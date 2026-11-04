package services

import (
	"fmt"
	"time"

	"miappfiber/database"
	"miappfiber/models"
)

// Período habilitado para registrar información en las actividades del estudio: las obligaciones se cargan
// "pasando el mes" (en noviembre se trabaja octubre), así que solo se puede registrar un período que ya terminó.
// El mes en curso y los futuros se pueden mirar, pero no cargar, marcar ni verificar nada en ellos.
// "Hoy" es la fecha del SERVIDOR en Lima (pdt621Now, que los tests pueden fijar), no la de la PC del usuario.

// currentMonthLima mes en curso en Lima, AAAA-MM.
func currentMonthLima() string { return pdt621Now().In(limaLoc).Format("2006-01") }

// LastEnabledPeriodYM último período habilitado (el mes anterior al actual), AAAA-MM.
func LastEnabledPeriodYM() string {
	now := pdt621Now().In(limaLoc)
	first := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, limaLoc)
	return first.AddDate(0, -1, 0).Format("2006-01")
}

// ActivityPeriodEnabled true si el período (AAAA-MM) ya terminó y por tanto admite registros.
func ActivityPeriodEnabled(periodYM string) bool {
	return validPeriodYM(periodYM) && periodYM < currentMonthLima()
}

// ActivityPeriodNotEnabledError mensaje para quien intenta registrar en un período que aún no corresponde.
func ActivityPeriodNotEnabledError(periodYM string) error {
	return fmt.Errorf("el período %s aún no está habilitado: solo se registra información de períodos ya terminados (hasta %s)", periodYM, LastEnabledPeriodYM())
}

// DeclarationPeriodYM período de la declaración (el de su control mensual).
func (s *SupervisorService) DeclarationPeriodYM(declarationID uint) (string, error) {
	var d models.SupervisorDeclaration
	if err := database.DB.Select("monthly_control_id").First(&d, declarationID).Error; err != nil {
		return "", err
	}
	var c models.SupervisorMonthlyControl
	if err := database.DB.Select("period_ym").First(&c, d.MonthlyControlID).Error; err != nil {
		return "", err
	}
	return c.PeriodYM, nil
}
