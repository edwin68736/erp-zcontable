# Fase 6 — Paso 1: Auditoría de cancelaciones + write-off

**Fecha**: 2026-09-15
**Alcance**: solo auditoría — nada implementado en este paso. Traza exhaustiva de código real
(`DeletePaymentTx`, `WriteOffUnlinkedDebt`, todas las rutas que tocan borrado/baja de `Payment` y
`Document`) contra el contrato de `docs/blueprint-financiero-definitivo-2026-09-14.md` §19-22.

---

## 1. Contrato del Blueprint (§19-22)

### §19 — Cancelación auditable de Payments

```go
// Nuevos campos en Payment:
VoidedAt   *time.Time
VoidedBy   *uint
VoidReason string
```

Al anular (ya no `DELETE` físico):
1. Marcar `voided_at/by/reason` (el registro permanece, nunca se destruye).
2. Revertir sus `PaymentAllocation`s (igual que hoy hace `DeletePaymentTx`, se conserva esa lógica).
3. Recalcular saldo/estado de cada `Document` afectado vía `PersistBalanceAndStatus` (igual que hoy).
4. Desvincular el `TukifacFiscalReceipt` si estaba enlazado, volviendo a `pendiente_vincular` (igual que hoy).
5. **Corrección adicional** (gap detectado en Fase 1): revertir también el vínculo deuda↔liquidación si ese pago la había establecido.
6. Un pago anulado deja de contar en `SUM(Payment.amount)` de todos los cálculos oficiales — filtrar siempre `voided_at IS NULL`.

### §20 — Write-off / condonación — regla de bloqueo

`WriteOffUnlinkedDebt` debe **bloquear** (no solo advertir) cuando:
```
EXISTS PaymentAllocation con amount > 0 asociada al Document
  AND balance_amount > 0 (aún queda algo pendiente)
```

### §21-22 — Fuentes de verdad y fórmulas oficiales

`DineroNoAplicado`, `DineroTotalRecibido`, `DineroAplicadoADeudas` deben filtrar `voided_at IS NULL`
(directamente o vía JOIN a `Payment.voided_at IS NULL`). `SaldoDocumentado` no cambia (ya filtra por
`status`).

---

## 2. Estado real de `DeletePaymentTx` (código actual)

[backend/services/payment_service.go:586-638](../backend/services/payment_service.go#L586)

```go
func (s *PaymentService) DeletePaymentTx(tx *gorm.DB, id uint) error {
    // 1. Lock FOR UPDATE del Payment
    // 2. Desvincula cualquier TukifacFiscalReceipt (linked_payment_id=nil, reconciliation_status=Pending)
    // 3. Recolecta los Document IDs afectados (por Allocations y por el legacy Payment.DocumentID)
    // 4. Lock FOR UPDATE ascendente de esos Documents (mismo orden que ApplyPaymentTx/AllocateExistingPaymentTx)
    // 5. Delete de PaymentAllocation (payment_id = id)
    // 6. Delete de Payment (id)
    // 7. recalculateDocumentStatusTx por cada Document afectado
}
```

**Hallazgo importante #1 — ya es soft-delete, no hay DELETE físico hoy.**
`models.Payment` y `models.PaymentAllocation` ya tienen `DeletedAt gorm.DeletedAt`. `tx.Delete(...)`
sobre ambos modelos es, con GORM, un **UPDATE de `deleted_at`**, nunca un `DELETE FROM` real —
verificado: no existe ningún `.Unscoped()` sobre `Payment`/`PaymentAllocation` en todo el backend. La
formulación del Blueprint ("ya no `DELETE` físico") es correcta en la intención pero técnicamente el
dato físico **ya sobrevive** hoy — lo que falta no es evitar el borrado físico, sino:
- un campo de **motivo** (`VoidReason`) — hoy no existe ningún lugar donde se pida o guarde por qué se eliminó un pago;
- un campo de **actor explícito** (`VoidedBy`) — hoy no se registra qué usuario ejecutó el borrado (más allá de lo que pueda inferirse de logs de acceso genéricos, si existen);
- una **marca de tiempo dedicada y con semántica de "anulación"** (`VoidedAt`), distinta de `DeletedAt` (que es un campo técnico genérico de GORM usado también para soft-delete en decenas de modelos no financieros);
- que los **cálculos financieros oficiales filtren explícitamente por ese campo** en vez de depender implícitamente del scope automático de GORM (ver Hallazgo #4).

Confirmado por lectura de `docs/blueprint-financiero-definitivo-2026-09-14.md` §19 punto 1: coincide
— lo que pide el Blueprint es agregar la **auditoría explícita** (motivo/actor/marca dedicada), no
resolver un borrado físico que en la práctica no existe.

**Hallazgo #2 — el punto 5 del Blueprint (revertir vínculo deuda↔liquidación) NO está implementado.**
Cuando un pago se aplica con `TaxSettlementID` (viene de `ApplyPaymentTx` → `linkPaymentDebtsToSettlement`,
[payment_apply.go:383](../backend/services/debt/payment_apply.go#L383)), se establece:
- `Document.tax_settlement_id = settlementID` (vía `linkDocumentToSettlement`)
- una fila nueva en `TaxSettlementLine` (vía `ensureSettlementLineForDocument`)

`DeletePaymentTx` **no toca `Document.tax_settlement_id` ni `TaxSettlementLine` en ningún punto**. Si
se borra el pago que estableció ese vínculo, el `Document` queda con `tax_settlement_id` apuntando a
una liquidación con la que ya no tiene ningún pago real asociado — exactamente el "gap detectado en
Fase 1" que el Blueprint pide corregir explícitamente en Fase 6. Confirmado por trazado de código, no
solo por el texto del Blueprint.

**Hallazgo #3 — `DeletePaymentTx` ya hace correctamente los puntos 2, 3 y 4 del §19.**
Verificado línea por línea: revierte `PaymentAllocation` (punto 2), recalcula
`Document`/`recalculateDocumentStatusTx` (equivalente confirmado de `PersistBalanceAndStatus`, punto
3), y desvincula el `TukifacFiscalReceipt` devolviéndolo a `pendiente_vincular` (punto 4) — esta
lógica **debe conservarse tal cual** al introducir `voided_at`, tal como pide el Blueprint
explícitamente ("se conserva esa lógica").

---

## 3. Rutas que hoy invocan `DeletePaymentTx` (borrado — soft-delete — de un Payment)

| # | Entry point | RBAC | Contexto |
|---|---|---|---|
| 1 | `DELETE /api/payments/:id` → `PaymentController.DeleteAPI` ([payment_controller.go:362-376](../backend/controllers/payment_controller.go#L362)) | `middleware.RequirePermission(rbac.PaymentsDelete)` **+** chequeo interno `hasStudioScope(c)` ("Solo el administrador puede eliminar pagos") | Borrado manual directo de un pago. Sin body — no hay forma de enviar un motivo hoy. |
| 2 | `TaxSettlementService.Delete` ([tax_settlement_service.go:905-938](../backend/services/tax_settlement_service.go#L905)) → `revertSettlementPaymentsAndFiscal` cuando `ts.Status == Issued` | `DELETE /api/tax-settlements/:id` con `rbac.TaxSettlementsDelete` | Al eliminar una liquidación emitida, se revierten (soft-delete) TODOS los Payments con `tax_settlement_id = ts.ID`. |
| 3 | `TaxSettlementService.RevertToDraft` ([tax_settlement_service.go:941-971](../backend/services/tax_settlement_service.go#L941)) → `revertSettlementPaymentsAndFiscal` | `POST /api/tax-settlements/:id/revert-to-draft` con `rbac.TaxSettlementsUpdate` | Igual que #2 pero deja la liquidación en borrador en vez de eliminarla. |

No existe ninguna otra ruta ni servicio que borre un `Payment` (confirmado por búsqueda exhaustiva de
`Delete(&models.Payment{}` en todo el repo — un único sitio: `payment_service.go:624`).

**Hallazgo #4 — no hay registro de motivo/actor en NINGUNA de las 3 rutas.** Las rutas #2 y #3 son
cascadas automáticas (el usuario anula la liquidación completa, no cada pago individualmente) — ahí
el "motivo" natural sería el de revertir/eliminar la liquidación, que tampoco se pide ni se guarda hoy
en `TaxSettlement`. Fuera del alcance textual de §19 (que habla de `Payment`), pero relevante para el
diseño de Fase 6 Paso 2: si `VoidReason` se vuelve obligatorio en `DeletePaymentTx`, las llamadas en
cascada desde #2/#3 necesitan un motivo sintético (p. ej. `"Liquidación #<id> revertida/eliminada"`) o
`VoidReason` debe seguir siendo opcional para estas dos rutas y obligatorio solo para la ruta #1
manual — **decisión de diseño pendiente para Paso 2, no tomada aquí**.

---

## 4. Estado real de `WriteOffUnlinkedDebt`

[backend/services/debt/writeoff.go:23-78](../backend/services/debt/writeoff.go#L23)

Ya implementa exactamente el patrón de auditoría que el Blueprint pide para `Payment` — pero aplicado
a `Document`:

```go
type Document struct {
    ...
    WriteoffReason string     `gorm:"type:text"`
    WriteoffBy     *uint      `gorm:"index"`
    WriteoffAt     *time.Time
}
```

Validaciones actuales (en orden):
1. Acción válida (`exonerar` → `StatusExonerado` | `eliminar` → `StatusCancelled`).
2. `reason` obligatorio (rechaza vacío).
3. Documento no vinculado a una liquidación (`TaxSettlementID == nil`).
4. No está ya en estado terminal (`IsTerminalWriteoffStatus`).
5. No está `StatusPaid`.
6. `EffectiveBalance(tx, &d) > MoneyEpsilon` (debe tener saldo pendiente).

Al pasar todas: `status`, `balance_amount=0`, `writeoff_reason`, `writeoff_at`, `writeoff_by` (si
`userID > 0`) — actualizado con `tx.Model(...).Updates(...)` dentro de una transacción abierta por el
llamador (`TaxSettlementService.WriteOffPendingDebt`).

**Hallazgo #5 — 🔴 la regla de bloqueo del §20 NO está implementada.** El chequeo actual (paso 6,
`EffectiveBalance <= MoneyEpsilon`) solo bloquea cuando el saldo está en ~0 (deuda ya completamente
pagada — que además ya está cubierto por el chequeo del paso 5, `StatusPaid`). **No existe ningún
chequeo de `hasPaymentAllocations`** (la función ya existe y se usa en otro archivo del mismo paquete:
[settlement.go:88-94](../backend/services/debt/settlement.go#L88)) antes de permitir el write-off. Consecuencia
verificada por trazado de código: un `Document` con `total_amount=1000`, una `PaymentAllocation` real
de `400` (`balance_amount=600`, `status='parcial'`) puede hoy ser exonerado o anulado sin ningún
bloqueo ni advertencia — el Blueprint exige exactamente bloquear ese caso
(`EXISTS PaymentAllocation > 0 AND balance_amount > 0`).

Importante — esto **no es un bug de duplicación ni pérdida de dinero**: `DineroAplicadoADeudas` sigue
contando esa `PaymentAllocation` de 400 correctamente sin importar el `status` del `Document` (no
filtra por `status`). El dinero no desaparece de los cálculos financieros oficiales. El riesgo real es
operativo/de integridad de negocio: un usuario puede dar de baja una deuda que en realidad ya tiene
dinero real aplicado, sin que el sistema se lo advierta ni se lo impida, dejando un `Document` en
estado terminal (`exonerado`/`anulado`) con una `PaymentAllocation` activa apuntándole — una
combinación de estados que hoy ningún otro punto del sistema valida como inconsistente.

**Hallazgo #6 — infraestructura reutilizable ya existe.** `hasPaymentAllocations(tx, documentID)`
([settlement.go:88](../backend/services/debt/settlement.go#L88)) y `PaidTotal(tx, documentID)`
([balance.go:20](../backend/services/debt/balance.go#L20)) ya calculan exactamente lo que la regla del
§20 necesita — implementar el bloqueo en Paso 2 no requiere una fórmula nueva, solo una llamada
adicional dentro de `WriteOffUnlinkedDebt`.

---

## 5. Ruta que invoca `WriteOffUnlinkedDebt`

| Entry point | RBAC | Wrapper |
|---|---|---|
| `POST /api/tax-settlements/debts/:documentId/writeoff` → `TaxSettlementController.WriteOffDebtAPI` ([tax_settlement_controller.go:280](../backend/controllers/tax_settlement_controller.go#L280)) | `middleware.RequirePermission(rbac.TaxSettlementsUpdate)` | `TaxSettlementService.WriteOffPendingDebt` ([tax_settlement_service.go:1121](../backend/services/tax_settlement_service.go#L1121)) — abre transacción y delega en `debt.WriteOffUnlinkedDebt` |

Única ruta que llama a `WriteOffUnlinkedDebt` en todo el backend (confirmado por búsqueda exhaustiva).
El body ya transporta `action` y `motivo` (mapeado a `reason`) y el `userID` viene del contexto de
autenticación — la mecánica de auditoría (reason/userID) que le falta a `DeletePaymentTx` **ya existe
tal cual** en este endpoint; es el patrón de referencia a replicar.

---

## 6. Cálculos financieros de Fase 3 — impacto de `voided_at`

[backend/services/debt/financial_totals.go](../backend/services/debt/financial_totals.go) — su propio
comentario (C1, escrito en Fase 3) ya anticipa esto explícitamente:

> "Cuando Fase 6 agregue `voided_at`, estas 4 funciones necesitarán una condición adicional
> (`AND voided_at IS NULL`), no un rediseño."

Confirmado por lectura de las 4 funciones: hoy dependen únicamente del scope automático de GORM sobre
`DeletedAt` (ninguna usa `.Unscoped()`, así que un Payment soft-deleted ya queda excluido
implícitamente de las 4 — el dato ya es correcto hoy). El cambio real que exige el Blueprint es:
- añadir `voided_at IS NULL` explícito en `DineroTotalRecibido` (hoy: `WHERE company_id = ?`).
- añadir `AND p.voided_at IS NULL` al JOIN de `DineroAplicadoADeudas` (hoy solo filtra `p.deleted_at IS NULL`).
- añadir `voided_at IS NULL` al `Where(...)` de `DineroNoAplicado` (hoy: `purpose IS NULL OR purpose = 'deuda'`).
- `SaldoDocumentado` no necesita cambios (no depende de `Payment`).

Es un cambio aditivo y acotado — no un rediseño — tal como ya predijo el propio comentario de Fase 3.
Mismo patrón en `PaidTotal`/`EffectiveBalance`/`DineroAplicadoADeudas` (todos hacen
`JOIN payments p ON ... AND p.deleted_at IS NULL`): cada uno de esos JOIN necesitará el `AND
p.voided_at IS NULL` agregado en el mismo lugar.

---

## 7. Matriz de contradicciones/gaps vs Blueprint

| # | Punto del Blueprint | Estado actual | Clasificación |
|---|---|---|---|
| 1 | §19.1 `voided_at/by/reason` en `Payment` | No existen los 3 campos — hoy solo hay `DeletedAt` genérico de GORM (soft-delete real, sin motivo/actor) | 🟠 pendiente de implementar (Paso 2) |
| 2 | §19.2 revertir `PaymentAllocation` | Ya implementado en `DeletePaymentTx`, debe conservarse | 🟢 sin cambios necesarios |
| 3 | §19.3 recalcular saldo/estado vía `PersistBalanceAndStatus` | Ya implementado (`recalculateDocumentStatusTx`), debe conservarse | 🟢 sin cambios necesarios |
| 4 | §19.4 desvincular `TukifacFiscalReceipt` → `pendiente_vincular` | Ya implementado, debe conservarse | 🟢 sin cambios necesarios |
| 5 | §19.5 revertir vínculo deuda↔liquidación | **No implementado** — `Document.tax_settlement_id`/`TaxSettlementLine` quedan huérfanos tras borrar el pago que los estableció | 🟠 gap real, confirmado por código — pendiente Paso 2 |
| 6 | §19.6 excluir `voided_at` en cálculos oficiales | Las 4 funciones de Fase 3 necesitan el filtro adicional (cambio aditivo, ya anticipado) | 🟠 pendiente Paso 2 |
| 7 | §20 bloqueo de write-off con pago parcial | **No implementado** — `WriteOffUnlinkedDebt` no verifica `PaymentAllocation` alguna antes de permitir exonerar/anular | 🔴 gap real y más significativo de este audit — pendiente Paso 2 |
| 8 | Motivo/actor en las rutas de cascada (#2/#3 de la sección 3) | No cubierto textualmente por el Blueprint (habla de `Payment`, no de `TaxSettlement`) | 🟠 decisión de diseño abierta para Paso 2, no una contradicción del Blueprint |

---

## 8. Qué NO se tocó en esta auditoría (fuera de alcance, confirmado)

- No se modificó ningún archivo de código.
- No se diseñaron los nuevos campos ni migraciones.
- No se tocó UI/frontend/Android/Tauri.
- `consolidation.go` (herramienta de migración de datos histórica, `cmd/debt-consolidate`) y
  `RevertPaymentAllocationsTx` (función marcada `TODO: remove legacy`, **cero llamadores** en todo el
  repo — confirmado por búsqueda) quedan fuera de alcance: no son rutas activas de cancelación de
  pagos ni deben confundirse con la infraestructura a extender en Paso 2.
- `DiscardFiscalReceipt`/`TukifacReceiptDiscarded` es un mecanismo distinto (descartar comprobantes
  Tukifac sincronizados que nunca tendrán Payment) — ya bloquea explícitamente descartar un
  comprobante `Linked`, sin relación con la cancelación de Payments.
- `DocumentService.Delete` (borrado — también soft-delete, pese a su comentario "elimina físicamente")
  ya está protegido por `DocumentFinancialOrSettlementHistory` desde Fase 1 — no se encontró ningún gap
  nuevo ahí relevante a Fase 6.

---

## 9. Conclusión del Paso 1

Auditoría completa. Los dos hallazgos accionables para Fase 6 — Paso 2 son:

1. **🟠 §19**: agregar `VoidedAt/VoidedBy/VoidReason` a `Payment`, conservar intacta la lógica ya
   correcta de `DeletePaymentTx` (puntos 2-4), agregar la reversión del vínculo deuda↔liquidación
   (punto 5, gap confirmado), y filtrar `voided_at IS NULL` en las 4 funciones de Fase 3 (cambio
   aditivo).
2. **🔴 §20**: agregar el bloqueo de write-off cuando existe `PaymentAllocation > 0` y `balance_amount
   > 0`, reutilizando `hasPaymentAllocations`/`PaidTotal` ya existentes — es el hallazgo más
   significativo de este audit porque hoy permite dar de baja una deuda con dinero real ya aplicado
   sin ninguna advertencia.

No implementado nada de lo anterior — queda a la espera de autorización explícita para diseñar
(Fase 6 Paso 2, diseño) e implementar (Fase 6 Paso 3) siguiendo el mismo patrón de pasos usado en
Fases 4 y 5.
