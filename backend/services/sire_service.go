package services

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"miappfiber/database"
	"miappfiber/models"
)

// Cliente de la API SIRE de SUNAT (RVIE = ventas, RCE = compras). Fuente: "Manual de servicios Web Api - SIRE
// Ventas v31" y "SIRE Compras v28" (cpe.sunat.gob.pe). Fase 1: solo consulta y descarga (nada que modifique datos).
//
// Autenticación: OAuth2 "password" contra api-seguridad.sunat.gob.pe con el client_id/client_secret que la empresa
// genera en SOL (Credenciales de API SUNAT → "MIGE RCE y RVIE - SIRE") y usuario = RUC+usuario SOL, clave = clave SOL.
// La API no se puede llamar desde el navegador (CORS): todo pasa por este servicio.

const (
	sireTokenBase = "https://api-seguridad.sunat.gob.pe/v1/clientessol"
	sireAPIBase   = "https://api-sire.sunat.gob.pe"
	sireScope     = "https://api-sire.sunat.gob.pe"
	sireLibroPath = "/v1/contribuyente/migeigv/libros/"

	sireLibroVentas  = "ventas"
	sireLibroCompras = "compras"

	sireCodLibroVentas  = "140000"
	sireCodLibroCompras = "080000"

	sireAccessTarget = "sire"

	sireTokenFallbackTTL = 5 * time.Minute
	sireBadCredsCooldown = 3 * time.Minute
	sireMaxBody          = 200 << 20 // tope de lo que se lee de una descarga (200 MB)
)

// Códigos de error estables (el frontend decide qué mostrar según el código).
const (
	SireErrMissingData   = "faltan_datos"
	SireErrBadCreds      = "credenciales_api_invalidas"
	SireErrCooldown      = "credenciales_en_pausa"
	SireErrForbidden     = "sin_permiso_sunat"
	SireErrUnavailable   = "sunat_no_disponible"
	SireErrValidation    = "sunat_validacion"
	SireErrUnexpected    = "respuesta_inesperada"
	SireErrOutOfScope    = "sin_acceso"
	SireErrInvalidParams = "parametros_invalidos"
)

// SireError error legible para el usuario, con el motivo de SUNAT cuando lo informa.
type SireError struct {
	Code    string
	Message string
	Detail  string
}

func (e *SireError) Error() string { return e.Message }

func sireErr(code, msg, detail string) *SireError { return &SireError{Code: code, Message: msg, Detail: detail} }

// SireCreds datos necesarios para hablar con la API SIRE de una empresa.
type SireCreds struct {
	CompanyID    uint
	RUC          string
	SolUsuario   string
	SolClave     string
	ClientID     string
	ClientSecret string
}

func (c SireCreds) fingerprint() string {
	h := sha256.Sum256([]byte(strings.Join([]string{c.RUC, c.SolUsuario, c.SolClave, c.ClientID, c.ClientSecret}, "\x00")))
	return hex.EncodeToString(h[:])
}

func (c SireCreds) missing() string {
	switch {
	case strings.TrimSpace(c.RUC) == "":
		return "el RUC"
	case strings.TrimSpace(c.SolUsuario) == "":
		return "el usuario SOL"
	case strings.TrimSpace(c.SolClave) == "":
		return "la clave SOL"
	case strings.TrimSpace(c.ClientID) == "":
		return "el Client ID de la API SIRE"
	case strings.TrimSpace(c.ClientSecret) == "":
		return "el Client Secret de la API SIRE"
	}
	return ""
}

type sireToken struct {
	value   string
	expires time.Time
	finger  string
}

type sireCachedFile struct {
	data    []byte
	expires time.Time
}

// SireService servicio compartido (caché de tokens y de archivos descargados en memoria).
type SireService struct {
	creds *CompanyAccessCredentialService

	tokenBase string // inyectables para pruebas
	apiBase   string
	http      *http.Client

	mu       sync.Mutex
	tokens   map[uint]sireToken
	badUntil map[string]time.Time
	locks    map[uint]*sync.Mutex
	files    map[string]sireCachedFile
}

func NewSireService() *SireService {
	return &SireService{
		creds:     NewCompanyAccessCredentialService(),
		tokenBase: sireTokenBase,
		apiBase:   sireAPIBase,
		http:      &http.Client{Timeout: 2 * time.Minute},
		tokens:    map[uint]sireToken{},
		badUntil:  map[string]time.Time{},
		locks:     map[uint]*sync.Mutex{},
		files:     map[string]sireCachedFile{},
	}
}

// SireSession acceso a la API SIRE de UNA empresa (credenciales ya cargadas).
type SireSession struct {
	svc   *SireService
	creds SireCreds
}

// Session carga las credenciales de la empresa (validando que esté en el alcance del usuario).
func (s *SireService) Session(companyID uint, allowed []uint) (*SireSession, error) {
	row, err := s.creds.GetByCompanyID(companyID, allowed)
	if err != nil {
		return nil, sireErr(SireErrOutOfScope, "No tiene acceso a esta empresa.", err.Error())
	}
	return s.SessionFromCreds(SireCreds{
		CompanyID:    companyID,
		RUC:          row.RUC,
		SolUsuario:   row.SolUsuario,
		SolClave:     row.SolClave,
		ClientID:     row.SireClientID,
		ClientSecret: row.SireClientSecret,
	})
}

// SessionFromCreds permite construir la sesión con credenciales ya conocidas (pruebas).
func (s *SireService) SessionFromCreds(c SireCreds) (*SireSession, error) {
	c.RUC, c.SolUsuario, c.SolClave = strings.TrimSpace(c.RUC), strings.TrimSpace(c.SolUsuario), strings.TrimSpace(c.SolClave)
	c.ClientID, c.ClientSecret = strings.TrimSpace(c.ClientID), strings.TrimSpace(c.ClientSecret)
	if m := c.missing(); m != "" {
		return nil, sireErr(SireErrMissingData, "Falta "+m+" de esta empresa. Complételo en Claves SOL con el botón Editar.", "")
	}
	return &SireSession{svc: s, creds: c}, nil
}

// LogAccess deja en la bitácora quién consultó el SIRE de qué empresa (nunca claves ni datos).
func (s *SireService) LogAccess(companyID, userID uint, err error) {
	status, code := sunatAccessStatusOK, ""
	if err != nil {
		status = sunatAccessStatusErr
		var se *SireError
		if errors.As(err, &se) {
			code = se.Code
		} else {
			code = "interno"
		}
	}
	if dbErr := database.DB.Create(&models.CompanyAccessLog{
		CompanyID: companyID, UserID: userID, Target: sireAccessTarget, Status: status, ErrorCode: code,
	}).Error; dbErr != nil {
		log.Printf("sire: no se pudo registrar la bitácora: %v", dbErr)
	}
}

// ───────────────────────────── Token ─────────────────────────────

func (s *SireService) lockFor(companyID uint) *sync.Mutex {
	s.mu.Lock()
	defer s.mu.Unlock()
	l, ok := s.locks[companyID]
	if !ok {
		l = &sync.Mutex{}
		s.locks[companyID] = l
	}
	return l
}

func (s *SireService) invalidateToken(companyID uint) {
	s.mu.Lock()
	delete(s.tokens, companyID)
	s.mu.Unlock()
}

// token devuelve un token vigente (en caché mientras no venza o cambien las credenciales).
func (ss *SireSession) token() (string, error) {
	s, c := ss.svc, ss.creds
	fp := c.fingerprint()

	lock := s.lockFor(c.CompanyID)
	lock.Lock()
	defer lock.Unlock()

	s.mu.Lock()
	if t, ok := s.tokens[c.CompanyID]; ok && t.finger == fp && time.Now().Before(t.expires) {
		s.mu.Unlock()
		return t.value, nil
	}
	if until, ok := s.badUntil[fp]; ok && time.Now().Before(until) {
		s.mu.Unlock()
		return "", sireErr(SireErrCooldown,
			"SUNAT rechazó estas credenciales hace poco. Se pausó el reintento para no bloquear la clave SOL: corrija los datos en Claves SOL (Editar) o espere unos minutos.", "")
	}
	s.mu.Unlock()

	form := url.Values{
		"grant_type":    {"password"},
		"scope":         {sireScope},
		"client_id":     {c.ClientID},
		"client_secret": {c.ClientSecret},
		"username":      {c.RUC + c.SolUsuario},
		"password":      {c.SolClave},
	}
	endpoint := s.tokenBase + "/" + url.PathEscape(c.ClientID) + "/oauth2/token/"
	req, _ := http.NewRequest(http.MethodPost, endpoint, strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	resp, err := s.http.Do(req)
	if err != nil {
		return "", sireErr(SireErrUnavailable, "No se pudo conectar con SUNAT para obtener el token. Intente de nuevo en unos minutos.", errSummary(err))
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))

	if resp.StatusCode != http.StatusOK {
		detail := tokenErrorSummary(body)
		if resp.StatusCode == http.StatusBadRequest || resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
			s.mu.Lock()
			s.badUntil[fp] = time.Now().Add(sireBadCredsCooldown)
			s.mu.Unlock()
			return "", sireErr(SireErrBadCreds,
				"SUNAT no aceptó las credenciales de la API SIRE de esta empresa (Client ID/Secret, usuario o clave SOL). Revíselas en Claves SOL (Editar).",
				fmt.Sprintf("HTTP %d %s", resp.StatusCode, detail))
		}
		return "", sireErr(SireErrUnavailable, "SUNAT no pudo entregar el token en este momento. Intente de nuevo en unos minutos.",
			fmt.Sprintf("HTTP %d %s", resp.StatusCode, detail))
	}

	var tr struct {
		AccessToken string `json:"access_token"`
		ExpiresIn   any    `json:"expires_in"`
	}
	if err := json.Unmarshal(body, &tr); err != nil || strings.TrimSpace(tr.AccessToken) == "" {
		return "", sireErr(SireErrUnexpected, "SUNAT respondió sin token de acceso.", "campos: "+jsonKeysSummary(body))
	}
	ttl := sireTokenFallbackTTL
	if secs := toInt(tr.ExpiresIn); secs > 90 {
		ttl = time.Duration(secs-60) * time.Second
	} else if secs > 0 {
		ttl = time.Duration(secs) * time.Second / 2
	}
	s.mu.Lock()
	s.tokens[c.CompanyID] = sireToken{value: tr.AccessToken, expires: time.Now().Add(ttl), finger: fp}
	s.mu.Unlock()
	return tr.AccessToken, nil
}

func toInt(v any) int {
	switch x := v.(type) {
	case float64:
		return int(x)
	case string:
		n, _ := strconv.Atoi(strings.TrimSpace(x))
		return n
	case json.Number:
		n, _ := x.Int64()
		return int(n)
	}
	return 0
}

// tokenErrorSummary solo el tipo y la descripción del error de OAuth (nunca credenciales).
func tokenErrorSummary(b []byte) string {
	var v struct {
		Error       string `json:"error"`
		Description string `json:"error_description"`
		Msg         string `json:"msg"`
		Cod         any    `json:"cod"`
	}
	if err := json.Unmarshal(b, &v); err != nil {
		return fmt.Sprintf("(respuesta no JSON, %d bytes)", len(b))
	}
	parts := []string{}
	for _, p := range []string{v.Error, v.Description, v.Msg} {
		if strings.TrimSpace(p) != "" {
			parts = append(parts, strings.TrimSpace(p))
		}
	}
	if v.Cod != nil {
		parts = append(parts, fmt.Sprintf("cod=%v", v.Cod))
	}
	out := strings.Join(parts, " · ")
	if len(out) > 300 {
		out = out[:300] + "…"
	}
	return out
}

// ───────────────────────────── Llamadas ─────────────────────────────

// SireResponse respuesta cruda de SUNAT (ya validada: solo llega con 2xx).
type SireResponse struct {
	Status      int
	ContentType string
	Disposition string
	Body        []byte
}

// call hace una petición autenticada. path va relativo a /v1/contribuyente/migeigv/libros/.
func (ss *SireSession) call(method, path string, query url.Values) (*SireResponse, error) {
	for attempt := 0; attempt < 2; attempt++ {
		tok, err := ss.token()
		if err != nil {
			return nil, err
		}
		u := ss.svc.apiBase + sireLibroPath + path
		if len(query) > 0 {
			u += "?" + query.Encode()
		}
		req, _ := http.NewRequest(method, u, nil)
		req.Header.Set("Authorization", "Bearer "+tok)
		req.Header.Set("Accept", "application/json, text/plain, */*")
		resp, err := ss.svc.http.Do(req)
		if err != nil {
			return nil, sireErr(SireErrUnavailable, "No se pudo conectar con SUNAT. Intente de nuevo en unos minutos.", errSummary(err))
		}
		body, rerr := io.ReadAll(io.LimitReader(resp.Body, sireMaxBody))
		resp.Body.Close()
		if rerr != nil {
			return nil, sireErr(SireErrUnavailable, "Se interrumpió la descarga desde SUNAT. Intente de nuevo.", errSummary(rerr))
		}
		if resp.StatusCode == http.StatusUnauthorized && attempt == 0 {
			ss.svc.invalidateToken(ss.creds.CompanyID) // token vencido: se pide otro una vez
			continue
		}
		if resp.StatusCode >= 200 && resp.StatusCode < 300 {
			return &SireResponse{
				Status:      resp.StatusCode,
				ContentType: resp.Header.Get("Content-Type"),
				Disposition: resp.Header.Get("Content-Disposition"),
				Body:        body,
			}, nil
		}
		return nil, sireHTTPError(resp.StatusCode, body)
	}
	return nil, sireErr(SireErrBadCreds, "SUNAT rechazó el acceso a la API SIRE con el token generado.", "HTTP 401 repetido")
}

// sireHTTPError traduce un estado de error de SUNAT a un SireError con el mensaje de SUNAT.
func sireHTTPError(status int, body []byte) *SireError {
	info := sunatErrorSummary(body)
	switch {
	case status == http.StatusUnprocessableEntity || status == http.StatusBadRequest:
		msg, cod := sireFirstValidationMessage(body)
		if msg == "" {
			msg = "SUNAT no aceptó la consulta."
		}
		return sireErr(SireErrValidation, msg, "cod "+cod+" · "+info)
	case status == http.StatusUnauthorized:
		return sireErr(SireErrBadCreds, "SUNAT rechazó el acceso con estas credenciales.", "HTTP 401 · "+info)
	case status == http.StatusForbidden:
		return sireErr(SireErrForbidden, "Las credenciales de API de esta empresa no tienen permiso para este servicio del SIRE. Verifique en SOL que la aplicación tenga marcado \"MIGE RCE y RVIE - SIRE\".", "HTTP 403 · "+info)
	case status == http.StatusNotFound:
		return sireErr(SireErrValidation, "SUNAT no encontró información para esta consulta.", "HTTP 404 · "+info)
	case status >= 500:
		return sireErr(SireErrUnavailable, "SUNAT no pudo atender la consulta en este momento. Intente de nuevo en unos minutos.", fmt.Sprintf("HTTP %d · %s", status, info))
	}
	return sireErr(SireErrUnexpected, "SUNAT respondió de forma inesperada.", fmt.Sprintf("HTTP %d · %s", status, info))
}

// sireFirstValidationMessage primer mensaje de {"errors":[{"cod","msg"}]} o del propio {"msg"}.
func sireFirstValidationMessage(b []byte) (msg, cod string) {
	var v struct {
		Cod    any    `json:"cod"`
		Msg    string `json:"msg"`
		Errors []struct {
			Cod any    `json:"cod"`
			Msg string `json:"msg"`
		} `json:"errors"`
	}
	if err := json.Unmarshal(b, &v); err != nil {
		return "", ""
	}
	if len(v.Errors) > 0 && strings.TrimSpace(v.Errors[0].Msg) != "" {
		return strings.TrimSpace(v.Errors[0].Msg), fmt.Sprintf("%v", v.Errors[0].Cod)
	}
	return strings.TrimSpace(v.Msg), fmt.Sprintf("%v", v.Cod)
}

// JSON llama y decodifica la respuesta como JSON genérico.
func (ss *SireSession) JSON(method, path string, query url.Values) (any, error) {
	r, err := ss.call(method, path, query)
	if err != nil {
		return nil, err
	}
	if len(bytes.TrimSpace(r.Body)) == 0 {
		return nil, nil
	}
	var v any
	if err := json.Unmarshal(r.Body, &v); err != nil {
		return nil, sireErr(SireErrUnexpected, "SUNAT no devolvió un JSON válido.", fmt.Sprintf("%d bytes, %s", len(r.Body), r.ContentType))
	}
	return v, nil
}

var sirePeriodRe = regexp.MustCompile(`^\d{6}$`)

// ValidSirePeriod período tributario AAAAMM (mes 01–12).
func ValidSirePeriod(p string) bool {
	if !sirePeriodRe.MatchString(p) {
		return false
	}
	m, _ := strconv.Atoi(p[4:])
	return m >= 1 && m <= 12
}

// SireCodLibro código de libro de SUNAT ("" si el libro no es válido).
func SireCodLibro(libro string) string {
	switch libro {
	case sireLibroVentas:
		return sireCodLibroVentas
	case sireLibroCompras:
		return sireCodLibroCompras
	}
	return ""
}

// ───────────────────────────── Caché de archivos ─────────────────────────────

const (
	sireFileCacheTTL = 15 * time.Minute
	sireFileCacheMax = 24
)

func (s *SireService) cacheGet(key string) ([]byte, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	f, ok := s.files[key]
	if !ok || time.Now().After(f.expires) {
		delete(s.files, key)
		return nil, false
	}
	return f.data, true
}

func (s *SireService) cachePut(key string, data []byte) {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now()
	for k, f := range s.files {
		if now.After(f.expires) {
			delete(s.files, k)
		}
	}
	for len(s.files) >= sireFileCacheMax { // descarta el que vence primero
		var oldK string
		var oldT time.Time
		for k, f := range s.files {
			if oldK == "" || f.expires.Before(oldT) {
				oldK, oldT = k, f.expires
			}
		}
		delete(s.files, oldK)
	}
	s.files[key] = sireCachedFile{data: data, expires: now.Add(sireFileCacheTTL)}
}
