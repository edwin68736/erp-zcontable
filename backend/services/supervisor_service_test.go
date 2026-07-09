package services

import (
	"testing"
	"time"

	"miappfiber/database"
	"miappfiber/models"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

func setupSupervisorTestDB(t *testing.T) *gorm.DB {
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
		&models.SupervisorTaxLiquidation{},
		&models.SupervisorNPS{},
		&models.SupervisorNotification{},
	); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	database.DB = db
	return db
}

func seedActiveCompany(t *testing.T, db *gorm.DB, code string) models.Company {
	t.Helper()
	co := models.Company{
		RUC:          "20" + code + "1",
		BusinessName: "Empresa " + code,
		InternalCode: code,
		Status:       "activo",
	}
	if err := db.Create(&co).Error; err != nil {
		t.Fatalf("company: %v", err)
	}
	return co
}

func TestBootstrapControlsForPeriod(t *testing.T) {
	db := setupSupervisorTestDB(t)
	svc := NewSupervisorService()

	seedActiveCompany(t, db, "A001")
	seedActiveCompany(t, db, "A002")

	period, err := svc.CreatePeriod("2026-05", "test")
	if err != nil {
		t.Fatalf("CreatePeriod: %v", err)
	}
	if period.PeriodYM != "2026-05" {
		t.Fatalf("period_ym: %s", period.PeriodYM)
	}

	res, err := svc.BootstrapControlsForPeriod("2026-05", nil)
	if err != nil {
		t.Fatalf("Bootstrap: %v", err)
	}
	if res.Created != 2 {
		t.Fatalf("created=%d want 2", res.Created)
	}
	if res.Skipped != 0 {
		t.Fatalf("skipped=%d want 0", res.Skipped)
	}

	res2, err := svc.BootstrapControlsForPeriod("2026-05", nil)
	if err != nil {
		t.Fatalf("Bootstrap again: %v", err)
	}
	if res2.Created != 0 || res2.Skipped != 2 {
		t.Fatalf("second bootstrap created=%d skipped=%d", res2.Created, res2.Skipped)
	}

	var declCount int64
	if err := db.Model(&models.SupervisorDeclaration{}).Count(&declCount).Error; err != nil {
		t.Fatal(err)
	}
	if declCount != 8 { // 2 companies * 4 declaration types
		t.Fatalf("declarations=%d want 8", declCount)
	}
}

func approveControlForClose(t *testing.T, db *gorm.DB, controlID uint) {
	t.Helper()
	okDecl := []string{models.SupervisorDeclAprobado, models.SupervisorDeclPresentado, models.SupervisorDeclCerrado}
	types := []string{models.SupervisorDeclPDT601, models.SupervisorDeclPDT621, models.SupervisorDeclSIRE}
	for _, typ := range types {
		if err := db.Model(&models.SupervisorDeclaration{}).
			Where("monthly_control_id = ? AND declaration_type = ?", controlID, typ).
			Update("status", okDecl[0]).Error; err != nil {
			t.Fatalf("decl %s: %v", typ, err)
		}
	}
	if err := db.Model(&models.SupervisorTaxLiquidation{}).
		Where("monthly_control_id = ?", controlID).
		Update("validation_status", models.SupervisorLiqAprobada).Error; err != nil {
		t.Fatalf("liq: %v", err)
	}
	if err := db.Model(&models.SupervisorMonthlyControl{}).
		Where("id = ?", controlID).
		Update("general_status", models.SupervisorControlAlDia).Error; err != nil {
		t.Fatalf("control: %v", err)
	}
}

func TestClosePeriodSuccess(t *testing.T) {
	db := setupSupervisorTestDB(t)
	svc := NewSupervisorService()

	seedActiveCompany(t, db, "B001")
	p, _ := svc.CreatePeriod("2026-04", "")
	_, _ = svc.BootstrapControlsForPeriod("2026-04", nil)

	var controls []models.SupervisorMonthlyControl
	if err := db.Where("period_ym = ?", "2026-04").Find(&controls).Error; err != nil {
		t.Fatal(err)
	}
	for _, c := range controls {
		approveControlForClose(t, db, c.ID)
	}

	closed, err := svc.ClosePeriod(p.ID, 1)
	if err != nil {
		t.Fatalf("ClosePeriod: %v", err)
	}
	if closed.Status != models.SupervisorPeriodClosed {
		t.Fatalf("status=%s", closed.Status)
	}
	if closed.ClosedAt == nil {
		t.Fatal("expected closed_at")
	}
}

func TestClosePeriodFailsWhenDeclarationPending(t *testing.T) {
	db := setupSupervisorTestDB(t)
	svc := NewSupervisorService()

	seedActiveCompany(t, db, "C001")
	p, _ := svc.CreatePeriod("2026-03", "")
	_, _ = svc.BootstrapControlsForPeriod("2026-03", nil)

	var ctrl models.SupervisorMonthlyControl
	if err := db.Where("period_ym = ?", "2026-03").First(&ctrl).Error; err != nil {
		t.Fatal(err)
	}
	approveControlForClose(t, db, ctrl.ID)
	_ = db.Model(&models.SupervisorDeclaration{}).
		Where("monthly_control_id = ? AND declaration_type = ?", ctrl.ID, models.SupervisorDeclPDT601).
		Update("status", models.SupervisorDeclPendiente).Error

	_, err := svc.ClosePeriod(p.ID, 1)
	if err == nil {
		t.Fatal("expected close to fail when 601 is pending")
	}
}

func TestNotifyIfNewDedup(t *testing.T) {
	setupSupervisorTestDB(t)
	svc := NewSupervisorService()
	cid := uint(9)
	svc.notifyIfNew(1, "overdue", "T", "M", "2026-05", &cid)
	svc.notifyIfNew(1, "overdue", "T", "M", "2026-05", &cid)

	var n int64
	_ = database.DB.Model(&models.SupervisorNotification{}).
		Where("user_id = ? AND kind = ? AND read_at IS NULL", 1, "overdue").Count(&n).Error
	if n != 1 {
		t.Fatalf("notifications=%d want 1 (dedup)", n)
	}
}

func TestSyncOverdueNPS(t *testing.T) {
	db := setupSupervisorTestDB(t)
	svc := NewSupervisorService()

	co := seedActiveCompany(t, db, "D001")
	past := time.Now().AddDate(0, 0, -2)
	ctrl := models.SupervisorMonthlyControl{CompanyID: co.ID, PeriodYM: "2026-06", GeneralStatus: models.SupervisorControlPendiente, RiskLevel: models.SupervisorRiskBajo}
	if err := db.Create(&ctrl).Error; err != nil {
		t.Fatal(err)
	}
	nps := models.SupervisorNPS{
		MonthlyControlID: ctrl.ID,
		Tributo:          "IGV",
		Importe:          100,
		PaymentDueDate:   &past,
		PaymentStatus:    models.SupervisorNPSPendientePago,
	}
	if err := db.Create(&nps).Error; err != nil {
		t.Fatal(err)
	}

	n, err := svc.SyncOverdueNPS("2026-06")
	if err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("synced=%d want 1", n)
	}
	var updated models.SupervisorNPS
	_ = db.First(&updated, nps.ID)
	if updated.PaymentStatus != models.SupervisorNPSVencido {
		t.Fatalf("status=%s", updated.PaymentStatus)
	}
}

func TestEnsureMonthlyPeriodOpen(t *testing.T) {
	setupSupervisorTestDB(t)
	svc := NewSupervisorService()

	p1, err := svc.EnsureMonthlyPeriodOpen("2026-07")
	if err != nil || p1.PeriodYM != "2026-07" {
		t.Fatalf("first: %v", err)
	}
	p2, err := svc.EnsureMonthlyPeriodOpen("2026-07")
	if err != nil || p2.ID != p1.ID {
		t.Fatalf("second: %v id %d vs %d", err, p2.ID, p1.ID)
	}
}
