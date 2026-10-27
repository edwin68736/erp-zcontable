package services

import (
	"errors"
	"strconv"

	"miappfiber/database"
	"miappfiber/models"

	"gorm.io/gorm"
)

// SetCompanySuspendida marca o desmarca a una empresa como SUSPENDIDA en un período, desde cualquier
// módulo de actividades (Buzón SOL, Preliminar de ventas, Detracciones, PDT 601/621, informes…).
//
// La suspensión es una marca global del control mensual (SupervisorMonthlyControl.Suspendida, §5.9.7):
// todos los módulos la leen de ahí, así que marcarla en uno la deja marcada en todos. La empresa sigue
// ACTIVA (no es lo mismo que inactiva o eliminada): se sigue viendo en todas las listas, con su insignia, y
// queda exenta de plazos ese período. Si el control del período todavía no existe, se crea.
func (s *SupervisorService) SetCompanySuspendida(companyID uint, periodYM string, suspendida bool, userID uint) (bool, error) {
	if err := s.validateOpenPeriod(periodYM); err != nil {
		return false, err
	}
	var company models.Company
	// Model(&Company) ya excluye las eliminadas; solo se suspende a empresas activas del estudio.
	if err := database.DB.Where("id = ? AND client_type = ? AND status = ?", companyID, models.CompanyClientTypeEstudio, "activo").
		First(&company).Error; err != nil {
		return false, errors.New("empresa no disponible")
	}

	var ctrl models.SupervisorMonthlyControl
	previous := false
	err := database.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("company_id = ? AND period_ym = ?", companyID, periodYM).First(&ctrl).Error; err != nil {
			if !errors.Is(err, gorm.ErrRecordNotFound) {
				return err
			}
			due := periodDefaultDueDate(periodYM)
			ctrl = models.SupervisorMonthlyControl{
				CompanyID:         companyID,
				PeriodYM:          periodYM,
				ResponsibleUserID: company.AccountantUserID,
				SupervisorUserID:  company.SupervisorUserID,
				DueDate:           &due,
				GeneralStatus:     models.SupervisorControlPendiente,
				RiskLevel:         models.SupervisorRiskBajo,
			}
			if err := tx.Create(&ctrl).Error; err != nil {
				return err
			}
		}
		previous = ctrl.Suspendida
		return tx.Model(&models.SupervisorMonthlyControl{}).Where("id = ?", ctrl.ID).Update("suspendida", suspendida).Error
	})
	if err != nil {
		return false, err
	}
	if previous != suspendida {
		s.LogChange("monthly_control", ctrl.ID, "suspendida", strconv.FormatBool(previous), strconv.FormatBool(suspendida), userID)
	}
	return suspendida, nil
}
