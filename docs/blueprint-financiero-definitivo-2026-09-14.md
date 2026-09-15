# BLUEPRINT DEFINITIVO DE EVOLUCIÓN FINANCIERA

**Consolida**: [Fase 1 — Auditoría técnica](auditoria-logica-financiera-2026-09-14.md), [Fase 2 — Modelo definitivo](modelo-negocio-financiero-fase2-2026-09-14.md), [Fase 3 — Contexto de negocio](modelo-negocio-financiero-fase3-2026-09-14.md).
**Estado**: contrato funcional y técnico propuesto para implementación. **Ningún código ha sido modificado.**
**Alcance**: solo Cuentas por Cobrar del estudio (Deudas + Payments + Allocations + Comprobantes + Liquidaciones). Sin proveedores/compras/caja/bancos/contabilidad general.

---

## ⚠️ Contradicción encontrada entre fases (declarada explícitamente, como se pidió)

**Fase 3 §13** propuso clasificar "pago independiente" vs. "pago a cuenta" **sin campo nuevo**, usando una regla de presentación: *"si tiene comprobante vinculado → independiente; si no → a cuenta."*

**Esta instrucción (§11)** rechaza explícitamente esa regla por ambigua ("NO uses únicamente 'tiene comprobante' como única regla de clasificación").

**Por qué existía la contradicción**: en Fase 3 prioricé no agregar campos nuevos ("no sobrediseñar"), asumiendo que la presencia de un comprobante bastaba como señal. Al recibir el contexto de negocio más preciso de este mensaje, esa señal es frágil: nada impide que en el futuro se emita un comprobante también para un pago que SÍ está aplicado a una deuda (por ejemplo, si el cliente pide boleta de un pago de liquidación) — en ese momento la regla "tiene comprobante → independiente" clasificaría mal un pago que en realidad es de deuda.

**Resolución adoptada en este Blueprint**: agregar un campo explícito y pequeño, **no inferido**, `Payment.Purpose` (ver §III y §IX). Es la solución "tipo/origen" que esta instrucción invita a diseñar. Impacto: 1 columna nueva (string corto, 2-3 valores), sin nuevas tablas, sin tocar `Type` (que sigue siendo la mecánica de aplicación: applied/on_account). No se encontraron otras contradicciones sustantivas entre las tres fases — el resto es consistente y se consolida sin cambios de fondo.

---

## 1. Resumen ejecutivo

El modelo de datos actual (`Document`, `Payment`, `PaymentAllocation`, `TukifacFiscalReceipt`, `TaxSettlement`) es **conceptualmente correcto y suficiente** para el negocio de cuentas por cobrar del estudio — no requiere nuevas entidades. Los problemas están en **reglas de validación y decisiones de ownership mal definidas**, no en la arquitectura de datos. Este Blueprint cierra el modelo agregando **un campo inmutable** (`origin_settlement_id`), **un campo de clasificación** (`Payment.Purpose`), **un mecanismo de anulación auditable** para pagos, y **una función única de cálculo de deuda**, y define con precisión cómo debe comportarse POS para dejar de generar dinero invisible.

---

## 2. Modelo de negocio definitivo

```
Company (empresa cliente)
   │
   ├── Document (deuda / cuenta por cobrar) ─── vive independiente de cualquier liquidación
   │      origin_settlement_id (inmutable, dónde nació)
   │      tax_settlement_id     (mutable, dónde está comunicada hoy)
   │
   ├── TaxSettlement (liquidación) ─── agrupa y COMUNICA deudas de un periodo; no es la deuda
   │
   ├── Payment (dinero real recibido) ─── existe con o sin deuda, con o sin comprobante
   │      type: applied | on_account          (mecánico, derivado de allocations)
   │      purpose: deuda | servicio           (de negocio, explícito — NUEVO)
   │
   ├── PaymentAllocation (Payment → Document, 0..N) ─── única operación que reduce saldo
   │
   └── TukifacFiscalReceipt (nota de venta / boleta / factura) ─── evidencia de la operación comercial
          origin: pos_sale | issued_local
          linked_payment_id (opcional)
```

---

## 3. Definición oficial de cada entidad

| Entidad | Definición oficial |
|---|---|
| **`Company`** | Cliente/empresa con relación comercial con el estudio. |
| **`TaxSettlement`** | Liquidación periódica que **agrupa y comunica** las obligaciones de un periodo a la empresa. **No es la deuda ni la fuente de verdad de ningún saldo.** |
| **`Document`** | La deuda/cuenta por cobrar individual. Vive independiente de en qué liquidación se comunique hoy; puede sobrevivir al cierre de varias liquidaciones sucesivas sin perder su identidad (mismo `id`). |
| **`Payment`** | Dinero **efectivamente recibido** por el estudio. `Payment.amount` es la fuente de verdad del ingreso monetario — exista o no una deuda, exista o no un comprobante. |
| **`PaymentAllocation`** | La decisión, explícita y posterior a la recepción del dinero si hace falta, de cuánto de un `Payment` se destina a un `Document` específico. Es la **única** operación que reduce el saldo de una deuda. |
| **Comprobante (`TukifacFiscalReceipt`)** | Documento que **evidencia la operación comercial o servicio realizado** (nota de venta, boleta o factura). Puede asociarse al ingreso correspondiente vía `Payment`, pero **nunca sustituye** el registro financiero — el dinero siempre se cuenta desde `Payment`, nunca desde el comprobante. |

---

## 4. Relación comprobante ↔ Payment ↔ PaymentAllocation

```
OPERACIÓN COMERCIAL (venta, servicio, cobranza)
        │
        ▼
   COMPROBANTE (nota de venta / boleta / factura)  ── documenta QUÉ se hizo
        │  (opcional, puede o no existir; puede o no preceder al Payment)
        ▼
     PAYMENT  ── documenta CUÁNTO dinero entró de verdad
        │  (opcional, puede tener 0 allocations)
        ▼
  PAYMENT ALLOCATION  ── documenta A QUÉ deuda(s) se destinó
        │
        ▼
      DOCUMENT (deuda)  ── ve reducido su saldo
```

**Ningún eslabón es obligatorio salvo `Payment` cuando hubo dinero real** — esa es la regla no negociable de todo este Blueprint. La nota de venta **sí importa** y **sí se relaciona con el ingreso** (no es un documento aislado): cuando existe, debe estar `linked_payment_id` hacia el `Payment` correspondiente, exactamente como ya funciona hoy para el origen `issued_local` (Fase 3, hallazgo central).

---

## 5. Flujo de dinero (definitivo)

```
Dinero entra al estudio
        │
        ▼
   Payment { amount, method, date, purpose }
        │
        ├── purpose=servicio, 0 allocations ──────────► Ingreso independiente (nunca reduce deuda)
        │
        └── purpose=deuda
                ├── 0 allocations aún ─────────────────► "a cuenta", pendiente de asignar
                └── N allocations (≤ amount) ──────────► reduce balance_amount de cada Document
                                                            (vía debt.PersistBalanceAndStatus, ÚNICA función)
```

---

## 6. Flujo de deuda

```
Document nace (manual / liquidación / suscripción)
        │  origin_settlement_id fijado aquí si aplica (INMUTABLE)
        ▼
   status = pendiente, balance_amount = total_amount
        │
        ├── recibe Allocation(s) parciales ──► status = parcial
        ├── recibe Allocation(s) totales   ──► status = pagado
        ├── se exonera/anula (write-off)   ──► status = exonerado/anulado, balance = 0 (con motivo+auditoría)
        └── se comunica en 1 o más liquidaciones sucesivas, cambiando tax_settlement_id,
            SIN que origin_settlement_id cambie jamás
```

---

## 7. Flujo de liquidaciones

`TaxSettlement`: `borrador → emitida → cerrada` (o `revertida a borrador`, o `eliminada` si nunca se cerró). Al **crear/editar/emitir** (`EnsureSettlementLineDebts`), genera `Document`s nuevos (fijando `origin_settlement_id`) o vincula existentes (`tax_settlement_id`, sin tocar el origen). Al **cerrar**, congela un snapshot histórico por línea y **libera** (desvincula) las deudas que sigan impagas — comportamiento ya correcto, se mantiene igual.

---

## 8. Deudas arrastradas

Ya confirmado en las 3 fases sin contradicción: una deuda impaga de un periodo cerrado puede "arrastrarse" (vincularse) a la liquidación del periodo siguiente, cuantas veces sea necesario, **sin crear un nuevo `Document`** — sigue siendo el mismo registro. Esto es un flujo de negocio deliberado y correcto; lo único que debía corregirse es cómo el sistema rastrea "quién la creó realmente" (§9).

---

## 9. `OriginSettlementID` — solución definitiva al bug crítico

```go
// Nuevo campo en Document, nullable, INMUTABLE tras la creación:
OriginSettlementID *uint `gorm:"index"`
```

- Se asigna **una sola vez**, en `createSettlementDebtDocument`, en el momento en que una liquidación genera el `Document` por primera vez.
- **Nunca se modifica** después, sin importar cuántas veces la deuda se arrastre a otras liquidaciones.
- `Document.TaxSettlementID` sigue siendo el campo mutable ("dónde se comunica hoy").
- `IsSettlementOwnedDebt(d, settlementID)` deja de comparar `TaxSettlementID`+`Source`/`Type` (mutables/genéricos) y pasa a comparar **exclusivamente** `d.OriginSettlementID == settlementID`.

Con este único cambio, el bug queda cerrado de raíz: una deuda arrastrada desde otra liquidación **nunca** volverá a evaluarse como "propiedad" de la liquidación que solo la tomó prestada.

---

## 10. Eliminación segura — regla formal definitiva

```
ELIMINAR FÍSICAMENTE un Document es válido SOLO SI, simultáneamente:
  1. d.OriginSettlementID == settlementID (la liquidación que edita es quien lo creó)
  2. la liquidación sigue en estado 'borrador' (nunca fue emitida/cerrada)
  3. cero PaymentAllocation asociadas
  4. cero Payment.DocumentID legacy apuntando a él
  5. cero referencias desde tax_settlement_lines de OTRA liquidación

EN CUALQUIER OTRO CASO → solo DESVINCULAR (tax_settlement_id = NULL).
El Document nunca desaparece si tiene historial fuera de su propia vida en el borrador actual.
```

Aplica idéntico a `CleanupSettlementDebtsNotInLines` y `PurgeSettlementDocumentsOnDelete`.

---

## 11. Pagos parciales

Ya funciona correctamente y se mantiene sin cambios: `Payment` con 1 `PaymentAllocation` menor al saldo → `Document.status=parcial`, saldo permanece en el **mismo** `Document` (nunca se crea uno nuevo por el remanente).

---

## 12. Sobrepagos — fórmula oficial

```
Payment.amount = SUM(PaymentAllocation.amount asociadas) + saldo_no_aplicado
```

`saldo_no_aplicado` **no es una columna** — se calcula siempre como `Payment.amount − SUM(allocations)`. Cambio de validación necesario en `ValidatePaymentAmountsAndAllocations`: reemplazar la exigencia de igualdad exacta (`sum == amount`) por `sum ≤ amount` (sin descuento), validando además que cada allocation individual no exceda el saldo de su documento (regla que ya existe, se conserva). **Un único `Payment`, nunca se parte en dos, nunca se rechaza la operación completa, nunca se pierde el excedente.**

---

## 13. Pagos a cuenta / sin allocation

`Payment` con `purpose=deuda` y 0 allocations = dinero recibido, destinado eventualmente a una deuda, aún sin decidir cuál. No reduce ningún saldo mientras no tenga `PaymentAllocation`. Debe poder aplicarse después a una, varias, o parcialmente (§14) sin perder identidad.

---

## 14. Aplicación posterior — funcionalidad nueva a construir

Hoy `PaymentService.Update` **no lo permite** (confirmado línea por línea: solo fija un `DocumentID` legacy único, rechaza editar pagos con allocations). Se necesita una función nueva y explícita, ej. `PaymentService.AllocateExisting(paymentID, lines)`:

- No modifica `amount`/`date`/`method`/`reference` del pago original (conserva identidad y fecha real de recepción).
- Verifica que las nuevas allocations no excedan el disponible actual (`amount − SUM(allocations existentes)`).
- Crea las `PaymentAllocation`s nuevas y llama `debt.PersistBalanceAndStatus` por cada `Document` afectado — todo en una transacción.
- Puede llamarse varias veces mientras quede saldo disponible (aplicar hoy 600, mañana 400, del mismo pago de 1000).
- El campo legacy `Payment.DocumentID` **deja de usarse para escrituras nuevas** desde este punto (queda solo por compatibilidad de lectura con datos históricos).

---

## 15. Pagos independientes de servicios — solución con `Payment.Purpose`

Resolviendo la contradicción del inicio: se agrega

```go
// Nuevo campo en Payment:
Purpose string `gorm:"size:20;not null;default:'deuda'"`  // 'deuda' | 'servicio'
```

- **`deuda`** (default): el pago corresponde (o eventualmente corresponderá) a una obligación de liquidación — puede tener 0 o N allocations en cualquier momento de su vida.
- **`servicio`**: el pago corresponde a una operación comercial independiente (servicio adicional cobrado al instante) — **nunca** se espera que reciba `PaymentAllocation` contra un `Document` de liquidación; es ingreso ya "cerrado" conceptualmente en el momento en que se recibe.
- Se fija **explícitamente al crear el pago** (por quien lo registra: Finanzas o POS), no se infiere de si tiene o no comprobante — resolviendo la ambigüedad que esta instrucción señaló.
- Un pago `purpose=servicio` normalmente lleva comprobante asociado (nota de venta), pero **eso no es lo que lo clasifica** — es la elección explícita del usuario al momento de registrarlo.

---

## 16. Nota de venta / boleta / factura

Los 3 son `TukifacFiscalReceipt` con distinto `DocumentTypeID` (`NV`, `03`, `01`). La **nota de venta no se declara a SUNAT** (ya reflejado en el código: usa su propia serie `NV0x`, sin `sunat_code` fiscal real) pero **sí documenta la operación comercial y sí debe estar enlazada al `Payment`** cuando corresponde a un cobro — exactamente como ya sucede en el flujo `issued_local` (Fase 3, confirmado sin duplicar dinero en ningún reporte). Si el cliente después pide boleta/factura por la misma operación, es una re-emisión del comprobante (documento distinto, mismo `Payment` de respaldo) — no genera un segundo ingreso.

---

## 17. Flujo POS — definido y resuelto

**Flujo correcto (recomendado, resuelve la decisión pendiente de Fase 2/3 con el criterio dado en esta instrucción):**

```
Venta POS
   │
   ▼
Dentro de LA MISMA TRANSACCIÓN:
   TukifacFiscalReceipt (origin=pos_sale)
   +
   Payment (purpose=servicio por default; method/reference tomados
            de los mismos datos que hoy ya captura normalizePosPayments)
   +
   LinkedPaymentID del receipt ← el Payment recién creado (nace 'vinculado', no 'pendiente_vincular')
```

- **No se crea ningún `Document` artificial** — una venta POS pagada al instante no es una deuda, tal como pide explícitamente esta instrucción.
- Si el cajero, durante la venta, indica que corresponde a una deuda existente de la empresa (caso menos común pero posible), se marca `purpose=deuda` y se crea la `PaymentAllocation` correspondiente en la misma transacción, reutilizando el mismo motor (`ApplyPaymentTx`) que ya usa Finanzas — **no se duplica lógica**.
- Con esto, POS y Finanzas **comparten exactamente el mismo modelo financiero**, cumpliendo el objetivo explícito de esta instrucción.

---

## 18. Métodos de pago

**Fuente de verdad: `Payment.Method`/`Payment.Reference`.** No se requiere refactor de esquema (instrucción explícita de no refactorizar si no es imprescindible). Se mantiene:
- `fiscal_receipt_payments` (detalle por línea, soporta pagos divididos multi-método en POS) como el desglose operativo del comprobante.
- `TukifacFiscalReceipt.PaymentMethod/Reference` (cabecera) como resumen legible.
- **Única corrección de proceso** (no de esquema): cuando el `Payment` se crea en la misma transacción que el comprobante (§17), su `Method`/`Reference` deben poblarse desde el mismo cálculo que ya arma el header (`normalizePosPayments`), garantizando una sola fuente de escritura — hoy son dos escrituras independientes sin relación garantizada; con el flujo unificado pasan a ser una sola operación que llena ambos lados de forma consistente por construcción.

---

## 19. Cancelación auditable de Payments

```go
// Nuevos campos en Payment:
VoidedAt     *time.Time
VoidedBy     *uint
VoidReason   string
```

Al anular (ya no `DELETE` físico):
1. Marcar `voided_at/by/reason` (el registro permanece, nunca se destruye).
2. Revertir sus `PaymentAllocation`s (igual que hoy hace `DeletePaymentTx`, se conserva esa lógica).
3. Recalcular saldo/estado de cada `Document` afectado vía `PersistBalanceAndStatus` (igual que hoy).
4. Desvincular el `TukifacFiscalReceipt` si estaba enlazado, volviendo a `pendiente_vincular` (igual que hoy).
5. **Corrección adicional** (gap detectado en Fase 1): revertir también el vínculo deuda↔liquidación si ese pago la había establecido.
6. Un pago anulado **deja de contar** en `SUM(Payment.amount)` de todos los cálculos oficiales (§21) — filtrar siempre `voided_at IS NULL`.

---

## 20. Write-off / condonación — regla de bloqueo

`WriteOffUnlinkedDebt` debe **bloquear** (no solo advertir) cuando:
```
EXISTS PaymentAllocation con amount > 0 asociada al Document
  AND balance_amount > 0 (aún queda algo pendiente)
```
En ese caso, el mensaje debe indicar explícitamente el monto ya cobrado y exigir que primero se reasigne o gestione ese dinero (vía §14, aplicarlo a otra deuda, o dejarlo a cuenta) antes de permitir exonerar/anular el resto. Se elige **bloquear por defecto** (no solo advertir) porque es la opción segura por defecto para dinero ya recibido — decisión tomada en este Blueprint, ya no queda abierta.

---

## 21. Fuentes de verdad — tabla oficial

| Concepto | Fuente de verdad |
|---|---|
| Deuda (monto) | `Document.total_amount` |
| Saldo de deuda | `Document.balance_amount`, escrito **solo** por `debt.PersistBalanceAndStatus` |
| Dinero recibido | `Payment.amount`, considerando solo `voided_at IS NULL` |
| Aplicación del dinero | `PaymentAllocation.amount` |
| Operación comercial | `TukifacFiscalReceipt` |
| Liquidación mensual (comunicación) | `TaxSettlement` |
| Liquidación de origen de una deuda | `Document.origin_settlement_id` (nuevo, inmutable) |
| Liquidación actual de una deuda | `Document.tax_settlement_id` (mutable) |
| Método de pago | `Payment.Method`/`Reference` |
| Propósito del pago | `Payment.Purpose` (nuevo) |
| Estado del pago | `Payment.Type` (mecánico) + `voided_at` (nuevo, anulación) |
| Estado de la deuda | `Document.status` |
| Deuda total de una empresa | Función única `SaldoDocumentado` (§22) — reemplaza las 4 implementaciones actuales |

**El comprobante documenta la operación; el dinero siempre se cuenta desde `Payment`. `Payment` no reduce una deuda por el solo hecho de existir — solo `PaymentAllocation` reduce saldo.** (Ambas frases, pedidas explícitamente, quedan aquí como regla oficial.)

---

## 22. Fórmulas oficiales

```
SaldoDocumentado(empresa) =
    SUM(Document.balance_amount)
    WHERE company_id = X AND status IN ('pendiente', 'parcial')

DineroNoAplicado(empresa) =
    SUM(Payment.amount − SUM(sus PaymentAllocation.amount))
    WHERE company_id = X AND voided_at IS NULL

DineroTotalRecibido(empresa) =
    SUM(Payment.amount) WHERE company_id = X AND voided_at IS NULL

DineroAplicadoADeudas(empresa) =
    SUM(PaymentAllocation.amount)
    WHERE allocation.payment.voided_at IS NULL
```

**Prohibido explícitamente**: `totalDocuments − totalPayments` como fórmula de deuda, en cualquier pantalla — mezcla dinero independiente, a cuenta y ya aplicado, y produce saldos negativos falsos (demostrado con el ejemplo de negocio real en Fase 3 §21: 1000 de deuda + 300 independiente + 1000 de pago de deuda → esta fórmula da −300, cuando el resultado correcto es deuda=0, independiente=300, todo consistente).

**Todas las pantallas** (Dashboard, Estado de cuenta, Reporte financiero, Reporte de deudas) deben consumir exclusivamente estas 4 funciones — cero `SUM` ad-hoc propios.

---

## 23. Estado de cuenta — diseño conceptual

| Bloque | Columnas |
|---|---|
| **Deudas** | fecha, concepto, monto original, pagado, saldo, `origin_settlement_id` (liquidación de origen), liquidaciones donde fue comunicada (histórico vía `tax_settlement_lines`) |
| **Pagos** | fecha, monto, método, comprobante relacionado, `purpose`, aplicado, no aplicado, estado (activo/anulado) |
| **Aplicaciones** | qué `Payment` pagó qué `Document`, monto, fecha |
| **Servicios independientes** | pagos `purpose=servicio`, con su comprobante — explícitamente fuera del cálculo de `SaldoDocumentado` |

Preguntas que debe poder responder sin contradicción: cuánto me deben (`SaldoDocumentado`), cuánto recibí (`DineroTotalRecibido`), cuánto de eso pagó deudas (`DineroAplicadoADeudas`), cuánto es de servicios independientes (filtrar `purpose=servicio`), cuánto está sin aplicar (`DineroNoAplicado`).

---

## 24. Invariantes del sistema (consolidadas y ampliadas)

Las 25 propuestas en esta instrucción son **todas correctas y se adoptan tal cual**, más 3 adicionales que las fases anteriores evidenciaron:

26. `Document.origin_settlement_id` nunca cambia después de creado; `Document.tax_settlement_id` sí puede cambiar o quedar NULL.
27. `Payment.Purpose` se fija explícitamente al crear el pago y no se infiere de la presencia de un comprobante.
28. Un `Document` con pago parcial aplicado no puede exonerarse/anularse sin antes resolver ese pago (§20).

---

## 25. Matriz de escenarios (completa)

| Escenario | Comprobante | Payment | Purpose | Allocation | Document | Resultado |
|---|---|---|---|---|---|---|
| Deuda mensual sin pagar | No | No | — | 0 | Sí | Pendiente |
| Servicio independiente pagado | Sí | Sí | servicio | 0 | No | Ingreso independiente |
| Deuda pagada completa | opcional | Sí | deuda | 1+ | Sí | Saldada |
| Deuda parcialmente pagada | opcional | Sí | deuda | 1+ (parcial) | Sí | Saldo pendiente |
| Pago a cuenta | opcional | Sí | deuda | 0 | No aún | Dinero no aplicado |
| Pago a cuenta aplicado después | opcional | Sí (mismo id) | deuda | agregadas después | Sí | Reduce deuda |
| Sobrepago | opcional | Sí | deuda | parcial | Sí | Excedente no aplicado, mismo Payment |
| Un Payment para varias deudas | opcional | Sí | deuda | N | N | Aplicación distribuida |
| Comprobante sin Payment | Sí | No | — | 0 | según caso | 🔴 Estado inválido — solo transitorio, nunca permanente (§17 lo elimina para POS) |
| Payment sin comprobante | No | Sí | deuda/servicio | sí/no | según caso | Válido — la mayoría de cobranza de liquidación |
| Payment anulado | opcional | Sí (voided) | — | anuladas | recalculado | Histórico preservado, no cuenta como dinero |
| Independiente + deuda simultáneos (Fase 3 §21) | Sí (independiente) | 2 Payments distintos | servicio + deuda | 0 y N respectivamente | Sí | Ambos correctos, sin interferencia |

---

## 26-29. Bugs, funcionalidades faltantes, refactors y decisiones

### 🔴 BUGS (corregir primero — causan pérdida/corrupción de datos hoy)
- Eliminación física de deudas arrastradas (`CleanupSettlementDebtsNotInLines`, `PurgeSettlementDocumentsOnDelete`) — §9-10.
- Rechazo de sobrepagos con deuda parcial insuficiente (`ValidatePaymentAmountsAndAllocations`) — §12.
- Dashboard/Estado de cuenta/Reporte financiero calculando deuda con `totalDocuments − totalPayments` — §22.
- POS genera comprobante sin `Payment` — §17.

### 🟠 FUNCIONALIDADES FALTANTES
- Aplicación posterior de un pago a cuenta a una o varias deudas (`AllocateExisting`) — §14.
- Cancelación auditable de pagos (`voided_at/by/reason`) — §19.
- Bloqueo de write-off con pago parcial existente — §20.
- Clasificación explícita `Payment.Purpose` — §15.

### 🟡 REFACTORS (sin cambiar comportamiento, solo consolidar)
- Unificar las 4 implementaciones de deuda-por-empresa en `SaldoDocumentado`/`DineroNoAplicado` — §22.
- Centralizar la escritura de `Payment.fiscal_status` (hoy en 3 lugares).
- Alinear la escritura de método/referencia entre `Payment` y `fiscal_receipt_payments` cuando nacen juntos (§18) — sin cambio de esquema.

### 🔵 DECISIONES DE NEGOCIO — **todas resueltas en este Blueprint** salvo:
- Ninguna queda abierta a nivel de reglas. Queda a criterio de implementación (no de negocio) el orden exacto de despliegue de cada fase (§30) y si `Purpose` se expone editable en la UI de Pagos o solo se fija al crear.

---

## 30. Plan de implementación priorizado

### Fase 1 — Integridad de deuda (máxima prioridad, ya hay pérdida de datos activa)
`origin_settlement_id` + corrección de `IsSettlementOwnedDebt`/cleanup/purge + regla de eliminación segura (§9-10).

### Fase 2 — Integridad de Payments
Sobrepagos con remanente (§12), `AllocateExisting` para pagos a cuenta (§14), `Payment.Purpose` (§15).

### Fase 3 — Cálculos financieros
`SaldoDocumentado`/`DineroNoAplicado` únicos, reemplazando Dashboard/Statement/FinancialReport (§22).

### Fase 4 — Comprobantes + Payments
Formalizar que `issued_local` es el patrón de referencia; preparar el punto de enganche que usará POS.

### Fase 5 — POS
Crear `Payment` en la misma transacción que el comprobante, sin `Document` artificial, reutilizando `ApplyPaymentTx` (§17).

### Fase 6 — Cancelaciones y write-off
`voided_at/by/reason` en `Payment` (§19), bloqueo de write-off con pago parcial (§20).

### Fase 7 — UI y reportes
Estado de cuenta con los 4 bloques (§23), vista de Pagos mostrando `purpose` y aplicado/no aplicado desglosado.

**Cada fase es aprobable e implementable por separado**; el orden respeta dependencias reales (ej. Fase 5 depende de que Fase 2 ya soporte `Purpose` y allocations desde el mismo motor). Ningún punto requiere entidades, tablas ni módulos fuera del alcance de cuentas por cobrar ya existente.

---

## Cierre

Este documento reemplaza cualquier ambigüedad remanente de las Fases 1-3 como el contrato único a partir de aquí. La única contradicción real encontrada (clasificación independiente/a-cuenta) quedó resuelta con `Payment.Purpose`. Todo lo demás es consistente entre las tres fases y se consolida sin cambios de fondo.
