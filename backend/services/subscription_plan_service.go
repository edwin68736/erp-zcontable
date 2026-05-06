package services

import (
	"errors"
	"fmt"
	"math"
	"strings"

	"miappfiber/database"
	"miappfiber/models"

	"gorm.io/gorm"
)

type SubscriptionPlanService struct{}

func NewSubscriptionPlanService() *SubscriptionPlanService {
	return &SubscriptionPlanService{}
}

func (s *SubscriptionPlanService) ListByCategory(categoryID uint) ([]models.SubscriptionPlan, error) {
	var list []models.SubscriptionPlan
	err := database.DB.
		Preload("Tiers", func(db *gorm.DB) *gorm.DB {
			return db.Order("sort_order ASC, id ASC")
		}).
		Where("plan_category_id = ?", categoryID).
		Order("name ASC").
		Find(&list).Error
	return list, err
}

func (s *SubscriptionPlanService) ListAll() ([]models.SubscriptionPlan, error) {
	var list []models.SubscriptionPlan
	err := database.DB.
		Preload("PlanCategory").
		Preload("Tiers", func(db *gorm.DB) *gorm.DB {
			return db.Order("sort_order ASC, id ASC")
		}).
		Order("name ASC").
		Find(&list).Error
	return list, err
}

func (s *SubscriptionPlanService) GetByID(id uint) (*models.SubscriptionPlan, error) {
	var p models.SubscriptionPlan
	if err := database.DB.
		Preload("PlanCategory").
		Preload("Tiers", func(db *gorm.DB) *gorm.DB {
			return db.Order("sort_order ASC, id ASC")
		}).
		First(&p, id).Error; err != nil {
		return nil, err
	}
	return &p, nil
}

func validateTiersNonOverlap(tiers []models.PlanTier) error {
	if len(tiers) == 0 {
		return errors.New("el plan debe tener al menos un tramo")
	}
	for i := range tiers {
		t := &tiers[i]
		if t.MonthlyPrice < 0 {
			return errors.New("precio mensual inválido")
		}
		if t.MaxBilling != nil && *t.MaxBilling < t.MinBilling-0.005 {
			return errors.New("máximo de facturación no puede ser menor al mínimo en un tramo")
		}
	}
	for i := 0; i < len(tiers); i++ {
		for j := i + 1; j < len(tiers); j++ {
			a, b := tiers[i], tiers[j]
			if rangesOverlap(a.MinBilling, a.MaxBilling, b.MinBilling, b.MaxBilling) {
				return errors.New("los tramos no deben solaparse")
			}
		}
	}
	return nil
}

func rangesOverlap(minA float64, maxA *float64, minB float64, maxB *float64) bool {
	endA := math.MaxFloat64
	if maxA != nil {
		endA = *maxA
	}
	endB := math.MaxFloat64
	if maxB != nil {
		endB = *maxB
	}
	return minA <= endB+0.005 && minB <= endA+0.005
}

// ResolveMonthlyPrice elige precio según facturación base B.
func (s *SubscriptionPlanService) ResolveMonthlyPrice(planID uint, billing float64) (float64, error) {
	var tiers []models.PlanTier
	if err := database.DB.Where("subscription_plan_id = ?", planID).Order("sort_order ASC, id ASC").Find(&tiers).Error; err != nil {
		return 0, err
	}
	if len(tiers) == 0 {
		return 0, errors.New("el plan no tiene tramos")
	}
	for _, t := range tiers {
		if billing+0.005 < t.MinBilling {
			continue
		}
		if t.MaxBilling != nil && billing > *t.MaxBilling+0.005 {
			continue
		}
		return t.MonthlyPrice, nil
	}
	return 0, fmt.Errorf("la facturación %.2f no cae en ningún tramo del plan", billing)
}

func (s *SubscriptionPlanService) Create(input *models.SubscriptionPlan, tiers []models.PlanTier) error {
	input.Name = strings.TrimSpace(input.Name)
	if input.Name == "" {
		return errors.New("el nombre del plan es requerido")
	}
	if input.PlanCategoryID == 0 {
		return errors.New("la categoría es requerida")
	}
	basis := strings.TrimSpace(input.BillingBasis)
	if basis == "" {
		basis = models.BillingBasisManual
	}
	if basis != models.BillingBasisManual && basis != models.BillingBasisDocumentsMonthSum {
		return errors.New("base de liquidación inválida")
	}
	input.BillingBasis = basis

	var cat models.PlanCategory
	if err := database.DB.First(&cat, input.PlanCategoryID).Error; err != nil {
		return errors.New("categoría inválida")
	}
	for i := range tiers {
		tiers[i].SubscriptionPlanID = 0
	}
	if err := validateTiersNonOverlap(tiers); err != nil {
		return err
	}

	return database.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(input).Error; err != nil {
			return err
		}
		for i := range tiers {
			tiers[i].SubscriptionPlanID = input.ID
			if err := tx.Create(&tiers[i]).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

func (s *SubscriptionPlanService) ReplaceTiers(planID uint, tiers []models.PlanTier) error {
	for i := range tiers {
		tiers[i].SubscriptionPlanID = planID
	}
	if err := validateTiersNonOverlap(tiers); err != nil {
		return err
	}
	return database.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("subscription_plan_id = ?", planID).Delete(&models.PlanTier{}).Error; err != nil {
			return err
		}
		for i := range tiers {
			tiers[i].ID = 0
			tiers[i].SubscriptionPlanID = planID
			if err := tx.Create(&tiers[i]).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

func (s *SubscriptionPlanService) Update(id uint, input *models.SubscriptionPlan) error {
	var p models.SubscriptionPlan
	if err := database.DB.First(&p, id).Error; err != nil {
		return err
	}
	if strings.TrimSpace(input.Name) != "" {
		p.Name = strings.TrimSpace(input.Name)
	}
	p.Description = input.Description
	p.Active = input.Active
	if strings.TrimSpace(input.BillingBasis) != "" {
		b := strings.TrimSpace(input.BillingBasis)
		if b != models.BillingBasisManual && b != models.BillingBasisDocumentsMonthSum {
			return errors.New("base de liquidación inválida")
		}
		p.BillingBasis = b
	}
	return database.DB.Save(&p).Error
}

func (s *SubscriptionPlanService) Delete(id uint) error {
	var cnt int64
	database.DB.Model(&models.Company{}).Where("subscription_plan_id = ?", id).Count(&cnt)
	if cnt > 0 {
		return errors.New("no se puede eliminar: hay empresas con este plan")
	}
	res := database.DB.Delete(&models.SubscriptionPlan{}, id)
	if res.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return res.Error
}
