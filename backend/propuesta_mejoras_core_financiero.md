# Propuesta de mejoras e implementaciones (Core Financiero MiWeb)

Basado en [requerimiento.md](file:///d:/goprojects/miweb/requerimiento.md) y el comportamiento actual del sistema (Go API + React), este documento lista brechas y propuestas para lograr un flujo financiero consistente (cuentas por cobrar, pagos parciales/totales, estados, saldos, control de acceso por empresa).

## 1) Resumen del estado actual (observado)

### Documentos
- Representan un “cargo” a una empresa: `company_id`, `total_amount`, `issue_date`, `status`, `source`.
- `status` es un texto y no se recalcula automáticamente según pagos (solo se setea al crear/sincronizar o al editar).
- No existe “fecha de vencimiento” en documentos.
- Se permite asociar múltiples pagos a un documento.

### Pagos
- Representan “abonos” por empresa: `company_id` y `amount` son obligatorios.
- `document_id` es opcional, por lo que un pago puede existir sin estar aplicado a una factura/documento.
- No hay `status` del pago (pendiente/completado) ni “pago programado”.
- El sistema permite adjuntar comprobante como URL/archivo.

### Saldos y estados de cuenta
- El saldo por empresa se calcula como: `SUM(documents.total_amount) - SUM(payments.amount)`.
- En el estado de cuenta se calcula saldo por documento sumando los pagos asociados a ese documento.
- Si se registran pagos sin `document_id`, bajan el saldo global pero no “cancelan” documentos específicos.

### Integración Tukifac
- Sincroniza una referencia financiera: id, tipo, número, fecha emisión, monto total, estado, ruc.
- El “estado” sincronizado se copia al `status` del documento.

## 2) Brechas contra el requerimiento

### 2.1 Cuentas por cobrar y estados de factura
Requerimiento: estados de la factura “Pendiente / Parcialmente pagado / Pagado / Anulado” y actualización automática del saldo.

Brecha actual:
- No hay actualización automática del `status` del documento en base a pagos.
- No hay manejo explícito de “parcialmente pagado”.
- No existe fecha de vencimiento, por lo que “deuda vencida” depende de un estado manual.

### 2.2 Flujo de “pago pendiente” vs “registro de pago”
Requerimiento: “seguimiento de facturas” y registro de pagos parciales o totales.

Brecha actual:
- El módulo de pagos es un registro directo de pagos ya efectuados, no una cola de pagos pendientes por factura.
- No existe entidad/estado de “pago pendiente”, ni programación, ni vencimiento del pago.

### 2.3 Control de acceso por empresas asignadas
Requerimiento: usuarios solo pueden ver/gestionar empresas asignadas (excepto Administrador).

Brecha actual:
- Hay RBAC por rol, pero no se observa restricción por empresa asignada en endpoints de companies/documents/payments.
- No existe (a nivel de modelo) la relación muchos-a-muchos Usuario–Empresa ni la asignación de equipo contable por empresa.

### 2.4 Gestión completa de usuarios
Requerimiento: activar/desactivar, asignar empresas, cambio y reset de contraseña, etc.

Brecha actual:
- Se observa CRUD básico de usuarios y roles, pero no:
  - estado activo/inactivo,
  - relación usuario-empresa,
  - flujos de reset/restore.

### 2.5 Recordatorios/alertas
Requerimiento: recordatorios automáticos de pago (correo/whatsapp/notificaciones internas) y alertas de deuda vencida.

Brecha actual:
- No se ve infraestructura para jobs/scheduler, plantilla de mensajes, colas ni auditoría de notificaciones.
- Sin fecha de vencimiento, “vencido” no puede calcularse con precisión.

## 3) Propuesta de modelo de negocio (opción recomendada)

### Conceptos
- Documento = cuenta por cobrar (factura/cargo) con un total y un saldo.
- Pago = movimiento de cobranza (entrada) que se aplica a:
  - un documento específico (recomendado), o
  - a la empresa como “pago a cuenta” (permitido pero controlado).

### Regla central
- El “estado” del documento debe derivarse (o recalcularse) por la suma de pagos aplicados:
  - `pendiente` si `paid = 0`
  - `parcial` si `0 < paid < total`
  - `pagado` si `paid >= total` (con tolerancia por redondeo)
  - `anulado` si la fuente indica anulación o se marca manualmente y bloquea aplicación de pagos

### Vencimiento
- Agregar `due_date` al documento.
- Estado “vencido” se calcula si `today > due_date` y `balance > 0` (o se expone como flag calculado).

## 4) Propuestas concretas (qué implementar)

### 4.1 Documentos: campos y reglas
- Agregar campos:
  - `due_date` (fecha vencimiento)
  - `paid_amount` (opcional materializado) o calcularlo al vuelo por agregación
  - `balance_amount` (opcional materializado) o calcularlo al vuelo
  - `status` restringido a un conjunto (enum lógico)
- Reglas:
  - Al crear/actualizar un pago aplicado a un documento, recalcular estado y saldo del documento.
  - Si el documento está `anulado`, bloquear aplicación de pagos (o exigir confirmación con política).

### 4.2 Pagos: aplicación y consistencia
- Decidir política de aplicación:
  - Recomendado: `document_id` obligatorio para pagos operativos (pagos “a cuenta” deben marcarse explícitamente).
- Agregar campos:
  - `applied_to` (si se necesita soportar aplicación múltiple)
  - `type`: `applied` | `on_account` (pago a cuenta)
  - `currency` (si aplica en el futuro)
- Validaciones:
  - Si `payment.document_id` existe, validar que el documento pertenezca a `payment.company_id`.
  - Evitar “sobrepago” sin política clara (permitir y registrar excedente como saldo a favor, o bloquear).

### 4.3 Distribución de pagos (si se requiere)
Si el estudio necesita registrar “un pago que cubre varias facturas”:
- Introducir tabla intermedia: `payment_allocations`:
  - `payment_id`, `document_id`, `amount`
- Reglas:
  - El pago total = suma de allocations
  - El estado del documento se basa en allocations.

### 4.4 Endpoints API recomendados (orientativos)
- Documentos:
  - `GET /api/documents?company_id=&status=&overdue=1`
  - `GET /api/documents/:id` incluir: pagos/aplicaciones + montos calculados
  - `POST /api/documents` permitir `due_date`
  - `PUT /api/documents/:id` actualizar campos y recalcular estado si corresponde
- Pagos:
  - `GET /api/payments?company_id=&document_id=&type=`
  - `POST /api/payments` (si es aplicado: requiere `document_id`)
  - `POST /api/payments/upload-attachment`
- Estado de cuenta:
  - `GET /api/companies/:id/statement` incluir:
    - documentos con `paid` y `balance`,
    - pagos no aplicados (“a cuenta”) separados.

### 4.5 Control de acceso por empresas asignadas
- Modelo:
  - `company_assignments` (many-to-many): `user_id`, `company_id`, `role_in_company` (opcional)
  - Campos en empresa para equipo contable:
    - `supervisor_user_id`
    - `assistant_user_id`
    - `accountant_user_id` (opcional)
- Middleware/políticas:
  - Administrador: acceso total
  - Supervisor/Asistente/Contador: solo empresas asignadas
- En API:
  - filtrar listados por empresas permitidas
  - validar acceso en `GET/PUT/DELETE` por id

### 4.6 Gestión de usuarios (completa)
- Agregar:
  - `active` boolean
  - “cambiar contraseña” y “reset” con token temporal
  - asignación de empresas (UI + endpoints)
- Política:
  - usuarios inactivos no pueden autenticarse

### 4.7 Notificaciones y alertas (fase posterior)
- Requisitos previos:
  - `due_date` + cálculo de vencidos
  - bitácora de notificaciones (tabla `notifications_log`)
- Jobs:
  - recordatorios N días antes del vencimiento
  - alertas de deuda vencida (interno y canal externo)
- Canales:
  - email primero, luego WhatsApp (requiere proveedor)

## 5) Cambios de UI/UX sugeridos (sin rediseños)

### Estado de cuenta
- Mostrar por documento:
  - total, pagado, saldo, estado (pendiente/parcial/pagado/anulado), vencimiento.
- Sección separada:
  - “Pagos a cuenta” (pagos sin documento o excedentes).

### Registro de pagos
- Flujo recomendado:
  - Entrar desde un documento (botón “Registrar pago” en el estado de cuenta) para preseleccionar `document_id`.
  - Validar monto contra saldo pendiente del documento (mostrar saldo en pantalla).
- Comprobante:
  - adjunto obligatorio cuando se marca como “pagado” (política configurable).

## 6) Prioridad recomendada (roadmap)

1) Definir política de pagos: ¿siempre a documento o permitir “a cuenta”?
2) Agregar `due_date` y cálculo de vencidos.
3) Recalcular automáticamente estados de documento según pagos (pendiente/parcial/pagado/anulado).
4) Restringir acceso por empresas asignadas (modelo + middleware + filtros).
5) Completar gestión de usuarios: activo/inactivo, asignación de empresas, reset de contraseña.
6) Notificaciones y alertas (jobs + log + canales).

## 7) Checklist de decisiones (para cerrar alcance)

- ¿Se permite que un pago cubra múltiples documentos en una sola operación?
- ¿Se permite “sobrepago”? Si sí, ¿se registra como saldo a favor o como pago a cuenta?
- ¿El estado “anulado” viene solo de Tukifac o también se gestiona manualmente?
- ¿Qué roles pueden ver/editar pagos/documentos cuando están asignados a una empresa?

