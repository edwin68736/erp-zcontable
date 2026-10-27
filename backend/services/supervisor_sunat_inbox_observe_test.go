package services

import (
	"testing"

	"miappfiber/models"
)

// Flujo de una captura de buzón observada: el asistente sube, el supervisor observa con un motivo, el
// asistente lo ve en su panel y lo levanta subiendo la captura corregida (vuelve a "cargado"), y recién
// entonces el supervisor puede verificarla.
func TestMailboxCapture_ObserveAndLiftByReupload(t *testing.T) {
	db := setupDashboardOverviewTestDB(t)
	if err := db.AutoMigrate(&models.SupervisorMailboxCaptureSlot{}, &models.FirmConfig{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	svc := NewSupervisorService()

	sup := models.User{Name: "Claudia", Username: "claudia"}
	ana := models.User{Name: "Ana", Username: "ana"}
	for _, u := range []*models.User{&sup, &ana} {
		if err := db.Create(u).Error; err != nil {
			t.Fatalf("user: %v", err)
		}
	}
	co := models.Company{RUC: "20A0011", BusinessName: "Empresa A", InternalCode: "A001", ClientType: models.CompanyClientTypeEstudio,
		Status: "activo", SupervisorUserID: &sup.ID, AssistantUserID: &ana.ID}
	if err := db.Create(&co).Error; err != nil {
		t.Fatalf("company: %v", err)
	}
	if _, err := svc.CreatePeriod("2026-07", "test"); err != nil {
		t.Fatalf("CreatePeriod: %v", err)
	}
	week := "2026-06-29" // lunes de la semana que contiene el 1 de julio

	up, err := svc.UploadMailboxCapture(co.ID, "2026-07", week, 1, models.SupervisorMailboxTypeSunat, "captura.pdf", []byte("%PDF-1"), ana.ID)
	if err != nil {
		t.Fatalf("UploadMailboxCapture: %v", err)
	}
	if up.Sunat.Status != models.SupervisorMailboxStatusCargado || up.ID == 0 {
		t.Fatalf("tras subir = %+v, want cargado", up.Sunat)
	}
	allowed := []uint{co.ID}

	// Observar exige un motivo y un buzón ya cargado.
	if _, err := svc.ObserveMailboxCapture(up.ID, "sunat", "  ", sup.ID, allowed); err == nil {
		t.Fatal("observar sin motivo debería fallar")
	}
	if _, err := svc.ObserveMailboxCapture(up.ID, "sunafil", "Falta la hoja 2", sup.ID, allowed); err == nil {
		t.Fatal("observar un buzón sin cargar debería fallar")
	}
	obs, err := svc.ObserveMailboxCapture(up.ID, "sunat", "Falta la hoja 2 de la captura", sup.ID, allowed)
	if err != nil {
		t.Fatalf("ObserveMailboxCapture: %v", err)
	}
	if obs.Sunat.Status != models.SupervisorMailboxStatusObservado || obs.Sunat.Observation != "Falta la hoja 2 de la captura" || obs.Sunat.ObservedBy != "Claudia" || obs.Sunat.ObservedAt == nil {
		t.Fatalf("buzón observado = %+v", obs.Sunat)
	}
	// El otro buzón no se toca, y un buzón observado no se puede verificar.
	if obs.Sunafil.Status != models.SupervisorMailboxStatusPendiente {
		t.Fatalf("SUNAFIL = %+v, want pendiente", obs.Sunafil)
	}
	if _, err := svc.VerifyMailboxCapture(up.ID, "sunat", sup.ID, allowed); err == nil {
		t.Fatal("un buzón observado no se puede verificar hasta que el asistente lo levante")
	}
	// Sin acceso a la empresa no se puede observar.
	if _, err := svc.ObserveMailboxCapture(up.ID, "sunat", "Otra", sup.ID, []uint{9999}); err == nil {
		t.Fatal("observar sin acceso a la empresa debería fallar")
	}

	// El asistente la ve en su panel como tarea observada, con el motivo y la semana.
	ov, err := svc.AssistantOverview(SupervisorDashboardParams{PeriodYM: "2026-07", AllowedCompanyIDs: []uint{co.ID}})
	if err != nil {
		t.Fatalf("AssistantOverview: %v", err)
	}
	var item *AssistantWorkItem
	for i := range ov.Work {
		if ov.Work[i].ModuleKey == models.SupervisorDeclSunatInbox {
			item = &ov.Work[i]
		}
	}
	if item == nil || item.State != "observada" || item.Note != "Falta la hoja 2 de la captura" || item.NoteBy != "Claudia" || item.WeekStart != week || item.Detail == "" {
		t.Fatalf("tarea del panel = %+v", item)
	}
	if ov.Counts.Observed != 1 {
		t.Fatalf("observadas = %d, want 1", ov.Counts.Observed)
	}

	// Subir la captura corregida levanta la observación: vuelve a "cargado" y sin motivo.
	fixed, err := svc.UploadMailboxCapture(co.ID, "2026-07", week, 1, models.SupervisorMailboxTypeSunat, "captura-completa.pdf", []byte("%PDF-2"), ana.ID)
	if err != nil {
		t.Fatalf("re-upload: %v", err)
	}
	if fixed.Sunat.Status != models.SupervisorMailboxStatusCargado || fixed.Sunat.Observation != "" || fixed.Sunat.ObservedAt != nil {
		t.Fatalf("tras corregir = %+v, want cargado sin observación", fixed.Sunat)
	}
	ov, _ = svc.AssistantOverview(SupervisorDashboardParams{PeriodYM: "2026-07", AllowedCompanyIDs: []uint{co.ID}})
	if ov.Counts.Observed != 0 {
		t.Fatalf("observadas tras levantar = %d, want 0", ov.Counts.Observed)
	}
	// Ya corregida, el supervisor sí puede verificarla.
	ver, err := svc.VerifyMailboxCapture(up.ID, "sunat", sup.ID, allowed)
	if err != nil || ver.Sunat.Status != models.SupervisorMailboxStatusVerificado {
		t.Fatalf("verificar tras corregir: %v / %+v", err, ver)
	}

	// El filtro del listado "con observaciones" encuentra el buzón observado.
	if !companyMatchesMailboxFilter([]SunatInboxCaptureSlot{{Sunat: SunatInboxMailboxSide{Status: "observado"}, Sunafil: SunatInboxMailboxSide{Status: "pendiente"}}}, "observado") {
		t.Fatal("el filtro observado debe encontrar un buzón observado")
	}
	if companyMatchesMailboxFilter([]SunatInboxCaptureSlot{{Sunat: SunatInboxMailboxSide{Status: "cargado"}}}, "observado") {
		t.Fatal("el filtro observado no debe encontrar un buzón cargado")
	}
}
