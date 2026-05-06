package services

import (
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
	"time"

	"miappfiber/database"
	"miappfiber/models"
)

var limaLoc *time.Location

func init() {
	limaLoc, _ = time.LoadLocation("America/Lima")
	if limaLoc == nil {
		limaLoc = time.UTC
	}
}

func dateInLima(t time.Time) time.Time {
	if t.IsZero() {
		return time.Time{}
	}
	lt := t.In(limaLoc)
	return time.Date(lt.Year(), lt.Month(), lt.Day(), 0, 0, 0, 0, limaLoc)
}

// AccountLedgerMovement una fila del estado de cuenta estilo extracto bancario.
type AccountLedgerMovement struct {
	OperationDate  string  `json:"operation_date"`
	ProcessDate    string  `json:"process_date"`
	TypeCode       string  `json:"type_code"`
	DocumentNumber string  `json:"document_number"`
	Detail         string  `json:"detail"`
	PaymentMethod  string  `json:"payment_method"`
	OperationCode  string  `json:"operation_code"`
	Cargo          float64 `json:"cargo"`
	Abono          float64 `json:"abono"`
	Balance        float64 `json:"balance"`
}

// AccountLedger resumen y movimientos de un mes calendario o de un rango de fechas (zona America/Lima).
type AccountLedger struct {
	PeriodYear    int                     `json:"period_year"`
	PeriodMonth   int                     `json:"period_month"`
	PeriodLabel   string                  `json:"period_label"`
	LedgerKind    string                  `json:"ledger_kind,omitempty"`     // "month" | "date_range"
	RangeDateFrom string                  `json:"range_date_from,omitempty"` // yyyy-MM-dd (Lima), solo en date_range
	RangeDateTo   string                  `json:"range_date_to,omitempty"`   // yyyy-MM-dd (Lima), inclusivo
	SaldoAnterior float64                 `json:"saldo_anterior"`
	TotalAbonos   float64                 `json:"total_abonos"`
	TotalCargos   float64                 `json:"total_cargos"`
	SaldoFinal    float64                 `json:"saldo_final"`
	Movements     []AccountLedgerMovement `json:"movements"`
}

type ledgerEntry struct {
	opDate    time.Time
	processAt time.Time
	isPayment bool
	uid       uint
	typeCode  string
	docNumber string
	detail    string
	payMethod string
	opCode    string
	cargo     float64
	abono     float64
}

func statementDocumentTypeCode(d models.Document) string {
	t := strings.TrimSpace(strings.ToLower(d.Type))
	switch t {
	case "nota_venta":
		return "NV"
	case "recibo":
		return "RC"
	case "liquidacion_impuestos", "li":
		return "LI"
	case "plan":
		return "PL"
	}
	raw := strings.TrimSpace(d.Type)
	if len(raw) >= 2 {
		return strings.ToUpper(raw[:2])
	}
	return "DO"
}

func isDocumentFromLiquidacion(d models.Document) bool {
	if strings.TrimSpace(strings.ToLower(d.Source)) == "liquidacion" {
		return true
	}
	return strings.EqualFold(strings.TrimSpace(d.Type), "LI")
}

// IsDocumentFromLiquidacion indica deuda generada al emitir liquidación (DEU-LIQ-* / tipo LI).
func IsDocumentFromLiquidacion(d models.Document) bool {
	return isDocumentFromLiquidacion(d)
}

// liquidationSettlementIDFromDebtNumber extrae el ID de tax_settlement del número DEU-LIQ-{id}-{lineId}.
func liquidationSettlementIDFromDebtNumber(number string) (uint, bool) {
	s := strings.TrimSpace(number)
	const prefix = "DEU-LIQ-"
	if len(s) < len(prefix)+2 || !strings.HasPrefix(strings.ToUpper(s), prefix) {
		return 0, false
	}
	rest := s[len(prefix):]
	i := strings.IndexByte(rest, '-')
	if i <= 0 {
		return 0, false
	}
	id, err := strconv.ParseUint(rest[:i], 10, 32)
	if err != nil || id == 0 {
		return 0, false
	}
	return uint(id), true
}

func collectSettlementNumbersForDebtDocs(docs []models.Document) map[uint]string {
	ids := make([]uint, 0)
	seen := make(map[uint]struct{})
	for _, d := range docs {
		if !isDocumentFromLiquidacion(d) {
			continue
		}
		sid, ok := liquidationSettlementIDFromDebtNumber(d.Number)
		if !ok || sid == 0 {
			continue
		}
		if _, dup := seen[sid]; dup {
			continue
		}
		seen[sid] = struct{}{}
		ids = append(ids, sid)
	}
	if len(ids) == 0 {
		return nil
	}
	var rows []models.TaxSettlement
	if err := database.DB.Select("id", "number").Where("id IN ?", ids).Find(&rows).Error; err != nil {
		return nil
	}
	out := make(map[uint]string, len(rows))
	for _, r := range rows {
		if n := strings.TrimSpace(r.Number); n != "" {
			out[r.ID] = n
		}
	}
	return out
}

func normalizeDebtPeriodYM(accountingPeriod, serviceMonth string) string {
	s := strings.TrimSpace(accountingPeriod)
	if s == "" {
		s = strings.TrimSpace(serviceMonth)
	}
	if s == "" {
		return ""
	}
	if len(s) >= 7 && s[4] == '-' {
		return s[:7]
	}
	if len(s) == 6 {
		return s[:4] + "-" + s[4:6]
	}
	return s
}

// mesesStmtNombre mes en minúsculas para texto de estado de cuenta (ej. marzo-2026).
var mesesStmtNombre = []string{
	"", "enero", "febrero", "marzo", "abril", "mayo", "junio",
	"julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
}

func formatDebtPeriodHumanES(ym string) string {
	ym = strings.TrimSpace(ym)
	if ym == "" {
		return ""
	}
	var yStr, moStr string
	if len(ym) >= 7 && ym[4] == '-' {
		yStr, moStr = ym[:4], ym[5:7]
	} else if len(ym) == 6 {
		yStr, moStr = ym[:4], ym[4:6]
	} else {
		return ym
	}
	mo, err := strconv.Atoi(moStr)
	if err != nil || mo < 1 || mo > 12 {
		return ym
	}
	return fmt.Sprintf("%s-%s", mesesStmtNombre[mo], yStr)
}

func statementDocumentDetailWithPeriod(d models.Document) string {
	base := statementDocumentDetail(d)
	ym := normalizeDebtPeriodYM(d.AccountingPeriod, d.ServiceMonth)
	if ym == "" {
		return base
	}
	ymHuman := formatDebtPeriodHumanES(ym)
	if ymHuman == "" {
		ymHuman = ym
	}
	if base != "" {
		return base + " (" + ymHuman + ")"
	}
	return "(" + ymHuman + ")"
}

func ledgerCargoTypeDisplay(d models.Document) string {
	if isDocumentFromLiquidacion(d) {
		return "LI"
	}
	return statementDocumentTypeCode(d)
}

func ledgerCargoDocNumber(d models.Document, settlementNums map[uint]string) string {
	if isDocumentFromLiquidacion(d) {
		if sid, ok := liquidationSettlementIDFromDebtNumber(d.Number); ok {
			if settlementNums != nil {
				if n := settlementNums[sid]; n != "" {
					return n
				}
			}
		}
	}
	num := strings.TrimSpace(d.Number)
	if num == "" {
		return fmt.Sprintf("#%d", d.ID)
	}
	return num
}

func tukifacReceiptTypeDisplay(rec *models.TukifacFiscalReceipt) string {
	if rec == nil {
		return ""
	}
	dt := strings.TrimSpace(strings.ToUpper(rec.DocumentTypeID))
	switch dt {
	case "01", "03", "07", "08", "09", "20", "40":
		return dt
	case "NV":
		return "NV"
	default:
		if dt != "" {
			if len(dt) <= 4 {
				return dt
			}
			return dt[:4]
		}
	}
	return "CF"
}

func statementDocumentDetail(d models.Document) string {
	parts := make([]string, 0, len(d.Items)+1)
	for _, it := range d.Items {
		if s := strings.TrimSpace(it.Description); s != "" {
			parts = append(parts, s)
		}
	}
	if len(parts) > 0 {
		return strings.Join(parts, " · ")
	}
	return strings.TrimSpace(d.Description)
}

func paymentLedgerDetail(p models.Payment) string {
	if strings.TrimSpace(p.Notes) != "" {
		return strings.TrimSpace(p.Notes)
	}
	if p.Document != nil && strings.TrimSpace(p.Document.Number) != "" {
		return fmt.Sprintf("Abono a deuda %s", strings.TrimSpace(p.Document.Number))
	}
	if p.TaxSettlement != nil && strings.TrimSpace(p.TaxSettlement.Number) != "" {
		return fmt.Sprintf("Abono liquidación %s", strings.TrimSpace(p.TaxSettlement.Number))
	}
	if p.TaxSettlementID != nil && *p.TaxSettlementID != 0 {
		return fmt.Sprintf("Abono liquidación #%d", *p.TaxSettlementID)
	}
	return "Abono / pago registrado"
}

func collectSortedLedgerEntries(docs []models.Document, pays []models.Payment) []ledgerEntry {
	entries := make([]ledgerEntry, 0, len(docs)+len(pays))
	settlementNums := collectSettlementNumbersForDebtDocs(docs)

	for _, d := range docs {
		if strings.TrimSpace(strings.ToLower(d.Status)) == "anulado" {
			continue
		}
		op := dateInLima(d.IssueDate)
		if op.IsZero() {
			op = dateInLima(d.CreatedAt)
		}
		proc := d.CreatedAt
		if proc.IsZero() {
			proc = d.IssueDate
		}
		typeDisp := ledgerCargoTypeDisplay(d)
		docNum := ledgerCargoDocNumber(d, settlementNums)
		entries = append(entries, ledgerEntry{
			opDate:    op,
			processAt: proc,
			isPayment: false,
			uid:       d.ID,
			typeCode:  typeDisp,
			docNumber: docNum,
			detail:    statementDocumentDetailWithPeriod(d),
			cargo:     math.Round(d.TotalAmount*100) / 100,
			abono:     0,
		})
	}

	for _, p := range pays {
		op := dateInLima(p.Date)
		if op.IsZero() {
			op = dateInLima(p.CreatedAt)
		}
		proc := p.CreatedAt
		if proc.IsZero() {
			proc = p.Date
		}
		refDoc := ""
		if p.Document != nil {
			refDoc = strings.TrimSpace(p.Document.Number)
		}
		if refDoc == "" {
			refDoc = fmt.Sprintf("P-%d", p.ID)
		}
		typeDisp := fmt.Sprintf("AB%06d", p.ID)
		docNum := refDoc
		if p.TukifacFiscalReceipt != nil {
			if tc := tukifacReceiptTypeDisplay(p.TukifacFiscalReceipt); tc != "" {
				typeDisp = tc
			}
			if n := strings.TrimSpace(p.TukifacFiscalReceipt.Number); n != "" {
				docNum = n
			}
		}
		entries = append(entries, ledgerEntry{
			opDate:    op,
			processAt: proc,
			isPayment: true,
			uid:       p.ID,
			typeCode:  typeDisp,
			docNumber: docNum,
			detail:    paymentLedgerDetail(p),
			payMethod: strings.TrimSpace(p.Method),
			opCode:    strings.TrimSpace(p.Reference),
			cargo:     0,
			abono:     math.Round(p.Amount*100) / 100,
		})
	}

	sort.Slice(entries, func(i, j int) bool {
		a, b := entries[i], entries[j]
		if !a.opDate.Equal(b.opDate) {
			return a.opDate.Before(b.opDate)
		}
		if !a.processAt.Equal(b.processAt) {
			return a.processAt.Before(b.processAt)
		}
		if a.isPayment != b.isPayment {
			return !a.isPayment
		}
		return a.uid < b.uid
	})

	return entries
}

func ledgerFromSortedEntries(
	entries []ledgerEntry,
	windowStart, windowEndExclusive time.Time,
	periodYear, periodMonth int,
	periodLabel, ledgerKind, rangeDateFrom, rangeDateTo string,
) *AccountLedger {
	opening := 0.0
	for _, e := range entries {
		if e.opDate.Before(windowStart) {
			opening += e.cargo - e.abono
		}
	}
	opening = math.Round(opening*100) / 100

	movements := make([]AccountLedgerMovement, 0)
	running := opening
	var sumCargos, sumAbonos float64

	for _, e := range entries {
		if e.opDate.Before(windowStart) {
			continue
		}
		if !e.opDate.Before(windowEndExclusive) {
			continue
		}
		running = math.Round((running+e.cargo-e.abono)*100) / 100
		sumCargos += e.cargo
		sumAbonos += e.abono

		opStr := e.opDate.Format("2006-01-02")
		if opStr == "0001-01-01" {
			opStr = ""
		}
		procStr := dateInLima(e.processAt).Format("2006-01-02")
		if procStr == "0001-01-01" {
			procStr = opStr
		}

		movements = append(movements, AccountLedgerMovement{
			OperationDate:  opStr,
			ProcessDate:    procStr,
			TypeCode:       e.typeCode,
			DocumentNumber: e.docNumber,
			Detail:         e.detail,
			PaymentMethod:  e.payMethod,
			OperationCode:  e.opCode,
			Cargo:          e.cargo,
			Abono:          e.abono,
			Balance:        running,
		})
	}

	sumCargos = math.Round(sumCargos*100) / 100
	sumAbonos = math.Round(sumAbonos*100) / 100
	saldoFinal := math.Round((opening+sumCargos-sumAbonos)*100) / 100
	if len(movements) == 0 {
		saldoFinal = opening
	} else if movements[len(movements)-1].Balance != saldoFinal {
		saldoFinal = movements[len(movements)-1].Balance
	}

	return &AccountLedger{
		PeriodYear:    periodYear,
		PeriodMonth:   periodMonth,
		PeriodLabel:   periodLabel,
		LedgerKind:    ledgerKind,
		RangeDateFrom: rangeDateFrom,
		RangeDateTo:   rangeDateTo,
		SaldoAnterior: opening,
		TotalAbonos:   sumAbonos,
		TotalCargos:   sumCargos,
		SaldoFinal:    saldoFinal,
		Movements:     movements,
	}
}

func buildAccountLedger(docs []models.Document, pays []models.Payment, year, month int) *AccountLedger {
	if month < 1 || month > 12 {
		now := time.Now().In(limaLoc)
		year, month = now.Year(), int(now.Month())
	}
	monthStart := time.Date(year, time.Month(month), 1, 0, 0, 0, 0, limaLoc)
	monthEnd := monthStart.AddDate(0, 1, 0)

	meses := []string{
		"", "ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO",
		"JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE",
	}
	periodLabel := fmt.Sprintf("%s %d", meses[month], year)

	entries := collectSortedLedgerEntries(docs, pays)
	return ledgerFromSortedEntries(entries, monthStart, monthEnd, year, month, periodLabel, "month", "", "")
}

const maxStatementRangeDays = 800

// buildAccountLedgerDateRange construye el libro para fechas inclusivas from–to (día calendario en Lima).
func buildAccountLedgerDateRange(docs []models.Document, pays []models.Payment, fromDate, toDate time.Time) *AccountLedger {
	ws := time.Date(fromDate.Year(), fromDate.Month(), fromDate.Day(), 0, 0, 0, 0, limaLoc)
	te := time.Date(toDate.Year(), toDate.Month(), toDate.Day(), 0, 0, 0, 0, limaLoc)
	if te.Before(ws) {
		te = ws
	}
	days := int(te.Sub(ws).Hours()/24) + 1
	if days > maxStatementRangeDays {
		te = ws.AddDate(0, 0, maxStatementRangeDays-1)
	}
	endExclusive := te.AddDate(0, 0, 1)
	label := fmt.Sprintf("Del %s al %s", ws.Format("02/01/2006"), te.Format("02/01/2006"))
	fromStr := ws.Format("2006-01-02")
	toStr := te.Format("2006-01-02")

	entries := collectSortedLedgerEntries(docs, pays)
	return ledgerFromSortedEntries(entries, ws, endExclusive, 0, 0, label, "date_range", fromStr, toStr)
}
