/* Service worker de ZContable (solo se registra en el build de producción, ver src/main.tsx).
 *
 * Existe únicamente para que el navegador ofrezca "Instalar aplicación" en todas las plataformas.
 * NO guarda nada en caché y NO intercepta peticiones: todo sigue yendo a la red como en la web
 * normal, así un deploy nuevo siempre se ve de inmediato y nunca queda un index.html viejo apuntando
 * a archivos con hash que ya no existen (la causa típica de "la página no carga" con una PWA).
 *
 * Si algún día hay que apagarla: quitar VITE_ENABLE_PWA del Dockerfile — el build deja de registrarla
 * y desregistra la que ya esté instalada en cada navegador. */

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Limpia cualquier caché que hubiera dejado un service worker anterior.
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

// Handler de fetch vacío a propósito: sin respondWith el navegador atiende la petición normalmente.
self.addEventListener('fetch', () => {});
