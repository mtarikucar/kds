import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from "@nestjs/common";
import { from, Observable } from "rxjs";
import { catchError, switchMap } from "rxjs/operators";
import { RequestContext } from "./request-context";
import { CountryService } from "../country/country.service";

/**
 * Enriches the request-scoped correlation context with the resolved
 * multi-tenant identity. Guards run before interceptors, so by the time this
 * executes JwtAuthGuard has set `req.user` and BranchGuard has set
 * `req.scope` — service-layer logs and Sentry events for the rest of the
 * request then carry tenantId/branchId/userId for free, without any service
 * threading the values through.
 *
 * Also resolves `countryCode` so SYNCHRONOUS code downstream (e.g.
 * class-transformer decorators, which run in the pipe phase — after
 * interceptors) can read the tenant's country from RequestContext without a
 * database call of their own. Doing that resolution here without adding a
 * query to every request is why CountryService carries a process-lifetime
 * cache: cache hit stays fully synchronous (the interceptor's original
 * shape), and only the first request for a given tenant per process takes
 * the async path.
 *
 * PUBLIC ROUTES (Task 5 review fix): TenantGuard steps aside entirely for
 * @Public() routes via shouldBypassGlobalAuth, so `req.user`/`req.tenantId`
 * are BOTH absent — the QR menu, public reservations, customer self-pay,
 * OTP, Partner Display. Ambient country resolution was completely inert on
 * exactly the surfaces where a CUSTOMER types their own phone number (an
 * Uzbek café's QR-menu customer typing "90 123 45 67" was always parsed as
 * Turkish). Several of these routes still carry the tenant as a route param
 * (`@Get(":tenantId")`, `@Get(":tenantId/settings")`) — enough to pick a
 * country profile. `by-subdomain/:subdomain` is explicitly out of scope
 * (resolving a subdomain needs a separate lookup this fix doesn't add) and
 * keeps falling back to TR, same as today.
 *
 * SECURITY: on a public route that param is attacker-controlled. It is used
 * ONLY for `countryLookupTenantId` below — NEVER written to
 * `RequestContext.tenantId`, which flows into logs, Sentry, and branch/
 * tenant scoping decisions elsewhere. Worst case under this design is that
 * an attacker makes their own phone number parse under a different
 * country's rules, which is harmless.
 *
 * Registered as a global APP_INTERCEPTOR — runs on EVERY HTTP request. The
 * whole Nest pipeline runs inside the AsyncLocalStorage context that
 * RequestContextMiddleware opened, so `set()` mutates the live store the
 * downstream continuation reads.
 */
@Injectable()
export class RequestContextInterceptor implements NestInterceptor {
  private readonly logger = new Logger(RequestContextInterceptor.name);

  constructor(private readonly country: CountryService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== "http") return next.handle();

    const req: any = context.switchToHttp().getRequest();
    const tenantId = req?.user?.tenantId ?? req?.tenantId;
    RequestContext.set({
      tenantId,
      branchId: req?.scope?.branchId,
      userId: req?.user?.id ?? req?.user?.sub,
    });

    // Authenticated tenantId if we have one; otherwise fall back to a route
    // param IN NAME ONLY for the purpose of picking a country profile. See
    // the SECURITY note above — this value must never reach
    // RequestContext.tenantId or anything derived from it.
    const countryLookupTenantId: string | undefined =
      tenantId ?? req?.params?.tenantId;

    if (!countryLookupTenantId) return next.handle(); // fully anonymous — ambient() falls back

    // Fast path: a tenant's country never changes in practice, so this
    // misses exactly once per tenant per process. Keeping it synchronous is
    // the whole point — this interceptor runs on EVERY request.
    const cached = this.country.cachedCodeFor(countryLookupTenantId);
    if (cached) {
      RequestContext.set({ countryCode: cached });
      return next.handle();
    }

    return from(this.country.forTenant(countryLookupTenantId)).pipe(
      switchMap((profile) => {
        RequestContext.set({ countryCode: profile.code });
        return next.handle();
      }),
      // Country is a nice-to-have; the request is not. Before the cache
      // existed this interceptor was fully synchronous and could not fail
      // here — the cache makes a DB round-trip reachable on this path, and
      // right after a process restart it is empty for EVERY tenant, so a
      // hiccup during warm-up would 500 the first request of any tenant
      // (Turkish ones included) if left uncaught. Degrade to no countryCode
      // (ambient() falls back to the default profile) rather than fail the
      // request the same way the fully-anonymous branch above already does.
      catchError((err) => {
        this.logger.warn(
          `Country resolution failed for tenant ${countryLookupTenantId}, continuing without it: ${err?.message ?? err}`,
        );
        return next.handle();
      }),
    );
  }
}
