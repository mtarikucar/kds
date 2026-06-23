import { BadRequestException, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  IngenicoTerminalProvider,
  IngenicoEcrRequest,
  IngenicoEcrResponse,
} from "./ingenico-terminal-provider";
import { PaymentProviderRegistry } from "../payment-provider.registry";
import { PaymentIntentRequest } from "../payment-provider.interface";

/**
 * Ingenico card-present terminal provider.
 *
 * The terminal is on-prem: createIntent reserves a `cardPresent` intent and
 * dispatches a `charge_card` device command to the paired terminal via the
 * Local Bridge; status() polls that command's `result` JSON for the ECR
 * response; refund() enqueues a PaymentReversal. These tests use test doubles
 * for the registry, the CommandQueueService, Prisma and ConfigService — no
 * real device, no fabricated "always success".
 */
describe("IngenicoTerminalProvider", () => {
  let provider: IngenicoTerminalProvider;
  let registry: PaymentProviderRegistry;
  let commands: { enqueue: jest.Mock };
  let prisma: {
    deviceCommand: { findFirst: jest.Mock };
    device: { findFirst: jest.Mock };
  };
  let config: ConfigService;

  const OLD_ENV = process.env.INGENICO_ECR_ENABLED;

  beforeEach(() => {
    registry = new PaymentProviderRegistry();
    commands = { enqueue: jest.fn().mockResolvedValue({ id: "cmd-1" }) };
    prisma = {
      deviceCommand: { findFirst: jest.fn() },
      device: { findFirst: jest.fn() },
    };
    config = { get: jest.fn() } as unknown as ConfigService;
    provider = new IngenicoTerminalProvider(
      registry,
      commands as any,
      prisma as any,
      config,
    );
  });

  afterEach(() => {
    if (OLD_ENV === undefined) delete process.env.INGENICO_ECR_ENABLED;
    else process.env.INGENICO_ECR_ENABLED = OLD_ENV;
    jest.restoreAllMocks();
  });

  function intentReq(
    overrides: Partial<PaymentIntentRequest> = {},
  ): PaymentIntentRequest {
    return {
      tenantId: "t-1",
      externalRef: "ORD-42",
      idempotencyKey: "idem-abc",
      amountCents: 14990,
      currency: "TRY",
      purpose: "pos",
      metadata: { deviceId: "term-1", branchId: "b-1" },
      ...overrides,
    };
  }

  describe("identity", () => {
    it("is id=ingenico, modes=[cardPresent]", () => {
      expect(provider.id).toBe("ingenico");
      expect(provider.modes).toEqual(["cardPresent"]);
    });
  });

  describe("onModuleInit registration (env-gated)", () => {
    it("registers when INGENICO_ECR_ENABLED=true", () => {
      process.env.INGENICO_ECR_ENABLED = "true";
      const spy = jest.spyOn(registry, "register");
      provider.onModuleInit();
      expect(spy).toHaveBeenCalledWith(provider);
      expect(registry.get("ingenico")).toBe(provider);
    });

    it("does NOT register when the env flag is absent", () => {
      delete process.env.INGENICO_ECR_ENABLED;
      const spy = jest.spyOn(registry, "register");
      provider.onModuleInit();
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe("createIntent", () => {
    it("dispatches a charge_card command with a faithful ECR CardPayment request", async () => {
      const intent = await provider.createIntent(intentReq());

      expect(commands.enqueue).toHaveBeenCalledTimes(1);
      const [tenantId, deviceId, input, branchId] =
        commands.enqueue.mock.calls[0];
      expect(tenantId).toBe("t-1");
      expect(deviceId).toBe("term-1");
      expect(branchId).toBe("b-1");
      expect(input.kind).toBe("charge_card");
      expect(input.idempotencyKey).toBe("idem-abc");

      const ecr = input.payload.ecrRequest as IngenicoEcrRequest;
      expect(ecr.requestType).toBe("CardPayment");
      expect(ecr.amountMinor).toBe(14990);
      expect(ecr.currency).toBe("TRY");
      expect(ecr.posReference).toBe("ING-idem-abc");
      expect(ecr.externalRef).toBe("ORD-42");
      expect(ecr.slipText).toBe("pos");

      // The charge is queued, not yet authorised.
      expect(intent.providerId).toBe("ingenico");
      expect(intent.intentId).toBe("ING-idem-abc");
      expect(intent.status).toBe("requires_action");
      expect(intent.amountCents).toBe(14990);
    });

    it("forwards the caller idempotencyKey as the command key (no double-charge on retry)", async () => {
      await provider.createIntent(intentReq());
      await provider.createIntent(intentReq());
      // The provider does not itself dedup; it relies on enqueue's
      // (deviceId, idempotencyKey) uniqueness — assert it forwards the SAME key.
      expect(commands.enqueue.mock.calls[0][2].idempotencyKey).toBe("idem-abc");
      expect(commands.enqueue.mock.calls[1][2].idempotencyKey).toBe("idem-abc");
    });

    it("rejects when metadata.deviceId (paired terminal) is missing", async () => {
      await expect(
        provider.createIntent(intentReq({ metadata: {} })),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(commands.enqueue).not.toHaveBeenCalled();
    });

    it("rejects a non-positive / non-integer amount before dispatching", async () => {
      await expect(
        provider.createIntent(intentReq({ amountCents: 0 })),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        provider.createIntent(intentReq({ amountCents: 12.5 })),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(commands.enqueue).not.toHaveBeenCalled();
    });
  });

  describe("status (polls the command result — never fabricates success)", () => {
    function ecrResult(ecr: IngenicoEcrResponse) {
      return { ecrResponse: ecr };
    }

    it("maps a queued/inflight command (no result) to pending", async () => {
      prisma.deviceCommand.findFirst.mockResolvedValue({
        status: "inflight",
        result: null,
        error: null,
      });
      const tx = await provider.status("ING-idem-abc");
      expect(tx.status).toBe("pending");
      expect(prisma.deviceCommand.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { idempotencyKey: "idem-abc", kind: "charge_card" },
        }),
      );
    });

    it("maps an ECR Success response to succeeded + carries auth trail", async () => {
      prisma.deviceCommand.findFirst.mockResolvedValue({
        status: "done",
        result: ecrResult({
          overallResult: "Success",
          acquirerTransactionId: "HOST-9911",
          authorisationCode: "A1B2C3",
          cardCircuit: "VISA",
          maskedPan: "4242 **** **** 1234",
        }),
        error: null,
      });
      const tx = await provider.status("ING-idem-abc");
      expect(tx.status).toBe("succeeded");
      expect(tx.acquirerRef).toBe("HOST-9911");
      expect(tx.authCode).toBe("A1B2C3");
      expect(tx.cardBrand).toBe("VISA");
      expect(tx.cardLast4).toBe("1234");
    });

    it("maps an ECR Failure response to failed", async () => {
      prisma.deviceCommand.findFirst.mockResolvedValue({
        status: "done",
        result: ecrResult({
          overallResult: "Failure",
          responseCode: "51",
          responseText: "Insufficient funds",
        }),
        error: null,
      });
      const tx = await provider.status("ING-idem-abc");
      expect(tx.status).toBe("failed");
    });

    it("treats a done command with NO parseable ECR response as failed (no silent success)", async () => {
      prisma.deviceCommand.findFirst.mockResolvedValue({
        status: "done",
        result: {},
        error: null,
      });
      const tx = await provider.status("ING-idem-abc");
      expect(tx.status).toBe("failed");
    });

    it("maps a terminal `failed`/`expired` command to failed", async () => {
      prisma.deviceCommand.findFirst.mockResolvedValue({
        status: "failed",
        result: null,
        error: "No ack received",
      });
      const tx = await provider.status("ING-idem-abc");
      expect(tx.status).toBe("failed");
    });

    it("404s an unknown intent", async () => {
      prisma.deviceCommand.findFirst.mockResolvedValue(null);
      await expect(provider.status("ING-nope")).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it("rejects a malformed intentId (missing ING- prefix)", async () => {
      await expect(provider.status("garbage")).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe("refund (PaymentReversal to the terminal)", () => {
    it("enqueues a PaymentReversal referencing the original acquirer transaction", async () => {
      prisma.deviceCommand.findFirst.mockResolvedValue({
        tenantId: "t-1",
        deviceId: "term-1",
        branchId: "b-1",
        result: {
          ecrResponse: {
            overallResult: "Success",
            acquirerTransactionId: "HOST-9911",
          },
        },
      });
      const out = await provider.refund({
        intentId: "ING-idem-abc",
        idempotencyKey: "idem-rv-1",
        reason: "customer cancelled",
      });
      expect(out.providerId).toBe("ingenico");
      expect(out.status).toBe("pending");
      const ecr = commands.enqueue.mock.calls[0][2].payload
        .ecrRequest as IngenicoEcrRequest;
      expect(ecr.requestType).toBe("PaymentReversal");
      expect(ecr.originalTransactionId).toBe("HOST-9911");
      expect(commands.enqueue.mock.calls[0][2].idempotencyKey).toBe(
        "idem-rv-1",
      );
    });

    it("refuses to reverse an intent with no completed acquirer transaction", async () => {
      prisma.deviceCommand.findFirst.mockResolvedValue({
        tenantId: "t-1",
        deviceId: "term-1",
        branchId: "b-1",
        result: { ecrResponse: { overallResult: "Failure" } },
      });
      await expect(
        provider.refund({ intentId: "ING-idem-abc", idempotencyKey: "rv" }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(commands.enqueue).not.toHaveBeenCalled();
    });

    it("404s a refund for an unknown intent", async () => {
      prisma.deviceCommand.findFirst.mockResolvedValue(null);
      await expect(
        provider.refund({ intentId: "ING-x", idempotencyKey: "rv" }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("parseWebhook / healthCheck", () => {
    it("parseWebhook is a no-op (terminals push via the bridge, not HTTP)", async () => {
      await expect(provider.parseWebhook("", "")).resolves.toEqual([]);
    });

    it("healthCheck reflects the enable flag", async () => {
      process.env.INGENICO_ECR_ENABLED = "true";
      await expect(provider.healthCheck()).resolves.toMatchObject({ ok: true });
      delete process.env.INGENICO_ECR_ENABLED;
      await expect(provider.healthCheck()).resolves.toMatchObject({
        ok: false,
      });
    });
  });

  describe("PaymentTerminal (paired device)", () => {
    function term() {
      return provider.terminalFor({
        deviceId: "term-1",
        tenantId: "t-1",
        branchId: "b-1",
      });
    }

    it("exposes the PaymentTerminal shape", () => {
      const t = term();
      expect(t.id).toBe("ingenico:term-1");
      expect(t.providerId).toBe("ingenico");
      expect(t.deviceId).toBe("term-1");
    });

    it("charge enqueues a charge_card CardPayment and returns pending", async () => {
      const t = term();
      const tx = await t.charge({
        amountCents: 5000,
        currency: "TRY",
        idempotencyKey: "ck-1",
      });
      expect(tx.status).toBe("pending");
      expect(tx.amountCents).toBe(5000);
      const ecr = commands.enqueue.mock.calls[0][2].payload
        .ecrRequest as IngenicoEcrRequest;
      expect(ecr.requestType).toBe("CardPayment");
      expect(ecr.amountMinor).toBe(5000);
      expect(commands.enqueue.mock.calls[0][2].idempotencyKey).toBe("ck-1");
    });

    it("charge rejects a non-positive amount", async () => {
      const t = term();
      await expect(
        t.charge({ amountCents: -1, currency: "TRY", idempotencyKey: "x" }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("void enqueues a PaymentReversal for a completed charge", async () => {
      prisma.deviceCommand.findFirst.mockResolvedValue({
        result: {
          ecrResponse: {
            overallResult: "Success",
            acquirerTransactionId: "HOST-555",
          },
        },
      });
      const t = term();
      await t.void("ING-ck-1");
      const ecr = commands.enqueue.mock.calls[0][2].payload
        .ecrRequest as IngenicoEcrRequest;
      expect(ecr.requestType).toBe("PaymentReversal");
      expect(ecr.originalTransactionId).toBe("HOST-555");
    });

    it("void refuses when there is no completed acquirer transaction", async () => {
      prisma.deviceCommand.findFirst.mockResolvedValue({
        result: { ecrResponse: { overallResult: "Pending" } },
      });
      const t = term();
      await expect(t.void("ING-ck-1")).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it("status maps device status to terminal liveness", async () => {
      const t = term();
      prisma.device.findFirst.mockResolvedValueOnce({ status: "online" });
      await expect(t.status()).resolves.toEqual({ status: "online" });

      prisma.device.findFirst.mockResolvedValueOnce({ status: "busy" });
      await expect(t.status()).resolves.toEqual({ status: "busy" });

      prisma.device.findFirst.mockResolvedValueOnce({ status: "offline" });
      await expect(t.status()).resolves.toMatchObject({ status: "offline" });

      prisma.device.findFirst.mockResolvedValueOnce(null);
      await expect(t.status()).resolves.toMatchObject({ status: "offline" });
    });
  });
});
