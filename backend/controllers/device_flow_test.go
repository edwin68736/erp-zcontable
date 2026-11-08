package controllers

import (
	"net/http"
	"strings"
	"testing"
	"time"

	"miappfiber/middleware"
	"miappfiber/models"
	"miappfiber/services"

	"github.com/gofiber/fiber/v3"
	"gorm.io/gorm"
)

const (
	devA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	devB = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
	devC = "cccccccccccccccccccccccccccccccccccccccccccccccc"
	devD = "dddddddddddddddddddddddddddddddddddddddddddddddd"
	pass = "una-clave-segura-123"
)

// deviceApp arma la API real de dispositivos (login, verificación, aprobaciones, mi cuenta y administración).
func deviceApp(t *testing.T) (*fiber.App, *gorm.DB) {
	t.Helper()
	_, db := setupAuthTest(t)
	if err := db.AutoMigrate(&models.SecuritySetting{}, &models.UserDevice{}, &models.LoginChallenge{}, &models.UserTOTP{}); err != nil {
		t.Fatal(err)
	}
	t.Setenv("APP_ENCRYPTION_KEY", "")
	admin := models.User{Name: "ana", Username: "ana", Active: true}
	_ = admin.SetPassword(pass)
	db.Create(&admin)
	services.Authz().InvalidateAll()
	services.Sessions().ResetCache()

	auth, dev := NewAuthController(), NewDeviceController()
	app := fiber.New()
	app.Post("/api/login", auth.LoginAPI)
	app.Post("/api/login/verify", dev.VerifyAPI)
	app.Post("/api/login/approval", dev.RequestApprovalAPI)
	app.Get("/api/login/challenge/:id", dev.ChallengeStatusAPI)
	app.Post("/api/login/complete", dev.CompleteAPI)
	api := app.Group("/api", middleware.JWTProtected())
	api.Get("/ok", func(c fiber.Ctx) error { return c.SendString("ok") })
	api.Get("/me/devices", dev.MyDevicesAPI)
	api.Delete("/me/devices/:id", dev.RevokeMyDeviceAPI)
	api.Get("/me/totp", dev.MyTOTPAPI)
	api.Post("/me/totp/setup", dev.TOTPSetupAPI)
	api.Post("/me/totp/enable", dev.TOTPEnableAPI)
	api.Post("/me/totp/disable", dev.TOTPDisableAPI)
	api.Get("/security/settings", dev.SettingsAPI)
	api.Put("/security/settings", dev.UpdateSettingsAPI)
	api.Get("/security/approvals", dev.PendingApprovalsAPI)
	api.Post("/security/approvals/:id/approve", dev.ApproveAPI)
	api.Post("/security/approvals/:id/deny", dev.DenyAPI)
	api.Get("/security/users/:id/devices", dev.UserDevicesAPI)
	api.Delete("/security/devices/:id", dev.RevokeDeviceAPI)
	api.Post("/security/users/:id/reset", dev.ResetUserAPI)
	return app, db
}

func loginWith(t *testing.T, app *fiber.App, user, device string, extra string) (int, map[string]any) {
	t.Helper()
	body := `{"username":"` + user + `","password":"` + pass + `","device_token":"` + device + `"` + extra + `}`
	return call(t, app, http.MethodPost, "/api/login", "", body, nil)
}

func tokenOf(t *testing.T, out map[string]any) string {
	t.Helper()
	tok, _ := out["token"].(string)
	if tok == "" {
		t.Fatalf("se esperaba un token: %v", out)
	}
	return tok
}

// enrollTOTP activa la verificación en dos pasos de quien tiene el token y devuelve el secreto y los códigos de recuperación.
func enrollTOTP(t *testing.T, app *fiber.App, tok string) (string, []string) {
	t.Helper()
	code, out := call(t, app, http.MethodPost, "/api/me/totp/setup", tok, "", nil)
	if code != 200 {
		t.Fatalf("setup: %d %v", code, out)
	}
	secret := out["data"].(map[string]any)["secret"].(string)
	code, out = call(t, app, http.MethodPost, "/api/me/totp/enable", tok, `{"code":"`+services.TOTPCodeAt(secret, time.Now())+`"}`, nil)
	if code != 200 {
		t.Fatalf("enable: %d %v", code, out)
	}
	var rec []string
	for _, c := range out["data"].(map[string]any)["recovery_codes"].([]any) {
		rec = append(rec, c.(string))
	}
	if len(rec) != 8 {
		t.Fatalf("8 códigos de recuperación: %d", len(rec))
	}
	return secret, rec
}

func setMode(t *testing.T, app *fiber.App, adminTok, mode string) {
	t.Helper()
	code, out := call(t, app, http.MethodPut, "/api/security/settings", adminTok, `{"device_trust_mode":"`+mode+`","device_trust_days":30}`, nil)
	if code != 200 {
		t.Fatalf("modo %s: %d %v", mode, code, out)
	}
}

func idOfUser(db *gorm.DB, name string) uint {
	var u models.User
	db.Where("username = ?", name).First(&u)
	return u.ID
}

func TestDispositivos_porDefectoNoCambiaNadaYAprendeElEquipo(t *testing.T) {
	app, _ := deviceApp(t)
	code, out := loginWith(t, app, "maria", devA, "")
	tok := tokenOf(t, out)
	if code != 200 {
		t.Fatalf("login: %d %v", code, out)
	}
	// El equipo quedó registrado en silencio y se ve en «Mis dispositivos», marcado como el actual.
	code, out = call(t, app, http.MethodGet, "/api/me/devices", tok, "", nil)
	rows, _ := out["data"].([]any)
	if code != 200 || len(rows) != 1 || rows[0].(map[string]any)["current"] != true {
		t.Fatalf("mis dispositivos: %d %v", code, out)
	}
	// Sin identificador de equipo (navegador viejo o cliente sin soporte) también entra.
	if code, _ := loginWith(t, app, "maria", "", ""); code != 200 {
		t.Error("sin identificador entra igual en aprendizaje")
	}
}

func TestDispositivos_equipoNuevoConCodigoDeLaAppYConfiarEnElEquipo(t *testing.T) {
	app, _ := deviceApp(t)
	_, out := loginWith(t, app, "ana", devA, "")
	adminTok := tokenOf(t, out)
	_, out = loginWith(t, app, "maria", devA, "")
	mariaTok := tokenOf(t, out)
	secret, recovery := enrollTOTP(t, app, mariaTok)
	setMode(t, app, adminTok, models.DeviceTrustEnforce)

	// Equipo conocido: entra directo.
	if code, out := loginWith(t, app, "maria", devA, ""); code != 200 {
		t.Fatalf("equipo conocido: %d %v", code, out)
	}
	// Equipo nuevo: 202 con la verificación pendiente; todavía no hay token.
	code, out := loginWith(t, app, "maria", devC, "")
	id, _ := out["challenge_id"].(string)
	methods, _ := out["methods"].(map[string]any)
	if code != 202 || id == "" || out["token"] != nil || methods["totp"] != true || methods["approval"] != true {
		t.Fatalf("equipo nuevo: %d %v", code, out)
	}
	// La contraseña correcta sola no basta: sin el código no se puede usar el sistema.
	if code, _ := call(t, app, http.MethodPost, "/api/login/verify", "", `{"challenge_id":"`+id+`","code":"111111","device_token":"`+devC+`"}`, nil); code != 401 {
		t.Errorf("código equivocado: %d", code)
	}
	// Código correcto (el del paso siguiente: el actual ya se usó al activar la verificación).
	good := services.TOTPCodeAt(secret, time.Now().Add(30*time.Second))
	code, out = call(t, app, http.MethodPost, "/api/login/verify", "", `{"challenge_id":"`+id+`","code":"`+good+`","device_token":"`+devC+`"}`, nil)
	tok := tokenOf(t, out)
	if code != 200 {
		t.Fatalf("verificado: %d %v", code, out)
	}
	if code, _ := call(t, app, http.MethodGet, "/api/ok", tok, "", nil); code != 200 {
		t.Error("la sesión verificada funciona")
	}
	// El equipo quedó de confianza: el siguiente login desde él ya no pide nada.
	if code, _ := loginWith(t, app, "maria", devC, ""); code != 200 {
		t.Errorf("equipo de confianza: %d", code)
	}
	// La verificación usada no se repite.
	if code, _ := call(t, app, http.MethodPost, "/api/login/verify", "", `{"challenge_id":"`+id+`","code":"`+good+`","device_token":"`+devC+`"}`, nil); code != 401 {
		t.Errorf("verificación ya usada: %d", code)
	}

	// Con un código de recuperación (celular perdido) y SIN «confiar en este equipo»: entra pero no queda registrado.
	code, out = loginWith(t, app, "maria", devD, `,"remember":false`)
	id2, _ := out["challenge_id"].(string)
	if code != 202 {
		t.Fatalf("otro equipo nuevo: %d %v", code, out)
	}
	code, out = call(t, app, http.MethodPost, "/api/login/verify", "", `{"challenge_id":"`+id2+`","code":"`+strings.ToUpper(recovery[0])+`","device_token":"`+devD+`"}`, nil)
	if code != 200 {
		t.Fatalf("código de recuperación: %d %v", code, out)
	}
	if code, _ := loginWith(t, app, "maria", devD, `,"remember":false`); code != 202 {
		t.Errorf("sin «confiar» vuelve a pedir verificación: %d", code)
	}
}

func TestDispositivos_aprobacionDelAdministrador(t *testing.T) {
	app, db := deviceApp(t)
	_, out := loginWith(t, app, "ana", devA, "")
	adminTok := tokenOf(t, out)
	_, out = loginWith(t, app, "maria", devA, "")
	mariaTok := tokenOf(t, out)
	setMode(t, app, adminTok, models.DeviceTrustEnforce)

	code, out := loginWith(t, app, "maria", devB, "")
	id, _ := out["challenge_id"].(string)
	if code != 202 {
		t.Fatalf("equipo nuevo: %d %v", code, out)
	}
	// Sin pedir aprobación no hay nada que aprobar.
	if code, _ := call(t, app, http.MethodPost, "/api/security/approvals/"+id+"/approve", adminTok, "", nil); code != 400 {
		t.Errorf("aprobar algo no solicitado: %d", code)
	}
	if code, out := call(t, app, http.MethodPost, "/api/login/approval", "", `{"challenge_id":"`+id+`"}`, nil); code != 200 || out["status"] != models.ChallengePending {
		t.Fatalf("pedir aprobación: %d %v", code, out)
	}
	// Mientras nadie apruebe, no puede terminar de entrar.
	if code, _ := call(t, app, http.MethodPost, "/api/login/complete", "", `{"challenge_id":"`+id+`","device_token":"`+devB+`"}`, nil); code != 409 {
		t.Errorf("complete sin aprobar: %d", code)
	}
	// El administrador la ve en su lista.
	code, out = call(t, app, http.MethodGet, "/api/security/approvals", adminTok, "", nil)
	list, _ := out["data"].([]any)
	if code != 200 || len(list) != 1 || list[0].(map[string]any)["username"] != "maria" {
		t.Fatalf("lista de aprobaciones: %d %v", code, out)
	}
	// Nadie aprueba su propio equipo (María con sesión abierta en otro equipo ya conocido).
	if code, out := call(t, app, http.MethodPost, "/api/security/approvals/"+id+"/approve", mariaTok, "", nil); code != 400 {
		t.Errorf("auto-aprobación: %d %v", code, out)
	}
	if code, out := call(t, app, http.MethodPost, "/api/security/approvals/"+id+"/approve", adminTok, "", nil); code != 200 {
		t.Fatalf("aprobar: %d %v", code, out)
	}
	if code, out := call(t, app, http.MethodGet, "/api/login/challenge/"+id, "", "", nil); code != 200 || out["status"] != models.ChallengeApproved {
		t.Errorf("estado aprobado: %d %v", code, out)
	}
	code, out = call(t, app, http.MethodPost, "/api/login/complete", "", `{"challenge_id":"`+id+`","device_token":"`+devB+`"}`, nil)
	tok := tokenOf(t, out)
	if code != 200 {
		t.Fatalf("terminar de entrar: %d %v", code, out)
	}
	if code, _ := call(t, app, http.MethodGet, "/api/ok", tok, "", nil); code != 200 {
		t.Error("sesión aprobada")
	}
	if code, _ := call(t, app, http.MethodPost, "/api/login/complete", "", `{"challenge_id":"`+id+`","device_token":"`+devB+`"}`, nil); code == 200 {
		t.Error("una aprobación sirve una sola vez")
	}
	if code, _ := loginWith(t, app, "maria", devB, ""); code != 200 {
		t.Error("el equipo aprobado queda de confianza")
	}

	// Rechazada: no entra.
	_, out = loginWith(t, app, "maria", devD, "")
	id2, _ := out["challenge_id"].(string)
	call(t, app, http.MethodPost, "/api/login/approval", "", `{"challenge_id":"`+id2+`"}`, nil)
	if code, _ := call(t, app, http.MethodPost, "/api/security/approvals/"+id2+"/deny", adminTok, "", nil); code != 200 {
		t.Fatal("rechazar")
	}
	if code, _ := call(t, app, http.MethodPost, "/api/login/complete", "", `{"challenge_id":"`+id2+`","device_token":"`+devD+`"}`, nil); code == 200 {
		t.Error("un equipo rechazado no entra")
	}
	// Todo queda en la bitácora.
	for _, typ := range []string{models.AuthEventDeviceChallenge, models.AuthEventApprovalRequested, models.AuthEventDeviceApproved, models.AuthEventDeviceDenied, models.AuthEventDeviceVerified, models.AuthEventSettingsChanged} {
		var n int64
		db.Model(&models.AuthEvent{}).Where("type = ?", typ).Count(&n)
		if n == 0 {
			t.Errorf("falta en la bitácora: %s", typ)
		}
	}
}

func TestDispositivos_cincoCodigosEquivocadosAnulanLaVerificacionYContarComoFallos(t *testing.T) {
	app, db := deviceApp(t)
	_, out := loginWith(t, app, "ana", devA, "")
	adminTok := tokenOf(t, out)
	_, out = loginWith(t, app, "maria", devA, "")
	secret, _ := enrollTOTP(t, app, tokenOf(t, out))
	setMode(t, app, adminTok, models.DeviceTrustEnforce)

	_, out = loginWith(t, app, "maria", devB, "")
	id, _ := out["challenge_id"].(string)
	for i := 0; i < 5; i++ {
		if code, _ := call(t, app, http.MethodPost, "/api/login/verify", "", `{"challenge_id":"`+id+`","code":"000000","device_token":"`+devB+`"}`, nil); code != 401 {
			t.Fatalf("intento %d: %d", i+1, code)
		}
	}
	// Ni el código correcto sirve ya: hay que volver a iniciar sesión.
	good := services.TOTPCodeAt(secret, time.Now().Add(30*time.Second))
	if code, _ := call(t, app, http.MethodPost, "/api/login/verify", "", `{"challenge_id":"`+id+`","code":"`+good+`","device_token":"`+devB+`"}`, nil); code == 200 {
		t.Error("la verificación quedó anulada")
	}
	var fails int64
	db.Model(&models.AuthEvent{}).Where("type = ?", models.AuthEventLoginFail).Count(&fails)
	if fails < 5 {
		t.Errorf("cada código equivocado cuenta como intento fallido: %d", fails)
	}
}

func TestDispositivos_revocarCierraLaSesionYReiniciarDejaAlUsuarioLimpio(t *testing.T) {
	app, db := deviceApp(t)
	_, out := loginWith(t, app, "ana", devA, "")
	adminTok := tokenOf(t, out)
	_, out = loginWith(t, app, "maria", devB, "")
	mariaTok := tokenOf(t, out)
	secret, _ := enrollTOTP(t, app, mariaTok)
	_ = secret

	// María quita su propio equipo: la sesión abierta desde él se cierra.
	_, out = call(t, app, http.MethodGet, "/api/me/devices", mariaTok, "", nil)
	rows := out["data"].([]any)
	devID := uint(rows[0].(map[string]any)["id"].(float64))
	if code, _ := call(t, app, http.MethodDelete, "/api/me/devices/"+itoa(devID), mariaTok, "", nil); code != 200 {
		t.Fatal("quitar equipo")
	}
	if code, _ := call(t, app, http.MethodGet, "/api/ok", mariaTok, "", nil); code != 401 {
		t.Errorf("la sesión del equipo quitado se cierra: %d", code)
	}
	// Nadie puede quitar el equipo de otra persona por la ruta de «Mi cuenta».
	_, out = call(t, app, http.MethodGet, "/api/me/devices", adminTok, "", nil)
	adminDev := uint(out["data"].([]any)[0].(map[string]any)["id"].(float64))
	_, out = loginWith(t, app, "maria", devC, "")
	mariaTok = tokenOf(t, out)
	if code, _ := call(t, app, http.MethodDelete, "/api/me/devices/"+itoa(adminDev), mariaTok, "", nil); code != 404 {
		t.Errorf("equipo ajeno: %d", code)
	}

	// Desactivar la verificación pide la contraseña.
	if code, _ := call(t, app, http.MethodPost, "/api/me/totp/disable", mariaTok, `{"password":"otra-cosa"}`, nil); code != 400 {
		t.Errorf("contraseña incorrecta: %d", code)
	}
	if code, out := call(t, app, http.MethodGet, "/api/me/totp", mariaTok, "", nil); code != 200 || out["data"].(map[string]any)["enabled"] != true {
		t.Errorf("sigue activada: %v", out)
	}
	if code, _ := call(t, app, http.MethodPost, "/api/me/totp/disable", mariaTok, `{"password":"`+pass+`"}`, nil); code != 200 {
		t.Error("desactivar con la contraseña")
	}

	// El administrador la deja sin verificación, sin equipos y sin sesiones.
	enrollTOTP(t, app, mariaTok)
	mid := idOfUser(db, "maria")
	code, out := call(t, app, http.MethodGet, "/api/security/users/"+itoa(mid)+"/devices", adminTok, "", nil)
	if code != 200 || out["totp"].(map[string]any)["enabled"] != true || len(out["data"].([]any)) == 0 {
		t.Fatalf("equipos del usuario: %d %v", code, out)
	}
	if code, _ := call(t, app, http.MethodPost, "/api/security/users/"+itoa(mid)+"/reset", adminTok, "", nil); code != 200 {
		t.Fatal("reiniciar")
	}
	if code, _ := call(t, app, http.MethodGet, "/api/ok", mariaTok, "", nil); code != 401 {
		t.Errorf("sin sesiones tras el reinicio: %d", code)
	}
	code, out = call(t, app, http.MethodGet, "/api/security/users/"+itoa(mid)+"/devices", adminTok, "", nil)
	if len(out["data"].([]any)) != 0 || out["totp"].(map[string]any)["enabled"] != false {
		t.Errorf("usuario limpio: %v", out)
	}
}

func TestDispositivos_configuracion(t *testing.T) {
	app, _ := deviceApp(t)
	_, out := loginWith(t, app, "ana", devA, "")
	adminTok := tokenOf(t, out)

	code, out := call(t, app, http.MethodGet, "/api/security/settings", adminTok, "", nil)
	d := out["data"].(map[string]any)
	if code != 200 || d["device_trust_mode"] != "learn" || d["device_trust_days"].(float64) != 30 || d["effective_mode"] != "learn" {
		t.Fatalf("por defecto: %d %v", code, out)
	}
	for _, bad := range []string{
		`{"device_trust_mode":"otro","device_trust_days":30}`,
		`{"device_trust_mode":"enforce","device_trust_days":0}`,
		`{"device_trust_mode":"enforce","device_trust_days":999}`,
		`{"device_trust_mode":"learn","device_trust_days":30,"enforce_from":"mañana"}`,
	} {
		if code, _ := call(t, app, http.MethodPut, "/api/security/settings", adminTok, bad, nil); code != 400 {
			t.Errorf("%s debía rechazarse: %d", bad, code)
		}
	}
	// Fecha programada: aprendizaje hoy, exigir desde ayer ⇒ ya rige enforce.
	yesterday := time.Now().AddDate(0, 0, -1).Format("2006-01-02")
	code, out = call(t, app, http.MethodPut, "/api/security/settings", adminTok, `{"device_trust_mode":"learn","device_trust_days":15,"enforce_from":"`+yesterday+`"}`, nil)
	d = out["data"].(map[string]any)
	if code != 200 || d["effective_mode"] != "enforce" || d["device_trust_mode"] != "learn" || d["device_trust_days"].(float64) != 15 {
		t.Fatalf("fecha programada: %d %v", code, out)
	}
}
