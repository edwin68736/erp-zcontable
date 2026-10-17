import { defineConfig } from 'vitest/config'
import { loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// En desarrollo, si VITE_BACKEND_URL está vacío, Axios usa /api y este proxy reenvía al Go local.
// Definir VITE_DEV_PROXY_TARGET en .env.development.local si el API no está en :3000.
const devBackend = process.env.VITE_DEV_PROXY_TARGET || 'http://127.0.0.1:3000'

/** PWA solo en producción: el manifest y los meta de instalación se inyectan en el HTML únicamente
 * cuando el build trae VITE_ENABLE_PWA=1 (lo define frontend/Dockerfile, que es el build del VPS de
 * producción; el deploy a pruebas y el desarrollo no lo definen, así que no son instalables). */
function pwaHtml(enabled: boolean): Plugin {
  return {
    name: 'zcontable-pwa-html',
    transformIndexHtml() {
      if (!enabled) return []
      return [
        { tag: 'link', attrs: { rel: 'manifest', href: '/manifest.webmanifest' }, injectTo: 'head' },
        { tag: 'meta', attrs: { name: 'theme-color', content: '#003786' }, injectTo: 'head' },
        { tag: 'link', attrs: { rel: 'apple-touch-icon', href: '/pwa/apple-touch-icon.png' }, injectTo: 'head' },
        { tag: 'meta', attrs: { name: 'mobile-web-app-capable', content: 'yes' }, injectTo: 'head' },
        { tag: 'meta', attrs: { name: 'apple-mobile-web-app-capable', content: 'yes' }, injectTo: 'head' },
        { tag: 'meta', attrs: { name: 'apple-mobile-web-app-title', content: 'ZContable' }, injectTo: 'head' },
      ]
    },
  }
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), 'VITE_'), ...process.env }
  const enablePwa = env.VITE_ENABLE_PWA === '1'

  return {
    plugins: [react(), pwaHtml(enablePwa)],
    test: {
      environment: 'node',
      include: ['src/**/*.test.ts'],
    },
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
      port: Number(process.env.PORT) || 5174,
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
  }
})
