# Fase 3 — Auditoría con contexto real de negocio: liquidaciones vs. pagos independientes

Complementa [Fase 1 (auditoría técnica)](auditoria-logica-financiera-2026-09-14.md) y [Fase 2 (modelo definitivo)](modelo-negocio-financiero-fase2-2026-09-14.md) — no las repite donde ya hay respuesta firme, solo referencia y profundiza lo nuevo: la distinción entre **cobranza de liquidación** y **pago independiente por servicio**. Ningún código fue modificado.

---

## Hallazgo central de esta fase (adelanto)

**El flujo correcto para "pago independiente" YA EXISTE en el sistema — solo que no es el que usa POS.** Verifiqué `IssueComprobanteFromPayment`/`BuildReceiptLinesFromPayment`: cuando un `Payment` no tiene ninguna `PaymentAllocation` (exactamente el caso de un servicio adicional pagado sin deuda), el sistema ya sabe generar el comprobante igual, con una línea genérica ("Servicios contables") por el monto total — **sin duplicar el dinero en ningún reporte** (confirmé que ningún cálculo de ingresos suma `tukifac_fiscal_receipts.total`, solo `payments.amount`). Es decir: **Finanzas → Pagos → "Emitir comprobante" ya implementa correctamente tu Escenario 2**, de punta a punta. El único punto que lo rompe es que **POS toma un atajo distinto** (emite el comprobante primero, sin pasar nunca por crear el `Payment`).

Esto cambia el enfoque del plan: no hace falta diseñar un flujo nuevo para "pago independiente" — hace falta que POS deje de saltarse el flujo que ya funciona en Finanzas.

---

## 1-2. Modelo actual y definición de entidades

Ya determinado con precisión en Fase 1 §2-3 y Fase 2 §1-2. Resumen aplicado a tu contexto de negocio:

| Entidad | Qué representa en TU negocio |
|---|---|
| `Empresa` (`Company`) | El cliente del estudio |
| `TaxSettlement` (liquidación) | La **comunicación mensual** de conceptos a pagar — un agrupador/resumen de un periodo, no una obligación en sí misma |
| `Document` (deuda) | Cada concepto individual a cobrar (el "Servicio mensual S/500", el "Otro concepto S/300", el "Saldo pendiente S/200" de tu ejemplo son 3 `Document`s distintos, no una fila de la liquidación) |
| `Payment` | El dinero que efectivamente entra al estudio — **por cobranza de liquidación O por un servicio independiente, es indistinguible en su naturaleza: siempre es "dinero recibido"** |
| `PaymentAllocation` | La decisión de a qué `Document` se destina ese dinero — puede no haber ninguna |
| `TukifacFiscalReceipt` | El respaldo fiscal/comercial (boleta, factura, nota de venta) de una venta o de un cobro — documento, no dinero |

---

## 3. ¿`Payment` = dinero recibido, con o sin relación a deuda? — Confirmado, y ya es compatible sin cambios

La estructura `Payment ├─ aplicado a 1 deuda ├─ aplicado a N deudas ├─ a cuenta └─ independiente` **ya es representable hoy sin tocar el modelo**:

```
Payment { company_id, amount, method, date, type='on_account', document_id=NULL }
+ 0 PaymentAllocation
+ (opcional) description="Redacción de contratos"
+ (opcional) TukifacFiscalReceipt vinculado, generado después
```

Esto cubre **tanto** "pago a cuenta esperando asignación" **como** "pago independiente por servicio" — a nivel de datos son el mismo estado (`on_account`, 0 allocations). Ver §13 para la discusión de si hace falta distinguirlos igual.

**No introduzcas un tipo nuevo** — confirmado que no es necesario (respondiendo tu pregunta explícita del §3).

---

## 4. Pagos independientes — dónde se registran HOY (dos caminos, uno roto)

| Camino | Endpoint/servicio | ¿Crea `Payment`? | ¿Genera comprobante? | Estado |
|---|---|---|---|---|
| **A — Finanzas** | `POST /payments` (`type=on_account`, sin `document_id`) → luego `POST /payments/:id/issue-comprobante` (`IssueComprobanteFromPayment`) | ✅ Sí, primero | ✅ Sí, después, ya vinculado (`origin=issued_local`, nace `vinculado`) | ✅ **Funciona correctamente de punta a punta** |
| **B — POS** | `POST /pos/sales` (`IssuePosSale`) | ❌ **No, nunca** | ✅ Sí, primero (`origin=pos_sale`) | 🔴 Roto — el comprobante nace sin ningún `Payment`, queda `pendiente_vincular` indefinidamente |

Validaciones/campos presentes en ambos: empresa (`company_id`), método de pago, referencia/operación, historial (`created_at`), relación con empresa — todo existe en ambos modelos, la diferencia es únicamente el orden de creación y si el `Payment` llega a existir.

**Conclusión de este punto**: sí existe un flujo correcto para "Empresa → servicio adicional → pago → comprobante, sin deuda mensual" — es el Camino A. El Camino B (el que usa el mostrador/POS en la práctica) es el que hay que alinear a ese mismo patrón.

---

## 5. Relación pago ↔ comprobante

- ¿Cuándo se genera un comprobante? Dos momentos posibles hoy: (a) desde un `Payment` ya existente (Camino A, `issued_local`) — correcto; (b) directo en POS sin `Payment` (Camino B) — el problema.
- ¿Qué entidad representa que se cobró dinero? **`Payment`, exclusivamente.** El comprobante es respaldo documental, nunca la fuente de verdad del dinero.
- ¿Puede existir un pago sin comprobante? Sí — todos los pagos de liquidación vía Finanzas normalmente no generan boleta/factura (no es obligatorio).
- ¿Puede existir comprobante sin pago? Hoy sí (el bug de POS) — y **no debería considerarse un estado válido permanente** (ya concluido en Fase 2 §11-12).
- ¿Qué ocurre si se genera el comprobante pero no el pago? Dinero real invisible en todo el sistema financiero — exactamente el caso investigado (S/900 de Fundas del Sur).

---

## 6-9. Liquidaciones, deudas mensuales, arrastre e identidad de la deuda

**Ya determinado con exactitud en Fase 1 §2, §6 y Fase 2 §9-10.** Resumen aplicado a tu ejemplo septiembre→octubre:

- **Cómo nace la deuda de septiembre**: `TaxSettlementService.CreateDraft`/`Emit` → `EnsureSettlementLineDebts` (`backend/services/debt/settlement.go`) → `createSettlementDebtDocument` → `INSERT INTO documents` (`Type=LI`, `Source=liquidacion`, `TaxSettlementID=<liquidación de septiembre>`).
- **Si no se paga y se cierra septiembre**: `TaxSettlementService.Close` → `SnapshotAndReleaseOpenDebtsOnClose` — congela el snapshot histórico en la línea de septiembre (`document_number_snapshot`/`status`/`balance`) y **desvincula** la deuda (`tax_settlement_id=NULL`), porque sigue con saldo. La deuda **sigue siendo el mismo registro** (`Document#123`), no se crea una nueva.
- **Al crear la liquidación de octubre**: el asistente usa `PendingDebtsFromClosedSettlements`/`LinkDebtToDraft` para traer `Document#123` (la deuda de septiembre) a octubre → `Document#123.TaxSettlementID = <octubre>`. **Es la misma deuda** (mismo `id`, mismo `Document#123`), solo se le cambió a qué liquidación está actualmente asociada.
- **¿Se puede arrastrar varias veces?** Sí, no hay límite — puede pasar por septiembre→octubre→noviembre indefinidamente mientras siga impaga.
- **¿Qué pasa si se quita la línea de octubre?** **Aquí está el bug crítico ya documentado** (Fase 1 §14, Fase 2 §9-10): el sistema hoy la **borra físicamente** en vez de solo desvincularla, porque no distingue "deuda que octubre creó" de "deuda que octubre solo tomó prestada de septiembre." La solución (`origin_settlement_id` inmutable) ya quedó definida en Fase 2 y sigue siendo la correcta.
- **Identidad permanente**: confirmado que `Document#123` mantiene su identidad (mismo id) a través de septiembre/octubre/noviembre — el modelo de datos ya soporta esto correctamente; lo que falta es el campo que registre "nació en septiembre" de forma inmutable, separado de "está actualmente en noviembre" (`tax_settlement_id`, mutable). **Exactamente la distinción que planteas en tu §9 — confirmo que el modelo actual NO la hace, y que sí hace falta.**

---

## 10-12. Pago total repartido en varias deudas / parcial / a cuenta aplicado después

Ya determinado en Fase 2 §5-6, Flujos 5-7. Confirmado con tu ejemplo exacto (A=500, B=700, C=300, pago Yape=1500): **sí es posible hoy** vía modo `manual` de `CreateFromParams`, una sola `Payment` con 3 `PaymentAllocation`. Pago parcial (1500 debido, 800 pagado → aplicado 800, pendiente 700): **sí funciona hoy**, `status→parcial`. Pago a cuenta aplicado después a A=600+B=400: **NO funciona hoy sin borrar y recrear el pago** — gap real ya documentado (Fase 2 §6, Flujo 5).

---

## 13. Pago independiente vs. pago a cuenta — ¿necesitan distinguirse técnicamente?

**Respuesta: NO a nivel de modelo de datos / lógica de saldos. SÍ conviene distinguirlos a nivel de UI/reporte, pero con datos que ya existen — no con un campo nuevo.**

Por qué NO hace falta un campo/tipo nuevo: en ambos casos el efecto sobre el dinero es idéntico — `Payment` sin allocations, no reduce ninguna deuda específica, cuenta igual en "SaldoACuenta" (Fase 2 §8). La diferencia entre ambos es puramente **narrativa** (¿por qué existe este dinero sin aplicar?), y esa narrativa **ya tiene dónde vivir**:
- `Payment.Description` (texto libre, "detalle visible al cliente") — para un pago independiente, ahí va "Redacción de contratos"; para un pago a cuenta genuino, se deja vacío o dice "A cuenta, pendiente de asignar."
- El `TukifacFiscalReceipt` vinculado (si existe) — su detalle de líneas (`FiscalReceiptLine`) ya documenta qué se vendió.

**Por qué SÍ conviene distinguirlos en la vista/reporte** (no en el modelo): un pago independiente **nunca debería aparecer como "pendiente de aplicar" en un reporte de cobranza** (nadie va a ir a buscarle una deuda, porque no la tiene) — mientras que un pago a cuenta genuino sí debería aparecer ahí como una tarea pendiente ("hay que decidir a qué se aplica esto"). Esto se puede lograr con una simple regla de presentación: **si el `Payment` tiene un `TukifacFiscalReceipt` vinculado, se muestra como "Servicio independiente" (no requiere acción); si no lo tiene, se muestra como "A cuenta — pendiente de aplicar"** (si acaso requiere seguimiento). No requiere ningún campo ni migración — es una regla de presentación basada en una relación que ya existe (`LinkedPaymentID`).

---

## 14. Métodos de pago

Ya documentado en Fase 1 (agente de comprobantes/POS): `Payment.Method` es texto libre normalizado por convención en Finanzas (`Efectivo`/`Yape`/`Plin`/`Transferencia`, ver `payMethodOptions` del modal que ya mejoramos). En POS, `FiscalReceiptPayment.Method` es por línea (soporta pagos divididos, ej. mitad efectivo/mitad Yape), y el header `TukifacFiscalReceipt.PaymentMethod` es la concatenación de todos (`"efectivo + yape"`). **Duplicidad ya identificada** entre cabecera y detalle (Fase 1 §hallazgo), mitigada solo en lectura (`syncFiscalReceiptPayments`), no garantizada en escritura. Es escritura, sí puede modificarse (campo simple), y sí forma parte del historial (nunca se sobrescribe tras crear el pago, salvo edición explícita de un pago aún no aplicado).

---

## 15. "Todo dinero recibido debe quedar registrado" — validado

**Confirmado como principio correcto, y `Payment` ya es la fuente de verdad adecuada para esto — el problema no es el modelo, es que POS no lo usa siempre** (mismo hallazgo que §4/§12 de Fase 2). Tus 3 ejemplos (deuda de liquidación / servicio independiente / a cuenta) son, en la base de datos, **el mismo tipo de fila** (`Payment`) con distinta combinación de `type`/`allocations`/`description` — eso es correcto y suficiente, no hace falta diferenciarlos estructuralmente (ver §13).

---

## 16. Riesgo de doble registro — investigado y descartado (para el código actual)

Verifiqué explícitamente: **ningún reporte, dashboard ni estado de cuenta suma `tukifac_fiscal_receipts.total` como ingreso independiente** — todos los cálculos de "dinero recibido" usan exclusivamente `SUM(payments.amount)`. Por lo tanto, **hoy no existe el riesgo de que "Pago S/300 + Comprobante S/300 = S/600"** — el comprobante nunca se cuenta como dinero por sí solo en ningún lugar del sistema actual.

El riesgo real **no es doble conteo, es conteo cero**: cuando el comprobante nace sin `Payment` (POS), ese dinero no se cuenta ni una vez, en ningún lado — el problema opuesto al que preguntabas, y ya lo teníamos identificado. Confirmo que tu preocupación de fondo (que el dinero nunca se duplique) **está bien resuelta en el diseño actual**, y que hay que tener cuidado de no romperla al corregir el bug de POS — la corrección correcta es "que POS cree el `Payment`", nunca "que el reporte también sume el comprobante."

---

## 17-18. Vista global de pagos y estado de cuenta

Ya confirmado en Fase 1 §5/Fase 2 §7: la vista de Pagos ya muestra todo (aplicado, a cuenta, o — aplicando §13 — independiente por descripción/comprobante vinculado), sin discriminar. Tus 3 ejemplos (Pago 001 aplicado / Pago 002 servicio independiente sin deuda / Pago 003 a cuenta) **ya son representables tal cual con los datos actuales**, salvo la etiqueta "Servicio independiente" que hoy no existe como tal en la UI (hoy solo distingue "aplicado" vs "a cuenta" — ver mejora sugerida en §13).

Para el estado de cuenta: la separación Deudas / Pagos / Aplicaciones / Pagos independientes que pides **ya es posible con `SaldoDocumentado` (Fase 2 §8)** — un pago independiente, al no tener `PaymentAllocation`, sencillamente no aparece restando ninguna deuda específica en ese cálculo. Confirmo explícitamente tu preocupación del final del §18 ("no quiero que un pago independiente reduzca accidentalmente la deuda mensual") — **con `SaldoDocumentado` como fuente única esto no ocurre**; **con la fórmula actual del Dashboard (que resta TODOS los pagos del total de documentos) SÍ ocurre** — es exactamente la inconsistencia crítica #3 de Fase 1/2, ahora con un ejemplo de negocio concreto que la hace evidente.

---

## 19-20. Regla fundamental de saldos y sobrepago

Confirmado íntegramente, ya validado en Fase 2 §5/§8/Regla 7. `Saldo de deuda = monto − aplicaciones válidas a esa deuda`, nunca `monto − todos los pagos de la empresa`. El sobrepago (700 debido, 1000 pagado → 700 aplicado + 300 disponible, sin rechazar la operación) es exactamente el Flujo 7 de Fase 2, hoy roto (confirmado leyendo `ValidatePaymentAmountsAndAllocations` línea por línea).

---

## 21. Escenario combinado — la prueba de fuego

Tu ejemplo (deuda liquidación 1000 + pago independiente 300 + pago de liquidación 1000) es el caso perfecto para validar todo lo anterior junto:

```
Document (liquidación): total=1000, balance=1000, status=pendiente
Payment #1: amount=300, allocations=[], description="Servicio adicional"   ← independiente
Payment #2: amount=1000, allocations=[{document_id, amount=1000}]           ← paga la deuda
```

Con `SaldoDocumentado` (Fase 2): `Document.balance_amount` pasa a 0 solo por el `Payment #2` (vía su `PaymentAllocation`) → **deuda liquidación = 0, correcto**. El `Payment #1` nunca toca `balance_amount` de ese documento (no tiene allocation hacia él) → **no interfiere, correcto**. Total recibido = `SUM(payments.amount)` = 1300 → correcto, sin que "sobre" ni "falte" nada.

Con la fórmula actual del Dashboard (`SUM(total_amount no anulado) − SUM(TODOS los payments)`): `1000 − 1300 = −300` → **saldo negativo falso**, exactamente el resultado incorrecto que tú mismo señalas que NO debería ocurrir. **Esto confirma con un ejemplo de negocio real y concreto que la corrección de Fase 2 §8 (unificar en `SaldoDocumentado`) no es una mejora cosmética — es necesaria para que este escenario, que es exactamente como opera tu negocio, no arroje cifras negativas absurdas.**

---

## 22. Comprobantes — sin forzar relación innecesaria

Confirmado, sin forzar nada nuevo: los comprobantes (boleta/factura/nota de venta) **no representan una deuda por sí mismos**, representan la venta/servicio o el registro del cobro. Pueden existir sin `Payment` (hoy, indebidamente, en POS) y `Payment` puede existir sin comprobante (normal, la mayoría de cobranza de liquidación no emite boleta). **No hace falta forzar que todo comprobante genere una deuda** — tu negocio no lo necesita (correctamente descartado ya en Fase 2 §11, Escenario A).

---

## 23. Reglas de negocio — validadas una por una

| # | Regla propuesta | Veredicto |
|---|---|---|
| 1 | Una deuda representa una obligación pendiente | ✅ Correcta |
| 2 | Una liquidación agrupa/comunica las obligaciones de un periodo | ✅ Correcta — confirmado que la liquidación es un agrupador de comunicación, no la obligación en sí |
| 3 | Una deuda puede sobrevivir al cierre de una liquidación | ✅ Correcta, ya funciona así (`SnapshotAndReleaseOpenDebtsOnClose`) |
| 4 | Una deuda pendiente puede aparecer en una liquidación posterior | ✅ Correcta, ya funciona (arrastre) |
| 5 | Un Payment representa dinero recibido | ✅ Correcta, principio central confirmado |
| 6 | Un Payment puede existir sin deuda | ✅ Correcta, ya funciona (`on_account`) |
| 7 | Un Payment puede aplicarse a 0, 1 o N deudas | ✅ Correcta como objetivo — falta el "aplicar después" (Fase 2 Flujo 5) |
| 8 | Un pago independiente no reduce una deuda automáticamente | ✅ Correcta — y de hecho hoy tampoco la reduce a nivel de `PaymentAllocation` (eso está bien); el problema es que sí la reduce indirectamente en el Dashboard (§21) |
| 9 | Solo una PaymentAllocation reduce una deuda | ✅ Correcta, y es justo la regla que el Dashboard viola indirectamente |
| 10 | Todo dinero recibido debe quedar registrado | ✅ Correcta — violada hoy solo por POS |
| 11 | Un comprobante no representa automáticamente otro movimiento de dinero | ✅ Correcta, y confirmado que **ya se cumple** en el código actual (§16) |
| 12 | El monto pendiente de una deuda depende de sus aplicaciones válidas | ✅ Correcta, ya es así vía `balance_amount`/`PersistBalanceAndStatus` |

**Las 12 reglas que propones son correctas tal cual — ninguna necesitó corrección.** Se suman a las 13 ya consolidadas en Fase 2 §15 (hay solapamiento entre ambas listas, no contradicción).

---

## 24. Matriz de escenarios — completada

| Escenario | ¿Deuda? | ¿Payment? | ¿PaymentAllocation? | ¿Comprobante? | ¿Reduce deuda? |
|---|---|---|---|---|---|
| Deuda mensual sin pagar | Sí | No | No | No aplica | No |
| Pago total de deuda | Sí (ya existente) | Sí | Sí (1) | Opcional | Sí |
| Pago parcial | Sí (ya existente) | Sí | Sí (1, parcial) | Opcional | Sí (parcial) |
| Pago a cuenta | No necesariamente | Sí | No (0) | Opcional, si se emite luego | No |
| Pago a cuenta luego aplicado | Sí (ya existente) | Sí (el mismo) | Sí (agregada después) | Opcional | Sí, en el momento de aplicar |
| Pago independiente por servicio | **No** | Sí | No (0) | **Sí, normalmente** (boleta/nota de venta del servicio) | No |
| Sobrepago | Sí (ya existente) | Sí | Sí (parcial, cubre la deuda) | Opcional | Sí, hasta el monto de la deuda; resto queda a cuenta |
| Independiente + deuda existente (ambos a la vez) | Sí (para la parte de deuda) | Sí (pueden ser 2 `Payment`s distintos, uno con allocation y otro sin) | Solo en el que corresponde | Sí para el independiente, opcional para el otro | Solo el que tiene allocation |

La única celda que cambié respecto a tu borrador: "Pago independiente por servicio" — comprobante = **Sí** (no "?"), porque es precisamente el caso donde el comprobante SÍ suele existir (es la evidencia fiscal de la venta), a diferencia de la cobranza de liquidación donde normalmente no se emite boleta.

---

## 25. Fuentes de verdad — versión final consolidada

| Concepto | Fuente de verdad |
|---|---|
| Monto de deuda | `Document.total_amount` |
| Saldo de deuda | `Document.balance_amount` (vía `PersistBalanceAndStatus`) |
| Total aplicado a una deuda | `debt.PaidTotal(document_id)` |
| Total de pagos recibidos (empresa) | `SUM(Payment.amount)` |
| Total de pagos a cuenta | `SUM(Payment.amount − SUM(allocations)) WHERE type=on_account o remanente>0` |
| Total de pagos independientes | Mismo cálculo que "a cuenta" — **no se distingue por campo**, se distingue por presentación (¿tiene `TukifacFiscalReceipt` vinculado?) — ver §13 |
| Deuda total de empresa | `SaldoDocumentado` (Fase 2 §8) — única función, no 4 |
| Historial de pagos | Tabla `payments`, filtrable por empresa/fecha/tipo — ya existe |
| Relación pago-deuda | `PaymentAllocation` |
| Origen de deuda | **Falta**: `Document.origin_settlement_id` (Fase 2 §9) |
| Liquidación actual | `Document.tax_settlement_id` |
| Comprobante | `TukifacFiscalReceipt`, enlazado opcionalmente vía `LinkedPaymentID` |

Sin cambios respecto a Fase 2 — esta fase no encontró ninguna fuente de verdad adicional en conflicto, solo confirmó que las ya definidas cubren también el caso de pagos independientes.

---

## 26. Clasificación de hallazgos

### 🔴 BUG
- Borrado físico de deudas arrastradas (Fase 1/2, sin cambios).
- Rechazo de sobrepagos con deuda parcial insuficiente (Fase 1/2, sin cambios).
- Dashboard/Estado de cuenta/Reporte financiero calculan "deuda de empresa" restando TODOS los pagos (incluyendo independientes y a cuenta) — confirmado con el ejemplo de negocio del §21 que esto produce saldos negativos falsos en un escenario perfectamente normal de tu negocio (liquidación + servicio adicional pagados el mismo mes).

### 🟠 FUNCIONALIDAD FALTANTE
- Aplicar un pago a cuenta existente a una o varias deudas sin borrar/recrear (Fase 2 Flujo 5).
- Anulación auditable de pagos (Fase 2 §13).
- **POS no crea `Payment` al emitir** — no es exactamente "funcionalidad faltante" en el sentido de que el patrón correcto YA EXISTE (Camino A de §4); es más preciso llamarlo una **inconsistencia entre dos flujos que deberían comportarse igual** (ver 🔵 abajo, matiz de decisión).

### 🟡 REFACTOR
- Unificar Dashboard/Estado de cuenta/Reporte financiero para usar `SaldoDocumentado` en vez de sus propios `SUM` independientes.
- `Payment.fiscal_status` escrito desde 3 lugares.

### 🔵 DECISIÓN DE NEGOCIO (no lo resuelvo yo, necesito tu decisión antes de tocar código)
1. **¿POS debería crear el `Payment` automáticamente al emitir** (replicando exactamente lo que ya hace `IssueComprobanteFromPayment` pero en el orden inverso), **o prefieres mantener el flujo POS tal cual y en su lugar reforzar con una alerta/bandeja** que obligue a completar la conciliación manualmente? Ambas son válidas para tu negocio — la primera elimina el riesgo de raíz, la segunda mantiene el control manual actual. Ya lo habíamos dejado abierto en Fase 2, lo confirmo aquí como pendiente real de decidir, no de código.
2. **¿Un pago independiente (servicio adicional) debería, además, quedar visualmente separado en el estado de cuenta** de los pagos "a cuenta genuinos" (con la regla de presentación del §13: tiene comprobante vinculado → independiente; no tiene → a cuenta pendiente), **o prefieres que ambos se muestren igual bajo "a cuenta"** por ahora? Es una decisión de UX, no de datos — el dato para hacerlo ya existe.

---

## Flujos canónicos (A-J)

Los Flujos A (liquidación mensual), C (arrastre), D (pago de deuda), E (parcial), F (a cuenta), G (aplicación posterior) e I (sobrepago) **son idénticos a los Flujos 1, 6/10/11, 2, 3, 4, 5, 7 de Fase 2 §16** — no se repiten aquí. Los nuevos, específicos de esta fase:

### Flujo B — Deuda pendiente (sin acción)
**Entidades**: `Document` solo. **Operación**: ninguna, es el estado natural post-creación. **Regla**: `status=pendiente` mientras `balance_amount=total_amount`.

### Flujo H — Pago independiente
**Entidades**: `Payment` (sin `document_id`, sin allocations), `TukifacFiscalReceipt` (opcional, normalmente sí). **Operación**: `POST /payments` (`type=on_account`, con `description` del servicio) → opcionalmente `POST /payments/:id/issue-comprobante`. **Saldo**: ninguna deuda se toca. **Regla**: 5, 6, 8, 9, 11 (§23). **Transaccional**: cada paso ya lo es individualmente (creación de pago, emisión de comprobante) — no necesitan ser una sola transacción porque son decisiones independientes en el tiempo (se puede pagar hoy y emitir el comprobante después). **Estado actual**: ✅ funciona vía Finanzas (Camino A), 🔴 roto vía POS (Camino B).

### Flujo J — Generación de comprobante
**Entidades**: `TukifacFiscalReceipt`, `Payment` (origen). **Operación**: `IssueComprobanteFromPayment` — construye líneas desde las `PaymentAllocation`s del pago si existen, o una línea genérica por el monto total si no hay ninguna (pago independiente). **Regla**: 11 — nunca duplica el monto en ningún reporte (confirmado §16). **Transaccional**: sí, ya lo es (crea receipt+líneas+vínculo con el pago en una sola transacción).

---

## Pregunta central — respuesta en una frase por entidad

> **Deuda (`Document`)** = un concepto individual que la empresa debe pagar al estudio, con vida propia más allá de en qué liquidación aparezca hoy.
> **Liquidación (`TaxSettlement`)** = el resumen mensual que agrupa y comunica esas deudas a la empresa, sin ser ella misma la obligación.
> **Payment** = el dinero que efectivamente entró al estudio, exista o no una deuda que lo explique.
> **PaymentAllocation** = la decisión, explícita y editable en el tiempo, de contra qué deuda(s) se usa ese dinero.
> **Comprobante (`TukifacFiscalReceipt`)** = la evidencia fiscal/comercial de una venta o cobro, nunca la fuente del dinero ni de la deuda.

**Estas 5 definiciones ya funcionan correctamente tanto para cobranza mensual como para pagos independientes** — lo demuestra el escenario combinado del §21: con `SaldoDocumentado` como única fuente de deuda de empresa, un pago independiente de S/300 conviviendo con una deuda de liquidación de S/1000 nunca produce un saldo negativo ni una deuda mal calculada. **El único punto donde el sistema hoy no respeta estas definiciones es POS** (crea comprobante sin el `Payment` que las 5 definiciones exigen que exista siempre que hay dinero real) — y es, como ya señalamos, una decisión de negocio pendiente, no un defecto de arquitectura.

---

## Plan de implementación (prioridad, sin ejecutar aún)

1. 🔴 `origin_settlement_id` + corregir las funciones de limpieza de liquidaciones (Fase 2, máxima prioridad — pérdida de datos activa).
2. 🔴 Permitir remanente en sobrepagos (`ValidatePaymentAmountsAndAllocations`).
3. 🔴 Unificar Dashboard/Estado de cuenta/Reporte financiero en `SaldoDocumentado` — esta fase demostró con un ejemplo de negocio real que produce cifras negativas falsas hoy.
4. 🔵 Decidir el punto de POS (crear Payment automático vs. alerta) — **bloquea** cualquier trabajo de código sobre POS hasta que decidas.
5. 🟠 Aplicar pago a cuenta post-hoc (Fase 2 Flujo 5).
6. 🟠 Anulación auditable de pagos.
7. 🔵 Decidir si separar visualmente "independiente" de "a cuenta" en la UI (§13) — no bloquea nada, es cosmético.
8. 🟡 Refactors menores (`fiscal_status` centralizado, etc.)

Ningún punto requiere entidades nuevas ni módulos de compras/proveedores/caja/bancos.
