package database

import (
	"errors"
	"fmt"
	"strings"

	"miappfiber/models"
	"miappfiber/rbac"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// SeedRBAC construye TODO el RBAC a partir de la fuente única (paquete rbac):
// módulos, permisos, roles de sistema y la matriz rol↔permiso reconciliada
// (agrega faltantes y quita sobrantes en roles de sistema). Idempotente.
func SeedRBAC(db *gorm.DB) error {
	if err := seedRBACModules(db); err != nil {
		return err
	}
	if err := seedRBACPermissions(db); err != nil {
		return err
	}
	if err := seedRBACSystemRoles(db); err != nil {
		return err
	}
	if err := reconcileSystemRolePermissions(db); err != nil {
		return err
	}
	if err := ensureDefaultRole(db); err != nil {
		return err
	}
	if err := assignDefaultRoleWhereNoRoles(db); err != nil {
		return err
	}
	return ensureAdminSuperusuarioUser(db)
}

// ─────────────────────────────── Módulos ───────────────────────────────

// operationalModules — módulos de la matriz de permisos, alineados con el sidebar.
func operationalModules() []models.Module {
	return []models.Module{
		{Code: rbac.ModRecursos, Name: "Recursos", Icon: "fas fa-globe", SortOrder: 10, Active: true},
		{Code: rbac.ModFinanzas, Name: "Finanzas del estudio", Icon: "fas fa-coins", SortOrder: 20, Active: true},
		{Code: rbac.ModSupervisores, Name: "Supervisores", Icon: "fas fa-user-check", SortOrder: 30, Active: true},
		{Code: rbac.ModVentas, Name: "Ventas", Icon: "fas fa-cash-register", SortOrder: 40, Active: true},
		{Code: rbac.ModEstudio, Name: "Estudio", Icon: "fas fa-building-columns", SortOrder: 50, Active: true},
	}
}

func seedRBACModules(db *gorm.DB) error {
	rows := operationalModules()
	for i := range rows {
		r := rows[i]
		if err := db.Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "code"}},
			DoUpdates: clause.AssignmentColumns([]string{"name", "icon", "sort_order", "active", "updated_at"}),
		}).Create(&r).Error; err != nil {
			return fmt.Errorf("module %s: %w", r.Code, err)
		}
	}
	return nil
}

// cleanupOrphanModules elimina módulos que ya no existen en la taxonomía operativa
// (p. ej. los antiguos módulos de dominio). Seguro: los permisos ya fueron repuntados.
func cleanupOrphanModules(db *gorm.DB) error {
	valid := make([]string, 0)
	for _, m := range operationalModules() {
		valid = append(valid, m.Code)
	}
	return db.Where("code NOT IN ?", valid).Delete(&models.Module{}).Error
}

func moduleIDByCode(db *gorm.DB, code string) (uint, error) {
	var m models.Module
	if err := db.Where("code = ?", code).First(&m).Error; err != nil {
		return 0, err
	}
	return m.ID, nil
}

// ───────────────────────────── Permisos ─────────────────────────────

// seedRBACPermissions inserta/actualiza cada permiso del registro y ELIMINA los
// que ya no existan en el registro (limpieza de permisos retirados).
func seedRBACPermissions(db *gorm.DB) error {
	defs := rbac.PermDefs()

	// Cache module_id por código para no consultar por cada permiso.
	moduleIDs := map[string]uint{}
	for _, d := range defs {
		if _, ok := moduleIDs[d.Module]; ok {
			continue
		}
		mid, err := moduleIDByCode(db, d.Module)
		if err != nil {
			return fmt.Errorf("módulo %s: %w", d.Module, err)
		}
		moduleIDs[d.Module] = mid
	}

	for i, d := range defs {
		parts := strings.SplitN(d.Code, ".", 2)
		if len(parts) != 2 {
			return fmt.Errorf("código de permiso inválido: %s", d.Code)
		}
		p := models.Permission{
			ModuleID:  moduleIDs[d.Module],
			Code:      d.Code,
			Action:    parts[1],
			Name:      d.Name,
			Group:     d.Group,
			SortOrder: i, // el orden del registro define el orden en la matriz
		}
		if err := db.Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "code"}},
			DoUpdates: clause.AssignmentColumns([]string{"module_id", "action", "name", "perm_group", "sort_order", "updated_at"}),
		}).Create(&p).Error; err != nil {
			return fmt.Errorf("permiso %s: %w", d.Code, err)
		}
	}

	if err := cleanupOrphanPermissions(db, defs); err != nil {
		return err
	}
	return cleanupOrphanModules(db)
}

// cleanupOrphanPermissions borra permisos (y sus vínculos rol↔permiso) que ya no
// están en el registro. Evita que códigos retirados sigan apareciendo en el catálogo.
func cleanupOrphanPermissions(db *gorm.DB, defs []rbac.PermDef) error {
	valid := make([]string, 0, len(defs))
	for _, d := range defs {
		valid = append(valid, d.Code)
	}
	var orphans []models.Permission
	if err := db.Where("code NOT IN ?", valid).Find(&orphans).Error; err != nil {
		return err
	}
	for _, op := range orphans {
		if err := db.Where("permission_id = ?", op.ID).Delete(&models.RolePermission{}).Error; err != nil {
			return fmt.Errorf("limpiar vínculos permiso %s: %w", op.Code, err)
		}
		if err := db.Delete(&models.Permission{}, op.ID).Error; err != nil {
			return fmt.Errorf("eliminar permiso huérfano %s: %w", op.Code, err)
		}
	}
	return nil
}

// ───────────────────────────── Roles ─────────────────────────────

func seedRBACSystemRoles(db *gorm.DB) error {
	system := []models.Role{
		{Code: rbac.RoleSuperusuario, Name: "Super usuario", Description: "Acceso total al sistema y alcance global del estudio", IsSystem: true},
		{Code: rbac.RoleAdministrador, Name: "Administrador", Description: "Administración de área o equipo (permisos configurables)", IsSystem: true},
		{Code: rbac.RoleSupervisor, Name: "Supervisor", Description: "Supervisión operativa", IsSystem: true},
		{Code: rbac.RoleContador, Name: "Contador", Description: "Gestión contable y fiscal", IsSystem: true},
		{Code: rbac.RoleAsistente, Name: "Asistente", Description: "Apoyo operativo", IsSystem: true},
		{Code: rbac.RoleAnalista, Name: "Analista", Description: "Analista contable (avance y liquidaciones)", IsSystem: true},
		{Code: rbac.RoleGerencia, Name: "Gerencia", Description: "Gerencia — supervisión y cierre (mismo alcance que supervisor)", IsSystem: true},
		{Code: rbac.RoleEmisorComprobantes, Name: "Emisor de Comprobantes", Description: "Emisión rápida de comprobantes (POS)", IsSystem: true},
	}
	for i := range system {
		r := system[i]
		if err := db.Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "code"}},
			DoUpdates: clause.AssignmentColumns([]string{"name", "description", "is_system", "updated_at"}),
		}).Create(&r).Error; err != nil {
			return fmt.Errorf("rol %s: %w", r.Code, err)
		}
	}
	return nil
}

// reconcileSystemRolePermissions fija la matriz rol↔permiso de CADA rol de sistema
// EXACTAMENTE a su conjunto canónico (agrega faltantes y quita sobrantes). Los roles
// personalizados (is_system=false) no se tocan.
// reconcileSystemRolePermissions siembra los permisos POR DEFECTO de los roles de sistema.
//
// Importante (evita que un deploy pise la configuración del administrador):
//   - super_usuario: se mantiene SIEMPRE con el catálogo completo (rol omnipotente / red de
//     seguridad; además el enforcement depende de que tenga todos los permisos).
//   - demás roles de sistema: se siembran con su set canónico SOLO la primera vez (cuando aún
//     no tienen permisos). Si ya están configurados, se respeta lo que haya definido el
//     administrador por la UI — no se restablece en cada arranque.
//
// La limpieza de permisos huérfanos (código retirado del registro) sí ocurre siempre, en
// seedRBACPermissions; eso no es "restablecer un rol", es quitar referencias muertas.
func reconcileSystemRolePermissions(db *gorm.DB) error {
	var perms []models.Permission
	if err := db.Find(&perms).Error; err != nil {
		return err
	}
	idByCode := make(map[string]uint, len(perms))
	for _, p := range perms {
		idByCode[p.Code] = p.ID
	}

	setCanonical := func(role *models.Role, roleCode string) error {
		codes := rbac.RolePermissionCodes(roleCode)
		want := make([]models.Permission, 0, len(codes))
		for _, c := range codes {
			if id, ok := idByCode[c]; ok {
				want = append(want, models.Permission{ID: id})
			}
		}
		if err := db.Model(role).Association("Permissions").Replace(want); err != nil {
			return fmt.Errorf("sembrar rol %s: %w", roleCode, err)
		}
		return nil
	}

	for _, roleCode := range rbac.SystemRoleCodes() {
		var role models.Role
		if err := db.Where("code = ? AND is_system = ?", roleCode, true).First(&role).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				continue
			}
			return err
		}

		// super_usuario siempre completo.
		if roleCode == rbac.RoleSuperusuario {
			if err := setCanonical(&role, roleCode); err != nil {
				return err
			}
			continue
		}

		// Resto: sembrar solo si el rol aún no tiene permisos (primera vez / rol recién creado).
		var count int64
		if err := db.Model(&models.RolePermission{}).Where("role_id = ?", role.ID).Count(&count).Error; err != nil {
			return err
		}
		if count > 0 {
			continue // ya configurado; respetar al administrador
		}
		if err := setCanonical(&role, roleCode); err != nil {
			return err
		}
	}
	return nil
}

// ensureDefaultRole marca el rol por defecto si ninguno lo es todavía.
func ensureDefaultRole(db *gorm.DB) error {
	var n int64
	if err := db.Model(&models.Role{}).Where("is_default = ?", true).Count(&n).Error; err != nil {
		return err
	}
	if n > 0 {
		return nil
	}
	var r models.Role
	if err := db.Where("code = ?", rbac.DefaultRoleCode).First(&r).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil
		}
		return err
	}
	return db.Model(&r).Update("is_default", true).Error
}

// ─────────────────────── Asignación de roles a usuarios ───────────────────────

func assignDefaultRoleWhereNoRoles(db *gorm.DB) error {
	var def models.Role
	if err := db.Where("is_default = ?", true).First(&def).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil
		}
		return err
	}
	var users []models.User
	if err := db.Preload("Roles").Find(&users).Error; err != nil {
		return err
	}
	for i := range users {
		u := &users[i]
		if len(u.Roles) == 0 {
			if err := db.Model(u).Association("Roles").Replace([]models.Role{def}); err != nil {
				return fmt.Errorf("usuario %d: %w", u.ID, err)
			}
		}
	}
	return nil
}

func findUserByAdminUsername(db *gorm.DB) (*models.User, error) {
	var admin models.User
	err := db.Where("LOWER(TRIM(username)) = ?", "admin").First(&admin).Error
	if err == nil {
		return &admin, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	return nil, nil
}

func assignUserRolesExplicit(db *gorm.DB, userID, roleID uint) error {
	return db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("user_id = ?", userID).Delete(&models.UserRole{}).Error; err != nil {
			return err
		}
		return tx.Create(&models.UserRole{UserID: userID, RoleID: roleID}).Error
	})
}

// ensureAdminSuperusuarioUser: si existe el usuario "admin", le asigna super_usuario
// (cuyos permisos ya reconcilió reconcileSystemRolePermissions).
func ensureAdminSuperusuarioUser(db *gorm.DB) error {
	admin, err := findUserByAdminUsername(db)
	if err != nil {
		return err
	}
	if admin == nil {
		return nil
	}
	var superRole models.Role
	if err := db.Where("code = ?", rbac.RoleSuperusuario).First(&superRole).Error; err != nil {
		return fmt.Errorf("usuario admin: falta rol %s: %w", rbac.RoleSuperusuario, err)
	}
	if err := assignUserRolesExplicit(db, admin.ID, superRole.ID); err != nil {
		return fmt.Errorf("usuario admin: asignar rol: %w", err)
	}
	if err := db.Model(admin).Association("Roles").Replace([]models.Role{superRole}); err != nil {
		return fmt.Errorf("usuario admin: sync roles: %w", err)
	}
	return nil
}
