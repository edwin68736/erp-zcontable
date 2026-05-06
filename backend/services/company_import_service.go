package services

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"regexp"
	"strconv"
	"strings"
	"time"

	"miappfiber/database"
	"miappfiber/models"

	"github.com/xuri/excelize/v2"
	"gorm.io/gorm"
)

const (
	companyImportSheetMain   = "Empresas"
	companyImportSheetRef    = "Referencia"
	companyImportMaxRows     = 500
	companyImportMaxFileSize = 8 << 20
)

// CompanyImportRowError describe un problema en una fila del Excel (número de fila = hoja, incl. cabecera).
type CompanyImportRowError struct {
	Row     int    `json:"row"`
	Message string `json:"message"`
}

type companyImportParsedRow struct {
	excelRow int
	company  models.Company
	contacts []models.Contact
}

var rucNonDigit = regexp.MustCompile(`\D`)

// CompanyImportTemplateXLSX genera un .xlsx con cabeceras, ejemplo y hoja de referencia (planes y usuarios de equipo).
func CompanyImportTemplateXLSX() ([]byte, error) {
	f := excelize.NewFile()
	defer func() { _ = f.Close() }()

	const main = companyImportSheetMain
	if err := f.SetSheetName("Sheet1", main); err != nil {
		return nil, err
	}

	headers := []string{
		"codigo_interno", "ruc", "razon_social", "nombre_comercial", "estado",
		"direccion", "telefono", "email", "inicio_servicio",
		"plan_nombre", "ciclo_facturacion", "suscripcion_inicio", "suscripcion_fin", "suscripcion_activa",
		"monto_facturacion_declarada",
		"documento_contador", "documento_supervisor", "documento_asistente",
		"c1_nombre", "c1_cargo", "c1_telefono", "c1_email", "c1_prioridad",
		"c2_nombre", "c2_cargo", "c2_telefono", "c2_email", "c2_prioridad",
		"c3_nombre", "c3_cargo", "c3_telefono", "c3_email", "c3_prioridad",
	}
	for i, h := range headers {
		cell, _ := excelize.CoordinatesToCellName(i+1, 1)
		if err := f.SetCellStr(main, cell, h); err != nil {
			return nil, err
		}
	}

	var plans []models.SubscriptionPlan
	if err := database.DB.Where("active = ?", true).Order("id ASC").Find(&plans).Error; err != nil {
		return nil, err
	}
	examplePlan := "Mi plan activo"
	if len(plans) > 0 {
		examplePlan = plans[0].Name
	}

	var users []models.User
	if err := database.DB.Where("active = ? AND role IN ?", true, []string{"Contador", "Supervisor", "Asistente", "Administrador"}).
		Order("role ASC, name ASC").Find(&users).Error; err != nil {
		return nil, err
	}
	var exDocCont, exDocSup, exDocAss string
	for _, u := range users {
		d := strings.TrimSpace(u.DNI)
		if d == "" {
			continue
		}
		if u.Role == "Contador" || u.Role == "Administrador" {
			if exDocCont == "" {
				exDocCont = d
			}
		}
		if u.Role == "Supervisor" || u.Role == "Administrador" {
			if exDocSup == "" {
				exDocSup = d
			}
		}
		if u.Role == "Asistente" || u.Role == "Administrador" {
			if exDocAss == "" {
				exDocAss = d
			}
		}
	}

	_ = f.SetSheetRow(main, "A2", &[]interface{}{
		"0001", "20123456789", "EMPRESA DEMO SAC", "Demo", "activo",
		"Av. Ejemplo 123", "999888777", "contacto@demo.com", "2026-01-15",
		examplePlan, "start_month", "2026-01-01", "", "si",
		"",
		exDocCont, exDocSup, exDocAss,
		"Juan Pérez", "Gerente general", "999111222", "juan@demo.com", "Alta",
		"", "", "", "", "",
		"", "", "", "", "",
	})

	if _, err := f.NewSheet(companyImportSheetRef); err != nil {
		return nil, err
	}
	ref := companyImportSheetRef
	_ = f.SetCellStr(ref, "A1", "Planes activos (use el nombre exacto en plan_nombre)")
	_ = f.SetCellStr(ref, "B1", "nombre")
	for i, p := range plans {
		r := i + 2
		_ = f.SetCellStr(ref, "B"+strconv.Itoa(r), p.Name)
	}

	startUsers := len(plans) + 4
	_ = f.SetCellStr(ref, "A"+strconv.Itoa(startUsers), "Usuarios equipo (documento = DNI en el sistema; si no existe, no se asigna)")
	_ = f.SetCellStr(ref, "B"+strconv.Itoa(startUsers+1), "documento")
	_ = f.SetCellStr(ref, "C"+strconv.Itoa(startUsers+1), "nombre")
	_ = f.SetCellStr(ref, "D"+strconv.Itoa(startUsers+1), "email")
	_ = f.SetCellStr(ref, "E"+strconv.Itoa(startUsers+1), "rol")
	for i, u := range users {
		r := startUsers + 2 + i
		_ = f.SetCellStr(ref, "B"+strconv.Itoa(r), strings.TrimSpace(u.DNI))
		_ = f.SetCellStr(ref, "C"+strconv.Itoa(r), u.Name)
		_ = f.SetCellStr(ref, "D"+strconv.Itoa(r), (&u).EmailString())
		_ = f.SetCellStr(ref, "E"+strconv.Itoa(r), u.Role)
	}

	if _, err := f.NewSheet("Instrucciones"); err != nil {
		return nil, err
	}
	inst := "Instrucciones"
	lines := []string{
		"1) Complete la hoja «Empresas». No elimine ni renombre la fila de cabeceras.",
		"2) Archivo obligatorio: formato Excel (.xlsx), no CSV.",
		"3) codigo_interno, ruc, razon_social, plan_nombre, ciclo_facturacion y suscripcion_inicio son obligatorios por fila.",
		"4) plan_nombre: texto igual al nombre de un plan activo (véase hoja Referencia), sin importar mayúsculas.",
		"5) ruc: 11 dígitos. estado: activo o inactivo.",
		"6) ciclo_facturacion: start_month o end_month (también inicio_mes / fin_mes).",
		"7) Fechas: AAAA-MM-DD (inicio_servicio, suscripcion_inicio, suscripcion_fin opcional).",
		"8) suscripcion_activa: si / no / true / false.",
		"9) documento_contador / documento_supervisor / documento_asistente: DNI del usuario (campo documento en el sistema). Si no hay usuario con ese documento, el cargo queda sin asignar. Si existe y el rol no corresponde, se marca error.",
		"10) Contactos c1_… c2_… c3_: si completa un bloque, deben ir nombre, cargo, teléfono y correo (prioridad opcional).",
		"11) Use «Validar» en la web antes de importar: no se guardará nada si hay errores.",
	}
	for i, ln := range lines {
		_ = f.SetCellStr(inst, "A"+strconv.Itoa(i+1), ln)
	}

	buf, err := f.WriteToBuffer()
	if err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func companyImportExpectedHeaders() []string {
	return []string{
		"codigo_interno", "ruc", "razon_social", "nombre_comercial", "estado",
		"direccion", "telefono", "email", "inicio_servicio",
		"plan_nombre", "ciclo_facturacion", "suscripcion_inicio", "suscripcion_fin", "suscripcion_activa",
		"monto_facturacion_declarada",
		"documento_contador", "documento_supervisor", "documento_asistente",
		"c1_nombre", "c1_cargo", "c1_telefono", "c1_email", "c1_prioridad",
		"c2_nombre", "c2_cargo", "c2_telefono", "c2_email", "c2_prioridad",
		"c3_nombre", "c3_cargo", "c3_telefono", "c3_email", "c3_prioridad",
	}
}

func rowIsEmpty(row []string) bool {
	for _, c := range row {
		if strings.TrimSpace(c) != "" {
			return false
		}
	}
	return true
}

func headerColumnMap(header []string) (map[string]int, []CompanyImportRowError) {
	want := companyImportExpectedHeaders()
	col := make(map[string]int, len(header))
	for i, h := range header {
		key := strings.ToLower(strings.TrimSpace(h))
		if key == "" {
			continue
		}
		col[key] = i
	}
	var errs []CompanyImportRowError
	for _, w := range want {
		if _, ok := col[w]; !ok {
			errs = append(errs, CompanyImportRowError{Row: 1, Message: fmt.Sprintf("Falta la columna obligatoria «%s» en la cabecera", w)})
		}
	}
	return col, errs
}

func cell(row []string, col map[string]int, key string) string {
	i, ok := col[key]
	if !ok || i < 0 || i >= len(row) {
		return ""
	}
	return strings.TrimSpace(row[i])
}

func resolveSubscriptionPlanIDByName(planName string) (uint, error) {
	n := strings.TrimSpace(planName)
	if n == "" {
		return 0, errors.New("plan_nombre es obligatorio")
	}
	var plans []models.SubscriptionPlan
	if err := database.DB.Where("active = ?", true).Find(&plans).Error; err != nil {
		return 0, err
	}
	var matches []models.SubscriptionPlan
	for _, p := range plans {
		if strings.EqualFold(strings.TrimSpace(p.Name), n) {
			matches = append(matches, p)
		}
	}
	if len(matches) == 0 {
		return 0, fmt.Errorf("no hay plan activo con el nombre «%s»", n)
	}
	if len(matches) > 1 {
		return 0, fmt.Errorf("varios planes activos coinciden con «%s»; use un nombre más específico", n)
	}
	return matches[0].ID, nil
}

// resolveTeamUserIDByDocument busca usuario activo por DNI. Si no hay coincidencia, devuelve (nil, nil).
// Si hay varios o el rol no sirve para el puesto, devuelve error de fila.
func resolveTeamUserIDByDocument(excelRow int, docRaw string, columnKey string, acceptRoles []string) (*uint, *CompanyImportRowError) {
	doc := strings.TrimSpace(docRaw)
	if doc == "" {
		return nil, nil
	}
	var list []models.User
	if err := database.DB.Where("active = ? AND dni <> ? AND TRIM(dni) = ?", true, "", doc).Find(&list).Error; err != nil {
		return nil, &CompanyImportRowError{Row: excelRow, Message: columnKey + ": error al buscar usuario"}
	}
	if len(list) == 0 {
		return nil, nil
	}
	if len(list) > 1 {
		return nil, &CompanyImportRowError{Row: excelRow, Message: columnKey + ": hay más de un usuario activo con el mismo documento"}
	}
	u := list[0]
	if u.Role == "Administrador" {
		id := u.ID
		return &id, nil
	}
	ok := false
	for _, r := range acceptRoles {
		if u.Role == r {
			ok = true
			break
		}
	}
	if !ok {
		return nil, &CompanyImportRowError{
			Row: excelRow,
			Message: fmt.Sprintf("%s: el usuario existe pero su rol es «%s» (se esperaba %s)",
				columnKey, u.Role, strings.Join(acceptRoles, " o ")),
		}
	}
	id := u.ID
	return &id, nil
}

func parseBillingCycleCell(s string) (string, error) {
	v := strings.ToLower(strings.TrimSpace(s))
	switch v {
	case "start_month", "inicio_mes", "mes_inicio":
		return "start_month", nil
	case "end_month", "fin_mes", "mes_fin":
		return "end_month", nil
	default:
		return "", errors.New("ciclo_facturacion debe ser start_month o end_month (o inicio_mes / fin_mes)")
	}
}

func parseDateLima(s string) (*time.Time, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil, nil
	}
	lima, err := time.LoadLocation("America/Lima")
	if err != nil || lima == nil {
		lima = time.Local
	}
	t, err := time.ParseInLocation("2006-01-02", s, lima)
	if err != nil {
		return nil, fmt.Errorf("fecha inválida %q (use AAAA-MM-DD)", s)
	}
	return &t, nil
}

func parseBoolLoose(s string) (bool, error) {
	v := strings.ToLower(strings.TrimSpace(s))
	if v == "" {
		return true, nil
	}
	switch v {
	case "si", "sí", "s", "true", "1", "verdadero", "yes", "y":
		return true, nil
	case "no", "false", "0", "falso", "n":
		return false, nil
	default:
		return false, fmt.Errorf("valor booleano no reconocido: %q", s)
	}
}

func parseDeclaredAmount(s string) (*float64, error) {
	s = strings.TrimSpace(strings.ReplaceAll(s, ",", "."))
	if s == "" {
		return nil, nil
	}
	x, err := strconv.ParseFloat(s, 64)
	if err != nil || x < 0 {
		return nil, errors.New("monto_facturacion_declarada inválido")
	}
	return &x, nil
}

func contactFromSlot(row []string, col map[string]int, prefix string) (*models.Contact, error) {
	n := cell(row, col, prefix+"_nombre")
	pos := cell(row, col, prefix+"_cargo")
	ph := cell(row, col, prefix+"_telefono")
	em := cell(row, col, prefix+"_email")
	pr := cell(row, col, prefix+"_prioridad")
	if n == "" && pos == "" && ph == "" && em == "" && pr == "" {
		return nil, nil
	}
	if n == "" || pos == "" || ph == "" || em == "" {
		return nil, fmt.Errorf("contacto %s: complete nombre, cargo, teléfono y email", prefix)
	}
	return &models.Contact{
		FullName: n,
		Position: pos,
		Phone:    ph,
		Email:    em,
		Priority: pr,
	}, nil
}

func parseCompanyImportRows(rows [][]string) ([]companyImportParsedRow, []CompanyImportRowError) {
	if len(rows) < 2 {
		return nil, []CompanyImportRowError{{Row: 1, Message: "El archivo no tiene filas de datos"}}
	}
	col, herr := headerColumnMap(rows[0])
	if len(herr) > 0 {
		return nil, herr
	}

	var parsed []companyImportParsedRow
	var errs []CompanyImportRowError

	fileRUCs := map[string]int{}
	fileCodes := map[string]int{}
	dataRowCount := 0

	for excelIdx := 2; excelIdx <= len(rows); excelIdx++ {
		row := rows[excelIdx-1]
		if rowIsEmpty(row) {
			continue
		}
		dataRowCount++
		if dataRowCount > companyImportMaxRows {
			errs = append(errs, CompanyImportRowError{Row: excelIdx, Message: fmt.Sprintf("Se superó el máximo de %d filas de datos", companyImportMaxRows)})
			break
		}

		code := cell(row, col, "codigo_interno")
		rucRaw := cell(row, col, "ruc")
		ruc := rucNonDigit.ReplaceAllString(rucRaw, "")
		bname := cell(row, col, "razon_social")
		if code == "" || ruc == "" || bname == "" {
			errs = append(errs, CompanyImportRowError{Row: excelIdx, Message: "codigo_interno, ruc y razon_social son obligatorios"})
			continue
		}
		if len(ruc) != 11 {
			errs = append(errs, CompanyImportRowError{Row: excelIdx, Message: "el RUC debe tener 11 dígitos"})
			continue
		}

		planName := cell(row, col, "plan_nombre")
		planIDResolved, err := resolveSubscriptionPlanIDByName(planName)
		if err != nil {
			errs = append(errs, CompanyImportRowError{Row: excelIdx, Message: err.Error()})
			continue
		}
		planIDPtr := planIDResolved

		bcStr := cell(row, col, "ciclo_facturacion")
		bc, err := parseBillingCycleCell(bcStr)
		if err != nil {
			errs = append(errs, CompanyImportRowError{Row: excelIdx, Message: err.Error()})
			continue
		}

		subStartStr := cell(row, col, "suscripcion_inicio")
		if strings.TrimSpace(subStartStr) == "" {
			errs = append(errs, CompanyImportRowError{Row: excelIdx, Message: "suscripcion_inicio es obligatorio cuando hay plan_nombre"})
			continue
		}
		subStart, err := parseDateLima(subStartStr)
		if err != nil || subStart == nil {
			errs = append(errs, CompanyImportRowError{Row: excelIdx, Message: "suscripcion_inicio: " + errString(err)})
			continue
		}
		subEnd, err := parseDateLima(cell(row, col, "suscripcion_fin"))
		if err != nil {
			errs = append(errs, CompanyImportRowError{Row: excelIdx, Message: "suscripcion_fin: " + errString(err)})
			continue
		}

		st := strings.ToLower(strings.TrimSpace(cell(row, col, "estado")))
		if st == "" {
			st = "activo"
		}
		if st != "activo" && st != "inactivo" {
			errs = append(errs, CompanyImportRowError{Row: excelIdx, Message: "estado debe ser activo o inactivo"})
			continue
		}

		svcStart, err := parseDateLima(cell(row, col, "inicio_servicio"))
		if err != nil {
			errs = append(errs, CompanyImportRowError{Row: excelIdx, Message: "inicio_servicio: " + errString(err)})
			continue
		}

		subActive, err := parseBoolLoose(cell(row, col, "suscripcion_activa"))
		if err != nil {
			errs = append(errs, CompanyImportRowError{Row: excelIdx, Message: err.Error()})
			continue
		}

		decl, err := parseDeclaredAmount(cell(row, col, "monto_facturacion_declarada"))
		if err != nil {
			errs = append(errs, CompanyImportRowError{Row: excelIdx, Message: err.Error()})
			continue
		}

		accID, rowErr := resolveTeamUserIDByDocument(excelIdx, cell(row, col, "documento_contador"), "documento_contador", []string{"Contador"})
		if rowErr != nil {
			errs = append(errs, *rowErr)
			continue
		}
		supID, rowErr := resolveTeamUserIDByDocument(excelIdx, cell(row, col, "documento_supervisor"), "documento_supervisor", []string{"Supervisor"})
		if rowErr != nil {
			errs = append(errs, *rowErr)
			continue
		}
		assID, rowErr := resolveTeamUserIDByDocument(excelIdx, cell(row, col, "documento_asistente"), "documento_asistente", []string{"Asistente"})
		if rowErr != nil {
			errs = append(errs, *rowErr)
			continue
		}

		var contacts []models.Contact
		contactOK := true
		for _, prefix := range []string{"c1", "c2", "c3"} {
			ct, err := contactFromSlot(row, col, prefix)
			if err != nil {
				errs = append(errs, CompanyImportRowError{Row: excelIdx, Message: err.Error()})
				contactOK = false
				break
			}
			if ct != nil {
				contacts = append(contacts, *ct)
			}
		}
		if !contactOK {
			continue
		}

		if prev, ok := fileRUCs[ruc]; ok {
			errs = append(errs, CompanyImportRowError{Row: excelIdx, Message: fmt.Sprintf("RUC duplicado en el archivo (también en fila %d)", prev)})
			continue
		}
		if prev, ok := fileCodes[strings.ToLower(code)]; ok {
			errs = append(errs, CompanyImportRowError{Row: excelIdx, Message: fmt.Sprintf("codigo_interno duplicado en el archivo (también en fila %d)", prev)})
			continue
		}
		fileRUCs[ruc] = excelIdx
		fileCodes[strings.ToLower(code)] = excelIdx

		c := models.Company{
			InternalCode:          code,
			RUC:                   ruc,
			BusinessName:          bname,
			TradeName:             cell(row, col, "nombre_comercial"),
			Status:                st,
			Address:               cell(row, col, "direccion"),
			Phone:                 cell(row, col, "telefono"),
			Email:                 cell(row, col, "email"),
			ServiceStartAt:        svcStart,
			AccountantUserID:      accID,
			SupervisorUserID:      supID,
			AssistantUserID:       assID,
			SubscriptionPlanID:    &planIDPtr,
			BillingCycle:          bc,
			SubscriptionStartedAt: subStart,
			SubscriptionEndedAt:   subEnd,
			SubscriptionActive:    subActive,
			DeclaredBillingAmount: decl,
		}

		parsed = append(parsed, companyImportParsedRow{excelRow: excelIdx, company: c, contacts: contacts})
	}

	if len(parsed) == 0 && len(errs) == 0 {
		return nil, []CompanyImportRowError{{Row: 1, Message: "No hay filas de datos para importar"}}
	}

	return parsed, errs
}

func errString(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}

// CompanyImportValidate valida el archivo completo (incluye duplicados contra la base de datos). No persiste cambios.
func CompanyImportValidate(file io.ReaderAt, size int64) ([]CompanyImportRowError, int, error) {
	if size <= 0 || size > companyImportMaxFileSize {
		return nil, 0, errors.New("archivo vacío o demasiado grande (máx. 8 MB)")
	}
	raw := make([]byte, size)
	if _, err := file.ReadAt(raw, 0); err != nil && !errors.Is(err, io.EOF) {
		return nil, 0, err
	}

	xl, err := excelize.OpenReader(bytes.NewReader(raw))
	if err != nil {
		return nil, 0, errors.New("no se pudo leer el Excel (.xlsx). Use el archivo generado desde «Descargar plantilla»")
	}
	defer func() { _ = xl.Close() }()

	sheet := companyImportSheetMain
	sheetFound := false
	for _, name := range xl.GetSheetList() {
		if name == sheet {
			sheetFound = true
			break
		}
	}
	if !sheetFound {
		return []CompanyImportRowError{{Row: 0, Message: fmt.Sprintf("Falta la hoja «%s»", companyImportSheetMain)}}, 0, nil
	}

	rows, err := xl.GetRows(sheet)
	if err != nil {
		return nil, 0, err
	}

	parsed, perrs := parseCompanyImportRows(rows)
	var errs []CompanyImportRowError
	errs = append(errs, perrs...)

	// Errores de negocio / BD por fila
	cs := NewCompanyService()
	for _, pr := range parsed {
		c := pr.company
		if err := cs.ValidateNewCompanyForCreate(database.DB, &c); err != nil {
			errs = append(errs, CompanyImportRowError{Row: pr.excelRow, Message: err.Error()})
			continue
		}
		var rucCount int64
		database.DB.Model(&models.Company{}).Where("ruc = ?", c.RUC).Count(&rucCount)
		if rucCount > 0 {
			errs = append(errs, CompanyImportRowError{Row: pr.excelRow, Message: "ya existe una empresa con este RUC"})
		}
	}

	return errs, len(parsed), nil
}

// CompanyImportCommit importa en una sola transacción. Vuelve a validar antes de grabar.
// Si hay errores de validación devuelve valErrs sin err; err solo para fallos de lectura o de transacción.
func CompanyImportCommit(file io.ReaderAt, size int64) (created int, valErrs []CompanyImportRowError, err error) {
	errs, n, vErr := CompanyImportValidate(file, size)
	if vErr != nil {
		return 0, nil, vErr
	}
	if len(errs) > 0 {
		return 0, errs, nil
	}
	if n == 0 {
		return 0, nil, errors.New("no hay filas para importar")
	}

	raw := make([]byte, size)
	if _, err := file.ReadAt(raw, 0); err != nil && !errors.Is(err, io.EOF) {
		return 0, nil, err
	}
	xl, err := excelize.OpenReader(bytes.NewReader(raw))
	if err != nil {
		return 0, nil, err
	}
	defer func() { _ = xl.Close() }()
	rows, err := xl.GetRows(companyImportSheetMain)
	if err != nil {
		return 0, nil, err
	}
	parsed, _ := parseCompanyImportRows(rows)

	cs := NewCompanyService()
	err = database.DB.Transaction(func(tx *gorm.DB) error {
		for _, pr := range parsed {
			c := pr.company
			if err := cs.CreateWithTx(tx, &c); err != nil {
				return fmt.Errorf("fila %d: %w", pr.excelRow, err)
			}
			for i := range pr.contacts {
				pr.contacts[i].CompanyID = c.ID
				if err := tx.Create(&pr.contacts[i]).Error; err != nil {
					return fmt.Errorf("fila %d (contacto): %w", pr.excelRow, err)
				}
			}
			created++
		}
		return nil
	})
	return created, nil, err
}
