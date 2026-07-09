package services

import (
	"errors"
	"fmt"
	"strings"

	"miappfiber/database"
	"miappfiber/models"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// FormatFiscalCorrelative genera el número visible (ej. B001-00000003).
func FormatFiscalCorrelative(series string, number int) string {
	serie := strings.TrimSpace(strings.ToUpper(series))
	if serie == "" {
		serie = "X"
	}
	if number < 1 {
		number = 1
	}
	return fmt.Sprintf("%s-%08d", serie, number)
}

// NextCorrelativePreview muestra el siguiente número sin reservarlo.
func NextCorrelativePreview(ser *models.FiscalDocumentSeries) string {
	if ser == nil {
		return ""
	}
	return FormatFiscalCorrelative(ser.Series, ser.CurrentNumber+1)
}

type FiscalDocumentSeriesService struct{}

func NewFiscalDocumentSeriesService() *FiscalDocumentSeriesService {
	return &FiscalDocumentSeriesService{}
}

func (s *FiscalDocumentSeriesService) List(activeOnly bool, sunatCode string) ([]models.FiscalDocumentSeries, error) {
	q := database.DB.Model(&models.FiscalDocumentSeries{}).Order("sunat_code ASC, series ASC")
	if activeOnly {
		q = q.Where("active = ?", true)
	}
	if c := strings.TrimSpace(sunatCode); c != "" {
		q = q.Where("sunat_code = ?", c)
	}
	var list []models.FiscalDocumentSeries
	return list, q.Find(&list).Error
}

func (s *FiscalDocumentSeriesService) GetByID(id uint) (*models.FiscalDocumentSeries, error) {
	var row models.FiscalDocumentSeries
	if err := database.DB.First(&row, id).Error; err != nil {
		return nil, err
	}
	return &row, nil
}

type FiscalDocumentSeriesInput struct {
	Name          string `json:"name"`
	SunatCode     string `json:"sunat_code"`
	Series        string `json:"series"`
	CurrentNumber *int   `json:"current_number"`
	Active        *bool  `json:"active"`
	Description   string `json:"description"`
}

func normalizeSunatCode(code string) (string, error) {
	c := strings.TrimSpace(code)
	switch c {
	case "00", "01", "03":
		return c, nil
	default:
		return "", errors.New("código SUNAT inválido (use 00, 01 o 03)")
	}
}

func normalizeSeriesCode(series string) (string, error) {
	s := strings.TrimSpace(strings.ToUpper(series))
	if s == "" {
		return "", errors.New("la serie es obligatoria")
	}
	if len(s) > 20 {
		return "", errors.New("la serie no puede superar 20 caracteres")
	}
	return s, nil
}

func (s *FiscalDocumentSeriesService) seriesPairExists(sunatCode, series string, excludeID uint) (bool, error) {
	q := database.DB.Model(&models.FiscalDocumentSeries{}).
		Where("sunat_code = ? AND series = ?", sunatCode, series)
	if excludeID > 0 {
		q = q.Where("id <> ?", excludeID)
	}
	var n int64
	if err := q.Count(&n).Error; err != nil {
		return false, err
	}
	return n > 0, nil
}

func duplicateSeriesError(sunatCode, series string) error {
	return fmt.Errorf("ya existe la serie %s para este tipo de comprobante (SUNAT %s)", series, sunatCode)
}

func (s *FiscalDocumentSeriesService) Create(in *FiscalDocumentSeriesInput) (*models.FiscalDocumentSeries, error) {
	if in == nil {
		return nil, errors.New("datos inválidos")
	}
	sunat, err := normalizeSunatCode(in.SunatCode)
	if err != nil {
		return nil, err
	}
	serie, err := normalizeSeriesCode(in.Series)
	if err != nil {
		return nil, err
	}
	name := strings.TrimSpace(in.Name)
	if name == "" {
		return nil, errors.New("el nombre es obligatorio")
	}
	cur := 0
	if in.CurrentNumber != nil && *in.CurrentNumber >= 0 {
		cur = *in.CurrentNumber
	}
	active := true
	if in.Active != nil {
		active = *in.Active
	}
	exists, err := s.seriesPairExists(sunat, serie, 0)
	if err != nil {
		return nil, err
	}
	if exists {
		return nil, duplicateSeriesError(sunat, serie)
	}
	row := models.FiscalDocumentSeries{
		Name:          name,
		SunatCode:     sunat,
		Series:        serie,
		CurrentNumber: cur,
		Active:        active,
		Description:   strings.TrimSpace(in.Description),
	}
	if err := database.DB.Create(&row).Error; err != nil {
		return nil, err
	}
	return &row, nil
}

func (s *FiscalDocumentSeriesService) Update(id uint, in *FiscalDocumentSeriesInput) (*models.FiscalDocumentSeries, error) {
	row, err := s.GetByID(id)
	if err != nil {
		return nil, err
	}
	if in == nil {
		return nil, errors.New("datos inválidos")
	}
	if n := strings.TrimSpace(in.Name); n != "" {
		row.Name = n
	}
	newSunat := row.SunatCode
	if in.SunatCode != "" {
		sunat, err := normalizeSunatCode(in.SunatCode)
		if err != nil {
			return nil, err
		}
		newSunat = sunat
	}
	newSerie := row.Series
	if in.Series != "" {
		serie, err := normalizeSeriesCode(in.Series)
		if err != nil {
			return nil, err
		}
		newSerie = serie
	}
	exists, err := s.seriesPairExists(newSunat, newSerie, row.ID)
	if err != nil {
		return nil, err
	}
	if exists {
		return nil, duplicateSeriesError(newSunat, newSerie)
	}
	row.SunatCode = newSunat
	row.Series = newSerie
	if in.CurrentNumber != nil && *in.CurrentNumber >= 0 {
		row.CurrentNumber = *in.CurrentNumber
	}
	if in.Active != nil {
		row.Active = *in.Active
	}
	row.Description = strings.TrimSpace(in.Description)
	if err := database.DB.Save(row).Error; err != nil {
		return nil, err
	}
	return row, nil
}

// ReserveNextNumber incrementa el correlativo con bloqueo de fila (transacción).
func (s *FiscalDocumentSeriesService) ReserveNextNumber(seriesID uint) (fullNumber string, issuedNumber int, err error) {
	err = database.DB.Transaction(func(tx *gorm.DB) error {
		var ser models.FiscalDocumentSeries
		if e := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&ser, seriesID).Error; e != nil {
			return e
		}
		if !ser.Active {
			return errors.New("la serie está inactiva")
		}
		issuedNumber = ser.CurrentNumber + 1
		ser.CurrentNumber = issuedNumber
		if e := tx.Save(&ser).Error; e != nil {
			return e
		}
		fullNumber = FormatFiscalCorrelative(ser.Series, issuedNumber)
		return nil
	})
	return fullNumber, issuedNumber, err
}

// SunatCodeForComprobanteKind mapea kind de emisión a código SUNAT.
func SunatCodeForComprobanteKind(kind string) string {
	switch strings.ToLower(strings.TrimSpace(kind)) {
	case "factura":
		return "01"
	case "boleta":
		return "03"
	case "sale_note", "nota_venta", "nv":
		return "00"
	default:
		return ""
	}
}
