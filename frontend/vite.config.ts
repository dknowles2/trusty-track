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
    plugins: [
      react(),
      // Redirect HTTP (5173) to HTTPS (5174)
      !isHttps && {
        name: 'redirect-to-https',
        configureServer(server) {
          server.middlewares.use((req, res, next) => {
            if (req.headers.host?.includes(':5173')) {
              const httpsHost = req.headers.host.replace(':5173', ':5174');
              res.writeHead(301, { Location: `https://${httpsHost}${req.url}` });
              res.end();
            } else {
              next();
            }
          });
        }
      }
    ].filter(Boolean),
    server: {
      port: isHttps ? 5174 : 5173,
      https: isHttps ? {
        key: '../certs/localhost-key.pem',
        cert: '../certs/localhost.pem',
      } : undefined,
      proxy: {
        '/api': {
          target: 'https://127.0.0.1:8000',
          changeOrigin: true,
          secure: false, 
          rewrite: (path) => path.replace(/^\/api/, ''),
        },
        '/ws': {
            target: 'wss://127.0.0.1:8000',
            ws: true,
            secure: false,
        },
        '/static': {
          target: 'https://127.0.0.1:8000',
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
