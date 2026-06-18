package controllers

import (
	"strconv"
	"strings"
	"time"

	"miappfiber/services"

	"github.com/gofiber/fiber/v3"
)

type SupervisorController struct {
	svc    *services.SupervisorService
	access *services.AccessService
}

func NewSupervisorController() *SupervisorController {
	return &SupervisorController{
		svc:    services.NewSupervisorService(),
		access: services.NewAccessService(),
	}
}

func (ctrl *SupervisorController) allowedCompanyIDs(c fiber.Ctx) ([]uint, error) {
	if hasStudioScope(c) {
		return nil, nil
	}
	uid, err := getUserID(c)
	if err != nil {
		return nil, fiber.NewError(fiber.StatusUnauthorized, "No autenticado")
	}
	return ctrl.access.GetAllowedCompanyIDs(uid)
}

func (ctrl *SupervisorController) ensureControlCompany(c fiber.Ctx, controlID uint) error {
	if controlID == 0 {
		return fiber.NewError(fiber.StatusBadRequest, "control requerido")
	}
	ctrlRow, err := ctrl.svc.GetControl(controlID)
	if err != nil {
		return fiber.NewError(fiber.StatusNotFound, "Control no encontrado")
	}
	if hasStudioScope(c) {
		return nil
	}
	uid, err := getUserID(c)
	if err != nil {
		return fiber.NewError(fiber.StatusUnauthorized, "No autenticado")
	}
	ok, err := ctrl.svc.CanAccessCompany(uid, ctrlRow.CompanyID, false)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "Error de acceso")
	}
	if !ok {
		return fiber.NewError(fiber.StatusForbidden, "Sin acceso a esta empresa")
	}
	return nil
}

func (ctrl *SupervisorController) ensureDeclarationCompany(c fiber.Ctx, declarationID uint) error {
	controlID, err := ctrl.svc.ControlIDForDeclaration(declarationID)
	if err != nil {
		return fiber.NewError(fiber.StatusNotFound, "Declaración no encontrada")
	}
	return ctrl.ensureControlCompany(c, controlID)
}

func (ctrl *SupervisorController) ensureNPSCompany(c fiber.Ctx, npsID uint) error {
	controlID, err := ctrl.svc.ControlIDForNPS(npsID)
	if err != nil {
		return fiber.NewError(fiber.StatusNotFound, "NPS no encontrado")
	}
	return ctrl.ensureControlCompany(c, controlID)
}

func (ctrl *SupervisorController) ensureHistoryEntityAccess(c fiber.Ctx, entityType string, entityID uint) error {
	switch entityType {
	case "monthly_control", "control":
		return ctrl.ensureControlCompany(c, entityID)
	case "declaration":
		return ctrl.ensureDeclarationCompany(c, entityID)
	case "nps":
		return ctrl.ensureNPSCompany(c, entityID)
	default:
		return fiber.NewError(fiber.StatusBadRequest, "entity_type no soportado")
	}
}

func (ctrl *SupervisorController) ensureObservationScope(c fiber.Ctx, controlID, declarationID uint) error {
	if controlID > 0 {
		return ctrl.ensureControlCompany(c, controlID)
	}
	if declarationID > 0 {
		return ctrl.ensureDeclarationCompany(c, declarationID)
	}
	return fiber.NewError(fiber.StatusBadRequest, "control_id o declaration_id requerido")
}

func parseDatePtr(raw string) (*time.Time, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, nil
	}
	t, err := time.ParseInLocation("2006-01-02", raw, time.Local)
	if err != nil {
		return nil, err
	}
	return &t, nil
}

func paginationFromQuery(c fiber.Ctx) (page, perPage int) {
	page, perPage = 1, 20
	if v := c.Query("page", "1"); v != "" {
		if p, err := strconv.Atoi(v); err == nil && p > 0 {
			page = p
		}
	}
	if v := c.Query("per_page", "20"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 200 {
			perPage = n
		}
	}
	return page, perPage
}

// DashboardAPI GET /api/supervisors/dashboard?period_ym=YYYY-MM
func (ctrl *SupervisorController) DashboardAPI(c fiber.Ctx) error {
	allowed, err := ctrl.allowedCompanyIDs(c)
	if err != nil {
		if e, ok := err.(*fiber.Error); ok {
			return c.Status(e.Code).JSON(fiber.Map{"error": e.Message})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	p := services.SupervisorDashboardParams{
		PeriodYM:          c.Query("period_ym", time.Now().Format("2006-01")),
		GeneralStatus:     c.Query("general_status", ""),
		RiskLevel:         c.Query("risk_level", ""),
		AllowedCompanyIDs: allowed,
	}
	if v := c.Query("company_id", ""); v != "" {
		if id, e := strconv.ParseUint(v, 10, 32); e == nil {
			p.CompanyID = uint(id)
		}
	}
	if v := c.Query("responsible_user_id", ""); v != "" {
		if id, e := strconv.ParseUint(v, 10, 32); e == nil {
			p.ResponsibleUserID = uint(id)
		}
	}
	if v := c.Query("supervisor_user_id", ""); v != "" {
		if id, e := strconv.ParseUint(v, 10, 32); e == nil {
			p.SupervisorUserID = uint(id)
		}
	}
	data, err := ctrl.svc.Dashboard(p)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"data": data})
}

// Periods
func (ctrl *SupervisorController) ListPeriodsAPI(c fiber.Ctx) error {
	page, perPage := paginationFromQuery(c)
	rows, total, err := ctrl.svc.ListPeriods(page, perPage)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{
		"data": rows,
		"pagination": fiber.Map{
			"page": page, "per_page": perPage, "total": total,
			"total_pages": (total + int64(perPage) - 1) / int64(perPage),
		},
	})
}

func (ctrl *SupervisorController) CreatePeriodAPI(c fiber.Ctx) error {
	var body struct {
		PeriodYM          string `json:"period_ym"`
		Notes             string `json:"notes"`
		BootstrapControls bool   `json:"bootstrap_controls"`
	}
	if err := c.Bind().Body(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "JSON inválido"})
	}
	p, err := ctrl.svc.CreatePeriod(body.PeriodYM, body.Notes)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	resp := fiber.Map{"data": p}
	if body.BootstrapControls {
		allowed, aerr := ctrl.allowedCompanyIDs(c)
		if aerr != nil {
			if e, ok := aerr.(*fiber.Error); ok {
				return c.Status(e.Code).JSON(fiber.Map{"error": e.Message})
			}
		}
		boot, berr := ctrl.svc.BootstrapControlsForPeriod(p.PeriodYM, allowed)
		if berr != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": berr.Error(), "data": p})
		}
		resp["bootstrap"] = boot
	}
	return c.Status(fiber.StatusCreated).JSON(resp)
}

func (ctrl *SupervisorController) BootstrapPeriodAPI(c fiber.Ctx) error {
	id, err := strconv.ParseUint(c.Params("id"), 10, 32)
	if err != nil || id == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ID inválido"})
	}
	allowed, aerr := ctrl.allowedCompanyIDs(c)
	if aerr != nil {
		if e, ok := aerr.(*fiber.Error); ok {
			return c.Status(e.Code).JSON(fiber.Map{"error": e.Message})
		}
	}
	boot, berr := ctrl.svc.BootstrapControlsForPeriodID(uint(id), allowed)
	if berr != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": berr.Error()})
	}
	return c.JSON(fiber.Map{"data": boot})
}

func (ctrl *SupervisorController) UpdatePeriodAPI(c fiber.Ctx) error {
	id, err := strconv.ParseUint(c.Params("id"), 10, 32)
	if err != nil || id == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ID inválido"})
	}
	var body struct {
		Notes string `json:"notes"`
	}
	if err := c.Bind().Body(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "JSON inválido"})
	}
	p, err := ctrl.svc.UpdatePeriod(uint(id), body.Notes)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"data": p})
}

func (ctrl *SupervisorController) DeletePeriodAPI(c fiber.Ctx) error {
	id, err := strconv.ParseUint(c.Params("id"), 10, 32)
	if err != nil || id == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ID inválido"})
	}
	if err := ctrl.svc.DeletePeriod(uint(id)); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"ok": true})
}

func (ctrl *SupervisorController) ClosePeriodAPI(c fiber.Ctx) error {
	id, err := strconv.ParseUint(c.Params("id"), 10, 32)
	if err != nil || id == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ID inválido"})
	}
	uid, err := getUserID(c)
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "No autenticado"})
	}
	p, err := ctrl.svc.ClosePeriod(uint(id), uid)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"data": p})
}

// Controls
func (ctrl *SupervisorController) ListControlsAPI(c fiber.Ctx) error {
	allowed, err := ctrl.allowedCompanyIDs(c)
	if err != nil {
		if e, ok := err.(*fiber.Error); ok {
			return c.Status(e.Code).JSON(fiber.Map{"error": e.Message})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	page, perPage := paginationFromQuery(c)
	p := services.SupervisorListParams{
		PeriodYM:          c.Query("period_ym", ""),
		GeneralStatus:     c.Query("general_status", ""),
		RiskLevel:         c.Query("risk_level", ""),
		Q:                 c.Query("q", ""),
		AllowedCompanyIDs: allowed,
		Page:              page,
		PerPage:           perPage,
	}
	if v := c.Query("company_id", ""); v != "" {
		if id, e := strconv.ParseUint(v, 10, 32); e == nil && id > 0 {
			p.CompanyID = uint(id)
		}
	}
	rows, total, err := ctrl.svc.ListControls(p)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{
		"data": rows,
		"pagination": fiber.Map{
			"page": page, "per_page": perPage, "total": total,
			"total_pages": (total + int64(perPage) - 1) / int64(perPage),
		},
	})
}

func (ctrl *SupervisorController) GetControlAPI(c fiber.Ctx) error {
	id, err := strconv.ParseUint(c.Params("id"), 10, 32)
	if err != nil || id == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ID inválido"})
	}
	if err := ctrl.ensureControlCompany(c, uint(id)); err != nil {
		if e, ok := err.(*fiber.Error); ok {
			return c.Status(e.Code).JSON(fiber.Map{"error": e.Message})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	row, err := ctrl.svc.GetControl(uint(id))
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "No encontrado"})
	}
	return c.JSON(fiber.Map{"data": row})
}

func (ctrl *SupervisorController) bindControlInput(c fiber.Ctx) (services.SupervisorControlInput, error) {
	var body struct {
		CompanyID         uint    `json:"company_id"`
		PeriodYM          string  `json:"period_ym"`
		TaxRegime         string  `json:"tax_regime"`
		ResponsibleUserID *uint   `json:"responsible_user_id"`
		SupervisorUserID  *uint   `json:"supervisor_user_id"`
		DueDate           *string `json:"due_date"`
		GeneralStatus     string  `json:"general_status"`
		RiskLevel         string  `json:"risk_level"`
		Observations      string  `json:"observations"`
		InfoReceivedAt    *string `json:"info_received_at"`
	}
	if err := c.Bind().Body(&body); err != nil {
		return services.SupervisorControlInput{}, err
	}
	in := services.SupervisorControlInput{
		CompanyID:         body.CompanyID,
		PeriodYM:          body.PeriodYM,
		TaxRegime:         body.TaxRegime,
		ResponsibleUserID: body.ResponsibleUserID,
		SupervisorUserID:  body.SupervisorUserID,
		GeneralStatus:     body.GeneralStatus,
		RiskLevel:         body.RiskLevel,
		Observations:      body.Observations,
	}
	if body.DueDate != nil {
		t, err := parseDatePtr(*body.DueDate)
		if err != nil {
			return in, err
		}
		in.DueDate = t
	}
	if body.InfoReceivedAt != nil {
		t, err := time.Parse(time.RFC3339, *body.InfoReceivedAt)
		if err != nil {
			t2, err2 := parseDatePtr(*body.InfoReceivedAt)
			if err2 != nil {
				return in, err
			}
			in.InfoReceivedAt = t2
		} else {
			in.InfoReceivedAt = &t
		}
	}
	return in, nil
}

func (ctrl *SupervisorController) CreateControlAPI(c fiber.Ctx) error {
	in, err := ctrl.bindControlInput(c)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "JSON inválido"})
	}
	if !hasStudioScope(c) {
		uid, e := getUserID(c)
		if e != nil {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "No autenticado"})
		}
		ok, e := ctrl.svc.CanAccessCompany(uid, in.CompanyID, false)
		if e != nil || !ok {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "Sin acceso a esta empresa"})
		}
	}
	row, err := ctrl.svc.CreateControl(in)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	return c.Status(fiber.StatusCreated).JSON(fiber.Map{"data": row})
}

func (ctrl *SupervisorController) UpdateControlAPI(c fiber.Ctx) error {
	id, err := strconv.ParseUint(c.Params("id"), 10, 32)
	if err != nil || id == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ID inválido"})
	}
	if err := ctrl.ensureControlCompany(c, uint(id)); err != nil {
		if e, ok := err.(*fiber.Error); ok {
			return c.Status(e.Code).JSON(fiber.Map{"error": e.Message})
		}
	}
	in, err := ctrl.bindControlInput(c)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "JSON inválido"})
	}
	row, err := ctrl.svc.UpdateControl(uint(id), in)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"data": row})
}

func (ctrl *SupervisorController) RegisterInfoReceivedAPI(c fiber.Ctx) error {
	id, err := strconv.ParseUint(c.Params("id"), 10, 32)
	if err != nil || id == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ID inválido"})
	}
	if err := ctrl.ensureControlCompany(c, uint(id)); err != nil {
		if e, ok := err.(*fiber.Error); ok {
			return c.Status(e.Code).JSON(fiber.Map{"error": e.Message})
		}
	}
	row, err := ctrl.svc.RegisterInfoReceived(uint(id))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"data": row})
}

func (ctrl *SupervisorController) DeleteControlAPI(c fiber.Ctx) error {
	id, err := strconv.ParseUint(c.Params("id"), 10, 32)
	if err != nil || id == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ID inválido"})
	}
	if err := ctrl.ensureControlCompany(c, uint(id)); err != nil {
		if e, ok := err.(*fiber.Error); ok {
			return c.Status(e.Code).JSON(fiber.Map{"error": e.Message})
		}
	}
	if err := ctrl.svc.DeleteControl(uint(id)); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"ok": true})
}

// Declarations
func (ctrl *SupervisorController) ListDeclarationsAPI(c fiber.Ctx) error {
	cid, err := strconv.ParseUint(c.Params("controlId"), 10, 32)
	if err != nil || cid == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "controlId inválido"})
	}
	if err := ctrl.ensureControlCompany(c, uint(cid)); err != nil {
		if e, ok := err.(*fiber.Error); ok {
			return c.Status(e.Code).JSON(fiber.Map{"error": e.Message})
		}
	}
	rows, err := ctrl.svc.ListDeclarations(uint(cid))
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"data": rows})
}

func (ctrl *SupervisorController) UpdateDeclarationAPI(c fiber.Ctx) error {
	id, err := strconv.ParseUint(c.Params("id"), 10, 32)
	if err != nil || id == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ID inválido"})
	}
	if err := ctrl.ensureDeclarationCompany(c, uint(id)); err != nil {
		if e, ok := err.(*fiber.Error); ok {
			return c.Status(e.Code).JSON(fiber.Map{"error": e.Message})
		}
	}
	var body struct {
		Status            string  `json:"status"`
		Notes             string  `json:"notes"`
		ResponsibleUserID *uint   `json:"responsible_user_id"`
		ApproverUserID    *uint   `json:"approver_user_id"`
		ProgressPct       *int    `json:"progress_pct"`
		Priority          string  `json:"priority"`
		DueDate           *string `json:"due_date"`
	}
	if err := c.Bind().Body(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "JSON inválido"})
	}
	in := services.SupervisorDeclarationInput{
		Status: body.Status, Notes: body.Notes,
		ResponsibleUserID: body.ResponsibleUserID, ApproverUserID: body.ApproverUserID,
		ProgressPct: body.ProgressPct, Priority: body.Priority,
	}
	if body.DueDate != nil {
		t, e := parseDatePtr(*body.DueDate)
		if e != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "fecha inválida"})
		}
		in.DueDate = t
	}
	uid, _ := getUserID(c)
	row, err := ctrl.svc.UpdateDeclaration(uint(id), in, uid)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"data": row})
}

func (ctrl *SupervisorController) ApproveDeclarationAPI(c fiber.Ctx) error {
	id, err := strconv.ParseUint(c.Params("id"), 10, 32)
	if err != nil || id == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ID inválido"})
	}
	if err := ctrl.ensureDeclarationCompany(c, uint(id)); err != nil {
		if e, ok := err.(*fiber.Error); ok {
			return c.Status(e.Code).JSON(fiber.Map{"error": e.Message})
		}
	}
	uid, err := getUserID(c)
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "No autenticado"})
	}
	row, err := ctrl.svc.ApproveDeclaration(uint(id), uid)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"data": row})
}

func (ctrl *SupervisorController) ObserveDeclarationAPI(c fiber.Ctx) error {
	id, err := strconv.ParseUint(c.Params("id"), 10, 32)
	if err != nil || id == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ID inválido"})
	}
	if err := ctrl.ensureDeclarationCompany(c, uint(id)); err != nil {
		if e, ok := err.(*fiber.Error); ok {
			return c.Status(e.Code).JSON(fiber.Map{"error": e.Message})
		}
	}
	var body struct {
		Notes string `json:"notes"`
	}
	_ = c.Bind().Body(&body)
	uid, err := getUserID(c)
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "No autenticado"})
	}
	row, err := ctrl.svc.ObserveDeclaration(uint(id), uid, body.Notes)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"data": row})
}

func (ctrl *SupervisorController) DeleteDeclarationAPI(c fiber.Ctx) error {
	id, err := strconv.ParseUint(c.Params("id"), 10, 32)
	if err != nil || id == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ID inválido"})
	}
	if err := ctrl.ensureDeclarationCompany(c, uint(id)); err != nil {
		if e, ok := err.(*fiber.Error); ok {
			return c.Status(e.Code).JSON(fiber.Map{"error": e.Message})
		}
	}
	if err := ctrl.svc.DeleteDeclaration(uint(id)); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"ok": true})
}

// Liquidation
func (ctrl *SupervisorController) GetLiquidationAPI(c fiber.Ctx) error {
	cid, err := strconv.ParseUint(c.Params("controlId"), 10, 32)
	if err != nil || cid == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "controlId inválido"})
	}
	if err := ctrl.ensureControlCompany(c, uint(cid)); err != nil {
		if e, ok := err.(*fiber.Error); ok {
			return c.Status(e.Code).JSON(fiber.Map{"error": e.Message})
		}
	}
	row, err := ctrl.svc.GetLiquidationByControl(uint(cid))
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "No encontrado"})
	}
	return c.JSON(fiber.Map{"data": row})
}

func (ctrl *SupervisorController) UpdateLiquidationAPI(c fiber.Ctx) error {
	cid, err := strconv.ParseUint(c.Params("controlId"), 10, 32)
	if err != nil || cid == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "controlId inválido"})
	}
	if err := ctrl.ensureControlCompany(c, uint(cid)); err != nil {
		if e, ok := err.(*fiber.Error); ok {
			return c.Status(e.Code).JSON(fiber.Map{"error": e.Message})
		}
	}
	var body struct {
		IGV               float64 `json:"igv"`
		RentaMensual      float64 `json:"renta_mensual"`
		OtrosTributos     float64 `json:"otros_tributos"`
		ResponsibleUserID *uint   `json:"responsible_user_id"`
		ApproverUserID    *uint   `json:"approver_user_id"`
		ValidationStatus  string  `json:"validation_status"`
		Notes             string  `json:"notes"`
	}
	if err := c.Bind().Body(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "JSON inválido"})
	}
	in := services.SupervisorLiquidationInput{
		IGV: body.IGV, RentaMensual: body.RentaMensual, OtrosTributos: body.OtrosTributos,
		ResponsibleUserID: body.ResponsibleUserID, ApproverUserID: body.ApproverUserID,
		ValidationStatus: body.ValidationStatus, Notes: body.Notes,
	}
	row, err := ctrl.svc.UpdateLiquidation(uint(cid), in)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"data": row})
}

func (ctrl *SupervisorController) ApproveLiquidationAPI(c fiber.Ctx) error {
	cid, err := strconv.ParseUint(c.Params("controlId"), 10, 32)
	if err != nil || cid == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "controlId inválido"})
	}
	if err := ctrl.ensureControlCompany(c, uint(cid)); err != nil {
		if e, ok := err.(*fiber.Error); ok {
			return c.Status(e.Code).JSON(fiber.Map{"error": e.Message})
		}
	}
	uid, err := getUserID(c)
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "No autenticado"})
	}
	row, err := ctrl.svc.ApproveLiquidation(uint(cid), uid)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"data": row})
}

func (ctrl *SupervisorController) ObserveLiquidationAPI(c fiber.Ctx) error {
	cid, err := strconv.ParseUint(c.Params("controlId"), 10, 32)
	if err != nil || cid == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "controlId inválido"})
	}
	if err := ctrl.ensureControlCompany(c, uint(cid)); err != nil {
		if e, ok := err.(*fiber.Error); ok {
			return c.Status(e.Code).JSON(fiber.Map{"error": e.Message})
		}
	}
	var body struct {
		Notes string `json:"notes"`
	}
	_ = c.Bind().Body(&body)
	uid, err := getUserID(c)
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "No autenticado"})
	}
	row, err := ctrl.svc.ObserveLiquidation(uint(cid), uid, body.Notes)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"data": row})
}

// NPS
func (ctrl *SupervisorController) ListNPSAPI(c fiber.Ctx) error {
	cid, err := strconv.ParseUint(c.Params("controlId"), 10, 32)
	if err != nil || cid == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "controlId inválido"})
	}
	if err := ctrl.ensureControlCompany(c, uint(cid)); err != nil {
		if e, ok := err.(*fiber.Error); ok {
			return c.Status(e.Code).JSON(fiber.Map{"error": e.Message})
		}
	}
	rows, err := ctrl.svc.ListNPS(uint(cid))
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"data": rows})
}

func (ctrl *SupervisorController) CreateNPSAPI(c fiber.Ctx) error {
	var body struct {
		MonthlyControlID uint    `json:"monthly_control_id"`
		Tributo          string  `json:"tributo"`
		Importe          float64 `json:"importe"`
		CodigoNPS        string  `json:"codigo_nps"`
		PaymentDueDate   *string `json:"payment_due_date"`
		PaymentStatus    string  `json:"payment_status"`
		Notes            string  `json:"notes"`
	}
	if err := c.Bind().Body(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "JSON inválido"})
	}
	if err := ctrl.ensureControlCompany(c, body.MonthlyControlID); err != nil {
		if e, ok := err.(*fiber.Error); ok {
			return c.Status(e.Code).JSON(fiber.Map{"error": e.Message})
		}
	}
	in := services.SupervisorNPSInput{
		MonthlyControlID: body.MonthlyControlID,
		Tributo:          body.Tributo,
		Importe:          body.Importe,
		CodigoNPS:        body.CodigoNPS,
		PaymentStatus:    body.PaymentStatus,
		Notes:            body.Notes,
	}
	if body.PaymentDueDate != nil {
		t, e := parseDatePtr(*body.PaymentDueDate)
		if e != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "fecha inválida"})
		}
		in.PaymentDueDate = t
	}
	row, err := ctrl.svc.CreateNPS(in)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	return c.Status(fiber.StatusCreated).JSON(fiber.Map{"data": row})
}

func (ctrl *SupervisorController) UpdateNPSAPI(c fiber.Ctx) error {
	id, err := strconv.ParseUint(c.Params("id"), 10, 32)
	if err != nil || id == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ID inválido"})
	}
	if err := ctrl.ensureNPSCompany(c, uint(id)); err != nil {
		if e, ok := err.(*fiber.Error); ok {
			return c.Status(e.Code).JSON(fiber.Map{"error": e.Message})
		}
	}
	var body struct {
		Tributo        string  `json:"tributo"`
		Importe        float64 `json:"importe"`
		CodigoNPS      string  `json:"codigo_nps"`
		PaymentDueDate *string `json:"payment_due_date"`
		PaymentStatus  string  `json:"payment_status"`
		Notes          string  `json:"notes"`
	}
	if err := c.Bind().Body(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "JSON inválido"})
	}
	in := services.SupervisorNPSInput{
		Tributo: body.Tributo, Importe: body.Importe, CodigoNPS: body.CodigoNPS,
		PaymentStatus: body.PaymentStatus, Notes: body.Notes,
	}
	if body.PaymentDueDate != nil {
		t, e := parseDatePtr(*body.PaymentDueDate)
		if e != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "fecha inválida"})
		}
		in.PaymentDueDate = t
	}
	row, err := ctrl.svc.UpdateNPS(uint(id), in)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"data": row})
}

func (ctrl *SupervisorController) GenerateNPSAPI(c fiber.Ctx) error {
	id, err := strconv.ParseUint(c.Params("id"), 10, 32)
	if err != nil || id == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ID inválido"})
	}
	if err := ctrl.ensureNPSCompany(c, uint(id)); err != nil {
		if e, ok := err.(*fiber.Error); ok {
			return c.Status(e.Code).JSON(fiber.Map{"error": e.Message})
		}
	}
	row, err := ctrl.svc.GenerateNPS(uint(id))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"data": row})
}

func (ctrl *SupervisorController) DeleteNPSAPI(c fiber.Ctx) error {
	id, err := strconv.ParseUint(c.Params("id"), 10, 32)
	if err != nil || id == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ID inválido"})
	}
	if err := ctrl.ensureNPSCompany(c, uint(id)); err != nil {
		if e, ok := err.(*fiber.Error); ok {
			return c.Status(e.Code).JSON(fiber.Map{"error": e.Message})
		}
	}
	if err := ctrl.svc.DeleteNPS(uint(id)); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"ok": true})
}

// Reports
func (ctrl *SupervisorController) reportListParams(c fiber.Ctx) (services.SupervisorReportListParams, int, int, error) {
	ym := c.Query("period_ym", "")
	if ym == "" {
		return services.SupervisorReportListParams{}, 0, 0, fiber.NewError(fiber.StatusBadRequest, "period_ym requerido")
	}
	allowed, err := ctrl.allowedCompanyIDs(c)
	if err != nil {
		return services.SupervisorReportListParams{}, 0, 0, err
	}
	page, perPage := paginationFromQuery(c)
	return services.SupervisorReportListParams{
		PeriodYM: ym, Q: c.Query("q", ""), AllowedCompanyIDs: allowed, Page: page, PerPage: perPage,
	}, page, perPage, nil
}

func (ctrl *SupervisorController) ReportMonthlyAPI(c fiber.Ctx) error {
	params, page, perPage, err := ctrl.reportListParams(c)
	if err != nil {
		if e, ok := err.(*fiber.Error); ok {
			return c.Status(e.Code).JSON(fiber.Map{"error": e.Message})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	kind := c.Query("kind", "monthly")
	if kind == "productivity" {
		rows, err := ctrl.svc.ReportProductivity(params.PeriodYM, params.AllowedCompanyIDs)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
		}
		if rows == nil {
			rows = []services.SupervisorProductivityRow{}
		}
		return c.JSON(fiber.Map{"data": rows})
	}
	if kind == "observations" {
		rows, total, err := ctrl.svc.ReportObservationsHistory(params)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
		}
		if rows == nil {
			rows = []services.SupervisorObservationReportRow{}
		}
		return c.JSON(fiber.Map{
			"data": rows,
			"pagination": fiber.Map{
				"page": page, "per_page": perPage, "total": total,
				"total_pages": (total + int64(perPage) - 1) / int64(perPage),
			},
		})
	}
	rows, total, err := ctrl.svc.ReportList(kind, params)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	if rows == nil {
		rows = []services.SupervisorReportRow{}
	}
	return c.JSON(fiber.Map{
		"data": rows,
		"pagination": fiber.Map{
			"page": page, "per_page": perPage, "total": total,
			"total_pages": (total + int64(perPage) - 1) / int64(perPage),
		},
	})
}

func (ctrl *SupervisorController) ListHistoryAPI(c fiber.Ctx) error {
	entityType := c.Query("entity_type", "")
	eid, err := strconv.ParseUint(c.Query("entity_id", "0"), 10, 32)
	if entityType == "" || err != nil || eid == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "entity_type y entity_id requeridos"})
	}
	if err := ctrl.ensureHistoryEntityAccess(c, entityType, uint(eid)); err != nil {
		if e, ok := err.(*fiber.Error); ok {
			return c.Status(e.Code).JSON(fiber.Map{"error": e.Message})
		}
	}
	rows, err := ctrl.svc.ListChangeHistory(entityType, uint(eid))
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"data": rows})
}

func (ctrl *SupervisorController) ListObservationsAPI(c fiber.Ctx) error {
	cid, _ := strconv.ParseUint(c.Query("control_id", "0"), 10, 32)
	did, _ := strconv.ParseUint(c.Query("declaration_id", "0"), 10, 32)
	if err := ctrl.ensureObservationScope(c, uint(cid), uint(did)); err != nil {
		if e, ok := err.(*fiber.Error); ok {
			return c.Status(e.Code).JSON(fiber.Map{"error": e.Message})
		}
	}
	rows, err := ctrl.svc.ListObservations(uint(cid), uint(did))
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"data": rows})
}

func (ctrl *SupervisorController) CreateObservationAPI(c fiber.Ctx) error {
	var body struct {
		MonthlyControlID uint   `json:"monthly_control_id"`
		DeclarationID    uint   `json:"declaration_id"`
		Body             string `json:"body"`
	}
	if err := c.Bind().Body(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "JSON inválido"})
	}
	if err := ctrl.ensureObservationScope(c, body.MonthlyControlID, body.DeclarationID); err != nil {
		if e, ok := err.(*fiber.Error); ok {
			return c.Status(e.Code).JSON(fiber.Map{"error": e.Message})
		}
	}
	uid, err := getUserID(c)
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "No autenticado"})
	}
	row, err := ctrl.svc.CreateObservation(body.MonthlyControlID, body.DeclarationID, uid, body.Body)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	return c.Status(fiber.StatusCreated).JSON(fiber.Map{"data": row})
}

func (ctrl *SupervisorController) ListAttachmentsAPI(c fiber.Ctx) error {
	cid, _ := strconv.ParseUint(c.Query("control_id", "0"), 10, 32)
	did, _ := strconv.ParseUint(c.Query("declaration_id", "0"), 10, 32)
	if err := ctrl.ensureObservationScope(c, uint(cid), uint(did)); err != nil {
		if e, ok := err.(*fiber.Error); ok {
			return c.Status(e.Code).JSON(fiber.Map{"error": e.Message})
		}
	}
	rows, err := ctrl.svc.ListAttachments(uint(cid), uint(did))
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"data": rows})
}

func (ctrl *SupervisorController) UploadAttachmentAPI(c fiber.Ctx) error {
	fh, err := c.FormFile("file")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "archivo requerido"})
	}
	uid, err := getUserID(c)
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "No autenticado"})
	}
	cid, _ := strconv.ParseUint(c.FormValue("control_id", "0"), 10, 32)
	did, _ := strconv.ParseUint(c.FormValue("declaration_id", "0"), 10, 32)
	if cid == 0 && did == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "control_id o declaration_id requerido"})
	}
	if err := ctrl.ensureObservationScope(c, uint(cid), uint(did)); err != nil {
		if e, ok := err.(*fiber.Error); ok {
			return c.Status(e.Code).JSON(fiber.Map{"error": e.Message})
		}
	}
	if fh.Size > 10*1024*1024 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "archivo máximo 10 MB"})
	}
	f, err := fh.Open()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	defer f.Close()
	data := make([]byte, fh.Size)
	if _, err := f.Read(data); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	url, err := ctrl.svc.StoreSupervisorUpload(fh.Filename, data)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	row, err := ctrl.svc.SaveAttachment(uint(cid), uint(did), uid, fh.Filename, url)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.Status(fiber.StatusCreated).JSON(fiber.Map{"data": row})
}

func (ctrl *SupervisorController) ListNotificationsAPI(c fiber.Ctx) error {
	uid, err := getUserID(c)
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "No autenticado"})
	}
	unread := c.Query("unread", "") == "1"
	rows, err := ctrl.svc.ListNotifications(uid, unread, 80)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"data": rows})
}

func (ctrl *SupervisorController) MarkNotificationReadAPI(c fiber.Ctx) error {
	id, err := strconv.ParseUint(c.Params("id"), 10, 32)
	if err != nil || id == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ID inválido"})
	}
	uid, err := getUserID(c)
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "No autenticado"})
	}
	if err := ctrl.svc.MarkNotificationRead(uint(id), uid); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"ok": true})
}

func (ctrl *SupervisorController) RegisterNPSPaymentAPI(c fiber.Ctx) error {
	id, err := strconv.ParseUint(c.Params("id"), 10, 32)
	if err != nil || id == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ID inválido"})
	}
	if err := ctrl.ensureNPSCompany(c, uint(id)); err != nil {
		if e, ok := err.(*fiber.Error); ok {
			return c.Status(e.Code).JSON(fiber.Map{"error": e.Message})
		}
	}
	uid, err := getUserID(c)
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "No autenticado"})
	}
	row, err := ctrl.svc.RegisterNPSPayment(uint(id), uid)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"data": row})
}

// DetraccionesListAPI GET /api/supervisors/activity-modules/detracciones
func (ctrl *SupervisorController) DetraccionesListAPI(c fiber.Ctx) error {
	allowed, err := ctrl.allowedCompanyIDs(c)
	if err != nil {
		if e, ok := err.(*fiber.Error); ok {
			return c.Status(e.Code).JSON(fiber.Map{"error": e.Message})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	page, perPage := paginationFromQuery(c)
	out, err := ctrl.svc.ListDetracciones(services.DetraccionesListParams{
		PeriodYM:          c.Query("period_ym", ""),
		Status:            c.Query("status", ""),
		Q:                 c.Query("q", ""),
		AllowedCompanyIDs: allowed,
		Page:              page,
		PerPage:           perPage,
	})
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	if out.Rows == nil {
		out.Rows = []services.DetraccionesListRow{}
	}
	return c.JSON(fiber.Map{
		"data": out.Rows,
		"pagination": fiber.Map{
			"page": out.Page, "per_page": out.PerPage, "total": out.Total, "total_pages": out.TotalPages,
		},
	})
}

// DetraccionesDetailAPI GET /api/supervisors/activity-modules/detracciones/companies/:companyId
func (ctrl *SupervisorController) DetraccionesDetailAPI(c fiber.Ctx) error {
	companyID, err := strconv.ParseUint(c.Params("companyId"), 10, 32)
	if err != nil || companyID == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "empresa inválida"})
	}
	periodYM := strings.TrimSpace(c.Query("period_ym", ""))
	if periodYM == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "period_ym requerido"})
	}
	if !hasStudioScope(c) {
		uid, uerr := getUserID(c)
		if uerr != nil {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "No autenticado"})
		}
		ok, aerr := ctrl.svc.CanAccessCompany(uid, uint(companyID), false)
		if aerr != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Error de acceso"})
		}
		if !ok {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "Sin acceso a esta empresa"})
		}
	}
	row, err := ctrl.svc.EnsureDetracciones(uint(companyID), periodYM)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"data": row})
}

// DetraccionesValidateAPI POST /api/supervisors/activity-modules/detracciones/declarations/:declarationId/validate
func (ctrl *SupervisorController) DetraccionesValidateAPI(c fiber.Ctx) error {
	declarationID, err := strconv.ParseUint(c.Params("declarationId"), 10, 32)
	if err != nil || declarationID == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "declaración inválida"})
	}
	if err := ctrl.ensureDeclarationCompany(c, uint(declarationID)); err != nil {
		if e, ok := err.(*fiber.Error); ok {
			return c.Status(e.Code).JSON(fiber.Map{"error": e.Message})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	if err := ctrl.svc.EnsureDetraccionesDeclarationType(uint(declarationID)); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	uid, err := getUserID(c)
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "No autenticado"})
	}
	row, err := ctrl.svc.ValidateDetracciones(uint(declarationID), uid)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"data": row})
}

// DetraccionesUploadAPI POST /api/supervisors/activity-modules/detracciones/companies/:companyId/upload
func (ctrl *SupervisorController) DetraccionesUploadAPI(c fiber.Ctx) error {
	companyID, err := strconv.ParseUint(c.Params("companyId"), 10, 32)
	if err != nil || companyID == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "empresa inválida"})
	}
	periodYM := strings.TrimSpace(c.Query("period_ym", ""))
	if periodYM == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "period_ym requerido"})
	}
	if !hasStudioScope(c) {
		uid, uerr := getUserID(c)
		if uerr != nil {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "No autenticado"})
		}
		ok, aerr := ctrl.svc.CanAccessCompany(uid, uint(companyID), false)
		if aerr != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Error de acceso"})
		}
		if !ok {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "Sin acceso a esta empresa"})
		}
	}
	fh, err := c.FormFile("file")
	if err != nil || fh == nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "archivo requerido"})
	}
	if fh.Size > 10*1024*1024 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "archivo máximo 10 MB"})
	}
	f, err := fh.Open()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	defer f.Close()
	data := make([]byte, fh.Size)
	if _, err := f.Read(data); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	uid, err := getUserID(c)
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "No autenticado"})
	}
	row, err := ctrl.svc.UploadDetraccionesPDF(uint(companyID), periodYM, fh.Filename, data, uid)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	return c.Status(fiber.StatusCreated).JSON(fiber.Map{"data": row})
}

// DetraccionesVerifyAPI POST /api/supervisors/activity-modules/detracciones/declarations/:declarationId/verify
func (ctrl *SupervisorController) DetraccionesVerifyAPI(c fiber.Ctx) error {
	declarationID, err := strconv.ParseUint(c.Params("declarationId"), 10, 32)
	if err != nil || declarationID == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "declaración inválida"})
	}
	if err := ctrl.ensureDeclarationCompany(c, uint(declarationID)); err != nil {
		if e, ok := err.(*fiber.Error); ok {
			return c.Status(e.Code).JSON(fiber.Map{"error": e.Message})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	if err := ctrl.svc.EnsureDetraccionesDeclarationType(uint(declarationID)); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	uid, err := getUserID(c)
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "No autenticado"})
	}
	row, err := ctrl.svc.ValidateDetracciones(uint(declarationID), uid)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"data": row})
}

// DetraccionesSetStatusAPI PUT /api/supervisors/activity-modules/detracciones/declarations/:declarationId/status
func (ctrl *SupervisorController) DetraccionesSetStatusAPI(c fiber.Ctx) error {
	declarationID, err := strconv.ParseUint(c.Params("declarationId"), 10, 32)
	if err != nil || declarationID == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "declaración inválida"})
	}
	if err := ctrl.ensureDeclarationCompany(c, uint(declarationID)); err != nil {
		if e, ok := err.(*fiber.Error); ok {
			return c.Status(e.Code).JSON(fiber.Map{"error": e.Message})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	if err := ctrl.svc.EnsureDetraccionesDeclarationType(uint(declarationID)); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	var body struct {
		Status string `json:"status"`
	}
	if err := c.Bind().Body(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Datos inválidos"})
	}
	uid, err := getUserID(c)
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "No autenticado"})
	}
	row, err := ctrl.svc.SetDetraccionesSupervisorStatus(uint(declarationID), body.Status, uid)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"data": row})
}

// SunatInboxListAPI GET /api/supervisors/activity-modules/sunat-inbox
func (ctrl *SupervisorController) SunatInboxListAPI(c fiber.Ctx) error {
	allowed, err := ctrl.allowedCompanyIDs(c)
	if err != nil {
		if e, ok := err.(*fiber.Error); ok {
			return c.Status(e.Code).JSON(fiber.Map{"error": e.Message})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	page, perPage := paginationFromQuery(c)
	out, err := ctrl.svc.ListSunatInbox(services.SunatInboxListParams{
		PeriodYM:          c.Query("period_ym", ""),
		WeekStart:         c.Query("week_start", ""),
		Status:            c.Query("status", ""),
		Q:                 c.Query("q", ""),
		AllowedCompanyIDs: allowed,
		Page:              page,
		PerPage:           perPage,
	})
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	if out.Rows == nil {
		out.Rows = []services.SunatInboxListRow{}
	}
	return c.JSON(fiber.Map{
		"meta": out.Meta,
		"data": out.Rows,
		"pagination": fiber.Map{
			"page": out.Page, "per_page": out.PerPage, "total": out.Total, "total_pages": out.TotalPages,
		},
	})
}

// SunatInboxDetailAPI GET /api/supervisors/activity-modules/sunat-inbox/companies/:companyId
func (ctrl *SupervisorController) SunatInboxDetailAPI(c fiber.Ctx) error {
	companyID, err := strconv.ParseUint(c.Params("companyId"), 10, 32)
	if err != nil || companyID == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "empresa inválida"})
	}
	periodYM := strings.TrimSpace(c.Query("period_ym", ""))
	if periodYM == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "period_ym requerido"})
	}
	weekStart := strings.TrimSpace(c.Query("week_start", ""))
	if !hasStudioScope(c) {
		uid, uerr := getUserID(c)
		if uerr != nil {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "No autenticado"})
		}
		ok, aerr := ctrl.svc.CanAccessCompany(uid, uint(companyID), false)
		if aerr != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Error de acceso"})
		}
		if !ok {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "Sin acceso a esta empresa"})
		}
	}
	row, err := ctrl.svc.EnsureSunatInbox(uint(companyID), periodYM, weekStart)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"data": row})
}

// SunatInboxUploadAPI POST /api/supervisors/activity-modules/sunat-inbox/companies/:companyId/slots/:slotIndex/upload
func (ctrl *SupervisorController) SunatInboxUploadAPI(c fiber.Ctx) error {
	companyID, err := strconv.ParseUint(c.Params("companyId"), 10, 32)
	if err != nil || companyID == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "empresa inválida"})
	}
	slotIndex, err := strconv.Atoi(strings.TrimSpace(c.Params("slotIndex")))
	if err != nil || slotIndex < 1 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "slot_index inválido"})
	}
	periodYM := strings.TrimSpace(c.Query("period_ym", ""))
	if periodYM == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "period_ym requerido"})
	}
	weekStart := strings.TrimSpace(c.Query("week_start", ""))
	mailboxType := strings.TrimSpace(c.FormValue("mailbox_type", ""))
	if !hasStudioScope(c) {
		uid, uerr := getUserID(c)
		if uerr != nil {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "No autenticado"})
		}
		ok, aerr := ctrl.svc.CanAccessCompany(uid, uint(companyID), false)
		if aerr != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Error de acceso"})
		}
		if !ok {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "Sin acceso a esta empresa"})
		}
	}
	fh, err := c.FormFile("file")
	if err != nil || fh == nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "archivo requerido"})
	}
	if fh.Size > 10*1024*1024 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "archivo máximo 10 MB"})
	}
	f, err := fh.Open()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	defer f.Close()
	data := make([]byte, fh.Size)
	if _, err := f.Read(data); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	uid, err := getUserID(c)
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "No autenticado"})
	}
	row, err := ctrl.svc.UploadMailboxCapture(uint(companyID), periodYM, weekStart, slotIndex, mailboxType, fh.Filename, data, uid)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	return c.Status(fiber.StatusCreated).JSON(fiber.Map{"data": row})
}

// SunatInboxVerifySlotAPI POST /api/supervisors/activity-modules/sunat-inbox/slots/:slotId/verify
func (ctrl *SupervisorController) SunatInboxVerifySlotAPI(c fiber.Ctx) error {
	slotID, err := strconv.ParseUint(c.Params("slotId"), 10, 32)
	if err != nil || slotID == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "slot inválido"})
	}
	var body struct {
		MailboxType string `json:"mailbox_type"`
	}
	if err := c.Bind().Body(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Datos inválidos"})
	}
	allowed, err := ctrl.allowedCompanyIDs(c)
	if err != nil {
		if e, ok := err.(*fiber.Error); ok {
			return c.Status(e.Code).JSON(fiber.Map{"error": e.Message})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	uid, err := getUserID(c)
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "No autenticado"})
	}
	row, err := ctrl.svc.VerifyMailboxCapture(uint(slotID), body.MailboxType, uid, allowed)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"data": row})
}

// Pdt601ListAPI GET /api/supervisors/activity-modules/pdt-601
func (ctrl *SupervisorController) Pdt601ListAPI(c fiber.Ctx) error {
	allowed, err := ctrl.allowedCompanyIDs(c)
	if err != nil {
		if e, ok := err.(*fiber.Error); ok {
			return c.Status(e.Code).JSON(fiber.Map{"error": e.Message})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	page, perPage := paginationFromQuery(c)
	out, err := ctrl.svc.ListPdt601(services.Pdt601ListParams{
		PeriodYM:          c.Query("period_ym", ""),
		Status:            c.Query("status", ""),
		Q:                 c.Query("q", ""),
		AllowedCompanyIDs: allowed,
		Page:              page,
		PerPage:           perPage,
	})
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	if out.Rows == nil {
		out.Rows = []services.Pdt601ListRow{}
	}
	return c.JSON(fiber.Map{
		"data": out.Rows,
		"pagination": fiber.Map{
			"page": out.Page, "per_page": out.PerPage, "total": out.Total, "total_pages": out.TotalPages,
		},
	})
}

// Pdt601DetailAPI GET /api/supervisors/activity-modules/pdt-601/companies/:companyId
func (ctrl *SupervisorController) Pdt601DetailAPI(c fiber.Ctx) error {
	companyID, err := strconv.ParseUint(c.Params("companyId"), 10, 32)
	if err != nil || companyID == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "empresa inválida"})
	}
	periodYM := strings.TrimSpace(c.Query("period_ym", ""))
	if periodYM == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "period_ym requerido"})
	}
	if !hasStudioScope(c) {
		uid, uerr := getUserID(c)
		if uerr != nil {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "No autenticado"})
		}
		ok, aerr := ctrl.svc.CanAccessCompany(uid, uint(companyID), false)
		if aerr != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Error de acceso"})
		}
		if !ok {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "Sin acceso a esta empresa"})
		}
	}
	row, err := ctrl.svc.EnsurePdt601(uint(companyID), periodYM)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"data": row})
}

// Pdt621ListAPI GET /api/supervisors/activity-modules/pdt-621
func (ctrl *SupervisorController) Pdt621ListAPI(c fiber.Ctx) error {
	allowed, err := ctrl.allowedCompanyIDs(c)
	if err != nil {
		if e, ok := err.(*fiber.Error); ok {
			return c.Status(e.Code).JSON(fiber.Map{"error": e.Message})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	page, perPage := paginationFromQuery(c)
	out, err := ctrl.svc.ListPdt621(services.Pdt621ListParams{
		PeriodYM:          c.Query("period_ym", ""),
		Status:            c.Query("status", ""),
		Q:                 c.Query("q", ""),
		AllowedCompanyIDs: allowed,
		Page:              page,
		PerPage:           perPage,
	})
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	if out.Rows == nil {
		out.Rows = []services.Pdt621ListRow{}
	}
	return c.JSON(fiber.Map{
		"data": out.Rows,
		"pagination": fiber.Map{
			"page": out.Page, "per_page": out.PerPage, "total": out.Total, "total_pages": out.TotalPages,
		},
	})
}

// Pdt621DetailAPI GET /api/supervisors/activity-modules/pdt-621/companies/:companyId
func (ctrl *SupervisorController) Pdt621DetailAPI(c fiber.Ctx) error {
	companyID, err := strconv.ParseUint(c.Params("companyId"), 10, 32)
	if err != nil || companyID == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "empresa inválida"})
	}
	periodYM := strings.TrimSpace(c.Query("period_ym", ""))
	if periodYM == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "period_ym requerido"})
	}
	if !hasStudioScope(c) {
		uid, uerr := getUserID(c)
		if uerr != nil {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "No autenticado"})
		}
		ok, aerr := ctrl.svc.CanAccessCompany(uid, uint(companyID), false)
		if aerr != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Error de acceso"})
		}
		if !ok {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "Sin acceso a esta empresa"})
		}
	}
	row, err := ctrl.svc.EnsurePdt621(uint(companyID), periodYM)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"data": row})
}
