package services

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"miappfiber/models"

	"gorm.io/gorm"
)

// fakeSol simula el menú SOL y el visor del buzón.
type fakeSol struct {
	srv        *httptest.Server
	loginCalls int32
	logouts    int32 // prevApp + cierre de la aplicación + salir
	listCalls  int32
	notis      [][]string // páginas de filas JSON de notificaciones
	msgs       [][]string
}

func solRow(cod int, tipo int, asunto string, estado int, urg int, etiqueta string) string {
	return fmt.Sprintf(`{"codMensaje":%d,"indEstado":%d,"indDesta":0,"indUrg":%d,"indTipmsj":%d,"desAsunto":%q,"fecPublica":"26/10/2026 18:38:35","fecEnvio":"26/10/2026","codUsremisor":"SUNAT","codDepen":null,"cantidadArchAdj":1,"codEtiqueta":%q}`,
		cod, estado, urg, tipo, asunto, etiqueta)
}

func newFakeSol(t *testing.T) *fakeSol {
	t.Helper()
	f := &fakeSol{}
	mux := http.NewServeMux()
	mux.HandleFunc("/cl-ti-itmenu/MenuInternet.htm", func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.FormValue("action") == "prevApp":
			atomic.AddInt32(&f.logouts, 1)
			_, _ = w.Write([]byte(f.srv.URL + "/cierra-app"))
		case r.Method == http.MethodPost && r.FormValue("action") == "salir":
			atomic.AddInt32(&f.logouts, 1)
		case r.URL.Query().Get("action") == "buzon":
			http.Redirect(w, r, "/ol-ti-itvisornoti/visor/master", http.StatusFound)
		default:
			_, _ = w.Write([]byte(`<html><script>var subdominio="ww1";</script>MenuInternet</html>`))
		}
	})
	mux.HandleFunc("/cierra-app", func(w http.ResponseWriter, r *http.Request) { atomic.AddInt32(&f.logouts, 1) })
	mux.HandleFunc("/ol-ti-itvisornoti/visor/master", func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`<html><head><meta name="meta-token" content="TOK123"/></head></html>`))
	})
	mux.HandleFunc("/ol-ti-itvisornoti/visor/listNotiMenPag", func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&f.listCalls, 1)
		if r.Header.Get("X-Ruc") != "TOK123" {
			w.WriteHeader(http.StatusForbidden)
			return
		}
		pages := f.notis
		if r.URL.Query().Get("tipoMsj") == "1" {
			pages = f.msgs
		}
		pg := 1
		_, _ = fmt.Sscanf(r.URL.Query().Get("page"), "%d", &pg)
		rows := ""
		if pg <= len(pages) {
			rows = strings.Join(pages[pg-1], ",")
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = fmt.Fprintf(w, `{"total":%d,"records":0,"rows":[%s]}`, len(pages), rows)
	})
	f.srv = httptest.NewServer(mux)
	t.Cleanup(f.srv.Close)
	return f
}

func buzonTestService(t *testing.T, f *fakeSol) (*SunatBuzonService, *gorm.DB) {
	t.Helper()
	db := setupCompanyRucTestDB(t)
	if err := db.AutoMigrate(&models.CompanyAccessCredential{}, &models.CompanyAccessLog{}, &models.SunatBuzonMessage{}, &models.SunatBuzonSync{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	svc := NewSunatBuzonService()
	svc.loginFn = func(ruc, usuario, clave string) (string, error) {
		atomic.AddInt32(&f.loginCalls, 1)
		return f.srv.URL + "/cl-ti-itmenu/MenuInternet.htm?token=unico", nil
	}
	return svc, db
}

func buzonCompany(t *testing.T, db *gorm.DB, ruc, usuario, clave string) uint {
	t.Helper()
	co := models.Company{RUC: ruc, BusinessName: "Empresa " + ruc, Status: "activo", ClientType: models.CompanyClientTypeEstudio}
	if err := db.Create(&co).Error; err != nil {
		t.Fatalf("company: %v", err)
	}
	if usuario != "" || clave != "" {
		if err := db.Create(&models.CompanyAccessCredential{CompanyID: co.ID, SolUsuario: usuario, SolClave: clave}).Error; err != nil {
			t.Fatalf("cred: %v", err)
		}
	}
	return co.ID
}

func TestBuzon_PrimeraSincronizacionGuardaTodoYCierraSesion(t *testing.T) {
	f := newFakeSol(t)
	f.notis = [][]string{{solRow(1001, 2, "Notificación de Orden de Pago N° 1", 1, 1, "10"), solRow(1002, 2, "Notificación B", 1, 0, "11")}, {solRow(1003, 2, "Notificación C", 0, 0, "00")}}
	f.msgs = [][]string{{solRow(2001, 1, "ASUNTO: NotificaciÃ³n de ResoluciÃ³n", 0, 0, "00")}}
	svc, db := buzonTestService(t, f)
	id := buzonCompany(t, db, "20111111111", "USER", "clave")

	st, err := svc.SyncCompany(id, nil, BuzonSourceManual, 7, false)
	if err != nil {
		t.Fatalf("SyncCompany: %v", err)
	}
	if st.Status != models.SunatBuzonStatusOK || st.Notificaciones != 3 || st.Mensajes != 1 || st.NoLeidas != 2 || st.Urgentes != 0 || st.Nuevos != 0 {
		t.Fatalf("estado: %+v", st)
	}
	if f.logouts != 3 {
		t.Errorf("debe cerrar la aplicación y la sesión: %d cierres", f.logouts)
	}
	page, _ := svc.Messages(id, BuzonFilter{})
	if page.Total != 4 {
		t.Fatalf("total = %d", page.Total)
	}
	var m models.SunatBuzonMessage
	db.Where("cod_mensaje = ?", 2001).First(&m)
	if m.Asunto != "ASUNTO: Notificación de Resolución" || m.Tipo != 1 || m.Leido || m.FecPublica == nil || m.FecPublica.Format("2006-01-02 15:04") != "2026-10-26 18:38" || m.Raw == "" {
		t.Errorf("mensaje guardado: %+v", m)
	}
	var o models.SunatBuzonMessage
	db.Where("cod_mensaje = ?", 1001).First(&o)
	if !o.Urgente || !o.Leido || o.CodEtiqueta != "10" || o.Adjuntos != 1 {
		t.Errorf("notificación guardada: %+v", o)
	}
	var logs int64
	db.Model(&models.CompanyAccessLog{}).Where("target = ? AND status = ? AND user_id = ?", "buzon", "ok", 7).Count(&logs)
	if logs != 1 {
		t.Errorf("bitácora: %d", logs)
	}
}

func TestBuzon_SegundaSincronizacionMarcaNuevosYRetirados(t *testing.T) {
	f := newFakeSol(t)
	f.notis = [][]string{{solRow(1001, 2, "A", 0, 0, "10"), solRow(1002, 2, "B", 1, 0, "10")}}
	f.msgs = [][]string{{solRow(2001, 1, "M", 0, 0, "00")}}
	svc, db := buzonTestService(t, f)
	id := buzonCompany(t, db, "20111111111", "USER", "clave")
	if _, err := svc.SyncCompany(id, nil, BuzonSourceManual, 1, false); err != nil {
		t.Fatal(err)
	}

	// SUNAT: A pasa a leída, llega una nueva (1003, urgente) y el mensaje 2001 desaparece.
	f.notis = [][]string{{solRow(1003, 2, "Nueva", 0, 1, "11"), solRow(1001, 2, "A", 1, 0, "10"), solRow(1002, 2, "B", 1, 0, "10")}}
	f.msgs = nil
	st, err := svc.SyncCompany(id, nil, BuzonSourceNightly, 0, true)
	if err != nil {
		t.Fatal(err)
	}
	if st.Nuevos != 1 || st.Notificaciones != 3 || st.Mensajes != 0 || st.NoLeidas != 1 || st.Urgentes != 1 || st.Source != BuzonSourceNightly {
		t.Fatalf("estado: %+v", st)
	}
	nuevos, _ := svc.Messages(id, BuzonFilter{OnlyNew: true})
	if nuevos.Total != 1 || nuevos.Rows[0].CodMensaje != 1003 {
		t.Fatalf("nuevos: %+v", nuevos.Rows)
	}
	var a, m models.SunatBuzonMessage
	db.Where("cod_mensaje = ?", 1001).First(&a)
	db.Where("cod_mensaje = ?", 2001).First(&m)
	if !a.Leido || m.EnBuzon {
		t.Errorf("A leída=%v; mensaje retirado en_buzon=%v", a.Leido, m.EnBuzon)
	}
	if vis, _ := svc.Messages(id, BuzonFilter{}); vis.Total != 3 {
		t.Errorf("el listado solo muestra lo que sigue en el buzón: %d", vis.Total)
	}
	if err := svc.MarkSeen(id); err != nil {
		t.Fatal(err)
	}
	if st := svc.State(id); st.Nuevos != 0 {
		t.Errorf("tras marcar visto: %+v", st)
	}
	if n, _ := svc.Messages(id, BuzonFilter{OnlyNew: true}); n.Total != 0 {
		t.Errorf("quedaron nuevos: %d", n.Total)
	}
	// Filtros.
	if r, _ := svc.Messages(id, BuzonFilter{OnlyUrgent: true}); r.Total != 1 {
		t.Errorf("urgentes: %d", r.Total)
	}
	if r, _ := svc.Messages(id, BuzonFilter{Etiqueta: "11", Q: "nuev"}); r.Total != 1 {
		t.Errorf("etiqueta+texto: %d", r.Total)
	}
}

func TestBuzon_SinClaveNoLlamaASunat(t *testing.T) {
	f := newFakeSol(t)
	svc, db := buzonTestService(t, f)
	id := buzonCompany(t, db, "20111111111", "", "")

	st, err := svc.SyncCompany(id, nil, BuzonSourceManual, 1, false)
	be, ok := err.(*BuzonError)
	if !ok || be.Code != BuzonErrNoKey || st.Status != models.SunatBuzonStatusSinClave {
		t.Fatalf("st=%+v err=%v", st, err)
	}
	if f.loginCalls != 0 {
		t.Errorf("no debe ingresar a SUNAT sin clave")
	}
}

func TestBuzon_CredencialesRechazadasSeDetienenHastaCorregirlas(t *testing.T) {
	f := newFakeSol(t)
	svc, db := buzonTestService(t, f)
	id := buzonCompany(t, db, "20111111111", "USER", "mala")
	svc.loginFn = func(ruc, usuario, clave string) (string, error) {
		atomic.AddInt32(&f.loginCalls, 1)
		if clave == "mala" {
			return "", accessErr(SunatAccessBadCreds, "SUNAT rechazó el usuario o la clave SOL.", "")
		}
		return f.srv.URL + "/cl-ti-itmenu/MenuInternet.htm", nil
	}

	st, err := svc.SyncCompany(id, nil, BuzonSourceManual, 1, false)
	if be, ok := err.(*BuzonError); !ok || be.Code != BuzonErrRejected || st.Status != models.SunatBuzonStatusRechazadas {
		t.Fatalf("1.er intento: st=%+v err=%v", st, err)
	}
	if f.loginCalls != 1 {
		t.Fatalf("logins = %d", f.loginCalls)
	}
	// Mismos datos: no se vuelve a intentar (ni a mano ni en la corrida nocturna).
	if _, err := svc.SyncCompany(id, nil, BuzonSourceManual, 1, false); err == nil || f.loginCalls != 1 {
		t.Fatalf("no debía reintentar: err=%v logins=%d", err, f.loginCalls)
	}
	if sum := svc.RunAll(BuzonSourceNightly); sum.Rechazadas != 1 || sum.OK != 0 || f.loginCalls != 1 {
		t.Fatalf("corrida: %+v logins=%d", sum, f.loginCalls)
	}
	if !svc.State(id).Blocked {
		t.Errorf("con las mismas credenciales debe figurar bloqueada")
	}
	// Corrigen la clave: vuelve a intentar y sale bien.
	db.Model(&models.CompanyAccessCredential{}).Where("company_id = ?", id).Update("sol_clave", "buena")
	if svc.State(id).Blocked {
		t.Errorf("al corregir la clave ya no está bloqueada")
	}
	st, err = svc.SyncCompany(id, nil, BuzonSourceManual, 1, false)
	if err != nil || st.Status != models.SunatBuzonStatusOK || f.loginCalls != 2 {
		t.Fatalf("tras corregir: st=%+v err=%v logins=%d", st, err, f.loginCalls)
	}
}

func TestBuzon_BloqueoTemporalNoDetieneLaEmpresa(t *testing.T) {
	f := newFakeSol(t)
	svc, db := buzonTestService(t, f)
	id := buzonCompany(t, db, "20111111111", "USER", "clave")
	svc.loginFn = func(ruc, usuario, clave string) (string, error) {
		atomic.AddInt32(&f.loginCalls, 1)
		return "", accessErr(SunatAccessLocked, "SUNAT tiene bloqueada temporalmente la autenticación.", "")
	}
	st, _ := svc.SyncCompany(id, nil, BuzonSourceManual, 1, false)
	if st.Status != models.SunatBuzonStatusError || st.ErrorCode != SunatAccessLocked {
		t.Fatalf("st=%+v", st)
	}
	// No queda "rechazada": se puede reintentar.
	if _, err := svc.SyncCompany(id, nil, BuzonSourceManual, 1, false); f.loginCalls != 2 || err == nil {
		t.Fatalf("logins=%d err=%v", f.loginCalls, err)
	}
}

func TestBuzon_UnaEmpresaALaVez(t *testing.T) {
	f := newFakeSol(t)
	svc, db := buzonTestService(t, f)
	a := buzonCompany(t, db, "20111111111", "U1", "c1")
	b := buzonCompany(t, db, "20222222222", "U2", "c2")
	inside, release := make(chan struct{}), make(chan struct{})
	svc.loginFn = func(ruc, usuario, clave string) (string, error) {
		close(inside)
		<-release
		return f.srv.URL + "/cl-ti-itmenu/MenuInternet.htm", nil
	}
	done := make(chan error, 1)
	go func() { _, err := svc.SyncCompany(a, nil, BuzonSourceManual, 1, false); done <- err }()
	<-inside
	if svc.RunningCompany() != a {
		t.Errorf("empresa en curso = %d", svc.RunningCompany())
	}
	_, err := svc.SyncCompany(b, nil, BuzonSourceManual, 2, false)
	if be, ok := err.(*BuzonError); !ok || be.Code != BuzonErrInProgress || !strings.Contains(be.Message, "Empresa 20111111111") {
		t.Fatalf("se esperaba en_curso con el nombre de la empresa: %v", err)
	}
	close(release)
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if svc.RunningCompany() != 0 {
		t.Errorf("debe liberar el candado")
	}
}

func TestBuzon_RunAllResumen(t *testing.T) {
	f := newFakeSol(t)
	f.notis = [][]string{{solRow(1, 2, "A", 0, 0, "10")}}
	svc, db := buzonTestService(t, f)
	buzonCompany(t, db, "20111111111", "U1", "c1")
	buzonCompany(t, db, "20222222222", "", "")
	sum := svc.RunAll(BuzonSourceNightly)
	if sum.Total != 2 || sum.OK != 1 || sum.SinClave != 1 || sum.Errores != 0 || sum.Cortada {
		t.Fatalf("resumen: %+v", sum)
	}
	var sinClave models.SunatBuzonSync
	db.Where("status = ?", models.SunatBuzonStatusSinClave).First(&sinClave)
	if sinClave.ID == 0 {
		t.Errorf("la empresa sin clave debe quedar registrada como «sin clave»")
	}
}

func TestNextDailyRun(t *testing.T) {
	loc, _ := time.LoadLocation("America/Lima")
	at := func(s string) time.Time { tt, _ := time.ParseInLocation("2006-01-02 15:04", s, loc); return tt }
	cases := []struct{ now, want string }{
		{"2026-11-02 00:30", "2026-11-02 01:00"},
		{"2026-11-02 01:00", "2026-11-03 01:00"},
		{"2026-11-02 15:20", "2026-11-03 01:00"},
		{"2026-12-31 23:59", "2027-01-01 01:00"},
	}
	for _, c := range cases {
		if got := nextDailyRun(at(c.now), 1, loc); !got.Equal(at(c.want)) {
			t.Errorf("%s → %s, quiero %s", c.now, got.Format("2006-01-02 15:04"), c.want)
		}
	}
}

func TestFixMojibake(t *testing.T) {
	cases := map[string]string{
		"NotificaciÃ³n de ResoluciÃ³n de ConclusiÃ³n NÂ° 0530": "Notificación de Resolución de Conclusión N° 0530",
		"Notificación correcta N° 5":                           "Notificación correcta N° 5",
		"sin acentos":                                          "sin acentos",
	}
	for in, want := range cases {
		if got := fixMojibake(in); got != want {
			t.Errorf("fixMojibake(%q) = %q", in, got)
		}
	}
}

func TestBuzon_BuzonVacioInesperadoNoBorraLoGuardado(t *testing.T) {
	f := newFakeSol(t)
	f.notis = [][]string{{solRow(1001, 2, "A", 0, 0, "10")}}
	f.msgs = [][]string{{solRow(2001, 1, "M", 0, 0, "00")}}
	svc, db := buzonTestService(t, f)
	id := buzonCompany(t, db, "20111111111", "USER", "clave")
	if _, err := svc.SyncCompany(id, nil, BuzonSourceManual, 1, false); err != nil {
		t.Fatal(err)
	}
	f.notis, f.msgs = nil, nil
	st, err := svc.SyncCompany(id, nil, BuzonSourceManual, 1, false)
	if err == nil || st.Status != models.SunatBuzonStatusError {
		t.Fatalf("debía quedar en error: st=%+v err=%v", st, err)
	}
	if st.Notificaciones != 1 || st.Mensajes != 1 {
		t.Errorf("se conserva el último resultado bueno: %+v", st)
	}
	if page, _ := svc.Messages(id, BuzonFilter{}); page.Total != 2 {
		t.Errorf("lo guardado debe seguir visible: %d", page.Total)
	}
}

func TestParseBuzonHours(t *testing.T) {
	got := parseBuzonHours(" 17, 1 ,8,13,8,25,x,-1,13 ")
	if len(got) != 4 || got[0] != 1 || got[1] != 8 || got[2] != 13 || got[3] != 17 {
		t.Fatalf("horas: %v", got)
	}
	if len(parseBuzonHours("")) != 0 || len(parseBuzonHours("a,b")) != 0 {
		t.Error("sin horas válidas queda vacío")
	}
	if h := parseBuzonHours(buzonDefaultHours); len(h) != 4 || h[0] != 1 {
		t.Errorf("por defecto: %v", h)
	}
}

func TestNextBuzonRun(t *testing.T) {
	loc := time.FixedZone("-05", -5*3600)
	hours := []int{1, 8, 13, 17}
	at := func(h, m int) time.Time { return time.Date(2026, 11, 10, h, m, 0, 0, loc) }
	cases := []struct {
		now      time.Time
		wantHour int
		wantDay  int
	}{
		{at(0, 30), 1, 10},
		{at(1, 0), 8, 10}, // justo a la hora: la siguiente
		{at(9, 15), 13, 10},
		{at(13, 0), 17, 10},
		{at(17, 5), 1, 11}, // pasó la última: la 1:00 de mañana
	}
	for _, c := range cases {
		next, h := nextBuzonRun(c.now, hours, loc)
		if h != c.wantHour || next.Day() != c.wantDay || next.Hour() != c.wantHour {
			t.Errorf("desde %s: %s (hora %d), quería %d:00 del día %d", c.now.Format("15:04"), next.Format("02 15:04"), h, c.wantHour, c.wantDay)
		}
	}
}

// La sincronización manual tiene prioridad sobre una pasada programada: espera su turno (termina la empresa actual) en vez
// de rechazarse con «en curso»; la pasada, a su vez, le cede el paso. Entre dos manuales sigue rechazándose.
func TestBuzon_ManualTienePrioridadSobreLaPasadaProgramada(t *testing.T) {
	f := newFakeSol(t)
	f.notis = [][]string{{solRow(1001, 2, "Notificación A", 0, 0, "10")}}
	svc, db := buzonTestService(t, f)
	id := buzonCompany(t, db, "20111111111", "USER", "clave")

	// Una pasada programada tiene tomado el turno.
	svc.mu.Lock()
	svc.curSource.Store(BuzonSourceScheduled)
	done := make(chan error, 1)
	go func() {
		_, err := svc.SyncCompany(id, nil, BuzonSourceManual, 7, false)
		done <- err
	}()
	deadline := time.Now().Add(2 * time.Second)
	for svc.manualWaiting.Load() == 0 && time.Now().Before(deadline) {
		time.Sleep(5 * time.Millisecond)
	}
	if svc.manualWaiting.Load() != 1 {
		t.Fatalf("la manual debía quedar esperando su turno, esperando=%d", svc.manualWaiting.Load())
	}
	select {
	case err := <-done:
		t.Fatalf("la manual no debía terminar mientras la programada tiene el turno: %v", err)
	case <-time.After(100 * time.Millisecond):
	}
	// Termina la empresa de la pasada programada: la manual sigue y termina bien.
	svc.curSource.Store("")
	svc.mu.Unlock()
	if err := <-done; err != nil {
		t.Fatalf("la manual debía sincronizar: %v", err)
	}
	if svc.manualWaiting.Load() != 0 {
		t.Errorf("nadie debe quedar esperando: %d", svc.manualWaiting.Load())
	}
	if got := svc.State(id); got == nil || got.Source != BuzonSourceManual {
		t.Errorf("estado: %+v", got)
	}
}

func TestBuzon_NotificacionesSinLeerPorAlcance(t *testing.T) {
	f := newFakeSol(t)
	svc, db := buzonTestService(t, f)
	a := buzonCompany(t, db, "20111111111", "USER", "clave")
	b := buzonCompany(t, db, "20222222222", "USER", "clave")
	c := buzonCompany(t, db, "20333333333", "USER", "clave")
	old := time.Date(2026, 10, 1, 9, 0, 0, 0, time.UTC)
	mk := func(company uint, cod uint64, tipo int, leido, urgente, enBuzon bool, pub time.Time) {
		db.Create(&models.SunatBuzonMessage{CompanyID: company, CodMensaje: cod, Tipo: tipo, Asunto: "x", FecPublica: &pub, Leido: leido, Urgente: urgente, EnBuzon: enBuzon, FirstSeenAt: pub, LastSeenAt: pub})
	}
	// Empresa a: 2 notificaciones sin leer (una urgente) + 1 leída + 1 mensaje sin leer + 1 retirada del buzón.
	mk(a, 1, 2, false, true, true, old)
	mk(a, 2, 2, false, false, true, old.Add(48*time.Hour))
	mk(a, 3, 2, true, false, true, old)
	mk(a, 4, 1, false, false, true, old)
	mk(a, 5, 2, false, false, false, old)
	// (GORM aplica el default true al crear con false: se fuerza después)
	db.Model(&models.SunatBuzonMessage{}).Where("cod_mensaje = ?", 5).Update("en_buzon", false)
	// Empresa b: 1 sin leer. Empresa c: ninguna.
	mk(b, 6, 2, false, false, true, old.Add(24*time.Hour))
	db.Create(&models.SunatBuzonSync{CompanyID: c, Status: models.SunatBuzonStatusRechazadas})
	db.Create(&models.SunatBuzonSync{CompanyID: b, Status: models.SunatBuzonStatusOK})

	// Administrador (todo el estudio).
	all, err := svc.UnreadSummary(nil)
	if err != nil {
		t.Fatal(err)
	}
	if all.Total != 3 || all.Urgent != 1 || len(all.Companies) != 2 || all.Companies[0].CompanyID != a || all.Companies[0].Unread != 2 || all.Companies[0].Urgent != 1 {
		t.Fatalf("todo el estudio: %+v", all)
	}
	if all.Companies[0].Oldest == nil || all.Companies[1].CompanyID != b || all.Unchecked.Rejected != 1 || all.Unchecked.Error != 0 {
		t.Errorf("antigüedad / sin revisar: %+v", all)
	}
	// Asistente o supervisor: solo las empresas que tienen asignadas.
	mine, _ := svc.UnreadSummary([]uint{b, c})
	if mine.Total != 1 || len(mine.Companies) != 1 || mine.Companies[0].CompanyID != b || mine.Unchecked.Rejected != 1 {
		t.Errorf("solo sus empresas: %+v", mine)
	}
	only, _ := svc.UnreadSummary([]uint{b})
	if only.Total != 1 || only.Unchecked.Rejected != 0 {
		t.Errorf("lo no revisado también respeta el alcance: %+v", only)
	}
	none, err := svc.UnreadSummary([]uint{})
	if err != nil || none.Total != 0 || len(none.Companies) != 0 {
		t.Errorf("sin empresas asignadas no ve nada: %+v %v", none, err)
	}
	// El estado de cada empresa trae su conteo de notificaciones sin leer (no el de mensajes).
	st := svc.State(a)
	if st == nil {
		db.Create(&models.SunatBuzonSync{CompanyID: a, Status: models.SunatBuzonStatusOK})
		st = svc.State(a)
	}
	if st.NotifNoLeidas != 2 {
		t.Errorf("notif_no_leidas = %d, quería 2", st.NotifNoLeidas)
	}
	states, _ := svc.States([]uint{a, b})
	if states[b].NotifNoLeidas != 1 {
		t.Errorf("States b: %+v", states[b])
	}
}
