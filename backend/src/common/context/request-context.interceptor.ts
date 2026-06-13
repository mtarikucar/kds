import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from "@nestjs/common";
import { Observable } from "rxjs";
import { RequestContext } from "./request-context";

/**
 * Enriches the request-scoped correlation context with the resolved
 * multi-tenant identity. Guards run before interceptors, so by the time this
 * executes JwtAuthGuard has set `req.user` and BranchGuard has set
 * `req.scope` — service-layer logs and Sentry events for the rest of the
 * request then carry tenantId/branchId/userId for free, without any service
 * threading the values through.
 *
 * Registered as a global APP_INTERCEPTOR. The whole Nest pipeline runs inside
 * the AsyncLocalStorage context that RequestContextMiddleware opened, so
 * `set()` mutates the live store the downstream continuation reads.
 */
@Injectable()
export class RequestContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() === "http") {
      const req: any = context.switchToHttp().getRequest();
      RequestContext.set({
        tenantId: req?.user?.tenantId ?? req?.tenantId,
        branchId: req?.scope?.branchId,
        userId: req?.user?.id ?? req?.user?.sub,
      });
    }
    return next.handle();
  }
}
