# Testing Guide

Comprehensive guide for writing and running tests in the Restaurant POS system.

## Overview

The project uses different testing frameworks for different parts:
- **Backend**: Jest (NestJS standard)
- **Frontend**: Vitest (faster, Vite-native)
- **E2E**: Jest with Supertest

## Table of Contents

- [Backend Testing](#backend-testing)
- [Frontend Testing](#frontend-testing)
- [E2E Testing](#e2e-testing)
- [Test Coverage](#test-coverage)
- [Best Practices](#best-practices)
- [CI/CD Integration](#cicd-integration)

---

## Backend Testing

### Running Tests

```bash
cd backend

# Run all unit tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:cov

# Run specific test file
npm test -- auth.service.spec.ts

# Run E2E tests
npm run test:e2e
```

### Writing Unit Tests

**Location**: `/backend/src/**/*.spec.ts`

#### Example: Service Test

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { ProductsService } from './products.service';
import { PrismaService } from '../../prisma/prisma.service';
import { mockPrismaClient, mockProduct } from '../../common/test/prisma-mock.service';

describe('ProductsService', () => {
  let service: ProductsService;
  let prisma: ReturnType<typeof mockPrismaClient>;

  beforeEach(async () => {
    prisma = mockPrismaClient();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductsService,
        {
          provide: PrismaService,
          useValue: prisma,
        },
      ],
    }).compile();

    service = module.get<ProductsService>(ProductsService);
  });

  describe('findAll', () => {
    it('should return an array of products', async () => {
      const products = [mockProduct];
      prisma.product.findMany.mockResolvedValue(products);

      const result = await service.findAll('tenant-1');

      expect(result).toEqual(products);
      expect(prisma.product.findMany).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1' },
      });
    });
  });

  describe('create', () => {
    it('should create a product', async () => {
      const createDto = {
        name: 'New Product',
        price: 15.99,
        categoryId: 'cat-1',
      };

      prisma.product.create.mockResolvedValue({
        ...mockProduct,
        ...createDto,
      });

      const result = await service.create('tenant-1', createDto);

      expect(result.name).toBe(createDto.name);
      expect(prisma.product.create).toHaveBeenCalled();
    });
  });
});
```

#### Example: Controller Test

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { mockProduct } from '../../common/test/prisma-mock.service';

describe('ProductsController', () => {
  let controller: ProductsController;
  let service: ProductsService;

  const mockProductsService = {
    findAll: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProductsController],
      providers: [
        {
          provide: ProductsService,
          useValue: mockProductsService,
        },
      ],
    }).compile();

    controller = module.get<ProductsController>(ProductsController);
    service = module.get<ProductsService>(ProductsService);
  });

  it('should return products for a tenant', async () => {
    const products = [mockProduct];
    mockProductsService.findAll.mockResolvedValue(products);

    const req = { user: { tenantId: 'tenant-1' } };
    const result = await controller.findAll(req);

    expect(result).toEqual(products);
    expect(service.findAll).toHaveBeenCalledWith('tenant-1');
  });
});
```

### Test Utilities

**Mock Prisma Client**: Use `mockPrismaClient()` from `/backend/src/common/test/prisma-mock.service.ts`

**Mock Data**: Pre-defined mocks available:
- `mockUser`
- `mockTenant`
- `mockProduct`
- `mockOrder`
- `mockPayment`

**Test Helpers**: Available in `/backend/src/common/test/test-helpers.ts`:
- `createTestApp()` - Create app instance
- `cleanDatabase()` - Clean DB between tests
- `getAuthToken()` - Get JWT token
- `createTestTenant()` - Create test tenant
- `createTestProducts()` - Create test products
- `waitFor()` - Wait for async conditions
- `assertErrorResponse()` - Assert error format

---

## Frontend Testing

### Running Tests

```bash
cd frontend

# Run all tests
npm test

# Run tests in watch mode
npm run test

# Run tests with UI
npm run test:ui

# Run tests with coverage
npm run test:coverage

# Run specific test file
npm test -- ErrorBoundary.spec.tsx
```

### Writing Component Tests

**Location**: `/frontend/src/**/*.spec.tsx`

#### Example: Component Test

```typescript
import { describe, it, expect, vi } from 'vitest';
import { renderWithProviders, screen, userEvent, waitFor } from '../test/test-utils';
import ProductCard from './ProductCard';
import { mockProduct } from '../test/test-utils';

describe('ProductCard', () => {
  it('renders product information', () => {
    renderWithProviders(<ProductCard product={mockProduct} />);

    expect(screen.getByText(mockProduct.name)).toBeInTheDocument();
    expect(screen.getByText(mockProduct.description)).toBeInTheDocument();
    expect(screen.getByText(`$${mockProduct.price}`)).toBeInTheDocument();
  });

  it('calls onAddToCart when add button is clicked', async () => {
    const onAddToCart = vi.fn();
    const user = userEvent.setup();

    renderWithProviders(
      <ProductCard product={mockProduct} onAddToCart={onAddToCart} />
    );

    const addButton = screen.getByRole('button', { name: /add to cart/i });
    await user.click(addButton);

    expect(onAddToCart).toHaveBeenCalledWith(mockProduct);
  });

  it('shows "Out of Stock" when product is unavailable', () => {
    const unavailableProduct = { ...mockProduct, available: false };

    renderWithProviders(<ProductCard product={unavailableProduct} />);

    expect(screen.getByText(/out of stock/i)).toBeInTheDocument();
  });
});
```

#### Example: Hook Test

```typescript
import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useProducts } from './useProducts';
import * as api from '../api/products';

vi.mock('../api/products');

describe('useProducts', () => {
  const wrapper = ({ children }) => (
    <QueryClientProvider client={new QueryClient()}>
      {children}
    </QueryClientProvider>
  );

  it('fetches products successfully', async () => {
    const mockProducts = [mockProduct];
    vi.mocked(api.getProducts).mockResolvedValue(mockProducts);

    const { result } = renderHook(() => useProducts(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual(mockProducts);
  });

  it('handles errors', async () => {
    vi.mocked(api.getProducts).mockRejectedValue(new Error('API Error'));

    const { result } = renderHook(() => useProducts(), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
```

### Test Utilities

**Render with Providers**: Use `renderWithProviders()` from `src/test/test-utils.tsx`

**Mock Data**: Pre-defined mocks available:
- `mockUser`
- `mockAuthTokens`
- `mockProduct`
- `mockOrder`

**Helpers**:
- `mockLocalStorage()` - Mock localStorage
- `mockApiResponse()` - Mock API success
- `mockApiError()` - Mock API error
- `createMockFile()` - Create file for uploads

---

## E2E Testing

### Running E2E Tests

```bash
cd backend

# Run E2E tests
npm run test:e2e

# Run specific E2E test
npm run test:e2e -- auth.e2e-spec.ts
```

### Writing E2E Tests

**Location**: `/backend/test/**/*.e2e-spec.ts`

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  cleanDatabase,
  createTestTenant,
  getAuthToken,
} from '../src/common/test/test-helpers';

describe('Products (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let authToken: string;
  let tenantId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    prisma = app.get<PrismaService>(PrismaService);

    // Create test tenant and user
    const { tenant, user } = await createTestTenant(prisma);
    tenantId = tenant.id;

    // Get auth token
    authToken = await getAuthToken(app);
  });

  afterAll(async () => {
    await cleanDatabase(prisma);
    await app.close();
  });

  describe('/api/products (GET)', () => {
    it('should return products for authenticated user', () => {
      return request(app.getHttpServer())
        .get('/api/products')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)
        .expect((res) => {
          expect(Array.isArray(res.body)).toBe(true);
        });
    });

    it('should return 401 without auth token', () => {
      return request(app.getHttpServer())
        .get('/api/products')
        .expect(401);
    });
  });

  describe('/api/products (POST)', () => {
    it('should create a new product', () => {
      const createDto = {
        name: 'Test Product',
        description: 'Test Description',
        price: 15.99,
        categoryId: 'cat-1',
      };

      return request(app.getHttpServer())
        .post('/api/products')
        .set('Authorization', `Bearer ${authToken}`)
        .send(createDto)
        .expect(201)
        .expect((res) => {
          expect(res.body.name).toBe(createDto.name);
          expect(res.body.price).toBe(createDto.price);
        });
    });
  });
});
```

---

## Test Coverage

### Target Coverage

- **Unit Tests**: 60% minimum
- **Integration Tests**: Critical paths
- **E2E Tests**: Main user flows

### Checking Coverage

```bash
# Backend
cd backend
npm run test:cov

# Frontend
cd frontend
npm run test:coverage
```

### Coverage Reports

Coverage reports are generated in:
- Backend: `/backend/coverage/`
- Frontend: `/frontend/coverage/`

Open `coverage/index.html` in a browser to view detailed reports.

---

## Best Practices

### General

1. **Test Naming**: Use descriptive names
   - Good: `should return 404 when product not found`
   - Bad: `test product`

2. **AAA Pattern**: Arrange, Act, Assert
   ```typescript
   it('should create a product', async () => {
     // Arrange
     const createDto = { name: 'Product', price: 10 };

     // Act
     const result = await service.create(createDto);

     // Assert
     expect(result.name).toBe(createDto.name);
   });
   ```

3. **One Assertion Per Test**: Focus tests on single behaviors

4. **Mock External Dependencies**: Database, APIs, file system

5. **Clean Up**: Reset mocks, clean database after tests

### Backend-Specific

1. **Use Mock Prisma Client**: Don't connect to real database
2. **Test Business Logic**: Focus on services, not DTO validation
3. **Test Error Cases**: Not just happy paths
4. **Use Test Factories**: Reuse mock data generators

### Frontend-Specific

1. **Test User Interactions**: Click, type, submit
2. **Test Accessibility**: Use `getByRole`, `getByLabelText`
3. **Avoid Implementation Details**: Test behavior, not state
4. **Mock API Calls**: Don't make real network requests
5. **Test Loading States**: Skeleton screens, spinners

### E2E-Specific

1. **Test Critical Paths**: Login, checkout, payment
2. **Clean Database**: Between tests to avoid flakiness
3. **Use Real Data Flow**: Minimal mocking
4. **Test Error Scenarios**: Network failures, validation errors

---

## CI/CD Integration

### GitHub Actions

Tests run automatically on:
- Pull requests
- Pushes to `main` branch
- Manual workflow dispatch

### Configuration

See `.github/workflows/test.yml` (to be created)

```yaml
name: Tests

on: [push, pull_request]

jobs:
  backend-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: cd backend && npm ci
      - run: cd backend && npm test
      - run: cd backend && npm run test:e2e

  frontend-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: cd frontend && npm ci
      - run: cd frontend && npm test
```

---

## Troubleshooting

### Common Issues

**Tests timing out**:
- Increase timeout in test: `jest.setTimeout(10000)`
- Check for unresolved promises
- Verify mocks are properly configured

**Database connection errors**:
- Use mock Prisma client in unit tests
- Clean database in E2E tests

**React hooks errors**:
- Use `renderWithProviders()` instead of `render()`
- Wrap hooks in `renderHook()` with proper providers

**Module not found**:
- Check path aliases in config files
- Verify imports match file structure

### Getting Help

- Check test output for error messages
- Review existing test files for patterns
- Ask in team chat
- Review this guide

---

## Resources

- [Jest Documentation](https://jestjs.io/)
- [Vitest Documentation](https://vitest.dev/)
- [Testing Library](https://testing-library.com/)
- [NestJS Testing](https://docs.nestjs.com/fundamentals/testing)

---

## Next Steps

1. ✅ Test infrastructure configured
2. ⏭️ Write unit tests for Auth module
3. ⏭️ Write unit tests for critical services
4. ⏭️ Add frontend component tests
5. ⏭️ Write E2E tests for main flows
6. ⏭️ Set up CI/CD test automation
7. ⏭️ Achieve 60%+ coverage target
