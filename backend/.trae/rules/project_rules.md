# Reglas de desarrollo del proyecto (MiWeb)

## Objetivo de migración

- Estado actual: migración completada.
- Go es backend puro: solo API REST (`/api/**`) + archivos estáticos del sistema (`/storage/**`).
- React (Vite + TS) es el único frontend: consume el API REST del backend usando Bearer token.
- Mantener el mismo diseño (Tailwind) del frontend actual; evitar introducir estilos “nuevos” por pantalla.

## Arquitectura general (regla #0)

- Sistema desacoplado:
  - Backend (Go + Fiber v3): API REST, JSON.
  - Frontend (React + Vite + TS): consume API, UI idéntica a la actual.
- Estructura esperada de alto nivel:
  - Raíz Go actual (backend): API REST.
  - `frontend-react/` (frontend).
- Prohibición funcional:
  - Nuevas funcionalidades deben implementarse como endpoints `/api/**` consumidos por React.
  - No agregar rutas web HTML ni templates en Go (no `Render`, no `views/**`).
  - Evitar rutas fuera de `/api/**` salvo `GET /storage/**` (archivos) y rutas técnicas (ej: healthcheck) si se agregan.

## Paridad funcional (regla #1)

- La referencia funcional es el frontend React actual y los endpoints del backend.
- No se considera “completo” un módulo si falta algún detalle del comportamiento (filtros, confirmaciones, estados vacíos, permisos por rol).
- Antes de implementar/modificar una pantalla:
  - Revisar la pantalla existente en `frontend-react/src/pages/**` y los layouts en `frontend-react/src/layouts/**`.
  - Revisar endpoints en `routes/routes.go`, handlers en `controllers/**` y reglas en `services/**`.

## Consistencia visual (regla #2)

- La fuente de verdad del diseño actual es el frontend React:
  - Layout: [Layout.tsx](file:///d:/goprojects/miweb/frontend-react/src/layouts/Layout.tsx), [Header.tsx](file:///d:/goprojects/miweb/frontend-react/src/layouts/Header.tsx), [Sidebar.tsx](file:///d:/goprojects/miweb/frontend-react/src/layouts/Sidebar.tsx).
- React debe replicar:
  - Layout general (Sidebar + Header + contenedor principal).
  - Tipografías, colores, tamaños, paddings, bordes redondeados, sombras, estados hover/active.
  - Componentes visuales clave: barra de búsqueda del header, dropdown de usuario, tablas, pills/badges, botones redondeados.
- Tailwind:
  - Mantener la paleta `primary.*` definida en Tailwind (React).
  - No “re-interpretar” colores: usar las clases existentes (`bg-primary-600`, etc.) de forma consistente.
- Iconos:
  - Mantener FontAwesome y usar íconos/clases consistentes en todo el frontend.
- Patrón de vistas (React):
  - Respetar el patrón de diseño de otras vistas ya implementadas (misma estructura de header, tarjetas, tablas, estados de carga/vacío).
  - Evitar “diseños nuevos” para una sola pantalla; extraer componentes cuando se repitan.

## Mapa de rutas (React) → endpoints (API)

Fuente: [routes.go](file:///d:/goprojects/miweb/routes/routes.go).

- Autenticación
  - React: `/login` → `POST /api/login` (token + role en cliente)
  - React: `/logout` → limpiar token en cliente (opcional: llamar `GET /api/logout`)
- Dashboard
  - React: `/dashboard` → consumir `GET /api/dashboard`
- Empresas
  - Listado: `/companies` → `GET /api/companies?q=&status=`
  - Form: `/companies/new`, `/companies/:id/edit` → `POST/PUT /api/companies`
  - Estado de cuenta: `/companies/:id/statement` → `GET /api/companies/:id/statement`
  - Contactos: `/companies/:companyID/contacts` (+ new/edit) → `/api/companies/:companyID/contacts`
- Documentos
  - Listado: `/documents` → `GET /api/documents?company_id=&status=`
  - Form: `/documents/new`, `/documents/:id/edit` → `POST/PUT /api/documents`
  - Sincronizar Tukifac: botón → `POST /api/documents/sync-tukifac`
- Pagos
  - Listado: `/payments` → `GET /api/payments?company_id=&document_id=`
  - Form: `/payments/new`, `/payments/:id/edit` → `POST/PUT /api/payments`
  - Comprobante (archivo): `POST /api/payments/upload-attachment` (retorna URL en `/storage/**`)
- Reportes
  - React: `/reports/financial` debe replicar el mismo resumen y tabla por empresa
- Configuración
  - React: `/settings/firm` → `GET/PUT /api/firm-config` y `POST /api/firm-config/logo`
- Usuarios y roles
  - React: `/users` (+ new/edit) → `/api/users` (solo Administrador)

## Arquitectura backend (Go)

- Mantener capas:
  - `controllers/`: HTTP (parseo/validación superficial, status codes, JSON).
  - `services/`: reglas de negocio, validación, transacciones, acceso a DB vía GORM.
  - `models/`: entidades y serialización JSON.
  - `middleware/`: auth y autorización.
- SOLID:
  - Controladores delgados: no duplicar reglas de negocio.
  - Validaciones en servicios; controladores solo traducen errores a HTTP.
- Backend puro:
  - Solo endpoints `/api/**` (y `/storage/**` para archivos).
  - No cookies: la UI usa `Authorization: Bearer <token>`.
  - Fiber v3: `app.Static()` no existe; para archivos usar `github.com/gofiber/fiber/v3/middleware/static`.

## Arquitectura backend objetivo (Clean-ish, incremental)

- Objetivo de estructura (sin refactor “big bang”):
  - `internal/handlers` (equivalente a controllers HTTP)
  - `internal/services`
  - `internal/repositories`
  - `internal/models`
  - `internal/middleware`
  - `internal/routes`
- Reglas:
  - Handlers: parseo/validación superficial, HTTP status codes, serialización JSON.
  - Services: lógica de negocio y validación; no dependen del framework web.
  - Repositories: acceso a datos (GORM/SQL); no contienen reglas de negocio.
  - Models: entidades + serialización (`json:"..."`) + validaciones estructurales mínimas si aplica.
  - Middleware: auth/roles y concerns transversales.
- Principios:
  - Separation of Concerns, SOLID, dependencias apuntan hacia adentro (handlers → services → repositories).
  - No mezclar lógica de negocio en handlers.
  - Evitar “service que devuelve fiber.Ctx” o “repository que decide status HTTP”.

## Estándar del API REST (regla #3)

### Endpoints existentes (actuales)

Fuente: [routes.go](file:///d:/goprojects/miweb/routes/routes.go).

- Auth
  - `POST /api/login` (público)
  - `GET /api/logout` (protegido; stateless)
- Dashboard
  - `GET /api/dashboard`
- Config
  - `GET /api/firm-config`
  - `PUT /api/firm-config`
  - `POST /api/firm-config/logo` (multipart `file`)
- Companies
  - `GET /api/companies?q=&status=`
  - `GET /api/companies/:id`
  - `GET /api/companies/:id/statement`
  - `POST /api/companies`
  - `PUT /api/companies/:id`
  - `DELETE /api/companies/:id`
- Contacts
  - `GET /api/companies/:companyID/contacts`
  - `POST /api/companies/:companyID/contacts`
  - `PUT /api/companies/:companyID/contacts/:id`
  - `DELETE /api/companies/:companyID/contacts/:id`
- Documents
  - `GET /api/documents?company_id=&status=`
  - `GET /api/documents/:id`
  - `POST /api/documents`
  - `PUT /api/documents/:id`
  - `DELETE /api/documents/:id`
  - `POST /api/documents/sync-tukifac`
- Payments
  - `GET /api/payments?company_id=&document_id=`
  - `GET /api/payments/:id`
  - `POST /api/payments`
  - `PUT /api/payments/:id`
  - `DELETE /api/payments/:id`
  - `POST /api/payments/upload-attachment` (multipart `file`)
- Users
  - `GET /api/users`
  - `GET /api/users/:id`
  - `POST /api/users`
  - `PUT /api/users/:id`
  - `DELETE /api/users/:id`
- Reports
  - `GET /api/reports/financial` (resumen global)

### Respuestas JSON (consistencia)

- Regla práctica para migración: no romper consumidores existentes, pero todas las nuevas rutas o refactors deben converger al mismo formato.
- Formato objetivo (estandarizado) para endpoints nuevos o refactors:
  - Éxito:
    - `{ "success": true, "data": <obj|array|null>, "message": "" }`
  - Error:
    - `{ "success": false, "error": "mensaje_en_español" }`
- Compatibilidad:
  - Mientras existan endpoints que respondan como `{ "data": [...] }` o “array plano”, React debe normalizar respuestas en su capa de API/servicios para mantener consistencia interna sin cambiar el backend de golpe.
- Status codes:
  - `200` GET ok, `201` created, `400` validación/entrada inválida, `401` no autenticado, `403` sin permisos, `404` no encontrado.
- Validación:
  - Rechazar entradas inválidas con `400` y mensaje útil (sin filtrar información sensible).
  - Mantener reglas actuales definidas en `services/**` (ej: no eliminar empresas con documentos/pagos).

### Convenciones REST (recursos, filtros, paginación)

- Recursos y convenciones:
  - `GET /api/<resource>` lista
  - `GET /api/<resource>/:id` detalle
  - `POST /api/<resource>` crear
  - `PUT /api/<resource>/:id` reemplazo/actualización completa (o `PATCH` si se introduce parcial)
  - `DELETE /api/<resource>/:id` eliminar
- Filtros y búsqueda:
  - Usar query params claros (ej: `?q=`, `?status=`, `?company_id=`).
  - Mantener equivalencia con filtros existentes en vistas Go.
- Ordenamiento y paginación (cuando aplique):
  - `?page=1&per_page=20`
  - `?sort=created_at&order=desc`
  - Si se implementa, documentar en el handler y reflejarlo en React con URLs compartibles.
- Consistencia de IDs:
  - IDs numéricos: `:id` y nombres como `company_id` en query params.

### Seguridad (API)

- Nunca loguear tokens/headers de Authorization.
- No devolver trazas internas en errores; mapear a mensajes útiles en español.
- Validar autorización en backend aunque React oculte botones.

### Autenticación / Autorización

- Bearer Token / JWT es el estándar para todo `/api/**` (no cookies).
  - Middleware actual: `middleware.JWTProtected()` valida `Authorization: Bearer <token>`.
- Roles:
  - Respetar `middleware.RequireRole(...)` también en API.
  - En React, ocultar acciones según rol, pero asumir que el backend es la autoridad final.
- Recomendación de continuidad:
  - Incluir `role` en la respuesta de `POST /api/login` para que React pueda renderizar menús/acciones con paridad del web actual.

## Arquitectura frontend (React)

- Estructura actual:
  - `src/layouts/` (Layout, Sidebar, Header)
  - `src/pages/` (pantallas)
  - `src/api/` (cliente HTTP)
  - `src/types/` (tipos compartidos)
- Reglas:
  - Layout reutilizable (ya existe) es obligatorio: todas las páginas protegidas renderizan dentro de `Layout`.
  - Las páginas no deben “adivinar” diseño: seguir el patrón de las páginas React ya implementadas (mismas clases Tailwind y estructura).
  - Evitar mocks: reemplazar por consumo real del API antes de considerar “migrada” la pantalla.
  - Evitar filtros solo en memoria si en Go existen filtros server-side con query params; mantener URLs compartibles.
- Tipado:
  - Tipar respuestas del API de forma fiel (ej: listados vienen en `{data: ...}`).
  - Si una respuesta viene en PascalCase (ej: `DashboardData`), respetarlo hasta que el backend se estandarice.

## Arquitectura frontend objetivo (carpetas y separación)

- Estructura objetivo (sin obligar un refactor inmediato):
  - `src/components/` UI reutilizable (Table, Card, Modal, Form, Badge, EmptyState, etc.)
  - `src/pages/` pantallas (composición)
  - `src/layouts/` Layout/Sidebar/Header
  - `src/services/` capa API (funciones por recurso)
  - `src/hooks/` hooks reutilizables (ej: `useCompanies`, `useDebouncedValue`)
  - `src/utils/` helpers (formatos de fecha/monto, normalizadores)
  - `src/routes/` definición de rutas si se separa del App
- Reglas:
  - Las páginas no deben llamar axios directamente si ya existe capa `api/` o `services/`; centralizar llamadas para consistencia de errores y auth.
  - Separar UI (componentes presentacionales) de lógica (hooks/servicios) cuando la pantalla crezca.
  - Evitar estado duplicado: fuente de verdad única por pantalla/hook.

## UX (reglas de experiencia)

- Estados obligatorios por pantalla:
  - Loading visible (skeleton/spinner) mientras se consulta el API.
  - Estado vacío con texto equivalente a la vista Go cuando no hay datos.
  - Error visible y accionable (mensaje + opción de reintentar cuando aplique).
- Acciones críticas:
  - Confirmación obligatoria antes de eliminar (y mantener los mismos textos del sistema actual).
  - Feedback posterior (éxito/error) sin depender solo de `console.log`.
- Acciones asincrónicas:
  - Deshabilitar botones mientras se ejecuta la acción (ej: “Sincronizar Tukifac”).
  - Evitar dobles submits.
- Navegación:
  - Mantener rutas y labels consistentes con el sistema actual.
  - En pantallas con filtros, reflejar filtros en la URL cuando sea razonable.

## Reglas de continuidad (implementación incremental)

- Orden recomendado por dependencias:
  1. Auth (login/logout) + manejo de token
  2. Header: búsqueda de empresas usando `GET /api/companies?q=`
  3. CRUD Empresas + Estado de cuenta + Contactos
  4. CRUD Documentos + Sync Tukifac
  5. CRUD Pagos
  6. Reportes financieros (resumen + detalle por empresa)
  7. Configuración del estudio
  8. Usuarios y roles
- Si una vista Go usa datos combinados (ej: Reporte financiero con filas por empresa), y el API aún no lo expone:
  - Crear endpoint específico en Go que entregue exactamente lo necesario para esa pantalla.
  - Mantener naming claro y REST (ej: `GET /api/reports/financial/detail` o ampliar `GET /api/reports/financial` con `?include=companies`).

## Reglas de datos y formato (paridad de UI)

- Fechas:
  - Mostrar como `YYYY-MM-DD` (equivalente a `Format "2006-01-02"` de Go).
- Montos:
  - Mantener el mismo símbolo y formato que en las vistas Go (por defecto `$` y 2 decimales).
- Textos:
  - Mantener los textos en español exactamente como en el frontend actual.
  - Confirmaciones: usar los mismos mensajes (ej: “¿Eliminar este pago?”).

## Convenciones de desarrollo (backend y frontend)

- Go:
  - Nombres en inglés (structs/funciones/variables), mensajes al usuario en español.
  - `PascalCase` para structs/exportados, `camelCase` para variables y no exportados.
  - Evitar duplicar validación en controller/handler si ya existe en service.
- React/TS:
  - Componentes: `PascalCase.tsx` (ej: `CompanyTable.tsx`).
  - Hooks: `useX.ts` (ej: `useCompanies.ts`).
  - Tipos: `src/types/*.ts`, reusar tipos existentes y evitar duplicados.
  - Eventos y handlers: prefijo `handle` (ej: `handleDelete`, `handleSubmit`).
  - No introducir CSS inline innecesario; usar Tailwind y clases consistentes.
- Calidad (frontend-react):
  - Usar scripts existentes: `npm run lint` y `npm run build` (TypeScript) antes de cerrar un cambio relevante.

## Operación local (desarrollo)

- Backend Go corre en `:3000` por defecto (config `PORT`).
- Frontend React (Vite) corre en otro puerto; para evitar CORS y hardcodes:
  - Preferir baseURL relativo (`/api`) y configurar proxy de Vite o CORS en Go.
  - Evitar URLs absolutas hardcodeadas en el cliente.
- Archivos:
  - Backend sirve archivos del sistema desde `GET /storage/**` (logo, comprobantes, etc.).
  - En desarrollo, el frontend puede proxyear `/storage` igual que `/api`.
