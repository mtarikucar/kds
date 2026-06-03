import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Tauri's dev server expects a fixed port + auto-launches the browser shell.
// Build output goes to `dist/` which `tauri.conf.json` references as
// frontendDist.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1421,
    strictPort: true,
  },
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    target: ['es2020'],
    minify: 'esbuild',
    sourcemap: false,
    outDir: 'dist',
  },
});
