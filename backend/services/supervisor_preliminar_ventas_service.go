package services

import (
	"errors"
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"

	"miappfiber/database"
	"miappfiber/models"

	"gorm.io/gorm"
)

// PreliminarVentasSinRegistro filtro sintético del listado: empresas sin ningún dato registrado
// (ni entrega 1 ni entrega 2) todavía para este período.
const PreliminarVentasSinRegistro = "sin_registro"

// PreliminarVentasListParams filtros del listado Preliminar de Ventas por empresa y período.
type PreliminarVentasListParams struct {
	PeriodYM string
	Q        string
	// Status matches si CUALQUIERA de las 2 entregas tiene este estado (o PreliminarVentasSinRegistro
	// si NINGUNA de las 2 tiene registro).
	Status            string
	AllowedCompanyIDs []uint
	Page              int
	PerPage           int
	// All: sin paginar (reporte Excel).
	All bool
}

// PreliminarVentasSlotStatus estado + fecha límite de una entrega puntual — usado en el listado
// (dos columnas, una por entrega) para no repetir la resolución de fecha por fila.
type PreliminarVentasSlotStatus struct {
	Status  string     `json:"status"`
	DueDate *time.Time `json:"due_date,omitempty"`
	// Timeliness puntualidad de la entrega frente a su fecha del calendario: on_time | late | pending |
	// missing | exempt (vacío si el período no tiene esa entrega configurada). SentAt: cuándo se envió.
	Timeliness string     `json:"timeliness,omitempty"`
	SentAt     *time.Time `json:"sent_at,omitempty"`
	// RegistradoAt cuándo se registraron los datos por primera vez = cuándo se ENTREGÓ (mide el plazo).
	RegistradoAt *time.Time `json:"registrado_at,omitempty"`
	// Disponible: ya llegó la fecha de la entrega según el calendario (hora del servidor, Lima). La
	// pantalla oculta registrar/enviar hasta esa fecha; el backend NO lo bloquea (a propósito, para
	// poder permitir entregas anticipadas más adelante). Sin fecha configurada, siempre disponible.
	Disponible bool `json:"disponible"`
}

// PreliminarVentasListRow fila del listado (empresa + período), con el estado de sus dos entregas.
type PreliminarVentasListRow struct {
	CompanyID         uint                       `json:"company_id"`
	Code              string                     `json:"code"`
	Dig               string                     `json:"dig"`
	BusinessName      string                     `json:"business_name"`
	RUC               string                     `json:"ruc"`
	AssistantUsername string                     `json:"assistant_username"`
	Suspendida        bool                       `json:"suspendida"`
	Slot1             PreliminarVentasSlotStatus `json:"slot1"`
	Slot2             PreliminarVentasSlotStatus `json:"slot2"`
}

// PreliminarVentasRecordInput datos que registra el asistente para UNA entrega — solo Ventas
// (Facturas/Boletas/Notas de crédito, Base Imponible + No Gravadas) y, opcionalmente, un importe
// aproximado de Compras. Todo lo demás (IGV por fila, IGV resultante, montos aproximados a pagar)
// se calcula — ver computePreliminarVentasSummary. Se reusa la misma forma como DTO de lectura: no
// hay fechas ni campos opcionales que obliguen a separar input/salida, a diferencia de
// Pdt621RecordInput/DTO.
type PreliminarVentasRecordInput struct {
	// IgvAplicable18/105: al menos una debe venir en true — si ambas llegan en false, se guarda con
	// la tasa de la empresa (ver preliminarVentasActiveRates / SavePreliminarVentasSlotRecord).
	IgvAplicable18            bool    `json:"igv_aplicable_18"`
	IgvAplicable105           bool    `json:"igv_aplicable_105"`
	FacturasBase18            float64 `json:"facturas_base_18"`
	FacturasNoGravadas18      float64 `json:"facturas_no_gravadas_18"`
	FacturasBase105           float64 `json:"facturas_base_105"`
	FacturasNoGravadas105     float64 `json:"facturas_no_gravadas_105"`
	BoletasBase18             float64 `json:"boletas_base_18"`
	BoletasNoGravadas18       float64 `json:"boletas_no_gravadas_18"`
	BoletasBase105            float64 `json:"boletas_base_105"`
	BoletasNoGravadas105      float64 `json:"boletas_no_gravadas_105"`
	NotasCreditoBase18        float64 `json:"notas_credito_base_18"`
	NotasCreditoNoGravadas18  float64 `json:"notas_credito_no_gravadas_18"`
	NotasCreditoBase105       float64 `json:"notas_credito_base_105"`
	NotasCreditoNoGravadas105 float64 `json:"notas_credito_no_gravadas_105"`
	// ReduccionIgvPct: % del I.G.V. a pagar a compensar con compras (0–100, por defecto 95).
	ReduccionIgvPct float64 `json:"reduccion_igv_pct"`
	// CreditoPeriodoAnteriorOverride: nil usa el arrastre automático (ver
	// preliminarVentasAutoCredito); si no es nil, el usuario lo corrigió a mano y ese valor manda.
	CreditoPeriodoAnteriorOverride *float64 `json:"credito_periodo_anterior_override,omitempty"`
	// RetencionMonto/PercepcionMonto: montos aproximados simples (sin arrastre automático), que
	// también restan del I.G.V. resultante para llegar al I.G.V. A PAGAR.
	RetencionMonto  float64 `json:"retencion_monto"`
	PercepcionMonto float64 `json:"percepcion_monto"`
	// CutoffDate fecha de corte de la entrega (YYYY-MM-DD, vacío = sin definir): las ventas son las
	// acumuladas hasta ese día. Debe caer dentro del mes del período.
	CutoffDate string `json:"cutoff_date,omitempty"`
	// RentaRegimen/RentaCoeficientePct: régimen elegido para el pago a cuenta de renta de la entrega
	// (mype | rer | general | coeficiente). En la respuesta siempre viene resuelto (nunca vacío).
	RentaRegimen        string  `json:"renta_regimen"`
	RentaCoeficientePct float64 `json:"renta_coeficiente_pct"`
}

// PreliminarVentasSummaryRow una fila de la tabla "Ventas" (Facturas/Boletas/Notas de crédito/Total).
type PreliminarVentasSummaryRow struct {
	Label      string  `json:"label"`
	Base       float64 `json:"base"`
	NoGravadas float64 `json:"no_gravadas"`
	Igv        float64 `json:"igv"`
	Total      float64 `json:"total"`
}

// PreliminarVentasSummary importes calculados a partir de PreliminarVentasRecordInput y de la
// configuración vigente de la empresa (igv_rate, tax_regime) — nunca se persisten, se recalculan
// siempre que se lee o se guarda el registro, igual que el resto del sistema calcula IGV/Renta.
type PreliminarVentasSummary struct {
	// Rows: filas de detalle (Facturas Emitidas/Boletas Emitidas/(-) Notas de Crédito), UNA terna
	// por cada tasa activa — si solo hay una tasa, 3 filas sin sufijo (igual que siempre); si hay
	// dos, 6 filas con el sufijo "(18%)"/"(10.5%)" en el label. TotalRow es la fila "TOTAL VENTAS"
	// aparte (ya no vive dentro de Rows) para que el largo de Rows no quede implícito en el consumidor
	// (frontend/PDF antes asumían índices fijos 0-3, que dejaron de servir con 6 filas).
	Rows     []PreliminarVentasSummaryRow `json:"rows"`
	TotalRow PreliminarVentasSummaryRow   `json:"total_row"`
	// IgvRatesAplicables: tasa(s) efectivamente usadas en este cálculo (ver preliminarVentasActiveRates).
	IgvRatesAplicables []float64 `json:"igv_rates_aplicables"`
	// IgvResultante: redondeado a entero, antes de restar el crédito.
	IgvResultante float64 `json:"igv_resultante"`
	// CreditoPeriodoAnteriorAuto: lo que el arrastre automático sugiere (I.G.V. A PAGAR negativo de
	// la entrega anterior) — se muestra siempre, sea o no el que finalmente se usó.
	CreditoPeriodoAnteriorAuto float64 `json:"credito_periodo_anterior_auto"`
	// CreditoPeriodoAnterior: el efectivamente usado en el cálculo (override si el usuario lo puso,
	// si no el automático).
	CreditoPeriodoAnterior float64 `json:"credito_periodo_anterior"`
	IgvAPagar              float64 `json:"igv_a_pagar"`
	// MontoAproximadoIgv: lo que quedaría por pagar de I.G.V. si el cliente trae las compras de
	// ComprasBase (I.G.V. a pagar − I.G.V. de esas compras). nil cuando IgvAPagar <= 0 (saldo a
	// favor o neutral) — el PDF y la UI lo dejan en blanco.
	MontoAproximadoIgv *float64 `json:"monto_aproximado_igv,omitempty"`
	// Compras: importe CALCULADO a traer en facturas de compra para compensar ReduccionIgvPct% del
	// I.G.V. a pagar. Todo en 0 cuando IgvAPagar <= 0 (no hay nada que compensar).
	ComprasBase          float64 `json:"compras_base"`
	ComprasIgv           float64 `json:"compras_igv"`
	ComprasTotal         float64 `json:"compras_total"`
	RentaBase            float64 `json:"renta_base"`
	RentaRatePct         float64 `json:"renta_rate_pct"`
	MontoAproximadoRenta float64 `json:"monto_aproximado_renta"`
	// RentaRegimenOrigen de dónde salió el régimen aplicado: "entrega" (elegido y guardado en esta
	// entrega), "entrega_1" (heredado de la entrega 1 del período), "empresa" (ficha de la empresa) o
	// "por_defecto" (la empresa no tiene régimen: se asume MYPE 1 %, igual que la pantalla de Liquidación).
	RentaRegimenOrigen string `json:"renta_regimen_origen"`
}

// PreliminarVentasSlotDetail detalle de UNA entrega tras EnsurePreliminarVentasSlot (lazy create).
type PreliminarVentasSlotDetail struct {
	PeriodYM  string `json:"period_ym"`
	SlotIndex int    `json:"slot_index"`
	// DueDate fecha límite de ESTA entrega según el calendario (tipo "preliminar_ventas") — nil si
	// el período no tiene esa entrega configurada todavía.
	DueDate           *time.Time `json:"due_date,omitempty"`
	CompanyID         uint       `json:"company_id"`
	Code              string     `json:"code"`
	Dig               string     `json:"dig"`
	BusinessName      string     `json:"business_name"`
	RUC               string     `json:"ruc"`
	AssistantUsername string     `json:"assistant_username"`
	ControlID         uint       `json:"control_id"`
	// ControlSuspendida: overlay global de SupervisorMonthlyControl.Suspendida (§5.9.7), de solo
	// lectura acá — se marca/desmarca únicamente desde Control de Detracciones.
	ControlSuspendida bool `json:"control_suspendida"`
	// CompanyIgvRate: tasa configurada de la empresa (companies.igv_rate) — el frontend la usa para
	// marcar cuál checkbox de tasa es "(empresa)" en el selector 18%/10.5%/ambos.
	CompanyIgvRate float64    `json:"company_igv_rate"`
	Status         string     `json:"status"`
	SentAt         *time.Time `json:"sent_at,omitempty"`
	// RegistradoAt / Disponible: ver PreliminarVentasSlotStatus.
	RegistradoAt *time.Time `json:"registrado_at,omitempty"`
	Disponible   bool       `json:"disponible"`
	// Timeliness puntualidad de esta entrega frente a su fecha del calendario (ver PreliminarVentasSlotStatus).
	Timeliness string                      `json:"timeliness,omitempty"`
	Record     PreliminarVentasRecordInput `json:"record"`
	Summary    PreliminarVentasSummary     `json:"summary"`
	// DocumentNumber serie del PDF: PV001-<año 4><mes 2> — determinística
	// a partir del período (no distingue entrega 1 de 2 a propósito, confirmado con el
	// usuario: no importa que ambas entregas del mes compartan el mismo número).
	DocumentNumber string `json:"document_number"`
}

func round2(v float64) float64 {
	return math.Round(v*100) / 100
}

func roundToWhole(v float64) float64 {
	return math.Round(v)
}

func parseIgvRatePct(raw string) float64 {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return 18
	}
	v, err := strconv.ParseFloat(raw, 64)
	if err != nil || v <= 0 {
		return 18
	}
	return v
}

// Opciones de régimen para el pago a cuenta de renta — las mismas que la Liquidación
// (frontend/src/utils/companyTaxRegime.ts, LIQUIDATION_RENTA_REGIME_OPTIONS).
const preliminarVentasRentaCoeficiente = "coeficiente"

// normalizePreliminarVentasRentaRegimen devuelve mype | rer | general | coeficiente, o "" si no
// reconoce el valor (acepta los alias rmt / rg que ya acepta la Liquidación).
func normalizePreliminarVentasRentaRegimen(raw string) string {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case models.CompanyTaxRegimeMype, "rmt":
		return models.CompanyTaxRegimeMype
	case models.CompanyTaxRegimeRER:
		return models.CompanyTaxRegimeRER
	case models.CompanyTaxRegimeGeneral, "rg":
		return models.CompanyTaxRegimeGeneral
	case preliminarVentasRentaCoeficiente:
		return preliminarVentasRentaCoeficiente
	default:
		return ""
	}
}

// resolvePreliminarVentasRenta decide el régimen efectivo: el elegido en la entrega; si no hay,
// el heredado de la entrega 1 del mismo período (inherited, ya normalizado, "" si no hay); si no, el
// de la ficha de la empresa; y si la empresa no lo tiene cargado (la mayoría, hoy), MYPE — el mismo
// valor por defecto que la pantalla de Liquidación — para que la renta nunca quede en 0 por un dato faltante.
func resolvePreliminarVentasRenta(own string, ownCoef float64, inherited string, inheritedCoef float64, companyRegime string) (regimen string, coef float64, origen string) {
	pick := func(r string, c float64, o string) (string, float64, string) {
		if r != preliminarVentasRentaCoeficiente {
			c = 0
		}
		return r, c, o
	}
	if r := normalizePreliminarVentasRentaRegimen(own); r != "" {
		return pick(r, ownCoef, "entrega")
	}
	if r := normalizePreliminarVentasRentaRegimen(inherited); r != "" {
		return pick(r, inheritedCoef, "entrega_1")
	}
	// En la ficha de la empresa solo existen mype | rer | general (no "coeficiente").
	if r := normalizePreliminarVentasRentaRegimen(companyRegime); r != "" && r != preliminarVentasRentaCoeficiente {
		return r, 0, "empresa"
	}
	return models.CompanyTaxRegimeMype, 0, "por_defecto"
}

// preliminarVentasRentaRatePct tasa de pago a cuenta mensual de renta para un régimen ya resuelto:
// mype 1 %, rer/general 1.5 %, coeficiente = el % indicado a mano (0 si no se indicó) — igual que
// rentaMensualRatePct de la Liquidación (ver también SUNAT_RENTA_RATE_BY_REGIME en el frontend).
func preliminarVentasRentaRatePct(regimen string, coeficientePct float64) float64 {
	switch normalizePreliminarVentasRentaRegimen(regimen) {
	case models.CompanyTaxRegimeMype:
		return 1
	case models.CompanyTaxRegimeRER, models.CompanyTaxRegimeGeneral:
		return 1.5
	case preliminarVentasRentaCoeficiente:
		if coeficientePct > 0 {
			return coeficientePct
		}
		return 0
	default:
		return 1
	}
}

// preliminarVentasDocumentNumber serie del PDF — determinística, no un contador persistido: mismo
// número si se regenera el mismo período de la misma empresa (o si se genera la entrega 1 o la 2).
func preliminarVentasDocumentNumber(_ *models.Company, periodYM string) string {
	var year, month int
	_, _ = fmt.Sscanf(periodYM, "%d-%d", &year, &month)
	return fmt.Sprintf("PV001-%04d%02d", year, month)
}

func preliminarVentasRecordToInput(r *models.SupervisorPreliminarVentasRecord) PreliminarVentasRecordInput {
	if r == nil {
		return PreliminarVentasRecordInput{}
	}
	return PreliminarVentasRecordInput{
		IgvAplicable18:                 r.IgvAplicable18,
		IgvAplicable105:                r.IgvAplicable105,
		FacturasBase18:                 r.FacturasBase18,
		FacturasNoGravadas18:           r.FacturasNoGravadas18,
		FacturasBase105:                r.FacturasBase105,
		FacturasNoGravadas105:          r.FacturasNoGravadas105,
		BoletasBase18:                  r.BoletasBase18,
		BoletasNoGravadas18:            r.BoletasNoGravadas18,
		BoletasBase105:                 r.BoletasBase105,
		BoletasNoGravadas105:           r.BoletasNoGravadas105,
		NotasCreditoBase18:             r.NotasCreditoBase18,
		NotasCreditoNoGravadas18:       r.NotasCreditoNoGravadas18,
		NotasCreditoBase105:            r.NotasCreditoBase105,
		NotasCreditoNoGravadas105:      r.NotasCreditoNoGravadas105,
		ReduccionIgvPct:                r.ReduccionIgvPct,
		CreditoPeriodoAnteriorOverride: r.CreditoPeriodoAnteriorOverride,
		RetencionMonto:                 r.RetencionMonto,
		PercepcionMonto:                r.PercepcionMonto,
		CutoffDate:                     formatPreliminarVentasCutoff(r.CutoffDate),
		RentaRegimen:                   r.RentaRegimen,
		RentaCoeficientePct:            r.RentaCoeficientePct,
	}
}

const preliminarVentasDateLayout = "2006-01-02"

func formatPreliminarVentasCutoff(t *time.Time) string {
	if t == nil || t.IsZero() {
		return ""
	}
	return t.Format(preliminarVentasDateLayout)
}

// parsePreliminarVentasCutoff valida la fecha de corte recibida: vacía = sin definir; si viene, debe
// ser una fecha válida del mismo mes que el período (el corte nunca cae fuera del mes que se informa).
func parsePreliminarVentasCutoff(raw, periodYM string) (*time.Time, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, nil
	}
	d, err := time.ParseInLocation(preliminarVentasDateLayout, raw, time.Local)
	if err != nil {
		return nil, errors.New("la fecha de corte no es válida")
	}
	if d.Format("2006-01") != periodYM {
		return nil, errors.New("la fecha de corte debe estar dentro del mes del período")
	}
	return &d, nil
}

// preliminarVentasDefaultReduccionIgvPct % de I.G.V. a compensar con compras que usa el estudio.
const preliminarVentasDefaultReduccionIgvPct = 95

// clampReduccionIgvPct acota el % al rango válido (0–100): con compras no se puede bajar más del
// 100% del I.G.V.
func clampReduccionIgvPct(v float64) float64 {
	if v < 0 {
		return 0
	}
	if v > 100 {
		return 100
	}
	return round2(v)
}

// preliminarVentasCompanyDefaultRateBools tasa(s) activas por defecto para una entrega nueva (sin
// registro todavío): la única tasa configurada en la empresa — el usuario puede prender la otra
// también desde el selector si emitió a ambas tasas en el período.
func preliminarVentasCompanyDefaultRateBools(company *models.Company) (igv18, igv105 bool) {
	if parseIgvRatePct(company.IgvRate) == 10.5 {
		return false, true
	}
	return true, false
}

// preliminarVentasActiveRates tasa(s) efectivamente usadas en un cálculo — si el registro no marcó
// ninguna (nunca debería pasar una vez guardado, ver SavePreliminarVentasSlotRecord, pero un
// registro recién creado en memoria sin pasar por EnsurePreliminarVentasSlot podría llegar así),
// cae a la tasa única de la empresa.
func preliminarVentasActiveRates(igv18, igv105 bool, companyRatePct float64) []float64 {
	var rates []float64
	if igv18 {
		rates = append(rates, 18)
	}
	if igv105 {
		rates = append(rates, 10.5)
	}
	if len(rates) == 0 {
		rates = append(rates, companyRatePct)
	}
	return rates
}

func igvRateLabel(rate float64) string {
	if rate == 10.5 {
		return "10.5%"
	}
	return "18%"
}

// preliminarVentasRateBucket valores de Ventas de UNA tasa IGV (18% o 10.5%) — separa el acceso a
// los campos "_18"/"_105" del resto del cálculo, que no necesita saber cuál sufijo corresponde.
type preliminarVentasRateBucket struct {
	facturasBase, facturasNoGrav float64
	boletasBase, boletasNoGrav   float64
	notasBase, notasNoGrav       float64
}

func preliminarVentasBucketForRate(in PreliminarVentasRecordInput, rate float64) preliminarVentasRateBucket {
	if rate == 10.5 {
		return preliminarVentasRateBucket{
			facturasBase: in.FacturasBase105, facturasNoGrav: in.FacturasNoGravadas105,
			boletasBase: in.BoletasBase105, boletasNoGrav: in.BoletasNoGravadas105,
			notasBase: in.NotasCreditoBase105, notasNoGrav: in.NotasCreditoNoGravadas105,
		}
	}
	return preliminarVentasRateBucket{
		facturasBase: in.FacturasBase18, facturasNoGrav: in.FacturasNoGravadas18,
		boletasBase: in.BoletasBase18, boletasNoGrav: in.BoletasNoGravadas18,
		notasBase: in.NotasCreditoBase18, notasNoGrav: in.NotasCreditoNoGravadas18,
	}
}

// preliminarVentasSlotDueDates resuelve las fechas límite de las 2 entregas del período desde el
// calendario (actividades tipo "preliminar_ventas", CalendarActivitiesForType ya las trae
// ordenadas por due_day ascendente — la más temprana es la entrega 1, la otra la entrega 2, mismo
// mecanismo que ya usa Buzón SOL para elegir entre varias cargas del mismo tipo por período). nil
// en cualquiera de las dos si el calendario de ese período aún no tiene esa entrega configurada.
func preliminarVentasSlotDueDates(periodYM string) (due1, due2 *time.Time) {
	acts, err := CalendarActivitiesForType(periodYM, models.CalendarActivityPreliminarVentas)
	if err != nil || len(acts) == 0 {
		return nil, nil
	}
	if dt, err := dueDateForActivity(periodYM, acts[0].DueDay); err == nil {
		due1 = &dt
	}
	if len(acts) > 1 {
		if dt, err := dueDateForActivity(periodYM, acts[1].DueDay); err == nil {
			due2 = &dt
		}
	}
	return due1, due2
}

func preliminarVentasSlotDueDate(periodYM string, slotIndex int) *time.Time {
	due1, due2 := preliminarVentasSlotDueDates(periodYM)
	if slotIndex == 2 {
		return due2
	}
	return due1
}

// computePreliminarVentasSummary calcula todo lo derivado de lo registrado — nunca se guarda en la
// tabla (salvo el override de crédito, que si está presente ya viene reflejado en
// creditoEfectivo), se recalcula siempre con la tasa vigente de la empresa (igv_rate/tax_regime).
func (s *SupervisorService) computePreliminarVentasSummary(
	company *models.Company,
	in PreliminarVentasRecordInput,
	creditoEfectivo float64,
	creditoAuto float64,
) PreliminarVentasSummary {
	companyRate := parseIgvRatePct(company.IgvRate)
	rates := preliminarVentasActiveRates(in.IgvAplicable18, in.IgvAplicable105, companyRate)
	multiRate := len(rates) > 1

	rows := make([]PreliminarVentasSummaryRow, 0, len(rates)*3)
	var totalBase, totalNoGravadas, totalIgv float64
	for _, rate := range rates {
		b := preliminarVentasBucketForRate(in, rate)
		suffix := ""
		if multiRate {
			suffix = fmt.Sprintf(" (%s)", igvRateLabel(rate))
		}
		facturasIgv := round2(b.facturasBase * rate / 100)
		facturasTotal := round2(b.facturasBase + b.facturasNoGrav + facturasIgv)
		boletasIgv := round2(b.boletasBase * rate / 100)
		boletasTotal := round2(b.boletasBase + b.boletasNoGrav + boletasIgv)
		notasIgv := round2(b.notasBase * rate / 100)
		notasTotal := round2(b.notasBase + b.notasNoGrav + notasIgv)

		rows = append(rows,
			PreliminarVentasSummaryRow{Label: "Facturas Emitidas" + suffix, Base: b.facturasBase, NoGravadas: b.facturasNoGrav, Igv: facturasIgv, Total: facturasTotal},
			PreliminarVentasSummaryRow{Label: "Boletas Emitidas" + suffix, Base: b.boletasBase, NoGravadas: b.boletasNoGrav, Igv: boletasIgv, Total: boletasTotal},
			PreliminarVentasSummaryRow{Label: "(-) Notas de Crédito" + suffix, Base: b.notasBase, NoGravadas: b.notasNoGrav, Igv: notasIgv, Total: notasTotal},
		)

		totalBase += b.facturasBase + b.boletasBase - b.notasBase
		totalNoGravadas += b.facturasNoGrav + b.boletasNoGrav - b.notasNoGrav
		totalIgv += facturasIgv + boletasIgv - notasIgv
	}
	totalBase = round2(totalBase)
	totalNoGravadas = round2(totalNoGravadas)
	totalIgv = round2(totalIgv)
	totalTotal := round2(totalBase + totalNoGravadas + totalIgv)
	totalRow := PreliminarVentasSummaryRow{Label: "TOTAL VENTAS", Base: totalBase, NoGravadas: totalNoGravadas, Igv: totalIgv, Total: totalTotal}

	// I.G.V Resultante: redondeado a entero (declaración SUNAT sin decimales), igual criterio que
	// impuesto_periodo en la Liquidación (roundTaxTotalAmount).
	igvResultante := roundToWhole(totalIgv)
	// Retención/percepción restan igual que el crédito del período anterior — si el resultado da
	// negativo es saldo a favor (crédito fiscal), no "a pagar" (ver IgvAPagar en el comentario del
	// tipo y PreliminarVentasDetailPage.tsx, que oculta Compras en ese caso).
	igvAPagar := round2(igvResultante - creditoEfectivo - in.RetencionMonto - in.PercepcionMonto)

	// Compras a traer: el I.G.V. a compensar es ReduccionIgvPct% del I.G.V. a pagar, y la base de
	// compras que lo genera es ese monto ÷ tasa. Se redondea hacia arriba al sol entero para que la
	// factura alcance a compensar (aproximado). Compras no se separa por tasa: usa la tasa única
	// configurada de la empresa. Sin I.G.V. a pagar (saldo a favor) no hay nada que compensar.
	reduccionPct := clampReduccionIgvPct(in.ReduccionIgvPct)
	var comprasBase, comprasIgv, comprasTotal float64
	var montoAproxIgv *float64
	if igvAPagar > 0 {
		igvACompensar := igvAPagar * reduccionPct / 100
		comprasBase = math.Ceil(math.Round(igvACompensar*100/companyRate*1e6) / 1e6)
		comprasIgv = round2(comprasBase * companyRate / 100)
		comprasTotal = round2(comprasBase + comprasIgv)
		// Lo que quedaría por pagar si el cliente trae esas compras.
		restante := roundToWhole(igvAPagar - comprasIgv)
		if restante < 0 {
			restante = 0
		}
		montoAproxIgv = &restante
	}

	rentaBaseRaw := totalBase + totalNoGravadas
	if rentaBaseRaw < 0 {
		rentaBaseRaw = 0
	}
	rentaBase := round2(rentaBaseRaw)
	rentaRegimen, rentaCoef, rentaOrigen := resolvePreliminarVentasRenta(in.RentaRegimen, in.RentaCoeficientePct, "", 0, company.TaxRegime)
	rentaRate := preliminarVentasRentaRatePct(rentaRegimen, rentaCoef)
	montoAproxRenta := 0.0
	if rentaRate > 0 && rentaBase > 0 {
		montoAproxRenta = roundToWhole(round2(rentaBase * rentaRate / 100))
	}

	return PreliminarVentasSummary{
		Rows:                       rows,
		TotalRow:                   totalRow,
		IgvRatesAplicables:         rates,
		IgvResultante:              igvResultante,
		CreditoPeriodoAnteriorAuto: creditoAuto,
		CreditoPeriodoAnterior:     creditoEfectivo,
		IgvAPagar:                  igvAPagar,
		MontoAproximadoIgv:         montoAproxIgv,
		ComprasBase:                comprasBase,
		ComprasIgv:                 comprasIgv,
		ComprasTotal:               comprasTotal,
		RentaBase:                  rentaBase,
		RentaRatePct:               rentaRate,
		MontoAproximadoRenta:       montoAproxRenta,
		RentaRegimenOrigen:         rentaOrigen,
	}
}

type preliminarVentasSlotRef struct {
	PeriodYM string
	Slot     int
}

// preliminarVentasPrevSlotRefs candidatos, en orden de prioridad, a "la entrega inmediatamente
// anterior" de (periodYM, slotIndex): si se pide la entrega 2, es la entrega 1 del MISMO período;
// si se pide la entrega 1, es la entrega 2 del período anterior (o, si esa no existe, la entrega 1
// de ese período anterior).
func preliminarVentasPrevSlotRefs(periodYM string, slotIndex int) []preliminarVentasSlotRef {
	if slotIndex == 2 {
		return []preliminarVentasSlotRef{{periodYM, 1}}
	}
	prev, ok := previousPeriodYM(periodYM)
	if !ok {
		return nil
	}
	return []preliminarVentasSlotRef{{prev, 2}, {prev, 1}}
}

// preliminarVentasAutoCredito arrastre automático (confirmado con el usuario): el I.G.V. A PAGAR de
// la entrega anterior de la MISMA empresa, si salió negativo (crédito a favor), se resta acá. Se
// mantiene la misma lógica sea cual sea el override que haya tenido esa entrega anterior (si lo
// tuvo, se usa igual — el arrastre siempre sigue el I.G.V. A PAGAR EFECTIVO). depth acota la
// recursión (protección defensiva; en operación normal nunca se acerca a ese límite).
func (s *SupervisorService) preliminarVentasAutoCredito(company *models.Company, periodYM string, slotIndex, depth int) float64 {
	if depth > 48 {
		return 0
	}
	for _, ref := range preliminarVentasPrevSlotRefs(periodYM, slotIndex) {
		var prevCtrl models.SupervisorMonthlyControl
		if err := database.DB.Where("company_id = ? AND period_ym = ?", company.ID, ref.PeriodYM).First(&prevCtrl).Error; err != nil {
			continue
		}
		var prevRecord models.SupervisorPreliminarVentasRecord
		if err := database.DB.Where("monthly_control_id = ? AND slot_index = ?", prevCtrl.ID, ref.Slot).First(&prevRecord).Error; err != nil {
			continue
		}
		prevInput := preliminarVentasRecordToInput(&prevRecord)
		prevAuto := s.preliminarVentasAutoCredito(company, ref.PeriodYM, ref.Slot, depth+1)
		prevEfectivo := prevAuto
		if prevRecord.CreditoPeriodoAnteriorOverride != nil {
			prevEfectivo = *prevRecord.CreditoPeriodoAnteriorOverride
		}
		prevSummary := s.computePreliminarVentasSummary(company, prevInput, prevEfectivo, prevAuto)
		if prevSummary.IgvAPagar < 0 {
			return -prevSummary.IgvAPagar
		}
		return 0
	}
	return 0
}

// EnsurePreliminarVentasSlot crea (lazy) el control mensual y la declaración "preliminar_ventas" si
// no existen (una sola vez por período, no por entrega) — mismo patrón que EnsurePdt621 — y arma el
// detalle de la entrega pedida (1 o 2), con su registro si ya existe.
func (s *SupervisorService) EnsurePreliminarVentasSlot(companyID uint, periodYM string, slotIndex int) (*PreliminarVentasSlotDetail, error) {
	if slotIndex != 1 && slotIndex != 2 {
		return nil, errors.New("entrega inválida (use 1 o 2)")
	}
	if err := s.validateOpenPeriod(periodYM); err != nil {
		return nil, err
	}
	var company models.Company
	if err := database.DB.Preload("Assistant").First(&company, companyID).Error; err != nil {
		return nil, errors.New("empresa no encontrada")
	}
	if company.ClientType != models.CompanyClientTypeEstudio || company.Status != "activo" {
		return nil, errors.New("empresa no disponible")
	}

	var ctrl models.SupervisorMonthlyControl
	var decl models.SupervisorDeclaration
	err := database.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("company_id = ? AND period_ym = ?", companyID, periodYM).First(&ctrl).Error; err != nil {
			if !errors.Is(err, gorm.ErrRecordNotFound) {
				return err
			}
			due := periodDefaultDueDate(periodYM)
			ctrl = models.SupervisorMonthlyControl{
				CompanyID:         companyID,
				PeriodYM:          periodYM,
				ResponsibleUserID: company.AccountantUserID,
				SupervisorUserID:  company.SupervisorUserID,
				DueDate:           &due,
				GeneralStatus:     models.SupervisorControlPendiente,
				RiskLevel:         models.SupervisorRiskBajo,
			}
			if err := tx.Create(&ctrl).Error; err != nil {
				return err
			}
		}
		if err := tx.Where("monthly_control_id = ? AND declaration_type = ?", ctrl.ID, models.SupervisorDeclPreliminarVentas).
			First(&decl).Error; err != nil {
			if !errors.Is(err, gorm.ErrRecordNotFound) {
				return err
			}
			decl = models.SupervisorDeclaration{
				MonthlyControlID: ctrl.ID,
				DeclarationType:  models.SupervisorDeclPreliminarVentas,
				Status:           models.SupervisorDeclPendiente,
				Priority:         models.SupervisorPriorityMedia,
			}
			return tx.Create(&decl).Error
		}
		return nil
	})
	if err != nil {
		return nil, err
	}

	var record models.SupervisorPreliminarVentasRecord
	_ = database.DB.Where("monthly_control_id = ? AND slot_index = ?", ctrl.ID, slotIndex).First(&record).Error
	status := record.Status
	if status == "" {
		status = models.PreliminarVentasPendiente
	}
	if record.ID == 0 {
		// Entrega todavía sin registro: precarga la tasa de la empresa como selección por defecto
		// (sin persistir nada) para que el formulario abra con el checkbox correcto ya marcado.
		record.IgvAplicable18, record.IgvAplicable105 = preliminarVentasCompanyDefaultRateBools(&company)
		record.ReduccionIgvPct = preliminarVentasDefaultReduccionIgvPct
	}

	input := preliminarVentasRecordToInput(&record)
	// CutoffDate sin guardar queda vacío: el formulario propone la fecha de HOY con la hora del
	// navegador (el servidor puede estar en otra zona horaria y dar el día equivocado de noche).
	// Régimen de renta: el de la entrega; si no lo eligieron, el de la entrega 1 del mismo período
	// (el preliminar sale 2 veces al mes y lo normal es que el régimen no cambie entre ambas); si no,
	// el de la empresa; y MYPE por defecto.
	var inheritedRegimen string
	var inheritedCoef float64
	if slotIndex == 2 && normalizePreliminarVentasRentaRegimen(record.RentaRegimen) == "" {
		var first models.SupervisorPreliminarVentasRecord
		if err := database.DB.Where("monthly_control_id = ? AND slot_index = 1", ctrl.ID).First(&first).Error; err == nil {
			inheritedRegimen, inheritedCoef = first.RentaRegimen, first.RentaCoeficientePct
		}
	}
	rentaRegimen, rentaCoef, rentaOrigen := resolvePreliminarVentasRenta(record.RentaRegimen, record.RentaCoeficientePct, inheritedRegimen, inheritedCoef, company.TaxRegime)
	input.RentaRegimen, input.RentaCoeficientePct = rentaRegimen, rentaCoef

	autoCredito := s.preliminarVentasAutoCredito(&company, periodYM, slotIndex, 0)
	efectivo := autoCredito
	if record.CreditoPeriodoAnteriorOverride != nil {
		efectivo = *record.CreditoPeriodoAnteriorOverride
	}
	summary := s.computePreliminarVentasSummary(&company, input, efectivo, autoCredito)
	summary.RentaRegimenOrigen = rentaOrigen

	slotDue := preliminarVentasSlotDueDate(periodYM, slotIndex)
	slotTimeliness := ""
	if acts := preliminarVentasSlotActivities(periodYM); slotDue != nil && slotIndex >= 1 && slotIndex <= len(acts) {
		slotTimeliness = preliminarSlotTimeliness(*slotDue, acts[slotIndex-1].ActivityRuleID, status, preliminarRegistradoAt(&record), ctrl.Suspendida, time.Now()).Timeliness
	}

	return &PreliminarVentasSlotDetail{
		PeriodYM:          periodYM,
		SlotIndex:         slotIndex,
		DueDate:           slotDue,
		Timeliness:        slotTimeliness,
		CompanyID:         company.ID,
		Code:              strings.TrimSpace(company.InternalCode),
		Dig:               s.companyDig(company.ID),
		BusinessName:      strings.TrimSpace(company.BusinessName),
		RUC:               strings.TrimSpace(company.RUC),
		AssistantUsername: assistantUsername(company.Assistant),
		ControlID:         ctrl.ID,
		ControlSuspendida: ctrl.Suspendida,
		CompanyIgvRate:    parseIgvRatePct(company.IgvRate),
		Status:            status,
		SentAt:            record.SentAt,
		RegistradoAt:      preliminarRegistradoAt(&record),
		Disponible:        activityDateReached(slotDue),
		Record:            input,
		Summary:           summary,
		DocumentNumber:    preliminarVentasDocumentNumber(&company, periodYM),
	}, nil
}

// SavePreliminarVentasSlotRecord guarda lo registrado por el asistente para una entrega puntual
// (Ventas/Compras + override de crédito opcional) — el resto se recalcula al vuelo, nunca se
// guarda. Guardar es lo que marca "registrado" (nunca retrocede desde "enviado").
func (s *SupervisorService) SavePreliminarVentasSlotRecord(companyID uint, periodYM string, slotIndex int, in PreliminarVentasRecordInput) (*PreliminarVentasSlotDetail, error) {
	detail, err := s.EnsurePreliminarVentasSlot(companyID, periodYM, slotIndex)
	if err != nil {
		return nil, err
	}
	// Suspendida es global por control (Control de Detracciones es el único que la marca/desmarca,
	// docs/diseno-limpieza-control-detail-2026-09-16.md §5.9.7) — mientras esté marcada, este módulo
	// también queda de solo lectura, mismo criterio que PDT 601/621.
	if detail.ControlSuspendida {
		return nil, errors.New("esta empresa está suspendida en este período (marcado desde Control de Detracciones); no se puede editar")
	}
	var ctrl models.SupervisorMonthlyControl
	if err := database.DB.Where("company_id = ? AND period_ym = ?", companyID, periodYM).First(&ctrl).Error; err != nil {
		return nil, err
	}

	var record models.SupervisorPreliminarVentasRecord
	err = database.DB.Where("monthly_control_id = ? AND slot_index = ?", ctrl.ID, slotIndex).First(&record).Error
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	record.MonthlyControlID = ctrl.ID
	record.SlotIndex = slotIndex
	record.IgvAplicable18 = in.IgvAplicable18
	record.IgvAplicable105 = in.IgvAplicable105
	if !record.IgvAplicable18 && !record.IgvAplicable105 {
		// Defensivo: nunca se guarda sin ninguna tasa activa — si llegan las dos en false (bug de
		// cliente o body incompleto), cae a la tasa configurada de la empresa.
		var company models.Company
		if err := database.DB.First(&company, companyID).Error; err == nil {
			record.IgvAplicable18, record.IgvAplicable105 = preliminarVentasCompanyDefaultRateBools(&company)
		} else {
			record.IgvAplicable18 = true
		}
	}
	record.FacturasBase18 = in.FacturasBase18
	record.FacturasNoGravadas18 = in.FacturasNoGravadas18
	record.FacturasBase105 = in.FacturasBase105
	record.FacturasNoGravadas105 = in.FacturasNoGravadas105
	record.BoletasBase18 = in.BoletasBase18
	record.BoletasNoGravadas18 = in.BoletasNoGravadas18
	record.BoletasBase105 = in.BoletasBase105
	record.BoletasNoGravadas105 = in.BoletasNoGravadas105
	record.NotasCreditoBase18 = in.NotasCreditoBase18
	record.NotasCreditoNoGravadas18 = in.NotasCreditoNoGravadas18
	record.NotasCreditoBase105 = in.NotasCreditoBase105
	record.NotasCreditoNoGravadas105 = in.NotasCreditoNoGravadas105
	record.ReduccionIgvPct = clampReduccionIgvPct(in.ReduccionIgvPct)
	record.CreditoPeriodoAnteriorOverride = in.CreditoPeriodoAnteriorOverride
	record.RetencionMonto = in.RetencionMonto
	record.PercepcionMonto = in.PercepcionMonto
	cutoff, err := parsePreliminarVentasCutoff(in.CutoffDate, periodYM)
	if err != nil {
		return nil, err
	}
	record.CutoffDate = cutoff
	// Régimen de renta elegido: se guarda tal cual (nunca vacío si el cliente lo manda). El % de
	// coeficiente solo cuenta con régimen "coeficiente" y se acota a 0–100.
	record.RentaRegimen = normalizePreliminarVentasRentaRegimen(in.RentaRegimen)
	record.RentaCoeficientePct = 0
	if record.RentaRegimen == preliminarVentasRentaCoeficiente {
		record.RentaCoeficientePct = math.Min(math.Max(in.RentaCoeficientePct, 0), 100)
	}
	if record.Status == "" || record.Status == models.PreliminarVentasPendiente {
		record.Status = models.PreliminarVentasRegistrado
	}

	if record.ID == 0 {
		if err := database.DB.Create(&record).Error; err != nil {
			return nil, err
		}
	} else {
		if err := database.DB.Save(&record).Error; err != nil {
			return nil, err
		}
	}
	return s.EnsurePreliminarVentasSlot(companyID, periodYM, slotIndex)
}

// MarkPreliminarVentasSlotSent marca una entrega como enviada al cliente — acción explícita del
// asistente, separada de guardar (confirmado con el usuario). Exige que ya haya datos registrados.
func (s *SupervisorService) MarkPreliminarVentasSlotSent(companyID uint, periodYM string, slotIndex int, userID uint) (*PreliminarVentasSlotDetail, error) {
	detail, err := s.EnsurePreliminarVentasSlot(companyID, periodYM, slotIndex)
	if err != nil {
		return nil, err
	}
	if detail.ControlSuspendida {
		return nil, errors.New("esta empresa está suspendida en este período (marcado desde Control de Detracciones); no se puede editar")
	}
	if detail.Status == models.PreliminarVentasPendiente {
		return nil, errors.New("primero registre los datos de esta entrega antes de marcarla como enviada")
	}
	var ctrl models.SupervisorMonthlyControl
	if err := database.DB.Where("company_id = ? AND period_ym = ?", companyID, periodYM).First(&ctrl).Error; err != nil {
		return nil, err
	}
	now := time.Now()
	if err := database.DB.Model(&models.SupervisorPreliminarVentasRecord{}).
		Where("monthly_control_id = ? AND slot_index = ?", ctrl.ID, slotIndex).
		Updates(map[string]any{"status": models.PreliminarVentasEnviado, "sent_at": now, "sent_by_user_id": userID}).Error; err != nil {
		return nil, err
	}
	return s.EnsurePreliminarVentasSlot(companyID, periodYM, slotIndex)
}

// ListPreliminarVentas listado empresa+período del módulo — columnas comunes más el estado y fecha
// límite de cada una de las 2 entregas del mes.
func (s *SupervisorService) ListPreliminarVentas(p PreliminarVentasListParams) ([]PreliminarVentasListRow, int64, error) {
	if !validPeriodYM(p.PeriodYM) {
		return nil, 0, errors.New("período inválido (use YYYY-MM)")
	}
	page := p.Page
	if page < 1 {
		page = 1
	}
	perPage := p.PerPage
	if perPage < 1 {
		perPage = 20
	}
	if perPage > 200 {
		perPage = 200
	}

	q := database.DB.Table("companies AS comp").
		Joins("LEFT JOIN supervisor_monthly_controls c ON c.company_id = comp.id AND c.period_ym = ? AND c.deleted_at IS NULL", p.PeriodYM).
		Joins("LEFT JOIN supervisor_preliminar_ventas_records s1 ON s1.monthly_control_id = c.id AND s1.slot_index = 1 AND s1.deleted_at IS NULL").
		Joins("LEFT JOIN supervisor_preliminar_ventas_records s2 ON s2.monthly_control_id = c.id AND s2.slot_index = 2 AND s2.deleted_at IS NULL").
		Joins("LEFT JOIN users au ON au.id = comp.assistant_user_id").
		Where(companyStudioVisibleSQL("comp"))

	if len(p.AllowedCompanyIDs) > 0 {
		q = q.Where("comp.id IN ?", p.AllowedCompanyIDs)
	} else if p.AllowedCompanyIDs != nil {
		return []PreliminarVentasListRow{}, 0, nil
	}
	if term := strings.TrimSpace(p.Q); len(term) >= 2 {
		like := "%" + term + "%"
		q = q.Where("comp.ruc LIKE ? OR comp.business_name LIKE ?", like, like)
	}
	if status := strings.TrimSpace(p.Status); status != "" {
		if status == PreliminarVentasSinRegistro {
			q = q.Where("s1.id IS NULL AND s2.id IS NULL")
		} else {
			q = q.Where(
				"COALESCE(s1.status, ?) = ? OR COALESCE(s2.status, ?) = ?",
				models.PreliminarVentasPendiente, status, models.PreliminarVentasPendiente, status,
			)
		}
	}

	var total int64
	if err := q.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	type rawRow struct {
		CompanyID         uint
		Code              string
		BusinessName      string
		RUC               string
		AssistantUsername string
		Suspendida        bool
		Slot1Status       *string
		Slot2Status       *string
		Slot1SentAt       *time.Time
		Slot2SentAt       *time.Time
		Slot1CreatedAt    *time.Time
		Slot2CreatedAt    *time.Time
	}
	var raws []rawRow
	q = q.Select(
		"comp.id AS company_id, comp.internal_code AS code, comp.business_name, comp.ruc, " +
			"au.username AS assistant_username, " +
			"COALESCE(c.suspendida, false) AS suspendida, " +
			"s1.status AS slot1_status, s2.status AS slot2_status, s1.sent_at AS slot1_sent_at, s2.sent_at AS slot2_sent_at, " +
			"s1.created_at AS slot1_created_at, s2.created_at AS slot2_created_at",
	).
		Order("comp.internal_code ASC")
	if !p.All {
		q = q.Limit(perPage).Offset((page - 1) * perPage)
	}
	err := q.Scan(&raws).Error
	if err != nil {
		return nil, 0, err
	}

	due1, due2 := preliminarVentasSlotDueDates(p.PeriodYM)
	acts := preliminarVentasSlotActivities(p.PeriodYM)
	now := time.Now()
	slotState := func(idx int, status string, due *time.Time, sentAt, registradoAt *time.Time, suspendida bool) PreliminarVentasSlotStatus {
		out := PreliminarVentasSlotStatus{Status: status, DueDate: due, SentAt: sentAt, RegistradoAt: registradoAt, Disponible: activityDateReached(due)}
		if due != nil && idx < len(acts) {
			out.Timeliness = preliminarSlotTimeliness(*due, acts[idx].ActivityRuleID, status, registradoAt, suspendida, now).Timeliness
		}
		return out
	}
	rows := make([]PreliminarVentasListRow, 0, len(raws))
	for _, r := range raws {
		s1 := models.PreliminarVentasPendiente
		if r.Slot1Status != nil {
			s1 = *r.Slot1Status
		}
		s2 := models.PreliminarVentasPendiente
		if r.Slot2Status != nil {
			s2 = *r.Slot2Status
		}
		rows = append(rows, PreliminarVentasListRow{
			CompanyID:         r.CompanyID,
			Code:              strings.TrimSpace(r.Code),
			Dig:               s.companyDig(r.CompanyID),
			BusinessName:      strings.TrimSpace(r.BusinessName),
			RUC:               strings.TrimSpace(r.RUC),
			AssistantUsername: strings.TrimSpace(r.AssistantUsername),
			Suspendida:        r.Suspendida,
			Slot1:             slotState(0, s1, due1, r.Slot1SentAt, r.Slot1CreatedAt, r.Suspendida),
			Slot2:             slotState(1, s2, due2, r.Slot2SentAt, r.Slot2CreatedAt, r.Suspendida),
		})
	}
	return rows, total, nil
}
