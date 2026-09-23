#!/usr/bin/env bash
# Deploy directo al VPS de pruebas (CloudPanel, sin GitHub) — sube el binario de Go
# compilado en local y el build del frontend, y reinicia el servicio del backend.
#
# NO toca la rama git ni hace push — esto es completamente independiente del
# despliegue de producción (que sigue siendo: push a main -> GitHub Actions).
#
# Requiere: los hosts "vps-zcontable-staging-backend" y
# "vps-zcontable-staging-frontend" configurados en ~/.ssh/config, y la regla de
# sudo acotada ya instalada en el servidor (systemctl restart zcontable).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="$REPO_ROOT/backend"
FRONTEND_DIR="$REPO_ROOT/frontend"

BACKEND_HOST="vps-zcontable-staging-backend"
BACKEND_PATH="/home/gestionweb-zcontable/htdocs/zcontable.gestionweb.cloud"
BACKEND_BIN_NAME="zcontable"

FRONTEND_HOST="vps-zcontable-staging-frontend"
FRONTEND_PATH="/home/gestionweb-zcontables/htdocs/zcontables.gestionweb.cloud"
# frontend/.env trae VITE_BACKEND_URL apuntando a producción (api.zcontables.net) como default —
# Vite hornea esa variable en el build, así que sin este override el frontend de pruebas queda
# hablando con el backend de PRODUCCIÓN (bug real detectado 2026-09-22: el sitio de pruebas
# mostraba datos de producción). Como variable de entorno real, esto SÍ pisa lo que diga .env.
STAGING_BACKEND_URL="https://zcontable.gestionweb.cloud"

SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=10)

log() { echo; echo "==> $*"; }

log "[0/6] Verificando conexión SSH a los dos sitios..."
ssh "${SSH_OPTS[@]}" "$BACKEND_HOST" "true" || { echo "No se pudo conectar a $BACKEND_HOST"; exit 1; }
ssh "${SSH_OPTS[@]}" "$FRONTEND_HOST" "true" || { echo "No se pudo conectar a $FRONTEND_HOST"; exit 1; }
echo "    ok"

log "[1/6] Compilando backend (linux/amd64)..."
BUILD_TMP="$(mktemp -d)"
BUILD_OUT="$BUILD_TMP/$BACKEND_BIN_NAME"
(cd "$BACKEND_DIR" && GOOS=linux GOARCH=amd64 go build -o "$BUILD_OUT" .)
echo "    listo: $(du -h "$BUILD_OUT" | cut -f1)"

log "[2/6] Compilando frontend (npm run build, API = $STAGING_BACKEND_URL)..."
(cd "$FRONTEND_DIR" && VITE_BACKEND_URL="$STAGING_BACKEND_URL" npm run build)
if ! grep -q "$STAGING_BACKEND_URL" "$FRONTEND_DIR"/dist/assets/index-*.js 2>/dev/null; then
  echo "    ERROR: el build no quedó apuntando a $STAGING_BACKEND_URL — abortando antes de subir nada."
  exit 1
fi
echo "    listo: $FRONTEND_DIR/dist (confirmado: apunta a $STAGING_BACKEND_URL)"

log "[3/6] Subiendo binario nuevo al backend..."
scp "${SSH_OPTS[@]}" -q "$BUILD_OUT" "$BACKEND_HOST:$BACKEND_PATH/${BACKEND_BIN_NAME}.new"
ssh "${SSH_OPTS[@]}" "$BACKEND_HOST" \
  "mv '$BACKEND_PATH/${BACKEND_BIN_NAME}.new' '$BACKEND_PATH/$BACKEND_BIN_NAME' && chmod +x '$BACKEND_PATH/$BACKEND_BIN_NAME'"
echo "    ok"

log "[4/6] Reiniciando servicio backend (sudo acotado)..."
ssh "${SSH_OPTS[@]}" "$BACKEND_HOST" "sudo -n systemctl restart $BACKEND_BIN_NAME"
sleep 2
if ssh "${SSH_OPTS[@]}" "$BACKEND_HOST" "pgrep -x $BACKEND_BIN_NAME >/dev/null"; then
  echo "    proceso corriendo ✓"
else
  echo "    ADVERTENCIA: no se detecta el proceso '$BACKEND_BIN_NAME' corriendo tras el reinicio."
  exit 1
fi

log "[5/6] Subiendo frontend (dist/ completo)..."
ssh "${SSH_OPTS[@]}" "$FRONTEND_HOST" "rm -rf '$FRONTEND_PATH/assets'"
tar -czf - -C "$FRONTEND_DIR/dist" . | ssh "${SSH_OPTS[@]}" "$FRONTEND_HOST" "tar -xzf - -C '$FRONTEND_PATH'"
echo "    ok"

rm -rf "$BUILD_TMP"

log "[6/6] Deploy a pruebas completo."
echo "    Backend:  https://zcontable.gestionweb.cloud"
echo "    Frontend: https://zcontables.gestionweb.cloud"
