package controllers

import (
	"strings"

	"miappfiber/services"

	"github.com/gofiber/fiber/v3"
)

type AuthController struct {
	authService *services.AuthService
}

func NewAuthController() *AuthController {
	return &AuthController{authService: services.NewAuthService()}
}

type LoginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

func (ctrl *AuthController) LoginAPI(c fiber.Ctx) error {
	var req LoginRequest
	if err := c.Bind().Body(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Datos inválidos"})
	}
	if strings.TrimSpace(req.Username) == "" || req.Password == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Usuario y contraseña son requeridos"})
	}

	user, err := ctrl.authService.Login(req.Username, req.Password)
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": err.Error()})
	}

	token, err := ctrl.authService.GenerateToken(user)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Error generando token"})
	}

	return c.JSON(fiber.Map{
		"token": token,
		"user": fiber.Map{
			"id":       user.ID,
			"name":     user.Name,
			"username": user.Username,
			"email":    user.EmailString(),
		},
	})
}

func (ctrl *AuthController) LogoutAPI(c fiber.Ctx) error {
	// En API stateless el cliente debe eliminar el token
	return c.JSON(fiber.Map{"message": "Sesión cerrada"})
}
