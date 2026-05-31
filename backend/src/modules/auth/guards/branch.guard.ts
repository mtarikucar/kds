import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../../prisma/prisma.service';
import { shouldBypassGlobalAuth } from '../../../common/helpers/guard-bypass.helper';
import { IS_SKIP_BRANCH_SCOPE_KEY } from '../decorators/skip-branch-scope.decorator';
import { UserRole } from '../../../common/constants/roles.enum';

/**
 * v3.0.0 — branch-scope resolver + enforcer.
 *
 * Runs AFTER TenantGuard in the APP_GUARD chain so `req.user.tenantId`
 * is already populated. The guard:
 *
 *  1. Skips when the route is `@Public()`, a SuperAdmin / Marketing
 *     realm route, or carries `@SkipBranchScope()` (a tenant-wide
 *     endpoint that legitimately operates above the branch axis —
 *     billing, marketing leads, marketplace checkout, /me).
 *
 *  2. Resolves the active branch via a fallback chain:
 *       a. `X-Branch-Id` HTTP header (SPA's BranchPicker sets this
 *          via an axios interceptor — per-request, no JWT refresh).
 *       b. `req.user.activeBranchId` from the JWT (the value the
 *          SPA had set when the token was minted).
 *       c. `req.user.primaryBranchId` from the JWT (user's home
 *          branch).
 *       d. The tenant's single active branch (the "1-branch tenant"
 *          fallback — most tenants on FREE/STARTER plans).
 *
 *  3. Validates the resolved branchId is owned by `req.user.tenantId`
 *     and `status='active'`. Cross-tenant or archived references
 *     produce a 403. Mirrors the v2.8.99.3 checkout-side validation
 *     pattern.
 *
 *  4. WAITER / KITCHEN / COURIER hard-restriction: if these roles
 *     supplied an `X-Branch-Id` (or carry an `activeBranchId` in
 *     their JWT) that differs from `req.user.primaryBranchId`, the
 *     guard 403s. These roles are pinned to a single branch — no
 *     BranchPicker, no switching.
 *
 *  5. Sets `req.branchId` for downstream services / @CurrentBranch.
 *
 * Roll-out flag:
 *   `BRANCH_SCOPE_ENFORCED` env (default false) — when false, a
 *   request that fails to resolve a branchId at all (step 2 returns
 *   nothing AND step 4's tenant lookup is empty) is allowed through
 *   with `req.branchId = null`. Service-layer code can read this and
 *   treat it as "skip branch slice" (legacy single-branch behavior).
 *   When true, an unresolved branchId is a hard 400. Deploy starts
 *   with the flag off, flips to on once staging matrix is green.
 */
@Injectable()
export class BranchGuard implements CanActivate {
  private readonly logger = new Logger(BranchGuard.name);
  // One-time cache of the env flag value at boot. Flipping it
  // requires a restart, which is intentional — the value gates a
  // security invariant and runtime mutation would surprise on-call.
  private readonly enforced: boolean;
  // Per-role hard-restriction set. Editable via constant if the
  // product changes which roles can switch branches.
  private static readonly HARD_RESTRICTED_ROLES: Set<string> = new Set([
    UserRole.WAITER,
    UserRole.KITCHEN,
    UserRole.COURIER,
  ]);

  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {
    this.enforced = process.env.BRANCH_SCOPE_ENFORCED === 'true';
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Skip the entire guard for public / superadmin / marketing
    // realms (same bypass set TenantGuard / RolesGuard use), and
    // for routes that explicitly opt out of branch scope.
    if (shouldBypassGlobalAuth(this.reflector, context)) return true;
    const skip = this.reflector.getAllAndOverride<boolean>(IS_SKIP_BRANCH_SCOPE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user;
    if (!user || !user.tenantId) {
      // TenantGuard should have already failed. Defensive.
      return false;
    }

    // Step 2: fallback chain.
    const headerBranchId = this.readHeaderBranchId(request);
    const jwtActive: string | null = user.activeBranchId ?? null;
    const jwtPrimary: string | null = user.primaryBranchId ?? null;

    let resolved: string | null =
      headerBranchId ?? jwtActive ?? jwtPrimary ?? null;

    // Step 2d: tenant's single active branch as last resort.
    if (!resolved) {
      const fallback = await this.prisma.branch.findFirst({
        where: { tenantId: user.tenantId, status: 'active' },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });
      resolved = fallback?.id ?? null;
    }

    // Step 4: WAITER/KITCHEN/COURIER hard-restriction. If the
    // selection differs from the user's primary branch, refuse.
    // (We check this BEFORE the validation pass so a malicious
    // X-Branch-Id from a hard-restricted role gets a clean 403
    // rather than being silently rewritten.)
    if (
      resolved &&
      jwtPrimary &&
      resolved !== jwtPrimary &&
      BranchGuard.HARD_RESTRICTED_ROLES.has(user.role)
    ) {
      throw new ForbiddenException(
        `Role ${user.role} is restricted to its primary branch; cannot switch via X-Branch-Id or activeBranchId.`,
      );
    }

    // Step 3: validate ownership + active status.
    if (resolved) {
      const branch = await this.prisma.branch.findFirst({
        where: { id: resolved, tenantId: user.tenantId, status: 'active' },
        select: { id: true },
      });
      if (!branch) {
        throw new ForbiddenException(
          'Active branch is not accessible (cross-tenant, archived, or unknown).',
        );
      }
    }

    if (!resolved) {
      if (this.enforced) {
        // Hard mode: branchId is required. Either the tenant has no
        // active branches (which is an operator bug — every tenant
        // gets a Main branch on signup) or some claim made it through
        // BranchGuard with no resolvable selection.
        throw new ForbiddenException(
          'No active branch could be resolved for this request.',
        );
      }
      // Soft mode: surface the gap once per process and continue.
      // The service layer reads `req.branchId === null` and falls
      // back to tenant-scope (legacy single-branch behavior).
      this.logOnceUnresolved(user.tenantId);
    }

    request.branchId = resolved;
    return true;
  }

  /**
   * Read the `X-Branch-Id` header tolerantly:
   *  - Trim whitespace
   *  - Reject obviously-non-UUID shapes (length / charset) so the
   *    DB lookup doesn't run with garbage; cheap defense-in-depth
   *    against a typo'd header surviving as a silent miss.
   * Returns `null` when the header is missing or malformed.
   */
  private readHeaderBranchId(request: any): string | null {
    const raw = request.headers?.['x-branch-id'];
    if (typeof raw !== 'string') return null;
    const trimmed = raw.trim();
    if (trimmed.length === 0) return null;
    // UUIDv4/v7 shape sanity — 36 char with dashes. Don't strict-
    // validate the actual version digits (Prisma does at FK time).
    if (!/^[0-9a-fA-F-]{36}$/.test(trimmed)) {
      this.logger.warn(`Malformed X-Branch-Id header dropped: ${trimmed.slice(0, 40)}`);
      return null;
    }
    return trimmed;
  }

  private readonly warnedTenants = new Set<string>();
  private logOnceUnresolved(tenantId: string): void {
    if (this.warnedTenants.has(tenantId)) return;
    this.warnedTenants.add(tenantId);
    this.logger.warn(
      `BranchGuard: tenant=${tenantId} has no resolvable active branch — running in soft-mode (req.branchId=null). ` +
        `BRANCH_SCOPE_ENFORCED=false; flip to true once the schema migration backfill confirms every tenant has ≥1 active branch.`,
    );
  }
}
