package main

import (
	"fmt"
	"log"

	"miappfiber/config"
	"miappfiber/database"
)

func main() {
	if err := config.Load(); err != nil {
		log.Fatal(err)
	}
	if err := database.Connect(); err != nil {
		log.Fatal(err)
	}
	db := database.DB

	type row struct{ Label string; N int64 }

	queries := []struct {
		label string
		sql   string
	}{
		{"deu_liq_creados_post_refactor (id alto, ultimos 30d)", `
			SELECT COUNT(*) FROM documents
			WHERE deleted_at IS NULL AND number LIKE 'DEU-LIQ-%'
			  AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)`},
		{"deudas_duplicadas_mismo_total_settlement", `
			SELECT COUNT(*) FROM (
			  SELECT tax_settlement_id, company_id, total_amount, COUNT(*) c
			  FROM documents
			  WHERE deleted_at IS NULL AND tax_settlement_id IS NOT NULL AND source='liquidacion'
			  GROUP BY tax_settlement_id, company_id, total_amount
			  HAVING c > 1
			) t`},
		{"pagos_applied_sin_allocations", `
			SELECT COUNT(*) FROM payments p
			WHERE p.deleted_at IS NULL AND p.type='applied'
			  AND NOT EXISTS (SELECT 1 FROM payment_allocations pa WHERE pa.payment_id=p.id AND pa.deleted_at IS NULL)`},
		{"pagos_settlement_con_deuda_externa", `
			SELECT COUNT(*) FROM payments p
			JOIN payment_allocations pa ON pa.payment_id=p.id AND pa.deleted_at IS NULL
			JOIN documents d ON d.id=pa.document_id AND d.deleted_at IS NULL
			WHERE p.deleted_at IS NULL AND p.tax_settlement_id IS NOT NULL
			  AND (d.tax_settlement_id IS NULL OR d.tax_settlement_id <> p.tax_settlement_id)`},
		{"comprobantes_sin_lineas_ni_snapshot", `
			SELECT COUNT(*) FROM tukifac_fiscal_receipts r
			WHERE r.deleted_at IS NULL AND r.linked_payment_id IS NOT NULL
			  AND (r.debt_payment_context_json IS NULL OR TRIM(r.debt_payment_context_json)='')
			  AND NOT EXISTS (SELECT 1 FROM fiscal_receipt_lines l WHERE l.fiscal_receipt_id=r.id)`},
		{"documentos_sin_periodo_ni_legacy", `
			SELECT COUNT(*) FROM documents
			WHERE deleted_at IS NULL AND has_period=0
			  AND (accounting_period IS NULL OR TRIM(accounting_period)='')
			  AND (service_month IS NULL OR TRIM(service_month)='')`},
		{"allocations_monto_mayor_saldo_historico", `
			SELECT COUNT(*) FROM payment_allocations pa
			JOIN payments p ON p.id=pa.payment_id AND p.deleted_at IS NULL
			JOIN documents d ON d.id=pa.document_id AND d.deleted_at IS NULL
			WHERE pa.deleted_at IS NULL AND pa.amount > d.total_amount + 0.02`},
	}

	fmt.Println("=== AUDITORIA EXTENDIDA (solo lectura) ===")
	for _, q := range queries {
		var n int64
		if err := db.Raw(q.sql).Scan(&n).Error; err != nil {
			fmt.Printf("ERROR [%s]: %v\n", q.label, err)
			continue
		}
		flag := ""
		if n > 0 {
			flag = " ⚠"
		}
		fmt.Printf("%s: %d%s\n", q.label, n, flag)
	}
}
