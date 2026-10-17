import { defineConfig } from 'vitest/config'
import { loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// En desarrollo, si VITE_BACKEND_URL está vacío, Axios usa /api y este proxy reenvía al Go local.
// Definir VITE_DEV_PROXY_TARGET en .env.development.local si el API no está en :3000.
const devBackend = process.env.VITE_DEV_PROXY_TARGET || 'http://127.0.0.1:3000'

/** PWA instalable: el manifest y los meta de instalación se inyectan en el HTML únicamente cuando el
 * build trae VITE_ENABLE_PWA=1. Lo define frontend/Dockerfile (producción: app "ZContable") y
 * scripts/deploy-staging.sh junto con VITE_PWA_VARIANT=demo (pruebas: app "ZContable Demo", con
 * nombre, ícono con cinta DEMO y color naranja distintos para no confundirla con la real). El
 * desarrollo (`npm run dev`) no lo define, así que no es instalable. */
function pwaHtml(enabled: boolean, variant: string): Plugin {
  const demo = variant === 'demo'
  return {
    name: 'zcontable-pwa-html',
    transformIndexHtml() {
      if (!enabled) return []
      return [
        { tag: 'link', attrs: { rel: 'manifest', href: demo ? '/manifest-demo.webmanifest' : '/manifest.webmanifest' }, injectTo: 'head' },
        { tag: 'meta', attrs: { name: 'theme-color', content: demo ? '#EA580C' : '#003786' }, injectTo: 'head' },
        {
          tag: 'link',
          attrs: { rel: 'apple-touch-icon', href: demo ? '/pwa/apple-touch-icon-demo.png' : '/pwa/apple-touch-icon.png' },
          injectTo: 'head',
        },
        { tag: 'meta', attrs: { name: 'mobile-web-app-capable', content: 'yes' }, injectTo: 'head' },
        { tag: 'meta', attrs: { name: 'apple-mobile-web-app-capable', content: 'yes' }, injectTo: 'head' },
        { tag: 'meta', attrs: { name: 'apple-mobile-web-app-title', content: demo ? 'ZContable Demo' : 'ZContable' }, injectTo: 'head' },
      ]
    },
  }
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), 'VITE_'), ...process.env }
  const enablePwa = env.VITE_ENABLE_PWA === '1'

  return {
    plugins: [react(), pwaHtml(enablePwa, env.VITE_PWA_VARIANT ?? '')],
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
