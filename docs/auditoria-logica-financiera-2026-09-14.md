# Auditoría de la lógica de negocio financiera — ERP ZContable

**Fecha:** 2026-09-14
**Alcance:** Pagos, Deudas, Comprobantes, Liquidaciones, Estado de cuenta, Dashboard, Reportes.
**Regla seguida:** Solo lectura y análisis. Ningún código fue modificado durante esta auditoría.

---

## 1. Resumen ejecutivo

El sistema **no es un ERP financiero completo** (no tiene compras, proveedores, cuentas por pagar, caja, bancos ni notas de crédito) — es, en su núcleo financiero real, un **sistema de cuentas por cobrar (AR) de un estudio contable hacia sus empresas clientes**, con un módulo adicional de facturación fiscal (comprobantes SUNAT) parcialmente integrado.

El modelo de datos separa correctamente **tres conceptos** en tres tablas (`Document` = deuda, `Payment` = pago, `PaymentAllocation` = aplicación pago→deuda) y sí soporta pagos sin deuda ("a cuenta"). Esta parte de tu sospecha inicial — que la vista de Pagos debería mostrar todo, esté o no aplicado — **ya está implementada correctamente** en el backend y el frontend actuales.

Sin embargo, encontré:
- **1 bug crítico de pérdida de datos ya confirmado en producción** (deudas borradas silenciosamente), con causa raíz estructural clara.
- **1 bug crítico de diseño no probado en producción pero confirmado por código**: un sobrepago con deuda parcial (ni $0 de deuda, ni deuda suficiente) puede ser **rechazado por el sistema** en vez de aplicarse parcialmente.
- **Al menos 4 implementaciones independientes** que calculan "cuánto debe una empresa", que **pueden divergir** entre sí específicamente por los pagos "a cuenta".
- **Ninguna fuente de verdad centralizada** para "quién es dueño de una deuda" cuando se trata de liquidaciones — esto es la raíz del bug de borrado.
- **Ausencia total** de: notas de crédito, anulación de comprobantes ya emitidos, anulación auditable de pagos (solo hay borrado físico), caja, banco, compras, proveedores.
- El comprobante fiscal (`TukifacFiscalReceipt`) **no tiene relación directa con la deuda** (`Document`) — solo se conectan indirectamente vía `Payment→PaymentAllocation`. Esto es lo que permite que existan comprobantes "flotando" sin ningún rastro de deuda ni de dinero (el caso POS que ya investigamos).

**Conclusión corta: la arquitectura de datos es conceptualmente razonable (comprobante ≠ deuda ≠ pago ≠ aplicación), pero la implementación tiene múltiples puntos donde esa separación se rompe o se calcula de más de una forma.**

---

## 2. Cómo funciona actualmente el sistema (visión general)

Hay **3 formas activas** de que nazca una deuda (`Document`), y son independientes entre sí:
1. **Manual** — Finanzas emite un comprobante/deuda a mano (`DocumentService.Create`).
2. **Automática por liquidación** — al crear/editar/emitir una `TaxSettlement` (liquidación mensual del estudio), las líneas tipo "ajuste"/"impuesto manual" generan un `Document` si no existía ya uno (`EnsureSettlementLineDebts`).
3. **Automática por suscripción recurrente** — un cargo mensual de plan (`SubscriptionLiquidationService`), deduplicado por empresa+mes.

**El módulo POS no crea ninguna deuda.** Emite un `TukifacFiscalReceipt` (comprobante fiscal: boleta/factura/nota de venta) totalmente aislado, sin ningún `Document` ni `Payment` asociado — ya lo comprobamos en el caso real de Fundas del Sur.

El dinero (`Payment`) se puede crear de 2 formas:
1. **Directo** (`/payments`, POST) — puede ser `on_account` (sin deuda) o `applied` (con una o varias imputaciones vía FIFO/manual/single).
2. **Desde un comprobante pendiente de conciliar** (`CreatePaymentFromReceipt`) — reutiliza exactamente el mismo motor que (1).

No existe ninguna tabla de "movimiento de caja/banco" ni de "ledger" persistido. El `Payment` mismo hace las veces de "constancia de que entró dinero" — no hay una capa aparte que registre el movimiento real de efectivo/banco.

---

## 3. Mapa de entidades financieras

| Entidad | Tabla | Qué representa realmente |
|---|---|---|
| **`Document`** | `documents` | La **deuda / cuenta por cobrar**. También hace de "comprobante interno" en algunos orígenes (`source=manual`), mezclando levemente ambos roles. |
| **`Payment`** | `payments` | El **pago recibido**. Representa a la vez "que entró dinero" (date/amount/method/reference) y, opcionalmente, "a qué deuda se aplicó" (vía `Allocations`) — es el punto de mayor mezcla conceptual del sistema, aunque de forma controlada. |
| **`PaymentAllocation`** | `payment_allocations` | La **aplicación** de un pago contra una deuda específica. Puede haber 0, 1 o varias por pago. |
| **`TukifacFiscalReceipt`** | `tukifac_fiscal_receipts` | El **comprobante fiscal/comercial** (boleta, factura, nota de venta). **No tiene FK a `Document`** — se conecta a la deuda solo indirectamente, a través de `LinkedPayment → Allocations → Document`. |
| **`TaxSettlement`** | `tax_settlements` | La **liquidación mensual de honorarios** del estudio hacia el cliente — es un agrupador de conceptos a cobrar de un periodo, no una deuda en sí misma (genera `Document`s). |
| **`AccountLedger`** | *(no persiste, es un DTO calculado)* | Un **reporte tipo extracto** armado en memoria a partir de `Document`+`Payment` para el estado de cuenta. No es un libro contable real. |
| **Caja / Banco / Compras / Proveedores / Nota de crédito** | *(no existen)* | Confirmado ausentes en todo el backend y frontend. |

---

## 4. Mapa de flujo del dinero (real, no idealizado)

```
                    ┌─── Manual (Finanzas)
                    ├─── Liquidación mensual (honorarios) ──┐
Document (deuda) ◄──┤                                        │
                    └─── Suscripción recurrente             │
                                                              ▼
                                                      TaxSettlement
                                                    (borrador→emitida→cerrada)

TukifacFiscalReceipt (comprobante)  ← sin FK directa a Document
      │  origin=pos_sale: nace aislado, sin Payment, sin Document
      │  origin=issued_local: nace YA vinculado a un Payment existente
      ▼
 LinkedPaymentID (opcional)
      │
      ▼
   Payment  ──── on_account (sin deuda) ──────────────► queda "suelto"
      │
      └─── applied (FIFO / manual / single) ──► PaymentAllocation ──► Document.balance_amount / status
                                                                        (única función centralizada:
                                                                         debt.PersistBalanceAndStatus)

(No existe Caja / Banco / Ledger persistido en ningún punto de esta cadena)
```

---

## 5. Flujo comprobante → deuda → pago

**No existe tal cadena directa.** El comprobante (`TukifacFiscalReceipt`) nunca genera una deuda (`Document`) ni viceversa. Son dos mundos que solo se tocan si:
- El comprobante nace de un pago ya aplicado a una deuda (`issued_local`) → en ese caso sí hay una cadena completa deuda→pago→comprobante, pero en **ese orden**, no comprobante→deuda→pago.
- El comprobante nace suelto (`pos_sale`) y **alguien, después, manualmente**, lo concilia contra una deuda existente (o lo deja como pago a cuenta).

Esto significa: **la cadena "venta → comprobante → deuda → pago" que describes en tu mensaje original NO es como funciona el sistema hoy.** Lo que realmente ocurre es más parecido a dos cadenas paralelas que se cruzan solo en el `Payment`:

```
CADENA A (facturación):  Venta POS ──► Comprobante fiscal
CADENA B (cobranza):     Deuda (Document) ──► Pago (Payment) ──► Aplicación (PaymentAllocation)
PUENTE (opcional, manual): Comprobante.LinkedPaymentID ──► Payment de la cadena B
```

---

## 6. Flujo pago → aplicación → movimiento de dinero

- **Pago → Aplicación**: sí existe y está bien resuelto — `PaymentAllocation` es una tabla intermedia limpia, soporta 1-a-muchos (un pago, varias deudas) mediante FIFO o modo manual.
- **Aplicación → Movimiento de dinero**: **no existe ese último eslabón**. El `Payment` en sí mismo ES el "movimiento de dinero" — no hay una tabla separada de caja/banco que se actualice después. Esto no es necesariamente incorrecto (muchos sistemas pequeños fusionan "pago" y "movimiento de dinero" en una sola entidad), pero significa que preguntas como "¿cuánto dinero real tengo en caja/banco?" **no tienen respuesta en el sistema** — solo se puede responder "cuánto se ha registrado como pagado", que es distinto (no contempla que un pago pueda no haberse depositado, o factura contra efectivo físico no arqueado, etc.).

---

## 7. Responsabilidad de cada servicio

| Servicio | Responsabilidad real observada | ¿Correcta/exclusiva? |
|---|---|---|
| `PaymentService` | Crear/editar/borrar pagos; decide FIFO/manual/on_account | Sí, es el dueño legítimo de `Payment` |
| `debt.Service` (`payment_apply.go`, `balance.go`, `writeoff.go`, `settlement.go`, `consolidation.go`) | Validar imputaciones, recalcular saldo/estado de `Document`, exonerar/anular deudas, gestionar pertenencia deuda↔liquidación, reparar datos legado | Mezcla 4 responsabilidades distintas en un mismo paquete (aplicación de pagos, ciclo de vida de deuda, dueño de liquidación, reparación de datos) |
| `TaxSettlementService` | Ciclo de vida de liquidaciones (crear/editar/emitir/cerrar/revertir/borrar) | Correcta como concepto, pero **también dispara** creación/borrado de `Document`s (delegando a `debt.Service`) — el borrado accidental ocurre exactamente en esta frontera |
| `FiscalReceiptService` / `FiscalReceiptIssueService` / `PosSaleService` | Comprobantes fiscales y ventas POS | Correcta, pero sin ninguna referencia a `Document` — nunca "saben" que existen deudas |
| `FinanceService` | Calcula balance por empresa y arma el estado de cuenta | **Duplica** el cálculo que hace el Dashboard y el Reporte financiero, cada uno con su propia query |

**¿Quién debería ser responsable de qué (recomendado)?**
- Crear un pago → `PaymentService` (ya lo es).
- Aplicar un pago → `debt.Service.ApplyPaymentTx` (ya lo es, correcto).
- Modificar una deuda (saldo/estado) → **una única función** (`PersistBalanceAndStatus`) — hoy casi se cumple, salvo 2 excepciones deliberadas (`writeoff.go`, migraciones) y las 2 rutas de borrado con bug.
- Decidir "quién es dueño de una deuda dentro de una liquidación" → **hoy no hay un responsable claro**; es la raíz del bug (ver §14).
- Revertir una operación → hoy solo existe para `Payment` (borrado físico) y para `Document` (exoneración/anulación con motivo) — **no existe** para `TukifacFiscalReceipt` ni para `TaxSettlement` emitida/cerrada de forma auditable con nota de crédito.

---

## 8. Fuente de verdad de cada dato

| Pregunta | Fuente de verdad actual | ¿Única? |
|---|---|---|
| ¿Cuánto se debe? | `Document.total_amount` | Sí |
| ¿Cuánto se pagó de una deuda puntual? | `debt.PaidTotal` (suma `PaymentAllocation` + pagos legacy con `document_id` directo) | Sí, es consistente |
| ¿Cuánto queda pendiente de una deuda puntual? | `Document.balance_amount` (persistido), con fallback a recálculo si diverge >0.02 (`EffectiveBalance`) | Sí |
| ¿Cuánto debe una empresa en total? | **NO hay una única fuente**: 4 implementaciones distintas (Dashboard, CompanyStatement, Reporte financiero, Reporte de deudas) — ver §12 | **No** ⚠️ |
| ¿Cuánto dinero entró (global)? | `SUM(payments.amount)` — pero calculado de forma independiente en Dashboard vs Reporte financiero | Parcialmente |
| ¿Saldo de caja/banco? | No existe el concepto | N/A |
| ¿Estado de una deuda? | `Document.status`, escrito por `PersistBalanceAndStatus` (normal) o directamente por `writeoff.go` (baja manual) o por el bug de limpieza (borrado) | Mayormente sí, con 2 excepciones documentadas |
| ¿Si una operación está anulada? | Documentos: sí (`status=anulado`/`exonerado` + motivo/auditoría). Pagos: **no existe ese concepto**, solo borrado físico sin motivo ni auditoría | Inconsistente entre entidades |
| ¿Movimiento del ledger? | No persiste; se recalcula on-the-fly desde `Document`+`Payment` en cada request del estado de cuenta | Es un espejo, no una fuente independiente (bien, en principio) |

---

## 9. Auditoría del ledger

El "ledger" (`AccountLedger`, `finance_statement_ledger.go`) **no es un libro contable real**:
- No persiste en base de datos — se construye en memoria en cada request del estado de cuenta, a partir de los mismos `Document`s y `Payment`s ya existentes.
- No puede "estar mal" de forma independiente — es un espejo fiel de lo que haya en `documents`/`payments` en ese momento. Pero por esto mismo, **si un `Document` fue borrado por el bug de §14, el ledger tampoco mostrará ningún rastro de esa deuda** — no hay forma de reconstruir el historial roto desde el ledger, porque el ledger nunca guardó nada aparte.
- No genera reversos explícitos: si se borra un pago, el ledger simplemente deja de mostrar esa fila en la próxima consulta (no queda un asiento de reverso, como sí ocurriría en un libro contable de verdad).
- **No puede reconstruir el flujo de dinero histórico** de forma confiable, porque depende 100% de que `documents`/`payments` nunca hayan sido alterados/borrados de forma indebida — que es precisamente lo que encontramos que ocurre.

**Conclusión: no hay ledger real que auditar — solo un reporte derivado, sin poder de detección de anomalías propio.**

---

## 10. Auditoría de caja/bancos

**No aplica — no existen.** Confirmado por búsqueda exhaustiva en todo el backend y frontend: no hay modelos `BankAccount`/`CashRegister`, no hay tablas de movimientos de caja/banco, no hay páginas ni componentes de tesorería. Las únicas menciones de "banco"/"caja" en el sistema son:
- Datos bancarios del estudio para mostrar QR de pago en PDFs (branding, no transaccional).
- Un valor de texto por defecto `"Caja"` como referencia sugerida en pagos en efectivo (cosmético).

---

## 11. Auditoría de pagos

- ✅ Soporta pago sin deuda (`on_account`).
- ✅ Soporta pago aplicado a una deuda (`single`).
- ✅ Soporta pago repartido entre varias deudas (`manual`/`fifo`).
- ✅ Al borrar un pago aplicado, revierte correctamente el saldo/estado de la(s) deuda(s) afectada(s) (Caso 10 ✔).
- ⚠️ **No revierte el vínculo deuda↔liquidación** al borrar el pago que lo había creado — la deuda queda "vinculada" a una liquidación cuyo pago origen ya no existe.
- ⚠️ **No existe "anular pago" como estado auditable** — solo borrado físico (soft-delete), sin motivo ni usuario registrado (a diferencia de `Document`, que sí tiene `writeoff_reason/by/at`).
- 🔴 **Sobrepago con deuda parcial existente puede fallar** (ver §14, hallazgo nuevo) — el "pago a cuenta automático" solo funciona limpiamente cuando la deuda abierta es exactamente $0, no cuando es insuficiente mayor a $0.
- ⚠️ `fiscal_status` de `Payment` se escribe desde 3 lugares distintos del código sin una función centralizada (riesgo menor, no confirmado como bug activo).
- ⚠️ Existen **dos formas distintas** de representar "este pago está aplicado a este documento": la moderna (`PaymentAllocation`) y una legacy (`Payment.DocumentID` directo, aún usada por `PaymentService.Update`) — ambas coexisten y ambas se contemplan en el cálculo de saldo, pero es complejidad innecesaria.

---

## 12. Auditoría de deudas

- ✅ 3 orígenes claros y no contradictorios entre sí (manual, liquidación, suscripción).
- ✅ Ciclo de estados razonable: `pendiente → parcial → pagado`, más 2 estados terminales de baja (`anulado`, `exonerado`).
- ⚠️ `isValidDocumentStatus` en `document_service.go` **no reconoce `"exonerado"`** como válido, aunque es un estado real del dominio — inconsistencia menor (solo afecta si alguna vez se edita una deuda ya exonerada desde ese endpoint, cosa que hoy no ocurre en la práctica).
- 🔴 **Bug crítico confirmado**: una deuda puede ser **eliminada físicamente** por error al editar o borrar una liquidación **que no es la que originalmente la creó**, si esa deuda fue "arrastrada" (vinculada) desde una liquidación cerrada anterior. Ya confirmado en al menos 5 empresas reales en producción, en 3+ meses distintos. Causa raíz documentada en detalle en §14.
- ⚠️ `WriteOffUnlinkedDebt` (exonerar/anular) permite dar de baja una deuda que **ya tiene un pago parcial**, sin revertir ni advertir sobre ese pago — el dinero ya cobrado queda "atrapado" en una deuda con saldo forzado a $0 por baja administrativa, indistinguible de un pago completo sin revisar el motivo de baja.
- ❌ No existe ningún mecanismo de nota de crédito o reverso auditable para una deuda ya emitida — la única corrección posible es mutar el propio registro o, en el peor caso, borrarlo (sin dejar rastro en `document_consolidation_logs`, que ninguna de las dos funciones de limpieza usa).

---

## 13. Matriz de casos de negocio — qué está soportado hoy

| Caso | ¿Soportado? | Detalle |
|---|---|---|
| 1. Venta a crédito (deuda sin pago) | ✅ Sí | |
| 2. Pago total de una deuda | ✅ Sí | |
| 3. Pago parcial de una deuda | ✅ Sí | Status pasa a `parcial` |
| 4. Pago recibido sin saber qué deuda (a cuenta) | ✅ Sí | `type=on_account`, `document_id=NULL` |
| 5. Ese pago a cuenta se aplica luego a deudas | ⚠️ **Parcial** | Solo a **una** deuda (vía `Update` + `DocumentID` legacy, sin crear `PaymentAllocation`). **No es posible dividirlo entre varias deudas** después de creado — para eso hay que borrarlo y recrearlo. |
| 6. Se paga más de lo que se debe | 🔴 **Roto en el caso intermedio** | Si la deuda abierta es **$0** → sí cae correctamente a "pago a cuenta" por el total. Si la deuda abierta es **mayor a $0 pero menor al pago** → el sistema **rechaza la operación completa** con error ("la suma de imputaciones debe igualar el monto del pago"), en vez de aplicar lo que corresponde y dejar el resto a cuenta. Confirmado leyendo `buildFIFOAllocations` + `ValidatePaymentAmountsAndAllocations` línea por línea — no es una suposición. |
| 7. Pago sin deuda (registro coherente) | ✅ Sí, a nivel de modelo | Pero el flujo POS **no lo usa** — emite el comprobante sin nunca crear el `Payment`, aunque el dinero sí se cobró. |
| 8. Deuda sin pago | ✅ Sí (trivial) | |
| 9. Pago anulado/revertido | ⚠️ Solo como borrado físico | Sin estado "anulado" auditable, sin motivo, sin usuario — inconsistente con cómo sí se maneja la baja de una deuda |
| 10. Pago aplicado y luego anulado → ¿la deuda vuelve a su estado anterior? | ✅ Sí | `DeletePaymentTx` recalcula correctamente saldo/estado. Pero no revierte el vínculo deuda↔liquidación (ver §11) |
| 11. Nota de crédito / anulación de comprobante ya emitido | ❌ No existe | Ni para `Document` ni para `TukifacFiscalReceipt` |

---

## 14. Inconsistencias encontradas — el bug de borrado de deudas, explicado a fondo

**Causa raíz**: la función `IsSettlementOwnedDebt` (usada tanto en `CleanupSettlementDebtsNotInLines` como en `PurgeSettlementDocumentsOnDelete`) decide si una deuda "pertenece" a una liquidación mirando el campo **mutable** `Document.TaxSettlementID` (más `Source`/`Type` genéricos) — no un campo inmutable que registre quién la creó originalmente.

```go
func IsSettlementOwnedDebt(d *models.Document, settlementID uint) bool {
	if d.TaxSettlementID != nil && *d.TaxSettlementID == settlementID {
		return d.Source == "liquidacion" || d.Type == "LI" || IsLegacySettlementClone(d)
	}
	...
}
```

El problema: `TaxSettlementID` se **sobrescribe sin dejar rastro** cada vez que una deuda se "arrastra" de una liquidación cerrada a una nueva — que es un flujo de negocio **explícitamente soportado** (`PendingDebtsFromClosedSettlements`, "deudas abiertas liberadas de liquidaciones cerradas"). Secuencia real:

1. Deuda `D` nace bajo la liquidación `A` (`Source=liquidacion`).
2. `A` se cierra con `D` todavía impaga → el sistema libera `D` (`tax_settlement_id=NULL`) para que se pueda re-liquidar después. Esto es correcto y deseado.
3. Un asistente arrastra `D` a la liquidación `B` (mes actual) — `D.TaxSettlementID = B.ID`. `D.Source`/`Type` no cambian.
4. Antes de emitir `B`, el asistente quita esa línea del borrador (la reemplaza, la corrige, etc.) y guarda.
5. `CleanupSettlementDebtsNotInLines(B, ...)` encuentra `D` (porque `tax_settlement_id=B.ID`), evalúa `IsSettlementOwnedDebt(D, B.ID)` → **true** (aunque `D` nunca fue creada por `B`), verifica que no tiene pagos (cierto, es deuda vieja impaga) → **la borra físicamente**.

Confirmado en producción en **5 empresas** (175, 88, 74, 189, 239) entre junio y septiembre 2026, sin ningún registro en `document_consolidation_logs` (ninguna de las dos funciones de limpieza escribe ahí) — es decir, **sin rastro forense**, solo detectable comparando `deleted_at` vs `updated_at` manualmente.

`PurgeSettlementDocumentsOnDelete` (al borrar una liquidación completa) tiene el mismo riesgo, agravado: ahí ni siquiera se exige que el `settlementID` codificado en el número legado `DEU-LIQ-{id}-*` coincida con la liquidación que se está borrando.

---

## 15. Errores críticos (🔴)

1. **Borrado silencioso de deudas** al editar/borrar liquidaciones que "heredaron" deudas de periodos cerrados (§14). Ya causó pérdida de S/900+ en un caso real, con al menos 4 empresas más afectadas detectadas por muestreo (probablemente más, no se hizo auditoría completa de todo el histórico).
2. **Rechazo de sobrepagos con deuda parcial** (Caso 6) — un pago legítimo puede fallar por completo en vez de aplicarse parcialmente, obligando a soluciones manuales fuera del flujo normal.
3. **Múltiples fuentes de "cuánto debe una empresa"** que pueden divergir por los pagos a cuenta (Dashboard/Estado de cuenta/Reporte financiero restan TODOS los pagos del total de deuda, incluyendo los "a cuenta" no aplicados a ningún documento; el Reporte de deudas —el único que usa `balance_amount` por documento— NO los resta). Esto significa que el mismo negocio puede ver dos cifras de "deuda pendiente" distintas para la misma empresa según qué pantalla mire.

## 16. Riesgos importantes (🟠)

4. Anulación de pago sin auditoría (sin motivo, sin usuario, solo borrado físico) — contraste con el manejo cuidadoso que sí tiene la baja de deudas.
5. Al borrar un pago que había vinculado una deuda a una liquidación, esa deuda queda "vinculada" a una liquidación sin ningún pago real detrás.
6. `WriteOffUnlinkedDebt` permite dar de baja deudas con pago parcial ya aplicado, sin advertir ni reconciliar ese dinero.
7. Ausencia total de notas de crédito / anulación auditable de comprobantes ya emitidos.
8. Comprobante fiscal sin relación directa a la deuda que origina — permite comprobantes "huérfanos" indefinidamente (el caso POS, con 20+ comprobantes acumulados sin conciliar en producción al momento de esta auditoría).
9. `fiscal_status` de `Payment` escrito desde 3 puntos no centralizados.
10. Duplicidad de datos de método/referencia de pago entre `TukifacFiscalReceipt.PaymentMethod/Reference` y la tabla `fiscal_receipt_payments` — mitigado en lectura, no garantizado en escritura.

## 17. Mejoras (🟡)

11. Dos formas de representar "pago aplicado a documento" (legacy `Payment.DocumentID` vs. moderno `PaymentAllocation`) — conviene deprecar la primera.
12. `isValidDocumentStatus` no reconoce `"exonerado"` como estado válido pese a que existe en producción.
13. El dashboard duplica manualmente toda su lógica en una segunda función (`getDashboardDataForCompanyIDs`) en vez de parametrizar una sola.

---

## 18. Modelo de negocio recomendado

```
Comprobante (venta/servicio)
      │  (idealmente) debería poder generar o referenciar
      ▼
Deuda / Cuenta por cobrar  ──nunca se modifica directo, solo vía──►  función única de saldo
      │
      ▼
Pago (siempre existe si hubo dinero real, con o sin deuda)
      │
      ▼
Aplicación de pago (0, 1 o N deudas) ── remanente no aplicado permanece explícito, nunca se rechaza
      │
      ▼
(Movimiento de caja/banco — hoy fusionado con Pago; separarlo es opcional, no urgente)
```

**Reglas clave que deberían regir:**
- **El comprobante fiscal SIEMPRE debería poder apuntar (aunque sea opcionalmente) a la deuda que factura**, no solo indirectamente vía un pago que quizás nunca llegue a existir.
- **Un `Document` nunca debería borrarse si alguna vez existió una liquidación que lo registró** — como máximo, desvincularse. El borrado físico debería reservarse para errores de captura sin ningún historial (recién creado, mismo request).
- **Un pago que excede la deuda disponible siempre debe aplicarse hasta donde alcance y dejar el resto explícito como "a cuenta"** — nunca debe poder rechazar la operación completa.
- **Anular un pago debería ser un estado auditable** (motivo, usuario, fecha), igual que ya existe para las deudas — no un borrado físico silencioso.
- **Vincular una deuda a una liquidación no debería sobrescribir su identidad de origen** — se necesita un campo inmutable (`origin_settlement_id` o similar) separado de `tax_settlement_id` (que sí puede cambiar libremente).

---

## 19. Qué partes actuales deben mantenerse

- La separación `Document` / `Payment` / `PaymentAllocation` — el modelo de datos de fondo es correcto y no necesita rediseño.
- El soporte de pagos `on_account` sin deuda — ya funciona bien y es la base correcta para lo que sospechabas.
- `debt.PersistBalanceAndStatus` como función centralizada de saldo — mantenerla como única fuente, no crear una nueva.
- La vista `/payments` — ya muestra correctamente el historial global, con o sin deuda aplicada. **No requiere cambios de fondo**, solo quizás mejoras de UX (que ya hicimos: etiquetas, autocompletado).

## 20. Qué partes deben corregirse (por prioridad)

1. **Urgente**: la lógica de "pertenencia" de una deuda a una liquidación (`IsSettlementOwnedDebt`) — cambiar a un campo inmutable de origen, y nunca borrar físicamente una deuda con historial de liquidación (solo desvincular).
2. **Urgente**: el caso de sobrepago con deuda parcial insuficiente — debe aplicar lo posible y dejar el resto a cuenta, no rechazar.
3. **Importante**: unificar el cálculo de "deuda pendiente por empresa" en una sola función reutilizada por Dashboard, Estado de cuenta y Reportes.
4. **Importante**: agregar estado auditable de anulación a `Payment` (motivo, usuario, fecha) en vez de borrado físico.
5. **Media**: decidir si conviene una relación directa `TukifacFiscalReceipt → Document`, o al menos una alerta/bandeja proactiva de comprobantes sin conciliar (ya lo discutimos aparte).
6. **Media**: revisar `WriteOffUnlinkedDebt` para bloquear o advertir explícitamente si existe un pago parcial antes de dar de baja.

## 21. Plan de implementación por fases (propuesta, sin ejecutar aún)

- **Fase A** (aislada, bajo riesgo): agregar campo inmutable de "liquidación de origen" a `Document`, migrar datos existentes por inferencia (número `DEU-LIQ-*` o `tax_settlement_id` actual si nunca fue re-vinculado), y corregir `IsSettlementOwnedDebt` para usar ese campo. Corregir en el mismo cambio `CleanupSettlementDebtsNotInLines`/`PurgeSettlementDocumentsOnDelete` para **desvincular siempre**, nunca borrar, salvo un caso explícito y auditado (recién creada, sin historial, mismo request).
- **Fase B** (aislada): corregir `buildFIFOAllocations`/`ValidatePaymentAmountsAndAllocations` para permitir remanente parcial no aplicado dentro del mismo pago.
- **Fase C** (refactor de reportes, sin tocar datos): unificar el cálculo de deuda por empresa en una sola función, reutilizada por Dashboard/Estado de cuenta/Reportes.
- **Fase D** (nueva funcionalidad): estado auditable de anulación de pagos.
- **Fase E** (producto, requiere decisión de negocio): relación comprobante↔deuda y/o alerta de comprobantes sin conciliar.

Cada fase es independiente y se puede aprobar/priorizar por separado.

---

## Conclusión final

**¿El sistema tiene una lógica financiera coherente?**

### PARCIALMENTE

El modelo conceptual de fondo (deuda / pago / aplicación, separados) es correcto y coherente. Lo que rompe la coherencia no es el diseño de datos sino: (a) una regla de "pertenencia" mal definida que causa pérdida real de datos, (b) una validación de pagos que rechaza en vez de degradar con gracia en un caso de negocio válido, y (c) la falta de una única fuente de verdad para "cuánto debe una empresa" — 4 cálculos independientes que pueden divergir.

**¿La vista de Pagos debería mostrar globalmente todos los pagos, estén o no vinculados a una deuda?**

**Sí — y ya lo hace correctamente.** Verificado en `payment_controller.go`/`payment_service.go`/`Payments.tsx`: no hay ningún filtro que excluya pagos sin `document_id`, el filtro de empresa es opcional ("Todas"), y los pagos sin deuda se etiquetan explícitamente "a cuenta". Tu sospecha era correcta como principio de diseño, y el sistema ya lo cumple en este punto específico. El problema real que viste (el pago de S/900 que no aparecía) no era un defecto de la vista de Pagos — era que **el pago todavía no existía** (el comprobante POS nunca lo generó), que es exactamente el hallazgo (h) de este informe.
