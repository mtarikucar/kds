import { Injectable, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { IS_SUPERADMIN_PUBLIC_KEY, IS_SUPERADMIN_ROUTE_KEY } from '../../superadmin/decorators/superadmin.decorator';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // Also check for 'isPublic' metadata (alternative public decorator)
    const isPublicAlt = this.reflector.getAllAndOverride<boolean>('isPublic', [
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

    // Skip for public routes and superadmin routes
    if (isPublic || isPublicAlt || isSuperAdminPublic || isSuperAdminRoute) {
      return true;
    }

    return super.canActivate(context);
  }
}
