import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { shouldBypassGlobalAuth } from '../../../common/helpers/guard-bypass.helper';

@Injectable()
export class TenantGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (shouldBypassGlobalAuth(this.reflector, context)) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user || !user.tenantId) {
      return false;
    }

    // Inject tenantId into request for use in services
    request.tenantId = user.tenantId;

    return true;
  }
}
