package services

import (
	"errors"
	"strings"

	"miappfiber/database"
	"miappfiber/models"

	"gorm.io/gorm"
)

// CloneRole duplica permisos de un rol en uno nuevo (nombre distinto; código interno autogenerado).
func (s *RoleService) CloneRole(sourceID uint, code, name, description string) (*models.Role, error) {
	src, err := s.GetByID(sourceID)
	if err != nil {
		return nil, errors.New("rol origen no encontrado")
	}
	name = strings.TrimSpace(name)
	description = strings.TrimSpace(description)
	if name == "" {
		return nil, errors.New("el nombre es requerido")
	}
	code = normalizeRoleCode(code)
	if code == "" {
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
			return nil, errors.New("ya existe un rol con ese nombre; use otro nombre")
		}
	}
	permIDs := make([]uint, 0, len(src.Permissions))
	for _, p := range src.Permissions {
		permIDs = append(permIDs, p.ID)
	}
	var created *models.Role
	err = database.DB.Transaction(func(tx *gorm.DB) error {
		r := &models.Role{
			Code:        code,
			Name:        name,
			Description: description,
			IsSystem:    false,
			IsDefault:   false,
		}
		if err := tx.Create(r).Error; err != nil {
			return err
		}
		if len(permIDs) > 0 {
			var plist []models.Permission
			if err := tx.Where("id IN ?", permIDs).Find(&plist).Error; err != nil {
				return err
			}
			if err := tx.Model(r).Association("Permissions").Replace(plist); err != nil {
				return err
			}
		}
		created = r
		return nil
	})
	if err != nil {
		return nil, err
	}
	return s.GetByID(created.ID)
}
