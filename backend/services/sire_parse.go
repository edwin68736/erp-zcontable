package services

import (
	"archive/zip"
	"bytes"
	"encoding/csv"
	"io"
	"path"
	"sort"
	"strings"
	"unicode/utf8"
)

// SireTable un archivo de datos (TXT/CSV) de SUNAT convertido a tabla para mostrarlo en pantalla.
type SireTable struct {
	Name    string     `json:"name"`
	Columns []string   `json:"columns"`
	Rows    [][]string `json:"-"`
	Total   int        `json:"total"`
}

const sireMaxRowsPerFile = 300000

// ParseSireArchive convierte la descarga de SUNAT en tablas: un ZIP con uno o más TXT/CSV, o directamente un TXT/CSV.
// Los archivos que no son de texto (PDF, etc.) se omiten.
func ParseSireArchive(data []byte, fallbackName string) ([]SireTable, error) {
	if len(data) >= 4 && data[0] == 'P' && data[1] == 'K' {
		zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
		if err != nil {
			return nil, err
		}
		names := make([]*zip.File, 0, len(zr.File))
		for _, f := range zr.File {
			if !f.FileInfo().IsDir() {
				names = append(names, f)
			}
		}
		sort.Slice(names, func(i, j int) bool { return names[i].Name < names[j].Name })
		out := []SireTable{}
		for _, f := range names {
			ext := strings.ToLower(path.Ext(f.Name))
			if ext != ".txt" && ext != ".csv" && ext != "" {
				continue
			}
			rc, err := f.Open()
			if err != nil {
				return nil, err
			}
			b, err := io.ReadAll(io.LimitReader(rc, 512<<20))
			rc.Close()
			if err != nil {
				return nil, err
			}
			if t := parseSireText(b, path.Base(f.Name)); t != nil {
				out = append(out, *t)
			}
		}
		return out, nil
	}
	if len(data) >= 4 && string(data[:4]) == "%PDF" {
		return nil, nil
	}
	if t := parseSireText(data, fallbackName); t != nil {
		return []SireTable{*t}, nil
	}
	return nil, nil
}

// decodeSireText devuelve UTF-8: SUNAT entrega UTF-8 o ANSI (Latin-1).
func decodeSireText(b []byte) string {
	b = bytes.TrimPrefix(b, []byte{0xEF, 0xBB, 0xBF})
	if utf8.Valid(b) {
		return string(b)
	}
	r := make([]rune, len(b))
	for i, c := range b {
		r[i] = rune(c)
	}
	return string(r)
}

func parseSireText(b []byte, name string) *SireTable {
	text := decodeSireText(b)
	text = strings.ReplaceAll(text, "\r\n", "\n")
	text = strings.ReplaceAll(text, "\r", "\n")
	lines := strings.Split(text, "\n")
	for len(lines) > 0 && strings.TrimSpace(lines[len(lines)-1]) == "" {
		lines = lines[:len(lines)-1]
	}
	if len(lines) == 0 {
		return nil
	}
	delim := detectSireDelimiter(lines[0])
	t := &SireTable{Name: name}
	parse := func(line string) []string {
		if delim == ',' || delim == ';' {
			r := csv.NewReader(strings.NewReader(line))
			r.Comma = delim
			r.LazyQuotes = true
			r.FieldsPerRecord = -1
			if rec, err := r.Read(); err == nil {
				return rec
			}
		}
		return strings.Split(line, string(delim))
	}
	t.Columns = parse(lines[0])
	for i, c := range t.Columns {
		t.Columns[i] = strings.TrimSpace(c)
	}
	for _, line := range lines[1:] {
		if strings.TrimSpace(line) == "" {
			continue
		}
		if len(t.Rows) >= sireMaxRowsPerFile {
			break
		}
		t.Rows = append(t.Rows, parse(line))
	}
	t.Total = len(t.Rows)
	return t
}

func detectSireDelimiter(header string) rune {
	best, bestN := '|', strings.Count(header, "|")
	for _, d := range []rune{',', ';', '\t'} {
		if n := strings.Count(header, string(d)); n > bestN {
			best, bestN = d, n
		}
	}
	return best
}

// SireTablePage una página de una tabla, con búsqueda simple por texto.
type SireTablePage struct {
	Name     string     `json:"name"`
	Columns  []string   `json:"columns"`
	Rows     [][]string `json:"rows"`
	Total    int        `json:"total"`    // filas de la tabla (sin filtrar)
	Filtered int        `json:"filtered"` // filas que cumplen el filtro
	Page     int        `json:"page"`
	PerPage  int        `json:"per_page"`
}

// Page devuelve una página (base 1) de las filas que contengan q (sin distinguir mayúsculas).
func (t SireTable) Page(page, perPage int, q string) SireTablePage {
	if page < 1 {
		page = 1
	}
	if perPage < 1 || perPage > 500 {
		perPage = 100
	}
	q = strings.ToLower(strings.TrimSpace(q))
	idx := make([]int, 0, len(t.Rows))
	for i, r := range t.Rows {
		if q == "" || strings.Contains(strings.ToLower(strings.Join(r, " ")), q) {
			idx = append(idx, i)
		}
	}
	start := (page - 1) * perPage
	if start > len(idx) {
		start = len(idx)
	}
	end := start + perPage
	if end > len(idx) {
		end = len(idx)
	}
	rows := make([][]string, 0, end-start)
	for _, i := range idx[start:end] {
		rows = append(rows, t.Rows[i])
	}
	return SireTablePage{Name: t.Name, Columns: t.Columns, Rows: rows, Total: len(t.Rows), Filtered: len(idx), Page: page, PerPage: perPage}
}
