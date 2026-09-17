package database

import (
	"testing"
	"time"

	"miappfiber/models"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

func setupPdt601Pdt621MigrationTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("sqlite: %v", err)
	}
	if err := db.AutoMigrate(
		&models.SupervisorDeclaration{},
		&models.SupervisorPdt601Planilla{},
		&models.SupervisorPdt621Record{},
		&models.SchemaMigration{},
	); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	return db
}

func mustCreateDeclaration(t *testing.T, db *gorm.DB, controlID uint, declType, status string) *models.SupervisorDeclaration {
	t.Helper()
	d := &models.SupervisorDeclaration{
		MonthlyControlID: controlID,
		DeclarationType:  declType,
		Status:           status,
	}
	if err := db.Create(d).Error; err != nil {
		t.Fatalf("create declaración: %v", err)
	}
	return d
}

// TestMigratePdt601Pdt621StatusEnum_AprobadoPresentadoCerradoBecomeEntregado cubre el caso más
// común en producción: declaraciones ya aprobadas antes del rediseño (docs/diseno-estados-pdt601-
// pdt621-2026-09-16.md) deben quedar "entregado", sin importar si tienen fecha de entrega cargada.
func TestMigratePdt601Pdt621StatusEnum_AprobadoPresentadoCerradoBecomeEntregado(t *testing.T) {
	db := setupPdt601Pdt621MigrationTestDB(t)
	d1 := mustCreateDeclaration(t, db, 1, models.SupervisorDeclPDT601, models.SupervisorDeclAprobado)
	d2 := mustCreateDeclaration(t, db, 2, models.SupervisorDeclPDT621, models.SupervisorDeclPresentado)
	d3 := mustCreateDeclaration(t, db, 3, models.SupervisorDeclPDT601, models.SupervisorDeclCerrado)

	if err := migratePdt601Pdt621StatusEnum(db); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	for _, d := range []*models.SupervisorDeclaration{d1, d2, d3} {
		var got models.SupervisorDeclaration
		if err := db.First(&got, d.ID).Error; err != nil {
			t.Fatalf("reload declaración %d: %v", d.ID, err)
		}
		if got.Status != models.SupervisorDeclEntregado {
			t.Errorf("declaración %d: status = %q, want %q", d.ID, got.Status, models.SupervisorDeclEntregado)
		}
		if got.ProgressPct != 100 {
			t.Errorf("declaración %d: progress_pct = %v, want 100", d.ID, got.ProgressPct)
		}
	}
}

// TestMigratePdt601Pdt621StatusEnum_LegacyDraftWithFechaEntregaBecomesPorRevisar cubre en_elaboracion/
// en_revision con la planilla/registro ya entregado (fecha de entrega cargada) — mismo criterio que
// el "entregar automático" de SavePdt601Planilla/SavePdt621Record.
func TestMigratePdt601Pdt621StatusEnum_LegacyDraftWithFechaEntregaBecomesPorRevisar(t *testing.T) {
	db := setupPdt601Pdt621MigrationTestDB(t)
	d1 := mustCreateDeclaration(t, db, 10, models.SupervisorDeclPDT601, models.SupervisorDeclEnElaboracion)
	fecha := time.Date(2026, 8, 15, 0, 0, 0, 0, time.Local)
	if err := db.Create(&models.SupervisorPdt601Planilla{MonthlyControlID: 10, FechaEntrega: &fecha}).Error; err != nil {
		t.Fatalf("create planilla: %v", err)
	}
	d2 := mustCreateDeclaration(t, db, 11, models.SupervisorDeclPDT621, models.SupervisorDeclEnRevision)
	if err := db.Create(&models.SupervisorPdt621Record{MonthlyControlID: 11, PrimeraEntregaFecha: &fecha}).Error; err != nil {
		t.Fatalf("create record: %v", err)
	}

	if err := migratePdt601Pdt621StatusEnum(db); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	for _, d := range []*models.SupervisorDeclaration{d1, d2} {
		var got models.SupervisorDeclaration
		if err := db.First(&got, d.ID).Error; err != nil {
			t.Fatalf("reload declaración %d: %v", d.ID, err)
		}
		if got.Status != models.SupervisorDeclPorRevisar {
			t.Errorf("declaración %d: status = %q, want %q", d.ID, got.Status, models.SupervisorDeclPorRevisar)
		}
		if got.ProgressPct != 65 {
			t.Errorf("declaración %d: progress_pct = %v, want 65", d.ID, got.ProgressPct)
		}
	}
}

// TestMigratePdt601Pdt621StatusEnum_LegacyDraftWithoutFechaEntregaBecomesPendiente cubre en_elaboracion/
// en_revision sin fecha de entrega cargada (o sin fila de planilla/registro siquiera) — no hay señal
// real de que el asistente haya entregado algo, así que cae a "pendiente".
func TestMigratePdt601Pdt621StatusEnum_LegacyDraftWithoutFechaEntregaBecomesPendiente(t *testing.T) {
	db := setupPdt601Pdt621MigrationTestDB(t)
	d1 := mustCreateDeclaration(t, db, 20, models.SupervisorDeclPDT601, models.SupervisorDeclEnRevision)
	if err := db.Create(&models.SupervisorPdt601Planilla{MonthlyControlID: 20}).Error; err != nil {
		t.Fatalf("create planilla: %v", err)
	}
	// PDT621 sin fila de registro en absoluto (nunca se guardó nada).
	d2 := mustCreateDeclaration(t, db, 21, models.SupervisorDeclPDT621, models.SupervisorDeclEnElaboracion)

	if err := migratePdt601Pdt621StatusEnum(db); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	for _, d := range []*models.SupervisorDeclaration{d1, d2} {
		var got models.SupervisorDeclaration
		if err := db.First(&got, d.ID).Error; err != nil {
			t.Fatalf("reload declaración %d: %v", d.ID, err)
		}
		if got.Status != models.SupervisorDeclPendiente {
			t.Errorf("declaración %d: status = %q, want %q", d.ID, got.Status, models.SupervisorDeclPendiente)
		}
		if got.ProgressPct != 0 {
			t.Errorf("declaración %d: progress_pct = %v, want 0", d.ID, got.ProgressPct)
		}
	}
}

// TestMigratePdt601Pdt621StatusEnum_LeavesValidAndOtherTypesUntouched valida que declaraciones ya en
// el enum nuevo (observado/pendiente/por_revisar/entregado) y declaraciones de otros tipos (sire,
// detracciones, etc. — fuera de alcance del rediseño) no se toquen.
func TestMigratePdt601Pdt621StatusEnum_LeavesValidAndOtherTypesUntouched(t *testing.T) {
	db := setupPdt601Pdt621MigrationTestDB(t)
	already := mustCreateDeclaration(t, db, 30, models.SupervisorDeclPDT601, models.SupervisorDeclObservado)
	// progress_pct deliberadamente distinto del que calcularía la migración, para detectar si la
	// tocó por error (no debería, porque "observado" ya es un valor válido del enum nuevo).
	sentinel := 7
	already.ProgressPct = sentinel
	if err := db.Save(already).Error; err != nil {
		t.Fatalf("seed progress_pct: %v", err)
	}
	otherType := mustCreateDeclaration(t, db, 31, models.SupervisorDeclSIRE, models.SupervisorDeclAprobado)

	if err := migratePdt601Pdt621StatusEnum(db); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	var gotAlready models.SupervisorDeclaration
	if err := db.First(&gotAlready, already.ID).Error; err != nil {
		t.Fatalf("reload: %v", err)
	}
	if gotAlready.Status != models.SupervisorDeclObservado {
		t.Errorf("status cambió de forma inesperada: %q", gotAlready.Status)
	}
	if gotAlready.ProgressPct != sentinel {
		t.Errorf("progress_pct se sobrescribió: %v, want %d", gotAlready.ProgressPct, sentinel)
	}

	var gotOther models.SupervisorDeclaration
	if err := db.First(&gotOther, otherType.ID).Error; err != nil {
		t.Fatalf("reload: %v", err)
	}
	if gotOther.Status != models.SupervisorDeclAprobado {
		t.Errorf("declaración de otro tipo (sire) se tocó: status = %q", gotOther.Status)
	}
}

// TestMigratePdt601Pdt621StatusEnum_Idempotent corrida repetida no debe fallar ni volver a tocar filas
// ya migradas (mismo criterio de applyMigrationOnce, pero acá se prueba la función interna sola).
func TestMigratePdt601Pdt621StatusEnum_Idempotent(t *testing.T) {
	db := setupPdt601Pdt621MigrationTestDB(t)
	d := mustCreateDeclaration(t, db, 40, models.SupervisorDeclPDT601, models.SupervisorDeclAprobado)

	if err := migratePdt601Pdt621StatusEnum(db); err != nil {
		t.Fatalf("primera corrida: %v", err)
	}
	if err := migratePdt601Pdt621StatusEnum(db); err != nil {
		t.Fatalf("segunda corrida: %v", err)
	}

	var got models.SupervisorDeclaration
	if err := db.First(&got, d.ID).Error; err != nil {
		t.Fatalf("reload: %v", err)
	}
	if got.Status != models.SupervisorDeclEntregado {
		t.Errorf("status = %q, want %q", got.Status, models.SupervisorDeclEntregado)
	}
}
