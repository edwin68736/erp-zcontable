# Implementación Fase 2.1 + 2.2 — `Payment.Purpose` y backfill histórico

**Fecha**: 2026-09-14
**Alcance**: exclusivamente el campo `Payment.Purpose` y su backfill histórico. Nada de sobrepagos, `AllocateExisting`, locking, POS, UI, anulación auditable ni Fase 3.

---

## Fase 2.1 — Campo agregado

```go
// backend/models/payment.go
const (
	PaymentPurposeDebt    = "deuda"
	PaymentPurposeService = "servicio"
)

Purpose *string `gorm:"size:20;index" json:"purpose,omitempty"`
```

- **Tipo**: `*string` — mismo patrón nullable ya usado en el proyecto para campos opcionales de FK/estado (`TaxSettlementID *uint`, `LinkedPaymentID *uint` en `TukifacFiscalReceipt`).
- **Nullable**: sí, sin `default`. Los `Payment` existentes quedan en `NULL` al agregarse la columna (verificado en `TestRunPaymentMigrations_ExistingPaymentsStayNullAndDontFail`).
- **Valores válidos**: `"deuda"` | `"servicio"`. No se introdujo ningún valor adicional (`otro`, `general`, `unknown`) — `NULL` es el único estado de "sin clasificar", consistente con el patrón ya usado por `Document.OriginSettlementID` en Fase 1.
- **Migración de esquema**: `gorm.AutoMigrate()` (ya incluye `&models.Payment{}` en `database/database.go`) — agrega la columna e índice automáticamente al reiniciar el backend, sin SQL manual, mismo mecanismo que Fase 1.

---

## Fase 2.2 — Backfill histórico

Nuevo archivo `backend/services/payment_migrations.go`, siguiendo **exactamente** el patrón de `document_migrations.go` de Fase 1: reutiliza el helper genérico `applyDocumentMigrationOnce` (ya existente, guardado en `schema_migrations` por nombre) — sin inventar un mecanismo nuevo.

### Reglas de clasificación (en orden, nunca se adivina)

| Caso | Condición | Resultado | Confianza |
|---|---|---|---|
| A | ≥1 `PaymentAllocation` activa | `deuda` | Alta — relación financiera directa, sin importar el `Source` del `Document` (todo `Document` en este modelo es una cuenta por cobrar) |
| B | `Payment.DocumentID` (legacy) apunta a un `Document` existente | `deuda` | Alta — misma evidencia que A, por el camino de escritura legacy |
| D | `type=on_account`, sin allocations, sin `DocumentID`, con `TukifacFiscalReceipt` vinculado (`LinkedPaymentID`) de `origin="pos_sale"` | `servicio` | **Media** — verificado contra el código real de `IssuePosSale` (`pos_sale_service.go`): el flujo POS nunca crea ni referencia un `Document`, así que un comprobante POS vinculado es evidencia estructural de venta/servicio independiente. Deliberadamente **excluye** `origin="issued_local"` (esos nacen de un `Payment` ya existente en Finanzas y pueden ser legítimamente un "a cuenta" genuino) |
| E | Cualquier otro caso | `NULL` (sin clasificar) | — |

`Document.Source` (liquidacion/recurrente_plan/manual) se registra en el reporte solo como desglose informativo — **no** se usa como filtro que excluya la clasificación `deuda`, porque las evidencias A/B (relación financiera directa) ya son suficientes por sí solas independientemente de qué tipo de documento sea.

### Idempotencia

- Filtra siempre `WHERE purpose IS NULL` — nunca reevalúa ni sobrescribe un `Payment` ya clasificado (por este backfill, por un operador, o por cualquier otro proceso futuro).
- Guardado en `schema_migrations` bajo el nombre `payments_v1_purpose_backfill` — corre una sola vez en la vida de la base (igual que las 6 migraciones de datos de `document_migrations.go`).
- Verificado con `TestBackfillPaymentPurpose_RunTwice_Idempotent` y `TestRunPaymentMigrations_RunTwice_NoError`: correr el backfill 2 veces produce exactamente el mismo resultado.

### Reporte

Se reutilizó `document_consolidation_logs` (Fase 1) — su campo `RelatedID` ya está documentado en el propio modelo como genérico ("payment_id, receipt_id, line_id, etc."), por lo que reutilizarlo para pagos no es un mal uso del mecanismo. Se deja **una fila por cada `Payment` procesado** (clasificado o ambiguo), con `payment_id`, `company_id`, `amount`, `type`, `document_id`, `allocation_count`, comprobante relacionado (si existe) y la razón. Además, un `log.Printf` de resumen al final de cada corrida:
```
[migrate payments_v1_purpose_backfill] total=X analizados=X ya_clasificados=X
  deuda_por_allocation=X deuda_por_document_id_legacy=X servicio_por_comprobante_pos=X
  ambiguos_sin_clasificar=X fuentes_document=map[...]
```

### Startup

`main.go`: se agregó una sola línea, inmediatamente después de `services.EnsureDocumentMigrationsOnStartup()` y antes de `database.BackfillUsernames()` — mismo punto del ciclo de arranque que Fase 1, después de que `AutoMigrate` ya haya creado la columna.

---

## Compatibilidad — confirmado sin cambios

| Elemento | Estado |
|---|---|
| `Payment.Type` | Sin cambios — sigue siendo `applied`/`on_account`, mecánico, no se toca su semántica ni su lógica de asignación |
| `Payment.DocumentID` | Sin cambios — sigue siendo escrito por `PaymentService.Update` exactamente igual que antes; el backfill de Fase 2.2 solo lo **lee** |
| `PaymentAllocation` | Sin cambios — el backfill de Purpose nunca crea, modifica ni elimina ninguna (verificado en `TestBackfillPaymentPurpose_ServicePayment_NeverGetsAllocations`) |
| `Payment.Amount` | Sin cambios (verificado en `TestBackfillPaymentPurpose_NeverModifiesUnrelatedFields`) |
| `Document.balance_amount`/`status` | Sin cambios — el backfill de Purpose nunca llama a `PersistBalanceAndStatus` ni toca `documents` (verificado en el mismo test) |
| `CreateFromParams` / `PaymentService.Create` / `ApplyPaymentTx` | Sin cambios — ningún punto de creación de pagos fija `Purpose` todavía (eso es Fase 2.6) |
| Fase 1 (`OriginSettlementID`, Cleanup/Purge, `DocumentService.Delete`) | Sin cambios — suite completa re-ejecutada y 100% verde |

---

## Dependencias detectadas para fases futuras (no implementadas aquí, solo documentadas)

- El Caso D (servicio vía comprobante POS) depende de que el flujo POS siga sin crear `Payment` directamente — cuando se implemente **Fase 2.7 (POS)**, el nuevo `Payment` creado en ese momento debería fijar `Purpose=servicio` explícitamente en la creación (Fase 2.6), no depender de este backfill retroactivo.
- La clasificación por `Document.Source=manual` (confianza media-baja, caso A/B) podría revisarse más adelante si se decide introducir un tercer estado de confianza — no se tocó nada de esto ahora, solo se documenta la observación.

---

## Tests (20/20 casos cubiertos, todos en verde)

`backend/services/payment_migrations_test.go` — 15 funciones de test cubriendo los 20 casos mínimos pedidos (varios casos se agrupan en una sola función donde comparten setup, ej. los 3 `Document.Source` en una tabla). Ver también `TestPaymentPurpose_ModelRoundTrip_DeudaServicioNull` para los 3 casos de modelo.
