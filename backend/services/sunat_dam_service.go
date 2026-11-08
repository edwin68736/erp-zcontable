package services

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"miappfiber/database"
	"miappfiber/models"
)

// Consulta de DAM (Declaración Aduanera de Mercancías de exportación).
//
// SUNAT no ofrece API para esto: es una pantalla del Menú SOL («Aduanas → Despacho aduanero de salida → Consulta de
// DAM», código 17.1.16.3.1) que pide la lista con una llamada AJAX (consultadam.htm?action=buscarPorRangoFecha) y la
// muestra en una tabla. El servidor entra a SOL con la clave de la empresa, abre esa opción y hace la misma llamada con
// el rango de fechas de numeración. SOLO LECTURA.
//
// La búsqueda de Aduanas es lenta (más de un minuto aun sin resultados), por eso se procesa en segundo plano y queda
// en el historial «en proceso» hasta que termina.
//
// NOTA: los campos de cada DAM (numDam, fechaNumeracion, despachadorAduana, exportador, consignatario, tipoEmbarque,
// totalClausulaVenta, totalValorAduanas, solicitudRegularizacion, idDeclaracion) salen del código de la pantalla de SUNAT:
// se probó la llamada con una empresa sin DAM (respuesta vacía), no con DAM reales.

const (
	damMenuCode      = "17.1.16.3.1"
	damListAction    = "buscarPorRangoFecha"
	damMaxRangeDays  = 92
	damStaleAfter    = 10 * time.Minute
	damDefaultAduana = "118"
)

// DAMItem una DAM de la lista de SUNAT.
type DAMItem struct {
	Dam            string  `json:"dam"` // Aduana-Régimen-Año-Número
	FecNumeracion  string  `json:"fec_numeracion"`
	Despachador    string  `json:"despachador"`
	Exportador     string  `json:"exportador"`
	Consignatario  string  `json:"consignatario"`
	TipoEmbarque   string  `json:"tipo_embarque"`
	ClausulaVenta  float64 `json:"clausula_venta"` // total de la cláusula de venta
	ValorAduana    float64 `json:"valor_aduana"`   // total del valor en aduanas
	Regularizacion string  `json:"regularizacion,omitempty"`
	IDDeclaracion  string  `json:"id_declaracion,omitempty"`
}

// DAMResult resultado de una consulta de DAM.
type DAMResult struct {
	Desde         string    `json:"desde"` // AAAA-MM-DD (fecha de numeración)
	Hasta         string    `json:"hasta"`
	Items         []DAMItem `json:"items"`
	Total         int       `json:"total"`
	TotalClausula float64   `json:"total_clausula"`
	TotalValor    float64   `json:"total_valor"`
	// Aviso mensaje de SUNAT que acompaña a la lista (por ejemplo, que hay más resultados de los que muestra).
	Aviso string `json:"aviso,omitempty"`
}

type SunatDamService struct {
	creds   *CompanyAccessCredentialService
	timeout time.Duration
	now     func() time.Time
	// async: la consulta corre en segundo plano (siempre en producción; las pruebas la ejecutan en línea).
	async bool
	mu    sync.Mutex
	// linkFn entrega el enlace de ingreso a SOL (en pruebas se reemplaza).
	linkFn func(companyID uint, allowed []uint, userID uint) (string, error)
}

func NewSunatDamService() *SunatDamService {
	sol := NewSunatSolAccessService()
	return &SunatDamService{
		creds: NewCompanyAccessCredentialService(),
		// Aduanas tarda más de un minuto en responder aunque no haya resultados.
		timeout: 180 * time.Second,
		now:     time.Now,
		async:   true,
		linkFn: func(companyID uint, allowed []uint, userID uint) (string, error) {
			res, err := sol.Generate(companyID, allowed, userID, sunatAccessTargetSunat)
			if err != nil {
				return "", err
			}
			return res.URL, nil
		},
	}
}

// InScope valida que la empresa esté dentro del alcance del usuario (nil = todo el estudio).
func (s *SunatDamService) InScope(companyID uint, allowed []uint) error {
	return s.creds.companyInScope(companyID, allowed)
}

// ValidateDAMRange valida el rango de fechas de numeración (AAAA-MM-DD).
func (s *SunatDamService) ValidateDAMRange(desde, hasta string) (time.Time, time.Time, error) {
	desde, hasta = strings.TrimSpace(desde), strings.TrimSpace(hasta)
	bad := func(msg string) error { return accessErr(SunatAccessInvalidParams, msg, desde+" – "+hasta) }
	if !reNPDDay.MatchString(desde) || !reNPDDay.MatchString(hasta) {
		return time.Time{}, time.Time{}, bad("Indique las fechas con el formato AAAA-MM-DD.")
	}
	d, err1 := time.Parse(npdRequestDateLayou, desde)
	h, err2 := time.Parse(npdRequestDateLayou, hasta)
	if err1 != nil || err2 != nil {
		return time.Time{}, time.Time{}, bad("Indique fechas válidas.")
	}
	if d.After(h) {
		return d, h, bad("La fecha «desde» no puede ser mayor que «hasta».")
	}
	if int(h.Sub(d).Hours()/24)+1 > damMaxRangeDays {
		return d, h, bad(fmt.Sprintf("El rango máximo es de %d días (3 meses): la consulta de Aduanas es lenta.", damMaxRangeDays))
	}
	if today := s.now().In(limaLocation()).Format(npdRequestDateLayou); hasta > today {
		return d, h, bad("La fecha «hasta» no puede ser posterior a hoy.")
	}
	return d, h, nil
}

// Start valida la consulta, la deja «en proceso» en el historial de la empresa y la ejecuta en segundo plano.
// Devuelve la fila del historial (la pantalla la consulta hasta que termine).
func (s *SunatDamService) Start(companyID uint, allowed []uint, userID uint, desde, hasta string) (*models.DamHistory, error) {
	d, h, err := s.ValidateDAMRange(desde, hasta)
	if err != nil {
		return nil, err
	}
	if _, err := s.creds.GetByCompanyID(companyID, allowed); err != nil {
		return nil, err
	}
	s.expireStale(companyID)
	s.mu.Lock()
	var running int64
	database.DB.Model(&models.DamHistory{}).Where("company_id = ? AND status = ?", companyID, models.DamHistoryRunning).Count(&running)
	if running > 0 {
		s.mu.Unlock()
		return nil, accessErr(SunatAccessInProgress, "Ya hay una consulta de DAM en proceso para esta empresa. Espere a que termine.", "")
	}
	row := models.DamHistory{
		CompanyID: companyID, Desde: d.Format(npdRequestDateLayou), Hasta: h.Format(npdRequestDateLayou),
		Status: models.DamHistoryRunning, RequestedBy: userID,
	}
	if err := database.DB.Create(&row).Error; err != nil {
		s.mu.Unlock()
		return nil, err
	}
	s.mu.Unlock()

	if s.async {
		go s.run(row.ID, companyID, allowed, userID, d, h)
	} else {
		s.run(row.ID, companyID, allowed, userID, d, h)
	}
	return &row, nil
}

// run hace la consulta y completa la fila del historial (acertada o fallida).
func (s *SunatDamService) run(id, companyID uint, allowed []uint, userID uint, d, h time.Time) {
	res, err := s.query(companyID, allowed, userID, d, h)
	s.finish(id, res, err)
}

func (s *SunatDamService) query(companyID uint, allowed []uint, userID uint, d, h time.Time) (res *DAMResult, err error) {
	defer func() {
		if r := recover(); r != nil {
			log.Printf("dam: pánico en la consulta de la empresa %d: %v", companyID, r)
			res, err = nil, accessErr(SunatAccessUnexpected, "Falló la consulta de DAM.", "error interno")
		}
	}()
	link, err := s.linkFn(companyID, allowed, userID)
	if err != nil {
		return nil, err
	}
	sess, err := openSolMenu(link, s.timeout)
	if err != nil {
		return nil, err
	}
	defer sess.close()

	// 1) Pantalla «Consulta de una DAM» (Aduanas).
	resp, _, err := sess.execute(damMenuCode)
	if err != nil {
		return nil, err
	}
	app := resp.Request.URL
	if resp.StatusCode != 200 || !strings.Contains(app.Path, "/cl-ad-itdeclaracionconsulta/") {
		return nil, accessErr(SunatAccessUnexpected, "SUNAT no abrió la consulta de DAM (la empresa podría no tener acceso).",
			fmt.Sprintf("DAM: HTTP %d %s", resp.StatusCode, safeURL(app)))
	}

	// 2) La llamada que hace la pantalla al buscar «por rango de fechas de numeración» (con todas las aduanas,
	//    estados y exportadores).
	form := url.Values{
		"optradio":             {"on"},
		"codigoAduana":         {damDefaultAduana},
		"codigoRegimen":        {"40"},
		"anio":                 {fmt.Sprint(h.Year())},
		"numero":               {""},
		"fechaNumeracionDesde": {d.Format(npdSunatDateLayout)},
		"fechaNumeracionHasta": {h.Format(npdSunatDateLayout)},
		"codAduNum":            {"99"},
		"codEstDAM":            {"99"},
		"codExpor":             {"99"},
		"numDocu":              {""},
		"nomExpor":             {""},
		"idHdnAduanaUser":      {""},
		"idHdnSistema":         {"IT"},
		"idHdnflagHistory":     {"null"},
	}
	endpoint := app.Scheme + "://" + app.Host + app.Path + "?action=" + damListAction
	listResp, body, err := sess.do(http.MethodPost, endpoint, form, app.String(), map[string]string{
		"Accept":           "application/json, text/javascript, */*; q=0.01",
		"X-Requested-With": "XMLHttpRequest",
	})
	if err != nil {
		return nil, err
	}
	if listResp.StatusCode != 200 {
		return nil, accessErr(SunatAccessUnexpected, "SUNAT respondió de forma inesperada a la consulta de DAM.", fmt.Sprintf("DAM consulta: HTTP %d", listResp.StatusCode))
	}
	out, perr := parseDAMResult(body)
	if perr != nil {
		return nil, perr
	}
	out.Desde, out.Hasta = d.Format(npdRequestDateLayou), h.Format(npdRequestDateLayou)
	return out, nil
}

// parseDAMResult lee la respuesta JSON de la lista de DAM.
func parseDAMResult(raw []byte) (*DAMResult, error) {
	var payload struct {
		Respuesta *struct {
			Estado   *bool           `json:"estado"`
			Mensajes json.RawMessage `json:"mensajes"`
			Datos    []struct {
				NumDam                 flexStr `json:"numDam"`
				FechaNumeracion        flexStr `json:"fechaNumeracion"`
				DespachadorAduana      flexStr `json:"despachadorAduana"`
				Exportador             flexStr `json:"exportador"`
				Consignatario          flexStr `json:"consignatario"`
				TipoEmbarque           flexStr `json:"tipoEmbarque"`
				TotalClausulaVenta     flexNum `json:"totalClausulaVenta"`
				TotalValorAduanas      flexNum `json:"totalValorAduanas"`
				SolicitudRegularizacio flexStr `json:"solicitudRegularizacion"`
				IDDeclaracion          flexStr `json:"idDeclaracion"`
			} `json:"datos"`
		} `json:"respuesta"`
	}
	if err := json.Unmarshal(raw, &payload); err != nil || payload.Respuesta == nil {
		return nil, accessErr(SunatAccessUnexpected, "SUNAT devolvió la lista de DAM en un formato inesperado.", "respuesta: "+truncateStr(htmlText(string(raw)), 200))
	}
	r := payload.Respuesta
	msgs := damMessages(r.Mensajes)
	res := &DAMResult{Items: []DAMItem{}}
	for _, d := range r.Datos {
		it := DAMItem{
			Dam: strings.TrimSpace(string(d.NumDam)), FecNumeracion: strings.TrimSpace(string(d.FechaNumeracion)),
			Despachador: strings.TrimSpace(string(d.DespachadorAduana)), Exportador: strings.TrimSpace(string(d.Exportador)),
			Consignatario: strings.TrimSpace(string(d.Consignatario)), TipoEmbarque: strings.TrimSpace(string(d.TipoEmbarque)),
			ClausulaVenta: float64(d.TotalClausulaVenta), ValorAduana: float64(d.TotalValorAduanas),
			Regularizacion: strings.TrimSpace(string(d.SolicitudRegularizacio)), IDDeclaracion: strings.TrimSpace(string(d.IDDeclaracion)),
		}
		res.Items = append(res.Items, it)
		res.TotalClausula += it.ClausulaVenta
		res.TotalValor += it.ValorAduana
	}
	res.Total = len(res.Items)
	if res.Total == 0 {
		// «No se encontraron datos…» es un resultado vacío, no un error. Cualquier otro mensaje sin datos sí lo es.
		if len(msgs) > 0 && !strings.Contains(strings.ToLower(strings.Join(msgs, " ")), "no se encontraron") {
			return nil, accessErr(SunatAccessUnexpected, "SUNAT no pudo procesar la consulta de DAM.", truncateStr(strings.Join(msgs, " | "), 400))
		}
		return res, nil
	}
	res.Aviso = truncateStr(strings.Join(msgs, " "), 600)
	return res, nil
}

// damMessages los mensajes de SUNAT llegan como lista de textos (o como un solo texto).
func damMessages(raw json.RawMessage) []string {
	if len(raw) == 0 || string(raw) == "null" {
		return nil
	}
	var list []string
	if json.Unmarshal(raw, &list) == nil {
		var out []string
		for _, m := range list {
			if m = strings.TrimSpace(htmlText(m)); m != "" {
				out = append(out, m)
			}
		}
		return out
	}
	var one string
	if json.Unmarshal(raw, &one) == nil {
		if one = strings.TrimSpace(htmlText(one)); one != "" {
			return []string{one}
		}
	}
	return nil
}

// ───────────────────────────── Historial ─────────────────────────────

const damHistoryKeep = 100 // consultas que se conservan por empresa

// finish completa la fila del historial con el resultado o el error de la consulta.
func (s *SunatDamService) finish(id uint, res *DAMResult, qerr error) {
	now := s.now()
	upd := map[string]any{"finished_at": now}
	switch {
	case qerr != nil:
		upd["status"] = models.DamHistoryFailed
		var ae *SunatSolAccessError
		if errors.As(qerr, &ae) {
			upd["error_code"], upd["error_message"], upd["error_detail"] = truncateStr(ae.Code, 40), truncateStr(ae.Message, 600), truncateStr(ae.Detail, 600)
		} else {
			upd["error_message"] = "No se pudo completar la consulta."
		}
	case res != nil:
		upd["total"], upd["total_valor"], upd["total_clausula"], upd["aviso"] = res.Total, res.TotalValor, res.TotalClausula, truncateStr(res.Aviso, 600)
		upd["status"] = models.DamHistoryReady
		if res.Total == 0 {
			upd["status"] = models.DamHistoryNoData
		}
		var buf bytes.Buffer
		zw := gzip.NewWriter(&buf)
		if err := json.NewEncoder(zw).Encode(res); err != nil || zw.Close() != nil {
			upd["status"], upd["error_message"] = models.DamHistoryFailed, "No se pudo guardar el resultado."
		} else {
			upd["data"] = buf.Bytes()
		}
	}
	var row models.DamHistory
	if err := database.DB.First(&row, id).Error; err != nil {
		return // la quitaron del historial mientras corría
	}
	if err := database.DB.Model(&row).Updates(upd).Error; err != nil {
		log.Printf("dam: no se pudo guardar el resultado de la consulta %d: %v", id, err)
		return
	}
	var ids []uint
	if err := database.DB.Model(&models.DamHistory{}).Where("company_id = ?", row.CompanyID).
		Order("created_at DESC, id DESC").Offset(damHistoryKeep).Pluck("id", &ids).Error; err == nil && len(ids) > 0 {
		_ = database.DB.Where("id IN ?", ids).Delete(&models.DamHistory{}).Error
	}
}

// expireStale una consulta que lleva demasiado «en proceso» (por ejemplo, el servidor se reinició) se da por fallida.
func (s *SunatDamService) expireStale(companyID uint) {
	limit := s.now().Add(-damStaleAfter)
	_ = database.DB.Model(&models.DamHistory{}).
		Where("company_id = ? AND status = ? AND created_at < ?", companyID, models.DamHistoryRunning, limit).
		Updates(map[string]any{
			"status": models.DamHistoryFailed, "error_code": "interrumpida", "finished_at": s.now(),
			"error_message": "La consulta se interrumpió antes de terminar. Vuelva a intentarla.",
		}).Error
}

// ListHistory historial de la empresa (lo más reciente primero), sin los resultados.
func (s *SunatDamService) ListHistory(companyID uint) ([]models.DamHistory, error) {
	s.expireStale(companyID)
	var rows []models.DamHistory
	err := database.DB.Omit("data").Where("company_id = ?", companyID).Order("created_at DESC, id DESC").Limit(damHistoryKeep).Find(&rows).Error
	return rows, err
}

// GetHistory el resultado guardado de una consulta (para mostrarlo sin consultar a SUNAT).
func (s *SunatDamService) GetHistory(companyID, id uint) (*models.DamHistory, *DAMResult, error) {
	var row models.DamHistory
	if err := database.DB.Where("id = ? AND company_id = ?", id, companyID).First(&row).Error; err != nil {
		return nil, nil, accessErr(SunatAccessInvalidParams, "No se encontró esa consulta.", fmt.Sprint(id))
	}
	if len(row.Data) == 0 {
		return &row, nil, nil
	}
	zr, err := gzip.NewReader(bytes.NewReader(row.Data))
	if err != nil {
		return &row, nil, accessErr(SunatAccessUnexpected, "No se pudo leer el resultado guardado.", "gzip")
	}
	defer zr.Close()
	raw, err := io.ReadAll(io.LimitReader(zr, 64<<20))
	var res DAMResult
	if err != nil || json.Unmarshal(raw, &res) != nil {
		return &row, nil, accessErr(SunatAccessUnexpected, "No se pudo leer el resultado guardado.", "json")
	}
	return &row, &res, nil
}

// DeleteHistory quita una consulta del historial (si estaba en proceso, su resultado se descarta al terminar).
func (s *SunatDamService) DeleteHistory(companyID, id uint) error {
	res := database.DB.Where("id = ? AND company_id = ?", id, companyID).Delete(&models.DamHistory{})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return accessErr(SunatAccessInvalidParams, "No se encontró esa consulta.", fmt.Sprint(id))
	}
	return nil
}

// ClearHistory vacía el historial de la empresa, menos lo que sigue en proceso, y devuelve cuántas consultas quitó.
func (s *SunatDamService) ClearHistory(companyID uint) (int64, error) {
	res := database.DB.Where("company_id = ? AND status <> ?", companyID, models.DamHistoryRunning).Delete(&models.DamHistory{})
	return res.RowsAffected, res.Error
}
