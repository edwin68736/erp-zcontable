package database

import (
	"errors"
	"fmt"
	"time"

	"miappfiber/models"
	"miappfiber/rbac"

	"gorm.io/gorm"
)

const (
	migLegacyAdminToSuper     = "rbac_v1_legacy_administrador_to_superusuario"
	migCompanyTeamAssignPerms = "rbac_v1_company_team_assign_permissions"
	migBootstrapDefaultRole   = "rbac_v1_bootstrap_default_role"
	migBootstrapAdminUser     = "rbac_v1_bootstrap_admin_user_role"
	migRepairSystemRoleMatrix   = "rbac_v1_repair_system_role_matrix"
	migContadorStripSupervisors = "rbac_v1_contador_strip_supervisors"
)

// RunRBACMigrations ejecuta migraciones de datos RBAC de una sola vez (no en cada arranque como reglas de negocio).
func RunRBACMigrations(db *gorm.DB) error {
	if err := db.AutoMigrate(&models.SchemaMigration{}); err != nil {
		return err
	}
	steps := []struct {
		name string
		fn   func(*gorm.DB) error
	}{
		{migLegacyAdminToSuper, migrateLegacyAdministradorToSuperusuario},
		{migCompanyTeamAssignPerms, migrateCompanyTeamAssignPermissions},
		{migBootstrapDefaultRole, migrateBootstrapDefaultRole},
		{migBootstrapAdminUser, migrateBootstrapAdminUserRole},
		{migRepairSystemRoleMatrix, migrateRepairSystemRoleMatrix},
		{migContadorStripSupervisors, migrateContadorStripSupervisors},
	}
	for _, step := range steps {
		if err := applyMigrationOnce(db, step.name, step.fn); err != nil {
			return fmt.Errorf("%s: %w", step.name, err)
		}
	}
	return nil
}

func applyMigrationOnce(db *gorm.DB, name string, fn func(*gorm.DB) error) error {
	var n int64
	if err := db.Model(&models.SchemaMigration{}).Where("name = ?", name).Count(&n).Error; err != nil {
		return err
	}
	if n > 0 {
		return nil
	}
	if err := fn(db); err != nil {
		return err
	}
	return db.Create(&models.SchemaMigration{Name: name, AppliedAt: time.Now()}).Error
}

// migrateCompanyTeamAssignPermissions asigna companies.assign_* una sola vez según matriz heredada (BD pre-permisos de equipo).
func migrateCompanyTeamAssignPermissions(db *gorm.DB) error {
	var accP, supP, assP models.Permission
	for _, pair := range []struct {
		code string
		out  *models.Permission
	}{
		{rbac.CompaniesAssignAccountant, &accP},
		{rbac.CompaniesAssignSupervisor, &supP},
		{rbac.CompaniesAssignAssistant, &assP},
	} {
		if err := db.Where("code = ?", pair.code).First(pair.out).Error; err != nil {
			return nil
		}
	}
	link := func(roleID, permID uint) error {
		var cnt int64
		if err := db.Model(&models.RolePermission{}).Where("role_id = ? AND permission_id = ?", roleID, permID).Count(&cnt).Error; err != nil {
			return err
		}
		if cnt > 0 {
			return nil
		}
		return db.Create(&models.RolePermission{RoleID: roleID, PermissionID: permID}).Error
	}
	var roleIDs []uint
	if err := db.Model(&models.Role{}).Pluck("id", &roleIDs).Error; err != nil {
		return err
	}
	for _, rid := range roleIDs {
		var codesList []string
		if err := db.Table("permissions").
			Select("permissions.code").
			Joins("JOIN role_permissions rp ON rp.permission_id = permissions.id").
			Where("rp.role_id = ?", rid).
			Pluck("permissions.code", &codesList).Error; err != nil {
			return err
		}
		have := make(map[string]struct{}, len(codesList))
		for _, c := range codesList {
			have[c] = struct{}{}
		}
		if _, ok := have[rbac.AccessStudio]; ok {
			_ = link(rid, accP.ID)
			_ = link(rid, supP.ID)
			_ = link(rid, assP.ID)
			continue
		}
		if _, ok := have[rbac.CompaniesUpdate]; ok {
			_ = link(rid, accP.ID)
			_ = link(rid, supP.ID)
		}
		_, hasView := have[rbac.CompaniesView]
		_, hasUpd := have[rbac.CompaniesUpdate]
		if hasView && !hasUpd {
			_ = link(rid, assP.ID)
		}
	}
	return nil
}

// migrateBootstrapDefaultRole marca un rol predeterminado solo si ninguno existe (instalaciones antiguas).
func migrateBootstrapDefaultRole(db *gorm.DB) error {
	var n int64
	if err := db.Model(&models.Role{}).Where("is_default = ?", true).Count(&n).Error; err != nil {
		return err
	}
	if n > 0 {
		return nil
	}
	var r models.Role
	if err := db.Where("code = ?", seedRoleAsistente).First(&r).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			var first models.Role
			if err := db.Order("id ASC").First(&first).Error; err != nil {
				return nil
			}
			return db.Model(&first).Update("is_default", true).Error
		}
		return err
	}
	return db.Model(&r).Update("is_default", true).Error
}

// migrateBootstrapAdminUserRole (histórico): la asignación vigente corre en SeedRBAC → ensureAdminSuperusuarioUser.
func migrateBootstrapAdminUserRole(db *gorm.DB) error {
	return nil
}

// migrateContadorStripSupervisors elimina permisos supervisors.* del rol Contador (C2).
func migrateContadorStripSupervisors(db *gorm.DB) error {
	var role models.Role
	if err := db.Where("code = ?", seedRoleContador).First(&role).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil
		}
		return err
	}
	var permIDs []uint
	if err := db.Model(&models.Permission{}).Where("code LIKE ?", "supervisors.%").Pluck("id", &permIDs).Error; err != nil {
		return err
	}
	if len(permIDs) == 0 {
		return nil
	}
	return db.Where("role_id = ? AND permission_id IN ?", role.ID, permIDs).
		Delete(&models.RolePermission{}).Error
}

// migrateRepairSystemRoleMatrix repara la matriz canónica de roles sistema (add-missing only, una sola vez).
func migrateRepairSystemRoleMatrix(db *gorm.DB) error {
	var permCount int64
	if err := db.Model(&models.Permission{}).Count(&permCount).Error; err != nil {
		return err
	}
	if permCount < int64(len(rbac.AllPermissionCodes)) {
		return fmt.Errorf("catálogo de permisos incompleto: %d < %d", permCount, len(rbac.AllPermissionCodes))
	}
	return db.Transaction(func(tx *gorm.DB) error {
		for _, roleCode := range systemRolesForCanonicalRepair() {
			if err := linkMissingCanonicalPermissionsForSystemRole(tx, roleCode); err != nil {
				return fmt.Errorf("rol %s: %w", roleCode, err)
			}
		}
		return nil
	})
}
