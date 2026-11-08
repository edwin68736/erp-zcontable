package services

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"miappfiber/database"
	"miappfiber/models"
)

// fakeApiPeru imita POST /api/tipo-de-cambio de ApiPeru.dev.
type fakeApiPeru struct {
	srv      *httptest.Server
	calls    atomic.Int32
	mu       sync.Mutex
	asked    []string
	status   int // si es distinto de 0, todas las respuestas usan este estado
	notFound map[string]bool
	lastAuth string
}

func newFakeApiPeru(t *testing.T) *fakeApiPeru {
	f := &fakeApiPeru{notFound: map[string]bool{}}
	f.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f.calls.Add(1)
		var body struct{ Fecha, Moneda string }
		_ = json.NewDecoder(r.Body).Decode(&body)
		f.mu.Lock()
		f.asked = append(f.asked, body.Fecha)
		f.lastAuth = r.Header.Get("Authorization")
		nf := f.notFound[body.Fecha]
		f.mu.Unlock()
		if r.URL.Path != "/api/tipo-de-cambio" || r.Method != http.MethodPost || r.Header.Get("Authorization") == "" {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		if f.status != 0 {
			w.WriteHeader(f.status)
			_, _ = w.Write([]byte(`{"success":false,"message":"no autorizado"}`))
			return
		}
		if nf {
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte(`{"success":false,"code":"document_not_found","message":"Tipo de cambio no encontrado."}`))
			return
		}
		d, _ := time.Parse("2006-01-02", body.Fecha)
		// compra = 3.40 + día/1000, venta = compra + 0.006 ; el cierre es del día anterior
		compra := 3.40 + float64(d.Day())/1000
		_ = json.NewEncoder(w).Encode(map[string]any{
			"success": true, "code": "found",
			"data": map[string]any{
				"moneda": body.Moneda, "fecha_busqueda": body.Fecha, "fecha_sunat": d.AddDate(0, 0, -1).Format("2006-01-02"),
				"compra": compra, "venta": compra + 0.006,
			},
		})
	}))
	t.Cleanup(f.srv.Close)
	return f
}

func newExchangeTest(t *testing.T, f *fakeApiPeru, token string) *ExchangeRateService {
	db := setupCompanyRucTestDB(t)
	if err := db.AutoMigrate(&models.FirmConfig{}, &models.ExchangeRate{}); err != nil {
		t.Fatal(err)
	}
	db.Create(&models.FirmConfig{Name: "Estudio", ApiPeruToken: token, ApiPeruBaseURL: f.srv.URL})
	svc := NewExchangeRateService()
	svc.now = func() time.Time { return time.Date(2026, 11, 7, 15, 0, 0, 0, time.UTC) } // 10:00 en Lima
	return svc
}

func TestExchangeMonth_traeLosDiasQueFaltanYNoLosVuelvePedir(t *testing.T) {
	f := newFakeApiPeru(t)
	svc := newExchangeTest(t, f, "Bearer secreto")

	// Octubre (cerrado): 31 días.
	m, err := svc.Month(2026, 10, "usd", true)
	if err != nil {
		t.Fatal(err)
	}
	if len(m.Days) != 31 || len(m.Missing) != 0 || m.Fetched != 31 || m.Warning != "" || f.calls.Load() != 31 {
		t.Fatalf("octubre: días=%d faltan=%d traídos=%d aviso=%q llamadas=%d", len(m.Days), len(m.Missing), m.Fetched, m.Warning, f.calls.Load())
	}
	if f.lastAuth != "Bearer secreto" {
		t.Errorf("el token se envía como Bearer sin duplicar el prefijo: %q", f.lastAuth)
	}
	d3 := m.Days[2]
	if d3.Date != "2026-10-03" || d3.Buy != 3.403 || d3.Sell != 3.409 || d3.SunatDate != "2026-10-02" || d3.Currency != "USD" {
		t.Errorf("día 3: %+v", d3)
	}
	// Ya está completo: no vuelve a llamar a ApiPeru.
	if m2, _ := svc.Month(2026, 10, "USD", true); f.calls.Load() != 31 || len(m2.Days) != 31 || m2.Fetched != 0 {
		t.Errorf("no debía volver a pedir: llamadas=%d traídos=%d", f.calls.Load(), m2.Fetched)
	}
	// Sin fetch solo lee la base.
	if m3, _ := svc.Month(2026, 9, "USD", false); len(m3.Days) != 0 || len(m3.Missing) != 30 || f.calls.Load() != 31 {
		t.Errorf("sin fetch no consulta: días=%d faltan=%d llamadas=%d", len(m3.Days), len(m3.Missing), f.calls.Load())
	}
}

func TestExchangeMonth_elMesActualLlegaHastaManiana(t *testing.T) {
	f := newFakeApiPeru(t)
	svc := newExchangeTest(t, f, "tok")
	m, err := svc.Month(2026, 11, "USD", true)
	if err != nil {
		t.Fatal(err)
	}
	// Hoy es 7 → se pide hasta el 8 (como el calendario de SUNAT).
	if len(m.Days) != 8 || m.Days[7].Date != "2026-11-08" || len(m.Missing) != 0 {
		t.Fatalf("noviembre: %d días, faltan %v", len(m.Days), m.Missing)
	}
	for _, d := range f.asked {
		if d > "2026-11-08" {
			t.Errorf("no debía pedir fechas futuras: %s", d)
		}
	}
	// Hoy y mañana se refrescan pasadas unas horas; lo anterior no.
	before := f.calls.Load()
	svc.now = func() time.Time { return time.Date(2026, 11, 7, 20, 0, 0, 0, time.UTC) } // 15:00 en Lima: 5 h después
	if _, err := svc.Month(2026, 11, "USD", true); err != nil {
		t.Fatal(err)
	}
	if got := f.calls.Load() - before; got != 2 {
		t.Errorf("debía refrescar solo hoy y mañana (2 llamadas), hizo %d", got)
	}
}

func TestExchangeMonth_diasSinPublicarNoSeInsisten(t *testing.T) {
	f := newFakeApiPeru(t)
	f.notFound["2026-11-08"] = true
	svc := newExchangeTest(t, f, "tok")
	m, _ := svc.Month(2026, 11, "USD", true)
	if len(m.Days) != 7 || len(m.Missing) != 1 || m.Missing[0] != "2026-11-08" || m.WarningCode != ExchangeWarnNotFound {
		t.Fatalf("un día sin publicar queda como faltante con aviso: %d días, %v, %q", len(m.Days), m.Missing, m.WarningCode)
	}
	n := f.calls.Load()
	svc.Month(2026, 11, "USD", true)
	// Solo se vuelve a pedir lo que se refresca (nada, aún no pasan 3 h) y no lo que ya se supo que no estaba.
	if f.calls.Load() != n {
		t.Errorf("no debía insistir con un día sin publicar durante la hora siguiente (%d → %d)", n, f.calls.Load())
	}
}

func TestExchangeMonth_sinTokenOTokenInvalidoDevuelveLoGuardado(t *testing.T) {
	f := newFakeApiPeru(t)
	svc := newExchangeTest(t, f, "")
	database.DB.Create(&models.ExchangeRate{Currency: "USD", Date: "2026-10-01", Buy: 3.4, Sell: 3.41, FetchedAt: svc.now()})
	m, err := svc.Month(2026, 10, "USD", true)
	if err != nil || m.WarningCode != ExchangeWarnNoToken || len(m.Days) != 1 || f.calls.Load() != 0 {
		t.Fatalf("sin token: %+v err=%v llamadas=%d", m, err, f.calls.Load())
	}

	// Token rechazado: se detiene (no gasta las 30 consultas restantes) y avisa.
	database.DB.Model(&models.FirmConfig{}).Where("1 = 1").Update("api_peru_token", "malo")
	f.status = http.StatusUnauthorized
	m, _ = svc.Month(2026, 10, "USD", true)
	if m.WarningCode != ExchangeWarnAuth || !strings.Contains(m.Warning, "Se muestra lo que ya está guardado") || len(m.Days) != 1 {
		t.Errorf("token inválido: %q %q", m.WarningCode, m.Warning)
	}
	if got := f.calls.Load(); got > exchangeFetchWorkers+1 {
		t.Errorf("con el token rechazado debía detenerse enseguida, hizo %d llamadas", got)
	}

	// Límite del plan.
	f.status = http.StatusTooManyRequests
	if m, _ = svc.Month(2026, 10, "USD", true); m.WarningCode != ExchangeWarnLimit {
		t.Errorf("límite: %q", m.WarningCode)
	}
}

func TestExchangeMonth_validaLosDatos(t *testing.T) {
	f := newFakeApiPeru(t)
	svc := newExchangeTest(t, f, "tok")
	for _, c := range []struct {
		y, m int
		cur  string
	}{{2026, 13, "USD"}, {2026, 0, "USD"}, {2003, 5, "USD"}, {2028, 1, "USD"}, {2026, 10, "GBP"}} {
		if _, err := svc.Month(c.y, c.m, c.cur, true); err == nil {
			t.Errorf("%v debía fallar", c)
		}
	}
	if f.calls.Load() != 0 {
		t.Error("los datos inválidos no consultan")
	}
}

func TestExchangeRate_unaFechaSueltaUsaLaBaseYLaGuarda(t *testing.T) {
	f := newFakeApiPeru(t)
	svc := newExchangeTest(t, f, "tok")
	r, err := svc.Rate("USD", "2026-10-03")
	if err != nil || r.Buy != 3.403 || f.calls.Load() != 1 {
		t.Fatalf("primera vez: %+v %v llamadas=%d", r, err, f.calls.Load())
	}
	if r2, err := svc.Rate("USD", "2026-10-03"); err != nil || r2.Sell != 3.409 || f.calls.Load() != 1 {
		t.Fatalf("la segunda sale de la base: %+v %v llamadas=%d", r2, err, f.calls.Load())
	}
	if _, err := svc.Rate("USD", "03/10/2026"); err == nil {
		t.Error("fecha inválida debía fallar")
	}
}
