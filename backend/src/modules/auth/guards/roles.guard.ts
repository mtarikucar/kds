import { Injectable, CanActivate, ExecutionContext, ForbiddenException, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { UserRole } from '../../../common/constants/roles.enum';
import { shouldBypassGlobalAuth } from '../../../common/helpers/guard-bypass.helper';

@Injectable()
export class RolesGuard implements CanActivate {
  private readonly logger = new Logger(RolesGuard.name);
  // v2.8.96 — track which (controller, handler) pairs we've already
  // warned about so the log doesn't spam on every request. The set
  // lives for the process lifetime; a redeploy resets it, which is the
  // intended cadence (warn once per deploy, fix on the next).
  private static readonly warnedHandlers = new Set<string>();

  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (shouldBypassGlobalAuth(this.reflector, context)) {
      return true;
    }

    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles) {
      // v2.8.96 — surface the missing @Roles annotation. The guard
      // returns `true` here for backwards compatibility (defaulting
      // to deny would break dozens of intentionally-open authenticated
      // endpoints — /me/profile, /me/preferences, etc.), but every
      // missing annotation is at minimum a documentation/intent gap
      // and at worst an unintended privilege grant on a sensitive
      // endpoint. The once-per-handler warn gives dev/test a loud
      // breadcrumb to fix without spamming prod logs.
      const controllerName = context.getClass()?.name ?? '?';
      const handlerName = context.getHandler()?.name ?? '?';
      const key = `${controllerName}.${handlerName}`;
      if (!RolesGuard.warnedHandlers.has(key)) {
        RolesGuard.warnedHandlers.add(key);
        this.logger.warn(
          `Endpoint ${key} has no @Roles() annotation; granting access to all authenticated roles. ` +
          `If this is intentional add @Roles(UserRole.ADMIN, UserRole.MANAGER, ...) — or document with @Roles() listing every role you want to allow.`,
        );
      }
      return true;
    }

    const { user } = context.switchToHttp().getRequest();

    if (!user) {
      throw new ForbiddenException('User not authenticated');
    }

    const hasRole = requiredRoles.some((role) => user.role === role);

    if (!hasRole) {
      throw new ForbiddenException('Insufficient permissions');
    }

    return true;
  }
}
