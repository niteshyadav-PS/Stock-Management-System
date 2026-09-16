import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  // Load .env variables so we can use them inside the config itself
  const env = loadEnv(mode, process.cwd(), '');

  // Proxy target: VITE_API_URL (without /api) or fallback to localhost:5000
  const backendTarget = env.VITE_API_URL || 'http://localhost:5000';

  return {
    plugins: [react()],

    // ── Dev server ───────────────────────────────────────────────────────────
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: backendTarget,
          // changeOrigin: true,
          secure: false,
          configure: (proxy) => {
            proxy.on('error', (err) => {
              console.log('[proxy error]', err.message);
            });
          },
        },
      },
    },

    // ── Production build ─────────────────────────────────────────────────────
    build: {
      outDir: 'dist',
      sourcemap: false,        // disable sourcemaps in production for security
      chunkSizeWarningLimit: 600,
      rollupOptions: {
        output: {
          // Split vendor bundle so the app chunk stays small
          manualChunks: {
            react:  ['react', 'react-dom', 'react-router-dom'],
            xlsx:   ['xlsx'],
            axios:  ['axios'],
          },
        },
      },
    },

    // ── Preview server (vite preview after build) ────────────────────────────
    preview: {
      port: 4173,
      proxy: {
        '/api': {
          target: backendTarget,
          changeOrigin: true,
          secure: false,
        },
      },
    },
  };
});
