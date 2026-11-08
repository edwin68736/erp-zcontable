package controllers

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"miappfiber/middleware"
	"miappfiber/models"
	"miappfiber/services"

	"github.com/gofiber/fiber/v3"
	"gorm.io/gorm"
)

// sessionApp arma la API real (login, token, sesiones y cambio de contraseña) sobre una base de prueba.
func sessionApp(t *testing.T) (*fiber.App, *gorm.DB) {
	t.Helper()
	_, db := setupAuthTest(t)
	services.Authz().InvalidateAll()
	ctrl := NewAuthController()
	app := fiber.New()
	app.Post("/api/login", ctrl.LoginAPI)
	api := app.Group("/api", middleware.JWTProtected())
	api.Get("/logout", ctrl.LogoutAPI)
	api.Get("/ok", func(c fiber.Ctx) error { return c.SendString("ok") })
	api.Post("/me/password", ctrl.ChangePasswordAPI)
	api.Get("/me/sessions", ctrl.MySessionsAPI)
	api.Post("/me/sessions/revoke-others", ctrl.RevokeOtherSessionsAPI)
	api.Delete("/me/sessions/:id", ctrl.RevokeSessionAPI)
	api.Post("/users/:id/revoke-sessions", ctrl.AdminRevokeSessionsAPI)
	return app, db
}

func sessionsReset() { services.Sessions().ResetCache() }

func itoa(n uint) string { return strconv.FormatUint(uint64(n), 10) }

func call(t *testing.T, app *fiber.App, method, path, token, body string, headers map[string]string) (int, map[string]any) {
	t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
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
	if out == nil {
		out = map[string]any{"_raw": string(raw)}
	}
	return resp.StatusCode, out
}

func loginToken(t *testing.T, app *fiber.App, user, pw string) string {
	t.Helper()
	code, out := call(t, app, http.MethodPost, "/api/login", "", `{"username":"`+user+`","password":"`+pw+`"}`, nil)
	tok, _ := out["token"].(string)
	if code != 200 || tok == "" {
		t.Fatalf("login de %s: %d %v", user, code, out)
	}
	return tok
}

func TestSesion_cerrarSesionInvalidaElTokenEnElServidor(t *testing.T) {
	app, db := sessionApp(t)
	tok := loginToken(t, app, "maria", "una-clave-segura-123")
	if code, _ := call(t, app, http.MethodGet, "/api/ok", tok, "", nil); code != 200 {
		t.Fatalf("token vigente: %d", code)
	}
	if code, _ := call(t, app, http.MethodGet, "/api/logout", tok, "", nil); code != 200 {
		t.Fatal("logout")
	}
	// El mismo token, aunque alguien lo hubiera copiado, ya no sirve.
	code, out := call(t, app, http.MethodGet, "/api/ok", tok, "", nil)
	if code != 401 || out["code"] != "session_revoked" {
		t.Errorf("después de cerrar sesión: %d %v", code, out)
	}
	var n int64
	db.Model(&models.AuthEvent{}).Where("type = ?", models.AuthEventLogout).Count(&n)
	if n != 1 {
		t.Errorf("el cierre debía quedar en la bitácora: %d", n)
	}
}

func TestSesion_losTokensSinSesionYaNoSirven(t *testing.T) {
	app, db := sessionApp(t)
	var u models.User
	db.Where("username = ?", "maria").First(&u)
	old, err := services.NewAuthService().GenerateToken(&u) // token del sistema anterior: sin «sid»
	if err != nil {
		t.Fatal(err)
	}
	code, out := call(t, app, http.MethodGet, "/api/ok", old, "", nil)
	if code != 401 || out["code"] != "session_missing" {
		t.Errorf("token sin sesión: %d %v", code, out)
	}
}

func TestSesion_inactividadSoloLaMantienenLosUsosReales(t *testing.T) {
	app, db := sessionApp(t)
	tok := loginToken(t, app, "maria", "una-clave-segura-123")
	// Se retrocede la última actividad: 31 minutos sin que la persona haga nada.
	past := time.Now().Add(-31 * time.Minute)
	db.Model(&models.UserSession{}).Where("1 = 1").Update("last_active_at", past)
	// Se descarta la copia en memoria para que se recargue de la base.
	sessionsReset()
	code, out := call(t, app, http.MethodGet, "/api/ok", tok, "", map[string]string{"X-Forwarded-For": "198.51.100.9"})
	if code != 401 || out["code"] != "session_idle" {
		t.Fatalf("31 min sin actividad: %d %v", code, out)
	}
	var n int64
	db.Model(&models.AuthEvent{}).Where("type = ?", models.AuthEventIdleLogout).Count(&n)
	if n != 1 {
		t.Errorf("el cierre por inactividad queda en la bitácora: %d", n)
	}
	// Ya cerrada: no revive aunque la persona vuelva a hacer algo.
	if code, out := call(t, app, http.MethodGet, "/api/ok", tok, "", map[string]string{"X-Client-Active": "1"}); code != 401 || out["code"] != "session_revoked" {
		t.Errorf("una sesión cerrada por inactividad no revive: %d %v", code, out)
	}
}

func TestSesion_laActividadRealRenuevaLaInactividad(t *testing.T) {
	app, db := sessionApp(t)
	tok := loginToken(t, app, "maria", "una-clave-segura-123")
	db.Model(&models.UserSession{}).Where("1 = 1").Update("last_active_at", time.Now().Add(-25*time.Minute))
	sessionsReset()
	// Una consulta automática de la pantalla (sin X-Client-Active) NO renueva; la que trae la cabecera, sí.
	if code, _ := call(t, app, http.MethodGet, "/api/ok", tok, "", nil); code != 200 {
		t.Fatal("a los 25 min todavía vale")
	}
	if code, _ := call(t, app, http.MethodGet, "/api/ok", tok, "", map[string]string{"X-Client-Active": "1"}); code != 200 {
		t.Fatal("con actividad")
	}
	// Con la actividad renovada, 25 minutos más tarde seguiría vigente (no se cierra a los 30 desde el inicio de sesión).
	db.Model(&models.UserSession{}).Where("1 = 1").Update("last_active_at", time.Now().Add(-29*time.Minute))
	sessionsReset()
	if code, _ := call(t, app, http.MethodGet, "/api/ok", tok, "", nil); code != 200 {
		t.Fatal("29 min sin actividad todavía vale")
	}
}

func TestSesion_cerrarEnOtrosEquiposYAlCambiarLaContrasena(t *testing.T) {
	app, _ := sessionApp(t)
	a := loginToken(t, app, "maria", "una-clave-segura-123") // PC 1
	b := loginToken(t, app, "maria", "una-clave-segura-123") // PC 2
	c := loginToken(t, app, "maria", "una-clave-segura-123") // PC 3

	code, out := call(t, app, http.MethodGet, "/api/me/sessions", a, "", nil)
	rows, _ := out["data"].([]any)
	if code != 200 || len(rows) != 3 {
		t.Fatalf("debía listar 3 sesiones: %d %v", code, out)
	}
	marked := 0
	for _, r := range rows {
		if r.(map[string]any)["current"] == true {
			marked++
		}
	}
	if marked != 1 {
		t.Errorf("solo una va marcada como la actual: %d", marked)
	}

	if code, out := call(t, app, http.MethodPost, "/api/me/sessions/revoke-others", a, "", nil); code != 200 || out["data"].(map[string]any)["closed"].(float64) != 2 {
		t.Fatalf("cerrar las otras: %d %v", code, out)
	}
	for name, tok := range map[string]string{"PC 2": b, "PC 3": c} {
		if code, _ := call(t, app, http.MethodGet, "/api/ok", tok, "", nil); code != 401 {
			t.Errorf("%s debía quedar cerrada: %d", name, code)
		}
	}
	if code, _ := call(t, app, http.MethodGet, "/api/ok", a, "", nil); code != 200 {
		t.Error("la sesión que pidió cerrar las demás sigue abierta")
	}

	// Al cambiar la contraseña también se cierran las otras (alguien más pudo tener la anterior).
	d := loginToken(t, app, "maria", "una-clave-segura-123")
	if code, _ := call(t, app, http.MethodPost, "/api/me/password", a, `{"current_password":"una-clave-segura-123","new_password":"NuevaClave-2026-x"}`, nil); code != 200 {
		t.Fatal("cambio de contraseña")
	}
	if code, _ := call(t, app, http.MethodGet, "/api/ok", d, "", nil); code != 401 {
		t.Errorf("la otra sesión debía cerrarse al cambiar la contraseña: %d", code)
	}
	if code, _ := call(t, app, http.MethodGet, "/api/ok", a, "", nil); code != 200 {
		t.Error("la sesión de quien cambió la contraseña sigue")
	}
}

func TestSesion_unAdministradorCierraLasSesionesDeUnUsuario(t *testing.T) {
	app, db := sessionApp(t)
	var u models.User
	db.Where("username = ?", "maria").First(&u)
	tok := loginToken(t, app, "maria", "una-clave-segura-123")
	adminTok := tok // el endpoint de prueba no exige permisos: lo que se comprueba es el efecto
	code, out := call(t, app, http.MethodPost, "/api/users/"+itoa(u.ID)+"/revoke-sessions", adminTok, "", nil)
	if code != 200 || out["data"].(map[string]any)["closed"].(float64) != 1 {
		t.Fatalf("cerrar sesiones del usuario: %d %v", code, out)
	}
	if code, _ := call(t, app, http.MethodGet, "/api/ok", tok, "", nil); code != 401 {
		t.Errorf("tras cerrar las sesiones del usuario: %d", code)
	}
}

func TestSesion_contrasenaPuestaPorUnAdminObligaACambiarla(t *testing.T) {
	app, db := sessionApp(t)
	db.Model(&models.User{}).Where("username = ?", "maria").Update("must_change_password", true)
	services.Authz().InvalidateAll()

	code, out := call(t, app, http.MethodPost, "/api/login", "", `{"username":"maria","password":"una-clave-segura-123"}`, nil)
	tok, _ := out["token"].(string)
	if code != 200 || out["must_change_password"] != true || tok == "" {
		t.Fatalf("el login avisa que debe cambiarla: %d %v", code, out)
	}
	// Mientras tanto no puede usar el sistema...
	code, out = call(t, app, http.MethodGet, "/api/ok", tok, "", nil)
	if code != 403 || out["code"] != "password_change_required" {
		t.Errorf("bloqueado hasta cambiarla: %d %v", code, out)
	}
	// ...pero sí ver sus sesiones y cambiar la contraseña.
	if code, _ := call(t, app, http.MethodGet, "/api/me/sessions", tok, "", nil); code != 200 {
		t.Errorf("/me/ está permitido: %d", code)
	}
	if code, _ := call(t, app, http.MethodPost, "/api/me/password", tok, `{"current_password":"una-clave-segura-123","new_password":"NuevaClave-2026-x"}`, nil); code != 200 {
		t.Fatal("cambio de contraseña")
	}
	services.Authz().InvalidateAll()
	if code, _ := call(t, app, http.MethodGet, "/api/ok", tok, "", nil); code != 200 {
		t.Errorf("tras cambiarla ya puede usar el sistema: %d", code)
	}
	if code, _ := call(t, app, http.MethodGet, "/api/logout", tok, "", nil); code != 200 {
		t.Error("cerrar sesión siempre se puede")
	}
}
