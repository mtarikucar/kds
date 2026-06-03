import { Injectable, NestMiddleware } from "@nestjs/common";
import { Request, Response, NextFunction } from "express";
import { LoggerService } from "../services/logger.service";

/**
 * Request logger middleware
 * Logs all incoming HTTP requests with details
 */
@Injectable()
export class RequestLoggerMiddleware implements NestMiddleware {
  private readonly logger = new LoggerService("HTTP");

  use(req: Request, res: Response, next: NextFunction): void {
    const { method, originalUrl, ip } = req;
    const userAgent = req.get("user-agent") || "";
    const startTime = Date.now();

    // Generate unique request ID
    const requestId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Attach request ID to request object for tracking
    (req as any).requestId = requestId;

    // Log request (using HTTP level)
    this.logger.http(`${method} ${originalUrl}`, {
      requestId,
      ip,
      userAgent,
    });

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
          requestId,
          statusCode,
          contentLength: contentLength || 0,
          responseTime: `${responseTime}ms`,
        },
      );
    });

    next();
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
