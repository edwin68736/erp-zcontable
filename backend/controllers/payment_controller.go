package controllers

import (
	"encoding/json"
	"math"
	"miappfiber/config"
	"os"
	"path"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"miappfiber/models"
	"miappfiber/services"

	"github.com/gofiber/fiber/v3"
)

type PaymentController struct {
	paymentService *services.PaymentService
	accessService  *services.AccessService
	tukifacService *services.TukifacService
}

func NewPaymentController() *PaymentController {
	return &PaymentController{
		paymentService: services.NewPaymentService(),
		accessService:  services.NewAccessService(),
		tukifacService: services.NewTukifacService(),
	}
}

// ---- API ----

func (ctrl *PaymentController) ListAPI(c fiber.Ctx) error {
	var params services.PaymentListParams
	if companyIDStr := c.Query("company_id"); companyIDStr != "" {
		if id, err := strconv.ParseUint(companyIDStr, 10, 32); err == nil {
			params.CompanyID = uint(id)
		}
	}
	if documentIDStr := c.Query("document_id"); documentIDStr != "" {
		if id, err := strconv.ParseUint(documentIDStr, 10, 32); err == nil {
			params.DocumentID = uint(id)
		}
	}
	params.Type = c.Query("type", "")
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

		list, total, err := ctrl.paymentService.ListPaged(params, page, perPage)
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

	list, err := ctrl.paymentService.List(params)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"data": list})
}

func (ctrl *PaymentController) GetAPI(c fiber.Ctx) error {
	id, err := strconv.ParseUint(c.Params("id"), 10, 32)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ID inválido"})
	}
	p, err := ctrl.paymentService.GetByID(uint(id))
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Pago no encontrado"})
	}

	if !isAdmin(c) {
		userID, err := getUserID(c)
		if err != nil {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "No autenticado"})
		}
		ok, err := ctrl.accessService.CanAccessCompany(userID, p.CompanyID)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Error de acceso"})
		}
		if !ok {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Pago no encontrado"})
		}
	}

	return c.JSON(p)
}

func (ctrl *PaymentController) CreateAPI(c fiber.Ctx) error {
	var body struct {
		CompanyID        uint                              `json:"company_id"`
		DocumentID       *uint                             `json:"document_id"`
		TaxSettlementID  *uint                             `json:"tax_settlement_id"`
		Type             string                            `json:"type"`
		Date             string                            `json:"date"`
		Amount           float64                           `json:"amount"`
		Method           string                            `json:"method"`
		Reference        string                            `json:"reference"`
		Attachment       string                            `json:"attachment"`
		Notes            string                            `json:"notes"`
		FiscalStatus     string                            `json:"fiscal_status"`
		AllocationMode   string                            `json:"allocation_mode"`
		Allocations      []services.PaymentAllocationInput `json:"allocations"`
	}
	if err := c.Bind().Body(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Datos inválidos"})
	}

	if !isAdmin(c) {
		userID, err := getUserID(c)
		if err != nil {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "No autenticado"})
		}
		ok, err := ctrl.accessService.CanAccessCompany(userID, body.CompanyID)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Error de acceso"})
		}
		if !ok {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Empresa inválida"})
		}
	}

	dt := time.Now()
	if strings.TrimSpace(body.Date) != "" {
		var err error
		dt, err = time.Parse(time.RFC3339, body.Date)
		if err != nil {
			dt, err = time.ParseInLocation("2006-01-02", strings.TrimSpace(body.Date), time.Local)
			if err != nil {
				return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Fecha inválida"})
			}
		}
	}

	params := services.PaymentCreateParams{
		CompanyID:       body.CompanyID,
		DocumentID:      body.DocumentID,
		TaxSettlementID: body.TaxSettlementID,
		Type:            body.Type,
		Date:            dt,
		Amount:          body.Amount,
		Method:          body.Method,
		Reference:       body.Reference,
		Attachment:      body.Attachment,
		Notes:           body.Notes,
		FiscalStatus:    body.FiscalStatus,
		AllocationMode:  body.AllocationMode,
		Allocations:     body.Allocations,
	}

	id, err := ctrl.paymentService.CreateFromParams(&params)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	pay, err := ctrl.paymentService.GetByID(id)
	if err != nil {
		return c.Status(fiber.StatusCreated).JSON(fiber.Map{"id": id})
	}
	return c.Status(fiber.StatusCreated).JSON(pay)
}

// IssueTukifacAPI POST /api/payments/:id/issue-tukifac — emite factura/boleta/NV en Tukifac a partir del pago (imputaciones = ítems).
func (ctrl *PaymentController) IssueTukifacAPI(c fiber.Ctx) error {
	id, err := strconv.ParseUint(c.Params("id"), 10, 32)
	if err != nil || id == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ID inválido"})
	}
	p, err := ctrl.paymentService.GetByID(uint(id))
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Pago no encontrado"})
	}
	if !isAdmin(c) {
		userID, err := getUserID(c)
		if err != nil {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "No autenticado"})
		}
		ok, err := ctrl.accessService.CanAccessCompany(userID, p.CompanyID)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Error de acceso"})
		}
		if !ok {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "Sin acceso a esta empresa"})
		}
	}
	var body services.PaymentTukifacIssueInput
	if err := c.Bind().Body(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Datos inválidos"})
	}
	rec, raw, err := ctrl.tukifacService.IssueComprobanteFromPayment(uint(id), body)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error":            err.Error(),
			"tukifac_response": json.RawMessage(raw),
		})
	}
	return c.Status(fiber.StatusCreated).JSON(fiber.Map{
		"receipt":          rec,
		"tukifac_response": json.RawMessage(raw),
	})
}

func (ctrl *PaymentController) UpdateAPI(c fiber.Ctx) error {
	id, err := strconv.ParseUint(c.Params("id"), 10, 32)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ID inválido"})
	}

	if !isAdmin(c) {
		userID, err := getUserID(c)
		if err != nil {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "No autenticado"})
		}
		p, err := ctrl.paymentService.GetByID(uint(id))
		if err != nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Pago no encontrado"})
		}
		ok, err := ctrl.accessService.CanAccessCompany(userID, p.CompanyID)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Error de acceso"})
		}
		if !ok {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Pago no encontrado"})
		}
	}

	var input models.Payment
	if err := c.Bind().Body(&input); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Datos inválidos"})
	}
	if err := ctrl.paymentService.Update(uint(id), &input); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	p, _ := ctrl.paymentService.GetByID(uint(id))
	return c.JSON(p)
}

func (ctrl *PaymentController) DeleteAPI(c fiber.Ctx) error {
	id, err := strconv.ParseUint(c.Params("id"), 10, 32)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ID inválido"})
	}

	if !isAdmin(c) {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "Solo el administrador puede eliminar pagos"})
	}

	if err := ctrl.paymentService.Delete(uint(id)); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"message": "Eliminado"})
}

func (ctrl *PaymentController) UploadAttachmentAPI(c fiber.Ctx) error {
	fh, err := c.FormFile("file")
	if err != nil || fh == nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Archivo inválido"})
	}
	if fh.Size <= 0 || fh.Size > 10*1024*1024 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "El archivo excede el tamaño permitido"})
	}

	ext := strings.ToLower(filepath.Ext(fh.Filename))
	switch ext {
	case ".png", ".jpg", ".jpeg", ".webp", ".gif", ".pdf":
	default:
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Formato de archivo no permitido"})
	}

	token, err := randomHex(12)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "No se pudo procesar el archivo"})
	}

	now := time.Now().UTC()
	dir := filepath.Join(config.AppConfig.StoragePath, "payments", now.Format("2006"), now.Format("01"))
	if err := os.MkdirAll(dir, 0755); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "No se pudo crear el almacenamiento"})
	}

	fileName := "attachment_" + token + ext
	storagePath := filepath.Join(dir, fileName)
	if err := c.SaveFile(fh, storagePath); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "No se pudo guardar el archivo"})
	}

	url := "/" + path.Join("storage", "payments", now.Format("2006"), now.Format("01"), fileName)
	return c.JSON(fiber.Map{
		"success": true,
		"data": fiber.Map{
			"url": url,
		},
		"message": "",
	})
}
