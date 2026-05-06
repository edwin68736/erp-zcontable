# Documentación de implementación: Liquidación de impuestos

## 1. Objetivo

Permitir que el estudio contable:

1. Siga registrando **cargos / deudas** por cliente (como hoy en **Deudas / documents**): fecha de registro, vencimiento opcional, concepto, monto — sin exigir comprobante fiscal SUNAT por cada línea.
2. Genere un documento de presentación **“Liquidación de impuestos”** (equivalente al Excel/PDF del ejemplo) que **agrupa** ítems enviados al cliente y **no sustituye** el registro contable interno de cada cargo.
3. Permita que el cliente pague **total o parcial**; los pagos se imputen a **cargos concretos**; el saldo pendiente **aparezca en liquidaciones posteriores** sin duplicar cargos.

Este documento analiza el código actual y propone un diseño **sin duplicar** la lógica de deudas ya existente.

---

## 2. Estado actual del sistema (referencia técnica)

### 2.1 Modelo `Document` (`models/document.go`)

Ya representa un **cargo** hacia la empresa cliente:

| Campo           | Uso |
|----------------|-----|
| `company_id`   | Cliente |
| `issue_date`   | Fecha de registro / emisión |
| `due_date`     | Opcional |
| `total_amount` | Monto |
| `description`  | Concepto |
| `type`, `number` | Tipo y número (el backend puede autogenerar `DEU-…` si falta número) |
| `status`       | `pendiente`, `parcial`, `pagado`, `anulado` |
| `source`       | `manual`, `tukifac`, `recurrente_plan` |

**Conclusión:** las “deudas mensuales sin comprobante” **ya encajan** en `Document` con `source = manual` (o un valor más explícito como `cargo_estudio` si se desea distinguir en informes).

### 2.2 Pagos e imputación

- `Payment`: dinero recibido por `company_id`; puede ir a un documento o repartirse.
- `PaymentAllocation`: une un pago con un `document_id` y un `amount`.
- `DocumentPaidTotal` + `recalculateDocumentStatusTx`: el **saldo** de un cargo es `total_amount − Σ(allocations)`; el estado pasa a `parcial` / `pagado` automáticamente.

**Conclusión:** el **pago parcial por ítem** ya está resuelto a nivel de datos: basta crear un `Payment` con `allocations` que indiquen qué `document_id` y cuánto.

### 2.3 Listado de deudas

- `DocumentService.List` / listado paginado con filtros por empresa, estado, fechas (`issue_date`), etc.
- Vista React: `Documents.tsx` con `date_from`, `date_to`, etc.

---

## 3. Conceptos: qué es cada cosa (para no mezclar)

| Concepto | Rol | ¿Duplica `Document`? |
|----------|-----|----------------------|
| **Cargo / deuda** (`Document`) | Obligación de cobro por línea (honorario, servicio, etc.) | Es la **fuente de verdad** del monto adeudado |
| **Liquidación de impuestos** | Documento **informativo/presentación** al cliente (PDF/Excel): resume periodo, puede incluir bloque fiscal (PDT 621) + listado de honorarios | **No** debe volver a crear cargos por cada honorario ya registrado |
| **Pago** (`Payment` + `Allocation`) | Dinero recibido aplicado a uno o varios cargos | Ya existe |
| **Factura / boleta / nota de venta** | Comprobante fiscal SUNAT (Tukifac u otro) | Puede ser **fase 2**: vínculo a un pago o a un “documento fiscal” separado; no confundir con el `Document` interno de deuda |

Regla de oro: **un honorario = un `Document` (cargo)**. La liquidación solo **referencia** esos documentos (y opcionalmente agrega líneas que no son cargos recurrentes, ver §5).

---

## 4. Propuesta de modelo de datos: `TaxSettlement` (liquidación)

### 4.1 Entidad cabecera (ejemplo de nombres)

`tax_settlements` (o `liquidaciones_impuestos`):

- `id`
- `company_id` (FK empresa cliente)
- `number` — correlativo tipo `LI001-000202602` (serie + número)
- `issue_date` — fecha de emisión al cliente
- `period_label` o `period_from` / `period_to` — texto o rango del periodo liquidado
- `status` — ej. `borrador`, `emitida`, `anulada`
- `notes` / texto introductorio opcional
- Campos numéricos **snapshot** (opcional, para no recalcular PDF si cambian datos): `total_honorarios`, `total_impuestos`, `total_general`
- `created_at`, `updated_at`, `deleted_at` si aplica

### 4.2 Líneas de liquidación

`tax_settlement_lines`:

- `id`
- `tax_settlement_id` (FK)
- `line_type` — enum sugerido:
  - `document_ref` — línea que corresponde a un **cargo existente** (`document_id` NOT NULL)
  - `tax_manual` — fila del bloque PDT 621 (IGV / renta) ingresada o calculada en UI, **sin** `document_id`
  - `adjustment` — ajustes, redondeos, notas
- `document_id` — nullable; si viene de un cargo
- `concept` — texto en liquidación (puede copiarse de `Document.description`)
- `amount` — monto **mostrado** en esa fila (idealmente = saldo pendiente del documento al **momento de emitir** la liquidación, o monto fijado en snapshot)
- `sort_order`

**Importante:** al **emitir** la liquidación se puede guardar `amount` como **snapshot** para que el PDF histórico no cambie si luego hay pagos. El **saldo vivo** del cliente sigue saliendo de `Document` + `PaymentAllocation`.

### 4.3 Bloque PDT 621 (IGV / renta)

El ejemplo Excel tiene tablas con bases, créditos, percepciones, etc. Opciones:

1. **Fase 1 (rápida):** JSON en `tax_settlements.pdt621_json` con la estructura que necesite el PDF, editado en formulario dedicado al crear la liquidación.
2. **Fase 2:** tablas normalizadas (`tax_settlement_igv_rows`, etc.) si se requiere consultas y validaciones SUNAT más estrictas.

Recomendación: empezar con **JSON + plantilla PDF/HTML** para igualar el layout del Excel.

---

## 5. Flujos de negocio

### 5.1 Crear liquidación

1. Usuario elige **empresa** y **periodo** (o rango de fechas).
2. Backend consulta `Document` con:
   - `company_id` = cliente
   - `status` ∈ (`pendiente`, `parcial`)
   - opcional: `issue_date` dentro del periodo **o** “todos los pendientes hasta hoy” (regla de negocio a definir).
3. Por cada documento candidato, calcular **saldo** = `total_amount - DocumentPaidTotal`.
4. Si saldo > 0, prellenar línea `document_ref` con `document_id`, `concept`, `amount` = saldo (o monto total del documento según política).
5. En la misma pantalla, el usuario puede:
   - quitar líneas,
   - añadir líneas `tax_manual` para PDT 621,
   - añadir otro `document_ref` si se creó un cargo nuevo en caliente.
6. Guardar como `borrador` o **emitir** (`emitida`), generar número correlativo, opcionalmente **PDF**.

### 5.2 PDF / Excel

- Plantilla (React-PDF, html-to-pdf, o exportación Excel) que reciba JSON de cabecera + líneas + bloque PDT desde `pdt621_json`.
- Branding del estudio (como `FirmConfig` existente).

### 5.3 Pago del cliente (total o parcial)

**No hace falta** un nuevo tipo de pago: usar `PaymentCreateParams` con `AllocationMode: "manual"` y `allocations: [{ document_id, amount }, ...]`.

Flujo UI sugerido:

1. Desde la liquidación emitida (o desde empresa): botón **“Registrar pago”**.
2. Mostrar los **mismos cargos** que siguen con saldo > 0 (no solo los de la liquidación, o filtrar por los incluidos en la liquidación según regla).
3. Checkboxes / montos editables por línea; total del pago = suma de montos seleccionados.
4. Crear un `Payment` + `PaymentAllocation` por cada línea.

Si el cliente paga **menos** que el total de la liquidación, los documentos no cubiertos siguen en `parcial` / `pendiente` y **saldrán** en la próxima liquidación al volver a ejecutar la consulta de §5.1.

### 5.4 “Factura / boleta / nota de venta” a partir de la liquidación

Es un flujo **fiscal** distinto del cargo interno:

- **Opción A:** En ZContable solo se registra referencia (`Payment.fiscal_status`, número SUNAT en notas) después de emitir en Tukifac manualmente.
- **Opción B:** Integración API Tukifac para crear el comprobante con líneas derivadas del pago o de la liquidación (fase posterior).

La liquidación **no** debe convertirse automáticamente en un `Document` duplicado por cada honorario; el comprobante fiscal es el “recibo oficial” del cobro, no la deuda interna.

---

## 6. ¿La liquidación es lo mismo que “crear deudas”?

**No.** Convención recomendada:

| Acción | Dónde |
|--------|--------|
| Registrar un nuevo honorario / cargo | **Deudas → Nuevo** (`Document`) |
| Agrupar y presentar al cliente | **Liquidación** (`TaxSettlement` + líneas) |
| Registrar cobro | **Pagos** (con imputación a `Document`) |

Ventajas:

- Una sola fuente de verdad del saldo (`Document` + allocations).
- La liquidación es **versión presentable** y **histórico** (snapshot), no un segundo libro de deudas.
- Evita duplicar montos y reconciliaciones.

Si en el futuro se quisiera “crear cargo desde liquidación”, sería solo un **atajo de UI** que inserta un `Document` y en la misma transacción una línea `document_ref` en la liquidación borrador.

---

## 7. Fases de implementación sugeridas

### Fase 1 — MVP

- Tablas `tax_settlements` + `tax_settlement_lines`.
- API: crear borrador, listar pendientes por empresa, emitir (número correlativo), obtener detalle.
- UI: asistente “Nueva liquidación” (empresa → precarga documentos con saldo → edición de líneas → emitir).
- PDF básico: cabecera cliente/estudio + tabla honorarios (líneas `document_ref`) sin PDT 621 o con bloque texto libre.

### Fase 2 — PDT 621

- Formulario estructurado o JSON con validaciones; mismo PDF ampliado como el ejemplo (IGV mensual, renta mensual, totales en amarillo).

### Fase 3 — Pago guiado desde liquidación

- Pantalla que llama al flujo existente de pagos con `allocations` manuales precargadas desde líneas de la liquidación.

### Fase 4 — Comprobante fiscal

- Enlace con Tukifac o registro de serie/número en pago; fuera del alcance del modelo de liquidación en sí.

---

## 8. API REST (borrador)

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/companies/:id/settlements/preview?as_of=…` | Documentos con saldo > 0 para precargar líneas |
| POST | `/api/tax-settlements` | Crear borrador |
| PUT | `/api/tax-settlements/:id` | Actualizar líneas / PDT JSON |
| POST | `/api/tax-settlements/:id/emit` | Asignar número, status emitida, snapshot montos |
| GET | `/api/tax-settlements/:id` | Detalle + líneas |
| GET | `/api/tax-settlements/:id/pdf` | Descarga PDF |

(Los nombres de ruta pueden alinearse con el resto del proyecto en español o inglés.)

---

## 9. Consideraciones y riesgos

1. **Snapshot vs saldo vivo:** Definir si el PDF debe congelar montos al emitir (recomendado para auditoría).
2. **Documentos anulados:** Excluir siempre de precarga; si ya estaban en liquidación emitida, la línea queda histórica.
3. **Permisos:** Mismos roles que crean/editan `Document` y `Payment`.
4. **Correlativo `LI001-…`:** Tabla de series o configuración en `FirmConfig` (similar a numeración de otros documentos).

---

## 10. Resumen ejecutivo

- Los **cargos** siguen siendo **`Document`** en Deudas; no duplicar esa entidad para “honorarios en liquidación”.
- La **liquidación** es una **nueva entidad** que **referencia** documentos (y opcionalmente filas fiscales manuales) y sirve para **presentación al cliente** y trazabilidad.
- Los **pagos parciales** usan el **módulo de pagos actual** con **imputaciones manuales**; lo pendiente reaparece en la siguiente liquidación al consultar saldos abiertos.

Este diseño mantiene el sistema **coherente, auditable y extensible** hacia PDT 621 completo y emisión fiscal sin rehacer el núcleo de deudas.
