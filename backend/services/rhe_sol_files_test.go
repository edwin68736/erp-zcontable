package services

import (
	"archive/zip"
	"bytes"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"miappfiber/models"
)

// fakeRheFiles imita el Menú SOL, la búsqueda exacta, el detalle del recibo y sus descargas.
type fakeRheFiles struct {
	srv      *httptest.Server
	searches []map[string]string
	detalles []string
	acciones []string
	sinXML   bool
}

func newFakeRheFiles(t *testing.T) *fakeRheFiles {
	f := &fakeRheFiles{}
	mux := http.NewServeMux()
	mux.HandleFunc("/cl-ti-itmenu/MenuInternet.htm", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			_, _ = io.WriteString(w, "none")
			return
		}
		if r.URL.Query().Get("action") == "execute" {
			http.Redirect(w, r, rheSolFormPath, http.StatusFound)
			return
		}
		_, _ = io.WriteString(w, `<html><script>var subdominio = 'ww1';</script></html>`)
	})
	mux.HandleFunc(rheSolFormPath, func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			_, _ = io.WriteString(w, `<html><title>Consulta</title></html>`)
			return
		}
		r.ParseForm()
		acc := r.PostForm.Get("accion")
		f.acciones = append(f.acciones, acc)
		switch acc {
		case "CapturaCriterioConsulatRec1":
			m := map[string]string{}
			for k := range r.PostForm {
				m[k] = r.PostForm.Get(k)
			}
			f.searches = append(f.searches, m)
			if r.PostForm.Get("num_comprob") == "99" {
				_, _ = io.WriteString(w, `<html>1 a 0 de 0 <b>No se han encontrado registros para los parametros ingresados</b></html>`)
				return
			}
			// Dos filas: el recibo pedido va en la 2.ª posición para comprobar que se elige por su número.
			_, _ = io.WriteString(w, `<html><a href="javascript:escoger(0 )">E001-1</a><a href="javascript:escoger(1 )">E001-`+r.PostForm.Get("num_comprob")+`</a></html>`)
		case "CapturaCriterioConsultaRec2":
			f.detalles = append(f.detalles, r.PostForm.Get("posirecibo"))
			_, _ = io.WriteString(w, `<html><script>function descargaArchivopdf (){ document.lista5.submit(); }</script><input type="hidden" name="accion" value="descargarrecibopdf"></html>`)
		case "descargarrecibopdf":
			w.Header().Set("Content-Type", "application/pdf")
			w.Header().Set("Content-Disposition", `attachment; filename="RHE10737771704E00120.pdf"`)
			_, _ = io.WriteString(w, "%PDF-1.4 recibo")
		case "descargarreciboxml":
			if f.sinXML {
				_, _ = io.WriteString(w, `<html>error</html>`)
				return
			}
			w.Header().Set("Content-Type", "application/xml")
			w.Header().Set("Content-Disposition", `attachment; filename="RHE1073777170420.xml"`)
			_, _ = io.WriteString(w, `<?xml version="1.0"?><Invoice/>`)
		}
	})
	f.srv = httptest.NewServer(mux)
	t.Cleanup(f.srv.Close)
	return f
}

func newRheFilesService(t *testing.T, f *fakeRheFiles) (*RheSolService, models.Company) {
	t.Helper()
	old := rheSolFilePause
	rheSolFilePause = time.Millisecond
	t.Cleanup(func() { rheSolFilePause = old })
	return newRheSolTest(t, &fakeSunatRhe{srv: f.srv})
}

func zipContents(t *testing.T, b []byte) map[string]string {
	t.Helper()
	zr, err := zip.NewReader(bytes.NewReader(b), int64(len(b)))
	if err != nil {
		t.Fatal(err)
	}
	out := map[string]string{}
	for _, f := range zr.File {
		rc, _ := f.Open()
		data, _ := io.ReadAll(rc)
		rc.Close()
		out[f.Name] = string(data)
	}
	return out
}

func TestRheSolFetchFiles_pdfYXmlEnCarpetas(t *testing.T) {
	f := newFakeRheFiles(t)
	svc, co := newRheFilesService(t, f)
	res, err := svc.FetchFiles(co.ID, nil, 1, []RheSolFileRef{{Comprobante: "e001-0020", FecEmision: "2026-10-06", EmisorDoc: "10737771704"}}, []string{"pdf", "xml"})
	if err != nil {
		t.Fatal(err)
	}
	if res.OK != 1 || res.Failed != 0 || res.Files != 2 {
		t.Fatalf("resumen: %+v", res)
	}
	s := f.searches[0]
	if s["num_serie"] != "E001" || s["num_comprob"] != "20" || s["fec_desde"] != "06/10/2026" || s["fec_hasta"] != "06/10/2026" || s["ruc_emisor"] != "10737771704" {
		t.Errorf("la búsqueda debe ser exacta: %v", s)
	}
	if len(f.detalles) != 1 || f.detalles[0] != "1" {
		t.Errorf("debía abrir la fila del recibo pedido (posición 1): %v", f.detalles)
	}
	files := zipContents(t, res.Zip)
	if files["PDF/RHE10737771704E00120.pdf"] != "%PDF-1.4 recibo" || !strings.HasPrefix(files["XML/RHE1073777170420.xml"], "<?xml") || len(files) != 2 {
		t.Errorf("zip: %v", files)
	}
}

func TestRheSolFetchFiles_soloPdfYRecibosQueFallan(t *testing.T) {
	f := newFakeRheFiles(t)
	svc, co := newRheFilesService(t, f)
	res, err := svc.FetchFiles(co.ID, nil, 1, []RheSolFileRef{
		{Comprobante: "E001-20", FecEmision: "2026-10-06", EmisorDoc: "10737771704"},
		{Comprobante: "E001-99", FecEmision: "2026-10-07", EmisorDoc: "10737771704"},
	}, []string{"pdf"})
	if err != nil {
		t.Fatal(err)
	}
	if res.OK != 1 || res.Failed != 1 || len(res.Errors) != 1 || !strings.Contains(res.Errors[0], "E001-99") {
		t.Fatalf("resumen: %+v", res)
	}
	for _, a := range f.acciones {
		if a == "descargarreciboxml" {
			t.Error("no debía pedir el XML")
		}
	}
	files := zipContents(t, res.Zip)
	if !strings.Contains(files["errores.txt"], "E001-99") {
		t.Errorf("el ZIP debe listar lo que falló: %v", files)
	}
}

func TestRheSolFetchFiles_faltaUnArchivoNoEsFallo(t *testing.T) {
	f := newFakeRheFiles(t)
	f.sinXML = true
	svc, co := newRheFilesService(t, f)
	res, err := svc.FetchFiles(co.ID, nil, 1, []RheSolFileRef{{Comprobante: "E001-20", FecEmision: "2026-10-06", EmisorDoc: "10737771704"}}, []string{"pdf", "xml"})
	if err != nil || res.OK != 1 || res.Files != 1 || len(res.Errors) != 1 || !strings.Contains(res.Errors[0], "XML") {
		t.Fatalf("un XML que falta no anula el PDF: %+v %v", res, err)
	}
}

func TestRheSolFetchFiles_validaciones(t *testing.T) {
	f := newFakeRheFiles(t)
	svc, co := newRheFilesService(t, f)
	ok := RheSolFileRef{Comprobante: "E001-20", FecEmision: "2026-10-06", EmisorDoc: "10737771704"}
	cases := map[string]struct {
		refs  []RheSolFileRef
		kinds []string
	}{
		"sin formatos":     {[]RheSolFileRef{ok}, nil},
		"formato inválido": {[]RheSolFileRef{ok}, []string{"txt"}},
		"sin recibos":      {nil, []string{"pdf"}},
		"comprobante malo": {[]RheSolFileRef{{Comprobante: "20", FecEmision: "2026-10-06", EmisorDoc: "10737771704"}}, []string{"pdf"}},
		"fecha mala":       {[]RheSolFileRef{{Comprobante: "E001-20", FecEmision: "06/10/2026", EmisorDoc: "10737771704"}}, []string{"pdf"}},
		"emisor malo":      {[]RheSolFileRef{{Comprobante: "E001-20", FecEmision: "2026-10-06", EmisorDoc: "12"}}, []string{"pdf"}},
	}
	for name, c := range cases {
		if _, err := svc.FetchFiles(co.ID, nil, 1, c.refs, c.kinds); err == nil {
			t.Errorf("%s: debía rechazarse", name)
		}
	}
	if len(f.searches) != 0 {
		t.Error("los pedidos inválidos no deben llegar a SUNAT")
	}
	many := make([]RheSolFileRef, rheSolMaxFileRefs+1)
	for i := range many {
		many[i] = ok
	}
	if _, err := svc.FetchFiles(co.ID, nil, 1, many, []string{"pdf"}); err == nil {
		t.Error("más del tope debía rechazarse")
	}
}
