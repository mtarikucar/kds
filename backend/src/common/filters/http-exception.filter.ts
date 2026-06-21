import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import { Request, Response } from "express";
import { ErrorResponse } from "../interfaces/error-response.interface";
import { BusinessException } from "../exceptions/business.exception";
import { LoggerService } from "../services/logger.service";
import { Prisma } from "@prisma/client";
import { captureException, setContext } from "../../sentry.config";

/**
 * Global exception filter
 * Catches all exceptions and formats them into a standardized error response
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new LoggerService(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const isDevelopment = process.env.NODE_ENV === "development";

    // Generate request ID for tracking
    const requestId = this.generateRequestId();

    let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = "Internal server error";
    let error = "InternalServerError";
    // Machine-readable code the SPA branches on (e.g. PROFILE_PHONE_REQUIRED
    // → inline phone prompt). Distinct from `error` (a human/category label
    // that is sometimes localized or class-validator's "Bad Request"). Kept
    // on the wire in EVERY environment — it carries no PII and the UI's
    // actionable-error flow depends on it in production. Pre-fix the filter
    // copied only message+error from a plain HttpException body, silently
    // dropping any `errorCode`/`code` the thrower attached, so the inline
    // remediation never fired in prod.
    let errorCode: string | undefined = undefined;
    let details: any = undefined;
    let stack: string | undefined = undefined;

    // Handle different exception types
    if (exception instanceof BusinessException) {
      // Business logic exceptions with custom error codes
      statusCode = exception.getStatus();
      const exceptionResponse = exception.getResponse() as any;
      message = exceptionResponse.message || exception.message;
      error = exceptionResponse.errorCode || "BusinessError";
      errorCode = exceptionResponse.errorCode;
      details = exceptionResponse.details;
    } else if (exception instanceof HttpException) {
      // Standard HTTP exceptions
      statusCode = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === "string") {
        message = exceptionResponse;
      } else if (typeof exceptionResponse === "object") {
        message = (exceptionResponse as any).message || exception.message;
        error = (exceptionResponse as any).error || exception.name;
        // Accept both the canonical `errorCode` and the legacy `code`
        // alias some gates still emit — standardize them onto errorCode.
        errorCode =
          (exceptionResponse as any).errorCode ??
          (exceptionResponse as any).code;
      }
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      // Prisma database errors
      const dbError = this.handlePrismaError(exception);
      statusCode = dbError.statusCode;
      message = dbError.message;
      error = dbError.error;
      details = isDevelopment ? dbError.details : undefined;
    } else if (exception instanceof Prisma.PrismaClientValidationError) {
      // Prisma validation errors
      statusCode = HttpStatus.BAD_REQUEST;
      message = "Database validation error";
      error = "DatabaseValidationError";
      details = isDevelopment ? exception.message : undefined;
    } else if (exception instanceof Error) {
      // Generic errors
      message = isDevelopment
        ? exception.message
        : "An unexpected error occurred";
      error = isDevelopment ? exception.name : "Internal Server Error";
      stack = isDevelopment ? exception.stack : undefined;
    }

    // Build standardized error response
    const errorResponse: ErrorResponse = {
      statusCode,
      message,
      error,
      timestamp: new Date().toISOString(),
      path: request.url,
      requestId,
    };

    // Surface the machine-readable code (when present) so the SPA's
    // actionable-error flow can branch on it. Omitted entirely when absent
    // to keep ordinary error bodies unchanged.
    if (errorCode) errorResponse.errorCode = errorCode;

    // Include details and stack only in development
    if (isDevelopment) {
      if (details) errorResponse.details = details;
      if (stack) errorResponse.stack = stack;
    }

    // Log the error
    this.logError(exception, request, statusCode, requestId);

    // Send 5xx errors to Sentry (server errors, not client errors).
    // Wrap the Sentry calls themselves — if the transport is down or
    // misconfigured, a throw here would mask the original 500 and turn
    // the response into a generic Nest internal error, hiding the true
    // cause from both the user and the logs.
    if (statusCode >= 500 && exception instanceof Error) {
      try {
        setContext("http", {
          url: request.url,
          method: request.method,
          headers: {
            "user-agent": request.headers["user-agent"],
            "content-type": request.headers["content-type"],
          },
          statusCode,
          requestId,
        });
        // Intentionally omit email here: Sentry retains breadcrumbs/events
        // for weeks and user email is unnecessary for triage when we already
        // have the user id + tenant id. Reduces our GDPR/KVKK surface.
        setContext("user", {
          id: (request as any).user?.id,
          tenantId: (request as any).user?.tenantId,
        });
        captureException(exception, {
          requestId,
          path: request.url,
          method: request.method,
        });
      } catch (sentryErr) {
        // v2.8.97 — log Sentry-side failure cause + the original
        // exception type so ops can disambiguate "Sentry network
        // outage" from "Sentry SDK threw on our payload". Pre-fix the
        // log line mentioned only "Sentry capture failed" with the
        // sentry error's stack, leaving the root cause of the original
        // exception silent on the server side. User has already
        // received an error response by this point, so the goal is
        // ops observability, not request flow.
        this.logger.error(
          `Sentry capture failed (${(sentryErr as Error)?.message ?? "unknown"}); ` +
            `original exception preserved (type=${(exception as any)?.constructor?.name ?? typeof exception}): ${(exception as Error)?.message ?? exception}`,
          (sentryErr as Error)?.stack,
        );
      }
    }

    // Send response
    response.status(statusCode).json(errorResponse);
  }

  /**
   * Handle Prisma database errors and convert them to user-friendly messages
   */
  private handlePrismaError(exception: Prisma.PrismaClientKnownRequestError): {
    statusCode: number;
    message: string;
    error: string;
    details?: any;
  } {
    const { code, meta } = exception;

    switch (code) {
      case "P2002": // Unique constraint violation
        return {
          statusCode: HttpStatus.CONFLICT,
          message: `A record with this ${(meta?.target as string[])?.join(", ")} already exists`,
          error: "UniqueConstraintViolation",
          details: meta,
        };

      case "P2025": // Record not found
        return {
          statusCode: HttpStatus.NOT_FOUND,
          message: "Record not found",
          error: "RecordNotFound",
          details: meta,
        };

      case "P2003": // Foreign key constraint violation
        return {
          statusCode: HttpStatus.BAD_REQUEST,
          message:
            "Related record not found or cannot delete record with dependencies",
          error: "ForeignKeyConstraintViolation",
          details: meta,
        };

      case "P2014": // Required relation violation
        return {
          statusCode: HttpStatus.BAD_REQUEST,
          message: "The change would violate a required relation",
          error: "RequiredRelationViolation",
          details: meta,
        };

      case "P2016": // Query interpretation error
        return {
          statusCode: HttpStatus.BAD_REQUEST,
          message: "Invalid query parameters",
          error: "InvalidQuery",
          details: meta,
        };

      case "P2021": // Table does not exist
        return {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: "Database configuration error",
          error: "DatabaseConfigError",
          details: meta,
        };

      case "P2024": // Connection timeout
        return {
          statusCode: HttpStatus.SERVICE_UNAVAILABLE,
          message: "Database connection timeout",
          error: "DatabaseTimeout",
        };

      case "P2000": // Value too long for the column
      case "P2020": // Value out of range for the type (e.g. numeric overflow)
        // Bad client input, not a server fault — a number/string that exceeds
        // the column's precision/length. Surface as 400 so the client gets an
        // actionable validation error instead of a 500. DTO @Max/@MaxLength
        // bounds are the first line of defense; this is the safety net for any
        // field that slips through.
        return {
          statusCode: HttpStatus.BAD_REQUEST,
          message: "A value is out of the allowed range or too long",
          error: "ValueOutOfRange",
          details: meta,
        };

      default:
        return {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: "Database error occurred",
          error: "DatabaseError",
          details: { code, meta },
        };
    }
  }

  /**
   * Log error with appropriate level based on status code
   */
  private logError(
    exception: unknown,
    request: Request,
    statusCode: number,
    requestId: string,
  ): void {
    // Iter-83: do NOT log req.user.email. Sentry already omits it
    // ("Sentry retains breadcrumbs/events for weeks and user email is
    // unnecessary for triage when we already have the user id +
    // tenant id" — see captureException block above) but the local
    // file/console logger used to bake it into every 4xx/5xx log
    // line. With file logs retained for weeks under standard ops
    // policy, every error response that fired for an authenticated
    // user persisted their email in the log archive — GDPR/KVKK
    // surface that the matching Sentry path was already protecting
    // against. user.id + tenant.id correlate to the auth/audit
    // tables on demand.
    const logMessage = {
      requestId,
      method: request.method,
      url: request.url,
      statusCode,
      // SuperAdminGuard attaches its principal to request.superAdmin (not
      // request.user), so without this fallback EVERY superadmin error —
      // even fully authenticated ones — logged userId:"anonymous" and looked
      // like a tokenless request during triage.
      userId:
        (request as any).user?.id ??
        (request as any).superAdmin?.id ??
        "anonymous",
      tenant: (request as any).user?.tenantId || "N/A",
      userAgent: request.headers["user-agent"],
      ip: request.ip,
    };

    if (statusCode >= 500) {
      // Server errors - log as error with stack trace
      this.logger.error(
        `Internal error: ${exception instanceof Error ? exception.message : "Unknown error"}`,
        exception instanceof Error ? exception.stack : undefined,
        JSON.stringify(logMessage),
      );
    } else if (statusCode >= 400) {
      // Client errors - log as warning
      this.logger.warn(
        `Client error: ${exception instanceof Error ? exception.message : "Unknown error"}`,
        JSON.stringify(logMessage),
      );
    }
  }

  /**
   * Generate unique request ID for tracking
   */
  private generateRequestId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}
