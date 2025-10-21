import { PrismaClient } from '@prisma/client';
import { mockDeep, DeepMockProxy } from 'jest-mock-extended';

/**
 * Create a mock Prisma client for testing
 * Usage in tests:
 *
 * const prismaMock = mockPrismaClient();
 * prismaMock.user.findUnique.mockResolvedValue(mockUser);
 */
export type MockPrismaClient = DeepMockProxy<PrismaClient>;

export function mockPrismaClient(): MockPrismaClient {
  return mockDeep<PrismaClient>();
}

/**
 * Mock data factories for common entities
 */
export const mockUser = {
  id: 'user-1',
  email: 'test@example.com',
  password: '$2a$10$hashed.password',
  name: 'Test User',
  role: 'ADMIN' as const,
  tenantId: 'tenant-1',
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
};

export const mockTenant = {
  id: 'tenant-1',
  name: 'Test Restaurant',
  slug: 'test-restaurant',
  address: '123 Test St',
  phone: '+1234567890',
  email: 'contact@test.com',
  subscriptionTier: 'PRO' as const,
  subscriptionStatus: 'ACTIVE' as const,
  trialEndsAt: null,
  subscriptionEndsAt: new Date('2025-01-01'),
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
};

export const mockProduct = {
  id: 'product-1',
  name: 'Test Product',
  description: 'Test description',
  price: 10.99,
  categoryId: 'category-1',
  tenantId: 'tenant-1',
  image: null,
  available: true,
  stockQuantity: 100,
  lowStockThreshold: 10,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
};

export const mockOrder = {
  id: 'order-1',
  orderNumber: 'ORD-001',
  tenantId: 'tenant-1',
  tableId: 'table-1',
  type: 'DINE_IN' as const,
  status: 'PENDING' as const,
  totalAmount: 50.0,
  discount: 0,
  finalAmount: 50.0,
  customerName: null,
  customerPhone: null,
  deliveryAddress: null,
  notes: null,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
};

export const mockPayment = {
  id: 'payment-1',
  orderId: 'order-1',
  amount: 50.0,
  method: 'CASH' as const,
  status: 'COMPLETED' as const,
  transactionId: null,
  metadata: null,
  createdAt: new Date('2024-01-01'),
};
