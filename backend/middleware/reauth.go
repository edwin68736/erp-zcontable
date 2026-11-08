package middleware

import (
	"miappfiber/services"

	"github.com/gofiber/fiber/v3"
)

// RequireRecentAuth exige haber escrito la contraseña hace poco (ReauthWindow) para acciones sensibles: crear o editar
// usuarios, cambiar roles y permisos, configuración de seguridad. Si no, responde 403 con code "reauth_required" y la
// pantalla pide la contraseña de nuevo (POST /me/reauth) y repite la acción. Así, una sesión abierta y desatendida o
// prestada no basta para cambiar quién puede entrar. Va DESPUÉS de JWTProtected y de RequirePermission.
func RequireRecentAuth() fiber.Handler {
	return func(c fiber.Ctx) error {
		sid, _ := c.Locals("session_id").(string)
		if sid != "" && services.Sessions().ReauthRecent(sid, services.ReauthWindow) {
			return c.Next()
		}
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
			"error": "Por seguridad, confirme su contraseña para continuar.",
			"code":  "reauth_required",
		})
	}
}
