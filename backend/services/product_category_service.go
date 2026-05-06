package services

import (
	"errors"
	"strings"

	"miappfiber/database"
	"miappfiber/models"

	"gorm.io/gorm"
)

type ProductCategoryService struct{}

func NewProductCategoryService() *ProductCategoryService {
	return &ProductCategoryService{}
}

func (s *ProductCategoryService) ListActive() ([]models.ProductCategory, error) {
	var list []models.ProductCategory
	err := database.DB.Where("active = ?", true).Order("sort_order ASC, name ASC").Find(&list).Error
	return list, err
}

func (s *ProductCategoryService) ListAll() ([]models.ProductCategory, error) {
	var list []models.ProductCategory
	err := database.DB.Order("sort_order ASC, name ASC").Find(&list).Error
	return list, err
}

func (s *ProductCategoryService) GetByID(id uint) (*models.ProductCategory, error) {
	var c models.ProductCategory
	if err := database.DB.First(&c, id).Error; err != nil {
		return nil, err
	}
	return &c, nil
}

func (s *ProductCategoryService) Create(input *models.ProductCategory) error {
	input.Name = strings.TrimSpace(input.Name)
	if input.Name == "" {
		return errors.New("el nombre es requerido")
	}
	return database.DB.Create(input).Error
}

func (s *ProductCategoryService) Update(id uint, input *models.ProductCategory) error {
	var c models.ProductCategory
	if err := database.DB.First(&c, id).Error; err != nil {
		return err
	}
	if n := strings.TrimSpace(input.Name); n != "" {
		c.Name = n
	}
	c.SortOrder = input.SortOrder
	c.Active = input.Active
	return database.DB.Save(&c).Error
}

func (s *ProductCategoryService) Delete(id uint) error {
	var cnt int64
	database.DB.Model(&models.Product{}).Where("product_category_id = ?", id).Count(&cnt)
	if cnt > 0 {
		return errors.New("no se puede eliminar: hay productos en esta categoría")
	}
	res := database.DB.Delete(&models.ProductCategory{}, id)
	if res.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return res.Error
}
