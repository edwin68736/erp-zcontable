package controllers

import (
	"strconv"

	"miappfiber/services"

	"github.com/gofiber/fiber/v3"
)

type RoleController struct {
	svc *services.RoleService
}

func NewRoleController() *RoleController {
	return &RoleController{svc: services.NewRoleService()}
}

func (ctrl *RoleController) ListAPI(c fiber.Ctx) error {
	roles, err := ctrl.svc.List()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"success": false, "message": err.Error()})
	}
	return c.JSON(fiber.Map{"success": true, "data": roles})
}

func (ctrl *RoleController) GetAPI(c fiber.Ctx) error {
	id, err := strconv.ParseUint(c.Params("id"), 10, 32)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"success": false, "message": "ID inválido"})
	}
	r, err := ctrl.svc.GetByID(uint(id))
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"success": false, "message": "Rol no encontrado"})
	}
	return c.JSON(fiber.Map{"success": true, "data": r})
}

func (ctrl *RoleController) CatalogAPI(c fiber.Ctx) error {
	mods, err := ctrl.svc.CatalogModules()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"success": false, "message": err.Error()})
	}
	return c.JSON(fiber.Map{"success": true, "data": mods})
}

func (ctrl *RoleController) CreateAPI(c fiber.Ctx) error {
	var body struct {
		Code        string `json:"code"`
		Name        string `json:"name"`
		Description string `json:"description"`
	}
	if err := c.Bind().Body(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"success": false, "message": "JSON inválido"})
	}
	r, err := ctrl.svc.CreateRole(body.Code, body.Name, body.Description)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"success": false, "message": err.Error()})
	}
	return c.Status(fiber.StatusCreated).JSON(fiber.Map{"success": true, "data": r})
}

func (ctrl *RoleController) UpdateAPI(c fiber.Ctx) error {
	id, err := strconv.ParseUint(c.Params("id"), 10, 32)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"success": false, "message": "ID inválido"})
	}
	var body struct {
		Name        string `json:"name"`
		Description string `json:"description"`
	}
	if err := c.Bind().Body(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"success": false, "message": "JSON inválido"})
	}
	r, err := ctrl.svc.UpdateRole(uint(id), body.Name, body.Description)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"success": false, "message": err.Error()})
	}
	return c.JSON(fiber.Map{"success": true, "data": r})
}

func (ctrl *RoleController) GetDefaultAPI(c fiber.Ctx) error {
	r, err := ctrl.svc.GetDefaultRole()
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"success": false, "message": err.Error()})
	}
	return c.JSON(fiber.Map{"success": true, "data": r})
}

func (ctrl *RoleController) SetDefaultAPI(c fiber.Ctx) error {
	id, err := strconv.ParseUint(c.Params("id"), 10, 32)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"success": false, "message": "ID inválido"})
	}
	r, err := ctrl.svc.SetDefaultRole(uint(id))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"success": false, "message": err.Error()})
	}
	return c.JSON(fiber.Map{"success": true, "data": r, "message": "Rol predeterminado actualizado"})
}

func (ctrl *RoleController) CloneAPI(c fiber.Ctx) error {
	id, err := strconv.ParseUint(c.Params("id"), 10, 32)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"success": false, "message": "ID inválido"})
	}
	var body struct {
		Code        string `json:"code"`
		Name        string `json:"name"`
		Description string `json:"description"`
	}
	if err := c.Bind().Body(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"success": false, "message": "JSON inválido"})
	}
	r, err := ctrl.svc.CloneRole(uint(id), body.Code, body.Name, body.Description)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"success": false, "message": err.Error()})
	}
	return c.Status(fiber.StatusCreated).JSON(fiber.Map{"success": true, "data": r})
}

func (ctrl *RoleController) DeleteAPI(c fiber.Ctx) error {
	id, err := strconv.ParseUint(c.Params("id"), 10, 32)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"success": false, "message": "ID inválido"})
	}
	if err := ctrl.svc.DeleteRole(uint(id)); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"success": false, "message": err.Error()})
	}
	return c.JSON(fiber.Map{"success": true, "message": "Rol eliminado"})
}

func (ctrl *RoleController) ReplacePermissionsAPI(c fiber.Ctx) error {
	id, err := strconv.ParseUint(c.Params("id"), 10, 32)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"success": false, "message": "ID inválido"})
	}
	var body struct {
		PermissionIDs []uint `json:"permission_ids"`
	}
	if err := c.Bind().Body(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"success": false, "message": "JSON inválido"})
	}
	if err := ctrl.svc.ReplaceRolePermissions(uint(id), body.PermissionIDs); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"success": false, "message": err.Error()})
	}
	return c.JSON(fiber.Map{"success": true, "message": "Permisos actualizados"})
}
