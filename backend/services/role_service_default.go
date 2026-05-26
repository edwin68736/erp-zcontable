package services

import (
	"errors"

	"miappfiber/database"
	"miappfiber/models"

	"gorm.io/gorm"
)

// GetDefaultRole devuelve el rol marcado como predeterminado para nuevos usuarios.
func (s *RoleService) GetDefaultRole() (*models.Role, error) {
	var r models.Role
	if err := database.DB.Where("is_default = ?", true).First(&r).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errors.New("no hay rol predeterminado configurado; defina uno en Roles y permisos")
		}
		return nil, err
	}
	return &r, nil
}

// SetDefaultRole marca un único rol como predeterminado.
func (s *RoleService) SetDefaultRole(roleID uint) (*models.Role, error) {
	var r models.Role
	if err := database.DB.First(&r, roleID).Error; err != nil {
		return nil, errors.New("rol no encontrado")
	}
	if err := database.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&models.Role{}).Where("is_default = ?", true).Update("is_default", false).Error; err != nil {
			return err
		}
		return tx.Model(&r).Update("is_default", true).Error
	}); err != nil {
		return nil, err
	}
	if err := database.DB.First(&r, roleID).Error; err != nil {
		return nil, err
	}
	return &r, nil
}
