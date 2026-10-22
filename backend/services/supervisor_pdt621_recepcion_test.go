package services

// Recepción del archivador PDT 621: la fecha/hora la fija el servidor y solo la registra el
// supervisor asignado a la empresa. Deja la declaración igual que antes la dejaba la entrega del
// asistente (Por revisar). Pendiente → 1ra entrega; Observado → 2da entrega (la 1ra no se toca).

import (
	"encoding/json"
	"errors"
	"testing"
	"time"

	"miappfiber/database"
	"miappfiber/models"
	"miappfiber/rbac"
)

const testPdt621SupervisorID uint = 9

// recepcionarPdt621EnFecha simula que el supervisor asignado recepciona el archivador el día `fecha`
// (AAAA-MM-DD, 10:15 hora de Lima). Asigna testPdt621SupervisorID como supervisor de la empresa si
// aún no tiene uno — reemplaza al viejo SavePdt621Record{PrimeraEntregaFecha: ...} de los tests.
func recepcionarPdt621EnFecha(t *testing.T, svc *SupervisorService, companyID uint, periodYM, fecha string) (*Pdt621Detail, error) {
	t.Helper()
	if err := database.DB.Model(&models.Company{}).
		Where("id = ? AND supervisor_user_id IS NULL", companyID).
		Update("supervisor_user_id", testPdt621SupervisorID).Error; err != nil {
		t.Fatalf("asignar supervisor: %v", err)
	}
	d, err := time.ParseInLocation("2006-01-02", fecha, limaLoc)
	if err != nil {
		t.Fatalf("fecha inválida %q: %v", fecha, err)
	}
	prev := pdt621Now
	pdt621Now = func() time.Time { return d.Add(10*time.Hour + 15*time.Minute) }
	defer func() { pdt621Now = prev }()

	var supID uint
	if err := database.DB.Model(&models.Company{}).Where("id = ?", companyID).
		Pluck("supervisor_user_id", &supID).Error; err != nil {
		t.Fatalf("leer supervisor: %v", err)
	}
	return svc.RecepcionarPdt621(companyID, periodYM, supID)
}

func TestRecepcionarPdt621_DesdePendiente_GrabaPrimeraConHoraDelServidor(t *testing.T) {
	db := setupPdt621TestDB(t)
	svc := NewSupervisorService()
	co := seedEstudioCompany(t, db, "R001")
	if _, err := svc.CreatePeriod("2026-07", "test"); err != nil {
		t.Fatalf("CreatePeriod: %v", err)
	}

	// 03:30 UTC del 11 = 22:30 del 10 en Lima: la fecha debe salir en hora de Lima.
	sup := uint(42)
	db.Model(&models.Company{}).Where("id = ?", co.ID).Update("supervisor_user_id", sup)
	prev := pdt621Now
	pdt621Now = func() time.Time { return time.Date(2026, 7, 11, 3, 30, 0, 0, time.UTC) }
	defer func() { pdt621Now = prev }()

	detail, err := svc.RecepcionarPdt621(co.ID, "2026-07", sup)
	if err != nil {
		t.Fatalf("RecepcionarPdt621: %v", err)
	}
	if detail.Declaration.Status != models.SupervisorDeclPorRevisar {
		t.Fatalf("Status=%s, want por_revisar", detail.Declaration.Status)
	}
	r := detail.Record
	if r == nil || r.PrimeraEntregaFecha == nil || *r.PrimeraEntregaFecha != "2026-07-10" || r.PrimeraEntregaHora != "22:30" {
		t.Fatalf("1ra entrega = %+v, want 2026-07-10 22:30 (hora de Lima)", r)
	}
	if r.SegundaEntregaFecha != nil {
		t.Fatalf("2da entrega no debía llenarse: %v", *r.SegundaEntregaFecha)
	}
	var rec models.SupervisorPdt621Record
	db.Where("monthly_control_id = ?", detail.ControlID).First(&rec)
	if rec.PrimeraRecepcionPor == nil || *rec.PrimeraRecepcionPor != sup {
		t.Fatalf("PrimeraRecepcionPor=%v, want %d", rec.PrimeraRecepcionPor, sup)
	}
}

func TestRecepcionarPdt621_SoloSupervisorAsignado(t *testing.T) {
	db := setupPdt621TestDB(t)
	svc := NewSupervisorService()
	co := seedEstudioCompany(t, db, "R002")
	if _, err := svc.CreatePeriod("2026-07", "test"); err != nil {
		t.Fatalf("CreatePeriod: %v", err)
	}

	// Sin supervisor asignado: nadie puede.
	if _, err := svc.RecepcionarPdt621(co.ID, "2026-07", 42); !errors.Is(err, ErrPdt621RecepcionNoAsignado) {
		t.Fatalf("sin supervisor asignado: err=%v, want ErrPdt621RecepcionNoAsignado", err)
	}
	// Otro usuario (otro supervisor, el asistente, un admin): tampoco.
	db.Model(&models.Company{}).Where("id = ?", co.ID).Update("supervisor_user_id", 42)
	if _, err := svc.RecepcionarPdt621(co.ID, "2026-07", 77); !errors.Is(err, ErrPdt621RecepcionNoAsignado) {
		t.Fatalf("otro usuario: err=%v, want ErrPdt621RecepcionNoAsignado", err)
	}
	d, _ := svc.EnsurePdt621(co.ID, "2026-07")
	if d.Declaration.Status != models.SupervisorDeclPendiente || d.Record != nil {
		t.Fatalf("un rechazo no debía tocar nada: status=%s record=%+v", d.Declaration.Status, d.Record)
	}
	if _, err := svc.RecepcionarPdt621(co.ID, "2026-07", 42); err != nil {
		t.Fatalf("supervisor asignado: %v", err)
	}
}

func TestRecepcionarPdt621_NoSeRecepcionaDosVeces(t *testing.T) {
	db := setupPdt621TestDB(t)
	svc := NewSupervisorService()
	co := seedEstudioCompany(t, db, "R003")
	if _, err := svc.CreatePeriod("2026-07", "test"); err != nil {
		t.Fatalf("CreatePeriod: %v", err)
	}
	detail, err := recepcionarPdt621EnFecha(t, svc, co.ID, "2026-07", "2026-07-10")
	if err != nil {
		t.Fatalf("1ra recepción: %v", err)
	}
	// Por revisar: no se vuelve a recepcionar (no se pisa la 1ra entrega).
	if _, err := recepcionarPdt621EnFecha(t, svc, co.ID, "2026-07", "2026-07-12"); err == nil {
		t.Fatal("en Por revisar no se debía poder recepcionar otra vez")
	}
	// Entregado: tampoco.
	if _, err := svc.ApproveDeclaration(detail.Declaration.ID, testPdt621SupervisorID); err != nil {
		t.Fatalf("Approve: %v", err)
	}
	if _, err := recepcionarPdt621EnFecha(t, svc, co.ID, "2026-07", "2026-07-12"); err == nil {
		t.Fatal("en Entregado no se debía poder recepcionar")
	}
	d, _ := svc.EnsurePdt621(co.ID, "2026-07")
	if *d.Record.PrimeraEntregaFecha != "2026-07-10" {
		t.Fatalf("1ra entrega cambió a %s", *d.Record.PrimeraEntregaFecha)
	}
}

func TestRecepcionarPdt621_TrasObservacion_GrabaSegundaYConservaPrimera(t *testing.T) {
	db := setupPdt621TestDB(t)
	svc := NewSupervisorService()
	co := seedEstudioCompany(t, db, "R004")
	if _, err := svc.CreatePeriod("2026-07", "test"); err != nil {
		t.Fatalf("CreatePeriod: %v", err)
	}
	detail, err := recepcionarPdt621EnFecha(t, svc, co.ID, "2026-07", "2026-07-10")
	if err != nil {
		t.Fatalf("1ra recepción: %v", err)
	}
	if _, err := svc.ObserveDeclaration(detail.Declaration.ID, testPdt621SupervisorID, "Falta la hoja de compras"); err != nil {
		t.Fatalf("Observe: %v", err)
	}
	detail, err = recepcionarPdt621EnFecha(t, svc, co.ID, "2026-07", "2026-07-14")
	if err != nil {
		t.Fatalf("2da recepción: %v", err)
	}
	if detail.Declaration.Status != models.SupervisorDeclPorRevisar {
		t.Fatalf("Status=%s, want por_revisar (igual que la 1ra, para revisar de nuevo)", detail.Declaration.Status)
	}
	r := detail.Record
	if *r.PrimeraEntregaFecha != "2026-07-10" || r.PrimeraEntregaHora != "10:15" {
		t.Fatalf("la 1ra entrega no debía tocarse: %s %s", *r.PrimeraEntregaFecha, r.PrimeraEntregaHora)
	}
	if r.SegundaEntregaFecha == nil || *r.SegundaEntregaFecha != "2026-07-14" {
		t.Fatalf("2da entrega=%v, want 2026-07-14", r.SegundaEntregaFecha)
	}
	// Tras la 2da se aprueba como siempre.
	if _, err := svc.ApproveDeclaration(detail.Declaration.ID, testPdt621SupervisorID); err != nil {
		t.Fatalf("Approve tras 2da recepción: %v", err)
	}
}

func TestSavePdt621Record_IgnoraFechasDeEntregaDelCliente(t *testing.T) {
	db := setupPdt621TestDB(t)
	svc := NewSupervisorService()
	co := seedEstudioCompany(t, db, "R005")
	if _, err := svc.CreatePeriod("2026-07", "test"); err != nil {
		t.Fatalf("CreatePeriod: %v", err)
	}
	if _, err := recepcionarPdt621EnFecha(t, svc, co.ID, "2026-07", "2026-07-20"); err != nil {
		t.Fatalf("recepción: %v", err)
	}
	// Un cliente que manda el JSON viejo con fechas "acomodadas": se descartan.
	var in Pdt621RecordInput
	if err := json.Unmarshal([]byte(`{"primera_entrega_fecha":"2026-07-01","primera_entrega_hora":"08:00","segunda_entrega_fecha":"2026-07-02","total_ventas":500}`), &in); err != nil {
		t.Fatalf("decode: %v", err)
	}
	d, err := svc.SavePdt621Record(co.ID, "2026-07", in)
	if err != nil {
		t.Fatalf("SavePdt621Record: %v", err)
	}
	if *d.Record.PrimeraEntregaFecha != "2026-07-20" || d.Record.PrimeraEntregaHora != "10:15" || d.Record.SegundaEntregaFecha != nil {
		t.Fatalf("las fechas de entrega cambiaron desde el formulario: %+v", d.Record)
	}
	if d.Record.TotalVentas != 500 {
		t.Fatalf("TotalVentas=%v, el resto del formulario sí debía guardarse", d.Record.TotalVentas)
	}
}

func TestSavePdt621Record_YaNoEntrega(t *testing.T) {
	db := setupPdt621TestDB(t)
	svc := NewSupervisorService()
	co := seedEstudioCompany(t, db, "R006")
	if _, err := svc.CreatePeriod("2026-07", "test"); err != nil {
		t.Fatalf("CreatePeriod: %v", err)
	}
	d, err := svc.SavePdt621Record(co.ID, "2026-07", Pdt621RecordInput{TotalVentas: 10})
	if err != nil {
		t.Fatalf("SavePdt621Record: %v", err)
	}
	if d.Declaration.Status != models.SupervisorDeclPendiente {
		t.Fatalf("Status=%s, want pendiente (guardar ya no entrega; solo Recepcionar)", d.Declaration.Status)
	}
}

func TestRecepcionarPdt621_AdministradorRecepcionaCualquierEmpresa(t *testing.T) {
	db := setupPdt621TestDB(t)
	if err := db.AutoMigrate(&models.Permission{}, &models.Role{}, &models.RolePermission{}, &models.UserRole{}); err != nil {
		t.Fatalf("migrate rbac: %v", err)
	}
	svc := NewSupervisorService()
	co := seedEstudioCompany(t, db, "R007")
	if _, err := svc.CreatePeriod("2026-07", "test"); err != nil {
		t.Fatalf("CreatePeriod: %v", err)
	}
	// La empresa la supervisa otro (42); 55 es administrador con el permiso de recepcionar cualquiera.
	db.Model(&models.Company{}).Where("id = ?", co.ID).Update("supervisor_user_id", 42)
	const admin uint = 55
	perm := models.Permission{ModuleID: 1, Code: rbac.SupervisorsPdt621ReceiveAny, Action: "receive", Name: "test"}
	role := models.Role{Code: rbac.RoleAdministrador, Name: "Administrador", IsSystem: true}
	db.Create(&perm)
	db.Create(&role)
	db.Create(&models.RolePermission{RoleID: role.ID, PermissionID: perm.ID})
	db.Create(&models.UserRole{UserID: admin, RoleID: role.ID})
	Authz().InvalidateAll()
	t.Cleanup(Authz().InvalidateAll)

	// Un supervisor que no es el asignado sigue sin poder.
	if _, err := svc.RecepcionarPdt621(co.ID, "2026-07", 77); !errors.Is(err, ErrPdt621RecepcionNoAsignado) {
		t.Fatalf("otro supervisor: err=%v, want ErrPdt621RecepcionNoAsignado", err)
	}
	d, err := svc.RecepcionarPdt621(co.ID, "2026-07", admin)
	if err != nil {
		t.Fatalf("administrador: %v", err)
	}
	if d.Declaration.Status != models.SupervisorDeclPorRevisar {
		t.Fatalf("Status=%s, want por_revisar", d.Declaration.Status)
	}
	var rec models.SupervisorPdt621Record
	db.Where("monthly_control_id = ?", d.ControlID).First(&rec)
	if rec.PrimeraRecepcionPor == nil || *rec.PrimeraRecepcionPor != admin {
		t.Fatalf("PrimeraRecepcionPor=%v, want %d (queda registrado que recepcionó el administrador)", rec.PrimeraRecepcionPor, admin)
	}
}

func TestPdt621Observacion_MotivoQuienYCuandoEnListaYDetalle(t *testing.T) {
	db := setupPdt621TestDB(t)
	if err := db.AutoMigrate(&models.SupervisorChangeLog{}); err != nil {
		t.Fatalf("migrate change log: %v", err)
	}
	svc := NewSupervisorService()
	co := seedEstudioCompany(t, db, "R008")
	if _, err := svc.CreatePeriod("2026-07", "test"); err != nil {
		t.Fatalf("CreatePeriod: %v", err)
	}
	d, err := recepcionarPdt621EnFecha(t, svc, co.ID, "2026-07", "2026-07-10")
	if err != nil {
		t.Fatalf("recepción: %v", err)
	}
	if _, err := svc.ObserveDeclaration(d.Declaration.ID, testPdt621SupervisorID, "Falta la hoja de compras"); err != nil {
		t.Fatalf("Observe: %v", err)
	}
	res, err := svc.ListPdt621(Pdt621ListParams{PeriodYM: "2026-07", Page: 1, PerPage: 20})
	if err != nil || len(res.Rows) != 1 {
		t.Fatalf("ListPdt621: %v (%d filas)", err, len(res.Rows))
	}
	row := res.Rows[0]
	if row.ObservacionMotivo != "Falta la hoja de compras" || row.ObservadoAt == nil {
		t.Fatalf("lista: motivo=%q at=%v", row.ObservacionMotivo, row.ObservadoAt)
	}
	det, err := svc.EnsurePdt621(co.ID, "2026-07")
	if err != nil {
		t.Fatalf("EnsurePdt621: %v", err)
	}
	if det.ObservacionMotivo != "Falta la hoja de compras" || det.ObservadoAt == nil {
		t.Fatalf("detalle: motivo=%q at=%v", det.ObservacionMotivo, det.ObservadoAt)
	}
	// Las notas adicionales (record.observacion) no se confunden con el motivo.
	if det.Record != nil && det.Record.Observacion == det.ObservacionMotivo {
		t.Fatal("el motivo de observar no debía copiarse a las notas adicionales")
	}
}
