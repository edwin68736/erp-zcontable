package services

import (
	"strings"
	"testing"
	"time"
)

func setupPdt621GuardadoTest(t *testing.T, code string) (*SupervisorService, uint) {
	t.Helper()
	db := setupPdt621TestDB(t)
	svc := NewSupervisorService()
	co := seedEstudioCompany(t, db, code)
	if _, err := svc.CreatePeriod("2026-07", "test"); err != nil {
		t.Fatalf("CreatePeriod: %v", err)
	}
	return svc, co.ID
}

// Cada persona guarda solo lo que cambió: el asistente (cuya pantalla se abrió con la fecha de declaración vacía) ya no pisa la
// fecha y los importes que el supervisor registró mientras tanto, y el supervisor no pisa el SIRE del asistente.
func TestSavePdt621Record_GuardaSoloLosCamposCambiados(t *testing.T) {
	svc, companyID := setupPdt621GuardadoTest(t, "G001")

	// El supervisor registra la declaración y los importes.
	if _, err := svc.SavePdt621Record(companyID, "2026-07", Pdt621RecordInput{
		FechaDeclaracion: "2026-07-20", TotalVentas: 1000, Igv: 180,
		Fields: []string{"fecha_declaracion", "total_ventas", "igv"},
	}); err != nil {
		t.Fatalf("supervisor: %v", err)
	}
	// El asistente, con su pantalla vieja (fecha de declaración e importes en blanco), registra solo el SIRE.
	d, err := svc.SavePdt621Record(companyID, "2026-07", Pdt621RecordInput{
		EnvioSire: "si", FechaEnvioSire: "2026-07-18",
		Fields: []string{"envio_sire", "fecha_envio_sire"},
	})
	if err != nil {
		t.Fatalf("asistente: %v", err)
	}
	r := d.Record
	if r == nil || r.FechaDeclaracion == nil || *r.FechaDeclaracion != "2026-07-20" || r.TotalVentas != 1000 || r.Igv != 180 {
		t.Fatalf("lo del supervisor se perdió al guardar el asistente: %+v", r)
	}
	if r.EnvioSire != "si" || r.FechaEnvioSire == nil || *r.FechaEnvioSire != "2026-07-18" {
		t.Fatalf("el SIRE del asistente no se guardó: %+v", r)
	}

	// Y al revés: el supervisor cambia una observación y el SIRE sigue igual.
	d, err = svc.SavePdt621Record(companyID, "2026-07", Pdt621RecordInput{Observacion: "Revisado", Fields: []string{"observacion"}})
	if err != nil {
		t.Fatalf("observación: %v", err)
	}
	if d.Record.EnvioSire != "si" || d.Record.Observacion != "Revisado" || d.Record.FechaDeclaracion == nil {
		t.Fatalf("un guardado parcial no debe tocar el resto: %+v", d.Record)
	}
}

// ¿Se envió SIRE? manda sobre la fecha de envío y el motivo.
func TestSavePdt621Record_ReglasDelSire(t *testing.T) {
	svc, companyID := setupPdt621GuardadoTest(t, "G002")
	save := func(in Pdt621RecordInput) (*Pdt621Detail, error) {
		return svc.SavePdt621Record(companyID, "2026-07", in)
	}
	wantErr := func(name string, in Pdt621RecordInput, contains string) {
		t.Helper()
		if _, err := save(in); err == nil || !strings.Contains(err.Error(), contains) {
			t.Errorf("%s: debía fallar con «%s», dio %v", name, contains, err)
		}
	}

	wantErr("sí sin fecha", Pdt621RecordInput{EnvioSire: "si"}, "fecha de envío")
	wantErr("no sin motivo", Pdt621RecordInput{EnvioSire: "no"}, "motivo")
	wantErr("fecha sin responder", Pdt621RecordInput{FechaEnvioSire: "2026-07-18"}, "indique si se envió SIRE")
	wantErr("valor inválido", Pdt621RecordInput{EnvioSire: "tal vez"}, "Sí o No")

	// «Sí»: guarda la fecha y limpia un motivo anterior.
	if d, err := save(Pdt621RecordInput{EnvioSire: "si", FechaEnvioSire: "2026-07-18", MotivoNoEnvio: "viejo"}); err != nil || d.Record.MotivoNoEnvio != "" || d.Record.FechaEnvioSire == nil {
		t.Fatalf("sí con fecha: %+v %v", d, err)
	}
	// «No»: guarda el motivo y borra la fecha de envío.
	d, err := save(Pdt621RecordInput{EnvioSire: "no", MotivoNoEnvio: "Cliente sin movimientos", FechaEnvioSire: "2026-07-18"})
	if err != nil || d.Record.FechaEnvioSire != nil || d.Record.MotivoNoEnvio != "Cliente sin movimientos" {
		t.Fatalf("no con motivo: %+v %v", d, err)
	}
}

// Las fechas no pueden ser futuras, y los importes del PDT 621 piden la fecha de declaración.
func TestSavePdt621Record_FechasYImportes(t *testing.T) {
	svc, companyID := setupPdt621GuardadoTest(t, "G003")
	future := time.Now().AddDate(0, 0, 3).Format("2006-01-02")

	if _, err := svc.SavePdt621Record(companyID, "2026-07", Pdt621RecordInput{FechaDeclaracion: future, Fields: []string{"fecha_declaracion"}}); err == nil || !strings.Contains(err.Error(), "futura") {
		t.Errorf("la fecha de declaración futura debía rechazarse: %v", err)
	}
	if _, err := svc.SavePdt621Record(companyID, "2026-07", Pdt621RecordInput{EnvioSire: "si", FechaEnvioSire: future, Fields: []string{"envio_sire", "fecha_envio_sire"}}); err == nil || !strings.Contains(err.Error(), "futura") {
		t.Errorf("la fecha de envío futura debía rechazarse: %v", err)
	}

	// Importes sin fecha de declaración: se rechaza; con la fecha, se guarda.
	if _, err := svc.SavePdt621Record(companyID, "2026-07", Pdt621RecordInput{TotalVentas: 500, Fields: []string{"total_ventas"}}); err == nil || !strings.Contains(err.Error(), "fecha de declaración") {
		t.Errorf("los importes sin fecha de declaración debían rechazarse: %v", err)
	}
	d, err := svc.SavePdt621Record(companyID, "2026-07", Pdt621RecordInput{TotalVentas: 500, FechaDeclaracion: "2026-07-20", Fields: []string{"total_ventas", "fecha_declaracion"}})
	if err != nil || d.Record.TotalVentas != 500 {
		t.Fatalf("importes con fecha: %+v %v", d, err)
	}
	// Una vez declarada, cambiar solo otro campo no exige nada más.
	if _, err := svc.SavePdt621Record(companyID, "2026-07", Pdt621RecordInput{Observacion: "ok", Fields: []string{"observacion"}}); err != nil {
		t.Errorf("guardar solo la observación: %v", err)
	}
}
