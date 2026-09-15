# Fase 4 — Paso 1: Auditoría de Comprobantes + Payments

Fecha: 2026-09-15
Estado: **auditoría únicamente — sin cambios de código, sin commit**
Fuente principal: [docs/blueprint-financiero-definitivo-2026-09-14.md](blueprint-financiero-definitivo-2026-09-14.md) §4, §15-18, §26, §30
Commit base: `44b0950` (Fase 3 cerrada)

---

## 1. Resumen ejecutivo

El flujo `issued_local` actual **no es** "Payment + comprobante nacen juntos" como sugiere la lectura superficial del Blueprint — es exactamente lo opuesto: **el `Payment` debe existir de antemano** (ya aplicado, con `PaymentAllocation`s) y el comprobante se emite **después**, en un paso separado, vinculándose al pago existente. Esto es coherente con el uso real (Finanzas cobra una deuda, y opcionalmente emite boleta/factura por esa cobranza ya registrada) pero significa que **`IssueComprobanteFromPayment` no es directamente reutilizable como motor para POS**, donde el Payment todavía no existe en el momento de la venta.

El hallazgo más crítico: **`Payment.Purpose` no se asigna en ningún flujo de creación de Payment vigente hoy** (ni en `CreateFromParams`, ni en `ApplyPaymentTx`, ni en `CreatePaymentFromReceipt`) — el campo solo se pobló, una vez, en la migración histórica de backfill (Fase 2.1/2.2). Todo Payment nuevo creado desde entonces nace con `Purpose = NULL`. Esto es exactamente lo que el propio Blueprint anticipó como dependencia no resuelta ("Fase 2.6... no bloquea Fase 2.4, pero sí determina cuántos pagos nuevos quedarán elegibles... hoy, sin Fase 2.6, todo pago nuevo nace con Purpose=NULL") — **confirmado que sigue sin resolverse**, y es un bloqueante real para que POS pueda nacer con `purpose=servicio` como pide el Blueprint §17.

El segundo hallazgo crítico, ya anticipado por el propio Blueprint como bug (§26): **POS (`IssuePosSale`) nunca crea un `Payment`** — solo crea `TukifacFiscalReceipt` + líneas + `FiscalReceiptPayment` (desglose), dejando el comprobante en `pending_vincular` indefinidamente hasta una reconciliación manual posterior (compartiendo el mismo camino genérico que usan los comprobantes importados de Tukifac). Confirmado, código en mano, que el bug sigue exactamente como lo describe el Blueprint.

---

## 2. Flujo actual completo de `issued_local`

**Entrada única**: `PaymentController.IssueComprobanteAPI`/`IssueTukifacAPI` → `FiscalReceiptIssueService.IssueComprobanteFromPayment(paymentID, in)` (`services/fiscal_receipt_issue_service.go:48-242`).

```
Finanzas ya registró y aplicó un Payment (ApplyPaymentTx, con PaymentAllocation)
        │
        ▼
POST /payments/:id/issue-comprobante  { kind, series_id, ... }
        │
        ▼
IssueComprobanteFromPayment(paymentID, in):
  1. Valida kind (boleta|factura|sale_note) y que la serie coincida con el SUNAT code esperado.
  2. Carga el Payment YA EXISTENTE (Preload Allocations.Document.Items, TaxSettlement).
  3. EXIGE pay.Type == "applied" && len(pay.Allocations) > 0  ← rechaza si no hay allocations
  4. Si el pago está ligado a una liquidación, exige que esté 'emitida'.
  5. Verifica que SUM(allocations) == pay.Amount (± descuento, tolerancia 0.03).
  6. Reserva correlativo local (ReserveNextNumber, ya con locking FOR UPDATE — Fase 2.5-style).
  7. Construye líneas del comprobante desde las Allocations (BuildReceiptLinesFromPayment).
  8. TRANSACCIÓN: crea TukifacFiscalReceipt + líneas + 1 FiscalReceiptPayment (snapshot del método
     de pago) + fija LinkedPaymentID = pay.ID + ReconciliationStatus = Linked + actualiza
     Payment.FiscalStatus = "linked".
  8. Retorna el detalle enriquecido del comprobante.
```

**Dónde nace el Payment**: en un paso previo y completamente separado — vía `ApplyPaymentTx` (Finanzas registrando un cobro normal) o vía `CreateFromParams`. `IssueComprobanteFromPayment` **nunca crea un Payment**, solo lo consume.

**Dónde nace el comprobante**: en `IssueComprobanteFromPayment`, siempre y exclusivamente después del Payment.

**¿Misma transacción?**: la creación de `TukifacFiscalReceipt` + líneas + `FiscalReceiptPayment` + el `LinkedPaymentID` + `Payment.FiscalStatus` sí ocurren en **una única transacción** (`database.DB.Transaction(...)`, líneas 200-232). Pero esa transacción **nunca incluye la creación del Payment** — el Payment ya existe de una transacción previa y distinta.

**`Payment.amount`/`Method`/`Reference`**: no se determinan aquí — se **leen** del Payment ya existente (`pm := pay.Method`, `PaymentReference: pay.Reference`, `Total: total` derivado de las líneas/allocations, verificado contra `pay.Amount`).

**`Payment.Purpose`**: no se toca en absoluto en este archivo (confirmado por búsqueda: cero menciones de `Purpose` en `fiscal_receipt_issue_service.go`). El Purpose del pago ya existente (si lo tiene) permanece como estaba.

**`Payment.Type`**: exigido `"applied"` como precondición, nunca escrito aquí.

**`linked_payment_id`**: se escribe una sola vez, dentro de la transacción (línea 222), nunca se limpia ni se reasigna en este flujo.

**Estado intermedio `pendiente_vincular`**: NO aplica a este flujo — el comprobante nace directamente `Linked` (nunca pasa por `Pending`), porque el Payment ya existía y se vincula en el mismo `Create`.

**Si falla la creación del Payment**: no aplica — el Payment es una precondición, no un efecto de esta función.

**Si falla la creación del comprobante**: la transacción hace rollback completo (ninguna línea, snapshot ni vínculo persiste); el Payment permanece exactamente como estaba antes (con su `FiscalStatus` previo).

**Si falla el vínculo**: el vínculo (`LinkedPaymentID`) se escribe **dentro de la misma transacción** que crea el comprobante — no hay ventana donde el comprobante exista sin vínculo en este flujo específico.

**¿Puede quedar un comprobante sin Payment?**: NO, en este flujo — el vínculo es atómico con la creación.

**¿Puede quedar un Payment sin comprobante?**: SÍ, y es el caso normal — la mayoría de cobros no emiten comprobante inmediatamente (o nunca).

**¿Se crea `Document` artificial?**: NO — no hay ningún `models.Document{}` en este archivo.

**¿Se crean `PaymentAllocation`?**: NO — las allocations ya existían (eran precondición); este flujo solo las lee para construir las líneas del comprobante.

**¿Qué representa el flujo?**: **exclusivamente deuda ya cobrada** (`pay.Type=="applied"` + allocations obligatorias) — no puede representar "servicio independiente" ni "pago a cuenta" (ambos casos tienen 0 o pago sin aplicar, lo que esta función rechaza explícitamente en el paso 3).

---

## 3. Flujo actual de nota de venta (`DocumentTypeID = NV`)

Se emite con `kind = "sale_note"` a través de **dos motores distintos** según el origen:

- **Vía Finanzas** (`IssueComprobanteFromPayment`, arriba): requiere Payment aplicado con allocations — es decir, hoy una "nota de venta" emitida desde Finanzas representa **deuda ya cobrada**, no un servicio independiente. `docType` se fuerza a `"NV"` cuando `kind=="sale_note" && ser.SunatCode=="00"` (línea 117-119) — confirmado: usa una serie cuyo `SunatCode` real es `"00"` (sin código SUNAT fiscal), y el `DocumentTypeID` guardado se sobrescribe a `"NV"` — **no se declara a SUNAT**, coincide con el Blueprint.
- **Vía POS** (`IssuePosSale`, más abajo): mismo mecanismo de `docType`, pero **sin ningún Payment** en absoluto.

**¿Genera Payment?**: vía Finanzas, no (usa uno existente); vía POS, no (nunca, en ningún kind).
**¿Se enlaza con Payment?**: vía Finanzas, sí, siempre (obligatorio); vía POS, no, nunca (nace `pending_vincular`, `LinkedPaymentID = nil`).
**¿Genera Document?**: no, en ningún caso.
**¿Representa servicio independiente?**: vía Finanzas, NO (representa deuda cobrada, contradice la intuición del nombre "nota de venta" pero es lo que hace el código); vía POS, presumiblemente sí en la intención de negocio, pero el código no lo formaliza con `Purpose` (no hay Payment que clasificar todavía).
**¿Qué ocurre si luego piden boleta/factura?**: no existe ningún flujo de "reemisión"/"upgrade" — ver §6.

**Contraste con el Blueprint**: el Blueprint (§16-17) da a entender que "nota de venta" es el patrón típico de **POS** (servicio independiente). El código real muestra que **el mismo `kind=sale_note` sirve para dos escenarios de negocio completamente distintos** (deuda cobrada por Finanzas vs. venta POS), diferenciados únicamente por qué motor los invoca, no por ningún campo explícito en el comprobante. Es una imprecisión del Blueprint respecto al código actual — **no una contradicción de reglas**, sino una diferencia entre la intuición del nombre del documento y su uso real hoy.

---

## 4. Flujo actual de boleta/factura (`DocumentTypeID = 03 / 01`)

**Vía Finanzas**: exactamente el mismo motor `IssueComprobanteFromPayment`, solo cambia `kind` (`"boleta"`/`"factura"`) y la serie exigida (`SunatCode` `"03"`/`"01"`). El Payment existe **antes** del comprobante siempre — nunca al revés en este flujo.

**Vía POS**: mismo `IssuePosSale`, mismo problema — nunca crea Payment.

**¿Duplicación en reemisión?**: no existe ningún guard que impida llamar `IssueComprobanteFromPayment` dos veces con el mismo `paymentID` (para, p. ej., primero emitir `sale_note` y luego `boleta` sobre el mismo pago). Cada llamada reserva un correlativo nuevo y crea una fila `TukifacFiscalReceipt` nueva, ambas con el mismo `LinkedPaymentID`. **No hay restricción de unicidad en `linked_payment_id`** (solo `gorm:"index"`, no `uniqueIndex`). Esto **coincide, por efecto colateral y no por diseño explícito**, con la regla del Blueprint ("mismo Payment de respaldo... no genera un segundo ingreso") — el dinero sigue siendo el mismo `Payment.amount`, dos comprobantes no duplican ingreso. Pero es un comportamiento no gobernado: nada distingue "reemisión intencional" de "doble clic accidental", ambos producen el mismo resultado técnico (dos filas de comprobante, cero impacto financiero, pero ruido operativo/auditoría).

---

## 5. Relación comprobante ↔ Payment ↔ PaymentAllocation

Se respeta la jerarquía del Blueprint en el código real: `TukifacFiscalReceipt.LinkedPaymentID` apunta a `Payment`; `Payment` nunca reduce una deuda por existir (confirmado: ninguna de las funciones aquí auditadas toca `Document.balance_amount` directamente; el único camino que lo hace es `PersistBalanceAndStatus`, invocado exclusivamente desde `ApplyPaymentTx`/`AllocateExistingPaymentTx`, no desde el código de comprobantes). El comprobante nunca sustituye al registro financiero — `IssueComprobanteFromPayment` **lee** `pay.Amount` para construir el total del comprobante, nunca al revés.

---

## 6. Estado de `linked_payment_id`

| Escritor | Cuándo | Valida empresa | Riesgo |
|---|---|---|---|
| `IssueComprobanteFromPayment` (`fiscal_receipt_issue_service.go:222`) | Al emitir desde un Payment ya aplicado | Implícito — `rec.CompanyID` se toma del propio `pay.CompanyID`, mismo origen, no puede cruzar empresas | Ninguno |
| `FiscalReceiptService.CreatePaymentFromReceipt` (`fiscal_receipt_service.go:177`) | Al crear un Payment nuevo desde un comprobante pendiente (reconciliación tukifac_sync/pos_sale) | Implícito — el nuevo Payment se crea con `CompanyID: rec.CompanyID` | Ninguno |
| `FiscalReceiptService.LinkReceiptToPayment` (`fiscal_receipt_service.go:212`) | Vínculo manual a un Payment ya existente | **Explícito**: `if pay.CompanyID != rec.CompanyID { return error }` | Ninguno — validación presente |
| `FiscalReceiptService.DiscardFiscalReceipt` (`fiscal_receipt_service.go:257`) | Al descartar (`LinkedPaymentID = nil`) | N/A (desvincula) | Ninguno |
| `FiscalReceiptService.LinkIssuedReceiptToPayment` (`fiscal_receipt_service.go:266`) | — | **Sin callers en todo el repo — código muerto** | No aplica hoy; si se conectara en el futuro sin agregar el check de empresa, sería un riesgo latente (no lo tiene) |

**¿Nullable?** Sí (`*uint`). **¿Puede cambiar?** Sí, se limpia en `DiscardFiscalReceipt`; no se reasigna a otro Payment una vez vinculado en ningún flujo vigente (`LinkReceiptToPayment` exige `ReconciliationStatus == Pending` antes de vincular, bloqueando re-vincular uno ya `Linked`). **¿Riesgo de cruzar empresas?** No, en los caminos activos — el único camino sin check explícito es código muerto. **¿Riesgo de duplicar vínculos?** `LinkReceiptToPayment` sí lo previene (`linkCount>0` → error si el Payment ya está en OTRO comprobante); `IssueComprobanteFromPayment` NO lo previene (ver §4, efecto colateral inofensivo financieramente). **¿Riesgo de Payment huérfano?** No se identificó ningún camino que deje un Payment "colgado" sin comprobante de forma anómala — un Payment sin comprobante es el estado normal y esperado (mayoría de cobros).

---

## 7. Estado de `Payment.Purpose`

**Hallazgo central de esta auditoría**: búsqueda exhaustiva de `Purpose` en `payment_service.go`, `fiscal_receipt_service.go`, `fiscal_receipt_issue_service.go`, `pos_sale_service.go` → **cero coincidencias**. `PaymentCreateParams` (la única vía pública de creación general de pagos) **no tiene campo `Purpose`** — confirmado leyendo su definición completa (`payment_service.go:30-49`). `ApplyPaymentTx` tampoco lo fija (confirmado en fases anteriores). El único lugar del repo que escribe `Purpose` es la migración de backfill histórico (`payment_migrations.go`, ejecutada una sola vez, Fase 2.1/2.2), que exclusivamente clasifica pagos **preexistentes** en el momento del primer arranque tras esa migración.

**Consecuencia verificada**: todo `Payment` creado desde entonces (incluyendo `CreatePaymentFromReceipt`, es decir cualquier reconciliación de un comprobante Tukifac o POS pendiente) nace con `Purpose = NULL`. Esto **no es una inferencia incorrecta** (no se está "adivinando" nada activamente) — es, literalmente, la ausencia total de la funcionalidad que el propio Blueprint nombra como "Fase 2.6" y nunca fue implementada.

**GAP** 🟡 (no bloqueante para Fase 4, pero **bloqueante para Fase 5** tal como está diseñada en el Blueprint §17, que exige "Payment (purpose=servicio por default...)"): no existe ningún parámetro para fijar `Purpose` al crear un Payment por ninguna vía pública hoy.

**Efecto colateral verificado**: cualquier Payment recién creado por estos caminos queda **inmediatamente bloqueado** para `AllocateExistingPaymentTx` (Fase 2.4), que exige `Purpose != nil && Purpose == "deuda"` — un pago a cuenta reconciliado hoy desde un comprobante no puede aplicarse después a una deuda sin antes clasificarlo manualmente (vía SQL directo; no existe todavía una UI/endpoint para "clasificar Purpose de un pago existente").

---

## 8. Estado de `Payment.Type`

Se mantiene con su semántica mecánica exclusiva (`applied`/`on_account`) en todos los flujos auditados. `IssueComprobanteFromPayment` lo **exige** como precondición (`applied`) pero nunca lo escribe. `CreatePaymentFromReceipt` lo fija explícitamente a `"applied"` (línea 159 de `fiscal_receipt_service.go`) porque siempre pasa `Allocations`/`AllowUnallocatedRemainder: true` — coherente con "se está aplicando dinero a deuda(s), con posible remanente". Ningún código confunde `Type` con `Purpose` — no se encontró ningún condicional que use `Type` para decidir algo que debería depender de `Purpose`, ni viceversa. La separación se respeta correctamente en el código auditado.

---

## 9. Estado de `Payment.DocumentID` (legacy)

Cero escrituras de `DocumentID` en los tres archivos de comprobantes/POS auditados. `CreatePaymentFromReceipt` construye `PaymentCreateParams` sin fijar `DocumentID` (queda `nil`). `IssueComprobanteFromPayment` no crea Payment. `IssuePosSale` no crea Payment. **Ningún flujo nuevo relacionado con comprobantes escribe el campo legacy** — coincide con la decisión de Fase 2.4.

---

## 10. Estado de `fiscal_receipt_payments`

- **Quién los crea**: `IssueComprobanteFromPayment` crea exactamente **1** fila (snapshot del método/monto del Payment ya existente, línea 211-220); `IssuePosSale` crea **N** filas (una por cada método de pago dividido, vía `normalizePosPayments`, líneas 330 y 389-395).
- **¿Soportan pagos divididos?**: sí, estructuralmente (es un array de líneas por comprobante) — usado activamente en POS, usado como snapshot único (1 fila) en `issued_local`.
- **¿Coinciden con `Payment.Method`/`Reference`?**: en `issued_local`, sí por construcción — la única fila usa exactamente `pay.Method`/`pay.Reference`. En POS, **no puede compararse** porque no existe ningún `Payment` con el que contrastar — el desglose de `fiscal_receipt_payments` es, hoy, la **única** fuente de qué métodos de pago se usaron en una venta POS, hasta que (si acaso) se reconcilie manualmente después.
- **¿Duplicación de información?**: no se detectó una segunda fuente independiente — `TukifacFiscalReceipt.PaymentMethod`/`Reference` (cabecera) se calculan una sola vez (`normalizePosPayments` para POS; `pay.Method`/`pay.Reference` directo para `issued_local`) y se guardan tanto en la cabecera como en el detalle, desde el mismo cálculo — no hay dos escrituras independientes que puedan divergir en los flujos actuales.

---

## 11. Atomicidad transaccional

| Operación | Transacción | Riesgo de estado inconsistente |
|---|---|---|
| `IssueComprobanteFromPayment` | Una transacción cubre comprobante+líneas+snapshot+vínculo+`FiscalStatus` | **Ninguno** — todo o nada |
| `IssuePosSale` | Una transacción cubre comprobante+líneas+`FiscalReceiptPayment`s | Ninguno para lo que crea — pero no crea Payment, así que "atómico" aquí no incluye el dinero |
| `CreatePaymentFromReceipt` | 🔴 **NO transaccional**: `pay.CreateFromParams(...)` corre y confirma su propia transacción interna; **después**, por separado, `database.DB.Save(&rec)` actualiza el comprobante | **Real**: si `Save(&rec)` falla tras crear el Payment con éxito, queda un Payment activo, con allocations reales, y un comprobante que sigue en `pending_vincular` sin saberlo — un "Payment huérfano de comprobante" que además ya movió dinero real (allocations ya aplicadas) |
| `LinkReceiptToPayment` | 🔴 **NO transaccional**: `database.DB.Save(&pay)` (fija `FiscalStatus=linked`) y luego `database.DB.Save(&rec)`, dos sentencias sueltas | Si la segunda falla, el Payment queda marcado `linked` pero el comprobante sigue `Pending` sin `LinkedPaymentID` — inconsistencia de estado, sin impacto en el dinero (no toca allocations) |

**Conclusión**: `IssueComprobanteFromPayment` e `IssuePosSale` son atómicos para lo que hacen. **Las dos rutas de reconciliación manual (`CreatePaymentFromReceipt`, `LinkReceiptToPayment`) NO son atómicas** — es un hallazgo real, no documentado en fases anteriores, y directamente relevante para Fase 5 (si el diseño de POS reutiliza o se inspira en estas rutas de reconciliación en vez de en `IssueComprobanteFromPayment`/`IssuePosSale`, heredaría este mismo defecto).

---

## 12. Validación de Company/Tenant

Verificado explícitamente en `LinkReceiptToPayment` (`pay.CompanyID != rec.CompanyID`). En el resto de los flujos, la empresa del comprobante **se deriva siempre** de la empresa del Payment o del cliente seleccionado en el mismo request — no hay ningún camino donde `CompanyID` del comprobante y del Payment provengan de fuentes independientes sin comparación, salvo la función muerta `LinkIssuedReceiptToPayment` (sin callers, sin riesgo real hoy). **No se encontró ningún escenario reproducible de "Company A comprobante + Company B Payment".**

---

## 13. Riesgos de duplicación de dinero

- **Dos Payments por la misma operación**: no se encontró ningún camino que cree 2 Payments para la misma venta/cobro — cada flujo de creación de Payment (`CreateFromParams`, `ApplyPaymentTx`, `CreatePaymentFromReceipt`) es independiente y no se invoca en cadena entre sí para la misma operación.
- **Payment + Document artificial**: no ocurre — ningún flujo de comprobantes crea `Document`.
- **Doble Payment por reemisión**: no ocurre — reemitir comprobante (§4) no crea un segundo Payment, reutiliza `linked_payment_id` hacia el mismo.
- **Payment desde comprobante + otro Payment desde POS**: no aplica hoy — POS no crea Payment en absoluto; si alguien reconcilia manualmente un comprobante POS pendiente (`CreatePaymentFromReceipt`), se crea exactamente 1 Payment, no 2.
- **`fiscal_receipt_payments` como fuente de ingreso paralela**: no ocurre — ningún cálculo financiero (confirmado en Fase 3) suma `fiscal_receipt_payments.amount`; todas las funciones oficiales de Fase 3 (`SaldoDocumentado`, `DineroTotalRecibido`, `DineroAplicadoADeudas`, `DineroNoAplicado`) leen exclusivamente `Payment`/`PaymentAllocation`/`Document`.

**Sin riesgos de duplicación de dinero detectados** en el código actual.

---

## 14. Matriz Blueprint vs. implementación

| # | Regla del Blueprint | Implementación actual | Estado | Clasificación |
|---|---|---|---|---|
| 1 | Comprobante no sustituye al Payment; dinero se cuenta desde Payment | `IssueComprobanteFromPayment` lee `pay.Amount`, nunca al revés; Fase 3 confirma que ningún cálculo usa `TukifacFiscalReceipt.Total` como dinero | ✅ Correcto | — |
| 2 | Payment no reduce deuda por existir, solo PaymentAllocation | Ningún código de comprobantes toca `balance_amount` directamente | ✅ Correcto | — |
| 3 | Nota de venta documenta la operación, no se declara a SUNAT | `docType` forzado a `"NV"`, serie con `SunatCode="00"` | ✅ Correcto | — |
| 4 | Nota de venta debe enlazarse al Payment cuando corresponde a un cobro | Vía Finanzas sí (obligatorio); vía POS no (nunca hay Payment que enlazar) | 🟡 Gap (vía POS) | No bloqueante para Fase 4, bloqueante para Fase 5 |
| 5 | Reemisión (boleta tras nota de venta) usa el mismo Payment de respaldo, no genera segundo ingreso | Funciona por ausencia de restricción, no por diseño explícito — sin guard ni distinción de intención | 🟡 Gap no bloqueante | Riesgo operativo bajo (ruido, no dinero) |
| 6 | Purpose se fija explícitamente al crear el Payment, nunca se infiere | **No se fija en ningún flujo de creación vigente** — todo pago nuevo nace `Purpose=NULL` | 🔴 Bug/gap real | **Bloqueante para Fase 5** tal como está diseñada (§17 exige `purpose=servicio` por defecto) |
| 7 | `Type` = mecánico, `Purpose` = de negocio, sin confundirse | Separación respetada en todo el código auditado | ✅ Correcto | — |
| 8 | `DocumentID` legacy no se usa para escrituras nuevas | Confirmado, cero escrituras en comprobantes/POS | ✅ Correcto | — |
| 9 | `fiscal_receipt_payments` = desglose operativo, cabecera = resumen, sin duplicar fuente de verdad | Confirmado, una sola fuente de cálculo alimenta ambos | ✅ Correcto | — |
| 10 | POS: comprobante + Payment + vínculo en la misma transacción | POS **nunca crea Payment** | 🔴 Bug (ya identificado por el propio Blueprint §26) | **Bloqueante para Fase 5** |
| 11 | Vínculo comprobante↔Payment respeta tenant/company | Validado explícitamente donde importa; sin riesgo reproducible | ✅ Correcto | — |
| 12 | Reconciliación manual (`CreatePaymentFromReceipt`/`LinkReceiptToPayment`) | Ambas **no transaccionales** — hallazgo nuevo de esta auditoría | 🔴 Bug (no documentado antes) | Relevante si Fase 5 reutiliza estas rutas |

---

## 15. Escenarios A-G trazados

- **A. Servicio independiente pagado al instante**: **no ocurre hoy tal como lo describe el Blueprint**. POS crea el comprobante pero ningún Payment — el "ingreso independiente" queda incompleto (sin `Payment`, sin `Purpose`, sin `linked_payment_id`) hasta una reconciliación manual posterior, que tampoco fija `Purpose`.
- **B. Deuda pagada**: funciona correctamente vía Finanzas (`ApplyPaymentTx` + `IssueComprobanteFromPayment` opcional después).
- **C. Pago a cuenta**: funciona a nivel de `Payment`/`PaymentAllocation` (Fase 2.3/2.4), pero **no puede emitir comprobante `issued_local`** mientras no tenga allocations (la función lo rechaza explícitamente) — coherente con el Blueprint (un pago a cuenta sin aplicar no debería tener comprobante todavía).
- **D. Sobrepago**: `IssueComprobanteFromPayment` exige `SUM(allocations) ≈ pay.Amount` (±0.03) — un pago con remanente sin aplicar **no puede emitir comprobante por el monto total** hasta que el remanente se aplique o se decida qué hacer con él. Coherente, no es un bug.
- **E. Nota de venta → posterior boleta/factura**: técnicamente posible sin duplicar dinero (§4), pero sin ningún flujo dedicado — sería 2 llamadas manuales a `IssueComprobanteFromPayment` con el mismo `paymentID`.
- **F. Comprobante sin Payment**: **sí ocurre y es el estado normal transitorio** para `pos_sale` y `tukifac_sync` (`ReconciliationStatus=Pending`) — por diseño, a la espera de reconciliación.
- **G. Payment sin comprobante**: **sí, es válido y es el caso mayoritario** — la mayoría de cobros de liquidación nunca emiten comprobante local.

---

## 16-17. Reutilizable para POS / qué debe cambiar antes de Fase 5

**Reutilizable directamente**:
- `BuildReceiptLinesFromPayment` / construcción de líneas y snapshot (`buildDebtPaymentContextSnapshot`) — genérico, no depende del orden de creación.
- El patrón transaccional de `IssueComprobanteFromPayment` (comprobante+líneas+snapshot+vínculo en una sola `database.DB.Transaction`) — es el patrón correcto a replicar, no el código en sí (porque asume Payment preexistente).
- `normalizePosPayments` (ya usado por POS) para construir el método/referencia de cabecera — el Blueprint (§18) ya pide reutilizar exactamente este cálculo para poblar `Payment.Method`/`Reference` cuando nazcan juntos.
- `FiscalDocumentSeriesService.ReserveNextNumber` (ya con locking, Fase 2.5-compatible).

**NO reutilizable tal cual, debe adaptarse o construirse de nuevo**:
- `IssueComprobanteFromPayment` en sí — su precondición ("Payment ya aplicado con allocations") es incompatible con POS (Payment no existe todavía). Fase 5 necesita una función nueva, con el orden invertido: crear `Payment` (con `Purpose` explícito) **dentro** de la misma transacción que crea el comprobante, no reutilizar esta función.
- Los flujos de reconciliación (`CreatePaymentFromReceipt`/`LinkReceiptToPayment`) — no son atómicos (§11); no deben ser el patrón de referencia para "nacer juntos", aunque puedan seguir sirviendo para reconciliar comprobantes que de verdad nazcan sin Payment (casos `tukifac_sync` reales, fuera del control del sistema).

**Debe cambiar antes de Fase 5** (bloqueante):
1. `PaymentCreateParams` necesita poder recibir `Purpose` explícito (hoy no existe el campo) — sin esto, POS no puede cumplir "Payment (purpose=servicio por default)".
2. Definir la función nueva de "crear Payment + comprobante juntos" (no existe hoy ninguna, ni siquiera parcialmente) — es 100% trabajo nuevo de Fase 5, no una migración de código existente.

---

## 18. Bugs encontrados

- 🔴 POS nunca crea `Payment` (ya identificado por el Blueprint, confirmado con código).
- 🔴 `CreatePaymentFromReceipt` y `LinkReceiptToPayment` no son transaccionales — riesgo real de estado inconsistente entre Payment y comprobante si falla el segundo `Save` (hallazgo nuevo de esta auditoría, no documentado en fases anteriores).

## 19. Gaps encontrados

- 🟡 `Payment.Purpose` nunca se fija en ningún flujo de creación vigente (Fase 2.6 nunca implementada) — confirmado que sigue pendiente.
- 🟡 Reemisión de comprobante (nota de venta → boleta) funciona por ausencia de restricción, no por diseño — sin guard explícito ni distinción de intención.
- 🟡 `IssueComprobanteFromPayment` no previene múltiples comprobantes para el mismo `paymentID` (mismo efecto que el punto anterior).
- 🟡 No existe endpoint/UI para clasificar `Purpose` de un pago ya existente sin `Purpose` — necesario dado el hallazgo del punto anterior, para poder usar `AllocateExisting` sobre pagos históricos/reconciliados.

## 20. Refactors recomendados (no urgentes)

- 🔵 Envolver `CreatePaymentFromReceipt` y `LinkReceiptToPayment` en `database.DB.Transaction(...)` — mismo patrón ya usado en `IssueComprobanteFromPayment`/`IssuePosSale`, cierra el hallazgo de atomicidad sin cambiar comportamiento observable en el caso feliz.
- 🔵 Eliminar `LinkIssuedReceiptToPayment` (código muerto, sin callers) o documentarlo explícitamente como reservado para uso futuro.

---

## 21. Recomendación de diseño para el siguiente paso de Fase 4

El siguiente paso de Fase 4 (aún de diseño, no implementación) debería formalizar:
1. Agregar `Purpose *string` a `PaymentCreateParams` (campo opcional, sin cambiar comportamiento de los llamadores actuales que no lo pasen — quedaría `nil` igual que hoy).
2. Diseñar la firma de la función nueva "crear Payment + comprobante en una transacción" que usará POS en Fase 5, dejando claro que **no** es una extensión de `IssueComprobanteFromPayment` sino una función hermana con precondiciones inversas.
3. Decidir (pendiente de aprobación, no técnico) si `CreatePaymentFromReceipt`/`LinkReceiptToPayment` deben transaccionalizarse en esta misma Fase 4 o quedar documentadas como deuda técnica para una fase posterior — no es estrictamente necesario para desbloquear Fase 5, pero es un bug real independiente.

No se propone ninguna implementación en este documento — queda para el próximo paso, sujeto a aprobación explícita.

---

## 22. Tests / Build / Vet

```
go test ./... -count=1   → falla únicamente en cmd/debt-audit (warning preexistente de vet,
                             documentado desde antes de Fase 2.4, no relacionado). Todos los
                             paquetes con tests (controllers, database, services, services/debt)
                             → ok, sin cambios respecto al cierre de Fase 3.
go build ./...            → OK
go vet ./...               → mismo warning preexistente, único
```

No se creó ningún test exploratorio en este paso (auditoría de solo lectura de código, sin necesidad de verificación empírica de comportamiento en runtime).

## 23. Estado final de git

`git status`/`git diff --stat` → **completamente vacíos**. Cero cambios de producción, cero archivos nuevos de código. Este documento es el único artefacto de este paso.
