package services

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// fakeSunat simula el portal de seguridad de SUNAT: login → pantalla de método → "continuar sin código".
type fakeSunat struct {
	srv           *httptest.Server
	postedForm    map[string]string
	cookieOnSinCd bool
	// sessionCookie: si no está vacío, el login deja la cookie SessionID (como SUNAT) con ese valor.
	sessionCookie string
	sinCodigoHits int
}

func newFakeSunat(t *testing.T, loginRedirect string, methodBody string, sinCodigoBody string) *fakeSunat {
	t.Helper()
	f := &fakeSunat{}
	mux := http.NewServeMux()
	mux.HandleFunc("/loginMenuSol", func(w http.ResponseWriter, r *http.Request) {
		http.SetCookie(w, &http.Cookie{Name: "TS01", Value: "abc", Path: "/"})
		if f.sessionCookie != "" {
			http.SetCookie(w, &http.Cookie{Name: "SessionID", Value: f.sessionCookie, Path: "/"})
		}
		_, _ = w.Write([]byte(`<form name="LoginForm" action="j_security_check" method="POST"></form>`))
	})
	mux.HandleFunc("/j_security_check", func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseForm()
		f.postedForm = map[string]string{}
		for k := range r.PostForm {
			f.postedForm[k] = r.PostForm.Get(k)
		}
		loc := loginRedirect
		if strings.HasPrefix(loc, "/") {
			loc = f.srv.URL + loc
		}
		http.Redirect(w, r, loc, http.StatusFound)
	})
	mux.HandleFunc("/proceso-seguridad", func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(methodBody))
	})
	mux.HandleFunc("/metodo/123456789012", func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(methodBody))
	})
	mux.HandleFunc("/redireccion-sin-codigo/123456789012", func(w http.ResponseWriter, r *http.Request) {
		f.sinCodigoHits++
		if c, err := r.Cookie("TS01"); err == nil && c.Value == "abc" {
			f.cookieOnSinCd = true
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(sinCodigoBody))
	})
	f.srv = httptest.NewServer(mux)
	t.Cleanup(f.srv.Close)
	return f
}

func newTestSunatService(base string) *SunatSolAccessService {
	return &SunatSolAccessService{baseURL: base, inFlight: map[uint]bool{}, badUntil: map[string]time.Time{}}
}

func TestSunatLogin_FlujoCompleto(t *testing.T) {
	f := newFakeSunat(t, "/metodo/123456789012", `<html>Método de Autenticación</html>`,
		`{"estado":"ok","urlRedireccion":"https://e-menu.sunat.gob.pe/cl-ti-itmenucabina/AutenticaMenuInternet.htm?code=XYZ&state=S"}`)
	svc := newTestSunatService(f.srv.URL)

	got, err := svc.login(sunatSolTargets[sunatAccessTargetSunat], "20123456789", "USUARIO1", "clave-secreta")
	if err != nil {
		t.Fatalf("login: %v", err)
	}
	want := "https://e-menu.sunat.gob.pe/cl-ti-itmenucabina/AutenticaMenuInternet.htm?code=XYZ&state=S"
	if got != want {
		t.Errorf("enlace = %q, quiero %q", got, want)
	}
	if f.postedForm["tipo"] != "2" || f.postedForm["custom_ruc"] != "20123456789" ||
		f.postedForm["j_username"] != "USUARIO1" || f.postedForm["j_password"] != "clave-secreta" {
		t.Errorf("formulario enviado a SUNAT incorrecto: %v", f.postedForm)
	}
	if !f.cookieOnSinCd {
		t.Error("la petición 'sin código' debe llevar las cookies de la sesión de login")
	}
}

func TestSunatLogin_CredencialesRechazadas(t *testing.T) {
	f := newFakeSunat(t, "/oauth2/error?x=1", "", "")
	svc := newTestSunatService(f.srv.URL)
	// El mock redirige a una ruta que no existe en mux; basta con que la ruta contenga /oauth2/error.
	_, err := svc.login(sunatSolTargets[sunatAccessTargetSunat], "20123456789", "USUARIO1", "mala")
	var ae *SunatSolAccessError
	if !errors.As(err, &ae) || ae.Code != SunatAccessBadCreds {
		t.Fatalf("esperaba credenciales_rechazadas, obtuve %v", err)
	}
	if f.sinCodigoHits != 0 {
		t.Error("no debe llamar a 'sin código' tras un rechazo")
	}
}

func TestSunatLogin_EnlaceDirectoSinSeguirlo(t *testing.T) {
	// Si SUNAT redirige directo a e-menu, se devuelve el enlace SIN seguirlo (seguirlo lo consumiría).
	f := newFakeSunat(t, "https://e-menu.sunat.gob.pe/cl-ti-itmenucabina/Autentica.htm?code=ABC", "", "")
	svc := newTestSunatService(f.srv.URL)
	got, err := svc.login(sunatSolTargets[sunatAccessTargetSunat], "20123456789", "USUARIO1", "clave")
	if err != nil {
		t.Fatalf("login: %v", err)
	}
	if got != "https://e-menu.sunat.gob.pe/cl-ti-itmenucabina/Autentica.htm?code=ABC" {
		t.Errorf("enlace inesperado: %q", got)
	}
}

func TestSunatLogin_VuelveAlFormularioEsCaptcha(t *testing.T) {
	f := newFakeSunat(t, "/loginMenuSol", "", "")
	svc := newTestSunatService(f.srv.URL)
	_, err := svc.login(sunatSolTargets[sunatAccessTargetSunat], "20123456789", "USUARIO1", "clave")
	var ae *SunatSolAccessError
	if !errors.As(err, &ae) || ae.Code != SunatAccessCaptcha {
		t.Fatalf("esperaba captcha, obtuve %v", err)
	}
}

func TestSunatLogin_RespuestaSinEnlaceNoFiltraValores(t *testing.T) {
	f := newFakeSunat(t, "/metodo/123456789012", `<html>Método</html>`, `{"estado":"ok","token":"SECRETO-123"}`)
	svc := newTestSunatService(f.srv.URL)
	_, err := svc.login(sunatSolTargets[sunatAccessTargetSunat], "20123456789", "USUARIO1", "clave")
	var ae *SunatSolAccessError
	if !errors.As(err, &ae) || ae.Code != SunatAccessUnexpected {
		t.Fatalf("esperaba respuesta_inesperada, obtuve %v", err)
	}
	if strings.Contains(ae.Detail, "SECRETO-123") || strings.Contains(ae.Detail, "clave") {
		t.Errorf("el detalle no debe incluir valores ni credenciales: %q", ae.Detail)
	}
	if !strings.Contains(ae.Detail, "estado") || !strings.Contains(ae.Detail, "token") {
		t.Errorf("el detalle debe listar los nombres de los campos: %q", ae.Detail)
	}
}

func TestExtractAccessURL(t *testing.T) {
	cases := map[string]string{
		`{"a":{"b":["https://otro.com/x","https://e-menu.sunat.gob.pe/cl/ok?c=1"]}}`: "https://e-menu.sunat.gob.pe/cl/ok?c=1",
		`{"url":"https://api-seguridad.sunat.gob.pe/algo"}`:                        "https://api-seguridad.sunat.gob.pe/algo",
		`location.href='https:\/\/e-menu.sunat.gob.pe\/cl\/abc?x=1';`:             "https://e-menu.sunat.gob.pe/cl/abc?x=1",
		`{"sin":"enlace"}`: "",
	}
	for in, want := range cases {
		if got := extractAccessURL([]byte(in), sunatSolTargets[sunatAccessTargetSunat]); got != want {
			t.Errorf("extractAccessURL(%s) = %q, quiero %q", in, got, want)
		}
	}
}

func TestSunatLogin_DestinosUsanSusParametros(t *testing.T) {
	cases := []struct {
		name      string
		link      string
		wantOrig  string
		wantState string
	}{
		{sunatAccessTargetPagos, "https://e-menu.sunat.gob.pe/cl-ti-itmenu2/AutenticaMenuInternetPlataforma.htm?code=P1&state=S",
			"https://e-menu.sunat.gob.pe/cl-ti-itmenu2/AutenticaMenuInternetPlataforma.htm", sunatSolTargets[sunatAccessTargetPagos].State},
		{sunatAccessTargetSunafil, "https://casillaelectronica.sunafil.gob.pe/si.inbox/Login/Empresa?state=s&code=J1&lang=es-PE",
			"https://casillaelectronica.sunafil.gob.pe/si.inbox/Login/Empresa", "s"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			f := newFakeSunat(t, "/metodo/123456789012", `<html>Método de Autenticación</html>`,
				`{"estado":"ok","urlRedireccion":"`+tc.link+`"}`)
			svc := newTestSunatService(f.srv.URL)
			got, err := svc.login(sunatSolTargets[tc.name], "20123456789", "USUARIO1", "clave")
			if err != nil {
				t.Fatalf("login: %v", err)
			}
			if got != tc.link {
				t.Errorf("enlace = %q, quiero %q", got, tc.link)
			}
			if f.postedForm["originalUrl"] != tc.wantOrig || f.postedForm["state"] != tc.wantState {
				t.Errorf("parámetros enviados incorrectos: %v", f.postedForm)
			}
		})
	}
}

func TestSunatLogin_SunafilNoAceptaEnlaceDeOtroSitio(t *testing.T) {
	// Un enlace a e-menu no sirve para SUNAFIL: el destino solo acepta su propia casilla.
	f := newFakeSunat(t, "/metodo/123456789012", `<html>Método</html>`,
		`{"url":"https://e-menu.sunat.gob.pe/cl-ti-itmenucabina/AutenticaMenuInternet.htm?code=X"}`)
	svc := newTestSunatService(f.srv.URL)
	if _, err := svc.login(sunatSolTargets[sunatAccessTargetSunafil], "20123456789", "USUARIO1", "clave"); err == nil {
		t.Fatal("se esperaba error: el enlace no es de la casilla de SUNAFIL")
	}
}

func TestSunatSolTargets_UrlsPorCliente(t *testing.T) {
	svc := &SunatSolAccessService{}
	want := map[string]string{
		sunatAccessTargetSunat:   "085b176d-2437-44cd-8c3e-e9a83b705921",
		sunatAccessTargetPagos:   "59d39217-c025-4de5-b342-393b0f4630ab",
		sunatAccessTargetSunafil: "b6474e23-8a3b-4153-b301-dafcc9646250",
	}
	for name, client := range want {
		got := svc.baseFor(sunatSolTargets[name])
		if got != "https://api-seguridad.sunat.gob.pe/v1/clientessol/"+client+"/oauth2" {
			t.Errorf("%s: base = %s", name, got)
		}
	}
}

func TestSunatLogin_IdDeSesionDesdeLaCookie(t *testing.T) {
	// SUNAT no siempre pone el id en la ruta: la pantalla de método lo lee de la cookie SessionID.
	f := newFakeSunat(t, "/proceso-seguridad", `<html>Método de Autenticación</html>`,
		`{"estado":"ok","url":"https://e-menu.sunat.gob.pe/cl-ti-itmenucabina/AutenticaMenuInternet.htm?code=C1"}`)
	f.sessionCookie = "123456789012"
	svc := newTestSunatService(f.srv.URL)
	got, err := svc.login(sunatSolTargets[sunatAccessTargetSunat], "20123456789", "USUARIO1", "clave")
	if err != nil {
		t.Fatalf("login: %v", err)
	}
	if got != "https://e-menu.sunat.gob.pe/cl-ti-itmenucabina/AutenticaMenuInternet.htm?code=C1" || f.sinCodigoHits != 1 {
		t.Errorf("enlace = %q, hits = %d", got, f.sinCodigoHits)
	}
}

func TestSunatLogin_SinIdDeSesionListaSoloNombresDeCookies(t *testing.T) {
	f := newFakeSunat(t, "/proceso-seguridad", `<html>Método de Autenticación</html>`, "")
	svc := newTestSunatService(f.srv.URL)
	_, err := svc.login(sunatSolTargets[sunatAccessTargetSunat], "20123456789", "USUARIO1", "clave")
	var ae *SunatSolAccessError
	if !errors.As(err, &ae) || ae.Code != SunatAccessUnexpected {
		t.Fatalf("se esperaba respuesta_inesperada, llegó %v", err)
	}
	if !strings.Contains(ae.Detail, "cookies: TS01") || strings.Contains(ae.Detail, "abc") {
		t.Errorf("el detalle debe listar nombres de cookies y no sus valores: %q", ae.Detail)
	}
}
