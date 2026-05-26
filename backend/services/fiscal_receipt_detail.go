package services

import (
	"fmt"
	"math"
	"sort"
	"strings"

	"miappfiber/database"
	"miappfiber/models"

	"gorm.io/gorm"
)

func roundFiscalMoney(v float64) float64 {
	return math.Round(v*100) / 100
}

func documentPeriodLabel(doc *models.Document) string {
	if doc == nil {
		return ""
	}
	if p := strings.TrimSpace(doc.AccountingPeriod); p != "" {
		return p
	}
	return strings.TrimSpace(doc.ServiceMonth)
}

// buildLinesFromPaymentAllocations genera líneas de PDF desde imputaciones del pago (deudas / liquidación).
func buildLinesFromPaymentAllocations(pay *models.Payment) []models.FiscalReceiptLine {
	if pay == nil || len(pay.Allocations) == 0 {
		return nil
	}
	lines := make([]models.FiscalReceiptLine, 0, len(pay.Allocations))
	for i, a := range pay.Allocations {
		amt := roundFiscalMoney(a.Amount)
		if amt <= 0 {
			continue
		}
		base := roundFiscalMoney(amt / 1.18)
		igv := roundFiscalMoney(amt - base)
		desc := "Pago de deuda"
		if a.Document != nil {
			d := strings.TrimSpace(a.Document.Description)
			if d != "" {
				desc = d
			}
			if per := documentPeriodLabel(a.Document); per != "" {
				desc = fmt.Sprintf("%s — %s", desc, per)
			}
		}
		lines = append(lines, models.FiscalReceiptLine{
			LineType:     models.FiscalReceiptLineTypeManual,
			ProductName:  desc,
			Description:  desc,
			InternalCode: fmt.Sprintf("%04d", i+1),
			UnitTypeID:   "NIU",
			Quantity:     1,
			UnitPrice:    amt,
			LineSubtotal: base,
			IGVRate:      18,
			IGVAmount:    igv,
			LineTotal:    amt,
			SortOrder:    i,
		})
	}
	return lines
}

func sumLineTotals(lines []models.FiscalReceiptLine) (subtotal, tax, total float64) {
	for _, ln := range lines {
		subtotal += ln.LineSubtotal
		tax += ln.IGVAmount
		total += ln.LineTotal
	}
	return roundFiscalMoney(subtotal), roundFiscalMoney(tax), roundFiscalMoney(total)
}

func uniqueNonEmptyStrings(in []string) []string {
	seen := make(map[string]struct{}, len(in))
	out := make([]string, 0, len(in))
	for _, s := range in {
		t := strings.TrimSpace(s)
		if t == "" {
			continue
		}
		k := strings.ToLower(t)
		if _, ok := seen[k]; ok {
			continue
		}
		seen[k] = struct{}{}
		out = append(out, t)
	}
	sort.Strings(out)
	return out
}

func resolveFiscalReceiptPeriodLabel(rec *models.TukifacFiscalReceipt) string {
	if rec == nil {
		return ""
	}
	if rec.TaxSettlement != nil {
		if pl := strings.TrimSpace(rec.TaxSettlement.PeriodLabel); pl != "" {
			return pl
		}
		if lp := strings.TrimSpace(rec.TaxSettlement.LiquidationPeriod); lp != "" {
			return lp
		}
	}
	if rec.LinkedPayment != nil && rec.LinkedPayment.TaxSettlement != nil {
		st := rec.LinkedPayment.TaxSettlement
		if pl := strings.TrimSpace(st.PeriodLabel); pl != "" {
			return pl
		}
		if lp := strings.TrimSpace(st.LiquidationPeriod); lp != "" {
			return lp
		}
	}
	periods := make([]string, 0)
	if rec.LinkedPayment != nil {
		for _, a := range rec.LinkedPayment.Allocations {
			if p := documentPeriodLabel(a.Document); p != "" {
				periods = append(periods, p)
			}
		}
	}
	periods = uniqueNonEmptyStrings(periods)
	if len(periods) == 0 {
		return ""
	}
	return strings.Join(periods, ", ")
}

func splitPaymentMethodHeader(header string) []string {
	h := strings.TrimSpace(header)
	if h == "" {
		return nil
	}
	if strings.Contains(h, "+") {
		parts := strings.Split(h, "+")
		out := make([]string, 0, len(parts))
		for _, p := range parts {
			if t := strings.TrimSpace(p); t != "" {
				out = append(out, t)
			}
		}
		if len(out) > 0 {
			return out
		}
	}
	return []string{h}
}

func syncFiscalReceiptPayments(rec *models.TukifacFiscalReceipt) {
	if rec == nil {
		return
	}
	if len(rec.Payments) > 0 {
		methods := make([]string, 0, len(rec.Payments))
		for _, p := range rec.Payments {
			if m := strings.TrimSpace(p.Method); m != "" {
				methods = append(methods, m)
			}
		}
		methods = uniqueNonEmptyStrings(methods)
		if len(methods) > 0 {
			rec.PaymentMethod = strings.Join(methods, " + ")
		}
		return
	}

	if rec.LinkedPayment != nil {
		m := strings.TrimSpace(rec.LinkedPayment.Method)
		if m != "" {
			rec.PaymentMethod = m
			rec.Payments = []models.FiscalReceiptPayment{{
				SortOrder:       0,
				Method:          m,
				Amount:          rec.Total,
				OperationNumber: strings.TrimSpace(rec.LinkedPayment.Reference),
			}}
			return
		}
	}

	pm := strings.TrimSpace(rec.PaymentMethod)
	if pm == "" {
		return
	}
	parts := splitPaymentMethodHeader(pm)
	if len(parts) > 1 {
		rows := make([]models.FiscalReceiptPayment, 0, len(parts))
		for i, part := range parts {
			rows = append(rows, models.FiscalReceiptPayment{
				SortOrder: i,
				Method:    part,
				Amount:    rec.Total,
			})
		}
		rec.Payments = rows
		return
	}
	rec.Payments = []models.FiscalReceiptPayment{{
		SortOrder: 0,
		Method:    pm,
		Amount:    rec.Total,
	}}
}

// GetFiscalReceiptDetail detalle para PDF / vista (líneas, pagos, empresa, período).
func (s *FiscalReceiptService) GetFiscalReceiptDetail(id uint) (*models.TukifacFiscalReceipt, error) {
	var rec models.TukifacFiscalReceipt
	err := database.DB.
		Preload("Company").
		Preload("TaxSettlement").
		Preload("Lines", func(db *gorm.DB) *gorm.DB {
			return db.Order("sort_order ASC, id ASC")
		}).
		Preload("Payments", func(db *gorm.DB) *gorm.DB {
			return db.Order("sort_order ASC, id ASC")
		}).
		Preload("IssuedByUser").
		Preload("LinkedPayment").
		Preload("LinkedPayment.TaxSettlement").
		Preload("LinkedPayment.Allocations", func(db *gorm.DB) *gorm.DB {
			return db.Order("id ASC")
		}).
		Preload("LinkedPayment.Allocations.Document").
		First(&rec, id).Error
	if err != nil {
		return nil, err
	}

	if len(rec.Lines) == 0 && rec.LinkedPaymentID != nil && *rec.LinkedPaymentID > 0 {
		var pay models.Payment
		if err := database.DB.
			Preload("Allocations", func(db *gorm.DB) *gorm.DB {
				return db.Order("id ASC")
			}).
			Preload("Allocations.Document").
			Preload("TaxSettlement").
			First(&pay, *rec.LinkedPaymentID).Error; err == nil {
			rec.Lines = buildLinesFromPaymentAllocations(&pay)
			if rec.LinkedPayment == nil {
				rec.LinkedPayment = &pay
			} else if len(rec.LinkedPayment.Allocations) == 0 {
				rec.LinkedPayment.Allocations = pay.Allocations
			}
		}
	}

	if rec.Subtotal == 0 && rec.TaxAmount == 0 && len(rec.Lines) > 0 {
		sub, tax, tot := sumLineTotals(rec.Lines)
		rec.Subtotal = sub
		rec.TaxAmount = tax
		if rec.Total == 0 {
			rec.Total = tot
		}
	}

	syncFiscalReceiptPayments(&rec)
	rec.PeriodLabel = resolveFiscalReceiptPeriodLabel(&rec)

	return &rec, nil
}
