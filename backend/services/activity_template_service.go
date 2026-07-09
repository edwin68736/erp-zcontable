package services

import (
	"errors"
	"fmt"
	"regexp"
	"strings"

	"miappfiber/database"
	"miappfiber/models"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type ActivityTemplateService struct{}

func NewActivityTemplateService() *ActivityTemplateService {
	return &ActivityTemplateService{}
}

var (
	hexTemplateTextColorRe = regexp.MustCompile(`^#[0-9A-Fa-f]{6}$`)
	faIconPrefixRe         = regexp.MustCompile(`^(fas|far|fab|fa-solid|fa-regular|fa-brands)\s+fa-[a-z0-9-]+$`)
)

var validActivityTypes = map[string]struct{}{
	models.CalendarActivityNPS:          {},
	models.CalendarActivityPDT601:       {},
	models.CalendarActivityPDT621:       {},
	models.CalendarActivitySIRE:         {},
	models.CalendarActivityPayment:      {},
	models.CalendarActivityLiquidation:  {},
	models.CalendarActivityReport:       {},
	models.CalendarActivityClosing:      {},
	models.CalendarActivityDetracciones: {},
	models.CalendarActivitySunatInbox:   {},
	models.CalendarActivityOther:        {},
}

var validActivityPriorities = map[string]struct{}{
	models.SupervisorPriorityBaja:    {},
	models.SupervisorPriorityMedia:   {},
	models.SupervisorPriorityAlta:    {},
	models.SupervisorPriorityCritica: {},
}

// ActivityTemplateInput datos de alta/edición (code autogenerado en create).
type ActivityTemplateInput struct {
	Name          string
	Description   string
	ActivityType  string
	Priority      string
	TextColor     string
	Icon          string
	SortOrder     int
	IsValidatable *bool
	Active        *bool
}

// ActivityTemplateListParams filtros de listado.
type ActivityTemplateListParams struct {
	ActiveOnly bool
}

// FormatActivityCode genera el código visible (AC001, AC1000, …).
func FormatActivityCode(n uint) string {
	if n < 1000 {
		return fmt.Sprintf("%s%03d", models.ActivityCodePrefix, n)
	}
	return fmt.Sprintf("%s%d", models.ActivityCodePrefix, n)
}

// GenerateNextCode reserva el siguiente correlativo (transacción + bloqueo de fila).
func (s *ActivityTemplateService) GenerateNextCode() (string, error) {
	var code string
	err := database.DB.Transaction(func(tx *gorm.DB) error {
		n, err := s.reserveNextActivityNumber(tx)
		if err != nil {
			return err
		}
		code = FormatActivityCode(n)
		return nil
	})
	return code, err
}

func (s *ActivityTemplateService) reserveNextActivityNumber(tx *gorm.DB) (uint, error) {
	var seq models.ActivityCodeSequence
	err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("prefix = ?", models.ActivityCodePrefix).
		First(&seq).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			seq = models.ActivityCodeSequence{Prefix: models.ActivityCodePrefix, LastNumber: 0}
			if err := tx.Create(&seq).Error; err != nil {
				return 0, err
			}
		} else {
			return 0, err
		}
	}
	seq.LastNumber++
	if err := tx.Save(&seq).Error; err != nil {
		return 0, err
	}
	return seq.LastNumber, nil
}

func normalizeTemplateTextColor(c string) string {
	c = strings.TrimSpace(c)
	if hexTemplateTextColorRe.MatchString(c) {
		return strings.ToLower(c)
	}
	return "#1d4ed8"
}

func normalizeTemplateIcon(icon string) string {
	icon = strings.TrimSpace(icon)
	if icon == "" {
		return ""
	}
	if len(icon) > 80 {
		icon = icon[:80]
	}
	return icon
}

func validateActivityType(t string) error {
	t = strings.TrimSpace(t)
	if t == "" {
		return errors.New("activity_type requerido")
	}
	if _, ok := validActivityTypes[t]; !ok {
		return errors.New("activity_type inválido")
	}
	return nil
}

func validateActivityPriority(p string) error {
	p = strings.TrimSpace(p)
	if p == "" {
		return nil
	}
	if _, ok := validActivityPriorities[p]; !ok {
		return errors.New("priority inválida")
	}
	return nil
}

func validateTemplateIcon(icon string) error {
	icon = strings.TrimSpace(icon)
	if icon == "" {
		return nil
	}
	if !faIconPrefixRe.MatchString(icon) {
		return errors.New("icon inválido: use formato Font Awesome (ej. fas fa-file-invoice)")
	}
	return nil
}

func (s *ActivityTemplateService) normalizeInput(in *ActivityTemplateInput) error {
	in.Name = strings.TrimSpace(in.Name)
	in.Description = strings.TrimSpace(in.Description)
	in.ActivityType = strings.TrimSpace(in.ActivityType)
	in.Priority = strings.TrimSpace(in.Priority)
	in.Icon = normalizeTemplateIcon(in.Icon)
	in.TextColor = normalizeTemplateTextColor(in.TextColor)

	if in.Name == "" {
		return errors.New("name requerido")
	}
	if len(in.Name) > 200 {
		return errors.New("name demasiado largo")
	}
	if err := validateActivityType(in.ActivityType); err != nil {
		return err
	}
	if in.Priority == "" {
		in.Priority = models.SupervisorPriorityMedia
	}
	if err := validateActivityPriority(in.Priority); err != nil {
		return err
	}
	if err := validateTemplateIcon(in.Icon); err != nil {
		return err
	}
	return nil
}

func (s *ActivityTemplateService) List(p ActivityTemplateListParams) ([]models.ActivityTemplate, error) {
	q := database.DB.Order("sort_order ASC, name ASC")
	if p.ActiveOnly {
		q = q.Where("active = ?", true)
	}
	var rows []models.ActivityTemplate
	if err := q.Find(&rows).Error; err != nil {
		return nil, err
	}
	return rows, nil
}

func (s *ActivityTemplateService) GetByID(id uint) (*models.ActivityTemplate, error) {
	var row models.ActivityTemplate
	if err := database.DB.First(&row, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errors.New("plantilla no encontrada")
		}
		return nil, err
	}
	return &row, nil
}

func (s *ActivityTemplateService) Create(in ActivityTemplateInput) (*models.ActivityTemplate, error) {
	if err := s.normalizeInput(&in); err != nil {
		return nil, err
	}
	isValidatable := in.ActivityType != models.CalendarActivityOther
	if in.IsValidatable != nil {
		isValidatable = *in.IsValidatable
	}
	active := true
	if in.Active != nil {
		active = *in.Active
	}

	var created models.ActivityTemplate
	err := database.DB.Transaction(func(tx *gorm.DB) error {
		n, err := s.reserveNextActivityNumber(tx)
		if err != nil {
			return err
		}
		created = models.ActivityTemplate{
			Code:          FormatActivityCode(n),
			Name:          in.Name,
			Description:   in.Description,
			ActivityType:  in.ActivityType,
			Priority:      in.Priority,
			TextColor:     in.TextColor,
			Icon:          in.Icon,
			SortOrder:     in.SortOrder,
			IsValidatable: isValidatable,
			Active:        active,
		}
		return tx.Create(&created).Error
	})
	if err != nil {
		return nil, err
	}
	return &created, nil
}

func (s *ActivityTemplateService) Update(id uint, in ActivityTemplateInput) (*models.ActivityTemplate, error) {
	row, err := s.GetByID(id)
	if err != nil {
		return nil, err
	}
	if err := s.normalizeInput(&in); err != nil {
		return nil, err
	}

	row.Name = in.Name
	row.Description = in.Description
	row.ActivityType = in.ActivityType
	row.Priority = in.Priority
	row.TextColor = in.TextColor
	row.Icon = in.Icon
	row.SortOrder = in.SortOrder
	if in.IsValidatable != nil {
		row.IsValidatable = *in.IsValidatable
	}
	if in.Active != nil {
		row.Active = *in.Active
	}

	if err := database.DB.Save(row).Error; err != nil {
		return nil, err
	}
	return row, nil
}

func (s *ActivityTemplateService) SetActive(id uint, active bool) (*models.ActivityTemplate, error) {
	row, err := s.GetByID(id)
	if err != nil {
		return nil, err
	}
	row.Active = active
	if err := database.DB.Save(row).Error; err != nil {
		return nil, err
	}
	return row, nil
}

func (s *ActivityTemplateService) SetActivityRule(id uint, ruleID *uint) (*models.ActivityTemplate, error) {
	row, err := s.GetByID(id)
	if err != nil {
		return nil, err
	}
	if ruleID != nil && *ruleID > 0 {
		var rule models.ActivityRule
		if err := database.DB.First(&rule, *ruleID).Error; err != nil {
			return nil, errors.New("regla no encontrada")
		}
		idCopy := *ruleID
		row.ActivityRuleID = &idCopy
	} else {
		row.ActivityRuleID = nil
	}
	if err := database.DB.Save(row).Error; err != nil {
		return nil, err
	}
	return row, nil
}

func (s *ActivityTemplateService) CountCalendarReferences(templateID uint) (int64, error) {
	var n int64
	err := database.DB.Unscoped().Model(&models.FinanceCalendarActivity{}).
		Where("activity_template_id = ?", templateID).
		Count(&n).Error
	return n, err
}

func (s *ActivityTemplateService) Delete(id uint) error {
	row, err := s.GetByID(id)
	if err != nil {
		return err
	}
	n, err := s.CountCalendarReferences(row.ID)
	if err != nil {
		return err
	}
	if n > 0 {
		return errors.New("no se puede eliminar: la plantilla tiene actividades en calendarios; desactívela con active=false")
	}
	res := database.DB.Delete(row)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return errors.New("plantilla no encontrada")
	}
	return nil
}

// PreviewNextCode muestra el siguiente código sin reservarlo.
func (s *ActivityTemplateService) PreviewNextCode() (string, error) {
	var seq models.ActivityCodeSequence
	err := database.DB.Where("prefix = ?", models.ActivityCodePrefix).First(&seq).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return FormatActivityCode(1), nil
		}
		return "", err
	}
	return FormatActivityCode(seq.LastNumber + 1), nil
}
