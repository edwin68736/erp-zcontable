package services

import (
	"archive/zip"
	"bytes"
	"fmt"
	"mime"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
)

// Archivos de cada recibo por honorarios recibido (PDF y XML firmado), tal como los ofrece SUNAT en el detalle del recibo
// (Consulta Receptor → clic en el recibo → «Descargar en Formato PDF» / «Descargar en Formato Digital Seguro»).
// Para no depender de la paginación de la lista, cada recibo se busca por su serie y número exactos (y el RUC del emisor),
// con lo que queda una sola fila; se abre su detalle y se pide cada archivo. Solo lectura, de a un recibo y con pausa.

const (
	rheSolMaxFileRefs = 100
	rheSolActDetail   = "CapturaCriterioConsultaRec2"
	rheSolActPDF      = "descargarrecibopdf"
	rheSolActXML      = "descargarreciboxml"
)

// rheSolFilePause se puede reemplazar en pruebas.
var rheSolFilePause = 400 * time.Millisecond

var (
	reRheComprobante = regexp.MustCompile(`^[A-Za-z0-9]{4}-\d{1,8}$`)
	reRheEscoger     = regexp.MustCompile(`(?is)escoger\(\s*(\d+)\s*\)[^>]*>\s*([^<]+?)\s*<`)
	reRheDigits      = regexp.MustCompile(`^\d{8,11}$`)
)

// RheSolFileRef un recibo recibido del que se piden los archivos (los datos salen de la consulta).
type RheSolFileRef struct {
	Comprobante string `json:"comprobante"` // E001-20
	FecEmision  string `json:"fec_emision"` // AAAA-MM-DD
	EmisorDoc   string `json:"emisor_doc"`  // RUC (o DNI) de quien emitió el recibo
}

// RheSolFilesResult el ZIP con los archivos y el resumen.
type RheSolFilesResult struct {
	Zip    []byte   `json:"-"`
	OK     int      `json:"ok"`     // recibos de los que se bajó al menos un archivo
	Files  int      `json:"files"`  // archivos en el ZIP
	Failed int      `json:"failed"` // recibos sin ningún archivo
	Errors []string `json:"errors"` // motivo de cada recibo que falló
}

func rheSolFileKinds(kinds []string) ([]string, error) {
	if len(kinds) == 0 {
		return nil, accessErr(SunatAccessInvalidParams, "Elija PDF, XML o ambos.", "")
	}
	out := []string{}
	seen := map[string]bool{}
	for _, k := range kinds {
		k = strings.ToLower(strings.TrimSpace(k))
		if k != "pdf" && k != "xml" {
			return nil, accessErr(SunatAccessInvalidParams, "Formato no válido: use PDF o XML.", k)
		}
		if !seen[k] {
			seen[k] = true
			out = append(out, k)
		}
	}
	return out, nil
}

func normalizeRheSolFileRef(r RheSolFileRef) (serie, numero, day string, err error) {
	r.Comprobante, r.EmisorDoc = strings.ToUpper(strings.TrimSpace(r.Comprobante)), strings.TrimSpace(r.EmisorDoc)
	bad := func(msg string) error {
		return accessErr(SunatAccessInvalidParams, msg, r.Comprobante+" "+r.FecEmision)
	}
	if !reRheComprobante.MatchString(r.Comprobante) {
		return "", "", "", bad("El comprobante debe tener el formato E001-20.")
	}
	if !reRheDigits.MatchString(r.EmisorDoc) {
		return "", "", "", bad("El documento del emisor no es válido.")
	}
	d, perr := time.Parse("2006-01-02", strings.TrimSpace(r.FecEmision))
	if perr != nil {
		return "", "", "", bad("La fecha de emisión debe tener el formato AAAA-MM-DD.")
	}
	parts := strings.SplitN(r.Comprobante, "-", 2)
	return parts[0], strings.TrimLeft(parts[1], "0"), d.Format("02/01/2006"), nil
}

// FetchFiles baja el PDF y/o el XML de los recibos recibidos indicados y los entrega en un ZIP con carpetas PDF/ y XML/.
func (s *RheSolService) FetchFiles(companyID uint, allowed []uint, userID uint, refs []RheSolFileRef, kinds []string) (*RheSolFilesResult, error) {
	kinds, err := rheSolFileKinds(kinds)
	if err != nil {
		return nil, err
	}
	if len(refs) == 0 {
		return nil, accessErr(SunatAccessInvalidParams, "Elija al menos un recibo.", "")
	}
	if len(refs) > rheSolMaxFileRefs {
		return nil, accessErr(SunatAccessInvalidParams, fmt.Sprintf("El máximo es de %d recibos por vez.", rheSolMaxFileRefs), fmt.Sprint(len(refs)))
	}
	type job struct {
		ref                RheSolFileRef
		serie, numero, day string
	}
	jobs := make([]job, 0, len(refs))
	for _, r := range refs {
		se, nu, dy, nerr := normalizeRheSolFileRef(r)
		if nerr != nil {
			return nil, nerr
		}
		jobs = append(jobs, job{ref: r, serie: se, numero: nu, day: dy})
	}
	if _, err := s.creds.GetByCompanyID(companyID, allowed); err != nil {
		return nil, err
	}
	link, err := s.linkFn(companyID, allowed, userID)
	if err != nil {
		return nil, err
	}
	sess, err := openSolMenu(link, s.timeout)
	if err != nil {
		return nil, err
	}
	defer sess.close()

	cfg := rheSolLados[RheSolReceptor]
	resp, opening, err := sess.execute(cfg.menuCode)
	if err != nil {
		return nil, err
	}
	if msg := rheSolSunatMessage(opening); msg != "" {
		return nil, accessErr(SunatAccessUnexpected, "SUNAT no permite esta consulta a la empresa: "+msg, "RHE archivos: "+msg)
	}
	if resp.StatusCode != 200 || !strings.Contains(resp.Request.URL.Path, rheSolAppPath) {
		return nil, accessErr(SunatAccessUnexpected, "SUNAT no abrió la consulta de recibos por honorarios (la empresa podría no tener acceso).",
			fmt.Sprintf("RHE archivos: HTTP %d %s", resp.StatusCode, safeURL(resp.Request.URL)))
	}
	formURL := resp.Request.URL.Scheme + "://" + resp.Request.URL.Host + rheSolFormPath
	referer := resp.Request.URL.String()

	out := &RheSolFilesResult{Errors: []string{}}
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	used := map[string]bool{}
	addFile := func(dir, name string, data []byte) error {
		path := dir + "/" + name
		for i := 2; used[path]; i++ {
			path = fmt.Sprintf("%s/%d-%s", dir, i, name)
		}
		used[path] = true
		w, werr := zw.Create(path)
		if werr != nil {
			return werr
		}
		_, werr = w.Write(data)
		return werr
	}
	fail := func(j job, why string) {
		out.Failed++
		out.Errors = append(out.Errors, fmt.Sprintf("%s: %s", j.ref.Comprobante, why))
	}

	for i, j := range jobs {
		if i > 0 {
			time.Sleep(rheSolFilePause)
		}
		// 1) Búsqueda exacta: serie, número, emisor y el día de emisión.
		form := url.Values{
			"accion": {cfg.searchAcc}, "tipocomprobante": {"01;02;03;"}, "num_serie": {j.serie}, "num_comprob": {j.numero},
			"fec_desde": {j.day}, "fec_hasta": {j.day}, "tipoestado": {"00"}, "tipocomprobante1": {"01", "02", "03"}, "ruc_emisor": {strings.TrimSpace(j.ref.EmisorDoc)},
		}
		r2, page, perr := sess.postForm(formURL, form, referer)
		if perr != nil {
			return nil, perr
		}
		text := sunatBodyToUTF8(page)
		if r2.StatusCode != 200 || strings.Contains(text, "Pagina de Error") || strings.Contains(text, "Página de Error") {
			fail(j, "SUNAT no pudo atender la búsqueda del recibo.")
			continue
		}
		if strings.Contains(text, rheSolEmptyMarker) {
			fail(j, "SUNAT no encontró el recibo.")
			continue
		}
		pos := ""
		rows := reRheEscoger.FindAllStringSubmatch(text, -1)
		for _, m := range rows {
			if rheSolSameComprobante(m[2], j.serie, j.numero) {
				pos = m[1]
				break
			}
		}
		if pos == "" && len(rows) == 1 {
			pos = rows[0][1]
		}
		if pos == "" {
			fail(j, "SUNAT no devolvió ese recibo en la búsqueda.")
			continue
		}
		// 2) El detalle del recibo.
		r3, det, perr := sess.postForm(formURL, url.Values{"accion": {rheSolActDetail}, "posirecibo": {pos}}, r2.Request.URL.String())
		if perr != nil {
			return nil, perr
		}
		if r3.StatusCode != 200 || !strings.Contains(sunatBodyToUTF8(det), rheSolActPDF) {
			fail(j, "SUNAT no abrió el detalle del recibo.")
			continue
		}
		// 3) Los archivos pedidos.
		got, missing := 0, []string{}
		for _, kind := range kinds {
			acc, ext, dir, magic := rheSolActPDF, "pdf", "PDF", "%PDF"
			if kind == "xml" {
				acc, ext, dir, magic = rheSolActXML, "xml", "XML", "<?xml"
			}
			r4, data, perr := sess.postForm(formURL, url.Values{"accion": {acc}}, r3.Request.URL.String())
			if perr != nil {
				return nil, perr
			}
			if r4.StatusCode != http.StatusOK || !bytes.HasPrefix(bytes.TrimSpace(data), []byte(magic)) {
				missing = append(missing, strings.ToUpper(kind))
				continue
			}
			name := fmt.Sprintf("RHE%s%s%08s.%s", j.ref.EmisorDoc, j.serie, j.numero, ext)
			if _, params, derr := mime.ParseMediaType(r4.Header.Get("Content-Disposition")); derr == nil && params["filename"] != "" {
				name = sanitizeRheFileName(params["filename"])
			}
			if werr := addFile(dir, name, data); werr != nil {
				return nil, werr
			}
			got++
			out.Files++
		}
		switch {
		case got == 0:
			fail(j, "SUNAT no entregó "+strings.Join(missing, " ni "))
		case len(missing) > 0:
			out.OK++
			out.Errors = append(out.Errors, fmt.Sprintf("%s: SUNAT no entregó %s", j.ref.Comprobante, strings.Join(missing, " ni ")))
		default:
			out.OK++
		}
	}
	if out.Files == 0 {
		return nil, accessErr(SunatAccessUnexpected, "SUNAT no entregó ningún archivo de los recibos pedidos.", "RHE archivos: "+truncateStr(strings.Join(out.Errors, " | "), 400))
	}
	if len(out.Errors) > 0 {
		w, _ := zw.Create("errores.txt")
		_, _ = w.Write([]byte(strings.Join(out.Errors, "\r\n") + "\r\n"))
	}
	if err := zw.Close(); err != nil {
		return nil, err
	}
	out.Zip = buf.Bytes()
	return out, nil
}

var reRheBadName = regexp.MustCompile(`[^A-Za-z0-9._-]`)

func sanitizeRheFileName(n string) string {
	n = reRheBadName.ReplaceAllString(n, "_")
	if n == "" {
		return "recibo"
	}
	return n
}

// rheSolSameComprobante compara «E001-20» (o «E001-0020») de la lista de SUNAT con la serie y el número buscados.
func rheSolSameComprobante(label, serie, numero string) bool {
	parts := strings.SplitN(strings.TrimSpace(label), "-", 2)
	return len(parts) == 2 && strings.EqualFold(strings.TrimSpace(parts[0]), serie) && strings.TrimLeft(strings.TrimSpace(parts[1]), "0") == numero
}
