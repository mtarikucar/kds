import React, { ReactElement } from 'react';
import { render, RenderOptions } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * Create a test query client with sensible defaults
 */
export function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        cacheTime: 0,
      },
      mutations: {
        retry: false,
      },
    },
    logger: {
      log: console.log,
      warn: console.warn,
      error: () => {}, // Suppress errors in tests
    },
  });
}

/**
 * Wrapper for tests that need Router and QueryClient
 */
interface AllProvidersProps {
  children: React.ReactNode;
}

export function AllProviders({ children }: AllProvidersProps) {
  const testQueryClient = createTestQueryClient();

  return (
    <QueryClientProvider client={testQueryClient}>
      <BrowserRouter>{children}</BrowserRouter>
    </QueryClientProvider>
  );
}

/**
 * Custom render function with all providers
 */
export function renderWithProviders(
  ui: ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>,
) {
  return render(ui, { wrapper: AllProviders, ...options });
}

/**
 * Mock user data for tests
 */
export const mockUser = {
  id: 'user-1',
  email: 'test@test.com',
  firstName: 'John',
  lastName: 'Doe',
  role: 'ADMIN',
  tenantId: 'tenant-1',
};

/**
 * Mock auth tokens
 */
export const mockAuthTokens = {
  accessToken: 'mock-access-token',
  refreshToken: 'mock-refresh-token',
};

/**
 * Mock localStorage
 */
export function mockLocalStorage() {
  const store: Record<string, string> = {};

  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      Object.keys(store).forEach((key) => delete store[key]);
    },
    get length() {
      return Object.keys(store).length;
    },
    key: (index: number) => Object.keys(store)[index] || null,
  };
}

/**
 * Mock API response helper
 */
export function mockApiResponse<T>(data: T, delay: number = 0): Promise<T> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(data), delay);
  });
}

/**
 * Mock API error helper
 */
export function mockApiError(
  message: string = 'API Error',
  status: number = 500,
  delay: number = 0,
): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => {
      reject({
        response: {
          data: { message, statusCode: status },
          status,
        },
      });
    }, delay);
  });
}

/**
 * Mock product data
 */
export const mockProduct = {
  id: 'product-1',
  name: 'Test Product',
  description: 'Test description',
  price: 10.99,
  categoryId: 'category-1',
  category: {
    id: 'category-1',
    name: 'Test Category',
  },
  available: true,
  stockQuantity: 100,
};

/**
 * Mock order data
 */
export const mockOrder = {
  id: 'order-1',
  orderNumber: 'ORD-001',
  type: 'DINE_IN',
  status: 'PENDING',
  totalAmount: 50.0,
  items: [],
  createdAt: new Date().toISOString(),
};

/**
 * Create mock file for file upload testing
 */
export function createMockFile(
  name: string = 'test.png',
  size: number = 1024,
  type: string = 'image/png',
): File {
  const file = new File(['test'], name, { type });
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

// Re-export everything from testing library
export * from '@testing-library/react';
export { default as userEvent } from '@testing-library/user-event';
