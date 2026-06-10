import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },

  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_API_URL?.replace(/\/api\/?$/, '') || 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },

  envPrefix: ['VITE_'],

  esbuild: {
    // Strip console.* and debugger in production builds (lead/commission
    // data is PII-adjacent; don't leave it in a shared browser console).
    drop: process.env.NODE_ENV === 'production' ? ['console', 'debugger'] : [],
  },

  build: {
    target: 'es2020',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (id.includes('i18next')) return 'i18n';
          if (id.includes('@tanstack')) return 'query';
          if (id.includes('react-hook-form') || id.includes('@hookform')) return 'form';
          if (id.includes('zod')) return 'zod';
          return 'vendor';
        },
      },
    },
    chunkSizeWarningLimit: 1000,
  },
});
