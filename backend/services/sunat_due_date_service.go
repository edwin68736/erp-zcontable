package services

import (
	"encoding/json"
	"fmt"
	"time"

	"miappfiber/database"
	"miappfiber/models"

	"gorm.io/gorm"
)

// SunatDueDateRow fila expuesta a la API: mes calendario + 10 fechas de vencimiento
// (una por dígito de RUC 0-9, en formato AAAA-MM-DD; "" si aún no está definida).
type SunatDueDateRow struct {
	Month     int        `json:"month"`
	Dates     [10]string `json:"dates"`
	UpdatedAt string     `json:"updated_at,omitempty"`
}

// SunatDueDateUpdateInput fecha por mes (PUT); las filas no incluidas no se modifican.
type SunatDueDateUpdateInput struct {
	Month int        `json:"month"`
	Dates [10]string `json:"dates"`
}

type SunatDueDateService struct{}

func NewSunatDueDateService() *SunatDueDateService { return &SunatDueDateService{} }

// sunatDueDateSeedDefaults valores iniciales = cronograma oficial SUNAT 2026 (referencia del
// estudio al momento de construir esta vista). El mes 12 (diciembre) vence en enero del año
// siguiente, como corresponde al cronograma real.
var sunatDueDateSeedDefaults = map[int][10]string{
	1:  {"2026-02-09", "2026-02-10", "2026-02-11", "2026-02-11", "2026-02-12", "2026-02-12", "2026-02-13", "2026-02-13", "2026-02-16", "2026-02-16"},
	2:  {"2026-03-09", "2026-03-10", "2026-03-11", "2026-03-11", "2026-03-12", "2026-03-12", "2026-03-13", "2026-03-13", "2026-03-16", "2026-03-16"},
	3:  {"2026-04-08", "2026-04-09", "2026-04-10", "2026-04-10", "2026-04-13", "2026-04-13", "2026-04-14", "2026-04-14", "2026-04-15", "2026-04-15"},
	4:  {"2026-05-09", "2026-05-11", "2026-05-12", "2026-05-12", "2026-05-13", "2026-05-13", "2026-05-14", "2026-05-14", "2026-05-15", "2026-05-15"},
	5:  {"2026-06-08", "2026-06-09", "2026-06-10", "2026-06-10", "2026-06-11", "2026-06-11", "2026-06-12", "2026-06-12", "2026-06-15", "2026-06-15"},
	6:  {"2026-07-08", "2026-07-09", "2026-07-10", "2026-07-10", "2026-07-13", "2026-07-13", "2026-07-14", "2026-07-14", "2026-07-15", "2026-07-15"},
	7:  {"2026-08-10", "2026-08-11", "2026-08-12", "2026-08-12", "2026-08-13", "2026-08-13", "2026-08-14", "2026-08-14", "2026-08-17", "2026-08-17"},
	8:  {"2026-09-08", "2026-09-09", "2026-09-10", "2026-09-10", "2026-09-11", "2026-09-11", "2026-09-14", "2026-09-14", "2026-09-15", "2026-09-15"},
	9:  {"2026-10-09", "2026-10-12", "2026-10-13", "2026-10-13", "2026-10-14", "2026-10-14", "2026-10-15", "2026-10-15", "2026-10-16", "2026-10-16"},
	10: {"2026-11-09", "2026-11-10", "2026-11-11", "2026-11-11", "2026-11-12", "2026-11-12", "2026-11-13", "2026-11-13", "2026-11-16", "2026-11-16"},
	11: {"2026-12-10", "2026-12-11", "2026-12-14", "2026-12-14", "2026-12-15", "2026-12-15", "2026-12-16", "2026-12-16", "2026-12-17", "2026-12-17"},
	12: {"2027-01-08", "2027-01-11", "2027-01-12", "2027-01-12", "2027-01-13", "2027-01-13", "2027-01-14", "2027-01-14", "2027-01-15", "2027-01-15"},
}

// EnsureSeeded crea las 12 filas fijas si aún no existen (idempotente; nunca sobrescribe
// filas ya presentes, ni siquiera con datos "más nuevos" — la edición es siempre manual).
func (s *SunatDueDateService) EnsureSeeded() error {
	var count int64
	if err := database.DB.Model(&models.SunatDueDateCalendarRow{}).Count(&count).Error; err != nil {
		return err
	}
	if count > 0 {
		return nil
	}
	return database.DB.Transaction(func(tx *gorm.DB) error {
		for month := 1; month <= 12; month++ {
			raw, err := json.Marshal(sunatDueDateSeedDefaults[month])
			if err != nil {
				return err
			}
			row := models.SunatDueDateCalendarRow{Month: month, DatesJSON: string(raw)}
			if err := tx.Create(&row).Error; err != nil {
				return fmt.Errorf("sembrar mes %d: %w", month, err)
			}
		}
		return nil
	})
}

func rowToDTO(r models.SunatDueDateCalendarRow) SunatDueDateRow {
	var dates [10]string
	_ = json.Unmarshal([]byte(r.DatesJSON), &dates)
	return SunatDueDateRow{
		Month:     r.Month,
		Dates:     dates,
		UpdatedAt: r.UpdatedAt.Format(time.RFC3339),
	}
}

// List devuelve las 12 filas (sembrando primero si la tabla está vacía).
func (s *SunatDueDateService) List() ([]SunatDueDateRow, error) {
	if err := s.EnsureSeeded(); err != nil {
		return nil, err
	}
	var rows []models.SunatDueDateCalendarRow
	if err := database.DB.Order("month ASC").Find(&rows).Error; err != nil {
		return nil, err
	}
	out := make([]SunatDueDateRow, 0, len(rows))
	for _, r := range rows {
		out = append(out, rowToDTO(r))
	}
	return out, nil
}

func validateSunatDueDate(s string) error {
	if s == "" {
		return nil
	}
	if _, err := time.Parse("2006-01-02", s); err != nil {
		return fmt.Errorf("fecha inválida %q (use AAAA-MM-DD)", s)
	}
	return nil
}

// Update reemplaza las fechas de los meses indicados. Nunca crea ni elimina filas: la fila de
// cada mes ya existe desde la siembra inicial (EnsureSeeded), esto solo la edita.
func (s *SunatDueDateService) Update(userID uint, rows []SunatDueDateUpdateInput) ([]SunatDueDateRow, error) {
	if err := s.EnsureSeeded(); err != nil {
		return nil, err
	}
	for _, r := range rows {
		if r.Month < 1 || r.Month > 12 {
			return nil, fmt.Errorf("mes inválido: %d", r.Month)
		}
		for _, d := range r.Dates {
			if err := validateSunatDueDate(d); err != nil {
				return nil, err
			}
		}
	}
	err := database.DB.Transaction(func(tx *gorm.DB) error {
		for _, r := range rows {
			raw, err := json.Marshal(r.Dates)
			if err != nil {
				return err
			}
			res := tx.Model(&models.SunatDueDateCalendarRow{}).
				Where("month = ?", r.Month).
				Updates(map[string]interface{}{
					"dates_json":         string(raw),
					"updated_by_user_id": userID,
				})
			if res.Error != nil {
				return res.Error
			}
			if res.RowsAffected == 0 {
				return fmt.Errorf("mes %d no encontrado", r.Month)
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return s.List()
}
