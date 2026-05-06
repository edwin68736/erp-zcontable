package services

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"strings"
	"time"

	"miappfiber/config"
	"miappfiber/database"
	"miappfiber/models"

	"gorm.io/gorm"
)

// TukifacDocument representa el payload mínimo que esperamos desde Tukifac.
// Se centra en los campos definidos en req.md.
type TukifacDocument struct {
	ID           string  `json:"id"`
	DocType      string  `json:"tipo_comprobante"`
	Number       string  `json:"numero"`
	IssueDateRaw string  `json:"fecha_emision"`
	TotalAmount  float64 `json:"monto_total"`
	Status       string  `json:"estado"`
	CompanyRUC   string  `json:"ruc"`
}

type TukifacService struct {
	httpClient *http.Client
}

func NewTukifacService() *TukifacService {
	return &TukifacService{
		httpClient: &http.Client{
			Timeout: 60 * time.Second,
		},
	}
}

type TukifacDocumentsListItem struct {
	ID                   TukifacFlexInt   `json:"id"`
	DateOfIssue          string           `json:"date_of_issue"`
	DateOfDue            string           `json:"date_of_due"`
	Number               TukifacFlexString `json:"number"`
	CustomerName         string           `json:"customer_name"`
	CustomerNumber       string           `json:"customer_number"`
	CurrencyTypeID       string           `json:"currency_type_id"`
	Total                TukifacFlexFloat `json:"total"`
	StateTypeID          string           `json:"state_type_id"`
	StateTypeDescription string  `json:"state_type_description"`
	DocumentTypeID       string  `json:"document_type_id"`
	DocumentTypeDesc     string  `json:"document_type_description"`
	HasXML               bool    `json:"has_xml"`
	HasPDF               bool    `json:"has_pdf"`
	HasCDR               bool    `json:"has_cdr"`
	DownloadXML          string  `json:"download_xml"`
	DownloadPDF          string  `json:"download_pdf"`
	DownloadCDR          string  `json:"download_cdr"`
	ExternalID           string  `json:"external_id"`
	CreatedAt            string  `json:"created_at"`
	UpdatedAt            string  `json:"updated_at"`
}

type TukifacDocumentsListResponse struct {
	Data []TukifacDocumentsListItem `json:"data"`
}

func (s *TukifacService) getAPIConfig() (string, string, error) {
	var cfg models.FirmConfig
	_ = database.DB.First(&cfg).Error

	baseURL := strings.TrimSpace(cfg.TukifacAPIURL)
	token := strings.TrimSpace(cfg.TukifacAPIToken)

	if baseURL == "" {
		baseURL = strings.TrimSpace(config.AppConfig.TukifacBaseURL)
	}
	if token == "" {
		token = strings.TrimSpace(config.AppConfig.TukifacAPIToken)
	}

	if baseURL == "" {
		return "", "", errors.New("URL del API de Tukifac no está configurada")
	}
	if token == "" {
		return "", "", errors.New("Token de Tukifac no está configurado")
	}
	return baseURL, token, nil
}

func normalizeBearerToken(value string) string {
	v := strings.TrimSpace(value)
	if v == "" {
		return ""
	}
	if strings.HasPrefix(strings.ToLower(v), "bearer ") {
		return v
	}
	return "Bearer " + v
}

func buildTukifacURL(base string, pathWithOrWithoutAPI string) string {
	b := strings.TrimRight(strings.TrimSpace(base), "/")
	if strings.HasSuffix(b, "/api") {
		return b + strings.TrimPrefix(pathWithOrWithoutAPI, "/api")
	}
	return b + pathWithOrWithoutAPI
}

// fetchTukifacListBody GET al listado Tukifac (mismo patrón de fechas que el API Laravel).
func (s *TukifacService) fetchTukifacListBody(apiListPath string, startDate string, endDate string) ([]byte, error) {
	baseURL, token, err := s.getAPIConfig()
	if err != nil {
		return nil, err
	}

	u := buildTukifacURL(baseURL, apiListPath)
	startDate = strings.TrimSpace(startDate)
	endDate = strings.TrimSpace(endDate)
	if startDate != "" || endDate != "" {
		if startDate == "" || endDate == "" {
			return nil, errors.New("Debe enviar fecha inicio y fecha fin")
		}
		u = fmt.Sprintf("%s/%s/%s", u, url.PathEscape(startDate), url.PathEscape(endDate))
	}

	req, err := http.NewRequest(http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", normalizeBearerToken(token))
	req.Header.Set("Accept", "application/json")

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("respuesta no exitosa de Tukifac: %s", resp.Status)
	}

	return io.ReadAll(resp.Body)
}

// getTukifacListJSON decodifica documents/lists al modelo unificado de comprobantes.
func (s *TukifacService) getTukifacListJSON(apiListPath string, startDate string, endDate string) (*TukifacDocumentsListResponse, error) {
	body, err := s.fetchTukifacListBody(apiListPath, startDate, endDate)
	if err != nil {
		return nil, err
	}
	var out TukifacDocumentsListResponse
	if err := json.Unmarshal(body, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (s *TukifacService) ListDocuments(startDate string, endDate string) (*TukifacDocumentsListResponse, error) {
	return s.getTukifacListJSON("/api/documents/lists", startDate, endDate)
}

// ListSaleNotes lista notas de venta desde Tukifac y las normaliza al mismo JSON que documents/lists para UI y sync.
func (s *TukifacService) ListSaleNotes(startDate string, endDate string) (*TukifacDocumentsListResponse, error) {
	body, err := s.fetchTukifacListBody("/api/sale-note/lists", startDate, endDate)
	if err != nil {
		return nil, err
	}
	return decodeTukifacSaleNoteListResponse(body)
}

// externalIDForSync genera clave única en tukifac_fiscal_receipts: facturas/boletas usan solo el id numérico (retrocompatible);
// notas de venta usan prefijo "nv-" para no colisionar con otro comprobante con el mismo id interno.
func externalIDForSync(prefix string, remoteID int) string {
	if remoteID <= 0 {
		return ""
	}
	if strings.TrimSpace(prefix) == "" {
		return fmt.Sprintf("%d", remoteID)
	}
	return fmt.Sprintf("%s%d", prefix, remoteID)
}

// parseTukifacIssueDate acepta fechas ISO (notas de venta) y dd-mm-yyyy (documents/lists).
func parseTukifacIssueDate(raw string) (time.Time, bool) {
	s := strings.TrimSpace(raw)
	if s == "" {
		return time.Time{}, false
	}
	layouts := []string{
		"2006-01-02",
		"02-01-2006",
		time.RFC3339,
	}
	for _, layout := range layouts {
		if t, err := time.ParseInLocation(layout, s, time.Local); err == nil {
			return t, true
		}
	}
	if len(s) >= 10 {
		if t, err := time.ParseInLocation("2006-01-02", s[:10], time.Local); err == nil {
			return t, true
		}
	}
	return time.Time{}, false
}

func (s *TukifacService) syncItemsToFiscalReceipts(items []TukifacDocumentsListItem, externalIDPrefix string, defaultDocType string) (int, int, error) {
	companiesCreated := 0
	createdOrUpdated := 0

	for _, d := range items {
		customerNumber := strings.TrimSpace(d.CustomerNumber)
		customerName := strings.TrimSpace(d.CustomerName)
		if customerNumber == "" {
			continue
		}
		if customerName == "" {
			customerName = "-"
		}

		var company models.Company
		err := database.DB.Where("ruc = ?", customerNumber).First(&company).Error
		if err != nil {
			internalCode := s.generateUniqueCompanyCode("TUK-" + customerNumber)
			company = models.Company{
				RUC:                  customerNumber,
				BusinessName:         customerName,
				InternalCode:         internalCode,
				Status:               "activo",
				Address:              "-",
				Phone:                "",
				Email:                "",
				SubscriptionActive: true,
			}
			if err := database.DB.Create(&company).Error; err != nil {
				continue
			}
			companiesCreated++
		}

		issueDate := time.Now()
		if t, ok := parseTukifacIssueDate(d.DateOfIssue); ok {
			issueDate = t
		}

		externalID := externalIDForSync(externalIDPrefix, d.ID.Int())
		if externalID == "" || strings.TrimSpace(d.Number.String()) == "" {
			continue
		}

		docType := strings.TrimSpace(d.DocumentTypeID)
		if docType == "" && defaultDocType != "" {
			docType = defaultDocType
		}

		var rec models.TukifacFiscalReceipt
		err = database.DB.Where("external_id = ?", externalID).First(&rec).Error
		if err == nil && rec.Origin == models.TukifacReceiptOriginIssuedLocal {
			continue
		}

		payload := models.TukifacFiscalReceipt{
			ExternalID:           externalID,
			CompanyID:            company.ID,
			DocumentTypeID:       docType,
			Number:               strings.TrimSpace(d.Number.String()),
			Total:                d.Total.Float64(),
			IssueDate:            issueDate,
			CustomerNumber:       customerNumber,
			CustomerName:         customerName,
			StateTypeDescription: strings.TrimSpace(d.StateTypeDescription),
			Origin:               models.TukifacReceiptOriginSync,
		}

		if err == nil {
			if rec.ReconciliationStatus == models.TukifacReceiptLinked {
				payload.LinkedPaymentID = rec.LinkedPaymentID
				payload.ReconciliationStatus = models.TukifacReceiptLinked
			} else {
				payload.ReconciliationStatus = rec.ReconciliationStatus
				payload.LinkedPaymentID = rec.LinkedPaymentID
			}
			rec.DocumentTypeID = payload.DocumentTypeID
			rec.Number = payload.Number
			rec.Total = payload.Total
			rec.IssueDate = payload.IssueDate
			rec.CustomerNumber = payload.CustomerNumber
			rec.CustomerName = payload.CustomerName
			rec.StateTypeDescription = payload.StateTypeDescription
			if err := database.DB.Save(&rec).Error; err != nil {
				continue
			}
			createdOrUpdated++
			continue
		}

		payload.ReconciliationStatus = models.TukifacReceiptPending
		if err := database.DB.Create(&payload).Error; err != nil {
			continue
		}
		createdOrUpdated++
	}

	return createdOrUpdated, companiesCreated, nil
}

func (s *TukifacService) SyncDocuments(startDate string, endDate string) (int, int, error) {
	list, err := s.ListDocuments(startDate, endDate)
	if err != nil {
		return 0, 0, err
	}
	return s.syncItemsToFiscalReceipts(list.Data, "", "")
}

// SyncSaleNotes importa notas de venta a tukifac_fiscal_receipts (conciliación igual que facturas/boletas).
func (s *TukifacService) SyncSaleNotes(startDate string, endDate string) (int, int, error) {
	list, err := s.ListSaleNotes(startDate, endDate)
	if err != nil {
		return 0, 0, err
	}
	return s.syncItemsToFiscalReceipts(list.Data, "nv-", "NV")
}

// FiscalReceiptListParams filtros y paginación para la bandeja de conciliación Tukifac.
type FiscalReceiptListParams struct {
	Status          string
	Origin          string
	CompanyID       *uint
	Ruc             string
	Number          string
	TaxSettlementID *uint
	NeedsSettlement bool // sin liquidación efectiva (columna ni pago con tax_settlement_id)
	Page            int
	PerPage         int
}

func buildFiscalReceiptListQuery(params FiscalReceiptListParams) *gorm.DB {
	q := database.DB.Model(&models.TukifacFiscalReceipt{})
	if strings.TrimSpace(params.Status) != "" {
		q = q.Where("reconciliation_status = ?", strings.TrimSpace(params.Status))
	}
	if o := strings.TrimSpace(params.Origin); o != "" {
		q = q.Where("origin = ?", o)
	}
	if params.CompanyID != nil && *params.CompanyID > 0 {
		q = q.Where("company_id = ?", *params.CompanyID)
	}
	if r := strings.TrimSpace(params.Ruc); r != "" {
		like := "%" + r + "%"
		sub := database.DB.Model(&models.Company{}).Select("id").Where("ruc LIKE ?", like)
		q = q.Where("(customer_number LIKE ?) OR (company_id IN (?))", like, sub)
	}
	if n := strings.TrimSpace(params.Number); n != "" {
		q = q.Where("number LIKE ?", "%"+n+"%")
	}
	if params.TaxSettlementID != nil && *params.TaxSettlementID > 0 {
		tid := *params.TaxSettlementID
		q = q.Where(
			"tax_settlement_id = ? OR linked_payment_id IN (SELECT id FROM payments WHERE tax_settlement_id = ? AND deleted_at IS NULL)",
			tid, tid,
		)
	}
	if params.NeedsSettlement {
		q = q.Where(`
			(tax_settlement_id IS NULL OR tax_settlement_id = 0)
			AND (
				linked_payment_id IS NULL OR NOT EXISTS (
					SELECT 1 FROM payments p
					WHERE p.id = tukifac_fiscal_receipts.linked_payment_id
					AND p.deleted_at IS NULL
					AND p.tax_settlement_id IS NOT NULL AND p.tax_settlement_id > 0
				)
			)
		`)
	}
	return q
}

// ListFiscalReceiptsPaged lista comprobantes con filtros y paginación (cada consulta usa un *gorm.DB nuevo).
func (s *TukifacService) ListFiscalReceiptsPaged(params FiscalReceiptListParams) ([]FiscalReceiptEnriched, int64, error) {
	page := params.Page
	if page <= 0 {
		page = 1
	}
	perPage := params.PerPage
	if perPage <= 0 {
		perPage = 20
	}
	if perPage > 200 {
		perPage = 200
	}

	var total int64
	if err := buildFiscalReceiptListQuery(params).Count(&total).Error; err != nil {
		return nil, 0, err
	}

	var list []models.TukifacFiscalReceipt
	err := buildFiscalReceiptListQuery(params).
		Preload("Company").
		Preload("TaxSettlement").
		Preload("LinkedPayment").
		Preload("LinkedPayment.TaxSettlement").
		Order("issue_date DESC, id DESC").
		Limit(perPage).
		Offset((page - 1) * perPage).
		Find(&list).Error
	if err != nil {
		return nil, 0, err
	}
	out := make([]FiscalReceiptEnriched, 0, len(list))
	for i := range list {
		if list[i].LinkedPayment != nil {
			list[i].LinkedPayment.TukifacFiscalReceipt = nil
		}
		out = append(out, EnrichFiscalReceipt(list[i]))
	}
	return out, total, nil
}

// GetFiscalReceiptByID carga un comprobante fiscal por id (control de acceso en el controlador).
func (s *TukifacService) GetFiscalReceiptByID(id uint) (*models.TukifacFiscalReceipt, error) {
	var r models.TukifacFiscalReceipt
	if err := database.DB.First(&r, id).Error; err != nil {
		return nil, err
	}
	return &r, nil
}

// ReceiptPaymentInput opciones al crear pago desde comprobante fiscal.
type ReceiptPaymentInput struct {
	AllocationMode  string                   `json:"allocation_mode"`
	Allocations     []PaymentAllocationInput `json:"allocations"`
	Method          string                   `json:"method"`
	Reference       string                   `json:"reference"`
	Attachment      string                   `json:"attachment"`
	Notes           string                   `json:"notes"`
	TaxSettlementID *uint                    `json:"tax_settlement_id"`
}

// CreatePaymentFromReceipt genera pago local + imputación y marca el comprobante como vinculado.
func (s *TukifacService) CreatePaymentFromReceipt(receiptID uint, in ReceiptPaymentInput) error {
	var rec models.TukifacFiscalReceipt
	if err := database.DB.First(&rec, receiptID).Error; err != nil {
		return err
	}
	if rec.ReconciliationStatus != models.TukifacReceiptPending {
		return errors.New("el comprobante no está pendiente de vincular")
	}

	pay := NewPaymentService()
	params := PaymentCreateParams{
		CompanyID:                 rec.CompanyID,
		Amount:                    rec.Total,
		Date:                      time.Now(),
		Type:                      "applied",
		Method:                    in.Method,
		Reference:                 in.Reference,
		Attachment:                in.Attachment,
		Notes:                     in.Notes,
		AllocationMode:            strings.TrimSpace(in.AllocationMode),
		Allocations:               in.Allocations,
		FiscalStatus:              "linked",
		AllowUnallocatedRemainder: true, // comprobante Tukifac: imputar hasta la deuda; el resto queda a favor en el mismo pago
		TaxSettlementID:           in.TaxSettlementID,
	}
	payID, err := pay.CreateFromParams(&params)
	if err != nil {
		return err
	}

	rec.ReconciliationStatus = models.TukifacReceiptLinked
	rec.LinkedPaymentID = &payID
	if in.TaxSettlementID != nil && *in.TaxSettlementID > 0 {
		tid := *in.TaxSettlementID
		rec.TaxSettlementID = &tid
	}
	return database.DB.Save(&rec).Error
}

// LinkReceiptToPayment asocia un comprobante fiscal a un pago ya existente (mismo monto y empresa).
func (s *TukifacService) LinkReceiptToPayment(receiptID, paymentID uint) error {
	var rec models.TukifacFiscalReceipt
	if err := database.DB.First(&rec, receiptID).Error; err != nil {
		return err
	}
	if rec.ReconciliationStatus != models.TukifacReceiptPending {
		return errors.New("el comprobante no está pendiente de vincular")
	}
	var pay models.Payment
	if err := database.DB.First(&pay, paymentID).Error; err != nil {
		return err
	}
	if pay.CompanyID != rec.CompanyID {
		return errors.New("el pago no pertenece a la misma empresa")
	}
	if math.Abs(pay.Amount-rec.Total) > 0.02 {
		return errors.New("el monto del pago no coincide con el comprobante")
	}
	var linkCount int64
	database.DB.Model(&models.TukifacFiscalReceipt{}).
		Where("linked_payment_id = ? AND id <> ?", paymentID, receiptID).
		Count(&linkCount)
	if linkCount > 0 {
		return errors.New("el pago ya está vinculado a otro comprobante")
	}

	rec.ReconciliationStatus = models.TukifacReceiptLinked
	rec.LinkedPaymentID = &paymentID
	if pay.TaxSettlementID != nil && *pay.TaxSettlementID > 0 {
		tid := *pay.TaxSettlementID
		rec.TaxSettlementID = &tid
	}
	pay.FiscalStatus = "linked"
	if err := database.DB.Save(&pay).Error; err != nil {
		return err
	}
	return database.DB.Save(&rec).Error
}

// LinkReceiptToTaxSettlement asigna o quita la liquidación emitida vinculada al comprobante (conciliación manual).
func (s *TukifacService) LinkReceiptToTaxSettlement(receiptID uint, settlementID *uint) error {
	var rec models.TukifacFiscalReceipt
	if err := database.DB.First(&rec, receiptID).Error; err != nil {
		return err
	}
	if rec.ReconciliationStatus == models.TukifacReceiptDiscarded {
		return errors.New("no se puede modificar un comprobante descartado")
	}
	if settlementID == nil || *settlementID == 0 {
		return database.DB.Model(&rec).Updates(map[string]interface{}{"tax_settlement_id": nil}).Error
	}
	var ts models.TaxSettlement
	if err := database.DB.First(&ts, *settlementID).Error; err != nil {
		return errors.New("liquidación inválida")
	}
	if ts.CompanyID != rec.CompanyID {
		return errors.New("la liquidación no corresponde a la empresa del comprobante")
	}
	if ts.Status != models.TaxSettlementStatusIssued {
		return errors.New("solo se puede vincular a liquidaciones emitidas")
	}
	return database.DB.Model(&rec).Update("tax_settlement_id", *settlementID).Error
}

// DiscardFiscalReceipt marca comprobante como descartado (no genera pago).
func (s *TukifacService) DiscardFiscalReceipt(receiptID uint) error {
	var rec models.TukifacFiscalReceipt
	if err := database.DB.First(&rec, receiptID).Error; err != nil {
		return err
	}
	if rec.ReconciliationStatus == models.TukifacReceiptLinked {
		return errors.New("no se puede descartar un comprobante ya vinculado")
	}
	rec.ReconciliationStatus = models.TukifacReceiptDiscarded
	rec.LinkedPaymentID = nil
	return database.DB.Save(&rec).Error
}

// TukifacSeriesItem refleja filas de series en Tukifac (document / sale-note).
type TukifacSeriesItem struct {
	ID                uint   `json:"id"`
	DocumentTypeID    string `json:"document_type_id"`
	Number            string `json:"number"`
	IsDefault         bool   `json:"is_default"`
	EstablishmentID   uint   `json:"establishment_id"`
}

func (s *TukifacService) fetchTukifacSimpleGET(apiPath string) ([]byte, error) {
	baseURL, token, err := s.getAPIConfig()
	if err != nil {
		return nil, err
	}
	u := buildTukifacURL(baseURL, apiPath)
	req, err := http.NewRequest(http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", normalizeBearerToken(token))
	req.Header.Set("Accept", "application/json")

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("respuesta no exitosa de Tukifac: %s", resp.Status)
	}

	return io.ReadAll(resp.Body)
}

func decodeTukifacSeriesList(body []byte) ([]TukifacSeriesItem, error) {
	raw := strings.TrimSpace(string(body))
	if raw == "" {
		return nil, errors.New("respuesta vacía de Tukifac (series)")
	}
	var arr []TukifacSeriesItem
	if err := json.Unmarshal([]byte(raw), &arr); err == nil {
		return arr, nil
	}
	var wrap struct {
		Data []TukifacSeriesItem `json:"data"`
	}
	if err := json.Unmarshal([]byte(raw), &wrap); err != nil {
		return nil, err
	}
	return wrap.Data, nil
}

// ListDocumentSeriesFacturaBoleta obtiene series SUNAT solo para factura (01) y boleta (03).
func (s *TukifacService) ListDocumentSeriesFacturaBoleta() ([]TukifacSeriesItem, error) {
	body, err := s.fetchTukifacSimpleGET("/api/document/series")
	if err != nil {
		return nil, err
	}
	items, err := decodeTukifacSeriesList(body)
	if err != nil {
		return nil, err
	}
	out := make([]TukifacSeriesItem, 0, len(items))
	for _, it := range items {
		t := strings.TrimSpace(it.DocumentTypeID)
		if t == "01" || t == "03" {
			out = append(out, it)
		}
	}
	return out, nil
}

// ListSaleNoteSeriesRemote lista series de nota de venta desde Tukifac.
func (s *TukifacService) ListSaleNoteSeriesRemote() ([]TukifacSeriesItem, error) {
	body, err := s.fetchTukifacSimpleGET("/api/sale-note/series")
	if err != nil {
		return nil, err
	}
	return decodeTukifacSeriesList(body)
}

func (s *TukifacService) generateUniqueCompanyCode(base string) string {
	code := strings.TrimSpace(base)
	if code == "" {
		code = "TUK"
	}
	if len(code) > 50 {
		code = code[:50]
	}

	candidate := code
	for i := 0; i < 50; i++ {
		var count int64
		if err := database.DB.Model(&models.Company{}).Where("internal_code = ?", candidate).Count(&count).Error; err == nil && count == 0 {
			return candidate
		}
		suffix := fmt.Sprintf("-%d", i+1)
		maxBase := 50 - len(suffix)
		basePart := code
		if len(basePart) > maxBase {
			basePart = basePart[:maxBase]
		}
		candidate = basePart + suffix
	}
	return fmt.Sprintf("TUK-%d", time.Now().Unix())
}
