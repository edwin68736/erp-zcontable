package services

import (
	"bytes"
	"testing"

	"github.com/xuri/excelize/v2"
)

func TestSireExcel_TiposComoElExcelDeReferencia(t *testing.T) {
	// Una fila de la propuesta de ventas (mismo orden y nombres que el Excel de referencia).
	cols := []string{"Ruc", "Razon Social", "Periodo", "CAR SUNAT", "Fecha de emisión", "Fecha Vcto/Pago", "Tipo CP/Doc.", "Serie del CDP",
		"Nro CP o Doc. Nro Inicial (Rango)", "Tipo Doc Identidad", "Nro Doc Identidad", "BI Gravada", "IGV / IPM", "Total CP", "Moneda", "Tipo Cambio", "Est. Comp", "Tipo Operación", "CLU"}
	rows := [][]string{
		{"20605920340", "EIDOS CONSTRUCTORA S.R.L.", "202610", "2060592034001E0010000000516", "06/10/2026", "", "1", "E001", "516", "6", "20510931514", "4704.00", "846.72", "5550.72", "PEN", "1.000", "1", "1001", ""},
		{"20605920340", "EIDOS CONSTRUCTORA S.R.L.", "202610", "2060592034001E0010000000517", "07/10/2026", "", "1", "E001", "517", "6", "20604778191", "845.69", "152.23", "997.92", "PEN", "1", "1", "1001", ""},
	}
	data, n, err := SireExcelFromTables([]SireTable{{Name: "ventas.txt", Columns: cols, Rows: rows, Total: 2}}, sireLibroVentas)
	if err != nil || n != 2 {
		t.Fatalf("SireExcelFromTables: n=%d err=%v", n, err)
	}
	f, err := excelize.OpenReader(bytes.NewReader(data))
	if err != nil {
		t.Fatalf("el Excel no abre: %v", err)
	}
	defer f.Close()
	if got := f.GetSheetList(); len(got) != 1 || got[0] != "Reporte Ventas" {
		t.Fatalf("hojas: %v", got)
	}
	cell := func(a string) (string, excelize.CellType) {
		v, _ := f.GetCellValue("Reporte Ventas", a)
		ty, _ := f.GetCellType("Reporte Ventas", a)
		return v, ty
	}
	check := func(addr, wantVal string, wantType excelize.CellType) {
		t.Helper()
		v, ty := cell(addr)
		if v != wantVal || ty != wantType {
			t.Errorf("%s = %q (tipo %v), quiero %q (tipo %v)", addr, v, ty, wantVal, wantType)
		}
	}
	check("A1", "Ruc", excelize.CellTypeInlineString)
	check("A2", "20605920340", excelize.CellTypeInlineString) // RUC: texto
	check("C2", "202610", excelize.CellTypeInlineString)      // período: texto
	check("D2", "2060592034001E0010000000516", excelize.CellTypeInlineString)
	check("E2", "06/10/2026", excelize.CellTypeInlineString) // fecha: texto dd/mm/aaaa
	check("F2", "", excelize.CellTypeUnset)                  // vacío: celda vacía
	check("G2", "1", excelize.CellTypeUnset)                // tipo CP: número (celda numérica, sin atributo de texto)
	check("H2", "E001", excelize.CellTypeInlineString)
	check("I2", "516", excelize.CellTypeUnset)
	check("K2", "20510931514", excelize.CellTypeUnset) // nro de documento: número
	check("L2", "4704", excelize.CellTypeUnset)
	check("M2", "846.72", excelize.CellTypeUnset)
	check("N2", "5550.72", excelize.CellTypeUnset)
	check("P2", "1", excelize.CellTypeUnset)
	check("Q2", "1", excelize.CellTypeInlineString) // est. comp: texto
	check("R2", "1001", excelize.CellTypeInlineString)
	check("S2", "", excelize.CellTypeUnset)
	if v, _ := f.GetCellValue("Reporte Ventas", "A3"); v != "20605920340" {
		t.Errorf("segunda fila: %q", v)
	}
}

func TestSireExcel_ComprasYVariasTablas(t *testing.T) {
	a := SireTable{Name: "propuesta.txt", Columns: []string{"RUC", "Total CP", "CLU1"}, Rows: [][]string{{"20123456789", "100.50", "0012"}}, Total: 1}
	b := SireTable{Name: "otra:cosa?.txt", Columns: []string{"X"}, Rows: [][]string{{"1"}}, Total: 1}
	data, n, err := SireExcelFromTables([]SireTable{a, b}, sireLibroCompras)
	if err != nil || n != 2 {
		t.Fatalf("n=%d err=%v", n, err)
	}
	f, _ := excelize.OpenReader(bytes.NewReader(data))
	defer f.Close()
	sheets := f.GetSheetList()
	if len(sheets) != 2 || sheets[0] != "Reporte Compras" || sheets[1] != "otra-cosa-.txt" {
		t.Fatalf("hojas: %v", sheets)
	}
	if v, _ := f.GetCellValue("Reporte Compras", "C2"); v != "0012" {
		t.Errorf("CLU conserva ceros: %q", v)
	}
	if ty, _ := f.GetCellType("Reporte Compras", "B2"); ty != excelize.CellTypeUnset {
		t.Errorf("Total CP debe ser número: %v", ty)
	}
}

func TestSireExcel_SinFilasYNombre(t *testing.T) {
	if _, n, err := SireExcelFromTables([]SireTable{{Name: "x.txt", Columns: []string{"A"}}}, sireLibroVentas); err != nil || n != 0 {
		t.Fatalf("n=%d err=%v", n, err)
	}
	if _, _, err := SireExcelFromTables(nil, sireLibroVentas); err == nil {
		t.Fatal("sin tablas debe fallar")
	}
	if got := SireExcelFileName("20605920340", "202610", sireLibroVentas); got != "20605920340-202610-SIREV-Propuesta.xlsx" {
		t.Errorf("nombre ventas: %s", got)
	}
	if got := SireExcelFileName("20605920340", "202610", sireLibroCompras); got != "20605920340-202610-SIREC-Propuesta.xlsx" {
		t.Errorf("nombre compras: %s", got)
	}
}
