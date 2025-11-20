/**
 * E2E Test Setup
 * Runs before all E2E tests
 */

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.JWT_EXPIRES_IN = '1h';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
process.env.JWT_REFRESH_EXPIRES_IN = '7d';

// Increase timeout for E2E tests
jest.setTimeout(30000); // 30 seconds

// Global test utilities
global.beforeAll(() => {
  console.log('Starting E2E tests...');
});

global.afterAll(() => {
  console.log('E2E tests completed');
});
