package services

import (
	"errors"
	"strings"

	"miappfiber/database"
	"miappfiber/models"

	"gorm.io/gorm"
)

type PlanCategoryService struct{}

func NewPlanCategoryService() *PlanCategoryService {
	return &PlanCategoryService{}
}

func (s *PlanCategoryService) List() ([]models.PlanCategory, error) {
	var list []models.PlanCategory
	err := database.DB.Where("active = ?", true).Order("sort_order ASC, name ASC").Find(&list).Error
	return list, err
}

func (s *PlanCategoryService) ListAll() ([]models.PlanCategory, error) {
	var list []models.PlanCategory
	err := database.DB.Order("sort_order ASC, name ASC").Find(&list).Error
	return list, err
}

func (s *PlanCategoryService) GetByID(id uint) (*models.PlanCategory, error) {
	var c models.PlanCategory
	if err := database.DB.Preload("Plans", func(db *gorm.DB) *gorm.DB {
		return db.Order("name ASC")
	}).First(&c, id).Error; err != nil {
		return nil, err
	}
	return &c, nil
}

func (s *PlanCategoryService) Create(input *models.PlanCategory) error {
	input.Code = strings.TrimSpace(input.Code)
	input.Name = strings.TrimSpace(input.Name)
	if input.Code == "" {
		return errors.New("el código es requerido")
	}
	if input.Name == "" {
		return errors.New("el nombre es requerido")
	}
	var cnt int64
	database.DB.Model(&models.PlanCategory{}).Where("code = ?", input.Code).Count(&cnt)
	if cnt > 0 {
		return errors.New("el código ya existe")
	}
	return database.DB.Create(input).Error
}

func (s *PlanCategoryService) Update(id uint, input *models.PlanCategory) error {
	var c models.PlanCategory
	if err := database.DB.First(&c, id).Error; err != nil {
		return err
	}
	if strings.TrimSpace(input.Code) != "" {
		code := strings.TrimSpace(input.Code)
		var cnt int64
		database.DB.Model(&models.PlanCategory{}).Where("code = ? AND id <> ?", code, id).Count(&cnt)
		if cnt > 0 {
			return errors.New("el código ya existe")
		}
		c.Code = code
	}
	if strings.TrimSpace(input.Name) != "" {
		c.Name = strings.TrimSpace(input.Name)
	}
	c.Description = input.Description
	c.SortOrder = input.SortOrder
	c.Active = input.Active
	return database.DB.Save(&c).Error
}

func (s *PlanCategoryService) Delete(id uint) error {
	var cnt int64
	database.DB.Model(&models.SubscriptionPlan{}).Where("plan_category_id = ?", id).Count(&cnt)
	if cnt > 0 {
		return errors.New("no se puede eliminar: hay planes en esta categoría")
	}
	res := database.DB.Delete(&models.PlanCategory{}, id)
	if res.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return res.Error
}
