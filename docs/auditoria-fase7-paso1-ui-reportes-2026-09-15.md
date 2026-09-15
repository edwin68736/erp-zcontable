# Fase 7 — Paso 1: Auditoría de UI y Reportes Financieros

**Fecha**: 2026-09-15. **Alcance**: solo auditoría — cero archivos modificados, cero commits.
Referencia: Blueprint (`docs/blueprint-financiero-definitivo-2026-09-14.md`) y todo lo construido en
Fases 1-6. Metodología: 4 sub-auditorías paralelas (backend cálculos, frontend Dashboard/Empresa/Deuda,
frontend Payments/Liquidaciones, reportes+write-off) + verificación directa e independiente de los
hallazgos más severos (código leído personalmente, no solo confiado a los sub-agentes).

---

## A) Mapa completo de UI financiera actual

| Pantalla | Archivo frontend | Endpoint(s) backend |
|---|---|---|
| Dashboard | `pages/Dashboard.tsx` | `GET /api/dashboard` |
| Listado de empresas | `pages/Companies.tsx` | `GET /api/companies` |
| Estado de cuenta (detalle de empresa) | `pages/CompanyStatement.tsx` | `GET /api/companies/:id/statement` |
| Listado/detalle de deudas | `pages/Documents.tsx`, `components/DocumentDebtDetailModal.tsx` | `GET /api/documents` |
| Formulario de deuda | `pages/DocumentForm.tsx` | `POST/PUT /api/documents` |
| Listado de pagos | `pages/Payments.tsx` (sin modal de detalle propio) | `GET /api/payments`, `DELETE /api/payments/:id` |
| Formulario de pago | `components/PaymentForm.tsx` | `POST/PUT /api/payments` |
| Liquidaciones (lista) | `pages/TaxSettlements.tsx` | `GET /api/tax-settlements`, `DELETE`, `.../revert-to-draft` |
| Liquidación (detalle) | `pages/TaxSettlementDetail.tsx` | `GET /api/tax-settlements/:id`, `.../debts-context`, `.../debts/:id/writeoff` |
| Reporte financiero | `pages/Reports.tsx` | `GET /api/reports/financial` |
| Reporte de deudas | *(sin página — endpoint huérfano)* | `GET /api/reports/debts` |

---

## B) Tabla — Pantallas

| Pantalla | Dato mostrado | Fuente actual | Fuente correcta según Blueprint | Estado |
|---|---|---|---|---|
| Dashboard | Saldo por cobrar / Deuda total (`GlobalBalance`, `TotalDebtAmount`) | `Σ GetCompanyBalance(id).Balance` → `SaldoDocumentado` | `SaldoDocumentado` | 🟢 |
| Dashboard | "Deudas"/"Pagos" badge (`TotalDocs`/`TotalPays`) | SQL ad-hoc propio (`SUM(total_amount)`, `SUM(amount) WHERE deleted_at IS NULL`) | Informativo — no es saldo, pero duplica la fórmula de `DineroTotalRecibido` sin llamarla | 🟠 |
| Dashboard | Barras de pagos mensuales / cobranza anual | SQL ad-hoc propio, sin filtro `voided_at` explícito | Debería usar `DineroTotalRecibido` con rango de fechas, o al menos filtrar `voided_at` explícitamente | 🟠 |
| Dashboard | `CompanyDebtCard.TotalPayments` (por deudor) | `GetCompanyBalance.TotalPayments`, ad-hoc, sin `voided_at` | `DineroTotalRecibido` | 🟠 |
| **Listado de empresas** | **`balance` por empresa** | **`SUM(documents.total_amount) − SUM(payments.amount)` — SQL crudo en `companyListBalanceSelect`** | **`SaldoDocumentado`** | **🔴** |
| Estado de cuenta | Saldo (`Balance`) | `SaldoDocumentado` | `SaldoDocumentado` | 🟢 |
| Estado de cuenta | `TotalPayments` (agregado) | Suma manual en Go (`for _, p := range pays { totalPays += p.Amount }`), sin filtro `voided_at` | `DineroTotalRecibido` | 🟠 |
| Estado de cuenta | Libro/ledger (abonos, cargos, saldo por movimiento) | `finance_statement_ledger.go`, construido en memoria desde la misma lista `pays` sin filtro `voided_at`; cero referencias a `VoidedAt` en todo el archivo | Debe excluir pagos anulados | 🟠 |
| Estado de cuenta | Por documento: Pagado/Saldo | `EffectiveBalance`/`PaidTotal` | igual | 🟢 |
| Detalle de deuda (modal) | Monto/Pagado/Saldo | `documentBalanceAmount()` — confía en `balance_amount` del backend, con fallback JS `total-pagado` si el campo faltara | `SaldoDocumentado`/`EffectiveBalance` | 🟠 (ver D.4 — fallback no se activa hoy en la práctica, verificado) |
| Detalle de deuda | Estado (badge) | `doc.status` directo + `documentIsOverdue()` local | `Document.status` | 🟢 (con el mismo matiz del fallback) |
| Detalle de deuda | Liquidación asociada | `doc.tax_settlement_id`, navegación directa | `Document.tax_settlement_id` | 🟢 |
| Detalle de deuda | Write-off (motivo/actor/fecha) | **No se muestra en ningún lado** | `Document.WriteoffReason/By/At` (ya expuestos por el backend) | 🟠 |
| Listado de pagos | Tipo (`applied`/`on_account`) | `Payment.type` | `Payment.Type` | 🟢 |
| Listado de pagos | Purpose (`deuda`/`servicio`) | **No existe en absoluto en el frontend** | `Payment.Purpose` | 🟠 |
| Listado de pagos | Comprobante vinculado | `tukifac_fiscal_receipt` | `TukifacFiscalReceipt` | 🟢 |
| Listado de pagos | Pago anulado (badge/filtro) | **No existe** — el tipo TS `Payment` ni siquiera declara `voided_at/by/reason` | `Payment.VoidedAt/By/Reason` | 🟠 |
| Liquidaciones (detalle) | Deudas vinculadas actuales | `GET .../debts-context` → `Document.tax_settlement_id` (NO usa `TaxSettlementLine` como fuente de verdad, salvo en liquidaciones **cerradas**, donde es una foto histórica intencional y etiquetada `(cierre)`) | `Document.tax_settlement_id` | 🟢 |
| Liquidaciones (lista/detalle) | Tras Delete/RevertToDraft | Refresca correctamente; el toast es genérico, no informa cuántos/cuáles pagos se anularon en cascada | — | 🟠 |
| Reporte financiero | `Balance`/`global_balance` | `SaldoDocumentado` | igual | 🟢 |
| Reporte financiero | `TotalDocuments`/`TotalPayments` | `companyTotalsForReport`, SQL ad-hoc, sin `voided_at` | `DineroTotalRecibido` | 🟠 |

---

## C) Tabla — Reportes

| Reporte | Endpoint | Servicio/cálculo | ¿Usa fuente oficial? | ¿Excluye voided? | Estado |
|---|---|---|---|---|---|
| Reporte financiero (por empresa) | `GET /api/reports/financial` | `GetFinancialReportRows` → `companyTotalsForReport` (ad-hoc) + `SaldoDocumentado` | Parcial (`Balance` sí, `TotalDocuments/Payments` no) | `Balance`: sí. `TotalPayments`: **no** | 🟠 |
| Estado de cuenta | `GET /companies/:id/statement` | `GetCompanyStatement` → `pays` sin filtrar + `SaldoDocumentado`/`EffectiveBalance` | Parcial | `Balance` y detalle por documento: sí. `TotalPayments` y **el ledger completo**: **no** | 🟠 |
| Reporte de deudas | `GET /api/reports/debts` | `ListDocumentReportRows` → `EffectiveBalance` (voided-aware) | Sí (indirectamente) | Sí | 🟢, pero **sin consumidor en el frontend** (endpoint huérfano) — y con un bug independiente: `ScopeActiveDocuments(q)` se llama sin reasignar (`q = ...`), por lo que el filtro de documentos legacy-merged/archived **nunca se aplica** en este reporte (confirmado leyendo `legacy.go`: `ScopeActiveDocuments` devuelve un `*gorm.DB` nuevo, no muta) | 🟠 |
| Listado de empresas (no es "reporte" formal pero funciona como uno) | `GET /api/companies` | `companyListBalanceSelect` (SQL crudo) | **No** | No (y la fórmula en sí está prohibida, independientemente del filtro) | 🔴 |

---

## D) Cálculos duplicados o incorrectos encontrados

**D.1 — 🔴 BLOQUEANTE: `services/company_service.go:737-742` usa la fórmula explícitamente prohibida por el Blueprint.**

```go
const companyListBalanceSelect = `companies.*,
			(
				(SELECT COALESCE(SUM(total_amount),0) FROM documents WHERE documents.company_id = companies.id AND documents.status <> 'anulado')
				-
				(SELECT COALESCE(SUM(amount),0) FROM payments WHERE payments.company_id = companies.id AND payments.deleted_at IS NULL)
			) AS balance`
```

Usada por `CompanyService.List`/`ListPaged` (vía `loadCompanyListItemsByIDs`, `company_service.go:236-252`) — es decir, **`GET /api/companies`**, el endpoint que alimenta el listado principal de empresas. Verificado personalmente leyendo el archivo: es exactamente `SUM(Document.total_amount) − SUM(Payment.amount)`, la fórmula que el propio comentario de `financial_totals.go:31-34` describe como "prohibida explícitamente por el Blueprint" — mezcla dinero de servicio/a-cuenta con deuda y puede producir saldos negativos falsos, el mismo bug que Fase 3 ya había corregido en `GetCompanyBalance`, `GetCompanyStatement`, `GetFinancialReportRows` y el Dashboard. **Este endpoint no fue migrado en Fase 3** y quedó fuera de esa migración. Adicionalmente no filtra `voided_at`. Es el hallazgo más severo de toda esta auditoría — el balance mostrado en el listado principal de empresas puede estar simplemente mal, no solo desactualizado respecto a Fase 6.

**D.2 — 🟠 Patrón sistémico: campos "informativos" (`TotalDocuments`/`TotalPayments`) duplican `DineroTotalRecibido` sin llamarla, en al menos 5 sitios:**
`finance_service.go:GetCompanyBalance` (líneas 64-68), `finance_service.go:GetCompanyStatement` (líneas 109-119+147-149, suma manual en Go), `finance_financial_report.go:companyTotalsForReport` (líneas 157-176), `report_controller.go:FinancialSummaryAPI` (líneas 60-67), `dashboard_controller.go` (4 sitios: `TotalPays`, `MonthlyPayments`, `YearCollectionPayments`, en ambas variantes de la función). Ninguno de estos llama a `debt.Service.DineroTotalRecibido` — todos son SUM ad-hoc independientes que **hoy** producen el mismo número solo porque ninguno usa `.Unscoped()` (así que `deleted_at IS NULL` se aplica automáticamente vía GORM) y porque Fase 6 siempre fija `deleted_at`+`voided_at` juntos. Es una coincidencia estructural, no una garantía: si algún día `VoidedAt` se fijara sin `DeletedAt` (el propio comentario de `models/payment.go` los trata como aditivos, no como un invariante duro), estos 5+ sitios empezarían a contar dinero anulado silenciosamente, mientras que las 4 funciones oficiales seguirían correctas. Ninguno de estos campos alimenta el "Saldo"/"Balance" mostrado al usuario (ese sí está correctamente migrado en todos los casos, excepto D.1) — son cifras secundarias/informativas, pero siguen siendo fórmulas duplicadas tal como pide detectar el punto 1 del pedido.

**D.3 — 🟠 El "libro"/ledger del Estado de Cuenta (`finance_statement_ledger.go`) no tiene ninguna noción de `voided_at`.**
Construido enteramente en memoria a partir de la lista `pays` sin filtrar (misma lista de D.2), sin ninguna llamada a `debt.Service`. Un pago anulado podría aparecer como movimiento en el libro contable de la empresa. Verificado: cero referencias a `VoidedAt`/`voided_at` en todo el archivo.

**D.4 — 🟠 (verificado personalmente, severidad reevaluada a la baja) `utils/documentDebtUi.ts:documentBalanceAmount()` tiene un fallback JS que hace `total_amount − paid_amount`** cuando `balance_amount` no es un número finito. En principio esto es exactamente la fórmula prohibida, ejecutada en el navegador. Verifiqué el backend: **tanto `DocumentService.List/ListPaged` como `GetByID` llaman siempre a `enrichDocumentsFinancials`**, que sobrescribe `BalanceAmount` con `EffectiveBalance` (voided-aware) en cada respuesta — así que en el flujo de datos actual este fallback nunca se activa en la práctica; es código defensivo dormido, no un bug activo hoy. Se mantiene como hallazgo porque viola la letra de la regla ("nunca recalcular en frontend") y quedaría reactivado silenciosamente si alguna respuesta futura omitiera el campo — pero no está produciendo cifras incorrectas actualmente.

**D.5 — 🟠 `services/debt/audit.go:211` — `ScopeActiveDocuments(q)` sin reasignar.** Bug de código confirmado (ver C, Reporte de deudas): el filtro de documentos legacy-merged/archived nunca se aplica en `ListDocumentReportRows`. Bajo impacto práctico porque ese endpoint no tiene consumidor en el frontend hoy.

**D.6 — 🟢 Lo que SÍ está correctamente migrado y unificado:** el campo "Balance"/"Saldo"/"global_balance" que efectivamente se le muestra al usuario como LA cifra de deuda — en Dashboard, Estado de Cuenta, Reporte Financiero y (indirectamente) Reporte de Deudas — proviene en el 100% de los casos auditados de `SaldoDocumentado` o de `EffectiveBalance` (su equivalente por documento). La migración de Fase 3 fue real y se sostiene; el problema está en los campos secundarios/informativos y en el listado de empresas (D.1), no en el número principal de "saldo".

---

## E) Problemas de UX/semántica financiera

- **"Comprobante" se usa para dos cosas distintas en la misma tabla de Pagos** (`Payments.tsx`): el número de comprobante fiscal Tukifac y el adjunto/proof subido manualmente — mismo encabezado de columna, dos conceptos.
- **No hay ninguna pantalla que distinga "pago a cuenta de deuda" vs. "pago independiente por servicio"** — la única distinción visible es `Type` (`applied`/`on_account`), que es un concepto mecánico distinto de `Purpose` (`deuda`/`servicio`), y `Purpose` no tiene ninguna representación en la UI. Esto es exactamente la ambigüedad "pago"/"abono"/"servicio" que el punto 10 del pedido pide revisar — hoy el usuario no puede saber, mirando la lista de pagos, si un ingreso fue clasificado como deuda o como servicio independiente.
- **Badge de deuda "Pagado" es ambiguo con "Exonerado"** (ver F/G).
- **Ninguna pantalla explica al usuario, después de eliminar o revertir una liquidación, cuántos o cuáles pagos quedaron anulados como consecuencia** — el aviso solo aparece antes de confirmar (en el modal de confirmación), nunca después, como un resumen post-acción.
- **`WriteoffReason/By/At` existen en el backend y en el modelo TypeScript no, y en ninguna pantalla se muestran** — un motivo de exoneración capturado con esfuerzo (Fase 6 lo hizo obligatorio) es invisible para cualquier usuario que después revise esa deuda.

---

## F) Problemas relacionados con Payments anulados

1. **🟢 Correcto y verificado**: un pago anulado **nunca aparece** en el listado (`GET /api/payments`) ni es recuperable por `GET /api/payments/:id` — verificado leyendo `PaymentService.List/ListPaged/GetByID`: ninguno usa `.Unscoped()`, y como `DeletePaymentTx` siempre fija `deleted_at` junto con `voided_at`, el scope automático de GORM lo excluye de raíz. No hay riesgo de que un pago anulado aparezca mezclado como si estuviera activo.
2. **🟢 Correcto**: un pago anulado no afecta ninguno de los 4 cálculos oficiales (ya verificado exhaustivamente en el Gate de Fase 6, con tests).
3. **🟠 Sí afecta a los cálculos NO oficiales/duplicados** listados en D.2/D.3 — ahí sí puede seguir contando, porque esos ni siquiera intentan filtrar `voided_at` (aunque hoy están protegidos indirectamente por la coincidencia `deleted_at`+`voided_at`).
4. **🟠 Hallazgo central de este punto**: **no existe ninguna forma de ver el historial de un pago anulado.** Ni el frontend (tipo `Payment` sin los 3 campos, cero UI) ni el backend (ningún endpoint usa `.Unscoped()` sobre `Payment`) exponen `VoidedAt`/`VoidedBy`/`VoidReason` en ningún punto alcanzable. El registro sobrevive en la base de datos (correcto, soft-delete), pero es efectivamente invisible para cualquier usuario — lo cual es una brecha real frente a la intención del Blueprint §19 ("el registro permanece, nunca se destruye", lo que implícitamente supone que alguien pueda revisarlo).

---

## G) Problemas relacionados con write-off

1. **🟠 Badge "Pagado" para una deuda exonerada** (`documentDebtUi.ts:debtCollectionBadge`, verificado personalmente): no hay ninguna rama para `status === 'exonerado'`; como `WriteOffUnlinkedDebt` siempre fija `balance_amount = 0`, cae en la condición `balance <= 0.005` y se muestra como "Pagado" (verde), indistinguible de un cobro real. Solo `eliminar` (status `anulado`) tiene badge propio ("Anulado", gris).
2. **🟠 La acción "Editar" no se bloquea para una deuda escrita de baja** — ni en frontend (`Documents.tsx`, el botón "Editar" se gatea solo por el permiso `canUpsert`, sin chequear `status`) ni en backend (`DocumentService.Update` no tiene ningún guard `IsTerminalWriteoffStatus`, y su validación de status ni siquiera reconoce `'exonerado'` como valor válido de entrada). Esto significa que hoy es posible editar el monto, los ítems o el estado de una deuda ya exonerada/anulada — un hallazgo de backend fuera del alcance estricto de "UI" pero que reporto tal como piden las reglas ("si encuentras un problema en backend fuera de Fase 7, repórtalo, no lo corrijas").
3. **🟢 El mensaje de bloqueo del write-off (Fase 6, §20) SÍ llega correctamente al usuario** — verificado: el controller propaga `err.Error()` verbatim como JSON y el frontend lo muestra tal cual en un toast, sin genericizarlo. No es elegante (no hay deep-link a "reasignar el pago"), pero es funcional y honesto.
4. **🟠 `writeoff_reason/by/at` nunca se muestran** — ver E/F, mismo patrón que los pagos anulados: el dato existe, nadie lo ve.

---

## H) DTOs/endpoints que requieren ajustes

- **`frontend/src/types/dashboard.ts` — interfaz `Payment`**: le faltan `purpose`, `voided_at`, `voided_by`, `void_reason`. El backend ya los serializa (son campos planos del modelo `Payment`, sin `json:"-"`) — el gap es puramente de modelado/consumo en frontend, no de exposición backend.
- **`frontend/src/types/dashboard.ts` — interfaz `Document`**: le faltan `writeoff_reason`, `writeoff_by`, `writeoff_at` (ya expuestos por el backend en `models/document.go:43-45`).
- **Backend — no hay ningún endpoint que permita ver pagos anulados.** Si Fase 7 decide que debe existir una vista de auditoría, se necesitaría un endpoint nuevo (p. ej. `GET /api/payments/:id/voided` o un parámetro `?include_voided=1` con permiso elevado) — **no existe hoy en ninguna forma**.
- **`backend/services/company_service.go`**: `companyListBalanceSelect` necesita reemplazarse por una fuente oficial (`SaldoDocumentado`) — este es un cambio de **backend**, no de UI, pero condiciona directamente lo que el listado de empresas puede mostrar correctamente.
- **`backend/services/debt/audit.go:ListDocumentReportRows`**: el bug de `ScopeActiveDocuments` sin reasignar es un fix de una línea, backend.

---

## I) Archivos que deberían modificarse en Paso 2/3

**Backend** (correcciones de cálculo/datos — fuera de la letra estricta de "UI" pero bloqueantes para que la UI muestre cifras correctas):
- `backend/services/company_service.go` (D.1 — 🔴 crítico)
- `backend/services/finance_service.go` (`GetCompanyStatement` — D.2/D.3)
- `backend/services/finance_financial_report.go` (`companyTotalsForReport` — D.2)
- `backend/controllers/report_controller.go` (`FinancialSummaryAPI` — D.2)
- `backend/controllers/dashboard_controller.go` (D.2, cosmético/informativo)
- `backend/services/finance_statement_ledger.go` (D.3)
- `backend/services/debt/audit.go` (D.5, fix de una línea)
- `backend/services/document_service.go` (`Update` — G.2, guard de write-off; fuera de alcance de Fase 7 si se decide tratar como un hallazgo de Fase 6, a decidir)

**Frontend**:
- `frontend/src/types/dashboard.ts` (H — agregar campos faltantes a `Payment`/`Document`)
- `frontend/src/utils/documentDebtUi.ts` (`debtCollectionBadge`, `documentCanReceivePayment` — G.1, agregar rama `exonerado`)
- `frontend/src/components/DocumentDebtDetailModal.tsx` (mostrar writeoff_reason/by/at)
- `frontend/src/pages/Payments.tsx` (mostrar Purpose; indicar en algún punto que existen pagos anulados, si Fase 7 decide exponerlos)
- `frontend/src/pages/Documents.tsx` (gatear "Editar" por status si el backend lo bloquea)
- `frontend/src/pages/TaxSettlements.tsx` / `TaxSettlementDetail.tsx` (resumen post-acción de pagos anulados tras Delete/RevertToDraft — mejora de UX, no bloqueante)

---

## J) Propuesta de alcance exacto para Fase 7 — Paso 2 (a tu criterio, no implementado)

Sugiero dividir Paso 2 en dos frentes, porque tienen severidad y naturaleza muy distintas:

**Frente 1 — Corrección de cálculo (backend), imprescindible:**
1. `company_service.go`: reemplazar `companyListBalanceSelect` por `SaldoDocumentado` por empresa (D.1, 🔴).
2. Agregar `voided_at IS NULL` a los 5+ sitios de D.2/D.3, o (más limpio) hacer que todos ellos llamen directamente a `DineroTotalRecibido`/`DineroAplicadoADeudas` en vez de reimplementar la suma — decisión de diseño para Paso 2.
3. Fix de una línea en `audit.go` (D.5).

**Frente 2 — Visibilidad/UX (frontend + pequeños endpoints backend), importante pero no bloqueante:**
4. Agregar `purpose`/`voided_at`/`voided_by`/`void_reason` al tipo `Payment` y decidir cómo (y si) exponerlos en la UI de pagos.
5. Agregar `writeoff_reason/by/at` al tipo `Document` y mostrarlos en el detalle de deuda.
6. Badge distinto para `exonerado` (G.1).
7. Decidir si Fase 7 debe crear una vía de auditoría para ver pagos anulados (endpoint nuevo) — **esto es una decisión de producto/alcance que requiere tu aprobación explícita antes de diseñar**, no algo que se pueda inferir del Blueprint.

**Explícitamente fuera de Fase 7** (a menos que decidas lo contrario): el guard de "Editar" sobre documentos con write-off (G.2) es un hallazgo de **backend de Fase 6** que quedó sin cubrir — lo reporto pero no lo incluyo en el alcance de Fase 7 por defecto, ya que Fase 7 es "UI y reportes", no "cancelaciones/write-off" (eso ya se cerró). Señalo la contradicción para que decidas si se atiende aquí, en un parche a Fase 6, o se documenta como deuda técnica.

---

## K) Hallazgos bloqueantes y no bloqueantes

🔴 **BLOQUEANTES**:
- **D.1**: `GET /api/companies` calcula `balance` con la fórmula `total_amount − payments` explícitamente prohibida por el Blueprint, sin pasar por `SaldoDocumentado`. Es el listado principal de empresas — impacto directo y visible.

🟠 **NO BLOQUEANTES** (documentados, no bloquean el cierre de este Paso 1, pero deben resolverse en Paso 2/3):
- D.2 (5+ sitios con `TotalPayments` duplicado, hoy correcto por coincidencia)
- D.3 (ledger del Estado de Cuenta sin filtro `voided_at`)
- D.4 (fallback JS de balance, dormido hoy)
- D.5 (`ScopeActiveDocuments` sin reasignar en el reporte de deudas huérfano)
- F.4 (pagos anulados invisibles — sin vía de auditoría)
- G.1 (badge "Pagado" para deudas exoneradas)
- G.2 (edición no bloqueada sobre deuda con write-off — hallazgo de backend/Fase 6, reportado no corregido)
- G.4 / E (writeoff_reason/by/at nunca mostrados; Purpose sin representación en UI; ambigüedad "Comprobante"; sin resumen post-cascada en liquidaciones)

🟢 **CORRECTO**:
- El campo "Saldo"/"Balance"/"global_balance" mostrado al usuario en Dashboard, Estado de Cuenta y Reporte Financiero usa consistentemente `SaldoDocumentado`/`EffectiveBalance`.
- `TaxSettlementLine` NO se usa como fuente de verdad del vínculo actual de una deuda (sí, correctamente, como snapshot histórico de liquidaciones cerradas, explícitamente etiquetado).
- Ningún pago anulado puede aparecer mezclado como activo en listados/detalle de pagos.
- El mensaje de bloqueo de write-off (Fase 6 §20) llega íntegro al usuario.
- Ninguna pantalla de las auditadas (Dashboard, Estado de Cuenta, Reporte Financiero) hace `.reduce()`/suma de arreglos de `Payment.amount`/`PaymentAllocation.amount` en el cliente para calcular el saldo principal.

---

## L) Veredicto

**¿UI/reportes están suficientemente alineados?** Parcialmente. La cifra que más importa — el saldo/deuda que el usuario ve como "cuánto debe la empresa" — está correctamente centralizada en `SaldoDocumentado` en todos los lugares relevantes **excepto uno**, pero ese uno (`GET /api/companies`, el listado principal de empresas) es suficientemente central y visible como para clasificar el conjunto como **no completamente alineado** todavía.

**¿Qué debe corregirse?**
1. Con prioridad máxima: `company_service.go` (D.1) — es una fórmula prohibida en producción, en la pantalla más usada del sistema.
2. Con prioridad alta pero no urgente: unificar los campos "informativos" duplicados (D.2/D.3) para que dejen de depender de una coincidencia de implementación y pasen a llamar explícitamente a las funciones oficiales — hoy no producen cifras incorrectas, pero son frágiles y no reflejan la arquitectura que el Blueprint pide.
3. Con prioridad media: cerrar la brecha de visibilidad de Fase 6 (pagos anulados y write-offs invisibles en la UI) — el backend ya capturó la auditoría, falta decidir y construir cómo mostrarla.
4. El badge "Pagado" para deudas exoneradas (G.1) es un bug de UX concreto y barato de corregir.

**¿Qué NO debe tocarse?** La arquitectura de las 4 funciones oficiales en sí (Fase 3), la lógica de `DeletePaymentTx`/`WriteOffUnlinkedDebt` (Fase 6, ya cerrada y aprobada), el manejo de `TaxSettlementLine` en la liquidación (ya correcto), y `PaymentAllocation`/reversión de vínculos (Fase 6). No propongo ningún refactor de arquitectura — todos los hallazgos son correcciones puntuales y localizadas.

No se modificó ningún archivo de código en este paso. Quedo a la espera de tu aprobación para diseñar Fase 7 — Paso 2, incluyendo tu decisión explícita sobre el punto J.7 (si se construye una vía de auditoría para pagos anulados).
