package controllers

import (
	"bytes"
	"errors"
	"io"
	"math"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"miappfiber/models"
	"miappfiber/services"

	"github.com/gofiber/fiber/v3"
	"gorm.io/gorm"
)

type CompanyController struct {
	companyService *services.CompanyService
	financeService *services.FinanceService
	accessService  *services.AccessService
	apiPeruService *services.ApiPeruService
}

func NewCompanyController() *CompanyController {
	return &CompanyController{
		companyService: services.NewCompanyService(),
		financeService: services.NewFinanceService(),
		accessService:  services.NewAccessService(),
		apiPeruService: services.NewApiPeruService(),
	}
}

// ---- API ----

func (ctrl *CompanyController) ListAPI(c fiber.Ctx) error {
	q := c.Query("q", "")
	status := c.Query("status", "")
	pageStr := c.Query("page", "")
	perPageStr := c.Query("per_page", "")

	var allowedIDs []uint
	if !isAdmin(c) {
		userID, err := getUserID(c)
		if err != nil {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "No autenticado"})
		}
		ids, err := ctrl.accessService.GetAllowedCompanyIDs(userID)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Error de acceso"})
		}
		allowedIDs = ids
	}

	codeOrder := strings.ToLower(strings.TrimSpace(c.Query("code_order", "")))
	if codeOrder != "asc" && codeOrder != "desc" {
		codeOrder = "asc"
	}

	params := services.CompanyListParams{
		Query:             q,
		Status:            status,
		AllowedCompanyIDs: allowedIDs,
		CodeOrder:         codeOrder,
	}

	if pageStr != "" || perPageStr != "" {
		page := 1
		perPage := 20
		if pageStr != "" {
			v, err := strconv.Atoi(pageStr)
			if err != nil || v <= 0 {
				return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Página inválida"})
			}
			page = v
		}
		if perPageStr != "" {
			v, err := strconv.Atoi(perPageStr)
			if err != nil || v <= 0 || v > 200 {
				return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Tamaño de página inválido"})
			}
			perPage = v
		}

		list, total, err := ctrl.companyService.ListPaged(params, page, perPage)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
		}

		totalPages := 0
		if perPage > 0 {
			totalPages = int(math.Ceil(float64(total) / float64(perPage)))
		}
		return c.JSON(fiber.Map{
			"data": list,
			"pagination": fiber.Map{
				"page":        page,
				"per_page":    perPage,
				"total":       total,
				"total_pages": totalPages,
			},
		})
	}

	list, err := ctrl.companyService.List(params)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"data": list})
}

func (ctrl *CompanyController) GetAPI(c fiber.Ctx) error {
	id, err := strconv.ParseUint(c.Params("id"), 10, 32)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ID inválido"})
	}

	if !isAdmin(c) {
		userID, err := getUserID(c)
		if err != nil {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "No autenticado"})
		}
		ok, err := ctrl.accessService.CanAccessCompany(userID, uint(id))
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Error de acceso"})
		}
		if !ok {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Empresa no encontrada"})
		}
	}

	company, err := ctrl.companyService.GetByID(uint(id))
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Empresa no encontrada"})
	}
	return c.JSON(company)
}

func (ctrl *CompanyController) CreateAPI(c fiber.Ctx) error {
	var input models.Company
	if err := c.Bind().Body(&input); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Datos inválidos"})
	}
	if err := ctrl.companyService.Create(&input); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	return c.Status(fiber.StatusCreated).JSON(input)
}

func (ctrl *CompanyController) UpdateAPI(c fiber.Ctx) error {
	id, err := strconv.ParseUint(c.Params("id"), 10, 32)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ID inválido"})
	}

	if !isAdmin(c) {
		userID, err := getUserID(c)
		if err != nil {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "No autenticado"})
		}
		ok, err := ctrl.accessService.CanAccessCompany(userID, uint(id))
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Error de acceso"})
		}
		if !ok {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Empresa no encontrada"})
		}
	}

	var input models.Company
	if err := c.Bind().Body(&input); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Datos inválidos"})
	}
	if err := ctrl.companyService.Update(uint(id), &input); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	company, _ := ctrl.companyService.GetByID(uint(id))
	return c.JSON(company)
}

func (ctrl *CompanyController) PatchStatusAPI(c fiber.Ctx) error {
	id, err := strconv.ParseUint(c.Params("id"), 10, 32)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ID inválido"})
	}

	if !isAdmin(c) {
		userID, err := getUserID(c)
		if err != nil {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "No autenticado"})
		}
		ok, err := ctrl.accessService.CanAccessCompany(userID, uint(id))
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Error de acceso"})
		}
		if !ok {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Empresa no encontrada"})
		}
	}

	var body struct {
		Status string `json:"status"`
	}
	if err := c.Bind().Body(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Datos inválidos"})
	}
	if err := ctrl.companyService.SetStatus(uint(id), body.Status); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Empresa no encontrada"})
		}
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	company, err := ctrl.companyService.GetByID(uint(id))
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Empresa no encontrada"})
	}
	return c.JSON(company)
}

// NextInternalCodeAPI devuelve un código interno sugerido (4 dígitos, único).
func (ctrl *CompanyController) NextInternalCodeAPI(c fiber.Ctx) error {
	code, err := ctrl.companyService.NextInternalCode()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"code": code})
}

// ValidateRUCAPI consulta ApiPeru.dev (SUNAT) y devuelve datos para autocompletar el alta de empresa.
// ImportTemplateAPI descarga la plantilla .xlsx para importación masiva de empresas.
func (ctrl *CompanyController) ImportTemplateAPI(c fiber.Ctx) error {
	buf, err := services.CompanyImportTemplateXLSX()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	c.Set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
	c.Set("Content-Disposition", `attachment; filename="plantilla_importacion_empresas.xlsx"`)
	return c.Send(buf)
}

// ImportCompaniesAPI valida (dry_run) o importa un Excel .xlsx multipart campo "file".
func (ctrl *CompanyController) ImportCompaniesAPI(c fiber.Ctx) error {
	fh, err := c.FormFile("file")
	if err != nil || fh == nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Adjunte un archivo en el campo file"})
	}
	if fh.Size <= 0 || fh.Size > 8<<20 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Archivo vacío o demasiado grande (máx. 8 MB)"})
	}
	ext := strings.ToLower(filepath.Ext(fh.Filename))
	if ext != ".xlsx" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Solo se admite Excel .xlsx (no CSV)"})
	}

	src, err := fh.Open()
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "No se pudo leer el archivo"})
	}
	raw, err := io.ReadAll(src)
	_ = src.Close()
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "No se pudo leer el archivo"})
	}

	reader := bytes.NewReader(raw)
	size := int64(len(raw))

	dry := c.Query("dry_run") == "1" || strings.EqualFold(strings.TrimSpace(c.Query("dry_run")), "true")
	if dry {
		rowErrs, n, vErr := services.CompanyImportValidate(reader, size)
		if vErr != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": vErr.Error()})
		}
		ok := len(rowErrs) == 0
		return c.JSON(fiber.Map{
			"ok":        ok,
			"row_count": n,
			"errors":    rowErrs,
		})
	}

	created, valErrs, err := services.CompanyImportCommit(bytes.NewReader(raw), size)
	if len(valErrs) > 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"ok":     false,
			"errors": valErrs,
		})
	}
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"ok": true, "created": created})
}

func (ctrl *CompanyController) ValidateRUCAPI(c fiber.Ctx) error {
	var body struct {
		RUC string `json:"ruc"`
	}
	if err := c.Bind().Body(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Datos inválidos"})
	}
	res, err := ctrl.apiPeruService.LookupRUC(body.RUC)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(res)
}

func (ctrl *CompanyController) DeleteAPI(c fiber.Ctx) error {
	id, err := strconv.ParseUint(c.Params("id"), 10, 32)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ID inválido"})
	}

	if !isAdmin(c) {
		userID, err := getUserID(c)
		if err != nil {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "No autenticado"})
		}
		ok, err := ctrl.accessService.CanAccessCompany(userID, uint(id))
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Error de acceso"})
		}
		if !ok {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Empresa no encontrada"})
		}
	}

	if err := ctrl.companyService.Delete(uint(id)); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"message": "Eliminado"})
}

// Estado de cuenta (API)
func (ctrl *CompanyController) StatementAPI(c fiber.Ctx) error {
	id, err := strconv.ParseUint(c.Params("id"), 10, 32)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ID inválido"})
	}

	if !isAdmin(c) {
		userID, err := getUserID(c)
		if err != nil {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "No autenticado"})
		}
		ok, err := ctrl.accessService.CanAccessCompany(userID, uint(id))
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Error de acceso"})
		}
		if !ok {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Empresa no encontrada"})
		}
	}

	lima, errLoc := time.LoadLocation("America/Lima")
	if errLoc != nil || lima == nil {
		lima = time.Local
	}
	now := time.Now().In(lima)
	var rangeFromPtr, rangeToPtr *time.Time
	if df := strings.TrimSpace(c.Query("date_from", "")); df != "" {
		if dt := strings.TrimSpace(c.Query("date_to", "")); dt != "" {
			t1, e1 := time.ParseInLocation("2006-01-02", df, lima)
			t2, e2 := time.ParseInLocation("2006-01-02", dt, lima)
			if e1 == nil && e2 == nil && !t1.After(t2) {
				rangeFromPtr = &t1
				rangeToPtr = &t2
			}
		}
	}

	y, mo := now.Year(), int(now.Month())
	if rangeFromPtr == nil || rangeToPtr == nil {
		if pq := strings.TrimSpace(c.Query("period", "")); pq != "" {
			if t, err := time.ParseInLocation("2006-01", pq, lima); err == nil {
				y, mo = t.Year(), int(t.Month())
			}
		}
	}

	stmt, err := ctrl.financeService.GetCompanyStatement(uint(id), y, mo, rangeFromPtr, rangeToPtr)
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Empresa no encontrada"})
	}
	return c.JSON(stmt)
}
