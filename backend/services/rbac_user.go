package services

import (
	"miappfiber/models"

	"gorm.io/gorm"
)

// CountOtherUsersWithPermission cuenta usuarios distintos de excludeUserID que tienen el permiso vía roles.
func CountOtherUsersWithPermission(db *gorm.DB, permissionCode string, excludeUserID uint) (int64, error) {
	var n int64
	err := db.Model(&models.User{}).
		Where("id <> ?", excludeUserID).
		Where(`EXISTS (
			SELECT 1 FROM user_roles ur
			JOIN role_permissions rp ON rp.role_id = ur.role_id
			JOIN permissions p ON p.id = rp.permission_id AND p.code = ?
			WHERE ur.user_id = users.id
		)`, permissionCode).
		Count(&n).Error
	return n, err
}
