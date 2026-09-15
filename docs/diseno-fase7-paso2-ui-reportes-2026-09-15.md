# Fase 7 — Paso 2: Diseño de correcciones de UI y reportes

**Fecha**: 2026-09-15. **Solo diseño — cero código tocado.** Referencia única: Blueprint,
`docs/auditoria-fase7-paso1-ui-reportes-2026-09-15.md`, y tus decisiones 1-8 de este mensaje.

---

## A) Diseño exacto de las correcciones

### A.1 — `GET /api/companies` (🔴 bloqueante, decisión 1)

Eliminar `companyListBalanceSelect` (SQL crudo, `company_service.go:737-742`) por completo. Reemplazar
`loadCompanyListItemsByIDs(ids []uint)` para que:
1. Cargue las empresas con un `Find` normal (sin el `Select` de subconsultas).
2. Por cada empresa, llame `debtsvc.NewService().SaldoDocumentado(database.DB, company.ID)`.
3. Arme `CompanyListItem{Company: company, Balance: balance}` igual que hoy (misma forma de
   respuesta — el frontend no necesita ningún cambio para este punto específico).

Mismo patrón exacto que ya usa `sumSaldoDocumentado` (report_controller.go) y los bucles de
`dashboard_controller.go`/`GetFinancialReportRows` — no se introduce arquitectura nueva, se replica la
que ya existe. Nota de rendimiento (no bloqueante, ver J): pasa de 1 consulta SQL batched a N
consultas (una por empresa) — exactamente el mismo trade-off que ya acepta el resto del sistema en
Dashboard/Reportes; `ListPaged` (la ruta paginada, la que usa la pantalla real) acota N al tamaño de
página. El endpoint `List()` sin paginar (usado en algún selector/exportación) queda con el mismo
trade-off que ya tiene hoy el resto de los bucles por-empresa del sistema — no es una regresión nueva.

### A.2 — Duplicación de `TotalDocuments`/`TotalPayments`/totales (decisión 5)

Se separan en dos categorías según si el sitio necesita un **escalar agregado** o **líneas individuales**:

**Categoría 1 — escalar sin rango de fechas → swap directo a la función oficial, sin tocar su firma:**

| Sitio | Cambio |
|---|---|
| `finance_service.go:GetCompanyBalance` (`TotalPayments`) | Reemplazar el `SUM` ad-hoc por `debtsvc.NewService().DineroTotalRecibido(database.DB, companyID)` |
| `finance_service.go:GetCompanyStatement` (`TotalPayments`) | Reemplazar el bucle `for _, p := range pays { totalPays += p.Amount }` por la misma llamada directa a `DineroTotalRecibido` |

**Categoría 2 — escalar multi-empresa (sin rango de fechas) → nuevo helper agregador, mismo patrón que `sumSaldoDocumentado`:**

Se agrega **una función nueva en `services/debt/financial_totals.go`**, junto a las 4 oficiales, con el
mismo estilo (no es una fórmula nueva, es una suma de la función oficial sobre varias empresas —
idéntico patrón al que `report_controller.go` ya aplica manualmente a `SaldoDocumentado`):

```go
// SumDineroTotalRecibido agrega DineroTotalRecibido sobre varias empresas — mismo patrón que
// sumSaldoDocumentado (report_controller.go), ahora centralizado aquí para reutilizarse en
// dashboard_controller.go y report_controller.go sin duplicar el bucle en cada uno.
func (s *Service) SumDineroTotalRecibido(db *gorm.DB, companyIDs []uint) (float64, error) {
    var total float64
    for _, cid := range companyIDs {
        v, err := s.DineroTotalRecibido(db, cid)
        if err != nil {
            return 0, err
        }
        total += v
    }
    return roundMoney(total), nil
}
```

Usada en:
- `report_controller.go:FinancialSummaryAPI` (líneas 60-67, `totalPays` top-level, ámbito multi-empresa)
- `dashboard_controller.go` (`TotalPays`, ambas variantes de `getDashboardData*`)

**Categoría 3 — con rango de fechas → NO se toca la firma de las funciones oficiales de Fase 3 (decisión abierta, ver J.1); se agrega `AND voided_at IS NULL` directamente en la consulta ad-hoc existente:**

| Sitio | Cambio |
|---|---|
| `finance_financial_report.go:companyTotalsForReport` (`pq`, con `dateFrom`/`dateToExclusive`) | Agregar `voided_at IS NULL` al `Where` existente |
| `dashboard_controller.go` — `YearCollectionPayments`, `MonthlyPayments[].Amount` (ambas variantes) | Agregar `voided_at IS NULL` a cada `Where` existente |

Esto no elimina la duplicación de fórmula en estos sitios con rango de fechas (siguen siendo SUM
ad-hoc), pero cierra la brecha real de seguridad (`voided_at`) sin tocar la firma de una función de
Fase 3 — la decisión de si vale la pena extender `DineroTotalRecibido` con parámetros de fecha
opcionales (eliminando también esta duplicación) queda como decisión abierta en J.1, porque toca un
archivo que Fase 3 posee y el mandato de esta sesión es no reabrir Fases 1-6 salvo que apruebes
explícitamente la extensión.

### A.3 — `finance_statement_ledger.go` / ledger del Estado de Cuenta (decisión 6)

**No requiere ningún cambio dentro del propio archivo.** El ledger se construye enteramente a partir de
la slice `pays` que le pasa `GetCompanyStatement` (`finance_service.go:151-156`) — nunca hace su propia
consulta a `Payment`. La corrección real es upstream, en la consulta que arma esa slice
(`finance_service.go:109-119`):

```go
// ANTES:
Where("company_id = ?", companyID)
// DESPUÉS:
Where("company_id = ? AND voided_at IS NULL", companyID)
```

Un solo cambio de una línea corrige simultáneamente: el ledger completo (`saldo_anterior`,
`total_abonos`, `total_cargos`, `saldo_final`, cada movimiento), el `TotalPayments` agregado (ítem A.2
categoría 1), y cualquier otro consumidor futuro de esa misma slice `pays` dentro de
`GetCompanyStatement`. Nada de esto crea una fórmula nueva — es agregar el mismo filtro que las 4
funciones oficiales ya aplican, en el único punto donde la lista de pagos "vivos" de una empresa se
arma para el estado de cuenta.

### A.4 — `services/debt/audit.go:211` (decisión 8 — documentar, NO implementar en Paso 3)

Bug de una línea (`ScopeActiveDocuments(q)` sin reasignar a `q =`), confirmado por lectura de
`legacy.go` (la función retorna un `*gorm.DB` nuevo vía `db.Where(...)`, no muta in-place). Afecta solo
a `GET /api/reports/debts`, que hoy **no tiene ningún consumidor en el frontend** (confirmado en Paso
1) — impacto práctico nulo mientras eso siga así. **Se documenta como deuda técnica, no se corrige en
Fase 7** por instrucción explícita (decisión 8). Recomendación: si en el futuro se construye una
pantalla que consuma este reporte, corregir esta línea como prerrequisito — no amerita una fase propia,
es un fix de una línea que puede ir en cualquier commit que toque ese reporte.

### A.5 — Guard de edición sobre deuda con write-off (decisión 8 — documentar, NO implementar en Paso 3)

Ni `DocumentService.Update` (backend) ni el botón "Editar" de `Documents.tsx` (frontend) bloquean
modificar una deuda ya `exonerado`/`anulado`. Es un hallazgo de **backend de Fase 6** que quedó sin
cubrir — Fase 6 implementó el bloqueo en `WriteOffUnlinkedDebt` (impedir dar de baja con dinero
aplicado) pero no un guard simétrico ("no permitir editar una deuda ya dada de baja"). **No se corrige
en Fase 7** por instrucción explícita. Recomendación: no amerita una fase nueva completa — es candidato
natural para un parche puntual a Fase 6 (`document_service.go:Update`, agregar
`if debtsvc.IsTerminalWriteoffStatus(existing.Status) { return error }`) el día que se decida atenderlo,
sin relación con "UI y reportes". Lo dejo señalado aquí para que no se pierda, pero fuera del alcance de
esta fase.

---

## B) Tabla — Pantalla/componente

| Pantalla/componente | Problema | Fuente actual | Fuente correcta | Cambio propuesto |
|---|---|---|---|---|
| Listado de empresas (`Companies.tsx` ← `GET /companies`) | 🔴 Fórmula prohibida | `companyListBalanceSelect` (SQL crudo) | `SaldoDocumentado` | A.1 — sin cambio de contrato de API, solo backend |
| Dashboard (`TotalPays`, `YearCollectionPayments`, barras mensuales) | SUM ad-hoc duplicado, sin `voided_at` en las variantes con fecha | SQL propio | `DineroTotalRecibido` / `SumDineroTotalRecibido` | A.2 categorías 2 y 3 |
| Estado de cuenta (`CompanyStatement.tsx`) — `TotalPayments` y ledger completo | SUM manual + ledger sin `voided_at` | `pays` sin filtrar | `DineroTotalRecibido` / filtro en `pays` | A.2 cat. 1 + A.3 |
| Reporte financiero (`Reports.tsx`) | `TotalDocuments`/`TotalPayments` por fila y grandes totales | `companyTotalsForReport` ad-hoc | `DineroTotalRecibido` (sin fecha) / filtro (con fecha) | A.2 cat. 3 |
| Listado de pagos (`Payments.tsx`) | Sin columna/indicador de `Purpose` | — | `Payment.Purpose` | E.1 |
| Listado de pagos | Sin forma de ver pagos anulados | — | Nueva vista de auditoría | D |
| Detalle de deuda (`DocumentDebtDetailModal.tsx`) | Badge "Pagado" para `exonerado`; sin motivo/actor/fecha de baja | `documentDebtUi.ts:debtCollectionBadge` | `Document.Status` + `WriteoffReason/By/At` | E.2 |
| Liquidación (lista/detalle) | Sin resumen post-cascada de pagos anulados | — | — | Mejora no bloqueante, ver K (fuera del foco explícito de esta fase, no rediseñado aquí salvo que lo pidas) |

---

## C) Tabla — Endpoints/DTOs

| Endpoint | Problema | Cambio necesario | Impacto |
|---|---|---|---|
| `GET /api/companies` (y `/companies?page=...`) | Balance con fórmula prohibida | Backend: `company_service.go` (A.1) | Ninguno en el contrato JSON — `CompanyListItem.Balance` sigue siendo un `float64`, solo cambia cómo se calcula. Frontend no requiere cambios para este punto. |
| `GET /api/dashboard` | `TotalPays`/`YearCollectionPayments` duplicados | Backend: `dashboard_controller.go` (A.2) | Ninguno en el contrato — mismos campos, mismo tipo. |
| `GET /companies/:id/statement` | Ledger y `TotalPayments` sin `voided_at` | Backend: `finance_service.go` (A.2/A.3) | Ninguno en el contrato — el `Payments []Payment` que ya devuelve la respuesta (usado por `CompanyStatement.tsx` para las tablas "aplicados"/"a cuenta") también dejará de incluir pagos anulados, que es exactamente el comportamiento correcto. |
| `GET /api/reports/financial` | `total_documents_amount`/`total_payments_amount` duplicados | Backend: `report_controller.go`, `finance_financial_report.go` (A.2) | Ninguno en el contrato. |
| **`GET /api/payments`** | Debe seguir excluyendo anulados (ya lo hace) — **sin cambios** | — | — |
| **`GET /api/payments/voided` (NUEVO)** | No existe hoy ninguna vía de auditoría | Nuevo endpoint + servicio + DTO (ver D) | Nuevo, aditivo — no reemplaza ni modifica `GET /api/payments` |
| `frontend/src/types/dashboard.ts` — `Payment` | Sin `purpose`/`voided_at`/`voided_by`/`void_reason` | Agregar los 4 campos (opcionales) | Aditivo, no rompe ningún consumidor existente |
| `frontend/src/types/dashboard.ts` — `Document` | Sin `writeoff_reason`/`writeoff_by`/`writeoff_at` | Agregar los 3 campos (opcionales) | Aditivo |
| `backend/models/payment.go` | `VoidedBy` es `*uint` sin relación a `User` | Agregar `VoidedByUser *User gorm:"foreignKey:VoidedBy"` (mismo patrón que `TukifacFiscalReceipt.IssuedByUser`) | Aditivo, campo nuevo en el JSON (`voided_by_user`, omitido si nil) |
| `backend/models/document.go` | `WriteoffBy` es `*uint` sin relación a `User` | Agregar `WriteoffByUser *User gorm:"foreignKey:WriteoffBy"` (mismo patrón) | Aditivo |

---

## D) Diseño de auditoría de Payments anulados (decisión 2)

### D.1 — Backend

**Nuevo endpoint**: `GET /api/payments/voided`

- **RBAC**: decisión abierta (ver J.2) — recomendado un permiso nuevo y dedicado
  `rbac.PaymentsViewVoided` (grupo `ModFinanzas`, "Pagos", "Ver pagos anulados"), en vez de reutilizar
  `PaymentsView` (que hoy da acceso al listado normal) o `PaymentsDelete` (que es sobre la capacidad de
  anular, no de auditar). Es información sensible (quién anuló y por qué) — separarla permite otorgar
  ese acceso solo a quien realmente deba auditarlo, sin acoplarlo a "puede eliminar pagos".
- **Filtros**: `company_id`, `document_id` (si aplica), rango de fechas — **sobre `voided_at`**, no
  sobre `date` (el filtro relevante para una vista de auditoría es "cuándo se anuló", no "cuándo se
  pagó" — aunque se puede mostrar/filtrar por ambas fechas si lo prefieres, ver D.3), paginación (mismo
  patrón que `ListPaged`).
- **Servicio nuevo**: `PaymentService.ListVoided(params PaymentVoidedListParams, page, perPage int) ([]models.Payment, int64, error)`

```go
func (s *PaymentService) ListVoided(params PaymentVoidedListParams, page, perPage int) ([]models.Payment, int64, error) {
    base := database.DB.Unscoped().
        Model(&models.Payment{}).
        Where("voided_at IS NOT NULL") // explícito — no depender solo de deleted_at
    if params.CompanyID != 0 {
        base = base.Where("company_id = ?", params.CompanyID)
    }
    // ... resto de filtros (fecha de anulación, etc.)

    var total int64
    base.Count(&total)

    var list []models.Payment
    base.
        Preload("Company").
        Preload("Document").                                    // legacy, nunca se limpia al anular
        Preload("TaxSettlement").                                // Payment.TaxSettlementID no se limpia al anular
        Preload("VoidedByUser").                                 // nuevo, ver C
        Preload("Allocations", func(db *gorm.DB) *gorm.DB {
            return db.Unscoped()                                 // las allocations quedan soft-deleted al anular
        }).
        Preload("Allocations.Document").
        Order("voided_at DESC").
        Limit(perPage).Offset((page-1)*perPage).
        Find(&list)
    return list, total, nil
}
```

**Por qué `.Unscoped()` es correcto aquí y no introduce riesgo** (ya se demostró en el Gate de Fase 6
para el caso análogo de `DeletePaymentTx`): este es el ÚNICO lugar del sistema donde se usa
`Unscoped()` sobre `Payment` para LECTURA, y su `Where("voided_at IS NOT NULL")` es una condición
excluyente y explícita — nunca puede devolver un pago activo, ni mezclarse con el resultado de
`List`/`ListPaged` (que jamás usan `Unscoped()`). Las dos rutas son estructuralmente incapaces de
solaparse.

**Comprobante relacionado** — aclaración de diseño, no requiere código adicional: al anular,
`DeletePaymentTx` (Fase 6, comportamiento ya aprobado, no se toca) desvincula el comprobante
(`linked_payment_id = nil`, vuelve a `pendiente_vincular`). Esto significa que, para un pago anulado, **no
existe hoy un vínculo recuperable al comprobante que alguna vez tuvo** — el campo "comprobante
relacionado" en la vista de auditoría debe mostrar explícitamente **"Se desvinculó al anular"** en vez
de intentar reconstruir el vínculo (por ejemplo parseando el patrón `local-pay<id>-...`/`local-pc<id>-...`
del `ExternalID` — deliberadamente rechazado por frágil e indocumentado). Es información honesta y
coherente con el diseño ya aprobado de Fase 6, no una limitación de este Paso 2.

**Deuda/liquidación relacionada**: sí se puede mostrar con datos reales, sin inventar nada:
- Vía legacy: `Payment.Document` (el campo `DocumentID` nunca se limpia al anular).
- Vía moderna: `Payment.Allocations` con `.Unscoped()` — las filas de `PaymentAllocation` quedan
  soft-eliminadas (no destruidas) al anular, así que siguen siendo consultables y cuentan la historia
  real de a qué documento(s) se había aplicado el dinero antes de anularse.
- Liquidación: `Payment.TaxSettlementID`/`Payment.TaxSettlement` — tampoco se limpia al anular (solo se
  limpia `Document.tax_settlement_id`, y solo si ningún otro pago activo lo sostiene — Fase 6 §19.5).

### D.2 — Frontend

**Nueva pantalla/sección separada** — NO una pestaña/filtro dentro de `Payments.tsx` que pueda
confundirse visualmente con la lista activa. Recomendado: una ruta propia,
`/payments/voided` o una sección claramente separada dentro de la misma página pero con su propio
encabezado ("Pagos anulados — auditoría"), nunca mezclada en la misma tabla que los pagos activos —
esto es exactamente lo que pides explícitamente ("no debe mezclarse"). Decisión de UX final (ruta propia
vs. sección) queda abierta para Paso 3 (ver J.3), ambas opciones cumplen el requisito de no-mezcla.

**Columnas mínimas** (exactamente lo pedido):

| Columna | Campo |
|---|---|
| Monto | `payment.amount` |
| Fecha del pago | `payment.date` |
| Fecha de anulación | `payment.voided_at` |
| Anulado por | `payment.voided_by_user?.name` (fallback: `"Usuario #" + voided_by` si el usuario fue eliminado) |
| Motivo | `payment.void_reason` |
| Propósito | `payment.purpose` (badge "Deuda"/"Servicio"/"Sin clasificar" — ver E.1) |
| Método / Referencia | `payment.method` / `payment.reference` |
| Comprobante relacionado | "Se desvinculó al anular" (siempre, ver D.1) |
| Deuda / Liquidación | `payment.document?.number` y/o cada `allocation.document?.number`; `payment.tax_settlement?.number` |

**Indicación visual obligatoria** (pides explícitamente que "quede claro que es un Payment ANULADO"):
- Badge/etiqueta persistente tipo "ANULADO" en cada fila (no solo el hecho de estar en una pantalla
  separada — debe ser inequívoco incluso si se comparte un enlace directo a una fila).
- **Sin ninguna acción de pago activo disponible**: nada de "Editar", "Eliminar", "Aplicar a deuda",
  "Emitir comprobante" — la fila es de solo lectura. Ningún botón de acción en absoluto, o a lo sumo un
  ícono de "ver detalle" que abra un modal de solo-lectura con los mismos campos ampliados.

**Tipo TypeScript nuevo** (no reutilizar `Payment` para no arriesgar que algún componente existente
trate un registro anulado como si fuera uno activo por error de tipo):

```typescript
export interface VoidedPayment extends Omit<Payment, 'voided_at' | 'voided_by' | 'void_reason'> {
  voided_at: string;       // siempre presente aquí (a diferencia de Payment, donde es opcional/ausente)
  voided_by: number;
  voided_by_user?: { id: number; name: string };
  void_reason: string;
}
```

---

## E) Diseño visual/semántico de Purpose y estados de deuda

### E.1 — Purpose (decisión 3)

**Regla de representación** (aplica a `Payments.tsx` y a la nueva vista de auditoría D):
un badge INDEPENDIENTE del badge de `Type`, nunca fusionados en una sola etiqueta:

| `Purpose` | Etiqueta | Color sugerido |
|---|---|---|
| `"deuda"` | "Deuda" | mismo tono que usa hoy "aplicado" (coherencia con Type=applied, son conceptos relacionados pero distintos) |
| `"servicio"` | "Servicio" | tono distinto, p. ej. púrpura/índigo — para diferenciarlo claramente de los badges de Type (slate/primary) |
| `null` | "Sin clasificar" | gris neutro — igual de explícito que los otros dos, nunca se omite ni se infiere |

**Regla explícita para evitar la confusión Type/Purpose que señala el punto 3**: en cualquier pantalla
que muestre ambos, van en columnas/badges separados y con etiquetas de columna distintas — "Tipo"
(Type: Aplicado/A cuenta) y "Propósito" (Purpose: Deuda/Servicio/Sin clasificar) — nunca un solo
badge combinado ni un texto que mezcle ambos conceptos en una frase.

**Decisión abierta** (ver J.4): ¿el formulario manual de creación de pago (`PaymentForm.tsx`) debe
ganar un selector de `Purpose`, o Fase 7 se limita a *mostrar* el valor ya existente (que hoy solo lo
fijan los flujos POS/comprobante de Fases 4-5, y queda `null` para el resto)? Lo señalo explícitamente
porque agregar el selector es un cambio de flujo de creación, no solo de visualización — mayor alcance
que "UI y reportes" tal como se planteó el pedido. Recomendado para Paso 3: solo mostrar (no agregar
selector todavía), dejando la clasificación en creación como una decisión de un futuro paso si se
decide que hace falta.

### E.2 — Estados de deuda / write-off (decisión 4)

**Estado visual nuevo, distinto de "Pagado" y de "Anulado"** en `documentDebtUi.ts:debtCollectionBadge`:

```
if (st === 'exonerado') {
  return { label: 'Exonerado', className: 'bg-purple-50 text-purple-800 border-purple-200' };
}
if (st === 'anulado') { ... } // sin cambios, ya existe
if (st === 'pagado' || balance <= 0.005) { ... } // sin cambios — pero ahora 'exonerado' nunca llega aquí porque se atrapa antes
```

La rama de `exonerado` debe evaluarse **antes** que la de `pagado`/`balance<=0.005` (igual que hoy
`anulado` ya se evalúa primero) — es la corrección mínima y exacta del bug encontrado en Paso 1.

**Información de auditoría a mostrar** (en `DocumentDebtDetailModal.tsx`, visible para cualquier
documento con `status IN ('exonerado','anulado')` que tenga `writeoff_at` no nulo):

| Campo | Fuente |
|---|---|
| Motivo | `document.writeoff_reason` |
| Usuario | `document.writeoff_by_user?.name` (fallback igual que D.2) |
| Fecha | `document.writeoff_at` |

Sección claramente etiquetada, p. ej. "Esta deuda fue exonerada/anulada" con los 3 datos — mismo
patrón visual que se recomienda para el detalle de pago anulado (D.2), por consistencia entre pantallas.

**`documentCanReceivePayment`**: agregar el chequeo explícito de `exonerado` (hoy solo excluye
`anulado`/`pagado` y depende indirectamente de que `balance_amount` sea 0) — para que la razón de
"no se puede pagar" quede basada en el estado real, no en un efecto colateral del monto.

---

## F) Diseño de reportes/ledger

Ya cubierto en detalle en A.2/A.3. Resumen de la regla general aplicada uniformemente: **todo sitio que
calcule un total de dinero recibido/aplicado debe leer de `DineroTotalRecibido`/`DineroAplicadoADeudas`/
`DineroNoAplicado`/`SaldoDocumentado` (directamente, o agregando esa función sobre varias empresas con
el mismo patrón ya establecido) — nunca reimplementar el `SUM`.** La única excepción legítima es
cuando se necesitan **líneas individuales** (el ledger, el historial de pagos) en vez de un escalar — ahí
la corrección es agregar el filtro `voided_at IS NULL` directamente a la consulta que arma esas líneas,
no forzar el uso de una función que devuelve un solo número.

`SaldoDocumentado` **no se toca en ningún sitio** — confirmado que ningún hallazgo de Paso 1 lo
involucra.

---

## G) Archivos exactos que se modificarían en Paso 3

**Backend:**
- `backend/services/company_service.go` — A.1 (🔴 crítico)
- `backend/services/debt/financial_totals.go` — nueva `SumDineroTotalRecibido` (A.2 cat. 2)
- `backend/services/finance_service.go` — `GetCompanyBalance`, `GetCompanyStatement` (A.2 cat. 1, A.3)
- `backend/services/finance_financial_report.go` — `companyTotalsForReport` (A.2 cat. 3)
- `backend/controllers/report_controller.go` — `FinancialSummaryAPI` (A.2 cat. 2)
- `backend/controllers/dashboard_controller.go` — ambas variantes (A.2 cat. 2 y 3)
- `backend/models/payment.go` — `VoidedByUser` (C)
- `backend/models/document.go` — `WriteoffByUser` (C)
- `backend/services/payment_service.go` — nuevo `ListVoided` + `PaymentVoidedListParams` (D.1)
- `backend/controllers/payment_controller.go` — nuevo `ListVoidedAPI` (D.1)
- `backend/routes/routes.go` — nueva ruta `GET /api/payments/voided` (D.1)
- `backend/rbac/codes.go` + `backend/rbac/registry.go` — nuevo permiso (D.1, si se aprueba J.2)

**Frontend:**
- `frontend/src/types/dashboard.ts` — campos nuevos en `Payment`/`Document`, nuevo tipo `VoidedPayment` (C, D.2)
- `frontend/src/services/payments.ts` — nuevo método `listVoided(...)`
- Nueva pantalla/sección de pagos anulados (archivo nuevo, p. ej. `pages/PaymentsVoided.tsx`, o sección
  dentro de `Payments.tsx` — decisión J.3)
- `frontend/src/pages/Payments.tsx` — badges de `Purpose` (E.1)
- `frontend/src/utils/documentDebtUi.ts` — rama `exonerado` en `debtCollectionBadge` y
  `documentCanReceivePayment` (E.2)
- `frontend/src/components/DocumentDebtDetailModal.tsx` — sección de auditoría write-off (E.2)

**No se toca ningún archivo de Fases 1-6 fuera de los listados arriba** (en particular: `DeletePaymentTx`,
`WriteOffUnlinkedDebt`, `ApplyPaymentTx`, `RevertSettlementDebtLinksTx`, las 4 funciones oficiales en sí
— solo se les agrega UNA función nueva puramente aditiva, `SumDineroTotalRecibido` — y `TaxSettlementLine`
permanece intocada).

---

## H) Orden recomendado de implementación (Paso 3)

1. **A.1 primero y aislado** (`company_service.go`) — es el único bloqueante; puede cerrarse y
   verificarse independientemente del resto, sin esperar a ningún otro punto.
2. **A.2/A.3** (duplicación de totales + ledger) — un grupo cohesivo, mismo tipo de cambio repetido en
   varios archivos; conviene hacerlo junto porque comparte el mismo test de regresión (verificar que
   los totales no cambian para datos sin pagos anulados, y sí cambian correctamente cuando los hay).
3. **C — campos nuevos en modelos** (`VoidedByUser`, `WriteoffByUser`) — prerrequisito de D y E.2.
4. **D — auditoría de pagos anulados** (backend primero, endpoint + servicio; frontend después).
5. **E.1/E.2 — Purpose y estados de write-off en UI** — puramente de presentación, sin dependencias
   nuevas más que los tipos TS ya extendidos en el paso anterior.
6. **DTOs de frontend** (`types/dashboard.ts`) pueden extenderse en paralelo con el paso 3, ya que son
   aditivos y no bloquean nada.

---

## I) Tests necesarios para Paso 3

**Backend:**
1. `CompanyService.List`/`ListPaged` — el `Balance` devuelto coincide exactamente con
   `SaldoDocumentado` para un escenario con deuda + pago de servicio + pago parcial (mismo caso de
   prueba ya usado en Fase 3 para demostrar que la fórmula vieja daba un número distinto/negativo).
2. `GetCompanyBalance`/`GetCompanyStatement`/`GetFinancialReportRows`/`FinancialSummaryAPI`/Dashboard —
   un pago anulado no debe contarse en `TotalPayments`/`total_payments_amount`/`TotalPays` (hoy no hay
   ningún test que lo verifique porque estos campos nunca se tocaron en el Gate de Fase 6, que solo
   testeó las 4 funciones oficiales).
3. Estado de cuenta — el ledger (`saldo_anterior`/`total_abonos`/`total_cargos`/`saldo_final`/cada
   movimiento) excluye un pago anulado; un pago activo del mismo periodo sí aparece.
4. `PaymentService.ListVoided` — devuelve únicamente pagos con `voided_at IS NOT NULL`; nunca devuelve
   un pago activo; filtra correctamente por empresa; incluye `VoidedByUser`/`Document`/`Allocations`
   (con `.Unscoped()`)/`TaxSettlement` cuando corresponde.
5. `PaymentService.List`/`ListPaged`/`GetByID` (regresión) — siguen excluyendo pagos anulados (ya
   garantizado por el scope de GORM, pero vale un test explícito ahora que existe una ruta paralela que
   sí los expone, para dejar constancia de que nunca se cruzan).
6. `WriteOffUnlinkedDebt` (regresión, sin cambios de lógica) — sigue bloqueando/permitiendo exactamente
   igual que en el Gate de Fase 6; solo se agrega verificación de que `WriteoffByUser` se puede
   precargar correctamente tras el cambio de modelo.

**Frontend** (si el proyecto tiene suite de tests de componentes — a confirmar en Paso 3; si no, verificación manual dirigida):
7. `debtCollectionBadge('exonerado', balance=0)` → `"Exonerado"`, nunca `"Pagado"`.
8. `documentCanReceivePayment` → `false` para `status='exonerado'` independientemente del balance.

---

## J) Riesgos y decisiones abiertas (requieren tu aprobación antes de Paso 3)

**J.1 — ¿Extender la firma de `DineroTotalRecibido` con un rango de fechas opcional, o dejarla
intocada y solo agregar `voided_at IS NULL` a las consultas ad-hoc con fecha (recomendado)?**
Extenderla eliminaría por completo la duplicación de fórmula también en los sitios con rango de fechas,
pero técnicamente modifica un archivo que Fase 3 entregó como cerrado. Recomendado: dejarla intocada
en este Paso 3 (Opción B de A.2 categoría 3) y revisar la extensión en una fase posterior si se decide
que vale la pena. **¿Confirmas Opción B?**

**J.2 — RBAC para `GET /api/payments/voided`: ¿permiso nuevo dedicado (`PaymentsViewVoided`,
recomendado) o reutilizar `PaymentsDelete`?** Un permiso nuevo permite separar "quién puede auditar
anulaciones" de "quién puede anular pagos" — más flexible, pero es un permiso nuevo a dar de alta y
asignar a los roles correspondientes (probablemente solo Admin/Estudio por ahora, igual que hoy exige
`hasStudioScope` para anular). **¿Apruebas el permiso nuevo, o prefieres reutilizar `PaymentsDelete` para
no crear un permiso adicional?**

**J.3 — Ubicación de la vista de auditoría: ¿ruta propia (`/payments/voided`) o sección separada dentro
de `Payments.tsx`?** Ambas cumplen "no debe mezclarse". Una ruta propia es más clara y fácil de
restringir por permiso; una sección dentro de la misma página es más descubrible. **¿Tienes
preferencia, o lo dejamos a mi criterio de implementación en Paso 3 dentro de estas dos opciones?**

**J.4 — ¿El formulario manual de creación de pago debe ganar un selector de `Purpose`?** Recomendado:
no en este Paso 3 (alcance de Fase 7 es UI/reportes de lo ya existente, no flujos de creación) — dejarlo
como una decisión de un paso/fase posterior si se decide que los pagos manuales también deben
clasificarse en el momento de creación. **¿Confirmas que se excluye del alcance de Paso 3?**

**J.5 — Rendimiento de `A.1`** (N consultas en vez de 1 para el listado de empresas sin paginar): no
bloqueante, mismo patrón ya aceptado en el resto del sistema, pero señalado por transparencia — no
requiere tu decisión, solo tu conocimiento del trade-off.

---

## K) Clasificación de cambios

🔴 **BLOQUEANTE** (debe ir en Paso 3, sin negociación):
- A.1 — `company_service.go`, fórmula prohibida.

🟢 **NECESARIOS** (no bloquean el sistema hoy, pero son lo que efectivamente pediste corregir):
- A.2 (duplicación de totales, las 3 categorías)
- A.3 (ledger sin `voided_at`)
- D (auditoría de pagos anulados completa — backend + frontend)
- E.1 (Purpose visible, solo lectura)
- E.2 (badge `exonerado` + auditoría de write-off)
- C (campos DTO nuevos que sostienen todo lo anterior)

🟠 **MEJORAS NO BLOQUEANTES** (mencionadas en el pedido/auditoría pero no bloqueadas por nada anterior,
candidatas a incluir en Paso 3 si el tiempo lo permite, o a diferir sin costo):
- Resumen post-cascada de pagos anulados en pantallas de liquidación (mencionado en Paso 1 E, no
  rediseñado en detalle aquí porque no apareció en tus 8 puntos de instrucción — señalo que sigue
  pendiente de una decisión tuya si quieres incluirlo).

🔵 **DEUDA TÉCNICA FUTURA** (documentada, explícitamente NO se implementa en Fase 7):
- A.4 — bug de una línea en `audit.go:211` (candidato: corregir junto con cualquier trabajo futuro sobre
  `/api/reports/debts`, no amerita fase propia).
- A.5 — falta de guard de edición sobre deuda con write-off (candidato: parche puntual a Fase 6,
  `document_service.go:Update`, no relacionado con "UI y reportes").

---

Ningún archivo fue modificado en este paso. A la espera de tu resolución de J.1-J.4 antes de pasar a
Fase 7 — Paso 3 (implementación).
