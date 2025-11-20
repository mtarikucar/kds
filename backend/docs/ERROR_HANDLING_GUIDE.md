# Error Handling Guide

## Overview

The application uses a standardized error handling system with custom exceptions that include error codes for consistent client-side handling.

## Architecture

### 1. Exception Filter (`http-exception.filter.ts`)
- **Global filter** catches all exceptions
- **Standardizes responses** into `ErrorResponse` format
- **Handles Prisma errors** (unique constraints, not found, etc.)
- **Sentry integration** for 5xx errors
- **Development vs Production** modes (stack traces only in dev)

### 2. Custom Exceptions (`common/exceptions/`)
All custom exceptions extend `BusinessException` and include:
- **Error codes** from `ErrorCode` enum
- **HTTP status codes**
- **Optional details** for debugging
- **Consistent formatting**

### 3. Error Response Interface
```typescript
interface ErrorResponse {
  statusCode: number;        // HTTP status code
  message: string | string[]; // User-friendly message
  error: string;             // Error type/code
  timestamp: string;         // ISO timestamp
  path: string;              // Request path
  requestId?: string;        // Tracking ID
  details?: any;             // Dev mode only
  stack?: string;            // Dev mode only
}
```

## Available Custom Exceptions

### Import from Central Location
```typescript
import {
  ResourceNotFoundException,
  ResourceAlreadyExistsException,
  InvalidCredentialsException,
  ValidationException,
  InvalidInputException,
  PaymentFailedException,
  // ... more
} from '@/common/exceptions';
```

### Resource Exceptions
```typescript
// Resource not found
throw new ResourceNotFoundException('User', userId);
// → "User with ID '123' not found" (404)

// Resource already exists
throw new ResourceAlreadyExistsException('User', 'email', 'test@example.com');
// → "User with email 'test@example.com' already exists" (409)
```

### Authentication Exceptions
```typescript
// Invalid credentials (login failures)
throw new InvalidCredentialsException();
// → "Invalid email or password" (401)
```

### Authorization Exceptions
```typescript
// Insufficient permissions
throw new InsufficientPermissionsException('delete users');
// → "You don't have permission to delete users" (403)
```

### Validation Exceptions
```typescript
// Generic validation error
throw new ValidationException('Cannot provide both fields');
// → 400 with VALIDATION_ERROR code

// Invalid input
throw new InvalidInputException('email', 'Must be a valid email address');
// → "Invalid email: Must be a valid email address" (400)

// Missing field
throw new MissingRequiredFieldException('firstName');
// → "Required field 'firstName' is missing" (400)
```

### Payment Exceptions
```typescript
// Payment failed
throw new PaymentFailedException('Insufficient funds');
// → "Payment failed: Insufficient funds" (402)

// Invalid payment method
throw new InvalidPaymentMethodException('bitcoin');
// → "Invalid payment method: bitcoin" (400)

// Order already paid
throw new OrderAlreadyPaidException(orderId);
// → "Order 123 has already been paid" (400)
```

### Order Exceptions
```typescript
// Invalid order status
throw new InvalidOrderStatusException('CANCELLED', 'accept payment');
// → "Cannot accept payment an order with status 'CANCELLED'" (400)

// Insufficient stock
throw new InsufficientStockException('Pizza', 5, 10);
// → "Insufficient stock for Pizza. Available: 5, Requested: 10" (400)
```

### Subscription Exceptions
```typescript
// Subscription required
throw new SubscriptionRequiredException('advanced analytics');
// → "This feature requires an active subscription..." (402)

// Feature not available
throw new FeatureNotAvailableException('Multi-location', 'PRO');
// → "The Multi-location feature is not available on your current plan..." (402)

// Quota exceeded
throw new QuotaExceededException('products', 50);
// → "You have reached the maximum limit of 50 products..." (402)
```

## Migration Guide

### Before (Generic NestJS Exceptions)
```typescript
import { BadRequestException, NotFoundException } from '@nestjs/common';

// ❌ No error code, generic message
throw new BadRequestException('Invalid tenant');

// ❌ No structured details
throw new NotFoundException('User not found');
```

### After (Custom Exceptions)
```typescript
import { ResourceNotFoundException, ValidationException } from '@/common/exceptions';

// ✅ Includes error code, structured format
throw new ResourceNotFoundException('Tenant', tenantId);

// ✅ Error code for client-side handling
throw new ValidationException('Invalid tenant configuration');
```

## Error Codes

All error codes are defined in `ErrorCode` enum:

### Authentication
- `INVALID_CREDENTIALS`
- `TOKEN_EXPIRED`
- `TOKEN_INVALID`
- `UNAUTHORIZED`

### Authorization
- `FORBIDDEN`
- `INSUFFICIENT_PERMISSIONS`

### Resources
- `RESOURCE_NOT_FOUND`
- `RESOURCE_ALREADY_EXISTS`
- `RESOURCE_CONFLICT`

### Validation
- `VALIDATION_ERROR`
- `INVALID_INPUT`
- `MISSING_REQUIRED_FIELD`

### Business Logic
- `INSUFFICIENT_STOCK`
- `ORDER_ALREADY_PAID`
- `TABLE_OCCUPIED`
- `INVALID_ORDER_STATUS`
- `SUBSCRIPTION_REQUIRED`
- `FEATURE_NOT_AVAILABLE`
- `QUOTA_EXCEEDED`

### Payments
- `PAYMENT_FAILED`
- `PAYMENT_PROCESSING_ERROR`
- `INVALID_PAYMENT_METHOD`

### System
- `INTERNAL_SERVER_ERROR`
- `SERVICE_UNAVAILABLE`
- `DATABASE_ERROR`
- `EXTERNAL_SERVICE_ERROR`
- `TOO_MANY_REQUESTS`

## Client-Side Handling

### React/TypeScript Example
```typescript
try {
  await api.post('/users', userData);
} catch (error) {
  const errorResponse = error.response?.data as ErrorResponse;

  switch (errorResponse.error) {
    case 'RESOURCE_ALREADY_EXISTS':
      toast.error('Email is already registered');
      break;
    case 'VALIDATION_ERROR':
      setFieldErrors(errorResponse.details);
      break;
    case 'INSUFFICIENT_PERMISSIONS':
      navigate('/unauthorized');
      break;
    default:
      toast.error(errorResponse.message);
  }
}
```

## Prisma Error Handling

The exception filter automatically converts Prisma errors:

| Prisma Code | HTTP Status | Error Code | Message |
|-------------|-------------|------------|---------|
| P2002 | 409 | UniqueConstraintViolation | "A record with this {field} already exists" |
| P2025 | 404 | RecordNotFound | "Record not found" |
| P2003 | 400 | ForeignKeyConstraintViolation | "Related record not found..." |
| P2014 | 400 | RequiredRelationViolation | "The change would violate a required relation" |
| P2024 | 503 | DatabaseTimeout | "Database connection timeout" |

## Best Practices

### 1. Use Specific Exceptions
```typescript
// ❌ Generic
throw new BadRequestException('Invalid input');

// ✅ Specific
throw new InvalidInputException('email', 'Must be a valid email');
```

### 2. Include Context
```typescript
// ❌ No context
throw new ResourceNotFoundException('Order');

// ✅ With identifier
throw new ResourceNotFoundException('Order', orderId);
```

### 3. Add Details for Debugging
```typescript
throw new ValidationException('Invalid product configuration', {
  productId,
  missingFields: ['price', 'category'],
  providedFields: Object.keys(dto),
});
```

### 4. Don't Catch and Re-throw Generic
```typescript
// ❌ Loses error code
try {
  await someOperation();
} catch (error) {
  throw new BadRequestException('Operation failed');
}

// ✅ Let it bubble or add context
try {
  await someOperation();
} catch (error) {
  if (error instanceof SomeSpecificError) {
    throw new BusinessException(
      'Failed to process operation',
      ErrorCode.EXTERNAL_SERVICE_ERROR,
      HttpStatus.SERVICE_UNAVAILABLE,
      { originalError: error.message }
    );
  }
  throw error; // Let filter handle it
}
```

## Testing

### Unit Tests
```typescript
it('should throw ResourceNotFoundException when user not found', async () => {
  prisma.user.findUnique.mockResolvedValue(null);

  await expect(service.getUser('invalid-id'))
    .rejects
    .toThrow(ResourceNotFoundException);
});
```

### E2E Tests
```typescript
it('POST /users - should return 409 for duplicate email', () => {
  return request(app.getHttpServer())
    .post('/users')
    .send({ email: 'existing@example.com', ... })
    .expect(409)
    .expect((res) => {
      expect(res.body.error).toBe('RESOURCE_ALREADY_EXISTS');
      expect(res.body.message).toContain('email');
    });
});
```

## Creating New Exceptions

### 1. Add to existing file
```typescript
// In business.exception.ts, validation.exception.ts, or payment.exception.ts
export class MyCustomException extends BusinessException {
  constructor(param: string) {
    super(
      `Custom message with ${param}`,
      ErrorCode.MY_ERROR_CODE, // Add to enum first
      HttpStatus.BAD_REQUEST,
    );
  }
}
```

### 2. Add error code
```typescript
// In error-response.interface.ts
export enum ErrorCode {
  // ... existing codes
  MY_ERROR_CODE = 'MY_ERROR_CODE',
}
```

### 3. Export from index
```typescript
// In exceptions/index.ts
export { MyCustomException } from './business.exception';
```

## Summary

**✅ DO:**
- Use custom exceptions with error codes
- Import from `@/common/exceptions`
- Include context (IDs, field names)
- Add details for debugging
- Let the filter handle formatting

**❌ DON'T:**
- Use generic `BadRequestException` for business logic
- Throw Error directly
- Include sensitive data in messages
- Catch and re-throw without adding value
- Hard-code error messages in controllers

## References

- **Exception Filter:** `src/common/filters/http-exception.filter.ts`
- **Custom Exceptions:** `src/common/exceptions/`
- **Error Codes:** `src/common/interfaces/error-response.interface.ts`
- **Example Usage:** `src/modules/auth/auth.service.ts`
