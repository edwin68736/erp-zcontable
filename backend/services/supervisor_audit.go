package services

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"miappfiber/config"
	"miappfiber/database"
	"miappfiber/models"
)

func (s *SupervisorService) LogChange(entityType string, entityID uint, field, oldVal, newVal string, userID uint) {
	if strings.TrimSpace(field) == "" {
		return
	}
	_ = database.DB.Create(&models.SupervisorChangeLog{
		EntityType: entityType,
		EntityID:   entityID,
		FieldName:  field,
		OldValue:   oldVal,
		NewValue:   newVal,
		UserID:     userID,
	}).Error
}

func (s *SupervisorService) ListChangeHistory(entityType string, entityID uint) ([]models.SupervisorChangeLog, error) {
	var rows []models.SupervisorChangeLog
	err := database.DB.Where("entity_type = ? AND entity_id = ?", entityType, entityID).
		Preload("User").Order("id DESC").Limit(200).Find(&rows).Error
	return rows, err
}

func (s *SupervisorService) ListObservations(controlID uint, declarationID uint) ([]models.SupervisorObservation, error) {
	q := database.DB.Model(&models.SupervisorObservation{})
	if controlID > 0 {
		q = q.Where("monthly_control_id = ?", controlID)
	}
	if declarationID > 0 {
		q = q.Where("declaration_id = ?", declarationID)
	}
	var rows []models.SupervisorObservation
	err := q.Preload("User").Order("id DESC").Find(&rows).Error
	return rows, err
}

func (s *SupervisorService) CreateObservation(controlID, declarationID, userID uint, body string) (*models.SupervisorObservation, error) {
	body = strings.TrimSpace(body)
	if body == "" {
		return nil, errors.New("observación requerida")
	}
	if controlID == 0 && declarationID == 0 {
		return nil, errors.New("control o declaración requerido")
	}
	o := models.SupervisorObservation{
		MonthlyControlID: nil,
		DeclarationID:    nil,
		UserID:           userID,
		Body:             body,
	}
	if controlID > 0 {
		o.MonthlyControlID = &controlID
	}
	if declarationID > 0 {
		o.DeclarationID = &declarationID
	}
	if err := database.DB.Create(&o).Error; err != nil {
		return nil, err
	}
	return &o, nil
}

func (s *SupervisorService) ListAttachments(controlID, declarationID uint) ([]models.SupervisorAttachment, error) {
	q := database.DB.Model(&models.SupervisorAttachment{})
	if controlID > 0 {
		q = q.Where("monthly_control_id = ?", controlID)
	}
	if declarationID > 0 {
		q = q.Where("declaration_id = ?", declarationID)
	}
	var rows []models.SupervisorAttachment
	err := q.Preload("UploadedBy").Order("id DESC").Find(&rows).Error
	return rows, err
}

func (s *SupervisorService) SaveAttachment(controlID, declarationID, userID uint, fileName, relURL string) (*models.SupervisorAttachment, error) {
	a := models.SupervisorAttachment{
		FileName:         fileName,
		FileURL:          relURL,
		UploadedByUserID: userID,
	}
	if controlID > 0 {
		a.MonthlyControlID = &controlID
	}
	if declarationID > 0 {
		a.DeclarationID = &declarationID
	}
	if err := database.DB.Create(&a).Error; err != nil {
		return nil, err
	}
	return &a, nil
}

func (s *SupervisorService) DeleteAttachment(id uint) error {
	return database.DB.Delete(&models.SupervisorAttachment{}, id).Error
}

func (s *SupervisorService) StoreSupervisorUpload(fileName string, data []byte) (string, error) {
	ext := strings.ToLower(filepath.Ext(fileName))
	ym := time.Now().Format("2006")
	mm := time.Now().Format("01")
	dir := filepath.Join(config.AppConfig.StoragePath, "supervisors", ym, mm)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	token := fmt.Sprintf("%d_%s%s", time.Now().UnixNano(), sanitizeFileToken(filepath.Base(fileName)), ext)
	full := filepath.Join(dir, token)
	if err := os.WriteFile(full, data, 0o644); err != nil {
		return "", err
	}
	return "/storage/supervisors/" + ym + "/" + mm + "/" + token, nil
}

func sanitizeFileToken(s string) string {
	s = strings.Map(func(r rune) rune {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '_' {
			return r
		}
		return '_'
	}, s)
	if s == "" {
		return "file"
	}
	return s
}

func (s *SupervisorService) ListNotifications(userID uint, unreadOnly bool, limit int) ([]models.SupervisorNotification, error) {
	if limit <= 0 {
		limit = 50
	}
	q := database.DB.Where("user_id = ?", userID)
	if unreadOnly {
		q = q.Where("read_at IS NULL")
	}
	var rows []models.SupervisorNotification
	err := q.Order("id DESC").Limit(limit).Find(&rows).Error
	return rows, err
}

func (s *SupervisorService) MarkNotificationRead(id, userID uint) error {
	res := database.DB.Model(&models.SupervisorNotification{}).
		Where("id = ? AND user_id = ?", id, userID).
		Update("read_at", time.Now())
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return errors.New("notificación no encontrada")
	}
	return nil
}

func (s *SupervisorService) MarkAllNotificationsRead(userID uint) error {
	now := time.Now()
	return database.DB.Model(&models.SupervisorNotification{}).
		Where("user_id = ? AND read_at IS NULL", userID).
		Update("read_at", now).Error
}

func (s *SupervisorService) createNotification(userID uint, kind, title, message, periodYM string, controlID *uint) {
	if userID == 0 {
		return
	}
	n := models.SupervisorNotification{
		UserID: userID, Kind: kind, Title: title, Message: message, PeriodYM: periodYM,
		MonthlyControlID: controlID,
	}
	_ = database.DB.Create(&n).Error
}

// notifyIfNew evita duplicar alertas no leídas del mismo tipo, período y control.
func (s *SupervisorService) notifyIfNew(userID uint, kind, title, message, periodYM string, controlID *uint) {
	if userID == 0 {
		return
	}
	q := database.DB.Model(&models.SupervisorNotification{}).
		Where("user_id = ? AND kind = ? AND period_ym = ? AND read_at IS NULL", userID, kind, periodYM)
	if controlID != nil && *controlID > 0 {
		q = q.Where("monthly_control_id = ?", *controlID)
	}
	var existing int64
	if err := q.Count(&existing).Error; err != nil || existing > 0 {
		return
	}
	s.createNotification(userID, kind, title, message, periodYM, controlID)
}

func (s *SupervisorService) validatePeriodCloseReady(periodYM string) error {
	var controls []models.SupervisorMonthlyControl
	if err := database.DB.Where("period_ym = ?", periodYM).Find(&controls).Error; err != nil {
		return err
	}
	requiredDecl := []string{models.SupervisorDeclPDT601, models.SupervisorDeclPDT621, models.SupervisorDeclSIRE}
	okDecl := map[string]bool{
		models.SupervisorDeclAprobado: true, models.SupervisorDeclPresentado: true, models.SupervisorDeclCerrado: true,
	}
	for _, ctrl := range controls {
		var decls []models.SupervisorDeclaration
		if err := database.DB.Where("monthly_control_id = ?", ctrl.ID).Find(&decls).Error; err != nil {
			return err
		}
		byType := map[string]string{}
		for _, d := range decls {
			byType[d.DeclarationType] = d.Status
		}
		for _, t := range requiredDecl {
			st, ok := byType[t]
			if !ok || !okDecl[st] {
				return fmt.Errorf("empresa %d: falta %s aprobada/presentada/cerrada", ctrl.CompanyID, t)
			}
		}
		var liq models.SupervisorTaxLiquidation
		if err := database.DB.Where("monthly_control_id = ?", ctrl.ID).First(&liq).Error; err != nil {
			return fmt.Errorf("empresa %d: sin liquidación tributaria", ctrl.CompanyID)
		}
		if liq.ValidationStatus != models.SupervisorLiqAprobada {
			return fmt.Errorf("empresa %d: liquidación no aprobada", ctrl.CompanyID)
		}
	}
	return nil
}

func (s *SupervisorService) RegisterNPSPayment(id uint, userID uint) (*models.SupervisorNPS, error) {
	var nps models.SupervisorNPS
	if err := database.DB.First(&nps, id).Error; err != nil {
		return nil, err
	}
	old := nps.PaymentStatus
	nps.PaymentStatus = models.SupervisorNPSPagado
	if err := database.DB.Save(&nps).Error; err != nil {
		return nil, err
	}
	s.LogChange("nps", id, "payment_status", old, nps.PaymentStatus, userID)
	return &nps, nil
}

type SupervisorDashboardParams struct {
	PeriodYM          string
	CompanyID         uint
	GeneralStatus     string
	RiskLevel         string
	ResponsibleUserID uint
	SupervisorUserID  uint
	AllowedCompanyIDs []uint
}

type SupervisorProductivityRow struct {
	UserID       uint   `json:"user_id"`
	UserName     string `json:"user_name"`
	Total        int64  `json:"total"`
	AlDia        int64  `json:"al_dia"`
	Pendiente    int64  `json:"pendiente"`
	Vencido      int64  `json:"vencido"`
	Observado    int64  `json:"observado"`
	CompliancePct float64 `json:"compliance_pct"`
}

type SupervisorObservationReportRow struct {
	ID               uint      `json:"id"`
	CompanyName      string    `json:"company_name"`
	CompanyRUC       string    `json:"company_ruc"`
	PeriodYM         string    `json:"period_ym"`
	Body             string    `json:"body"`
	AuthorName       string    `json:"author_name"`
	CreatedAt        time.Time `json:"created_at"`
	MonthlyControlID uint      `json:"monthly_control_id,omitempty"`
}

// RunAutomations sincroniza vencidos y genera notificaciones para supervisores (sin duplicar no leídas).
func (s *SupervisorService) RunAutomations(periodYM string) error {
	if !validPeriodYM(periodYM) {
		return nil
	}
	_, _ = s.SyncOverdueControls(periodYM, nil)
	_, _ = s.SyncOverdueNPS(periodYM)

	var controls []models.SupervisorMonthlyControl
	if err := database.DB.Where("period_ym = ?", periodYM).Find(&controls).Error; err != nil {
		return err
	}
	observedByControl, err := countObservedDeclarationsByControl(controls)
	if err != nil {
		return err
	}
	now := time.Now()
	warnBefore := now.AddDate(0, 0, 3)
	for _, c := range controls {
		uid := notifyUserIDForControl(&c)
		cid := c.ID
		if c.GeneralStatus == models.SupervisorControlVencido {
			s.notifyIfNew(uid, "overdue", "Control vencido",
				fmt.Sprintf("Control empresa %d período %s vencido", c.CompanyID, periodYM), periodYM, &cid)
		}
		if c.DueDate != nil && !c.DueDate.Before(now) && !c.DueDate.After(warnBefore) {
			s.notifyIfNew(uid, "due_soon", "Vencimiento próximo",
				fmt.Sprintf("Vence el %s", c.DueDate.Format("2006-01-02")), periodYM, &cid)
		}
		if observedByControl[c.ID] > 0 {
			s.notifyIfNew(uid, "declaration_observed", "Declaración observada",
				fmt.Sprintf("Hay declaraciones observadas en control %d", c.ID), periodYM, &cid)
		}
	}
	return nil
}

// countObservedDeclarationsByControl evita N+1: una sola consulta agrupada por control.
func countObservedDeclarationsByControl(controls []models.SupervisorMonthlyControl) (map[uint]int64, error) {
	out := make(map[uint]int64, len(controls))
	if len(controls) == 0 {
		return out, nil
	}
	ids := make([]uint, 0, len(controls))
	for _, c := range controls {
		ids = append(ids, c.ID)
	}
	type row struct {
		MonthlyControlID uint  `gorm:"column:monthly_control_id"`
		Cnt              int64 `gorm:"column:cnt"`
	}
	var rows []row
	err := database.DB.Model(&models.SupervisorDeclaration{}).
		Select("monthly_control_id, COUNT(*) AS cnt").
		Where("monthly_control_id IN ? AND status = ?", ids, models.SupervisorDeclObservado).
		Group("monthly_control_id").
		Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	for _, r := range rows {
		out[r.MonthlyControlID] = r.Cnt
	}
	return out, nil
}

func StartSupervisorAutomationLoop() {
	go func() {
		ticker := time.NewTicker(6 * time.Hour)
		defer ticker.Stop()
		svc := NewSupervisorService()
		run := func() {
			ym := time.Now().Format("2006-01")
			if err := svc.RunMonthlyAutomations(ym); err != nil {
				return
			}
		}
		run()
		for range ticker.C {
			run()
		}
	}()
}
