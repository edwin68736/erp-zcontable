package services

import (
	"errors"
	"regexp"
	"strings"

	"miappfiber/database"
	"miappfiber/models"

	"gorm.io/gorm"
)

var roleCodePattern = regexp.MustCompile(`^[a-z][a-z0-9_]{1,62}$`)

func (s *RoleService) attachRoleListCounts(roles []models.Role) error {
	if len(roles) == 0 {
		return nil
	}
	ids := make([]uint, len(roles))
	for i := range roles {
		ids[i] = roles[i].ID
	}
	type cnt struct {
		RoleID uint  `gorm:"column:role_id"`
		C      int64 `gorm:"column:c"`
	}
	var uc []cnt
	if err := database.DB.Model(&models.UserRole{}).
		Select("role_id, COUNT(*) AS c").
		Where("role_id IN ?", ids).
		Group("role_id").
		Scan(&uc).Error; err != nil {
		return err
	}
	var pc []cnt
	if err := database.DB.Model(&models.RolePermission{}).
		Select("role_id, COUNT(*) AS c").
		Where("role_id IN ?", ids).
		Group("role_id").
		Scan(&pc).Error; err != nil {
		return err
	}
	um := make(map[uint]int64, len(uc))
	for _, r := range uc {
		um[r.RoleID] = r.C
	}
	pm := make(map[uint]int64, len(pc))
	for _, r := range pc {
		pm[r.RoleID] = r.C
	}
	for i := range roles {
		roles[i].UserCount = um[roles[i].ID]
		roles[i].PermissionCount = pm[roles[i].ID]
	}
	return nil
}

// CreateRole crea un rol personalizado. El código es identificador interno (se genera del nombre si viene vacío).
func (s *RoleService) CreateRole(code, name, description string) (*models.Role, error) {
	name = strings.TrimSpace(name)
	description = strings.TrimSpace(description)
	if name == "" {
		return nil, errors.New("el nombre es requerido")
	}
	code = normalizeRoleCode(code)
	if code == "" {
		var err error
		code, err = generateUniqueRoleCode(database.DB, name)
		if err != nil {
			return nil, err
		}
	} else if !roleCodePattern.MatchString(code) {
		return nil, errors.New("identificador interno inválido")
	} else {
		var exists int64
		if err := database.DB.Model(&models.Role{}).Where("code = ?", code).Count(&exists).Error; err != nil {
			return nil, err
		}
		if exists > 0 {
			return nil, errors.New("ya existe un rol con ese nombre o identificador; use otro nombre")
		}
	}
	r := &models.Role{
		Code:        code,
		Name:        name,
		Description: description,
		IsSystem:    false,
	}
	if err := database.DB.Create(r).Error; err != nil {
		return nil, err
	}
	return r, nil
}

// UpdateRole actualiza nombre y descripción (incluidos roles de sistema; el código no cambia).
func (s *RoleService) UpdateRole(id uint, name, description string) (*models.Role, error) {
	var r models.Role
	if err := database.DB.First(&r, id).Error; err != nil {
		return nil, err
	}
	name = strings.TrimSpace(name)
	description = strings.TrimSpace(description)
	if name == "" {
		return nil, errors.New("el nombre es requerido")
	}
	r.Name = name
	r.Description = description
	if err := database.DB.Save(&r).Error; err != nil {
		return nil, err
	}
	if err := database.DB.First(&r, id).Error; err != nil {
		return nil, err
	}
	return &r, nil
}

// DeleteRole elimina un rol sin usuarios asignados (incluidos roles de sistema) y sus pivotes de permisos.
func (s *RoleService) DeleteRole(id uint) error {
	var r models.Role
	if err := database.DB.First(&r, id).Error; err != nil {
		return err
	}
	if r.IsDefault {
		return errors.New("no se puede eliminar el rol predeterminado; asigne otro rol como predeterminado primero")
	}
	var n int64
	if err := database.DB.Model(&models.UserRole{}).Where("role_id = ?", id).Count(&n).Error; err != nil {
		return err
	}
	if n > 0 {
		return errors.New("el rol tiene usuarios asignados; reasigne esos usuarios antes de eliminar")
	}
	return database.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("role_id = ?", id).Delete(&models.RolePermission{}).Error; err != nil {
			return err
		}
		return tx.Delete(&models.Role{}, id).Error
	})
}
