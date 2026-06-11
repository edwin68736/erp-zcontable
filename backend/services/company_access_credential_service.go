package services

import (
	"errors"
	"fmt"
	"sort"
	"strings"

	"miappfiber/database"
	"miappfiber/models"

	"gorm.io/gorm"
)

type CompanyAccessCredentialService struct{}

func NewCompanyAccessCredentialService() *CompanyAccessCredentialService {
	return &CompanyAccessCredentialService{}
}

// CompanyAccessCredentialRow fila de listado (empresa + credenciales).
type CompanyAccessCredentialRow struct {
	CompanyID uint `json:"company_id"`
	Code      string `json:"code"`
	Dig       string `json:"dig"`
	RUC       string `json:"ruc"`
	BusinessName string `json:"business_name"`
	AssistantUserID    *uint  `json:"assistant_user_id,omitempty"`
	SupervisorUserID   *uint  `json:"supervisor_user_id,omitempty"`
	AssistantUsername  string `json:"assistant_username"`
	SupervisorUsername string `json:"supervisor_username"`

	SolUsuario string `json:"sol_usuario"`
	SolClave   string `json:"sol_clave"`

	BnlCuenta            string `json:"bnl_cuenta"`
	BnlDNI               string `json:"bnl_dni"`
	BnlClaveDetracciones string `json:"bnl_clave_detracciones"`

	AfpUsuario string `json:"afp_usuario"`
	AfpClave   string `json:"afp_clave"`

	RnpClave string `json:"rnp_clave"`

	FacturadorLink       string `json:"facturador_link"`
	FacturadorUsuario    string `json:"facturador_usuario"`
	FacturadorContrasena string `json:"facturador_contrasena"`

	UpdatedAt *string `json:"credentials_updated_at,omitempty"`
}

type CompanyAccessCredentialListParams struct {
	Q                 string
	Page              int
	PerPage           int
	AllowedCompanyIDs []uint
	AssistantUserID   uint
	SupervisorUserID  uint
	Dig               string
}

// CredentialFilterUserOption usuario para filtros de asistente/supervisor.
type CredentialFilterUserOption struct {
	UserID   uint   `json:"user_id"`
	Username string `json:"username"`
}

// CompanyAccessCredentialFilterFacets opciones de filtro y colores por dígito.
type CompanyAccessCredentialFilterFacets struct {
	Assistants           []CredentialFilterUserOption `json:"assistants"`
	Supervisors          []CredentialFilterUserOption `json:"supervisors"`
	ClavesSolDigColorsJSON string                     `json:"claves_sol_dig_colors_json,omitempty"`
}

type CompanyAccessCredentialListResult struct {
	Rows       []CompanyAccessCredentialRow `json:"data"`
	Total      int64                        `json:"total"`
	Page       int                          `json:"page"`
	PerPage    int                          `json:"per_page"`
	TotalPages int                          `json:"total_pages"`
}

// CompanyAccessCredentialUpdateInput campos editables (no RUC ni razón social).
type CompanyAccessCredentialUpdateInput struct {
	Dig                  string `json:"dig"`
	SolUsuario           string `json:"sol_usuario"`
	SolClave             string `json:"sol_clave"`
	BnlCuenta            string `json:"bnl_cuenta"`
	BnlDNI               string `json:"bnl_dni"`
	BnlClaveDetracciones string `json:"bnl_clave_detracciones"`
	AfpUsuario           string `json:"afp_usuario"`
	AfpClave             string `json:"afp_clave"`
	RnpClave             string `json:"rnp_clave"`
	FacturadorLink       string `json:"facturador_link"`
	FacturadorUsuario    string `json:"facturador_usuario"`
	FacturadorContrasena string `json:"facturador_contrasena"`
}

func userUsername(u *models.User) string {
	if u == nil {
		return ""
	}
	return strings.TrimSpace(u.Username)
}

func (s *CompanyAccessCredentialService) companyInScope(companyID uint, allowed []uint) error {
	if allowed == nil {
		return nil
	}
	for _, id := range allowed {
		if id == companyID {
			return nil
		}
	}
	return fmt.Errorf("empresa no disponible en su alcance")
}

func (s *CompanyAccessCredentialService) rowFrom(company models.Company, cred *models.CompanyAccessCredential) CompanyAccessCredentialRow {
	row := CompanyAccessCredentialRow{
		CompanyID:          company.ID,
		Code:               strings.TrimSpace(company.InternalCode),
		RUC:                strings.TrimSpace(company.RUC),
		BusinessName:       strings.TrimSpace(company.BusinessName),
		AssistantUserID:    company.AssistantUserID,
		SupervisorUserID:   company.SupervisorUserID,
		AssistantUsername:  userUsername(company.Assistant),
		SupervisorUsername: userUsername(company.Supervisor),
	}
	if cred != nil {
		row.Dig = cred.Dig
		row.SolUsuario = cred.SolUsuario
		row.SolClave = cred.SolClave
		row.BnlCuenta = cred.BnlCuenta
		row.BnlDNI = cred.BnlDNI
		row.BnlClaveDetracciones = cred.BnlClaveDetracciones
		row.AfpUsuario = cred.AfpUsuario
		row.AfpClave = cred.AfpClave
		row.RnpClave = cred.RnpClave
		row.FacturadorLink = cred.FacturadorLink
		row.FacturadorUsuario = cred.FacturadorUsuario
		row.FacturadorContrasena = cred.FacturadorContrasena
		ts := cred.UpdatedAt.Format("2006-01-02T15:04:05Z07:00")
		row.UpdatedAt = &ts
	}
	return row
}

func (s *CompanyAccessCredentialService) List(p CompanyAccessCredentialListParams) (*CompanyAccessCredentialListResult, error) {
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
		Where("client_type = ? AND status = ?", models.CompanyClientTypeEstudio, "activo").
		Preload("Assistant").
		Preload("Supervisor")

	if p.AllowedCompanyIDs != nil {
		if len(p.AllowedCompanyIDs) == 0 {
			return &CompanyAccessCredentialListResult{
				Rows: []CompanyAccessCredentialRow{}, Total: 0, Page: page, PerPage: perPage, TotalPages: 0,
			}, nil
		}
		q = q.Where("id IN ?", p.AllowedCompanyIDs)
	}

	term := strings.TrimSpace(p.Q)
	if len(term) >= 2 {
		like := "%" + term + "%"
		q = q.Where(
			"ruc LIKE ? OR business_name LIKE ? OR internal_code LIKE ?",
			like, like, like,
		)
	}

	if p.AssistantUserID > 0 {
		q = q.Where("assistant_user_id = ?", p.AssistantUserID)
	}
	if p.SupervisorUserID > 0 {
		q = q.Where("supervisor_user_id = ?", p.SupervisorUserID)
	}
	if dig := normalizeCredentialDigFilter(p.Dig); dig != "" {
		q = q.Where(
			`EXISTS (
				SELECT 1 FROM company_access_credentials c
				WHERE c.company_id = companies.id AND TRIM(c.dig) = ?
			)`,
			dig,
		)
	}

	var total int64
	if err := q.Count(&total).Error; err != nil {
		return nil, err
	}

	var companies []models.Company
	offset := (page - 1) * perPage
	if err := q.Order("internal_code ASC").Offset(offset).Limit(perPage).Find(&companies).Error; err != nil {
		return nil, err
	}

	ids := make([]uint, 0, len(companies))
	for _, c := range companies {
		ids = append(ids, c.ID)
	}
	credByCompany := map[uint]*models.CompanyAccessCredential{}
	if len(ids) > 0 {
		var creds []models.CompanyAccessCredential
		if err := database.DB.Where("company_id IN ?", ids).Find(&creds).Error; err != nil {
			return nil, err
		}
		for i := range creds {
			credByCompany[creds[i].CompanyID] = &creds[i]
		}
	}

	rows := make([]CompanyAccessCredentialRow, 0, len(companies))
	for _, c := range companies {
		rows = append(rows, s.rowFrom(c, credByCompany[c.ID]))
	}

	totalPages := 0
	if total > 0 {
		totalPages = int((total + int64(perPage) - 1) / int64(perPage))
	}

	return &CompanyAccessCredentialListResult{
		Rows: rows, Total: total, Page: page, PerPage: perPage, TotalPages: totalPages,
	}, nil
}

func normalizeCredentialDigFilter(d string) string {
	d = strings.TrimSpace(d)
	if d == "" {
		return ""
	}
	ch := d[0]
	if ch >= '0' && ch <= '9' {
		return string(ch)
	}
	return ""
}

func (s *CompanyAccessCredentialService) FilterFacets(allowed []uint) (*CompanyAccessCredentialFilterFacets, error) {
	q := database.DB.Model(&models.Company{}).
		Where("client_type = ? AND status = ?", models.CompanyClientTypeEstudio, "activo")
	if allowed != nil {
		if len(allowed) == 0 {
			return &CompanyAccessCredentialFilterFacets{
				Assistants:  []CredentialFilterUserOption{},
				Supervisors: []CredentialFilterUserOption{},
			}, nil
		}
		q = q.Where("id IN ?", allowed)
	}

	var companies []models.Company
	if err := q.Preload("Assistant").Preload("Supervisor").Find(&companies).Error; err != nil {
		return nil, err
	}

	assistantSeen := map[uint]struct{}{}
	supervisorSeen := map[uint]struct{}{}
	var assistants []CredentialFilterUserOption
	var supervisors []CredentialFilterUserOption

	for _, c := range companies {
		if c.AssistantUserID != nil && *c.AssistantUserID > 0 {
			if _, ok := assistantSeen[*c.AssistantUserID]; !ok {
				assistantSeen[*c.AssistantUserID] = struct{}{}
				assistants = append(assistants, CredentialFilterUserOption{
					UserID:   *c.AssistantUserID,
					Username: userUsername(c.Assistant),
				})
			}
		}
		if c.SupervisorUserID != nil && *c.SupervisorUserID > 0 {
			if _, ok := supervisorSeen[*c.SupervisorUserID]; !ok {
				supervisorSeen[*c.SupervisorUserID] = struct{}{}
				supervisors = append(supervisors, CredentialFilterUserOption{
					UserID:   *c.SupervisorUserID,
					Username: userUsername(c.Supervisor),
				})
			}
		}
	}

	sortCredentialFilterUsers(assistants)
	sortCredentialFilterUsers(supervisors)

	digColorsJSON := ""
	if cfg, err := NewConfigService().GetFirmConfig(); err == nil && cfg != nil {
		digColorsJSON = strings.TrimSpace(cfg.ClavesSolDigColorsJSON)
	}

	return &CompanyAccessCredentialFilterFacets{
		Assistants:             assistants,
		Supervisors:            supervisors,
		ClavesSolDigColorsJSON: digColorsJSON,
	}, nil
}

func sortCredentialFilterUsers(list []CredentialFilterUserOption) {
	sort.Slice(list, func(i, j int) bool {
		a := strings.ToLower(list[i].Username)
		b := strings.ToLower(list[j].Username)
		if a == b {
			return list[i].UserID < list[j].UserID
		}
		return a < b
	})
}

func (s *CompanyAccessCredentialService) GetByCompanyID(companyID uint, allowed []uint) (*CompanyAccessCredentialRow, error) {
	if err := s.companyInScope(companyID, allowed); err != nil {
		return nil, err
	}
	var company models.Company
	if err := database.DB.Where("id = ? AND client_type = ? AND status = ?", companyID, models.CompanyClientTypeEstudio, "activo").
		Preload("Assistant").Preload("Supervisor").
		First(&company).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, fmt.Errorf("empresa no encontrada")
		}
		return nil, err
	}
	var cred models.CompanyAccessCredential
	err := database.DB.Where("company_id = ?", companyID).First(&cred).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		row := s.rowFrom(company, nil)
		return &row, nil
	}
	if err != nil {
		return nil, err
	}
	row := s.rowFrom(company, &cred)
	return &row, nil
}

func applyCredentialInput(row *models.CompanyAccessCredential, in CompanyAccessCredentialUpdateInput) {
	row.Dig = strings.TrimSpace(in.Dig)
	row.SolUsuario = strings.TrimSpace(in.SolUsuario)
	row.SolClave = strings.TrimSpace(in.SolClave)
	row.BnlCuenta = strings.TrimSpace(in.BnlCuenta)
	row.BnlDNI = strings.TrimSpace(in.BnlDNI)
	row.BnlClaveDetracciones = strings.TrimSpace(in.BnlClaveDetracciones)
	row.AfpUsuario = strings.TrimSpace(in.AfpUsuario)
	row.AfpClave = strings.TrimSpace(in.AfpClave)
	row.RnpClave = strings.TrimSpace(in.RnpClave)
	row.FacturadorLink = strings.TrimSpace(in.FacturadorLink)
	row.FacturadorUsuario = strings.TrimSpace(in.FacturadorUsuario)
	row.FacturadorContrasena = strings.TrimSpace(in.FacturadorContrasena)
}

func (s *CompanyAccessCredentialService) Upsert(companyID uint, in CompanyAccessCredentialUpdateInput, allowed []uint) (*CompanyAccessCredentialRow, error) {
	if err := s.companyInScope(companyID, allowed); err != nil {
		return nil, err
	}
	var company models.Company
	if err := database.DB.Where("id = ? AND client_type = ? AND status = ?", companyID, models.CompanyClientTypeEstudio, "activo").
		Preload("Assistant").Preload("Supervisor").
		First(&company).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, fmt.Errorf("empresa no encontrada")
		}
		return nil, err
	}

	var cred models.CompanyAccessCredential
	err := database.DB.Where("company_id = ?", companyID).First(&cred).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		cred = models.CompanyAccessCredential{CompanyID: companyID}
		applyCredentialInput(&cred, in)
		if err := database.DB.Create(&cred).Error; err != nil {
			return nil, err
		}
	} else if err != nil {
		return nil, err
	} else {
		applyCredentialInput(&cred, in)
		if err := database.DB.Save(&cred).Error; err != nil {
			return nil, err
		}
	}
	row := s.rowFrom(company, &cred)
	return &row, nil
}
