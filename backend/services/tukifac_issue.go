package services

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"miappfiber/config"
	"miappfiber/database"
	"miappfiber/models"

	"gorm.io/gorm"
)

func (s *TukifacService) documentsPostPath() string {
	p := strings.TrimSpace(config.AppConfig.TukifacPostDocumentsPath)
	if p == "" {
		p = "/api/documents"
	}
	if !strings.HasPrefix(p, "/") {
		p = "/" + p
	}
	return p
}

func (s *TukifacService) saleNotePostPath() string {
	p := strings.TrimSpace(config.AppConfig.TukifacPostSaleNotePath)
	if p == "" {
		p = "/api/sale-note"
	}
	if !strings.HasPrefix(p, "/") {
		p = "/" + p
	}
	return p
}

// logTukifacRequestBody escribe en la consola del proceso (stdout del API) el POST exacto hacia Tukifac (sin cabecera Authorization).
func logTukifacRequestBody(fullURL string, jsonBody []byte) {
	body := string(jsonBody)
	var buf bytes.Buffer
	if err := json.Indent(&buf, jsonBody, "", "  "); err == nil {
		body = buf.String()
	}
	log.Printf("[Tukifac] envío POST %s cuerpo:\n%s", fullURL, body)
}

func (s *TukifacService) postTukifacJSON(path string, jsonBody []byte) (int, []byte, error) {
	baseURL, token, err := s.getAPIConfig()
	if err != nil {
		return 0, nil, err
	}
	u := buildTukifacURL(baseURL, path)
	logTukifacRequestBody(u, jsonBody)
	req, err := http.NewRequest(http.MethodPost, u, bytes.NewReader(jsonBody))
	if err != nil {
		return 0, nil, err
	}
	req.Header.Set("Authorization", normalizeBearerToken(token))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return 0, nil, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return resp.StatusCode, nil, err
	}
	return resp.StatusCode, body, nil
}

func extractPayloadCustomerRUC(payload []byte) (string, bool) {
	var m map[string]interface{}
	if err := json.Unmarshal(payload, &m); err != nil {
		return "", false
	}
	rec, ok := m["datos_del_cliente_o_receptor"].(map[string]interface{})
	if !ok {
		return "", false
	}
	num := stringish(rec["numero_documento"])
	return num, num != ""
}

func stringish(v interface{}) string {
	switch x := v.(type) {
	case string:
		return strings.TrimSpace(x)
	case float64:
		return fmt.Sprintf("%.0f", x)
	case json.Number:
		return strings.TrimSpace(x.String())
	default:
		return ""
	}
}

func floatish(v interface{}) (float64, bool) {
	switch x := v.(type) {
	case float64:
		return x, true
	case int:
		return float64(x), true
	case int64:
		return float64(x), true
	case json.Number:
		f, err := x.Float64()
		return f, err == nil
	default:
		return 0, false
	}
}

func parseTukifacCreateDataMap(body []byte) (map[string]interface{}, error) {
	var root map[string]interface{}
	if err := json.Unmarshal(body, &root); err != nil {
		return nil, err
	}
	if d, ok := root["data"].(map[string]interface{}); ok && len(d) > 0 {
		return d, nil
	}
	return root, nil
}

// parseIssuedReceiptFromTukifacResponse extrae campos habituales de respuestas Laravel / Tukifac.
func parseIssuedReceiptFromTukifacResponse(body []byte, saleNote bool) (externalID, number, docType string, total float64, issueDate time.Time, err error) {
	data, err := parseTukifacCreateDataMap(body)
	if err != nil {
		return "", "", "", 0, time.Time{}, err
	}

	idVal, ok := floatish(data["id"])
	if !ok || idVal <= 0 {
		return "", "", "", 0, time.Time{}, errors.New("la respuesta de Tukifac no incluye id reconocible del comprobante")
	}
	if saleNote {
		externalID = externalIDForSync("nv-", int(idVal))
	} else {
		externalID = externalIDForSync("", int(idVal))
	}

	number = strings.TrimSpace(stringish(data["number"]))
	if number == "" {
		number = strings.TrimSpace(stringish(data["number_full"]))
	}
	if number == "" {
		serie := stringish(data["serie_documento"])
		num := stringish(data["numero_documento"])
		if serie != "" && num != "" {
			number = serie + "-" + strings.TrimPrefix(num, "-")
		}
	}
	if number == "" {
		return "", "", "", 0, time.Time{}, errors.New("la respuesta de Tukifac no incluye número de comprobante")
	}

	docType = strings.TrimSpace(stringish(data["document_type_id"]))
	if docType == "" {
		docType = strings.TrimSpace(stringish(data["codigo_tipo_documento"]))
	}
	if saleNote && docType == "" {
		docType = "NV"
	}

	if t, ok := floatish(data["total"]); ok && t > 0 {
		total = t
	} else if tot, ok := data["totales"].(map[string]interface{}); ok {
		if tv, ok2 := floatish(tot["total_venta"]); ok2 {
			total = tv
		} else if tv, ok2 := floatish(tot["subtotal_venta"]); ok2 {
			total = tv
		}
	}
	if total <= 0 {
		if t, ok := floatish(data["total_venta"]); ok {
			total = t
		}
	}
	if total < 0 {
		total = 0
	}

	rawDate := stringish(data["date_of_issue"])
	if rawDate == "" {
		rawDate = stringish(data["fecha_de_emision"])
	}
	if rawDate == "" {
		rawDate = stringish(data["created_at"])
	}
	if t, ok := parseTukifacIssueDate(rawDate); ok {
		issueDate = t
	} else {
		issueDate = time.Now()
	}

	return externalID, number, docType, total, issueDate, nil
}

// parseTukifacDownloadURLs extrae enlaces de la raíz JSON (data.print_ticket, links.pdf).
func parseTukifacDownloadURLs(body []byte) (printTicket, pdfURL string) {
	var root map[string]interface{}
	if err := json.Unmarshal(body, &root); err != nil {
		return "", ""
	}
	if data, ok := root["data"].(map[string]interface{}); ok {
		printTicket = strings.TrimSpace(stringish(data["print_ticket"]))
	}
	if links, ok := root["links"].(map[string]interface{}); ok {
		pdfURL = strings.TrimSpace(stringish(links["pdf"]))
	}
	return printTicket, pdfURL
}

// IssueFiscalDocumentToTukifac envía el JSON de factura/boleta (manual o catálogo) y registra el comprobante localmente sin pasar por sincronización.
func (s *TukifacService) IssueFiscalDocumentToTukifac(companyID uint, payload []byte) (*models.TukifacFiscalReceipt, []byte, error) {
	return s.issueToTukifac(companyID, payload, false)
}

// IssueSaleNoteToTukifac envía el JSON de nota de venta y registra el comprobante localmente.
func (s *TukifacService) IssueSaleNoteToTukifac(companyID uint, payload []byte) (*models.TukifacFiscalReceipt, []byte, error) {
	return s.issueToTukifac(companyID, payload, true)
}

func (s *TukifacService) issueToTukifac(companyID uint, payload []byte, saleNote bool) (*models.TukifacFiscalReceipt, []byte, error) {
	payload = bytes.TrimSpace(payload)
	if len(payload) == 0 {
		return nil, nil, errors.New("payload vacío")
	}
	var company models.Company
	if err := database.DB.First(&company, companyID).Error; err != nil {
		return nil, nil, err
	}
	if cr, ok := extractPayloadCustomerRUC(payload); ok {
		if strings.TrimSpace(company.RUC) != "" && strings.TrimSpace(cr) != strings.TrimSpace(company.RUC) {
			return nil, nil, fmt.Errorf("el RUC/DNI del receptor en el payload (%s) no coincide con la empresa seleccionada (%s)", cr, company.RUC)
		}
	}

	path := s.documentsPostPath()
	if saleNote {
		path = s.saleNotePostPath()
	}
	status, respBody, err := s.postTukifacJSON(path, payload)
	if err != nil {
		return nil, respBody, err
	}
	if status < 200 || status >= 300 {
		return nil, respBody, fmt.Errorf("Tukifac respondió %d: %s", status, truncateRunes(string(respBody), 500))
	}

	externalID, number, docType, total, issueDate, err := parseIssuedReceiptFromTukifacResponse(respBody, saleNote)
	if err != nil {
		return nil, respBody, err
	}

	var existing models.TukifacFiscalReceipt
	err = database.DB.Where("external_id = ?", externalID).First(&existing).Error
	if err == nil {
		return nil, respBody, fmt.Errorf("ya existe un comprobante local con external_id %s", externalID)
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, respBody, err
	}

	customerName := strings.TrimSpace(company.BusinessName)
	if customerName == "" {
		customerName = "-"
	}

	printTicket, pdfDL := parseTukifacDownloadURLs(respBody)
	rec := models.TukifacFiscalReceipt{
		ExternalID:           externalID,
		CompanyID:            company.ID,
		DocumentTypeID:       docType,
		Number:               number,
		Total:                total,
		IssueDate:            issueDate,
		CustomerNumber:       strings.TrimSpace(company.RUC),
		CustomerName:         customerName,
		ReconciliationStatus: models.TukifacReceiptPending,
		Origin:               models.TukifacReceiptOriginIssuedLocal,
		PrintTicketURL:       printTicket,
		PdfURL:               pdfDL,
	}
	if err := database.DB.Create(&rec).Error; err != nil {
		return nil, respBody, err
	}
	_ = database.DB.Preload("Company").First(&rec, rec.ID).Error
	return &rec, respBody, nil
}

// LinkIssuedReceiptToPayment marca el comprobante recién emitido en Tukifac como vinculado al pago y a la liquidación del pago.
func (s *TukifacService) LinkIssuedReceiptToPayment(rec *models.TukifacFiscalReceipt, pay *models.Payment) error {
	if rec == nil || pay == nil {
		return errors.New("datos inválidos")
	}
	pid := pay.ID
	rec.LinkedPaymentID = &pid
	rec.ReconciliationStatus = models.TukifacReceiptLinked
	if pay.TaxSettlementID != nil && *pay.TaxSettlementID > 0 {
		tid := *pay.TaxSettlementID
		rec.TaxSettlementID = &tid
	}
	if err := database.DB.Save(rec).Error; err != nil {
		return err
	}
	return database.DB.Model(&models.Payment{}).Where("id = ?", pay.ID).Update("fiscal_status", "linked").Error
}

func truncateRunes(s string, max int) string {
	r := []rune(s)
	if len(r) <= max {
		return s
	}
	return string(r[:max]) + "…"
}
