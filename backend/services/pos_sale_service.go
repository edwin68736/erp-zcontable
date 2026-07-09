package services

import (
	"errors"
	"fmt"
	"math"
	"strings"
	"time"

	"miappfiber/database"
	"miappfiber/models"

	"gorm.io/gorm"
)

const defaultIGVRate = 18.0

// PosSaleLineInput línea de venta POS (catálogo o manual).
type PosSaleLineInput struct {
	ProductID   *uint   `json:"product_id"`
	Description string  `json:"description"`
	Quantity    float64 `json:"quantity"`
	UnitPrice   float64 `json:"unit_price"`
	IsManual    bool    `json:"is_manual"`
}

// PosSalePaymentInput línea de pago en venta POS.
type PosSalePaymentInput struct {
	Method          string  `json:"method"`
	Amount          float64 `json:"amount"`
	OperationNumber string  `json:"operation_number"`
	ProofURL        string  `json:"proof_url"`
}

// PosSaleIssueInput emisión rápida desde POS.
type PosSaleIssueInput struct {
	Kind             string                `json:"kind"`
	SeriesID         uint                  `json:"series_id"`
	CompanyID        uint                  `json:"company_id"`
	Lines            []PosSaleLineInput    `json:"lines"`
	Payments         []PosSalePaymentInput `json:"payments"`
	PaymentMethod    string                `json:"payment_method"`
	PaymentReference string                `json:"payment_reference"`
	Notes            string                `json:"notes"`
}

type posLineComputed struct {
	line models.FiscalReceiptLine
}

type PosSaleService struct {
	series  *FiscalDocumentSeriesService
	receipt *FiscalReceiptService
	access  *AccessService
}

func NewPosSaleService() *PosSaleService {
	return &PosSaleService{
		series:  NewFiscalDocumentSeriesService(),
		receipt: NewFiscalReceiptService(),
		access:  NewAccessService(),
	}
}

func roundPosMoney(v float64) float64 {
	return math.Round(v*100) / 100
}

func splitIGVFromTotalWithIGV(totalWithIGV float64, rate float64) (base, igv float64) {
	if rate <= 0 {
		rate = defaultIGVRate
	}
	base = roundPosMoney(totalWithIGV / (1 + rate/100))
	igv = roundPosMoney(totalWithIGV - base)
	return base, igv
}

func (s *PosSaleService) computeLines(in []PosSaleLineInput, allowPriceEdit bool) ([]posLineComputed, float64, float64, float64, error) {
	if len(in) == 0 {
		return nil, 0, 0, 0, errors.New("agregue al menos un ítem")
	}
	out := make([]posLineComputed, 0, len(in))
	var subtotal, tax, total float64
	for i, row := range in {
		qty := row.Quantity
		if qty <= 0 {
			qty = 1
		}
		var snap models.FiscalReceiptLine
		snap.SortOrder = i
		snap.IGVRate = defaultIGVRate

		if row.IsManual || row.ProductID == nil || *row.ProductID == 0 {
			desc := strings.TrimSpace(row.Description)
			if desc == "" {
				return nil, 0, 0, 0, fmt.Errorf("línea %d: indique descripción del ítem manual", i+1)
			}
			unit := row.UnitPrice
			if unit < 0 {
				return nil, 0, 0, 0, fmt.Errorf("línea %d: precio inválido", i+1)
			}
			lineTotal := roundPosMoney(qty * unit)
			base, igv := splitIGVFromTotalWithIGV(lineTotal, defaultIGVRate)
			snap.LineType = models.FiscalReceiptLineTypeManual
			snap.ProductName = desc
			snap.Description = desc
			snap.UnitTypeID = "ZZ"
			snap.Quantity = qty
			snap.UnitPrice = unit
			snap.LineSubtotal = base
			snap.IGVAmount = igv
			snap.LineTotal = lineTotal
		} else {
			var p models.Product
			if err := database.DB.First(&p, *row.ProductID).Error; err != nil {
				return nil, 0, 0, 0, fmt.Errorf("línea %d: producto no encontrado", i+1)
			}
			if !p.Active {
				return nil, 0, 0, 0, fmt.Errorf("línea %d: producto inactivo", i+1)
			}
			catalogPrice := productUnitPriceFromModel(&p)
			unit := catalogPrice
			if row.UnitPrice > 0 {
				if !allowPriceEdit && math.Abs(row.UnitPrice-catalogPrice) > 0.02 {
					return nil, 0, 0, 0, fmt.Errorf("línea %d: no tiene permiso para modificar el precio", i+1)
				}
				unit = row.UnitPrice
			}
			if unit < 0 {
				return nil, 0, 0, 0, fmt.Errorf("línea %d: precio inválido", i+1)
			}
			name := productDisplayName(&p)
			if name == "" {
				name = "Ítem"
			}
			desc := strings.TrimSpace(p.Description)
			if desc == "" {
				desc = name
			}
			lineTotal := roundPosMoney(qty * unit)
			base, igv := splitIGVFromTotalWithIGV(lineTotal, defaultIGVRate)
			pid := p.ID
			snap.LineType = models.FiscalReceiptLineTypeCatalog
			snap.ProductID = &pid
			snap.ProductName = name
			snap.Description = desc
			snap.InternalCode = strings.TrimSpace(p.InternalID)
			if snap.InternalCode == "" {
				snap.InternalCode = strings.TrimSpace(p.TukifacItemID)
			}
			snap.UnitTypeID = strings.TrimSpace(strings.ToUpper(p.UnitTypeID))
			if snap.UnitTypeID == "" {
				snap.UnitTypeID = "ZZ"
			}
			snap.Quantity = qty
			snap.UnitPrice = unit
			snap.LineSubtotal = base
			snap.IGVAmount = igv
			snap.LineTotal = lineTotal
		}
		subtotal += snap.LineSubtotal
		tax += snap.IGVAmount
		total += snap.LineTotal
		out = append(out, posLineComputed{line: snap})
	}
	return out, roundPosMoney(subtotal), roundPosMoney(tax), roundPosMoney(total), nil
}

func productDisplayName(p *models.Product) string {
	if p == nil {
		return "Ítem"
	}
	if p.Name != nil {
		if n := strings.TrimSpace(*p.Name); n != "" {
			return n
		}
	}
	if n := strings.TrimSpace(p.Description); n != "" {
		return n
	}
	return "Ítem"
}

func productUnitPriceFromModel(p *models.Product) float64 {
	if p == nil {
		return 0
	}
	fromSale := parseMoneyString(p.SaleUnitPrice)
	if fromSale > 0 {
		return fromSale
	}
	if p.Price > 0 {
		return p.Price
	}
	return 0
}

func isCashPaymentMethod(method string) bool {
	m := strings.ToLower(strings.TrimSpace(method))
	return m == "efectivo" || m == "cash" || m == "contado"
}

func normalizePosPayments(in *PosSaleIssueInput, saleTotal float64) ([]models.FiscalReceiptPayment, string, string, error) {
	rows := in.Payments
	if len(rows) == 0 {
		m := strings.TrimSpace(in.PaymentMethod)
		if m == "" {
			m = "efectivo"
		}
		rows = []PosSalePaymentInput{{
			Method: m,
			Amount: saleTotal,
		}}
	}
	var sum float64
	out := make([]models.FiscalReceiptPayment, 0, len(rows))
	methods := make([]string, 0, len(rows))
	var refs []string
	for i, row := range rows {
		method := strings.TrimSpace(row.Method)
		if method == "" {
			return nil, "", "", fmt.Errorf("pago %d: indique el método", i+1)
		}
		amt := roundPosMoney(row.Amount)
		if amt <= 0 {
			return nil, "", "", fmt.Errorf("pago %d: monto inválido", i+1)
		}
		op := strings.TrimSpace(row.OperationNumber)
		if !isCashPaymentMethod(method) {
			if op == "" {
				return nil, "", "", fmt.Errorf("pago %d (%s): indique número de operación", i+1, method)
			}
			refs = append(refs, op)
		}
		sum += amt
		methods = append(methods, method)
		out = append(out, models.FiscalReceiptPayment{
			SortOrder:       i,
			Method:          method,
			Amount:          amt,
			OperationNumber: op,
			ProofURL:        strings.TrimSpace(row.ProofURL),
		})
	}
	if math.Abs(sum-saleTotal) > 0.02 {
		return nil, "", "", fmt.Errorf("el total pagado (S/ %.2f) debe coincidir con el total de la venta (S/ %.2f)", sum, saleTotal)
	}
	headerMethod := strings.Join(uniqueStrings(methods), " + ")
	headerRef := strings.Join(refs, "; ")
	if headerRef == "" {
		headerRef = strings.TrimSpace(in.PaymentReference)
	}
	return out, headerMethod, headerRef, nil
}

func uniqueStrings(in []string) []string {
	seen := make(map[string]struct{}, len(in))
	out := make([]string, 0, len(in))
	for _, s := range in {
		k := strings.ToLower(strings.TrimSpace(s))
		if k == "" {
			continue
		}
		if _, ok := seen[k]; ok {
			continue
		}
		seen[k] = struct{}{}
		out = append(out, strings.TrimSpace(s))
	}
	return out
}

func parseMoneyString(s string) float64 {
	s = strings.TrimSpace(strings.ReplaceAll(s, ",", "."))
	if s == "" {
		return 0
	}
	var v float64
	_, _ = fmt.Sscan(s, &v)
	return v
}

// IssuePosSale registra comprobante POS con líneas snapshot e correlativo local.
func (s *PosSaleService) IssuePosSale(userID uint, in PosSaleIssueInput, allowPriceEdit bool) (*models.TukifacFiscalReceipt, error) {
	kind := strings.ToLower(strings.TrimSpace(in.Kind))
	if kind != "boleta" && kind != "factura" && kind != "sale_note" {
		return nil, errors.New("kind debe ser boleta, factura o sale_note")
	}
	if in.CompanyID == 0 {
		return nil, errors.New("seleccione el cliente")
	}
	ok, err := s.access.CanAccessCompany(userID, in.CompanyID)
	if err != nil {
		return nil, err
	}
	if !ok {
		// POS: permitir venta a cualquier empresa activa del estudio (alcance lectura comercial).
		var co models.Company
		if err := database.DB.Where("id = ? AND status = ?", in.CompanyID, "activo").First(&co).Error; err != nil {
			return nil, errors.New("cliente no disponible")
		}
	}

	expectedSunat := SunatCodeForComprobanteKind(kind)
	seriesID := in.SeriesID
	if seriesID == 0 {
		var ser models.FiscalDocumentSeries
		if err := database.DB.Where("sunat_code = ? AND active = ?", expectedSunat, true).
			Order("id ASC").First(&ser).Error; err != nil {
			return nil, errors.New("no hay serie activa para este tipo de comprobante")
		}
		seriesID = ser.ID
	}
	ser, err := s.series.GetByID(seriesID)
	if err != nil {
		return nil, errors.New("serie no encontrada")
	}
	if ser.SunatCode != expectedSunat {
		return nil, fmt.Errorf("la serie no corresponde al tipo %s", kind)
	}

	computed, subtotal, tax, total, err := s.computeLines(in.Lines, allowPriceEdit)
	if err != nil {
		return nil, err
	}
	if total <= 0 {
		return nil, errors.New("el total debe ser mayor a cero")
	}

	paymentRows, headerMethod, headerRef, err := normalizePosPayments(&in, total)
	if err != nil {
		return nil, err
	}

	var co models.Company
	if err := database.DB.First(&co, in.CompanyID).Error; err != nil {
		return nil, err
	}

	fullNumber, _, err := s.series.ReserveNextNumber(ser.ID)
	if err != nil {
		return nil, err
	}

	issueDate := time.Now().In(fiscalPeruTZ())
	docType := ser.SunatCode
	if kind == "sale_note" && docType == "00" {
		docType = "NV"
	}
	customerName := strings.TrimSpace(co.BusinessName)
	if customerName == "" {
		customerName = "-"
	}
	uid := userID
	sid := ser.ID

	rec := models.TukifacFiscalReceipt{
		ExternalID:           fmt.Sprintf("pos-%d-%s", time.Now().UnixNano(), fullNumber),
		CompanyID:            co.ID,
		DocumentTypeID:       docType,
		Number:               fullNumber,
		Total:                total,
		Subtotal:             subtotal,
		TaxAmount:            tax,
		IssueDate:            issueDate,
		CustomerNumber:       strings.TrimSpace(co.RUC),
		CustomerName:         customerName,
		ReconciliationStatus: models.TukifacReceiptPending,
		StateTypeDescription: "Venta POS",
		Origin:               models.TukifacReceiptOriginPOS,
		IssuedByUserID:       &uid,
		FiscalSeriesID:       &sid,
		PaymentMethod:        headerMethod,
		PaymentReference:     headerRef,
		Notes:                strings.TrimSpace(in.Notes),
	}

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
	if err != nil {
		return nil, err
	}
	_ = database.DB.Preload("Company").Preload("Lines").Preload("Payments", func(db *gorm.DB) *gorm.DB {
		return db.Order("sort_order ASC, id ASC")
	}).Preload("IssuedByUser").First(&rec, rec.ID).Error
	return &rec, nil
}

// PosSaleListParams filtros historial POS.
type PosSaleListParams struct {
	Page      int
	PerPage   int
	OnlyOwn   bool
	UserID    uint
	CompanyID *uint
}

func (s *PosSaleService) ListPosSales(params PosSaleListParams) ([]FiscalReceiptEnriched, int64, error) {
	q := database.DB.Model(&models.TukifacFiscalReceipt{}).Where("origin = ?", models.TukifacReceiptOriginPOS)
	if params.OnlyOwn && params.UserID > 0 {
		q = q.Where("issued_by_user_id = ?", params.UserID)
	}
	if params.CompanyID != nil && *params.CompanyID > 0 {
		q = q.Where("company_id = ?", *params.CompanyID)
	}
	var total int64
	if err := q.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	page := params.Page
	if page <= 0 {
		page = 1
	}
	perPage := params.PerPage
	if perPage <= 0 {
		perPage = 20
	}
	if perPage > 100 {
		perPage = 100
	}
	var list []models.TukifacFiscalReceipt
	err := q.Preload("Company").Preload("IssuedByUser").
		Order("issue_date DESC, id DESC").
		Limit(perPage).
		Offset((page - 1) * perPage).
		Find(&list).Error
	if err != nil {
		return nil, 0, err
	}
	out := make([]FiscalReceiptEnriched, 0, len(list))
	for i := range list {
		out = append(out, EnrichFiscalReceipt(list[i]))
	}
	return out, total, nil
}

// GetPosSaleDetail detalle con líneas (solo snapshot).
func (s *PosSaleService) GetPosSaleDetail(id uint, userID uint, onlyOwn bool) (*models.TukifacFiscalReceipt, error) {
	var rec models.TukifacFiscalReceipt
	q := database.DB.Where("id = ? AND origin = ?", id, models.TukifacReceiptOriginPOS)
	if onlyOwn && userID > 0 {
		q = q.Where("issued_by_user_id = ?", userID)
	}
	if err := q.Preload("Company").Preload("IssuedByUser").
		Preload("Lines", func(db *gorm.DB) *gorm.DB {
			return db.Order("sort_order ASC, id ASC")
		}).
		Preload("Payments", func(db *gorm.DB) *gorm.DB {
			return db.Order("sort_order ASC, id ASC")
		}).
		First(&rec).Error; err != nil {
		return nil, errors.New("comprobante no encontrado")
	}
	return &rec, nil
}

// ListCompaniesForPos empresas activas para selector de cliente.
func (s *PosSaleService) ListCompaniesForPos() ([]models.Company, error) {
	var list []models.Company
	err := database.DB.Where("status = ?", "activo").
		Order("business_name ASC").
		Find(&list).Error
	return list, err
}
