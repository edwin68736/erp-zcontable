package services

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"miappfiber/database"
	"miappfiber/models"
)

// fakeSunatAPI imita lo justo de SUNAT: el Menú SOL (con la pantalla de credenciales que redirige con un token) y
// el servicio api.sunat.gob.pe/v1/tecnologia/controlacceso.
type fakeSunatAPI struct {
	srv       *httptest.Server
	app       map[string]any // aplicación registrada (nil = no tiene)
	rejectURL bool           // el PUT con más de una URL responde 400
	puts      []map[string]any
	posts     []map[string]any
	salio     bool
}

var fakeSunatPermisos = []map[string]string{
	{"desPathRecurso": "/v1/contribuyente/controlcpe", "desNombrePath": "MIGE Gestion Factoring"},
	{"desPathRecurso": "/v1/contribuyente/migeigv", "desNombrePath": "MIGE RCE y RVIE - SIRE"},
	{"desPathRecurso": "/v1/contribuyente/controlmsg", "desNombrePath": "Control de mensajes - alertas"},
}

func newFakeSunatAPI(t *testing.T) *fakeSunatAPI {
	f := &fakeSunatAPI{}
	mux := http.NewServeMux()
	mux.HandleFunc("/cl-ti-itmenu/MenuInternet.htm", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			r.ParseForm()
			if r.PostForm.Get("action") == "salir" {
				f.salio = true
			}
			_, _ = io.WriteString(w, "none")
			return
		}
		if r.URL.Query().Get("action") == "execute" && r.URL.Query().Get("code") == sunatAPIMenuCode {
			http.Redirect(w, r, "/loader/gestion.html?token=TOK123", http.StatusFound)
			return
		}
		_, _ = io.WriteString(w, `<html><script>var subdominio = 'ww1';</script></html>`)
	})
	mux.HandleFunc("/loader/gestion.html", func(w http.ResponseWriter, r *http.Request) { _, _ = io.WriteString(w, "<html></html>") })
	api := "/v1/tecnologia/controlacceso"
	auth := func(w http.ResponseWriter, r *http.Request) bool {
		if r.Header.Get("Authorization") != "Bearer TOK123" {
			w.WriteHeader(http.StatusUnauthorized)
			return false
		}
		return true
	}
	mux.HandleFunc(api+"/apis", func(w http.ResponseWriter, r *http.Request) {
		if auth(w, r) {
			_ = json.NewEncoder(w).Encode(fakeSunatPermisos)
		}
	})
	mux.HandleFunc(api+"/aplicaciones", func(w http.ResponseWriter, r *http.Request) {
		if !auth(w, r) {
			return
		}
		switch r.Method {
		case http.MethodGet:
			if f.app == nil {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			_ = json.NewEncoder(w).Encode(f.app)
		case http.MethodPost, http.MethodPut:
			var body map[string]any
			_ = json.NewDecoder(r.Body).Decode(&body)
			if r.Method == http.MethodPost {
				f.posts = append(f.posts, body)
				f.app = map[string]any{"id": "app-1", "desClientId": "cid-nuevo", "desClientSecret": "secreto-nuevo"}
			} else {
				f.puts = append(f.puts, body)
				if f.rejectURL && strings.Contains(body["desUrlApp"].(string), ",") {
					w.WriteHeader(http.StatusBadRequest)
					_, _ = io.WriteString(w, `{"message":"url invalida"}`)
					return
				}
			}
			f.app["nomApp"], f.app["desUrlApp"], f.app["expFlujoAutoriz"] = body["nomApp"], body["desUrlApp"], body["expFlujoAutoriz"]
			var apis []map[string]any
			for _, rc := range body["recursos"].([]any) {
				apis = append(apis, map[string]any{"recursos": []map[string]any{{"desPathRecurso": rc.(map[string]any)["desPathRecurso"]}}})
			}
			f.app["apis"] = apis
			w.WriteHeader(http.StatusOK)
		}
	})
	f.srv = httptest.NewServer(mux)
	t.Cleanup(f.srv.Close)
	return f
}

func (f *fakeSunatAPI) existingApp(name, url, scope string, paths ...string) {
	var apis []map[string]any
	for _, p := range paths {
		apis = append(apis, map[string]any{"recursos": []map[string]any{{"desPathRecurso": p}}})
	}
	f.app = map[string]any{"id": "app-0", "nomApp": name, "desUrlApp": url, "expFlujoAutoriz": scope, "desClientId": "cid-previo", "desClientSecret": "secreto-previo", "apis": apis}
}

func newApiCredsTest(t *testing.T, f *fakeSunatAPI) (*SunatApiCredentialsService, models.Company) {
	db := setupCompanyRucTestDB(t)
	if err := db.AutoMigrate(&models.CompanyAccessCredential{}, &models.CompanyAccessLog{}); err != nil {
		t.Fatal(err)
	}
	co := models.Company{RUC: "20111111111", BusinessName: "Empresa", Status: "activo", ClientType: models.CompanyClientTypeEstudio}
	db.Create(&co)
	db.Create(&models.CompanyAccessCredential{CompanyID: co.ID, SolUsuario: "USUARIO", SolClave: "clave"})
	svc := NewSunatApiCredentialsService()
	svc.apiBase = f.srv.URL
	svc.appName, svc.appURL = "zcontable", "https://zcontables.net"
	svc.linkFn = func(uint, []uint, uint) (string, error) { return f.srv.URL + "/cl-ti-itmenu/MenuInternet.htm?x=1", nil }
	return svc, co
}

func sireDe(t *testing.T, companyID uint) (string, string) {
	var cred models.CompanyAccessCredential
	if err := database.DB.Where("company_id = ?", companyID).First(&cred).Error; err != nil {
		t.Fatal(err)
	}
	return cred.SireClientID, cred.SireClientSecret
}

func TestProvision_creaLaAplicacionSiNoExiste(t *testing.T) {
	f := newFakeSunatAPI(t)
	svc, co := newApiCredsTest(t, f)
	res, err := svc.Provision(co.ID, nil, 1)
	if err != nil {
		t.Fatal(err)
	}
	if !res.Created || len(f.posts) != 1 {
		t.Fatalf("debía crear la aplicación: %+v posts=%d", res, len(f.posts))
	}
	p := f.posts[0]
	if p["nomApp"] != "zcontable" || p["desUrlApp"] != "https://zcontables.net" || p["expFlujoAutoriz"] != sunatAPIScopeDesktop || len(p["recursos"].([]any)) != len(fakeSunatPermisos) {
		t.Errorf("cuerpo de creación: %+v", p)
	}
	if id, secret := sireDe(t, co.ID); id != "cid-nuevo" || secret != "secreto-nuevo" {
		t.Errorf("no guardó las credenciales: %q %q", id, secret)
	}
	if !f.salio {
		t.Error("debía cerrar la sesión de SOL")
	}
}

func TestProvision_existenteConservaNombreYAgregaPermisosYUrl(t *testing.T) {
	f := newFakeSunatAPI(t)
	f.existingApp("Datamart", "https://datamart.cl", "001000", "/v1/contribuyente/migeigv")
	svc, co := newApiCredsTest(t, f)
	res, err := svc.Provision(co.ID, nil, 1)
	if err != nil {
		t.Fatal(err)
	}
	if res.Created || !res.Updated || !res.URLAdded || len(f.posts) != 0 || len(f.puts) != 1 {
		t.Fatalf("resultado: %+v puts=%d posts=%d", res, len(f.puts), len(f.posts))
	}
	p := f.puts[0]
	if p["nomApp"] != "Datamart" || p["id"] != "app-0" || p["expFlujoAutoriz"] != "001000" {
		t.Errorf("no debía cambiar nombre, id ni alcance: %+v", p)
	}
	if u := p["desUrlApp"].(string); !strings.Contains(u, "https://datamart.cl") || !strings.Contains(u, "https://zcontables.net") {
		t.Errorf("la URL debía conservar la anterior y agregar la nuestra: %q", u)
	}
	if len(p["recursos"].([]any)) != len(fakeSunatPermisos) {
		t.Errorf("debía marcar todos los permisos: %+v", p["recursos"])
	}
	if id, secret := sireDe(t, co.ID); id != "cid-previo" || secret != "secreto-previo" {
		t.Errorf("debía guardar las credenciales existentes: %q %q", id, secret)
	}
}

func TestProvision_yaCompletaNoEscribeNada(t *testing.T) {
	f := newFakeSunatAPI(t)
	f.existingApp("zcontable", "https://zcontables.net/", sunatAPIScopeDesktop,
		"/v1/contribuyente/controlcpe", "/v1/contribuyente/migeigv", "/v1/contribuyente/controlmsg")
	svc, co := newApiCredsTest(t, f)
	res, err := svc.Provision(co.ID, nil, 1)
	if err != nil {
		t.Fatal(err)
	}
	if res.Created || res.Updated || len(f.puts)+len(f.posts) != 0 {
		t.Fatalf("no debía escribir en SUNAT: %+v", res)
	}
	if id, _ := sireDe(t, co.ID); id != "cid-previo" {
		t.Errorf("debía guardar el Client ID: %q", id)
	}
}

func TestProvision_siSunatRechazaLaUrlCompletaSoloLosPermisos(t *testing.T) {
	f := newFakeSunatAPI(t)
	f.rejectURL = true
	f.existingApp("Datamart", "https://datamart.cl", sunatAPIScopeDesktop, "/v1/contribuyente/migeigv")
	svc, co := newApiCredsTest(t, f)
	res, err := svc.Provision(co.ID, nil, 1)
	if err != nil {
		t.Fatal(err)
	}
	if !res.Updated || res.URLAdded || len(res.Warnings) == 0 || len(f.puts) != 2 {
		t.Fatalf("resultado: %+v puts=%d", res, len(f.puts))
	}
	if u := f.puts[1]["desUrlApp"]; u != "https://datamart.cl" {
		t.Errorf("el reintento debía dejar la URL como estaba: %v", u)
	}
	if id, _ := sireDe(t, co.ID); id != "cid-previo" {
		t.Errorf("igual debía guardar las credenciales: %q", id)
	}
}

func TestProvision_errorDeLoginNoLlamaASunatApi(t *testing.T) {
	f := newFakeSunatAPI(t)
	svc, co := newApiCredsTest(t, f)
	svc.linkFn = func(uint, []uint, uint) (string, error) {
		return "", accessErr(SunatAccessBadCreds, "rechazada", "")
	}
	_, err := svc.Provision(co.ID, nil, 1)
	var ae *SunatSolAccessError
	if !errors.As(err, &ae) || ae.Code != SunatAccessBadCreds {
		t.Fatalf("esperaba credenciales_rechazadas: %v", err)
	}
	if len(f.posts)+len(f.puts) != 0 {
		t.Error("no debía escribir")
	}
}

func TestValidateSol_marcaYSeInvalidaAlCambiarLaClave(t *testing.T) {
	f := newFakeSunatAPI(t)
	svc, co := newApiCredsTest(t, f)
	credSvc := NewCompanyAccessCredentialService()

	row, _ := credSvc.GetByCompanyID(co.ID, nil)
	if row.SolValidada {
		t.Fatal("al inicio no está validada")
	}
	if err := svc.ValidateSol(co.ID, nil, 1); err != nil {
		t.Fatal(err)
	}
	if row, _ = credSvc.GetByCompanyID(co.ID, nil); !row.SolValidada {
		t.Fatal("debía quedar validada")
	}
	// Cambia la clave: la validación ya no vale.
	database.DB.Model(&models.CompanyAccessCredential{}).Where("company_id = ?", co.ID).Update("sol_clave", "otra")
	if row, _ = credSvc.GetByCompanyID(co.ID, nil); row.SolValidada {
		t.Fatal("al cambiar la clave debía dejar de estar validada")
	}
	// SUNAT la rechaza: se queda sin validar.
	_ = svc.ValidateSol(co.ID, nil, 1)
	svc.linkFn = func(uint, []uint, uint) (string, error) { return "", accessErr(SunatAccessBadCreds, "rechazada", "") }
	if err := svc.ValidateSol(co.ID, nil, 1); err == nil {
		t.Fatal("debía devolver el error de SUNAT")
	}
	if row, _ = credSvc.GetByCompanyID(co.ID, nil); row.SolValidada {
		t.Fatal("tras un rechazo no debía quedar validada")
	}
}

func TestMergeAppURL(t *testing.T) {
	cases := []struct {
		existing, ours, want string
		changed              bool
	}{
		{"", "https://zcontables.net", "https://zcontables.net", true},
		{"https://zcontables.net", "https://zcontables.net", "https://zcontables.net", false},
		{"http://www.zcontables.net/", "https://zcontables.net", "http://www.zcontables.net/", false},
		{"https://datamart.cl", "https://zcontables.net", "https://datamart.cl, https://zcontables.net", true},
		{"https://datamart.cl, https://zcontables.net", "https://zcontables.net", "https://datamart.cl, https://zcontables.net", false},
	}
	for _, c := range cases {
		got, changed := mergeAppURL(c.existing, c.ours)
		if got != c.want || changed != c.changed {
			t.Errorf("mergeAppURL(%q,%q) = %q,%v; quería %q,%v", c.existing, c.ours, got, changed, c.want, c.changed)
		}
	}
}
