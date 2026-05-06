package services

import (
	"time"

	"miappfiber/database"
	"miappfiber/models"

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

	return &CompanyBalance{
		Company:        &company,
		TotalDocuments: totalDocs,
		TotalPayments:  totalPayments,
		Balance:        totalDocs - totalPayments,
	}, nil
}

// GetCompanyStatement devuelve el detalle de documentos, pagos y saldo por empresa, y el libro contable.
// Si rangeFrom y rangeTo no son nil, el libro es por rango de fechas inclusivo (día en Lima); si no, por mes calendario (ledgerYear, ledgerMonth).
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
		paid := DocumentPaidTotal(database.DB, d.ID)
		statDocs = append(statDocs, DocumentStatement{
			Document: d,
			Paid:     paid,
			Balance:  d.TotalAmount - paid,
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

	return &CompanyStatement{
		Company:        &company,
		Documents:      statDocs,
		Payments:       pays,
		TotalDocuments: totalDocs,
		TotalPayments:  totalPays,
		Balance:        totalDocs - totalPays,
		Ledger:         ledger,
	}, nil
}
