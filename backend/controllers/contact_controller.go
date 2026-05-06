package controllers

import (
	"strconv"

	"miappfiber/models"
	"miappfiber/services"

	"github.com/gofiber/fiber/v3"
)

type ContactController struct {
	contactService *services.ContactService
	accessService  *services.AccessService
}

func NewContactController() *ContactController {
	return &ContactController{
		contactService: services.NewContactService(),
		accessService:  services.NewAccessService(),
	}
}

// ---- API ----

func (ctrl *ContactController) ListByCompanyAPI(c fiber.Ctx) error {
	companyID, err := parseUintParam(c, "companyID")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "companyID inválido"})
	}

	if !isAdmin(c) {
		userID, err := getUserID(c)
		if err != nil {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "No autenticado"})
		}
		ok, err := ctrl.accessService.CanAccessCompany(userID, uint(companyID))
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Error de acceso"})
		}
		if !ok {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Empresa no encontrada"})
		}
	}

	list, err := ctrl.contactService.ListByCompany(uint(companyID))
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"data": list})
}

func (ctrl *ContactController) GetAPI(c fiber.Ctx) error {
	companyID, err := parseUintParam(c, "companyID")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "companyID inválido"})
	}

	if !isAdmin(c) {
		userID, err := getUserID(c)
		if err != nil {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "No autenticado"})
		}
		ok, err := ctrl.accessService.CanAccessCompany(userID, uint(companyID))
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Error de acceso"})
		}
		if !ok {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Empresa no encontrada"})
		}
	}

	id, err := parseUintParam(c, "id")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ID inválido"})
	}
	contact, err := ctrl.contactService.GetByID(uint(id))
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Contacto no encontrado"})
	}
	if contact.CompanyID != uint(companyID) {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Contacto no encontrado"})
	}
	return c.JSON(contact)
}

func (ctrl *ContactController) CreateAPI(c fiber.Ctx) error {
	companyID, err := parseUintParam(c, "companyID")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "companyID inválido"})
	}

	if !isAdmin(c) {
		userID, err := getUserID(c)
		if err != nil {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "No autenticado"})
		}
		ok, err := ctrl.accessService.CanAccessCompany(userID, uint(companyID))
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Error de acceso"})
		}
		if !ok {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Empresa no encontrada"})
		}
	}

	var input models.Contact
	if err := c.Bind().Body(&input); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Datos inválidos"})
	}
	input.CompanyID = uint(companyID)
	if err := ctrl.contactService.Create(&input); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	return c.Status(fiber.StatusCreated).JSON(input)
}

func (ctrl *ContactController) UpdateAPI(c fiber.Ctx) error {
	companyID, err := parseUintParam(c, "companyID")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "companyID inválido"})
	}

	if !isAdmin(c) {
		userID, err := getUserID(c)
		if err != nil {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "No autenticado"})
		}
		ok, err := ctrl.accessService.CanAccessCompany(userID, uint(companyID))
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Error de acceso"})
		}
		if !ok {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Empresa no encontrada"})
		}
	}

	id, err := parseUintParam(c, "id")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ID inválido"})
	}
	var input models.Contact
	if err := c.Bind().Body(&input); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Datos inválidos"})
	}
	input.CompanyID = uint(companyID)
	if err := ctrl.contactService.Update(uint(id), &input); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	contact, _ := ctrl.contactService.GetByID(uint(id))
	return c.JSON(contact)
}

func (ctrl *ContactController) DeleteAPI(c fiber.Ctx) error {
	companyID, err := parseUintParam(c, "companyID")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "companyID inválido"})
	}

	if !isAdmin(c) {
		userID, err := getUserID(c)
		if err != nil {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "No autenticado"})
		}
		ok, err := ctrl.accessService.CanAccessCompany(userID, uint(companyID))
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Error de acceso"})
		}
		if !ok {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Empresa no encontrada"})
		}
	}

	id, err := parseUintParam(c, "id")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ID inválido"})
	}
	if err := ctrl.contactService.Delete(uint(id)); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"message": "Eliminado"})
}

func parseUintParam(c fiber.Ctx, name string) (uint64, error) {
	return strconv.ParseUint(c.Params(name), 10, 32)
}
