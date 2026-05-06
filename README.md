# ERP ZContable

Plataforma ERP en desarrollo para **ZContable**, orientada a la gestión integral de un **estudio contable** (clientes, facturación, contabilidad y operaciones internas según evolucione el producto).

## Estado del proyecto

El sistema está **en construcción** y en fases de **despliegue**. La interfaz y la API pueden cambiar; no usar en producción crítica hasta próximos releases estables.

## Arquitectura

| Capa        | Tecnología                          |
|------------|-------------------------------------|
| Frontend   | React (Vite), puerto interno 3000   |
| Backend    | Go (`net/http`), puerto interno 8080 |
| Base datos | MySQL 8                             |
| Proxy / TLS| Traefik (Let's Encrypt)             |

Orquestación con **Docker Compose**: servicios `frontend`, `backend`, `mysql` y `traefik`.

Dominios previstos en `docker-compose.yml` (ajustar DNS y correo ACME antes de producción):

- Web: `zcontables.net`
- API: `api.zcontables.net`

## Requisitos

- [Docker](https://docs.docker.com/get-docker/) y Docker Compose v2

## Puesta en marcha con Docker

Desde la raíz del repositorio:

```bash
docker compose up -d --build
```

Antes de producción, sustituir `TU_CORREO@gmail.com` en `docker-compose.yml` por el correo válido para Let's Encrypt.

## Desarrollo local (referencia)

- **Backend Go**: ejecutar desde `./backend` (por defecto escucha en `:8080`).
- **Frontend**: desde `./frontend`, `npm install` y `npm run dev` (ver `frontend/package.json`).

## Licencia y uso

Definir según política del estudio ZContable.
