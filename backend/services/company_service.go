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

type CompanyService struct{}

func NewCompanyService() *CompanyService {
	return &CompanyService{}
}

// NextInternalCode sugiere un código interno numérico de 4 dígitos (0001–9999) sin repetir
// códigos ya usados. Parte de (cantidad de empresas + 1) y avanza hasta encontrar hueco.
func (s *CompanyService) NextInternalCode() (string, error) {
	var codes []string
	if err := database.DB.Model(&models.Company{}).Pluck("internal_code", &codes).Error; err != nil {
		return "", err
	}
	existing := make(map[string]struct{}, len(codes))
	for _, c := range codes {
		existing[strings.TrimSpace(c)] = struct{}{}
	}
	var total int64
	if err := database.DB.Model(&models.Company{}).Count(&total).Error; err != nil {
		return "", err
	}
	candidate := int(total) + 1
	if candidate < 1 {
		candidate = 1
	}
	for candidate <= 9999 {
		code := fmt.Sprintf("%04d", candidate)
		if _, ok := existing[code]; !ok {
			return code, nil
		}
		candidate++
	}
	return "", errors.New("no hay códigos internos de 4 dígitos disponibles")
}

type CompanyListParams struct {
	Query             string
	Status            string
	AllowedCompanyIDs []uint
	// CodeOrder: "asc" | "desc" — orden por internal_code (código de empresa).
	CodeOrder string
}

// companyListOrderByCode ordena por código como número (internal_code es VARCHAR en BD).
// En MySQL/MariaDB: (0 + TRIM(...)) fuerza orden numérico p. ej. 001, 112, 211 frente al orden lexicográfico.
func companyListOrderByCode(codeOrder string) string {
	if strings.EqualFold(strings.TrimSpace(codeOrder), "desc") {
		return "(0 + TRIM(internal_code)) DESC, id DESC"
	}
	return "(0 + TRIM(internal_code)) ASC, id ASC"
}

// loadCompanyListItemsByIDs carga filas con balance y respeta el orden de ids (GORM + Select con subconsultas
// puede ignorar ORDER BY en algunos drivers; el orden se fija aquí).
func (s *CompanyService) loadCompanyListItemsByIDs(ids []uint) ([]CompanyListItem, error) {
	if len(ids) == 0 {
		return []CompanyListItem{}, nil
	}
	var list []CompanyListItem
	if err := database.DB.Model(&models.Company{}).Select(companyListBalanceSelect).Where("id IN ?", ids).Find(&list).Error; err != nil {
		return nil, err
	}
	pos := make(map[uint]int, len(ids))
	for i, id := range ids {
		pos[id] = i
	}
	sort.SliceStable(list, func(i, j int) bool {
		return pos[list[i].ID] < pos[list[j].ID]
	})
	return list, nil
}

type CompanyListItem struct {
	models.Company
	Balance float64 `json:"balance"`
}

// ValidateNewCompanyForCreate valida los mismos reglas que Create, usando db para consultas (p. ej. transacción de importación).
func (s *CompanyService) ValidateNewCompanyForCreate(db *gorm.DB, input *models.Company) error {
	input.RUC = strings.TrimSpace(input.RUC)
	input.BusinessName = strings.TrimSpace(input.BusinessName)
	input.InternalCode = strings.TrimSpace(input.InternalCode)

	if input.RUC == "" {
		return errors.New("el RUC es requerido")
	}
	if input.BusinessName == "" {
		return errors.New("la razón social es requerida")
	}
	if input.InternalCode == "" {
		return errors.New("el código interno es requerido")
	}

	var count int64
	db.Model(&models.Company{}).
		Where("internal_code = ?", input.InternalCode).
		Count(&count)
	if count > 0 {
		return errors.New("el código interno ya existe")
	}

	if input.AccountantUserID != nil {
		if *input.AccountantUserID == 0 {
			input.AccountantUserID = nil
		} else {
			var u models.User
			if err := db.First(&u, *input.AccountantUserID).Error; err != nil {
				return errors.New("contador general inválido")
			}
			if !u.Active {
				return errors.New("contador general inactivo")
			}
			if u.Role != "Contador" && u.Role != "Administrador" {
				return errors.New("el usuario seleccionado no tiene rol Contador")
			}
		}
	}
	if input.SupervisorUserID != nil {
		if *input.SupervisorUserID == 0 {
			input.SupervisorUserID = nil
		} else {
			var u models.User
			if err := db.First(&u, *input.SupervisorUserID).Error; err != nil {
				return errors.New("supervisor inválido")
			}
			if !u.Active {
				return errors.New("supervisor inactivo")
			}
			if u.Role != "Supervisor" && u.Role != "Administrador" {
				return errors.New("el usuario seleccionado no tiene rol Supervisor")
			}
		}
	}
	if input.AssistantUserID != nil {
		if *input.AssistantUserID == 0 {
			input.AssistantUserID = nil
		} else {
			var u models.User
			if err := db.First(&u, *input.AssistantUserID).Error; err != nil {
				return errors.New("asistente inválido")
			}
			if !u.Active {
				return errors.New("asistente inactivo")
			}
			if u.Role != "Asistente" && u.Role != "Administrador" {
				return errors.New("el usuario seleccionado no tiene rol Asistente")
			}
		}
	}

	ids := make([]uint, 0, 3)
	if input.AccountantUserID != nil && *input.AccountantUserID != 0 {
		ids = append(ids, *input.AccountantUserID)
	}
	if input.SupervisorUserID != nil && *input.SupervisorUserID != 0 {
		ids = append(ids, *input.SupervisorUserID)
	}
	if input.AssistantUserID != nil && *input.AssistantUserID != 0 {
		ids = append(ids, *input.AssistantUserID)
	}
	seen := map[uint]struct{}{}
	for _, v := range ids {
		if _, ok := seen[v]; ok {
			return errors.New("el equipo no puede repetir el mismo usuario")
		}
		seen[v] = struct{}{}
	}

	bc := strings.TrimSpace(input.BillingCycle)
	if bc != "" && bc != "start_month" && bc != "end_month" {
		return errors.New("ciclo de cobro inválido (use start_month o end_month)")
	}
	if input.SubscriptionPlanID != nil && *input.SubscriptionPlanID > 0 {
		var cnt int64
		db.Model(&models.SubscriptionPlan{}).Where("id = ? AND active = ?", *input.SubscriptionPlanID, true).Count(&cnt)
		if cnt == 0 {
			return errors.New("plan de suscripción inválido o inactivo")
		}
	}

	return nil
}

func (s *CompanyService) Create(input *models.Company) error {
	if err := s.ValidateNewCompanyForCreate(database.DB, input); err != nil {
		return err
	}
	if input.SubscriptionPlanID != nil && *input.SubscriptionPlanID > 0 {
		input.SubscriptionActive = true
	}
	return database.DB.Create(input).Error
}

// CreateWithTx crea empresa dentro de una transacción GORM (p. ej. importación masiva).
func (s *CompanyService) CreateWithTx(tx *gorm.DB, input *models.Company) error {
	if err := s.ValidateNewCompanyForCreate(tx, input); err != nil {
		return err
	}
	if input.SubscriptionPlanID != nil && *input.SubscriptionPlanID > 0 {
		input.SubscriptionActive = true
	}
	return tx.Create(input).Error
}

func (s *CompanyService) Update(id uint, input *models.Company) error {
	var c models.Company
	if err := database.DB.First(&c, id).Error; err != nil {
		return err
	}

	if input.RUC != "" {
		c.RUC = strings.TrimSpace(input.RUC)
	}
	if input.BusinessName != "" {
		c.BusinessName = strings.TrimSpace(input.BusinessName)
	}
	if input.InternalCode != "" && input.InternalCode != c.InternalCode {
		// verificar unicidad nuevo código
		var count int64
		database.DB.Model(&models.Company{}).
			Where("internal_code = ? AND id <> ?", input.InternalCode, id).
			Count(&count)
		if count > 0 {
			return errors.New("el código interno ya existe")
		}
		c.InternalCode = strings.TrimSpace(input.InternalCode)
	}
	if input.TradeName != "" {
		c.TradeName = strings.TrimSpace(input.TradeName)
	}
	if input.Address != "" {
		c.Address = strings.TrimSpace(input.Address)
	}
	if input.Phone != "" {
		c.Phone = strings.TrimSpace(input.Phone)
	}
	if input.Email != "" {
		c.Email = strings.TrimSpace(input.Email)
	}
	if input.Status != "" {
		c.Status = strings.TrimSpace(input.Status)
	}
	c.ServiceStartAt = input.ServiceStartAt

	if input.AccountantUserID != nil {
		if *input.AccountantUserID == 0 {
			c.AccountantUserID = nil
		} else {
			var u models.User
			if err := database.DB.First(&u, *input.AccountantUserID).Error; err != nil {
				return errors.New("contador general inválido")
			}
			if !u.Active {
				return errors.New("contador general inactivo")
			}
			if u.Role != "Contador" && u.Role != "Administrador" {
				return errors.New("el usuario seleccionado no tiene rol Contador")
			}
			c.AccountantUserID = input.AccountantUserID
		}
	}
	if input.SupervisorUserID != nil {
		if *input.SupervisorUserID == 0 {
			c.SupervisorUserID = nil
		} else {
			var u models.User
			if err := database.DB.First(&u, *input.SupervisorUserID).Error; err != nil {
				return errors.New("supervisor inválido")
			}
			if !u.Active {
				return errors.New("supervisor inactivo")
			}
			if u.Role != "Supervisor" && u.Role != "Administrador" {
				return errors.New("el usuario seleccionado no tiene rol Supervisor")
			}
			c.SupervisorUserID = input.SupervisorUserID
		}
	}
	if input.AssistantUserID != nil {
		if *input.AssistantUserID == 0 {
			c.AssistantUserID = nil
		} else {
			var u models.User
			if err := database.DB.First(&u, *input.AssistantUserID).Error; err != nil {
				return errors.New("asistente inválido")
			}
			if !u.Active {
				return errors.New("asistente inactivo")
			}
			if u.Role != "Asistente" && u.Role != "Administrador" {
				return errors.New("el usuario seleccionado no tiene rol Asistente")
			}
			c.AssistantUserID = input.AssistantUserID
		}
	}

	ids := make([]uint, 0, 3)
	if c.AccountantUserID != nil && *c.AccountantUserID != 0 {
		ids = append(ids, *c.AccountantUserID)
	}
	if c.SupervisorUserID != nil && *c.SupervisorUserID != 0 {
		ids = append(ids, *c.SupervisorUserID)
	}
	if c.AssistantUserID != nil && *c.AssistantUserID != 0 {
		ids = append(ids, *c.AssistantUserID)
	}
	seen := map[uint]struct{}{}
	for _, v := range ids {
		if _, ok := seen[v]; ok {
			return errors.New("el equipo no puede repetir el mismo usuario")
		}
		seen[v] = struct{}{}
	}

	c.SubscriptionPlanID = input.SubscriptionPlanID
	if strings.TrimSpace(input.BillingCycle) != "" {
		bc := strings.TrimSpace(input.BillingCycle)
		if bc != "start_month" && bc != "end_month" {
			return errors.New("ciclo de cobro inválido (use start_month o end_month)")
		}
		c.BillingCycle = bc
	}
	if input.SubscriptionPlanID != nil && *input.SubscriptionPlanID > 0 {
		var cnt int64
		database.DB.Model(&models.SubscriptionPlan{}).Where("id = ? AND active = ?", *input.SubscriptionPlanID, true).Count(&cnt)
		if cnt == 0 {
			return errors.New("plan de suscripción inválido o inactivo")
		}
	}
	c.SubscriptionStartedAt = input.SubscriptionStartedAt
	c.SubscriptionEndedAt = input.SubscriptionEndedAt
	c.SubscriptionActive = input.SubscriptionActive
	c.DeclaredBillingAmount = input.DeclaredBillingAmount

	return database.DB.Save(&c).Error
}

// SetStatus actualiza solo el estado (activo/inactivo) sin tocar el resto del registro.
func (s *CompanyService) SetStatus(id uint, status string) error {
	status = strings.TrimSpace(strings.ToLower(status))
	if status != "activo" && status != "inactivo" {
		return errors.New("estado inválido")
	}
	var count int64
	if err := database.DB.Model(&models.Company{}).Where("id = ?", id).Count(&count).Error; err != nil {
		return err
	}
	if count == 0 {
		return gorm.ErrRecordNotFound
	}
	// No usar RowsAffected: en varios drivers un UPDATE idempotente (mismo valor) devuelve 0 filas.
	return database.DB.Model(&models.Company{}).Where("id = ?", id).Update("status", status).Error
}

// companyListBaseQuery construye el FROM/WHERE común para listados de empresas.
// No reutilices el *gorm.DB devuelto tras un .Count(): vuelve a llamar a esta función.
func (s *CompanyService) companyListBaseQuery(params CompanyListParams) *gorm.DB {
	// Model (no Table) para que GORM aplique soft delete y Order+Pluck generen SQL coherente.
	q := database.DB.Model(&models.Company{})
	if params.AllowedCompanyIDs != nil {
		if len(params.AllowedCompanyIDs) == 0 {
			return q.Where("1 = 0")
		}
		q = q.Where("id IN ?", params.AllowedCompanyIDs)
	}
	if params.Status != "" {
		q = q.Where("status = ?", params.Status)
	}
	if params.Query != "" {
		like := "%" + params.Query + "%"
		q = q.Where("ruc LIKE ? OR business_name LIKE ? OR internal_code LIKE ?", like, like, like)
	}
	return q
}

const companyListBalanceSelect = `companies.*,
			(
				(SELECT COALESCE(SUM(total_amount),0) FROM documents WHERE documents.company_id = companies.id AND documents.status <> 'anulado')
				-
				(SELECT COALESCE(SUM(amount),0) FROM payments WHERE payments.company_id = companies.id AND payments.deleted_at IS NULL)
			) AS balance`

func (s *CompanyService) GetByID(id uint) (*models.Company, error) {
	var c models.Company
	if err := database.DB.
		Preload("Accountant").
		Preload("Supervisor").
		Preload("Assistant").
		Preload("Contacts").
		Preload("SubscriptionPlan", func(db *gorm.DB) *gorm.DB {
			return db.Preload("PlanCategory").Preload("Tiers", func(db2 *gorm.DB) *gorm.DB {
				return db2.Order("sort_order ASC, id ASC")
			})
		}).
		First(&c, id).Error; err != nil {
		return nil, err
	}
	return &c, nil
}

func (s *CompanyService) List(params CompanyListParams) ([]CompanyListItem, error) {
	if params.AllowedCompanyIDs != nil && len(params.AllowedCompanyIDs) == 0 {
		return []CompanyListItem{}, nil
	}
	var ids []uint
	if err := s.companyListBaseQuery(params).Order(companyListOrderByCode(params.CodeOrder)).Pluck("id", &ids).Error; err != nil {
		return nil, err
	}
	return s.loadCompanyListItemsByIDs(ids)
}

func (s *CompanyService) ListPaged(params CompanyListParams, page int, perPage int) ([]CompanyListItem, int64, error) {
	if params.AllowedCompanyIDs != nil && len(params.AllowedCompanyIDs) == 0 {
		return []CompanyListItem{}, 0, nil
	}
	if page <= 0 {
		page = 1
	}
	if perPage <= 0 {
		perPage = 20
	}

	var total int64
	if err := s.companyListBaseQuery(params).Count(&total).Error; err != nil {
		return nil, 0, err
	}

	var ids []uint
	if err := s.companyListBaseQuery(params).
		Order(companyListOrderByCode(params.CodeOrder)).
		Limit(perPage).
		Offset((page - 1) * perPage).
		Pluck("id", &ids).Error; err != nil {
		return nil, 0, err
	}
	list, err := s.loadCompanyListItemsByIDs(ids)
	if err != nil {
		return nil, 0, err
	}
	return list, total, nil
}

func (s *CompanyService) Delete(id uint) error {
	// Evitar eliminar empresas con documentos o pagos
	var docsCount, payCount int64
	database.DB.Model(&models.Document{}).Where("company_id = ?", id).Count(&docsCount)
	database.DB.Model(&models.Payment{}).Where("company_id = ?", id).Count(&payCount)
	if docsCount > 0 || payCount > 0 {
		return errors.New("no se puede eliminar la empresa porque tiene documentos o pagos asociados")
	}

	result := database.DB.Delete(&models.Company{}, id)
	if result.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return result.Error
}
