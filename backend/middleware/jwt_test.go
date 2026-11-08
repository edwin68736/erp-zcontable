package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"miappfiber/config"
	"miappfiber/database"
	"miappfiber/models"
	"miappfiber/services"

	"github.com/glebarez/sqlite"
	"github.com/gofiber/fiber/v3"
	"gorm.io/gorm"
)

func jwtTestApp(t *testing.T) (*fiber.App, *gorm.DB, string, uint) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	sqlDB.SetMaxOpenConns(1)
	if err := db.AutoMigrate(&models.User{}); err != nil {
		t.Fatal(err)
	}
	database.DB = db
	config.AppConfig = &config.Config{JWTSecret: "secreto-de-prueba"}
	u := models.User{Name: "Maria", Username: "maria", Active: true}
	_ = u.SetPassword("una-clave-segura-123")
	db.Create(&u)
	token, err := services.NewAuthService().GenerateToken(&u)
	if err != nil {
		t.Fatal(err)
	}
	services.Authz().InvalidateAll()
	app := fiber.New()
	app.Use(JWTProtected())
	app.Get("/ok", func(c fiber.Ctx) error { return c.SendString("ok") })
	return app, db, token, u.ID
}

func get(t *testing.T, app *fiber.App, token string) (int, string) {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/ok", nil)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	buf := make([]byte, 200)
	n, _ := resp.Body.Read(buf)
	return resp.StatusCode, string(buf[:n])
}

func TestJWTProtected_tokenValidoDeUsuarioActivo(t *testing.T) {
	app, _, token, _ := jwtTestApp(t)
	if code, _ := get(t, app, token); code != 200 {
		t.Errorf("token válido: %d", code)
	}
	if code, _ := get(t, app, ""); code != 401 {
		t.Errorf("sin token: %d", code)
	}
	if code, _ := get(t, app, token+"x"); code != 401 {
		t.Errorf("token alterado: %d", code)
	}
}

func TestJWTProtected_unUsuarioDesactivadoOEliminadoPierdeElAccesoAunConToken(t *testing.T) {
	app, db, token, id := jwtTestApp(t)
	if code, _ := get(t, app, token); code != 200 {
		t.Fatalf("antes de desactivar: %d", code)
	}
	// Se desactiva (el servicio de usuarios invalida la caché al editar).
	db.Model(&models.User{}).Where("id = ?", id).Update("active", false)
	services.Authz().InvalidateUser(id)
	if code, body := get(t, app, token); code != 401 || body == "ok" {
		t.Errorf("usuario inactivo con token vigente debía rechazarse: %d %s", code, body)
	}
	// Se reactiva.
	db.Model(&models.User{}).Where("id = ?", id).Update("active", true)
	services.Authz().InvalidateUser(id)
	if code, _ := get(t, app, token); code != 200 {
		t.Errorf("reactivado: %d", code)
	}
	// Se elimina (borrado lógico).
	db.Delete(&models.User{}, id)
	services.Authz().InvalidateUser(id)
	if code, _ := get(t, app, token); code != 401 {
		t.Errorf("usuario eliminado: %d", code)
	}
}

func TestSecurityHeaders(t *testing.T) {
	app := fiber.New()
	app.Use(SecurityHeaders())
	app.Use("/storage", StorageHeaders())
	app.Get("/api/x", func(c fiber.Ctx) error { return c.SendString("x") })
	app.Get("/storage/*", func(c fiber.Ctx) error { return c.SendString("contenido") })

	resp, _ := app.Test(httptest.NewRequest(http.MethodGet, "/api/x", nil))
	if resp.Header.Get("X-Content-Type-Options") != "nosniff" || resp.Header.Get("X-Frame-Options") != "DENY" || resp.Header.Get("Referrer-Policy") == "" {
		t.Errorf("cabeceras de la API: %v", resp.Header)
	}
	// Lo ejecutable se fuerza a descarga y se aísla.
	for _, f := range []string{"a.html", "b.SVG", "c.xml", "d.js"} {
		resp, _ = app.Test(httptest.NewRequest(http.MethodGet, "/storage/payments/"+f, nil))
		csp := resp.Header.Get("Content-Security-Policy")
		if !contains(csp, "sandbox") || !contains(csp, "default-src 'none'") || resp.Header.Get("Content-Disposition") != "attachment" || resp.Header.Get("X-Content-Type-Options") != "nosniff" {
			t.Errorf("%s debía quedar aislado: %v", f, resp.Header)
		}
	}
	// Imágenes y PDF se sirven normal: con sandbox el visor de PDF de Chrome no abre.
	for _, f := range []string{"a.pdf", "b.png", "c.jpg", "logo_abc.PNG"} {
		resp, _ = app.Test(httptest.NewRequest(http.MethodGet, "/storage/firm/"+f, nil))
		if resp.Header.Get("Content-Security-Policy") != "" || resp.Header.Get("Content-Disposition") != "" || resp.Header.Get("X-Content-Type-Options") != "nosniff" {
			t.Errorf("%s no debía llevar sandbox ni forzar descarga: %v", f, resp.Header)
		}
	}
}

func contains(s, sub string) bool {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}
