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
	"os"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
	"unicode/utf8"

	"miappfiber/database"
	"miappfiber/models"
)

// Sincronización del Buzón Electrónico SOL (notificaciones y mensajes de SUNAT) de cada empresa.
//
// SUNAT no tiene API para el buzón, así que el servidor hace lo que haría un navegador: entra a SOL con la clave
// guardada de la empresa, abre el visor del buzón (ol-ti-itvisornoti) y lee el LISTADO de notificaciones y mensajes.
// Nunca abre el detalle de un mensaje (eso lo marca como leído en SUNAT) ni descarga adjuntos. Al terminar cierra la
// sesión de SOL. Solo se sincroniza UNA empresa a la vez (SUNAT permite una sesión por usuario y muchos ingresos
// seguidos pueden bloquear la clave).
//
// Reglas de seguridad: no se loguea ninguna clave, cookie ni enlace — solo códigos de resultado.

const (
	BuzonSourceManual  = "manual"
	BuzonSourceNightly = "nocturna"
	// BuzonSourceScheduled pasadas programadas durante el día (la de la madrugada se sigue llamando «nocturna»).
	BuzonSourceScheduled = "programada"

	buzonAccessTarget = "buzon"
	buzonMaxPages     = 60
	buzonNightlyHour  = 1
	// Pausa entre empresas en la sincronización nocturna (no encadenar ingresos a SOL).
	buzonNightlyPause = 6 * time.Second
	// Tras tantas empresas seguidas con error de SUNAT (caída o bloqueo de IP) se corta la corrida nocturna.
	buzonNightlyMaxConsecutiveErrors = 5

	BuzonErrNoKey      = "sin_clave"
	BuzonErrRejected   = "credenciales_rechazadas"
	BuzonErrInProgress = "en_curso"
	BuzonErrOutOfScope = "sin_acceso"
	BuzonErrUnexpected = "respuesta_inesperada"
)

// BuzonEtiquetas etiquetas con que SUNAT clasifica las notificaciones.
var BuzonEtiquetas = map[string]string{
	"00": "Sin etiqueta",
	"10": "Valores",
	"11": "Resoluciones de cobranza",
	"12": "Resoluciones de fraccionamiento",
	"13": "Resoluciones no contenciosas",
	"14": "Resoluciones de fiscalización",
	"15": "Notificaciones anteriores",
	"16": "Avisos",
	"18": "Inspección no intrusiva",
	"19": "Requerimientos diversos",
	"20": "Cartas",
}

// BuzonError error con código estable y mensaje para el usuario.
type BuzonError struct {
	Code    string
	Message string
	Detail  string
}

func (e *BuzonError) Error() string { return e.Message }

func buzonErr(code, msg, detail string) *BuzonError {
	return &BuzonError{Code: code, Message: msg, Detail: detail}
}

// buzonRow una fila del listado de SUNAT.
type buzonRow struct {
	CodMensaje      flexStr `json:"codMensaje"`
	IndEstado       flexNum `json:"indEstado"`
	IndDesta        flexNum `json:"indDesta"`
	IndUrg          flexNum `json:"indUrg"`
	IndTipmsj       flexNum `json:"indTipmsj"`
	DesAsunto       string  `json:"desAsunto"`
	FecPublica      string  `json:"fecPublica"`
	FecEnvio        string  `json:"fecEnvio"`
	CodUsremisor    flexStr `json:"codUsremisor"`
	CodDepen        flexStr `json:"codDepen"`
	CantidadArchAdj flexNum `json:"cantidadArchAdj"`
	CodEtiqueta     flexStr `json:"codEtiqueta"`
}

type buzonItem struct {
	tipo int
	row  buzonRow
	raw  string
}

// SunatBuzonService sincroniza y consulta el buzón guardado. Hay UNA instancia compartida (ver SharedSunatBuzonService)
// porque el candado de "una empresa a la vez" debe ser común al botón manual y a la corrida nocturna.
type SunatBuzonService struct {
	creds *CompanyAccessCredentialService
	// loginFn entrega el enlace de ingreso a SOL (en pruebas se reemplaza).
	loginFn func(ruc, usuario, clave string) (string, error)
	timeout time.Duration

	mu      sync.Mutex // una sincronización a la vez
	current atomic.Uint32
	// curSource origen de la sincronización en curso («manual», «nocturna», «programada»).
	curSource atomic.Value
	// manualWaiting personas esperando su turno para una sincronización manual: la corrida programada les cede el paso
	// antes de empezar con la siguiente empresa (una pasada de todo el estudio dura más de media hora).
	manualWaiting atomic.Int32
}

var (
	buzonOnce   sync.Once
	buzonShared *SunatBuzonService
)

// SharedSunatBuzonService instancia única del servicio.
func SharedSunatBuzonService() *SunatBuzonService {
	buzonOnce.Do(func() { buzonShared = NewSunatBuzonService() })
	return buzonShared
}

func NewSunatBuzonService() *SunatBuzonService {
	sol := NewSunatSolAccessService()
	return &SunatBuzonService{
		creds: NewCompanyAccessCredentialService(),
		loginFn: func(ruc, usuario, clave string) (string, error) {
			// Igual que el formulario de SUNAT: usuario en mayúsculas y recortado a 8, clave a 12 (ver browserSolInput).
			usuario, clave = browserSolInput(usuario, clave)
			return sol.login(sunatSolTargets[sunatAccessTargetSunat], ruc, usuario, clave)
		},
		timeout: 40 * time.Second,
	}
}

// RunningCompany empresa que se está sincronizando ahora (0 = ninguna).
func (s *SunatBuzonService) RunningCompany() uint { return uint(s.current.Load()) }

func buzonFingerprint(usuario, clave string) string {
	h := sha256.Sum256([]byte(usuario + "\x00" + clave))
	return hex.EncodeToString(h[:])
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}

// fixMojibake SUNAT entrega algunos textos con UTF-8 leído como latin-1 («NotificaciÃ³n»): se corrige.
func fixMojibake(s string) string {
	if !strings.ContainsAny(s, "ÃÂ") {
		return s
	}
	b := make([]byte, 0, len(s))
	for _, r := range s {
		if r > 0xFF {
			return s
		}
		b = append(b, byte(r))
	}
	if utf8.Valid(b) {
		return string(b)
	}
	return s
}

func parseBuzonDate(s string) *time.Time {
	loc := limaLoc
	if loc == nil {
		loc = time.UTC
	}
	for _, layout := range []string{"02/01/2006 15:04:05", "02/01/2006"} {
		if t, err := time.ParseInLocation(layout, strings.TrimSpace(s), loc); err == nil {
			return &t
		}
	}
	return nil
}

// ───────────────────────────── Estado y consulta ─────────────────────────────

// State estado guardado de la empresa (nil si nunca se sincronizó).
func (s *SunatBuzonService) State(companyID uint) *models.SunatBuzonSync {
	var st models.SunatBuzonSync
	if err := database.DB.Where("company_id = ?", companyID).First(&st).Error; err != nil {
		return nil
	}
	if st.Status == models.SunatBuzonStatusRechazadas {
		var cr models.CompanyAccessCredential
		if database.DB.Where("company_id = ?", companyID).First(&cr).Error == nil {
			st.Blocked = st.CredFingerprint == buzonFingerprint(strings.TrimSpace(cr.SolUsuario), strings.TrimSpace(cr.SolClave))
		}
	}
	st.NotifNoLeidas = s.notifUnreadByCompany([]uint{companyID})[companyID]
	return &st
}

// States estados de varias empresas (las que no tienen fila no aparecen).
func (s *SunatBuzonService) States(companyIDs []uint) (map[uint]models.SunatBuzonSync, error) {
	out := map[uint]models.SunatBuzonSync{}
	if len(companyIDs) == 0 {
		return out, nil
	}
	var rows []models.SunatBuzonSync
	if err := database.DB.Where("company_id IN ?", companyIDs).Find(&rows).Error; err != nil {
		return nil, err
	}
	creds := map[uint]models.CompanyAccessCredential{}
	var cr []models.CompanyAccessCredential
	if database.DB.Where("company_id IN ?", companyIDs).Find(&cr).Error == nil {
		for _, c := range cr {
			creds[c.CompanyID] = c
		}
	}
	unread := s.notifUnreadByCompany(companyIDs)
	for _, r := range rows {
		if c, ok := creds[r.CompanyID]; ok && r.Status == models.SunatBuzonStatusRechazadas {
			r.Blocked = r.CredFingerprint == buzonFingerprint(strings.TrimSpace(c.SolUsuario), strings.TrimSpace(c.SolClave))
		}
		r.NotifNoLeidas = unread[r.CompanyID]
		out[r.CompanyID] = r
	}
	return out, nil
}

// BuzonFilter filtros del listado guardado.
type BuzonFilter struct {
	Tipo       int // 0 todos, 1 mensajes, 2 notificaciones
	Etiqueta   string
	OnlyUnread bool
	OnlyUrgent bool
	OnlyNew    bool
	Q          string
	Page       int
	PerPage    int
}

// BuzonPage resultado paginado.
type BuzonPage struct {
	Rows    []models.SunatBuzonMessage `json:"rows"`
	Total   int64                      `json:"total"`
	Page    int                        `json:"page"`
	PerPage int                        `json:"per_page"`
}

// Messages listado guardado de una empresa (solo lo que sigue en el buzón de SUNAT).
func (s *SunatBuzonService) Messages(companyID uint, f BuzonFilter) (*BuzonPage, error) {
	if f.Page < 1 {
		f.Page = 1
	}
	if f.PerPage < 1 || f.PerPage > 100 {
		f.PerPage = 25
	}
	q := database.DB.Model(&models.SunatBuzonMessage{}).Where("company_id = ? AND en_buzon = ?", companyID, true)
	if f.Tipo == 1 || f.Tipo == 2 {
		q = q.Where("tipo = ?", f.Tipo)
	}
	if e := strings.TrimSpace(f.Etiqueta); e != "" {
		q = q.Where("cod_etiqueta = ?", e)
	}
	if f.OnlyUnread {
		q = q.Where("leido = ?", false)
	}
	if f.OnlyUrgent {
		q = q.Where("urgente = ?", true)
	}
	if f.OnlyNew {
		q = q.Where("es_nuevo = ?", true)
	}
	if t := strings.TrimSpace(f.Q); t != "" {
		q = q.Where("asunto LIKE ?", "%"+t+"%")
	}
	var total int64
	if err := q.Count(&total).Error; err != nil {
		return nil, err
	}
	var rows []models.SunatBuzonMessage
	if err := q.Order("fec_publica DESC, cod_mensaje DESC").Limit(f.PerPage).Offset((f.Page - 1) * f.PerPage).Find(&rows).Error; err != nil {
		return nil, err
	}
	return &BuzonPage{Rows: rows, Total: total, Page: f.Page, PerPage: f.PerPage}, nil
}

// MarkSeen quita la marca "nuevo" de lo ya visto por el usuario.
func (s *SunatBuzonService) MarkSeen(companyID uint) error {
	if err := database.DB.Model(&models.SunatBuzonMessage{}).Where("company_id = ? AND es_nuevo = ?", companyID, true).Update("es_nuevo", false).Error; err != nil {
		return err
	}
	return database.DB.Model(&models.SunatBuzonSync{}).Where("company_id = ?", companyID).Update("nuevos", 0).Error
}

// ───────────────────────────── Sincronización ─────────────────────────────

// SyncCompany sincroniza el buzón de UNA empresa. `allowed` es el alcance del usuario (nil = todo el estudio).
// Con wait=false, si ya hay otra sincronización en curso responde de inmediato con el código "en_curso".
func (s *SunatBuzonService) SyncCompany(companyID uint, allowed []uint, source string, userID uint, wait bool) (*models.SunatBuzonSync, error) {
	st, err, _ := s.syncCompany(companyID, allowed, source, userID, wait)
	return st, err
}

// syncCompany devuelve además si se llamó a SUNAT (para espaciar los ingresos en la corrida nocturna).
func (s *SunatBuzonService) syncCompany(companyID uint, allowed []uint, source string, userID uint, wait bool) (*models.SunatBuzonSync, error, bool) {
	row, err := s.creds.GetByCompanyID(companyID, allowed)
	if err != nil {
		return nil, buzonErr(BuzonErrOutOfScope, "No tiene acceso a esta empresa.", err.Error()), false
	}
	st := s.State(companyID)
	if st == nil {
		st = &models.SunatBuzonSync{CompanyID: companyID}
	}
	st.Source, st.TriggeredBy = source, userID

	ruc, usuario, clave := strings.TrimSpace(row.RUC), strings.TrimSpace(row.SolUsuario), strings.TrimSpace(row.SolClave)
	if ruc == "" || usuario == "" || clave == "" {
		st.Status, st.ErrorCode = models.SunatBuzonStatusSinClave, BuzonErrNoKey
		st.ErrorMessage = "La empresa no tiene usuario o clave SOL cargados (Claves SOL → Editar)."
		_ = s.saveState(st)
		return st, buzonErr(BuzonErrNoKey, st.ErrorMessage, ""), false
	}
	fp := buzonFingerprint(usuario, clave)
	// SUNAT ya rechazó estas mismas credenciales: no se insiste hasta que se corrijan (evita bloquear la clave).
	if st.Status == models.SunatBuzonStatusRechazadas && st.CredFingerprint == fp {
		return st, buzonErr(BuzonErrRejected, "SUNAT rechazó el usuario o la clave SOL de esta empresa. Corríjalos en Claves SOL (Editar) para volver a sincronizar.", ""), false
	}

	switch {
	case wait:
		// Corrida programada: antes de empezar con otra empresa cede el paso a quien espera una sincronización manual.
		for i := 0; i < 600 && s.manualWaiting.Load() > 0; i++ {
			time.Sleep(200 * time.Millisecond)
		}
		s.mu.Lock()
	case !s.mu.TryLock():
		// Si lo que está corriendo es una pasada programada, la sincronización manual tiene prioridad: espera a que termine la
		// empresa actual (segundos) en vez de rechazarse. Si es otra manual, se responde como siempre «en curso».
		if src, _ := s.curSource.Load().(string); src == "" || src == BuzonSourceManual {
			return st, buzonErr(BuzonErrInProgress, s.busyMessage(), ""), false
		}
		s.manualWaiting.Add(1)
		s.mu.Lock()
		s.manualWaiting.Add(-1)
	}
	defer s.mu.Unlock()
	s.current.Store(uint32(companyID))
	defer s.current.Store(0)
	s.curSource.Store(source)
	defer s.curSource.Store("")

	started := time.Now()
	now := started.Truncate(time.Second) // MySQL guarda las fechas sin fracción
	st.LastAttemptAt = &now
	items, runErr := s.fetch(ruc, usuario, clave)
	st.DurationMs = int(time.Since(started).Milliseconds())
	if runErr == nil && len(items) == 0 {
		// Un buzón que de pronto sale vacío es casi seguro una respuesta defectuosa de SUNAT: no se borra lo guardado.
		var previous int64
		database.DB.Model(&models.SunatBuzonMessage{}).Where("company_id = ? AND en_buzon = ?", companyID, true).Count(&previous)
		if previous > 0 {
			runErr = accessErr(SunatAccessUnexpected, "SUNAT devolvió el buzón vacío; se conservó lo ya guardado. Intente de nuevo más tarde.", "listado vacío con mensajes guardados")
		}
	}

	if runErr != nil {
		be := toBuzonError(runErr)
		st.Status, st.ErrorCode, st.ErrorMessage = models.SunatBuzonStatusError, be.Code, truncate(be.Message, 600)
		if be.Code == SunatAccessBadCreds {
			st.Status, st.ErrorCode, st.CredFingerprint = models.SunatBuzonStatusRechazadas, BuzonErrRejected, fp
			be.Code = BuzonErrRejected
		}
		_ = s.saveState(st)
		s.logAccess(companyID, userID, be.Code)
		return st, be, true
	}

	if err := s.persist(st, items, now); err != nil {
		st.Status, st.ErrorCode, st.ErrorMessage = models.SunatBuzonStatusError, "interno", "No se pudo guardar la información del buzón."
		_ = s.saveState(st)
		s.logAccess(companyID, userID, "interno")
		log.Printf("buzon: guardar empresa %d: %v", companyID, err)
		return st, buzonErr("interno", st.ErrorMessage, ""), true
	}
	s.logAccess(companyID, userID, "")
	return st, nil, true
}

func (s *SunatBuzonService) busyMessage() string {
	if id := s.RunningCompany(); id != 0 {
		var name string
		_ = database.DB.Model(&models.Company{}).Where("id = ?", id).Select("business_name").Scan(&name).Error
		if name != "" {
			return "Hay otra sincronización en curso (" + name + "). Espere a que termine e intente de nuevo."
		}
	}
	return "Hay otra sincronización en curso. Espere a que termine e intente de nuevo."
}

func (s *SunatBuzonService) logAccess(companyID, userID uint, code string) {
	status := sunatAccessStatusOK
	if code != "" {
		status = sunatAccessStatusErr
	}
	if err := database.DB.Create(&models.CompanyAccessLog{CompanyID: companyID, UserID: userID, Target: buzonAccessTarget, Status: status, ErrorCode: code}).Error; err != nil {
		log.Printf("buzon: no se pudo registrar la bitácora: %v", err)
	}
}

func (s *SunatBuzonService) saveState(st *models.SunatBuzonSync) error {
	return database.DB.Save(st).Error
}

func toBuzonError(err error) *BuzonError {
	var be *BuzonError
	if errors.As(err, &be) {
		return be
	}
	var ae *SunatSolAccessError
	if errors.As(err, &ae) {
		return buzonErr(ae.Code, ae.Message, ae.Detail)
	}
	return buzonErr(BuzonErrUnexpected, "SUNAT respondió de forma inesperada.", err.Error())
}

// persist guarda el listado (altas y cambios) y deja el estado de la empresa con los totales.
func (s *SunatBuzonService) persist(st *models.SunatBuzonSync, items []buzonItem, now time.Time) error {
	companyID := st.CompanyID
	var existing []models.SunatBuzonMessage
	if err := database.DB.Where("company_id = ?", companyID).Find(&existing).Error; err != nil {
		return err
	}
	byCod := make(map[uint64]*models.SunatBuzonMessage, len(existing))
	for i := range existing {
		byCod[existing[i].CodMensaje] = &existing[i]
	}
	baseline := st.BaselineDone

	tx := database.DB.Begin()
	if tx.Error != nil {
		return tx.Error
	}
	seen := make(map[uint64]bool, len(items))
	for _, it := range items {
		cod, err := strconv.ParseUint(strings.TrimSpace(string(it.row.CodMensaje)), 10, 64)
		if err != nil || cod == 0 {
			continue
		}
		seen[cod] = true
		leido := int(it.row.IndEstado) != 0
		urg := int(it.row.IndUrg) == 1
		dest := int(it.row.IndDesta) == 1
		adj := int(it.row.CantidadArchAdj)
		if cur, ok := byCod[cod]; ok {
			cur.Tipo, cur.Leido, cur.Urgente, cur.Destacado, cur.Adjuntos = it.tipo, leido, urg, dest, adj
			cur.EnBuzon, cur.LastSeenAt, cur.Raw = true, now, it.raw
			if err := tx.Save(cur).Error; err != nil {
				tx.Rollback()
				return err
			}
			continue
		}
		fecTxt := strings.TrimSpace(it.row.FecPublica)
		if fecTxt == "" {
			fecTxt = strings.TrimSpace(it.row.FecEnvio)
		}
		m := models.SunatBuzonMessage{
			CompanyID: companyID, CodMensaje: cod, Tipo: it.tipo,
			Asunto: fixMojibake(strings.TrimSpace(it.row.DesAsunto)), FecPublica: parseBuzonDate(fecTxt), FecPublicaTexto: truncate(fecTxt, 30),
			Remitente: truncate(string(it.row.CodUsremisor), 60), CodDepen: truncate(string(it.row.CodDepen), 20), CodEtiqueta: truncate(string(it.row.CodEtiqueta), 4),
			Adjuntos: adj, Leido: leido, Urgente: urg, Destacado: dest, EnBuzon: true,
			// En la primera sincronización todo es "lo que ya había": solo se marca nuevo lo que aparece después.
			EsNuevo:     baseline,
			FirstSeenAt: now, LastSeenAt: now, Raw: it.raw,
		}
		if err := tx.Create(&m).Error; err != nil {
			tx.Rollback()
			return err
		}
	}
	// Lo que SUNAT ya no lista (eliminado o movido a otra carpeta) queda guardado pero fuera del buzón.
	var gone []uint
	for i := range existing {
		if existing[i].EnBuzon && !seen[existing[i].CodMensaje] {
			gone = append(gone, existing[i].ID)
		}
	}
	for start := 0; start < len(gone); start += 500 {
		end := start + 500
		if end > len(gone) {
			end = len(gone)
		}
		if err := tx.Model(&models.SunatBuzonMessage{}).Where("id IN ?", gone[start:end]).Update("en_buzon", false).Error; err != nil {
			tx.Rollback()
			return err
		}
	}
	if err := tx.Commit().Error; err != nil {
		return err
	}

	count := func(where string, args ...any) int {
		var n int64
		database.DB.Model(&models.SunatBuzonMessage{}).Where("company_id = ? AND en_buzon = ?", companyID, true).Where(where, args...).Count(&n)
		return int(n)
	}
	st.Notificaciones, st.Mensajes = count("tipo = ?", 2), count("tipo = ?", 1)
	st.NoLeidas, st.Urgentes, st.Nuevos = count("leido = ?", false), count("urgente = ? AND leido = ?", true, false), count("es_nuevo = ?", true)
	st.Status, st.ErrorCode, st.ErrorMessage, st.CredFingerprint = models.SunatBuzonStatusOK, "", "", ""
	st.LastSuccessAt, st.BaselineDone = &now, true
	return s.saveState(st)
}

// ───────────────────────────── Lectura en SOL ─────────────────────────────

var (
	reBuzonSubdominio = regexp.MustCompile(`(?:var\s+)?subdominio\s*=\s*['"]([a-z0-9]+)['"]`)
	reBuzonMetaToken  = regexp.MustCompile(`<meta\s+name="meta-token"\s+content="([^"]*)"`)
)

// fetch entra a SOL, lee el listado completo del buzón (notificaciones y mensajes) y cierra la sesión.
func (s *SunatBuzonService) fetch(ruc, usuario, clave string) ([]buzonItem, error) {
	link, err := s.loginFn(ruc, usuario, clave)
	if err != nil {
		return nil, err
	}
	jar, _ := cookiejar.New(nil)
	client := &http.Client{Jar: jar, Timeout: s.timeout}
	do := func(req *http.Request) (*http.Response, error) {
		req.Header.Set("User-Agent", sunatSolUserAgent)
		req.Header.Set("Accept-Language", "es-PE,es;q=0.9")
		return client.Do(req)
	}
	read := func(resp *http.Response) []byte {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
		resp.Body.Close()
		return b
	}
	unexpected := func(what string, resp *http.Response) error {
		return accessErr(SunatAccessUnexpected, "SUNAT respondió de forma inesperada al leer el buzón.", fmt.Sprintf("%s: HTTP %d %s", what, resp.StatusCode, safeURL(resp.Request.URL)))
	}

	// 1) El enlace de ingreso (un solo uso) deja la sesión del menú SOL.
	req, _ := http.NewRequest(http.MethodGet, link, nil)
	resp, err := do(req)
	if err != nil {
		return nil, accessErr(SunatAccessUnavailable, "No se pudo conectar con SUNAT. Intente de nuevo en unos minutos.", "menú: "+errSummary(err))
	}
	menuURL := *resp.Request.URL
	menuURL.RawQuery, menuURL.Fragment = "", ""
	menuBody := string(read(resp))
	if resp.StatusCode != http.StatusOK || !strings.Contains(menuURL.Path, "MenuInternet") {
		return nil, unexpected("menú", resp)
	}
	// Desde acá hay una sesión abierta en SOL: se cierra pase lo que pase.
	defer s.logout(client, menuURL.String())

	sub := "ww1"
	if m := reBuzonSubdominio.FindStringSubmatch(menuBody); m != nil {
		sub = m[1]
	}

	// 2) El visor del buzón (lo que abre el botón «Buzón» del menú).
	req, _ = http.NewRequest(http.MethodGet, menuURL.String()+"?action=buzon&s="+url.QueryEscape(sub), nil)
	resp, err = do(req)
	if err != nil {
		return nil, accessErr(SunatAccessUnavailable, "No se pudo conectar con SUNAT. Intente de nuevo en unos minutos.", "buzón: "+errSummary(err))
	}
	visor := *resp.Request.URL
	page := string(read(resp))
	if resp.StatusCode != http.StatusOK || !strings.Contains(visor.Path, "/ol-ti-itvisornoti/") {
		return nil, unexpected("buzón", resp)
	}
	tok := reBuzonMetaToken.FindStringSubmatch(page)
	if tok == nil {
		return nil, accessErr(SunatAccessUnexpected, "SUNAT no entregó el visor del buzón con el formato esperado.", "sin meta-token en "+safeURL(&visor))
	}
	base := visor.Scheme + "://" + visor.Host + "/ol-ti-itvisornoti/visor"

	// 3) Listados paginados (solo lectura): notificaciones (2) y mensajes (1).
	var out []buzonItem
	seen := map[string]bool{}
	for _, tipo := range []int{2, 1} {
		for pg := 1; pg <= buzonMaxPages; pg++ {
			q := url.Values{"tipoMsj": {strconv.Itoa(tipo)}, "codCarpeta": {"00"}, "codEtiqueta": {""}, "page": {strconv.Itoa(pg)}, "des_asunto": {""}, "codMensaje": {""}, "tipoOrden": {"NADA"}}
			req, _ = http.NewRequest(http.MethodGet, base+"/listNotiMenPag?"+q.Encode(), nil)
			req.Header.Set("X-Ruc", tok[1])
			req.Header.Set("X-Requested-With", "XMLHttpRequest")
			req.Header.Set("Accept", "application/json, text/javascript, */*; q=0.01")
			req.Header.Set("Referer", base+"/master")
			resp, err = do(req)
			if err != nil {
				return nil, accessErr(SunatAccessUnavailable, "No se pudo conectar con SUNAT. Intente de nuevo en unos minutos.", "listado: "+errSummary(err))
			}
			body := read(resp)
			if resp.StatusCode != http.StatusOK {
				return nil, unexpected("listado", resp)
			}
			var list struct {
				Total flexNum           `json:"total"`
				Rows  []json.RawMessage `json:"rows"`
			}
			if err := json.Unmarshal(body, &list); err != nil {
				return nil, accessErr(SunatAccessUnexpected, "SUNAT devolvió el listado del buzón en un formato inesperado.", "campos: "+jsonKeysSummary(body))
			}
			for _, raw := range list.Rows {
				var r buzonRow
				if err := json.Unmarshal(raw, &r); err != nil {
					continue
				}
				key := strconv.Itoa(tipo) + "|" + string(r.CodMensaje)
				if seen[key] {
					continue
				}
				seen[key] = true
				out = append(out, buzonItem{tipo: tipo, row: r, raw: string(raw)})
			}
			if len(list.Rows) == 0 || pg >= int(list.Total) {
				break
			}
		}
	}
	return out, nil
}

// logout cierra la aplicación abierta (el buzón) y la sesión del menú, igual que la pantalla de SOL al salir.
// Es "mejor esfuerzo": un fallo acá no invalida lo leído.
func (s *SunatBuzonService) logout(client *http.Client, menuURL string) {
	post := func(u, body string) string {
		req, _ := http.NewRequest(http.MethodPost, u, strings.NewReader(body))
		req.Header.Set("User-Agent", sunatSolUserAgent)
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded; charset=UTF-8")
		req.Header.Set("X-Requested-With", "XMLHttpRequest")
		resp, err := client.Do(req)
		if err != nil {
			return ""
		}
		defer resp.Body.Close()
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
		return strings.TrimSpace(string(b))
	}
	if prev := post(menuURL, "action=prevApp"); strings.HasPrefix(prev, "http") {
		post(prev, "")
	}
	post(menuURL, "action=salir&pestana=null&agrupacion=null")
}

// ───────────────────────────── Corrida nocturna ─────────────────────────────

// nextDailyRun próxima ocurrencia de `hour`:00 en la zona horaria dada, siempre en el futuro.
func nextDailyRun(now time.Time, hour int, loc *time.Location) time.Time {
	n := now.In(loc)
	next := time.Date(n.Year(), n.Month(), n.Day(), hour, 0, 0, 0, loc)
	if !next.After(n) {
		next = next.AddDate(0, 0, 1)
	}
	return next
}

// BuzonRunSummary resultado de una corrida (para el log).
type BuzonRunSummary struct {
	Total, OK, SinClave, Rechazadas, Errores int
	Cortada                                  bool
}

// RunAll sincroniza, de a una, todas las empresas activas del estudio.
func (s *SunatBuzonService) RunAll(source string) BuzonRunSummary {
	var ids []uint
	if err := database.DB.Model(&models.Company{}).Where("client_type = ? AND status = ?", models.CompanyClientTypeEstudio, "activo").Order("id").Pluck("id", &ids).Error; err != nil {
		log.Printf("buzon: no se pudo listar las empresas: %v", err)
		return BuzonRunSummary{}
	}
	sum := BuzonRunSummary{Total: len(ids)}
	consecutive := 0
	for _, id := range ids {
		_, err, called := s.syncCompany(id, nil, source, 0, true)
		var be *BuzonError
		switch {
		case err == nil:
			sum.OK++
			consecutive = 0
		case errors.As(err, &be) && be.Code == BuzonErrNoKey:
			sum.SinClave++
		case errors.As(err, &be) && be.Code == BuzonErrRejected:
			sum.Rechazadas++
		default:
			sum.Errores++
			consecutive++
		}
		if consecutive >= buzonNightlyMaxConsecutiveErrors {
			sum.Cortada = true
			break
		}
		if called {
			time.Sleep(buzonNightlyPause)
		}
	}
	return sum
}

// buzonDefaultHours horas (Lima) de las pasadas sobre todo el estudio: la madrugada y tres durante la jornada, para que los
// avisos de «notificaciones sin leer» no tengan más de unas horas de retraso. Se cambia con BUZON_SYNC_HOURS («1,8,13,17»).
const buzonDefaultHours = "1,8,13,17"

// parseBuzonHours lee una lista de horas 0-23 separadas por coma (sin repetir, ordenadas); lo inválido se ignora.
func parseBuzonHours(spec string) []int {
	seen := map[int]bool{}
	var out []int
	for _, p := range strings.Split(spec, ",") {
		h, err := strconv.Atoi(strings.TrimSpace(p))
		if err != nil || h < 0 || h > 23 || seen[h] {
			continue
		}
		seen[h] = true
		out = append(out, h)
	}
	sort.Ints(out)
	return out
}

// nextBuzonRun la próxima pasada (la más cercana en el futuro entre las horas dadas) y su hora.
func nextBuzonRun(now time.Time, hours []int, loc *time.Location) (time.Time, int) {
	var best time.Time
	bestHour := 0
	for _, h := range hours {
		n := nextDailyRun(now, h, loc)
		if best.IsZero() || n.Before(best) {
			best, bestHour = n, h
		}
	}
	return best, bestHour
}

// StartSunatBuzonNightlySync deja corriendo la sincronización de todas las empresas a las horas programadas (hora de Lima):
// por defecto 1:00, 8:00, 13:00 y 17:00. La de la madrugada se registra como «nocturna»; las demás, como «programada».
// Se desactiva con BUZON_SYNC_NIGHTLY=false (p. ej. en el ambiente de pruebas, para no duplicar los ingresos a SOL).
func StartSunatBuzonNightlySync() {
	switch strings.ToLower(strings.TrimSpace(os.Getenv("BUZON_SYNC_NIGHTLY"))) {
	case "false", "0", "off", "no":
		log.Print("buzon: sincronización programada desactivada (BUZON_SYNC_NIGHTLY)")
		return
	}
	loc := limaLoc
	if loc == nil {
		loc = time.UTC
	}
	spec := strings.TrimSpace(os.Getenv("BUZON_SYNC_HOURS"))
	if spec == "" {
		spec = buzonDefaultHours
	}
	hours := parseBuzonHours(spec)
	if len(hours) == 0 {
		hours = []int{buzonNightlyHour}
	}
	go func() {
		svc := SharedSunatBuzonService()
		for {
			next, hour := nextBuzonRun(time.Now(), hours, loc)
			source := BuzonSourceScheduled
			if hour < 6 {
				source = BuzonSourceNightly
			}
			log.Printf("buzon: próxima sincronización (%s): %s", source, next.Format("2006-01-02 15:04 MST"))
			time.Sleep(time.Until(next))
			started := time.Now()
			sum := svc.RunAll(source)
			log.Printf("buzon: sincronización %s terminada en %s — empresas %d, ok %d, sin clave %d, rechazadas %d, con error %d, cortada %v",
				source, time.Since(started).Round(time.Second), sum.Total, sum.OK, sum.SinClave, sum.Rechazadas, sum.Errores, sum.Cortada)
		}
	}()
}

// InScope valida que la empresa esté dentro del alcance del usuario (nil = todo el estudio).
func (s *SunatBuzonService) InScope(companyID uint, allowed []uint) error {
	return s.creds.companyInScope(companyID, allowed)
}
