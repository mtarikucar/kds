import { HttpStatus } from '@nestjs/common';
import { BusinessException } from './business.exception';
import { ErrorCode } from '../interfaces/error-response.interface';

/**
 * Validation exception for input validation errors
 * Use this instead of BadRequestException for validation failures
 */
export class ValidationException extends BusinessException {
  constructor(message: string, details?: any) {
    super(
      message,
      ErrorCode.VALIDATION_ERROR,
      HttpStatus.BAD_REQUEST,
      details,
    );
  }
}

/**
 * Invalid input exception
 */
export class InvalidInputException extends BusinessException {
  constructor(field: string, reason?: string) {
    const message = reason
      ? `Invalid ${field}: ${reason}`
      : `Invalid ${field}`;
    super(message, ErrorCode.INVALID_INPUT, HttpStatus.BAD_REQUEST);
  }
}

/**
 * Missing required field exception
 */
export class MissingRequiredFieldException extends BusinessException {
  constructor(field: string) {
    super(
      `Required field '${field}' is missing`,
      ErrorCode.MISSING_REQUIRED_FIELD,
      HttpStatus.BAD_REQUEST,
    );
  }
}

/**
 * Conflict exception for resource conflicts
 * Use this instead of ConflictException
 */
export class ResourceConflictException extends BusinessException {
  constructor(message: string, details?: any) {
    super(message, ErrorCode.RESOURCE_CONFLICT, HttpStatus.CONFLICT, details);
  }
}
