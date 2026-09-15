# Fase 6 — Paso 2: Diseño técnico de cancelaciones y write-off

**Fecha**: 2026-09-15. **Solo diseño — nada implementado.** Referencia única: Blueprint
(`docs/blueprint-financiero-definitivo-2026-09-14.md` §19-22) + auditoría de Paso 1
(`docs/auditoria-fase6-paso1-cancelaciones-writeoff-2026-09-15.md`).

---

## A) DISEÑO TÉCNICO PROPUESTO

### A.1 — Campos nuevos en `Payment`

```go
// models/payment.go — junto a los campos existentes, antes de CreatedAt/UpdatedAt/DeletedAt
VoidedAt     *time.Time `json:"voided_at,omitempty"`
VoidedBy     *uint      `gorm:"index" json:"voided_by,omitempty"`
VoidReason   string     `gorm:"type:text" json:"void_reason,omitempty"`
```

**Decisión de diseño clave (no queda abierta, se explica por qué): `DeletedAt` NO se elimina, se
mantiene exactamente como hoy, en paralelo a los 3 campos nuevos.**

Razón: `Payment.DeletedAt` es lo que hoy hace que **todo** el resto del sistema (decenas de queries
con scope automático de GORM: `PaymentService.GetByID`, `ListPaged`, dashboards, reportes,
`PaidTotal`, `EffectiveBalance`, etc. — ninguno usa `.Unscoped()`, confirmado en Paso 1) deje de ver un
pago anulado, sin tener que auditar y tocar cada uno de esos sitios. Si se dejara de setear
`DeletedAt` al anular, *todos* esos sitios necesitarían revisión — eso sería reabrir Fases 1-5 y
exceder claramente el alcance de "no hacer refactors fuera de estos puntos". Mantenerlo:
- conserva 100% del comportamiento actual en todo el resto del sistema, sin tocarlo;
- no contradice el Blueprint: "el registro permanece, nunca se destruye" se cumple igual con
  soft-delete (la fila sigue en la tabla, solo queda fuera del scope por defecto — ya se demostró en
  el audit que esto **ya es así hoy**, no hay `DELETE FROM` físico en ningún lado);
- los 3 campos nuevos añaden exactamente lo que falta: motivo, actor, y una marca de tiempo con
  semántica de "anulación" (distinta de la genérica `DeletedAt` que usan ~20 modelos no financieros).

### A.2 — Extensión de `DeletePaymentTx`

Firma nueva (cambia; ambos llamadores internos se actualizan, ver A.4):

```go
func (s *PaymentService) DeletePaymentTx(tx *gorm.DB, id uint, reason string, userID uint) error
```

Estructura interna (se conserva el orden y la lógica actual punto por punto, solo se insertan los
pasos nuevos donde se indica):

```go
func (s *PaymentService) DeletePaymentTx(tx *gorm.DB, id uint, reason string, userID uint) error {
    reason = strings.TrimSpace(reason)
    if reason == "" {
        return errors.New("el motivo de anulación es obligatorio")
    }

    var p models.Payment
    if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&p, id).Error; err != nil {
        return err
    }

    // NUEVO — idempotencia (ver A.6): si ya estaba anulado, no repetir ningún efecto.
    if p.VoidedAt != nil {
        return ErrPaymentAlreadyVoided // sentinel exportado, ver A.6
    }

    // [SIN CAMBIOS] Desvincular TukifacFiscalReceipt -> pendiente_vincular
    if err := tx.Model(&models.TukifacFiscalReceipt{}).
        Where("linked_payment_id = ?", id).
        Updates(map[string]interface{}{
            "linked_payment_id":     nil,
            "reconciliation_status": models.TukifacReceiptPending,
        }).Error; err != nil {
        return err
    }

    // [SIN CAMBIOS] Recolectar Document IDs afectados (Allocations + legacy DocumentID)
    docIDs := map[uint]struct{}{}
    var allocs []models.PaymentAllocation
    tx.Where("payment_id = ?", id).Find(&allocs)
    for _, a := range allocs {
        docIDs[a.DocumentID] = struct{}{}
    }
    if p.DocumentID != nil {
        docIDs[*p.DocumentID] = struct{}{}
    }

    // [SIN CAMBIOS] Lock ascendente de esos Documents (mismo orden Payment->Documents ASC de Fase 2.5)
    orderedDocIDs := make([]uint, 0, len(docIDs))
    for did := range docIDs {
        orderedDocIDs = append(orderedDocIDs, did)
    }
    if _, err := debtsvc.NewService().LockDocumentsForUpdateAsc(tx, orderedDocIDs); err != nil {
        return err
    }

    // [SIN CAMBIOS] Revertir PaymentAllocation (Blueprint §19.2)
    if err := tx.Where("payment_id = ?", id).Delete(&models.PaymentAllocation{}).Error; err != nil {
        return err
    }

    // NUEVO — Blueprint §19.5: revertir vínculo deuda<->liquidación si este pago lo había establecido
    // (ver A.3 para el detalle exacto de esta lógica)
    if p.TaxSettlementID != nil {
        if err := s.revertSettlementDebtLinksTx(tx, *p.TaxSettlementID, orderedDocIDs); err != nil {
            return err
        }
    }

    // CAMBIA — antes: tx.Delete(&models.Payment{}, id) (soft-delete "desnudo").
    // Ahora: una sola UPDATE que fija deleted_at (mismo efecto de siempre) + los 3 campos nuevos.
    now := time.Now()
    result := tx.Model(&models.Payment{}).Where("id = ? AND deleted_at IS NULL", id).
        Updates(map[string]interface{}{
            "deleted_at":    now,
            "voided_at":     now,
            "voided_by":     userID, // 0 si no aplica (ver A.4, cascadas sin actor humano directo)
            "void_reason":   reason,
        })
    if result.Error != nil {
        return result.Error
    }
    if result.RowsAffected == 0 {
        return gorm.ErrRecordNotFound
    }

    // [SIN CAMBIOS] Recalcular saldo/estado de cada Document afectado (Blueprint §19.3)
    for did := range docIDs {
        if err := recalculateDocumentStatusTx(tx, did); err != nil {
            return err
        }
    }
    return nil
}
```

Puntos 2, 3 y 4 del Blueprint §19 quedan **literalmente intactos** (mismo código, mismo orden). Solo
se insertan: el guard de idempotencia, el paso §19.5 nuevo, y el cambio de `Delete()` a `Updates()`
para escribir los 3 campos nuevos en el mismo statement que ya fijaba `deleted_at`.

### A.3 — Reversión de `tax_settlement_id` / `TaxSettlementLine` (Blueprint §19.5)

**`Document.tax_settlement_id`**: se revierte reutilizando el helper ya existente y ya usado en otros
flujos de settlement, `debt.Service.UnlinkSettlementFromDocument(tx, documentID, settlementID)`
([settlement.go:308](../backend/services/debt/settlement.go#L308)) — sin duplicar lógica.

**Corrección de concurrencia necesaria** (no la tiene el helper por sí solo, hay que envolverlo): un
mismo `Document` puede tener **más de un** `Payment` activo con el mismo `TaxSettlementID` (pagos
parciales sucesivos). Si se anula solo uno de ellos, el vínculo **no debe** revertirse mientras siga
existiendo otro pago activo que también lo sostenga. Función nueva (paquete `debt`, mismo patrón que
`hasPaymentAllocations`):

```go
// revertSettlementDebtLinksTx (llamada desde PaymentService.DeletePaymentTx) revierte
// Document.tax_settlement_id para cada Document en docIDs SOLO si, tras eliminar las allocations del
// pago que se está anulando, ya no queda ningún otro Payment activo (no anulado) con el mismo
// TaxSettlementID sosteniendo ese vínculo (ni vía PaymentAllocation ni vía el esquema legacy
// Payment.DocumentID). Debe llamarse DESPUÉS de borrar las PaymentAllocation del pago anulado.
func (s *Service) revertSettlementDebtLinksTx(tx *gorm.DB, tsID uint, documentIDs []uint) error {
    for _, did := range documentIDs {
        var stillLinked int64
        tx.Model(&models.PaymentAllocation{}).
            Joins("JOIN payments p ON p.id = payment_allocations.payment_id "+
                "AND p.deleted_at IS NULL AND p.voided_at IS NULL AND p.tax_settlement_id = ?", tsID).
            Where("payment_allocations.document_id = ?", did).
            Count(&stillLinked)
        if stillLinked > 0 {
            continue
        }
        var stillLegacy int64
        tx.Model(&models.Payment{}).
            Where("document_id = ? AND tax_settlement_id = ? AND voided_at IS NULL", did, tsID).
            Count(&stillLegacy)
        if stillLegacy > 0 {
            continue
        }
        if err := s.UnlinkSettlementFromDocument(tx, did, tsID); err != nil {
            return err
        }
    }
    return nil
}
```

**`TaxSettlementLine`**: **se propone NO tocarla en este paso.** Razón: §21 del Blueprint define "el
vínculo deuda↔liquidación" explícitamente como `Document.tax_settlement_id` (tabla de fuentes de
verdad: *"Liquidación actual de una deuda | `Document.tax_settlement_id` (mutable)"*).
`TaxSettlementLine` es una estructura distinta (composición/detalle de la liquidación, usada para sus
totales `TotalHonorarios/TotalImpuestos/TotalGeneral`) que no tiene mecanismo hoy para recalcular esos
totales al quitar una sola línea fuera de los flujos ya existentes (`UpdateDraft`, `Emit`) — tocarla
aquí sí reabriría lógica de Fase 1/liquidaciones fuera del alcance de Fase 6. Queda como limitación
documentada: tras anular un pago, la `TaxSettlementLine` correspondiente puede seguir existiendo
apuntando a un documento ya desvinculado. **Esto es una decisión de diseño — ver sección E.1.**

### A.4 — Cancelación manual vs. cascadas automáticas

| Caller | `reason` | `userID` |
|---|---|---|
| Manual: `DELETE /api/payments/:id` | **Obligatorio**, nuevo campo en el body (`{"reason": "..."}`). Si viene vacío → 400. | `getUserID(c)` (ya disponible en el controller, mismo patrón que otros endpoints) |
| Cascada: `TaxSettlementService.Delete` | Sintetizado: `fmt.Sprintf("Liquidación #%d eliminada", ts.ID)` | El usuario que ejecuta el `DELETE /api/tax-settlements/:id` — requiere agregar `userID uint` a la firma de `Delete(id uint, userID uint) error` y threadearlo desde `DeleteAPI` vía `getUserID(c)` (hoy no se pasa, confirmado en el audit) |
| Cascada: `TaxSettlementService.RevertToDraft` | Sintetizado: `fmt.Sprintf("Liquidación #%d revertida a borrador", ts.ID)` | Igual: agregar `userID uint` a `RevertToDraft(id uint, userID uint) error` |

`revertSettlementPaymentsAndFiscal(tx, ts, reason, userID)` recibe `reason`/`userID` ya resueltos y
los pasa tal cual a cada `DeletePaymentTx(tx, pid, reason, userID)` del loop — un solo motivo
sintético para todos los pagos de esa cascada (no uno distinto por pago).

### A.5 — Atomicidad

Ya garantizada por construcción, sin mecanismo nuevo: `DeletePaymentTx` sigue recibiendo `tx *gorm.DB`
ya abierto por el llamador (`PaymentService.Delete` abre su propia `database.DB.Transaction(...)`;
`TaxSettlementService.Delete`/`RevertToDraft` ya envuelven todo el flujo, incluida la cascada, en su
propia transacción). El nuevo paso §19.5 corre dentro de la misma `tx` — si cualquier paso falla
(incluida la reversión del vínculo), toda la operación se revierte, incluido el `Updates` que marcaba
`voided_at`. No se introduce ninguna transacción anidada nueva.

### A.6 — Idempotencia y concurrencia

Reutiliza el lock `FOR UPDATE` que ya existe en la primera línea de `DeletePaymentTx` (Fase 2.5) — dos
solicitudes concurrentes de anular el mismo pago se serializan ahí exactamente igual que hoy
serializa un borrado concurrente con una asignación. La segunda, tras obtener el lock, ve
`p.VoidedAt != nil` (ya escrito por la primera) y corta inmediatamente sin repetir ningún efecto
secundario — verdadera idempotencia, no un best-effort.

```go
var ErrPaymentAlreadyVoided = errors.New("el pago ya fue anulado")
```

**Decisión abierta (ver E.2)**: qué hace cada capa superior al recibir `ErrPaymentAlreadyVoided`:
- Cascadas (§A.4, filas 2-3): tratarlo como no-error, `continue` al siguiente pago del loop — un
  reintento completo de `Delete`/`RevertToDraft` sobre una liquidación ya procesada no debe fallar.
- Endpoint manual (`DeleteAPI`): dos opciones razonables, se necesita tu decisión:
  - **Opción A (recomendada)**: 200 OK idempotente, `{"message": "El pago ya estaba anulado"}` — mismo
    espíritu que la idempotencia de `SaleClientRef` en Fase 5 (un reintento no es un error).
  - **Opción B**: 409 Conflict — trata un segundo intento como una condición a reportar (p. ej. dos
    administradores intentando anular el mismo pago casi a la vez, uno debería enterarse de que
    "alguien más ya lo hizo", no ver un éxito silencioso).

---

## B) ARCHIVOS A MODIFICAR / CREAR

| Archivo | Cambio |
|---|---|
| `backend/models/payment.go` | Agregar `VoidedAt`, `VoidedBy`, `VoidReason` a `Payment` (A.1) |
| `backend/services/payment_service.go` | Extender `DeletePaymentTx` (A.2); `Delete(id uint)` → `Delete(id uint, reason string, userID uint) error` |
| `backend/services/debt/settlement.go` | Nueva función `revertSettlementDebtLinksTx` (A.3) |
| `backend/services/debt/writeoff.go` | Nuevo chequeo de bloqueo en `WriteOffUnlinkedDebt` (sección C del pedido, ver abajo) |
| `backend/services/debt/financial_totals.go` | Filtro `voided_at IS NULL` en 3 de las 4 funciones (sección C.2) |
| `backend/services/debt/balance.go` | Filtro `voided_at IS NULL` en `PaidTotal` (`EffectiveBalance` no requiere cambio propio, ya delega) |
| `backend/services/tax_settlement_service.go` | `Delete`/`RevertToDraft` reciben `userID uint`; `revertSettlementPaymentsAndFiscal` recibe y propaga `reason`/`userID` (A.4) |
| `backend/controllers/payment_controller.go` | `DeleteAPI` exige `reason` en el body, lo pasa a `Delete()` |
| `backend/controllers/tax_settlement_controller.go` | `DeleteAPI`/`RevertToDraftAPI` obtienen `userID` vía `getUserID(c)` y lo pasan a `svc.Delete`/`svc.RevertToDraft` |
| `backend/services/payment_service_voiding_test.go` (nuevo) | Tests de sección D |

No se crean archivos de rutas nuevos — las 3 rutas existentes (`DELETE /payments/:id`,
`DELETE /tax-settlements/:id`, `POST /tax-settlements/:id/revert-to-draft`) se reutilizan tal cual,
solo cambia el body/comportamiento interno.

---

## C) MIGRACIÓN / COMPATIBILIDAD

### C.1 — Campos de `Payment`

Mecanismo: el mismo `AutoMigrate()` plano ya usado para `Purpose` (Fase 2.1) y `SaleClientRef` (Fase
5) — `models.Payment` ya está en la lista de `database/database.go:AutoMigrate()`; agregar los 3
campos al struct basta, GORM emite `ALTER TABLE payments ADD COLUMN ...` (nullable, sin `DEFAULT`
más que NULL/vacío) automáticamente al arrancar. Aditivo, no destructivo, sin downtime.

**No se requiere backfill.** A diferencia de `Purpose` (que sí necesitó un script de clasificación
retroactiva, `migratePaymentsPurposeBackfill`, porque representaba un concepto que ya existía
implícitamente en datos históricos), `VoidedAt/By/Reason` representa un evento nuevo: un pago
histórico que nunca fue anulado simplemente **queda `VoidedAt = NULL`**, que es su estado real y
correcto — no hay nada que inventar ni clasificar retroactivamente.

**Punto crítico de compatibilidad, verificado**: pagos ya soft-eliminados **antes** de este cambio
(vía el `DeletePaymentTx` actual, sin los campos nuevos) quedarán con `DeletedAt` ya fijado pero
`VoidedAt = NULL`. Esto **no causa ningún doble conteo ni fuga**: siguen excluidos por el scope
automático de GORM (`DeletedAt IS NULL`) en todo el sistema, y los nuevos filtros explícitos
`voided_at IS NULL` que se agregan en la sección C.2 son estrictamente redundantes (no contradictorios)
para esas filas — ya estaban excluidas por otra vía. **Decisión abierta**: ¿vale la pena, solo por
prolijidad de reportes futuros de auditoría, backfillear `VoidedAt = DeletedAt` para esas filas
históricas (sin inventar `VoidedBy`/`VoidReason`, que quedarían NULL/vacío por no tener esa
evidencia)? Ver E.3 — se recomienda **NO hacerlo** (no inventar datos, mismo principio ya aplicado en
Fase 4/5).

### C.2 — Cálculos financieros: ubicación exacta de `voided_at IS NULL`

```go
// financial_totals.go — DineroTotalRecibido
Where("company_id = ? AND voided_at IS NULL", companyID)   // antes: Where("company_id = ?", companyID)

// financial_totals.go — DineroAplicadoADeudas (JOIN)
Joins("JOIN payments p ON p.id = payment_allocations.payment_id "+
    "AND p.deleted_at IS NULL AND p.voided_at IS NULL AND p.company_id = ?", companyID)
    // se agrega "AND p.voided_at IS NULL" junto al ya existente "AND p.deleted_at IS NULL"

// financial_totals.go — DineroNoAplicado
Where("company_id = ? AND voided_at IS NULL AND (purpose IS NULL OR purpose = ?)",
    companyID, models.PaymentPurposeDebt)

// balance.go — PaidTotal (ambas ramas)
// fromAlloc:
Joins("JOIN payments p ON p.id = payment_allocations.payment_id AND p.deleted_at IS NULL AND p.voided_at IS NULL")
// fromLegacy:
Where("document_id = ? AND deleted_at IS NULL AND voided_at IS NULL", documentID)
```

`EffectiveBalance` (balance.go:94) **no requiere cambio propio** — delega 100% en `PaidTotal`, que ya
queda corregido arriba.

`SaldoDocumentado` — **sin cambios**, confirmado que no depende de `Payment` (según instrucción
explícita y ya así en el diseño de Fase 3).

---

## C.3) WRITE-OFF — bloqueo exigido por §20

En `WriteOffUnlinkedDebt` ([writeoff.go:23](../backend/services/debt/writeoff.go#L23)), **un solo
chequeo nuevo**, insertado inmediatamente después del ya existente `EffectiveBalance <= MoneyEpsilon`
(ese ya cubre la mitad de la condición del Blueprint, "balance_amount > 0" — solo falta la mitad de
"EXISTS PaymentAllocation > 0"):

```go
if s.EffectiveBalance(tx, &d) <= MoneyEpsilon {
    return nil, errors.New("la deuda no tiene saldo pendiente")
}
// NUEVO — Blueprint §20
hasAlloc, err := s.hasPaymentAllocations(tx, d.ID)
if err != nil {
    return nil, err
}
if hasAlloc {
    return nil, fmt.Errorf("la deuda %s tiene dinero ya aplicado (S/ %.2f) y aún saldo pendiente; "+
        "reasigne o gestione ese pago antes de exonerar/anular", d.Number, s.PaidTotal(tx, d.ID))
}
```

Reutiliza `hasPaymentAllocations` y `PaidTotal`, ambos ya existentes en el mismo paquete — cero lógica
duplicada, tal como exige el pedido.

**Punto para tu decisión (E.4)**: el texto literal del Blueprint §20 solo menciona `PaymentAllocation`.
El propio código de `settlement.go` (protección de borrado de Documents) siempre chequea **ambos**,
`hasPaymentAllocations` **y** `hasLegacyPayments` juntos, tratándolos como equivalentes ("existe un
pago registrado"). ¿Extiendo el bloqueo de write-off para cubrir también `hasLegacyPayments` (pagos
legacy vía `Payment.DocumentID` directo, sin `PaymentAllocation`), por consistencia con ese patrón ya
establecido? Recomendado: sí, por consistencia — pero lo señalo explícitamente porque excede la letra
literal del Blueprint y por eso no lo doy por decidido.

---

## D) TESTS DEL PASO 3

Paquete `services` (payment) + paquete `services/debt` (write-off), siguiendo el mismo patrón sqlite
`:memory:` + `TranslateError: true` + `SetMaxOpenConns(1)` ya usado en Fases 4-5.

**Cancelación de Payment:**
1. **Cancelación manual simple** — un Payment aplicado con 1 allocation → `DeletePaymentTx` con
   reason+userID → `VoidedAt/By/Reason` fijados, `DeletedAt` fijado, `PaymentAllocation` revertida,
   `Document.balance_amount` recalculado, `TukifacFiscalReceipt` (si estaba linked) vuelve a
   `pendiente_vincular`.
2. **Reason vacío rechazado** — `DeletePaymentTx(tx, id, "", uid)` → error, nada se modifica.
3. **Reversión del vínculo deuda↔liquidación (único pago)** — Payment con `TaxSettlementID` seteado
   que estableció `Document.tax_settlement_id` → al anular, `Document.tax_settlement_id` vuelve a
   `nil`.
4. **NO reversión si otro pago activo sostiene el vínculo** — dos Payments parciales con el mismo
   `TaxSettlementID` sobre el mismo Document → anular solo uno → `Document.tax_settlement_id` **se
   mantiene** (el otro pago sigue activo).
5. **Cancelación por cascada — `TaxSettlementService.Delete`** — liquidación `Issued` con 2 Payments →
   `Delete(id, userID)` → ambos Payments quedan `VoidedAt` con el mismo `VoidReason` sintético
   (`"Liquidación #N eliminada"`) y el mismo `VoidedBy`.
6. **Cancelación por cascada — `RevertToDraft`** — igual que 5 pero verificando que la liquidación
   queda en `Draft` con totales en 0 y los Payments anulados (no solo soft-deleted como hoy).
7. **Exclusión de pagos cancelados de los 4 cálculos** — un Payment `Purpose=servicio` anulado no debe
   contar en `DineroTotalRecibido`; un Payment `Purpose=deuda` con allocation, anulado, no debe contar
   en `DineroAplicadoADeudas` ni en `DineroNoAplicado`; verificar también `PaidTotal`/`EffectiveBalance`
   directamente.
8. **Idempotencia — reintento simple** — anular dos veces el mismo pago → segunda llamada devuelve
   `ErrPaymentAlreadyVoided`, cero efectos secundarios repetidos (mismo `VoidedAt`, no se vuelve a
   tocar `Document`/`TukifacFiscalReceipt`).
9. **Concurrencia** — 2 goroutines anulando el mismo pago simultáneamente (mismo patrón
   `sync.WaitGroup` + `SetMaxOpenConns(1)` de Fase 5) → una tiene éxito, la otra recibe
   `ErrPaymentAlreadyVoided`, nunca ambas tienen éxito, nunca ambas fallan con otro error.

**Write-off:**
10. **Bloqueado con allocation + saldo pendiente** — Document con `PaymentAllocation` parcial
    (`balance_amount > 0`) → `WriteOffUnlinkedDebt` devuelve error, `status`/`balance_amount` sin
    cambios.
11. **Permitido sin allocations** — Document abierto sin ningún pago → `WriteOffUnlinkedDebt` funciona
    igual que hoy (regresión, no debe romperse).
12. **Permitido tras liberar el dinero aplicado** — Document con allocation, se revierte esa
    allocation primero (p. ej. anulando el Payment que la generó, usando el mecanismo del punto 1) →
    ahora sí se puede exonerar/anular.

**Regresión obligatoria** (no nuevos, pero deben seguir en verde): los 5 tests de idempotencia POS de
Fase 5 Paso 2A, los 10 de integración Payment+comprobante de Fase 5 Paso 2B, los 11 de
`CreatePaymentWithComprobante` de Fase 4 — ninguno debería verse afectado por estos cambios (no tocan
`ApplyPaymentTx` ni `CreatePaymentWithComprobante`), pero se re-ejecutan igual como parte del Paso 3
para confirmarlo empíricamente, no solo por inspección.

---

## E) RIESGOS Y DECISIONES ABIERTAS (requieren tu aprobación antes de implementar)

**E.1 — `TaxSettlementLine` no se toca.** Al anular un pago se revierte `Document.tax_settlement_id`
pero la fila de `TaxSettlementLine` correspondiente puede quedar apuntando a un documento ya
desvinculado, sin corregirse. Recomendado dejarlo así en Paso 3 (evita reabrir lógica de totales de
liquidación) y documentarlo como limitación conocida. **¿Apruebas dejarlo así, o prefieres que se
elimine también esa `TaxSettlementLine` específica (con el riesgo de tocar código de totales de
liquidación fuera del alcance original de Fase 6)?**

**E.2 — Respuesta HTTP ante un reintento de anulación manual ya anulada.** Opción A (200 idempotente,
recomendada) vs Opción B (409 Conflict). **¿Cuál prefieres?**

**E.3 — Backfill opcional de `VoidedAt` para pagos ya soft-eliminados antes de Fase 6.** Recomendado
NO hacerlo (no inventar datos). **¿Confirmas que no se debe backfillear?**

**E.4 — Alcance del bloqueo de write-off: ¿solo `PaymentAllocation` (letra literal del Blueprint) o
también pagos legacy (`hasLegacyPayments`), por consistencia con el patrón ya usado en
`settlement.go`?** Recomendado incluir ambos. **¿Apruebas extenderlo, o prefieres ceñirte
estrictamente al texto del Blueprint (solo `PaymentAllocation`)?**

**E.5 — Riesgo de cambio de firma.** `PaymentService.Delete`, `TaxSettlementService.Delete` y
`TaxSettlementService.RevertToDraft` cambian de firma (nuevos parámetros obligatorios). Son funciones
internas (no hay más llamadores fuera de los ya identificados en el audit de Paso 1 y los controllers
correspondientes) — impacto controlado y ya mapeado en la sección B, pero se señala explícitamente
por ser un cambio de contrato de funciones existentes, no solo una adición.

**E.6 — El endpoint manual `DELETE /payments/:id` empieza a exigir `reason` en el body.** Esto es un
cambio de contrato de API (hoy no espera body). Cualquier cliente/frontend que lo invoque sin ese
campo empezará a recibir 400. Confirmado como fuera del alcance de este diseño tocar frontend — se
señala como impacto a coordinar antes de desplegar Paso 3, no una implementación pendiente de este
paso.

---

Ningún archivo de código fue modificado en este paso. A la espera de tu resolución de E.1-E.4 (E.5/E.6
son solo advertencias, no requieren una decisión distinta a "procede" o "ajusta") antes de pasar a
Fase 6 — Paso 3 (implementación).
