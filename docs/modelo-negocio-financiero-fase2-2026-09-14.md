# Fase 2 — Modelo de negocio financiero definitivo (Cuentas por Cobrar)

**Alcance confirmado**: solo lo que ya existe y mueve dinero hoy — `Document` (deuda), `Payment`, `PaymentAllocation`, `TukifacFiscalReceipt`, `TaxSettlement`. Sin proveedores/compras/caja/bancos/notas de crédito como módulo. Ningún código fue modificado.

---

## 1. Qué es una Deuda (`Document`)

Es una **cuenta por cobrar**: una obligación de una empresa cliente hacia el estudio, generada por honorarios/servicios (liquidación mensual, suscripción o registro manual). No es "el comprobante fiscal" ni depende de él.

| Pregunta | Respuesta | Base |
|---|---|---|
| ¿Es una cuenta por cobrar? | Sí, exactamente eso | `total_amount`/`balance_amount`/`status` |
| ¿Es obligación de la empresa cliente? | Sí | `company_id` |
| ¿Puede existir sin comprobante fiscal? | **Sí, y es el caso normal.** La mayoría de deudas (liquidación, suscripción) nunca tienen un `TukifacFiscalReceipt` asociado | 3 orígenes activos, ninguno pasa por Tukifac |
| ¿Puede existir antes de que el cliente pague? | Sí, por definición nace `pendiente` | |
| ¿Puede existir sin estar en una liquidación? | Sí — deudas manuales y de suscripción no requieren `TaxSettlement` | `tax_settlement_id` nullable |
| ¿Puede moverse de una liquidación a otra? | **Sí, es un flujo de negocio deliberado y correcto** (arrastrar deuda impaga de un periodo cerrado a uno nuevo) — el problema no es que esto exista, es cómo se registra (ver §9-10) | `PendingDebtsFromClosedSettlements`, `SettlementAllowsDebtRelink` |
| ¿Puede tener múltiples pagos? | Sí, vía `PaymentAllocation` a lo largo del tiempo | |
| ¿Parcialmente pagada / totalmente pagada? | Sí, `status=parcial`/`pagado` | |
| ¿Exonerada? | Sí — significa "se perdona, no se va a cobrar" | `WriteOffUnlinkedDebt` |
| ¿Anulada? | Sí — significa "nunca debió existir / error de captura" | idem, `status=anulado` |
| **¿Cuándo debe desaparecer físicamente?** | **Solo** si nunca formó parte de una liquidación emitida/cerrada distinta a la que se está editando ahora mismo, y no tiene ningún pago — equivale a "deshacer" un error reciente sin trascendencia externa | Nueva regla (§10) |
| **¿Cuándo NUNCA debe eliminarse?** | Si alguna vez perteneció a otra liquidación (activa o cerrada), o tiene cualquier pago (parcial incluido) | Nueva regla (§10) |

---

## 2. Qué es un Pago (`Payment`)

**Tu interpretación es correcta y la tomo como principio central: `Payment` = dinero que realmente fue recibido del cliente.** Esto ya está bien reflejado en el modelo (`date`, `amount`, `method`, `reference` son obligatorios; `document_id` es opcional).

Debe poder existir: sin aplicación, aplicado a una deuda, aplicado a varias. **El código actual cumple esto en la CREACIÓN** (`CreateFromParams` soporta `on_account`, `single`, `manual`, `fifo`). **No lo cumple en la EDICIÓN posterior**: `PaymentService.Update` solo permite convertir un pago `on_account` a aplicado sobre **una única** deuda (vía el campo legacy `DocumentID`), nunca dividirlo entre varias. Este es el hueco real detrás de tu pregunta del punto 6.

---

## 3. Pago vs. Aplicación

La separación **ya está bien modelada a nivel de datos** (`Payment` = dinero, `PaymentAllocation` = decisión de a qué deuda va). Lo que falla no es el diseño, son dos reglas de validación demasiado estrictas:

1. `ValidatePaymentAmountsAndAllocations` (sin descuento) exige `sum(allocations) == amount` **exacto** — no permite `sum(allocations) < amount` con el resto quedando explícitamente "disponible" dentro del mismo pago. Esto es lo que rompe el sobrepago (§5).
2. No existe ningún campo/estado que represente "aplicado parcialmente, con remanente" — hoy solo existen los extremos (100% aplicado o 100% a cuenta). El dato para calcularlo (`amount - SUM(allocations)`) sí está disponible, solo falta que la escritura lo permita.

---

## 4. Pagos a cuenta (`on_account`)

Confirmado: significa dinero recibido, aún sin aplicar a una deuda específica. La relación debe ser siempre:

```
aplicado + a_cuenta = monto_del_pago
```

Hoy se cumple en los dos extremos (0% o 100% aplicado) pero **no en el punto intermedio** — ese es exactamente el caso que rompe.

---

## 5. Sobrepago — regla confirmada

Tu ejemplo (deuda 700, pago 1000 → aplicado 700, a cuenta 300, deuda pagada) **es la regla correcta**. Cómo debe implementarse con las estructuras que ya existen (sin entidades nuevas):

- `buildFIFOAllocations`/modo manual deben poder devolver `sum(allocations) < amount` sin que la operación se rechace, siempre que cada línea individual siga sin exceder el saldo de su documento (regla que ya existe y se mantiene).
- El remanente (`amount - sum(allocations)`) **no necesita un campo nuevo en la tabla** — se sigue calculando al leer. Solo hay que dejar de exigir igualdad estricta al escribir.
- **Sigue siendo UN solo `Payment`**, no dos registros — partirlo en "un pago aplicado + un pago a cuenta" duplicaría visualmente el dinero (misma fecha, mismo método, mismo comprobante bancario) y complicaría el estado de cuenta sin necesidad.

---

## 6. Pagos a cuenta aplicados después

**Sí, el sistema debería permitirlo — y hoy NO lo permite bien.** Confirmé leyendo `PaymentService.Update` línea por línea: rechaza editar cualquier pago que ya tenga allocations, y para uno sin ellas solo acepta fijar **un** `DocumentID` (campo legacy, sin crear `PaymentAllocation`). No existe ninguna función que tome un pago `on_account` existente y le agregue N aplicaciones conservando su identidad (mismo id, misma fecha).

Esto es una **funcionalidad faltante real**, no un bug puntual — hoy la única forma de lograrlo es borrar el pago y crear uno nuevo, perdiendo trazabilidad (nuevo id, nueva fecha de creación, y cualquier comprobante ya vinculado a ese pago quedaría roto).

Regla futura, tal como la planteas: *"un pago puede tener 0, 1 o N aplicaciones, y puede pasar de 0 a N en cualquier momento sin perder su identidad."* Esto requiere una acción explícita ("aplicar pago a cuenta a deuda(s)") que:
- Solo agregue `PaymentAllocation`s nuevas (nunca modifique fecha/método/monto original del pago).
- Verifique que las nuevas allocations no excedan el disponible actual (`amount - SUM(allocations existentes)`).
- Reutilice `debt.PersistBalanceAndStatus` para cada documento afectado.
- El campo legacy `Payment.DocumentID` debería dejar de usarse para operaciones nuevas — toda aplicación, presente y futura, vía `PaymentAllocation` exclusivamente.

---

## 7. Vista de Pagos — cierre definitivo

**Confirmado: debe mostrar TODOS los pagos, aplicados o no, con desglose Aplicado/A cuenta.** Ya lo hace correctamente en el aspecto más importante (no filtra nada, empresa opcional, etiqueta "a cuenta" cuando corresponde) — verificado en fase 1. Lo único que falta es que pueda existir y mostrarse el caso **intermedio** ("aplicado S/700, a cuenta S/300") — hoy no puede ni existir en los datos porque se rechaza al crearlo (§5). Una vez corregido eso, la vista solo necesita un ajuste de UI menor (desglosar aplicado/a cuenta en vez de mostrar un estado binario) — no se rediseña.

---

## 8. Deuda total de una empresa — la regla definitiva

Propongo **dos conceptos con nombre explícito y una sola función cada uno** (no uno solo, porque responden preguntas de negocio distintas y ambas son legítimas):

### `SaldoDocumentado` (la deuda "dura", documento por documento)
```
SaldoDocumentado(empresa) = SUM(Document.balance_amount)
                             WHERE company_id = X AND status IN ('pendiente','parcial')
```
No depende de `tax_settlement_id` (una deuda arrastrada o sin liquidación pesa igual). No resta pagos a cuenta — responde "cuánto hay documentado y sin cerrar", que es lo que necesita cobranza para saber qué reclamar.

### `SaldoACuenta` (dinero recibido y aún no aplicado, informativo aparte)
```
SaldoACuenta(empresa) = SUM(Payment.amount - SUM(sus allocations))
                         WHERE company_id = X, sobre pagos no anulados
```

**Por qué no fusionarlos en una sola cifra "neta"**: el Dashboard actual (`totalDocs - totalPays`, restando TODOS los pagos) intenta aproximar un "saldo neto" pero lo hace mal — resta pagos ya aplicados (que ya están descontados en `balance_amount`, doble conteo si se compara contra `SaldoDocumentado`) mezclado con pagos a cuenta (que si son legítimos de restar). El resultado no es ni una cosa ni la otra de forma confiable. Cualquier pantalla que quiera mostrar "saldo neto" debe hacerlo como `SaldoDocumentado - SaldoACuenta`, **usando las dos funciones únicas**, no una tercera fórmula propia.

**Todas estas pantallas deben consumir exactamente estas 2 funciones, sin SUM ad-hoc propios:**
- `dashboard_controller.go` (`TotalDocs`/`TotalPays`/`GlobalBalance`, y su duplicado en `getDashboardDataForCompanyIDs`)
- `FinanceService.GetCompanyBalance`
- `FinanceService.GetCompanyStatement` (Total/Balance "clásico", no el Ledger — el Ledger puede seguir siendo su propio cálculo de saldo corrido, es un reporte distinto)
- `FinanceService.companyTotalsForReport`/`GetFinancialReportRows`
- `debtsvc.ListDocumentReportRows`/`EffectiveBalance` (esta ya usa el criterio correcto de `SaldoDocumentado` por documento — es la referencia a seguir, no a reemplazar)

---

## 9. Relación liquidación-deuda: ¿se necesita `origin_settlement_id`?

**Sí, confirmado tras revisar `settlement_close.go` completo.** Al cerrar una liquidación, el sistema ya congela un snapshot (`document_number_snapshot`, `document_status_snapshot`, `document_balance_snapshot`) en la propia `TaxSettlementLine` — eso preserva correctamente el historial **de la liquidación que se cierra**. Pero **no resuelve** el problema mientras una deuda está temporalmente vinculada a una liquidación nueva (en borrador): en ese momento no hay ningún dato que diga "esta deuda es mía de verdad" vs. "la tomé prestada." `tax_settlement_id` se sobrescribe sin dejar rastro (`linkDocumentToSettlement` solo hace `UPDATE tax_settlement_id`).

Es exactamente la distinción que tú planteas: **deuda de origen ≠ liquidación actual**. La solución mínima y justificada (no es sobre-ingeniería, es 1 columna nueva, usada en 1 función):

- `Document.OriginSettlementID *uint` — se asigna **una sola vez**, en el momento de creación (`createSettlementDebtDocument`), y **nunca se modifica después**, pase por las liquidaciones que pase.
- `Document.TaxSettlementID` sigue siendo el campo mutable de "dónde está trabajándose ahora" (como ya es).
- `IsSettlementOwnedDebt` deja de mirar `TaxSettlementID`+`Source`/`Type` genéricos, y compara `OriginSettlementID == settlementID`.

---

## 10. Borrado de deudas — regla definitiva

Secuencia correcta:

1. **Liquidación A se cierra con deuda D impaga** → D se desvincula (`tax_settlement_id=NULL`), queda libre/pendiente para poder re-liquidarse. Su historial en A queda congelado en el snapshot de esa línea (ya funciona así hoy, correctamente).
2. **D se arrastra a Liquidación B (borrador)** → `tax_settlement_id=B.ID`. `origin_settlement_id` sigue siendo A (nunca cambia).
3. **Alguien quita la línea de D dentro de B, antes de emitir**:
   - Si `D.origin_settlement_id == B.ID` (nació en B, nunca fue de nadie más) **y** B sigue en borrador **y** D no tiene pagos → **puede eliminarse físicamente**, sin riesgo real (nunca existió fuera de B).
   - **En cualquier otro caso** (vino de otra liquidación, cerrada o no) → **solo se desvincula** (`tax_settlement_id=NULL`). D vuelve a quedar libre/pendiente, disponible para el futuro — exactamente el mismo resultado que si B nunca la hubiera tomado.
4. D **conserva siempre** su `origin_settlement_id` y su fila completa — nunca desaparece silenciosamente por una edición ajena a su propio ciclo de vida.

---

## 11. Comprobante fiscal y deuda — por escenario

| Escenario | Qué debería existir | Estado hoy |
|---|---|---|
| **A** — venta POS pagada al instante | `TukifacFiscalReceipt` (evidencia fiscal) **+ `Payment`** (el dinero, aplicado o a cuenta) siempre. `Document` opcional según si el negocio quiere que esa venta quede reflejada como cobranza formal del cliente | Hoy solo nace el comprobante — el `Payment` **no** se crea (el hallazgo central) |
| **B** — venta a crédito por comprobante | `Document` (deuda) + `TukifacFiscalReceipt` que la sustenta, sin `Payment` todavía | No implementado — el negocio actual genera crédito por liquidación/suscripción, no por comprobante POS a crédito |
| **C** — comprobante existe, dinero no recibido | Igual que B | Igual que B |
| **D** — pago sin comprobante | Válido y ya soportado (pagos de Finanzas contra liquidaciones, sin pasar por POS) | ✅ Funciona |
| **E** — comprobante sin `Payment` | **Debe considerarse pendiente de conciliación**, nunca un estado final válido de forma indefinida | Hoy puede quedar así indefinidamente (20+ casos reales acumulados) |

**La regla más importante de todo este análisis, aplicable a los 5 escenarios**: *si hubo dinero real, siempre debe existir un `Payment`* — con o sin aplicación, con o sin comprobante. Hoy el único punto que viola esto es el origen `pos_sale`.

---

## 12. El caso del pago de S/900 — veredicto

**Respuesta: B con matiz de C.**

No es (A) "comportamiento correcto" — deja dinero real fuera del sistema financiero durante meses (confirmado: 20+ comprobantes acumulados en producción). El código hace exactamente lo que se programó (POS solo emite comprobante, deliberadamente sin `Payment`) — no es un bug de ejecución. Pero **es una inconsistencia de negocio** porque viola la regla central del punto 11 ("todo dinero real debe ser un `Payment`"): el diseño actual asume que ese segundo paso (conciliar) se hará siempre, pero no hay ningún control que lo garantice ni ningún aviso cuando no ocurre. Por eso también tiene matiz de (C): la solución concreta (¿se crea el `Payment` automáticamente al emitir? ¿se bloquea la emisión sin conciliar? ¿solo se agrega una alerta?) es una decisión de producto que aún no hemos tomado — coherente con que ya acordamos NO auto-conciliar.

---

## 13. Anulación de pagos — recomendación

**Sí, se recomienda anulación auditable en vez de solo borrado físico**, por consistencia con cómo ya se trata a las deudas (`writeoff_reason/by/at`). Definición conceptual (mismo patrón, sin inventar uno nuevo):

- `Payment.voided_at`, `Payment.voided_by`, `Payment.voided_reason` (o `anulado_*`, mismo nombre que ya usa `Document` para mantener consistencia de vocabulario en el código).
- Qué debe pasar con aplicaciones y deuda: **exactamente lo que ya hace hoy `DeletePaymentTx`** (revertir allocations, recalcular saldo/estado de cada documento vía `PersistBalanceAndStatus`) — esa parte ya está bien y se mantiene igual. Solo cambia que el `Payment` ya no desaparece de la tabla: queda marcado como anulado, con motivo/usuario/fecha, visible en el historial (la vista de Pagos podría incluso mostrarlo tachado/con badge "Anulado" en vez de que simplemente desaparezca).
- Aprovechar el mismo cambio para corregir el gap ya detectado: revertir también el vínculo deuda↔liquidación cuando corresponda (hoy no se hace).

---

## 14. Fuentes de verdad — tabla definitiva

| Concepto | Fuente de verdad |
|---|---|
| Monto total de una deuda | `Document.total_amount` |
| Saldo pendiente de una deuda | `Document.balance_amount`, mantenido **solo** por `debt.PersistBalanceAndStatus` |
| Total pagado de una deuda | `debt.PaidTotal(document_id)` |
| Pago recibido (bruto) | `Payment.amount` |
| Pago aplicado | `SUM(PaymentAllocation.amount) WHERE payment_id=X` |
| Saldo no aplicado de un pago | `Payment.amount − SUM(allocations)` (calculado, no columna nueva) |
| **Deuda total de una empresa** | `SaldoDocumentado` — una función nueva y única, reemplazando las 4 implementaciones actuales (§8) |
| Estado de una deuda | `Document.status`, escrito solo por `PersistBalanceAndStatus` (pagos) o `WriteOffUnlinkedDebt` (baja manual) |
| Estado de un pago | `Payment.type` (derivado de si tiene allocations) + nuevo campo de anulación |
| Liquidación de origen | **Nuevo**: `Document.origin_settlement_id` (inmutable) |
| Liquidación actual | `Document.tax_settlement_id` (mutable) |

---

## 15. Reglas invariantes — validadas y ajustadas

Tu lista de 10 revisada contra el código real:

| # | Regla | Veredicto |
|---|---|---|
| 1 | Un pago puede existir sin deuda | ✅ Ya se cumple |
| 2 | Un pago puede tener 0, 1 o N aplicaciones | ✅ Correcta como objetivo — hoy solo se cumple al crear, no al editar (§6) |
| 3 | La suma de aplicaciones nunca supera el monto del pago | ✅ Correcta — y hoy se **sobre-cumple** exigiendo igualdad exacta cuando debería permitir "≤" (§5) |
| 4 | El saldo no aplicado nunca es negativo | ✅ Correcta (consecuencia de la 3) |
| 5 | aplicado + no_aplicado = monto del pago | ✅ Correcta — debe reemplazar la validación de igualdad estricta actual |
| 6 | Una deuda nunca tiene saldo negativo | ✅ Ya se cumple |
| 7 | Saldo de deuda = monto − aplicado | ✅ Ya se cumple vía `PersistBalanceAndStatus` |
| 8 | Un pago anulado no sigue afectando el saldo de una deuda | ✅ Correcta — ya se cumple con el borrado actual, debe seguir igual con anulación |
| 9 | Una deuda histórica no debe desaparecer silenciosamente | ✅ Correcta — es la regla que hoy se viola (el bug) |
| 10 | Todas las pantallas calculan deuda total igual | ✅ Correcta — es el hallazgo de §8 |

**3 reglas nuevas que el análisis evidenció como necesarias:**

| # | Regla nueva |
|---|---|
| 11 | La liquidación de **origen** de una deuda nunca cambia después de creada — solo la liquidación **actual** puede cambiar o quedar NULL |
| 12 | Una deuda solo puede eliminarse físicamente si su origen es la liquidación que se está editando/borrando ahora mismo, esa liquidación sigue en borrador, y no tiene pagos — en cualquier otro caso, solo se desvincula |
| 13 | Dar de baja (exonerar/anular) una deuda con pago parcial ya aplicado debe bloquearse o exigir confirmación explícita adicional advirtiendo sobre el dinero ya recibido — nunca en silencio |

---

## 16. Flujos definitivos

### Flujo 1 — Crear deuda
**Entidades**: `Document`. **Operación**: `INSERT` (manual, por liquidación, o por suscripción). **Saldo**: `balance_amount = total_amount`, `status = pendiente`. **Reglas**: `origin_settlement_id` se fija aquí si nace de una liquidación (nunca más cambia). **Transaccional**: sí, junto con `DocumentItem`s si los hay.

### Flujo 2 — Pago total
**Entidades**: `Payment`, `PaymentAllocation`, `Document`. **Operación**: crear `Payment` (`type=applied`) + 1 `PaymentAllocation` por el saldo completo. **Saldo**: `Document.balance_amount → 0`, `status → pagado`. **Reglas**: 6, 7. **Transaccional**: sí (ya lo es, `ApplyPaymentTx`).

### Flujo 3 — Pago parcial
Igual al Flujo 2 pero `allocation.amount < balance` → `status → parcial`. Ya soportado correctamente.

### Flujo 4 — Pago a cuenta
**Entidades**: `Payment` únicamente. **Operación**: `INSERT` con `type=on_account`, sin `PaymentAllocation`. **Saldo**: ninguna deuda se toca. Ya soportado correctamente.

### Flujo 5 — Aplicar posteriormente un pago a cuenta
**Entidades**: `Payment` existente, nuevas `PaymentAllocation`(s), `Document`(s). **Operación**: **nueva función** (no `Update` genérico) que solo agrega allocations respetando el disponible del pago. **Saldo**: recalcular cada `Document` afectado vía `PersistBalanceAndStatus`. **Regla**: 2, 3, 5. **Transaccional**: sí, todas las allocations nuevas + recálculos en una sola transacción. **Estado actual**: no implementado (§6).

### Flujo 6 — Aplicar un pago a varias deudas
Ya soportado en creación (`manual`/`fifo`). Extenderlo también al Flujo 5 (post-hoc).

### Flujo 7 — Sobrepago
**Entidades**: igual al Flujo 2/3. **Operación**: permitir `sum(allocations) < amount`, sin rechazar. **Saldo**: deuda(s) cubierta(s) → `pagado`; remanente queda implícito como "a cuenta" del mismo pago (`amount − sum(allocations)`). **Regla**: 3, 4, 5 (corregidas). **Transaccional**: sí. **Estado actual**: 🔴 roto — se rechaza (§5).

### Flujo 8 — Anulación de pago
**Entidades**: `Payment`, sus `PaymentAllocation`s, `Document`(s) afectados, `TukifacFiscalReceipt` si estaba vinculado. **Operación**: marcar `Payment` anulado (nuevo campo, no `DELETE`), revertir allocations, recalcular saldo/estado de cada `Document`, desvincular comprobante fiscal si aplica, **y desvincular deuda↔liquidación si el pago la había vinculado** (gap a corregir). **Transaccional**: sí (ya lo es en su mayor parte vía `DeletePaymentTx`, adaptar a "anular" en vez de "borrar").

### Flujo 9 — Liquidación → deuda
**Entidades**: `TaxSettlement`, `TaxSettlementLine`, `Document`. **Operación**: al crear/editar/emitir, `EnsureSettlementLineDebts` crea `Document`s para líneas sin `document_id` (fijando `origin_settlement_id`), o vincula (`tax_settlement_id`) documentos existentes referenciados por `document_ref`. **Transaccional**: sí, ya lo es.

### Flujo 10 — Arrastre de deuda de liquidación cerrada a nueva
**Entidades**: `Document` (D), `TaxSettlement` origen (cerrada) y destino (borrador). **Operación**: `linkDocumentToSettlement` actualiza `tax_settlement_id=destino`; `origin_settlement_id` **no cambia**. **Regla**: 11. **Transaccional**: sí. **Estado actual**: la mecánica ya existe y es correcta; falta el campo de origen para que el resto del sistema no la confunda con "propiedad."

### Flujo 11 — Quitar una deuda de una liquidación
**Entidades**: `Document`, `TaxSettlement` actual. **Operación**: evaluar `origin_settlement_id == settlementID actual` **y** `status=borrador` **y** sin pagos → eliminar; si no, **desvincular** (`tax_settlement_id=NULL`). **Regla**: 9, 11, 12. **Transaccional**: sí (ya lo es, `CleanupSettlementDebtsNotInLines`/`PurgeSettlementDocumentsOnDelete`, corrigiendo la condición). **Estado actual**: 🔴 roto — hoy borra por error (§9-10, el bug).

### Flujo 12 — Comprobante fiscal → pago/deuda
**Entidades**: `TukifacFiscalReceipt`, `Payment`. **Regla más importante**: si hubo dinero real, debe existir un `Payment` (aunque sea `on_account`), sin excepción — incluyendo el origen `pos_sale`, que hoy es el único que la viola. **Estado actual**: pendiente de decisión de producto (§12), no de código — ya descartamos auto-conciliación; falta decidir si se crea el `Payment` automáticamente al emitir (aunque quede `on_account`) o se refuerza con alertas.

---

## Resultado final

### A. Modelo actual
`Document`/`Payment`/`PaymentAllocation` bien separados a nivel de datos y en la creación de pagos. `TukifacFiscalReceipt` desconectado de `Document`, conectado solo indirectamente vía `Payment`. 4 cálculos independientes de "deuda de empresa". Pertenencia deuda↔liquidación basada en un campo mutable, causando borrado accidental. Sin edición posterior de aplicaciones de un pago a cuenta. Sobrepago con deuda parcial insuficiente se rechaza. Anulación de pago = borrado físico sin auditoría.

### B. Modelo correcto
El de este documento (§1-14): mismas 3 entidades núcleo, con `origin_settlement_id` inmutable agregado a `Document`, con la restricción de igualdad de allocations relajada a "≤", con una única función de `SaldoDocumentado` por empresa, con anulación de pagos auditable, y con la regla explícita de que todo dinero real (incluyendo POS) debe nacer como `Payment`.

### C. Diferencias exactas
1. Falta `Document.origin_settlement_id` (o equivalente inmutable).
2. `IsSettlementOwnedDebt`/`CleanupSettlementDebtsNotInLines`/`PurgeSettlementDocumentsOnDelete` deben desvincular en vez de borrar salvo el caso seguro descrito.
3. `ValidatePaymentAmountsAndAllocations` exige igualdad estricta; debe permitir `sum(allocations) ≤ amount`.
4. No existe función para aplicar (post-hoc) un pago `on_account` a una o varias deudas sin borrar/recrear.
5. 4 implementaciones de "deuda de empresa" en vez de 1.
6. `Payment` no tiene estado de anulación auditable (motivo/usuario/fecha) — solo borrado físico.
7. `WriteOffUnlinkedDebt` no bloquea/advierte sobre pagos parciales existentes.
8. POS no crea `Payment` cuando recibe dinero real.

### D. Reglas invariantes finales
Las 10 propuestas, confirmadas, más las 3 nuevas del §15 (13 en total).

### E. Plan de implementación por categoría y prioridad

**🔴 BUG (corregir cuanto antes, ya causó pérdida de datos real):**
1. `origin_settlement_id` + corregir `IsSettlementOwnedDebt` y las 2 funciones de limpieza (desvincular, no borrar).
2. Permitir remanente parcial en `ValidatePaymentAmountsAndAllocations` (sobrepago con deuda insuficiente).

**🟠 FUNCIONALIDAD FALTANTE (decisión de producto + implementación):**
3. Aplicar post-hoc un pago `on_account` a una o varias deudas (Flujo 5), deprecando el uso de `Payment.DocumentID` legacy para casos nuevos.
4. Anulación auditable de pagos (`voided_at/by/reason`) en vez de solo borrado físico, incluyendo revertir el vínculo deuda↔liquidación.
5. Decisión pendiente sobre POS: ¿crear `Payment` automáticamente al emitir (aunque quede `on_account`), o reforzar con alertas manteniendo el paso manual? (ya descartamos auto-conciliación completa).

**🟡 REFACTOR (sin cambiar comportamiento visible, solo consolidar):**
6. Unificar las 4 implementaciones de "deuda de empresa" en una sola función `SaldoDocumentado` (+ `SaldoACuenta` aparte), reutilizada por Dashboard/Estado de cuenta/Reporte financiero/Reporte de deudas.
7. Centralizar la escritura de `Payment.fiscal_status` (hoy en 3 lugares).

**🟡 MEJORA (bloqueada por los bugs de arriba, no se puede hacer antes):**
8. `WriteOffUnlinkedDebt` debe bloquear o exigir confirmación explícita si la deuda tiene pago parcial.
9. `isValidDocumentStatus` debe reconocer `"exonerado"` como válido.
10. Vista de Pagos: desglosar "Aplicado"/"A cuenta" en el caso intermedio, una vez exista (depende del punto 2).

Ningún punto de este plan requiere módulos nuevos (caja, bancos, proveedores, notas de crédito) — todo se resuelve dentro de las 4 tablas que ya existen.
