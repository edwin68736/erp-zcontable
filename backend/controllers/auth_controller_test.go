package controllers

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"miappfiber/config"
	"miappfiber/database"
	"miappfiber/models"

	"github.com/glebarez/sqlite"
	"github.com/gofiber/fiber/v3"
	"gorm.io/gorm"
)

func setupAuthTest(t *testing.T) (*fiber.App, *gorm.DB) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	sqlDB.SetMaxOpenConns(1)
	if err := db.AutoMigrate(&models.User{}, &models.AuthEvent{}, &models.UserSession{}); err != nil {
		t.Fatal(err)
	}
	database.DB = db
	config.AppConfig = &config.Config{JWTSecret: "secreto-de-prueba"}
	t.Setenv("PASSWORD_BREACH_CHECK", "off") // las pruebas no salen a Internet
	mk := func(username, pw string, active bool) models.User {
		u := models.User{Name: username, Username: username, Active: true}
		_ = u.SetPassword(pw)
		db.Create(&u)
		if !active {
			db.Model(&u).Update("active", false)
		}
		return u
	}
	mk("maria", "una-clave-segura-123", true)
	mk("inactivo", "una-clave-segura-123", false)

	ctrl := NewAuthController()
	app := fiber.New()
	app.Post("/login", ctrl.LoginAPI)
	app.Post("/me/password", func(c fiber.Ctx) error {
		var u models.User
		db.Where("username = ?", "maria").First(&u)
		c.Locals("user_id", u.ID)
		c.Locals("user_username", u.Username)
		return ctrl.ChangePasswordAPI(c)
	})
	app.Get("/security/events", ctrl.SecurityEventsAPI)
	return app, db
}

func post(t *testing.T, app *fiber.App, path, body string, headers map[string]string) (int, map[string]any, http.Header) {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	resp, err := app.Test(req, fiber.TestConfig{Timeout: 10 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	var out map[string]any
	_ = json.Unmarshal(raw, &out)
	return resp.StatusCode, out, resp.Header
}

func TestLogin_respuestaIgualParaUsuarioInexistenteInactivoYClaveMala(t *testing.T) {
	app, db := setupAuthTest(t)
	bodies := map[string]string{
		"clave mala":   `{"username":"maria","password":"mala"}`,
		"no existe":    `{"username":"fantasma","password":"una-clave-segura-123"}`,
		"inactivo":     `{"username":"inactivo","password":"una-clave-segura-123"}`,
		"inactivo+mal": `{"username":"inactivo","password":"mala"}`,
	}
	var first string
	for name, b := range bodies {
		code, out, _ := post(t, app, "/login", b, map[string]string{"X-Forwarded-For": "198.51.100.9"})
		msg, _ := out["error"].(string)
		if code != http.StatusUnauthorized || msg != "credenciales inválidas" || out["token"] != nil {
			t.Errorf("%s: %d %v", name, code, out)
		}
		if first == "" {
			first = msg
		} else if msg != first {
			t.Errorf("%s: el mensaje debía ser idéntico: %q vs %q", name, msg, first)
		}
	}
	// El motivo real queda solo en la bitácora.
	var reasons []string
	db.Model(&models.AuthEvent{}).Where("type = ?", models.AuthEventLoginFail).Pluck("detail", &reasons)
	joined := strings.Join(reasons, "|")
	for _, want := range []string{"contraseña incorrecta", "usuario inexistente", "usuario inactivo"} {
		if !strings.Contains(joined, want) {
			t.Errorf("la bitácora debía registrar %q: %s", want, joined)
		}
	}
}

func TestLogin_correctoDaTokenYQuedaRegistrado(t *testing.T) {
	app, db := setupAuthTest(t)
	code, out, _ := post(t, app, "/login", `{"username":"Maria","password":"una-clave-segura-123"}`, map[string]string{"User-Agent": "Chrome/130", "X-Forwarded-For": "198.51.100.9"})
	if code != 200 || out["token"] == nil || out["user"] == nil {
		t.Fatalf("login: %d %v", code, out)
	}
	if strings.Contains(string(mustJSON(out)), "una-clave-segura-123") || strings.Contains(string(mustJSON(out)), `"password"`) {
		t.Error("la respuesta no debe incluir contraseñas")
	}
	var ev models.AuthEvent
	if err := db.Where("type = ?", models.AuthEventLoginOK).First(&ev).Error; err != nil || ev.Username != "maria" || ev.UserAgent != "Chrome/130" || ev.UserID == 0 {
		t.Errorf("evento login_ok: %+v %v", ev, err)
	}
	if code, _, _ := post(t, app, "/login", `{"username":"","password":"x"}`, nil); code != http.StatusBadRequest {
		t.Errorf("datos vacíos: %d", code)
	}
}

func TestLogin_cincoFallosBloqueanYNoPruebanLaClave(t *testing.T) {
	app, _ := setupAuthTest(t)
	h := map[string]string{"X-Forwarded-For": "198.51.100.9"}
	for i := 0; i < 5; i++ {
		if code, _, _ := post(t, app, "/login", `{"username":"maria","password":"mala"}`, h); code != http.StatusUnauthorized {
			t.Fatalf("intento %d: %d", i+1, code)
		}
	}
	// Ahora hasta la contraseña CORRECTA queda rechazada mientras dure el bloqueo.
	code, out, hdr := post(t, app, "/login", `{"username":"maria","password":"una-clave-segura-123"}`, h)
	msg, _ := out["error"].(string)
	if code != http.StatusTooManyRequests || !strings.Contains(msg, "Demasiados intentos") || out["token"] != nil {
		t.Fatalf("bloqueado: %d %v", code, out)
	}
	if hdr.Get("Retry-After") == "" || out["retry_after"] == nil {
		t.Errorf("debía indicar cuánto esperar: %v %v", hdr, out)
	}
	if !strings.Contains(msg, "15 minutos") {
		t.Errorf("mensaje: %q", msg)
	}
	// Un usuario que NO existe se bloquea igual (no se puede averiguar quién existe).
	for i := 0; i < 5; i++ {
		post(t, app, "/login", `{"username":"fantasma","password":"x"}`, h)
	}
	if code, out, _ := post(t, app, "/login", `{"username":"fantasma","password":"x"}`, h); code != http.StatusTooManyRequests {
		t.Errorf("el usuario inexistente también se bloquea: %d %v", code, out)
	}
	// Otro usuario desde otra IP sigue entrando.
	if code, _, _ := post(t, app, "/login", `{"username":"inactivo","password":"mala"}`, map[string]string{"X-Forwarded-For": "198.51.100.77"}); code != http.StatusUnauthorized {
		t.Errorf("otro usuario no está bloqueado: %d", code)
	}
}

func TestChangePassword(t *testing.T) {
	app, db := setupAuthTest(t)
	h := map[string]string{"X-Forwarded-For": "198.51.100.9"}
	if code, _, _ := post(t, app, "/me/password", `{"current_password":"","new_password":"x"}`, h); code != http.StatusBadRequest {
		t.Errorf("datos incompletos: %d", code)
	}
	code, out, _ := post(t, app, "/me/password", `{"current_password":"mala","new_password":"NuevaClave-2026-x"}`, h)
	if code != http.StatusBadRequest || !strings.Contains(out["error"].(string), "actual") {
		t.Errorf("actual incorrecta: %d %v", code, out)
	}
	code, out, _ = post(t, app, "/me/password", `{"current_password":"una-clave-segura-123","new_password":"ab12"}`, h)
	if code != http.StatusBadRequest || !strings.Contains(out["error"].(string), "6 caracteres") {
		t.Errorf("política: %d %v", code, out)
	}
	code, out, _ = post(t, app, "/me/password", `{"current_password":"una-clave-segura-123","new_password":"NuevaClave-2026-x"}`, h)
	if code != 200 {
		t.Fatalf("cambio correcto: %d %v", code, out)
	}
	if code, _, _ := post(t, app, "/login", `{"username":"maria","password":"NuevaClave-2026-x"}`, h); code != 200 {
		t.Errorf("la nueva contraseña debía servir: %d", code)
	}
	var kinds []string
	db.Model(&models.AuthEvent{}).Where("username = ?", "maria").Pluck("type", &kinds)
	got := strings.Join(kinds, ",")
	if !strings.Contains(got, models.AuthEventPasswordChange) || !strings.Contains(got, models.AuthEventPasswordChangeX) {
		t.Errorf("la bitácora debía registrar el cambio y el intento fallido: %s", got)
	}
	// Adivinar la contraseña actual desde una sesión abierta también se frena.
	for i := 0; i < 6; i++ {
		post(t, app, "/me/password", `{"current_password":"mala","new_password":"OtraClave-2026-yy"}`, h)
	}
	if code, _, _ := post(t, app, "/me/password", `{"current_password":"NuevaClave-2026-x","new_password":"OtraClave-2026-yy"}`, h); code != http.StatusTooManyRequests {
		t.Errorf("tras varios intentos fallidos debía bloquearse: %d", code)
	}
}

func TestSecurityEventsAPI(t *testing.T) {
	app, _ := setupAuthTest(t)
	post(t, app, "/login", `{"username":"maria","password":"una-clave-segura-123"}`, nil)
	post(t, app, "/login", `{"username":"maria","password":"mala"}`, nil)
	req := httptest.NewRequest(http.MethodGet, "/security/events?type=login_fail&username=mar", nil)
	resp, err := app.Test(req, fiber.TestConfig{Timeout: 10 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	var out struct {
		Data struct {
			Total int64 `json:"total"`
			Rows  []struct {
				Type, Username, Detail string
			} `json:"rows"`
		} `json:"data"`
	}
	raw, _ := io.ReadAll(resp.Body)
	_ = json.Unmarshal(raw, &out)
	if resp.StatusCode != 200 || out.Data.Total != 1 || out.Data.Rows[0].Type != "login_fail" || out.Data.Rows[0].Username != "maria" {
		t.Errorf("filtrado: %d %s", resp.StatusCode, raw)
	}
}

func mustJSON(v any) []byte {
	b, _ := json.Marshal(v)
	return b
}
