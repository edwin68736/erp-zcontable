package services

import (
	"net/http"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
)

// fakeCpe simula api-cpe reutilizando el token falso de fakeSire.
func fakeCpeSession(t *testing.T, f *fakeSire, handler func(w http.ResponseWriter, r *http.Request)) *SireSession {
	t.Helper()
	f.srv.Config.Handler.(*http.ServeMux).HandleFunc("/v1/contribuyente/controlcpe/comprobantesext", handler)
	ss := f.session(t, 7)
	ss.svc.cpeBase = f.srv.URL
	return ss
}

func TestRhe_RangoSeTrocea_EnVentanasDe15Dias_YPaginas(t *testing.T) {
	f := newFakeSire(t)
	var mu sync.Mutex
	var calls []string
	var hits int32
	ss := fakeCpeSession(t, f, func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hits, 1)
		q := r.URL.Query()
		mu.Lock()
		calls = append(calls, q.Get("fecInicio")+".."+q.Get("fecFin")+"/"+q.Get("codEstado")+"/p"+q.Get("numPag"))
		mu.Unlock()
		if r.Header.Get("Authorization") == "" || q.Get("codCpe") != "02" || q.Get("indTipoPedido") != "C" || q.Get("numRegPag") != "100" {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		if q.Get("codEstado") == "01" && q.Get("fecInicio") == "2026-10-01" {
			// 150 registros → dos páginas de 100
			var b strings.Builder
			n := 100
			if q.Get("numPag") == "2" {
				n = 50
			}
			b.WriteString(`{"numTotalReg":150,"numPag":` + q.Get("numPag") + `,"numRegPag":100,"comprobantes":[`)
			for i := 0; i < n; i++ {
				if i > 0 {
					b.WriteString(",")
				}
				num := i
				if q.Get("numPag") == "2" {
					num += 100
				}
				b.WriteString(`{"numRuc":"10456789012","codCpe":"02","numSerie":"E001","numCpe":` + strconv.Itoa(num) + `,"fecEmision":"2026-10-05T10:00:00.000","mtoTotalRhe":1000.5,"mtoRetencionRhe":80,"mtoTotalNetoRecibidoRhe":"920.50","codMoneda":"PEN"}`)
			}
			b.WriteString(`]}`)
			_, _ = w.Write([]byte(b.String()))
			return
		}
		if q.Get("codEstado") == "03" && q.Get("fecInicio") == "2026-10-16" {
			_, _ = w.Write([]byte(`{"numTotalReg":1,"numPag":1,"numRegPag":100,"comprobantes":[{"numRuc":"10456789012","codCpe":"02","numSerie":"E001","numCpe":"999","fecEmision":"2026-10-20T00:00:00.000","subsanacion":{"fecSubsanacion":"2026-10-25T00:00:00.000","notasCpe":[{"codCpe":"R7","numSerie":"ER01","numCpe":3,"motivos":["1",2],"comentario":"ok"}]}}]}`))
			return
		}
		_, _ = w.Write([]byte(`{"numTotalReg":0,"numPag":1,"numRegPag":100,"comprobantes":[]}`))
	})

	res, err := ss.RheList(RheQuery{Tipo: "C", Desde: "2026-10-01", Hasta: "2026-10-31"})
	if err != nil {
		t.Fatalf("RheList: %v", err)
	}
	if res.Total != 151 || len(res.Items) != 151 {
		t.Fatalf("total = %d / %d, quiero 151", res.Total, len(res.Items))
	}
	// 31 días → ventanas 01-15, 16-30, 31-31 × 3 estados = 9 consultas (más la 2.ª página del estado 01).
	if res.Consultas != 9 {
		t.Errorf("consultas = %d, quiero 9", res.Consultas)
	}
	if hits != 10 {
		t.Errorf("llamadas HTTP = %d, quiero 10 (9 + 1 página extra)", hits)
	}
	joined := strings.Join(calls, " ")
	for _, want := range []string{"2026-10-01..2026-10-15/01/p1", "2026-10-01..2026-10-15/01/p2", "2026-10-16..2026-10-30/06/p1", "2026-10-31..2026-10-31/03/p1"} {
		if !strings.Contains(joined, want) {
			t.Errorf("falta la consulta %s en %s", want, joined)
		}
	}
	var sub *RheComprobante
	for i := range res.Items {
		if res.Items[i].Estado == "03" {
			sub = &res.Items[i]
		}
	}
	if sub == nil || sub.Numero != "999" || len(sub.NotasSubsanacion) != 1 || strings.Join(sub.NotasSubsanacion[0].Motivos, ",") != "1,2" {
		t.Fatalf("subsanado mal leído: %+v", sub)
	}
	for _, it := range res.Items {
		if it.Estado == "01" && (it.TotalHonorarios != 1000.5 || it.NetoRecibido != 920.5 || it.Retencion != 80) {
			t.Fatalf("montos mal leídos: %+v", it)
		}
	}
	if f.tokenForm["scope"] != "https://api-cpe.sunat.gob.pe" {
		t.Errorf("scope del token = %q", f.tokenForm["scope"])
	}
	if f.tokenHits != 1 {
		t.Errorf("el token debe pedirse una sola vez: %d", f.tokenHits)
	}
}

func TestRhe_ValidaFiltros(t *testing.T) {
	f := newFakeSire(t)
	ss := fakeCpeSession(t, f, func(w http.ResponseWriter, r *http.Request) {})
	cases := []RheQuery{
		{Tipo: "X", Desde: "2026-10-01", Hasta: "2026-10-02"},
		{Tipo: "C", Desde: "2026-10-10", Hasta: "2026-10-02"},
		{Tipo: "C", Desde: "2026-01-01", Hasta: "2026-12-31"},
		{Tipo: "C", Desde: "ayer", Hasta: "hoy"},
		{Tipo: "V", Desde: "2026-10-01", Hasta: "2026-10-02", Estados: []string{"01"}},
		{Tipo: "C", CodCpe: "03", Desde: "2026-10-01", Hasta: "2026-10-02"},
	}
	for i, q := range cases {
		_, err := ss.RheList(q)
		se, ok := err.(*SireError)
		if !ok || se.Code != SireErrInvalidParams {
			t.Errorf("caso %d: se esperaba parametros_invalidos, hubo %v", i, err)
		}
	}
	if f.tokenHits != 0 {
		t.Errorf("no debe pedir token con filtros inválidos")
	}
}

func TestRhe_ErrorDeSunatMuestraSuMensaje(t *testing.T) {
	f := newFakeSire(t)
	ss := fakeCpeSession(t, f, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnprocessableEntity)
		_, _ = w.Write([]byte(`{"cod":"422","msg":"Unprocessable Entity","errors":[{"codError":"NN3","desError":"Rango máximo de consulta es 15 días"}]}`))
	})
	_, err := ss.RheList(RheQuery{Tipo: "V", Desde: "2026-10-01", Hasta: "2026-10-05"})
	se, ok := err.(*SireError)
	if !ok || se.Code != SireErrValidation || !strings.Contains(se.Message, "Rango máximo") || !strings.Contains(se.Detail, "NN3") {
		t.Fatalf("error = %#v", err)
	}
}
