package debt

import (
	"fmt"
	"strings"

	"miappfiber/models"
)

// PeriodDisplayMMYYYY formatea periodo para UI/PDF: MM/YYYY o "—".
func PeriodDisplayMMYYYY(doc *models.Document) string {
	if doc == nil {
		return "—"
	}
	if doc.HasPeriod && doc.PeriodMonth != nil && doc.PeriodYear != nil {
		return fmt.Sprintf("%02d/%04d", *doc.PeriodMonth, *doc.PeriodYear)
	}
	for _, src := range []string{doc.AccountingPeriod, doc.ServiceMonth} {
		if mo, yr, ok := ParseYYYYMM(src); ok {
			return fmt.Sprintf("%02d/%04d", mo, yr)
		}
	}
	return "—"
}

// PeriodLabelForReceipt concepto/PDF: YYYY-MM legacy o MM/YYYY si has_period.
func PeriodLabelForReceipt(doc *models.Document) string {
	if doc == nil {
		return ""
	}
	if doc.HasPeriod && doc.PeriodMonth != nil && doc.PeriodYear != nil {
		return fmt.Sprintf("%02d/%04d", *doc.PeriodMonth, *doc.PeriodYear)
	}
	if p := strings.TrimSpace(doc.AccountingPeriod); p != "" {
		if mo, yr, ok := ParseYYYYMM(p); ok {
			return fmt.Sprintf("%02d/%04d", mo, yr)
		}
		return p
	}
	if p := strings.TrimSpace(doc.ServiceMonth); p != "" {
		if mo, yr, ok := ParseYYYYMM(p); ok {
			return fmt.Sprintf("%02d/%04d", mo, yr)
		}
		return p
	}
	return ""
}
