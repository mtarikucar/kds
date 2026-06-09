import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ServiceUnavailableException,
  UnauthorizedException,
  Logger,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { timingSafeEqual } from "crypto";

/**
 * Static service-token guard for service-to-service internal endpoints
 * (`/api/internal/*`). The kds-marketing service authenticates with the
 * shared `INTERNAL_SERVICE_TOKEN` secret presented in the
 * `x-internal-token` header.
 *
 * Mirrors the (now extracted) marketing IngestTokenGuard pattern:
 *   - fails closed when the env is unset — but with a 503 instead of a
 *     401, so the peer can distinguish "core not configured for the
 *     split yet" from "my token is wrong";
 *   - constant-time compare so the token can't be brute-forced
 *     byte-by-byte via response timing.
 */
@Injectable()
export class InternalServiceTokenGuard implements CanActivate {
  private readonly logger = new Logger(InternalServiceTokenGuard.name);

  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.configService.get<string>("INTERNAL_SERVICE_TOKEN");
    if (!expected) {
      this.logger.error(
        "INTERNAL_SERVICE_TOKEN not configured — rejecting internal service call",
      );
      throw new ServiceUnavailableException("Internal transport not configured");
    }

    const request = context.switchToHttp().getRequest();
    const header = request.headers["x-internal-token"];
    if (!header || typeof header !== "string") {
      throw new UnauthorizedException("Missing internal service token");
    }

    // timingSafeEqual requires equal-length buffers. Length leak is
    // acceptable — the token is a fixed-width random string and any
    // non-matching length is rejected anyway.
    const headerBuf = Buffer.from(header, "utf8");
    const expectedBuf = Buffer.from(expected, "utf8");
    if (headerBuf.length !== expectedBuf.length) {
      throw new UnauthorizedException("Invalid internal service token");
    }
    if (!timingSafeEqual(headerBuf, expectedBuf)) {
      throw new UnauthorizedException("Invalid internal service token");
    }

    return true;
  }
}
