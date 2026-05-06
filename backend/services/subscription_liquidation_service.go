package services

import (
	"errors"
	"strconv"
	"time"

	"miappfiber/database"
	"miappfiber/models"

	"gorm.io/gorm"
)

type SubscriptionLiquidationService struct {
	planService *SubscriptionPlanService
}

func NewSubscriptionLiquidationService() *SubscriptionLiquidationService {
	return &SubscriptionLiquidationService{
		planService: NewSubscriptionPlanService(),
	}
}

type LiquidationResult struct {
	CreatedDocuments int      `json:"created_documents"`
	Skipped          int      `json:"skipped"`
	Errors           []string `json:"errors,omitempty"`
}

// RunLiquidation genera cargos recurrentes pendientes según ciclo (inicio/fin de mes) a la fecha indicada.
func (s *SubscriptionLiquidationService) RunLiquidation(asOf time.Time) LiquidationResult {
	out := LiquidationResult{}
	loc := asOf.Location()
	firstOfMonth := time.Date(asOf.Year(), asOf.Month(), 1, 0, 0, 0, 0, loc)
	if asOf.Before(firstOfMonth) {
		return out
	}

	var companies []models.Company
	if err := database.DB.Where("subscription_active = ? AND subscription_plan_id IS NOT NULL", true).Find(&companies).Error; err != nil {
		out.Errors = append(out.Errors, err.Error())
		return out
	}

	for _, co := range companies {
		if co.SubscriptionPlanID == nil {
			continue
		}
		if co.SubscriptionStartedAt != nil && asOf.Before(*co.SubscriptionStartedAt) {
			out.Skipped++
			continue
		}
		if co.SubscriptionEndedAt != nil && !asOf.Before(*co.SubscriptionEndedAt) {
			out.Skipped++
			continue
		}

		var serviceMonth string
		switch co.BillingCycle {
		case "end_month":
			prev := firstOfMonth.AddDate(0, -1, 0)
			serviceMonth = prev.Format("2006-01")
		case "start_month", "":
			serviceMonth = firstOfMonth.Format("2006-01")
		default:
			out.Errors = append(out.Errors, "empresa "+co.InternalCode+": ciclo de cobro inválido")
			out.Skipped++
			continue
		}

		if err := s.ensureMonthlyCharge(&co, *co.SubscriptionPlanID, serviceMonth, asOf); err != nil {
			if errors.Is(err, errLiquidationSkip) {
				out.Skipped++
				continue
			}
			out.Errors = append(out.Errors, "empresa "+co.InternalCode+": "+err.Error())
			continue
		}
		out.CreatedDocuments++
	}
	return out
}

var errLiquidationSkip = errors.New("skip")

func (s *SubscriptionLiquidationService) billingBaseForCompany(co *models.Company, plan *models.SubscriptionPlan, serviceMonth string) (float64, error) {
	switch plan.BillingBasis {
	case models.BillingBasisManual:
		if co.DeclaredBillingAmount == nil {
			return 0, nil
		}
		return *co.DeclaredBillingAmount, nil
	case models.BillingBasisDocumentsMonthSum:
		start, err := time.ParseInLocation("2006-01", serviceMonth, time.Local)
		if err != nil {
			return 0, err
		}
		end := start.AddDate(0, 1, 0)
		var sum float64
		err = database.DB.Model(&models.Document{}).
			Where("company_id = ? AND status <> ? AND source = ? AND issue_date >= ? AND issue_date < ?",
				co.ID, "anulado", "manual", start, end).
			Select("COALESCE(SUM(total_amount),0)").
			Scan(&sum).Error
		return sum, err
	default:
		return 0, errors.New("base de liquidación no soportada")
	}
}

func (s *SubscriptionLiquidationService) ensureMonthlyCharge(co *models.Company, planID uint, serviceMonth string, asOf time.Time) error {
	var existing int64
	database.DB.Model(&models.Document{}).
		Where("company_id = ? AND source = ? AND service_month = ?", co.ID, "recurrente_plan", serviceMonth).
		Count(&existing)
	if existing > 0 {
		return errLiquidationSkip
	}

	plan, err := s.planService.GetByID(planID)
	if err != nil || !plan.Active {
		return errLiquidationSkip
	}

	base, err := s.billingBaseForCompany(co, plan, serviceMonth)
	if err != nil {
		return err
	}

	price, err := s.planService.ResolveMonthlyPrice(planID, base)
	if err != nil {
		return err
	}
	if price < 0.005 {
		return errors.New("precio de plan cero o no resuelto")
	}

	desc := "Mensualidad plan " + plan.Name + " — " + serviceMonth
	number := "REC-" + strconv.FormatUint(uint64(co.ID), 10) + "-" + serviceMonth

	doc := models.Document{
		CompanyID:          co.ID,
		Type:               "PLAN",
		Number:             number,
		IssueDate:          asOf,
		TotalAmount:        price,
		Description:        desc,
		ServiceMonth:       serviceMonth,
		AccountingPeriod:   serviceMonth,
		Status:             "pendiente",
		Source:             "recurrente_plan",
	}

	return database.DB.Transaction(func(tx *gorm.DB) error {
		var dup int64
		tx.Model(&models.Document{}).
			Where("company_id = ? AND source = ? AND service_month = ?", co.ID, "recurrente_plan", serviceMonth).
			Count(&dup)
		if dup > 0 {
			return errLiquidationSkip
		}
		return tx.Create(&doc).Error
	})
}
