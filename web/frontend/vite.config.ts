import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // Canonical i18n resources and domain constants live outside this app (ADR-018).
      '@shared': fileURLToPath(new URL('../../shared', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    // Allow importing from shared/ which sits above this package root.
    fs: { allow: ['..', '../../shared'] },
  },
});
