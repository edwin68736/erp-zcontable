package controllers

import (
	"math"
	"strconv"
	"strings"
	"time"

	"miappfiber/models"
	"miappfiber/services"

	"github.com/gofiber/fiber/v3"
)

type DocumentController struct {
	documentService *services.DocumentService
	accessService   *services.AccessService
}

func NewDocumentController() *DocumentController {
	return &DocumentController{
		documentService: services.NewDocumentService(),
		accessService:   services.NewAccessService(),
	}
}

// ---- API ----

func (ctrl *DocumentController) ListAPI(c fiber.Ctx) error {
	var params services.DocumentListParams
	if companyIDStr := c.Query("company_id"); companyIDStr != "" {
		if id, err := strconv.ParseUint(companyIDStr, 10, 32); err == nil {
			params.CompanyID = uint(id)
		}
	}
	rawStatus := strings.TrimSpace(c.Query("status", ""))
	params.Overdue = c.Query("overdue", "") == "1"
	params.ExplicitAllStatuses = false
	// "vencido" no es estado en BD; equivale a filtro por vencimiento (overdue).
	if strings.EqualFold(rawStatus, "vencido") {
		params.Status = ""
		params.Overdue = true
	} else if strings.EqualFold(rawStatus, "all") {
		// Ver todos los estados de deuda (sin filtro por status ni modo saldo implícito).
		params.Status = ""
		params.ExplicitAllStatuses = true
	} else {
		params.Status = rawStatus
	}
	pageStr := c.Query("page", "")
	perPageStr := c.Query("per_page", "")
	if fromStr := c.Query("date_from", ""); fromStr != "" {
		from, err := time.ParseInLocation("2006-01-02", fromStr, time.Local)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Fecha desde inválida"})
		}
		params.DateFrom = &from
	}
	if toStr := c.Query("date_to", ""); toStr != "" {
		to, err := time.ParseInLocation("2006-01-02", toStr, time.Local)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Fecha hasta inválida"})
		}
		toExclusive := to.AddDate(0, 0, 1)
		params.DateTo = &toExclusive
	}
	if params.DateFrom != nil && params.DateTo != nil && params.DateTo.Before(*params.DateFrom) {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Rango de fechas inválido"})
	}

	// Una empresa sin filtro por fecha de emisión: solo documentos con saldo (pendiente/parcial), todas las fechas.
	params.ImplicitOpenBalances = params.CompanyID != 0 &&
		params.DateFrom == nil && params.DateTo == nil &&
		params.Status == "" && !params.Overdue && !params.ExplicitAllStatuses

	if !isAdmin(c) {
		userID, err := getUserID(c)
		if err != nil {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "No autenticado"})
		}
		ids, err := ctrl.accessService.GetAllowedCompanyIDs(userID)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Error de acceso"})
		}
		params.AllowedCompanyIDs = ids
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

		groupQC := c.Query("group_by_company", "")
		params.GroupByCompany = (groupQC == "1" || groupQC == "true") && params.CompanyID == 0

		if params.GroupByCompany {
			rows, total, err := ctrl.documentService.ListCompaniesDebtSummaryPaged(params, page, perPage)
			if err != nil {
				return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
			}
			totalPages := 0
			if perPage > 0 {
				totalPages = int(math.Ceil(float64(total) / float64(perPage)))
			}
			return c.JSON(fiber.Map{
				"data": rows,
				"pagination": fiber.Map{
					"page":        page,
					"per_page":    perPage,
					"total":       total,
					"total_pages": totalPages,
				},
				"meta": fiber.Map{"list_mode": "by_company"},
			})
		}

		list, total, err := ctrl.documentService.ListPaged(params, page, perPage)
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
			"meta": fiber.Map{"list_mode": "documents"},
		})
	}

	list, err := ctrl.documentService.List(params)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"data": list})
}

func (ctrl *DocumentController) GetAPI(c fiber.Ctx) error {
	id, err := strconv.ParseUint(c.Params("id"), 10, 32)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ID inválido"})
	}
	doc, err := ctrl.documentService.GetByID(uint(id))
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Documento no encontrado"})
	}

	if !isAdmin(c) {
		userID, err := getUserID(c)
		if err != nil {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "No autenticado"})
		}
		ok, err := ctrl.accessService.CanAccessCompany(userID, doc.CompanyID)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Error de acceso"})
		}
		if !ok {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Documento no encontrado"})
		}
	}

	return c.JSON(doc)
}

func (ctrl *DocumentController) CreateAPI(c fiber.Ctx) error {
	var input models.Document
	if err := c.Bind().Body(&input); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Datos inválidos"})
	}

	if !isAdmin(c) {
		userID, err := getUserID(c)
		if err != nil {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "No autenticado"})
		}
		ok, err := ctrl.accessService.CanAccessCompany(userID, input.CompanyID)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Error de acceso"})
		}
		if !ok {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Empresa inválida"})
		}
	}

	if err := ctrl.documentService.Create(&input); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	return c.Status(fiber.StatusCreated).JSON(input)
}

func (ctrl *DocumentController) UpdateAPI(c fiber.Ctx) error {
	id, err := strconv.ParseUint(c.Params("id"), 10, 32)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ID inválido"})
	}

	if !isAdmin(c) {
		userID, err := getUserID(c)
		if err != nil {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "No autenticado"})
		}
		doc, err := ctrl.documentService.GetByID(uint(id))
		if err != nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Documento no encontrado"})
		}
		ok, err := ctrl.accessService.CanAccessCompany(userID, doc.CompanyID)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Error de acceso"})
		}
		if !ok {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Documento no encontrado"})
		}
	}

	var input models.Document
	if err := c.Bind().Body(&input); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Datos inválidos"})
	}
	if err := ctrl.documentService.Update(uint(id), &input); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	doc, _ := ctrl.documentService.GetByID(uint(id))
	return c.JSON(doc)
}

func (ctrl *DocumentController) DeleteAPI(c fiber.Ctx) error {
	id, err := strconv.ParseUint(c.Params("id"), 10, 32)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ID inválido"})
	}

	if !isAdmin(c) {
		userID, err := getUserID(c)
		if err != nil {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "No autenticado"})
		}
		doc, err := ctrl.documentService.GetByID(uint(id))
		if err != nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Documento no encontrado"})
		}
		ok, err := ctrl.accessService.CanAccessCompany(userID, doc.CompanyID)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Error de acceso"})
		}
		if !ok {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Documento no encontrado"})
		}
	}

	if err := ctrl.documentService.Delete(uint(id)); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"message": "Eliminado"})
}
