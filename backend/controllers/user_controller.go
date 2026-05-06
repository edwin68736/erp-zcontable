package controllers

import (
	"strconv"

	"miappfiber/services"

	"github.com/gofiber/fiber/v3"
)

type UserController struct {
	userService *services.UserService
}

func NewUserController() *UserController {
	return &UserController{
		userService: NewUserServiceWrapper(),
	}
}

// NewUserServiceWrapper existe para aislar la dependencia directa en services,
// facilitando pruebas si se requiere.
func NewUserServiceWrapper() *services.UserService {
	return services.NewUserService()
}

// ---- API ----

func (ctrl *UserController) ListAPI(c fiber.Ctx) error {
	users, err := ctrl.userService.List()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"data": users})
}

func (ctrl *UserController) GetAPI(c fiber.Ctx) error {
	id, err := strconv.ParseUint(c.Params("id"), 10, 32)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ID inválido"})
	}
	u, err := ctrl.userService.GetByID(uint(id))
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Usuario no encontrado"})
	}
	return c.JSON(u)
}

func (ctrl *UserController) CreateAPI(c fiber.Ctx) error {
	var body struct {
		Username string `json:"username"`
		Name     string `json:"name"`
		Email    string `json:"email"`
		Password string `json:"password"`
		Role     string `json:"role"`
		Active   *bool  `json:"active"`
		DNI      string `json:"dni"`
		Phone    string `json:"phone"`
		Address  string `json:"address"`
	}
	if err := c.Bind().Body(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Datos inválidos"})
	}
	active := true
	if body.Active != nil {
		active = *body.Active
	}
	u, generated, err := ctrl.userService.Create(body.Username, body.Name, body.Email, body.Password, body.Role, body.DNI, body.Phone, body.Address, active)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	resp := fiber.Map{
		"id":         u.ID,
		"name":       u.Name,
		"username":   u.Username,
		"role":       u.Role,
		"active":     u.Active,
		"dni":        u.DNI,
		"phone":      u.Phone,
		"address":    u.Address,
		"created_at": u.CreatedAt,
		"updated_at": u.UpdatedAt,
	}
	if u.Email != nil {
		resp["email"] = *u.Email
	}
	if generated != "" {
		resp["generated_password"] = generated
	}
	return c.Status(fiber.StatusCreated).JSON(resp)
}

func (ctrl *UserController) UpdateAPI(c fiber.Ctx) error {
	id, err := strconv.ParseUint(c.Params("id"), 10, 32)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ID inválido"})
	}
	var body struct {
		Username string  `json:"username"`
		Name     string  `json:"name"`
		Email    string  `json:"email"`
		Password string  `json:"password"`
		Role     string  `json:"role"`
		Active   *bool   `json:"active"`
		DNI      *string `json:"dni"`
		Phone    *string `json:"phone"`
		Address  *string `json:"address"`
	}
	if err := c.Bind().Body(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Datos inválidos"})
	}
	u, err := ctrl.userService.Update(uint(id), body.Username, body.Name, body.Email, body.Password, body.Role, body.Active, body.DNI, body.Phone, body.Address)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(u)
}

func (ctrl *UserController) DeleteAPI(c fiber.Ctx) error {
	id, err := strconv.ParseUint(c.Params("id"), 10, 32)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ID inválido"})
	}
	if err := ctrl.userService.Delete(uint(id)); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"message": "Eliminado"})
}
