# Implementación Fase 2.5 — Locking / Concurrencia

Fecha: 2026-09-14
Estado: **implementado, probado contra MySQL real, pendiente de revisión y commit del usuario**
Diseño aprobado: [docs/diseno-fase2-5-locking-concurrencia-2026-09-14.md](diseno-fase2-5-locking-concurrencia-2026-09-14.md)
Commit base: `df6f0b2` (Fase 2.4)

## 1. Qué resuelve

Cierra las 4 condiciones de carrera identificadas en el diseño de Fase 2.5:

1. Dos `AllocateExisting` concurrentes sobre el mismo `Payment` (podían sumar más que `Payment.amount`).
2. Dos `Payment`s diferentes aplicando sobre el mismo `Document` (podían sumar más que `Document.total_amount`).
3. `AllocateExisting` concurrente con `DeletePaymentTx` (podía dejar allocations huérfanas o dinero aplicado sin rastro).
4. `ApplyPaymentTx` concurrente con `AllocateExisting` sobre el mismo `Document` (misma carrera que 2, distinto origen).

## 2. Archivos modificados (126 inserciones, 32 eliminaciones, 3 archivos — todo dentro del alcance autorizado)

| Archivo | Cambio |
|---|---|
| [backend/services/debt/payment_apply.go](../backend/services/debt/payment_apply.go) | Nuevo `Service.LockDocumentsForUpdateAsc`; `ValidateAllocationsTx` bloquea Documents ASC antes de validar saldo; `AllocateExistingPaymentTx` bloquea el `Payment` al leerlo |
| [backend/services/payment_service.go](../backend/services/payment_service.go) | `DeletePaymentTx` bloquea el `Payment` al leerlo y los `Document`s afectados (ASC) antes de borrar sus allocations |
| [backend/services/document_service.go](../backend/services/document_service.go) | `DocumentService.Delete` ahora corre dentro de una transacción y bloquea el `Document` antes de verificar su historial financiero |

Más el test de concurrencia real ([backend/services/debt/allocate_existing_concurrency_test.go](../backend/services/debt/allocate_existing_concurrency_test.go)) y este documento.

## 3. Estrategia de locking (idéntica al diseño aprobado)

`clause.Locking{Strength: "UPDATE"}` (mismo mecanismo ya usado en `fiscal_document_series_service.go`/`activity_template_service.go`), dentro de las transacciones GORM existentes. Sin Redis, sin locks optativos, sin columnas de versión.

**Orden obligatorio, aplicado igual en las 3 operaciones**: `Payment` primero (si existe), luego `Document`s ordenados ascendentemente por ID — implementado en el helper compartido `Service.LockDocumentsForUpdateAsc(tx, documentIDs) (map[uint]models.Document, error)` (`services/debt/payment_apply.go`), usado tanto por `ValidateAllocationsTx` (mismo paquete) como por `PaymentService.DeletePaymentTx` (paquete `services`, vía `debtsvc.NewService()`) — una sola implementación, sin duplicar la lógica de orden+lock.

- **`AllocateExistingPaymentTx`**: `tx.Clauses(clause.Locking{...}).First(&pay, ...)` reemplaza el `tx.First` original; el resto del flujo (validar existencia/soft-delete/CompanyID/Purpose, calcular `available`, validar líneas, crear allocations, recalcular balances) no cambia de orden — ya ocurría después de leer el `Payment`. El lock de los `Document`s ocurre dentro de `ValidateAllocationsTx`, compartida con `ApplyPaymentTx`.
- **`ApplyPaymentTx`**: no requiere ningún cambio propio — hereda el lock de `Document`s automáticamente porque ya llama a `ValidateAllocationsTx` (vía `ValidatePaymentAmountsAndAllocations`) antes de crear el `Payment`/las allocations. No hay `Payment` previo que bloquear (se crea en la misma función).
- **`DeletePaymentTx`**: bloquea el `Payment` al leerlo, luego bloquea (vía `LockDocumentsForUpdateAsc`) los `Document`s recolectados de las allocations existentes + el `DocumentID` legacy, **antes** de borrar las allocations — mismo orden que las otras dos operaciones.
- **`DocumentService.Delete`**: no tenía transacción; se envolvió en `database.DB.Transaction(...)` y el `Document` se bloquea antes de `DocumentFinancialOrSettlementHistory`.

## 4. Hallazgo real durante la verificación con MySQL — y la corrección aplicada

Los tests A, B y D pasaron a la primera contra MySQL real. El **Test C** (Payments distintos, mismo Document) falló inicialmente: ambas operaciones concurrentes tenían éxito cuando debía fallar una.

**Causa raíz** (confirmada con instrumentación temporal, ya revertida — no quedó en el código): el lock del `Document` funcionaba correctamente — la segunda transacción esperaba y, al desbloquearse, `LockDocumentsForUpdateAsc` leía el `Document.BalanceAmount` ya actualizado por la primera transacción. Pero `ValidateAllocationsTx` no usaba ese valor directamente: llamaba a `EffectiveBalance`, que internamente ejecuta una segunda consulta (`PaidTotal`, un `SUM` plano sin lock) para autocorregir balances legacy inconsistentes. Esa segunda consulta queda sujeta al *snapshot* `REPEATABLE READ` de MySQL y, en la transacción que esperó, seguía viendo el estado anterior al commit de la otra. La lógica de autocorrección de `EffectiveBalance` (*"si el balance persistido difiere del recalculado en más de 0.02, confía en el recalculado"*) terminaba **descartando el valor fresco y ya bloqueado, y usando el obsoleto**.

**Corrección aplicada** (autorizada explícitamente por el usuario tras reportar el hallazgo, sin avanzar por cuenta propia): en `ValidateAllocationsTx`, para la comprobación "excede el saldo", se usa directamente `d.BalanceAmount` — el valor recién leído bajo el `FOR UPDATE` de `LockDocumentsForUpdateAsc` — en lugar de `EffectiveBalance`. `EffectiveBalance`/`PaidTotal` **no se modificaron** y siguen siendo la fórmula usada en el resto del código (p. ej. `DocumentOpenBalance`, la validación de descuento en `ValidatePaymentAmountsAndAllocations`, reportes). El cambio es de un solo archivo (`payment_apply.go`), una sola línea funcional (`bal := d.BalanceAmount` en vez de `bal := s.EffectiveBalance(tx, &d)`), sin tocar `balance.go`, sin cambiar el nivel de aislamiento de MySQL, sin ningún mecanismo nuevo.

Tras la corrección, los 4 tests pasaron consistentemente en **8 repeticiones** (`-count=8`, 32/32 PASS) contra MySQL real.

## 5. Riesgo residual documentado (no bloqueante, no corregido en esta fase)

Usar `d.BalanceAmount` directamente en vez de `EffectiveBalance` significa que, dentro de esta validación puntual, se pierde la autocorrección que `EffectiveBalance` aplicaría si un `Document` legacy tuviera `balance_amount` desincronizado de la realidad (dato corrupto de una migración antigua). En la práctica esto no es un problema nuevo: `PersistBalanceAndStatus` (que sí sigue ejecutándose sin cambios después de crear cada allocation) recalcula y persiste el balance correcto en cada operación, por lo que cualquier documento que pase por `AllocateExisting`/`ApplyPayment` queda con `balance_amount` sincronizado inmediatamente después. El riesgo solo aplicaría a un `Document` cuyo `balance_amount` ya estuviera corrupto **antes** de la primera vez que se le aplica dinero por esta vía — un caso de datos legacy preexistente, no introducido por este cambio, y fuera del alcance de Fase 2.5 (que es exclusivamente locking/concurrencia, no limpieza de datos legacy).

## 6. Tests de concurrencia real (MySQL)

Archivo: [backend/services/debt/allocate_existing_concurrency_test.go](../backend/services/debt/allocate_existing_concurrency_test.go), con build tag `mysql_integration` — invisible y no exigido por `go test ./...` normal (verificado: `go test ./services/debt/... -list '.*Concurrent.*'` no lista nada sin el tag).

**Por qué no se usa SQLite como evidencia**: el driver `github.com/glebarez/sqlite` descarta `clause.Locking` en su propio código fuente (`sqlite.go:115-119`, *"SQLite3 does not support row-level locking"*) — confirmado leyendo el código del driver, no es una suposición.

**Cómo ejecutarlos** (instrucciones también en la cabecera del archivo):

```bash
docker run --rm -e MYSQL_ROOT_PASSWORD=test -e MYSQL_DATABASE=zcontable_test \
  -p 3307:3306 -d --name zcontable-mysql-test mysql:8

MYSQL_TEST_DSN="root:test@tcp(127.0.0.1:3307)/zcontable_test?charset=utf8mb4&parseTime=True&loc=Local" \
  go test -tags=mysql_integration -count=1 -v ./services/debt/... -run Concurrent

docker stop zcontable-mysql-test   # --rm ya lo elimina al detenerse
```

Sin `MYSQL_TEST_DSN`, cada test hace `t.Skip()` — nunca fallan por falta de MySQL.

**En esta sesión** se ejecutaron realmente contra un MySQL 8.0.30 local (XAMPP, ya en ejecución en la máquina de desarrollo, no Docker) usando una base de datos desechable creada y eliminada exclusivamente para esta verificación (`zcontable_fase25_test`) — no se tocó ninguna base existente. No se conectó a producción ni al VPS en ningún momento.

| Test | Escenario | Resultado |
|---|---|---|
| A | Mismo Payment=1000, 700+600 concurrentes (excede) | PASS — exactamente 1 de 2 exitosa, `SUM<=1000` |
| B | Mismo Payment=1000, 400+500 concurrentes (caben) | PASS — ambas exitosas, `SUM=900`, remanente=100 |
| C | Payments distintos, mismo Document (saldo=500), 400+300 (excede) | PASS — exactamente 1 de 2 exitosa, `SUM<=500`, balance≥0 |
| D | AllocateExisting(600) + DeletePayment concurrentes sobre el mismo Payment | PASS — sin allocation huérfana, sin Payment eliminado con allocation persistente |

Repetido 8 veces (`-count=8`) tras la corrección del §4: **32/32 PASS**.

Nota sobre el seed de datos: los helpers `seedAEDebt`/`seedAEPayment` reutilizados de `allocate_existing_test.go` no fijan `IssueDate`/`Date`, lo cual SQLite acepta (zero-value) pero MySQL en modo estricto rechaza (`Error 1292: Incorrect datetime value '0000-00-00'`). Se agregaron variantes locales `seedConcDebt`/`seedConcPayment` **dentro del propio archivo de concurrencia** (no se tocó `allocate_existing_test.go`, que sigue funcionando igual contra SQLite) que sí fijan una fecha válida.

## 7. Regresión

```
go build ./...                                    → OK
go vet ./...                                       → limpio (único warning preexistente y no
                                                      relacionado en cmd/debt-audit/main.go)
go test ./services/... ./database/... -count=1    → ok (184 PASS, 0 FAIL) — mismo total que antes
                                                      de Fase 2.5, cero regresiones
```

Re-verificación por fase (subconjuntos del total anterior):
- Fase 1 (`Origin`/`DeleteGuard`): 11 PASS
- Fase 2.1/2.2 (`PaymentPurpose`/`PaymentMigration`): 13 PASS
- Fase 2.3 (`Remainder`, incluye solapamiento con nombres de Fase 2.4): 11 PASS
- Fase 2.3 orquestación (`Overpayment`): 18 PASS
- Fase 2.4 (`TestAllocateExisting`, sqlite): 22 PASS
- Fase 2.5 (`Concurrent`, MySQL real, build tag aparte): 4/4 PASS × 8 repeticiones = 32/32

`gofmt -l` sobre los 4 archivos tocados: limpio.

## 8. Alcance respetado

No se modificó: `Purpose`, `Type`, `PaymentAllocation` (modelo), el endpoint `POST /payments/:id/allocate`, ninguna fórmula financiera (`EffectiveBalance`/`PaidTotal`/`PersistBalanceAndStatus` permanecen intactas), `OriginSettlementID`, lógica de carry-forward, ni código de Fases 1/2.1/2.2/2.3. `RevertPaymentAllocationsTx` (código muerto, sin llamadores) y `consolidation.go` no se tocaron, según lo indicado. No se agregó ningún `UNIQUE` constraint. `PaymentService.Update` no se modificó (riesgo residual menor ya documentado en el diseño, no bloqueante).

## 9. Limitaciones conocidas

- El riesgo residual de `d.BalanceAmount` vs. autocorrección legacy, documentado en §5.
- `PaymentService.Update` (rama legacy) sigue sin lock — riesgo de ventana muy estrecha ya documentado en el diseño, no bloqueante, no corregido en esta fase por decisión explícita del usuario.
- Los tests de concurrencia real requieren MySQL disponible manualmente (Docker o instalación local) — no forman parte de la suite CI/`go test ./...` estándar por diseño.
