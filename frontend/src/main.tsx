import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import '@fortawesome/fontawesome-free/css/all.min.css'

// PWA: el service worker mínimo (public/sw.js) solo se registra en el build de producción
// (VITE_ENABLE_PWA=1, definido en frontend/Dockerfile). En cualquier otro build se DESREGISTRA el que
// hubiera quedado en el navegador, para que pruebas/desarrollo nunca arrastren uno instalado.
if ('serviceWorker' in navigator) {
  if (import.meta.env.VITE_ENABLE_PWA === '1') {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => undefined)
    })
  } else {
    navigator.serviceWorker
      .getRegistrations()
      .then((regs) => regs.forEach((r) => void r.unregister()))
      .catch(() => undefined)
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
