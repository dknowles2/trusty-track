/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Load env file based on `mode` in the current working directory.
  // Set the third parameter to '' to load all env regardless of the `VITE_` prefix.
  const env = process.env;
  const isHttps = env.HTTPS_SERVER === 'true';

  return {
    plugins: [react()],
    server: {
      port: isHttps ? 5174 : 5173,
      https: isHttps ? {
        key: '../certs/localhost-key.pem',
        cert: '../certs/localhost.pem',
      } : undefined,
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:8000', // Always proxy to HTTP backend for simplicity
          changeOrigin: true,
          secure: false, 
          rewrite: (path) => path.replace(/^\/api/, ''),
        },
        '/ws': {
            target: 'ws://127.0.0.1:8000', // Always proxy to HTTP backend for simplicity
            ws: true,
            secure: false,
        },
        '/static': {
          target: 'http://127.0.0.1:8000',
          changeOrigin: true,
          secure: false,
        }
      },
    },
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: './src/setupTests.ts',
      exclude: ['**/node_modules/**', '**/dist/**', '**/e2e/**'],
    },
  };
})
