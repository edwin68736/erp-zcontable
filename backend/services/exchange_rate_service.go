package services

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"

	"miappfiber/database"
	"miappfiber/models"

	"gorm.io/gorm/clause"
)

// Tipo de cambio (compra y venta de SUNAT) para Recursos → Tipo de cambio.
//
// SUNAT publica su tipo de cambio en un calendario mensual (e-consulta.sunat.gob.pe/cl-at-ittipcam), pero esa página
// rechaza las consultas automáticas, así que los valores se traen de ApiPeru.dev, que los reproduce día por día
// (POST /api/tipo-de-cambio con {"fecha","moneda"}; no tiene consulta por mes). Cada día traído se guarda en
// exchange_rates y no se vuelve a pedir: un mes se completa una sola vez. Cada consulta consume 1 del plan de ApiPeru.dev.
//
// El valor de una fecha es el cierre de la SBS del día hábil anterior (fecha_sunat), igual que en el calendario de SUNAT,
// que muestra hasta el día siguiente a hoy.

const (
	exchangeCurrencyUSD   = "USD"
	exchangeCurrencyEUR   = "EUR"
	exchangeFetchWorkers  = 4
	exchangeNotFoundRetry = time.Hour     // un día que ApiPeru no tiene no se vuelve a pedir enseguida
	exchangeRefreshAfter  = 3 * time.Hour // hoy y mañana pueden cambiar cuando SBS publica el cierre
	exchangeMinYear       = 2004
)

// Códigos de aviso de un mes que no pudo completarse (la pantalla muestra lo que haya en la base).
const (
	ExchangeWarnNoToken  = "sin_token"
	ExchangeWarnAuth     = "token_invalido"
	ExchangeWarnLimit    = "limite"
	ExchangeWarnPartial  = "parcial"
	ExchangeWarnNetwork  = "sin_conexion"
	ExchangeWarnNotFound = "sin_publicar"
)

// ExchangeMonth los tipos de cambio de un mes.
type ExchangeMonth struct {
	Year     int                   `json:"year"`
	Month    int                   `json:"month"`
	Currency string                `json:"currency"`
	Days     []models.ExchangeRate `json:"days"`
	// Missing fechas del mes (hasta mañana) que todavía no tienen valor.
	Missing []string `json:"missing"`
	// Fetched días traídos de ApiPeru.dev en esta consulta.
	Fetched     int    `json:"fetched"`
	Warning     string `json:"warning,omitempty"`
	WarningCode string `json:"warning_code,omitempty"`
}

type ExchangeRateService struct {
	cfg  *ConfigService
	http *http.Client
	now  func() time.Time

	mu       sync.Mutex
	notFound map[string]time.Time // moneda|fecha → cuándo se supo que no estaba publicado
	inFlight map[string]*sync.Mutex
}

func NewExchangeRateService() *ExchangeRateService {
	return &ExchangeRateService{
		cfg:      NewConfigService(),
		http:     &http.Client{Timeout: 15 * time.Second},
		now:      time.Now,
		notFound: map[string]time.Time{},
		inFlight: map[string]*sync.Mutex{},
	}
}

// today / tomorrow en hora de Lima (la fecha que ve el usuario).
func (s *ExchangeRateService) today() time.Time {
	n := s.now().In(limaLocation())
	return time.Date(n.Year(), n.Month(), n.Day(), 0, 0, 0, 0, time.UTC)
}

func normalizeExchangeCurrency(c string) (string, error) {
	c = strings.ToUpper(strings.TrimSpace(c))
	switch c {
	case "":
		return exchangeCurrencyUSD, nil
	case exchangeCurrencyUSD, exchangeCurrencyEUR:
		return c, nil
	}
	return "", accessErr(SunatAccessInvalidParams, "Moneda no válida: use USD o EUR.", c)
}

// monthLock un candado por mes y moneda: dos pantallas abiertas no traen el mismo mes a la vez.
func (s *ExchangeRateService) monthLock(key string) *sync.Mutex {
	s.mu.Lock()
	defer s.mu.Unlock()
	l, ok := s.inFlight[key]
	if !ok {
		l = &sync.Mutex{}
		s.inFlight[key] = l
	}
	return l
}

// Month devuelve los tipos de cambio del mes guardados en la base. Con fetch=true, antes trae de ApiPeru.dev los días
// que falten (hasta mañana). Si no se pudo completar, devuelve lo que haya y un aviso (nunca falla por eso).
func (s *ExchangeRateService) Month(year, month int, currency string, fetch bool) (*ExchangeMonth, error) {
	currency, err := normalizeExchangeCurrency(currency)
	if err != nil {
		return nil, err
	}
	if month < 1 || month > 12 || year < exchangeMinYear || year > s.today().Year()+1 {
		return nil, accessErr(SunatAccessInvalidParams, "Indique un mes y un año válidos.", fmt.Sprintf("%d-%d", year, month))
	}
	out := &ExchangeMonth{Year: year, Month: month, Currency: currency, Days: []models.ExchangeRate{}, Missing: []string{}}

	if fetch {
		lock := s.monthLock(fmt.Sprintf("%s|%04d-%02d", currency, year, month))
		lock.Lock()
		s.completeMonth(out)
		lock.Unlock()
	}
	s.loadMonth(out)
	return out, nil
}

// monthDates las fechas AAAA-MM-DD del mes, hasta mañana inclusive.
func (s *ExchangeRateService) monthDates(year, month int) []string {
	limit := s.today().AddDate(0, 0, 1)
	first := time.Date(year, time.Month(month), 1, 0, 0, 0, 0, time.UTC)
	var out []string
	for d := first; d.Month() == first.Month() && !d.After(limit); d = d.AddDate(0, 0, 1) {
		out = append(out, d.Format("2006-01-02"))
	}
	return out
}

// loadMonth lee de la base los días del mes y calcula los que faltan.
func (s *ExchangeRateService) loadMonth(m *ExchangeMonth) {
	prefix := fmt.Sprintf("%04d-%02d-", m.Year, m.Month)
	var rows []models.ExchangeRate
	database.DB.Where("currency = ? AND date LIKE ?", m.Currency, prefix+"%").Order("date ASC").Find(&rows)
	have := map[string]bool{}
	for _, r := range rows {
		have[r.Date] = true
	}
	m.Days = rows
	if m.Days == nil {
		m.Days = []models.ExchangeRate{}
	}
	m.Missing = []string{}
	for _, d := range s.monthDates(m.Year, m.Month) {
		if !have[d] {
			m.Missing = append(m.Missing, d)
		}
	}
}

// completeMonth trae de ApiPeru.dev los días que faltan (y refresca hoy y mañana si están viejos).
func (s *ExchangeRateService) completeMonth(m *ExchangeMonth) {
	s.loadMonth(m)
	today := s.today().Format("2006-01-02")
	var todo []string
	for _, d := range m.Missing {
		s.mu.Lock()
		t, skip := s.notFound[m.Currency+"|"+d]
		s.mu.Unlock()
		if skip && s.now().Sub(t) < exchangeNotFoundRetry {
			continue
		}
		todo = append(todo, d)
	}
	for _, r := range m.Days { // hoy y mañana: el cierre de SBS puede publicarse después
		if r.Date >= today && s.now().Sub(r.FetchedAt) > exchangeRefreshAfter {
			todo = append(todo, r.Date)
		}
	}
	if len(todo) == 0 {
		if len(m.Missing) > 0 {
			m.WarningCode, m.Warning = ExchangeWarnNotFound, "Algunos días todavía no tienen tipo de cambio publicado."
		}
		return
	}
	sort.Strings(todo)

	token, base, err := s.credentials()
	if err != nil {
		m.WarningCode, m.Warning = ExchangeWarnNoToken, err.Error()
		return
	}

	type result struct {
		date string
		rate *models.ExchangeRate
		err  error
	}
	jobs := make(chan string)
	results := make(chan result)
	stop := make(chan struct{})
	var stopOnce sync.Once
	var wg sync.WaitGroup
	for i := 0; i < exchangeFetchWorkers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for d := range jobs {
				select {
				case <-stop:
					results <- result{date: d, err: errExchangeSkipped}
					continue
				default:
				}
				rate, err := s.fetchDay(token, base, m.Currency, d)
				results <- result{date: d, rate: rate, err: err}
			}
		}()
	}
	go func() {
		for _, d := range todo {
			jobs <- d
		}
		close(jobs)
		wg.Wait()
		close(results)
	}()

	var fatal error
	failed := 0
	for r := range results {
		switch {
		case r.err == nil:
			if e := database.DB.Clauses(clause.OnConflict{
				Columns:   []clause.Column{{Name: "currency"}, {Name: "date"}},
				DoUpdates: clause.AssignmentColumns([]string{"buy", "sell", "sunat_date", "source", "fetched_at"}),
			}).Create(r.rate).Error; e == nil {
				m.Fetched++
			}
		case errors.Is(r.err, errExchangeNotFound):
			s.mu.Lock()
			s.notFound[m.Currency+"|"+r.date] = s.now()
			s.mu.Unlock()
		case errors.Is(r.err, errExchangeSkipped):
		default:
			failed++
			var fe *exchangeFatalError
			if errors.As(r.err, &fe) && fatal == nil {
				fatal = r.err
				stopOnce.Do(func() { close(stop) })
			} else if fatal == nil {
				fatal = r.err
			}
		}
	}
	s.loadMonth(m)
	switch {
	case fatal != nil:
		var fe *exchangeFatalError
		if errors.As(fatal, &fe) {
			m.WarningCode, m.Warning = fe.code, fe.msg
		} else {
			m.WarningCode, m.Warning = ExchangeWarnNetwork, "No se pudo consultar ApiPeru.dev: "+truncateStr(fatal.Error(), 160)
		}
		if m.Fetched > 0 || len(m.Days) > 0 {
			m.Warning += " Se muestra lo que ya está guardado."
		}
	case len(m.Missing) > 0:
		m.WarningCode, m.Warning = ExchangeWarnNotFound, "Algunos días todavía no tienen tipo de cambio publicado."
	}
}

var (
	errExchangeNotFound = errors.New("tipo de cambio no publicado")
	errExchangeSkipped  = errors.New("omitido")
)

// exchangeFatalError un error que no tiene sentido reintentar día por día (token, límite del plan).
type exchangeFatalError struct{ code, msg string }

func (e *exchangeFatalError) Error() string { return e.msg }

// credentials el token y la URL base de ApiPeru.dev guardados en Ajustes del estudio.
func (s *ExchangeRateService) credentials() (string, string, error) {
	cfg, err := s.cfg.GetFirmConfig()
	if err != nil {
		return "", "", err
	}
	token := bearerToken(cfg.ApiPeruToken)
	if token == "" {
		return "", "", errors.New("Configure el token de ApiPeru.dev en Ajustes del estudio para traer el tipo de cambio.")
	}
	base := strings.TrimRight(strings.TrimSpace(cfg.ApiPeruBaseURL), "/")
	if base == "" {
		base = defaultApiPeruBase
	}
	return token, base, nil
}

// fetchDay pide a ApiPeru.dev el tipo de cambio de una fecha.
func (s *ExchangeRateService) fetchDay(token, base, currency, date string) (*models.ExchangeRate, error) {
	body, _ := json.Marshal(map[string]string{"fecha": date, "moneda": currency})
	req, err := http.NewRequest(http.MethodPost, base+"/api/tipo-de-cambio", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := s.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("no se pudo contactar ApiPeru.dev: %w", err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<16))

	switch resp.StatusCode {
	case http.StatusUnauthorized, http.StatusForbidden:
		return nil, &exchangeFatalError{ExchangeWarnAuth, "ApiPeru.dev rechazó el token (revise Ajustes del estudio)."}
	case http.StatusTooManyRequests, http.StatusPaymentRequired:
		return nil, &exchangeFatalError{ExchangeWarnLimit, "ApiPeru.dev indica que se alcanzó el límite de consultas de su plan."}
	}

	var env struct {
		Success bool   `json:"success"`
		Code    string `json:"code"`
		Message string `json:"message"`
		Data    *struct {
			Moneda     string  `json:"moneda"`
			Busqueda   string  `json:"fecha_busqueda"`
			FechaSunat string  `json:"fecha_sunat"`
			Compra     float64 `json:"compra"`
			Venta      float64 `json:"venta"`
		} `json:"data"`
	}
	if json.Unmarshal(raw, &env) != nil {
		return nil, fmt.Errorf("respuesta inválida de ApiPeru.dev (HTTP %d)", resp.StatusCode)
	}
	if !env.Success || env.Data == nil {
		if resp.StatusCode == http.StatusNotFound || env.Code == "document_not_found" {
			return nil, errExchangeNotFound
		}
		msg := strings.TrimSpace(env.Message)
		low := strings.ToLower(msg)
		if strings.Contains(low, "límite") || strings.Contains(low, "limite") || strings.Contains(low, "consultas") && strings.Contains(low, "plan") {
			return nil, &exchangeFatalError{ExchangeWarnLimit, "ApiPeru.dev: " + truncateStr(msg, 160)}
		}
		if msg == "" {
			msg = fmt.Sprintf("HTTP %d", resp.StatusCode)
		}
		return nil, errors.New("ApiPeru.dev: " + truncateStr(msg, 160))
	}
	d := env.Data
	if d.Compra <= 0 || d.Venta <= 0 {
		return nil, errExchangeNotFound
	}
	return &models.ExchangeRate{
		Currency: currency, Date: date, Buy: d.Compra, Sell: d.Venta, SunatDate: strings.TrimSpace(d.FechaSunat),
		Source: "apiperu", FetchedAt: s.now(),
	}, nil
}

// Rate el tipo de cambio de una fecha (de la base; si falta, lo trae de ApiPeru.dev). Sirve a otros módulos.
func (s *ExchangeRateService) Rate(currency, date string) (*models.ExchangeRate, error) {
	currency, err := normalizeExchangeCurrency(currency)
	if err != nil {
		return nil, err
	}
	t, err := time.Parse("2006-01-02", strings.TrimSpace(date))
	if err != nil {
		return nil, accessErr(SunatAccessInvalidParams, "Use una fecha válida AAAA-MM-DD.", date)
	}
	var r models.ExchangeRate
	if database.DB.Where("currency = ? AND date = ?", currency, t.Format("2006-01-02")).First(&r).Error == nil {
		return &r, nil
	}
	token, base, cerr := s.credentials()
	if cerr != nil {
		return nil, cerr
	}
	rate, ferr := s.fetchDay(token, base, currency, t.Format("2006-01-02"))
	if ferr != nil {
		return nil, ferr
	}
	if e := database.DB.Clauses(clause.OnConflict{DoNothing: true}).Create(rate).Error; e != nil {
		return rate, nil
	}
	return rate, nil
}
