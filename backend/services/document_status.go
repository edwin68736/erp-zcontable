package services

import (
	"math"
	"strings"
	"time"

	"miappfiber/models"
)

// Estados internos persistidos en documents.status (español, minúsculas).
const (
	DocumentStatusPending   = "pendiente"
	DocumentStatusPartial   = "parcial"
	DocumentStatusPaid      = "pagado"
	DocumentStatusCancelled = "anulado"
	DocumentStatusExonerado = "exonerado"
)

// Situaciones comerciales de cobranza (filtro UI / API).
const (
	CollectionSituationAll        = "all"
	CollectionSituationPorCobrar  = "por_cobrar"
	CollectionSituationPagadas    = "pagadas"
	CollectionSituationVencidas   = "vencidas"
	CollectionSituationAnuladas   = "anuladas"
)

const documentMoneyEpsilon = 0.005

func isValidCollectionSituation(s string) bool {
	switch strings.TrimSpace(strings.ToLower(s)) {
	case "", CollectionSituationAll, CollectionSituationPorCobrar, CollectionSituationPagadas,
		CollectionSituationVencidas, CollectionSituationAnuladas:
		return true
	default:
		return false
	}
}

func normalizeCollectionSituation(s string) string {
	v := strings.TrimSpace(strings.ToLower(s))
	if v == "" {
		return CollectionSituationAll
	}
	if isValidCollectionSituation(v) {
		return v
	}
	return CollectionSituationAll
}

// MapLegacyStatusFilter traduce filtros antiguos (status/overdue) a situación comercial.
func MapLegacyStatusFilter(status string, overdue bool) string {
	if overdue || strings.EqualFold(strings.TrimSpace(status), "vencido") {
		return CollectionSituationVencidas
	}
	switch strings.TrimSpace(strings.ToLower(status)) {
	case "all":
		return CollectionSituationAll
	case DocumentStatusPaid:
		return CollectionSituationPagadas
	case DocumentStatusCancelled:
		return CollectionSituationAnuladas
	case DocumentStatusPending, DocumentStatusPartial:
		return CollectionSituationPorCobrar
	default:
		return ""
	}
}

// ComputeDocumentStatusFromPaid deriva el estado interno según montos (ignora anulado).
func ComputeDocumentStatusFromPaid(paid, total float64, currentStatus string) string {
	if strings.TrimSpace(strings.ToLower(currentStatus)) == DocumentStatusCancelled {
		return DocumentStatusCancelled
	}
	if paid <= documentMoneyEpsilon {
		return DocumentStatusPending
	}
	if paid+documentMoneyEpsilon >= total {
		return DocumentStatusPaid
	}
	return DocumentStatusPartial
}

// DocumentBalance calcula saldo pendiente (≥ 0).
func DocumentBalance(total, paid float64) float64 {
	b := total - paid
	if b < 0 || b < documentMoneyEpsilon {
		return 0
	}
	return math.Round(b*100) / 100
}

// DocumentIsOverdue indica vencimiento dinámico: fecha vencida y saldo pendiente, no anulada/pagada.
func DocumentIsOverdue(d *models.Document, balance float64, at time.Time) bool {
	if d == nil || d.DueDate == nil || d.DueDate.IsZero() {
		return false
	}
	st := strings.TrimSpace(strings.ToLower(d.Status))
	if st == DocumentStatusPaid || st == DocumentStatusCancelled || st == DocumentStatusExonerado {
		return false
	}
	if balance <= documentMoneyEpsilon {
		return false
	}
	startOfToday := time.Date(at.Year(), at.Month(), at.Day(), 0, 0, 0, 0, at.Location())
	return d.DueDate.Before(startOfToday)
}

// DocumentDisplayStatusLabel etiqueta para badge UI (español).
func DocumentDisplayStatusLabel(d *models.Document, balance float64, at time.Time) string {
	if d == nil {
		return "—"
	}
	if DocumentIsOverdue(d, balance, at) {
		return "vencido"
	}
	switch strings.TrimSpace(strings.ToLower(d.Status)) {
	case DocumentStatusPartial:
		return "parcial"
	case DocumentStatusPending:
		return "pendiente"
	case DocumentStatusPaid:
		return "pagado"
	case DocumentStatusCancelled:
		return "anulado"
	case DocumentStatusExonerado:
		return "exonerado"
	default:
		return d.Status
	}
}
