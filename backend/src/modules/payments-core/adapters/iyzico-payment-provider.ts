import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as crypto from "crypto";
import axios, { AxiosInstance } from "axios";
import {
  PaymentIntent,
  PaymentIntentRequest,
  PaymentMode,
  PaymentProvider,
  PaymentStatus,
  PaymentTransaction,
  ProviderWebhookEvent,
  RefundRequest,
  RefundTransaction,
} from "../payment-provider.interface";
import { PaymentProviderRegistry } from "../payment-provider.registry";

/**
 * Real Iyzico online payment adapter behind the provider-neutral
 * PaymentProvider interface.
 *
 * Mode coverage: 'online' only — the Iyzico hosted CheckoutForm (a.k.a.
 * "pay with iyzico" / 3DS payment page). Card-present is a separate provider
 * once a terminal/acquirer integration is signed, exactly like PayTR.
 *
 * Why a from-scratch adapter rather than a shim over an existing service:
 * unlike PayTR (whose live PaytrAdapter the façade shim wraps), there is no
 * pre-existing Iyzico code path in this codebase. This class IS the Iyzico
 * integration — it speaks Iyzico's documented v2 REST API directly over
 * axios and signs each request with the IYZWSv2 HMAC-SHA256 auth header.
 *
 * Auth (IYZWSv2), per Iyzico's v2 docs + the official iyzipay-node lib:
 *   signature   = HMAC_SHA256(secretKey, randomKey + uriPath + JSON.stringify(body)).hex
 *   authString  = "apiKey:<apiKey>&randomKey:<randomKey>&signature:<signature>"
 *   header      = "IYZWSv2 " + base64(authString)
 *   x-iyzi-rnd  = randomKey
 * The exact same `body` object that is JSON-serialised for the signature MUST
 * be the request body sent on the wire — any field-ordering / whitespace
 * difference breaks the HMAC. We therefore serialise once and reuse the
 * string for both the signature and the POST body.
 *
 * Credentials (apiKey / secretKey / baseUrl) come from config, never
 * hardcoded. baseUrl selects sandbox vs prod:
 *   sandbox: https://sandbox-api.iyzipay.com
 *   prod:    https://api.iyzipay.com
 */

/** Iyzico CheckoutForm REST endpoints (paths only; baseUrl from config). */
const CHECKOUTFORM_INITIALIZE_PATH =
  "/payment/iyzipos/checkoutform/initialize/auth/ecom";
const CHECKOUTFORM_RETRIEVE_PATH =
  "/payment/iyzipos/checkoutform/auth/ecom/detail";
const REFUND_PATH = "/payment/refund";

/** Default HTTP timeout — Iyzico's gateway is occasionally slow under load. */
const HTTP_TIMEOUT_MS = 15_000;

/** Iyzico's randomKey size used by the official client (`x-iyzi-rnd`). */
const RANDOM_KEY_BYTES = 12;

type IyziLocale = "tr" | "en";

/** A single line in the Iyzico basket. priceCents folds qty in (no qty field). */
interface IyziBasketItem {
  id: string;
  name: string;
  category1: string;
  itemType: "VIRTUAL" | "PHYSICAL";
  price: string; // major units, dotted decimal — sum MUST equal `price`
}

/** Shape of the CheckoutForm initialize request body we sign + POST. */
interface CheckoutFormInitializeBody {
  locale: IyziLocale;
  conversationId: string;
  price: string;
  paidPrice: string;
  currency: string;
  basketId: string;
  paymentGroup: "PRODUCT" | "SUBSCRIPTION" | "LISTING";
  callbackUrl: string;
  enabledInstallments: number[];
  buyer: {
    id: string;
    name: string;
    surname: string;
    email: string;
    gsmNumber?: string;
    identityNumber: string;
    registrationAddress: string;
    ip: string;
    city: string;
    country: string;
  };
  shippingAddress: {
    contactName: string;
    city: string;
    country: string;
    address: string;
  };
  billingAddress: {
    contactName: string;
    city: string;
    country: string;
    address: string;
  };
  basketItems: IyziBasketItem[];
}

/** Iyzico's common response envelope fields (status/errorCode/errorMessage). */
interface IyziResponseEnvelope {
  status?: string; // "success" | "failure"
  errorCode?: string;
  errorMessage?: string;
  locale?: string;
  conversationId?: string;
  systemTime?: number;
}

interface CheckoutFormInitializeResponse extends IyziResponseEnvelope {
  token?: string;
  checkoutFormContent?: string;
  paymentPageUrl?: string;
  tokenExpireTime?: number;
}

interface CheckoutFormRetrieveResponse extends IyziResponseEnvelope {
  token?: string;
  paymentStatus?: string; // SUCCESS | FAILURE | INIT_THREEDS | CALLBACK_THREEDS | BKM_POS_SELECTED | ...
  paymentId?: string;
  price?: string;
  paidPrice?: string;
  currency?: string;
  basketId?: string;
  fraudStatus?: number;
  cardType?: string;
  cardAssociation?: string; // VISA | MASTER_CARD | ...
  cardFamily?: string;
  lastFourDigits?: string;
  authCode?: string;
  hostReference?: string;
  itemTransactions?: Array<{ paymentTransactionId?: string }>;
}

interface RefundResponse extends IyziResponseEnvelope {
  paymentId?: string;
  paymentTransactionId?: string;
  price?: string;
  currency?: string;
  hostReference?: string;
}

/**
 * Webhook payload Iyzico POSTs to the notification URL. Two documented
 * shapes — "HPP" (hosted page; carries `token` + `iyziPaymentId`) and
 * "direct" (carries `paymentId`). We support both and verify the
 * X-IYZ-SIGNATURE-V3 header against the matching field order.
 */
interface IyziWebhookBody {
  iyziEventType?: string; // e.g. CHECKOUT_FORM_AUTH, API_AUTH, THREE_DS_AUTH
  iyziEventTime?: number;
  iyziReferenceCode?: string;
  token?: string; // HPP only
  paymentId?: string; // direct
  iyziPaymentId?: string; // HPP
  paymentConversationId?: string;
  merchantId?: string;
  status?: string; // SUCCESS | FAILURE | ...
}

@Injectable()
export class IyzicoPaymentProvider implements PaymentProvider, OnModuleInit {
  readonly id = "iyzico";
  readonly modes: PaymentMode[] = ["online"];
  private readonly logger = new Logger(IyzicoPaymentProvider.name);
  private readonly http: AxiosInstance;

  constructor(
    private readonly registry: PaymentProviderRegistry,
    private readonly config: ConfigService,
  ) {
    this.http = axios.create({ timeout: HTTP_TIMEOUT_MS });
  }

  onModuleInit(): void {
    // Mirror the PayTR provider: only self-register when credentials are
    // present, so dev/CI environments that haven't configured Iyzico don't
    // surface a half-wired provider the façade could dispatch to.
    const { apiKey, secretKey } = this.readCredentials();
    if (apiKey && secretKey) {
      this.registry.register(this);
    } else {
      this.logger.warn("Iyzico credentials missing — provider not registered");
    }
  }

  /* ------------------------------------------------------------------ */
  /* PaymentProvider surface                                            */
  /* ------------------------------------------------------------------ */

  /**
   * Idempotent per the interface contract: the same `idempotencyKey` must
   * map to the same intent. Iyzico has no server-side idempotency key on
   * CheckoutForm initialize, so we bind idempotency through the
   * `conversationId` — we derive it deterministically from
   * (externalRef, idempotencyKey). Re-issuing the same key produces an
   * intent carrying the same conversationId; Iyzico itself dedups
   * settlement on the buyer's actual card auth, and our outbox keys on
   * conversationId downstream. The `basketId` is `externalRef` so the
   * settlement event can be tied back to the order/subscription row.
   */
  async createIntent(req: PaymentIntentRequest): Promise<PaymentIntent> {
    const { apiKey, secretKey, baseUrl } = this.requireCredentials();

    // Iyzico requires a full structured buyer + IP for fraud scoring.
    // Mirror the PayTR adapter's posture: reject the intent up front with a
    // precise list of what's missing rather than submit placeholder
    // telemetry that pollutes the acquirer's risk model.
    const buyer = req.buyer ?? {};
    const missing: string[] = [];
    if (!buyer.email) missing.push("buyer.email");
    if (!buyer.name) missing.push("buyer.name");
    if (!req.buyerIp) missing.push("buyerIp");
    if (missing.length > 0) {
      throw new BadRequestException(
        `Iyzico intent requires: ${missing.join(", ")}. Provide them at checkout — fraud-scoring needs real values.`,
      );
    }

    if (!req.returnUrl) {
      // Iyzico delivers BOTH success and failure to a single callbackUrl;
      // without it the hosted form has nowhere to return the buyer and the
      // settlement webhook can't be correlated to a page.
      throw new BadRequestException(
        "Iyzico intent requires returnUrl (callbackUrl for the hosted CheckoutForm).",
      );
    }

    const price = this.centsToMajor(req.amountCents);
    const conversationId = this.deriveConversationId(req);
    const basketItems = this.buildBasketItems(req);

    const { name, surname } = this.splitName(buyer.name);
    const addressLine = this.addressToString(buyer.address);

    const body: CheckoutFormInitializeBody = {
      locale: this.resolveLocale(req),
      conversationId,
      price,
      paidPrice: price,
      currency: req.currency,
      basketId: req.externalRef.slice(0, 255),
      paymentGroup: req.purpose === "subscription" ? "SUBSCRIPTION" : "PRODUCT",
      callbackUrl: req.returnUrl,
      enabledInstallments: [1],
      buyer: {
        id: this.buyerId(req),
        name,
        surname,
        email: buyer.email as string,
        gsmNumber: this.normaliseGsm(buyer.phone),
        // Iyzico requires an identityNumber; for non-TR / B2B flows a
        // documented placeholder is accepted in fraud-low merchants. Prefer
        // the buyer.taxId when present so the field carries real data.
        identityNumber: buyer.taxId ?? "11111111111",
        registrationAddress: addressLine,
        ip: req.buyerIp as string,
        city: "N/A",
        country: "Turkey",
      },
      shippingAddress: {
        contactName: buyer.name as string,
        city: "N/A",
        country: "Turkey",
        address: addressLine,
      },
      billingAddress: {
        contactName: buyer.name as string,
        city: "N/A",
        country: "Turkey",
        address: addressLine,
      },
      basketItems,
    };

    const res = await this.post<CheckoutFormInitializeResponse>(
      baseUrl,
      CHECKOUTFORM_INITIALIZE_PATH,
      body,
      apiKey,
      secretKey,
    );

    if (res.status !== "success" || !res.token) {
      this.logger.error(
        `Iyzico checkoutform initialize rejected: ${res.errorCode ?? "?"} ${res.errorMessage ?? ""}`,
      );
      throw new BadGatewayException(
        res.errorMessage ?? "Iyzico rejected the payment intent",
      );
    }

    return {
      providerId: this.id,
      // The token is the durable handle for retrieve()/webhook correlation;
      // conversationId is our externalRef binding. We surface the token as
      // the intentId because status() retrieves by token.
      intentId: res.token,
      status: "requires_action", // buyer must complete the hosted 3DS form
      amountCents: req.amountCents,
      currency: req.currency,
      clientAction: {
        token: res.token,
        checkoutFormContent: res.checkoutFormContent,
        paymentPageUrl: res.paymentPageUrl,
        tokenExpireTime: res.tokenExpireTime,
        conversationId,
      },
    };
  }

  /**
   * Retrieve the authoritative status of a CheckoutForm by its token
   * (the `intentId` we returned from createIntent). Settlement is
   * webhook-driven, but the façade also exposes this polling shape and the
   * webhook-recovery sweeper uses it as source of truth.
   */
  async status(intentId: string): Promise<PaymentTransaction> {
    const { apiKey, secretKey, baseUrl } = this.requireCredentials();

    const body = {
      locale: "tr" as IyziLocale,
      conversationId: intentId,
      token: intentId,
    };
    const res = await this.post<CheckoutFormRetrieveResponse>(
      baseUrl,
      CHECKOUTFORM_RETRIEVE_PATH,
      body,
      apiKey,
      secretKey,
    );

    const amountCents = res.paidPrice
      ? this.majorToCents(res.paidPrice)
      : res.price
        ? this.majorToCents(res.price)
        : 0;

    return {
      providerId: this.id,
      intentId,
      status: this.mapPaymentStatus(res.paymentStatus),
      amountCents,
      currency: res.currency ?? "TRY",
      acquirerRef: res.hostReference,
      authCode: res.authCode,
      cardBrand: res.cardAssociation,
      cardLast4: res.lastFourDigits,
      raw: res as unknown as Record<string, unknown>,
    };
  }

  /**
   * Refund a settled transaction. Iyzico refunds at the
   * paymentTransactionId level (a payment may have several transactions —
   * one per basket item); the façade refunds against the intent, so we
   * resolve the paymentTransactionId via retrieve() unless the caller
   * passed it through metadata on the RefundRequest's idempotencyKey path.
   *
   * Idempotent per the interface: the same idempotencyKey is forwarded as
   * the Iyzico conversationId so a retried refund correlates to the same
   * logical operation in both systems.
   */
  async refund(req: RefundRequest): Promise<RefundTransaction> {
    const { apiKey, secretKey, baseUrl } = this.requireCredentials();

    // Resolve the transaction id from the original payment. `intentId` here
    // is the CheckoutForm token returned by createIntent.
    const detail = await this.post<CheckoutFormRetrieveResponse>(
      baseUrl,
      CHECKOUTFORM_RETRIEVE_PATH,
      {
        locale: "tr" as IyziLocale,
        conversationId: req.intentId,
        token: req.intentId,
      },
      apiKey,
      secretKey,
    );
    const paymentTransactionId =
      detail.itemTransactions?.[0]?.paymentTransactionId;
    if (!paymentTransactionId) {
      throw new BadRequestException(
        "Iyzico refund: could not resolve paymentTransactionId from the original payment.",
      );
    }

    const refundBody: Record<string, unknown> = {
      locale: "tr",
      conversationId: req.idempotencyKey,
      paymentTransactionId,
      // Omitted amount = full refund of that transaction.
      ...(typeof req.amountCents === "number"
        ? { price: this.centsToMajor(req.amountCents) }
        : {}),
      currency: detail.currency ?? "TRY",
      reason: req.reason,
    };

    const res = await this.post<RefundResponse>(
      baseUrl,
      REFUND_PATH,
      refundBody,
      apiKey,
      secretKey,
    );

    const succeeded = res.status === "success";
    if (!succeeded) {
      this.logger.warn(
        `Iyzico refund rejected for intent=${req.intentId}: ${res.errorCode ?? "?"} ${res.errorMessage ?? ""}`,
      );
    }

    return {
      providerId: this.id,
      intentId: req.intentId,
      refundId: res.paymentTransactionId ?? res.paymentId ?? req.idempotencyKey,
      status: succeeded
        ? typeof req.amountCents === "number"
          ? "partial_refund"
          : "refunded"
        : "failed",
      amountCents:
        req.amountCents ?? this.majorToCents(detail.paidPrice ?? "0"),
    };
  }

  /**
   * Verify the X-IYZ-SIGNATURE-V3 header on an Iyzico webhook and surface a
   * normalised event. Iyzico sends JSON (not form-urlencoded like PayTR) and
   * the signature is HMAC-SHA256(secretKey, <ordered fields>).hex.
   *
   * Two documented field orders — "HPP" (hosted page; has `token` +
   * `iyziPaymentId`) and "direct" (has `paymentId`). We compute the expected
   * signature for whichever shape the body matches and reject on mismatch,
   * mirroring the PayTR provider's refuse-to-emit-on-bad-hash posture so an
   * unverified body can never reach the outbox.
   */
  async parseWebhook(
    signature: string,
    raw: Buffer | string,
  ): Promise<ProviderWebhookEvent[]> {
    const bodyStr = typeof raw === "string" ? raw : raw.toString("utf8");
    let parsed: IyziWebhookBody;
    try {
      parsed = JSON.parse(bodyStr) as IyziWebhookBody;
    } catch {
      this.logger.warn("Rejected Iyzico webhook: body is not valid JSON");
      throw new UnauthorizedException("Iyzico webhook body invalid");
    }

    const { secretKey } = this.readCredentials();
    if (!secretKey) {
      this.logger.error(
        "Iyzico webhook verification skipped — secretKey missing in env",
      );
      throw new UnauthorizedException(
        "Iyzico webhook verification unavailable",
      );
    }

    const provided = (signature ?? "").trim();
    if (!provided) {
      this.logger.warn("Rejected Iyzico webhook: missing X-IYZ-SIGNATURE-V3");
      throw new UnauthorizedException("Iyzico webhook signature missing");
    }

    const expected = this.computeWebhookSignature(parsed, secretKey);
    if (!expected || !this.safeEqualHex(expected, provided)) {
      this.logger.warn(
        `Rejected Iyzico webhook with bad signature (eventType=${parsed.iyziEventType ?? "<none>"})`,
      );
      throw new UnauthorizedException("Iyzico webhook signature mismatch");
    }

    const status = String(parsed.status ?? "").toUpperCase();
    return [
      {
        providerId: this.id,
        type: status === "SUCCESS" ? "payment.succeeded" : "payment.failed",
        payload: {
          token: parsed.token,
          paymentId: parsed.iyziPaymentId ?? parsed.paymentId,
          conversationId: parsed.paymentConversationId,
          eventType: parsed.iyziEventType,
          status,
          referenceCode: parsed.iyziReferenceCode,
        },
      },
    ];
  }

  async healthCheck(): Promise<{
    ok: boolean;
    details?: Record<string, unknown>;
  }> {
    const { apiKey, secretKey, baseUrl } = this.readCredentials();
    const configured = Boolean(apiKey && secretKey);
    return {
      ok: configured,
      details: {
        configured,
        baseUrl: baseUrl,
        mode: baseUrl?.includes("sandbox") ? "sandbox" : "production",
      },
    };
  }

  /* ------------------------------------------------------------------ */
  /* Signing + HTTP                                                     */
  /* ------------------------------------------------------------------ */

  /**
   * Build the IYZWSv2 Authorization header and POST. The body is serialised
   * ONCE and the same string is used for both the HMAC and the wire payload
   * — any divergence in field order/whitespace would break the signature.
   */
  private async post<T extends IyziResponseEnvelope>(
    baseUrl: string,
    path: string,
    body: object,
    apiKey: string,
    secretKey: string,
  ): Promise<T> {
    const randomKey = this.generateRandomKey();
    const serialisedBody = JSON.stringify(body);
    const authorization = this.buildAuthorizationHeader(
      apiKey,
      secretKey,
      path,
      serialisedBody,
      randomKey,
    );

    try {
      const response = await this.http.post<T>(baseUrl + path, serialisedBody, {
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: authorization,
          "x-iyzi-rnd": randomKey,
          "x-iyzi-client-version": "kds-iyzico-1.0.0",
        },
        // We pre-serialise to guarantee byte-for-byte match with the signed
        // payload; tell axios to ship the string verbatim.
        transformRequest: [(data: unknown) => data as string],
      });
      return response.data;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Iyzico ${path} HTTP failure: ${message}`);
      throw new BadGatewayException("Iyzico is currently unreachable");
    }
  }

  /**
   * IYZWSv2 header:
   *   signature  = HMAC_SHA256(secretKey, randomKey + uriPath + body).hex
   *   authString = "apiKey:<k>&randomKey:<r>&signature:<s>"
   *   header     = "IYZWSv2 " + base64(authString)
   */
  private buildAuthorizationHeader(
    apiKey: string,
    secretKey: string,
    uriPath: string,
    serialisedBody: string,
    randomKey: string,
  ): string {
    const signature = crypto
      .createHmac("sha256", secretKey)
      .update(randomKey + uriPath + serialisedBody)
      .digest("hex");
    const authString = [
      `apiKey:${apiKey}`,
      `randomKey:${randomKey}`,
      `signature:${signature}`,
    ].join("&");
    return `IYZWSv2 ${Buffer.from(authString, "utf8").toString("base64")}`;
  }

  /**
   * Compute the expected X-IYZ-SIGNATURE-V3 for a webhook body. Iyzico
   * documents two concatenation orders; we pick by the fields present.
   *   HPP:    secretKey + iyziEventType + iyziPaymentId + token + paymentConversationId + status
   *   direct: secretKey + iyziEventType + paymentId + paymentConversationId + status
   */
  private computeWebhookSignature(
    body: IyziWebhookBody,
    secretKey: string,
  ): string | null {
    const eventType = body.iyziEventType ?? "";
    const conversationId = body.paymentConversationId ?? "";
    const status = body.status ?? "";

    let data: string | null = null;
    if (body.token && body.iyziPaymentId) {
      // HPP (hosted CheckoutForm) shape.
      data =
        secretKey +
        eventType +
        body.iyziPaymentId +
        body.token +
        conversationId +
        status;
    } else if (body.paymentId) {
      // Direct API shape.
      data = secretKey + eventType + body.paymentId + conversationId + status;
    }
    if (data === null) return null;
    return crypto.createHmac("sha256", secretKey).update(data).digest("hex");
  }

  /** Constant-time hex compare, length-guarded so it never throws. */
  private safeEqualHex(a: string, b: string): boolean {
    const bufA = Buffer.from(a, "utf8");
    const bufB = Buffer.from(b, "utf8");
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  }

  /* ------------------------------------------------------------------ */
  /* Mapping + helpers                                                  */
  /* ------------------------------------------------------------------ */

  private mapPaymentStatus(raw: string | undefined): PaymentStatus {
    switch (String(raw ?? "").toUpperCase()) {
      case "SUCCESS":
        return "succeeded";
      case "FAILURE":
        return "failed";
      case "INIT_THREEDS":
      case "CALLBACK_THREEDS":
      case "BKM_POS_SELECTED":
        return "requires_action";
      default:
        return "pending";
    }
  }

  /**
   * Build the Iyzico basketItems. Iyzico requires the basket lines to sum to
   * `price`; we fold qty into the line price (Iyzico has no qty field) and
   * sum-check against amountCents so a mis-priced basket fails noisily in
   * our code rather than as an Iyzico error, mirroring the PayTR adapter.
   */
  private buildBasketItems(req: PaymentIntentRequest): IyziBasketItem[] {
    if (req.basket && req.basket.length > 0) {
      const sumCents = req.basket.reduce(
        (acc, line) => acc + line.priceCents * line.qty,
        0,
      );
      if (sumCents !== req.amountCents) {
        throw new BadRequestException(
          `Iyzico basket sum mismatch: lines total ${sumCents} cents but amountCents=${req.amountCents}. Repricing drift?`,
        );
      }
      return req.basket.map((line, idx) => ({
        id: `${req.externalRef}-${idx}`.slice(0, 64),
        name: line.name.replace(/[\r\n\t]+/g, " ").slice(0, 80),
        category1: req.purpose,
        itemType: "VIRTUAL" as const,
        price: this.centsToMajor(line.priceCents * line.qty),
      }));
    }
    return [
      {
        id: req.externalRef.slice(0, 64),
        name: req.purpose.replace(/[\r\n\t]+/g, " ").slice(0, 80),
        category1: req.purpose,
        itemType: "VIRTUAL" as const,
        price: this.centsToMajor(req.amountCents),
      },
    ];
  }

  /** Iyzico prices are major-unit dotted decimals (e.g. "199.99"). */
  private centsToMajor(cents: number): string {
    return (cents / 100).toFixed(2);
  }

  private majorToCents(major: string): number {
    return Math.round(parseFloat(major) * 100);
  }

  private deriveConversationId(req: PaymentIntentRequest): string {
    // Deterministic from (externalRef, idempotencyKey) so a re-issued
    // idempotencyKey yields the same conversationId — the interface
    // documents createIntent as idempotent on idempotencyKey.
    return crypto
      .createHash("sha256")
      .update(`${req.externalRef}:${req.idempotencyKey}`)
      .digest("hex")
      .slice(0, 40);
  }

  private buyerId(req: PaymentIntentRequest): string {
    return (req.buyer?.email ?? req.tenantId).slice(0, 64);
  }

  private splitName(full: string | undefined): {
    name: string;
    surname: string;
  } {
    const parts = String(full ?? "")
      .trim()
      .split(/\s+/);
    if (parts.length <= 1) {
      return { name: parts[0] || "N/A", surname: parts[0] || "N/A" };
    }
    return {
      name: parts.slice(0, -1).join(" "),
      surname: parts[parts.length - 1],
    };
  }

  private addressToString(
    address: string | Record<string, unknown> | undefined,
  ): string {
    if (!address) return "N/A";
    if (typeof address === "string") return address.slice(0, 250) || "N/A";
    try {
      return JSON.stringify(address).slice(0, 250);
    } catch {
      return "N/A";
    }
  }

  private normaliseGsm(phone: string | undefined): string | undefined {
    if (!phone) return undefined;
    // Iyzico accepts E.164 (+90...). Upstream @NormalizePhone already yields
    // E.164; pass through, stripping any stray whitespace.
    return phone.replace(/\s+/g, "");
  }

  private resolveLocale(req: PaymentIntentRequest): IyziLocale {
    const raw = String(req.metadata?.locale ?? "tr").toLowerCase();
    return raw === "en" ? "en" : "tr";
  }

  private generateRandomKey(): string {
    return crypto.randomBytes(RANDOM_KEY_BYTES).toString("hex");
  }

  /* ------------------------------------------------------------------ */
  /* Credentials                                                        */
  /* ------------------------------------------------------------------ */

  private readCredentials(): {
    apiKey: string | undefined;
    secretKey: string | undefined;
    baseUrl: string;
  } {
    const apiKey = this.config.get<string>("IYZICO_API_KEY");
    const secretKey = this.config.get<string>("IYZICO_SECRET_KEY");
    // baseUrl selects sandbox vs prod; default to sandbox so a half-config
    // never points at the live acquirer by accident.
    const baseUrl =
      this.config.get<string>("IYZICO_BASE_URL") ??
      "https://sandbox-api.iyzipay.com";
    return { apiKey, secretKey, baseUrl: baseUrl.replace(/\/+$/, "") };
  }

  private requireCredentials(): {
    apiKey: string;
    secretKey: string;
    baseUrl: string;
  } {
    const { apiKey, secretKey, baseUrl } = this.readCredentials();
    if (!apiKey || !secretKey) {
      throw new BadRequestException("Iyzico credentials are not configured");
    }
    return { apiKey, secretKey, baseUrl };
  }
}
