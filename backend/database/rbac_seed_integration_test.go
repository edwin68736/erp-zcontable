package database

import (
	"strings"
	"testing"

	"miappfiber/models"
	"miappfiber/rbac"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

func setupRBACTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("sqlite: %v", err)
	}
	if err := db.AutoMigrate(
		&models.Module{}, &models.Permission{}, &models.Role{},
		&models.RolePermission{}, &models.UserRole{}, &models.User{},
		&models.SchemaMigration{},
	); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	prev := DB
	DB = db
	t.Cleanup(func() { DB = prev })
	return db
}

func roleCodes(t *testing.T, db *gorm.DB, roleCode string) map[string]struct{} {
	t.Helper()
	var codes []string
	if err := db.Table("permissions p").
		Joins("JOIN role_permissions rp ON rp.permission_id = p.id").
		Joins("JOIN roles r ON r.id = rp.role_id").
		Where("r.code = ?", roleCode).
		Pluck("p.code", &codes).Error; err != nil {
		t.Fatalf("roleCodes %s: %v", roleCode, err)
	}
	out := make(map[string]struct{}, len(codes))
	for _, c := range codes {
		out[c] = struct{}{}
	}
	return out
}

// TestSeedRBAC_derivesEverythingFromRegistry valida seed de permisos, grupos y matriz canónica.
func TestSeedRBAC_derivesEverythingFromRegistry(t *testing.T) {
	db := setupRBACTestDB(t)
	if err := SeedRBAC(db); err != nil {
		t.Fatalf("SeedRBAC: %v", err)
	}

	// Todos los permisos del registro existen exactamente una vez.
	var permCount int64
	db.Model(&models.Permission{}).Count(&permCount)
	if int(permCount) != len(rbac.AllPermissionCodes) {
		t.Fatalf("permisos en BD=%d want=%d", permCount, len(rbac.AllPermissionCodes))
	}

	// super_usuario tiene el catálogo completo.
	if got := roleCodes(t, db, rbac.RoleSuperusuario); len(got) != len(rbac.AllPermissionCodes) {
		t.Fatalf("super_usuario tiene %d permisos want %d", len(got), len(rbac.AllPermissionCodes))
	}

	// Contador no tiene el módulo supervisores.
	for c := range roleCodes(t, db, rbac.RoleContador) {
		if strings.HasPrefix(c, "supervisors.") {
			t.Fatalf("Contador no debería tener %q", c)
		}
	}

	// El módulo operativo y el subgrupo se sembraron según la taxonomía del sidebar.
	var ctrl models.Permission
	if err := db.Where("code = ?", rbac.SupervisorsControlsView).First(&ctrl).Error; err != nil {
		t.Fatalf("buscar permiso: %v", err)
	}
	if ctrl.Group != "Control de actividades" {
		t.Fatalf("group=%q want 'Control de actividades'", ctrl.Group)
	}
	var mod models.Module
	if err := db.First(&mod, ctrl.ModuleID).Error; err != nil {
		t.Fatalf("buscar módulo: %v", err)
	}
	if mod.Code != rbac.ModSupervisores {
		t.Fatalf("módulo=%q want %q", mod.Code, rbac.ModSupervisores)
	}

	// Solo existen los módulos operativos (los de dominio viejos fueron eliminados).
	var modCount int64
	db.Model(&models.Module{}).Count(&modCount)
	if modCount != 5 {
		t.Fatalf("módulos=%d want 5", modCount)
	}
}

// TestSeedRBAC_respectsAdminEdits: en re-deploys, los cambios del administrador a roles de
// sistema PERSISTEN; super_usuario se mantiene completo; y los permisos huérfanos se limpian.
func TestSeedRBAC_respectsAdminEdits(t *testing.T) {
	db := setupRBACTestDB(t)
	if err := SeedRBAC(db); err != nil {
		t.Fatalf("SeedRBAC 1: %v", err)
	}

	var contador models.Role
	db.Where("code = ?", rbac.RoleContador).First(&contador)

	// (a) Edición del admin: otorgar a Contador un permiso extra → debe PERSISTIR tras el re-deploy.
	var supPerm models.Permission
	db.Where("code = ?", rbac.SupervisorsControlsView).First(&supPerm)
	db.Create(&models.RolePermission{RoleID: contador.ID, PermissionID: supPerm.ID})

	// (b) super_usuario: quitarle un permiso → debe RESTABLECERSE (rol omnipotente).
	var superRole models.Role
	db.Where("code = ?", rbac.RoleSuperusuario).First(&superRole)
	var dash models.Permission
	db.Where("code = ?", rbac.DashboardView).First(&dash)
	db.Where("role_id = ? AND permission_id = ?", superRole.ID, dash.ID).Delete(&models.RolePermission{})

	// (c) Permiso huérfano (retirado del registro) enlazado → debe eliminarse en cascada.
	var mod models.Module
	db.Where("code = ?", rbac.ModFinanzas).First(&mod)
	orphan := models.Permission{ModuleID: mod.ID, Code: "documents.legacy_dead", Action: "legacy_dead", Name: "muerto"}
	db.Create(&orphan)
	db.Create(&models.RolePermission{RoleID: contador.ID, PermissionID: orphan.ID})

	if err := SeedRBAC(db); err != nil {
		t.Fatalf("SeedRBAC 2: %v", err)
	}

	// (a) La edición del admin persiste (NO se restablece en el deploy).
	if _, ok := roleCodes(t, db, rbac.RoleContador)[rbac.SupervisorsControlsView]; !ok {
		t.Fatal("el permiso agregado por el admin a Contador se perdió tras el re-deploy")
	}
	// (b) super_usuario recuperó el permiso y sigue completo.
	sc := roleCodes(t, db, rbac.RoleSuperusuario)
	if _, ok := sc[rbac.DashboardView]; !ok {
		t.Fatal("super_usuario no recuperó el permiso quitado")
	}
	if len(sc) != len(rbac.AllPermissionCodes) {
		t.Fatalf("super_usuario tiene %d permisos want %d", len(sc), len(rbac.AllPermissionCodes))
	}
	// (c) Huérfano y su vínculo eliminados.
	var orphanCount int64
	db.Model(&models.Permission{}).Where("code = ?", "documents.legacy_dead").Count(&orphanCount)
	if orphanCount != 0 {
		t.Fatal("permiso huérfano no eliminado")
	}
	var linkCount int64
	db.Model(&models.RolePermission{}).Where("permission_id = ?", orphan.ID).Count(&linkCount)
	if linkCount != 0 {
		t.Fatal("vínculo de permiso huérfano no eliminado")
	}
}

// TestDetraccionesMarkStatus_asistenteYQuienYaPodia: «Marcar Sin clave / No corresponde» es un permiso propio. En una
// instalación existente (roles ya configurados) se reparte una sola vez a quienes ya podían hacerlo (los que tienen
// «Aprobar declaración») y al Asistente, y no se vuelve a poner si el administrador lo quita después.
func TestDetraccionesMarkStatus_asistenteYQuienYaPodia(t *testing.T) {
	db := setupRBACTestDB(t)
	if err := SeedRBAC(db); err != nil {
		t.Fatalf("SeedRBAC 1: %v", err)
	}
	has := func(role string) bool {
		_, ok := roleCodes(t, db, role)[rbac.SupervisorsDetraccionesMarkStatus]
		return ok
	}
	// Instalación nueva: lo traen el Asistente y el Supervisor desde la matriz canónica; el Contador no.
	if !has(rbac.RoleAsistente) || !has(rbac.RoleSupervisor) || has(rbac.RoleContador) {
		t.Fatalf("matriz canónica: asistente=%v supervisor=%v contador=%v", has(rbac.RoleAsistente), has(rbac.RoleSupervisor), has(rbac.RoleContador))
	}

	// Simula una instalación anterior: el permiso nuevo no estaba en ningún rol y la migración no se había corrido.
	var perm, approve models.Permission
	db.Where("code = ?", rbac.SupervisorsDetraccionesMarkStatus).First(&perm)
	db.Where("code = ?", rbac.SupervisorsDeclarationsApprove).First(&approve)
	db.Where("permission_id = ?", perm.ID).Delete(&models.RolePermission{})
	db.Where("name = ?", "rbac_detracciones_mark_status_v1").Delete(&models.SchemaMigration{})
	// Un rol creado por el administrador que ya podía aprobar (y por tanto marcar el estado).
	custom := models.Role{Code: "revisor_custom", Name: "Revisor", IsSystem: false}
	if err := db.Create(&custom).Error; err != nil {
		t.Fatalf("rol: %v", err)
	}
	db.Create(&models.RolePermission{RoleID: custom.ID, PermissionID: approve.ID})

	if err := SeedRBAC(db); err != nil {
		t.Fatalf("SeedRBAC 2: %v", err)
	}
	if !has(rbac.RoleAsistente) {
		t.Fatal("el Asistente debía recibir el permiso nuevo")
	}
	if !has(rbac.RoleSupervisor) {
		t.Fatal("el Supervisor (ya podía aprobar) no debía perderlo")
	}
	if _, ok := roleCodes(t, db, "revisor_custom")[rbac.SupervisorsDetraccionesMarkStatus]; !ok {
		t.Fatal("un rol propio con «Aprobar declaración» no debía perder la capacidad de marcar el estado")
	}
	if has(rbac.RoleContador) {
		t.Fatal("el Contador no debía recibirlo")
	}

	// El administrador se lo quita al Asistente: no vuelve en el siguiente arranque.
	var asistente models.Role
	db.Where("code = ?", rbac.RoleAsistente).First(&asistente)
	db.Where("role_id = ? AND permission_id = ?", asistente.ID, perm.ID).Delete(&models.RolePermission{})
	if err := SeedRBAC(db); err != nil {
		t.Fatalf("SeedRBAC 3: %v", err)
	}
	if has(rbac.RoleAsistente) {
		t.Fatal("el permiso quitado por el administrador se volvió a poner solo")
	}
}
