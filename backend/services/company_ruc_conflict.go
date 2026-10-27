package services

import (
	"errors"
	"fmt"
	"strings"
	"time"

	"miappfiber/database"
	"miappfiber/models"

	"gorm.io/gorm"
)

// Un mismo RUC no debe estar en dos empresas del estudio. Antes no se validaba, y así se acumularon
// duplicados (p. ej. una empresa eliminada y otra viva con el mismo RUC). Al crear:
//   - ya existe una empresa ACTIVA con ese RUC → se bloquea;
//   - existe una INACTIVA → se ofrece reactivarla en vez de crear otra;
//   - existe una ELIMINADA → se ofrece reactivarla (conserva todo su historial).

const (
	RucConflictActiva    = "activa"
	RucConflictInactiva  = "inactiva"
	RucConflictEliminada = "eliminada"
)

// CompanyRucConflict la empresa existente que choca con el RUC que se quiere registrar.
type CompanyRucConflict struct {
	Kind         string     `json:"kind"` // activa | inactiva | eliminada
	CompanyID    uint       `json:"company_id"`
	Code         string     `json:"code"`
	BusinessName string     `json:"business_name"`
	RUC          string     `json:"ruc"`
	Status       string     `json:"status"`
	DeletedAt    *time.Time `json:"deleted_at,omitempty"`
	// Reactivable true si se puede reactivar desde el alta (inactiva o eliminada).
	Reactivable bool `json:"reactivable"`
}

// ErrCompanyRucConflict el RUC ya pertenece a otra empresa (ver CompanyRucConflict.Kind).
type ErrCompanyRucConflict struct {
	Conflict CompanyRucConflict
}

func (e *ErrCompanyRucConflict) Error() string {
	c := e.Conflict
	switch c.Kind {
	case RucConflictActiva:
		return fmt.Sprintf("el RUC %s ya está registrado en la empresa activa %q (código %s)", c.RUC, c.BusinessName, c.Code)
	case RucConflictInactiva:
		return fmt.Sprintf("el RUC %s ya está registrado en la empresa inactiva %q (código %s): reactívela en vez de crear otra", c.RUC, c.BusinessName, c.Code)
	default:
		return fmt.Sprintf("el RUC %s pertenece a la empresa eliminada %q (código %s): puede reactivarla en vez de crear otra", c.RUC, c.BusinessName, c.Code)
	}
}

// findRucConflict busca otra empresa del estudio con ese RUC (excluyendo `excludeID`). Prioriza la que
// más bloquea: activa, luego inactiva, luego eliminada (la más reciente).
func findRucConflict(db *gorm.DB, ruc string, excludeID uint) (*CompanyRucConflict, error) {
	ruc = strings.TrimSpace(ruc)
	if ruc == "" {
		return nil, nil
	}
	var rows []models.Company
	q := db.Unscoped().Where("TRIM(ruc) = ? AND client_type = ?", ruc, models.CompanyClientTypeEstudio)
	if excludeID > 0 {
		q = q.Where("id <> ?", excludeID)
	}
	if err := q.Order("id DESC").Find(&rows).Error; err != nil {
		return nil, err
	}
	var best *models.Company
	rank := func(c *models.Company) int {
		switch {
		case c.DeletedAt.Valid:
			return 1
		case c.Status == "inactivo":
			return 2
		default:
			return 3
		}
	}
	for i := range rows {
		if best == nil || rank(&rows[i]) > rank(best) {
			best = &rows[i]
		}
	}
	if best == nil {
		return nil, nil
	}
	out := &CompanyRucConflict{
		CompanyID: best.ID, Code: strings.TrimSpace(best.InternalCode), BusinessName: strings.TrimSpace(best.BusinessName),
		RUC: strings.TrimSpace(best.RUC), Status: best.Status,
	}
	switch {
	case best.DeletedAt.Valid:
		out.Kind, out.Reactivable = RucConflictEliminada, true
		t := best.DeletedAt.Time
		out.DeletedAt = &t
	case best.Status == "inactivo":
		out.Kind, out.Reactivable = RucConflictInactiva, true
	default:
		out.Kind = RucConflictActiva
	}
	return out, nil
}

// checkRucAvailable devuelve ErrCompanyRucConflict si el RUC ya lo tiene otra empresa del estudio.
func checkRucAvailable(db *gorm.DB, ruc string, excludeID uint) error {
	conflict, err := findRucConflict(db, ruc, excludeID)
	if err != nil {
		return err
	}
	if conflict != nil {
		return &ErrCompanyRucConflict{Conflict: *conflict}
	}
	return nil
}

// ReactivateCompany reactiva una empresa inactiva o eliminada con el mismo RUC que se estaba creando.
// Conserva su historial (controles, declaraciones, documentos). `input` trae los datos del formulario: se
// aplican sobre la empresa (razón social, equipo, etc.) y el código del formulario pasa a ser el suyo; si
// no trae código se conserva el anterior, siempre que ninguna empresa activa lo haya tomado mientras tanto.
func (s *CompanyService) ReactivateCompany(id uint, input *models.Company) (*models.Company, error) {
	var c models.Company
	if err := database.DB.Unscoped().First(&c, id).Error; err != nil {
		return nil, errors.New("empresa no encontrada")
	}
	if c.ClientType != models.CompanyClientTypeEstudio {
		return nil, errors.New("solo se pueden reactivar empresas del estudio")
	}
	if !c.DeletedAt.Valid && c.Status == "activo" {
		return nil, errors.New("la empresa ya está activa")
	}
	// El RUC que se reactiva no puede chocar con otra empresa viva distinta.
	if err := checkRucAvailable(database.DB, c.RUC, c.ID); err != nil {
		var rc *ErrCompanyRucConflict
		if errors.As(err, &rc) && rc.Conflict.Kind != RucConflictEliminada {
			return nil, err
		}
	}

	code := strings.TrimSpace(input.InternalCode)
	if code == "" {
		code = strings.TrimSpace(c.InternalCode)
	}
	taken, err := companyInternalCodeTaken(database.DB, code, c.ID)
	if err != nil {
		return nil, err
	}
	if taken {
		return nil, &ErrCompanyCodeConflict{Code: code}
	}

	err = database.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Unscoped().Model(&models.Company{}).Where("id = ?", c.ID).
			Updates(map[string]interface{}{"deleted_at": nil, "status": "activo", "internal_code": code}).Error; err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		return nil, err
	}

	// Datos del formulario sobre la empresa restaurada (los vacíos no pisan lo que ya tenía). El estado ya
	// quedó activo, así que no se vuelve a pasar por la regla de reactivación de código.
	upd := *input
	upd.Status = ""
	upd.InternalCode = ""
	upd.RUC = ""
	if err := s.Update(c.ID, &upd); err != nil {
		return nil, err
	}
	return s.GetByID(c.ID)
}
