import { ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { HttpExceptionFilter } from './http-exception.filter';
import { BusinessException, ResourceNotFoundException } from '../exceptions/business.exception';
import { ErrorCode } from '../interfaces/error-response.interface';

describe('HttpExceptionFilter', () => {
  let filter: HttpExceptionFilter;
  let mockArgumentsHost: ArgumentsHost;
  let mockResponse: any;
  let mockRequest: any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [HttpExceptionFilter],
    }).compile();

    filter = module.get<HttpExceptionFilter>(HttpExceptionFilter);

    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };

    mockRequest = {
      url: '/api/test',
      method: 'GET',
      ip: '127.0.0.1',
      headers: {
        'user-agent': 'test-agent',
      },
      user: {
        email: 'test@test.com',
        tenantId: 'tenant-1',
      },
    };

    mockArgumentsHost = {
      switchToHttp: jest.fn().mockReturnValue({
        getResponse: () => mockResponse,
        getRequest: () => mockRequest,
      }),
      getArgByIndex: jest.fn(),
      getArgs: jest.fn(),
      getType: jest.fn(),
      switchToRpc: jest.fn(),
      switchToWs: jest.fn(),
    };
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('catch', () => {
    it('should handle standard HttpException', () => {
      const exception = new HttpException('Test error', HttpStatus.BAD_REQUEST);

      filter.catch(exception, mockArgumentsHost);

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      expect(mockResponse.json).toHaveBeenCalled();

      const response = mockResponse.json.mock.calls[0][0];
      expect(response.message).toBe('Test error');
      expect(response.statusCode).toBe(HttpStatus.BAD_REQUEST);
      expect(response.path).toBe('/api/test');
      expect(response).toHaveProperty('timestamp');
      expect(response).toHaveProperty('requestId');
    });

    it('should handle BusinessException with custom error code', () => {
      const exception = new BusinessException(
        'Resource not found',
        ErrorCode.RESOURCE_NOT_FOUND,
        HttpStatus.NOT_FOUND,
      );

      filter.catch(exception, mockArgumentsHost);

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);

      const response = mockResponse.json.mock.calls[0][0];
      expect(response.message).toBe('Resource not found');
      expect(response.error).toBe(ErrorCode.RESOURCE_NOT_FOUND);
      expect(response.statusCode).toBe(HttpStatus.NOT_FOUND);
    });

    it('preserves a machine-readable errorCode from a BadRequestException body', () => {
      // Regression: the payment "missing phone" gate throws
      // `new BadRequestException({ message, error, errorCode: 'PROFILE_PHONE_REQUIRED' })`.
      // Pre-fix the filter copied only message+error and DROPPED the code,
      // so the SPA's inline phone-prompt branch (keyed on data.errorCode)
      // never fired in prod and the user fell through to a generic warning.
      const exception = new HttpException(
        {
          statusCode: 400,
          error: 'Profile Phone Required',
          errorCode: 'PROFILE_PHONE_REQUIRED',
          message: 'Telefon numarası gereklidir.',
        },
        HttpStatus.BAD_REQUEST,
      );

      filter.catch(exception, mockArgumentsHost);

      const response = mockResponse.json.mock.calls[0][0];
      expect(response.errorCode).toBe('PROFILE_PHONE_REQUIRED');
      expect(response.message).toBe('Telefon numarası gereklidir.');
    });

    it('accepts the legacy `code` alias on the exception body as errorCode', () => {
      const exception = new HttpException(
        { error: 'Unsupported Currency', code: 'PAYTR_ONLY_SUPPORTS_TRY', message: 'x' },
        HttpStatus.BAD_REQUEST,
      );

      filter.catch(exception, mockArgumentsHost);

      const response = mockResponse.json.mock.calls[0][0];
      expect(response.errorCode).toBe('PAYTR_ONLY_SUPPORTS_TRY');
    });

    it('surfaces the BusinessException errorCode in the dedicated errorCode field too', () => {
      const exception = new BusinessException(
        'Quota exceeded',
        ErrorCode.QUOTA_EXCEEDED,
        HttpStatus.FORBIDDEN,
      );

      filter.catch(exception, mockArgumentsHost);

      const response = mockResponse.json.mock.calls[0][0];
      expect(response.errorCode).toBe(ErrorCode.QUOTA_EXCEEDED);
    });

    it('omits errorCode when the exception carries none', () => {
      filter.catch(new HttpException('plain', HttpStatus.BAD_REQUEST), mockArgumentsHost);
      const response = mockResponse.json.mock.calls[0][0];
      expect(response.errorCode).toBeUndefined();
    });

    it('should handle ResourceNotFoundException', () => {
      const exception = new ResourceNotFoundException('User', 'user-123');

      filter.catch(exception, mockArgumentsHost);

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);

      const response = mockResponse.json.mock.calls[0][0];
      expect(response.message).toContain('User');
      expect(response.message).toContain('user-123');
      expect(response.error).toBe(ErrorCode.RESOURCE_NOT_FOUND);
    });

    it('should handle Prisma unique constraint violation (P2002)', () => {
      const exception = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '5.0.0',
        meta: { target: ['email'] },
      });

      filter.catch(exception, mockArgumentsHost);

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.CONFLICT);

      const response = mockResponse.json.mock.calls[0][0];
      expect(response.message).toContain('email');
      expect(response.error).toBe('UniqueConstraintViolation');
    });

    it('should handle Prisma record not found (P2025)', () => {
      const exception = new Prisma.PrismaClientKnownRequestError('Record not found', {
        code: 'P2025',
        clientVersion: '5.0.0',
        meta: {},
      });

      filter.catch(exception, mockArgumentsHost);

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);

      const response = mockResponse.json.mock.calls[0][0];
      expect(response.message).toBe('Record not found');
      expect(response.error).toBe('RecordNotFound');
    });

    it('should handle Prisma foreign key constraint (P2003)', () => {
      const exception = new Prisma.PrismaClientKnownRequestError('Foreign key constraint failed', {
        code: 'P2003',
        clientVersion: '5.0.0',
        meta: {},
      });

      filter.catch(exception, mockArgumentsHost);

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);

      const response = mockResponse.json.mock.calls[0][0];
      expect(response.error).toBe('ForeignKeyConstraintViolation');
    });

    it('should handle Prisma validation errors', () => {
      const exception = new Prisma.PrismaClientValidationError('Invalid query', {
        clientVersion: '5.0.0',
      });

      filter.catch(exception, mockArgumentsHost);

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);

      const response = mockResponse.json.mock.calls[0][0];
      expect(response.message).toBe('Database validation error');
      expect(response.error).toBe('DatabaseValidationError');
    });

    it('should mask generic errors in production with a stable message', () => {
      // Filter intentionally hides the raw exception message in non-dev
      // environments so internal details (file paths, SQL fragments)
      // can't leak to clients. The development branch is exercised in
      // the "should include stack trace in development mode" test below.
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      const exception = new Error('Something went wrong');

      filter.catch(exception, mockArgumentsHost);

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);

      const response = mockResponse.json.mock.calls[0][0];
      expect(response.message).toBe('An unexpected error occurred');
      expect(response.statusCode).toBe(HttpStatus.INTERNAL_SERVER_ERROR);

      process.env.NODE_ENV = originalEnv;
    });

    it('should include stack trace in development mode', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';

      const exception = new Error('Test error with stack');

      filter.catch(exception, mockArgumentsHost);

      const response = mockResponse.json.mock.calls[0][0];
      expect(response).toHaveProperty('stack');

      process.env.NODE_ENV = originalEnv;
    });

    it('should not include stack trace in production mode', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      const exception = new Error('Test error');

      filter.catch(exception, mockArgumentsHost);

      const response = mockResponse.json.mock.calls[0][0];
      expect(response.stack).toBeUndefined();

      process.env.NODE_ENV = originalEnv;
    });

    it('should generate unique request IDs', () => {
      const exception1 = new HttpException('Error 1', HttpStatus.BAD_REQUEST);
      const exception2 = new HttpException('Error 2', HttpStatus.BAD_REQUEST);

      filter.catch(exception1, mockArgumentsHost);
      const requestId1 = mockResponse.json.mock.calls[0][0].requestId;

      filter.catch(exception2, mockArgumentsHost);
      const requestId2 = mockResponse.json.mock.calls[1][0].requestId;

      expect(requestId1).not.toBe(requestId2);
      expect(requestId1).toBeTruthy();
      expect(requestId2).toBeTruthy();
    });

    /**
     * Iter-83 regression. The Sentry capture path explicitly omitted
     * user.email "for GDPR/KVKK reduction" — Sentry retains
     * breadcrumbs/events for weeks. But the local logError path used
     * to bake req.user.email into every 4xx/5xx log line, so file
     * logs retained for weeks under standard ops policy archived
     * every authenticated user's email anyway. iter-83 switches the
     * log payload to user.id + tenantId.
     */
    it('does not log req.user.email in error metadata (iter-83 PII guard)', () => {
      // Capture warn/error log payloads through the private LoggerService.
      const warnSpy = jest.spyOn((filter as any).logger, 'warn').mockImplementation();
      const errorSpy = jest.spyOn((filter as any).logger, 'error').mockImplementation();

      mockRequest.user = { id: 'u-1', email: 'leaky@example.com', tenantId: 't-1' };
      filter.catch(new HttpException('BadRequest', HttpStatus.BAD_REQUEST), mockArgumentsHost);

      // The metadata blob ends up either as the 2nd arg of warn (4xx)
      // or the 3rd arg of error (5xx). For 400 it's warn.
      const blob = warnSpy.mock.calls.flat().join(' ');
      expect(blob).not.toContain('leaky@example.com');
      expect(blob).toContain('u-1');

      warnSpy.mockRestore();
      errorSpy.mockRestore();
    });

    it('logs userId="anonymous" when no req.user is present', () => {
      const warnSpy = jest.spyOn((filter as any).logger, 'warn').mockImplementation();

      mockRequest.user = undefined;
      filter.catch(new HttpException('Forbidden', HttpStatus.FORBIDDEN), mockArgumentsHost);

      const blob = warnSpy.mock.calls.flat().join(' ');
      expect(blob).toContain('anonymous');

      warnSpy.mockRestore();
    });
  });
});
