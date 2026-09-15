package services

import (
	"math"
	"time"

	"miappfiber/database"
	"miappfiber/models"
	debtsvc "miappfiber/services/debt"

	"gorm.io/gorm"
)

type FinanceService struct{}

func NewFinanceService() *FinanceService {
	return &FinanceService{}
}

type CompanyBalance struct {
	Company        *models.Company
	TotalDocuments float64
	TotalPayments  float64
	Balance        float64
}

type DocumentStatement struct {
	Document models.Document
	Paid     float64
	Balance  float64
}

type CompanyStatement struct {
	Company        *models.Company
	Documents      []DocumentStatement
	Payments       []models.Payment
	TotalDocuments float64
	TotalPayments  float64
	Balance        float64
	Ledger         *AccountLedger `json:"ledger"`
}

// GetCompanyBalance calcula los montos totales de documentos y pagos para una empresa.
//
// Fase 3 Paso 2 (docs/auditoria-diseno-fase3-calculos-financieros-2026-09-14.md): Balance ya NO se
// calcula como TotalDocuments - TotalPayments (fórmula prohibida explícitamente por el Blueprint —
// mezclaba dinero de servicio/a-cuenta con la deuda y podía producir saldos negativos falsos).
// Balance ahora es exclusivamente debt.Service.SaldoDocumentado (SUM(Document.balance_amount) de
// documentos activos pendientes/parciales) — nunca considera Payment. TotalDocuments/TotalPayments
// se conservan sin cambios como datos informativos del contrato de respuesta existente, pero dejan
// de ser operandos de Balance.
func (s *FinanceService) GetCompanyBalance(companyID uint) (*CompanyBalance, error) {
	var company models.Company
	if err := database.DB.First(&company, companyID).Error; err != nil {
		return nil, err
	}

	var totalDocs float64
	database.DB.Model(&models.Document{}).
		Where("company_id = ? AND status <> ?", companyID, "anulado").
		Select("COALESCE(SUM(total_amount),0)").
		Scan(&totalDocs)

	var totalPayments float64
	database.DB.Model(&models.Payment{}).
		Where("company_id = ?", companyID).
		Select("COALESCE(SUM(amount),0)").
		Scan(&totalPayments)

	balance, err := debtsvc.NewService().SaldoDocumentado(database.DB, companyID)
	if err != nil {
		return nil, err
	}

	return &CompanyBalance{
		Company:        &company,
		TotalDocuments: totalDocs,
		TotalPayments:  totalPayments,
		Balance:        balance,
	}, nil
}

// GetCompanyStatement devuelve el detalle de documentos, pagos y saldo por empresa, y el libro contable.
// Si rangeFrom y rangeTo no son nil, el libro es por rango de fechas inclusivo (día en Lima); si no, por mes calendario (ledgerYear, ledgerMonth).
//
// Fase 3 Paso 3 (docs/auditoria-diseno-fase3-calculos-financieros-2026-09-14.md): Balance ya NO se
// calcula como TotalDocuments - TotalPayments (mismo bug corregido en Paso 2 para GetCompanyBalance)
// — ahora es exclusivamente debt.Service.SaldoDocumentado. TotalDocuments/TotalPayments y el detalle
// por documento (statDocs, vía EffectiveBalance) se conservan sin cambios como datos informativos e
// históricos del contrato de respuesta existente; dejan de ser operandos del Balance agregado.
func (s *FinanceService) GetCompanyStatement(companyID uint, ledgerYear int, ledgerMonth int, rangeFrom, rangeTo *time.Time) (*CompanyStatement, error) {
	var company models.Company
	if err := database.DB.First(&company, companyID).Error; err != nil {
		return nil, err
	}

	var docs []models.Document
	if err := database.DB.
		Preload("Items", func(db *gorm.DB) *gorm.DB {
			return db.Order("sort_order ASC, id ASC")
		}).
		Preload("Payments", "deleted_at IS NULL").
		Where("company_id = ?", companyID).
		Order("issue_date DESC, id DESC").
		Find(&docs).Error; err != nil {
		return nil, err
	}

	var pays []models.Payment
	if err := database.DB.
		Preload("Document").
		Preload("TaxSettlement").
		Preload("TukifacFiscalReceipt").
		Preload("Allocations", "deleted_at IS NULL").
		Where("company_id = ?", companyID).
		Order("date DESC, id DESC").
		Find(&pays).Error; err != nil {
		return nil, err
	}

	statDocs := make([]DocumentStatement, 0, len(docs))
	var totalDocs, totalPays float64

	for _, d := range docs {
		if d.Status == "anulado" {
			statDocs = append(statDocs, DocumentStatement{
				Document: d,
				Paid:     0,
				Balance:  0,
			})
			continue
		}
		totalDocs += d.TotalAmount
		debtSvc := debtsvc.NewService()
		bal := debtSvc.EffectiveBalance(database.DB, &d)
		paid := roundMoneyDebt(d.TotalAmount - bal)
		if paid < 0 {
			paid = 0
		}
		statDocs = append(statDocs, DocumentStatement{
			Document: d,
			Paid:     paid,
			Balance:  bal,
		})
	}

	for _, p := range pays {
		totalPays += p.Amount
	}

	var ledger *AccountLedger
	if rangeFrom != nil && rangeTo != nil {
		ledger = buildAccountLedgerDateRange(docs, pays, *rangeFrom, *rangeTo)
	} else {
		ledger = buildAccountLedger(docs, pays, ledgerYear, ledgerMonth)
	}

	balance, err := debtsvc.NewService().SaldoDocumentado(database.DB, companyID)
	if err != nil {
		return nil, err
	}

	return &CompanyStatement{
		Company:        &company,
		Documents:      statDocs,
		Payments:       pays,
		TotalDocuments: totalDocs,
		TotalPayments:  totalPays,
		Balance:        balance,
		Ledger:         ledger,
	}, nil
}

func roundMoneyDebt(v float64) float64 {
	return math.Round(v*100) / 100
}
