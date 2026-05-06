package services

import (
	"fmt"
	"strings"

	"miappfiber/models"
)

// FiscalReceiptEnriched comprobante fiscal + etiquetas para listados y trazabilidad con liquidaciones.
type FiscalReceiptEnriched struct {
	models.TukifacFiscalReceipt
	DocumentKindLabel        string `json:"document_kind_label"`
	OriginLabel              string `json:"origin_label"`
	ReconciliationLabel      string `json:"reconciliation_label"`
	EffectiveTaxSettlementID *uint  `json:"effective_tax_settlement_id,omitempty"`
	SettlementNumber         string `json:"settlement_number,omitempty"`
	SettlementLinkStatus     string `json:"settlement_link_status"`
	SettlementLinkMessage    string `json:"settlement_link_message"`
}

// FiscalDocumentKindLabel SUNAT / Tukifac → texto UI.
func FiscalDocumentKindLabel(documentTypeID string) string {
	s := strings.TrimSpace(strings.ToUpper(documentTypeID))
	switch s {
	case "01":
		return "Factura"
	case "03":
		return "Boleta"
	case "NV":
		return "Nota de venta"
	default:
		if strings.Contains(s, "NV") || strings.Contains(s, "NOTA") {
			return "Nota de venta"
		}
		if s == "" {
			return "Comprobante"
		}
		return s
	}
}

// FiscalReceiptOriginLabel origen técnico → texto UI.
func FiscalReceiptOriginLabel(origin string) string {
	switch strings.TrimSpace(origin) {
	case models.TukifacReceiptOriginIssuedLocal:
		return "Sistema"
	case models.TukifacReceiptOriginSync:
		return "Tukifac"
	default:
		if origin == "" {
			return "Tukifac"
		}
		return origin
	}
}

// FiscalReceiptReconciliationLabel estado de conciliación local.
func FiscalReceiptReconciliationLabel(status string) string {
	switch strings.TrimSpace(status) {
	case models.TukifacReceiptPending:
		return "Pendiente de conciliación"
	case models.TukifacReceiptLinked:
		return "Vinculado a pago"
	case models.TukifacReceiptDiscarded:
		return "Descartado"
	default:
		return status
	}
}

func effectiveSettlementFromReceipt(rec *models.TukifacFiscalReceipt) (id *uint, number string) {
	if rec == nil {
		return nil, ""
	}
	if rec.TaxSettlementID != nil && *rec.TaxSettlementID > 0 {
		if rec.TaxSettlement != nil && strings.TrimSpace(rec.TaxSettlement.Number) != "" {
			n := strings.TrimSpace(rec.TaxSettlement.Number)
			return rec.TaxSettlementID, n
		}
		return rec.TaxSettlementID, ""
	}
	if rec.LinkedPayment != nil && rec.LinkedPayment.TaxSettlementID != nil && *rec.LinkedPayment.TaxSettlementID > 0 {
		tid := rec.LinkedPayment.TaxSettlementID
		if rec.LinkedPayment.TaxSettlement != nil && strings.TrimSpace(rec.LinkedPayment.TaxSettlement.Number) != "" {
			return tid, strings.TrimSpace(rec.LinkedPayment.TaxSettlement.Number)
		}
		return tid, ""
	}
	return nil, ""
}

// EnrichFiscalReceipt construye la fila de listado (requiere preloads adecuados).
func EnrichFiscalReceipt(rec models.TukifacFiscalReceipt) FiscalReceiptEnriched {
	out := FiscalReceiptEnriched{TukifacFiscalReceipt: rec}
	out.DocumentKindLabel = FiscalDocumentKindLabel(rec.DocumentTypeID)
	out.OriginLabel = FiscalReceiptOriginLabel(rec.Origin)
	out.ReconciliationLabel = FiscalReceiptReconciliationLabel(rec.ReconciliationStatus)

	effID, effNum := effectiveSettlementFromReceipt(&rec)
	out.EffectiveTaxSettlementID = effID
	out.SettlementNumber = effNum

	switch {
	case rec.ReconciliationStatus == models.TukifacReceiptDiscarded:
		out.SettlementLinkStatus = "descartado"
		out.SettlementLinkMessage = "Comprobante descartado"
	case effID != nil:
		out.SettlementLinkStatus = "vinculado"
		if effNum != "" {
			out.SettlementLinkMessage = fmt.Sprintf("Este documento pertenece a la liquidación N° %s", effNum)
		} else {
			out.SettlementLinkMessage = fmt.Sprintf("Este documento pertenece a la liquidación #%d", *effID)
		}
	default:
		out.SettlementLinkStatus = "pendiente"
		out.SettlementLinkMessage = "Sin vinculación a liquidación — pendiente de conciliación"
	}
	return out
}
