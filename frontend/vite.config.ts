import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// En desarrollo, si VITE_BACKEND_URL está vacío, Axios usa /api y este proxy reenvía al Go local.
// Definir VITE_DEV_PROXY_TARGET en .env.development.local si el API no está en :3000.
const devBackend = process.env.VITE_DEV_PROXY_TARGET || 'http://127.0.0.1:3000'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // Algunos hosts (p. ej. nginx sin mime.types para .mjs) sirven *.mjs como
        // application/octet-stream y el worker de PDF.js deja de cargar.
        assetFileNames: (assetInfo) => {
          const name = assetInfo.name ?? '';
          if (name.endsWith('.mjs')) {
            return 'assets/[name]-[hash].js';
          }
          return 'assets/[name]-[hash][extname]';
        },
      },
    },
  },
  server: {
    port: 5174,
    strictPort: false,
    proxy: {
      '/api': {
        target: devBackend,
        changeOrigin: true,
      },
      '/storage': {
        target: devBackend,
        changeOrigin: true,
      },
    },
  },
})
