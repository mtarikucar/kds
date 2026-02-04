import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { IS_SUPERADMIN_PUBLIC_KEY, IS_SUPERADMIN_ROUTE_KEY } from '../../superadmin/decorators/superadmin.decorator';

@Injectable()
export class TenantGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // Check if route is public
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // Check for SuperAdmin public routes
    const isSuperAdminPublic = this.reflector.getAllAndOverride<boolean>(
      IS_SUPERADMIN_PUBLIC_KEY,
      [context.getHandler(), context.getClass()],
    );

    // Check for SuperAdmin routes (handled by SuperAdminGuard)
    const isSuperAdminRoute = this.reflector.getAllAndOverride<boolean>(
      IS_SUPERADMIN_ROUTE_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (isPublic || isSuperAdminPublic || isSuperAdminRoute) {
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
