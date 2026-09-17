package services

import (
	"errors"
	"fmt"
	"strings"

	"miappfiber/database"
	"miappfiber/models"
)

// previousPeriodYM AAAA-MM inmediatamente anterior a ym.
func previousPeriodYM(ym string) (string, bool) {
	var y, m int
	if _, err := fmt.Sscanf(ym, "%d-%d", &y, &m); err != nil || m < 1 || m > 12 {
		return "", false
	}
	m--
	if m < 1 {
		m = 12
		y--
	}
	return fmt.Sprintf("%04d-%02d", y, m), true
}

// SuspensionCarryOverRow empresa candidata a arrastrar suspensión (docs/diseno-limpieza-control-
// detail-2026-09-16.md §5.9.9) — misma forma mínima que el resto de listados de Detracciones.
type SuspensionCarryOverRow struct {
	CompanyID    uint   `json:"company_id"`
	Code         string `json:"code"`
	Dig          string `json:"dig"`
	BusinessName string `json:"business_name"`
	RUC          string `json:"ruc"`
}

// SuspensionCarryOverStatus respuesta del modal — `Pending=false` significa "no mostrar nada" (ya
// resuelto para este período, o el período anterior no tenía ninguna empresa suspendida).
type SuspensionCarryOverStatus struct {
	Pending   bool                      `json:"pending"`
	Companies []SuspensionCarryOverRow `json:"companies"`
}

// suspendidaCompaniesForPeriod empresas activas del estudio (dentro del alcance dado) cuyo control
// del período `periodYM` está marcado Suspendida — mismo criterio de alcance que el resto del
// dashboard (§5.9.7: el flag vive en SupervisorMonthlyControl).
func (s *SupervisorService) suspendidaCompaniesForPeriod(periodYM string, allowedCompanyIDs []uint) ([]SuspensionCarryOverRow, error) {
	q := database.DB.Table("companies").
		Select(`companies.id AS company_id, companies.internal_code AS code, companies.business_name,
			companies.ruc, COALESCE(cred.dig, '') AS dig`).
		Joins("INNER JOIN supervisor_monthly_controls c ON c.company_id = companies.id AND c.period_ym = ? AND c.deleted_at IS NULL AND c.suspendida = 1", periodYM).
		Joins("LEFT JOIN company_access_credentials cred ON cred.company_id = companies.id").
		Where("companies.client_type = ? AND companies.status = ? AND companies.deleted_at IS NULL", models.CompanyClientTypeEstudio, "activo").
		Order("companies.internal_code ASC")
	if allowedCompanyIDs != nil {
		if len(allowedCompanyIDs) == 0 {
			return []SuspensionCarryOverRow{}, nil
		}
		q = q.Where("companies.id IN ?", allowedCompanyIDs)
	}

	var rows []SuspensionCarryOverRow
	if err := q.Scan(&rows).Error; err != nil {
		return nil, err
	}
	for i := range rows {
		rows[i].Code = strings.TrimSpace(rows[i].Code)
		rows[i].BusinessName = strings.TrimSpace(rows[i].BusinessName)
		rows[i].RUC = strings.TrimSpace(rows[i].RUC)
	}
	return rows, nil
}

// GetSuspensionCarryOverStatus decide si corresponde mostrar el modal de arrastre (§5.9.9.2) al
// abrir Control de Detracciones para `periodYM`: el período debe existir, no tener el arrastre
// resuelto todavía, y el período anterior debe tener al menos una empresa suspendida (dentro del
// alcance del usuario que consulta).
func (s *SupervisorService) GetSuspensionCarryOverStatus(periodYM string, allowedCompanyIDs []uint) (*SuspensionCarryOverStatus, error) {
	if !validPeriodYM(periodYM) {
		return nil, errors.New("período inválido (use YYYY-MM)")
	}
	var period models.SupervisorPeriod
	if err := database.DB.Where("period_ym = ?", periodYM).First(&period).Error; err != nil {
		// Sin período todavía no hay nada que resolver — EnsureDetracciones/validateOpenPeriod ya
		// exigen que exista antes de poder entrar al módulo, así que este caso no debería llegar
		// desde el flujo normal, pero no es un error del arrastre en sí.
		return &SuspensionCarryOverStatus{Pending: false, Companies: []SuspensionCarryOverRow{}}, nil
	}
	if period.SuspensionCarryOverResolved {
		return &SuspensionCarryOverStatus{Pending: false, Companies: []SuspensionCarryOverRow{}}, nil
	}
	prevYM, ok := previousPeriodYM(periodYM)
	if !ok {
		return &SuspensionCarryOverStatus{Pending: false, Companies: []SuspensionCarryOverRow{}}, nil
	}
	rows, err := s.suspendidaCompaniesForPeriod(prevYM, allowedCompanyIDs)
	if err != nil {
		return nil, err
	}
	return &SuspensionCarryOverStatus{Pending: len(rows) > 0, Companies: rows}, nil
}

// ApplySuspensionCarryOver aplica la decisión del modal (§5.9.9.2/§5.9.9.4): `keepSuspendedCompanyIDs`
// son las empresas que el usuario dejó tildadas (mantener suspendidas); todas las demás candidatas
// (suspendidas en el período anterior pero NO incluidas acá) quedan reactivadas — no se les toca nada,
// el control nuevo ya nace con Suspendida=false por defecto.
//
// Concurrencia: compare-and-swap atómico sobre `suspension_carry_over_resolved` — gana quien guarda
// primero, el segundo intento se rechaza sin tocar ningún dato (§5.9.9.4, mismo mecanismo documentado).
func (s *SupervisorService) ApplySuspensionCarryOver(periodYM string, keepSuspendedCompanyIDs []uint, allowedCompanyIDs []uint) error {
	if !validPeriodYM(periodYM) {
		return errors.New("período inválido (use YYYY-MM)")
	}
	prevYM, ok := previousPeriodYM(periodYM)
	if !ok {
		return errors.New("período inválido (use YYYY-MM)")
	}
	// Candidatas reales (mismo alcance que GetSuspensionCarryOverStatus) — evita que el request
	// pueda colar un company_id fuera de este conjunto (no era candidata, o está fuera del alcance
	// del usuario) y terminar suspendiendo una empresa que no correspondía.
	candidates, err := s.suspendidaCompaniesForPeriod(prevYM, allowedCompanyIDs)
	if err != nil {
		return err
	}
	candidateSet := make(map[uint]bool, len(candidates))
	for _, c := range candidates {
		candidateSet[c.CompanyID] = true
	}
	keepSet := map[uint]bool{}
	for _, id := range keepSuspendedCompanyIDs {
		if candidateSet[id] {
			keepSet[id] = true
		}
	}

	res := database.DB.Model(&models.SupervisorPeriod{}).
		Where("period_ym = ? AND suspension_carry_over_resolved = ?", periodYM, false).
		Update("suspension_carry_over_resolved", true)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return errors.New("este arrastre ya fue resuelto por otro usuario — recargue la página")
	}

	for id := range keepSet {
		if _, err := s.SetDetraccionesSuspendida(id, periodYM, true); err != nil {
			return err
		}
	}
	return nil
}
