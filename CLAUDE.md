# ERP ZContable — notas para Claude Code

ERP para un estudio contable (Arequipa, Perú). Backend Go (`backend/`, módulo
`miappfiber`), frontend React + Vite + TypeScript + Tailwind (`frontend/`),
MySQL. Ver `README.md` para arquitectura general y `docs/` para decisiones de
diseño (p. ej. `docs/diseno-estados-pdt601-pdt621-2026-09-16.md`).

## Despliegues — dos ambientes totalmente separados

Este proyecto tiene DOS formas de desplegar, con mecanismos distintos. No mezclar.

### 1. Producción — vía GitHub Actions, disparado por `git push`

- **Nunca hacer `git push` (a ninguna rama, especialmente `main`) sin autorización
  explícita del usuario para ESE push puntual.** Commitear en local siempre está
  bien; pushear no, salvo que el usuario lo pida en ese momento ("sí, haz push",
  etc.). Que el usuario diga "commitea y sigue" no autoriza el push.
- Por qué: `.github/workflows/deploy.yml` corre en cada push a `main`, entra por
  SSH al VPS de producción, hace `git reset --hard origin/main`, reconstruye las
  imágenes Docker (frontend/backend) y reinicia el stack (`docker compose up -d`).
  No hay ningún gate de aprobación manual — el push ES el deploy.
- VPS de producción: stack Docker completo (traefik, mysql, backend, frontend) en
  `/docker/erp-zcontable`. Acceso SSH de diagnóstico: alias `vps-zcontable` en
  `~/.ssh/config` (si existe en esta máquina). Tratar como solo-diagnóstico —
  confirmar con el usuario antes de cualquier cambio manual ahí.

### 2. VPS de pruebas — deploy directo, sin GitHub, vía script

- VPS de pruebas separado (CloudPanel, sin integración con GitHub — no hay push
  ni Actions de por medio). Dos "sitios" CloudPanel en el mismo VPS:
  - **Backend**: usuario `gestionweb-zcontable`, ruta
    `/home/gestionweb-zcontable/htdocs/zcontable.gestionweb.cloud`, corre como
    servicio systemd (`zcontable`).
  - **Frontend**: usuario `gestionweb-zcontables`, ruta
    `/home/gestionweb-zcontables/htdocs/zcontables.gestionweb.cloud`, estático
    (build de Vite servido directo).
- El deploy es **[`scripts/deploy-staging.sh`](scripts/deploy-staging.sh)**:
  compila el backend en Go para `linux/amd64`, compila el frontend
  (`npm run build`), sube el binario nuevo por `scp`, lo reinicia con
  `sudo systemctl restart zcontable` (sudo acotado — el usuario del sitio SOLO
  puede correr ese comando exacto sin contraseña, nada más), y sube `dist/`
  completo al sitio del frontend.
- **Trampa real ya encontrada (2026-09-22):** `frontend/.env` trae
  `VITE_BACKEND_URL=https://api.zcontables.net` (producción) como valor por
  defecto — Vite hornea esa variable AL COMPILAR, así que un `npm run build` sin
  overridearla deja el frontend de pruebas hablando con el backend de
  **producción** (mismo dominio de datos, aunque el sitio estático esté en
  `zcontables.gestionweb.cloud`). El script ya fija
  `VITE_BACKEND_URL=https://zcontable.gestionweb.cloud` como variable de entorno
  real antes del build (eso sí pisa el `.env`) y aborta si no logra confirmar,
  por `grep` sobre el bundle compilado, que la URL correcta quedó incluida. Si
  se toca ese paso del script, no perder esa verificación — el fallo es
  silencioso (compila y despliega bien, solo apunta a los datos equivocados).
- Requiere en esta máquina: hosts `vps-zcontable-staging-backend` y
  `vps-zcontable-staging-frontend` en `~/.ssh/config`, con la clave dedicada
  `~/.ssh/id_ed25519_zcontable_staging` (separada de la de producción). Si una
  sesión nueva no encuentra esos alias, no están configurados en esa máquina —
  pedirle los datos al usuario en vez de asumir o reusar la clave de producción.
- **Igual que producción: nunca correr `scripts/deploy-staging.sh` salvo que el
  usuario lo pida explícitamente en ese momento** (frase acordada: "despliega a
  pruebas"). No es automático ni se dispara por commits/push.
- Este deploy es completamente independiente del de producción: no toca git, no
  hace push, no afecta el VPS de producción. Sirve para validar cambios antes de
  decidir si se autoriza el push a `main`.
