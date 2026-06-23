import { BadRequestException, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as crypto from "crypto";
import axios from "axios";
import { IyzicoPaymentProvider } from "./iyzico-payment-provider";
import { PaymentProviderRegistry } from "../payment-provider.registry";

/**
 * Real Iyzico online adapter. Mirrors the PaytrPaymentProvider spec structure:
 * the registry + ConfigService are stubbed, and the HTTP layer (axios) is
 * mocked so no network I/O occurs. The IYZWSv2 signing and the
 * X-IYZ-SIGNATURE-V3 webhook verification are the load-bearing crypto, so
 * they get exact-shape assertions against an independent reference impl.
 */

// axios.create() must return our controllable post-mock; the provider builds
// its instance in the constructor.
const postMock = jest.fn();
jest.mock("axios", () => ({
  __esModule: true,
  default: { create: jest.fn(() => ({ post: postMock })) },
}));
const mockedAxios = axios as jest.Mocked<typeof axios>;

const API_KEY = "sandbox-apiKey-xyz";
const SECRET_KEY = "sandbox-secretKey-abc";
const BASE_URL = "https://sandbox-api.iyzipay.com";

function makeConfig(overrides: Record<string, string | undefined> = {}) {
  const values: Record<string, string | undefined> = {
    IYZICO_API_KEY: API_KEY,
    IYZICO_SECRET_KEY: SECRET_KEY,
    IYZICO_BASE_URL: BASE_URL,
    ...overrides,
  };
  return {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
}

/** Independent reference of the IYZWSv2 header for cross-checking. */
function expectedAuthHeader(
  uriPath: string,
  serialisedBody: string,
  randomKey: string,
): string {
  const signature = crypto
    .createHmac("sha256", SECRET_KEY)
    .update(randomKey + uriPath + serialisedBody)
    .digest("hex");
  const authString = [
    `apiKey:${API_KEY}`,
    `randomKey:${randomKey}`,
    `signature:${signature}`,
  ].join("&");
  return `IYZWSv2 ${Buffer.from(authString, "utf8").toString("base64")}`;
}

function intentReq(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: "t-1",
    externalRef: "SUB-tenant-1-1740000000",
    idempotencyKey: "idem-1",
    amountCents: 299900,
    currency: "TRY",
    purpose: "subscription",
    buyer: {
      name: "Ada Lovelace",
      email: "ada@example.com",
      phone: "+905551234567",
    },
    buyerIp: "85.34.78.112",
    returnUrl: "https://hummytummy.com/checkout/iyzico/callback",
    ...overrides,
  } as any;
}

describe("IyzicoPaymentProvider", () => {
  let provider: IyzicoPaymentProvider;
  let registry: PaymentProviderRegistry;

  beforeEach(() => {
    jest.clearAllMocks();
    registry = new PaymentProviderRegistry();
    provider = new IyzicoPaymentProvider(registry, makeConfig());
  });

  describe("identity", () => {
    it("is id=iyzico, modes=[online]", () => {
      expect(provider.id).toBe("iyzico");
      expect(provider.modes).toEqual(["online"]);
    });
  });

  describe("onModuleInit registration", () => {
    it("self-registers when credentials are present", () => {
      const spy = jest.spyOn(registry, "register");
      provider.onModuleInit();
      expect(spy).toHaveBeenCalledWith(provider);
      expect(registry.list().map((p) => p.id)).toContain("iyzico");
    });

    it("does NOT register when credentials are missing", () => {
      const bare = new IyzicoPaymentProvider(
        registry,
        makeConfig({ IYZICO_API_KEY: undefined, IYZICO_SECRET_KEY: undefined }),
      );
      const spy = jest.spyOn(registry, "register");
      bare.onModuleInit();
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe("createIntent", () => {
    beforeEach(() => {
      postMock.mockResolvedValue({
        data: {
          status: "success",
          token: "tok-abc-123",
          checkoutFormContent: "<script>iyziInit()</script>",
          paymentPageUrl: "https://sandbox-cpp.iyzipay.com/?token=tok-abc-123",
          tokenExpireTime: 1800,
        },
      });
    });

    it("creates an account on the iyzico instance via axios.create", () => {
      expect(mockedAxios.create as jest.Mock).toHaveBeenCalled();
    });

    it("POSTs to the checkoutform initialize path with a correct IYZWSv2 header", async () => {
      await provider.createIntent(intentReq());
      expect(postMock).toHaveBeenCalledTimes(1);
      const [url, bodyStr, opts] = postMock.mock.calls[0];
      expect(url).toBe(
        `${BASE_URL}/payment/iyzipos/checkoutform/initialize/auth/ecom`,
      );
      // Body is pre-serialised so the signed bytes == wire bytes.
      expect(typeof bodyStr).toBe("string");
      const randomKey = opts.headers["x-iyzi-rnd"];
      expect(randomKey).toMatch(/^[0-9a-f]+$/);
      expect(opts.headers.Authorization).toBe(
        expectedAuthHeader(
          "/payment/iyzipos/checkoutform/initialize/auth/ecom",
          bodyStr,
          randomKey,
        ),
      );
      expect(opts.headers["Content-Type"]).toBe("application/json");
    });

    it("returns requires_action with token + hosted form in clientAction", async () => {
      const intent = await provider.createIntent(intentReq());
      expect(intent).toMatchObject({
        providerId: "iyzico",
        intentId: "tok-abc-123",
        status: "requires_action",
        amountCents: 299900,
        currency: "TRY",
      });
      expect(intent.clientAction).toMatchObject({
        token: "tok-abc-123",
        paymentPageUrl: "https://sandbox-cpp.iyzipay.com/?token=tok-abc-123",
      });
    });

    it("sends a price + basketItems that sum to the total (major units)", async () => {
      await provider.createIntent(intentReq());
      const body = JSON.parse(postMock.mock.calls[0][1]);
      expect(body.price).toBe("2999.00");
      expect(body.paidPrice).toBe("2999.00");
      expect(body.currency).toBe("TRY");
      expect(body.basketItems).toHaveLength(1);
      expect(body.basketItems[0].price).toBe("2999.00");
    });

    it("forwards a multi-line basket and folds qty into the line price", async () => {
      await provider.createIntent(
        intentReq({
          amountCents: 148880,
          basket: [
            { name: "Yazarkasa", priceCents: 60000, qty: 2 },
            { name: "Pro Plan", priceCents: 28880, qty: 1 },
          ],
        }),
      );
      const body = JSON.parse(postMock.mock.calls[0][1]);
      expect(body.basketItems.map((b: any) => b.price)).toEqual([
        "1200.00",
        "288.80",
      ]);
    });

    it("rejects a basket whose sum != amountCents (catches repricing drift)", async () => {
      await expect(
        provider.createIntent(
          intentReq({
            amountCents: 100000,
            basket: [
              { name: "A", priceCents: 50000, qty: 1 },
              { name: "B", priceCents: 30000, qty: 1 },
            ],
          }),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(postMock).not.toHaveBeenCalled();
    });

    it("rejects the intent when buyer email/name or buyerIp is missing (fraud telemetry)", async () => {
      await expect(
        provider.createIntent(intentReq({ buyer: { name: "X" } })),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        provider.createIntent(intentReq({ buyerIp: undefined })),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(postMock).not.toHaveBeenCalled();
    });

    it("rejects the intent when returnUrl (callbackUrl) is missing", async () => {
      await expect(
        provider.createIntent(intentReq({ returnUrl: undefined })),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("derives the same conversationId for the same (externalRef, idempotencyKey) — idempotent", async () => {
      await provider.createIntent(intentReq());
      const first = JSON.parse(postMock.mock.calls[0][1]).conversationId;
      postMock.mockClear();
      await provider.createIntent(intentReq());
      const second = JSON.parse(postMock.mock.calls[0][1]).conversationId;
      expect(first).toBe(second);
    });

    it("surfaces a BadGateway when iyzico returns status=failure", async () => {
      postMock.mockResolvedValueOnce({
        data: {
          status: "failure",
          errorCode: "5",
          errorMessage: "Invalid signature",
        },
      });
      await expect(provider.createIntent(intentReq())).rejects.toThrow(
        /Invalid signature/,
      );
    });

    it("maps an axios transport failure to BadGateway (not a raw error)", async () => {
      postMock.mockRejectedValueOnce(new Error("ECONNRESET"));
      await expect(provider.createIntent(intentReq())).rejects.toThrow(
        /unreachable/i,
      );
    });
  });

  describe("status", () => {
    it("retrieves by token and maps SUCCESS -> succeeded with card metadata", async () => {
      postMock.mockResolvedValueOnce({
        data: {
          status: "success",
          paymentStatus: "SUCCESS",
          paymentId: "p-1",
          price: "2999.00",
          paidPrice: "2999.00",
          currency: "TRY",
          cardAssociation: "VISA",
          lastFourDigits: "4242",
          authCode: "AUTH9",
          hostReference: "host-xyz",
          itemTransactions: [{ paymentTransactionId: "ptx-1" }],
        },
      });
      const tx = await provider.status("tok-abc-123");
      expect(tx).toMatchObject({
        providerId: "iyzico",
        intentId: "tok-abc-123",
        status: "succeeded",
        amountCents: 299900,
        currency: "TRY",
        acquirerRef: "host-xyz",
        cardBrand: "VISA",
        cardLast4: "4242",
        authCode: "AUTH9",
      });
      const [url, , opts] = postMock.mock.calls[0];
      expect(url).toBe(
        `${BASE_URL}/payment/iyzipos/checkoutform/auth/ecom/detail`,
      );
      expect(opts.headers.Authorization).toContain("IYZWSv2 ");
    });

    it("maps FAILURE -> failed and INIT_THREEDS -> requires_action", async () => {
      postMock.mockResolvedValueOnce({
        data: { status: "success", paymentStatus: "FAILURE", price: "10.00" },
      });
      expect((await provider.status("t")).status).toBe("failed");
      postMock.mockResolvedValueOnce({
        data: {
          status: "success",
          paymentStatus: "INIT_THREEDS",
          price: "10.00",
        },
      });
      expect((await provider.status("t")).status).toBe("requires_action");
    });
  });

  describe("refund", () => {
    it("resolves the paymentTransactionId via retrieve then POSTs /payment/refund (full refund)", async () => {
      postMock
        .mockResolvedValueOnce({
          data: {
            status: "success",
            paymentStatus: "SUCCESS",
            paidPrice: "2999.00",
            currency: "TRY",
            itemTransactions: [{ paymentTransactionId: "ptx-77" }],
          },
        })
        .mockResolvedValueOnce({
          data: {
            status: "success",
            paymentTransactionId: "ptx-77",
            price: "2999.00",
          },
        });
      const out = await provider.refund({
        intentId: "tok-abc-123",
        idempotencyKey: "refund-idem-1",
        reason: "buyer_request",
      });
      expect(out).toMatchObject({
        providerId: "iyzico",
        intentId: "tok-abc-123",
        refundId: "ptx-77",
        status: "refunded",
        amountCents: 299900,
      });
      const [refundUrl, refundBodyStr] = postMock.mock.calls[1];
      expect(refundUrl).toBe(`${BASE_URL}/payment/refund`);
      const refundBody = JSON.parse(refundBodyStr);
      expect(refundBody.paymentTransactionId).toBe("ptx-77");
      // Full refund: no price field.
      expect(refundBody.price).toBeUndefined();
      // Idempotency forwarded as conversationId.
      expect(refundBody.conversationId).toBe("refund-idem-1");
    });

    it("sends a price for a partial refund and reports partial_refund", async () => {
      postMock
        .mockResolvedValueOnce({
          data: {
            status: "success",
            paidPrice: "2999.00",
            currency: "TRY",
            itemTransactions: [{ paymentTransactionId: "ptx-88" }],
          },
        })
        .mockResolvedValueOnce({
          data: { status: "success", paymentTransactionId: "ptx-88" },
        });
      const out = await provider.refund({
        intentId: "tok-abc-123",
        idempotencyKey: "refund-idem-2",
        amountCents: 50000,
      });
      expect(out.status).toBe("partial_refund");
      expect(out.amountCents).toBe(50000);
      const refundBody = JSON.parse(postMock.mock.calls[1][1]);
      expect(refundBody.price).toBe("500.00");
    });

    it("throws BadRequest when the original payment has no resolvable transaction id", async () => {
      postMock.mockResolvedValueOnce({
        data: { status: "success", itemTransactions: [] },
      });
      await expect(
        provider.refund({ intentId: "tok-x", idempotencyKey: "r" }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("reports failed when iyzico rejects the refund", async () => {
      postMock
        .mockResolvedValueOnce({
          data: {
            status: "success",
            paidPrice: "2999.00",
            itemTransactions: [{ paymentTransactionId: "ptx-99" }],
          },
        })
        .mockResolvedValueOnce({
          data: { status: "failure", errorCode: "10", errorMessage: "nope" },
        });
      const out = await provider.refund({
        intentId: "tok-abc-123",
        idempotencyKey: "r3",
      });
      expect(out.status).toBe("failed");
    });
  });

  describe("parseWebhook", () => {
    function hppSig(body: Record<string, string>): string {
      const data =
        SECRET_KEY +
        body.iyziEventType +
        body.iyziPaymentId +
        body.token +
        body.paymentConversationId +
        body.status;
      return crypto.createHmac("sha256", SECRET_KEY).update(data).digest("hex");
    }
    function directSig(body: Record<string, string>): string {
      const data =
        SECRET_KEY +
        body.iyziEventType +
        body.paymentId +
        body.paymentConversationId +
        body.status;
      return crypto.createHmac("sha256", SECRET_KEY).update(data).digest("hex");
    }

    it("emits payment.succeeded for a valid HPP (token) webhook", async () => {
      const body = {
        iyziEventType: "CHECKOUT_FORM_AUTH",
        iyziPaymentId: "1234",
        token: "tok-abc-123",
        paymentConversationId: "conv-1",
        status: "SUCCESS",
        iyziReferenceCode: "ref-1",
      };
      const events = await provider.parseWebhook(
        hppSig(body),
        JSON.stringify(body),
      );
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        providerId: "iyzico",
        type: "payment.succeeded",
      });
      expect(events[0].payload).toMatchObject({
        token: "tok-abc-123",
        paymentId: "1234",
        conversationId: "conv-1",
        status: "SUCCESS",
      });
    });

    it("emits payment.failed for a valid direct (paymentId) FAILURE webhook", async () => {
      const body = {
        iyziEventType: "API_AUTH",
        paymentId: "9999",
        paymentConversationId: "conv-2",
        status: "FAILURE",
      };
      const events = await provider.parseWebhook(
        directSig(body),
        JSON.stringify(body),
      );
      expect(events[0].type).toBe("payment.failed");
      expect(events[0].payload.paymentId).toBe("9999");
    });

    it("rejects a forged signature with UnauthorizedException", async () => {
      const body = {
        iyziEventType: "CHECKOUT_FORM_AUTH",
        iyziPaymentId: "1234",
        token: "tok-abc-123",
        paymentConversationId: "conv-1",
        status: "SUCCESS",
      };
      await expect(
        provider.parseWebhook("deadbeefdeadbeef", JSON.stringify(body)),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it("rejects when the signature binds status (tampered SUCCESS->FAILURE)", async () => {
      const signed = {
        iyziEventType: "CHECKOUT_FORM_AUTH",
        iyziPaymentId: "1234",
        token: "tok-abc-123",
        paymentConversationId: "conv-1",
        status: "FAILURE",
      };
      const sig = hppSig(signed);
      // Re-send the SAME signature but flip status to SUCCESS in the body.
      const tampered = { ...signed, status: "SUCCESS" };
      await expect(
        provider.parseWebhook(sig, JSON.stringify(tampered)),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it("rejects a missing signature header", async () => {
      const body = { iyziEventType: "X", paymentId: "1", status: "SUCCESS" };
      await expect(
        provider.parseWebhook("", JSON.stringify(body)),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it("rejects when secretKey is missing (misconfigured deploy)", async () => {
      const bare = new IyzicoPaymentProvider(
        registry,
        makeConfig({ IYZICO_SECRET_KEY: undefined }),
      );
      const body = { iyziEventType: "X", paymentId: "1", status: "SUCCESS" };
      await expect(
        bare.parseWebhook("anything", JSON.stringify(body)),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it("rejects a non-JSON body", async () => {
      await expect(
        provider.parseWebhook("sig", "not-json"),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it("accepts a Buffer body (raw webhook bytes)", async () => {
      const body = {
        iyziEventType: "CHECKOUT_FORM_AUTH",
        iyziPaymentId: "1234",
        token: "tok-abc-123",
        paymentConversationId: "conv-1",
        status: "SUCCESS",
      };
      const events = await provider.parseWebhook(
        hppSig(body),
        Buffer.from(JSON.stringify(body), "utf8"),
      );
      expect(events[0].type).toBe("payment.succeeded");
    });
  });

  describe("healthCheck", () => {
    it("reports ok + sandbox mode when configured", async () => {
      const hc = await provider.healthCheck();
      expect(hc.ok).toBe(true);
      expect(hc.details).toMatchObject({ configured: true, mode: "sandbox" });
    });

    it("reports not-ok when credentials are missing", async () => {
      const bare = new IyzicoPaymentProvider(
        registry,
        makeConfig({ IYZICO_API_KEY: undefined, IYZICO_SECRET_KEY: undefined }),
      );
      expect((await bare.healthCheck()).ok).toBe(false);
    });

    it("reports production mode for the live baseUrl", async () => {
      const prod = new IyzicoPaymentProvider(
        registry,
        makeConfig({ IYZICO_BASE_URL: "https://api.iyzipay.com" }),
      );
      expect((await prod.healthCheck()).details).toMatchObject({
        mode: "production",
      });
    });
  });
});
