import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Logger,
  SetMetadata,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ConfigService } from "@nestjs/config";
import { timingSafeEqual, createHmac } from "crypto";

/**
 * Mark a webhook handler with the platform it serves. The guard reads
 * this metadata rather than parsing the URL, so an admin misroute or
 * global-prefix change can't silently break signature verification.
 */
export const WEBHOOK_PLATFORM_KEY = "webhookPlatform";
export const WebhookPlatform = (platform: string) =>
  SetMetadata(WEBHOOK_PLATFORM_KEY, platform.toUpperCase());

/** Trendyol + Yemeksepeti: reject signed credentials older than this many seconds. */
const WEBHOOK_MAX_AGE_SECONDS = 300;

@Injectable()
export class WebhookAuthGuard implements CanActivate {
  private readonly logger = new Logger(WebhookAuthGuard.name);

  constructor(
    private configService: ConfigService,
    private reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const platform = this.reflector.getAllAndOverride<string>(
      WEBHOOK_PLATFORM_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!platform) {
      // Fail-closed: a webhook handler without metadata is a bug.
      throw new UnauthorizedException("Webhook platform not declared");
    }
    const request = context.switchToHttp().getRequest();
    switch (platform) {
      case "YEMEKSEPETI":
        return this.validateYemeksepetiWebhook(request);
      case "TRENDYOL":
        return this.validateTrendyolWebhook(request);
      default:
        this.logger.warn(`Unknown webhook platform: ${platform}`);
        throw new UnauthorizedException("Unknown webhook platform");
    }
  }

  private validateYemeksepetiWebhook(request: any): boolean {
    const authHeader = request.headers["authorization"];
    if (!authHeader) {
      throw new UnauthorizedException("Missing authorization header");
    }

    const token = authHeader.replace("Bearer ", "");
    const webhookSecret = this.configService.get<string>(
      "YEMEKSEPETI_WEBHOOK_SECRET",
    );

    if (!webhookSecret) {
      this.logger.warn("YEMEKSEPETI_WEBHOOK_SECRET not configured");
      throw new UnauthorizedException("Webhook secret not configured");
    }

    try {
      const parts = token.split(".");
      if (parts.length !== 3) {
        throw new Error("Invalid JWT format");
      }

      const [header, payload, signature] = parts;

      // Validate the `alg` header claim before computing anything.
      // The HMAC compute below uses SHA-512 unconditionally, so the
      // strict-equal comparison already rejects `alg: "none"` and any
      // foreign algorithm — but pinning the header explicitly is
      // defence-in-depth against a future refactor that swaps to a
      // JWT library and silently honours whatever `alg` the sender
      // declared. The classic alg-confusion attack pivots on exactly
      // that gap.
      let decodedHeader: any;
      try {
        decodedHeader = JSON.parse(
          Buffer.from(header, "base64url").toString("utf8"),
        );
      } catch {
        throw new Error("Invalid JWT header");
      }
      if (decodedHeader.alg !== "HS512") {
        throw new Error(`Unsupported JWT alg: ${decodedHeader.alg}`);
      }

      const expectedSignature = createHmac("sha512", webhookSecret)
        .update(`${header}.${payload}`)
        .digest("base64url");

      const sigBuf = Buffer.from(signature, "utf8");
      const expBuf = Buffer.from(expectedSignature, "utf8");
      if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
        throw new Error("Invalid signature");
      }

      const decoded = JSON.parse(
        Buffer.from(payload, "base64url").toString("utf8"),
      );
      // Defensive: `exp` must be a number, and the token must be fresh.
      const nowSec = Date.now() / 1000;
      if (typeof decoded.exp !== "number" || decoded.exp < nowSec) {
        throw new Error("Token expired or malformed");
      }
      // Freshness window mirrors the Trendyol path. The JWT is a bearer
      // credential — it isn't bound to the request body — so a captured
      // long-lived token could otherwise be replayed with a different
      // body until exp lapses. Downstream `processIncomingOrder` dedupes
      // on externalOrderId so replay of the SAME body is harmless, but
      // an attacker pairing the JWT with a fresh body is not blocked by
      // dedup. Require `iat` within the last 5 minutes.
      if (
        typeof decoded.iat !== "number" ||
        nowSec - decoded.iat > WEBHOOK_MAX_AGE_SECONDS
      ) {
        throw new Error("Token issued-at outside freshness window");
      }
      // Also defend against clock skew shipping tokens with iat in the
      // future — reject anything more than 60s ahead.
      if (decoded.iat - nowSec > 60) {
        throw new Error("Token issued-at in the future");
      }

      return true;
    } catch (error: any) {
      this.logger.warn(`Yemeksepeti webhook auth failed: ${error.message}`);
      throw new UnauthorizedException("Invalid webhook signature");
    }
  }

  private validateTrendyolWebhook(request: any): boolean {
    const webhookSecret = this.configService.get<string>(
      "TRENDYOL_WEBHOOK_SECRET",
    );

    if (!webhookSecret) {
      this.logger.error(
        "TRENDYOL_WEBHOOK_SECRET not configured — rejecting webhook",
      );
      throw new UnauthorizedException("Webhook secret not configured");
    }

    const signature = request.headers["x-webhook-signature"];
    if (!signature) {
      throw new UnauthorizedException("Missing webhook signature");
    }

    // Require + enforce a timestamp header so replayed signatures
    // become useless after the window lapses. The previous version
    // skipped the freshness check when the header was absent, which
    // let an attacker bypass the 5-min window by simply omitting it.
    const timestamp = request.headers["x-webhook-timestamp"];
    if (!timestamp) {
      throw new UnauthorizedException("Missing webhook timestamp");
    }
    const ts = Number(timestamp);
    if (
      !Number.isFinite(ts) ||
      Math.abs(Date.now() / 1000 - ts) > WEBHOOK_MAX_AGE_SECONDS
    ) {
      throw new UnauthorizedException("Stale webhook timestamp");
    }

    // Fail closed if rawBody is missing OR isn't a Buffer.
    // Re-serializing via JSON.stringify is not byte-identical to what
    // the sender signed (key ordering, whitespace, number formatting).
    // Verifying against a re-serialized payload effectively disables
    // signature checking.
    //
    // v2.8.94 — explicit `instanceof Buffer` check. Without it a
    // misconfigured upstream body parser that captures rawBody as a
    // string or as the parsed object can still pass the truthy check
    // and `.toString('utf8')` would either return the JS-stringified
    // representation or, for a parsed object, "[object Object]".
    // Either case silently bypasses HMAC.
    if (!(request.rawBody instanceof Buffer)) {
      this.logger.error(
        `Trendyol webhook rawBody is not a Buffer (typeof=${typeof request.rawBody}) — refusing to verify against re-serialized JSON`,
      );
      throw new UnauthorizedException(
        "Webhook body capture missing or malformed",
      );
    }
    const body = request.rawBody.toString("utf8");
    const signedPayload = `${timestamp}.${body}`;
    const expectedSignature = createHmac("sha256", webhookSecret)
      .update(signedPayload)
      .digest("hex");

    const sigBuf = Buffer.from(signature, "utf8");
    const expBuf = Buffer.from(expectedSignature, "utf8");
    if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
      throw new UnauthorizedException("Invalid webhook signature");
    }

    return true;
  }
}
