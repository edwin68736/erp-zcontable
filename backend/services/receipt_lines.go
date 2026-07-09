package services

import (
	debtsvc "miappfiber/services/debt"

	"miappfiber/models"
)

// BuildReceiptLinesFromPayment genera líneas de comprobante desde imputaciones del pago.
func BuildReceiptLinesFromPayment(pay *models.Payment) []models.FiscalReceiptLine {
	return buildLinesFromPaymentAllocations(pay)
}

// ReceiptDocumentPeriodLabel periodo para línea de comprobante (MM/YYYY o "—").
func ReceiptDocumentPeriodLabel(doc *models.Document) string {
	return debtsvc.PeriodDisplayMMYYYY(doc)
}
