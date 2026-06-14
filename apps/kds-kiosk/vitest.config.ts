import { defineConfig } from 'vitest/config';

// Test runner config for the kiosk app. Tests cover pure helpers and the
// mesh/deviceToken modules (the latter via mocked global fetch and a mocked
// @tauri-apps/api/core). None of these need a DOM, so the lightweight `node`
// environment is used to keep the suite fast and dependency-free.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    globals: false,
  },
});
