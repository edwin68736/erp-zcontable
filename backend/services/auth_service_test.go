package services

import (
	"errors"
	"strings"
	"testing"

	"miappfiber/database"
	"miappfiber/models"
)

func init() {
	// Las pruebas no salen a Internet: la consulta de contraseñas filtradas se reemplaza.
	passwordBreachCheck = func(string) (bool, error) { return false, nil }
}

func newAuthTest(t *testing.T) *AuthService {
	db := setupCompanyRucTestDB(t)
	if err := db.AutoMigrate(&models.User{}); err != nil {
		t.Fatal(err)
	}
	mk := func(username, pw string, active bool) {
		u := models.User{Name: username, Username: username, Active: true}
		_ = u.SetPassword(pw)
		db.Create(&u)
		if !active {
			db.Model(&u).Update("active", false)
		}
	}
	mk("maria", "una-clave-segura-123", true)
	mk("inactivo", "una-clave-segura-123", false)
	return NewAuthService()
}

func TestLogin_todosLosFallosSeVenIgualPeroSeRegistraElMotivo(t *testing.T) {
	s := newAuthTest(t)
	u, reason, err := s.LoginDetailed("maria", "una-clave-segura-123")
	if err != nil || reason != "" || u == nil || u.Username != "maria" {
		t.Fatalf("login correcto: %+v %q %v", u, reason, err)
	}
	if u, _, err := s.LoginDetailed("  MARIA ", "una-clave-segura-123"); err != nil || u == nil {
		t.Errorf("el usuario no distingue mayúsculas ni espacios: %v", err)
	}
	cases := []struct {
		user, pw, wantReason string
		wantUser             bool
	}{
		{"maria", "otra-clave-mala", LoginFailBadPassword, true},
		{"noexiste", "una-clave-segura-123", LoginFailUnknownUser, false},
		{"", "x", LoginFailUnknownUser, false},
		// Inactivo con la contraseña correcta: antes decía «usuario inactivo» (revelaba que existe).
		{"inactivo", "una-clave-segura-123", LoginFailInactive, true},
		{"inactivo", "mala", LoginFailBadPassword, true},
	}
	for _, c := range cases {
		u, reason, err := s.LoginDetailed(c.user, c.pw)
		if !errors.Is(err, ErrInvalidCredentials) || err.Error() != "credenciales inválidas" {
			t.Errorf("%q: el error debía ser siempre «credenciales inválidas»: %v", c.user, err)
		}
		if reason != c.wantReason || (u != nil) != c.wantUser {
			t.Errorf("%q: motivo %q (quería %q), usuario devuelto %v", c.user, reason, c.wantReason, u != nil)
		}
	}
	if _, err := s.Login("inactivo", "una-clave-segura-123"); !errors.Is(err, ErrInvalidCredentials) {
		t.Errorf("Login envuelve el mismo comportamiento: %v", err)
	}
}

func TestChangeOwnPassword(t *testing.T) {
	s := newAuthTest(t)
	var u models.User
	database.DB.Where("username = ?", "maria").First(&u)

	if err := s.ChangeOwnPassword(u.ID, "no-es-esta", "NuevaClave-2026-x"); err == nil || !strings.Contains(err.Error(), "actual no es correcta") {
		t.Errorf("con la actual mal debía fallar: %v", err)
	}
	if err := s.ChangeOwnPassword(u.ID, "una-clave-segura-123", "una-clave-segura-123"); err == nil || !strings.Contains(err.Error(), "distinta") {
		t.Errorf("igual a la actual: %v", err)
	}
	if err := s.ChangeOwnPassword(u.ID, "una-clave-segura-123", "corta"); err == nil || !strings.Contains(err.Error(), "10 caracteres") {
		t.Errorf("política: %v", err)
	}
	if err := s.ChangeOwnPassword(u.ID, "una-clave-segura-123", "NuevaClave-2026-x"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Login("maria", "una-clave-segura-123"); err == nil {
		t.Error("la contraseña vieja ya no debía servir")
	}
	if _, err := s.Login("maria", "NuevaClave-2026-x"); err != nil {
		t.Errorf("la nueva sí: %v", err)
	}
	if err := s.ChangeOwnPassword(9999, "x", "NuevaClave-2026-x"); !errors.Is(err, ErrInvalidCredentials) {
		t.Errorf("usuario inexistente: %v", err)
	}
}

func TestPasswordPolicy(t *testing.T) {
	ok := []string{"Una-clave-larga-2026", "frase secreta del estudio", "k9#Xp2!vLm4Q"}
	for _, p := range ok {
		if err := ValidatePasswordPolicy(p, "maria"); err != nil {
			t.Errorf("%q debía aceptarse: %v", p, err)
		}
	}
	bad := map[string]string{
		"corta1":                    "al menos 10",
		"123456789":                 "al menos 10",
		"1234567890":                "demasiado común",
		"aaaaaaaaaaaa":              "demasiado común",
		"abcdefghijkl":              "demasiado común",
		"9876543210":                "demasiado común",
		"contraseña":                "demasiado común",
		"estudiocontable":           "demasiado común",
		"MARIA-2026-clave":          "nombre de usuario",
		"          ":                "en blanco", // 10 espacios no cuentan como contraseña
		strings.Repeat("a1", 40):    "72",
		strings.Repeat("áéíóúñ", 7): "72", // 42 letras, pero 84 BYTES: bcrypt solo mira 72
	}
	for p, want := range bad {
		err := ValidatePasswordPolicy(p, "maria")
		if err == nil || !strings.Contains(err.Error(), want) {
			t.Errorf("%q: esperaba error con %q, obtuve %v", p, want, err)
		}
	}
	// Contraseña filtrada: se rechaza; si el servicio falla, NO se bloquea el cambio.
	passwordBreachCheck = func(p string) (bool, error) { return p == "Una-clave-larga-2026", nil }
	if err := ValidatePasswordPolicy("Una-clave-larga-2026", "maria"); err == nil || !strings.Contains(err.Error(), "filtraciones") {
		t.Errorf("filtrada: %v", err)
	}
	passwordBreachCheck = func(string) (bool, error) { return true, errors.New("sin conexión") }
	if err := ValidatePasswordPolicy("Una-clave-larga-2026", "maria"); err != nil {
		t.Errorf("si el servicio falla no se bloquea: %v", err)
	}
	passwordBreachCheck = func(string) (bool, error) { return false, nil }
}

func TestUserService_aplicaLaPoliticaAlCrearYEditar(t *testing.T) {
	db := setupCompanyRucTestDB(t)
	if err := db.AutoMigrate(&models.User{}, &models.Role{}, &models.Permission{}); err != nil {
		t.Fatal(err)
	}
	us := NewUserService()
	if _, _, err := us.Create("nuevo1", "Nuevo", "", "123456", 1, "", "", "", true); err == nil || !strings.Contains(err.Error(), "10 caracteres") {
		t.Errorf("crear con contraseña débil debía rechazarse: %v", err)
	}
}
