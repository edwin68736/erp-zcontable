package controllers

import (
	"crypto/rand"
	"encoding/hex"
	"math"
	"os"
	"path"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"miappfiber/config"
	"miappfiber/rbac"
	"miappfiber/services"

	"github.com/gofiber/fiber/v3"
)

type PosSaleController struct {
	svc            *services.PosSaleService
	product        *services.ProductService
	companyService *services.CompanyService
}

func NewPosSaleController() *PosSaleController {
	return &PosSaleController{
		svc:            services.NewPosSaleService(),
		product:        services.NewProductService(),
		companyService: services.NewCompanyService(),
	}
}

func (ctrl *PosSaleController) hasPerm(c fiber.Ctx, code string) bool {
	uid, err := getUserID(c)
	if err != nil {
		return false
	}
	return services.Authz().HasPermission(uid, code)
}

func (ctrl *PosSaleController) IssueAPI(c fiber.Ctx) error {
	uid, err := getUserID(c)
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "No autenticado"})
	}
	var body services.PosSaleIssueInput
	if err := c.Bind().Body(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Datos inválidos"})
	}
	allowPrice := ctrl.hasPerm(c, rbac.SalesLinePriceEdit)
	rec, err := ctrl.svc.IssuePosSale(uid, body, allowPrice)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	return c.Status(fiber.StatusCreated).JSON(fiber.Map{"data": rec})
}

func (ctrl *PosSaleController) ListAPI(c fiber.Ctx) error {
	uid, err := getUserID(c)
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "No autenticado"})
	}
	page, perPage := parsePageParams(c)
	onlyOwn := !ctrl.hasPerm(c, rbac.FiscalReceiptsList)
	var companyID *uint
	if cid := c.Query("company_id"); cid != "" {
		if id64, e := strconv.ParseUint(cid, 10, 32); e == nil && id64 > 0 {
			v := uint(id64)
			companyID = &v
		}
	}
	list, total, err := ctrl.svc.ListPosSales(services.PosSaleListParams{
		Page: page, PerPage: perPage, OnlyOwn: onlyOwn, UserID: uid, CompanyID: companyID,
	})
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
			"page": page, "per_page": perPage, "total": total, "total_pages": totalPages,
		},
	})
}

func (ctrl *PosSaleController) GetAPI(c fiber.Ctx) error {
	uid, err := getUserID(c)
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "No autenticado"})
	}
	id, err := strconv.ParseUint(c.Params("id"), 10, 32)
	if err != nil || id == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ID inválido"})
	}
	onlyOwn := !ctrl.hasPerm(c, rbac.FiscalReceiptsList)
	rec, err := ctrl.svc.GetPosSaleDetail(uint(id), uid, onlyOwn)
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"data": rec})
}

func (ctrl *PosSaleController) ListCompaniesAPI(c fiber.Ctx) error {
	list, err := ctrl.svc.ListCompaniesForPos()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"data": list})
}

func (ctrl *PosSaleController) CreateQuickCompanyAPI(c fiber.Ctx) error {
	var body services.ExternalCompanyQuickInput
	if err := c.Bind().Body(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Datos inválidos"})
	}
	company, err := ctrl.companyService.CreateExternal(body)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	return c.Status(fiber.StatusCreated).JSON(fiber.Map{"data": company})
}

func (ctrl *PosSaleController) ListProductsAPI(c fiber.Ctx) error {
	q := c.Query("q", "")
	kind := c.Query("kind", "")
	page := 1
	if v := c.Query("page", "1"); v != "" {
		if p, e := strconv.Atoi(v); e == nil && p > 0 {
			page = p
		}
	}
	perPage := 50
	if v := c.Query("per_page", "50"); v != "" {
		if n, e := strconv.Atoi(v); e == nil && n > 0 && n <= 200 {
			perPage = n
		}
	}
	items, total, err := ctrl.product.ListPaged(services.ProductListParams{
		Query: q, Kind: kind, Active: "1",
	}, page, perPage)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	totalPages := 0
	if perPage > 0 {
		totalPages = int(math.Ceil(float64(total) / float64(perPage)))
	}
	return c.JSON(fiber.Map{
		"data": items,
		"pagination": fiber.Map{
			"page": page, "per_page": perPage, "total": total, "total_pages": totalPages,
		},
	})
}

// UploadPaymentProofAPI sube comprobante de pago (transferencia, Yape, etc.) antes de emitir la venta.
func (ctrl *PosSaleController) UploadPaymentProofAPI(c fiber.Ctx) error {
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
	token, err := posRandomHex(12)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "No se pudo procesar el archivo"})
	}
	now := time.Now().UTC()
	dir := filepath.Join(config.AppConfig.StoragePath, "pos-payments", now.Format("2006"), now.Format("01"))
	if err := os.MkdirAll(dir, 0755); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "No se pudo crear el almacenamiento"})
	}
	fileName := "proof_" + token + ext
	storagePath := filepath.Join(dir, fileName)
	if err := c.SaveFile(fh, storagePath); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "No se pudo guardar el archivo"})
	}
	url := "/" + path.Join("storage", "pos-payments", now.Format("2006"), now.Format("01"), fileName)
	return c.JSON(fiber.Map{"success": true, "data": fiber.Map{"url": url}})
}

func posRandomHex(nBytes int) (string, error) {
	b := make([]byte, nBytes)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

func parsePageParams(c fiber.Ctx) (page, perPage int) {
	page = 1
	perPage = 20
	if v := c.Query("page", "1"); v != "" {
		if p, err := strconv.Atoi(v); err == nil && p > 0 {
			page = p
		}
	}
	if v := c.Query("per_page", "20"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			perPage = n
			if perPage > 100 {
				perPage = 100
			}
		}
	}
	return page, perPage
}
