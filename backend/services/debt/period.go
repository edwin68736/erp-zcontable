package debt

import (
	"regexp"
	"strconv"
	"strings"

	"miappfiber/models"
)

var canonicalYYYYMM = regexp.MustCompile(`^(\d{4})-(\d{2})$`)

// ParseYYYYMM extrae año y mes de cadenas AAAA-MM.
func ParseYYYYMM(s string) (month, year int16, ok bool) {
	s = strings.TrimSpace(s)
	m := canonicalYYYYMM.FindStringSubmatch(s)
	if len(m) != 3 {
		return 0, 0, false
	}
	y, err := strconv.Atoi(m[1])
	if err != nil || y < 1900 || y > 2200 {
		return 0, 0, false
	}
	mo, err := strconv.Atoi(m[2])
	if err != nil || mo < 1 || mo > 12 {
		return 0, 0, false
	}
	return int16(mo), int16(y), true
}

// ApplyPeriodFields actualiza has_period / period_month / period_year en el documento.
func ApplyPeriodFields(doc *models.Document, month, year int16) {
	if doc == nil {
		return
	}
	doc.HasPeriod = true
	m := month
	y := year
	doc.PeriodMonth = &m
	doc.PeriodYear = &y
}

// ApplyPeriodFromString intenta parsear accounting_period, service_month o period_ym.
func ApplyPeriodFromString(doc *models.Document, sources ...string) bool {
	for _, src := range sources {
		if mo, yr, ok := ParseYYYYMM(src); ok {
			ApplyPeriodFields(doc, mo, yr)
			return true
		}
	}
	return false
}
