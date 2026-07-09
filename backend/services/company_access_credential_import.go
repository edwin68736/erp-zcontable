package services

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"regexp"
	"strings"

	"miappfiber/database"
	"miappfiber/models"

	"github.com/xuri/excelize/v2"
	"gorm.io/gorm"
)

const (
	credImportSheetMain   = "Claves"
	credImportMaxRows     = 1000
	credImportMaxFileSize = 8 << 20
)

// CompanyAccessCredentialImportRowError error por fila del Excel.
type CompanyAccessCredentialImportRowError struct {
	Row     int    `json:"row"`
	Message string `json:"message"`
}

type companyAccessCredentialImportParsed struct {
	excelRow int
	ruc      string
	fields   CompanyAccessCredentialUpdateInput
}

var credImportRucNonDigit = regexp.MustCompile(`\D`)

func normalizeImportRUC(raw string) (string, error) {
	d := credImportRucNonDigit.ReplaceAllString(strings.TrimSpace(raw), "")
	if len(d) != 11 {
		return "", errors.New("el RUC debe tener 11 dígitos")
	}
	return d, nil
}

// findStudioCompanyByRUC busca empresa del estudio por RUC (11 dígitos), tolerando guiones/espacios en BD.
func findStudioCompanyByRUC(normRUC string) (*models.Company, error) {
	var company models.Company
	err := database.DB.Where("client_type = ? AND ruc = ?", models.CompanyClientTypeEstudio, normRUC).
		First(&company).Error
	if err == nil {
		return &company, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	err = database.DB.Where(
		`client_type = ? AND REPLACE(REPLACE(REPLACE(TRIM(ruc), '-', ''), ' ', ''), '.', '') = ?`,
		models.CompanyClientTypeEstudio, normRUC,
	).First(&company).Error
	if err != nil {
		return nil, err
	}
	return &company, nil
}

// CompanyAccessCredentialImportTemplateXLSX plantilla vacía con una fila de ejemplo.
func CompanyAccessCredentialImportTemplateXLSX() ([]byte, error) {
	f := excelize.NewFile()
	defer func() { _ = f.Close() }()

	const sheet = credImportSheetMain
	if err := f.SetSheetName("Sheet1", sheet); err != nil {
		return nil, err
	}

	headers := []string{
		"ruc", "dig", "sol_usuario", "sol_clave",
		"bnl_cta", "bnl_dni", "bnl_clave_detracciones",
		"afp_usuario", "afp_clave", "rnp_clave",
		"facturador_link", "facturador_usuario", "facturador_contrasena",
	}
	for i, h := range headers {
		cell, _ := excelize.CoordinatesToCellName(i+1, 1)
		if err := f.SetCellStr(sheet, cell, h); err != nil {
			return nil, err
		}
	}

	example := []string{
		"20123456789", "1",
		"usuario_sol_ejemplo", "clave_sol_ejemplo",
		"0001234567890", "12345678", "clave_detr_ejemplo",
		"usuario_afp", "clave_afp_ejemplo",
		"clave_rnp_ejemplo",
		"https://ejemplo.com/facturador", "user_fact", "pass_fact",
	}
	for i, v := range example {
		cell, _ := excelize.CoordinatesToCellName(i+1, 2)
		if err := f.SetCellStr(sheet, cell, v); err != nil {
			return nil, err
		}
	}

	_ = f.SetColWidth(sheet, "A", "M", 18)
	buf, err := f.WriteToBuffer()
	if err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func parseCredentialImportSheet(f *excelize.File) ([]companyAccessCredentialImportParsed, []CompanyAccessCredentialImportRowError, error) {
	rows, err := f.GetRows(credImportSheetMain)
	if err != nil || len(rows) == 0 {
		return nil, nil, errors.New("no se encontró la hoja «Claves» o está vacía")
	}

	header := rows[0]
	colIdx := make(map[string]int)
	for i, h := range header {
		key := strings.ToLower(strings.TrimSpace(h))
		if key != "" {
			colIdx[key] = i
		}
	}
	required := []string{"ruc"}
	for _, k := range required {
		if _, ok := colIdx[k]; !ok {
			return nil, nil, fmt.Errorf("falta la columna obligatoria «%s» en la fila de cabeceras", k)
		}
	}

	getCell := func(row []string, key string) string {
		i, ok := colIdx[key]
		if !ok || i >= len(row) {
			return ""
		}
		return strings.TrimSpace(row[i])
	}

	var parsed []companyAccessCredentialImportParsed
	var errs []CompanyAccessCredentialImportRowError

	for ri := 1; ri < len(rows); ri++ {
		excelRow := ri + 1
		row := rows[ri]
		if rowEmpty(row) {
			continue
		}
		if len(parsed) >= credImportMaxRows {
			errs = append(errs, CompanyAccessCredentialImportRowError{
				Row: excelRow, Message: fmt.Sprintf("Se superó el máximo de %d filas de datos", credImportMaxRows),
			})
			break
		}

		rucRaw := getCell(row, "ruc")
		if rucRaw == "" {
			errs = append(errs, CompanyAccessCredentialImportRowError{Row: excelRow, Message: "ruc es obligatorio"})
			continue
		}
		ruc, rucErr := normalizeImportRUC(rucRaw)
		if rucErr != nil {
			errs = append(errs, CompanyAccessCredentialImportRowError{Row: excelRow, Message: rucErr.Error()})
			continue
		}

		fields := CompanyAccessCredentialUpdateInput{
			Dig:                  getCell(row, "dig"),
			SolUsuario:           getCell(row, "sol_usuario"),
			SolClave:             getCell(row, "sol_clave"),
			BnlCuenta:            getCell(row, "bnl_cta"),
			BnlDNI:               getCell(row, "bnl_dni"),
			BnlClaveDetracciones: getCell(row, "bnl_clave_detracciones"),
			AfpUsuario:           getCell(row, "afp_usuario"),
			AfpClave:             getCell(row, "afp_clave"),
			RnpClave:             getCell(row, "rnp_clave"),
			FacturadorLink:       getCell(row, "facturador_link"),
			FacturadorUsuario:    getCell(row, "facturador_usuario"),
			FacturadorContrasena: getCell(row, "facturador_contrasena"),
		}
		parsed = append(parsed, companyAccessCredentialImportParsed{excelRow: excelRow, ruc: ruc, fields: fields})
	}

	return parsed, errs, nil
}

func rowEmpty(row []string) bool {
	for _, c := range row {
		if strings.TrimSpace(c) != "" {
			return false
		}
	}
	return true
}

func openCredentialImportWorkbook(r io.Reader, size int64) (*excelize.File, error) {
	if size <= 0 || size > credImportMaxFileSize {
		return nil, errors.New("archivo vacío o demasiado grande (máx. 8 MB)")
	}
	raw, err := io.ReadAll(r)
	if err != nil {
		return nil, errors.New("no se pudo leer el archivo")
	}
	f, err := excelize.OpenReader(bytes.NewReader(raw))
	if err != nil {
		return nil, errors.New("no se pudo leer el Excel (.xlsx). Use la plantilla descargada desde la vista")
	}
	return f, nil
}

// CompanyAccessCredentialImportValidate valida el archivo sin guardar.
func CompanyAccessCredentialImportValidate(r io.Reader, size int64) ([]CompanyAccessCredentialImportRowError, int, []string, error) {
	f, err := openCredentialImportWorkbook(r, size)
	if err != nil {
		return nil, 0, nil, err
	}
	defer func() { _ = f.Close() }()

	parsed, parseErrs, err := parseCredentialImportSheet(f)
	if err != nil {
		return nil, 0, nil, err
	}

	errs := append([]CompanyAccessCredentialImportRowError{}, parseErrs...)
	unmatched := make([]string, 0)

	rucSeen := make(map[string]int)
	for _, pr := range parsed {
		if prev, dup := rucSeen[pr.ruc]; dup {
			errs = append(errs, CompanyAccessCredentialImportRowError{
				Row: pr.excelRow, Message: fmt.Sprintf("RUC duplicado en el archivo (también en fila %d)", prev),
			})
			continue
		}
		rucSeen[pr.ruc] = pr.excelRow

		company, err := findStudioCompanyByRUC(pr.ruc)
		if errors.Is(err, gorm.ErrRecordNotFound) {
			unmatched = append(unmatched, pr.ruc)
			continue
		}
		if err != nil {
			errs = append(errs, CompanyAccessCredentialImportRowError{Row: pr.excelRow, Message: "error al buscar empresa por RUC"})
			continue
		}
		_ = company
	}

	return errs, len(parsed), unmatched, nil
}

// CompanyAccessCredentialImportCommit actualiza credenciales por RUC; devuelve RUC no registrados.
func CompanyAccessCredentialImportCommit(r io.Reader, size int64) (updated int, unmatched []string, valErrs []CompanyAccessCredentialImportRowError, err error) {
	f, err := openCredentialImportWorkbook(r, size)
	if err != nil {
		return 0, nil, nil, err
	}
	defer func() { _ = f.Close() }()

	parsed, parseErrs, err := parseCredentialImportSheet(f)
	if err != nil {
		return 0, nil, nil, err
	}
	if len(parseErrs) > 0 {
		return 0, nil, parseErrs, nil
	}

	svc := NewCompanyAccessCredentialService()
	unmatched = make([]string, 0)
	rucSeen := make(map[string]int)

	for _, pr := range parsed {
		if prev, dup := rucSeen[pr.ruc]; dup {
			valErrs = append(valErrs, CompanyAccessCredentialImportRowError{
				Row: pr.excelRow, Message: fmt.Sprintf("RUC duplicado en el archivo (también en fila %d)", prev),
			})
			continue
		}
		rucSeen[pr.ruc] = pr.excelRow

		company, err := findStudioCompanyByRUC(pr.ruc)
		if errors.Is(err, gorm.ErrRecordNotFound) {
			unmatched = append(unmatched, pr.ruc)
			continue
		}
		if err != nil {
			valErrs = append(valErrs, CompanyAccessCredentialImportRowError{Row: pr.excelRow, Message: "error al buscar empresa"})
			continue
		}

		if _, err := svc.Upsert(company.ID, pr.fields, nil); err != nil {
			valErrs = append(valErrs, CompanyAccessCredentialImportRowError{Row: pr.excelRow, Message: err.Error()})
			continue
		}
		updated++
	}

	if len(valErrs) > 0 {
		return updated, unmatched, valErrs, nil
	}
	return updated, unmatched, nil, nil
}
