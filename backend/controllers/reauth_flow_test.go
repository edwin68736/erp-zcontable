package controllers

import (
	"net/http"
	"testing"
	"time"

	"miappfiber/middleware"
	"miappfiber/models"
	"miappfiber/services"

	"github.com/gofiber/fiber/v3"
	"gorm.io/gorm"
)

func reauthApp(t *testing.T) (*fiber.App, *gorm.DB) {
	t.Helper()
	_, db := setupAuthTest(t)
	services.Authz().InvalidateAll()
	services.Sessions().ResetCache()
	ctrl := NewAuthController()
	app := fiber.New()
	app.Post("/api/login", ctrl.LoginAPI)
	api := app.Group("/api", middleware.JWTProtected())
	api.Post("/me/reauth", ctrl.ReauthAPI)
	api.Post("/me/password", ctrl.ChangePasswordAPI)
	api.Post("/sensible", middleware.RequireRecentAuth(), func(c fiber.Ctx) error { return c.SendString("hecho") })
	api.Get("/normal", func(c fiber.Ctx) error { return c.SendString("ok") })
	return app, db
}

// vencerConfirmacion hace que hayan pasado `ago` desde que la persona escribió su contraseña.
func vencerConfirmacion(db *gorm.DB, ago time.Duration) {
	db.Model(&models.UserSession{}).Where("1 = 1").Update("reauth_at", time.Now().Add(-ago))
	services.Sessions().ResetCache()
}

func TestReauth_unaSesionRecienIniciadaPuedeHacerAccionesSensibles(t *testing.T) {
	app, _ := reauthApp(t)
	tok := loginToken(t, app, "maria", "una-clave-segura-123")
	if code, _ := call(t, app, http.MethodPost, "/api/sensible", tok, "", nil); code != 200 {
		t.Errorf("recién escrita la contraseña: %d", code)
	}
}

func TestReauth_pasadosLosMinutosPideLaContrasenaDeNuevo(t *testing.T) {
	app, db := reauthApp(t)
	tok := loginToken(t, app, "maria", "una-clave-segura-123")
	vencerConfirmacion(db, 6*time.Minute)

	// Lo normal sigue funcionando; lo sensible pide confirmar.
	if code, _ := call(t, app, http.MethodGet, "/api/normal", tok, "", nil); code != 200 {
		t.Fatal("lo normal no pide confirmación")
	}
	code, out := call(t, app, http.MethodPost, "/api/sensible", tok, "", nil)
	if code != 403 || out["code"] != "reauth_required" {
		t.Fatalf("a los 6 min: %d %v", code, out)
	}

	// Contraseña equivocada: no abre la puerta y cuenta como intento fallido.
	if code, _ := call(t, app, http.MethodPost, "/api/me/reauth", tok, `{"password":"otra-cosa"}`, nil); code != 400 {
		t.Errorf("contraseña equivocada: %d", code)
	}
	if code, _ := call(t, app, http.MethodPost, "/api/sensible", tok, "", nil); code != 403 {
		t.Error("sigue pidiendo confirmación")
	}
	var fails int64
	db.Model(&models.AuthEvent{}).Where("type = ?", models.AuthEventLoginFail).Count(&fails)
	if fails != 1 {
		t.Errorf("el error queda en la bitácora: %d", fails)
	}
	// Sin contraseña.
	if code, _ := call(t, app, http.MethodPost, "/api/me/reauth", tok, `{}`, nil); code != 400 {
		t.Errorf("sin contraseña: %d", code)
	}

	// Contraseña correcta: abre la puerta unos minutos.
	code, out = call(t, app, http.MethodPost, "/api/me/reauth", tok, `{"password":"una-clave-segura-123"}`, nil)
	if code != 200 || out["data"].(map[string]any)["valid_seconds"].(float64) != 300 {
		t.Fatalf("confirmar: %d %v", code, out)
	}
	if code, _ := call(t, app, http.MethodPost, "/api/sensible", tok, "", nil); code != 200 {
		t.Error("tras confirmar la contraseña")
	}
	// Y vence otra vez.
	vencerConfirmacion(db, 5*time.Minute+10*time.Second)
	if code, _ := call(t, app, http.MethodPost, "/api/sensible", tok, "", nil); code != 403 {
		t.Error("vuelve a vencer pasados los 5 minutos")
	}
}

func TestReauth_cambiarLaContrasenaTambienCuenta(t *testing.T) {
	app, db := reauthApp(t)
	tok := loginToken(t, app, "maria", "una-clave-segura-123")
	vencerConfirmacion(db, 20*time.Minute)
	if code, _ := call(t, app, http.MethodPost, "/api/me/password", tok, `{"current_password":"una-clave-segura-123","new_password":"NuevaClave-2026-x"}`, nil); code != 200 {
		t.Fatal("cambio de contraseña")
	}
	if code, _ := call(t, app, http.MethodPost, "/api/sensible", tok, "", nil); code != 200 {
		t.Error("acaba de escribir su contraseña")
	}
}

func TestReauth_laConfirmacionEsDeCadaSesion(t *testing.T) {
	app, db := reauthApp(t)
	a := loginToken(t, app, "maria", "una-clave-segura-123")
	b := loginToken(t, app, "maria", "una-clave-segura-123")
	vencerConfirmacion(db, 10*time.Minute)
	if code, _ := call(t, app, http.MethodPost, "/api/me/reauth", a, `{"password":"una-clave-segura-123"}`, nil); code != 200 {
		t.Fatal("confirmar en A")
	}
	if code, _ := call(t, app, http.MethodPost, "/api/sensible", a, "", nil); code != 200 {
		t.Error("A confirmó")
	}
	if code, _ := call(t, app, http.MethodPost, "/api/sensible", b, "", nil); code != 403 {
		t.Error("B no confirmó: una sesión abierta en otro equipo no hereda la confirmación")
	}
}
