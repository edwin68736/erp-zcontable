package services

import (
	"encoding/json"
	"errors"
	"regexp"
	"strings"
	"time"

	"miappfiber/database"
	"miappfiber/models"

	"gorm.io/gorm"
)

type ActivityRuleService struct{}

func NewActivityRuleService() *ActivityRuleService {
	return &ActivityRuleService{}
}

type ActivityRuleInput struct {
	Name          string
	Description   string
	CompareMode   string
	MaxUploadTime string
	GraceDays     int
	Active        bool
}

type ActivityRuleAuditDTO struct {
	ID             uint      `json:"id"`
	ActivityRuleID uint      `json:"activity_rule_id"`
	UserID         uint      `json:"user_id"`
	Action         string    `json:"action"`
	BeforeJSON     string    `json:"before_json,omitempty"`
	AfterJSON      string    `json:"after_json,omitempty"`
	CreatedAt      time.Time `json:"created_at"`
}

func validateActivityRuleInput(in ActivityRuleInput, isUpdate bool) error {
	in.Name = strings.TrimSpace(in.Name)
	if !isUpdate && in.Name == "" {
		return errors.New("name es obligatorio")
	}
	if in.Name != "" && len(in.Name) > 100 {
		return errors.New("name demasiado largo")
	}
	mode := strings.TrimSpace(in.CompareMode)
	if mode == "" {
		mode = models.ActivityRuleCompareDate
	}
	if mode != models.ActivityRuleCompareDate && mode != models.ActivityRuleCompareDateTime {
		return errors.New("compare_mode debe ser date o datetime")
	}
	if mode == models.ActivityRuleCompareDateTime {
		t := strings.TrimSpace(in.MaxUploadTime)
		if t == "" {
			return errors.New("max_upload_time es obligatorio cuando compare_mode es datetime")
		}
		if !regexp.MustCompile(`^([01][0-9]|2[0-3]):[0-5][0-9]$`).MatchString(t) {
			return errors.New("max_upload_time debe tener formato HH:MM")
		}
	}
	if in.GraceDays < 0 {
		return errors.New("grace_days debe ser >= 0")
	}
	return nil
}

func (s *ActivityRuleService) List() ([]models.ActivityRule, error) {
	var rows []models.ActivityRule
	err := database.DB.Order("name ASC, id ASC").Find(&rows).Error
	return rows, err
}

func (s *ActivityRuleService) ListActive() ([]models.ActivityRule, error) {
	var rows []models.ActivityRule
	err := database.DB.Where("active = ?", true).Order("name ASC, id ASC").Find(&rows).Error
	return rows, err
}

func (s *ActivityRuleService) GetByID(id uint) (*models.ActivityRule, error) {
	var row models.ActivityRule
	if err := database.DB.First(&row, id).Error; err != nil {
		return nil, errors.New("regla no encontrada")
	}
	return &row, nil
}

func (s *ActivityRuleService) Create(in ActivityRuleInput, userID uint) (*models.ActivityRule, error) {
	if err := validateActivityRuleInput(in, false); err != nil {
		return nil, err
	}
	mode := strings.TrimSpace(in.CompareMode)
	if mode == "" {
		mode = models.ActivityRuleCompareDate
	}
	row := models.ActivityRule{
		Name:          strings.TrimSpace(in.Name),
		Description:   strings.TrimSpace(in.Description),
		CompareMode:   mode,
		MaxUploadTime: strings.TrimSpace(in.MaxUploadTime),
		GraceDays:     in.GraceDays,
		Active:        in.Active,
	}
	err := database.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&row).Error; err != nil {
			return err
		}
		return s.writeAudit(tx, row.ID, userID, models.ActivityRuleAuditCreate, nil, &row)
	})
	if err != nil {
		return nil, err
	}
	return &row, nil
}

func (s *ActivityRuleService) Update(id uint, in ActivityRuleInput, userID uint) (*models.ActivityRule, error) {
	if err := validateActivityRuleInput(in, true); err != nil {
		return nil, err
	}
	var row models.ActivityRule
	if err := database.DB.First(&row, id).Error; err != nil {
		return nil, errors.New("regla no encontrada")
	}
	before := row
	if n := strings.TrimSpace(in.Name); n != "" {
		row.Name = n
	}
	row.Description = strings.TrimSpace(in.Description)
	if mode := strings.TrimSpace(in.CompareMode); mode != "" {
		row.CompareMode = mode
	}
	row.MaxUploadTime = strings.TrimSpace(in.MaxUploadTime)
	row.GraceDays = in.GraceDays
	row.Active = in.Active

	err := database.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Save(&row).Error; err != nil {
			return err
		}
		return s.writeAudit(tx, row.ID, userID, models.ActivityRuleAuditUpdate, &before, &row)
	})
	if err != nil {
		return nil, err
	}
	return &row, nil
}

func (s *ActivityRuleService) Delete(id uint, userID uint) error {
	var row models.ActivityRule
	if err := database.DB.First(&row, id).Error; err != nil {
		return errors.New("regla no encontrada")
	}
	return database.DB.Transaction(func(tx *gorm.DB) error {
		if err := s.writeAudit(tx, row.ID, userID, models.ActivityRuleAuditDelete, &row, nil); err != nil {
			return err
		}
		return tx.Delete(&row).Error
	})
}

func (s *ActivityRuleService) ListAudits(ruleID uint, limit int) ([]ActivityRuleAuditDTO, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	var rows []models.ActivityRuleAudit
	err := database.DB.Where("activity_rule_id = ?", ruleID).
		Order("created_at DESC, id DESC").
		Limit(limit).
		Find(&rows).Error
	if err != nil {
		return nil, err
	}
	out := make([]ActivityRuleAuditDTO, 0, len(rows))
	for _, r := range rows {
		out = append(out, ActivityRuleAuditDTO{
			ID:             r.ID,
			ActivityRuleID: r.ActivityRuleID,
			UserID:         r.UserID,
			Action:         r.Action,
			BeforeJSON:     r.BeforeJSON,
			AfterJSON:      r.AfterJSON,
			CreatedAt:      r.CreatedAt,
		})
	}
	return out, nil
}

func (s *ActivityRuleService) writeAudit(tx *gorm.DB, ruleID, userID uint, action string, before, after *models.ActivityRule) error {
	var beforeJSON, afterJSON string
	if before != nil {
		b, err := json.Marshal(before)
		if err != nil {
			return err
		}
		beforeJSON = string(b)
	}
	if after != nil {
		b, err := json.Marshal(after)
		if err != nil {
			return err
		}
		afterJSON = string(b)
	}
	audit := models.ActivityRuleAudit{
		ActivityRuleID: ruleID,
		UserID:         userID,
		Action:         action,
		BeforeJSON:     beforeJSON,
		AfterJSON:      afterJSON,
	}
	return tx.Create(&audit).Error
}

// LoadActiveActivityRule carga regla activa por ID (nullable).
func LoadActiveActivityRule(ruleID *uint) (*models.ActivityRule, error) {
	if ruleID == nil || *ruleID == 0 {
		return nil, nil
	}
	var rule models.ActivityRule
	if err := database.DB.First(&rule, *ruleID).Error; err != nil {
		return nil, err
	}
	if !rule.Active {
		return nil, nil
	}
	return &rule, nil
}
