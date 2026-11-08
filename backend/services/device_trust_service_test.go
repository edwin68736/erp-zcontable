package services

import (
	"errors"
	"strings"
	"testing"
	"time"

	"miappfiber/config"
	"miappfiber/database"
	"miappfiber/models"
)

const (
	tokA  = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" // identificador de un navegador
	tokB  = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
	uaWin = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36"
)

type deviceEnv struct {
	svc          *DeviceTrustService
	now          *time.Time
	maria, pedro models.User
}

func newDeviceEnv(t *testing.T, mode string) *deviceEnv {
	t.Helper()
	db := setupCompanyRucTestDB(t)
	if err := db.AutoMigrate(&models.User{}, &models.AuthEvent{}, &models.UserSession{}, &models.SecuritySetting{}, &models.UserDevice{}, &models.LoginChallenge{}, &models.UserTOTP{}); err != nil {
		t.Fatal(err)
	}
	config.AppConfig = &config.Config{JWTSecret: "secreto-de-prueba-largo-largo-largo-123"}
	t.Setenv("APP_ENCRYPTION_KEY", "")
	env := &deviceEnv{svc: NewDeviceTrustService()}
	now := time.Date(2026, 11, 8, 10, 0, 0, 0, time.UTC)
	env.now = &now
	env.svc.now = func() time.Time { return *env.now }
	env.svc.events.now = env.svc.now
	mk := func(name string) models.User {
		u := models.User{Name: name, Username: name, Active: true}
		_ = u.SetPassword("una-clave-segura-123")
		db.Create(&u)
		return u
	}
	env.maria, env.pedro = mk("maria"), mk("pedro")
	if _, err := env.svc.UpdateSettings(mode, 30, nil); err != nil {
		t.Fatal(err)
	}
	return env
}

func TestDeviceToken(t *testing.T) {
	if !ValidDeviceToken(tokA) || !ValidDeviceToken(strings.Repeat("aB3_-", 10)) {
		t.Error("un identificador de 32 a 128 caracteres seguros es válido")
	}
	for _, bad := range []string{"", "corto", strings.Repeat("a", 31), strings.Repeat("a", 129), strings.Repeat("a", 31) + "!", strings.Repeat("a", 31) + " "} {
		if ValidDeviceToken(bad) {
			t.Errorf("%q no debía ser válido", bad)
		}
	}
	if h := HashDeviceToken(tokA); len(h) != 64 || strings.Contains(h, tokA) || h != HashDeviceToken(tokA) || h == HashDeviceToken(tokB) {
		t.Errorf("la huella es estable, distinta por equipo y no contiene el identificador: %s", h)
	}
}

func TestDescribeUserAgent(t *testing.T) {
	cases := map[string]string{
		uaWin: "Chrome · Windows",
		"Mozilla/5.0 (Windows NT 10.0) Chrome/130 Safari/537 Edg/130":       "Edge · Windows",
		"Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko Firefox/130.0":     "Firefox · Linux",
		"Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604": "Safari · iOS",
		"curl/8.0": "Navegador",
		"":         "Navegador desconocido",
	}
	for ua, want := range cases {
		if got := DescribeUserAgent(ua); got != want {
			t.Errorf("%q → %q, quería %q", ua, got, want)
		}
	}
}

func TestSettings_porDefectoYValidacion(t *testing.T) {
	env := newDeviceEnv(t, models.DeviceTrustLearn)
	database.DB.Where("1 = 1").Delete(&models.SecuritySetting{})
	set, err := env.svc.Settings()
	if err != nil || set.DeviceTrustMode != models.DeviceTrustLearn || set.DeviceTrustDays != 30 || set.EnforceFrom != nil {
		t.Fatalf("por defecto: modo aprendizaje, 30 días, sin fecha: %+v %v", set, err)
	}
	for _, c := range []struct {
		mode string
		days int
	}{{"otro", 30}, {"learn", 0}, {"learn", 181}, {"", 30}} {
		if _, err := env.svc.UpdateSettings(c.mode, c.days, nil); err == nil {
			t.Errorf("%+v debía rechazarse", c)
		}
	}
	// La fecha programada pasa solo de learn a enforce.
	from := env.now.Add(24 * time.Hour)
	set, _ = env.svc.UpdateSettings(models.DeviceTrustLearn, 30, &from)
	if env.svc.EffectiveMode(set) != models.DeviceTrustLearn {
		t.Error("antes de la fecha rige learn")
	}
	*env.now = env.now.Add(25 * time.Hour)
	if env.svc.EffectiveMode(set) != models.DeviceTrustEnforce {
		t.Error("llegada la fecha rige enforce")
	}
	// En otros modos la fecha no se guarda.
	set, _ = env.svc.UpdateSettings(models.DeviceTrustEnforce, 10, &from)
	if set.EnforceFrom != nil || env.svc.EffectiveMode(set) != models.DeviceTrustEnforce {
		t.Errorf("enforce sin fecha: %+v", set)
	}
}

func TestDecide_modoOffYAprendizaje(t *testing.T) {
	env := newDeviceEnv(t, models.DeviceTrustOff)
	d, err := env.svc.Decide(&env.maria, tokA, uaWin, "1.1.1.1", true)
	if err != nil || d.Challenge != nil || d.Device != nil {
		t.Fatalf("modo off no hace nada: %+v %v", d, err)
	}

	env.svc.UpdateSettings(models.DeviceTrustLearn, 30, nil)
	d, _ = env.svc.Decide(&env.maria, tokA, uaWin, "1.1.1.1", true)
	if d.Challenge != nil || d.Device == nil || !d.NewDevice || d.Device.TrustedUntil == nil || d.Device.Via != models.DeviceViaLearn || d.Device.Label != "Chrome · Windows" {
		t.Fatalf("en aprendizaje el equipo nuevo se registra sin pedir nada: %+v", d)
	}
	if want := env.now.Add(30 * 24 * time.Hour); !d.Device.TrustedUntil.Equal(want) {
		t.Errorf("30 días de confianza: %v", d.Device.TrustedUntil)
	}
	// La segunda vez ya es conocido.
	if d2, _ := env.svc.Decide(&env.maria, tokA, uaWin, "1.1.1.2", true); d2.NewDevice || d2.Device == nil || d2.Device.ID != d.Device.ID {
		t.Errorf("segunda vez: %+v", d2)
	}
	// Sin «recordar», o sin identificador: entra pero no queda registrado.
	if d3, _ := env.svc.Decide(&env.maria, tokB, uaWin, "1.1.1.1", false); d3.Device != nil || d3.Challenge != nil {
		t.Errorf("sin recordar: %+v", d3)
	}
	if d4, _ := env.svc.Decide(&env.maria, "", uaWin, "1.1.1.1", true); d4.Device != nil || d4.Challenge != nil {
		t.Errorf("sin identificador: %+v", d4)
	}
	var n int64
	database.DB.Model(&models.UserDevice{}).Count(&n)
	if n != 1 {
		t.Errorf("solo debía haber 1 equipo registrado: %d", n)
	}
}

func TestDecide_enforcePideVerificacionAlEquipoNuevoYLaConfianzaEsPorUsuario(t *testing.T) {
	env := newDeviceEnv(t, models.DeviceTrustLearn)
	// María ya usaba este equipo (aprendido).
	env.svc.Decide(&env.maria, tokA, uaWin, "1.1.1.1", true)
	env.svc.UpdateSettings(models.DeviceTrustEnforce, 30, nil)

	// María en su equipo conocido: entra directo.
	d, _ := env.svc.Decide(&env.maria, tokA, uaWin, "1.1.1.1", true)
	if d.Challenge != nil || d.Device == nil {
		t.Fatalf("equipo conocido entra directo: %+v", d)
	}
	// Pedro, en el MISMO equipo, no: la confianza no es de la PC sino de la persona.
	d, _ = env.svc.Decide(&env.pedro, tokA, uaWin, "1.1.1.1", true)
	if d.Challenge == nil || d.Device != nil || d.Challenge.UserID != env.pedro.ID || d.Challenge.Status != models.ChallengePending || !d.Challenge.Remember {
		t.Fatalf("Pedro debía verificar aunque la PC sea de confianza para María: %+v", d)
	}
	if !d.Challenge.ExpiresAt.Equal(env.now.Add(10 * time.Minute)) {
		t.Errorf("la verificación dura 10 min: %v", d.Challenge.ExpiresAt)
	}
	// María en un equipo nuevo también.
	if d, _ = env.svc.Decide(&env.maria, tokB, uaWin, "9.9.9.9", true); d.Challenge == nil {
		t.Error("equipo nuevo de María: verificación")
	}
}

func TestDecide_laConfianzaVenceYSeRenuevaConElUso(t *testing.T) {
	env := newDeviceEnv(t, models.DeviceTrustEnforce)
	// Se registra a mano un equipo de confianza (como si ya se hubiera verificado).
	ch := &models.LoginChallenge{ID: "x", UserID: env.maria.ID, DeviceHash: HashDeviceToken(tokA), UserAgent: uaWin, IP: "1.1.1.1", Remember: true}
	set, _ := env.svc.Settings()
	dev, err := env.svc.Trust(ch, tokA, models.DeviceViaTOTP)
	if err != nil || dev == nil {
		t.Fatalf("registrar: %v", err)
	}
	// Se usa a los 20 días: sigue y se renueva a 30 días desde ahora.
	*env.now = env.now.Add(20 * 24 * time.Hour)
	d, _ := env.svc.Decide(&env.maria, tokA, uaWin, "1.1.1.1", true)
	if d.Challenge != nil {
		t.Fatal("a los 20 días sigue de confianza")
	}
	var got models.UserDevice
	database.DB.First(&got, dev.ID)
	if want := env.now.Add(30 * 24 * time.Hour); !got.TrustedUntil.Equal(want) {
		t.Errorf("renovada a 30 días desde el uso: %v (quería %v)", got.TrustedUntil, want)
	}
	// 31 días sin usarlo: vence y pide verificar.
	*env.now = env.now.Add(31 * 24 * time.Hour)
	if d, _ = env.svc.Decide(&env.maria, tokA, uaWin, "1.1.1.1", true); d.Challenge == nil {
		t.Error("a los 31 días sin uso debía pedir verificación")
	}
	// Nunca pasa de 180 días desde que se registró, aunque se use todos los días.
	env2 := newDeviceEnv(t, models.DeviceTrustEnforce)
	ch2 := &models.LoginChallenge{ID: "y", UserID: env2.maria.ID, DeviceHash: HashDeviceToken(tokA), UserAgent: uaWin, Remember: true}
	dev2, _ := env2.svc.Trust(ch2, tokA, models.DeviceViaTOTP)
	for i := 0; i < 20; i++ {
		*env2.now = env2.now.Add(10 * 24 * time.Hour)
		if d, _ := env2.svc.Decide(&env2.maria, tokA, uaWin, "1.1.1.1", true); d.Challenge != nil && i < 17 {
			t.Fatalf("día %d: no debía pedir verificación todavía", (i+1)*10)
		}
	}
	var got2 models.UserDevice
	database.DB.First(&got2, dev2.ID)
	if limit := dev2.CreatedAt.Add(180 * 24 * time.Hour); got2.TrustedUntil.After(limit) {
		t.Errorf("la confianza no pasa de 180 días desde el registro: %v > %v", got2.TrustedUntil, limit)
	}
	_ = set
}

func enableTOTP(t *testing.T, env *deviceEnv, u models.User) (secret string, recovery []string) {
	t.Helper()
	secret, uri, err := env.svc.TOTPSetup(u.ID, u.Username)
	if err != nil || !strings.Contains(uri, secret) {
		t.Fatalf("setup: %v", err)
	}
	if env.svc.TOTPStatus(u.ID).Enabled {
		t.Fatal("antes de confirmar el código no está activada")
	}
	sec, _ := decodeTOTPSecret(secret)
	recovery, err = env.svc.TOTPEnable(u.ID, totpCodeAt(sec, env.now.Unix()/totpPeriod))
	if err != nil || len(recovery) != 8 {
		t.Fatalf("enable: %v %d", err, len(recovery))
	}
	return secret, recovery
}

func TestTOTP_configurarYSecretoCifradoEnLaBase(t *testing.T) {
	env := newDeviceEnv(t, models.DeviceTrustEnforce)
	if _, err := env.svc.TOTPEnable(env.maria.ID, "123456"); err == nil {
		t.Error("sin generar el QR no se puede activar")
	}
	secret, _ := enableTOTP(t, env, env.maria)
	var row models.UserTOTP
	database.DB.Where("user_id = ?", env.maria.ID).First(&row)
	if strings.Contains(row.SecretEnc, secret) || !row.Enabled || row.EnabledAt == nil {
		t.Errorf("el secreto no debe quedar en claro: %+v", row)
	}
	if st := env.svc.TOTPStatus(env.maria.ID); !st.Enabled || st.RecoveryCodesLeft != 8 {
		t.Errorf("estado: %+v", st)
	}
	if _, _, err := env.svc.TOTPSetup(env.maria.ID, "maria"); err == nil {
		t.Error("ya activada: hay que desactivarla antes de configurarla de nuevo")
	}
	// Un código equivocado no activa.
	_, _, _ = env.svc.TOTPSetup(env.pedro.ID, "pedro")
	if _, err := env.svc.TOTPEnable(env.pedro.ID, "000000"); err == nil || env.svc.TOTPStatus(env.pedro.ID).Enabled {
		t.Error("un código equivocado no activa")
	}
	env.svc.TOTPDisable(env.maria.ID)
	if env.svc.TOTPStatus(env.maria.ID).Enabled {
		t.Error("desactivada")
	}
}

func TestVerificacion_conCodigoDeLaAppIntentosYRecuperacion(t *testing.T) {
	env := newDeviceEnv(t, models.DeviceTrustEnforce)
	secret, recovery := enableTOTP(t, env, env.maria)
	sec, _ := decodeTOTPSecret(secret)
	code := func() string { return totpCodeAt(sec, env.now.Unix()/totpPeriod) }

	newChallenge := func() *models.LoginChallenge {
		d, err := env.svc.Decide(&env.maria, tokB, uaWin, "2.2.2.2", true)
		if err != nil || d.Challenge == nil {
			t.Fatalf("debía haber verificación: %v", err)
		}
		return d.Challenge
	}

	// Código equivocado: cuenta intentos y avisa cuántos quedan.
	ch := newChallenge()
	_, _, err := env.svc.VerifyCode(ch.ID, "111111")
	var bad *ChallengeBadCodeError
	if !errors.As(err, &bad) || bad.Left != 4 || !strings.Contains(err.Error(), "4 intentos") {
		t.Fatalf("primer error: %v", err)
	}
	// Código correcto: la verificación queda usada y el equipo, de confianza.
	// (El paso actual ya fue usado al activar: se avanza 30 s para tener un código nuevo.)
	*env.now = env.now.Add(30 * time.Second)
	got, via, err := env.svc.VerifyCode(ch.ID, code())
	if err != nil || via != models.DeviceViaTOTP || got.UserID != env.maria.ID {
		t.Fatalf("código correcto: %v %q", err, via)
	}
	dev, err := env.svc.Trust(got, tokB, via)
	if err != nil || dev == nil || dev.TrustedUntil == nil {
		t.Fatalf("el equipo queda de confianza: %v %+v", err, dev)
	}
	// La verificación no se puede usar dos veces.
	if _, _, err := env.svc.VerifyCode(ch.ID, code()); !errors.Is(err, ErrChallengeInvalid) {
		t.Errorf("verificación ya usada: %v", err)
	}
	// Con ese equipo ya no pide verificar.
	if d, _ := env.svc.Decide(&env.maria, tokB, uaWin, "2.2.2.2", true); d.Challenge != nil {
		t.Error("el equipo verificado entra directo")
	}
	// Trust exige el mismo identificador con el que empezó la verificación.
	ch2 := newChallenge2(t, env, tokA)
	*env.now = env.now.Add(30 * time.Second)
	got2, _, err := env.svc.VerifyCode(ch2.ID, code())
	if err != nil {
		t.Fatal(err)
	}
	if dev, _ := env.svc.Trust(got2, tokB, models.DeviceViaTOTP); dev != nil {
		t.Error("otro identificador distinto al de la verificación no se registra")
	}
	// Sin «recordar» tampoco se registra.
	d, _ := env.svc.Decide(&env.maria, "cccccccccccccccccccccccccccccccccccccccc", uaWin, "2.2.2.2", false)
	*env.now = env.now.Add(30 * time.Second)
	got3, _, _ := env.svc.VerifyCode(d.Challenge.ID, code())
	if dev, _ := env.svc.Trust(got3, "cccccccccccccccccccccccccccccccccccccccc", models.DeviceViaTOTP); dev != nil {
		t.Error("sin «recordar» el equipo no queda de confianza")
	}

	// Cinco códigos equivocados anulan la verificación.
	ch4 := newChallenge2(t, env, "dddddddddddddddddddddddddddddddddddddddd")
	for i := 0; i < 5; i++ {
		env.svc.VerifyCode(ch4.ID, "000000")
	}
	if _, _, err := env.svc.VerifyCode(ch4.ID, code()); err == nil || !strings.Contains(err.Error(), "intentos") {
		t.Errorf("tras 5 errores ni el código correcto sirve: %v", err)
	}

	// Código de recuperación: sirve una sola vez.
	ch5 := newChallenge2(t, env, "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee")
	_, via, err = env.svc.VerifyCode(ch5.ID, strings.ToUpper(recovery[0]))
	if err != nil || via != models.DeviceViaRecovery {
		t.Fatalf("recuperación: %v %q", err, via)
	}
	if st := env.svc.TOTPStatus(env.maria.ID); st.RecoveryCodesLeft != 7 {
		t.Errorf("quedan 7 códigos: %d", st.RecoveryCodesLeft)
	}
	ch6 := newChallenge2(t, env, "ffffffffffffffffffffffffffffffffffffffff")
	if _, _, err := env.svc.VerifyCode(ch6.ID, recovery[0]); err == nil {
		t.Error("un código de recuperación no sirve dos veces")
	}
}

func newChallenge2(t *testing.T, env *deviceEnv, tok string) *models.LoginChallenge {
	t.Helper()
	d, err := env.svc.Decide(&env.maria, tok, uaWin, "3.3.3.3", true)
	if err != nil || d.Challenge == nil {
		t.Fatalf("debía haber verificación: %v", err)
	}
	return d.Challenge
}

func TestVerificacion_sinTOTPYVencimiento(t *testing.T) {
	env := newDeviceEnv(t, models.DeviceTrustEnforce)
	ch := newChallenge2(t, env, tokA)
	if _, _, err := env.svc.VerifyCode(ch.ID, "123456"); !errors.Is(err, ErrChallengeNoTOTP) {
		t.Errorf("sin TOTP activado: %v", err)
	}
	*env.now = env.now.Add(11 * time.Minute)
	if _, err := env.svc.Challenge(ch.ID); !errors.Is(err, ErrChallengeInvalid) {
		t.Errorf("a los 11 min venció: %v", err)
	}
	if st := env.svc.ChallengeStatus(ch.ID); st != "vencida" {
		t.Errorf("estado de una vencida: %s", st)
	}
	if _, err := env.svc.Challenge("no-existe"); !errors.Is(err, ErrChallengeInvalid) {
		t.Errorf("inexistente: %v", err)
	}
}

func TestAprobacionDelAdministrador(t *testing.T) {
	env := newDeviceEnv(t, models.DeviceTrustEnforce)
	ch := newChallenge2(t, env, tokA)

	if got := env.svc.ChallengeStatus(ch.ID); got != models.ChallengePending {
		t.Errorf("estado inicial: %s", got)
	}
	if list, _ := env.svc.PendingApprovals(); len(list) != 0 {
		t.Error("sin pedir aprobación no aparece en la lista del administrador")
	}
	if _, err := env.svc.DecideApproval(ch.ID, env.pedro.ID, true); err == nil {
		t.Error("no se puede aprobar algo que nadie pidió")
	}
	req, err := env.svc.RequestApproval(ch.ID)
	if err != nil || req.ApprovalRequestedAt == nil || !req.ExpiresAt.Equal(env.now.Add(30*time.Minute)) {
		t.Fatalf("pedir aprobación extiende a 30 min: %+v %v", req, err)
	}
	list, _ := env.svc.PendingApprovals()
	if len(list) != 1 || list[0].Username != "maria" || list[0].DeviceLabel != "Chrome · Windows" || list[0].IP != "3.3.3.3" {
		t.Fatalf("lista del administrador: %+v", list)
	}
	if _, err := env.svc.CompleteApproved(ch.ID); err == nil {
		t.Error("sin aprobar no se puede terminar de entrar")
	}
	// Nadie aprueba su propio equipo.
	if _, err := env.svc.DecideApproval(ch.ID, env.maria.ID, true); err == nil || !strings.Contains(err.Error(), "propio") {
		t.Errorf("auto-aprobación: %v", err)
	}
	if _, err := env.svc.DecideApproval(ch.ID, env.pedro.ID, true); err != nil {
		t.Fatal(err)
	}
	if env.svc.ChallengeStatus(ch.ID) != models.ChallengeApproved {
		t.Error("estado aprobada")
	}
	if list, _ := env.svc.PendingApprovals(); len(list) != 0 {
		t.Error("una aprobada ya no está pendiente")
	}
	done, err := env.svc.CompleteApproved(ch.ID)
	if err != nil {
		t.Fatal(err)
	}
	if dev, _ := env.svc.Trust(done, tokA, models.DeviceViaApproval); dev == nil || dev.Via != models.DeviceViaApproval {
		t.Error("el equipo aprobado queda de confianza")
	}
	if _, err := env.svc.CompleteApproved(ch.ID); err == nil {
		t.Error("una aprobación no se usa dos veces")
	}

	// Rechazada: no entra.
	ch2 := newChallenge2(t, env, tokB)
	env.svc.RequestApproval(ch2.ID)
	env.svc.DecideApproval(ch2.ID, env.pedro.ID, false)
	if env.svc.ChallengeStatus(ch2.ID) != models.ChallengeDenied {
		t.Error("estado rechazada")
	}
	if _, err := env.svc.CompleteApproved(ch2.ID); err == nil {
		t.Error("una rechazada no entra")
	}
	// Sin respuesta en 30 min: vence.
	ch3 := newChallenge2(t, env, "gggggggggggggggggggggggggggggggggggggggg")
	env.svc.RequestApproval(ch3.ID)
	*env.now = env.now.Add(31 * time.Minute)
	if list, _ := env.svc.PendingApprovals(); len(list) != 0 || env.svc.ChallengeStatus(ch3.ID) != "vencida" {
		t.Error("una solicitud sin respuesta vence a los 30 minutos")
	}
}

func TestDispositivos_revocarYReiniciarUsuario(t *testing.T) {
	env := newDeviceEnv(t, models.DeviceTrustLearn)
	d1, _ := env.svc.Decide(&env.maria, tokA, uaWin, "1.1.1.1", true)
	d2, _ := env.svc.Decide(&env.maria, tokB, uaWin, "1.1.1.1", true)
	d3, _ := env.svc.Decide(&env.pedro, tokA, uaWin, "1.1.1.1", true)
	sess, _ := Sessions().Create(env.maria.ID, d1.Device.ID, "1.1.1.1", uaWin)

	devs, _ := env.svc.Devices(env.maria.ID)
	if len(devs) != 2 {
		t.Fatalf("María tiene 2 equipos: %d", len(devs))
	}
	// Una persona no puede quitar el equipo de otra.
	if _, err := env.svc.RevokeDevice(d3.Device.ID, env.maria.ID); err == nil {
		t.Error("el equipo de Pedro no se quita como si fuera de María")
	}
	if _, err := env.svc.RevokeDevice(d1.Device.ID, env.maria.ID); err != nil {
		t.Fatal(err)
	}
	if st := Sessions().Check(sess.ID, env.maria.ID, false); st != SessionRevoked {
		t.Errorf("quitar el equipo cierra las sesiones abiertas desde él: %v", st)
	}
	if devs, _ = env.svc.Devices(env.maria.ID); len(devs) != 1 {
		t.Errorf("queda 1: %d", len(devs))
	}
	// Quitado el equipo, vuelve a pedir verificación en modo enforce.
	env.svc.UpdateSettings(models.DeviceTrustEnforce, 30, nil)
	if d, _ := env.svc.Decide(&env.maria, tokA, uaWin, "1.1.1.1", true); d.Challenge == nil {
		t.Error("un equipo quitado pide verificación")
	}

	// Reiniciar al usuario: sin TOTP, sin equipos y sin sesiones.
	enableTOTP(t, env, env.maria)
	sess2, _ := Sessions().Create(env.maria.ID, d2.Device.ID, "1.1.1.1", uaWin)
	env.svc.ResetUser(env.maria.ID)
	if env.svc.TOTPStatus(env.maria.ID).Enabled {
		t.Error("sin verificación en dos pasos")
	}
	if devs, _ = env.svc.Devices(env.maria.ID); len(devs) != 0 {
		t.Error("sin equipos")
	}
	if Sessions().Check(sess2.ID, env.maria.ID, false) == SessionOK {
		t.Error("sin sesiones")
	}
	if devs, _ = env.svc.Devices(env.pedro.ID); len(devs) != 1 {
		t.Error("lo de Pedro no se toca")
	}
}
