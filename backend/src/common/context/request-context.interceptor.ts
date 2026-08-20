import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from "@nestjs/common";
import { from, Observable } from "rxjs";
import { switchMap } from "rxjs/operators";
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
 * Registered as a global APP_INTERCEPTOR — runs on EVERY HTTP request. The
 * whole Nest pipeline runs inside the AsyncLocalStorage context that
 * RequestContextMiddleware opened, so `set()` mutates the live store the
 * downstream continuation reads.
 */
@Injectable()
export class RequestContextInterceptor implements NestInterceptor {
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

    if (!tenantId) return next.handle(); // anonymous — ambient() falls back

    // Fast path: a tenant's country never changes in practice, so this
    // misses exactly once per tenant per process. Keeping it synchronous is
    // the whole point — this interceptor runs on EVERY request.
    const cached = this.country.cachedCodeFor(tenantId);
    if (cached) {
      RequestContext.set({ countryCode: cached });
      return next.handle();
    }

    return from(this.country.forTenant(tenantId)).pipe(
      switchMap((profile) => {
        RequestContext.set({ countryCode: profile.code });
        return next.handle();
      }),
    );
  }
}
