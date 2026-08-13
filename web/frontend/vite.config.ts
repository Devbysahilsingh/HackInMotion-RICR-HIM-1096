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
  build: {
    rollupOptions: {
      output: {
        /**
         * Vendor split.
         *
         * The framework and the translation resources change on a different
         * cadence from the app, and the target user is on a rural connection —
         * so a routine app deploy should not re-download React or 54KB of
         * disease strings. Charts are their own chunk because Recharts is the
         * single largest dependency and only two routes need it.
         */
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-query': ['@tanstack/react-query', 'axios'],
          'vendor-i18n': ['i18next', 'react-i18next', 'i18next-browser-languagedetector'],
          'vendor-forms': ['react-hook-form', '@hookform/resolvers', 'zod'],
          'vendor-charts': ['recharts'],
        },
      },
    },
  },
});
