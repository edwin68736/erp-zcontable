package controllers

import (
	"errors"
	"strconv"
	"strings"

	"miappfiber/services"

	"github.com/gofiber/fiber/v3"
)

// SunatBuzonController notificaciones y mensajes del Buzón Electrónico SOL de cada empresa: lo guardado y la
// sincronización con SUNAT (ver services/sunat_buzon_service.go).
type SunatBuzonController struct {
	svc    *services.SunatBuzonService
	access *services.AccessService
}

func NewSunatBuzonController() *SunatBuzonController {
	return &SunatBuzonController{svc: services.SharedSunatBuzonService(), access: services.NewAccessService()}
}

func (ctrl *SunatBuzonController) allowed(c fiber.Ctx) ([]uint, error) {
	if hasStudioScope(c) {
		return nil, nil
	}
	uid, err := getUserID(c)
	if err != nil {
		return nil, fiber.NewError(fiber.StatusUnauthorized, "No autenticado")
	}
	return ctrl.access.GetAllowedCompanyIDs(uid)
}

// company valida el id y el alcance; si falla ya respondió.
func (ctrl *SunatBuzonController) company(c fiber.Ctx) (uint, []uint, bool, error) {
	allowed, err := ctrl.allowed(c)
	if err != nil {
		var fe *fiber.Error
		if errors.As(err, &fe) {
			return 0, nil, false, c.Status(fe.Code).JSON(fiber.Map{"error": fe.Message})
		}
		return 0, nil, false, c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Error de acceso"})
	}
	id, perr := strconv.ParseUint(c.Params("companyId"), 10, 64)
	if perr != nil || id == 0 {
		return 0, nil, false, c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ID de empresa inválido"})
	}
	if serr := ctrl.svc.InScope(uint(id), allowed); serr != nil {
		return 0, nil, false, c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "No tiene acceso a esta empresa.", "code": services.BuzonErrOutOfScope})
	}
	return uint(id), allowed, true, nil
}

// SummaryAPI GET /tools/buzon/summary?ids=1,2,3 — estado de sincronización de varias empresas (para la lista).
func (ctrl *SunatBuzonController) SummaryAPI(c fiber.Ctx) error {
	allowed, err := ctrl.allowed(c)
	if err != nil {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "No tiene acceso"})
	}
	scope := map[uint]bool{}
	for _, id := range allowed {
		scope[id] = true
	}
	var ids []uint
	for _, p := range strings.Split(c.Query("ids"), ",") {
		if n, e := strconv.ParseUint(strings.TrimSpace(p), 10, 64); e == nil && n > 0 && (allowed == nil || scope[uint(n)]) {
			ids = append(ids, uint(n))
		}
	}
	if len(ids) > 200 {
		ids = ids[:200]
	}
	states, serr := ctrl.svc.States(ids)
	if serr != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "No se pudo leer el estado de las sincronizaciones."})
	}
	return c.JSON(fiber.Map{"data": states, "running": ctrl.svc.RunningCompany()})
}

// GetAPI GET /tools/buzon/:companyId?tipo=&etiqueta=&no_leidas=1&urgentes=1&nuevos=1&q=&page=&per_page=
// Devuelve lo ya guardado (sin llamar a SUNAT).
func (ctrl *SunatBuzonController) GetAPI(c fiber.Ctx) error {
	id, _, ok, err := ctrl.company(c)
	if !ok {
		return err
	}
	page, perr := ctrl.svc.Messages(id, services.BuzonFilter{
		Tipo:       queryInt(c, "tipo", 0),
		Etiqueta:   c.Query("etiqueta"),
		OnlyUnread: c.Query("no_leidas") == "1",
		OnlyUrgent: c.Query("urgentes") == "1",
		OnlyNew:    c.Query("nuevos") == "1",
		Q:          c.Query("q"),
		Page:       queryInt(c, "page", 1),
		PerPage:    queryInt(c, "per_page", 25),
	})
	if perr != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "No se pudo leer el buzón guardado."})
	}
	return c.JSON(fiber.Map{"state": ctrl.svc.State(id), "running": ctrl.svc.RunningCompany(), "messages": page, "etiquetas": services.BuzonEtiquetas})
}

// SyncAPI POST /tools/buzon/:companyId/sync — entra a SUNAT con la clave guardada y actualiza el buzón guardado.
func (ctrl *SunatBuzonController) SyncAPI(c fiber.Ctx) error {
	id, allowed, ok, err := ctrl.company(c)
	if !ok {
		return err
	}
	uid, _ := getUserID(c)
	st, serr := ctrl.svc.SyncCompany(id, allowed, services.BuzonSourceManual, uid, false)
	if serr == nil {
		return c.JSON(fiber.Map{"state": st})
	}
	var be *services.BuzonError
	if !errors.As(serr, &be) {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "No se pudo sincronizar el buzón.", "state": st})
	}
	status := fiber.StatusUnprocessableEntity
	switch be.Code {
	case services.BuzonErrInProgress:
		status = fiber.StatusConflict
	case services.BuzonErrOutOfScope:
		status = fiber.StatusForbidden
	case "sunat_no_disponible":
		status = fiber.StatusBadGateway
	}
	return c.Status(status).JSON(fiber.Map{"error": be.Message, "code": be.Code, "detail": be.Detail, "state": st})
}

// SeenAPI POST /tools/buzon/:companyId/seen — quita la marca "nuevo" de lo que el usuario ya revisó.
func (ctrl *SunatBuzonController) SeenAPI(c fiber.Ctx) error {
	id, _, ok, err := ctrl.company(c)
	if !ok {
		return err
	}
	if e := ctrl.svc.MarkSeen(id); e != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "No se pudo marcar como visto."})
	}
	return c.JSON(fiber.Map{"state": ctrl.svc.State(id)})
}
