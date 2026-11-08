package services

import (
	"fmt"
	"strings"
	"testing"
	"time"

	"miappfiber/database"
	"miappfiber/models"
)

func newAuthSecurityTest(t *testing.T) (*AuthSecurityService, *time.Time) {
	db := setupCompanyRucTestDB(t)
	if err := db.AutoMigrate(&models.AuthEvent{}); err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 11, 7, 10, 0, 0, 0, time.UTC)
	s := NewAuthSecurityService()
	s.now = func() time.Time { return now }
	return s, &now
}

func failN(s *AuthSecurityService, now *time.Time, user, ip string, n int, step time.Duration) {
	for i := 0; i < n; i++ {
		s.Record(models.AuthEventLoginFail, 1, user, ip, "ua", "contraseña incorrecta")
		*now = now.Add(step)
	}
}

func TestLocked_cincoFallosBloqueanAlUsuarioPorQuinceMinutos(t *testing.T) {
	s, now := newAuthSecurityTest(t)
	failN(s, now, "Maria", "1.1.1.1", 4, time.Minute)
	if _, locked := s.Locked("maria", "1.1.1.1"); locked {
		t.Fatal("con 4 fallos todavía no se bloquea")
	}
	failN(s, now, " MARIA ", "1.1.1.1", 1, 0) // el 5.º, con mayúsculas y espacios: es el mismo usuario
	wait, locked := s.Locked("maria", "9.9.9.9")
	if !locked {
		t.Fatal("con 5 fallos debía bloquearse (aunque la IP sea otra)")
	}
	// El bloqueo dura hasta que el más viejo de los 5 fallos cumpla 15 min: el 1.º fue hace 4 min → faltan 11.
	if wait != 11*time.Minute {
		t.Errorf("espera esperada 11 min, fue %v", wait)
	}
	// Pasan 16 minutos: se levanta solo.
	*now = now.Add(16 * time.Minute)
	if _, locked := s.Locked("maria", "9.9.9.9"); locked {
		t.Error("tras 15 minutos el bloqueo debía levantarse")
	}
	// Otro usuario no se ve afectado.
	if _, locked := s.Locked("pedro", "1.1.1.1"); locked {
		t.Error("el bloqueo de un usuario no alcanza a otro")
	}
}

func TestLocked_unAccesoCorrectoReiniciaLosFallos(t *testing.T) {
	s, now := newAuthSecurityTest(t)
	failN(s, now, "ana", "2.2.2.2", 4, time.Second)
	s.Record(models.AuthEventLoginOK, 1, "ana", "2.2.2.2", "ua", "")
	*now = now.Add(time.Second)
	failN(s, now, "ana", "2.2.2.2", 4, time.Second)
	if _, locked := s.Locked("ana", "2.2.2.2"); locked {
		t.Error("4 fallos después de un acceso correcto no bloquean: se reiniciaron")
	}
	failN(s, now, "ana", "2.2.2.2", 1, time.Second)
	if _, locked := s.Locked("ana", "2.2.2.2"); !locked {
		t.Error("5 fallos seguidos después del acceso correcto sí bloquean")
	}
}

func TestLocked_unIntentoBloqueadoNoAlargaElBloqueo(t *testing.T) {
	s, now := newAuthSecurityTest(t)
	failN(s, now, "luis", "3.3.3.3", 5, 0)
	first, _ := s.Locked("luis", "3.3.3.3")
	*now = now.Add(10 * time.Minute)
	for i := 0; i < 20; i++ {
		s.Record(models.AuthEventLoginBlocked, 0, "luis", "3.3.3.3", "ua", "bloqueo")
	}
	second, locked := s.Locked("luis", "3.3.3.3")
	if !locked || second >= first {
		t.Errorf("los intentos bloqueados no suman: debía faltar menos (antes %v, ahora %v)", first, second)
	}
}

func TestLocked_unaIPConMuchosFallosQuedaBloqueada(t *testing.T) {
	s, now := newAuthSecurityTest(t)
	for i := 0; i < authMaxFailIP-1; i++ {
		failN(s, now, fmt.Sprintf("u%d", i), "7.7.7.7", 1, 0)
	}
	if _, locked := s.Locked("nuevo", "7.7.7.7"); locked {
		t.Fatal("29 fallos de una IP (con usuarios distintos) todavía no bloquean")
	}
	failN(s, now, "otro", "7.7.7.7", 1, 0)
	if _, locked := s.Locked("nuevo", "7.7.7.7"); !locked {
		t.Error("30 fallos desde una IP deben bloquearla, aunque pruebe un usuario nuevo")
	}
	if _, locked := s.Locked("nuevo", "8.8.8.8"); locked {
		t.Error("otra IP no se ve afectada")
	}
}

func TestAuthEvents_listarFiltrarYPurgar(t *testing.T) {
	s, now := newAuthSecurityTest(t)
	s.Record(models.AuthEventLoginOK, 1, "ana", "1.1.1.1", strings.Repeat("x", 400), "")
	*now = now.Add(time.Hour)
	s.Record(models.AuthEventLoginFail, 2, "Luis", "2.2.2.2", "ua", "usuario inexistente")
	*now = now.Add(time.Hour)
	s.Record(models.AuthEventPasswordChange, 1, "ana", "1.1.1.1", "ua", "")

	page, err := s.List(AuthEventFilter{})
	if err != nil || page.Total != 3 || len(page.Rows) != 3 || page.Rows[0].Type != models.AuthEventPasswordChange {
		t.Fatalf("lo más reciente primero: %+v %v", page, err)
	}
	if len(page.Rows[2].UserAgent) != 255 {
		t.Errorf("el navegador se recorta a 255: %d", len(page.Rows[2].UserAgent))
	}
	if p, _ := s.List(AuthEventFilter{Type: models.AuthEventLoginFail}); p.Total != 1 || p.Rows[0].Username != "luis" {
		t.Errorf("filtro por tipo: %+v", p)
	}
	if p, _ := s.List(AuthEventFilter{Username: "AN"}); p.Total != 2 {
		t.Errorf("filtro por usuario (parcial, sin mayúsculas): %d", p.Total)
	}
	if p, _ := s.List(AuthEventFilter{IP: "2.2.2.2"}); p.Total != 1 {
		t.Errorf("filtro por IP: %d", p.Total)
	}
	from := now.Add(-90 * time.Minute)
	if p, _ := s.List(AuthEventFilter{From: &from}); p.Total != 2 {
		t.Errorf("filtro por fecha: %d", p.Total)
	}
	if p, _ := s.List(AuthEventFilter{PerPage: 2, Page: 2}); len(p.Rows) != 1 || p.TotalPages != 2 {
		t.Errorf("paginación: %+v", p)
	}

	*now = now.Add(200 * 24 * time.Hour)
	if n := s.PurgeOlderThan(authEventsRetention); n != 3 {
		t.Errorf("debía borrar los 3 viejos: %d", n)
	}
	var left int64
	database.DB.Model(&models.AuthEvent{}).Count(&left)
	if left != 0 {
		t.Errorf("quedan %d", left)
	}
}

func TestClientIP(t *testing.T) {
	cases := []struct{ remote, xff, want string }{
		{"203.0.113.5", "", "203.0.113.5"},
		// Detrás de Traefik (IP privada): vale la última IP, la que agregó el proxy; lo anterior lo escribe el cliente.
		{"172.18.0.4", "198.51.100.7", "198.51.100.7"},
		{"172.18.0.4", "1.2.3.4, 198.51.100.7", "198.51.100.7"},
		{"127.0.0.1", "198.51.100.7", "198.51.100.7"},
		// Una conexión directa desde Internet no puede mandar su propia X-Forwarded-For.
		{"203.0.113.5", "1.2.3.4", "203.0.113.5"},
		{"172.18.0.4", "no-es-una-ip", "172.18.0.4"},
	}
	for _, c := range cases {
		if got := ClientIP(c.remote, c.xff); got != c.want {
			t.Errorf("ClientIP(%q,%q) = %q, quería %q", c.remote, c.xff, got, c.want)
		}
	}
}
