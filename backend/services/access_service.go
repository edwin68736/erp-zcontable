package services

import (
	"miappfiber/database"
	"miappfiber/models"
)

type AccessService struct{}

func NewAccessService() *AccessService {
	return &AccessService{}
}

func (s *AccessService) GetAllowedCompanyIDs(userID uint) ([]uint, error) {
	ids := make([]uint, 0)

	var direct []uint
	if err := database.DB.
		Model(&models.Company{}).
		Where("accountant_user_id = ? OR supervisor_user_id = ? OR assistant_user_id = ?", userID, userID, userID).
		Pluck("id", &direct).Error; err != nil {
		return nil, err
	}

	var extra []uint
	if err := database.DB.
		Model(&models.CompanyAssignment{}).
		Where("user_id = ?", userID).
		Pluck("company_id", &extra).Error; err != nil {
		return nil, err
	}

	seen := make(map[uint]struct{}, len(direct)+len(extra))
	for _, id := range direct {
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		ids = append(ids, id)
	}
	for _, id := range extra {
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		ids = append(ids, id)
	}

	return ids, nil
}

func (s *AccessService) CanAccessCompany(userID uint, companyID uint) (bool, error) {
	var count int64
	if err := database.DB.
		Model(&models.Company{}).
		Where("id = ? AND (accountant_user_id = ? OR supervisor_user_id = ? OR assistant_user_id = ?)", companyID, userID, userID, userID).
		Count(&count).Error; err != nil {
		return false, err
	}
	if count > 0 {
		return true, nil
	}

	count = 0
	if err := database.DB.
		Model(&models.CompanyAssignment{}).
		Where("company_id = ? AND user_id = ?", companyID, userID).
		Count(&count).Error; err != nil {
		return false, err
	}
	return count > 0, nil
}
