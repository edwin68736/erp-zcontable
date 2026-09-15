# Fase 3 — Auditoría y diseño de cálculos financieros

Fecha: 2026-09-14
Estado: **auditoría + diseño únicamente — sin cambios de código, sin commit**
Fuente principal: [docs/blueprint-financiero-definitivo-2026-09-14.md](blueprint-financiero-definitivo-2026-09-14.md) (§21-23, §26-30) — el usuario referenció `blueprint-financiero-definitivo-2026-09-14(1).md`; ese archivo con sufijo `(1)` no existe en el repositorio (probablemente una copia local/descarga del mismo documento). Se usó el único archivo existente en `docs/`, cuyo contenido coincide con las citas y fórmulas dadas en la instrucción — si el archivo `(1)` tuviera diferencias, deben señalarse antes de aprobar este diseño.
Commits base: `838b990` (Fase 1), `2538097` (2.1/2.2), `9fa3eb9` (2.3), `df6f0b2` (2.4), `894918e` (2.5) — working tree limpio, ninguno pusheado.

---

## ⚠️ Contradicciones encontradas entre el Blueprint y el estado actual (declaradas, no resueltas silenciosamente)

### C1 — Las fórmulas oficiales (§22) asumen `Payment.voided_at`, que NO existe todavía

El Blueprint (§19, §21, §22) define "dinero recibido" y las 3 fórmulas de Payment como `WHERE ... voided_at IS NULL`, y clasifica la creación de `voided_at/voided_by/void_reason` como **Fase 6** (§26-30, "FUNCIONALIDADES FALTANTES"), es decir **posterior** a esta Fase 3. Verificado en el modelo actual (`backend/models/payment.go`): el campo `VoidedAt` **no existe**. El único mecanismo de "anulación" de un `Payment` hoy es el borrado físico vía `DeletePaymentTx` (Fase 2.4/2.5), que es un **soft-delete de GORM** (`Payment.DeletedAt`), excluido automáticamente por el scope por defecto de GORM en cualquier `Find`/`Model`/`First` que no use `.Unscoped()`.

**Resolución propuesta** (a aprobar, no aplicada): las 4 funciones de Fase 3 deben filtrar "activo" usando el mecanismo que **existe hoy** (el scope de soft-delete por defecto de GORM sobre `Payment`/`PaymentAllocation`, sin `.Unscoped()`) en vez de `voided_at IS NULL`. Esto es funcionalmente equivalente al `voided_at IS NULL` del Blueprint *para el estado actual del sistema* (hoy "anulado" = "soft-deleted"). Cuando se implemente Fase 6, la migración consistirá en agregar una condición adicional (`AND voided_at IS NULL`) a las mismas 4 funciones, sin rediseñarlas — se deja documentado como nota de futuro, no bloqueante para Fase 3.

### C2 — `DineroNoAplicado`: la fórmula literal del §22 contradice su propia descripción de negocio

Fórmula literal (§22):
```
DineroNoAplicado(empresa) = SUM(Payment.amount − SUM(sus PaymentAllocation.amount)) WHERE company_id = X AND voided_at IS NULL
```
Esta fórmula **no filtra por `Purpose`** — sumaría el remanente de **todos** los `Payment`, incluyendo los `purpose=servicio`. Pero el propio Blueprint dice inmediatamente antes: *"`DineroNoAplicado` debe representar correctamente el **dinero destinado a deuda** que todavía no ha sido aplicado"* (§22, prosa) y en §15: un pago `servicio` *"nunca se espera que reciba `PaymentAllocation`... es ingreso ya 'cerrado' conceptualmente en el momento en que se recibe."*

Un pago `purpose=servicio` **siempre** tiene 0 allocations por diseño (§15) — bajo la fórmula literal, su monto completo entraría en `DineroNoAplicado` como si fuera "dinero disponible para pagar deudas", lo cual **contradice directamente** la intención de negocio del propio documento (un ingreso de servicio nunca está "pendiente de aplicar a una deuda"; simplemente no es de esa naturaleza).

**Esto NO se resuelve silenciosamente.** Dos opciones, a decidir por el usuario antes de implementar:

| Opción | Definición | A favor | En contra |
|---|---|---|---|
| **A (recomendada)** | `DineroNoAplicado` = solo `Purpose IN ('deuda')` — excluye explícitamente `servicio` | Coincide con la prosa del Blueprint y con el ejemplo de negocio (§22, el mismo que cita esta instrucción) | Los pagos con `Purpose IS NULL` (históricos sin clasificar, ver Fase 2.1/2.2) quedarían fuera de este cálculo — su remanente "desaparecería" de la métrica |
| **A' (variante recomendada)** | `Purpose IN ('deuda') OR Purpose IS NULL` — excluye solo `servicio`, incluye no clasificados | Coincide con la prosa igual que A, y no oculta dinero legítimamente pendiente de clasificar (nunca se "adivina" que es servicio) | Un pago no clasificado que en el fondo IBA a ser un servicio se contaría de más hasta que se clasifique |
| **B (fórmula literal, no recomendada)** | Sin filtro de `Purpose`, tal como está escrito en §22 | Fiel al texto exacto | Reproduce el mismo tipo de mezcla que el Blueprint prohíbe explícitamente para `SaldoDocumentado` (mezclar dinero independiente con dinero de deuda) — riesgo de inflar la métrica con dinero que nunca fue para deuda |

Recomiendo **A'** por consistencia con la regla "nunca se infiere/adivina `Purpose`" (§15, §21): un `NULL` no es una confirmación de `servicio`, así que no debe excluirse como si lo fuera. Pero es una decisión de negocio, no técnica — **queda pendiente de tu aprobación explícita antes de escribir código.**

`DineroAplicadoADeudas` y `DineroTotalRecibido` **no tienen esta ambigüedad**: sus fórmulas literales no necesitan filtro de `Purpose` y son consistentes con su propia prosa (`DineroTotalRecibido` es, por definición, *todo* el dinero recibido, sin importar su propósito; `DineroAplicadoADeudas` ya está acotado por definición a lo que tiene `PaymentAllocation`, que nunca ocurre en pagos `servicio`).

### C3 — `SaldoDocumentado`: la fórmula del §22 no menciona el filtro de documentos legacy fusionados/archivados

La implementación **ya correcta** existente (`ListDocumentReportRows`, usada por "Reporte de deudas", ver §Hallazgos) aplica, además de `status <> 'anulado'`, un segundo filtro independiente: `ScopeActiveDocuments` (excluye `Document.legacy_status IN ('legacy_merged','archived')` — documentos duplicados de una consolidación histórica de datos, ver `services/debt/legacy.go`). El §22 del Blueprint no menciona este filtro. No es una contradicción de negocio (el Blueprint no dice "inclúyelos"), sino un **detalle técnico no cubierto explícitamente** por la fórmula de alto nivel.

**Resolución propuesta**: `SaldoDocumentado` debe incluir también `ScopeActiveDocuments`, replicando exactamente el mismo filtro que ya usa la única implementación actual que es correcta. Omitirlo arriesgaría doble conteo si alguna vez existe un documento clon legacy con `status IN ('pendiente','parcial')` y `balance_amount > 0` remanente de antes de una consolidación.

---

## 1. Estado actual (después de Fase 2.5)

Working tree limpio, 5 commits locales sin pushear. Ningún archivo de Fase 1-2.5 tiene código relacionado con los cálculos agregados de esta fase (confirmado: `payment_apply.go`, `payment_service.go`, `document_service.go`, `settlement.go` no contienen ningún `SUM` de tipo "deuda total" — solo manejan documentos/pagos individuales). Los cálculos agregados por empresa (para Dashboard/Estado de cuenta/Reportes) viven en un conjunto de archivos **separados y nunca tocados** por las fases anteriores: `finance_service.go`, `finance_financial_report.go`, `dashboard_controller.go`, `report_controller.go`.

---

## 2. Hallazgos — implementaciones duplicadas del cálculo de deuda

Se encontraron **6 sitios de código** con la fórmula `SUM(Document.total_amount) − SUM(Payment.amount)` (o su equivalente exacto), repartidos en **4 pantallas/conceptos** — coincide con "las 4 implementaciones que el Blueprint menciona que deben consolidarse", donde una de las 4 pantallas (Reporte financiero) tiene 2 sitios de código duplicados internamente, y el Dashboard tiene 2 variantes (vista estudio / vista alcance limitado):

| # | Pantalla | Archivo:línea | Función | Filtra `status<>anulado` (Document) | Filtra Payment por algo | Filtra `Purpose` |
|---|---|---|---|---|---|---|
| 1 | **Dashboard** (vista estudio) | `controllers/dashboard_controller.go:96-102,262` | `DashboardAPI` (inline) | Sí | Solo por `deleted_at IS NULL` (línea 101, redundante con GORM) | **No** |
| 2 | **Dashboard** (vista alcance limitado) | `controllers/dashboard_controller.go:326-332,488` | función assistant-scoped equivalente (inline) | Sí | No filtra nada explícito (default GORM) | **No** |
| 3 | **Dashboard** — tarjetas de morosos por empresa | `services/finance_service.go:44-68` (`GetCompanyBalance`) | Llamada en bucle desde ambas vistas del Dashboard (líneas 209 y 435 de `dashboard_controller.go`) | Sí | No filtra nada explícito | **No** |
| 4 | **Estado de cuenta** (Company Statement) | `services/finance_service.go:70-148` (`GetCompanyStatement`) | Endpoint `company_controller.go:446` | Sí (excluye "anulado" del subtotal, pero por otra vía — ver abajo) | No filtra nada explícito | **No** |
| 5 | **Reporte financiero** — resumen global | `controllers/report_controller.go:41-51,111` (`FinancialSummaryAPI`, rama sin `include=companies`) | Endpoint `/api/reports/financial-summary` | Sí | No filtra nada explícito | **No** |
| 6 | **Reporte financiero** — filas por empresa | `services/finance_financial_report.go:157-224` (`companyTotalsForReport` + `GetFinancialReportRows`) | Mismo endpoint, con `?include=companies` | Sí | No filtra nada explícito | **No** |

**Reporte de deudas** (`report_controller.go:116-145`, `DebtsReportAPI` → `debtsvc.ListDocumentReportRows`, `services/debt/audit.go:208-260`) es la **única de las 4 pantallas que YA es correcta**: calcula saldo por documento vía `EffectiveBalance` (no resta agregados), y ya aplica `ScopeActiveDocuments`. No reproduce el bug — pero tampoco usa todavía ninguna función compartida oficial (haría falta migrarla a `SaldoDocumentado` por consistencia, no por corrección).

### Hallazgo adicional (menor, no una de las 4 pantallas): gráfico mensual del Dashboard

`dashboard_controller.go:113-129` (y su equivalente ~336-352) calcula `SUM(Payment.amount)` por mes para un gráfico de barras ("pagos por mes") — es una métrica de **flujo** (dinero recibido en el mes), no de saldo/deuda, y no resta nada. No reproduce el bug de "deuda negativa falsa", pero tampoco filtra `Purpose` ni excluye anulados de forma explícita (aunque GORM ya excluye soft-deleted por defecto). Es candidato natural a reusar `DineroTotalRecibido` con rango de fechas en una fase posterior, pero **no es uno de los 4 cálculos a consolidar en esta fase** — se documenta, no se toca.

---

## 3. Cada cálculo incorrecto o peligroso, explicado

**El bug único, repetido 6 veces**: `Balance = SUM(Document.total_amount) − SUM(Payment.amount)`.

Por qué es peligroso (con el ejemplo exacto de esta instrucción y del Blueprint §22):
```
Document.total_amount = 1000 (deuda)
Payment A: amount=300, purpose=servicio, 0 allocations   (venta independiente ya cobrada)
Payment B: amount=1000, purpose=deuda, 1 allocation=1000 (paga la deuda completa)

SUM(Document.total_amount) = 1000
SUM(Payment.amount)        = 300 + 1000 = 1300
Balance (bug)               = 1000 − 1300 = −300   ← FALSO: aparenta que el estudio le debe
                                                        S/300 a la empresa, cuando en realidad
                                                        la deuda está saldada (saldo=0) y los
                                                        300 son un ingreso de servicio no
                                                        relacionado con ninguna deuda.
```
El resultado correcto, con las fórmulas oficiales:
```
SaldoDocumentado      = 0      (el único Document tiene balance_amount=0, status=pagado)
DineroTotalRecibido   = 1300   (300 + 1000, todo el dinero que entró)
DineroAplicadoADeudas = 1000   (solo la allocation de Payment B)
DineroNoAplicado      = 0      (Payment B no tiene remanente; Payment A se excluye si se
                                 adopta la resolución C2/opción A o A' de este documento)
```
Ningún número queda negativo, y el ingreso de servicio no contamina el saldo de deuda — exactamente el criterio de aceptación que pide la instrucción.

**Riesgo adicional no mencionado explícitamente por el Blueprint pero visible en el código**: en `GetCompanyStatement` (implementación #4), el bucle por documento (línea 105-126) **ya calcula correctamente** `paid`/`balance` por documento usando `EffectiveBalance` — pero el campo agregado final `CompanyStatement.Balance` (línea 145) **descarta ese cálculo correcto** y vuelve a aplicar la resta global `totalDocs − totalPays`. Es decir: dentro del mismo endpoint conviven un cálculo correcto (por documento, no usado en el total) y uno incorrecto (el total mostrado). Esto es evidencia adicional de por qué unificar en una sola función es necesario, no solo "más prolijo".

---

## 4. Mapeo actual → función financiera oficial

| Implementación actual | Reemplazar por |
|---|---|
| `dashboard_controller.go` (ambas vistas), `totalDocs`/`totalPays`/`GlobalBalance` inline | `SaldoDocumentado` (para el saldo/deuda) + `DineroTotalRecibido` (si se quiere seguir mostrando "total pagos" como dato informativo, ya no como operando de una resta) |
| `finance_service.go: GetCompanyBalance` | `SaldoDocumentado(companyID)` — reemplaza el campo `Balance`; `TotalDocuments`/`TotalPayments` quedan como datos informativos opcionales (ver §12) |
| `finance_service.go: GetCompanyStatement` | `SaldoDocumentado`, `DineroTotalRecibido`, `DineroAplicadoADeudas`, `DineroNoAplicado` — los 4, dado que el Blueprint (§23) pide que el Estado de Cuenta pueda responder las 4 preguntas explícitamente |
| `report_controller.go: FinancialSummaryAPI` (resumen global) | `SaldoDocumentado` agregando compañías permitidas |
| `finance_financial_report.go: companyTotalsForReport`/`GetFinancialReportRows` | `SaldoDocumentado` por empresa (reemplaza `bal := td-tp`); `DineroTotalRecibido` para la columna informativa "total pagos" |
| `services/debt/audit.go: ListDocumentReportRows` (Reporte de deudas) | Ya correcto; migrar el cálculo por documento a compartir la misma función interna que usa `SaldoDocumentado` (no cambia el resultado, solo evita una segunda fórmula) |

---

## 5. Dónde debe vivir la implementación única

**`backend/services/debt/financial_totals.go` (archivo nuevo, paquete `debt`)**, como métodos de `Service` (el mismo tipo que ya centraliza `PaidTotal`/`EffectiveBalance`/`PersistBalanceAndStatus`/`LockDocumentsForUpdateAsc`). Motivos:
- Es el paquete que el propio Blueprint ya reconoce como dueño de la fórmula de saldo (`debt.PersistBalanceAndStatus`, citado explícitamente en §5, §21).
- Las 4 funciones nuevas **leen** exactamente los mismos modelos (`Document`, `Payment`, `PaymentAllocation`) que ya gestiona este paquete — no介 hay razón de arquitectura para ponerlas en `services` (paquete de más alto nivel, con controladores/orquestación) en vez de en `services/debt` (paquete de dominio/reglas).
- Mantiene "una sola fuente de verdad, un solo paquete" — el mismo principio que ya se aplicó en Fase 2.4/2.5 con `ValidateAllocationsTx`/`LockDocumentsForUpdateAsc`.

`services/finance_service.go`, `services/finance_financial_report.go`, `controllers/dashboard_controller.go` y `controllers/report_controller.go` pasan a ser **consumidores** (llaman a `debtsvc.NewService().SaldoDocumentado(db, companyID)` etc.), igual que hoy ya consumen `debtsvc.NewService().EffectiveBalance(...)` en otros puntos.

---

## 6-9. Diseño de las 4 funciones oficiales

Firma común propuesta (consistente con el resto de `debt.Service`, que siempre recibe `*gorm.DB` explícito en vez de usar `database.DB` directo — permite testear con sqlite y reusar dentro de una transacción si algún día hiciera falta):

```go
func (s *Service) SaldoDocumentado(db *gorm.DB, companyID uint) (float64, error)
func (s *Service) DineroTotalRecibido(db *gorm.DB, companyID uint) (float64, error)
func (s *Service) DineroAplicadoADeudas(db *gorm.DB, companyID uint) (float64, error)
func (s *Service) DineroNoAplicado(db *gorm.DB, companyID uint) (float64, error)
```

### 6. `SaldoDocumentado`

```go
func (s *Service) SaldoDocumentado(db *gorm.DB, companyID uint) (float64, error) {
    q := db.Model(&models.Document{}).
        Where("company_id = ? AND status IN ?", companyID, []string{StatusPending, StatusPartial})
    q = ScopeActiveDocuments(q) // excluye legacy_status IN (legacy_merged, archived) — resolución C3
    var total float64
    if err := q.Select("COALESCE(SUM(balance_amount),0)").Scan(&total).Error; err != nil {
        return 0, err
    }
    return roundMoney(total), nil
}
```
- Usa `balance_amount` (ya persistido y mantenido por `PersistBalanceAndStatus`), **no** recalcula desde `PaidTotal` — coincide con la fórmula oficial (§22: "SUM(Document.balance_amount)").
- `status IN ('pendiente','parcial')` es una lista blanca explícita (no una exclusión de `'anulado'`), consistente con el texto del Blueprint y más segura que el patrón `status <> 'anulado'` usado hoy (que dejaría pasar `'exonerado'` si alguna vez tuviera saldo residual, aunque en la práctica `IsTerminalWriteoffStatus` ya fuerza `balance_amount=0` en ese estado).
- Incluye `ScopeActiveDocuments` (resolución C3).
- No toca `Document.DeletedAt` explícitamente — GORM ya lo excluye por defecto.

### 7. `DineroTotalRecibido`

```go
func (s *Service) DineroTotalRecibido(db *gorm.DB, companyID uint) (float64, error) {
    var total float64
    err := db.Model(&models.Payment{}).
        Where("company_id = ?", companyID).
        Select("COALESCE(SUM(amount),0)").Scan(&total).Error
    return roundMoney(total), err
}
```
- Sin filtro de `Purpose` (correcto per §22 — es "todo el dinero", deuda + servicio).
- Sin filtro explícito de anulado — GORM excluye `deleted_at IS NULL` por defecto sobre el modelo `Payment` (resolución C1: hoy soft-delete = "anulado"; mañana, cuando exista `voided_at`, se añade `AND voided_at IS NULL` en esta misma línea).

### 8. `DineroAplicadoADeudas`

```go
func (s *Service) DineroAplicadoADeudas(db *gorm.DB, companyID uint) (float64, error) {
    var total float64
    err := db.Model(&models.PaymentAllocation{}).
        Joins("JOIN payments p ON p.id = payment_allocations.payment_id AND p.deleted_at IS NULL AND p.company_id = ?", companyID).
        Select("COALESCE(SUM(payment_allocations.amount),0)").Scan(&total).Error
    return roundMoney(total), err
}
```
- Mismo patrón de JOIN que ya usa `debt.PaidTotal` (`balance.go:20-26`) — no se inventa una fórmula nueva, se reutiliza el patrón probado.
- GORM excluye `payment_allocations.deleted_at IS NULL` automáticamente (modelo base de la consulta).
- Filtra por `Payment.company_id` (no por `Document.company_id`) — asume el invariante ya impuesto por `ValidateAllocationsTx` ("el documento no pertenece a la empresa" se valida en cada allocation creada) de que toda `PaymentAllocation` conecta un `Payment` y un `Document` de la **misma** empresa. Se documenta como suposición explícita, no verificada de nuevo aquí por rendimiento (evita un JOIN adicional a `documents`).

### 9. `DineroNoAplicado`

**Depende de la resolución de C2.** Diseño propuesto asumiendo la opción **A'** (recomendada):

```go
func (s *Service) DineroNoAplicado(db *gorm.DB, companyID uint) (float64, error) {
    var payments []models.Payment
    if err := db.Model(&models.Payment{}).
        Where("company_id = ? AND (purpose IS NULL OR purpose = ?)", companyID, models.PaymentPurposeDebt).
        Preload("Allocations").
        Find(&payments).Error; err != nil {
        return 0, err
    }
    var total float64
    for _, p := range payments {
        var applied float64
        for _, a := range p.Allocations {
            applied += a.Amount
        }
        remainder := roundMoney(p.Amount - applied)
        if remainder > MoneyEpsilon {
            total += remainder
        }
    }
    return roundMoney(total), nil
}
```
- Se calcula en Go (cargar payments + sus allocations) en vez de un `SUM` SQL de una resta por fila, porque GORM no permite fácilmente `SUM(amount - (SELECT SUM(...) FROM payment_allocations ...))` de forma portable/legible sin SQL crudo; dado el volumen esperado (pagos por empresa, no todo el sistema), el costo es aceptable y es el mismo patrón que ya usa `AllocateExistingPaymentTx` para calcular `available` de un pago individual (Fase 2.4) — no se introduce una fórmula nueva, se reutiliza el mismo cálculo `amount - SUM(allocations)` ya usado y probado ahí.
- `remainder` se descarta si es `<= MoneyEpsilon` (evita ruido de redondeo, mismo umbral usado en todo `services/debt`).
- **Si se aprueba la opción B (fórmula literal sin filtro de Purpose)**, el único cambio es remover la cláusula `purpose IS NULL OR purpose = 'deuda'` del `Where` — el resto del diseño no cambia.

---

## 10. Archivos que deberían modificarse

| Archivo | Cambio |
|---|---|
| `backend/services/debt/financial_totals.go` (**nuevo**) | Las 4 funciones oficiales |
| `backend/services/debt/financial_totals_test.go` (**nuevo**) | Tests unitarios de las 4 funciones (sqlite, patrón ya establecido) |
| `backend/services/finance_service.go` | `GetCompanyBalance` y `GetCompanyStatement` consumen las 4 funciones en vez de `SUM` inline |
| `backend/services/finance_financial_report.go` | `companyTotalsForReport`/`GetFinancialReportRows` consumen `SaldoDocumentado`/`DineroTotalRecibido` |
| `backend/controllers/dashboard_controller.go` | Las 2 secciones `GlobalBalance: totalDocs-totalPays` pasan a usar `SaldoDocumentado` agregado sobre las empresas visibles |
| `backend/controllers/report_controller.go` | `FinancialSummaryAPI` (rama sin `include=companies`) usa `SaldoDocumentado` agregado |
| `backend/services/debt/audit.go` (`ListDocumentReportRows`) | Opcional/baja prioridad: reusar la misma función interna que alimenta `SaldoDocumentado` por documento, sin cambiar su comportamiento (ya es correcto) |

## 11. Archivos que NO deberían tocarse

- Todo lo de Fase 1-2.5: `payment_apply.go`, `payment_service.go` (fuera de que YA no se toca en esta fase), `document_service.go`, `settlement.go`, `document_migrations.go`, `payment_migrations.go`, `balance.go` (las fórmulas `PaidTotal`/`EffectiveBalance`/`PersistBalanceAndStatus` se **reutilizan**, no se modifican).
- `services/finance_statement_ledger.go` — el ledger cronológico (cargo/abono por movimiento) es una vista distinta (historial de transacciones, no un agregado de saldo); no reproduce el bug `totalDocuments-totalPayments` y está fuera del alcance textual de esta fase (Dashboard/Statement-headline/FinancialReport/DebtsReport). Se recomienda una revisión aparte si se decide auditar ledgers en el futuro.
- `dashboard_controller.go`: el bloque de "pagos por mes" (gráfico mensual) — es una métrica de flujo, no de saldo; no reproduce el bug. Se documenta como candidato futuro a `DineroTotalRecibido` con rango, no se toca ahora.
- Todo el frontend (`frontend/src/pages/Dashboard.tsx`, `CompanyStatement.tsx`, `Reports.tsx`, `types/dashboard.ts`) — **si se mantienen los mismos nombres de campo JSON** en las respuestas (`GlobalBalance`, `Balance`, `TotalDocuments`, `TotalPayments`, `total_documents_amount`, etc.), el frontend no necesita ningún cambio: ya consume esos campos tal cual los entrega el backend, sin recomputarlos (verificado línea por línea en las 3 páginas).
- RBAC, POS, comprobantes fiscales, `Payment.Purpose`/`Type`, `OriginSettlementID`, locking de Fase 2.5 — nada de esto se modifica; Fase 3 solo reemplaza el *cálculo agregado*, no las reglas de negocio que ya rigen `Document`/`Payment`/`PaymentAllocation`.

---

## 12. Estrategia de migración/reemplazo

1. Crear `financial_totals.go` + tests, **sin tocar ningún consumidor todavía** — verificable de forma aislada.
2. Migrar consumidores **uno por uno**, en el orden de menor a mayor riesgo de romper una pantalla visible (ver §18), verificando después de cada uno que el JSON de respuesta conserve el mismo *shape* (incluso si el *valor* cambia porque ahora es correcto).
3. **No renombrar campos JSON** en esta fase — mantiene el frontend intacto. Si se quiere exponer `DineroNoAplicado` como dato nuevo en alguna pantalla, se **agrega** un campo nuevo (aditivo), nunca se reutiliza uno existente con otro significado.
4. `TotalDocuments`/`TotalPayments` (campos ya existentes en las respuestas) se conservan como datos informativos (siguen siendo útiles: "cuánta deuda se emitió" / "cuánto se ha cobrado en total"), pero **dejan de usarse como operandos de una resta** — el campo `Balance`/`GlobalBalance` pasa a ser `SaldoDocumentado`, no `TotalDocuments - TotalPayments`. Esto es un cambio de significado interno sin cambio de forma externa.
5. Verificar con datos reales (o un snapshot/dump de staging si existe) que los nuevos totales por empresa **no exploten** en magnitud respecto a los actuales antes de dar por cerrada la fase — un cambio grande y repentino en el número mostrado a los clientes merece aviso previo al usuario, no solo a los tests.

---

## 13. Casos límite

- Empresa sin ningún `Document`: `SaldoDocumentado=0`. Sin ningún `Payment`: los otros 3 en `0`. Ninguna función debe fallar con `nil`/división por cero (ninguna divide).
- `Document` con `status='pagado'` pero `balance_amount` ligeramente positivo por redondeo residual (<`MoneyEpsilon`): excluido de `SaldoDocumentado` por el filtro de `status`, no por el monto — coherente con que `ComputeStatusFromAmounts` ya decide el estado como fuente de verdad.
- `Payment` con `Purpose=NULL` (backfill histórico sin evidencia, Fase 2.1/2.2): entra en `DineroTotalRecibido` siempre; en `DineroNoAplicado` según la resolución de C2 (incluido si se adopta A').
- `Payment` con remanente exactamente `0` tras redondeo (`amount == SUM(allocations)`): no debe aparecer en `DineroNoAplicado` (umbral `MoneyEpsilon`, ya contemplado en el diseño de §9).
- Documento con `origin_settlement_id` distinto de `tax_settlement_id` (arrastrado, Fase 1): no afecta estas fórmulas — `SaldoDocumentado` no distingue liquidación de origen vs. actual, solo `status`/`balance_amount`, tal como pide el Blueprint (§21: la liquidación "no es la deuda ni la fuente de verdad de ningún saldo").
- `PaymentAllocation` cuyo `Document` fue eliminado físicamente (caso ya bloqueado estructuralmente desde Fase 1 — un documento con allocations no puede borrarse, §10 del Blueprint) — no debería poder ocurrir; si ocurriera por datos legacy corruptos, `DineroAplicadoADeudas` seguiría sumándolo correctamente (no depende de que el `Document` exista, solo de que el `Payment` no esté anulado) mientras que `SaldoDocumentado` simplemente no lo vería (el documento ya no existe). Se documenta como asimetría aceptable y preexistente, no introducida por esta fase.
- Empresa con acceso restringido (`AllowedCompanyIDs`) en Dashboard/Reporte: las funciones reciben un `companyID` a la vez; la agregación multi-empresa (bucle + suma) es responsabilidad del *llamador* (igual que hoy hace `GetCompanyBalance` en bucle) — las 4 funciones no necesitan saber nada de RBAC.

---

## 14. Tests actuales relacionados con estos cálculos

**Ninguno.** Búsqueda exhaustiva (`grep` de `GetCompanyBalance|GetCompanyStatement|GetFinancialReportRows|companyTotalsForReport|ListDocumentReportRows|FinancialSummaryAPI` en todo `*_test.go`) no encontró ningún test existente para ninguna de las 6 implementaciones actuales del bug, ni para la implementación ya correcta de "Reporte de deudas". Esto significa que Fase 3 **no tiene ninguna regresión previa que proteger** en este dominio — todo el test coverage de esta fase será nuevo.

---

## 15. Nuevos tests propuestos

`backend/services/debt/financial_totals_test.go` (paquete `debt_test`, patrón sqlite ya establecido en `allocate_existing_test.go`):

1. `SaldoDocumentado`: empresa sin documentos → 0.
2. `SaldoDocumentado`: documentos `pendiente`+`parcial` suman su `balance_amount`; `pagado`/`anulado`/`exonerado` se excluyen.
3. `SaldoDocumentado`: documento con `legacy_status='legacy_merged'` y saldo pendiente → excluido (resolución C3).
4. `SaldoDocumentado`: documento de otra empresa → no se cuenta.
5. `DineroTotalRecibido`: suma `Payment.amount` de `purpose=deuda` y `purpose=servicio` juntos (verifica que NO filtra Purpose).
6. `DineroTotalRecibido`: pago soft-deleted (`DeletedAt`) → excluido.
7. `DineroAplicadoADeudas`: suma solo `PaymentAllocation.amount`, no `Payment.amount`.
8. `DineroAplicadoADeudas`: allocation de un pago soft-deleted → excluida.
9. `DineroAplicadoADeudas`: allocation soft-deleted individualmente (sin que el Payment lo esté) → excluida.
10. `DineroNoAplicado`: pago `deuda` con remanente → cuenta.
11. `DineroNoAplicado`: pago `deuda` con allocations que cubren el 100% → no cuenta (remainder≈0).
12. `DineroNoAplicado`: pago `servicio` → NO cuenta (si se aprueba A/A').
13. `DineroNoAplicado`: pago `Purpose=NULL` → cuenta si se aprueba A', no cuenta si se aprueba A.
14. **Test de integración del ejemplo del Blueprint** (el más importante, replica exactamente el escenario de esta instrucción y del §22): deuda=1000 + servicio=300 (0 allocations) + pago de deuda=1000 (1 allocation=1000) → `SaldoDocumentado=0`, `DineroTotalRecibido=1300`, `DineroAplicadoADeudas=1000`, `DineroNoAplicado=0`, **ningún valor negativo**.
15. Test explícito de sobrepago (reutiliza escenario de Fase 2.3): pago=1000, allocation=600 → `DineroNoAplicado=400` para ese pago.
16. Test multi-empresa: dos empresas con datos cruzados, cada función debe aislar correctamente por `company_id` (no fugas entre empresas).

Adicionalmente, tests de los **consumidores** (`GetCompanyBalance`, `GetFinancialReportRows`, etc.) verificando que el campo `Balance`/`GlobalBalance` que devuelven coincide exactamente con `SaldoDocumentado` — no se testea la fórmula dos veces, se testea que el consumidor **delega** correctamente.

---

## 16. Riesgos

- **Cambio de valores visibles**: cualquier empresa con pagos `purpose=servicio` o sobrepagos hoy verá un número de "deuda"/"balance" **distinto** (más bajo, correcto) tras el despliegue. Es el objetivo de la fase, pero debe comunicarse — no es un efecto colateral oculto.
- **Decisión de negocio pendiente (C2)**: si se implementa antes de que el usuario decida A vs. A' vs. B, el número de `DineroNoAplicado` podría no coincidir con lo que se espera mostrar en producción. Bloqueante hasta aprobación.
- **Payments con `Purpose=NULL` en volumen**: si la base real tiene muchos pagos sin clasificar (herencia de Fase 2.1/2.2, backfill "sin evidencia suficiente"), el resultado de `DineroNoAplicado` dependerá fuertemente de la resolución de C2 — vale la pena, antes de implementar, consultar cuántos `Payment.Purpose IS NULL` existen hoy en producción vía una consulta de solo lectura (no incluida en esta fase, es diagnóstico).
- **Rendimiento**: `DineroNoAplicado` carga los `Payment`+`Allocations` en memoria por empresa en vez de un `SUM` SQL puro — aceptable para una empresa a la vez (Dashboard/Statement individuales), pero si `GetFinancialReportRows`/`FinancialSummaryAPI` iteran sobre **todas** las empresas del estudio, esto se convierte en N llamadas con carga de filas — mismo patrón N+1 que ya tiene hoy el bucle de `GetCompanyBalance` en `dashboard_controller.go` (no es una regresión de rendimiento nueva, pero tampoco se corrige aquí; fuera de alcance de "cálculos correctos", sería una optimización de Fase futura si el volumen de empresas lo justifica).
- **`ListDocumentReportRows` no migrado**: si se deja sin tocar (opción de baja prioridad, §10), queda una función correcta pero estructuralmente duplicada respecto a `SaldoDocumentado` — riesgo de que en el futuro alguien "corrija" una y no la otra. Se recomienda migrarla igual, aunque no sea estrictamente necesario para cerrar el bug.

---

## 17. Criterios de aceptación

1. Las 4 funciones oficiales existen en `services/debt/financial_totals.go`, con tests unitarios que pasan.
2. Ningún archivo de Fase 1-2.5 fue modificado.
3. Ninguna pantalla (Dashboard, Estado de cuenta, Reporte financiero, Reporte de deudas) contiene ya la expresión `totalDocs - totalPays`/`totalDocuments - totalPayments` ni equivalente — verificable por `grep`.
4. El escenario del Blueprint (deuda=1000, servicio=300, pago=1000) produce `SaldoDocumentado=0` y ningún campo de "balance"/"deuda" negativo en ninguna de las 4 pantallas, verificado con un test de integración end-to-end de al menos un consumidor real (`GetCompanyBalance` o `GetCompanyStatement`).
5. `go build ./...`, `go vet ./...`, `go test ./services/... ./database/... -count=1` en verde, sin regresiones en los ~184 tests existentes.
6. El frontend sigue funcionando sin cambios (mismos nombres de campo JSON) — verificado revisando que ningún archivo de `frontend/src` necesitó edición, o documentando explícitamente cuáles si alguno la necesitó.
7. La resolución de C1, C2 y C3 quedó explícitamente aprobada por el usuario antes de escribir código (no asumida).

---

## 18. Orden recomendado de implementación

1. `financial_totals.go` + tests (aislado, sin tocar consumidores) — cero riesgo de romper pantallas.
2. `GetCompanyBalance` (el más simple: un valor por empresa, ya usado en 3 sitios del Dashboard) → correr tests + revisión manual de al menos una empresa real conocida.
3. `GetCompanyStatement` (Estado de cuenta) — expone además `DineroNoAplicado`/`DineroAplicadoADeudas` si se decide enriquecer la respuesta (§23 del Blueprint pide los 4 bloques; decidir en la aprobación si eso es parte de esta fase o de la Fase 7 "UI y reportes" ya prevista en el propio plan del Blueprint, §30).
4. `companyTotalsForReport`/`GetFinancialReportRows` (Reporte financiero, filas por empresa).
5. `FinancialSummaryAPI` (Reporte financiero, resumen global) — depende de que el paso 4 ya esté probado, ya que ambos comparten el mismo endpoint.
6. `dashboard_controller.go` (las 2 vistas) — se deja para el final porque agrega sobre **todas** las empresas visibles, el radio de impacto visual más amplio (primera pantalla que ve cualquier usuario).
7. (Opcional, baja prioridad) `ListDocumentReportRows` — migrar a compartir la función interna sin cambiar su comportamiento observable.

Cada paso es un commit separado y aprobable por el usuario, siguiendo exactamente el mismo patrón de fases anteriores.
