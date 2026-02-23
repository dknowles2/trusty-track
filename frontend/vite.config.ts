/// <reference types="vitest" />
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Load env file based on `mode` in the current working directory.
  // Set the third parameter to '' to load all env regardless of the `VITE_` prefix.
  const env = loadEnv(mode, process.cwd(), '');
  const isHttps = env.HTTPS_SERVER === 'true';
  const isSecure = env.VITE_BACKEND_SECURE !== 'false';


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
      host: "0.0.0.0",
      port: isHttps ? 5174 : 5173,
      https: isHttps ? {
        key: '../certs/localhost-key.pem',
        cert: '../certs/localhost.pem',
      } : undefined,
      proxy: {
        '/api': {
          target: env.VITE_BACKEND_URL || 'https://localhost:8000',
          changeOrigin: true,
          secure: isSecure,
          ws: true,
          rewrite: (path) => path.replace(/^\/api/, ''),
        },
        '/ws': {
          target: env.VITE_BACKEND_URL || 'https://localhost:8000',
          changeOrigin: true,
          secure: isSecure,
          ws: true,
        },
        '/static': {
          target: env.VITE_BACKEND_URL || 'https://localhost:8000',
          changeOrigin: true,
          secure: isSecure,
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
