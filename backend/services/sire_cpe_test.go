package services

import (
	"archive/zip"
	"bytes"
	"encoding/base64"
	"strings"
	"sync"
	"testing"
	"time"

	"miappfiber/database"
	"miappfiber/models"

	"github.com/xuri/excelize/v2"
)

// fakeCpeConsulta responde como el servicio de comprobantes de SUNAT: GET {ruc-tipo-serie-numero-filtro}/{archivo}.
type fakeCpeConsulta struct {
	mu      sync.Mutex
	calls   []string
	closed  bool
	respond func(path string) (int, []byte)
}

func (f *fakeCpeConsulta) get(u string) (int, []byte, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	p := strings.TrimPrefix(u, cpeConsultaBase)
	f.calls = append(f.calls, p)
	st, b := f.respond(p)
	return st, b, nil
}
func (f *fakeCpeConsulta) close() { f.mu.Lock(); f.closed = true; f.mu.Unlock() }

func cpeZipJSON(t *testing.T, name, content string) []byte {
	t.Helper()
	var buf bytes.Buffer
	w := zip.NewWriter(&buf)
	fw, _ := w.Create(name)
	_, _ = fw.Write([]byte(content))
	_ = w.Close()
	return []byte(`{"nomArchivo":"x.zip","valArchivo":"` + base64.StdEncoding.EncodeToString(buf.Bytes()) + `"}`)
}

func cpeSetup(t *testing.T, sess *fakeCpeConsulta) (*SireCpeService, uint) {
	t.Helper()
	db := setupCompanyRucTestDB(t)
	if err := db.AutoMigrate(&models.CompanyAccessCredential{}, &models.CompanyAccessLog{}, &models.SireDownload{}, &models.SireCpeFile{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	if sqlDB, err := db.DB(); err == nil {
		sqlDB.SetMaxOpenConns(1)
	}
	old := cpePauseBetween
	cpePauseBetween = time.Millisecond
	t.Cleanup(func() { cpePauseBetween = old })
	co := models.Company{RUC: "20123456789", BusinessName: "Empresa SAC", Status: "activo", ClientType: models.CompanyClientTypeEstudio}
	if err := db.Create(&co).Error; err != nil {
		t.Fatal(err)
	}
	svc := NewSireCpeService()
	svc.openFn = func(uint, []uint, uint) (cpeSession, error) { return sess, nil }
	return svc, co.ID
}

func cpeWait(t *testing.T, companyID uint) []models.SireCpeFile {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		var n int64
		database.DB.Model(&models.SireCpeFile{}).Where("company_id = ? AND status = ?", companyID, models.SireCpeProcessing).Count(&n)
		if n == 0 {
			var rows []models.SireCpeFile
			database.DB.Where("company_id = ?", companyID).Order("id").Find(&rows)
			return rows
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("la descarga no terminó")
	return nil
}

func TestCpe_NormalizaYValida(t *testing.T) {
	r, err := normalizeCpeRef(CpeRef{Ruc: " 20610043098 ", Tipo: "1", Serie: "ff01", Numero: "00000060"})
	if err != nil || r.Tipo != "01" || r.Serie != "FF01" || r.Numero != "60" {
		t.Fatalf("normalizar: %+v %v", r, err)
	}
	for _, bad := range []CpeRef{
		{Ruc: "123", Tipo: "01", Serie: "F001", Numero: "1"},
		{Ruc: "20610043098", Tipo: "12", Serie: "F001", Numero: "1"},
		{Ruc: "20610043098", Tipo: "01", Serie: "F1", Numero: "1"},
		{Ruc: "20610043098", Tipo: "01", Serie: "F001", Numero: "0"},
		{Ruc: "20610043098", Tipo: "01", Serie: "F001", Numero: "12a"},
	} {
		if _, err := normalizeCpeRef(bad); err == nil {
			t.Errorf("debía rechazar %+v", bad)
		}
	}
}

func TestCpe_BajaLosTresArchivos(t *testing.T) {
	sess := &fakeCpeConsulta{respond: func(p string) (int, []byte) {
		switch {
		case strings.HasSuffix(p, "/01"):
			return 200, cpeZipJSON(t, "a.pdf", "%PDF-1.4 fake")
		case strings.HasSuffix(p, "/02"):
			return 200, cpeZipJSON(t, "a.xml", "<Invoice/>")
		default:
			return 200, cpeZipJSON(t, "R-a.xml", "<ApplicationResponse/>")
		}
	}}
	svc, cid := cpeSetup(t, sess)
	// Una factura emitida por la propia empresa (filtro 1) y una recibida de otro RUC (filtro 2).
	res, err := svc.Start(cid, nil, 1, []CpeRef{
		{Ruc: "20123456789", Tipo: "01", Serie: "FF01", Numero: "00000060"},
		{Ruc: "20604778191", Tipo: "1", Serie: "E001", Numero: "517"},
	})
	if err != nil || len(res.Items) != 2 {
		t.Fatalf("Start: %v %+v", err, res)
	}
	rows := cpeWait(t, cid)
	if len(rows) != 2 {
		t.Fatalf("filas: %d", len(rows))
	}
	for _, r := range rows {
		if r.Status != models.SireCpeReady || !r.HasPDF || !r.HasXML || !r.HasCDR {
			t.Fatalf("estado: %+v", r)
		}
	}
	if string(rows[0].PDF) != "%PDF-1.4 fake" || string(rows[0].XML) != "<Invoice/>" || string(rows[0].CDR) != "<ApplicationResponse/>" {
		t.Errorf("contenido sin descomprimir mal: %q %q %q", rows[0].PDF, rows[0].XML, rows[0].CDR)
	}
	if rows[0].Lado != "emisor" || rows[1].Lado != "receptor" {
		t.Errorf("lados: %s %s", rows[0].Lado, rows[1].Lado)
	}
	joined := strings.Join(sess.calls, " ")
	for _, want := range []string{"20123456789-01-FF01-60-1/01", "20604778191-01-E001-517-2/03"} {
		if !strings.Contains(joined, want) {
			t.Errorf("falta el pedido %s en %s", want, joined)
		}
	}
	if !sess.closed {
		t.Error("la sesión SOL debe cerrarse al terminar")
	}

	// Lo que ya está bajado no se vuelve a pedir.
	n := len(sess.calls)
	res2, err := svc.Start(cid, nil, 1, []CpeRef{{Ruc: "20123456789", Tipo: "01", Serie: "FF01", Numero: "60"}})
	if err != nil || res2.Ready != 1 {
		t.Fatalf("segunda vez: %v %+v", err, res2)
	}
	time.Sleep(50 * time.Millisecond)
	if len(sess.calls) != n {
		t.Errorf("no debía consultar otra vez: %d → %d", n, len(sess.calls))
	}

	// ZIP con los tres archivos de cada comprobante.
	zdata, count, err := svc.Zip(cid, nil, "", "")
	if err != nil || count != 2 {
		t.Fatalf("Zip: %v %d", err, count)
	}
	zr, _ := zip.NewReader(bytes.NewReader(zdata), int64(len(zdata)))
	if len(zr.File) != 6 {
		t.Errorf("el ZIP trae %d archivos, quiero 6", len(zr.File))
	}
	if _, name, _, ferr := svc.File(cid, rows[0].ID, "cdr"); ferr != nil || name != "R-20123456789-01-FF01-00000060.xml" {
		t.Errorf("nombre del CDR: %q %v", name, ferr)
	}
}

func TestCpe_SinArchivosYReintento(t *testing.T) {
	sess := &fakeCpeConsulta{respond: func(p string) (int, []byte) {
		return 422, []byte(`{"cod":"422","errors":[{"codError":"113","desError":"El comprobante no existe"}]}`)
	}}
	svc, cid := cpeSetup(t, sess)
	if _, err := svc.Start(cid, nil, 1, []CpeRef{{Ruc: "20604778191", Tipo: "01", Serie: "E001", Numero: "9"}}); err != nil {
		t.Fatal(err)
	}
	rows := cpeWait(t, cid)
	if rows[0].Status != models.SireCpeMissing || !strings.Contains(rows[0].ErrorMessage, "no existe") {
		t.Fatalf("sin_cpe esperado: %+v", rows[0])
	}
	// Pedirlo de nuevo lo reintenta (ahora sí existe).
	sess.mu.Lock()
	sess.respond = func(p string) (int, []byte) { return 200, cpeZipJSON(t, "a.xml", "<Invoice/>") }
	sess.mu.Unlock()
	if _, err := svc.Start(cid, nil, 1, []CpeRef{{Ruc: "20604778191", Tipo: "01", Serie: "E001", Numero: "9"}}); err != nil {
		t.Fatal(err)
	}
	rows = cpeWait(t, cid)
	if len(rows) != 1 || rows[0].Status != models.SireCpeReady || !rows[0].HasXML {
		t.Fatalf("reintento: %+v", rows)
	}
}

func TestCpe_TokenVencidoAbreOtraSesion(t *testing.T) {
	first := true
	opens := 0
	sess := &fakeCpeConsulta{}
	sess.respond = func(p string) (int, []byte) {
		if first {
			first = false
			return 401, []byte(`{}`)
		}
		return 200, cpeZipJSON(t, "a.xml", "<Invoice/>")
	}
	svc, cid := cpeSetup(t, sess)
	svc.openFn = func(uint, []uint, uint) (cpeSession, error) { opens++; return sess, nil }
	if _, err := svc.Start(cid, nil, 1, []CpeRef{{Ruc: "20604778191", Tipo: "01", Serie: "E001", Numero: "9"}}); err != nil {
		t.Fatal(err)
	}
	rows := cpeWait(t, cid)
	if rows[0].Status != models.SireCpeReady || opens != 2 {
		t.Fatalf("token vencido: estado %s, sesiones abiertas %d", rows[0].Status, opens)
	}
}

func TestCpe_FallaAlEntrarASOL(t *testing.T) {
	svc, cid := cpeSetup(t, &fakeCpeConsulta{})
	svc.openFn = func(uint, []uint, uint) (cpeSession, error) {
		return nil, accessErr(SunatAccessUnavailable, "No se pudo conectar con SUNAT. Intente de nuevo en unos minutos.", "x")
	}
	if _, err := svc.Start(cid, nil, 1, []CpeRef{{Ruc: "20604778191", Tipo: "01", Serie: "E001", Numero: "9"}}); err != nil {
		t.Fatal(err)
	}
	rows := cpeWait(t, cid)
	if rows[0].Status != models.SireCpeFailed || !strings.Contains(rows[0].ErrorMessage, "No se pudo conectar") {
		t.Fatalf("error esperado: %+v", rows[0])
	}
	if rows[0].FinishedAt == nil {
		t.Error("debe quedar con fecha de fin")
	}
}

func TestCpe_RefsDesdeExcelDeCompras(t *testing.T) {
	cols := []string{"Ruc", "Tipo CP/Doc.", "Serie del CDP", "Nro CP o Doc. Nro Inicial (Rango)", "Nro Final (Rango)", "Tipo Doc Identidad", "Nro Doc Identidad"}
	data := [][]string{
		{"20123456789", "1", "E001", "516", "", "6", "20510931514"},      // factura
		{"20123456789", "7", "FF01", "00000003", "", "6", "20604778191"}, // nota de crédito
		{"20123456789", "12", "0001", "5", "", "6", "20604778191"},       // ticket: no descargable
		{"20123456789", "3", "B001", "1", "50", "1", "00000000"},         // boletas por rango
		{"20123456789", "1", "F001", "7", "", "1", "12345678"},           // emisor sin RUC
	}
	f := excelize.NewFile()
	sh := f.GetSheetName(0)
	for i, c := range cols {
		cell, _ := excelize.CoordinatesToCellName(i+1, 1)
		_ = f.SetCellValue(sh, cell, c)
	}
	for r, row := range data {
		for i, v := range row {
			cell, _ := excelize.CoordinatesToCellName(i+1, r+2)
			_ = f.SetCellValue(sh, cell, v)
		}
	}
	buf, _ := f.WriteToBuffer()
	refs, skipped, err := cpeRefsFromExcel(buf.Bytes(), sireLibroCompras, "202610", "20123456789")
	if err != nil || len(refs) != 2 || skipped != 3 {
		t.Fatalf("compras: %v refs=%+v skipped=%d", err, refs, skipped)
	}
	if refs[0].Ruc != "20510931514" || refs[0].Tipo != "01" || refs[0].Numero != "516" || refs[1].Tipo != "07" || refs[1].Numero != "3" {
		t.Errorf("refs: %+v", refs)
	}
	// En ventas el emisor es la propia empresa.
	refs, _, err = cpeRefsFromExcel(buf.Bytes(), sireLibroVentas, "202610", "20123456789")
	if err != nil || refs[0].Ruc != "20123456789" {
		t.Fatalf("ventas: %v %+v", err, refs)
	}
}
