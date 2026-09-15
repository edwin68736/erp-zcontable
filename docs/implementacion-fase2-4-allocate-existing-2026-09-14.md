# Implementación Fase 2.4 — `AllocateExisting`

Fecha: 2026-09-14
Estado: **implementado, con tests, pendiente de revisión y commit del usuario**
Diseño aprobado: [docs/diseno-fase2-4-allocate-existing-2026-09-14.md](diseno-fase2-4-allocate-existing-2026-09-14.md)
Commit base: `9fa3eb9` (Fase 2.3)

## 1. Qué resuelve

Permite aplicar el remanente disponible de un `Payment` ya existente (dinero recibido, sea
`on_account` o `applied` con remanente por Fase 2.3) a una o varias deudas (`Document`), **sin
crear un `Payment` nuevo**. Antes de esta fase, la única forma de "usar" ese dinero era recrear
un `Payment` (duplicando el ingreso) o editarlo vía `UpdateAPI`.

## 2. Archivos modificados (100% aditivo, cero líneas no relacionadas tocadas)

| Archivo | Cambio |
|---|---|
| [backend/services/debt/payment_apply.go](../backend/services/debt/payment_apply.go) | `AllocateExistingInput` + `Service.AllocateExistingPaymentTx` (motor) |
| [backend/services/payment_service.go](../backend/services/payment_service.go) | `PaymentService.AllocateExisting` (orquestación: abre transacción) |
| [backend/controllers/payment_controller.go](../backend/controllers/payment_controller.go) | `PaymentController.AllocateExistingAPI` |
| [backend/routes/routes.go](../backend/routes/routes.go) | `POST /payments/:id/allocate` |
| [backend/services/debt/allocate_existing_test.go](../backend/services/debt/allocate_existing_test.go) | 22 tests del motor (nuevo) |

Ningún archivo de POS, UI, Dashboard, Reports, SUNAT, comprobantes fiscales, ni código de Fase
1/2.3/2.5/2.6/2.7/3 fue tocado. `git diff --stat` final: 4 archivos, +161/-0 líneas.

## 3. Endpoint

```
POST /payments/:id/allocate
Permiso: rbac.PaymentsUpdate  (no se creó permiso nuevo)
```

Body:
```json
{
  "allocations": [
    { "document_id": 123, "amount": 250.00 },
    { "document_id": 124, "amount": 100.00 }
  ]
}
```

Respuesta: el `Payment` actualizado (mismo shape que `GetAPI`), con sus `Allocations` recalculadas.
Errores de validación → `400` con `{"error": "..."}`.

Es un método de controlador nuevo, **no** una reutilización de `UpdateAPI` — sigue la convención
verbo-acción ya usada en `POST /payments/:id/issue-comprobante`.

## 4. Validaciones (motor `AllocateExistingPaymentTx`)

En orden:

1. `payment_id` y al menos una línea presentes.
2. El `Payment` existe (no soft-deleted) y pertenece a `CompanyID`.
3. **Purpose**: `Payment.Purpose == nil` → rechazado (no se adivina). `Purpose == "servicio"` →
   rechazado siempre (un ingreso de servicio nunca se aplica a una deuda). Solo
   `Purpose == "deuda"` puede continuar.
4. **Estado B legacy**: si `Payment.DocumentID != nil` y aún no existe ninguna `PaymentAllocation`
   para ese pago (el backfill de arranque `database.BackfillPaymentAllocations()` todavía no lo
   sincronizó), se rechaza explícitamente con un mensaje pidiendo reintentar tras el próximo
   reinicio — evita contar como "disponible" dinero ya comprometido con ese documento legacy.
   Si el `DocumentID` legacy **ya** tiene su `PaymentAllocation` equivalente (Estado C), se permite
   con normalidad.
5. Remanente disponible = `Payment.Amount − SUM(PaymentAllocation.amount)` (nunca se persiste como
   columna, siempre derivado — igual que Fase 2.3).
6. La suma de las líneas nuevas no puede exceder el remanente disponible (tolerancia
   `MoneyEpsilon`). Si excede, se rechaza **todo el lote** (ver rollback, §6).
7. Se reutiliza `ValidateAllocationsTx` (la misma validación por línea que usa `ApplyPaymentTx`):
   documento existe, misma empresa, no anulado, monto > 0, no excede saldo del documento, sin
   documentos repetidos entre sí.

## 5. Qué NO modifica nunca

`Payment.Amount`, `Date`, `Method`, `Reference`, `Description`, `Purpose`, `DocumentID` — ninguno
se toca. Tampoco se crea ni modifica ningún `TukifacFiscalReceipt` vinculado. El único campo que
puede cambiar es `Payment.Type`: si estaba en `on_account` pasa a `applied` (mismo criterio que
`ApplyPaymentTx`); si ya era `applied`, no cambia.

Por cada línea se crea una `PaymentAllocation` nueva y se recalcula `Document.BalanceAmount`/
`Status` vía `PersistBalanceAndStatus` — el mismo mecanismo que ya usa `ApplyPaymentTx`, sin
fórmulas nuevas.

## 6. Transacción y rollback

Toda la operación corre dentro de una única transacción GORM (`database.DB.Transaction(...)` en
`PaymentService.AllocateExisting`). Si cualquier línea falla la validación de negocio (excede
remanente, documento anulado, etc.) o falla al persistir, la transacción completa hace rollback:
**ninguna** `PaymentAllocation` de ese lote queda persistida, ni siquiera las líneas que
individualmente sí eran válidas. Verificado explícitamente en
`TestAllocateExisting_Rejects_ExceedsRemainder_NoPartialPersist`.

## 7. Locking — explícitamente NO implementado (Fase 2.5)

No hay `SELECT ... FOR UPDATE` sobre el `Payment` ni sobre los `Document` afectados. Dos llamadas
concurrentes sobre el mismo `Payment` podrían leer el mismo remanente disponible y ambas pasar la
validación antes de que la otra confirme. Esto es una limitación conocida y **deliberadamente
diferida a Fase 2.5**, documentada con un comentario `TODO Fase 2.5` en el propio código
(`payment_apply.go`), tal como se acordó en el diseño aprobado. No se implementó ningún mecanismo
de idempotencia (idempotency key) — tampoco estaba en el alcance autorizado.

## 8. Tests (22 en `allocate_existing_test.go`, todos en `package debt_test`)

| Test | Cubre |
|---|---|
| `OnAccount_PartialAllocation` | aplicación parcial sobre pago `on_account` |
| `OnAccount_FullAllocation` | aplicación completa, deuda queda `pagado` |
| `PartiallyApplied_ApplyRemainder` | **caso obligatorio**: 1000 con 600 ya aplicado + 250 nuevo → 850 aplicado, remanente 150, `Amount` intacto |
| `MultipleDocuments` | una llamada, 3 documentos distintos |
| `Rejects_NoRemainderAvailable` | remanente ya en 0 |
| `Rejects_ExceedsRemainder_NoPartialPersist` | **caso obligatorio de rollback**: 500 disponible, pide 200+400=600 → rechazo total, cero allocations persistidas, documentos sin modificar |
| `Rejects_ExceedsDocumentBalance` | dinero del pago alcanza pero excede el saldo del documento |
| `Rejects_PurposeServicio` | pago `purpose=servicio` nunca aplica a deuda |
| `Rejects_PurposeNull` | pago sin clasificar se rechaza, no se adivina |
| `Rejects_LegacyDocumentIDStateB` | Estado B: `DocumentID` legacy sin allocation sincronizada aún |
| `AllowsStateC_LegacyDocumentIDAlreadySynced` | Estado C: `DocumentID` legacy ya sincronizado, se permite |
| `DoesNotTouchFiscalReceipt` | comprobante vinculado permanece sin cambios |
| `NoMutationOfUnrelatedFields` | **caso obligatorio de no-mutación**: Amount/Date/Method/Reference/Description/Purpose/DocumentID intactos, único cambio permitido es Type |
| `TypeChangesOnAccountToApplied` | transición legítima de Type |
| `TypeStaysAppliedIfAlreadyApplied` | Type no cambia si ya era applied |
| `DocumentBalanceAndStatusRecalculated` | `BalanceAmount`/`Status` del documento correctos tras aplicar |
| `Rejects_CompanyIDMismatch` | CompanyID del request no coincide con el del pago |
| `Rejects_DocumentFromDifferentCompany` | el `Document` de una línea pertenece a otra empresa, aunque el `CompanyID` del request sí coincida con el del pago (agregado en revisión de cobertura 2026-09-14) |
| `Rejects_CancelledDocument` | no se puede imputar a documento anulado |
| `Rejects_DuplicateDocumentInSameCall` | mismo documento repetido en una llamada |
| `Rejects_PaymentNotFound` | `payment_id` inexistente |
| `Rejects_SoftDeletedPayment` | pago soft-deleted no admite nuevas imputaciones |

## 9. Regresión

```
go build ./...                                    → OK
go test ./services/... ./database/... -count=1    → ok (184 PASS, 0 FAIL)
go vet ./...                                       → limpio (único warning preexistente en
                                                      cmd/debt-audit/main.go, no tocado por esta fase)
```

Re-ejecución dirigida por fase (subconjunto del total anterior, cero regresiones):
- Fase 1 (`Origin`/`DeleteGuard`): 11 PASS
- Fase 2.1/2.2 (`PaymentPurpose`/`PaymentMigration`): 13 PASS
- Fase 2.3 motor (`Remainder`): 8 PASS
- Fase 2.3 orquestación (`Overpayment`): 18 PASS
- Fase 2.4 (`AllocateExisting`, nuevo): 22 PASS

## 10. Limitaciones conocidas (heredadas o explícitamente diferidas)

- **Sin locking** (§7) — Fase 2.5.
- **Sin idempotencia** — fuera de alcance autorizado para esta fase.
- El backfill legacy (`database.BackfillPaymentAllocations`) sigue corriendo en cada arranque del
  backend, no gated por `schema_migrations` — comportamiento preexistente, sin cambios aquí.
