# Fase 2.5 — Auditoría y diseño de locking / concurrencia

Fecha: 2026-09-14
Estado: **diseño únicamente — sin cambios de código, sin commit**
Alcance: `AllocateExistingPaymentTx`, `ApplyPaymentTx`, `DeletePaymentTx` y las lecturas de saldo
que dependen de `PaymentAllocation`/`Document.balance_amount`. No incluye Purpose, POS, ni
funcionalidades ajenas al dinero (Blueprint Fase 2.5).
Commit base: `df6f0b2` (Fase 2.4)

---

## 1. Auditoría del código actual

### 1.1 Patrón de locking ya existente en el proyecto

El proyecto **sí** tiene un patrón establecido de bloqueo pesimista de fila única, usado 3 veces,
siempre para reservar un contador/correlativo:

```go
// services/fiscal_document_series_service.go:206 (idéntico en
// services/activity_template_service.go:90 y database/activity_template_migrations.go:256)
err = database.DB.Transaction(func(tx *gorm.DB) error {
    var ser models.FiscalDocumentSeries
    if e := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&ser, seriesID).Error; e != nil {
        return e
    }
    // ... leer, incrementar, guardar, todo dentro de la misma tx ...
})
```

Es `SELECT ... FOR UPDATE` vía `gorm.io/gorm/clause`, sobre **una sola fila**, dentro de
`database.DB.Transaction(...)`. No hay ningún caso existente en el proyecto que bloquee **múltiples
filas** en una misma transacción, por lo que el "orden de locks" (§4) es diseño nuevo, no reutilización.

**Decisión de diseño: reutilizar exactamente este mismo mecanismo** (`clause.Locking{Strength:
"UPDATE"}`), extendido a bloquear más de una fila con un orden determinista. No se introduce
ningún patrón nuevo (sin `SELECT ... LOCK IN SHARE MODE`, sin advisory locks, sin Redis, etc.).

### 1.2 Inventario de rutas que crean/modifican/eliminan `PaymentAllocation`

| Función | Archivo | Transacción | Lock hoy |
|---|---|---|---|
| `AllocateExistingPaymentTx` | `services/debt/payment_apply.go:199` | Sí (abierta por el llamador, `PaymentService.AllocateExisting`) | **Ninguno** |
| `ApplyPaymentTx` | `services/debt/payment_apply.go:125` | Sí (abierta por `CreateFromParams`) | **Ninguno** |
| `DeletePaymentTx` | `services/payment_service.go:565` | Sí (abierta por `PaymentService.Delete`) | **Ninguno** |
| `RevertPaymentAllocationsTx` | `services/debt/payment_apply.go:283` | Recibe `tx` de fuera | **Ninguno** — pero **código muerto**: no tiene ningún llamador en todo el repo (verificado por búsqueda global). Marcado en el propio código como candidato a eliminación ("remove legacy after migration stable"). No forma parte del riesgo real hoy. |
| `PaymentService.Update` (rama legacy) | `services/payment_service.go:336` | Sí | **Ninguno** — pero **estructuralmente bloqueada** para pagos con allocations: rechaza con error si `allocCount > 0`, `DocumentID != nil` o `Type == "applied"` (línea 345). Solo puede tocar pagos `on_account` sin ninguna imputación todavía. |
| `consolidation.go` (fusión de documentos duplicados) | `services/debt/consolidation.go:278-385` | Sí | **Ninguno** — mueve/fusiona `PaymentAllocation` entre documentos. Operación administrativa manual, de bajo volumen, **fuera del alcance de esta fase** (no toca `AllocateExisting`/`ApplyPayment`); se deja como riesgo P2 documentado, no se rediseña aquí. |

### 1.3 Lecturas de saldo relevantes (sin lock hoy)

- `ValidateAllocationsTx` (`payment_apply.go:47`): `tx.First(&d, ln.DocumentID)` + `EffectiveBalance` — lectura simple, sin `FOR UPDATE`.
- `AllocateExistingPaymentTx`: `tx.First(&pay, in.PaymentID)` + `SUM(PaymentAllocation.amount)` — lectura simple.
- `PersistBalanceAndStatus` / `PersistBalanceAndStatusForDoc` (`balance.go:52-76`): vuelve a leer el `Document` (`tx.First`), recalcula `PaidTotal` (nuevo `SUM`) y escribe `balance_amount`/`status` con un `UPDATE` ciego (no es un `UPDATE ... SET balance = balance - X`, es "recalcular todo y sobrescribir").
- `CreateFromParams` (`payment_service.go:112-264`): hace una **pre-validación completa fuera de cualquier transacción**, usando `database.DB` directo (no `tx`): lee `Document`, calcula `EffectiveBalance`, llama `ValidatePaymentAmountsAndAllocations(database.DB, ...)`. Esta validación es solo un *fail-fast* de UX (mensaje de error temprano); la validación que realmente importa para la integridad de datos es la que se repite **dentro** de la transacción, en `ApplyPaymentTx` (línea 132, usando `tx`). Esto es relevante para el diseño: **el locking solo debe agregarse dentro de la transacción real**, no en el pre-chequeo externo (bloquear fuera de una transacción explícita no sirve de nada — con autocommit MySQL libera el lock al terminar la sola sentencia).

### 1.4 Rutas de eliminación/anulación relacionadas

- `DeletePaymentTx` (`payment_service.go:565`): dentro de una transacción, pero sin lock — lee `Payment`, desvincula el `TukifacFiscalReceipt`, borra sus `PaymentAllocation`, borra el `Payment`, recalcula balance de los documentos afectados.
- `DocumentService.Delete` (`document_service.go:654`): **no usa transacción en absoluto** — son 3 sentencias sueltas (`database.DB.First`, luego el chequeo `DocumentFinancialOrSettlementHistory`, luego `database.DB.Delete`). Ya bloquea el borrado si el documento tiene `PaymentAllocation` (Blueprint Fase 1), pero el chequeo y el borrado no son atómicos entre sí — ver §7.2.

---

## 2. Escenario de carrera concreto

### 2.1 Dos requests concurrentes sobre el MISMO Payment (caso pedido explícitamente)

```
Payment.amount = 1000, allocations existentes = 0

t0  Request A: AllocateExistingPaymentTx(PaymentID=P, Lines=[{Doc1, 700}])
t0  Request B: AllocateExistingPaymentTx(PaymentID=P, Lines=[{Doc2, 600}])

t1  A: tx.First(&pay, P)                          -> pay.Amount=1000
t1  B: tx.First(&pay, P)                          -> pay.Amount=1000   (misma fila, sin lock)
t2  A: SUM(PaymentAllocation WHERE payment_id=P)  -> 0  -> available=1000
t2  B: SUM(PaymentAllocation WHERE payment_id=P)  -> 0  -> available=1000
t3  A: 700 <= 1000+eps -> OK -> ValidateAllocationsTx OK -> INSERT allocation(P,Doc1,700) -> commit
t4  B: 600 <= 1000+eps -> OK -> ValidateAllocationsTx OK -> INSERT allocation(P,Doc2,600) -> commit

Resultado: SUM(allocations) = 1300 > Payment.amount = 1000. Sobregiro de 300 confirmado.
```

Esto **sí ocurre hoy** tal como está implementado. Ninguna sentencia en `AllocateExistingPaymentTx`
adquiere un lock que fuerce a B a esperar a que A confirme antes de leer el `SUM`. El nivel de
aislamiento por defecto de MySQL/InnoDB (`REPEATABLE READ`) no evita esto: A y B hacen `SELECT`
simples (no `FOR UPDATE`) sobre una fila de `payments` que ninguno de los dos modifica (solo
insertan en `payment_allocations`, una tabla hija) — no hay ningún lock implícito de InnoDB que
sirva de barrera aquí.

### 2.2 Dos solicitudes sobre Payments DIFERENTES, mismo Document

```
Document.total_amount = 500, balance_amount = 500 (documento nuevo, sin pagos)

Request A: AllocateExistingPaymentTx(PaymentID=P1 [servicio purpose=deuda, amount=500], Lines=[{Doc, 400}])
Request B: AllocateExistingPaymentTx(PaymentID=P2 [purpose=deuda, amount=500], Lines=[{Doc, 300}])

t1 A: ValidateAllocationsTx lee Document -> EffectiveBalance=500 -> 400<=500 OK
t1 B: ValidateAllocationsTx lee Document -> EffectiveBalance=500 -> 300<=500 OK   (misma fila, sin lock)
t2 A: INSERT allocation(P1,Doc,400) -> PersistBalanceAndStatus(Doc) -> balance=100
t3 B: INSERT allocation(P2,Doc,300) -> PersistBalanceAndStatus(Doc) -> balance recalculado desde
      SUM real de allocations (400+300=700) -> BalanceFromTotalPaid(500,700) -> 0 (con clamp a
      no-negativo), status="pagado"

Resultado: el balance final SÍ queda en 0 (porque PersistBalanceAndStatus recalcula desde el SUM
real, no arrastra un contador ciego) — pero el Document quedó pagado con 700 aplicados sobre una
deuda de 500, es decir 200 de sobregiro que nunca debieron pasar la validación de "no exceder el
saldo del documento" en la línea de B. La corrupción NO es en `balance_amount` (que se auto-corrige
al recalcularse), sino en las `PaymentAllocation` ya persistidas: quedan 700 en imputaciones reales
sobre una deuda de 500, y ese exceso de 200 es standing data incorrecta que ningún proceso posterior
vuelve a corregir.
```

Esta es una carrera **distinta** de la 2.1: aquí el `Payment` de cada request es diferente (no hay
fila de `payments` compartida que bloquear), el recurso compartido es el `Document`. Bloquear solo
`Payment` (alternativa A, §3) **no** evita este escenario.

### 2.3 Asignación concurrente + reversión/eliminación del mismo Payment

```
Payment P, amount=1000, sin allocations.

Request A: AllocateExistingPaymentTx(P, Lines=[{Doc1,600}])
Request B: PaymentService.Delete(P)   (DeleteAPI, borrado manual)

t1 A: tx.First(&pay, P) -> OK, Purpose=deuda
t1 B: tx.First(&p, P) (DeletePaymentTx) -> OK
t2 A: SUM(allocations)=0 -> available=1000 -> valida línea -> INSERT allocation(P,Doc1,600)
t3 B: Find(allocations WHERE payment_id=P) -> puede ver 0 o 1 fila según el orden real de commit
      -> Delete(allocations WHERE payment_id=P) -> Delete(Payment P)

Dos desenlaces posibles según el entrelazado exacto:
(a) B borra el Payment y sus allocations DESPUÉS de que A confirmó -> el Document Doc1 queda con
    balance_amount recalculado sin la allocation de 600 (porque ya no existe), pero el pago que la
    originó tampoco existe -> dinero "perdido" contablemente: se aplicó y luego desapareció sin
    dejar rastro de reversión explícita.
(b) B lee el Payment y sus allocations ANTES de que A inserte la suya (allocs=[]), borra el Payment
    -> A, que ya validó "el pago existe y pertenece a la empresa" en t1, procede a insertar una
    PaymentAllocation que referencia un Payment que ya no existe (no hay FK real en el esquema,
    solo índices) -> allocation huérfana, referencialmente inconsistente, invisible a cualquier
    reporte que haga JOIN con payments.
```

Ninguno de los dos desenlaces es aceptable. El fix es el mismo en ambos casos: `DeletePaymentTx`
debe bloquear la misma fila de `Payment` (`FOR UPDATE`) que bloquea `AllocateExistingPaymentTx`,
de modo que una de las dos transacciones espere a que la otra confirme, y la segunda vea el estado
post-commit real (en (b), si A gana la carrera del lock, B verá la allocation ya creada y el borrado
del Payment la arrastrará correctamente vía su lógica existente de limpieza de `payment_allocations`
por `payment_id`).

### 2.4 Asignación concurrente + cambio de saldo del Document

Igual mecanismo que §2.2 pero con la otra fuente de escritura de saldo: `ApplyPaymentTx` creando un
pago **nuevo** aplicado directamente a `Doc` mientras `AllocateExistingPaymentTx` aplica el
remanente de un pago existente al mismo `Doc`. Ambos leen `EffectiveBalance`/`Document` sin lock
antes de validar “no exceder saldo”, con el mismo resultado que §2.2: ambos pueden pasar la
validación individualmente y sumar más que `total_amount` en `PaymentAllocation`.

---

## 3. Qué fila(s) deben bloquearse

| Alternativa | Qué carrera evita | Qué carrera NO evita | Riesgo de deadlock | Impacto en concurrencia | Complejidad | Compatibilidad |
|---|---|---|---|---|---|---|
| **A. Solo `Payment`** | §2.1 (mismo Payment, dos allocations concurrentes) y §2.3 (allocate + delete del mismo Payment) | §2.2 y §2.4 (mismo Document, Payments distintos) — el Document nunca se bloquea, dos Payments distintos pueden seguir sobregirando el mismo Document | Bajo (una sola fila por transacción, sin bloqueos anidados) | Alto — solo serializa operaciones sobre el mismo Payment, que ya es un recurso naturalmente poco compartido (normalmente una sola persona/flujo opera sobre un Payment a la vez) | Baja | Total — mismo patrón que ya existe (§1.1) aplicado a `payments` |
| **B. Solo `Document`(s)** | §2.2 y §2.4 (saldo del Document protegido contra cualquier origen de escritura) | §2.1 — dos `AllocateExisting` sobre el MISMO Payment pero con líneas hacia **Documents distintos** no comparten ningún Document que bloquear, y aun así pueden sobregirar el Payment (700 a Doc1 + 600 a Doc2, ningún Document individual se sobregira, pero el Payment sí) | Medio — si se bloquean varios documentos por transacción, hace falta orden determinista (§4) igualmente | Medio — más granular que bloquear el Payment (dos requests sobre el mismo Payment pero Documents distintos no se bloquean entre sí), pero dos requests distintas sobre el mismo Document siempre se serializan aunque sean de negocios lógicamente no conflictivos (ej. dos pagos distintos llegando al mismo cliente el mismo minuto, deseable que se serialicen igual, así que no es un impacto negativo real aquí) | Media (requiere orden de locks) | Alta, pero dejaría el escenario 2.1 sin cubrir |
| **C. `Payment` + `Document`(s)** (recomendada) | §2.1, §2.2, §2.3 y §2.4 — cubre ambas invariantes (el remanente del Payment y el saldo del Document) en la misma transacción | Ninguno de los 4 escenarios auditados queda sin cubrir | Medio — mitigado con el orden determinista de §4 (siempre Payment primero si existe, luego Documents ascendente por ID) | Medio — el costo es aceptable: el volumen de pagos concurrentes sobre el mismo Payment o el mismo Document es bajo en este negocio (no es un sistema de alta frecuencia), y ya es el mismo costo que pagan hoy los correlativos de comprobantes (§1.1) sin problema reportado | Media — dos bloqueos por transacción en vez de uno, pero reutilizando la misma primitiva | Total, reutiliza el patrón §1.1 dos veces con un orden fijo |
| **D. Otra estrategia (optimista / versión)** | En teoría, ninguna carrera si se implementa con reintentos — pero exige agregar una columna de versión (`version`/`updated_at` como optimistic lock) a `payments` y/o `documents`, retry-loop en el llamador, y cambiar el patrón de error (de "rechazado" a "reintente") | Nada intrínsecamente, pero introduce una superficie nueva (manejo de conflictos y reintentos) no presente en ningún otro punto del proyecto | N/A (no hay locks, hay reintentos) | Alto en teoría (no bloquea lectores), pero irrelevante aquí porque el problema no es de lectores sino de escritores concurrentes sobre el mismo dinero — el optimistic locking solo evita la corrupción, no reduce la necesidad de serializar las escrituras reales | Alta — requiere cambiar el modelo (migración) y el patrón de código en cada punto de escritura | Baja — sería el único patrón de concurrencia del proyecto que no es "SELECT ... FOR UPDATE"; iría contra "no inventes un mecanismo nuevo si el proyecto ya tiene uno establecido" |

**Decisión: Alternativa C — bloquear el `Payment` (si existe previamente) y los `Document`(s)
afectados, ambos con `SELECT ... FOR UPDATE` dentro de la misma transacción**, reutilizando
`clause.Locking{Strength: "UPDATE"}` tal cual se usa hoy en `fiscal_document_series_service.go`.

---

## 4. Orden de los locks

Regla determinista única, aplicada por igual en `AllocateExistingPaymentTx`, `ApplyPaymentTx` y
`DeletePaymentTx`:

```
1. Si la operación parte de un Payment YA EXISTENTE (AllocateExisting, DeletePaymentTx):
   bloquear ese Payment PRIMERO (una sola fila, no hay ambigüedad de orden posible).
   (ApplyPaymentTx crea un Payment NUEVO — no existe fila previa que bloquear; no aplica.)

2. Luego, bloquear los Document(s) afectados por la operación, ORDENADOS ASCENDENTEMENTE POR ID,
   sin importar el orden en que el llamador los envió en el payload.
```

Por qué este orden evita deadlocks:

- **Document vs Document**: si dos transacciones (de cualquiera de las 3 operaciones) tocan un
  conjunto de Documents que se solapa (ej. Tx1 = [Doc3, Doc7], Tx2 = [Doc7, Doc3]), ambas los
  bloquean en el mismo orden ascendente (Doc3 luego Doc7) — la segunda transacción en llegar a
  Doc3 simplemente espera; nunca se da el ciclo "Tx1 espera Doc7 que tiene Tx2, Tx2 espera Doc3 que
  tiene Tx1".
- **Payment vs Document**: `payments` y `documents` son tablas distintas; un lock de fila en una
  tabla nunca puede formar un ciclo con un lock de fila en otra tabla **siempre que todas las
  operaciones que tocan ambas respeten el mismo orden relativo** (Payment antes que sus Documents).
  Como las 3 operaciones en alcance siguen esa regla, no hay forma de que una espere un Document
  mientras posee un lock de Payment que otra necesita, y viceversa, en direcciones cruzadas.
- **Payment vs Payment**: ninguna de las 3 operaciones bloquea más de un `Payment` a la vez, así
  que no existe escenario de dos Payments bloqueados en orden cruzado.

---

## 5. `PaymentAllocation`: duplicados, índices, constraints

- **¿Riesgo de duplicar una allocation?** Sí, hoy — mitigado completamente por el lock de `Payment`
  (§2.1): una vez que la lectura de `SUM(allocations)` y la validación de `available` ocurren
  dentro de la sección crítica protegida por el lock del `Payment`, dos requests concurrentes sobre
  el mismo `Payment` quedan serializadas y la segunda ve el `SUM` actualizado por la primera.
- **¿Dos allocations simultáneas para el mismo Payment+Document?** Esto **no es un bug a prevenir**
  — es un caso legítimo explícitamente señalado en la instrucción: aplicar el remanente de un mismo
  Payment hacia el mismo Document en dos operaciones distintas (hoy o en el futuro) debe seguir
  siendo posible. El lock de Payment evita que dos INSERTs *concurrentes* se basen en el mismo
  remanente stale; no impide que existan dos filas `PaymentAllocation(payment_id, document_id)`
  legítimas y consecutivas. **No se debe agregar un `UNIQUE(payment_id, document_id)`.**
- **¿Una consulta de SUM puede ver un estado incompleto?** Solo si corre fuera de la sección crítica
  bloqueada, o en una conexión que no respeta el aislamiento por defecto de InnoDB. Con el lock de
  Payment adquirido ANTES de calcular el `SUM`, y manteniéndolo hasta commit, esto queda cerrado:
  nadie más puede insertar una `PaymentAllocation` para ese `payment_id` mientras el lock esté
  activo (cualquier INSERT concurrente en `payment_allocations` para ese `payment_id` proviene de
  una transacción que primero necesita el mismo lock del `Payment`, según la regla que estamos
  fijando para las 3 operaciones en alcance).
- **Índices/constraints**: el índice individual ya existente en `payment_id` es suficiente para el
  rendimiento del `SUM(...) WHERE payment_id = ?`. Un índice compuesto `(payment_id, document_id)`
  sería una optimización de lectura opcional, no una necesidad de corrección — **queda fuera de
  Fase 2.5** (no se requiere para cerrar ninguna carrera).
- **Conclusión**: ninguna restricción nueva a nivel de base de datos. Todo el cierre de esta
  categoría de riesgo es a nivel de locking transaccional (§3-4).

---

## 6. `Document.balance_amount`

`PersistBalanceAndStatus` recalcula siempre desde cero (`PaidTotal` = `SUM` real de
`PaymentAllocation` + pagos legacy) y sobrescribe `balance_amount`/`status` — no es un contador que
se decrementa incrementalmente, así que no puede "perder" una resta ni un `+=`/`-=` corrupto por
una escritura concurrente perdida (*lost update* clásico de contador). El riesgo real, como se vio
en §2.2, no es que `balance_amount` quede mal calculado (siempre se recalcula correcto respecto al
estado de `PaymentAllocation` en ese instante) — es que **la validación "no exceder el saldo" se
evalúa sobre una lectura vieja de `balance_amount`/`PaidTotal` antes de que exista lock**, dejando
persistir imputaciones que en conjunto exceden `total_amount`.

**Decisión**: el saldo debe **recalcularse después de adquirir el lock**, no antes. Concretamente:

1. Bloquear el `Document` (`FOR UPDATE`) — esto es lo que hoy falta en `ValidateAllocationsTx`.
2. Con el lock ya tomado, calcular `EffectiveBalance`/`PaidTotal` (exactamente el código actual,
   sin cambiar la fórmula) — ahora esa lectura es consistente porque nadie más puede insertar una
   `PaymentAllocation` nueva para ese documento mientras el lock esté activo.
3. Validar la línea contra ese saldo ya protegido.
4. Insertar la `PaymentAllocation`.
5. Llamar a `PersistBalanceAndStatus` — como el `Document` ya está bloqueado desde el paso 1 **en
   la misma transacción**, su segunda lectura interna (`tx.First(&d, documentID)`) es consistente
   sin necesidad de bloquear otra vez (el lock de fila de InnoDB se mantiene mientras dure la
   transacción, no hay que "re-pedirlo").

No se requiere ninguna actualización atómica tipo `UPDATE documents SET balance = balance - ?` — 
cambiar el patrón de "recalcular todo" a "decrementar" sería una reescritura de `PersistBalanceAndStatus`
que usan también otras rutas fuera de este alcance (settlement, writeoff, consolidación) y no aporta
nada que el lock de fila no resuelva ya. Se mantiene el patrón actual, solo se agrega el lock antes.

---

## 7. Delete / Revert / Void

| Ruta | Estado actual | ¿Debe compartir el esquema de locking de Fase 2.5? |
|---|---|---|
| `DeletePaymentTx` (borrado real de `Payment` vía `DeleteAPI`) | Transaccional, sin lock | **Sí, obligatorio** — es la única ruta viva que borra `PaymentAllocation`/`Payment` y compite directamente con `AllocateExistingPaymentTx` sobre el mismo `Payment` (§2.3). Debe bloquear el `Payment` primero (mismo orden, §4), luego los `Document`(s) afectados (los que tenían allocations) antes de recalcular su balance. |
| `RevertPaymentAllocationsTx` | Sin lock, pero **sin ningún llamador en el repo** | No aplica hoy — es código muerto. Si en el futuro se conecta a algún flujo real, debe adoptar el mismo esquema en ese momento; no se toca en Fase 2.5 porque tocar código sin llamador no cierra ninguna carrera real y el alcance de esta fase es explícitamente el flujo vivo. |
| `PaymentService.Update` (rama legacy, edición de pago sin allocations) | Sin lock, pero auto-limitada: rechaza cualquier `Payment` con `allocCount > 0` | Riesgo residual menor (TOCTOU): lee `allocCount` sin lock; en teoría un `AllocateExisting` podría crear la primera allocation justo después de que `Update` la contó en 0 y antes de que `Update` guarde sus cambios, dejando editado un campo (monto/fecha/etc.) de un pago que ya tiene una imputación real. Es un caso de ventana muy estrecha y bajo impacto (campos editables no incluyen `amount` una vez que hay allocations en la intención de diseño, pero el código no lo re-verifica en el mismo statement). **Recomendación**: agregar el mismo lock de `Payment` a `Update` por consistencia y barato costo, pero no es bloqueante para cerrar Fase 2.5 — se documenta como mejora de bajo riesgo a decidir en la implementación. |
| `DocumentService.Delete` (borrado físico de `Document`) | **No transaccional en absoluto** (3 sentencias sueltas) | **Sí recomendado** — ya bloquea el borrado si detecta historial financiero (`DocumentFinancialOrSettlementHistory`), pero el chequeo y el `Delete` final no son atómicos entre sí: una `AllocateExistingPaymentTx` concurrente podría crear la primera `PaymentAllocation` de ese documento justo después de que `Delete` verificó "sin historial" y antes de que ejecute el `DELETE FROM documents`, dejando una allocation huérfana apuntando a un documento inexistente. Cerrar esto requiere además envolver `DocumentService.Delete` en una transacción (hoy no la tiene) y bloquear el `Document` antes del chequeo de historial — cambio más grande que los anteriores porque toca una función sin transacción previa. Se marca como parte del plan de implementación (§10) pero con prioridad secundaria dentro de la misma fase, ya que el escenario requiere que alguien esté borrando un documento y aplicando dinero a él en el mismo instante — mucho menos frecuente que los escenarios §2.1/§2.2. |
| `consolidation.go` (fusión de documentos) | Sin lock | Fuera de alcance de Fase 2.5 (operación administrativa manual, no forma parte del flujo `AllocateExisting`/`ApplyPayment`). Queda como riesgo P2 documentado para una fase futura si se decide. |

**Conclusión de §7**: para que "proteger `AllocateExisting` contra concurrencia" sea real (no solo
en el papel), **`DeletePaymentTx` debe entrar en el mismo esquema de locking en esta misma fase** —
de lo contrario, §2.3 queda sin cerrar aunque `AllocateExistingPaymentTx` esté perfectamente
bloqueado por su lado. `DocumentService.Delete` se recomienda para la misma fase por consistencia,
con menor prioridad. `PaymentService.Update` y `RevertPaymentAllocationsTx` quedan documentados,
no bloqueantes.

---

## 8. Transacciones — dónde empieza/termina hoy y dónde deben ir los locks

| Operación | Transacción hoy | Dónde debe adquirirse el lock |
|---|---|---|
| `AllocateExistingPaymentTx` | Abierta por `PaymentService.AllocateExisting` (`database.DB.Transaction`), `tx` se pasa entero a la función | Lock del `Payment` **inmediatamente al leerlo** (reemplaza el `tx.First(&pay, in.PaymentID)` actual por la versión con `Clauses(clause.Locking{...})`) — antes de calcular `available`. Lock de cada `Document` de `in.Lines` (ordenados por ID) **dentro de `ValidateAllocationsTx`**, en el momento en que hoy se hace `tx.First(&d, ln.DocumentID)` — antes de leer `EffectiveBalance`. |
| `ApplyPaymentTx` | Abierta por `CreateFromParams` | No hay `Payment` previo que bloquear (se crea en esta misma función). Lock de cada `Document` de `in.Lines` (ordenados por ID), en el mismo punto de `ValidateAllocationsTx`/`ValidatePaymentAmountsAndAllocations` que usa `AllocateExisting`. |
| `DeletePaymentTx` | Abierta por `PaymentService.Delete` | Lock del `Payment` al inicio (reemplaza `tx.First(&p, id)`), antes de leer sus `PaymentAllocation`. Lock de los `Document`(s) afectados (ordenados por ID) antes de `recalculateDocumentStatusTx`. |
| `DocumentService.Delete` | **No existe hoy** — debe envolverse en `database.DB.Transaction(...)` como parte de este trabajo | Lock del `Document` al inicio, antes de `DocumentFinancialOrSettlementHistory`. |

En los 4 casos, el lock se libera automáticamente al `COMMIT`/`ROLLBACK` que ya gestiona
`database.DB.Transaction(...)` (o el que se agregue en `DocumentService.Delete`) — no hace falta
ninguna liberación manual.

**Nota sobre el pre-chequeo fuera de transacción de `CreateFromParams`** (§1.3): no se toca. Seguirá
siendo una validación de UX no autoritativa; la autoritativa (con lock) es la que corre dentro de
`ApplyPaymentTx`.

---

## 9. Tests de concurrencia

### 9.1 Limitación real y verificada del entorno de test actual

El driver usado en todos los tests de este repo (`github.com/glebarez/sqlite`) **ignora
explícitamente** la cláusula de locking:

```go
// glebarez/sqlite@v1.11.0/sqlite.go:115-119
"FOR": func(c clause.Clause, builder clause.Builder) {
    if _, ok := c.Expression.(clause.Locking); ok {
        // SQLite3 does not support row-level locking.
        return
    }
    ...
```

Es decir: `tx.Clauses(clause.Locking{Strength:"UPDATE"})` bajo SQLite **compila y corre sin error,
pero no bloquea nada** — es un no-op silencioso. Un test de concurrencia contra la base sqlite en
memoria usada hoy por el resto de la suite **no puede demostrar** que el lock realmente serializa
nada; como mucho puede demostrar que el código no revienta. Esto es un hallazgo verificado
directamente en el código fuente del driver, no una suposición.

**Consecuencia**: los tests A-D pedidos por la instrucción necesitan una base de datos con soporte
real de `SELECT ... FOR UPDATE` — es decir, MySQL, igual que producción.

### 9.2 Propuesta de tests contra MySQL real

Se propone un archivo separado, ej. `services/debt/allocate_existing_concurrency_test.go`, con
**build tag** o *skip* condicionado a una variable de entorno (para no romper `go test ./...` en
CI/local sin MySQL disponible):

```go
//go:build mysql_integration

func TestAllocateExisting_Concurrent_SamePayment_NeverExceedsAmount(t *testing.T) {
    dsn := os.Getenv("MYSQL_TEST_DSN")
    if dsn == "" {
        t.Skip("MYSQL_TEST_DSN no configurado — este test requiere MySQL real, ver docs/...")
    }
    // abrir conexión MySQL real (no sqlite), sembrar Payment(amount=1000) + 2 Documents,
    // lanzar 2 goroutines con un sync.WaitGroup + una barrera (channel) para maximizar la
    // probabilidad de que ambas lleguen al SELECT en la ventana de carrera,
    // cada una llamando AllocateExistingPaymentTx en su propia transacción real,
    // esperar ambas, y verificar:
    //   - SUM(payment_allocations.amount WHERE payment_id=P) <= 1000 + epsilon
    //   - exactamente una de las dos llamadas devolvió error si 700+600 > 1000
    //   - si ambas succeeden, sum(applied) == 700+600 solo si eso es <= 1000 (no aplica en este caso)
}
```

Ejecución local propuesta (sin tocar producción): `docker run --rm -e MYSQL_ROOT_PASSWORD=test
-p 3307:3306 -d mysql:8` + `MYSQL_TEST_DSN=... go test -tags=mysql_integration ./services/debt/...`.
Se documentará el comando exacto en el README de tests cuando se implemente (Fase 2.5 de código).

- **Test A** (`Payment=1000`, goroutines piden 700 y 600 simultáneamente): verificar
  `SUM(allocations) <= 1000+eps` siempre, y que exactamente una de las dos falle con "excede el
  disponible" (dado que 700+600=1300>1000) — nunca que ambas tengan éxito.
- **Test B** (mismo Payment, dos asignaciones concurrentes que SÍ caben, ej. 400+500=900<=1000):
  ambas deben poder tener éxito (el lock serializa, no rechaza trabajo legítimo), y el remanente
  final debe ser exactamente 100.
- **Test C** (Payments diferentes, mismo Document con saldo 500, piden 400 y 300 a la vez):
  verificar que como máximo una de las dos tenga éxito si juntas exceden 500, y que
  `Document.balance_amount` nunca quede negativo ni la suma de sus `PaymentAllocation` exceda
  `total_amount`.
- **Test D** (allocation concurrente + `DeletePaymentTx` sobre el mismo Payment): verificar que al
  finalizar ambas operaciones, o bien el Payment y sus allocations no existen (ganó el delete y la
  allocation concurrente falló porque el Payment ya no estaba, o se aplicó y luego el delete la
  limpió correctamente como parte de su propio borrado), o bien el Payment existe con su allocation
  intacta (ganó el allocate) — nunca un estado intermedio con la allocation huérfana o el Payment
  borrado pero la allocation sobreviviendo.

Los tests **secuenciales** (sin concurrencia real, ya buildables hoy bajo sqlite) que sí pueden
escribirse sin MySQL son los de "un test llama a la función dos veces en la misma goroutine
simulando el orden de llegada" — útiles para fijar el comportamiento determinista del rechazo
(ej. "si la primera línea ya consumió el remanente, la segunda llamada secuencial fallará sola"),
pero **no prueban la serialización real**, solo la lógica de validación — se seguirán agregando en
`allocate_existing_test.go` igual que hoy, sin depender de MySQL.

---

## 10. Fase 2.5 propuesta

- **Recursos a bloquear**: fila de `payments` (cuando el Payment ya existe: `AllocateExisting`,
  `DeletePaymentTx`) + filas de `documents` afectadas (en las 4 operaciones: `AllocateExisting`,
  `ApplyPayment`, `DeletePaymentTx`, `DocumentService.Delete`).
- **Orden de locks**: `Payment` (si existe) primero, luego `Document`s ordenados ascendentemente
  por `ID` — regla única para las 4 operaciones (§4).
- **Momento exacto de adquisición**: el lock del `Payment` se adquiere en el primer `First` que ya
  existe hoy (se le agrega `Clauses(clause.Locking{...})`), antes de calcular cualquier remanente o
  leer allocations. El lock de cada `Document` se adquiere dentro de `ValidateAllocationsTx` (o el
  código equivalente en `DeletePaymentTx`/`DocumentService.Delete`), antes de leer su
  `EffectiveBalance`/`PaidTotal` y antes de validar la línea correspondiente.
- **Duración del lock**: hasta el `COMMIT`/`ROLLBACK` de la transacción (gestionado automáticamente
  por `database.DB.Transaction(...)`); no se libera manualmente en ningún punto intermedio.
- **Operaciones que deben compartir la estrategia**: obligatorio — `AllocateExistingPaymentTx`,
  `ApplyPaymentTx`, `DeletePaymentTx`. Recomendado en la misma fase — `DocumentService.Delete`
  (requiere envolverla en transacción, hoy no la tiene). Documentado, no bloqueante —
  `PaymentService.Update` (rama legacy). Fuera de alcance — `RevertPaymentAllocationsTx` (código
  muerto), `consolidation.go` (operación administrativa separada).
- **Índices/constraints necesarios**: ninguno nuevo. No se agrega `UNIQUE(payment_id, document_id)`
  (rompería el caso legítimo de múltiples allocations Payment→mismo Document). El índice compuesto
  opcional para performance queda fuera de esta fase.
- **Tests necesarios**: 4 tests de concurrencia real contra MySQL (Test A-D, §9.2), gateados por
  variable de entorno / build tag para no exigir MySQL en el resto de la suite; documentación del
  comando de ejecución local. Los tests secuenciales existentes de `allocate_existing_test.go` no
  necesitan cambios (siguen siendo válidos, solo no prueban la serialización real).
- **Archivos que habría que modificar** (en la implementación, NO en este diseño):
  - `backend/services/debt/payment_apply.go` — lock del `Payment` en `AllocateExistingPaymentTx`;
    lock de `Document`s dentro de `ValidateAllocationsTx` (compartido por `ApplyPaymentTx` y
    `AllocateExistingPaymentTx`, ya que ambos la llaman).
  - `backend/services/payment_service.go` — lock del `Payment` en `DeletePaymentTx`.
  - `backend/services/document_service.go` — envolver `Delete` en transacción + lock del
    `Document`.
  - Nuevo archivo de test `backend/services/debt/allocate_existing_concurrency_test.go` (build tag
    `mysql_integration`).
  - Documentación de cómo levantar el MySQL de prueba local (probablemente un apéndice en el doc de
    implementación de Fase 2.5, no en este diseño).
- **Riesgos**:
  - Bloquear 2 recursos por transacción en vez de 1 aumenta ligeramente la ventana de contención,
    aceptable dado el volumen actual del negocio (mismo argumento que ya vale para los
    correlativos, §1.1).
  - `DocumentService.Delete` pasa de "sin transacción" a "con transacción" — cambio de
    comportamiento estructural que merece su propia revisión de regresión cuando se implemente
    (ej. confirmar que ningún llamador dependía de que el chequeo de historial y el borrado fueran
    operaciones separadas).
  - Los tests de concurrencia real requieren infraestructura MySQL en el entorno de CI/dev que hoy
    no está configurada para tests (aunque sí existe MySQL en producción) — se documenta como
    trabajo adicional de la fase de implementación, no bloqueante para el diseño.
- **Compatibilidad con Fases 1-2.4**: total. No se cambia ninguna fórmula de negocio
  (`ValidateAllocationsTx`, `PersistBalanceAndStatus`, `EffectiveBalance` mantienen exactamente su
  lógica actual), no se cambian firmas públicas, no se cambia el endpoint ni el payload de
  `AllocateExisting`, no se toca `Purpose` ni `Type`. El único cambio de comportamiento observable
  es que dos requests que hoy "ganan las dos" en una carrera pasarán a que una de las dos espere
  (y potencialmente sea rechazada si el remanente/saldo ya no alcanza) — que es exactamente el
  comportamiento correcto que Fase 2.4 documentó como pendiente.

---

## 11. Matriz final

| Operación | Payment lock | Document lock | Transaction | Riesgo actual | Solución |
|---|---|---|---|---|---|
| `AllocateExistingPaymentTx` | No → **Sí (nuevo)** | No → **Sí (nuevo)** | Ya existe | Sobregiro del remanente del Payment (§2.1) y del saldo del Document (§2.2) bajo concurrencia | `FOR UPDATE` en `Payment` al leerlo + `FOR UPDATE` en cada `Document` de las líneas, orden Payment→Documents ascendente |
| `ApplyPaymentTx` | N/A (Payment nuevo, no hay fila previa) | No → **Sí (nuevo)** | Ya existe | Sobregiro del saldo del Document si compite con `AllocateExisting`/otro `ApplyPayment` sobre el mismo Document (§2.4) | `FOR UPDATE` en cada `Document` de las líneas (mismo código compartido vía `ValidateAllocationsTx`), orden ascendente por ID |
| `Delete/Revert allocation` (`DeletePaymentTx`; `RevertPaymentAllocationsTx` es código muerto) | No → **Sí (nuevo, en `DeletePaymentTx`)** | No → **Sí (nuevo, en `DeletePaymentTx`)** | Ya existe (`DeletePaymentTx`); `RevertPaymentAllocationsTx` recibe `tx` externo, sin llamador | Borrado concurrente con una asignación en curso sobre el mismo Payment deja allocations huérfanas o dinero aplicado sin rastro (§2.3) | `FOR UPDATE` en el `Payment` al leerlo, luego en los `Document`(s) afectados antes de recalcular su balance |
| `Void Payment` (no existe una ruta de "anulación" separada del borrado físico hoy — `DeletePaymentTx` es la única) | Ver fila anterior | Ver fila anterior | Ver fila anterior | Mismo que "Delete/Revert allocation" — no hay una operación de "void" distinta en el código actual | Mismo fix que `DeletePaymentTx`; si en el futuro se agrega un "void" lógico separado, debe heredar el mismo esquema |
| `PersistBalanceAndStatus` | N/A (no lee/escribe `Payment`) | Depende del lock ya tomado por el llamador — **no debe tomar su propio lock** | Depende del llamador (recibe `tx`) | Ninguno propio si el `Document` ya fue bloqueado antes por el llamador (§6); si se llama sin que el `Document` esté bloqueado (ej. desde código fuera de este alcance como `settlement_close.go`/`writeoff.go`), el riesgo persiste igual que hoy, pero es un riesgo preexistente fuera del alcance de Fase 2.5 | Ninguna: mantener el recálculo actual, documentar como precondición que el `Document` debe estar bloqueado por el llamador antes de invocarla en cualquier flujo nuevo |
| `DocumentService.Delete` (agregado por completitud, no estaba en la matriz pedida pero surge del análisis §7) | N/A | No → **Sí (recomendado)** | No existe → **se debe agregar** | Chequeo de historial y borrado no atómicos; una allocation nueva creada entre ambos deja el documento borrado con una allocation huérfana | Envolver en transacción + `FOR UPDATE` en el `Document` antes del chequeo de historial |

---

## Resumen ejecutivo

```
Código modificado: NO (solo este documento de diseño)
Migraciones: NO
Endpoints: NO
Modelos: NO
Commit: NO

Hallazgo principal:
AllocateExistingPaymentTx, ApplyPaymentTx y DeletePaymentTx leen Payment/Document
y calculan remanente/saldo sin ningún lock. Dos requests concurrentes sobre el
mismo Payment pueden sumar más que Payment.amount; dos requests sobre el mismo
Document (aunque vengan de Payments distintos) pueden sumar más que
Document.total_amount. Confirmado con escenario numérico 700+600 sobre 1000.

Patrón ya existente en el proyecto:
tx.Clauses(clause.Locking{Strength:"UPDATE"}).First(&fila, id) dentro de
database.DB.Transaction(...) — usado hoy para 3 correlativos de un solo recurso.
Fase 2.5 reutiliza EXACTAMENTE este patrón, extendido a bloquear Payment + N
Documents en un orden determinista (Payment primero, Documents ascendente por ID).

Estrategia recomendada: Alternativa C (Payment + Document(s)), la única que cierra
los 4 escenarios de carrera auditados.

PaymentAllocation: sin nuevas constraints — el lock transaccional basta; no se
debe prohibir múltiples allocations legítimas de un Payment hacia el mismo
Document.

Document.balance_amount: se sigue recalculando igual (PaidTotal + UPDATE), solo
se exige que el Document ya esté bloqueado antes de leer/escribir su saldo.

Delete/Revert: DeletePaymentTx debe entrar en el mismo esquema en esta misma
fase (si no, la protección de AllocateExisting queda incompleta). Recomendado
además envolver DocumentService.Delete en transacción + lock. Update (rama
legacy) y RevertPaymentAllocationsTx (código muerto) quedan documentados, no
bloqueantes.

Tests: sqlite (glebarez) ignora clause.Locking por diseño propio del driver —
verificado en su código fuente — por lo que los tests de concurrencia real
requieren MySQL, propuestos como archivo separado con build tag/skip
condicionado a variable de entorno, sin afectar la suite actual.
```
