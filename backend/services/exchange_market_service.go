package services

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Tipo de cambio «paralelo» (de mercado), distinto del de SUNAT (que es el cierre de la SBS): es el que muestran Google
// y las casas de cambio, y sirve para convertir dólares a soles al valor al que realmente se negocia.
//
// Fuente principal: Yahoo Finance, par USD/PEN (`USDPEN=X`), que trae la cotización de ahora y el historial diario con la
// misma forma que el gráfico de Google. Es una dirección pública pero no oficial: si dejara de responder, se usan
//   - valor de hoy: open.er-api.com (una cotización de mercado diaria);
//   - historial: BCRP, tipo de cambio interbancario (promedio de compra y venta; publica con 1 o 2 días de retraso).
//
// Es solo informativo: no se guarda en la base y se recuerda en memoria unos minutos.

const (
	marketYahooURL  = "https://query1.finance.yahoo.com/v8/finance/chart/USDPEN=X?range=1y&interval=1d"
	marketSpotURL   = "https://open.er-api.com/v6/latest/USD"
	marketBCRPURL   = "https://estadisticas.bcrp.gob.pe/estadisticas/series/api/PD04637PD-PD04638PD/json/%s/%s/esp"
	marketHistory   = 400 // días de historial que se piden al BCRP (alcanza para «1 año»)
	marketCacheTTL  = 15 * time.Minute
	marketHTTPLimit = 15 * time.Second

	marketSrcYahoo = "Yahoo Finance (mercado)"
	marketSrcER    = "open.er-api.com (mercado)"
	marketSrcBCRP  = "BCRP interbancario"
)

// MarketPoint un día del historial (cierre).
type MarketPoint struct {
	Date  string  `json:"date"` // AAAA-MM-DD
	Value float64 `json:"value"`
}

// MarketSpot la cotización de ahora (1 US$ en soles).
type MarketSpot struct {
	Rate      float64 `json:"rate"`
	UpdatedAt string  `json:"updated_at"` // ISO 8601 (UTC) o AAAA-MM-DD si la fuente solo da el día
	Source    string  `json:"source"`
}

// MarketRates lo que muestra Recursos → Tipo de cambio → «Tipo de cambio paralelo».
type MarketRates struct {
	Spot         *MarketSpot   `json:"spot,omitempty"`
	Series       []MarketPoint `json:"series"` // del más antiguo al más reciente
	SeriesSource string        `json:"series_source,omitempty"`
	Warnings     []string      `json:"warnings,omitempty"`
	FetchedAt    time.Time     `json:"fetched_at"`
}

type ExchangeMarketService struct {
	http     *http.Client
	yahooURL string
	spotURL  string
	bcrpURL  string // con dos %s: fecha inicial y final (AAAA-MM-DD)
	now      func() time.Time

	mu    sync.Mutex
	cache *MarketRates
}

func NewExchangeMarketService() *ExchangeMarketService {
	return &ExchangeMarketService{http: &http.Client{Timeout: marketHTTPLimit}, yahooURL: marketYahooURL, spotURL: marketSpotURL, bcrpURL: marketBCRPURL, now: time.Now}
}

// Get devuelve el tipo de cambio de mercado (de memoria si es reciente). Si la fuente principal falla se usan las de
// respaldo con un aviso; si todas fallan y hay algo guardado, se devuelve lo guardado.
func (s *ExchangeMarketService) Get() (*MarketRates, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.cache != nil && s.now().Sub(s.cache.FetchedAt) < marketCacheTTL {
		return s.cache, nil
	}
	res := &MarketRates{Series: []MarketPoint{}, FetchedAt: s.now()}

	spot, series, yerr := s.fetchYahoo()
	if yerr == nil {
		res.Spot, res.Series, res.SeriesSource = spot, series, marketSrcYahoo
		s.cache = res
		return res, nil
	}

	// Respaldo: valor de hoy de open.er-api e historial del BCRP.
	var wg sync.WaitGroup
	var spotER *MarketSpot
	var bcrp []MarketPoint
	var spotErr, bcrpErr error
	wg.Add(2)
	go func() { defer wg.Done(); spotER, spotErr = s.fetchSpotER() }()
	go func() { defer wg.Done(); bcrp, bcrpErr = s.fetchBCRP() }()
	wg.Wait()
	if spotErr != nil && bcrpErr != nil {
		if s.cache != nil {
			stale := *s.cache
			stale.Warnings = append([]string{"No se pudo actualizar; se muestra lo último que se pudo leer."}, stale.Warnings...)
			return &stale, nil
		}
		return nil, fmt.Errorf("sin fuentes: %v | %v | %v", yerr, spotErr, bcrpErr)
	}
	res.Warnings = append(res.Warnings, "La fuente principal del mercado no respondió; se muestran fuentes de respaldo y los valores pueden diferir un poco de Google.")
	if bcrpErr == nil {
		res.Series, res.SeriesSource = bcrp, marketSrcBCRP
	}
	switch {
	case spotErr == nil:
		res.Spot = spotER
	case len(res.Series) > 0:
		last := res.Series[len(res.Series)-1]
		res.Spot = &MarketSpot{Rate: last.Value, UpdatedAt: last.Date, Source: marketSrcBCRP}
	}
	s.cache = res
	return res, nil
}

func (s *ExchangeMarketService) getJSON(u string, v any) error {
	req, err := http.NewRequest(http.MethodGet, u, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (compatible; ZContable)")
	req.Header.Set("Accept", "application/json")
	resp, err := s.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	return json.Unmarshal(body, v)
}

// fetchYahoo cotización de ahora e historial diario del par USD/PEN.
func (s *ExchangeMarketService) fetchYahoo() (*MarketSpot, []MarketPoint, error) {
	var r struct {
		Chart struct {
			Result []struct {
				Meta struct {
					Price float64 `json:"regularMarketPrice"`
					Time  int64   `json:"regularMarketTime"`
					Curr  string  `json:"currency"`
				} `json:"meta"`
				Timestamp  []int64 `json:"timestamp"`
				Indicators struct {
					Quote []struct {
						Close []*float64 `json:"close"`
					} `json:"quote"`
				} `json:"indicators"`
			} `json:"result"`
		} `json:"chart"`
	}
	if err := s.getJSON(s.yahooURL, &r); err != nil {
		return nil, nil, err
	}
	if len(r.Chart.Result) == 0 || len(r.Chart.Result[0].Indicators.Quote) == 0 {
		return nil, nil, fmt.Errorf("respuesta sin datos")
	}
	res := r.Chart.Result[0]
	if res.Meta.Curr != "" && !strings.EqualFold(res.Meta.Curr, "PEN") {
		return nil, nil, fmt.Errorf("moneda inesperada %s", res.Meta.Curr)
	}
	closes := res.Indicators.Quote[0].Close
	points := make([]MarketPoint, 0, len(res.Timestamp))
	for i, ts := range res.Timestamp {
		if i >= len(closes) || closes[i] == nil || *closes[i] <= 0 {
			continue
		}
		points = append(points, MarketPoint{Date: time.Unix(ts, 0).UTC().Format("2006-01-02"), Value: round4(*closes[i])})
	}
	if len(points) == 0 || res.Meta.Price <= 0 {
		return nil, nil, fmt.Errorf("sin cotización")
	}
	updated := points[len(points)-1].Date
	if res.Meta.Time > 0 {
		updated = time.Unix(res.Meta.Time, 0).UTC().Format(time.RFC3339)
	}
	return &MarketSpot{Rate: round4(res.Meta.Price), UpdatedAt: updated, Source: marketSrcYahoo}, points, nil
}

func (s *ExchangeMarketService) fetchSpotER() (*MarketSpot, error) {
	var r struct {
		Result string             `json:"result"`
		Update string             `json:"time_last_update_utc"`
		Unix   int64              `json:"time_last_update_unix"`
		Rates  map[string]float64 `json:"rates"`
	}
	if err := s.getJSON(s.spotURL, &r); err != nil {
		return nil, err
	}
	pen := r.Rates["PEN"]
	if r.Result != "success" || pen <= 0 {
		return nil, fmt.Errorf("respuesta sin PEN")
	}
	updated := r.Update
	if r.Unix > 0 {
		updated = time.Unix(r.Unix, 0).UTC().Format(time.RFC3339)
	}
	return &MarketSpot{Rate: round4(pen), UpdatedAt: updated, Source: marketSrcER}, nil
}

var bcrpMonths = map[string]time.Month{
	"ene": 1, "feb": 2, "mar": 3, "abr": 4, "may": 5, "jun": 6, "jul": 7, "ago": 8, "set": 9, "sep": 9, "oct": 10, "nov": 11, "dic": 12,
}

// parseBCRPDay «12.Oct.26» → «2026-10-12».
func parseBCRPDay(s string) (string, bool) {
	p := strings.Split(strings.TrimSpace(s), ".")
	if len(p) != 3 {
		return "", false
	}
	day, e1 := strconv.Atoi(p[0])
	yy, e2 := strconv.Atoi(p[2])
	mon, ok := bcrpMonths[strings.ToLower(p[1])]
	if e1 != nil || e2 != nil || !ok || day < 1 || day > 31 {
		return "", false
	}
	if yy < 100 {
		yy += 2000
	}
	return fmt.Sprintf("%04d-%02d-%02d", yy, int(mon), day), true
}

// fetchBCRP tipo de cambio interbancario: promedio de compra y venta por día; los días sin dato («n.d.») se omiten.
func (s *ExchangeMarketService) fetchBCRP() ([]MarketPoint, error) {
	end := s.now().In(limaLocation())
	start := end.AddDate(0, 0, -marketHistory)
	var r struct {
		Periods []struct {
			Name   string   `json:"name"`
			Values []string `json:"values"`
		} `json:"periods"`
	}
	if err := s.getJSON(fmt.Sprintf(s.bcrpURL, start.Format("2006-01-02"), end.Format("2006-01-02")), &r); err != nil {
		return nil, err
	}
	out := make([]MarketPoint, 0, len(r.Periods))
	for _, p := range r.Periods {
		date, ok := parseBCRPDay(p.Name)
		if !ok || len(p.Values) < 2 {
			continue
		}
		compra, e1 := strconv.ParseFloat(strings.TrimSpace(p.Values[0]), 64)
		venta, e2 := strconv.ParseFloat(strings.TrimSpace(p.Values[1]), 64)
		if e1 != nil || e2 != nil || compra <= 0 || venta <= 0 {
			continue
		}
		out = append(out, MarketPoint{Date: date, Value: round4((compra + venta) / 2)})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Date < out[j].Date })
	if len(out) == 0 {
		return nil, fmt.Errorf("el BCRP no devolvió días con dato")
	}
	return out, nil
}

func round4(v float64) float64 { return float64(int64(v*10000+0.5)) / 10000 }
