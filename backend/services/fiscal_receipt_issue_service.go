package services

import (
	"errors"
	"fmt"
	"math"
	"strings"
	"sync"
	"time"

	"miappfiber/database"
	"miappfiber/models"

	"gorm.io/gorm"
)

// PaymentComprobanteIssueInput emisión local desde un pago (sin Tukifac).
type PaymentComprobanteIssueInput struct {
	Kind                 string `json:"kind"` // boleta | factura | sale_note
	SeriesID             uint   `json:"series_id"`
	PaymentMethodTypeID  string `json:"payment_method_type_id"`
	PaymentDestinationID string `json:"payment_destination_id"`
	PaymentReference     string `json:"payment_reference"`
}

// FiscalReceiptIssueService emite comprobantes y reserva correlativos locales.
type FiscalReceiptIssueService struct {
	series *FiscalDocumentSeriesService
	receipt *FiscalReceiptService
}

func NewFiscalReceiptIssueService() *FiscalReceiptIssueService {
	return &FiscalReceiptIssueService{
		series:  NewFiscalDocumentSeriesService(),
		receipt: NewFiscalReceiptService(),
	}
}

var fiscalPeruTZ = sync.OnceValue(func() *time.Location {
	loc, err := time.LoadLocation("America/Lima")
	if err != nil {
		return time.UTC
	}
	return loc
})

// IssueComprobanteFromPayment registra el comprobante localmente y vincula al pago.
func (s *FiscalReceiptIssueService) IssueComprobanteFromPayment(paymentID uint, in PaymentComprobanteIssueInput) (*models.TukifacFiscalReceipt, error) {
	kind := strings.ToLower(strings.TrimSpace(in.Kind))
	if kind != "boleta" && kind != "factura" && kind != "sale_note" {
		return nil, errors.New("kind debe ser boleta, factura o sale_note")
	}
	if in.SeriesID == 0 {
		return nil, errors.New("indique series_id (serie local)")
	}

	expectedSunat := SunatCodeForComprobanteKind(kind)
	ser, err := s.series.GetByID(in.SeriesID)
	if err != nil {
		return nil, errors.New("serie no encontrada")
	}
	if ser.SunatCode != expectedSunat {
		return nil, fmt.Errorf("la serie seleccionada no corresponde al tipo %s (SUNAT %s)", kind, expectedSunat)
	}

	var pay models.Payment
	if err := database.DB.
		Preload("Allocations.Document.Items.Product").
		Preload("TaxSettlement.Lines", func(db *gorm.DB) *gorm.DB {
			return db.Order("sort_order ASC, id ASC")
		}).
		Preload("TaxSettlement").
		First(&pay, paymentID).Error; err != nil {
		return nil, errors.New("pago no encontrado")
	}

	if pay.Type != "applied" || len(pay.Allocations) == 0 {
		return nil, errors.New("el pago debe estar aplicado con imputaciones a deudas")
	}
	if pay.TaxSettlementID != nil && *pay.TaxSettlementID > 0 {
		if pay.TaxSettlement == nil || pay.TaxSettlement.Status != models.TaxSettlementStatusIssued {
			return nil, errors.New("la liquidación debe estar emitida")
		}
	}

	var sumAlloc float64
	for _, a := range pay.Allocations {
		sumAlloc += a.Amount
	}
	discount := roundFiscalMoney(pay.DiscountAmount)
	if discount > documentMoneyEpsilon {
		if math.Abs(sumAlloc-pay.Amount-discount) > 0.03 {
			return nil, errors.New("las imputaciones no coinciden con el monto del pago y el descuento")
		}
	} else if math.Abs(sumAlloc-pay.Amount) > 0.03 {
		return nil, errors.New("las imputaciones no coinciden con el monto del pago")
	}

	var co models.Company
	if err := database.DB.First(&co, pay.CompanyID).Error; err != nil {
		return nil, err
	}

	fullNumber, _, err := s.series.ReserveNextNumber(ser.ID)
	if err != nil {
		return nil, err
	}

	// Emisión interna = fecha de registro del pago (no la fecha en que ocurrió el pago).
	issueDate := pay.CreatedAt
	if issueDate.IsZero() {
		issueDate = time.Now()
	}
	issueDate = issueDate.In(fiscalPeruTZ())

	docType := ser.SunatCode
	if kind == "sale_note" && docType == "00" {
		docType = "NV"
	}

	customerName := strings.TrimSpace(co.BusinessName)
	if customerName == "" {
		customerName = "-"
	}

	externalID := fmt.Sprintf("local-pay%d-%s", pay.ID, fullNumber)
	var existing models.TukifacFiscalReceipt
	err = database.DB.Where("external_id = ?", externalID).First(&existing).Error
	if err == nil {
		return nil, fmt.Errorf("ya existe un comprobante con referencia %s", externalID)
	}
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}

	lines := BuildReceiptLinesFromPayment(&pay)
	if discount > documentMoneyEpsilon {
		lines = append(lines, buildFiscalDiscountLine(discount, len(lines)))
	}
	subtotal, tax, total := sumLineTotals(lines)
	if total <= 0 {
		total = roundFiscalMoney(pay.Amount)
		if total > 0 {
			subtotal = roundFiscalMoney(total / 1.18)
			tax = roundFiscalMoney(total - subtotal)
			lines = []models.FiscalReceiptLine{{
				LineType:     models.FiscalReceiptLineTypeManual,
				ProductName:  "Servicios contables",
				Description:  "Servicios contables",
				InternalCode: "0001",
				UnitTypeID:   "NIU",
				Quantity:     1,
				UnitPrice:    total,
				LineSubtotal: subtotal,
				IGVRate:      18,
				IGVAmount:    tax,
				LineTotal:    total,
				SortOrder:    0,
			}}
		}
	}
	if discount > documentMoneyEpsilon && math.Abs(total-pay.Amount) > 0.03 {
		return nil, errors.New("no se pudo cuadrar el total del comprobante con el monto pagado")
	}

	pm := strings.TrimSpace(pay.Method)
	if pm == "" {
		pm = "efectivo"
	}
	sid := ser.ID

	debtCtxJSON := ""
	if ctx := buildDebtPaymentContextSnapshot(&pay, lines); ctx != nil {
		if j, err := debtPaymentContextToJSON(ctx); err == nil {
			debtCtxJSON = j
		}
	}

	rec := models.TukifacFiscalReceipt{
		ExternalID:           externalID,
		CompanyID:            co.ID,
		DocumentTypeID:       docType,
		Number:               fullNumber,
		Total:                total,
		Subtotal:             subtotal,
		TaxAmount:            tax,
		TotalDiscount:        discount,
		IssueDate:            issueDate,
		CustomerNumber:       strings.TrimSpace(co.RUC),
		CustomerName:         customerName,
		ReconciliationStatus: models.TukifacReceiptPending,
		StateTypeDescription: "Emitido localmente",
		Origin:               models.TukifacReceiptOriginIssuedLocal,
		FiscalSeriesID:       &sid,
		PaymentMethod:        pm,
		PaymentReference:     strings.TrimSpace(pay.Reference),
		DebtPaymentContextJSON: debtCtxJSON,
	}

	err = database.DB.Transaction(func(tx *gorm.DB) error {
		if e := tx.Create(&rec).Error; e != nil {
			return e
		}
		for i := range lines {
			ln := lines[i]
			ln.FiscalReceiptID = rec.ID
			if e := tx.Create(&ln).Error; e != nil {
				return e
			}
		}
		paySnap := models.FiscalReceiptPayment{
			FiscalReceiptID: rec.ID,
			SortOrder:       0,
			Method:          pm,
			Amount:          roundFiscalMoney(pay.Amount),
			OperationNumber: strings.TrimSpace(pay.Reference),
		}
		if e := tx.Create(&paySnap).Error; e != nil {
			return e
		}
		pid := pay.ID
		rec.LinkedPaymentID = &pid
		rec.ReconciliationStatus = models.TukifacReceiptLinked
		if pay.TaxSettlementID != nil && *pay.TaxSettlementID > 0 {
			tid := *pay.TaxSettlementID
			rec.TaxSettlementID = &tid
		}
		if e := tx.Save(&rec).Error; e != nil {
			return e
		}
		return tx.Model(&models.Payment{}).Where("id = ?", pay.ID).Update("fiscal_status", "linked").Error
	})
	if err != nil {
		return nil, err
	}

	detail, err := s.receipt.GetFiscalReceiptDetail(rec.ID)
	if err != nil {
		return &rec, nil
	}
	return detail, nil
}

// PaymentWithComprobanteLine línea de contenido para el comprobante del nuevo flujo "Payment +
// comprobante juntos" (Fase 4 Paso 2). El llamador (Fase 5 para POS, u otro flujo futuro) decide
// cómo se arman estas líneas (catálogo, manual, etc.) — esta infraestructura solo las valida y
// persiste, no las calcula ni conoce productos/POS.
type PaymentWithComprobanteLine struct {
	LineType     string // models.FiscalReceiptLineTypeCatalog | Manual | Discount
	ProductID    *uint
	ProductName  string
	Description  string
	InternalCode string
	UnitTypeID   string
	Quantity     float64
	UnitPrice    float64
	LineSubtotal float64
	IGVRate      float64
	IGVAmount    float64
	LineTotal    float64
}

// PaymentWithComprobanteInput datos para crear un Payment nuevo y su comprobante de respaldo dentro
// de una única transacción (Fase 4 Paso 2).
type PaymentWithComprobanteInput struct {
	CompanyID uint
	Kind      string // boleta | factura | sale_note
	SeriesID  uint
	// Origin: models.TukifacReceiptOriginIssuedLocal | TukifacReceiptOriginPOS | ... — decisión del
	// llamador, esta función no asume ningún origen concreto (no depende de POS).
	Origin string

	// Purpose (Fase 4 §2, OBLIGATORIO en este flujo): decisión explícita de negocio del llamador.
	// Nunca se infiere de Origin/Kind — a diferencia de PaymentCreateParams.Purpose (opcional, por
	// compatibilidad con llamadores legado), aquí es requerido porque este es un flujo nuevo que
	// por definición conoce la naturaleza del dinero.
	Purpose string

	Amount           float64
	Date             time.Time // opcional, default = ahora
	Method           string    // fallback de un solo método si Payments está vacío
	Reference        string
	PaymentReference string                // fallback de referencia de cabecera si Payments está vacío
	Payments         []PosSalePaymentInput // desglose multi-método (reutiliza normalizePosPayments)
	Lines            []PaymentWithComprobanteLine
	Description      string
	Notes            string

	// IssuedByUserID (opcional): usuario que emite, si corresponde (p. ej. cajero POS). Nil = no se
	// registra (comportamiento preexistente para el flujo genérico sin cambios).
	IssuedByUserID *uint
	// StateTypeDescription (opcional): etiqueta descriptiva del comprobante. Vacío = "Emitido
	// localmente" (comportamiento preexistente sin cambios); un llamador como POS puede pasar su
	// propia etiqueta (p. ej. "Venta POS") sin alterar el comportamiento de otros llamadores.
	StateTypeDescription string

	// SaleClientRef (Fase 5 Paso 2B, opcional): referencia de idempotencia generada por el cliente
	// ANTES de la operación (mismo mecanismo diseñado y probado en Fase 5 Paso 2A — vive aquí ahora
	// porque este método es quien realiza la escritura real de Payment+comprobante). Si se provee y
	// ya existe una operación con la misma (CompanyID, SaleClientRef), se devuelve esa operación
	// existente sin crear nada nuevo. Vacío = sin protección de idempotencia (comportamiento
	// preexistente para llamadores que no la necesiten).
	SaleClientRef string
}

// CreatePaymentWithComprobante crea un Payment nuevo y su TukifacFiscalReceipt de respaldo dentro de
// una única transacción (Fase 4 Paso 2, docs/auditoria-fase4-comprobantes-payments-2026-09-15.md
// §16-17). A diferencia de IssueComprobanteFromPayment (que exige un Payment YA existente, aplicado,
// con allocations), esta función crea el Payment desde cero — es la infraestructura que Fase 5
// (POS) consumirá para que un ingreso independiente nazca completo: Payment + comprobante + vínculo,
// sin ventana donde exista uno sin el otro. NO depende de IssuePosSale ni de ninguna estructura
// específica de POS.
//
// Reutiliza exactamente normalizePosPayments (única fuente para Payment.Method/Reference,
// TukifacFiscalReceipt.PaymentMethod/Reference y cada FiscalReceiptPayment — nunca un segundo
// cálculo independiente) y FiscalDocumentSeriesService.ReserveNextNumber (mismo locking ya
// existente, sin introducir otro mecanismo de correlativos).
//
// El comprobante nace directamente en estado Linked (nunca Pending) — a diferencia de los
// comprobantes que sí nacen sin Payment (pos_sale actual, tukifac_sync), este flujo nunca deja una
// ventana donde exista uno sin el otro: si cualquier paso de la transacción falla, ni el Payment ni
// el comprobante quedan persistidos (rollback completo).
//
// NO crea Document ni PaymentAllocation, NUNCA escribe Payment.DocumentID — para Purpose=servicio
// es exactamente lo esperado (Blueprint §15, §17). Si en el futuro un flujo explícito de deuda
// necesita aplicar PaymentAllocation sobre este mismo patrón, esta función deberá extenderse (o
// crearse una variante) — deliberadamente NO implementado aquí, fuera del alcance de este paso.
func (s *FiscalReceiptIssueService) CreatePaymentWithComprobante(in PaymentWithComprobanteInput) (*models.TukifacFiscalReceipt, error) {
	kind := strings.ToLower(strings.TrimSpace(in.Kind))
	if kind != "boleta" && kind != "factura" && kind != "sale_note" {
		return nil, errors.New("kind debe ser boleta, factura o sale_note")
	}
	if in.CompanyID == 0 {
		return nil, errors.New("la empresa es requerida")
	}
	if in.SeriesID == 0 {
		return nil, errors.New("indique series_id (serie local)")
	}
	if strings.TrimSpace(in.Origin) == "" {
		return nil, errors.New("indique el origin del comprobante")
	}
	if !models.IsValidPaymentPurpose(in.Purpose) {
		return nil, errors.New("purpose inválido: use 'deuda' o 'servicio'")
	}
	if in.Amount <= 0 {
		return nil, errors.New("el monto debe ser mayor a 0")
	}
	if len(in.Lines) == 0 {
		return nil, errors.New("indique al menos una línea para el comprobante")
	}

	// Fase 5 Paso 2B (idempotencia, mecanismo diseñado y probado en Fase 5 Paso 2A): camino rápido
	// para el caso común (retry secuencial) — si el llamador ya envió esta misma referencia antes,
	// se devuelve la operación ya creada sin reservar un correlativo nuevo. NO es la protección
	// definitiva contra una carrera concurrente (ver el manejo de gorm.ErrDuplicatedKey más abajo,
	// tras el intento de creación) — es solo la vía optimista para el retry no simultáneo.
	saleClientRef := strings.TrimSpace(in.SaleClientRef)
	if saleClientRef != "" {
		if existing, err := s.findReceiptBySaleClientRef(in.CompanyID, saleClientRef); err != nil {
			return nil, err
		} else if existing != nil {
			return existing, nil
		}
	}

	expectedSunat := SunatCodeForComprobanteKind(kind)
	ser, err := s.series.GetByID(in.SeriesID)
	if err != nil {
		return nil, errors.New("serie no encontrada")
	}
	if ser.SunatCode != expectedSunat {
		return nil, fmt.Errorf("la serie seleccionada no corresponde al tipo %s (SUNAT %s)", kind, expectedSunat)
	}

	var co models.Company
	if err := database.DB.First(&co, in.CompanyID).Error; err != nil {
		return nil, errors.New("empresa no encontrada")
	}

	// Método(s) de pago: única fuente para Payment.Method/Reference, cabecera del comprobante y
	// FiscalReceiptPayment — reutiliza exactamente normalizePosPayments, sin un segundo cálculo.
	posIn := &PosSaleIssueInput{
		Payments:         in.Payments,
		PaymentMethod:    in.Method,
		PaymentReference: firstNonEmpty(in.PaymentReference, in.Reference),
	}
	paymentRows, headerMethod, headerRef, err := normalizePosPayments(posIn, roundFiscalMoney(in.Amount))
	if err != nil {
		return nil, err
	}

	// Líneas: el llamador ya las calculó (Fase 5 decide cómo) — aquí solo se valida que su total
	// cuadre con el monto del pago, mismo criterio de tolerancia que ya usa IssueComprobanteFromPayment.
	lines := make([]models.FiscalReceiptLine, 0, len(in.Lines))
	for i, ln := range in.Lines {
		lines = append(lines, models.FiscalReceiptLine{
			LineType:     ln.LineType,
			ProductID:    ln.ProductID,
			ProductName:  ln.ProductName,
			Description:  ln.Description,
			InternalCode: ln.InternalCode,
			UnitTypeID:   ln.UnitTypeID,
			Quantity:     ln.Quantity,
			UnitPrice:    ln.UnitPrice,
			LineSubtotal: ln.LineSubtotal,
			IGVRate:      ln.IGVRate,
			IGVAmount:    ln.IGVAmount,
			LineTotal:    ln.LineTotal,
			SortOrder:    i,
		})
	}
	subtotal, tax, total := sumLineTotals(lines)
	if math.Abs(total-roundFiscalMoney(in.Amount)) > 0.03 {
		return nil, errors.New("el total de las líneas no coincide con el monto del pago")
	}

	date := in.Date
	if date.IsZero() {
		date = time.Now()
	}
	issueDate := date.In(fiscalPeruTZ())

	docType := ser.SunatCode
	if kind == "sale_note" && docType == "00" {
		docType = "NV"
	}
	customerName := strings.TrimSpace(co.BusinessName)
	if customerName == "" {
		customerName = "-"
	}

	// Fase 2.5: mismo mecanismo de correlativo ya existente (FOR UPDATE), en su propia transacción
	// interna — igual que ya hace IssueComprobanteFromPayment (línea ~104 de este archivo). Si el
	// resto de la operación falla después, el número reservado queda "quemado" (hueco en la
	// secuencia, nunca reutilizado) — comportamiento preexistente y aceptado para correlativos
	// fiscales, no introducido por esta función.
	fullNumber, _, err := s.series.ReserveNextNumber(ser.ID)
	if err != nil {
		return nil, err
	}
	sid := ser.ID
	purpose := in.Purpose

	var rec models.TukifacFiscalReceipt
	err = database.DB.Transaction(func(tx *gorm.DB) error {
		pay := models.Payment{
			CompanyID:    in.CompanyID,
			DocumentID:   nil,
			Type:         "on_account",
			Purpose:      &purpose,
			Date:         date,
			Amount:       roundFiscalMoney(in.Amount),
			Method:       headerMethod,
			Reference:    headerRef,
			Description:  in.Description,
			Notes:        in.Notes,
			FiscalStatus: "linked",
		}
		if e := tx.Create(&pay).Error; e != nil {
			return e
		}
		pid := pay.ID

		stateDesc := strings.TrimSpace(in.StateTypeDescription)
		if stateDesc == "" {
			stateDesc = "Emitido localmente"
		}
		rec = models.TukifacFiscalReceipt{
			ExternalID:           fmt.Sprintf("local-pc%d-%s", pid, fullNumber),
			CompanyID:            co.ID,
			DocumentTypeID:       docType,
			Number:               fullNumber,
			Total:                total,
			Subtotal:             subtotal,
			TaxAmount:            tax,
			IssueDate:            issueDate,
			CustomerNumber:       strings.TrimSpace(co.RUC),
			CustomerName:         customerName,
			ReconciliationStatus: models.TukifacReceiptLinked,
			StateTypeDescription: stateDesc,
			Origin:               in.Origin,
			IssuedByUserID:       in.IssuedByUserID,
			FiscalSeriesID:       &sid,
			PaymentMethod:        headerMethod,
			PaymentReference:     headerRef,
			Notes:                strings.TrimSpace(in.Notes),
			LinkedPaymentID:      &pid,
		}
		if saleClientRef != "" {
			rec.SaleClientRef = &saleClientRef
		}
		if e := tx.Create(&rec).Error; e != nil {
			return e
		}
		for i := range lines {
			ln := lines[i]
			ln.FiscalReceiptID = rec.ID
			if e := tx.Create(&ln).Error; e != nil {
				return e
			}
		}
		for i := range paymentRows {
			pr := paymentRows[i]
			pr.FiscalReceiptID = rec.ID
			if e := tx.Create(&pr).Error; e != nil {
				return e
			}
		}
		return nil
	})
	if err != nil {
		// Fase 5 Paso 2B: barrera DEFINITIVA contra la carrera de doble envío concurrente — si el
		// error es precisamente la violación del índice único (CompanyID, SaleClientRef) — otra
		// solicitud concurrente con la misma referencia ganó la carrera y ya creó Payment+comprobante
		// — se devuelve esa operación ya creada en vez de un error genérico de base de datos.
		// Cualquier otro error (validación, conexión, etc.) se propaga sin cambios.
		if saleClientRef != "" && errors.Is(err, gorm.ErrDuplicatedKey) {
			if existing, findErr := s.findReceiptBySaleClientRef(in.CompanyID, saleClientRef); findErr == nil && existing != nil {
				return existing, nil
			}
		}
		return nil, err
	}

	detail, err := s.receipt.GetFiscalReceiptDetail(rec.ID)
	if err != nil {
		return &rec, nil
	}
	return detail, nil
}

// findReceiptBySaleClientRef busca una operación (Payment+comprobante) ya creada con la misma
// (CompanyID, SaleClientRef) — Fase 5 Paso 2B. Devuelve (nil, nil) si no existe ninguna; no es un
// error, es el caso normal de una operación nueva.
func (s *FiscalReceiptIssueService) findReceiptBySaleClientRef(companyID uint, ref string) (*models.TukifacFiscalReceipt, error) {
	var rec models.TukifacFiscalReceipt
	err := database.DB.
		Preload("Company").Preload("Lines").Preload("Payments", func(db *gorm.DB) *gorm.DB {
		return db.Order("sort_order ASC, id ASC")
	}).Preload("IssuedByUser").Preload("LinkedPayment").
		Where("company_id = ? AND sale_client_ref = ?", companyID, ref).
		First(&rec).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return &rec, nil
}
