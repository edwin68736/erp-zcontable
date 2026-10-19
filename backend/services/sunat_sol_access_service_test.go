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
	sinCodigoHits int
}

func newFakeSunat(t *testing.T, loginRedirect string, methodBody string, sinCodigoBody string) *fakeSunat {
	t.Helper()
	f := &fakeSunat{}
	mux := http.NewServeMux()
	mux.HandleFunc("/loginMenuSol", func(w http.ResponseWriter, r *http.Request) {
		http.SetCookie(w, &http.Cookie{Name: "TS01", Value: "abc", Path: "/"})
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

	got, err := svc.login("20123456789", "USUARIO1", "clave-secreta")
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
	_, err := svc.login("20123456789", "USUARIO1", "mala")
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
	got, err := svc.login("20123456789", "USUARIO1", "clave")
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
	_, err := svc.login("20123456789", "USUARIO1", "clave")
	var ae *SunatSolAccessError
	if !errors.As(err, &ae) || ae.Code != SunatAccessCaptcha {
		t.Fatalf("esperaba captcha, obtuve %v", err)
	}
}

func TestSunatLogin_RespuestaSinEnlaceNoFiltraValores(t *testing.T) {
	f := newFakeSunat(t, "/metodo/123456789012", `<html>Método</html>`, `{"estado":"ok","token":"SECRETO-123"}`)
	svc := newTestSunatService(f.srv.URL)
	_, err := svc.login("20123456789", "USUARIO1", "clave")
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

func TestExtractMenuURL(t *testing.T) {
	cases := map[string]string{
		`{"a":{"b":["https://otro.com/x","https://e-menu.sunat.gob.pe/cl/ok?c=1"]}}`: "https://e-menu.sunat.gob.pe/cl/ok?c=1",
		`{"url":"https://api-seguridad.sunat.gob.pe/algo"}`:                        "https://api-seguridad.sunat.gob.pe/algo",
		`location.href='https:\/\/e-menu.sunat.gob.pe\/cl\/abc?x=1';`:             "https://e-menu.sunat.gob.pe/cl/abc?x=1",
		`{"sin":"enlace"}`: "",
	}
	for in, want := range cases {
		if got := extractMenuURL([]byte(in)); got != want {
			t.Errorf("extractMenuURL(%s) = %q, quiero %q", in, got, want)
		}
	}
}
