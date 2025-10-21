import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { LoggerService } from '../services/logger.service';

/**
 * Request logger middleware
 * Logs all incoming HTTP requests with details
 */
@Injectable()
export class RequestLoggerMiddleware implements NestMiddleware {
  private readonly logger = new LoggerService('HTTP');

  use(req: Request, res: Response, next: NextFunction): void {
    const { method, originalUrl, ip } = req;
    const userAgent = req.get('user-agent') || '';
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
    res.on('finish', () => {
      const { statusCode } = res;
      const contentLength = res.get('content-length');
      const responseTime = Date.now() - startTime;

      const level = statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'http';

      this.logger.logWithLevel(level, `${method} ${originalUrl} ${statusCode}`, {
        requestId,
        statusCode,
        contentLength: contentLength || 0,
        responseTime: `${responseTime}ms`,
      });
    });

    next();
  }
}

/**
 * Enhanced request logger with more details (for production)
 */
@Injectable()
export class DetailedRequestLoggerMiddleware implements NestMiddleware {
  private readonly logger = new LoggerService('HTTP');

  use(req: Request, res: Response, next: NextFunction): void {
    const { method, originalUrl, ip, body, query, params } = req;
    const userAgent = req.get('user-agent') || '';
    const startTime = Date.now();

    // Generate unique request ID
    const requestId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Attach request ID to request and response
    (req as any).requestId = requestId;
    res.setHeader('X-Request-ID', requestId);

    // Extract user info if available
    const user = (req as any).user;
    const userInfo = user ? `User: ${user.email} (ID: ${user.userId})` : 'Anonymous';
    const tenantInfo = user ? `Tenant: ${user.tenantId}` : 'N/A';

    // Log request with details
    const requestDetails = {
      requestId,
      method,
      url: originalUrl,
      ip,
      userAgent,
      user: userInfo,
      tenant: tenantInfo,
      // Only log body for non-sensitive routes
      body: this.shouldLogBody(originalUrl) ? body : '[REDACTED]',
      query,
      params,
    };

    this.logger.log(
      `[${requestId}] Incoming request: ${JSON.stringify(requestDetails)}`,
    );

    // Log response when finished
    res.on('finish', () => {
      const { statusCode } = res;
      const contentLength = res.get('content-length');
      const responseTime = Date.now() - startTime;

      const responseDetails = {
        requestId,
        method,
        url: originalUrl,
        statusCode,
        contentLength: contentLength || 0,
        responseTime: `${responseTime}ms`,
        user: userInfo,
        tenant: tenantInfo,
      };

      const logLevel = statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'log';

      this.logger[logLevel](
        `[${requestId}] Response: ${JSON.stringify(responseDetails)}`,
      );
    });

    next();
  }

  /**
   * Determine if request body should be logged
   * Exclude sensitive endpoints like auth, password reset, etc.
   */
  private shouldLogBody(url: string): boolean {
    const sensitiveRoutes = [
      '/auth/login',
      '/auth/register',
      '/auth/reset-password',
      '/auth/change-password',
      '/users/password',
      '/subscriptions/webhook',
    ];

    return !sensitiveRoutes.some((route) => url.includes(route));
  }
}
