import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/**
 * Guard for validating API keys for service-to-service authentication
 * Used by external services like GitHub Actions for automated tasks
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private configService: ConfigService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    // Check if endpoint is marked as public
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

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
    // Only accept dedicated API-key headers; do not fall back to Authorization
    // (which is owned by the JWT strategy) to avoid cross-mechanism confusion.
    return request.headers['x-api-key'] || request.headers['api-key'];
  }

  private safeCompare(a: string, b: string): boolean {
    const aBuf = Buffer.from(a, 'utf8');
    const bBuf = Buffer.from(b, 'utf8');
    if (aBuf.length !== bBuf.length) {
      return false;
    }
    return timingSafeEqual(aBuf, bBuf);
  }
}
