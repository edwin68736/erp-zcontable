package services

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

const bcrpSample = `{"config":{"title":"Tipo de cambio"},"periods":[
{"name":"05.Nov.26","values":["3.44685714285714","3.44871428571429"]},
{"name":"06.Nov.26","values":["3.42728571428571","3.42857142857143"]},
{"name":"02.Nov.26","values":["3.45885714285714","3.46057142857143"]},
{"name":"09.Nov.26","values":["n.d.","n.d."]},
{"name":"10.Nov.26","values":["n.d.","n.d."]},
{"name":"15.Set.26","values":["3.40","3.41"]}]}`

const spotSample = `{"result":"success","time_last_update_unix":1783641600,"time_last_update_utc":"Tue, 10 Nov 2026 00:02:31 +0000","rates":{"USD":1,"PEN":3.421491}}`

// Forma real de la respuesta de Yahoo Finance (cierres diarios; un día sin cierre viene como null).
const yahooSample = `{"chart":{"result":[{"meta":{"currency":"PEN","regularMarketPrice":3.4149,"regularMarketTime":1794330157},
"timestamp":[1793836800,1793923200,1794009600,1794096000,1794182400],
"indicators":{"quote":[{"close":[3.459,3.3461,null,3.3464,3.4149]}]}}],"error":null}}`

func newMarketTest(t *testing.T, yahoo, spot, bcrp http.HandlerFunc) (*ExchangeMarketService, *int32) {
	var nYahoo int32
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasPrefix(r.URL.Path, "/yahoo"):
			atomic.AddInt32(&nYahoo, 1)
			yahoo(w, r)
		case strings.HasPrefix(r.URL.Path, "/spot"):
			spot(w, r)
		default:
			bcrp(w, r)
		}
	}))
	t.Cleanup(ts.Close)
	s := NewExchangeMarketService()
	s.yahooURL, s.spotURL, s.bcrpURL = ts.URL+"/yahoo", ts.URL+"/spot", ts.URL+"/bcrp/%s/%s"
	s.now = func() time.Time { return time.Date(2026, 11, 10, 12, 0, 0, 0, time.UTC) }
	return s, &nYahoo
}

func ok(body string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte(body)) }
}
func fail(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusInternalServerError) }

func TestParseBCRPDay(t *testing.T) {
	for in, want := range map[string]string{"12.Oct.26": "2026-10-12", "01.Ene.27": "2027-01-01", "30.Set.26": "2026-09-30", "30.Sep.26": "2026-09-30", "03.Dic.25": "2025-12-03"} {
		if got, okk := parseBCRPDay(in); !okk || got != want {
			t.Errorf("%q → %q (%v), quería %q", in, got, okk, want)
		}
	}
	for _, in := range []string{"", "12-Oct-26", "xx.Oct.26", "12.Foo.26", "40.Oct.26"} {
		if _, okk := parseBCRPDay(in); okk {
			t.Errorf("%q no debía interpretarse", in)
		}
	}
}

func TestMarket_yahooEsLaFuentePrincipal(t *testing.T) {
	s, _ := newMarketTest(t, ok(yahooSample), fail, fail)
	r, err := s.Get()
	if err != nil {
		t.Fatal(err)
	}
	if r.Spot == nil || r.Spot.Rate != 3.4149 || r.Spot.Source != marketSrcYahoo || r.SeriesSource != marketSrcYahoo || len(r.Warnings) != 0 {
		t.Fatalf("spot/fuente/avisos: %+v %q %v", r.Spot, r.SeriesSource, r.Warnings)
	}
	// 5 días, uno sin cierre (null) → 4 puntos, del más antiguo al más reciente.
	if len(r.Series) != 4 || r.Series[0].Value != 3.459 || r.Series[3].Value != 3.4149 || r.Series[0].Date >= r.Series[3].Date {
		t.Errorf("serie: %+v", r.Series)
	}
}

func TestMarket_respaldoSiYahooCae(t *testing.T) {
	s, _ := newMarketTest(t, fail, ok(spotSample), ok(bcrpSample))
	r, err := s.Get()
	if err != nil {
		t.Fatal(err)
	}
	if r.Spot == nil || r.Spot.Rate != 3.4215 || r.Spot.Source != marketSrcER || r.SeriesSource != marketSrcBCRP || len(r.Warnings) != 1 {
		t.Fatalf("respaldo: %+v %q %v", r.Spot, r.SeriesSource, r.Warnings)
	}
	// 4 días con dato (los «n.d.» se omiten), ordenados.
	if len(r.Series) != 4 || r.Series[0].Date != "2026-09-15" || r.Series[3].Date != "2026-11-06" || r.Series[3].Value != 3.4279 {
		t.Errorf("serie BCRP: %+v", r.Series)
	}
	// Sin open.er-api, el valor principal es el último día del BCRP.
	s2, _ := newMarketTest(t, fail, fail, ok(bcrpSample))
	r2, err := s2.Get()
	if err != nil || r2.Spot == nil || r2.Spot.Source != marketSrcBCRP || r2.Spot.Rate != 3.4279 {
		t.Fatalf("solo BCRP: %+v %v", r2, err)
	}
}

func TestMarket_cacheYFalloTotal(t *testing.T) {
	s, nYahoo := newMarketTest(t, ok(yahooSample), fail, fail)
	if _, err := s.Get(); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Get(); err != nil || *nYahoo != 1 {
		t.Fatalf("la segunda lectura sale de la memoria: yahoo=%d %v", *nYahoo, err)
	}
	// Pasado el tiempo, si caen todas las fuentes se devuelve lo guardado con aviso.
	later := s.now().Add(2 * time.Hour)
	s.now = func() time.Time { return later }
	s.yahooURL, s.spotURL, s.bcrpURL = "http://127.0.0.1:1/y", "http://127.0.0.1:1/s", "http://127.0.0.1:1/%s/%s"
	r, err := s.Get()
	if err != nil || r.Spot == nil || len(r.Warnings) == 0 {
		t.Fatalf("debía devolver lo último guardado con aviso: %+v %v", r, err)
	}
	// Sin nada guardado y sin fuentes: error.
	s3 := NewExchangeMarketService()
	s3.yahooURL, s3.spotURL, s3.bcrpURL = "http://127.0.0.1:1/y", "http://127.0.0.1:1/s", "http://127.0.0.1:1/%s/%s"
	if _, err := s3.Get(); err == nil {
		t.Error("sin fuentes ni memoria debía fallar")
	}
}

func TestMarket_yahooConMonedaInesperadaSeDescarta(t *testing.T) {
	bad := strings.Replace(yahooSample, `"currency":"PEN"`, `"currency":"USD"`, 1)
	s, _ := newMarketTest(t, ok(bad), ok(spotSample), ok(bcrpSample))
	r, err := s.Get()
	if err != nil || r.Spot.Source != marketSrcER {
		t.Fatalf("con otra moneda debía usar el respaldo: %+v %v", r, err)
	}
}
