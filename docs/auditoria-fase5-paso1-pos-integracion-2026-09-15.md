# Fase 5 — Paso 1: Auditoría y plan de integración POS

Fecha: 2026-09-15
Estado: **auditoría + plan únicamente — sin cambios de código, sin commit**
Fuente principal: [docs/blueprint-financiero-definitivo-2026-09-14.md](blueprint-financiero-definitivo-2026-09-14.md) §17-18
Insumo directo: [docs/auditoria-fase4-comprobantes-payments-2026-09-15.md](auditoria-fase4-comprobantes-payments-2026-09-15.md) (Fase 4 Paso 1)
Infraestructura disponible (Fase 4 Paso 2, sin commit todavía): `Payment.Purpose`, `FiscalReceiptIssueService.CreatePaymentWithComprobante`

---

## 1. Flujo actual completo de `IssuePosSale`

**Entrada**: `POST /pos/sales` (permiso `rbac.SalesEmit`) → `PosSaleController.IssueAPI` (`controllers/pos_sale_controller.go:43-58`) → hace bind de `services.PosSaleIssueInput` desde el body, resuelve `allowPrice := ctrl.hasPerm(c, rbac.SalesLinePriceEdit)` → `ctrl.svc.IssuePosSale(uid, body, allowPrice)`.

**Servicio** (`services/pos_sale_service.go:284-405`, `IssuePosSale`):

```
1. Valida kind ∈ {boleta, factura, sale_note}.
2. Valida CompanyID != 0.
3. Valida acceso del usuario a la empresa (CanAccessCompany) — si no tiene acceso directo,
   permite igual si la empresa está status='activo' (alcance comercial POS, más laxo que Finanzas).
4. Resuelve SeriesID: si no vino explícito, busca la primera serie activa cuyo SunatCode
   coincida con el kind pedido.
5. Valida que la serie encontrada/indicada tenga el SunatCode correcto para el kind.
6. computeLines(in.Lines, allowPriceEdit) → líneas desde catálogo (Product) o manuales,
   calcula subtotal/tax/total.
7. Valida total > 0.
8. normalizePosPayments(&in, total) → valida SUM(métodos) == total (±0.02), arma
   []FiscalReceiptPayment + headerMethod + headerRef.
9. Carga Company.
10. ReserveNextNumber(seriesID) — EN SU PROPIA TRANSACCIÓN, fuera de la principal.
11. Resuelve issueDate, docType (fuerza "NV" si kind=sale_note y el código SUNAT de la
    serie es "00").
12. Construye TukifacFiscalReceipt { Origin: pos_sale, ReconciliationStatus: Pending,
    IssuedByUserID, PaymentMethod/Reference de la cabecera, SIN LinkedPaymentID }.
13. TRANSACCIÓN: crea el receipt + cada línea + cada FiscalReceiptPayment. NADA MÁS.
14. Recarga el receipt con sus preloads y lo retorna.
```

**No hay ningún paso posterior automático.** El comprobante queda `Pending`, sin `Payment`, esperando reconciliación manual (§5 más abajo).

---

## 2. Diagrama actual

```
Cliente POS (frontend/Android/Tauri)
        │
        ▼
POST /pos/sales  { kind, company_id, lines[], payments[], payment_method, payment_reference }
        │
        ▼
PosSaleController.IssueAPI
        │
        ▼
PosSaleService.IssuePosSale
        │
        ├─ computeLines()            (catálogo/manual, sin BD fuera de lectura de Product)
        ├─ normalizePosPayments()    (cálculo puro, sin BD)
        ├─ ReserveNextNumber()       (TRANSACCIÓN PROPIA #1 — ya confirmada al volver)
        │
        ▼
   TRANSACCIÓN #2 (database.DB.Transaction)
        │
        ├─ TukifacFiscalReceipt.Create   (Origin=pos_sale, ReconciliationStatus=Pending)
        ├─ FiscalReceiptLine.Create × N
        └─ FiscalReceiptPayment.Create × N
        │
        ▼
   COMMIT — el comprobante queda "Pending", SIN Payment, SIN LinkedPaymentID
        │
        │   (── AQUÍ TERMINA HOY. No hay paso automático posterior. ──)
        │
        ▼  (acción manual separada, en otro momento, por otro usuario/endpoint)
FiscalReceiptService.CreatePaymentFromReceipt  o  LinkReceiptToPayment
        │
        ▼
   Payment nace (o se vincula uno existente) — Purpose SIEMPRE NULL hoy
```

---

## 3. Evidencia exacta del bug actual (POS crea comprobante pero no Payment)

Código completo de la única transacción de `IssuePosSale` (`services/pos_sale_service.go:378-397`):

```go
err = database.DB.Transaction(func(tx *gorm.DB) error {
    if e := tx.Create(&rec).Error; e != nil {
        return e
    }
    for i := range computed {
        ln := computed[i].line
        ln.FiscalReceiptID = rec.ID
        if e := tx.Create(&ln).Error; e != nil {
            return e
        }
    }
    for i := range paymentRows {
        p := paymentRows[i]
        p.FiscalReceiptID = rec.ID
        if e := tx.Create(&p).Error; e != nil {
            return e
        }
    }
    return nil
})
```

**No hay ninguna línea `tx.Create(&models.Payment{...})` ni en esta transacción ni en ningún otro punto de todo el archivo `pos_sale_service.go`** — confirmado por búsqueda exhaustiva (`grep "models.Payment{"` → cero coincidencias en este archivo). El literal `rec := models.TukifacFiscalReceipt{...}` (línea 357-376) construido justo antes de la transacción fija explícitamente:

```go
ReconciliationStatus: models.TukifacReceiptPending,
```

y **no incluye ningún campo `LinkedPaymentID`** (queda en su valor cero, `nil`, por ausencia). Tras el `COMMIT`, una consulta `SELECT * FROM payments WHERE ...` para esa venta no devuelve absolutamente nada — el `Payment` no existe en ningún momento del flujo `IssuePosSale`. Bug confirmado con evidencia de código, no por referencia al Blueprint.

---

## 4. Cómo funciona actualmente `CreatePaymentFromReceipt`

(`services/fiscal_receipt_service.go:145-183`, ya auditada en Fase 4 Paso 1 — releída de nuevo para este paso, sin cambios desde entonces)

```go
func (s *FiscalReceiptService) CreatePaymentFromReceipt(receiptID uint, in ReceiptPaymentInput) error {
    var rec models.TukifacFiscalReceipt
    database.DB.First(&rec, receiptID)
    if rec.ReconciliationStatus != models.TukifacReceiptPending {
        return errors.New("el comprobante no está pendiente de vincular")
    }
    pay := NewPaymentService()
    params := PaymentCreateParams{
        CompanyID: rec.CompanyID, Amount: rec.Total, Date: time.Now(), Type: "applied",
        Method: in.Method, Reference: in.Reference, ..., AllocationMode: in.AllocationMode,
        Allocations: in.Allocations, FiscalStatus: "linked", AllowUnallocatedRemainder: true,
        TaxSettlementID: in.TaxSettlementID,
    }
    payID, err := pay.CreateFromParams(&params)
    rec.ReconciliationStatus = models.TukifacReceiptLinked
    rec.LinkedPaymentID = &payID
    return database.DB.Save(&rec).Error
}
```

- **Amount**: `rec.Total` (el total del comprobante ya emitido, no un valor nuevo).
- **Method/Reference**: los que el llamador de ESTE endpoint decide pasar en `ReceiptPaymentInput` — **no** reutiliza `rec.PaymentMethod`/`rec.PaymentReference` (los que ya guardó `IssuePosSale`); puede divergir del método original de la venta.
- **Type**: `"applied"` fijo, con `AllocationMode`/`Allocations` que el llamador puede pasar — esta función asume que se quiere **aplicar** el dinero a una o más deudas (`Document`), no que es un ingreso independiente.
- **Purpose**: **no se fija** — confirmado (búsqueda exhaustiva, cero menciones de `Purpose` en todo el archivo, incluso después de que Fase 4 Paso 2 agregó el campo a `PaymentCreateParams`). Un pago reconciliado hoy desde un comprobante POS pendiente **sigue naciendo con `Purpose = NULL`**.
- **Allocations**: sí puede crearlas, si el llamador las pasa — es decir, esta función asume implícitamente que el dinero de un comprobante pendiente **debe aplicarse a una deuda**, contradictorio con la naturaleza "servicio independiente" que en realidad tiene una venta POS normal.
- **`fiscal_status`**: se fija a `"linked"` en el propio `Payment`.
- **`LinkedPaymentID`**: se escribe, pero en un `database.DB.Save(&rec)` **separado** de la transacción interna de `CreateFromParams` — no atómico (ya señalado como bug en Fase 4 Paso 1, sin corregir).
- **¿Puede crear un Payment duplicado?** Si se invoca dos veces casi simultáneamente sobre el mismo `receiptID`, ambas lecturas iniciales pueden ver `ReconciliationStatus == Pending` (sin lock), ambas crean un `Payment`, y la segunda en escribir `Save(&rec)` "gana" — dejando el primer `Payment` creado huérfano (sin ningún comprobante que lo referencie) y compartiendo el mismo problema de ausencia de atomicidad ya documentado. **Sí puede ejecutarse dos veces** sin ninguna protección adicional a nivel de aplicación (más allá del chequeo de estado, vulnerable a la carrera descrita).

---

## 5. Tabla: campo actual POS → `PaymentWithComprobanteInput`

| Campo actual POS | Fuente en `IssuePosSale` hoy | → `PaymentWithComprobanteInput` | Nota |
|---|---|---|---|
| Empresa | `in.CompanyID` (validado contra acceso/estado) | `CompanyID` | Directo |
| Tipo de comprobante | `in.Kind` (boleta/factura/sale_note) | `Kind` | Directo |
| Serie | `seriesID` resuelto (explícito o autodetectado) | `SeriesID` | Directo — la autodetección de serie por defecto debe seguir ocurriendo ANTES de construir el input (es lógica de POS, no de la infraestructura genérica) |
| Origen | Constante `models.TukifacReceiptOriginPOS` | `Origin` | Directo, ya existe como constante |
| — | **No existe hoy en ningún lado** | `Purpose` | **GAP** — debe fijarse explícitamente `models.PaymentPurposeService` en el código de POS que arme el input (nunca inferido dentro de la infraestructura, según diseño de Fase 4) |
| Monto | `total` (de `computeLines`) | `Amount` | Directo |
| Fecha | `time.Now()` implícito (no se fija explícitamente en `rec.IssueDate`, sino `issueDate := time.Now().In(fiscalPeruTZ())`) | `Date` | Directo, mismo criterio |
| Método (cabecera) | `headerMethod` (de `normalizePosPayments`) | se recalcula igual dentro de `CreatePaymentWithComprobante` — no se pasa como dato ya calculado | `Method`/`Payments` — ver §7 |
| Referencia | `headerRef` | idem | `Reference`/`PaymentReference` |
| Desglose de pagos | `in.Payments []PosSalePaymentInput` | `Payments []PosSalePaymentInput` | **Tipo idéntico ya reutilizado** — sin conversión |
| Líneas | `computed []posLineComputed` (envoltorio de `models.FiscalReceiptLine`) | `Lines []PaymentWithComprobanteLine` | Requiere **mapeo mínimo** campo a campo (mismos nombres, tipo envoltorio distinto) — ver §6 |
| Descripción del pago | No existe un campo equivalente hoy (POS no tiene "Description" de Payment) | `Description` | **GAP menor** — dejar vacío o derivar un texto genérico ("Venta POS") en el punto de integración, sin inventar semántica nueva |
| Notas | `in.Notes` | `Notes` | Directo |

---

## 6. Mapeo de líneas

`computeLines` ya devuelve `[]posLineComputed{ line models.FiscalReceiptLine }` con **todos** los campos que `PaymentWithComprobanteLine` espera (`LineType, ProductID, ProductName, Description, InternalCode, UnitTypeID, Quantity, UnitPrice, LineSubtotal, IGVRate, IGVAmount, LineTotal`) — mismos nombres, mismos tipos. El mapeo en Paso 2 es una conversión 1:1 campo por campo (no un recálculo). **No se debe usar `BuildReceiptLinesFromPayment`** para POS — esa función lee `pay.Allocations.Document.Items` (confirmado en la auditoría de Fase 4 Paso 1), estructuralmente incompatible con un `Payment` sin allocations; POS ya tiene su propio origen de líneas (catálogo/manual vía `computeLines`), correcto y suficiente.

---

## 7. Mapeo de métodos de pago

`normalizePosPayments(in *PosSaleIssueInput, saleTotal float64) ([]models.FiscalReceiptPayment, headerMethod string, headerRef string, error)` ya es la única normalización, y **ya la reutiliza `CreatePaymentWithComprobante`** (confirmado en el código de Fase 4 Paso 2: construye internamente su propio `&PosSaleIssueInput{Payments, PaymentMethod, PaymentReference}` y llama a esta misma función). Esto significa que **en Paso 2, POS no debe llamar a `normalizePosPayments` por su cuenta ni pasar `headerMethod`/`headerRef` ya calculados** — debe pasar los datos crudos (`in.Payments`, `in.PaymentMethod`, `in.PaymentReference`) tal cual en `PaymentWithComprobanteInput.Payments/Method/PaymentReference`, y dejar que `CreatePaymentWithComprobante` haga el único cálculo, exactamente como ya lo hace para su propio flujo genérico. **No debe haber dos llamadas a `normalizePosPayments`** (una en `IssuePosSale` actual y otra dentro de `CreatePaymentWithComprobante`) — Paso 2 debe **eliminar** la llamada directa que hoy existe en `IssuePosSale` (líneas 330 y 389-395 actuales), dejando que la infraestructura de Fase 4 la haga una sola vez.

---

## 8. Mapeo de Amount

Hoy, sin `Payment`, solo hay **una** fuente real: `total` (de `computeLines`), contra la cual `normalizePosPayments` valida `SUM(métodos) == total` (±0.02) y con la cual se construye `rec.Total`. No hay divergencia hoy porque no hay un tercer número (`Payment.Amount`) con el que comparar. **La decisión coherente para Paso 2**: `PaymentWithComprobanteInput.Amount = total` (el mismo valor, sin recalcular) — `CreatePaymentWithComprobante` ya revalida internamente que `SUM(Lines) == Amount` y `SUM(Payments) == Amount` (ambas ±0.03/±0.02), así que la validación de coherencia se conserva, ahora aplicada también sobre el monto que tendrá el `Payment`.

---

## 9. Mapeo de Purpose

**No existe ningún camino hoy donde POS fije `Purpose`** (confirmado, `IssuePosSale` no crea `Payment`). El punto exacto donde debe establecerse en Paso 2: en el código de integración dentro de (o inmediatamente antes de llamar a) `IssuePosSale`, al construir `PaymentWithComprobanteInput`, fijar literalmente:

```go
Purpose: models.PaymentPurposeService,
```

como decisión explícita y **hardcodeada** para el flujo POS normal — no derivada de `kind`, no derivada de `origin`, no derivada de ningún dato de la venta. Esto es exactamente lo que pide el Blueprint §17 y lo que ya soporta la infraestructura de Fase 4 (`PaymentWithComprobanteInput.Purpose` es un `string` obligatorio, validado por `models.IsValidPaymentPurpose`).

---

## 10. Mapeo de Origin

Ya existe como constante (`models.TukifacReceiptOriginPOS = "pos_sale"`), escrita hoy en un único lugar (`pos_sale_service.go:370`, confirmado por búsqueda exhaustiva — sin ningún origin paralelo). En Paso 2, simplemente: `Origin: models.TukifacReceiptOriginPOS`.

---

## 11-13. Nota de venta / boleta / factura

Los 3 casos comparten **exactamente el mismo código** en `IssuePosSale` — no hay ramas de flujo distintas, solo `kind` cambia el `SunatCode` esperado y si `docType` se sobrescribe a `"NV"`. La integración de Paso 2 no necesita ninguna lógica condicional adicional por tipo de comprobante: `Kind`/`SeriesID` ya viajan sin cambios a `PaymentWithComprobanteInput`, que internamente repite la misma resolución de `docType`/`SunatCode` que `IssuePosSale` ya hace hoy (confirmado, mismo patrón en ambos archivos). El comportamiento fiscal actual (serie, código SUNAT, `docType="NV"` para nota de venta) queda preservado sin ningún cambio de reglas — solo cambia qué función ejecuta la escritura.

---

## 14. Transacción actual

Dentro de `database.DB.Transaction(...)` de `IssuePosSale` hoy: `TukifacFiscalReceipt.Create`, `FiscalReceiptLine.Create` (×N), `FiscalReceiptPayment.Create` (×N). **Fuera**: `ReserveNextNumber` (su propia transacción, ya confirmada antes) y todas las validaciones/cálculos previos (sin escritura). Comparado con `CreatePaymentWithComprobante` (Fase 4 Paso 2): mismo patrón exacto de posición de `ReserveNextNumber` (fuera, antes), pero la transacción principal de la nueva infraestructura además incluye `Payment.Create` como primer paso — es decir, Paso 2 no inventa nada nuevo en materia transaccional, solo **reemplaza** la transacción actual (3 escrituras) por la de `CreatePaymentWithComprobante` (4 escrituras, incluyendo el Payment). No puede ocurrir "Payment COMMIT → Receipt FAIL" ni al revés porque ambos viven en la misma transacción de la infraestructura ya construida y probada en Fase 4 Paso 2 (rollback verificado empíricamente en ese paso).

---

## 15. Idempotencia / doble envío

**Qué existe hoy**: nada a nivel de aplicación. `PosSaleIssueInput` no tiene ningún campo `sale_id`/`order_id`/`idempotency_key` ni equivalente (confirmado, struct completo revisado). El único identificador único generado es `ExternalID`, pero se construye **dentro** del propio `IssuePosSale` a partir de `time.Now().UnixNano()` + el correlativo recién reservado (`fmt.Sprintf("pos-%d-%s", time.Now().UnixNano(), fullNumber)`) — es decir, se genera **después** de decidir procesar la venta, no es un identificador que el cliente POS envíe de antemano para poder deduplicar. Dos clics rápidos sobre "emitir venta" (doble click, retry de red, reconexión) generan **dos llamadas HTTP independientes**, cada una con su propio `ExternalID` único y su propio correlativo — el sistema no tiene forma de saber que son la "misma" venta lógica.

**Qué falta**: un identificador de idempotencia generado por el **cliente** (frontend/Android/Tauri) antes de enviar la venta, enviado en el payload, y verificado en el backend contra un valor ya usado (rechazar o devolver el mismo resultado si ya existe).

**Qué riesgo hay**: hoy (sin Payment) un doble envío produce **dos comprobantes** `Pending` para la misma venta real — molesto pero no gravemente peligroso (ambos requieren reconciliación manual, un humano puede detectarlo). **Después de Fase 5 Paso 2 (con Payment nativo), un doble envío produciría dos `Payment` reales, dos ingresos registrados para una sola venta real** — esto SÍ es un riesgo financiero directo y nuevo (agrava lo que hoy es solo un problema de datos duplicados a un problema de dinero duplicado). **No se diseña ninguna solución en este paso** — se documenta como riesgo real que Paso 2 debe decidir si aborda o si queda explícitamente diferido con una mitigación mínima (ver recomendación en el plan, §Plan Paso 2 más abajo).

---

## 16. Riesgos encontrados (consolidado)

1. 🔴 Doble envío puede duplicar ingresos reales una vez que POS cree `Payment` (§15) — el más importante a decidir antes/durante Paso 2.
2. 🟡 `CreatePaymentFromReceipt`/`LinkReceiptToPayment` no transaccionales (ya documentado en Fase 4 Paso 1, sin cambios) — deja de ser el camino que usará POS normal, pero sigue existiendo para otros orígenes (`tukifac_sync`, y POS excepcional — ver §16 del plan).
3. 🟡 `CreatePaymentFromReceipt` sigue sin fijar `Purpose` — si se le sigue llamando para reconciliar comprobantes `pos_sale` residuales (los ya emitidos antes de Paso 2, o casos excepcionales), esos pagos seguirán naciendo `Purpose=NULL`, no `servicio` — consistente con que esta función seguirá siendo el camino "genérico", pero deja una asimetría entre "POS nuevo" (con Purpose) y "reconciliación manual" (sin Purpose) que conviene documentar, no necesariamente corregir en Paso 2.

---

## 17-18. Qué se reutiliza / qué deja de usarse

**Se reutiliza sin cambios**: `computeLines` (líneas), `PosSaleLineInput`/`PosSalePaymentInput` (tipos de entrada), `PosSaleIssueInput` (DTO de request, sin cambios de forma), resolución de serie por defecto, validación de acceso a empresa, `ListPosSales`/`GetPosSaleDetail`/`ListCompaniesForPos` (lectura, no tocadas), `PosSaleController` casi entero (solo cambia lo que pasa internamente a `IssuePosSale`, no el contrato HTTP).

**Deja de usarse (para el flujo POS normal, sin eliminarse del código)**: la llamada directa a `normalizePosPayments` dentro de `IssuePosSale` (la hará `CreatePaymentWithComprobante`); la construcción manual del literal `models.TukifacFiscalReceipt{...}` y la transacción de 3 escrituras actual (la reemplaza la transacción de 4 escrituras de la infraestructura de Fase 4); `CreatePaymentFromReceipt`/`LinkReceiptToPayment` **dejan de ser invocadas por el flujo POS normal** — pero **no se eliminan ni se modifican**, siguen siendo necesarias para comprobantes que de verdad nazcan sin Payment (`tukifac_sync`, y cualquier comprobante POS legacy ya `Pending` de antes de Paso 2, que deberá poder reconciliarse igual que hoy).

---

## 19-20. Qué debe/no debe modificarse en Paso 2

**Debe modificarse** (solo esto): `PosSaleService.IssuePosSale` — reemplazar su bloque de construcción de `rec` + transacción de 3 escrituras por: preparar `PaymentWithComprobanteInput` (mapeo de §5-10, con `Purpose: models.PaymentPurposeService` fijo) + una llamada a `FiscalReceiptIssueService.CreatePaymentWithComprobante`. El resto de `IssuePosSale` (validaciones de acceso, resolución de serie, `computeLines`) permanece igual.

**No debe modificarse**: `pos_sale_controller.go` (el contrato HTTP no cambia — mismo `PosSaleIssueInput`, misma respuesta `*models.TukifacFiscalReceipt`), `PosSaleIssueInput`/`PosSaleLineInput`/`PosSalePaymentInput` (tipos ya suficientes, confirmado en §5), `computeLines`, `normalizePosPayments`, `CreatePaymentFromReceipt`/`LinkReceiptToPayment` (quedan intactas, para otros orígenes), frontend/Android/Tauri, rutas, permisos, modelos, migraciones.

---

## 21. Dependencias de Fase 5

Ninguna dependencia bloqueante nueva — toda la infraestructura que Paso 2 necesita ya existe y fue auditada línea por línea en este documento: `CreatePaymentWithComprobante`, `PaymentWithComprobanteInput`/`Line`, `models.IsValidPaymentPurpose`, `models.PaymentPurposeService`, `models.TukifacReceiptOriginPOS`. La única decisión pendiente de aprobación antes de implementar Paso 2 es cómo tratar el riesgo de doble envío (§15-16, punto 1) — no requiere código nuevo de infraestructura, es una decisión de alcance para Paso 2.

---

## 22. Tests / Build / Vet

```
go test ./... -count=1   → falla únicamente cmd/debt-audit (warning preexistente de vet,
                             documentado desde antes de Fase 2.4, no relacionado). Todos los
                             paquetes con tests → ok, sin cambios respecto al cierre de Fase 4.
go build ./...            → OK
go vet ./...                → mismo warning preexistente, único
```
No se crearon tests (temporales ni permanentes) en este paso — auditoría de solo lectura de código, sin necesidad de verificación empírica de comportamiento en runtime.

## 23. Estado final de git

`git status`/`git diff --stat` — **sin cambios respecto al inicio de este paso**: siguen pendientes únicamente los 4 archivos modificados + 2 nuevos de Fase 4 Paso 2 (sin commitear, como quedaron). Cero archivos nuevos ni modificados por esta auditoría.

---

# PLAN — FASE 5, PASO 2 (a aprobar, NO ejecutado)

**Alcance exclusivo**: modificar `PosSaleService.IssuePosSale` para que use `CreatePaymentWithComprobante` en vez de su transacción manual actual. Nada más.

```
IssuePosSale(userID, in, allowPriceEdit)
    │
    ├─ (sin cambios) validar kind, CompanyID, acceso a empresa
    ├─ (sin cambios) resolver seriesID por defecto si no vino, validar SunatCode
    ├─ (sin cambios) computed, subtotal, tax, total := computeLines(in.Lines, allowPriceEdit)
    ├─ (sin cambios) validar total > 0
    ├─ (NUEVO) mapear computed []posLineComputed → []PaymentWithComprobanteLine (1:1, §6)
    ├─ (NUEVO) construir PaymentWithComprobanteInput{
    │        CompanyID: in.CompanyID,
    │        Kind: kind,
    │        SeriesID: seriesID,
    │        Origin: models.TukifacReceiptOriginPOS,
    │        Purpose: models.PaymentPurposeService,   ← fijo, explícito, nunca inferido
    │        Amount: total,
    │        Method: in.PaymentMethod,
    │        Reference: "",
    │        PaymentReference: in.PaymentReference,
    │        Payments: in.Payments,
    │        Lines: <mapeadas>,
    │        Notes: in.Notes,
    │      }
    ├─ (NUEVO) rec, err := fiscalReceiptIssueService.CreatePaymentWithComprobante(input)
    │        — reemplaza: normalizePosPayments() + ReserveNextNumber() + construcción manual
    │          de TukifacFiscalReceipt + database.DB.Transaction(3 escrituras)
    └─ (sin cambios) recargar/retornar el receipt
```

**Campos que ya NO se calculan a mano en `IssuePosSale`** tras Paso 2: `paymentRows`/`headerMethod`/`headerRef` (los calcula `CreatePaymentWithComprobante` internamente), `fullNumber`/`issuedNumber` (la reserva la hace la infraestructura), el literal `models.TukifacFiscalReceipt{...}` completo, y la transacción de 3 escrituras.

**Sobre idempotencia (hallazgo §15-16, punto 1)** — dos alternativas para que decidas antes de implementar Paso 2, **sin diseñarlas todavía en detalle**:
- (a) Diferir explícitamente: implementar Paso 2 sin guard de idempotencia (mismo riesgo que existe hoy, solo que ahora sobre `Payment` en vez de solo sobre comprobantes), documentado como deuda técnica a resolver en un Paso 3 dedicado.
- (b) Incluir en Paso 2 un guard mínimo: agregar un campo opcional al request (`sale_client_ref` o similar) que, si viene informado, se use como parte de un `ExternalID` determinista para que un reintento con el mismo valor colisione contra el `uniqueIndex` de `TukifacFiscalReceipt.ExternalID` ya existente (mismo mecanismo que ya protege `IssueComprobanteFromPayment`/`CreatePaymentWithComprobante` contra colisiones, reutilizado como guard en vez de solo como efecto secundario) — esto SÍ tocaría el DTO `PosSaleIssueInput` (un campo nuevo opcional) y el frontend/Android/Tauri (para generarlo), por lo que excede el "no modificar frontend" de este documento si se decide — quedaría para un Paso 2b o Paso 3 separado.

Recomiendo **(a)** para mantener Paso 2 estrictamente acotado a "conectar POS con la infraestructura de Fase 4" (tu propio criterio de alcance), y tratar la idempotencia como su propio paso posterior explícito, dado que toca DTO+frontend, fuera del principio "reutilizar sin duplicar" que rige Fase 4-5. Pero es tu decisión, no la tomo aquí.

**Tests a agregar en Paso 2** (no en este paso): equivalentes a los de `payment_with_comprobante_test.go` pero ejercitando `IssuePosSale` end-to-end — venta con 1 línea catálogo, venta con línea manual, pago único, pago dividido (efectivo+Yape), verificar `Payment.Purpose=servicio`, verificar `ReconciliationStatus=Linked` (nunca `Pending`), verificar cero `Document`/`PaymentAllocation` creados, verificar que `ListPosSales`/`GetPosSaleDetail` (sin tocar) siguen funcionando con el nuevo shape de datos.

**Archivos a tocar en Paso 2**: únicamente `backend/services/pos_sale_service.go` (función `IssuePosSale`) + su archivo de test nuevo. Ninguno de los archivos de Fase 4 (`fiscal_receipt_issue_service.go`, `payment_service.go`, `payment_apply.go`, `models/payment.go`) debería necesitar cambios — la infraestructura ya está lista tal cual.
