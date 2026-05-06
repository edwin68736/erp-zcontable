package services

import (
	"errors"
	"strings"

	"miappfiber/database"
	"miappfiber/models"

	"gorm.io/gorm"
)

type ContactService struct{}

func NewContactService() *ContactService {
	return &ContactService{}
}

func (s *ContactService) Create(input *models.Contact) error {
	if input.CompanyID == 0 {
		return errors.New("la empresa es requerida")
	}
	input.FullName = strings.TrimSpace(input.FullName)
	input.Position = strings.TrimSpace(input.Position)
	input.Phone = strings.TrimSpace(input.Phone)
	input.Email = strings.TrimSpace(input.Email)

	if input.FullName == "" {
		return errors.New("el nombre es requerido")
	}
	if input.Position == "" {
		return errors.New("el cargo es requerido")
	}
	if input.Phone == "" {
		return errors.New("el teléfono es requerido")
	}
	if input.Email == "" {
		return errors.New("el correo es requerido")
	}

	return database.DB.Create(input).Error
}

func (s *ContactService) Update(id uint, input *models.Contact) error {
	var c models.Contact
	if err := database.DB.First(&c, id).Error; err != nil {
		return err
	}
	if input.FullName != "" {
		c.FullName = strings.TrimSpace(input.FullName)
	}
	if input.Position != "" {
		c.Position = strings.TrimSpace(input.Position)
	}
	if input.Phone != "" {
		c.Phone = strings.TrimSpace(input.Phone)
	}
	if input.Email != "" {
		c.Email = strings.TrimSpace(input.Email)
	}
	if input.Notes != "" {
		c.Notes = input.Notes
	}
	if input.Priority != "" {
		c.Priority = strings.TrimSpace(input.Priority)
	}
	return database.DB.Save(&c).Error
}

func (s *ContactService) ListByCompany(companyID uint) ([]models.Contact, error) {
	var list []models.Contact
	if err := database.DB.
		Where("company_id = ?", companyID).
		Order("priority DESC, full_name ASC").
		Find(&list).Error; err != nil {
		return nil, err
	}
	return list, nil
}

func (s *ContactService) GetByID(id uint) (*models.Contact, error) {
	var c models.Contact
	if err := database.DB.First(&c, id).Error; err != nil {
		return nil, err
	}
	return &c, nil
}

func (s *ContactService) Delete(id uint) error {
	result := database.DB.Delete(&models.Contact{}, id)
	if result.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return result.Error
}

