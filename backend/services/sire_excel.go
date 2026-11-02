package services

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"github.com/xuri/excelize/v2"
)

// Conversión de un archivo del SIRE (TXT/CSV de SUNAT) a un Excel (.xlsx) válido: una hoja con la fila de
// encabezados de SUNAT y una fila por comprobante, con los números como números y los códigos como texto
// (RUC, período, CAR, serie…), igual que el Excel que se obtiene de otros sistemas.

const (
	sireExcelMime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
	// Excel no admite más de 1 048 576 filas por hoja.
	sireExcelMaxRows = 1_000_000
)

var reSireNumber = regexp.MustCompile(`^-?\d+(\.\d+)?$`)

// Columnas que son códigos aunque parezcan números (un RUC o un período no se suman ni se redondean).
var sireTextColumns = map[string]bool{
	"ruc": true, "razon social": true, "periodo": true, "car sunat": true, "serie del cdp": true, "serie cp modificado": true,
	"est. comp": true, "est. comp.": true, "tipo operación": true, "tipo operacion": true, "dam / cp": true, "tipo de nota": true,
	"id proyecto operadores atribución": true, "id proyecto operadores atribucion": true, "id proyecto operadores": true,
	"car orig/ ind e o i": true, "moneda": true,
}

func sireIsTextColumn(header string) bool {
	h := strings.ToLower(strings.TrimSpace(header))
	return sireTextColumns[h] || strings.HasPrefix(h, "clu")
}

// sireCell convierte un valor de texto del archivo de SUNAT en el valor de la celda.
func sireCell(header, v string) any {
	v = strings.TrimSpace(v)
	if v == "" {
		return nil
	}
	if sireIsTextColumn(header) || !reSireNumber.MatchString(v) {
		return v
	}
	if !strings.Contains(v, ".") {
		if n, err := strconv.ParseInt(v, 10, 64); err == nil {
			return n
		}
		return v
	}
	if f, err := strconv.ParseFloat(v, 64); err == nil {
		return f
	}
	return v
}

func sireSheetName(base string, used map[string]bool) string {
	name := strings.Map(func(r rune) rune {
		if strings.ContainsRune(`:\/?*[]`, r) {
			return '-'
		}
		return r
	}, strings.TrimSpace(base))
	if name == "" {
		name = "Hoja"
	}
	if len(name) > 31 {
		name = name[:31]
	}
	for i := 2; used[strings.ToLower(name)]; i++ {
		suffix := fmt.Sprintf(" (%d)", i)
		cut := name
		if len(cut)+len(suffix) > 31 {
			cut = cut[:31-len(suffix)]
		}
		name = cut + suffix
	}
	used[strings.ToLower(name)] = true
	return name
}

// SireExcelFromTables arma el .xlsx. La primera tabla va en la hoja «Reporte Ventas» o «Reporte Compras»; si el
// archivo de SUNAT trae más de una tabla, cada una va en su propia hoja. Devuelve el Excel y el total de filas.
func SireExcelFromTables(tables []SireTable, libro string) ([]byte, int, error) {
	f := excelize.NewFile()
	defer f.Close()
	used := map[string]bool{}
	first := "Reporte Compras"
	if libro == sireLibroVentas {
		first = "Reporte Ventas"
	}
	boldStyle, err := f.NewStyle(&excelize.Style{Font: &excelize.Font{Bold: true}})
	if err != nil {
		return nil, 0, err
	}
	total, sheets := 0, 0
	for i, t := range tables {
		if len(t.Columns) == 0 {
			continue
		}
		if len(t.Rows) > sireExcelMaxRows {
			return nil, 0, fmt.Errorf("el archivo tiene más filas de las que admite una hoja de Excel (%d)", len(t.Rows))
		}
		name := first
		if i > 0 {
			name = t.Name
		}
		name = sireSheetName(name, used)
		if sheets == 0 {
			if err := f.SetSheetName(f.GetSheetName(0), name); err != nil {
				return nil, 0, err
			}
		} else if _, err := f.NewSheet(name); err != nil {
			return nil, 0, err
		}
		sw, err := f.NewStreamWriter(name)
		if err != nil {
			return nil, 0, err
		}
		head := make([]any, len(t.Columns))
		for c, h := range t.Columns {
			head[c] = excelize.Cell{Value: h, StyleID: boldStyle}
		}
		if err := sw.SetRow("A1", head); err != nil {
			return nil, 0, err
		}
		for r, row := range t.Rows {
			vals := make([]any, len(t.Columns))
			for c := range t.Columns {
				if c < len(row) {
					vals[c] = sireCell(t.Columns[c], row[c])
				}
			}
			cell, _ := excelize.CoordinatesToCellName(1, r+2)
			if err := sw.SetRow(cell, vals); err != nil {
				return nil, 0, err
			}
		}
		if err := sw.Flush(); err != nil {
			return nil, 0, err
		}
		total += len(t.Rows)
		sheets++
	}
	if sheets == 0 {
		return nil, 0, fmt.Errorf("el archivo de SUNAT no trae datos tabulares")
	}
	buf, err := f.WriteToBuffer()
	if err != nil {
		return nil, 0, err
	}
	return buf.Bytes(), total, nil
}

// RUC de la empresa de la sesión (para nombrar los archivos).
func (ss *SireSession) RUC() string { return ss.creds.RUC }

// SireExcelFileName nombre del Excel de la propuesta: «<RUC>-<AAAAMM>-SIREV-Propuesta.xlsx» (ventas) o «-SIREC-» (compras).
func SireExcelFileName(ruc, period, libro string) string {
	tag := "SIREC"
	if libro == sireLibroVentas {
		tag = "SIREV"
	}
	return fmt.Sprintf("%s-%s-%s-Propuesta.xlsx", ruc, period, tag)
}
