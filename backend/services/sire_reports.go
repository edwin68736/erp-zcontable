package services

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"mime"
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

// Catálogo de reportes del SIRE que se pueden consultar/descargar (fase 1: solo lectura). Cada definición dice
// qué libros la admiten, qué datos pide al usuario y cómo arma la petición según el manual de SUNAT.
//
// kind "ticket": SUNAT responde con un número de ticket; el archivo (ZIP) se baja cuando el ticket termina.
// kind "file":   SUNAT responde el archivo en la misma llamada.

const (
	sireKindTicket = "ticket"
	sireKindFile   = "file"

	sireOriginAPI    = "2" // "Servicio web" según el manual
	sireOriginLegacy = "1" // los ejemplos del manual de Compras usan 1; se reintenta si SUNAT rechaza el 2
)

type SireOption struct {
	Value string `json:"value"`
	Label string `json:"label"`
}

type SireField struct {
	Key         string       `json:"key"`
	Label       string       `json:"label"`
	Options     []SireOption `json:"options,omitempty"`
	Default     string       `json:"default,omitempty"`
	Required    bool         `json:"required,omitempty"`
	Placeholder string       `json:"placeholder,omitempty"`
	// Libros a los que aplica el campo (vacío = todos).
	Libros []string `json:"libros,omitempty"`
}

type SireReportDef struct {
	Key         string   `json:"key"`
	Label       string   `json:"label"`
	Group       string   `json:"group"`
	Description string   `json:"description"`
	Kind        string   `json:"kind"`
	Libros      []string `json:"libros"`
	// FileTypes tipos de archivo por libro (campo tipo_archivo). Vacío = el reporte no lo pide.
	FileTypes map[string][]SireOption `json:"file_types,omitempty"`
	Fields    []SireField             `json:"fields,omitempty"`

	build func(b sireBuildCtx) (method, path string, q url.Values, err error)
}

type sireBuildCtx struct {
	libro  string
	period string
	ruc    string
	origin string
	p      map[string]string
}

func (b sireBuildCtx) tipoArchivo() string {
	if v := strings.TrimSpace(b.p["tipo_archivo"]); v != "" {
		return v
	}
	return "0"
}

var (
	sireTxt     = SireOption{"0", "TXT"}
	sireXls     = SireOption{"1", "Excel (XLS)"}
	sireCsv     = SireOption{"1", "CSV"}
	sireCsv2    = SireOption{"2", "CSV"}
	sireBothLib = []string{sireLibroVentas, sireLibroCompras}
	sireV       = []string{sireLibroVentas}
	sireC       = []string{sireLibroCompras}
)

func sireTypes(v, c []SireOption) map[string][]SireOption {
	m := map[string][]SireOption{}
	if v != nil {
		m[sireLibroVentas] = v
	}
	if c != nil {
		m[sireLibroCompras] = c
	}
	return m
}

func pick[T any](libro string, v, c T) T {
	if libro == sireLibroCompras {
		return c
	}
	return v
}

func qv(kv ...string) url.Values {
	q := url.Values{}
	for i := 0; i+1 < len(kv); i += 2 {
		q.Set(kv[i], kv[i+1])
	}
	return q
}

// sireReportDefs el catálogo. El orden define el orden en pantalla.
var sireReportDefs = []SireReportDef{
	{
		Key: "propuesta", Label: "Propuesta de comprobantes", Group: "Propuesta", Kind: sireKindTicket, Libros: sireBothLib,
		Description: "Comprobantes que SUNAT propone para el registro del período (descarga por ticket).",
		FileTypes:   sireTypes([]SireOption{sireTxt, sireXls}, []SireOption{sireTxt, sireCsv}),
		build: func(b sireBuildCtx) (string, string, url.Values, error) {
			if b.libro == sireLibroVentas {
				return http.MethodGet, "rvie/propuesta/web/propuesta/" + b.period + "/exportapropuesta", qv("codTipoArchivo", b.tipoArchivo()), nil
			}
			return http.MethodGet, "rce/propuesta/web/propuesta/" + b.period + "/exportacioncomprobantepropuesta",
				qv("codTipoArchivo", b.tipoArchivo(), "codOrigenEnvio", b.origin), nil
		},
	},
	{
		Key: "excluidos", Label: "Comprobantes no incluidos / excluidos", Group: "Propuesta", Kind: sireKindTicket, Libros: sireBothLib,
		Description: "Comprobantes que quedaron fuera de la propuesta del período vigente.",
		FileTypes:   sireTypes([]SireOption{sireTxt, sireXls}, []SireOption{sireTxt, sireCsv}),
		build: func(b sireBuildCtx) (string, string, url.Values, error) {
			q := qv("codTipoArchivo", b.tipoArchivo(), "codOrigenEnvio", b.origin)
			if b.libro == sireLibroVentas {
				return http.MethodGet, "rvie/propuesta/web/noincluidos/" + b.period + "/exportanoincluidos", q, nil
			}
			return http.MethodGet, "rce/propuesta/web/excluidos/" + b.period + "/exportaexcluidos", q, nil
		},
	},
	{
		Key: "preliminar", Label: "Preliminar registrado", Group: "Registro", Kind: sireKindTicket, Libros: sireBothLib,
		Description: "Comprobantes del preliminar del registro del período.",
		FileTypes:   sireTypes([]SireOption{sireTxt, sireXls}, []SireOption{sireTxt, sireCsv}),
		build: func(b sireBuildCtx) (string, string, url.Values, error) {
			q := qv("codTipoArchivo", b.tipoArchivo(), "codOrigenEnvio", b.origin)
			if b.libro == sireLibroVentas {
				return http.MethodGet, "rvierce/gestionlibro/web/registroslibros/" + b.period + "/reportepreliminar", q, nil
			}
			return http.MethodGet, "rce/preliminar/web/registroslibros/" + b.period + "/exportareportepreliminar", q, nil
		},
	},
	{
		Key: "preliminar_nd", Label: "Preliminar de no domiciliados", Group: "Registro", Kind: sireKindTicket, Libros: sireC,
		Description: "Operaciones con sujetos no domiciliados del preliminar de compras.",
		FileTypes:   sireTypes(nil, []SireOption{sireTxt, sireCsv}),
		build: func(b sireBuildCtx) (string, string, url.Values, error) {
			return http.MethodGet, "rce/preliminar/web/nodomiciliados/" + b.period + "/exportapreliminarnd",
				qv("codTipoArchivo", b.tipoArchivo(), "codOrigenEnvio", b.origin), nil
		},
	},
	{
		Key: "registro", Label: "Registro generado y reportes del libro", Group: "Registro", Kind: sireKindTicket, Libros: sireBothLib,
		Description: "Registro de ventas/compras ya generado, su consolidado y los ajustes posteriores (descarga por ticket).",
		FileTypes:   sireTypes([]SireOption{sireTxt, sireXls}, []SireOption{sireTxt, sireCsv}),
		Fields: []SireField{
			{Key: "cod_proceso", Label: "Qué descargar", Required: true, Libros: sireV, Default: "23", Options: []SireOption{
				{"23", "Registro de ventas (RVIE) del período"},
				{"22", "Consolidado del libro y ajustes"},
				{"28", "Preliminar registrado"},
				{"18", "Ajustes posteriores (individual)"},
				{"19", "Ajustes posteriores (consolidado)"},
				{"20", "Ajustes posteriores de períodos anteriores (individual)"},
				{"21", "Ajustes posteriores de períodos anteriores (consolidado)"},
			}},
			{Key: "cod_proceso", Label: "Qué descargar", Required: true, Libros: sireC, Default: "70", Options: []SireOption{
				{"70", "Registro de compras (RCE) del período"},
				{"69", "Consolidado de registros del RCE"},
				{"68", "Ajustes posteriores de períodos anteriores"},
			}},
			{Key: "cod_moneda", Label: "Moneda", Libros: sireC, Default: "PEN", Options: []SireOption{{"PEN", "Soles (PEN)"}, {"USD", "Dólares (USD)"}}},
		},
		build: func(b sireBuildCtx) (string, string, url.Values, error) {
			proc := strings.TrimSpace(b.p["cod_proceso"])
			if proc == "" {
				proc = pick(b.libro, "23", "70")
			}
			if _, err := strconv.Atoi(proc); err != nil {
				return "", "", nil, fmt.Errorf("código de proceso inválido")
			}
			if b.libro == sireLibroVentas {
				return http.MethodGet, "rvierce/gestionlibro/web/registroslibros/descarga",
					qv("perTributario", b.period, "codOrigenEnvio", b.origin, "codTipoArchivo", b.tipoArchivo(),
						"codProceso", proc, "codLibro", sireCodLibroVentas), nil
			}
			moneda := strings.TrimSpace(b.p["cod_moneda"])
			if moneda == "" {
				moneda = "PEN"
			}
			return http.MethodGet, "rce/ajustesposteriores/web/ajustesposteriores/" + b.period + "/solicitardescarga",
				qv("codTipoArchivo", b.tipoArchivo(), "codMoneda", moneda, "codProceso", proc, "codOrigen", b.origin, "lisPeriodos", b.period), nil
		},
	},
	{
		Key: "ajustes_rce", Label: "Ajustes posteriores del RCE", Group: "Registro", Kind: sireKindTicket, Libros: sireC,
		Description: "Ajustes posteriores del registro de compras (o la propuesta informativa de SUNAT si no hay cargados).",
		FileTypes:   sireTypes(nil, []SireOption{sireTxt, sireCsv}),
		build: func(b sireBuildCtx) (string, string, url.Values, error) {
			return http.MethodGet, "rce/ajustesposteriores/web/comprobantesajuspost/" + b.period + "/exportaajustesposterioresrc",
				qv("codTipoArchivo", b.tipoArchivo(), "codOrigenEnvio", b.origin), nil
		},
	},
	{
		Key: "inconsistencias", Label: "Inconsistencias por comprobante", Group: "Inconsistencias", Kind: sireKindTicket, Libros: sireBothLib,
		Description: "Detalle de los comprobantes del período que SUNAT marca con inconsistencias.",
		FileTypes:   sireTypes([]SireOption{sireTxt, sireXls}, []SireOption{sireTxt, sireCsv}),
		build: func(b sireBuildCtx) (string, string, url.Values, error) {
			if b.libro == sireLibroVentas {
				return http.MethodGet, "rvie/inconsistencias/web/periodoinconsistencias/" + b.period + "/exporta", qv("codTipoArchivo", b.tipoArchivo()), nil
			}
			return http.MethodGet, "rce/inconsistencias/web/periodoinconsistencias/" + b.period + "/" + sireCodLibroCompras + "/exportarinconsistenciasporcomprobantes",
				qv("codTipoArchivo", b.tipoArchivo(), "codOrigenEnvio", b.origin), nil
		},
	},
	{
		Key: "inconsistencias_montos", Label: "Inconsistencias por montos totales", Group: "Inconsistencias", Kind: sireKindTicket, Libros: sireC,
		Description: "Inconsistencias del RCE agrupadas por montos totales.",
		FileTypes:   sireTypes(nil, []SireOption{sireTxt, sireCsv}),
		build: func(b sireBuildCtx) (string, string, url.Values, error) {
			return http.MethodGet, "rce/inconsistencias/web/periodoinconsistencias/" + b.period + "/exportarinconsistenciasportotales",
				qv("codTipoArchivo", b.tipoArchivo(), "codLibro", sireCodLibroCompras), nil
		},
	},
	{
		Key: "car", Label: "Lista de CAR", Group: "Registro", Kind: sireKindTicket, Libros: sireBothLib,
		Description: "Códigos de Aplicación de Registro (CAR) de los comprobantes, según la fase del registro.",
		Fields: []SireField{
			{Key: "cod_fase", Label: "Código de fase", Required: true, Placeholder: "Ej.: 1"},
		},
		build: func(b sireBuildCtx) (string, string, url.Values, error) {
			fase := strings.TrimSpace(b.p["cod_fase"])
			if fase == "" {
				return "", "", nil, fmt.Errorf("indique el código de fase")
			}
			return http.MethodGet, "rvierce/gestionlibro/web/comprobanteslibros/" + b.period + "/reportecar",
				qv("codOrigenEnvio", b.origin, "codLibro", SireCodLibro(b.libro), "codFase", fase), nil
		},
	},
	{
		Key: "casillas", Label: "Reporte de casillas", Group: "Reportes", Kind: sireKindFile, Libros: sireBothLib,
		Description: "Casillas propuestas para la declaración (preliminar o comparada).",
		Fields: []SireField{
			{Key: "tipo_reporte", Label: "Reporte", Required: true, Default: "1", Options: []SireOption{{"1", "Preliminar"}, {"2", "Comparada"}}},
			{Key: "tipo_descarga", Label: "Formato", Required: true, Default: "0", Options: []SireOption{{"0", "TXT"}, {"1", "Excel (XLS)"}, {"2", "PDF"}}},
		},
		build: func(b sireBuildCtx) (string, string, url.Values, error) {
			tr, td := strings.TrimSpace(b.p["tipo_reporte"]), strings.TrimSpace(b.p["tipo_descarga"])
			if tr == "" {
				tr = "1"
			}
			if td == "" {
				td = "0"
			}
			return http.MethodGet, "rvierce/casillas/e/casillaspropuestas/" + b.period + "/reporte/" + url.PathEscape(tr) + "/" + url.PathEscape(td), nil, nil
		},
	},
	{
		Key: "estadistico", Label: "Reporte estadístico", Group: "Reportes", Kind: sireKindFile, Libros: sireBothLib,
		Description: "Resumen estadístico (razón social, monto y porcentaje).",
		FileTypes:   sireTypes([]SireOption{sireTxt, sireXls, sireCsv2}, []SireOption{sireTxt, sireCsv}),
		Fields: []SireField{
			{Key: "tipo_reporte", Label: "Reporte", Required: true, Libros: sireV, Default: "1", Options: []SireOption{
				{"1", "Montos por adquiriente"}, {"2", "Montos por notas de crédito y débito"}}},
			{Key: "tipo_reporte", Label: "Reporte", Required: true, Libros: sireC, Default: "1", Options: []SireOption{
				{"1", "Compras por proveedor"}, {"2", "Notas de crédito y débito por proveedor"}, {"3", "Compras por día"}, {"4", "Compras por CIIU"}}},
		},
		build: func(b sireBuildCtx) (string, string, url.Values, error) {
			tr := strings.TrimSpace(b.p["tipo_reporte"])
			if tr == "" {
				tr = "1"
			}
			q := qv("numRuc", b.ruc, "perTributario", b.period, "codTipoArchivo", b.tipoArchivo(), "codTipoReporte", tr, "codLibro", SireCodLibro(b.libro))
			path := pick(b.libro, "rvierce/estadistica/web/resumenestadistico/exportarvie", "rvierce/estadistica/web/resumenestadistico/exporta")
			return http.MethodGet, path, q, nil
		},
	},
	{
		Key: "cumplimiento", Label: "Reporte de cumplimiento", Group: "Reportes", Kind: sireKindFile, Libros: sireBothLib,
		Description: "Períodos presentados y pendientes del libro (PDF).",
		build: func(b sireBuildCtx) (string, string, url.Values, error) {
			return http.MethodGet, "rvierce/cumplimiento/web/omisos/" + b.period + "/" + SireCodLibro(b.libro) + "/consultaReporteCumplimiento/exportardocumento", nil, nil
		},
	},
}

// SireCatalog definiciones visibles para un libro, con sus campos filtrados.
func SireCatalog(libro string) []SireReportDef {
	out := []SireReportDef{}
	for _, d := range sireReportDefs {
		if !containsStr(d.Libros, libro) {
			continue
		}
		c := d
		c.build = nil
		c.Fields = nil
		for _, f := range d.Fields {
			if len(f.Libros) == 0 || containsStr(f.Libros, libro) {
				c.Fields = append(c.Fields, f)
			}
		}
		if ft, ok := d.FileTypes[libro]; ok {
			c.FileTypes = map[string][]SireOption{libro: ft}
		}
		out = append(out, c)
	}
	return out
}

func containsStr(list []string, v string) bool {
	for _, s := range list {
		if s == v {
			return true
		}
	}
	return false
}

func sireFindDef(key, libro string) (*SireReportDef, error) {
	for i := range sireReportDefs {
		d := &sireReportDefs[i]
		if d.Key == key {
			if !containsStr(d.Libros, libro) {
				return nil, sireErr(SireErrInvalidParams, "Este reporte no existe para el libro seleccionado.", key)
			}
			return d, nil
		}
	}
	return nil, sireErr(SireErrInvalidParams, "Reporte desconocido.", key)
}

func sireCheckLibroPeriod(libro, period string) *SireError {
	if SireCodLibro(libro) == "" {
		return sireErr(SireErrInvalidParams, "Libro no válido (use ventas o compras).", libro)
	}
	if !ValidSirePeriod(period) {
		return sireErr(SireErrInvalidParams, "Período no válido: use el formato AAAAMM (por ejemplo 202609).", period)
	}
	return nil
}

// ───────────────────────────── Operaciones ─────────────────────────────

// SireFile archivo listo para entregar al navegador.
type SireFile struct {
	Name        string
	ContentType string
	Data        []byte
}

// RequestTicket pide un reporte de tipo ticket y devuelve el número de ticket.
func (ss *SireSession) RequestTicket(libro, key, period string, p map[string]string) (string, error) {
	if e := sireCheckLibroPeriod(libro, period); e != nil {
		return "", e
	}
	def, err := sireFindDef(key, libro)
	if err != nil {
		return "", err
	}
	if def.Kind != sireKindTicket {
		return "", sireErr(SireErrInvalidParams, "Este reporte se descarga directamente, no por ticket.", key)
	}
	origin := sireOriginAPI
	for attempt := 0; attempt < 2; attempt++ {
		method, path, q, berr := def.build(sireBuildCtx{libro: libro, period: period, ruc: ss.creds.RUC, origin: origin, p: p})
		if berr != nil {
			return "", sireErr(SireErrInvalidParams, berr.Error(), key)
		}
		r, cerr := ss.call(method, path, q)
		if cerr != nil {
			// Algunos manuales usan origen 1 en sus ejemplos: si SUNAT rechaza el 2, se reintenta una vez con 1.
			var se *SireError
			if attempt == 0 && asSireErr(cerr, &se) && se.Code == SireErrValidation &&
				(strings.Contains(se.Detail, "cod 1028") || strings.Contains(se.Detail, "cod 1029") || strings.Contains(se.Detail, "cod 1030")) {
				origin = sireOriginLegacy
				continue
			}
			return "", cerr
		}
		var v struct {
			NumTicket string `json:"numTicket"`
		}
		if err := json.Unmarshal(r.Body, &v); err != nil || strings.TrimSpace(v.NumTicket) == "" {
			return "", sireErr(SireErrUnexpected, "SUNAT no devolvió el número de ticket.", "campos: "+jsonKeysSummary(r.Body))
		}
		return strings.TrimSpace(v.NumTicket), nil
	}
	return "", sireErr(SireErrUnexpected, "SUNAT no aceptó el reporte solicitado.", key)
}

func asSireErr(err error, target **SireError) bool {
	se, ok := err.(*SireError)
	if ok {
		*target = se
	}
	return ok
}

// DirectFile descarga un reporte de tipo "file" (respuesta inmediata).
func (ss *SireSession) DirectFile(libro, key, period string, p map[string]string) (*SireFile, error) {
	if e := sireCheckLibroPeriod(libro, period); e != nil {
		return nil, e
	}
	def, err := sireFindDef(key, libro)
	if err != nil {
		return nil, err
	}
	if def.Kind != sireKindFile {
		return nil, sireErr(SireErrInvalidParams, "Este reporte se pide por ticket.", key)
	}
	method, path, q, berr := def.build(sireBuildCtx{libro: libro, period: period, ruc: ss.creds.RUC, origin: sireOriginAPI, p: p})
	if berr != nil {
		return nil, sireErr(SireErrInvalidParams, berr.Error(), key)
	}
	r, cerr := ss.call(method, path, q)
	if cerr != nil {
		return nil, cerr
	}
	return sireFileFromResponse(r, fmt.Sprintf("SIRE_%s_%s_%s", strings.ToUpper(libro[:1])+libro[1:], key, period)), nil
}

// sireFileFromResponse arma el archivo de una respuesta: PDF en base64 dentro de un JSON, o bytes directos.
func sireFileFromResponse(r *SireResponse, baseName string) *SireFile {
	if strings.Contains(strings.ToLower(r.ContentType), "json") || (len(r.Body) > 0 && r.Body[0] == '{') {
		var v struct {
			ArchivoPdf string `json:"archivoPdf"`
			Nombre     string `json:"nombreArchivoPdf"`
		}
		if json.Unmarshal(r.Body, &v) == nil && strings.TrimSpace(v.ArchivoPdf) != "" {
			if data, err := base64.StdEncoding.DecodeString(strings.TrimSpace(v.ArchivoPdf)); err == nil {
				name := strings.TrimSpace(v.Nombre)
				if name == "" {
					name = baseName + ".pdf"
				} else if !strings.Contains(name, ".") {
					name += ".pdf"
				}
				return &SireFile{Name: name, ContentType: "application/pdf", Data: data}
			}
		}
	}
	name := ""
	if r.Disposition != "" {
		if _, params, err := mime.ParseMediaType(r.Disposition); err == nil {
			name = params["filename"]
		}
	}
	ct := strings.TrimSpace(r.ContentType)
	if ct == "" {
		ct = "application/octet-stream"
	}
	if name == "" {
		name = baseName + sireExtFor(r.Body, ct)
	}
	return &SireFile{Name: name, ContentType: ct, Data: r.Body}
}

func sireExtFor(body []byte, ct string) string {
	switch {
	case len(body) > 3 && string(body[:2]) == "PK":
		return ".zip"
	case len(body) > 4 && string(body[:4]) == "%PDF":
		return ".pdf"
	case strings.Contains(ct, "csv"):
		return ".csv"
	}
	return ".txt"
}

// Periods ejercicios y períodos habilitados del libro.
func (ss *SireSession) Periods(libro string) (any, error) {
	cod := SireCodLibro(libro)
	if cod == "" {
		return nil, sireErr(SireErrInvalidParams, "Libro no válido (use ventas o compras).", libro)
	}
	return ss.JSON(http.MethodGet, "rvierce/padron/web/omisos/"+cod+"/periodos", nil)
}

// Tickets historial de tickets (estado de cada solicitud) entre dos períodos.
func (ss *SireSession) Tickets(libro, perIni, perFin string, page, perPage int, ticket string) (any, error) {
	if SireCodLibro(libro) == "" {
		return nil, sireErr(SireErrInvalidParams, "Libro no válido (use ventas o compras).", libro)
	}
	if !ValidSirePeriod(perIni) || !ValidSirePeriod(perFin) {
		return nil, sireErr(SireErrInvalidParams, "Períodos no válidos: use el formato AAAAMM.", perIni+"-"+perFin)
	}
	if page < 1 {
		page = 1
	}
	if perPage < 1 || perPage > 100 {
		perPage = 20
	}
	q := qv("perIni", perIni, "perFin", perFin, "page", strconv.Itoa(page), "perPage", strconv.Itoa(perPage))
	if t := strings.TrimSpace(ticket); t != "" {
		q.Set("numTicket", t)
	}
	q.Set("codLibro", SireCodLibro(libro))
	q.Set("codOrigenEnvio", sireOriginAPI)
	return ss.JSON(http.MethodGet, "rvierce/gestionprocesosmasivos/web/masivo/consultaestadotickets", q)
}

// TicketFileParams datos de un archivo generado por un ticket (salen del listado de tickets).
type TicketFileParams struct {
	Libro, Name, TypeCode, Period, Proceso, Ticket string
}

// TicketFile descarga el archivo (ZIP) que generó un ticket terminado. Se guarda en caché unos minutos para
// poder paginar la vista previa sin volver a pedirlo a SUNAT.
func (ss *SireSession) TicketFile(p TicketFileParams) ([]byte, error) {
	cod := SireCodLibro(p.Libro)
	if cod == "" {
		return nil, sireErr(SireErrInvalidParams, "Libro no válido (use ventas o compras).", p.Libro)
	}
	if strings.TrimSpace(p.Name) == "" || strings.TrimSpace(p.Ticket) == "" || !ValidSirePeriod(p.Period) {
		return nil, sireErr(SireErrInvalidParams, "Faltan datos del archivo (nombre, ticket o período).", "")
	}
	key := fmt.Sprintf("%d|%s|%s", ss.creds.CompanyID, p.Ticket, p.Name)
	if data, ok := ss.svc.cacheGet(key); ok {
		return data, nil
	}
	typeCode := strings.TrimSpace(p.TypeCode)
	if typeCode == "" {
		typeCode = "null" // el manual pide enviar el valor tal cual lo informó el estado del ticket (null si no hay)
	}
	q := qv("nomArchivoReporte", p.Name, "codTipoArchivoReporte", typeCode, "perTributario", p.Period,
		"codProceso", strings.TrimSpace(p.Proceso), "numTicket", strings.TrimSpace(p.Ticket), "codLibro", cod)
	r, err := ss.call(http.MethodGet, "rvierce/gestionprocesosmasivos/web/masivo/archivoreporte", q)
	if err != nil {
		return nil, err
	}
	ss.svc.cachePut(key, r.Body)
	return r.Body, nil
}

// Summary resumen de comprobantes (tipo 1 propuesta … 7 no domiciliados) en TXT/CSV.
func (ss *SireSession) Summary(libro, period, tipo, fileType string) (*SireFile, error) {
	if e := sireCheckLibroPeriod(libro, period); e != nil {
		return nil, e
	}
	tipo = strings.TrimSpace(tipo)
	if n, err := strconv.Atoi(tipo); err != nil || n < 1 || n > 7 {
		return nil, sireErr(SireErrInvalidParams, "Tipo de resumen no válido (1 a 7).", tipo)
	}
	if fileType != "0" && fileType != "1" {
		fileType = "0"
	}
	r, err := ss.call(http.MethodGet, "rvierce/resumen/web/resumencomprobantes/"+period+"/"+tipo+"/"+fileType+"/exporta",
		qv("codLibro", SireCodLibro(libro)))
	if err != nil {
		return nil, err
	}
	return sireFileFromResponse(r, fmt.Sprintf("SIRE_%s_resumen%s_%s", libro, tipo, period)), nil
}

// Inconsistencies resumen de inconsistencias (JSON): porcentajes y totales por cantidad y monto.
// El manual indica GET para ventas y POST para compras; si SUNAT responde 405 se prueba el otro método.
func (ss *SireSession) Inconsistencies(libro, period, tipo string) (any, error) {
	if e := sireCheckLibroPeriod(libro, period); e != nil {
		return nil, e
	}
	tipo = strings.TrimSpace(tipo)
	if n, err := strconv.Atoi(tipo); err != nil || n < 1 || n > 6 {
		return nil, sireErr(SireErrInvalidParams, "Tipo de resumen no válido (1 a 6).", tipo)
	}
	q := qv("codTipoResumen", tipo, "codLibro", SireCodLibro(libro))
	path := "rvierce/resumen/web/resumeninconsistencias/" + period
	first, second := pick(libro, http.MethodGet, http.MethodPost), pick(libro, http.MethodPost, http.MethodGet)
	v, err := ss.JSON(first, path, q)
	if err != nil {
		var se *SireError
		if asSireErr(err, &se) && se.Code == SireErrUnexpected && strings.Contains(se.Detail, "405") {
			return ss.JSON(second, path, q)
		}
	}
	return v, err
}

// Preliminares preliminares registrados (JSON paginado).
func (ss *SireSession) Preliminares(perIni, perFin string, page, perPage int) (any, error) {
	if !ValidSirePeriod(perIni) || !ValidSirePeriod(perFin) {
		return nil, sireErr(SireErrInvalidParams, "Períodos no válidos: use el formato AAAAMM.", perIni+"-"+perFin)
	}
	if page < 1 {
		page = 1
	}
	if perPage < 1 || perPage > 100 {
		perPage = 20
	}
	return ss.JSON(http.MethodGet, "rvierce/gestionlibro/web/registroslibros/consultapreliminaresregistro",
		qv("page", strconv.Itoa(page), "perPage", strconv.Itoa(perPage), "perIni", perIni, "perFin", perFin))
}

// FV0621 datos del formulario virtual 621 asociados al RCE: prorrata, reintegro y crédito fiscal especial.
func (ss *SireSession) FV0621(period string) (any, error) {
	if !ValidSirePeriod(period) {
		return nil, sireErr(SireErrInvalidParams, "Período no válido: use el formato AAAAMM.", period)
	}
	// El manual documenta el método PUT para esta consulta (sin cuerpo).
	return ss.JSON(http.MethodPut, "rce/propuesta/web", qv("periodoSeleccionado", period, "tipoInfo", "FV0621"))
}

// AjustesRCE código de ajuste posterior y comprobantes de ajustes posteriores del RCE.
func (ss *SireSession) AjustesRCE(period string, page, perPage int) (any, error) {
	if !ValidSirePeriod(period) {
		return nil, sireErr(SireErrInvalidParams, "Período no válido: use el formato AAAAMM.", period)
	}
	if page < 1 {
		page = 1
	}
	if perPage < 1 || perPage > 100 {
		perPage = 20
	}
	return ss.JSON(http.MethodGet, "rce/ajustesposteriores/web/comprobantesajuspost/"+period+"/listarcap",
		qv("page", strconv.Itoa(page), "perPage", strconv.Itoa(perPage)))
}

// Constancia constancia de recepción (PDF) por nombre de archivo (sale del estado del ticket de generación).
func (ss *SireSession) Constancia(libro, name string) (*SireFile, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return nil, sireErr(SireErrInvalidParams, "Indique el nombre del archivo de la constancia.", "")
	}
	var path string
	q := url.Values{}
	switch libro {
	case sireLibroVentas:
		path = "rvierce/gestionlibro/web/registroslibros/constancia/archivo"
		q.Set("nomArchivo", name)
	case sireLibroCompras:
		path = "rvierce/gestionlibro/web/registroslibros/constancia/constanciarecepcion"
		q.Set("nomConstanciaRecepcion", name)
	default:
		return nil, sireErr(SireErrInvalidParams, "Libro no válido (use ventas o compras).", libro)
	}
	r, err := ss.call(http.MethodGet, path, q)
	if err != nil {
		return nil, err
	}
	return sireFileFromResponse(r, "constancia_"+libro), nil
}

// TestConnection verifica que las credenciales permitan obtener el token y que SUNAT atienda la API SIRE.
// Que el libro de ventas no tenga períodos (empresa no obligada al RVIE) no cuenta como fallo de conexión.
func (ss *SireSession) TestConnection() error {
	if _, err := ss.token(); err != nil {
		return err
	}
	if _, err := ss.Periods(sireLibroVentas); err != nil {
		var se *SireError
		if asSireErr(err, &se) && se.Code == SireErrValidation {
			return nil
		}
		return err
	}
	return nil
}
