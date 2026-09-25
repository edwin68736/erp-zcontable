package services

import (
	"errors"
	"strings"

	"miappfiber/database"
	"miappfiber/models"
)

// InformeDeudasListParams filtros del listado "Informe deudas" por empresa y período. Por ahora
// solo expone las columnas comunes a todos los módulos de actividad (código, dígito, razón
// social, RUC, asistente) — sin filtro de estado propio todavía, porque este módulo aún no tiene
// datos propios que declarar. Se irán agregando a medida que se defina qué se controla acá.
type InformeDeudasListParams struct {
	PeriodYM          string
	Q                 string
	AllowedCompanyIDs []uint
	Page              int
	PerPage           int
}

// InformeDeudasListRow fila del listado — solo las columnas comunes por ahora.
type InformeDeudasListRow struct {
	CompanyID         uint   `json:"company_id"`
	Code              string `json:"code"`
	Dig               string `json:"dig"`
	BusinessName      string `json:"business_name"`
	RUC               string `json:"ruc"`
	AssistantUsername string `json:"assistant_username"`
}

type informeDeudasListResult struct {
	Rows       []InformeDeudasListRow
	Total      int64
	Page       int
	PerPage    int
	TotalPages int
}

// ListInformeDeudas lista las empresas del alcance del usuario (igual que los demás módulos de
// actividad) con las columnas comunes. No comparte función/endpoint con los otros módulos a
// propósito: cada uno va a sumar columnas y acciones propias que no tienen sentido en los demás.
func (s *SupervisorService) ListInformeDeudas(p InformeDeudasListParams) (*informeDeudasListResult, error) {
	if !validPeriodYM(p.PeriodYM) {
		return nil, errors.New("período inválido (use YYYY-MM)")
	}
	page := p.Page
	if page < 1 {
		page = 1
	}
	perPage := p.PerPage
	if perPage < 1 {
		perPage = 20
	}
	if perPage > 200 {
		perPage = 200
	}

	q := database.DB.Model(&models.Company{}).
		Where("companies.client_type = ? AND companies.status = ?", models.CompanyClientTypeEstudio, "activo").
		Preload("Assistant")

	if len(p.AllowedCompanyIDs) > 0 {
		q = q.Where("companies.id IN ?", p.AllowedCompanyIDs)
	} else if p.AllowedCompanyIDs != nil {
		return &informeDeudasListResult{Rows: []InformeDeudasListRow{}, Page: page, PerPage: perPage}, nil
	}

	term := strings.TrimSpace(p.Q)
	if len(term) >= 2 {
		like := "%" + term + "%"
		q = q.Where("companies.ruc LIKE ? OR companies.business_name LIKE ?", like, like)
	}

	var total int64
	if err := q.Count(&total).Error; err != nil {
		return nil, err
	}

	var companies []models.Company
	if err := q.Order("companies.internal_code ASC").
		Offset((page - 1) * perPage).Limit(perPage).
		Find(&companies).Error; err != nil {
		return nil, err
	}

	rows := make([]InformeDeudasListRow, 0, len(companies))
	for _, c := range companies {
		rows = append(rows, InformeDeudasListRow{
			CompanyID:         c.ID,
			Code:              strings.TrimSpace(c.InternalCode),
			Dig:               s.companyDig(c.ID),
			BusinessName:      strings.TrimSpace(c.BusinessName),
			RUC:               strings.TrimSpace(c.RUC),
			AssistantUsername: assistantUsername(c.Assistant),
		})
	}

	return &informeDeudasListResult{
		Rows: rows, Total: total, Page: page, PerPage: perPage,
		TotalPages: sunatInboxTotalPages(total, perPage),
	}, nil
}
