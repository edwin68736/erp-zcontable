package services

import (
	"errors"
	"testing"

	"miappfiber/models"
)

func TestRheHistory_guardaListaYQuita(t *testing.T) {
	db := setupCompanyRucTestDB(t)
	if err := db.AutoMigrate(&models.RheHistory{}); err != nil {
		t.Fatal(err)
	}
	s := &SireService{}
	q := RheQuery{Tipo: "C", CodCpe: "02", Desde: "2026-10-01", Hasta: "2026-10-15"}
	res := &RheResult{
		Items:     []RheComprobante{{Estado: "01", EstadoDesc: "Pendiente", RucEmisor: "10123456789", Serie: "E001", Numero: "15", TotalHonorarios: 100}},
		Total:     1,
		Consultas: 2,
		Estados:   []string{"01", "03"},
	}
	id1 := s.RecordRheHistory(7, 3, q, res, nil)
	id2 := s.RecordRheHistory(7, 3, q, &RheResult{Estados: []string{"01"}}, nil)
	id3 := s.RecordRheHistory(7, 3, q, nil, sireErr(SireErrUnavailable, "SUNAT no responde. Inténtelo más tarde: ñandú", "HTTP 503"))
	other := s.RecordRheHistory(8, 3, q, res, nil)
	if id1 == 0 || id2 == 0 || id3 == 0 || other == 0 {
		t.Fatalf("debía guardar todas: %d %d %d %d", id1, id2, id3, other)
	}

	rows, err := s.ListRheHistory(7)
	if err != nil || len(rows) != 3 {
		t.Fatalf("historial de la empresa 7: %d %v", len(rows), err)
	}
	if rows[0].ID != id3 || rows[0].Status != models.RheHistoryFailed || rows[0].ErrorMessage == "" {
		t.Errorf("lo más reciente primero y con su error: %+v", rows[0])
	}
	if rows[1].Status != models.RheHistoryNoData || rows[2].Status != models.RheHistoryReady || rows[2].Total != 1 || rows[2].Estados != "01,03" {
		t.Errorf("estados: %+v / %+v", rows[1], rows[2])
	}
	if len(rows[2].Data) != 0 {
		t.Error("el listado no debe traer los resultados")
	}

	row, got, err := s.GetRheHistory(7, id1)
	if err != nil || got == nil || len(got.Items) != 1 || got.Items[0].Serie != "E001" || got.Items[0].TotalHonorarios != 100 || row.Desde != "2026-10-01" {
		t.Fatalf("resultado guardado: %+v %+v %v", row, got, err)
	}
	if _, _, err := s.GetRheHistory(8, id1); err == nil {
		t.Error("no se puede leer una consulta de otra empresa")
	}

	if err := s.DeleteRheHistory(7, id1); err != nil {
		t.Fatal(err)
	}
	if err := s.DeleteRheHistory(7, id1); err == nil {
		t.Error("quitar dos veces debía fallar")
	}
	n, err := s.ClearRheHistory(7)
	if err != nil || n != 2 {
		t.Fatalf("limpiar: %d %v", n, err)
	}
	if rows, _ := s.ListRheHistory(8); len(rows) != 1 {
		t.Error("limpiar una empresa no debe tocar a las otras")
	}
}

func TestRheHistory_conservaSoloLasUltimas(t *testing.T) {
	db := setupCompanyRucTestDB(t)
	if err := db.AutoMigrate(&models.RheHistory{}); err != nil {
		t.Fatal(err)
	}
	s := &SireService{}
	q := RheQuery{Tipo: "V", CodCpe: "01", Desde: "2026-10-01", Hasta: "2026-10-15"}
	for i := 0; i < rheHistoryKeep+5; i++ {
		s.RecordRheHistory(1, 1, q, nil, errors.New("x"))
	}
	rows, _ := s.ListRheHistory(1)
	if len(rows) != rheHistoryKeep {
		t.Fatalf("debía conservar %d, hay %d", rheHistoryKeep, len(rows))
	}
}

func TestTruncateStr_noPartePorLaMitadUnCaracter(t *testing.T) {
	got := truncateStr("ñandú", 2) // «ñ» ocupa 2 bytes
	if got != "ñ" {
		t.Errorf("%q", got)
	}
	if got := truncateStr("añ", 2); got != "a" {
		t.Errorf("no debía dejar medio carácter: %q", got)
	}
}
