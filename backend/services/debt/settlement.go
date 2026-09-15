package debt

import (
	"errors"
	"fmt"
	"log"
	"math"
	"strconv"
	"strings"
	"time"

	"miappfiber/models"

	"gorm.io/gorm"
)

// ParseDEULIQNumber extrae tax_settlement_id desde número legacy DEU-LIQ-{settlementId}-{lineId}.
func ParseDEULIQNumber(number string) (settlementID uint, ok bool) {
	n := strings.TrimSpace(number)
	const prefix = "DEU-LIQ-"
	if !strings.HasPrefix(n, prefix) {
		return 0, false
	}
	rest := strings.TrimPrefix(n, prefix)
	parts := strings.Split(rest, "-")
	if len(parts) < 2 {
		return 0, false
	}
	sid, err := strconv.ParseUint(parts[0], 10, 32)
	if err != nil || sid == 0 {
		return 0, false
	}
	return uint(sid), true
}

// ParseDEULIQFull extrae tax_settlement_id y tax_settlement_line id desde DEU-LIQ-{settlementId}-{lineId}.
func ParseDEULIQFull(number string) (settlementID, lineID uint, ok bool) {
	n := strings.TrimSpace(number)
	const prefix = "DEU-LIQ-"
	if !strings.HasPrefix(n, prefix) {
		return 0, 0, false
	}
	rest := strings.TrimPrefix(n, prefix)
	parts := strings.Split(rest, "-")
	if len(parts) < 2 {
		return 0, 0, false
	}
	sid, err := strconv.ParseUint(parts[0], 10, 32)
	if err != nil || sid == 0 {
		return 0, 0, false
	}
	lid, err := strconv.ParseUint(parts[len(parts)-1], 10, 32)
	if err != nil || lid == 0 {
		return uint(sid), 0, false
	}
	return uint(sid), uint(lid), true
}

// IsLegacySettlementClone indica deuda generada con patrón DEU-LIQ (pre-refactor).
func IsLegacySettlementClone(d *models.Document) bool {
	if d == nil {
		return false
	}
	if strings.TrimSpace(strings.ToLower(d.Source)) != "liquidacion" {
		return false
	}
	_, ok := ParseDEULIQNumber(d.Number)
	return ok
}

// IsSettlementOwnedDebt determina si el ORIGEN inmutable de la deuda es exactamente esta liquidación
// (nunca fue de ninguna otra). Deliberadamente NO usa TaxSettlementID (mutable — cambia al arrastrar
// la deuda entre liquidaciones), ni Source ni Type (genéricos, compartidos por cualquier deuda de
// liquidación sin importar cuál la creó) — esos tres campos fueron la causa raíz del bug de borrado
// de deudas arrastradas (Blueprint Fase 1 §9, ver también CleanupSettlementDebtsNotInLines).
//
// Si OriginSettlementID es nil (deuda manual, de suscripción, o histórica sin evidencia suficiente
// para reconstruir su origen — ver backfill en document_migrations.go), NUNCA se considera dueña de
// ninguna liquidación: más vale desvincular de más que eliminar por error (§24 del Blueprint).
func IsSettlementOwnedDebt(d *models.Document, settlementID uint) bool {
	if d == nil || settlementID == 0 {
		return false
	}
	return d.OriginSettlementID != nil && *d.OriginSettlementID == settlementID
}

// hasPaymentAllocations true si el documento tiene al menos una imputación de pago activa.
func (s *Service) hasPaymentAllocations(tx *gorm.DB, documentID uint) (bool, error) {
	var cnt int64
	if err := tx.Model(&models.PaymentAllocation{}).Where("document_id = ?", documentID).Count(&cnt).Error; err != nil {
		return false, err
	}
	return cnt > 0, nil
}

// hasLegacyPayments true si existe un Payment legacy con document_id apuntando directo al documento
// (esquema previo a PaymentAllocation; ver Payment.DocumentID).
func (s *Service) hasLegacyPayments(tx *gorm.DB, documentID uint) (bool, error) {
	var cnt int64
	if err := tx.Model(&models.Payment{}).Where("document_id = ?", documentID).Count(&cnt).Error; err != nil {
		return false, err
	}
	return cnt > 0, nil
}

// referencedByOtherSettlement true si existe una TaxSettlementLine de OTRA liquidación (distinta de
// excludeSettlementID) que referencia este documento — evidencia de que participó en otra liquidación
// (activa o cerrada) y por lo tanto tiene historial que no debe perderse.
func (s *Service) referencedByOtherSettlement(tx *gorm.DB, documentID, excludeSettlementID uint) (bool, error) {
	var cnt int64
	if err := tx.Model(&models.TaxSettlementLine{}).
		Where("document_id = ? AND tax_settlement_id <> ?", documentID, excludeSettlementID).
		Count(&cnt).Error; err != nil {
		return false, err
	}
	return cnt > 0, nil
}

// isSettlementDraft consulta el estado actual de una liquidación (para exigir 'borrador' antes de
// permitir cualquier borrado físico de sus propias deudas).
func (s *Service) isSettlementDraft(tx *gorm.DB, settlementID uint) (bool, error) {
	var st models.TaxSettlement
	if err := tx.Select("id", "status").First(&st, settlementID).Error; err != nil {
		return false, err
	}
	return strings.TrimSpace(st.Status) == models.TaxSettlementStatusDraft, nil
}

// logBlockedDocumentDeletion deja rastro cuando se evita un borrado físico y se desvincula en su
// lugar — útil para diagnosticar futuros casos sin necesidad de logging excesivo.
func logBlockedDocumentDeletion(d *models.Document, settlementID uint, reason string) {
	var origin interface{} = nil
	if d.OriginSettlementID != nil {
		origin = *d.OriginSettlementID
	}
	log.Printf("[settlement-cleanup] document deletion blocked document_id=%d settlement_id=%d origin_settlement_id=%v reason=%q — unlinked instead",
		d.ID, settlementID, origin, reason)
}

func allocateShortDebtNumber(tx *gorm.DB, companyID uint) (string, error) {
	var count int64
	if err := tx.Model(&models.Document{}).Where("company_id = ?", companyID).Count(&count).Error; err != nil {
		return "", err
	}
	for try := 0; try < 10000; try++ {
		v := uint64(count) + 1 + uint64(try)
		candidate := fmt.Sprintf("%06d", v%1000000)
		var exists int64
		if err := tx.Model(&models.Document{}).
			Where("company_id = ? AND number = ?", companyID, candidate).
			Count(&exists).Error; err != nil {
			return "", err
		}
		if exists == 0 {
			return candidate, nil
		}
	}
	return "", errors.New("no se pudo generar un número de deuda único")
}

type settlementLineDebtInput struct {
	LineType   string
	DocumentID *uint
	ProductID  *uint
	Concept    string
	Amount     float64
	PeriodYM   string
	PeriodDate *time.Time
}

// EnsureSettlementLineDebts vincula o crea UN documento por línea (sin clonar DEU-LIQ al emitir).
func (s *Service) EnsureSettlementLineDebts(
	tx *gorm.DB,
	settlementID, companyID uint,
	issueDate time.Time,
	liquidationPeriod string,
	lines []models.TaxSettlementLine,
) error {
	svc := s
	for i := range lines {
		ln := &lines[i]
		in := settlementLineDebtInput{
			LineType:   ln.LineType,
			DocumentID: ln.DocumentID,
			ProductID:  ln.ProductID,
			Concept:    ln.Concept,
			Amount:     ln.Amount,
			PeriodYM:   ln.PeriodYM,
			PeriodDate: ln.PeriodDate,
		}
		docID, err := svc.ensureLineDebt(tx, settlementID, companyID, issueDate, liquidationPeriod, in)
		if err != nil {
			return err
		}
		if docID > 0 && (ln.DocumentID == nil || *ln.DocumentID != docID) {
			if err := tx.Model(&models.TaxSettlementLine{}).Where("id = ?", ln.ID).Update("document_id", docID).Error; err != nil {
				return err
			}
			ln.DocumentID = &docID
		}
	}
	return nil
}

func (s *Service) ensureLineDebt(
	tx *gorm.DB,
	settlementID, companyID uint,
	issueDate time.Time,
	liquidationPeriod string,
	ln settlementLineDebtInput,
) (uint, error) {
	switch ln.LineType {
	case models.TaxSettlementLineDocRef:
		if ln.DocumentID == nil || *ln.DocumentID == 0 {
			return 0, errors.New("document_ref sin document_id")
		}
		return s.linkDocumentToSettlement(tx, *ln.DocumentID, companyID, settlementID)
	case models.TaxSettlementLineAdjust, models.TaxSettlementLineTaxManual:
		if ln.DocumentID != nil && *ln.DocumentID > 0 {
			return s.linkDocumentToSettlement(tx, *ln.DocumentID, companyID, settlementID)
		}
		if ln.Amount < MoneyEpsilon {
			return 0, nil
		}
		return s.createSettlementDebtDocument(tx, settlementID, companyID, issueDate, liquidationPeriod, ln)
	default:
		return 0, nil
	}
}

func (s *Service) linkDocumentToSettlement(tx *gorm.DB, documentID, companyID, settlementID uint) (uint, error) {
	var d models.Document
	if err := tx.First(&d, documentID).Error; err != nil {
		return 0, err
	}
	if d.CompanyID != companyID {
		return 0, errors.New("el documento no pertenece a la empresa de la liquidación")
	}
	if err := s.assertCanLinkDocumentToSettlement(tx, &d, settlementID); err != nil {
		return 0, err
	}
	if err := tx.Model(&models.Document{}).Where("id = ?", documentID).
		Update("tax_settlement_id", settlementID).Error; err != nil {
		return 0, err
	}
	return documentID, nil
}

func (s *Service) createSettlementDebtDocument(
	tx *gorm.DB,
	settlementID, companyID uint,
	issueDate time.Time,
	liquidationPeriod string,
	ln settlementLineDebtInput,
) (uint, error) {
	y, mo, d := issueDate.Date()
	issue := time.Date(y, mo, d, 0, 0, 0, 0, issueDate.Location())
	periodYM := strings.TrimSpace(ln.PeriodYM)
	if periodYM == "" && ln.PeriodDate != nil && !ln.PeriodDate.IsZero() {
		periodYM = ln.PeriodDate.Format("2006-01")
	}
	if periodYM == "" {
		periodYM = strings.TrimSpace(liquidationPeriod)
	}
	if periodYM == "" {
		periodYM = issue.Format("2006-01")
	}
	desc := strings.TrimSpace(ln.Concept)
	if desc == "" {
		desc = "Cargo liquidación"
	}
	if len(desc) > 900 {
		desc = desc[:900] + "…"
	}
	acct := periodYM
	if len(acct) > 64 {
		acct = acct[:64]
	}
	num, err := allocateShortDebtNumber(tx, companyID)
	if err != nil {
		return 0, err
	}
	doc := models.Document{
		CompanyID:       companyID,
		TaxSettlementID: &settlementID,
		// OriginSettlementID se fija AQUÍ, una sola vez, en el momento real de creación — nunca se
		// vuelve a tocar (ni siquiera cuando la deuda se arrastra a otra liquidación después).
		OriginSettlementID: &settlementID,
		Type:               models.DocumentTypeLiquidacion,
		Number:             num,
		IssueDate:          issue,
		TotalAmount:        math.Round(ln.Amount*100) / 100,
		Description:        desc,
		ServiceMonth:       acct,
		AccountingPeriod:   acct,
		Status:             StatusPending,
		Source:             "liquidacion",
	}
	s.InitBalanceOnCreate(&doc)
	ApplyPeriodFromString(&doc, periodYM, acct)
	if err := tx.Omit("Company", "Payments", "Allocations", "Items", "TaxSettlement").Create(&doc).Error; err != nil {
		return 0, err
	}
	return doc.ID, nil
}

// UnlinkSettlementFromDocument quita vínculo de liquidación (document_ref al revertir).
func (s *Service) UnlinkSettlementFromDocument(tx *gorm.DB, documentID, settlementID uint) error {
	return tx.Model(&models.Document{}).
		Where("id = ? AND tax_settlement_id = ?", documentID, settlementID).
		Update("tax_settlement_id", nil).Error
}

// RevertSettlementDebtLinksTx (Fase 6, Blueprint §19.5 —
// docs/diseno-fase6-paso2-cancelaciones-writeoff-2026-09-15.md A.3): llamada desde
// PaymentService.DeletePaymentTx al anular un pago con TaxSettlementID. Revierte
// Document.tax_settlement_id para cada documento en documentIDs SOLO si, tras eliminar las
// allocations del pago que se está anulando, ya no queda ningún otro Payment activo (no anulado, no
// soft-eliminado) con el mismo tax_settlement_id sosteniendo ese vínculo — ni vía PaymentAllocation
// ni vía el esquema legacy Payment.DocumentID directo. Un mismo Document puede tener más de un
// Payment activo con el mismo TaxSettlementID (pagos parciales sucesivos); anular solo uno de ellos
// nunca debe desvincular un Document que otro pago activo sigue sosteniendo legítimamente.
//
// Debe llamarse DESPUÉS de borrar las PaymentAllocation del pago que se está anulando (para que la
// verificación de "¿sigue habiendo otro pago activo?" no cuente las de ese mismo pago).
//
// No toca TaxSettlementLine (decisión E.1, Fase 6 Paso 2): "el vínculo deuda↔liquidación" según la
// tabla de fuentes de verdad del Blueprint (§21) es específicamente Document.tax_settlement_id.
func (s *Service) RevertSettlementDebtLinksTx(tx *gorm.DB, taxSettlementID uint, documentIDs []uint) error {
	for _, did := range documentIDs {
		var stillLinked int64
		if err := tx.Model(&models.PaymentAllocation{}).
			Joins("JOIN payments p ON p.id = payment_allocations.payment_id "+
				"AND p.deleted_at IS NULL AND p.voided_at IS NULL AND p.tax_settlement_id = ?", taxSettlementID).
			Where("payment_allocations.document_id = ?", did).
			Count(&stillLinked).Error; err != nil {
			return err
		}
		if stillLinked > 0 {
			continue
		}
		var stillLegacy int64
		if err := tx.Model(&models.Payment{}).
			Where("document_id = ? AND tax_settlement_id = ? AND voided_at IS NULL", did, taxSettlementID).
			Count(&stillLegacy).Error; err != nil {
			return err
		}
		if stillLegacy > 0 {
			continue
		}
		if err := s.UnlinkSettlementFromDocument(tx, did, taxSettlementID); err != nil {
			return err
		}
	}
	return nil
}

// SettlementDebtRow fila para API de deudas vinculadas / no vinculadas.
type SettlementDebtRow struct {
	DocumentID             uint    `json:"document_id"`
	Number                 string  `json:"number"`
	Description            string  `json:"description"`
	TotalAmount            float64 `json:"total_amount"`
	BalanceAmount          float64 `json:"balance_amount"`
	Status                 string  `json:"status"`
	AccountingPeriod       string  `json:"accounting_period,omitempty"`
	HasPeriod              bool    `json:"has_period"`
	PeriodMonth            *int16  `json:"period_month,omitempty"`
	PeriodYear             *int16  `json:"period_year,omitempty"`
	SourceSettlementID     *uint   `json:"source_settlement_id,omitempty"`
	SourceSettlementNumber string  `json:"source_settlement_number,omitempty"`
	SourceSettlementPeriod string  `json:"source_settlement_period,omitempty"`
	FromPreviousSettlement bool    `json:"from_previous_settlement,omitempty"`
	HistoricalView         bool    `json:"historical_view,omitempty"`
}

// ListLinkedDebts deudas con tax_settlement_id = settlementID.
func (s *Service) ListLinkedDebts(tx *gorm.DB, settlementID uint) ([]SettlementDebtRow, error) {
	var docs []models.Document
	q := tx.Where("tax_settlement_id = ?", settlementID)
	ScopeActiveDocuments(q)
	if err := q.Order("issue_date ASC, id ASC").Find(&docs).Error; err != nil {
		return nil, err
	}
	return s.toSettlementDebtRows(tx, docs), nil
}

// ListUnlinkedOpenDebts deudas abiertas de la empresa no vinculadas a ninguna liquidación.
func (s *Service) ListUnlinkedOpenDebts(tx *gorm.DB, companyID uint) ([]SettlementDebtRow, error) {
	var docs []models.Document
	if err := tx.Where("company_id = ? AND tax_settlement_id IS NULL", companyID).
		Where("status NOT IN ?", []string{StatusPaid, StatusCancelled, StatusExonerado}).
		Where("balance_amount > ?", MoneyEpsilon).
		Where("legacy_status IS NULL OR legacy_status = '' OR legacy_status NOT IN ?", []string{LegacyStatusMerged, LegacyStatusArchived}).
		Order("issue_date ASC, id ASC").
		Find(&docs).Error; err != nil {
		return nil, err
	}
	out := s.toSettlementDebtRows(tx, docs)
	filtered := make([]SettlementDebtRow, 0, len(out))
	for _, row := range out {
		if row.BalanceAmount > MoneyEpsilon {
			filtered = append(filtered, row)
		}
	}
	return s.enrichUnlinkedWithClosedOrigins(tx, companyID, filtered)
}

// CleanupSettlementDebtsNotInLines desvincula o elimina deudas ya no referenciadas en líneas del
// borrador. Regla de seguridad (Blueprint Fase 1 §10): el borrado físico SOLO puede ocurrir si (1) el
// documento fue creado originalmente por esta misma liquidación (IsSettlementOwnedDebt, vía
// OriginSettlementID inmutable — nunca vía TaxSettlementID/Source/Type), (2) la liquidación sigue en
// borrador, (3) no tiene imputaciones de pago, (4) no tiene pagos legacy directos, y (5) ninguna otra
// liquidación lo referencia. Si CUALQUIERA de estas condiciones falla, se DESVINCULA, nunca se borra
// — una deuda arrastrada de otra liquidación (o cuyo origen no pudo determinarse) jamás desaparece
// físicamente por editar la liquidación actual.
func (s *Service) CleanupSettlementDebtsNotInLines(
	tx *gorm.DB,
	settlementID, companyID uint,
	keptDocumentIDs map[uint]bool,
) error {
	settlementIsDraft, err := s.isSettlementDraft(tx, settlementID)
	if err != nil {
		return err
	}

	var docs []models.Document
	if err := tx.Where("tax_settlement_id = ?", settlementID).Find(&docs).Error; err != nil {
		return err
	}
	for i := range docs {
		d := &docs[i]
		if keptDocumentIDs[d.ID] {
			continue
		}
		if d.CompanyID != companyID {
			continue
		}

		if settlementIsDraft && IsSettlementOwnedDebt(d, settlementID) {
			// La liquidación actual es la dueña real (lo creó ella misma): mismo comportamiento
			// protector de siempre — si ya tiene pagos, se bloquea la operación completa en vez de
			// borrar o desvincular silenciosamente (el usuario debe decidir qué hacer con ese dinero).
			paid := s.PaidTotal(tx, d.ID)
			if paid >= MoneyEpsilon {
				return fmt.Errorf("la deuda %s tiene pagos; no se puede quitar de la liquidación", d.Number)
			}
			hasAlloc, err := s.hasPaymentAllocations(tx, d.ID)
			if err != nil {
				return err
			}
			hasLegacyPay, err := s.hasLegacyPayments(tx, d.ID)
			if err != nil {
				return err
			}
			if hasAlloc || hasLegacyPay {
				return fmt.Errorf("existe un pago registrado sobre la deuda %s", d.Number)
			}
			referencedElsewhere, err := s.referencedByOtherSettlement(tx, d.ID, settlementID)
			if err != nil {
				return err
			}
			if referencedElsewhere {
				logBlockedDocumentDeletion(d, settlementID, "referenciada por otra liquidación")
				if err := s.UnlinkSettlementFromDocument(tx, d.ID, settlementID); err != nil {
					return err
				}
				continue
			}
			if err := tx.Where("document_id = ?", d.ID).Delete(&models.DocumentItem{}).Error; err != nil {
				return err
			}
			if err := tx.Delete(&models.Document{}, d.ID).Error; err != nil {
				return err
			}
			continue
		}

		// No es dueña de verdad (arrastrada de otra liquidación, manual, u origen sin evidencia
		// suficiente) — o esta liquidación ya no está en borrador: nunca se elimina, solo se desvincula.
		if d.OriginSettlementID != nil {
			logBlockedDocumentDeletion(d, settlementID, "el origen de la deuda no es esta liquidación")
		}
		if err := s.UnlinkSettlementFromDocument(tx, d.ID, settlementID); err != nil {
			return err
		}
	}
	return nil
}

// PurgeSettlementDocumentsOnDelete limpia documentos al eliminar una liquidación. Aplica exactamente
// la misma protección que CleanupSettlementDebtsNotInLines (Blueprint Fase 1 §10/§15): solo elimina
// físicamente documentos que la liquidación eliminada creó ella misma (origen inmutable), que sigue
// en borrador en el momento de borrarse, sin pagos ni imputaciones, y sin referencias desde otra
// liquidación. Cualquier deuda con historial fuera de esta liquidación se desvincula, nunca se borra.
func (s *Service) PurgeSettlementDocumentsOnDelete(tx *gorm.DB, ts *models.TaxSettlement, lines []models.TaxSettlementLine) error {
	if ts == nil {
		return nil
	}
	settlementIsDraft := strings.TrimSpace(ts.Status) == models.TaxSettlementStatusDraft

	for _, ln := range lines {
		if ln.DocumentID == nil || *ln.DocumentID == 0 {
			continue
		}
		var d models.Document
		if err := tx.First(&d, *ln.DocumentID).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				continue
			}
			return err
		}
		switch ln.LineType {
		case models.TaxSettlementLineDocRef:
			if err := s.UnlinkSettlementFromDocument(tx, d.ID, ts.ID); err != nil {
				return err
			}
		case models.TaxSettlementLineAdjust, models.TaxSettlementLineTaxManual:
			if !settlementIsDraft || !IsSettlementOwnedDebt(&d, ts.ID) {
				if d.OriginSettlementID != nil {
					logBlockedDocumentDeletion(&d, ts.ID, "el origen de la deuda no es esta liquidación o ya no está en borrador")
				}
				if err := s.UnlinkSettlementFromDocument(tx, d.ID, ts.ID); err != nil {
					return err
				}
				continue
			}
			paid := s.PaidTotal(tx, d.ID)
			if paid >= MoneyEpsilon {
				return fmt.Errorf("la deuda %s aún tiene saldo abonado; no se puede eliminar la liquidación", d.Number)
			}
			hasAlloc, err := s.hasPaymentAllocations(tx, d.ID)
			if err != nil {
				return err
			}
			hasLegacyPay, err := s.hasLegacyPayments(tx, d.ID)
			if err != nil {
				return err
			}
			if hasAlloc || hasLegacyPay {
				return fmt.Errorf("existe un pago registrado sobre la deuda %s; elimínelo antes de borrar la liquidación", d.Number)
			}
			referencedElsewhere, err := s.referencedByOtherSettlement(tx, d.ID, ts.ID)
			if err != nil {
				return err
			}
			if referencedElsewhere {
				logBlockedDocumentDeletion(&d, ts.ID, "referenciada por otra liquidación")
				if err := s.UnlinkSettlementFromDocument(tx, d.ID, ts.ID); err != nil {
					return err
				}
				continue
			}
			if err := tx.Where("document_id = ?", d.ID).Delete(&models.DocumentItem{}).Error; err != nil {
				return err
			}
			if err := tx.Delete(&models.Document{}, d.ID).Error; err != nil {
				return err
			}
		}
	}
	return nil
}

// DocumentFinancialOrSettlementHistory indica si un documento tiene cualquier historial financiero
// (pagos, imputaciones) o de liquidación (origen o referencia actual) — usado para proteger CUALQUIER
// ruta de borrado físico de un Document en el sistema, no solo las de edición/eliminación de
// liquidaciones (Blueprint Fase 1 §23: la regla de seguridad debe ser global, no solo para dos
// funciones). Devuelve true y el motivo si el documento no debe eliminarse físicamente.
func (s *Service) DocumentFinancialOrSettlementHistory(tx *gorm.DB, d *models.Document) (bool, string, error) {
	if d == nil {
		return false, "", nil
	}
	hasAlloc, err := s.hasPaymentAllocations(tx, d.ID)
	if err != nil {
		return false, "", err
	}
	if hasAlloc {
		return true, "la deuda tiene imputaciones de pago", nil
	}
	hasLegacyPay, err := s.hasLegacyPayments(tx, d.ID)
	if err != nil {
		return false, "", err
	}
	if hasLegacyPay {
		return true, "la deuda tiene pagos asociados", nil
	}
	if d.OriginSettlementID != nil {
		return true, "la deuda fue creada originalmente por una liquidación", nil
	}
	var lineCnt int64
	if err := tx.Model(&models.TaxSettlementLine{}).Where("document_id = ?", d.ID).Count(&lineCnt).Error; err != nil {
		return false, "", err
	}
	if lineCnt > 0 {
		return true, "la deuda está referenciada por una liquidación", nil
	}
	return false, "", nil
}

func (s *Service) toSettlementDebtRows(tx *gorm.DB, docs []models.Document) []SettlementDebtRow {
	out := make([]SettlementDebtRow, 0, len(docs))
	for _, d := range docs {
		bal := s.EffectiveBalance(tx, &d)
		out = append(out, SettlementDebtRow{
			DocumentID:       d.ID,
			Number:           d.Number,
			Description:      SanitizeDocumentDescription(d.Description),
			TotalAmount:      d.TotalAmount,
			BalanceAmount:    bal,
			Status:           d.Status,
			AccountingPeriod: d.AccountingPeriod,
			HasPeriod:        d.HasPeriod,
			PeriodMonth:      d.PeriodMonth,
			PeriodYear:       d.PeriodYear,
		})
	}
	return out
}
