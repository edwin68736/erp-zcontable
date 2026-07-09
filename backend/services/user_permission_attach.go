package services

import (
	"sort"

	"miappfiber/database"
	"miappfiber/models"
)

// AttachEffectivePermissionCodes rellena PermissionCodes en memoria (una consulta por lote).
func AttachEffectivePermissionCodes(users []models.User) error {
	if len(users) == 0 {
		return nil
	}
	ids := make([]uint, len(users))
	for i := range users {
		ids[i] = users[i].ID
	}
	type row struct {
		UserID uint   `gorm:"column:user_id"`
		Code   string `gorm:"column:code"`
	}
	var rows []row
	if err := database.DB.Table("user_roles ur").
		Select("ur.user_id AS user_id, permissions.code AS code").
		Joins("JOIN role_permissions rp ON rp.role_id = ur.role_id").
		Joins("JOIN permissions ON permissions.id = rp.permission_id").
		Where("ur.user_id IN ?", ids).
		Scan(&rows).Error; err != nil {
		return err
	}
	byUser := make(map[uint]map[string]struct{}, len(ids))
	for _, r := range rows {
		if byUser[r.UserID] == nil {
			byUser[r.UserID] = make(map[string]struct{})
		}
		byUser[r.UserID][r.Code] = struct{}{}
	}
	for i := range users {
		set := byUser[users[i].ID]
		if len(set) == 0 {
			users[i].PermissionCodes = []string{}
			continue
		}
		list := make([]string, 0, len(set))
		for c := range set {
			list = append(list, c)
		}
		sort.Strings(list)
		users[i].PermissionCodes = list
	}
	return nil
}
