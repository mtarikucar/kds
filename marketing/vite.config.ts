import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// Standalone marketing SPA — served at the ROOT of marketing.hummytummy.com
// (host nginx routes 3200 → this container, /api → backend:3000). Hence
// base:'/', unlike the POS frontend which uses base:'/app/'.
export default defineConfig({
  base: '/',
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  envPrefix: ['VITE_'],
  server: {
    port: 5200,
    proxy: {
      '/api': {
        target: process.env.VITE_API_URL || 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  esbuild: {
    drop: process.env.NODE_ENV === 'production' ? ['console', 'debugger'] : [],
  },
  build: {
    target: 'es2020',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (id.includes('i18next')) return 'i18n';
          if (id.includes('@tanstack')) return 'query';
          if (id.includes('react-hook-form') || id.includes('@hookform') || id.includes('zod'))
            return 'form';
          if (id.includes('date-fns')) return 'date-fns';
          return 'vendor';
        },
      },
    },
  },
});
