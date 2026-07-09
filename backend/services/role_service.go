package services

import (
	"errors"

	"miappfiber/database"
	"miappfiber/models"

	"gorm.io/gorm"
)

type RoleService struct{}

func NewRoleService() *RoleService {
	return &RoleService{}
}

func (s *RoleService) List() ([]models.Role, error) {
	var roles []models.Role
	if err := database.DB.Order("is_system DESC, id ASC").Find(&roles).Error; err != nil {
		return nil, err
	}
	if err := s.attachRoleListCounts(roles); err != nil {
		return nil, err
	}
	return roles, nil
}

func (s *RoleService) GetByID(id uint) (*models.Role, error) {
	var r models.Role
	if err := database.DB.Preload("Permissions", func(db *gorm.DB) *gorm.DB {
		return db.Order("permissions.code ASC")
	}).First(&r, id).Error; err != nil {
		return nil, err
	}
	return &r, nil
}

func (s *RoleService) ReplaceRolePermissions(roleID uint, permissionIDs []uint) error {
	var role models.Role
	if err := database.DB.First(&role, roleID).Error; err != nil {
		return err
	}
	var perms []models.Permission
	if len(permissionIDs) > 0 {
		if err := database.DB.Where("id IN ?", permissionIDs).Find(&perms).Error; err != nil {
			return err
		}
		if len(perms) != len(permissionIDs) {
			return errors.New("algunos permisos no existen")
		}
	}
	if err := database.DB.Model(&role).Association("Permissions").Replace(perms); err != nil {
		return err
	}
	s.invalidateUsersWithRole(roleID)
	return nil
}

func (s *RoleService) invalidateUsersWithRole(roleID uint) {
	var userIDs []uint
	_ = database.DB.Model(&models.UserRole{}).Where("role_id = ?", roleID).Pluck("user_id", &userIDs)
	for _, uid := range userIDs {
		Authz().InvalidateUser(uid)
	}
}

// CatalogModules permisos agrupados por módulo para la UI matriz.
func (s *RoleService) CatalogModules() ([]models.Module, error) {
	var mods []models.Module
	if err := database.DB.Where("active = ?", true).Order("sort_order ASC, id ASC").Preload("Permissions", func(db *gorm.DB) *gorm.DB {
		return db.Order("permissions.code ASC")
	}).Find(&mods).Error; err != nil {
		return nil, err
	}
	return mods, nil
}
