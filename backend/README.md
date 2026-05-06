# MiWeb - Aplicación SaaS con Go y Fiber

Aplicación web moderna con arquitectura limpia: controladores, modelos, rutas, servicios y middleware. Incluye autenticación JWT, CRUD de productos y clientes, módulo de ventas y panel con TailwindCSS.

## Requisitos

- Go 1.21+
- MySQL 8.x (o MariaDB compatible)

## Estructura del proyecto

```
miweb/
├── config/           # Configuración y variables de entorno
├── controllers/      # Controladores HTTP (auth, dashboard, products, clients, sales)
├── database/         # Conexión, migraciones automáticas y seeds
├── middleware/       # JWT y protección de rutas
├── models/           # Modelos GORM (User, Product, Client, Sale, SaleItem)
├── routes/           # Definición de rutas
├── services/         # Lógica de negocio
├── views/            # Plantillas HTML (TailwindCSS)
│   ├── layouts/      # Layout base (sidebar, navbar)
│   ├── dashboard/
│   └── login.html
├── main.go
├── .env.example
└── README.md
```

## Cómo ejecutar en local

### 1. Clonar / entrar al proyecto

```bash
cd D:\goprojects\miweb
```

### 2. Crear base de datos en MySQL

```sql
CREATE DATABASE miweb_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

### 3. Configurar variables de entorno

Copia el ejemplo y edita con tu usuario y contraseña de MySQL:

```bash
copy .env.example .env
```

Edita `.env`:

```
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=tu_password_mysql
DB_NAME=miweb_db
JWT_SECRET=un-secreto-muy-seguro-cambiar-en-produccion
PORT=3000
```

### 4. Instalar dependencias y ejecutar

```bash
go mod download
go run main.go
```

La aplicación estará en **http://localhost:3000**.

- **Login (vista):** http://localhost:3000/login  
- **Dashboard (tras login):** http://localhost:3000/dashboard  
- **API (JSON):** prefijo `/api/` (ver más abajo)

### 5. Usuario de prueba (seed)

Tras la primera ejecución se crean datos de ejemplo. Para entrar al panel:

- **Email:** `admin@example.com`  
- **Contraseña:** `admin123`

## API REST

Todas las rutas bajo `/api/` (excepto `/api/login`) requieren cabecera:

```
Authorization: Bearer <token>
```

Obtener token:

```bash
curl -X POST http://localhost:3000/api/login \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"admin@example.com\",\"password\":\"admin123\"}"
```

### Endpoints

| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | /api/login | Login (email, password) → token |
| GET  | /api/logout | Cerrar sesión (simbólico) |
| GET  | /api/products | Listar productos (paginado: ?page=1&limit=10) |
| GET  | /api/products/:id | Obtener producto |
| POST | /api/products | Crear producto |
| PUT  | /api/products/:id | Actualizar producto |
| DELETE | /api/products/:id | Eliminar producto |
| GET  | /api/clients | Listar clientes |
| GET  | /api/clients/:id | Obtener cliente |
| POST | /api/clients | Crear cliente |
| PUT  | /api/clients/:id | Actualizar cliente |
| DELETE | /api/clients/:id | Eliminar cliente |
| GET  | /api/sales | Listar ventas (paginado) |
| GET  | /api/sales/:id | Obtener venta con ítems |
| POST | /api/sales | Crear venta (client_id, items[]) |

### Ejemplo: crear venta

```json
POST /api/sales
{
  "client_id": 1,
  "items": [
    { "product_id": 1, "quantity": 2 },
    { "product_id": 2, "quantity": 1 }
  ]
}
```

El total se calcula automáticamente y se descuenta el stock.

## Seguridad

- Contraseñas con **bcrypt**
- **JWT** para API y cookie para vistas web
- Middleware de protección en rutas privadas
- Validación de entradas en servicios
- GORM con **PrepareStmt** para consultas preparadas

## Base de datos

Las tablas se crean automáticamente al arrancar (GORM AutoMigrate). Para referencia, la estructura equivalente en SQL se describe en `database/schema_example.sql`.

## Producción

- Cambiar `JWT_SECRET` por un valor seguro y único
- Usar variables de entorno reales (no depender de `.env` en servidor)
- Configurar MySQL con usuario con permisos mínimos necesarios
- Servir la app detrás de HTTPS (reverse proxy o similar)
