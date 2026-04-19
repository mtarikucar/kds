import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { timingSafeEqual } from 'crypto';

/**
 * Service-to-service API key guard. Used by GitHub Actions CI to publish
 * desktop releases. Unlike JwtAuthGuard, this guard does NOT honor
 * `@Public()` — when explicitly attached to an endpoint via @UseGuards
 * it always enforces the API key. Previously the public-bypass shortcut
 * here combined with a `@Public()` controller decoration to leave the
 * CI endpoints entirely unauthenticated.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private configService: ConfigService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const apiKey = this.extractApiKey(request);

    if (!apiKey) {
      throw new UnauthorizedException('API key is missing');
    }

    const validApiKey = this.configService.get<string>('DESKTOP_RELEASE_API_KEY');
    if (!validApiKey) {
      throw new UnauthorizedException('API key authentication is not configured');
    }

    if (!this.safeCompare(apiKey, validApiKey)) {
      throw new UnauthorizedException('Invalid API key');
    }

    return true;
  }

  private extractApiKey(request: any): string | undefined {
    return request.headers['x-api-key'] || request.headers['api-key'];
  }

  private safeCompare(a: string, b: string): boolean {
    const aBuf = Buffer.from(a, 'utf8');
    const bBuf = Buffer.from(b, 'utf8');
    if (aBuf.length !== bBuf.length) return false;
    return timingSafeEqual(aBuf, bBuf);
  }
}
