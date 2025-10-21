import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ErrorResponse } from '../interfaces/error-response.interface';
import { BusinessException } from '../exceptions/business.exception';
import { LoggerService } from '../services/logger.service';
import { Prisma } from '@prisma/client';

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

    const isDevelopment = process.env.NODE_ENV === 'development';

    // Generate request ID for tracking
    const requestId = this.generateRequestId();

    let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = 'Internal server error';
    let error = 'InternalServerError';
    let details: any = undefined;
    let stack: string | undefined = undefined;

    // Handle different exception types
    if (exception instanceof BusinessException) {
      // Business logic exceptions with custom error codes
      statusCode = exception.getStatus();
      const exceptionResponse = exception.getResponse() as any;
      message = exceptionResponse.message || exception.message;
      error = exceptionResponse.errorCode || 'BusinessError';
      details = exceptionResponse.details;
    } else if (exception instanceof HttpException) {
      // Standard HTTP exceptions
      statusCode = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      } else if (typeof exceptionResponse === 'object') {
        message = (exceptionResponse as any).message || exception.message;
        error = (exceptionResponse as any).error || exception.name;
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
      message = 'Database validation error';
      error = 'DatabaseValidationError';
      details = isDevelopment ? exception.message : undefined;
    } else if (exception instanceof Error) {
      // Generic errors
      message = exception.message || 'An unexpected error occurred';
      error = exception.name || 'Error';
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

    // Include details and stack only in development
    if (isDevelopment) {
      if (details) errorResponse.details = details;
      if (stack) errorResponse.stack = stack;
    }

    // Log the error
    this.logError(exception, request, statusCode, requestId);

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
      case 'P2002': // Unique constraint violation
        return {
          statusCode: HttpStatus.CONFLICT,
          message: `A record with this ${(meta?.target as string[])?.join(', ')} already exists`,
          error: 'UniqueConstraintViolation',
          details: meta,
        };

      case 'P2025': // Record not found
        return {
          statusCode: HttpStatus.NOT_FOUND,
          message: 'Record not found',
          error: 'RecordNotFound',
          details: meta,
        };

      case 'P2003': // Foreign key constraint violation
        return {
          statusCode: HttpStatus.BAD_REQUEST,
          message: 'Related record not found or cannot delete record with dependencies',
          error: 'ForeignKeyConstraintViolation',
          details: meta,
        };

      case 'P2014': // Required relation violation
        return {
          statusCode: HttpStatus.BAD_REQUEST,
          message: 'The change would violate a required relation',
          error: 'RequiredRelationViolation',
          details: meta,
        };

      case 'P2016': // Query interpretation error
        return {
          statusCode: HttpStatus.BAD_REQUEST,
          message: 'Invalid query parameters',
          error: 'InvalidQuery',
          details: meta,
        };

      case 'P2021': // Table does not exist
        return {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Database configuration error',
          error: 'DatabaseConfigError',
          details: meta,
        };

      case 'P2024': // Connection timeout
        return {
          statusCode: HttpStatus.SERVICE_UNAVAILABLE,
          message: 'Database connection timeout',
          error: 'DatabaseTimeout',
        };

      default:
        return {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Database error occurred',
          error: 'DatabaseError',
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
    const logMessage = {
      requestId,
      method: request.method,
      url: request.url,
      statusCode,
      user: (request as any).user?.email || 'anonymous',
      tenant: (request as any).user?.tenantId || 'N/A',
      userAgent: request.headers['user-agent'],
      ip: request.ip,
    };

    if (statusCode >= 500) {
      // Server errors - log as error with stack trace
      this.logger.error(
        `Internal error: ${exception instanceof Error ? exception.message : 'Unknown error'}`,
        exception instanceof Error ? exception.stack : undefined,
        JSON.stringify(logMessage),
      );
    } else if (statusCode >= 400) {
      // Client errors - log as warning
      this.logger.warn(
        `Client error: ${exception instanceof Error ? exception.message : 'Unknown error'}`,
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
