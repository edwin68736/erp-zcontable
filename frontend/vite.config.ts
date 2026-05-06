import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Solo se usa si VITE_BACKEND_URL está vacío (Axios usa /api relativo → pasa por este proxy).
// Por defecto coincide con PORT=3000 del backend en .env de la raíz del proyecto.
const devBackend = process.env.VITE_DEV_PROXY_TARGET || 'http://127.0.0.1:3000'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
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
