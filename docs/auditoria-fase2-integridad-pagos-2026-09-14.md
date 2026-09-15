# Auditoría Fase 2 — Integridad de pagos, pagos a cuenta, sobrepagos y aplicación posterior

**Fecha**: 2026-09-14
**Alcance**: exclusivamente `Payment`, `PaymentAllocation`, su relación con `Document` (ya protegido por Fase 1) y con `TukifacFiscalReceipt`. Sin caja/bancos/cuentas por pagar/contabilidad completa.
**Regla seguida**: solo lectura y diseño. **Ningún código, modelo, migración, endpoint o UI fue modificado.** Corrí únicamente los tests existentes (sin cambios) para confirmar el comportamiento actual documentado aquí.

---

## 1. Resumen ejecutivo

**Lo que está bien**: la separación conceptual `Payment` (dinero) vs. `PaymentAllocation` (aplicación) vs. `Document` (deuda) ya existe en el modelo de datos y funciona correctamente en el camino feliz — pago total, parcial, a cuenta puro (100% sin aplicar), y reparto FIFO/manual entre varias deudas. `DeletePaymentTx` revierte correctamente allocations y saldo.

**Lo que está mal** (resumen, detalle en §8):
1. **🔴 Sobrepago con deuda parcial insuficiente se rechaza por completo** — `ValidatePaymentAmountsAndAllocations` exige `SUM(allocations) == amount` exacto (sin margen), así que un pago que cubre toda la deuda disponible y deja un remanente falla con error, en vez de aplicar lo posible y dejar el resto como saldo no aplicado. Solo el caso extremo "cero deuda" cae a `on_account` completo.
2. **🔴 No existe forma de aplicar después un `Payment` `on_account` a una o varias deudas** sin borrarlo y recrearlo — `PaymentService.Update` solo permite fijar **un** `DocumentID` legacy (sin crear `PaymentAllocation`), y además prohíbe editar cualquier pago que ya tenga imputaciones.
3. **🟠 `Payment.Purpose` no existe** — hoy no hay forma de distinguir a nivel de dato "dinero destinado a deuda, aún sin aplicar" de "ingreso independiente de un servicio" — ambos son técnicamente idénticos (`type=on_account`, 0 allocations), lo cual es ambiguo para reportes y para saber si algo "queda pendiente de aplicar".
4. **🟠 POS nunca crea `Payment`** — ya documentado en la auditoría original; sigue sin corregirse (fuera del alcance de Fase 1, pertenece aquí o a una fase POS dedicada).
5. **🟠 Sin locking en la aplicación de pagos** — ninguna lectura de `Document.balance_amount` durante `ValidateAllocationsTx`/`ApplyPaymentTx` usa `SELECT ... FOR UPDATE`, a diferencia de otros contadores del mismo proyecto (series de comprobantes, plantillas de actividad) que sí lo usan. Riesgo real de doble aplicación con dos requests concurrentes sobre el mismo documento.
6. **🟡 Dos mecanismos de aplicación coexistiendo activamente** (no solo históricamente): `PaymentAllocation` (moderno) y `Payment.DocumentID` (legacy) — y until confirmé algo no documentado antes: `Payment.DocumentID` **sigue siendo un camino de escritura vivo hoy** (vía `PaymentService.Update`), no solo un remanente de datos viejos, y además `database.BackfillPaymentAllocations()` corre en **cada arranque del backend** (no una sola vez) y crea automáticamente la `PaymentAllocation` faltante para cualquier pago legacy — hay una ventana entre que un pago se actualiza vía `Update` y el próximo reinicio del backend en la que el mismo dinero está representado solo por `DocumentID`, no por `PaymentAllocation`.

---

## 2. Modelo actual — diagrama con las variantes reales

```
                    ┌── on_account puro (0 allocations, Payment.DocumentID=nil) ──► queda "suelto"
                    │
Payment ────────────┼── applied vía CreateFromParams (FIFO/manual/single) ──► SIEMPRE Payment.DocumentID=nil,
                    │                                                          relación exclusiva vía PaymentAllocation
                    │
                    └── applied vía PaymentService.Update (legacy) ──► Payment.DocumentID=X, SIN PaymentAllocation
                                                                         (hasta el próximo restart, que la crea)

TukifacFiscalReceipt ──(opcional, LinkedPaymentID)──► Payment   [nunca al revés; el comprobante no es la fuente del dinero]

PaymentAllocation(N) ──► Document.balance_amount  [única función que lo actualiza: debt.PersistBalanceAndStatus]
```

No existe ningún caso donde un `Payment` tenga **simultáneamente** `DocumentID` seteado y `PaymentAllocation`s **en el momento de su creación** — pero sí puede ocurrir de forma **transitoria** (Update + backfill de arranque), y en datos históricos migrados es el estado esperado permanente (ambos presentes, ver §11).

---

## 3. Estado actual de `Payment`

| Campo | Uso actual | Uso esperado (Blueprint) | Problema |
|---|---|---|---|
| `ID`, `CompanyID`, `Date`, `Amount`, `Method`, `Reference`, `Attachment`, `Description`, `Notes` | Datos del cobro | Igual | Ninguno |
| `DocumentID *uint` | Legacy: aplicación directa a UN documento (sigue escribiéndose hoy vía `Update`) | Solo lectura/compatibilidad, nunca escritura nueva | **Activo, no solo legacy de datos** — ver §6/§11 |
| `Type` (`applied`/`on_account`) | Mecánico: ¿tiene alguna aplicación? Se re-deriva en `Update` según si `DocumentID != nil` | Igual (mecánico) | Ninguno de fondo, pero se confunde con "propósito" en la práctica (ver §4A) |
| `DiscountAmount` | Descuento comercial; exige `amount+discount == SUM(allocations)` y cada línea cubra el saldo completo | Igual | Ninguno |
| `FiscalStatus` (`na`/`pending_receipt`/`linked`) | Vínculo con comprobante Tukifac | Igual | Escrito desde 3 lugares no centralizados (`CreateFromParams`, `fiscal_receipt_issue_service.go:231`, `fiscal_receipt_service.go:275`) |
| `TaxSettlementID *uint` | Liquidación a la que se asocia el pago (opcional) | Igual | Ninguno |
| `Purpose` | **No existe** | `deuda` \| `servicio`, explícito, nunca inferido | 🟠 Falta — es el objeto central de esta fase |
| `Allocations []PaymentAllocation` | Relación 1-a-N | Igual | Ninguno |
| `TukifacFiscalReceipt` (por `LinkedPaymentID`) | Comprobante asociado, opcional | Igual | Ninguno de fondo |
| `DeletedAt` | Soft-delete físico, sin motivo/usuario | Estado auditable (`voided_at/by/reason`) | 🟠 Sin auditoría de anulación (ya señalado en fases previas, sigue pendiente) |

---

## 4. Estado actual de `PaymentAllocation`

| Campo | Uso actual | Uso esperado | Problema |
|---|---|---|---|
| `PaymentID`, `DocumentID` (ambos `not null`) | Relación N-a-N vía tabla puente | Igual | Ninguno |
| `Amount` | Monto imputado a ese documento | Igual | Ninguno |
| Constraint de unicidad | **No existe** — nada impide 2 filas `(payment_id, document_id)` idénticas si algo las creara por error | Debería haber una, o al menos una validación de negocio | 🟡 `ValidateAllocationsTx` sí rechaza duplicados **dentro de una misma llamada** (`seen[]`), pero no contra filas ya existentes en BD de otra llamada — riesgo de doble-submit (ver §15) |
| `DeletedAt` | Soft-delete, se borra en cascada al revertir el pago | Igual | Ninguno |

---

## A. ¿Qué significa `Payment.Type` hoy?

Representa **mecánica**, no naturaleza: `applied` = tiene ≥1 imputación (o `DocumentID` legacy); `on_account` = ninguna. Se determina así:
- En creación (`CreateFromParams`): explícito según el modo (`on_account` forzado si `p.Type==""` y no hay documento/allocations/fifo válido; `applied` forzado dentro de `ApplyPaymentTx`, línea 139, **sin importar lo que el llamador haya pedido**).
- En `Update`: re-derivado (`p.DocumentID == nil → on_account`, si no `applied`).

**No está mal usado como "naturaleza del ingreso"** en el código — el código es consistente en tratarlo como mecánico. El problema es que **no hay ningún otro campo** que capture la naturaleza (deuda vs. servicio), así que en la práctica el equipo/reportes solo tienen `Type` para inferir algo, y `Type=on_account` es indistinguible entre "a cuenta de una deuda futura" y "ingreso de un servicio que nunca tendrá deuda" — exactamente el vacío que `Purpose` debe llenar.

---

## 5. Matriz de flujos

| Escenario | Estado actual | Problema | Comportamiento esperado |
|---|---|---|---|
| Deuda cobrada completa | ✅ Funciona (`single`/`fifo`/`manual`, 1+ allocation cubre balance) | Ninguno | Igual |
| Deuda parcialmente cobrada | ✅ Funciona (`status→parcial`) | Ninguno | Igual |
| Pago a cuenta (sin decidir deuda) | ✅ Funciona (`type=on_account`, 0 allocations) | No se distingue de "ingreso independiente" (falta `Purpose`) | `purpose=deuda`, `type=on_account` |
| Sobrepago (deuda parcial insuficiente) | 🔴 **Roto** — `sum(allocations) < amount` es rechazado por `ValidatePaymentAmountsAndAllocations:110-112` salvo que la deuda sea exactamente $0 | Operación completa falla; usuario debe reducir el monto a mano o usar 2 pagos | Aplicar lo posible, dejar `amount - sum(allocations)` como remanente explícito, mismo `Payment` |
| Pago independiente (servicio) | 🟠 **Técnicamente posible pero indistinguible** de "a cuenta" — mismo `type=on_account`, 0 allocations, sin campo que diga "esto nunca se va a aplicar" | Un reporte de "dinero pendiente de aplicar" mostraría también los ingresos por servicios, que nunca deberían tener nada pendiente | `purpose=servicio` explícito |
| POS contado | 🔴 No crea `Payment` — solo `TukifacFiscalReceipt` (`pos_sale_service.go`, ya documentado en la auditoría original, sin cambios desde entonces) | Dinero real invisible en `/payments`, dashboard, reportes hasta conciliación manual | `Payment` creado en la misma transacción que el comprobante |
| POS crédito | No existe tal flujo hoy — POS nunca crea `Document` (correcto, según Blueprint no debe crearlo artificialmente) | N/A — es una funcionalidad no implementada, no un bug | Si se implementa: `Document` real + luego `Payment`+`PaymentAllocation` al cobrar |
| Aplicación posterior de pago a cuenta | 🔴 **No soportado** sin borrar/recrear (`Update` solo legacy, un documento, sin allocation) | Pierde trazabilidad (nuevo id, nueva fecha) | Nueva acción que solo agregue `PaymentAllocation`s al `Payment` existente |
| Pago contra múltiples deudas | ✅ Funciona (`manual`/`fifo`, N allocations, `SUM==amount` exacto) | Ninguno en el camino exacto; falla si no puede cubrir el 100% (mismo bug del sobrepago) | Igual, con soporte de remanente |

---

## 6. Todas las validaciones encontradas

| # | Archivo:línea | Regla actual | Problema | Comportamiento esperado |
|---|---|---|---|---|
| 1 | `payment_service.go:116-117` | `Amount <= 0` → error | Ninguno (Invariante 1 se cumple) | Igual |
| 2 | `payment_service.go:119-122` | `DiscountAmount < 0` → error | Ninguno | Igual |
| 3 | `payment_service.go:131-133` | `Type` debe ser `applied`/`on_account` | Ninguno | Igual |
| 4 | `payment_apply.go:53-54` (`ValidateAllocationsTx`) | cada línea requiere `DocumentID!=0` y `Amount>0` | Ninguno | Igual |
| 5 | `payment_apply.go:56-59` | documento repetido en la misma llamada → error | Ninguno | Igual |
| 6 | `payment_apply.go:68-70` | documento `anulado` → no se puede imputar | Ninguno | Igual |
| 7 | `payment_apply.go:72-74` | `ln.Amount > bal + MoneyEpsilon` → error ("excede el saldo") | Ninguno — correcto, protege contra sobre-imputar UN documento | Igual |
| 8 | `payment_apply.go:76-78` | documento ya vinculado a otra liquidación (si se pasa `taxSettlementID`) → error | Ninguno | Igual |
| 9 | `payment_apply.go:96-98` (con descuento) | `amount+discount == sum` exacto | Ninguno (con descuento sí tiene sentido exigir exactitud) | Igual |
| 10 | `payment_apply.go:105-107` | con descuento, cada línea debe cubrir el saldo completo de su documento | Ninguno | Igual |
| 11 | **`payment_apply.go:110-112`** (sin descuento) | **`sum == amount` exacto** | 🔴 **Es la causa raíz del bug de sobrepago** — no permite `sum < amount` | `sum <= amount`, remanente explícito |
| 12 | `payment_service.go:314-321` (`buildFIFOAllocations`) | si `remaining>0` y `!allowPartial` → error; si `len(lines)==0` y `!allowPartial` → error | Consistente con #11 (mismo síntoma) | Igual, corregido junto con #11 |
| 13 | `payment_service.go:335-337` (`Update`) | prohíbe editar si `DocumentID!=nil` **o** `Type==applied` **o** `allocCount>0` | Correcto como protección, pero es la razón por la que "aplicar después" no existe — no hay una acción alternativa que sí lo permita | Mantener esta protección para `Update` genérico, agregar una acción NUEVA y distinta para "aplicar allocations a un pago sin ellas" |
| 14 | `payment_service.go:411-413` (`Update`, camino legacy) | `p.Amount > bal+0.005` → error | Correcto — el único lugar que sí bloquea un "sobrepago" en el camino legacy, de forma más estricta que el resto | Consistente tras el fix; documentarlo como comportamiento intencional del camino legacy (1 documento, sin remanente permitido ahí) |
| 15 | `payment_apply.go:122-124` (`ApplyPaymentTx`) | `CompanyID==0` / `Amount<=0` → error | Ninguno | Igual |

---

## 7. Todas las rutas de escritura (Payment / PaymentAllocation)

| Operación | Archivo:línea | Notas |
|---|---|---|
| **Create** `Payment` (on_account puro) | `payment_service.go:149-165`, `198-214` | 2 sitios casi idénticos (rama explícita + fallback de FIFO sin deuda) |
| **Create** `Payment` (applied) | `payment_apply.go:136-153` (`ApplyPaymentTx`), única función que crea pagos `applied` | `DocumentID` siempre `nil` aquí |
| **Update** `Payment` | `payment_service.go:416` (`tx.Save`) | Único punto de edición; el único que puede fijar `DocumentID` hoy |
| **Delete/Anular** `Payment` | `payment_service.go:567` (`DeletePaymentTx`) | Soft-delete físico, sin motivo/usuario (ver hallazgo Fase 1, sigue pendiente) |
| **Create** `PaymentAllocation` | `payment_apply.go:155-159` (creación normal), `database/backfill_allocations.go:26-31` (backfill de arranque) | 2 caminos |
| **Delete** `PaymentAllocation` | `payment_apply.go:190` (`RevertPaymentAllocationsTx`, sin llamador activo hoy — código muerto/reservado), `payment_service.go:563` (`DeletePaymentTx`) | |
| **Modifica `Payment.Type`** | `CreateFromParams` (al crear), `Update` (al editar) | Nunca se modifica fuera de estos 2 |
| **Modifica `Payment.DocumentID`** | Solo `Update:362-368` | Único lugar en todo el backend |
| **Relaciona comprobante↔Payment** | `fiscal_receipt_issue_service.go:222,228,231`, `fiscal_receipt_service.go:182,218,221,275` | Ya auditado en la fase original, sin cambios |

---

## 8. Problemas encontrados (clasificados)

### 🔴 CRÍTICO
1. **Sobrepago con deuda parcial insuficiente se rechaza** (`payment_apply.go:110-112`). Bloquea una operación de cobranza legítima y frecuente.
2. **No hay forma de aplicar después un pago a cuenta** sin destruir su identidad (borrar+recrear). Rompe trazabilidad (fecha real de cobro, comprobante ya vinculado si lo hubiera).

### 🟠 ALTO
3. **`Payment.Purpose` no existe** — ambigüedad entre "a cuenta de deuda" y "servicio independiente" en cualquier reporte de "dinero pendiente de aplicar".
4. **POS no crea `Payment`** (persiste desde la auditoría original).
5. **Sin locking optimista/pesimista en la aplicación de pagos** — ver §9 abajo, riesgo de doble aplicación concurrente sobre el mismo documento. El propio proyecto ya usa `clause.Locking{Strength:"UPDATE"}` en otros contadores (series de comprobantes, plantillas), pero no aquí.

### 🟡 MEDIO
6. **`Payment.DocumentID` sigue siendo un camino de escritura activo** (no solo dato histórico) vía `Update`, con una ventana de inconsistencia hasta el próximo backfill de arranque.
7. **Sin protección contra doble-submit**: nada impide que la misma petición de creación de pago, enviada dos veces (doble clic, reintento de red), cree dos `Payment` con las mismas `Allocation`s — no hay idempotency key ni unique constraint relevante.
8. **`fiscal_status` escrito desde 3 lugares no centralizados** (persiste de la auditoría original).

### 🔵 BAJO
9. `RevertPaymentAllocationsTx` es código sin llamador activo (marcado `TODO: remove legacy`) — no rompe nada, pero es ruido a limpiar eventualmente.

---

## 9. Concurrencia — dónde está el riesgo exacto

`ValidateAllocationsTx` (línea 62): `tx.First(&d, ln.DocumentID)` — lectura simple, **sin `.Clauses(clause.Locking{Strength: "UPDATE"})`**. `ApplyPaymentTx` inserta la allocation y llama `PersistBalanceAndStatus`, que vuelve a leer (`tx.First`) y recalcula sumando `PaymentAllocation` — también sin lock.

**Escenario concreto**: Documento con saldo 100. Dos usuarios registran, casi simultáneamente, un pago de 80 cada uno contra ese mismo documento (dos requests HTTP distintos, dos transacciones DB distintas). Ambas transacciones leen `balance_amount=100` (o lo recalculan a partir de `PaidTotal=0`) **antes** de que la otra confirme su `INSERT` en `payment_allocations`, ambas pasan la validación `80 <= 100`, ambas insertan su allocation y ambas llaman `PersistBalanceAndStatus` — dependiendo del nivel de aislamiento efectivo de MySQL/InnoDB (REPEATABLE READ por defecto) y del momento exacto de cada lectura dentro de su propia transacción, es posible terminar con **160 aplicado sobre una deuda de 100** (violación directa de la Invariante 3). Confirmé por búsqueda global (`grep FOR UPDATE`) que el proyecto **sí** usa este mecanismo en otro lugar (`fiscal_document_series_service.go:206`, `activity_template_service.go:90`) — es un patrón conocido por el equipo, simplemente no se aplicó aquí. No es una construcción teórica: es la ausencia de un patrón que el propio código ya usa en casos análogos.

---

## 10. Preguntas del criterio de éxito — respondidas

1. **¿Dónde se crea cada Payment?** `CreateFromParams` (2 ramas on_account + `ApplyPaymentTx` para applied) y `PaymentService.Create` (wrapper legacy que delega a `CreateFromParams`). Nunca desde POS, nunca desde liquidaciones directamente (liquidaciones usan el mismo `CreateFromParams`/`ApplyPaymentTx` vía el flujo normal de Pagos).
2. **¿Dónde se impide un sobrepago?** Parcialmente: `ValidateAllocationsTx:72-74` impide sobrepagar **un documento individual** dentro de una imputación (correcto y se mantiene); `ValidatePaymentAmountsAndAllocations:110-112` impide indebidamente que el **pago total** exceda la suma de imputaciones (el bug).
3. **¿Dónde se decide si un Payment está aplicado?** `Type` — fijado por `ApplyPaymentTx` (siempre `applied`) o derivado en `Update` según `DocumentID`. La UI (`Payments.tsx`, ya visto en fases previas) además usa `!p.document_id` como señal visual independiente de `Type`.
4. **¿Dónde se usa `Payment.DocumentID`?** Solo en `PaymentService.Update` (escritura) y en `debt.PaidTotal`/`DeletePaymentTx` (lectura, para sumar/revertir pagos legacy). `ApplyPaymentTx` lo fuerza siempre a `nil`.
5. **¿Dónde se usa `PaymentAllocation`?** `ApplyPaymentTx` (creación), `debt.PaidTotal`/`EffectiveBalance` (lectura para saldo), `DeletePaymentTx`/`RevertPaymentAllocationsTx` (reversión), `database.BackfillPaymentAllocations` (backfill de arranque desde legacy).
6. **¿Existen Payments con ambas relaciones?** Estructuralmente no en el momento de creación (mutuamente excluyentes por diseño), pero **sí de forma transitoria o histórica**: cualquier pago legacy con `DocumentID` termina con una `PaymentAllocation` equivalente tras el próximo reinicio del backend (backfill automático no gateado por `schema_migrations`, corre siempre).
7. **¿Existen Payments independientes?** Técnicamente sí (`type=on_account`, sin documento) pero sin ninguna marca que diga "esto es un servicio, nunca esperes que se aplique" — indistinguible de un "a cuenta" genuino.
8. **¿Puede el sistema representar S/1,000 con S/700 aplicado y S/300 restante?** **No, hoy no** — `ValidatePaymentAmountsAndAllocations` lo rechazaría (`sum=700 != amount=1000`), salvo el caso especial de "cero deuda total" que cae a 100% on_account, no a un remanente parcial junto con aplicación parcial.
9. **¿Puede un Payment aplicarse después?** No sin borrar y recrear (`Update` no soporta agregar allocations).
10. **¿Puede aplicarse a múltiples documentos?** Sí, en la creación (`manual`/`fifo`), siempre que la suma sea exacta.
11. **¿Dónde está el riesgo de doble aplicación por concurrencia?** `ValidateAllocationsTx`/`ApplyPaymentTx`/`PersistBalanceAndStatus` — ninguna lectura de saldo usa lock, ver §9.
12. **¿Cómo introducir `Payment.Purpose` sin clasificar mal los históricos?** Ver §11 — estrategia de backfill NULL-por-defecto con reporte de ambigüedad, igual criterio que Fase 1.

---

## 11. Estrategia de migración de `Payment.Purpose` (propuesta, no implementada)

**Clasificación de pagos existentes, por evidencia disponible:**

| Señal disponible | Clasificación propuesta | Confianza |
|---|---|---|
| Tiene `PaymentAllocation` o `DocumentID` legacy apuntando a un `Document` con `Source IN (liquidacion, recurrente_plan)` | `purpose=deuda` | Alta — hay una deuda real de cobranza detrás |
| Tiene `PaymentAllocation`/`DocumentID` apuntando a un `Document` con `Source=manual` | `purpose=deuda` | Media-alta — es una cuenta por cobrar manual, sigue siendo "deuda" en sentido amplio |
| `type=on_account`, sin ninguna allocation nunca, con `TukifacFiscalReceipt` vinculado cuyo `origin=pos_sale` | `purpose=servicio` | Media — es el patrón típico de una venta de mostrador, pero no 100% seguro sin revisar el concepto |
| `type=on_account`, sin allocation, **sin** comprobante vinculado, sin ningún otro indicio | **Ambiguo → NULL** | — no hay evidencia suficiente para decidir si algún día se pensaba aplicar a una deuda o si fue un ingreso suelto |

**Regla**: igual que en Fase 1 — preferir `NULL` (o un tercer valor explícito `sin_clasificar`) antes que asignar `deuda`/`servicio` sin evidencia. El reporte de backfill debe separar: total analizados, clasificados como deuda (con desglose de por qué), clasificados como servicio (con desglose), y dejados sin clasificar con el conteo exacto.

**Compatibilidad legacy**: `Payment.DocumentID` y `Type` **no se tocan ni se eliminan** en esta migración — `Purpose` es un campo nuevo, aditivo, nullable.

---

## 12. Estrategia transaccional propuesta (diseño, no implementado)

| Operación | Debe ser atómica junto con | Lock necesario |
|---|---|---|
| Crear pago aplicado (nuevo) | Insert `Payment` + N `PaymentAllocation` + recálculo de saldo por documento — **ya lo es** (una sola `tx.Transaction`) | Agregar `SELECT ... FOR UPDATE` sobre cada `Document` afectado, ANTES de leer su saldo para validar, dentro de la misma transacción |
| Aplicar pago a cuenta existente (nueva función) | Igual patrón: dentro de una transacción, lock del/los documento(s) destino, validar disponible del pago (`amount - sum(allocations existentes)`), crear allocations, recalcular saldo | Mismo lock |
| Desasignar/anular una allocation | Borrar allocation + recalcular saldo del documento — ya es lo que hace `DeletePaymentTx`/`RevertPaymentAllocationsTx` | Mismo lock sobre el documento durante el recálculo |
| Sobrepago (remanente) | Una sola transacción: crear pago, crear allocations parciales que sí caben, dejar el resto sin allocation (mismo registro) | Igual |

No se requiere ningún mecanismo nuevo de infraestructura — el propio patrón `tx.Clauses(clause.Locking{Strength: "UPDATE"})` ya usado en `fiscal_document_series_service.go` es exactamente lo que hace falta replicar aquí, documento por documento, dentro de las transacciones que ya existen.

---

## 13. Plan de implementación propuesto (subfases, NINGUNA implementada aún)

```
Fase 2.1  Modelo: agregar Payment.Purpose (nullable) — sin lógica todavía
Fase 2.2  Migración/backfill de Purpose con reporte de ambiguos (mismo patrón que Fase 1)
Fase 2.3  Corregir ValidatePaymentAmountsAndAllocations / buildFIFOAllocations para permitir remanente (sobrepago)
Fase 2.4  Nueva función AllocateExisting (aplicación posterior de pago a cuenta) + endpoint
Fase 2.5  Locking (FOR UPDATE) en la validación/aplicación de allocations
Fase 2.6  Fijar Purpose explícitamente en los puntos de creación existentes (Finanzas, conciliación de comprobantes)
Fase 2.7  POS: crear Payment en la misma transacción que el comprobante (requiere 2.3 y 2.6 ya hechas)
Fase 2.8  Tests de integración de todo lo anterior + regresión
```

Cada subfase es aprobable y desplegable por separado; ninguna requiere las demás para compilar, salvo 2.7 que depende de 2.3 y 2.6.

---

## 14. Tests propuestos (diseño, ninguno creado aún)

Los 20 solicitados, mapeados a dónde vivirían:

| # | Caso | Paquete sugerido |
|---|---|---|
| 1-3 | Pago total / parcial / a cuenta | `services/debt` (ya hay cobertura parcial vía tests existentes de `payment_apply`) |
| 4 | Aplicación posterior | `services` (nueva función `AllocateExisting`) |
| 5 | Pago a múltiples documentos | `services/debt` |
| 6 | Sobrepago con remanente | `services/debt` (extender `payment_apply_test.go`) |
| 7-9 | Pago independiente (servicio, sin Document, sin Allocation) | `services` (una vez exista `Purpose`) |
| 10-12 | Remainder / completamente aplicado / parcialmente aplicado | `services/debt` |
| 13-14 | Allocation > Payment / Allocation > saldo del Document | `services/debt` (13 es nuevo tras el fix; 14 ya está cubierto hoy) |
| 15 | Doble aplicación concurrente | `services/debt`, usando 2 goroutines + `sync.WaitGroup` contra la misma sqlite en memoria, o test de integración con locking real |
| 16 | Compatibilidad `Payment.DocumentID` legacy | `services` (ya parcialmente ejercitado por `TestDocumentServiceDelete_BlocksDocumentWithPaymentAllocation` de Fase 1, ampliar) |
| 17-18 | Con/sin comprobante | `services` |
| 19 | Rollback completo Payment+Allocation | `services` (simular error a mitad de transacción) |
| 20 | Idempotencia | `services` (mismo request 2 veces) |

---

## 15. Ejecución de tests existentes (verificación de comprensión, sin cambios)

```
go build ./...                                    → OK
go test ./services/... ./database/... -count=1    → ok (todos los paquetes, incluye Fase 1)
```
Confirmado: la suite completa (incluida la de Fase 1) sigue en verde — esta auditoría no tocó código, por lo tanto no hay riesgo de regresión que reportar aquí.

---

## Contradicciones Blueprint vs. código actual (declaradas explícitamente)

1. El Blueprint (Fase 2, ya aprobado) asume que "aplicado parcialmente + remanente" es un estado natural del modelo — el código actual lo **prohíbe explícitamente** en la validación. No es una interpretación errónea del blueprint: es una regla de validación que hay que cambiar deliberadamente (§6, fila 11).
2. El Blueprint asume `Payment.DocumentID` como "solo legacy, ya no se escribe" — el código actual **sí lo sigue escribiendo** activamente vía `Update`. Recomiendo que la Fase 2.4 (aplicación posterior) además **deprecie** ese camino de escritura en `Update` una vez exista la función nueva, para que la afirmación del Blueprint se vuelva cierta en vez de aspiracional.

---

## FASE 2 — AUDITORÍA COMPLETADA

```
Código modificado: NO
Migraciones ejecutadas: NO

Problemas críticos encontrados: 2
Problemas altos: 3
Problemas medios: 3
Problemas bajos: 1

Recomendación:
IMPLEMENTAR

Siguiente paso recomendado:
Ejecutar Fase 2.1 + 2.2 (modelo Payment.Purpose + backfill con reporte de ambiguos) de forma aislada,
seguido de Fase 2.3 (corrección del sobrepago) por ser el hallazgo crítico con mayor impacto de negocio
inmediato y el de menor riesgo técnico (cambio acotado a una función de validación ya cubierta por tests).
```
