import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { IS_PUBLIC_KEY } from "../decorators/public.decorator";
import { PrismaService } from "../../../prisma/prisma.service";

/**
 * The global lockout lever.
 *
 * This replaces `SubscriptionStatusGuard`, which locked a tenant out when
 * their subscription lapsed. With a free core there is nothing subscription-
 * shaped left to lock on — but deleting that guard without a replacement
 * would leave NO global lever at all, because `TenantGuard` resolves the
 * tenant without ever checking `Tenant.status`. Superadmin suspension is the
 * only defence against an abusive account once the product is free to use, so
 * it needs to actually do something.
 *
 * Registered in the same APP_GUARD position as its predecessor (last, after
 * Jwt/Roles/Tenant/Branch) so `req.user.tenantId` is populated. Superadmin
 * requests carry no tenantId and fly through.
 *
 * The result is cached per tenant for a minute: this runs on every non-public
 * tenant request, and a suspension that takes up to 60s to bite is fine when
 * the alternative is an indexed read per request forever.
 */
@Injectable()
export class TenantStatusGuard implements CanActivate {
  /** Paths a suspended tenant may still reach, to see why and to appeal. */
  private static readonly ALLOWED_PREFIXES = [
    "/auth",
    "/me",
    "/users/me",
    "/profile",
    "/legal",
    "/entitlements",
    "/webhooks",
    "/health",
  ];

  private static readonly TTL_MS = 60_000;
  private readonly cache = new Map<string, { status: string; at: number }>();

  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const tenantId = request.user?.tenantId;
    // Unauthenticated is JwtAuthGuard's job; the superadmin realm has no
    // tenant to suspend.
    if (!tenantId) return true;

    const path: string = String(request.path ?? request.url ?? "").split(
      "?",
    )[0];
    if (TenantStatusGuard.isAllowed(path)) return true;

    const status = await this.resolveStatus(tenantId);
    if (status === "ACTIVE") return true;

    throw new ForbiddenException({
      statusCode: 403,
      error: "Tenant Suspended",
      errorCode: "TENANT_SUSPENDED",
      message:
        "Hesabınız askıya alınmıştır. Lütfen destek ekibiyle iletişime geçin.",
    });
  }

  /** Drop a tenant's cached status — call on suspend/reactivate. */
  invalidate(tenantId: string): void {
    this.cache.delete(tenantId);
  }

  private async resolveStatus(tenantId: string): Promise<string> {
    const hit = this.cache.get(tenantId);
    const now = Date.now();
    if (hit && now - hit.at < TenantStatusGuard.TTL_MS) return hit.status;

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { status: true },
    });
    // A missing tenant is not this guard's error to raise — TenantGuard has
    // already resolved one. Treat it as active and let the real owner 404.
    const status = tenant?.status ?? "ACTIVE";
    this.cache.set(tenantId, { status, at: now });
    return status;
  }

  /**
   * Segment-aware prefix match against the request path (which carries the
   * /api global prefix): "/me" matches "/api/users/me" but not "/api/menu".
   */
  private static isAllowed(path: string): boolean {
    return TenantStatusGuard.ALLOWED_PREFIXES.some((prefix) => {
      const idx = path.indexOf(prefix);
      if (idx === -1) return false;
      const after = path.charAt(idx + prefix.length);
      return after === "" || after === "/";
    });
  }
}
