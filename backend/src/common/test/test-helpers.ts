import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../prisma/prisma.service';
import * as request from 'supertest';

/**
 * Test Helpers for E2E and Integration Tests
 */

/**
 * Create a test application instance
 */
export async function createTestApp(): Promise<INestApplication> {
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleFixture.createNestApplication();
  await app.init();

  return app;
}

/**
 * Clean database between tests
 */
export async function cleanDatabase(prisma: PrismaService) {
  // Delete in order to respect foreign key constraints
  await prisma.payment.deleteMany();
  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
  await prisma.productImage.deleteMany();
  await prisma.productModifierGroup.deleteMany();
  await prisma.product.deleteMany();
  await prisma.category.deleteMany();
  await prisma.table.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.user.deleteMany();
  await prisma.tenant.deleteMany();
}

/**
 * Generate authentication token for testing
 */
export async function getAuthToken(
  app: INestApplication,
  email: string = 'test@example.com',
  password: string = 'password123',
): Promise<string> {
  const response = await request.default(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email, password })
    .expect(200);

  return response.body.accessToken;
}

/**
 * Create a test tenant with admin user
 */
export async function createTestTenant(prisma: PrismaService) {
  const bcrypt = require('bcryptjs');

  const tenant = await prisma.tenant.create({
    data: {
      name: 'Test Restaurant',
      subdomain: 'test-restaurant',
      paymentRegion: 'INTERNATIONAL',
      status: 'ACTIVE',
    },
  });

  const hashedPassword = await bcrypt.hash('password123', 10);

  const user = await prisma.user.create({
    data: {
      email: 'test@example.com',
      password: hashedPassword,
      firstName: 'Test',
      lastName: 'User',
      role: 'ADMIN',
      tenantId: tenant.id,
      emailVerified: true,
    },
  });

  return { tenant, user };
}

/**
 * Create test categories
 */
export async function createTestCategories(
  prisma: PrismaService,
  tenantId: string,
  count: number = 3,
) {
  const categories = [];

  for (let i = 1; i <= count; i++) {
    const category = await prisma.category.create({
      data: {
        name: `Category ${i}`,
        description: `Test category ${i}`,
        tenantId,
      },
    });
    categories.push(category);
  }

  return categories;
}

/**
 * Create test products
 */
export async function createTestProducts(
  prisma: PrismaService,
  tenantId: string,
  categoryId: string,
  count: number = 5,
) {
  const products = [];

  for (let i = 1; i <= count; i++) {
    const product = await prisma.product.create({
      data: {
        name: `Product ${i}`,
        description: `Test product ${i}`,
        price: 10 + i,
        categoryId,
        tenantId,
        isAvailable: true,
        stockTracked: true,
        currentStock: 100,
      },
    });
    products.push(product);
  }

  return products;
}

/**
 * Create a test order
 */
export async function createTestOrder(
  prisma: PrismaService,
  tenantId: string,
  productIds: string[],
) {
  // Get products to calculate total
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
  });

  const totalAmount = products.reduce((sum, p) => sum + Number(p.price), 0);

  const order = await prisma.order.create({
    data: {
      orderNumber: `TEST-${Date.now()}`,
      tenantId,
      type: 'DINE_IN',
      status: 'PENDING',
      totalAmount,
      discount: 0,
      finalAmount: totalAmount,
      orderItems: {
        create: products.map((product) => ({
          productId: product.id,
          quantity: 1,
          unitPrice: Number(product.price),
          subtotal: Number(product.price),
          modifierTotal: 0,
        })) as any,
      },
    },
    include: {
      orderItems: true,
    },
  } as any);

  return order;
}

/**
 * Wait for condition with timeout
 */
export async function waitFor(
  condition: () => Promise<boolean> | boolean,
  timeout: number = 5000,
  interval: number = 100,
): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    if (await condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }

  throw new Error('Timeout waiting for condition');
}

/**
 * Mock date for consistent testing
 */
export function mockDate(date: string | Date) {
  const mockDate = new Date(date);
  const originalDate = Date;

  global.Date = class extends originalDate {
    constructor(...args: any[]) {
      if (args.length === 0) {
        super();
        Object.setPrototypeOf(mockDate, new.target.prototype);
        return mockDate as any;
      }
      super(...(args as []));
    }

    static now() {
      return mockDate.getTime();
    }
  } as any;

  return () => {
    global.Date = originalDate;
  };
}

/**
 * Assert error response format
 */
export function assertErrorResponse(response: any, expectedStatus: number, expectedError?: string) {
  expect(response.status).toBe(expectedStatus);
  expect(response.body).toHaveProperty('statusCode', expectedStatus);
  expect(response.body).toHaveProperty('message');
  expect(response.body).toHaveProperty('timestamp');
  expect(response.body).toHaveProperty('path');

  if (expectedError) {
    expect(response.body).toHaveProperty('error', expectedError);
  }
}
