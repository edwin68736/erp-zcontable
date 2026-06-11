package services

import (
	"errors"
	"fmt"
	"math"
	"strings"
	"time"
	"unicode/utf8"

	"miappfiber/database"
	"miappfiber/models"
	debtsvc "miappfiber/services/debt"

	"gorm.io/gorm"
)

const maxManualDebtNumberRunes = 6

func isManualDocumentSource(src string) bool {
	s := strings.TrimSpace(strings.ToLower(src))
	return s == "" || s == "manual"
}

func validateManualDocumentNumber(n string) error {
	if utf8.RuneCountInString(strings.TrimSpace(n)) > maxManualDebtNumberRunes {
		return errors.New("el número de la deuda no puede superar 6 caracteres")
	}
	return nil
}

// allocateShortDebtNumber asigna hasta 6 caracteres (relleno numérico), único por empresa.
func allocateShortDebtNumber(tx *gorm.DB, companyID uint) (string, error) {
	var count int64
	if err := tx.Model(&models.Document{}).Where("company_id = ?", companyID).Count(&count).Error; err != nil {
		return "", err
	}
	for try := 0; try < 10000; try++ {
		v := uint64(count) + 1 + uint64(try)
		candidate := fmt.Sprintf("%06d", v%1000000)
		var exists int64
		if err := tx.Model(&models.Document{}).
			Where("company_id = ? AND number = ?", companyID, candidate).
			Count(&exists).Error; err != nil {
			return "", err
		}
		if exists == 0 {
			return candidate, nil
		}
	}
	return "", errors.New("no se pudo generar un número de deuda único")
}

type DocumentService struct{}

func NewDocumentService() *DocumentService {
	return &DocumentService{}
}

type DocumentListParams struct {
	CompanyID         uint
	Status            string
	Overdue           bool
	CollectionSituation string
	DateFrom          *time.Time
	DateTo            *time.Time
	AllowedCompanyIDs []uint
	// ImplicitOpenBalances: una empresa sin rango de fechas de emisión → solo pendiente+parcial con saldo (incluye vencidas).
	ImplicitOpenBalances bool
	// ExplicitAllStatuses: status=all en URL → no filtrar por estado (ni modo implícito de saldos).
	ExplicitAllStatuses bool
	// GroupByCompany: sin company_id, devolver filas agregadas por empresa (paginación por cantidad de empresas).
	GroupByCompany bool
	// IncludeItems: con company_id fijo, adjunta líneas (document_items) en cada fila del listado paginado.
	IncludeItems bool
}

// CompanyDebtSummaryRow es una fila del listado agrupado por empresa (saldo abierto en el rango/filtros).
type CompanyDebtSummaryRow struct {
	CompanyID        uint           `json:"company_id"`
	Company          models.Company `json:"company"`
	DocumentCount    int64          `json:"document_count"`
	OpenBalanceTotal float64        `json:"open_balance_total"`
}

func isValidDocumentStatus(s string) bool {
	switch s {
	case "pendiente", "parcial", "pagado", "anulado":
		return true
	default:
		return false
	}
}

func normalizeDocumentItem(it *models.DocumentItem) error {
	it.Description = strings.TrimSpace(it.Description)
	if it.Description == "" {
		return errors.New("cada ítem requiere descripción")
	}
	if it.Quantity <= 0 {
		it.Quantity = 1
	}
	if it.Amount <= 0 {
		return errors.New("cada ítem debe tener monto mayor a 0")
	}
	it.Amount = math.Round(it.Amount*100) / 100
	if it.UnitPrice <= 0 {
		it.UnitPrice = math.Round((it.Amount/it.Quantity)*100) / 100
	} else {
		it.UnitPrice = math.Round(it.UnitPrice*100) / 100
	}
	return nil
}

func (s *DocumentService) Create(input *models.Document) error {
	if input.CompanyID == 0 {
		return errors.New("la empresa es requerida")
	}
	if input.Type == "" {
		return errors.New("el tipo de comprobante es requerido")
	}
	if input.Source == "" {
		input.Source = "manual"
	}
	input.Number = strings.TrimSpace(input.Number)
	if isManualDocumentSource(input.Source) && input.Number != "" {
		if err := validateManualDocumentNumber(input.Number); err != nil {
			return err
		}
	}
	items := input.Items
	input.Items = nil

	if len(items) > 0 {
		var sum float64
		for i := range items {
			if err := normalizeDocumentItem(&items[i]); err != nil {
				return err
			}
			sum += items[i].Amount
		}
		input.TotalAmount = math.Round(sum*100) / 100
	} else if input.TotalAmount <= 0 {
		return errors.New("el monto debe ser mayor a 0")
	}
	if input.Status == "" {
		input.Status = "pendiente"
	}
	if !isValidDocumentStatus(input.Status) {
		return errors.New("estado de documento inválido")
	}
	if input.IssueDate.IsZero() {
		input.IssueDate = time.Now()
	}
	if input.DueDate != nil && !input.DueDate.IsZero() && input.DueDate.Before(input.IssueDate) {
		return errors.New("la fecha de vencimiento no puede ser menor a la fecha de emisión")
	}
	input.ExternalID = strings.TrimSpace(input.ExternalID)

	src := strings.TrimSpace(input.Source)
	needsDebtPeriod := (src == "" || src == "manual") && len(items) > 0
	ap := strings.TrimSpace(input.AccountingPeriod)
	if ap == "" {
		ap = strings.TrimSpace(input.ServiceMonth)
	}
	if needsDebtPeriod {
		if _, err := time.Parse("2006-01", ap); err != nil {
			return errors.New("el periodo contable (AAAA-MM) es obligatorio para deudas manuales y es independiente de la fecha de registro")
		}
		input.AccountingPeriod = ap
		if strings.TrimSpace(input.ServiceMonth) == "" {
			input.ServiceMonth = ap
		}
	} else if ap != "" {
		if _, err := time.Parse("2006-01", ap); err == nil {
			input.AccountingPeriod = ap
		}
	}
	debtsvc.ApplyPeriodFromString(input, input.AccountingPeriod, input.ServiceMonth)
	debtsvc.NewService().InitBalanceOnCreate(input)

	return database.DB.Transaction(func(tx *gorm.DB) error {
		if input.Number == "" && isManualDocumentSource(input.Source) {
			n, err := allocateShortDebtNumber(tx, input.CompanyID)
			if err != nil {
				return err
			}
			input.Number = n
		}
		if err := tx.Omit("Items", "Company", "Payments", "Allocations").Create(input).Error; err != nil {
			return err
		}
		if len(items) == 0 {
			return nil
		}
		for i := range items {
			items[i].ID = 0
			items[i].DocumentID = input.ID
			items[i].SortOrder = i
		}
		return tx.Create(&items).Error
	})
}

func (s *DocumentService) Update(id uint, input *models.Document) error {
	return database.DB.Transaction(func(tx *gorm.DB) error {
		var d models.Document
		if err := tx.First(&d, id).Error; err != nil {
			return err
		}
		if input.Type != "" {
			d.Type = input.Type
		}
		if input.Number != "" {
			num := strings.TrimSpace(input.Number)
			if isManualDocumentSource(d.Source) {
				if err := validateManualDocumentNumber(num); err != nil {
					return err
				}
			}
			d.Number = num
		}
		if !input.IssueDate.IsZero() {
			d.IssueDate = input.IssueDate
		}
		if input.DueDate != nil {
			if input.DueDate.IsZero() {
				d.DueDate = nil
			} else {
				d.DueDate = input.DueDate
			}
		}
		if input.Status != "" {
			if !isValidDocumentStatus(input.Status) {
				return errors.New("estado de documento inválido")
			}
			d.Status = input.Status
		}
		d.Description = input.Description
		ap := strings.TrimSpace(input.AccountingPeriod)
		if ap == "" {
			ap = strings.TrimSpace(input.ServiceMonth)
		}
		if ap != "" {
			if _, err := time.Parse("2006-01", ap); err != nil {
				return errors.New("periodo contable inválido (AAAA-MM)")
			}
			d.AccountingPeriod = ap
		}
		if strings.TrimSpace(input.ServiceMonth) != "" {
			d.ServiceMonth = strings.TrimSpace(input.ServiceMonth)
		} else if d.AccountingPeriod != "" && strings.TrimSpace(d.ServiceMonth) == "" {
			d.ServiceMonth = d.AccountingPeriod
		}

		if input.Items != nil {
			if err := tx.Where("document_id = ?", id).Delete(&models.DocumentItem{}).Error; err != nil {
				return err
			}
			if len(input.Items) > 0 {
				var sum float64
				for i := range input.Items {
					it := &input.Items[i]
					if err := normalizeDocumentItem(it); err != nil {
						return err
					}
					sum += it.Amount
					it.ID = 0
					it.DocumentID = id
					it.SortOrder = i
				}
				d.TotalAmount = math.Round(sum*100) / 100
				if err := tx.Create(&input.Items).Error; err != nil {
					return err
				}
			} else {
				if input.TotalAmount <= 0 {
					return errors.New("el monto debe ser mayor a 0")
				}
				d.TotalAmount = input.TotalAmount
			}
		} else if input.TotalAmount > 0 {
			d.TotalAmount = input.TotalAmount
		}

		if d.DueDate != nil && !d.DueDate.IsZero() && d.DueDate.Before(d.IssueDate) {
			return errors.New("la fecha de vencimiento no puede ser menor a la fecha de emisión")
		}
		return tx.Omit("Items", "Company", "Payments", "Allocations").Save(&d).Error
	})
}

// SQL: saldo abierto persistido (post-migración final). TODO: remove legacy after final migration — fallback en EffectiveBalance para lectura API.
func documentOpenBalancePositiveClause() string {
	return `(documents.balance_amount > 0.005 AND (documents.legacy_status IS NULL OR documents.legacy_status = '' OR documents.legacy_status NOT IN ('legacy_merged','archived')))`
}

func shouldFilterDocumentsWithRealOpenBalance(params DocumentListParams) bool {
	if params.ExplicitAllStatuses {
		return false
	}
	sit := normalizeCollectionSituation(params.CollectionSituation)
	if sit == CollectionSituationPagadas || sit == CollectionSituationAnuladas {
		return false
	}
	if sit == CollectionSituationPorCobrar || sit == CollectionSituationVencidas {
		return true
	}
	if params.Status == "pagado" || params.Status == "anulado" {
		return false
	}
	if params.Overdue {
		return true
	}
	if params.Status == "pendiente" || params.Status == "parcial" {
		return true
	}
	if params.ImplicitOpenBalances {
		return true
	}
	return false
}

func (s *DocumentService) applyCollectionSituationFilter(q *gorm.DB, situation string, startOfToday time.Time) *gorm.DB {
	sit := normalizeCollectionSituation(situation)
	switch sit {
	case CollectionSituationAll:
		return q
	case CollectionSituationAnuladas:
		return q.Where("status = ?", DocumentStatusCancelled)
	case CollectionSituationPagadas:
		return q.Where("status = ?", DocumentStatusPaid)
	case CollectionSituationVencidas:
		return q.Where("due_date IS NOT NULL AND due_date < ? AND status <> ? AND status <> ?",
			startOfToday, DocumentStatusPaid, DocumentStatusCancelled).
			Where(documentOpenBalancePositiveClause())
	case CollectionSituationPorCobrar:
		return q.Where("status IN ?", []string{DocumentStatusPending, DocumentStatusPartial}).
			Where("(due_date IS NULL OR due_date >= ?)", startOfToday).
			Where(documentOpenBalancePositiveClause())
	default:
		return q
	}
}

func (s *DocumentService) applyDocumentListFilters(q *gorm.DB, params DocumentListParams) *gorm.DB {
	now := time.Now()
	startOfToday := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.Local)

	if params.AllowedCompanyIDs != nil {
		if len(params.AllowedCompanyIDs) == 0 {
			return q.Where("1 = 0")
		}
		q = q.Where("company_id IN ?", params.AllowedCompanyIDs)
	}

	if params.CompanyID != 0 {
		q = q.Where("company_id = ?", params.CompanyID)
	}

	singleCompanyNoIssueDates := params.CompanyID != 0 && params.DateFrom == nil && params.DateTo == nil
	hasIssueDateRange := params.DateFrom != nil || params.DateTo != nil
	situation := normalizeCollectionSituation(params.CollectionSituation)

	if situation != CollectionSituationAll && situation != "" {
		q = s.applyCollectionSituationFilter(q, situation, startOfToday)
	} else if params.ImplicitOpenBalances {
		q = q.Where("status IN ?", []string{DocumentStatusPending, DocumentStatusPartial})
	} else {
		if params.Status != "" {
			q = q.Where("status = ?", params.Status)
		}
		if params.Overdue {
			q = q.Where("due_date IS NOT NULL AND due_date < ? AND status <> ? AND status <> ?", startOfToday, DocumentStatusPaid, DocumentStatusCancelled)
		} else if (params.Status == DocumentStatusPending || params.Status == DocumentStatusPartial) && !singleCompanyNoIssueDates && !hasIssueDateRange {
			q = q.Where("(due_date IS NULL OR due_date >= ?)", startOfToday)
		}
	}

	if params.DateFrom != nil {
		q = q.Where("issue_date >= ?", *params.DateFrom)
	}
	if params.DateTo != nil {
		q = q.Where("issue_date < ?", *params.DateTo)
	}
	if shouldFilterDocumentsWithRealOpenBalance(params) {
		q = q.Where(documentOpenBalancePositiveClause())
	}
	return q
}

func formatDebtDisplayNumberFromSettlementNumber(settlementNumber string) string {
	s := strings.TrimSpace(settlementNumber)
	if s == "" {
		return ""
	}
	upper := strings.ToUpper(s)
	if strings.HasPrefix(upper, "LI-") {
		return "DEU-LI-" + s[len("LI-"):]
	}
	return "DEU-LI-" + s
}

func (s *DocumentService) enrichDocumentDisplayNumbers(list []models.Document) {
	if len(list) == 0 {
		return
	}
	settlementNums := collectSettlementNumbersForDebtDocs(list)
	for i := range list {
		d := &list[i]
		if !isDocumentFromLiquidacion(*d) {
			continue
		}
		sid, ok := liquidationSettlementIDFromDebtNumber(d.Number)
		if !ok {
			continue
		}
		sn := strings.TrimSpace(settlementNums[sid])
		if sn == "" {
			continue
		}
		d.DisplayNumber = formatDebtDisplayNumberFromSettlementNumber(sn)
	}
}

// enrichDocumentHasItems marca HasItems según existencia de líneas en document_items (una consulta por lote).
func (s *DocumentService) enrichDocumentHasItems(list []models.Document) {
	if len(list) == 0 {
		return
	}
	ids := make([]uint, len(list))
	for i := range list {
		ids[i] = list[i].ID
	}
	var docIDs []uint
	if err := database.DB.Raw(
		"SELECT DISTINCT document_id FROM document_items WHERE document_id IN ?",
		ids,
	).Scan(&docIDs).Error; err != nil {
		return
	}
	set := make(map[uint]struct{}, len(docIDs))
	for _, id := range docIDs {
		set[id] = struct{}{}
	}
	for i := range list {
		if _, ok := set[list[i].ID]; ok {
			list[i].HasItems = true
		}
	}
}

func (s *DocumentService) List(params DocumentListParams) ([]models.Document, error) {
	var list []models.Document
	q := database.DB.Model(&models.Document{})
	q = debtsvc.ScopeActiveDocuments(q)
	q = s.applyDocumentListFilters(q, params)
	if err := q.Preload("Company").Preload("TaxSettlement").Order("issue_date DESC, id DESC").Find(&list).Error; err != nil {
		return nil, err
	}
	s.enrichDocumentDisplayNumbers(list)
	s.enrichDocumentHasItems(list)
	s.enrichDocumentsFinancials(list)
	return list, nil
}

func (s *DocumentService) ListPaged(params DocumentListParams, page int, perPage int) ([]models.Document, int64, error) {
	if page <= 0 {
		page = 1
	}
	if perPage <= 0 {
		perPage = 20
	}

	base := database.DB.Model(&models.Document{})
	base = debtsvc.ScopeActiveDocuments(base)
	base = s.applyDocumentListFilters(base, params)

	var total int64
	if err := base.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	q := base.Preload("Company").Preload("TaxSettlement")
	if params.IncludeItems && params.CompanyID != 0 {
		q = q.Preload("Items", func(db *gorm.DB) *gorm.DB {
			return db.Order("sort_order ASC, id ASC")
		})
	}
	q = q.Order("issue_date DESC, id DESC").
		Limit(perPage).
		Offset((page - 1) * perPage)

	var list []models.Document
	if err := q.Find(&list).Error; err != nil {
		return nil, 0, err
	}
	s.enrichDocumentDisplayNumbers(list)
	if params.IncludeItems && params.CompanyID != 0 {
		for i := range list {
			list[i].HasItems = len(list[i].Items) > 0
		}
	} else {
		s.enrichDocumentHasItems(list)
	}
	s.enrichDocumentsFinancials(list)
	return list, total, nil
}

// ListCompaniesDebtSummaryPaged lista empresas distintas que tienen documentos con los mismos filtros;
// total es la cantidad de empresas; OpenBalanceTotal suma max(0, total_amount - pagado) por documento.
func (s *DocumentService) ListCompaniesDebtSummaryPaged(params DocumentListParams, page, perPage int) ([]CompanyDebtSummaryRow, int64, error) {
	if page <= 0 {
		page = 1
	}
	if perPage <= 0 {
		perPage = 20
	}

	base := database.DB.Model(&models.Document{})
	base = s.applyDocumentListFilters(base, params)

	countSub := base.Session(&gorm.Session{}).Select("company_id").Group("company_id")
	var total int64
	if err := database.DB.Table("(?) AS company_groups", countSub).Count(&total).Error; err != nil {
		return nil, 0, err
	}

	type idRow struct {
		CompanyID uint `gorm:"column:company_id"`
	}
	var idRows []idRow
	if err := base.Session(&gorm.Session{}).Select("company_id").Group("company_id").
		Order("company_id ASC").Limit(perPage).Offset((page - 1) * perPage).Find(&idRows).Error; err != nil {
		return nil, 0, err
	}

	out := make([]CompanyDebtSummaryRow, 0, len(idRows))
	for _, ir := range idRows {
		if ir.CompanyID == 0 {
			continue
		}
		var docs []models.Document
		q := base.Session(&gorm.Session{}).Where("company_id = ?", ir.CompanyID).
			Select("id", "total_amount", "status")
		if err := q.Find(&docs).Error; err != nil {
			return nil, 0, err
		}
		var openSum float64
		for _, d := range docs {
			if !debtsvc.IsActiveDebt(&d) {
				continue
			}
			ob := d.BalanceAmount
			if ob <= 0.005 {
				ob = debtsvc.NewService().EffectiveBalance(database.DB, &d)
			}
			if ob > 0 && !math.IsNaN(ob) {
				openSum += math.Round(ob*100) / 100
			}
		}
		var co models.Company
		_ = database.DB.First(&co, ir.CompanyID).Error
		out = append(out, CompanyDebtSummaryRow{
			CompanyID:        ir.CompanyID,
			Company:          co,
			DocumentCount:    int64(len(docs)),
			OpenBalanceTotal: math.Round(openSum*100) / 100,
		})
	}
	return out, total, nil
}

func (s *DocumentService) enrichDocumentsFinancials(list []models.Document) {
	if len(list) == 0 {
		return
	}
	now := time.Now()
	debtSvc := debtsvc.NewService()
	for i := range list {
		paid := debtSvc.PaidTotal(database.DB, list[i].ID)
		list[i].PaidAmount = math.Round(paid*100) / 100
		bal := debtSvc.EffectiveBalance(database.DB, &list[i])
		list[i].BalanceAmount = bal
		list[i].IsOverdue = DocumentIsOverdue(&list[i], bal, now)
	}
}

func (s *DocumentService) loadDocumentPaymentHistory(documentID uint) ([]models.DocumentPaymentHistoryEntry, error) {
	type row struct {
		PaymentID   uint
		Date        time.Time
		Amount      float64
		Method      string
		Reference   string
		Notes       string
		Description string
	}
	var rows []row

	err := database.DB.Raw(`
		SELECT p.id AS payment_id, p.date, pa.amount, p.method, p.reference, p.notes, p.description
		FROM payment_allocations pa
		INNER JOIN payments p ON p.id = pa.payment_id AND p.deleted_at IS NULL
		WHERE pa.document_id = ? AND pa.deleted_at IS NULL
		UNION ALL
		SELECT p.id, p.date, p.amount, p.method, p.reference, p.notes, p.description
		FROM payments p
		WHERE p.document_id = ? AND p.deleted_at IS NULL
		AND NOT EXISTS (SELECT 1 FROM payment_allocations pa2 WHERE pa2.payment_id = p.id AND pa2.deleted_at IS NULL)
		ORDER BY date ASC, payment_id ASC
	`, documentID, documentID).Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	out := make([]models.DocumentPaymentHistoryEntry, 0, len(rows))
	for _, r := range rows {
		out = append(out, models.DocumentPaymentHistoryEntry{
			PaymentID:   r.PaymentID,
			Date:        r.Date,
			Amount:      math.Round(r.Amount*100) / 100,
			Method:      r.Method,
			Reference:   r.Reference,
			Notes:       r.Notes,
			Description: r.Description,
		})
	}
	return out, nil
}

func (s *DocumentService) GetByID(id uint) (*models.Document, error) {
	var d models.Document
	if err := database.DB.Preload("Company").Preload("Payments").
		Preload("Items", func(db *gorm.DB) *gorm.DB {
			return db.Order("sort_order ASC, id ASC")
		}).
		Preload("Items.Product").
		First(&d, id).Error; err != nil {
		return nil, err
	}
	d.HasItems = len(d.Items) > 0
	enriched := []models.Document{d}
	s.enrichDocumentsFinancials(enriched)
	d.PaidAmount = enriched[0].PaidAmount
	d.BalanceAmount = enriched[0].BalanceAmount
	d.IsOverdue = enriched[0].IsOverdue
	hist, err := s.loadDocumentPaymentHistory(id)
	if err == nil {
		d.PaymentHistory = hist
	}
	return &d, nil
}

func (s *DocumentService) Delete(id uint) error {
	// No permitir eliminar si tiene pagos asociados
	var count int64
	database.DB.Model(&models.Payment{}).Where("document_id = ?", id).Count(&count)
	if count > 0 {
		return errors.New("no se puede eliminar porque tiene pagos asociados")
	}
	if err := database.DB.Where("document_id = ?", id).Delete(&models.DocumentItem{}).Error; err != nil {
		return err
	}
	result := database.DB.Delete(&models.Document{}, id)
	if result.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return result.Error
}

func (s *DocumentService) RecalculateStatusFromPayments(documentID uint) error {
	return debtsvc.NewService().PersistBalanceAndStatus(database.DB, documentID)
}
