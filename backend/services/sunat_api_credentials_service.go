package services

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"os"
	"strings"
	"time"

	"miappfiber/database"
	"miappfiber/models"
)

// Generación automática de las credenciales de API SUNAT (Client ID y Client Secret) de una empresa.
//
// SUNAT no ofrece una API para esto: la pantalla «Credenciales de API SUNAT → Gestión Credenciales de API SUNAT» del
// Menú SOL es una aplicación web que, con el token de la sesión SOL, llama a api.sunat.gob.pe/v1/tecnologia/controlacceso
// (lista de permisos y aplicación registrada). Este servicio hace lo mismo que esa pantalla desde el servidor:
//  1. entra a SOL con la clave de la empresa (mismo login, límites y bitácora del acceso directo),
//  2. abre esa pantalla (menú 80.1.1.1.1) y toma el token que SUNAT le entrega,
//  3. si la empresa no tiene aplicación la crea; si ya la tiene respeta su nombre, marca todos los permisos y agrega
//     la URL de este sistema,
//  4. guarda el Client ID y el Client Secret en las credenciales de la empresa y cierra la sesión.

const (
	sunatAPIDefaultBase    = "https://api.sunat.gob.pe"
	sunatAPIControlPath    = "/v1/tecnologia/controlacceso"
	sunatAPIMenuCode       = "80.1.1.1.1"
	sunatAPIScopeDesktop   = "100000" // alcance «Desktop» de la pantalla (el que usa el flujo con usuario y clave SOL)
	sunatAPIDefaultAppName = "zcontable"
	sunatAPIDefaultAppURL  = "https://zcontables.net"
)

// SunatApiCredentialsResult resumen de lo que se hizo (nunca incluye el Client ID ni el Secret).
type SunatApiCredentialsResult struct {
	Created  bool     `json:"created"`            // se creó la aplicación
	Updated  bool     `json:"updated"`            // se completó una aplicación existente (permisos y/o URL)
	URLAdded bool     `json:"url_added"`          // se agregó la URL de este sistema
	Warnings []string `json:"warnings,omitempty"` // avisos que no impidieron obtener las credenciales
}

type SunatApiCredentialsService struct {
	sol     *SunatSolAccessService
	creds   *CompanyAccessCredentialService
	apiBase string
	appName string
	appURL  string
	timeout time.Duration
	// linkFn entrega el enlace de ingreso a SOL (en pruebas se reemplaza).
	linkFn func(companyID uint, allowed []uint, userID uint) (string, error)
}

func NewSunatApiCredentialsService() *SunatApiCredentialsService {
	sol := NewSunatSolAccessService()
	return &SunatApiCredentialsService{
		sol:     sol,
		creds:   NewCompanyAccessCredentialService(),
		apiBase: sunatAPIDefaultBase,
		appName: envOr("SUNAT_API_APP_NAME", sunatAPIDefaultAppName),
		appURL:  envOr("SUNAT_API_APP_URL", sunatAPIDefaultAppURL),
		timeout: 40 * time.Second,
		linkFn: func(companyID uint, allowed []uint, userID uint) (string, error) {
			res, err := sol.Generate(companyID, allowed, userID, sunatAccessTargetSunat)
			if err != nil {
				return "", err
			}
			return res.URL, nil
		},
	}
}

func envOr(key, def string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return def
}

// solFingerprint huella del par usuario/clave SOL (para saber si la validación sigue vigente).
func solFingerprint(usuario, clave string) string {
	return buzonFingerprint(strings.TrimSpace(usuario), clave)
}

// ValidateSol prueba el usuario y la clave SOL de la empresa contra SUNAT (botón de la llave). Si SUNAT los acepta
// queda registrado; si los rechaza se quita la validación. Usa el mismo límite de intentos que el acceso directo.
func (s *SunatApiCredentialsService) ValidateSol(companyID uint, allowed []uint, userID uint) error {
	_, err := s.linkFn(companyID, allowed, userID)
	var cred models.CompanyAccessCredential
	if dbErr := database.DB.Where("company_id = ?", companyID).First(&cred).Error; dbErr != nil {
		return err
	}
	if err == nil {
		now := time.Now()
		return database.DB.Model(&cred).Updates(map[string]any{
			"sol_validated_at": now, "sol_validated_fp": solFingerprint(cred.SolUsuario, cred.SolClave),
		}).Error
	}
	var ae *SunatSolAccessError
	if errors.As(err, &ae) && ae.Code == SunatAccessBadCreds {
		_ = database.DB.Model(&cred).Updates(map[string]any{"sol_validated_at": nil, "sol_validated_fp": ""}).Error
	}
	return err
}

// Provision crea o completa la aplicación de API SUNAT de la empresa y guarda su Client ID y Secret.
func (s *SunatApiCredentialsService) Provision(companyID uint, allowed []uint, userID uint) (*SunatApiCredentialsResult, error) {
	link, err := s.linkFn(companyID, allowed, userID)
	if err != nil {
		return nil, err
	}
	sess, err := s.openSession(link)
	if err != nil {
		return nil, err
	}
	defer sess.close()

	// 1) Permisos disponibles y aplicación actual.
	var apis []sunatAPIRecurso
	if st, body, err := sess.call(http.MethodGet, "/apis", nil); err != nil {
		return nil, err
	} else if st != http.StatusOK || json.Unmarshal(body, &apis) != nil || len(apis) == 0 {
		return nil, accessErr(SunatAccessUnexpected, "SUNAT no entregó la lista de permisos de API.", fmt.Sprintf("GET apis: HTTP %d", st))
	}
	want := make([]string, 0, len(apis))
	for _, a := range apis {
		if p := strings.TrimSpace(a.DesPathRecurso); p != "" {
			want = append(want, p)
		}
	}
	app, err := sess.currentApp()
	if err != nil {
		return nil, err
	}

	res := &SunatApiCredentialsResult{}
	recursosBody := func() []map[string]string {
		out := make([]map[string]string, 0, len(want))
		for _, p := range want {
			out = append(out, map[string]string{"desPathRecurso": p})
		}
		return out
	}

	if app == nil {
		// 2a) No tiene aplicación: se crea con todos los permisos y la URL de este sistema.
		st, body, err := sess.call(http.MethodPost, "/aplicaciones", map[string]any{
			"id": nil, "expFlujoAutoriz": sunatAPIScopeDesktop, "nomApp": s.appName, "desUrlApp": s.appURL, "recursos": recursosBody(),
		})
		if err != nil {
			return nil, err
		}
		if st < 200 || st >= 300 {
			return nil, accessErr(SunatAccessUnexpected, "SUNAT no aceptó el registro de la aplicación de API.", fmt.Sprintf("POST aplicaciones: HTTP %d %s", st, sunatErrorSummary(body)))
		}
		res.Created, res.URLAdded = true, true
	} else {
		// 2b) Ya tiene: se conserva el nombre; se marcan todos los permisos y se agrega la URL de este sistema.
		missing := missingResources(app.paths(), want)
		newURL, urlChanged := mergeAppURL(app.DesUrlApp, s.appURL)
		if len(missing) > 0 || urlChanged {
			scope := strings.TrimSpace(app.ExpFlujoAutoriz)
			if scope == "" {
				scope = sunatAPIScopeDesktop
			}
			put := func(urlValue string) (int, []byte, error) {
				return sess.call(http.MethodPut, "/aplicaciones", map[string]any{
					"id": app.ID, "expFlujoAutoriz": scope, "nomApp": app.NomApp, "desUrlApp": urlValue, "recursos": recursosBody(),
				})
			}
			st, body, err := put(newURL)
			if err != nil {
				return nil, err
			}
			switch {
			case st >= 200 && st < 300:
				res.Updated, res.URLAdded = true, urlChanged
			case urlChanged && len(missing) > 0:
				// SUNAT no aceptó la URL agregada: se reintenta solo con los permisos.
				res.Warnings = append(res.Warnings, "SUNAT no aceptó agregar la URL de este sistema; se completaron solo los permisos.")
				if st2, body2, err2 := put(app.DesUrlApp); err2 == nil && st2 >= 200 && st2 < 300 {
					res.Updated = true
				} else {
					res.Warnings = append(res.Warnings, "No se pudieron marcar todos los permisos: "+sunatErrorSummary(body2))
				}
			case urlChanged:
				res.Warnings = append(res.Warnings, "SUNAT no aceptó agregar la URL de este sistema: "+sunatErrorSummary(body))
			default:
				res.Warnings = append(res.Warnings, "No se pudieron marcar todos los permisos: "+sunatErrorSummary(body))
			}
		}
	}

	// 3) Se vuelve a leer la aplicación: ahí están el Client ID y el Client Secret.
	app, err = sess.currentApp()
	if err != nil {
		return nil, err
	}
	if app == nil || strings.TrimSpace(app.DesClientID) == "" || strings.TrimSpace(app.DesClientSecret) == "" {
		return nil, accessErr(SunatAccessUnexpected, "SUNAT no entregó el Client ID y el Client Secret de la aplicación.", "aplicación sin credenciales")
	}
	if err := s.creds.SetSireCredentials(companyID, app.DesClientID, app.DesClientSecret, allowed); err != nil {
		return nil, err
	}
	return res, nil
}

// ───────────────────────────── Sesión en la pantalla de credenciales ─────────────────────────────

type sunatAPIRecurso struct {
	DesPathRecurso string `json:"desPathRecurso"`
	DesNombrePath  string `json:"desNombrePath"`
}

type sunatAPIApp struct {
	ID              string `json:"id"`
	NomApp          string `json:"nomApp"`
	DesUrlApp       string `json:"desUrlApp"`
	DesClientID     string `json:"desClientId"`
	DesClientSecret string `json:"desClientSecret"`
	ExpFlujoAutoriz string `json:"expFlujoAutoriz"`
	Apis            []struct {
		Recursos []sunatAPIRecurso `json:"recursos"`
	} `json:"apis"`
}

func (a *sunatAPIApp) paths() []string {
	var out []string
	for _, api := range a.Apis {
		for _, r := range api.Recursos {
			out = append(out, r.DesPathRecurso)
		}
	}
	return out
}

func missingResources(have, want []string) []string {
	set := map[string]bool{}
	for _, h := range have {
		set[strings.TrimSpace(h)] = true
	}
	var out []string
	for _, w := range want {
		if !set[w] {
			out = append(out, w)
		}
	}
	return out
}

// mergeAppURL agrega `ours` a la URL registrada si todavía no figura. Devuelve la URL resultante y si cambió.
func mergeAppURL(existing, ours string) (string, bool) {
	existing, ours = strings.TrimSpace(existing), strings.TrimSpace(ours)
	if ours == "" {
		return existing, false
	}
	if existing == "" {
		return ours, true
	}
	norm := func(u string) string {
		u = strings.ToLower(strings.TrimSpace(u))
		u = strings.TrimPrefix(strings.TrimPrefix(u, "https://"), "http://")
		return strings.TrimSuffix(strings.TrimPrefix(u, "www."), "/")
	}
	for _, part := range strings.FieldsFunc(existing, func(r rune) bool { return r == ',' || r == ';' || r == ' ' }) {
		if norm(part) == norm(ours) {
			return existing, false
		}
	}
	return existing + ", " + ours, true
}

type sunatAPISession struct {
	svc     *SunatApiCredentialsService
	client  *http.Client
	token   string
	menuURL string
}

func (sess *sunatAPISession) close() {
	(&SunatBuzonService{}).logout(sess.client, sess.menuURL)
}

// openSession sigue el enlace de ingreso a SOL, abre «Gestión Credenciales de API SUNAT» y toma el token que SUNAT
// entrega a esa pantalla (viene en la URL a la que redirige el menú).
func (s *SunatApiCredentialsService) openSession(link string) (*sunatAPISession, error) {
	jar, _ := cookiejar.New(nil)
	client := &http.Client{Jar: jar, Timeout: s.timeout}
	get := func(u string) (*http.Response, string, error) {
		req, _ := http.NewRequest(http.MethodGet, u, nil)
		req.Header.Set("User-Agent", sunatSolUserAgent)
		req.Header.Set("Accept-Language", "es-PE,es;q=0.9")
		resp, err := client.Do(req)
		if err != nil {
			return nil, "", accessErr(SunatAccessUnavailable, "No se pudo conectar con SUNAT. Intente de nuevo en unos minutos.", "credenciales API: "+errSummary(err))
		}
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
		resp.Body.Close()
		return resp, string(b), nil
	}
	resp, menuBody, err := get(link)
	if err != nil {
		return nil, err
	}
	menu := *resp.Request.URL
	menu.RawQuery, menu.Fragment = "", ""
	if resp.StatusCode != http.StatusOK || !strings.Contains(menu.Path, "MenuInternet") {
		return nil, accessErr(SunatAccessUnexpected, "SUNAT respondió de forma inesperada al abrir el menú.", fmt.Sprintf("menú: HTTP %d %s", resp.StatusCode, safeURL(resp.Request.URL)))
	}
	sess := &sunatAPISession{svc: s, client: client, menuURL: menu.String()}
	sub := "ww1"
	if m := reBuzonSubdominio.FindStringSubmatch(menuBody); m != nil {
		sub = m[1]
	}
	resp, _, err = get(menu.String() + "?action=execute&code=" + sunatAPIMenuCode + "&s=" + url.QueryEscape(sub))
	if err != nil {
		sess.close()
		return nil, err
	}
	tok := resp.Request.URL.Query().Get("token")
	if resp.StatusCode != http.StatusOK || tok == "" {
		sess.close()
		return nil, accessErr(SunatAccessUnexpected, "SUNAT no entregó acceso a la gestión de credenciales de API (la empresa podría no tener permiso).",
			fmt.Sprintf("credenciales: HTTP %d %s", resp.StatusCode, safeURL(resp.Request.URL)))
	}
	sess.token = tok
	return sess, nil
}

func (sess *sunatAPISession) call(method, path string, body any) (int, []byte, error) {
	var rd io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rd = bytes.NewReader(b)
	}
	req, _ := http.NewRequest(method, sess.svc.apiBase+sunatAPIControlPath+path, rd)
	req.Header.Set("User-Agent", sunatSolUserAgent)
	req.Header.Set("Authorization", "Bearer "+sess.token)
	req.Header.Set("Accept", "application/json, text/plain, */*")
	req.Header.Set("Origin", "https://ww1.sunat.gob.pe")
	req.Header.Set("Referer", "https://ww1.sunat.gob.pe/")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := sess.client.Do(req)
	if err != nil {
		return 0, nil, accessErr(SunatAccessUnavailable, "No se pudo conectar con SUNAT. Intente de nuevo en unos minutos.", "api: "+errSummary(err))
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	return resp.StatusCode, b, nil
}

// currentApp aplicación registrada de la empresa (nil si todavía no tiene).
func (sess *sunatAPISession) currentApp() (*sunatAPIApp, error) {
	st, body, err := sess.call(http.MethodGet, "/aplicaciones", nil)
	if err != nil {
		return nil, err
	}
	if st == http.StatusNotFound || st == http.StatusNoContent || len(bytes.TrimSpace(body)) == 0 {
		return nil, nil
	}
	if st != http.StatusOK {
		return nil, accessErr(SunatAccessUnexpected, "SUNAT no entregó la aplicación de API de la empresa.", fmt.Sprintf("GET aplicaciones: HTTP %d %s", st, sunatErrorSummary(body)))
	}
	var app sunatAPIApp
	if json.Unmarshal(body, &app) != nil {
		return nil, accessErr(SunatAccessUnexpected, "SUNAT devolvió la aplicación de API en un formato inesperado.", "campos: "+jsonKeysSummary(body))
	}
	if strings.TrimSpace(app.ID) == "" {
		return nil, nil
	}
	return &app, nil
}
