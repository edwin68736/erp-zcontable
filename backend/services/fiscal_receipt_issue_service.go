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
