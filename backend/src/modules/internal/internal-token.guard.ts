import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';

/**
 * Static service-token guard for the service-to-service internal endpoints
 * (/api/internal/*). Mirrors the IngestTokenGuard pattern: fails closed when
 * INTERNAL_SERVICE_TOKEN is unset so a misconfigured deploy can't silently
 * accept anonymous referral resolves or event deliveries.
 *
 * Core sends the same token in `x-internal-token` that this service sends
 * when calling core's /api/internal/provisioning/* endpoints.
 */
@Injectable()
export class InternalTokenGuard implements CanActivate {
  private readonly logger = new Logger(InternalTokenGuard.name);

  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.configService.get<string>('INTERNAL_SERVICE_TOKEN');
    if (!expected) {
      this.logger.error(
        'INTERNAL_SERVICE_TOKEN not configured — rejecting internal call',
      );
      throw new UnauthorizedException('Internal API disabled');
    }

    const request = context.switchToHttp().getRequest();
    const header = request.headers['x-internal-token'];
    if (!header || typeof header !== 'string') {
      throw new UnauthorizedException('Missing internal token');
    }

    // timingSafeEqual requires equal-length buffers. Length leak is
    // acceptable here — the token is a fixed-width random string and we'd
    // reject any non-matching length anyway.
    const headerBuf = Buffer.from(header, 'utf8');
    const expectedBuf = Buffer.from(expected, 'utf8');
    if (headerBuf.length !== expectedBuf.length) {
      throw new UnauthorizedException('Invalid internal token');
    }
    if (!timingSafeEqual(headerBuf, expectedBuf)) {
      throw new UnauthorizedException('Invalid internal token');
    }

    return true;
  }
}
