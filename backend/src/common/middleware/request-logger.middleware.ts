import { Injectable, NestMiddleware, Optional } from "@nestjs/common";
import { Request, Response, NextFunction } from "express";
import { LoggerService } from "../services/logger.service";
import { MetricsService } from "../metrics/metrics.service";
import { RequestContext } from "../context/request-context";

/**
 * Self-observation endpoints whose requests would only add noise to the
 * http_request_duration_seconds histogram (every Prometheus scrape and
 * orchestrator probe would dominate the low-latency buckets).
 */
const METRICS_EXCLUDED_PATHS = [
  "/api/metrics",
  "/api/health",
  "/api/healthz",
  "/uploads",
];

/**
 * Request logger middleware
 * Logs all incoming HTTP requests with details, and feeds the Prometheus
 * request-duration histogram (single observation point for both signals).
 */
@Injectable()
export class RequestLoggerMiddleware implements NestMiddleware {
  private readonly logger = new LoggerService("HTTP");

  // Optional so unit tests that construct the middleware bare (and any
  // module context without MetricsModule) keep working — logging never
  // depends on metrics being wired.
  constructor(@Optional() private readonly metrics?: MetricsService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const { method, originalUrl, ip } = req;
    const userAgent = req.get("user-agent") || "";
    const startTime = Date.now();

    // Seed the request-scoped correlation context. An inbound X-Request-Id
    // is honoured for cross-service tracing; otherwise RequestContext mints a
    // UUID. Wrapping `next()` makes the correlation id visible to every
    // service-layer log, Sentry event, and outbox append in this request's
    // async continuation — not just the two access-log lines here.
    const inboundId =
      (req.headers["x-request-id"] as string | undefined) || undefined;

    RequestContext.run({ requestId: inboundId }, () => {
      const requestId = RequestContext.getRequestId()!;

      // Attach request ID to request object + response header for tracking.
      (req as any).requestId = requestId;
      res.setHeader("X-Request-Id", requestId);

      // Log request (using HTTP level) — requestId auto-injected via context.
      this.logger.http(`${method} ${originalUrl}`, { ip, userAgent });

      // Log response when finished
      res.on("finish", () => {
        const { statusCode } = res;
        const contentLength = res.get("content-length");
        const responseTime = Date.now() - startTime;

        const level =
          statusCode >= 500 ? "error" : statusCode >= 400 ? "warn" : "http";

        this.logger.logWithLevel(
          level,
          `${method} ${originalUrl} ${statusCode}`,
          {
            statusCode,
            contentLength: contentLength || 0,
            responseTime: `${responseTime}ms`,
          },
        );

        if (
          this.metrics &&
          !METRICS_EXCLUDED_PATHS.some((p) => originalUrl.startsWith(p))
        ) {
          // req.route is populated once Express matched a handler; its
          // pattern (`/orders/:id`) keeps label cardinality bounded where
          // the raw URL would not. Unmatched requests (404s) share one
          // bucket for the same reason.
          const routePath = (req as any).route?.path;
          const route = routePath ? `${req.baseUrl}${routePath}` : "unmatched";
          this.metrics.observeHttpRequest(
            method,
            route,
            statusCode,
            responseTime / 1000,
          );
        }
      });

      next();
    });
  }
}

// NOTE: a `DetailedRequestLoggerMiddleware` used to live here. It
// logged the full request body (with a substring-match
// `shouldLogBody` route filter) into JSON.stringify lines on every
// request. Pre-iter-83 it had zero callers — no app.module wiring,
// no test, no @Module import. The middleware was dead code and could
// have been resurrected by accident into a production code path
// that retains logs for weeks; the body-filter was a substring match
// (`originalUrl.includes(route)`) so a URL like `/foo?p=/auth/login`
// would falsely match the sensitive route, while a route like
// `/api/v2/auth/login/admin` would also match correctly — fragile
// shape. Removed entirely in iter-83 so a fresh implementation will
// be forced to wire a proper exact-match sensitive-route filter +
// per-tenant body size cap from scratch instead of resurrecting the
// loose shape.
