package services

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"

	"miappfiber/database"
	"miappfiber/models"
)

// Acceso directo a SUNAT Operaciones en Línea (Clave SOL) con las credenciales guardadas de la empresa.
//
// El servidor hace por detrás lo mismo que un navegador: login en el portal de seguridad de SUNAT, el
// paso "Continuar sin código" y recoge el enlace de un solo uso a e-menu.sunat.gob.pe que SUNAT entrega.
// Ese enlace se devuelve al navegador del usuario, que lo abre en una pestaña nueva y entra directo al
// panel (sin pasar por el login). El enlace NUNCA se sigue desde acá: abrirlo lo consumiría.
//
// Reglas de seguridad de este archivo: no se loguea ninguna clave, usuario, cookie ni enlace — solo
// códigos de resultado y rutas sin parámetros.

const (
	sunatSolBaseHost = "https://api-seguridad.sunat.gob.pe/v1/clientessol"
	sunatSolLang     = "es-PE"
	// Cookie con el id de sesión que usa la pantalla de método de SUNAT (la lee su JavaScript).
	sunatSolSessionCookie = "SessionID"

	sunatSolUserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
	sunatSolMaxHops   = 8
	sunatSolTimeout   = 25 * time.Second

	// Tras un rechazo de credenciales no se reintenta con las MISMAS credenciales durante este tiempo:
	// SUNAT pide captcha al 3er intento fallido y bloquearía el acceso manual también.
	sunatSolBadCredsCooldown = 10 * time.Minute
)

// Destino del ingreso directo: el mismo login SOL con distinto "cliente", originalUrl y state, que son los que
// la otra aplicación del estudio usa para cada botón. FinalHosts son los únicos sitios a los que se acepta un
// enlace de acceso (nunca se sigue ese enlace: abrirlo lo consumiría).
type sunatSolTarget struct {
	Name        string
	ClientID    string
	OriginalURL string
	State       string
	FinalHosts  []string
}

const (
	sunatAccessTargetPagos   = "pagos"
	sunatAccessTargetSunafil = "sunafil"
)

var sunatSolTargets = map[string]sunatSolTarget{
	// Menú SOL (cabina).
	sunatAccessTargetSunat: {
		Name:        sunatAccessTargetSunat,
		ClientID:    "085b176d-2437-44cd-8c3e-e9a83b705921",
		OriginalURL: "https://e-menu.sunat.gob.pe/cl-ti-itmenucabina/AutenticaMenuInternet.htm",
		State:       "rO0ABXNyABFqYXZhLnV0aWwuSGFzaE1hcAUH2sHDFmDRAwACRgAKbG9hZEZhY3RvckkACXRocmVzaG9sZHhwP0AAAAAAAAx3CAAAABAAAAADdAAEZXhlY3B0AAZwYXJhbXN0AFEqJiomL2NsLXRpLWl0bWVudWNhYmluYS9NZW51SW50ZXJuZXQuaHRtJjBlMWY4NDg5ZmVlYWJmOTMxNmI5ODUwNTYyMjA5MTE4ZjkxZTJjMmN0AANleGVweA==",
		FinalHosts:  []string{"e-menu.sunat.gob.pe"},
	},
	// Pagos: plataforma de pagos y deudas del Menú SOL.
	sunatAccessTargetPagos: {
		Name:        sunatAccessTargetPagos,
		ClientID:    "59d39217-c025-4de5-b342-393b0f4630ab",
		OriginalURL: "https://e-menu.sunat.gob.pe/cl-ti-itmenu2/AutenticaMenuInternetPlataforma.htm",
		State:       "rO0ABXQA7HpIam90dXJFVVlqQlpNb2t3NE8xQUZiZFBYdG5qZlhKbzVRQ3k0TnBZZ0lWNWhBNDU4OTZWU2xUbU85V1pVa2gvQUU2N09OR1VPR0M2d2g1YTBmMkxlOGpZQWNiazcyVXkweEhkTU44QWQrNVJCYUJURkgvcHdPRkxGZkplSTN5dkFESjdBSXZXM2lZbkZOc2NwMWNsbWJ2c1pXeUJQVnNIOEdERklJZWFCd1AvRFFVTFcraGRoeGk0YTczVC9pS3Z0Vmd1WVBqODlJckN3LzViaE5LelBmcnNqcURTNHdNOVYvTitvYTVyVmM9",
		FinalHosts:  []string{"e-menu.sunat.gob.pe"},
	},
	// SUNAFIL: casilla electrónica; entra con la misma clave SOL (SUNAT entrega un código de un solo uso).
	sunatAccessTargetSunafil: {
		Name:        sunatAccessTargetSunafil,
		ClientID:    "b6474e23-8a3b-4153-b301-dafcc9646250",
		OriginalURL: "https://casillaelectronica.sunafil.gob.pe/si.inbox/Login/Empresa",
		State:       "s",
		FinalHosts:  []string{"casillaelectronica.sunafil.gob.pe"},
	},
}

// Códigos de error estables (el frontend decide el mensaje y las acciones según el código).
const (
	SunatAccessMissingData  = "faltan_datos"
	SunatAccessBadCreds     = "credenciales_rechazadas"
	SunatAccessCooldown     = "credenciales_en_pausa"
	SunatAccessCaptcha      = "captcha"
	SunatAccessUnexpected   = "respuesta_inesperada"
	SunatAccessUnavailable  = "sunat_no_disponible"
	SunatAccessInProgress   = "en_curso"
	SunatAccessOutOfScope   = "sin_acceso"
	sunatAccessStatusOK     = "ok"
	sunatAccessStatusErr    = "error"
	sunatAccessTargetSunat  = "sunat"
	sunatAccessDetailMaxLen = 600
)

// SunatSolAccessError error con código estable y detalle técnico seguro (sin credenciales ni tokens).
type SunatSolAccessError struct {
	Code    string
	Message string
	Detail  string
}

func (e *SunatSolAccessError) Error() string { return e.Message }

func accessErr(code, msg, detail string) *SunatSolAccessError {
	if len(detail) > sunatAccessDetailMaxLen {
		detail = detail[:sunatAccessDetailMaxLen]
	}
	return &SunatSolAccessError{Code: code, Message: msg, Detail: detail}
}

// SunatSolAccessResult enlace de un solo uso listo para abrir en el navegador.
type SunatSolAccessResult struct {
	URL string `json:"url"`
	// ExpiresHintSeconds referencial: SUNAT no publica la vigencia exacta; conviene usarlo enseguida.
	ExpiresHintSeconds int `json:"expires_hint_seconds"`
}

type SunatSolAccessService struct {
	creds   *CompanyAccessCredentialService
	baseURL string // inyectable para pruebas; vacío = la URL real de cada destino

	mu       sync.Mutex
	inFlight map[uint]bool
	badUntil map[string]time.Time
}

func NewSunatSolAccessService() *SunatSolAccessService {
	return &SunatSolAccessService{
		creds:    NewCompanyAccessCredentialService(),
		inFlight: map[uint]bool{},
		badUntil: map[string]time.Time{},
	}
}

// Generate genera el enlace de acceso a SUNAT de una empresa. `allowed` es el alcance del usuario
// (nil = todo el estudio), igual que en el resto del módulo de claves.
func (s *SunatSolAccessService) Generate(companyID uint, allowed []uint, userID uint, targetName string) (res *SunatSolAccessResult, err error) {
	if targetName == "" {
		targetName = sunatAccessTargetSunat
	}
	target, ok := sunatSolTargets[targetName]
	if !ok {
		return nil, accessErr(SunatAccessUnexpected, "Destino de acceso no válido.", targetName)
	}
	defer func() {
		// Bitácora: quién abrió qué empresa y si salió bien (nunca claves ni enlaces).
		status, code := sunatAccessStatusOK, ""
		if err != nil {
			status = sunatAccessStatusErr
			var ae *SunatSolAccessError
			if errors.As(err, &ae) {
				code = ae.Code
			} else {
				code = "interno"
			}
		}
		if dbErr := database.DB.Create(&models.CompanyAccessLog{
			CompanyID: companyID, UserID: userID, Target: target.Name, Status: status, ErrorCode: code,
		}).Error; dbErr != nil {
			log.Printf("sunat-access: no se pudo registrar la bitácora: %v", dbErr)
		}
	}()

	row, err := s.creds.GetByCompanyID(companyID, allowed)
	if err != nil {
		return nil, accessErr(SunatAccessOutOfScope, "No tiene acceso a esta empresa.", err.Error())
	}
	ruc, usuario, clave := strings.TrimSpace(row.RUC), strings.TrimSpace(row.SolUsuario), row.SolClave
	switch {
	case ruc == "":
		return nil, accessErr(SunatAccessMissingData, "La empresa no tiene RUC cargado.", "")
	case usuario == "":
		return nil, accessErr(SunatAccessMissingData, "La empresa no tiene usuario SOL cargado.", "")
	case strings.TrimSpace(clave) == "":
		return nil, accessErr(SunatAccessMissingData, "La empresa no tiene clave SOL cargada.", "")
	}

	// Pausa tras un rechazo previo con las mismas credenciales.
	key := credKey(companyID, ruc, usuario, clave)
	s.mu.Lock()
	if until, ok := s.badUntil[key]; ok && time.Now().Before(until) {
		s.mu.Unlock()
		return nil, accessErr(SunatAccessCooldown,
			"SUNAT rechazó estas credenciales hace poco. Se pausó el reintento para no bloquear la clave: corrija el usuario o la clave SOL (botón Editar) o espere unos minutos.", "")
	}
	if s.inFlight[companyID] {
		s.mu.Unlock()
		return nil, accessErr(SunatAccessInProgress, "Ya se está generando el acceso de esta empresa.", "")
	}
	s.inFlight[companyID] = true
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		delete(s.inFlight, companyID)
		s.mu.Unlock()
	}()

	link, err := s.login(target, ruc, usuario, clave)
	if err != nil {
		var ae *SunatSolAccessError
		if errors.As(err, &ae) && (ae.Code == SunatAccessBadCreds || ae.Code == SunatAccessCaptcha) {
			s.mu.Lock()
			s.badUntil[key] = time.Now().Add(sunatSolBadCredsCooldown)
			s.mu.Unlock()
		}
		return nil, err
	}
	return &SunatSolAccessResult{URL: link, ExpiresHintSeconds: 300}, nil
}

// base URL del portal de seguridad para un destino (en pruebas se reemplaza por un servidor falso).
func (s *SunatSolAccessService) baseFor(t sunatSolTarget) string {
	if s.baseURL != "" {
		return s.baseURL
	}
	return sunatSolBaseHost + "/" + t.ClientID + "/oauth2"
}

func (t sunatSolTarget) isFinalHost(u *url.URL) bool {
	if u == nil {
		return false
	}
	for _, h := range t.FinalHosts {
		if strings.EqualFold(u.Hostname(), h) {
			return true
		}
	}
	return false
}

func credKey(companyID uint, parts ...string) string {
	h := sha256.Sum256([]byte(strings.Join(parts, "\x00")))
	return fmt.Sprintf("%d:%s", companyID, hex.EncodeToString(h[:]))
}

var (
	reSessionIDInPath = regexp.MustCompile(`/(\d{8,})(?:[/?#]|$)`)
	reSessionIDInBody = regexp.MustCompile(`redireccion-sin-codigo/(\d{8,})`)
	// reSessionCookieValue valor aceptable del id de sesión (se inserta en la ruta de la petición).
	reSessionCookieValue = regexp.MustCompile(`^[A-Za-z0-9_-]{6,64}$`)
	reMenuURLInBody   = regexp.MustCompile(`https://e-menu\.sunat\.gob\.pe/[^\s"'<>\\]+`)
)

// sessionCookie valor de la cookie "SessionID" que SUNAT deja tras el login (solo dígitos/letras: va en una ruta).
func sessionCookie(jar http.CookieJar, base string) string {
	u, err := url.Parse(base)
	if err != nil {
		return ""
	}
	for _, c := range jar.Cookies(u) {
		if c.Name == sunatSolSessionCookie && reSessionCookieValue.MatchString(c.Value) {
			return c.Value
		}
	}
	return ""
}

// cookieNames solo los NOMBRES de las cookies (nunca los valores) para el detalle técnico del error.
func cookieNames(jar http.CookieJar, base string) string {
	u, err := url.Parse(base)
	if err != nil {
		return "-"
	}
	names := []string{}
	for _, c := range jar.Cookies(u) {
		names = append(names, c.Name)
	}
	if len(names) == 0 {
		return "ninguna"
	}
	return strings.Join(names, ",")
}

// safeURL: host + ruta, sin parámetros (los parámetros pueden llevar tokens).
func safeURL(u *url.URL) string {
	if u == nil {
		return ""
	}
	return u.Hostname() + u.Path
}

// login hace el recorrido completo y devuelve el enlace de un solo uso a e-menu.sunat.gob.pe.
func (s *SunatSolAccessService) login(target sunatSolTarget, ruc, usuario, clave string) (string, error) {
	base := s.baseFor(target)
	jar, _ := cookiejar.New(nil)
	client := &http.Client{
		Jar:     jar,
		Timeout: sunatSolTimeout,
		// Los redirects se siguen a mano: jamás se debe seguir el enlace a e-menu (lo consumiría).
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
	do := func(req *http.Request) (*http.Response, error) {
		req.Header.Set("User-Agent", sunatSolUserAgent)
		req.Header.Set("Accept-Language", "es-PE,es;q=0.9")
		return client.Do(req)
	}
	var trail []string // recorrido (estado + host/ruta) para el detalle técnico del error
	note := func(status int, u *url.URL) { trail = append(trail, fmt.Sprintf("%d %s", status, safeURL(u))) }
	fail := func(code, msg string) error { return accessErr(code, msg, strings.Join(trail, " → ")) }

	loginPage := base + "/loginMenuSol?lang=" + sunatSolLang + "&showDni=true&showLanguages=false&originalUrl=" +
		target.OriginalURL + "&state=" + target.State

	// 1) Página de login (deja las cookies de sesión que el navegador también tendría).
	req, _ := http.NewRequest(http.MethodGet, loginPage, nil)
	if resp, err := do(req); err != nil {
		return "", accessErr(SunatAccessUnavailable, "No se pudo conectar con SUNAT. Intente de nuevo en unos minutos.", "GET login: "+errSummary(err))
	} else {
		note(resp.StatusCode, resp.Request.URL)
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 1<<20))
		resp.Body.Close()
	}

	// 2) Envío del formulario de login (los mismos campos que arma el JavaScript de SUNAT).
	form := url.Values{
		"tipo":        {"2"},
		"dni":         {""},
		"custom_ruc":  {ruc},
		"j_username":  {usuario},
		"j_password":  {clave},
		"captcha":     {""},
		"originalUrl": {target.OriginalURL},
		"lang":        {sunatSolLang},
		"state":       {target.State},
	}
	req, _ = http.NewRequest(http.MethodPost, base+"/j_security_check", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Referer", loginPage)
	req.Header.Set("Origin", "https://api-seguridad.sunat.gob.pe")
	resp, err := do(req)
	if err != nil {
		return "", accessErr(SunatAccessUnavailable, "No se pudo conectar con SUNAT. Intente de nuevo en unos minutos.", "POST login: "+errSummary(err))
	}

	// 3) Seguir la cadena de redirecciones hasta la pantalla de método de autenticación (o hasta un enlace a e-menu).
	var lastPage *url.URL
	var sessionID string
	var body string
	for hop := 0; hop < sunatSolMaxHops; hop++ {
		note(resp.StatusCode, resp.Request.URL)
		cur := resp.Request.URL
		lastPage = cur

		if strings.Contains(cur.Path, "/oauth2/error") {
			resp.Body.Close()
			return "", fail(SunatAccessBadCreds, "SUNAT rechazó el usuario o la clave SOL de esta empresa.")
		}
		if id := reSessionIDInPath.FindStringSubmatch(cur.Path); id != nil {
			sessionID = id[1]
		}

		if resp.StatusCode >= 300 && resp.StatusCode < 400 {
			loc, lerr := resp.Location()
			resp.Body.Close()
			if lerr != nil {
				return "", fail(SunatAccessUnexpected, "SUNAT respondió de forma inesperada al iniciar sesión.")
			}
			if target.isFinalHost(loc) {
				// SUNAT ya entregó el enlace de un solo uso (sin pedir método): se devuelve sin seguirlo.
				return loc.String(), nil
			}
			if strings.Contains(loc.Path, "/oauth2/error") {
				return "", fail(SunatAccessBadCreds, "SUNAT rechazó el usuario o la clave SOL de esta empresa.")
			}
			if id := reSessionIDInPath.FindStringSubmatch(loc.Path); id != nil {
				sessionID = id[1]
			}
			nreq, _ := http.NewRequest(http.MethodGet, loc.String(), nil)
			nreq.Header.Set("Referer", cur.String())
			if resp, err = do(nreq); err != nil {
				return "", accessErr(SunatAccessUnavailable, "No se pudo conectar con SUNAT. Intente de nuevo en unos minutos.", "redirect: "+errSummary(err))
			}
			continue
		}

		b, _ := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
		resp.Body.Close()
		body = string(b)
		break
	}

	// ¿La página final todavía es el formulario de login? → no se completó (clave mala o captcha).
	if strings.Contains(body, `name="LoginForm"`) {
		return "", fail(SunatAccessCaptcha, "SUNAT no aceptó el ingreso (clave incorrecta o pide captcha por varios intentos fallidos). Ingrese una vez a mano en SUNAT para destrabarlo.")
	}
	// La pantalla de método de SUNAT toma el id de sesión de la cookie "SessionID" (no de la ruta): es la fuente
	// autoritativa; la ruta y el cuerpo quedan como respaldo.
	if c := sessionCookie(jar, base); c != "" {
		sessionID = c
	}
	if sessionID == "" {
		if m := reSessionIDInBody.FindStringSubmatch(body); m != nil {
			sessionID = m[1]
		}
	}
	if sessionID == "" {
		if m := target.findURLInText(strings.ReplaceAll(body, `\/`, `/`)); m != "" {
			return m, nil
		}
		return "", accessErr(SunatAccessUnexpected, "No se encontró el paso de método de autenticación en la respuesta de SUNAT.",
			strings.Join(trail, " → ")+" | cookies: "+cookieNames(jar, base))
	}

	// 4) "Continuar sin código": la misma petición que hace el botón de SUNAT; responde con el enlace de un solo uso.
	nreq, _ := http.NewRequest(http.MethodGet, base+"/redireccion-sin-codigo/"+sessionID, nil)
	nreq.Header.Set("Accept", "application/json, text/plain, */*")
	nreq.Header.Set("X-Requested-With", "XMLHttpRequest")
	if lastPage != nil {
		nreq.Header.Set("Referer", lastPage.String())
	}
	resp, err = do(nreq)
	if err != nil {
		return "", accessErr(SunatAccessUnavailable, "No se pudo conectar con SUNAT. Intente de nuevo en unos minutos.", "sin-codigo: "+errSummary(err))
	}
	note(resp.StatusCode, resp.Request.URL)
	if resp.StatusCode >= 300 && resp.StatusCode < 400 {
		loc, lerr := resp.Location()
		resp.Body.Close()
		if lerr == nil && target.isFinalHost(loc) {
			return loc.String(), nil
		}
		return "", fail(SunatAccessUnexpected, "SUNAT respondió de forma inesperada al continuar sin código.")
	}
	b, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fail(SunatAccessUnexpected, "SUNAT rechazó el paso de continuar sin código.")
	}
	if link := extractAccessURL(b, target); link != "" {
		return link, nil
	}
	return "", accessErr(SunatAccessUnexpected, "SUNAT no entregó el enlace de acceso en la respuesta esperada.",
		strings.Join(trail, " → ")+" | campos: "+jsonKeysSummary(b))
}

// findURLInText primer enlace https a uno de los hosts finales del destino dentro de un texto.
func (t sunatSolTarget) findURLInText(text string) string {
	for _, h := range t.FinalHosts {
		re := regexp.MustCompile("https://" + regexp.QuoteMeta(h) + `/[^\s"'<>\\]+`)
		if m := re.FindString(text); m != "" {
			return m
		}
	}
	return ""
}

// extractAccessURL busca en la respuesta (JSON o texto) el enlace de acceso del destino (e-menu o la casilla de SUNAFIL).
func extractAccessURL(b []byte, target sunatSolTarget) string {
	var v any
	if err := json.Unmarshal(b, &v); err == nil {
		var found, other string
		var walk func(x any)
		walk = func(x any) {
			switch t := x.(type) {
			case string:
				u, err := url.Parse(strings.TrimSpace(t))
				if err != nil || (u.Scheme != "https" && u.Scheme != "http") {
					return
				}
				if target.isFinalHost(u) && found == "" {
					found = u.String()
				} else if strings.HasSuffix(strings.ToLower(u.Hostname()), "sunat.gob.pe") && other == "" {
					other = u.String()
				}
			case map[string]any:
				for _, val := range t {
					walk(val)
				}
			case []any:
				for _, val := range t {
					walk(val)
				}
			}
		}
		walk(v)
		if found != "" {
			return found
		}
		if other != "" && strings.HasSuffix(target.FinalHosts[0], "sunat.gob.pe") {
			return other
		}
	}
	return target.findURLInText(strings.ReplaceAll(string(b), `\/`, `/`))
}

// jsonKeysSummary solo los NOMBRES de los campos (nunca los valores, que pueden llevar tokens).
func jsonKeysSummary(b []byte) string {
	var m map[string]any
	if err := json.Unmarshal(b, &m); err != nil {
		return fmt.Sprintf("no es JSON (%d bytes)", len(b))
	}
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	return strings.Join(keys, ",")
}

func errSummary(err error) string {
	var ue *url.Error
	if errors.As(err, &ue) {
		if pu, perr := url.Parse(ue.URL); perr == nil {
			return ue.Op + " " + safeURL(pu)
		}
		return ue.Op
	}
	return "error de red"
}
