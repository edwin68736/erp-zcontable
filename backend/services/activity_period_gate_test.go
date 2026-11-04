package services

import (
	"testing"
	"time"
)

func TestActivityPeriodEnabled_soloPeriodosTerminados(t *testing.T) {
	prev := pdt621Now
	defer func() { pdt621Now = prev }()
	// 4 de noviembre de 2026 en Lima: se trabaja octubre; noviembre (mes en curso) y diciembre aún no.
	pdt621Now = func() time.Time { return time.Date(2026, 11, 4, 10, 0, 0, 0, limaLoc) }

	for ym, want := range map[string]bool{
		"2026-09": true, "2026-10": true, "2026-11": false, "2026-12": false, "2027-01": false, "2025-12": true,
		"": false, "2026-13": false, "basura": false,
	} {
		if got := ActivityPeriodEnabled(ym); got != want {
			t.Errorf("ActivityPeriodEnabled(%q) = %v, quiero %v", ym, got, want)
		}
	}
	if got := LastEnabledPeriodYM(); got != "2026-10" {
		t.Errorf("LastEnabledPeriodYM = %q", got)
	}
	if err := ActivityPeriodNotEnabledError("2026-11"); err == nil || err.Error() != "el período 2026-11 aún no está habilitado: solo se registra información de períodos ya terminados (hasta 2026-10)" {
		t.Errorf("mensaje: %v", err)
	}
}

func TestActivityPeriodEnabled_cambioDeMesEnLima(t *testing.T) {
	prev := pdt621Now
	defer func() { pdt621Now = prev }()
	// 1.º de noviembre 00:30 en Lima ya es noviembre (aunque en UTC sea 05:30 del mismo día): octubre sigue habilitado.
	pdt621Now = func() time.Time { return time.Date(2026, 11, 1, 5, 30, 0, 0, time.UTC) }
	if !ActivityPeriodEnabled("2026-10") || ActivityPeriodEnabled("2026-11") {
		t.Error("el 1 de noviembre en Lima: octubre habilitado, noviembre no")
	}
	// 31 de octubre 23:30 en Lima (= 1 nov 04:30 UTC): todavía es octubre → habilitado septiembre, no octubre.
	pdt621Now = func() time.Time { return time.Date(2026, 11, 1, 4, 30, 0, 0, time.UTC) }
	if !ActivityPeriodEnabled("2026-09") || ActivityPeriodEnabled("2026-10") {
		t.Error("31 de octubre en Lima: septiembre habilitado, octubre no")
	}
}
