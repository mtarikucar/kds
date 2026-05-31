import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../../prisma/prisma.service';
import { shouldBypassGlobalAuth } from '../../../common/helpers/guard-bypass.helper';
import { IS_SKIP_BRANCH_SCOPE_KEY } from '../decorators/skip-branch-scope.decorator';
import {
  HARD_RESTRICTED_ROLES,
  UserRole,
  isHardRestrictedRole,
} from '../../../common/constants/roles.enum';

/**
 * v3.0.0 strict BranchGuard.
 *
 * Runs after JwtAuthGuard + RolesGuard + TenantGuard in the APP_GUARD
 * chain. For every branch-scoped route:
 *
 *   1. The request must carry an `X-Branch-Id` header. No fallback
 *      to JWT claims; no fallback to "the tenant's first active
 *      branch". The header is the contract; missing it is a 400.
 *   2. The branch must belong to `req.user.tenantId` and be in
 *      `status='active'`. Cross-tenant or archived references are
 *      403.
 *   3. Role-conditional allow-list enforcement:
 *      - WAITER/KITCHEN/COURIER: header MUST equal
 *        `user.primaryBranchId`. The DB CHECK constraint guarantees
 *        primaryBranchId is non-null for these roles, so a null is a
 *        re-login signal (something stripped the claim).
 *      - MANAGER: header MUST be in `user.allowedBranchIds`.
 *      - ADMIN: empty `allowedBranchIds` means wildcard tenant access
 *        (owner accounts). Non-empty list narrows to the listed
 *        branches just like MANAGER.
 *   4. `req.scope = { tenantId, branchId, userId, role }` is set for
 *      `@CurrentScope()` to consume.
 *
 * No soft mode, no JWT grace window, no in-memory cache. The strict
 * design is the design.
 */
@Injectable()
export class BranchGuard implements CanActivate {
  private readonly logger = new Logger(BranchGuard.name);

  // Canonical UUID shape — v4/v7 hex layout with dashes. The DB FK
  // makes the real validation either way, but rejecting obvious
  // garbage upstream avoids a DB round-trip on every malformed
  // header.
  private static readonly UUID_RE =
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (shouldBypassGlobalAuth(this.reflector, context)) return true;
    const skip = this.reflector.getAllAndOverride<boolean>(
      IS_SKIP_BRANCH_SCOPE_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (skip) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user;
    if (!user || !user.tenantId || !user.role) {
      // TenantGuard / JwtAuthGuard should have already failed; getting
      // here means the guard chain was misconfigured.
      throw new UnauthorizedException();
    }

    const headerBranchId = this.readHeaderBranchId(request);
    if (!headerBranchId) {
      throw new BadRequestException(
        'X-Branch-Id header required for branch-scoped routes.',
      );
    }

    // Tenant ownership + active check. Single index hit on
    // (tenantId, status). One query per request, sub-millisecond at
    // the scale this product targets.
    const branch = await this.prisma.branch.findFirst({
      where: {
        id: headerBranchId,
        tenantId: user.tenantId,
        status: 'active',
      },
      select: { id: true },
    });
    if (!branch) {
      throw new ForbiddenException(
        'Branch is not accessible (cross-tenant, archived, or unknown).',
      );
    }

    // Role-conditional allow-list. Centralised in a helper so the
    // KDS/notifications/analytics WebSocket gateways can reuse the
    // exact same predicate.
    if (
      !this.canAccessBranch(
        user.role,
        headerBranchId,
        user.primaryBranchId ?? null,
        user.allowedBranchIds ?? [],
      )
    ) {
      throw new ForbiddenException(this.denialReason(user.role));
    }

    request.scope = {
      tenantId: user.tenantId,
      branchId: headerBranchId,
      userId: user.id,
      role: user.role,
    };
    return true;
  }

  /**
   * Pure authorization predicate — exported as a static method so the
   * WebSocket gateways can call it during their handshake without
   * dragging in the full guard. Identical semantics as the in-request
   * check above.
   */
  static canAccessBranchStatic(
    role: string,
    targetBranchId: string,
    primaryBranchId: string | null,
    allowedBranchIds: readonly string[],
  ): boolean {
    if (isHardRestrictedRole(role)) {
      if (!primaryBranchId) {
        // DB CHECK guarantees these roles carry primaryBranchId. A
        // null at request time means the claim was stripped — refuse
        // and force re-login at the layer above.
        return false;
      }
      return targetBranchId === primaryBranchId;
    }
    if (role === UserRole.ADMIN) {
      // Empty list = wildcard tenant access (owner accounts).
      if (allowedBranchIds.length === 0) return true;
      return allowedBranchIds.includes(targetBranchId);
    }
    // MANAGER and any future intermediate role — must be in the
    // allow-list explicitly.
    return allowedBranchIds.includes(targetBranchId);
  }

  // Instance shim so tests don't have to call the static form.
  private canAccessBranch(
    role: string,
    targetBranchId: string,
    primaryBranchId: string | null,
    allowedBranchIds: readonly string[],
  ): boolean {
    return BranchGuard.canAccessBranchStatic(
      role,
      targetBranchId,
      primaryBranchId,
      allowedBranchIds,
    );
  }

  private denialReason(role: string): string {
    if (isHardRestrictedRole(role)) {
      return `Role ${role} is pinned to its primary branch; X-Branch-Id must match.`;
    }
    return `Role ${role} is not allowed on this branch (not in allow-list).`;
  }

  /**
   * Read the `X-Branch-Id` header, trim, and reject anything that
   * doesn't pass the UUID shape check. Returns null when the header
   * is missing or malformed; the caller decides what to do (in
   * `canActivate` this maps to a 400).
   */
  private readHeaderBranchId(request: any): string | null {
    const raw = request.headers?.['x-branch-id'];
    if (typeof raw !== 'string') return null;
    const trimmed = raw.trim();
    if (!BranchGuard.UUID_RE.test(trimmed)) {
      this.logger.warn(
        `Malformed X-Branch-Id header dropped: ${trimmed.slice(0, 64)}`,
      );
      return null;
    }
    return trimmed;
  }
}

// Re-export for legacy import paths.
export { HARD_RESTRICTED_ROLES };
