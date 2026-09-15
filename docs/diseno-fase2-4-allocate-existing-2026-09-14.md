# Diseño Fase 2.4 — `AllocateExisting`

**Fecha**: 2026-09-14
**Naturaleza de este documento**: diseño y auditoría exclusivamente. **Ningún código fue modificado.** Solo se ejecutaron lecturas (`Read`/`Grep`) del código real ya existente (`Payment`, `PaymentAllocation`, `payment_service.go`, `debt/payment_apply.go`, `routes.go`, `rbac/codes.go`).

---

## 1. Estado actual

Confirmado leyendo el código tal como quedó después de Fase 2.3 (commit `9fa3eb9`):

- **Crear un `Payment`**: `PaymentService.CreateFromParams` — única puerta de entrada real (`Create` es un wrapper delgado que delega a ella). Soporta `on_account`, `single`, `manual`, `fifo`. Desde Fase 2.3, cualquiera de estos modos puede dejar remanente (`Payment.amount > SUM(PaymentAllocation.amount)`).
- **Crear `PaymentAllocation`s**: solo dentro de `debt.ApplyPaymentTx` (camino moderno, siempre dentro de una transacción, siempre recalcula `Document.balance_amount`/`status` vía `PersistBalanceAndStatus`) y en el backfill de arranque (`database.BackfillPaymentAllocations`, desde `Payment.DocumentID` legacy).
- **`Payment.Type`**: `applied` si tiene ≥1 allocation (o `DocumentID` legacy); `on_account` si no tiene ninguna. Se fija en creación (`ApplyPaymentTx` siempre `applied`; `on_account` explícito en las 2 ramas correspondientes) o se re-deriva en `PaymentService.Update`.
- **`Payment.Purpose`** (Fase 2.1/2.2): `deuda` \| `servicio` \| `NULL`. Nunca se fija todavía en la creación (eso es Fase 2.6) — hoy solo lo puebla el backfill histórico.
- **`PaymentService.Update`**: **rechaza explícitamente** cualquier pago que tenga `DocumentID != nil`, `Type == applied`, o `allocCount > 0` (línea: `"no se puede editar un pago aplicado o con imputaciones; elimínelo y regístrelo de nuevo"`). Es decir, **solo puede operar sobre un pago `on_account` totalmente virgen**, y aun así solo permite fijar un único `DocumentID` legacy — nunca crea `PaymentAllocation`. **Esta es exactamente la función que la instrucción prohíbe reutilizar**, y por buena razón: su propio diseño la hace estructuralmente incapaz de resolver Fase 2.4 sin reescribirla por completo.
- **`DeletePaymentTx`/`RevertPaymentAllocationsTx`**: revierten allocations y recalculan saldo correctamente; `RevertPaymentAllocationsTx` no tiene ningún llamador activo hoy (código reservado/legacy).
- **Endpoints existentes** (`routes.go:108-115`): `GET/POST/PUT/DELETE /payments`, y el patrón de sub-acción ya establecido `POST /payments/:id/issue-comprobante`. No existe ningún endpoint de "aplicar/asignar".
- **Permisos** (`rbac/codes.go:43-48`): `payments.view`, `payments.create`, `payments.update`, `payments.delete`, `payments.issue_comprobante`, `payments.upload_attachment`. No existe un permiso dedicado a "aplicar".

## 2. Problema

Hoy, un `Payment` `on_account` (con o sin remanente tras Fase 2.3) **no tiene ninguna forma de aplicarse a una o varias deudas después de creado**, salvo borrarlo y recrearlo — lo que destruye identidad, fecha real de cobro, y cualquier comprobante ya vinculado. `Update` no sirve (ver §1). Es exactamente el vacío que Fase 2.4 debe llenar.

---

## 3. Diseño propuesto — firma de `AllocateExisting`

**Capa interna (motor), en `backend/services/debt/payment_apply.go`, junto a `ApplyPaymentTx`:**

```go
// AllocateExistingInput datos para aplicar dinero ya recibido (Payment existente) a una o varias deudas.
type AllocateExistingInput struct {
    PaymentID uint
    CompanyID uint // debe coincidir con Payment.CompanyID — misma verificación que ApplyPaymentTx
    Lines     []PaymentAllocationLine
}

// AllocateExistingPaymentTx aplica allocations nuevas a un Payment YA EXISTENTE, sin crear un
// Payment nuevo ni modificar amount/date/method/reference/comprobante. Ver Blueprint Fase 2.4.
func (s *Service) AllocateExistingPaymentTx(tx *gorm.DB, in AllocateExistingInput) error
```

**Capa de orquestación, en `backend/services/payment_service.go`, junto a `CreateFromParams`:**

```go
// AllocateExisting aplica dinero disponible de un Payment ya existente a una o varias deudas.
func (s *PaymentService) AllocateExisting(paymentID, companyID uint, lines []PaymentAllocationInput) error
```

**¿Manual, FIFO, o ambas?** Recomendación: **solo allocations explícitas** (`Lines []PaymentAllocationLine`), igual que el modo `manual` de `CreateFromParams` — no reintroducir FIFO aquí. Justificación: el escenario de negocio de esta operación (Fase 3 §6-7 del blueprint) es que alguien **decide activamente** a qué deuda(s) aplicar dinero que ya está esperando — es una decisión explícita del usuario, no una regla automática. FIFO sí tendría sentido como una opción de UI más adelante, pero como diseño de la función interna, exigir `document_id`+`amount` explícitos es más seguro y más fácil de auditar (evita que un cambio en qué deudas existen en ese momento decida silenciosamente dónde va el dinero).

---

## 4. Validaciones necesarias

En orden, reutilizando exactamente la infraestructura de `ValidatePaymentAmountsAndAllocations`/`ValidateAllocationsTx` (no se reinventa nada):

1. `Payment` existe, no está soft-eliminado (`deleted_at IS NULL`).
2. `Payment.CompanyID == in.CompanyID` (misma verificación de pertenencia que ya hace `ApplyPaymentTx`).
3. **`Payment.Purpose == "deuda"`** — cualquier otro valor (`servicio`, `NULL`) rechaza la operación completa (ver §9-10).
4. **Estado B legacy** (ver §12): si `Payment.DocumentID != nil` y `SUM(PaymentAllocation existentes) == 0`, rechazar — el remanente no puede calcularse con seguridad todavía.
5. Calcular `available := Payment.amount - SUM(PaymentAllocation.amount existentes)`.
6. `SUM(in.Lines[].Amount) <= available + MoneyEpsilon` — si excede, rechazar la operación **completa**, sin aplicar ninguna línea parcialmente.
7. Reutilizar `ValidateAllocationsTx` tal cual (sin ninguna modificación) para cada línea nueva: documento existe, pertenece a la empresa, no anulado, `line.Amount <= saldo efectivo del documento`, sin documentos repetidos entre sí.
8. Todo dentro de una única transacción (ver §15).

---

## 5. `Payment.Purpose`

**Confirmado: `purpose != "deuda"` → `AllocateExisting` debe rechazarse por completo.** Un pago `purpose=servicio` es, por definición (Fase 2.1/2.2), un ingreso que **nunca** tuvo como finalidad pagar una deuda — permitir aplicarlo después contradiría exactamente la razón de ser de ese campo.

**No encontré ninguna excepción real en el código histórico** que justifique relajar esto: la clasificación `servicio` solo se asigna hoy (backfill) cuando hay un comprobante POS vinculado y CERO allocations/DocumentID — es decir, nunca hubo intención de deuda para esos pagos específicos.

## 6. `Payment.Purpose = NULL`

**Se valida y se mantiene la propuesta inicial: `NULL` → rechazar, exigir clasificación previa.**

Justificación contra los datos reales: por diseño del backfill de Fase 2.2, cualquier pago que hoy tenga evidencia de deuda (allocation o `DocumentID` legacy) **ya quedó clasificado como `deuda`** — así que un `Payment` con `Purpose=NULL` es, por construcción, uno de los casos genuinamente ambiguos (sin ninguna señal usable). Tratarlo como `deuda` por defecto violaría el principio rector de todas las fases anteriores ("nunca adivinar"); tratarlo como `servicio` sería igual de arbitrario. La única opción consistente es bloquear y exigir que alguien lo clasifique explícitamente primero — mecanismo que pertenece a Fase 2.6 (fijar `Purpose` explícitamente), no a esta fase.

---

## 7. `Payment.Type`

Verificado en el código real: `Type` se deriva puramente de "¿tiene aplicación?" (allocation o `DocumentID`). Diseño para `AllocateExisting`:

- Si antes de la operación `Type == "on_account"` (0 allocations) y la operación agrega ≥1 allocation nueva → **al final de la misma transacción**, `UPDATE payments SET type='applied' WHERE id=?` (escritura directa, no vía `PaymentService.Update`).
- Si `Type` ya era `"applied"` (tenía allocations previas) → no se toca, permanece `applied`.
- **Nunca** se revierte `applied → on_account` por ningún motivo dentro de esta operación (ni siquiera si, hipotéticamente, el remanente resultante fuera igual al monto total — eso no debería ocurrir nunca porque solo se agregan allocations, jamás se quitan).

## 8. `Document.balance_amount` / `status`

**Reutilizar `debt.PersistBalanceAndStatus(tx, documentID)` sin ninguna fórmula nueva** — exactamente como ya hace `ApplyPaymentTx` por cada línea. Se llama una vez por cada documento distinto tocado por las nuevas allocations, dentro de la misma transacción.

---

## 9. `Payment.DocumentID` legacy — los 5 estados

| Estado | Descripción | Qué debe hacer `AllocateExisting` |
|---|---|---|
| A | `DocumentID=NULL`, `Allocations=0` | Caso normal objetivo de esta fase — calcular `available=Payment.amount`, permitir |
| B | `DocumentID=X`, `Allocations=0` | **Peligroso** — el legacy backfill de arranque (`database.BackfillPaymentAllocations`, corre en cada reinicio) todavía no convirtió este vínculo en `PaymentAllocation`. Si se calcula `available` solo desde `SUM(allocations)=0`, se vería el monto COMPLETO como disponible, aunque en realidad ya está comprometido con el documento `X` legacy — riesgo real de duplicar la aplicación de ese dinero. **Diseño: rechazar explícitamente** con un mensaje claro ("este pago tiene un vínculo legacy pendiente de sincronizar; reinicie el backend o espere al próximo arranque") |
| C | `DocumentID=X`, `Allocations` ya reflejan ese vínculo (backfill ya corrió) | `SUM(allocations)` ya es la fuente de verdad correcta; `DocumentID` queda como puntero vestigial, se **ignora** para el cálculo — permitir normalmente |
| D | `DocumentID=NULL`, `Allocations>0` | Caso normal de Fase 2.3 (sobrepago con remanente) — permitir normalmente |
| E | `DocumentID=X`, `Allocations>0` | Igual que C — `DocumentID` vestigial, se ignora, permitir normalmente |

## 10. ¿Qué hacer con `Payment.DocumentID`?

**Recomendación explícita: leerlo solo para detectar el Estado B (bloquear), nunca escribirlo, nunca migrarlo/normalizarlo en esta fase.** Migrar el vínculo legacy a una `PaymentAllocation` explícita durante `AllocateExisting` sería tentador pero **se sale del alcance** (la instrucción original de Fase 2.3 ya prohibió tocar `DocumentID`, y esta fase hereda esa restricción salvo indicación explícita en contrario). La normalización completa de `DocumentID` queda como candidata natural para cuando `AllocateExisting` ya esté implementado y estable (mencionado en la auditoría de Fase 2 original como dependencia de esta misma función).

---

## 11. Comprobantes

Verificado: `TukifacFiscalReceipt.LinkedPaymentID` se valida contra `Payment.amount` completo (`LinkReceiptToPayment`: `math.Abs(pay.Amount-rec.Total) > 0.02`), **nunca contra el monto aplicado**. Como `AllocateExisting` **nunca modifica `Payment.amount`**, no existe ningún escenario en que agregar allocations invalide un comprobante ya vinculado. **Diseño: `AllocateExisting` no debe leer ni escribir `TukifacFiscalReceipt` en absoluto** — ninguna fila de esa tabla debe verse afectada, y esto debe quedar como aserción explícita en los tests (§14, tests 12).

---

## 12. Transaccionalidad

```
BEGIN TX
  1. SELECT Payment (validar existe, no eliminado, CompanyID coincide)
  2. Validar Purpose == "deuda" (si no, ROLLBACK con error)
  3. Detectar Estado B legacy (si aplica, ROLLBACK con error)
  4. Calcular available = Payment.amount - SUM(PaymentAllocation activas)
  5. Validar SUM(nuevas líneas) <= available
  6. Para cada línea: ValidateAllocationsTx (documento existe, empresa, no anulado, no excede saldo, sin duplicados)
  7. INSERT cada PaymentAllocation nueva
  8. Por cada documento afectado: PersistBalanceAndStatus
  9. Si Type era on_account: UPDATE payments SET type='applied'
COMMIT
```

Vive **dentro de una única `tx *gorm.DB` pasada por el llamador** (`AllocateExistingPaymentTx(tx, ...)`), exactamente como `ApplyPaymentTx` — la orquestación en `PaymentService.AllocateExisting` la envuelve en `database.DB.Transaction(...)`, igual patrón que `CreateFromParams`. Si cualquier paso falla, rollback completo — ninguna allocation queda a medias.

**⚠️ Esta operación necesitará locking (`SELECT ... FOR UPDATE`) antes de considerarse segura en producción — explícitamente fuera de esta fase, ver §13.**

## 13. Locking — PENDIENTE FASE 2.5

No se implementa aquí. El diseño de Fase 2.5 deberá agregar `tx.Clauses(clause.Locking{Strength:"UPDATE"})` sobre la fila `Payment` (al leerla en el paso 1, para fijar `available` de forma segura) y sobre cada `Document` tocado (mismo patrón que ya usa el proyecto en `fiscal_document_series_service.go`/`activity_template_service.go`).

## 14. Concurrencia — riesgo reconocido explícitamente, no corregido aquí

Escenario exacto de la instrucción: `Payment=1000, Applied=700, Available=300`. Requests A y B llegan casi simultáneos, cada uno pide aplicar 300. Sin locking, ambos pueden leer `available=300` **antes** de que el otro confirme su `INSERT`, ambos pasan la validación `300<=300`, ambos insertan → **600 aplicado sobre un disponible real de 300**, violando la Invariante 2 (`SUM(allocations) <= Payment.amount`). Es el mismo patrón de riesgo ya documentado para `ApplyPaymentTx` en la auditoría de Fase 2 — `AllocateExisting` hereda exactamente el mismo problema, sin agravarlo ni resolverlo. Queda explícitamente para Fase 2.5.

## 15. Idempotencia

Si el frontend envía la misma petición `AllocateExisting(Payment=123, Document=10, Amount=300)` dos veces (doble clic, reintento de red):

- **Riesgo real**: sin ninguna clave de idempotencia, la segunda petición se procesaría como una operación nueva e independiente — si todavía queda `available >= 300` en ese momento (porque la primera ya se aplicó y consumió exactamente 300, dejando 0 disponible), la segunda **debería** fallar naturalmente por el propio chequeo de `available` (paso 5) — así que el caso "doble clic secuencial, sin concurrencia real" **ya queda parcialmente protegido** por la propia validación de remanente, sin necesidad de una idempotency key.
- El riesgo real de duplicación solo aparece **combinado con la falta de locking** (§14): si ambas peticiones llegan lo bastante rápido como para leer el mismo `available` antes de que la primera confirme, ninguna де las dos detecta a la otra.
- **Una unique constraint** sobre `(payment_id, document_id)` en `payment_allocations` ayudaría a nivel de base de datos (evitaría dos filas idénticas para el mismo par), pero no es hoy una regla de negocio del sistema (una persona podría legítimamente querer dos abonos separados al mismo documento desde el mismo pago, aunque hoy `ValidateAllocationsTx` ya rechaza documentos repetidos **dentro de una misma llamada** — el riesgo es entre llamadas distintas).
- **Recomendación**: no resolverlo aquí. Fase 2.5 (locking) resuelve el caso de concurrencia real; una idempotency key explícita (header o token de operación) queda como candidata para Fase 2.8 (tests/hardening) si se decide que hace falta más allá del locking.

## 16. Reversiones — compatibilidad verificada

`DeletePaymentTx` y `RevertPaymentAllocationsTx` operan sobre **todas** las `PaymentAllocation` de un `payment_id`, sin importar en qué momento se crearon (creación inicial vía `ApplyPaymentTx`, o después vía `AllocateExisting`) — ambas son filas idénticas en la misma tabla, no hay estructura nueva que introducir. **Confirmado: `AllocateExisting` no introduce ninguna incompatibilidad** — si mañana se elimina/anula un `Payment` de 1000 con allocaciones 500+200 (300 de ellas agregadas después vía `AllocateExisting`), `DeletePaymentTx` las revertiría todas igual, recalculando el saldo de ambos documentos correctamente. No se modificó esa lógica, solo se verificó su compatibilidad.

---

## 17. Endpoint / API

**Método y ruta**: `POST /payments/:id/allocate` — sigue la convención **verbo-acción** ya establecida en el propio código (`/payments/:id/issue-comprobante`, `/tax-settlements/:id/close`, `/tax-settlements/:id/emit`), no un patrón RESTful de sub-recurso plural.

**Payload** (reutiliza exactamente la forma ya usada por `CreateFromParams`):
```json
{
  "allocations": [
    { "document_id": 10, "amount": 200 },
    { "document_id": 20, "amount": 100 }
  ]
}
```

**Respuesta**: el `Payment` completo actualizado (mismo shape que `GetByID`/`CreateAPI`), para que el frontend refresque su estado sin una segunda petición — mismo patrón que `IssueComprobanteAPI` devuelve `{"receipt": rec}`.

**Errores**: `400` para cualquier validación de negocio (mismo estilo `{"error": "..."}` que el resto del controller); `403`/`404` para acceso/pertenencia, igual que los demás endpoints de `PaymentController`.

**Autorización**: validar `CanAccessCompany` igual que `CreateAPI`/`UpdateAPI` (mismo patrón `hasStudioScope`/`getUserID`/`accessService.CanAccessCompany`).

**No debe implementarse como parte de `PaymentController.UpdateAPI`** — debe ser un método nuevo del controlador (`AllocateExistingAPI`), montado en su propia ruta, exactamente como `IssueComprobanteAPI` es distinto de `UpdateAPI`.

## 18. Permiso

**Recomendación**: reutilizar `rbac.PaymentsUpdate` (`"payments.update"`) — es el más cercano semánticamente ("modificar el estado de un pago existente") entre los ya existentes, y los roles que hoy tienen `PaymentsUpdate` (ej. Asistente) son plausiblemente los mismos que deberían poder decidir a qué deuda aplicar un pago a cuenta. **Esto es una recomendación, no una decisión unilateral** — asignar permisos es una decisión de política que debe confirmarse antes de implementar; no se creó ningún permiso nuevo, tal como se instruyó.

---

## 19. Matriz de comportamiento

| Purpose | Type | Allocations | Remainder | AllocateExisting | Motivo |
|---|---|---|---|---|---|
| deuda | on_account | 0 | >0 | **PERMITIR** | Caso objetivo central de esta fase |
| deuda | applied | parcial | >0 | **PERMITIR** | Sobrepago de Fase 2.3 con remanente aún disponible |
| deuda | applied | completo | 0 | **RECHAZAR** | `available=0`, nada que aplicar (paso 5 de validación) |
| servicio | on_account | 0 | >0 | **RECHAZAR** | `purpose != deuda` — ingreso independiente, nunca se aplica a deuda |
| NULL | on_account | 0 | >0 | **REQUIERE CLASIFICACIÓN** | Sin evidencia suficiente para saber si es deuda o servicio — bloquear hasta que Fase 2.6 permita clasificarlo |
| deuda | applied | 0 | >0 | **DEPENDE — ver Estado B (§9)** | Solo puede darse vía `DocumentID` legacy sin `PaymentAllocation` (el único camino que fija `Type=applied` sin crear allocations es `PaymentService.Update`) — si `DocumentID != nil`, es el Estado B peligroso → **RECHAZAR** hasta que el backfill de arranque lo sincronice |

---

## 20. Respuestas a las 13 preguntas del criterio de éxito

1. **Firma**: `debt.AllocateExistingPaymentTx(tx, AllocateExistingInput{PaymentID, CompanyID, Lines})` + wrapper `PaymentService.AllocateExisting(paymentID, companyID, lines)`.
2. **Dónde vive**: motor en `services/debt/payment_apply.go` (junto a `ApplyPaymentTx`); orquestación en `services/payment_service.go` (junto a `CreateFromParams`); controlador nuevo método en `PaymentController`.
3. **Remainder**: `Payment.amount - SUM(PaymentAllocation.amount activas)`, calculado en cada invocación, nunca persistido.
4. **Qué Payments puede modificar**: solo `purpose=deuda`, no eliminados, de la empresa del solicitante, y que no estén en el Estado B legacy sin sincronizar.
5. **¿Permite `purpose=servicio`?** No, rechazo explícito.
6. **¿Qué hacemos con `purpose=NULL`?** Rechazar, exigir clasificación previa (Fase 2.6).
7. **¿Qué hacemos con `Payment.DocumentID`?** Solo lectura defensiva para detectar el Estado B; nunca se escribe ni se migra en esta fase.
8. **¿Cómo cambia `Payment.Type`?** `on_account → applied` en la misma transacción si es la primera allocation; nunca al revés.
9. **¿Cómo se recalcula `Document.balance_amount`?** Reutilizando `debt.PersistBalanceAndStatus`, sin fórmulas nuevas.
10. **¿Cómo evitaremos doble aplicación?** No se evita en esta fase — reconocido explícitamente, resuelto en Fase 2.5 (locking).
11. **¿Qué parte pertenece a Fase 2.5?** El `SELECT ... FOR UPDATE` sobre `Payment` y sobre cada `Document` tocado.
12. **¿Qué endpoint?** `POST /payments/:id/allocate`, payload `{"allocations":[{document_id,amount}]}`, respuesta = `Payment` completo.
13. **¿Qué permiso?** Recomendado `payments.update` (`rbac.PaymentsUpdate`) — a confirmar antes de implementar.

---

## 21. Tests que deberían implementarse (23, mapeados a la instrucción)

1-4: aplicar parcial/completo desde on_account, aplicar remainder de un parcial, aplicar a múltiples documentos — motor (`debt` package).
5-7: rechazar sin remainder, rechazar allocation>remainder, rechazar allocation>saldo del Document.
8: `purpose=servicio` → rechazar.
9: `purpose=NULL` → rechazar (comportamiento definido, no simplemente "sin cubrir").
10: Payment con `DocumentID` legacy — separar explícitamente Estado B (rechazar) de Estado C/E (permitir, `DocumentID` ignorado).
11: Payment con allocations existentes (Estado D) → remainder correcto, se agregan más.
12: Payment con `TukifacFiscalReceipt` vinculado → verificar que la tabla de comprobantes queda completamente intacta (ni se lee su monto para nada, ni se modifica).
13: `Payment.amount` permanece intacto tras la operación.
14: `Type` cambia `on_account→applied` solo cuando corresponde (primera allocation), permanece `applied` si ya lo era.
15-16: `Document.balance_amount`/`status` recalculados correctamente (parcial y completo).
17: rollback completo si una línea de la lista falla (ninguna allocation debe persistir).
18: `CompanyID` no coincide → rechazar.
19: Documento anulado → rechazar.
20: Documento repetido en la misma llamada → rechazar (ya lo hace `ValidateAllocationsTx`, verificar que sigue aplicando aquí).
21: `PaymentID` inexistente → rechazar.
22: `Payment` eliminado (soft-delete) → rechazar.
23: `Payment` de otra empresa → rechazar.

---

## 22. Dependencias que deben existir antes de implementar

- **Ninguna dependencia bloqueante de otras fases** — `AllocateExisting` puede implementarse hoy mismo reutilizando exclusivamente infraestructura ya existente (`ValidateAllocationsTx`, `PersistBalanceAndStatus`, el patrón transaccional de `ApplyPaymentTx`).
- **Recomendación de secuencia, no dependencia dura**: sería prudente implementar Fase 2.5 (locking) inmediatamente después, antes de exponer `AllocateExisting` a tráfico real de producción con volumen — el riesgo de concurrencia (§14) es real aunque de baja probabilidad práctica hoy (bajo volumen de pagos simultáneos sobre el mismo `Payment`).
- **Fase 2.6** (fijar `Purpose` en creación) no bloquea Fase 2.4, pero sí determina cuántos pagos NUEVOS quedarán elegibles para `AllocateExisting` desde el día uno (hoy, sin Fase 2.6, todo pago nuevo `on_account` nace con `Purpose=NULL` y por lo tanto quedaría bloqueado por la regla de §6 hasta que algo lo clasifique).

---

## FASE 2.4 — DISEÑO COMPLETADO

```
Código modificado: NO
Migraciones: NO
Endpoints: NO
UI: NO
Commit: NO

Estado actual:
No existe forma de aplicar un Payment existente a una deuda sin borrarlo y
recrearlo. PaymentService.Update rechaza estructuralmente cualquier pago con
DocumentID, Type=applied o allocations — no es reutilizable.

Diseño AllocateExisting:
debt.AllocateExistingPaymentTx(tx, {PaymentID, CompanyID, Lines}) + wrapper
PaymentService.AllocateExisting — solo allocations explícitas (sin FIFO),
reutiliza ValidateAllocationsTx/PersistBalanceAndStatus sin fórmulas nuevas.

Payment.Purpose:
purpose=deuda -> permitir. purpose=servicio -> rechazar (ingreso independiente,
nunca se aplica a deuda). purpose=NULL -> rechazar, exigir clasificación previa
(Fase 2.6) — nunca se adivina.

Payment.Type:
on_account -> applied en la misma transacción si es la primera allocation
agregada; nunca se revierte applied -> on_account.

Payment.DocumentID:
Solo lectura defensiva. Detecta "Estado B" (DocumentID set, 0 allocations —
legacy sin sincronizar por el backfill de arranque) y lo bloquea explícitamente
para evitar duplicar la aplicación de ese dinero. Nunca se escribe ni se migra
en esta fase.

Comprobantes:
TukifacFiscalReceipt queda completamente fuera de esta operación — no se lee
ni se escribe. Payment.amount nunca cambia, así que ningún comprobante ya
vinculado puede quedar inconsistente.

Locking:
PENDIENTE FASE 2.5 (SELECT ... FOR UPDATE sobre Payment y cada Document
afectado) — riesgo de doble aplicación concurrente reconocido y documentado
explícitamente (§14), no corregido en este diseño.

Idempotencia:
Parcialmente mitigada por la propia validación de remanente (una segunda
petición secuencial idéntica fallaría sola si la primera ya consumió el
disponible); el riesgo real solo aparece combinado con la falta de locking.
Sin idempotency key en esta fase — candidata para Fase 2.5/2.8.

Tests propuestos: 23 (ver §21), cubriendo motor y casos de negocio completos.

Dependencias: ninguna bloqueante; se recomienda Fase 2.5 inmediatamente
después por el riesgo de concurrencia, y se nota que sin Fase 2.6 los pagos
nuevos nacerán con Purpose=NULL y quedarán bloqueados hasta clasificarse.

Riesgos:
(1) Concurrencia sin locking (documentado, no corregido — Fase 2.5).
(2) Estado B legacy mal manejado podría duplicar aplicación de dinero si no
    se implementa el chequeo defensivo exactamente como se diseñó aquí.
(3) Sin Fase 2.6, la utilidad práctica de AllocateExisting queda limitada a
    pagos históricos ya clasificados como "deuda" por el backfill — los pagos
    nuevos on_account no tendrán Purpose hasta que exista Fase 2.6.

Recomendación:
IMPLEMENTAR

Siguiente paso:
Implementar Fase 2.4 exactamente según este diseño (motor + wrapper +
endpoint + permiso payments.update a confirmar), con los 23 tests
propuestos, dejando explícitamente documentado en el código (igual que se
hizo en Fase 2.3) que el locking queda pendiente de Fase 2.5.
```
