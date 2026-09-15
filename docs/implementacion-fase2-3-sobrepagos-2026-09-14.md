# Implementación Fase 2.3 — Sobrepagos con remanente

**Fecha**: 2026-09-14
**Alcance**: exclusivamente permitir `SUM(PaymentAllocation.amount) <= Payment.amount` (sin descuento) preservando el excedente como remanente derivado. Nada de `AllocateExisting`, locking, POS, UI, `Payment.Purpose`, `Payment.DocumentID` ni Fase 3.

---

## 1. Problema original

La validación central (`debt.ValidatePaymentAmountsAndAllocations`) exigía, sin descuento, `SUM(allocations) == Payment.amount` **exacto**. Un pago que cubría toda la deuda disponible y dejaba un remanente (ej. Deuda=700, Pago=1000) se rechazaba por completo con el error *"la suma de imputaciones debe igualar el monto del pago"*, obligando al usuario a reducir artificialmente el monto o partirlo en dos operaciones.

## 2. Causa raíz

Tres puntos coordinados producían el bloqueo:

1. `debt/payment_apply.go:110-112` (`ValidatePaymentAmountsAndAllocations`) — comparaba `sum == amount` con `math.Abs(...)  > MoneyEpsilon`.
2. `payment_service.go` (`buildFIFOAllocations`) — devolvía error explícito si `remaining > 0.005 && !allowPartial`, y `allowPartial` (`AllowUnallocatedRemainder`) **no está expuesto** en el body JSON de `POST /payments` (confirmado leyendo `PaymentController.CreateAPI`) — solo lo usan llamadores internos como la conciliación de comprobantes Tukifac.
3. `payment_service.go` (modo `single`, un documento vía `document_id`) — construía la imputación con `Amount: p.Amount` (el monto **completo** del pago), nunca capada al saldo real de la deuda, así que cualquier sobrepago de un solo documento fallaba en `ValidateAllocationsTx` por exceder el saldo del documento, antes incluso de llegar a la validación de suma.

## 3. Cambio realizado

### a) `debt/payment_apply.go` — `ValidatePaymentAmountsAndAllocations`
Sin descuento, la condición pasó de `sum == amount` a `sum <= amount` (con la misma tolerancia `MoneyEpsilon`):
```go
} else {
    if sum > amount+MoneyEpsilon {
        return errors.New("la suma de imputaciones no puede exceder el monto del pago")
    }
}
```
**Con descuento, la regla no cambió** — sigue exigiendo `amount+discount == sum` exacto y que cada línea cubra el saldo completo de su documento (ver §8).

### b) `payment_service.go` — `buildFIFOAllocations`
Se eliminó el `return nil, error` que disparaba únicamente por `remaining > 0.005 && !allowPartial`. Se conservó **sin cambios** el otro guard: `len(lines) == 0 && !allowPartial` (ninguna deuda encontrada en absoluto) sigue rechazándose exactamente igual que antes — ese caso es distinto (no hay nada que aplicar, no es un sobrepago) y queda fuera del alcance de esta fase.

### c) `payment_service.go` — modo `single` (un documento)
Sin descuento, la imputación ahora se capa al saldo disponible:
```go
allocAmount := p.Amount
if allocAmount > bal {
    allocAmount = bal
}
lines = []PaymentAllocationInput{{DocumentID: *p.DocumentID, Amount: allocAmount}}
```
Si `p.Amount <= bal`, el comportamiento es idéntico al de siempre (allocation = monto completo). Con descuento, sin cambios (sigue exigiendo `amount+discount == bal` exacto).

---

## 4. Comportamiento anterior vs. nuevo

| Escenario | Antes | Ahora |
|---|---|---|
| Deuda=700, Pago=1000 (FIFO o single) | ❌ Error, operación rechazada | ✅ Allocation=700, remanente=300, mismo Payment |
| Deuda=100, Pago=100 | ✅ Igual que siempre | ✅ Sin cambios |
| Deuda=100, Pago=60 (parcial) | ✅ Igual que siempre | ✅ Sin cambios |
| Deuda=100, Pago=150, Allocation=150 (sobre-imputar el documento) | ❌ Error | ❌ Sigue siendo error (sin cambios — ver §6) |
| FIFO sin ninguna deuda pendiente | ❌ Error (salvo `allowPartial`) | ❌ Sin cambios |

---

## 5. Reglas que siguen bloqueando sobre-imputaciones (§6/§14, verificadas con tests)

- `PaymentAllocation.amount > saldo efectivo del Document` → sigue rechazado (`ValidateAllocationsTx`, sin tocar).
- `SUM(allocations) > Payment.amount` → ahora explícitamente rechazado con el nuevo mensaje (antes también fallaba, por la condición `==`; ahora es intencional y más preciso).
- Imputación negativa o cero → sigue rechazada.
- Documento anulado → sigue rechazado.
- Documento de otra empresa → sigue rechazado.
- Documento ya vinculado a otra liquidación (`TaxSettlementID` distinto) → sigue rechazado.

Los 6 casos anteriores tienen test dedicado (`payment_apply_remainder_test.go`), todos confirmando que **siguen fallando exactamente igual que antes**.

---

## 6. Interacción con `allowPartial`

`allowPartial` (`PaymentCreateParams.AllowUnallocatedRemainder`) siguió significando exactamente lo mismo que antes: *"si no se encuentra ninguna deuda pendiente en absoluto, registrar el pago igual como `on_account` en vez de fallar"*. Esa semántica **no se tocó**. Lo que cambió es que ya no hace falta activar ese flag para el caso intermedio (sí hay deuda, pero es insuficiente) — ese caso ahora funciona siempre, para cualquier llamador, porque dejó de depender de un flag que de todas formas no está expuesto en la API pública.

## 7. Interacción con descuentos

Verificado explícitamente con test (`TestOverpayment_DiscountStillRequiresExactMatch`): un pago con descuento sigue exigiendo que `amount + discount == sum(allocations)` exacto, y que cada línea cubra el saldo completo de su documento. **No se detectó ninguna contradicción** que obligara a tocar esta lógica — el descuento y el remanente son conceptualmente incompatibles en el diseño actual (el descuento presupone que la deuda se cierra por completo), así que no había nada que resolver ahí.

---

## 8. Tests agregados (26 nuevos)

- `backend/services/debt/payment_apply_remainder_test.go` (17 tests) — motor `ApplyPaymentTx`/`ValidatePaymentAmountsAndAllocations` directamente: los 10 casos pedidos en la instrucción (pago exacto, parcial, sobrepago simple, sobrepago multi-deuda, pago mucho mayor a la deuda, rechazo de sobre-imputación del documento, rechazo de allocation>payment, preservación de `Payment.amount`, documento correctamente pagado) más los 6 casos de "debe seguir fallando" (negativa, cero, anulado, otra empresa, otra liquidación) y la regresión de descuentos.
- `backend/services/payment_service_overpayment_test.go` (5 tests) — mismos escenarios centrales pero a través de la API pública real (`CreateFromParams`, modos `fifo`/`single`/`manual`), incluyendo el ejemplo principal exacto de la instrucción (Deuda=700, Pago=1000 vía FIFO) y la confirmación de que **no** se crea un segundo `Payment` ni un `Document` artificial para el remanente.

---

## 9. Limitaciones que quedan para fases futuras (documentadas, no implementadas)

- **Fase 2.4 (`AllocateExisting`)**: un pago `on_account` puro (sin ninguna deuda al momento de crearse) sigue sin poder aplicarse después a una o varias deudas sin borrarlo y recrearlo — Fase 2.3 no tocó esto, solo resolvió el sobrepago en el momento de la creación.
- **Fase 2.5 (locking)**: la auditoría de Fase 2 ya documentó que `ValidateAllocationsTx`/`ApplyPaymentTx`/`PersistBalanceAndStatus` no usan `SELECT ... FOR UPDATE`. Fase 2.3 no introduce ni corrige esto — el riesgo de doble aplicación concurrente sigue exactamente igual que antes, documentado pero no implementado (tal como se instruyó explícitamente).
- **Exposición de `allow_unallocated_remainder` en la API**: no fue necesario tocar el controlador para resolver Fase 2.3 (el fix vive enteramente en la capa de validación/servicio), así que `PaymentController.CreateAPI` sigue sin exponer ese campo — se deja como nota, no como dependencia bloqueante, ya que el caso que antes lo necesitaba (deuda insuficiente) ya no depende de él.
