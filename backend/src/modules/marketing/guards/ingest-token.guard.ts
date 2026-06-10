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
 * Static bearer-token guard for the AI research ingest endpoint.
 * Fails closed when MARKETING_INGEST_TOKEN is unset so a misconfigured
 * deploy can't silently accept anonymous lead inserts.
 */
@Injectable()
export class IngestTokenGuard implements CanActivate {
  private readonly logger = new Logger(IngestTokenGuard.name);

  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.configService.get<string>('MARKETING_INGEST_TOKEN');
    if (!expected) {
      this.logger.error('MARKETING_INGEST_TOKEN not configured — rejecting ingest');
      throw new UnauthorizedException('Ingest disabled');
    }

    const request = context.switchToHttp().getRequest();
    const header = request.headers['x-ingest-token'];
    if (!header || typeof header !== 'string') {
      throw new UnauthorizedException('Missing ingest token');
    }

    // timingSafeEqual requires equal-length buffers. Length leak is
    // acceptable here — the token is a fixed-width hex/random string
    // and we'd reject any non-matching length anyway.
    const headerBuf = Buffer.from(header, 'utf8');
    const expectedBuf = Buffer.from(expected, 'utf8');
    if (headerBuf.length !== expectedBuf.length) {
      throw new UnauthorizedException('Invalid ingest token');
    }
    if (!timingSafeEqual(headerBuf, expectedBuf)) {
      throw new UnauthorizedException('Invalid ingest token');
    }

    return true;
  }
}
