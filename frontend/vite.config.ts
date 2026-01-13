import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

const host = process.env.TAURI_DEV_HOST;

// https://vitejs.dev/config/
export default defineConfig({
  // Use /app/ base path for web builds, but keep root for Tauri desktop
  base: process.env.TAURI_PLATFORM ? '/' : '/app/',
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },

  // Tauri expects a fixed port, fail if that port is not available
  server: {
    port: 5173,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 5173,
        }
      : undefined,
    proxy: {
      '/api': {
        target: process.env.VITE_API_URL || 'http://localhost:3000',
        changeOrigin: true,
      },
      '/uploads': {
        target: process.env.VITE_API_URL || 'http://localhost:3000',
        changeOrigin: true,
      },
      '/socket.io': {
        target: process.env.VITE_WS_URL || 'http://localhost:3000',
        changeOrigin: true,
        ws: true,
      },
    },
  },

  // Prevent vite from obscuring rust errors
  clearScreen: false,

  // Environment variables
  envPrefix: ['VITE_', 'TAURI_'],

  build: {
    // Tauri uses Chromium on Windows and WebKit on macOS and Linux
    // For web builds (non-Tauri), use modern target that supports BigInt
    target: process.env.TAURI_PLATFORM == 'windows'
      ? 'chrome105'
      : process.env.TAURI_PLATFORM
        ? 'safari13'
        : 'es2020',
    // Don't minify for debug builds
    minify: !process.env.TAURI_DEBUG ? 'esbuild' : false,
    // Always produce sourcemaps for Sentry error tracking
    // 'hidden' means source maps are generated but not referenced in the bundle
    // This keeps them available for error reporting tools while hiding them from users
    sourcemap: process.env.NODE_ENV === 'production' ? 'hidden' : true,
    rollupOptions: {
      // Mark Tauri plugins as external for web builds
      // These are only available in Tauri desktop environment
      external: process.env.TAURI_PLATFORM ? [] : [
        '@tauri-apps/plugin-updater',
        '@tauri-apps/plugin-process',
      ],
    },
  },
});
