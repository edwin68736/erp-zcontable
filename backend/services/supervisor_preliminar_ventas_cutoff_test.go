package services

import "testing"

func TestParsePreliminarVentasCutoff(t *testing.T) {
	got, err := parsePreliminarVentasCutoff("", "2026-09")
	if err != nil || got != nil {
		t.Fatalf("vacío debe ser sin definir: got=%v err=%v", got, err)
	}

	got, err = parsePreliminarVentasCutoff(" 2026-09-15 ", "2026-09")
	if err != nil || got == nil || formatPreliminarVentasCutoff(got) != "2026-09-15" {
		t.Fatalf("fecha válida del período: got=%v err=%v", got, err)
	}

	if _, err = parsePreliminarVentasCutoff("2026-10-01", "2026-09"); err == nil {
		t.Fatal("una fecha fuera del mes del período debe rechazarse")
	}
	if _, err = parsePreliminarVentasCutoff("15/09/2026", "2026-09"); err == nil {
		t.Fatal("un formato distinto de YYYY-MM-DD debe rechazarse")
	}
	if _, err = parsePreliminarVentasCutoff("2026-02-30", "2026-02"); err == nil {
		t.Fatal("una fecha inexistente debe rechazarse")
	}
}
