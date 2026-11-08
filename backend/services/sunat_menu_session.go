package services

import (
	"fmt"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"strings"
	"time"
)

// Sesión en el Menú SOL para leer una pantalla de SUNAT que no tiene API (ITF, etc.): sigue el enlace de ingreso
// (un solo uso), queda con las cookies del menú, abre una opción por su código y, al terminar, cierra la sesión.
// Es solo lectura: quien la usa decide qué páginas pide.

type solMenuSession struct {
	client  *http.Client
	menuURL string
	sub     string
}

// openSolMenu sigue el enlace de ingreso a SOL y deja la sesión del menú abierta.
func openSolMenu(link string, timeout time.Duration) (*solMenuSession, error) {
	jar, _ := cookiejar.New(nil)
	m := &solMenuSession{client: &http.Client{Jar: jar, Timeout: timeout}, sub: "ww1"}
	resp, body, err := m.do(http.MethodGet, link, nil, "")
	if err != nil {
		return nil, err
	}
	menu := *resp.Request.URL
	menu.RawQuery, menu.Fragment = "", ""
	if resp.StatusCode != http.StatusOK || !strings.Contains(menu.Path, "MenuInternet") {
		return nil, accessErr(SunatAccessUnexpected, "SUNAT respondió de forma inesperada al abrir el menú.", fmt.Sprintf("menú: HTTP %d %s", resp.StatusCode, safeURL(resp.Request.URL)))
	}
	m.menuURL = menu.String()
	if sm := reBuzonSubdominio.FindStringSubmatch(string(body)); sm != nil {
		m.sub = sm[1]
	}
	return m, nil
}

func (m *solMenuSession) do(method, u string, form url.Values, referer string) (*http.Response, []byte, error) {
	var rd io.Reader
	if form != nil {
		rd = strings.NewReader(form.Encode())
	}
	req, _ := http.NewRequest(method, u, rd)
	req.Header.Set("User-Agent", sunatSolUserAgent)
	req.Header.Set("Accept-Language", "es-PE,es;q=0.9")
	if form != nil {
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	}
	if referer != "" {
		req.Header.Set("Referer", referer)
	}
	resp, err := m.client.Do(req)
	if err != nil {
		return nil, nil, accessErr(SunatAccessUnavailable, "No se pudo conectar con SUNAT. Intente de nuevo en unos minutos.", "menú: "+errSummary(err))
	}
	b, _ := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	resp.Body.Close()
	return resp, b, nil
}

// execute abre una opción del menú por su código (por ejemplo «13.6.1.1.1») y devuelve la primera página.
func (m *solMenuSession) execute(code string) (*http.Response, []byte, error) {
	return m.do(http.MethodGet, m.menuURL+"?action=execute&code="+url.QueryEscape(code)+"&s="+url.QueryEscape(m.sub), nil, "")
}

// postForm envía un formulario de la aplicación abierta.
func (m *solMenuSession) postForm(u string, form url.Values, referer string) (*http.Response, []byte, error) {
	return m.do(http.MethodPost, u, form, referer)
}

// close cierra la aplicación abierta y la sesión del menú (mejor esfuerzo).
func (m *solMenuSession) close() {
	(&SunatBuzonService{}).logout(m.client, m.menuURL)
}
