/// <reference types="vitest" />
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Whether `TRUSTYTRACK_HTTP_ONLY` was set for this dev server (#742).
 *
 * `env` is whatever `loadEnv(mode, cwd, '')` returned below, not
 * `process.env` directly — `HTTPS_SERVER` already reads that way, and it is
 * what lets a test call this with a plain object and no environment
 * mutation. `run_dev.sh`'s own HTTP-only branch needs no `VITE_`-prefixed
 * mirror or explicit `export`: `TRUSTYTRACK_HTTP_ONLY=1 ./scripts/run_dev.sh`
 * puts the variable in that script's own environment, which `npm run dev`
 * inherits as a plain child process, and `loadEnv`'s empty prefix merges all
 * of `process.env` in rather than only `VITE_`-prefixed names.
 *
 * Mirrors `run_dev.sh`'s own case-insensitive `1|true|yes|on` test, so the
 * two cannot disagree about what counts as "set."
 */
export function httpOnlyRequested(env: Record<string, string | undefined>): boolean {
  return /^(1|true|yes|on)$/i.test(env.TRUSTYTRACK_HTTP_ONLY ?? '');
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Load env file based on `mode` in the current working directory.
  // Set the third parameter to '' to load all env regardless of the `VITE_` prefix.
  const env = loadEnv(mode, process.cwd(), '');
  const isHttps = env.HTTPS_SERVER === 'true';
  // `run_dev.sh`'s HTTP-only branch starts only the `:5173` frontend and
  // deliberately skips the `:5174` HTTPS variant — there is no backend
  // certificate left for it to proxy to. The redirect plugin below used to
  // be gated on `isHttps` alone, so it kept 301-ing every `:5173` request to
  // a `:5174` nothing was listening on (#742).
  const httpOnly = httpOnlyRequested(env);


  return {
    plugins: [
      react(),
      // Redirect HTTP (5173) to HTTPS (5174)
      !isHttps && !httpOnly && {
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
          target: env.VITE_BACKEND_URL || 'http://localhost:8005',
          changeOrigin: true,
          secure: env.VITE_BACKEND_SECURE === 'true',
          ws: true,
          rewrite: (path) => path.replace(/^\/api/, ''),
        },
        '/graphql': {
          target: env.VITE_BACKEND_URL || 'http://localhost:8005',
          changeOrigin: true,
          secure: env.VITE_BACKEND_SECURE === 'true',
        },
        '/ws': {
          target: env.VITE_BACKEND_URL || 'http://localhost:8005',
          changeOrigin: true,
          secure: env.VITE_BACKEND_SECURE === 'true',
          ws: true,
        },
        '/static': {
          target: env.VITE_BACKEND_URL || 'http://localhost:8005',
          changeOrigin: true,
          secure: env.VITE_BACKEND_SECURE === 'true',
        },
        '/upload': {
          target: env.VITE_BACKEND_URL || 'http://localhost:8005',
          changeOrigin: true,
          secure: env.VITE_BACKEND_SECURE === 'true',
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
