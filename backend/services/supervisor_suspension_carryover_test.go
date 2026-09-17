package services

// Cubre el modal de arrastre de suspensión entre períodos (docs/diseno-limpieza-control-detail-2026-
// 09-16.md §5.9.9): status del modal, aplicar la decisión (mantener/reactivar por empresa), y el
// compare-and-swap de concurrencia (§5.9.9.4 — gana quien guarda primero).

import (
	"testing"

	"miappfiber/database"
	"miappfiber/models"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

func setupSuspensionCarryOverTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("sqlite: %v", err)
	}
	if err := db.AutoMigrate(
		&models.Company{},
		&models.SupervisorPeriod{},
		&models.SupervisorMonthlyControl{},
		&models.SupervisorDeclaration{},
		&models.SupervisorAttachment{},
		&models.CompanyAccessCredential{},
	); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	database.DB = db
	return db
}

// seedSuspendidaControl crea (o marca) el control mensual de una empresa en un período con
// Suspendida=true — simula lo que dejó Control de Detracciones el mes anterior.
func seedSuspendidaControl(t *testing.T, db *gorm.DB, companyID uint, periodYM string) {
	t.Helper()
	ctrl := models.SupervisorMonthlyControl{
		CompanyID: companyID, PeriodYM: periodYM,
		GeneralStatus: models.SupervisorControlPendiente, RiskLevel: models.SupervisorRiskBajo,
		Suspendida: true,
	}
	if err := db.Create(&ctrl).Error; err != nil {
		t.Fatalf("seed control suspendida: %v", err)
	}
}

func TestSuspensionCarryOverStatus_ListsPreviousPeriodSuspended(t *testing.T) {
	db := setupSuspensionCarryOverTestDB(t)
	svc := NewSupervisorService()
	prevYM, curYM := "2026-06", "2026-07"

	coA := seedEstudioCompany(t, db, "S001")
	coB := seedEstudioCompany(t, db, "S002")
	coC := seedEstudioCompany(t, db, "S003")
	seedSuspendidaControl(t, db, coA.ID, prevYM)
	seedSuspendidaControl(t, db, coB.ID, prevYM)
	// coC: sin control suspendido en prevYM — no debe aparecer en la lista.

	if _, err := svc.CreatePeriod(curYM, "test"); err != nil {
		t.Fatalf("CreatePeriod: %v", err)
	}

	status, err := svc.GetSuspensionCarryOverStatus(curYM, nil)
	if err != nil {
		t.Fatalf("GetSuspensionCarryOverStatus: %v", err)
	}
	if !status.Pending {
		t.Fatalf("Pending=false, want true (hay 2 empresas suspendidas en %s)", prevYM)
	}
	if len(status.Companies) != 2 {
		t.Fatalf("Companies=%d, want 2 (%+v)", len(status.Companies), status.Companies)
	}
	ids := map[uint]bool{}
	for _, c := range status.Companies {
		ids[c.CompanyID] = true
	}
	if !ids[coA.ID] || !ids[coB.ID] {
		t.Fatalf("Companies=%+v, want incluir coA=%d y coB=%d", status.Companies, coA.ID, coB.ID)
	}
	if ids[coC.ID] {
		t.Fatalf("coC (%d) no debía aparecer — no estaba suspendida en %s", coC.ID, prevYM)
	}
}

func TestSuspensionCarryOverStatus_NoPendingWhenPreviousPeriodHasNoneSuspended(t *testing.T) {
	db := setupSuspensionCarryOverTestDB(t)
	svc := NewSupervisorService()
	curYM := "2026-07"
	_ = seedEstudioCompany(t, db, "S010")
	if _, err := svc.CreatePeriod(curYM, "test"); err != nil {
		t.Fatalf("CreatePeriod: %v", err)
	}

	status, err := svc.GetSuspensionCarryOverStatus(curYM, nil)
	if err != nil {
		t.Fatalf("GetSuspensionCarryOverStatus: %v", err)
	}
	if status.Pending {
		t.Fatalf("Pending=true, want false (nadie suspendido el período anterior)")
	}
}

func TestApplySuspensionCarryOver_KeepsSelectedReactivatesRest(t *testing.T) {
	db := setupSuspensionCarryOverTestDB(t)
	svc := NewSupervisorService()
	prevYM, curYM := "2026-06", "2026-07"

	coA := seedEstudioCompany(t, db, "S020")
	coB := seedEstudioCompany(t, db, "S021")
	seedSuspendidaControl(t, db, coA.ID, prevYM)
	seedSuspendidaControl(t, db, coB.ID, prevYM)
	if _, err := svc.CreatePeriod(curYM, "test"); err != nil {
		t.Fatalf("CreatePeriod: %v", err)
	}

	// Solo coA se mantiene suspendida; coB queda implícitamente reactivada (no se incluye).
	if err := svc.ApplySuspensionCarryOver(curYM, []uint{coA.ID}, nil); err != nil {
		t.Fatalf("ApplySuspensionCarryOver: %v", err)
	}

	detA, err := svc.EnsureDetracciones(coA.ID, curYM)
	if err != nil {
		t.Fatalf("EnsureDetracciones coA: %v", err)
	}
	if !detA.Suspendida {
		t.Fatalf("coA.Suspendida=%v, want true (se mantuvo tildada)", detA.Suspendida)
	}
	detB, err := svc.EnsureDetracciones(coB.ID, curYM)
	if err != nil {
		t.Fatalf("EnsureDetracciones coB: %v", err)
	}
	if detB.Suspendida {
		t.Fatalf("coB.Suspendida=%v, want false (quedó reactivada, no se incluyó en la lista)", detB.Suspendida)
	}

	var period models.SupervisorPeriod
	if err := db.Where("period_ym = ?", curYM).First(&period).Error; err != nil {
		t.Fatalf("cargar período: %v", err)
	}
	if !period.SuspensionCarryOverResolved {
		t.Fatal("SuspensionCarryOverResolved=false, want true tras aplicar la decisión")
	}

	// El modal ya no debe mostrarse de nuevo para este período.
	status, err := svc.GetSuspensionCarryOverStatus(curYM, nil)
	if err != nil {
		t.Fatalf("GetSuspensionCarryOverStatus tras resolver: %v", err)
	}
	if status.Pending {
		t.Fatal("Pending=true tras resolver, want false")
	}
}

// TestApplySuspensionCarryOver_SecondAttemptFailsCleanly simula la concurrencia de §5.9.9.4 (dos
// usuarios resolviendo el mismo modal) llamando ApplySuspensionCarryOver dos veces seguidas sobre el
// mismo período — el segundo intento debe fallar sin tocar la decisión que ya quedó aplicada por el
// primero (mismo código, gana quien gana el UPDATE con RowsAffected=1 primero).
func TestApplySuspensionCarryOver_SecondAttemptFailsCleanly(t *testing.T) {
	db := setupSuspensionCarryOverTestDB(t)
	svc := NewSupervisorService()
	prevYM, curYM := "2026-06", "2026-07"

	coA := seedEstudioCompany(t, db, "S030")
	coB := seedEstudioCompany(t, db, "S031")
	seedSuspendidaControl(t, db, coA.ID, prevYM)
	seedSuspendidaControl(t, db, coB.ID, prevYM)
	if _, err := svc.CreatePeriod(curYM, "test"); err != nil {
		t.Fatalf("CreatePeriod: %v", err)
	}

	// Usuario 1: mantiene coA suspendida, reactiva coB.
	if err := svc.ApplySuspensionCarryOver(curYM, []uint{coA.ID}, nil); err != nil {
		t.Fatalf("primer ApplySuspensionCarryOver: %v", err)
	}

	// Usuario 2 (llega "después"): intenta una decisión distinta — mantener coB en vez de coA.
	err := svc.ApplySuspensionCarryOver(curYM, []uint{coB.ID}, nil)
	if err == nil {
		t.Fatal("el segundo ApplySuspensionCarryOver debía fallar (arrastre ya resuelto)")
	}

	// La decisión vigente sigue siendo la del primer usuario — coA suspendida, coB no.
	detA, err := svc.EnsureDetracciones(coA.ID, curYM)
	if err != nil {
		t.Fatalf("EnsureDetracciones coA: %v", err)
	}
	if !detA.Suspendida {
		t.Fatal("coA.Suspendida=false, want true — el segundo intento no debía pisar la decisión del primero")
	}
	detB, err := svc.EnsureDetracciones(coB.ID, curYM)
	if err != nil {
		t.Fatalf("EnsureDetracciones coB: %v", err)
	}
	if detB.Suspendida {
		t.Fatal("coB.Suspendida=true, want false — el segundo intento no debía aplicar ningún cambio")
	}
}
