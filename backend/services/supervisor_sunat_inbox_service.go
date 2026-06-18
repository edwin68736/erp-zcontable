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

const (
	mailboxCapturesPerWeekMin = 1
	mailboxCapturesPerWeekMax = 7
)

// SunatInboxWeekOption semana selectable dentro de un period_ym.
type SunatInboxWeekOption struct {
	WeekStart string `json:"week_start"`
	Label     string `json:"label"`
}

// SunatInboxListParams filtros del listado Buzón SOL por empresa, período y semana.
type SunatInboxListParams struct {
	PeriodYM          string
	WeekStart         string
	Status            string
	Q                 string
	AllowedCompanyIDs []uint
	Page              int
	PerPage           int
}

// SunatInboxMailboxSide estado y archivo de un buzón en un slot.
type SunatInboxMailboxSide struct {
	Status       string              `json:"status"`
	AttachmentID *uint               `json:"attachment_id,omitempty"`
	FileName     string              `json:"file_name,omitempty"`
	FileURL      string              `json:"file_url,omitempty"`
	UploadedAt   *time.Time          `json:"uploaded_at,omitempty"`
	VerifiedAt   *time.Time          `json:"verified_at,omitempty"`
	Timeliness   UploadTimelinessDTO `json:"timeliness"`
}

// SunatInboxCaptureSlot slot de carga semanal (columna dinámica).
type SunatInboxCaptureSlot struct {
	ID        uint                  `json:"id,omitempty"`
	SlotIndex int                   `json:"slot_index"`
	Sunat     SunatInboxMailboxSide `json:"sunat"`
	Sunafil   SunatInboxMailboxSide `json:"sunafil"`
}

// SunatInboxListRow fila del listado.
type SunatInboxListRow struct {
	CompanyID         uint                    `json:"company_id"`
	Code              string                  `json:"code"`
	Dig               string                  `json:"dig"`
	BusinessName      string                  `json:"business_name"`
	RUC               string                  `json:"ruc"`
	AssistantUsername string                  `json:"assistant_username"`
	ControlID         *uint                   `json:"control_id,omitempty"`
	DeclarationID     *uint                   `json:"declaration_id,omitempty"`
	SummaryStatus     string                  `json:"summary_status"`
	Slots             []SunatInboxCaptureSlot `json:"slots"`
}

// SunatInboxListMeta metadatos del listado (config y semanas).
type SunatInboxListMeta struct {
	CapturesPerWeek int                    `json:"captures_per_week"`
	WeekStart       string                 `json:"week_start"`
	Weeks           []SunatInboxWeekOption `json:"weeks"`
}

// SunatInboxDetail detalle de empresa con slots de la semana.
type SunatInboxDetail struct {
	PeriodYM          string                  `json:"period_ym"`
	WeekStart         string                  `json:"week_start"`
	CapturesPerWeek   int                     `json:"captures_per_week"`
	Weeks             []SunatInboxWeekOption  `json:"weeks"`
	CompanyID         uint                    `json:"company_id"`
	Code              string                  `json:"code"`
	Dig               string                  `json:"dig"`
	BusinessName      string                  `json:"business_name"`
	RUC               string                  `json:"ruc"`
	AssistantUsername string                  `json:"assistant_username"`
	ControlID         uint                    `json:"control_id"`
	DeclarationID     uint                    `json:"declaration_id"`
	Slots             []SunatInboxCaptureSlot `json:"slots"`
	SummaryStatus     string                  `json:"summary_status"`
}

type sunatInboxListResult struct {
	Meta       SunatInboxListMeta
	Rows       []SunatInboxListRow
	Total      int64
	Page       int
	PerPage    int
	TotalPages int
}

func (s *SupervisorService) validateOpenPeriod(periodYM string) error {
	periodYM = strings.TrimSpace(periodYM)
	if !validPeriodYM(periodYM) {
		return errors.New("período inválido (YYYY-MM)")
	}
	var p models.SupervisorPeriod
	if err := database.DB.Where("period_ym = ?", periodYM).First(&p).Error; err != nil {
		return errors.New("período no encontrado")
	}
	if p.Status == models.SupervisorPeriodClosed {
		return errors.New("el período está cerrado")
	}
	return nil
}

func (s *SupervisorService) companyDig(companyID uint) string {
	var cred models.CompanyAccessCredential
	if err := database.DB.Where("company_id = ?", companyID).First(&cred).Error; err != nil {
		return ""
	}
	return strings.TrimSpace(cred.Dig)
}

func assistantUsername(u *models.User) string {
	return userUsername(u)
}

func mailboxCapturesPerWeekFromConfig() int {
	cfg, err := NewConfigService().GetFirmConfig()
	n := 2
	if err == nil && cfg != nil && cfg.MailboxCapturesPerWeek >= mailboxCapturesPerWeekMin {
		n = cfg.MailboxCapturesPerWeek
	}
	if n < mailboxCapturesPerWeekMin {
		n = mailboxCapturesPerWeekMin
	}
	if n > mailboxCapturesPerWeekMax {
		n = mailboxCapturesPerWeekMax
	}
	return n
}

func mondayOfWeekContaining(t time.Time) time.Time {
	t = time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, t.Location())
	wd := int(t.Weekday())
	if wd == 0 {
		wd = 7
	}
	return t.AddDate(0, 0, -(wd - 1))
}

func parseWeekStart(value string) (time.Time, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return mondayOfWeekContaining(time.Now()), nil
	}
	t, err := time.ParseInLocation("2006-01-02", value, time.Local)
	if err != nil {
		return time.Time{}, errors.New("week_start inválido (use YYYY-MM-DD)")
	}
	if t.Weekday() != time.Monday {
		return time.Time{}, errors.New("week_start debe ser un lunes")
	}
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.Local), nil
}

func formatWeekStart(t time.Time) string {
	return t.Format("2006-01-02")
}

func weeksInPeriodYM(periodYM string) ([]SunatInboxWeekOption, error) {
	periodYM = strings.TrimSpace(periodYM)
	if !validPeriodYM(periodYM) {
		return nil, errors.New("período inválido (YYYY-MM)")
	}
	y, m, err := parsePeriodYMParts(periodYM)
	if err != nil {
		return nil, err
	}
	first := time.Date(y, time.Month(m), 1, 0, 0, 0, 0, time.Local)
	last := first.AddDate(0, 1, -1)

	seen := map[string]struct{}{}
	var out []SunatInboxWeekOption
	cur := mondayOfWeekContaining(first)
	for !cur.After(last.AddDate(0, 0, 6)) {
		end := cur.AddDate(0, 0, 6)
		if end.Before(first) {
			cur = cur.AddDate(0, 0, 7)
			continue
		}
		ws := formatWeekStart(cur)
		if _, ok := seen[ws]; !ok {
			seen[ws] = struct{}{}
			label := fmt.Sprintf("%s – %s", cur.Format("02/01"), end.Format("02/01/2006"))
			out = append(out, SunatInboxWeekOption{WeekStart: ws, Label: label})
		}
		cur = cur.AddDate(0, 0, 7)
		if cur.After(last.AddDate(0, 0, 7)) {
			break
		}
	}
	if len(out) == 0 {
		ws := formatWeekStart(mondayOfWeekContaining(first))
		out = append(out, SunatInboxWeekOption{
			WeekStart: ws,
			Label:     first.Format("02/01/2006"),
		})
	}
	return out, nil
}

func parsePeriodYMParts(periodYM string) (int, int, error) {
	parts := strings.Split(periodYM, "-")
	if len(parts) != 2 {
		return 0, 0, errors.New("período inválido")
	}
	var y, m int
	if _, err := fmt.Sscanf(parts[0], "%d", &y); err != nil {
		return 0, 0, err
	}
	if _, err := fmt.Sscanf(parts[1], "%d", &m); err != nil || m < 1 || m > 12 {
		return 0, 0, errors.New("período inválido")
	}
	return y, m, nil
}

func normalizeMailboxType(t string) (string, error) {
	t = strings.ToLower(strings.TrimSpace(t))
	switch t {
	case models.SupervisorMailboxTypeSunat, models.SupervisorMailboxTypeSunafil:
		return t, nil
	default:
		return "", errors.New("mailbox_type debe ser sunat o sunafil")
	}
}

func mailboxSideFromSlot(slot *models.SupervisorMailboxCaptureSlot, mailboxType string) SunatInboxMailboxSide {
	side := SunatInboxMailboxSide{Status: models.SupervisorMailboxStatusPendiente}
	if slot == nil {
		return side
	}
	switch mailboxType {
	case models.SupervisorMailboxTypeSunat:
		side.Status = slot.SunatStatus
		if slot.SunatAttachment != nil {
			side.AttachmentID = &slot.SunatAttachment.ID
			side.FileName = slot.SunatAttachment.FileName
			side.FileURL = slot.SunatAttachment.FileURL
		}
		side.UploadedAt = slot.SunatUploadedAt
		side.VerifiedAt = slot.SunatVerifiedAt
	case models.SupervisorMailboxTypeSunafil:
		side.Status = slot.SunafilStatus
		if slot.SunafilAttachment != nil {
			side.AttachmentID = &slot.SunafilAttachment.ID
			side.FileName = slot.SunafilAttachment.FileName
			side.FileURL = slot.SunafilAttachment.FileURL
		}
		side.UploadedAt = slot.SunafilUploadedAt
		side.VerifiedAt = slot.SunafilVerifiedAt
	}
	return side
}

func captureSlotDTO(slot *models.SupervisorMailboxCaptureSlot, slotIndex int) SunatInboxCaptureSlot {
	dto := SunatInboxCaptureSlot{SlotIndex: slotIndex}
	if slot != nil {
		dto.ID = slot.ID
		dto.Sunat = mailboxSideFromSlot(slot, models.SupervisorMailboxTypeSunat)
		dto.Sunafil = mailboxSideFromSlot(slot, models.SupervisorMailboxTypeSunafil)
	} else {
		dto.Sunat = SunatInboxMailboxSide{Status: models.SupervisorMailboxStatusPendiente}
		dto.Sunafil = SunatInboxMailboxSide{Status: models.SupervisorMailboxStatusPendiente}
	}
	return dto
}

func buildVirtualSlots(dbSlots map[int]*models.SupervisorMailboxCaptureSlot, n int, ctx mailboxTimelinessCtx) []SunatInboxCaptureSlot {
	return buildSunatInboxSlots(dbSlots, n, ctx)
}

func analyzeCaptureSlots(slots []SunatInboxCaptureSlot) (anyPendiente, anyCargado, anyVerificado, allVerificado bool) {
	if len(slots) == 0 {
		return true, false, false, false
	}
	allVerificado = true
	for _, sl := range slots {
		for _, side := range []SunatInboxMailboxSide{sl.Sunat, sl.Sunafil} {
			switch side.Status {
			case models.SupervisorMailboxStatusPendiente:
				anyPendiente = true
				allVerificado = false
			case models.SupervisorMailboxStatusCargado:
				anyCargado = true
				allVerificado = false
			case models.SupervisorMailboxStatusVerificado:
				anyVerificado = true
			default:
				anyPendiente = true
				allVerificado = false
			}
		}
	}
	return
}

func summarizeCaptureSlots(slots []SunatInboxCaptureSlot) string {
	anyPendiente, anyCargado, anyVerificado, allVerificado := analyzeCaptureSlots(slots)
	if allVerificado {
		return models.SupervisorMailboxStatusVerificado
	}
	if anyPendiente && (anyCargado || anyVerificado) {
		return models.SupervisorMailboxStatusParcial
	}
	if anyPendiente {
		return models.SupervisorMailboxStatusPendiente
	}
	if anyCargado {
		return models.SupervisorMailboxStatusCargado
	}
	return models.SupervisorMailboxStatusPendiente
}

func companyMatchesMailboxFilter(slots []SunatInboxCaptureSlot, filter string) bool {
	filter = strings.TrimSpace(filter)
	if filter == "" {
		return true
	}
	anyPendiente, anyCargado, anyVerificado, allVerificado := analyzeCaptureSlots(slots)
	switch filter {
	case models.SupervisorMailboxStatusPendiente:
		return anyPendiente
	case models.SupervisorMailboxStatusCargado:
		return anyCargado
	case models.SupervisorMailboxStatusVerificado:
		return allVerificado
	case models.SupervisorMailboxStatusParcial:
		return anyPendiente && (anyCargado || anyVerificado)
	default:
		return summarizeCaptureSlots(slots) == filter
	}
}

func (s *SupervisorService) ensureMailboxSlots(tx *gorm.DB, controlID uint, weekStart time.Time, slotsPerWeek int) ([]models.SupervisorMailboxCaptureSlot, error) {
	var existing []models.SupervisorMailboxCaptureSlot
	if err := tx.Where("monthly_control_id = ? AND week_start = ?", controlID, weekStart).
		Order("slot_index ASC").
		Find(&existing).Error; err != nil {
		return nil, err
	}
	byIndex := map[int]models.SupervisorMailboxCaptureSlot{}
	for _, row := range existing {
		byIndex[row.SlotIndex] = row
	}
	for i := 1; i <= slotsPerWeek; i++ {
		if _, ok := byIndex[i]; ok {
			continue
		}
		row := models.SupervisorMailboxCaptureSlot{
			MonthlyControlID: controlID,
			WeekStart:        weekStart,
			SlotIndex:        i,
			SlotsPerWeek:     slotsPerWeek,
			SunatStatus:      models.SupervisorMailboxStatusPendiente,
			SunafilStatus:    models.SupervisorMailboxStatusPendiente,
		}
		if err := tx.Create(&row).Error; err != nil {
			return nil, err
		}
		byIndex[i] = row
	}
	out := make([]models.SupervisorMailboxCaptureSlot, 0, slotsPerWeek)
	for i := 1; i <= slotsPerWeek; i++ {
		out = append(out, byIndex[i])
	}
	return out, nil
}

func (s *SupervisorService) loadMailboxSlotsByControlIDs(controlIDs []uint, weekStart time.Time) (map[uint]map[int]*models.SupervisorMailboxCaptureSlot, error) {
	result := map[uint]map[int]*models.SupervisorMailboxCaptureSlot{}
	if len(controlIDs) == 0 {
		return result, nil
	}
	var rows []models.SupervisorMailboxCaptureSlot
	if err := database.DB.
		Preload("SunatAttachment").
		Preload("SunafilAttachment").
		Where("monthly_control_id IN ? AND week_start = ?", controlIDs, weekStart).
		Find(&rows).Error; err != nil {
		return nil, err
	}
	for i := range rows {
		row := &rows[i]
		if result[row.MonthlyControlID] == nil {
			result[row.MonthlyControlID] = map[int]*models.SupervisorMailboxCaptureSlot{}
		}
		result[row.MonthlyControlID][row.SlotIndex] = row
	}
	return result, nil
}

// EnsureSunatInbox crea control, declaración sunat_inbox y slots de la semana.
func (s *SupervisorService) EnsureSunatInbox(companyID uint, periodYM, weekStartStr string) (*SunatInboxDetail, error) {
	if err := s.validateOpenPeriod(periodYM); err != nil {
		return nil, err
	}
	weekStart, err := parseWeekStart(weekStartStr)
	if err != nil {
		return nil, err
	}
	slotsPerWeek := mailboxCapturesPerWeekFromConfig()
	weeks, err := weeksInPeriodYM(periodYM)
	if err != nil {
		return nil, err
	}

	var company models.Company
	if err := database.DB.Preload("Assistant").First(&company, companyID).Error; err != nil {
		return nil, errors.New("empresa no encontrada")
	}
	if company.ClientType != models.CompanyClientTypeEstudio || company.Status != "activo" {
		return nil, errors.New("empresa no disponible")
	}

	var ctrl models.SupervisorMonthlyControl
	var decl models.SupervisorDeclaration

	err = database.DB.Transaction(func(tx *gorm.DB) error {
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
		if err := tx.Where("monthly_control_id = ? AND declaration_type = ?", ctrl.ID, models.SupervisorDeclSunatInbox).
			First(&decl).Error; err != nil {
			if !errors.Is(err, gorm.ErrRecordNotFound) {
				return err
			}
			decl = models.SupervisorDeclaration{
				MonthlyControlID: ctrl.ID,
				DeclarationType:  models.SupervisorDeclSunatInbox,
				Status:           models.SupervisorMailboxStatusPendiente,
				Priority:         models.SupervisorPriorityMedia,
			}
			if err := tx.Create(&decl).Error; err != nil {
				return err
			}
		}
		var errEnsure error
		_, errEnsure = s.ensureMailboxSlots(tx, ctrl.ID, weekStart, slotsPerWeek)
		return errEnsure
	})
	if err != nil {
		return nil, err
	}

	var loadedSlots []models.SupervisorMailboxCaptureSlot
	if err := database.DB.
		Preload("SunatAttachment").
		Preload("SunafilAttachment").
		Where("monthly_control_id = ? AND week_start = ?", ctrl.ID, weekStart).
		Order("slot_index ASC").
		Find(&loadedSlots).Error; err != nil {
		return nil, err
	}

	slotMap := map[int]*models.SupervisorMailboxCaptureSlot{}
	for i := range loadedSlots {
		slotMap[loadedSlots[i].SlotIndex] = &loadedSlots[i]
	}
	timelinessCtx := mailboxTimelinessCtxFor(periodYM, weekStart, slotsPerWeek)
	dtoSlots := buildVirtualSlots(slotMap, slotsPerWeek, timelinessCtx)

	return &SunatInboxDetail{
		PeriodYM:          periodYM,
		WeekStart:         formatWeekStart(weekStart),
		CapturesPerWeek:   slotsPerWeek,
		Weeks:             weeks,
		CompanyID:         company.ID,
		Code:              strings.TrimSpace(company.InternalCode),
		Dig:               s.companyDig(company.ID),
		BusinessName:      strings.TrimSpace(company.BusinessName),
		RUC:               strings.TrimSpace(company.RUC),
		AssistantUsername: assistantUsername(company.Assistant),
		ControlID:         ctrl.ID,
		DeclarationID:     decl.ID,
		Slots:             dtoSlots,
		SummaryStatus:     summarizeCaptureSlots(dtoSlots),
	}, nil
}

// ListSunatInbox listado empresa+período+semana.
func (s *SupervisorService) ListSunatInbox(p SunatInboxListParams) (*sunatInboxListResult, error) {
	p.PeriodYM = strings.TrimSpace(p.PeriodYM)
	if err := s.validateOpenPeriod(p.PeriodYM); err != nil {
		return nil, err
	}
	weekStart, err := parseWeekStart(p.WeekStart)
	if err != nil {
		return nil, err
	}
	slotsPerWeek := mailboxCapturesPerWeekFromConfig()
	weeks, err := weeksInPeriodYM(p.PeriodYM)
	if err != nil {
		return nil, err
	}

	page := p.Page
	if page < 1 {
		page = 1
	}
	perPage := p.PerPage
	if perPage < 1 {
		perPage = 20
	}
	if perPage > 200 {
		perPage = 200
	}

	q := database.DB.Model(&models.Company{}).
		Where("companies.client_type = ? AND companies.status = ?", models.CompanyClientTypeEstudio, "activo").
		Preload("Assistant")

	if len(p.AllowedCompanyIDs) > 0 {
		q = q.Where("companies.id IN ?", p.AllowedCompanyIDs)
	} else if p.AllowedCompanyIDs != nil {
		return &sunatInboxListResult{
			Meta: SunatInboxListMeta{
				CapturesPerWeek: slotsPerWeek,
				WeekStart:       formatWeekStart(weekStart),
				Weeks:           weeks,
			},
			Rows: []SunatInboxListRow{}, Total: 0, Page: page, PerPage: perPage, TotalPages: 0,
		}, nil
	}

	term := strings.TrimSpace(p.Q)
	if len(term) >= 2 {
		like := "%" + term + "%"
		q = q.Where(
			"companies.ruc LIKE ? OR companies.business_name LIKE ? OR companies.internal_code LIKE ?",
			like, like, like,
		)
	}

	var allCompanies []models.Company
	if err := q.Order("companies.internal_code ASC").Find(&allCompanies).Error; err != nil {
		return nil, err
	}

	ids := make([]uint, 0, len(allCompanies))
	for _, c := range allCompanies {
		ids = append(ids, c.ID)
	}

	type ctrlRow struct {
		CompanyID     uint
		ControlID     uint
		DeclarationID uint
	}
	var ctrls []ctrlRow
	if len(ids) > 0 {
		_ = database.DB.Table("supervisor_monthly_controls AS c").
			Select("c.company_id, c.id AS control_id, d.id AS declaration_id").
			Joins("INNER JOIN supervisor_declarations d ON d.monthly_control_id = c.id AND d.declaration_type = ? AND d.deleted_at IS NULL", models.SupervisorDeclSunatInbox).
			Where("c.company_id IN ? AND c.period_ym = ? AND c.deleted_at IS NULL", ids, p.PeriodYM).
			Scan(&ctrls).Error
	}

	ctrlByCompany := map[uint]ctrlRow{}
	controlIDs := make([]uint, 0, len(ctrls))
	for _, c := range ctrls {
		ctrlByCompany[c.CompanyID] = c
		controlIDs = append(controlIDs, c.ControlID)
	}

	slotsByControl, err := s.loadMailboxSlotsByControlIDs(controlIDs, weekStart)
	if err != nil {
		return nil, err
	}

	credDig := map[uint]string{}
	if len(ids) > 0 {
		var creds []models.CompanyAccessCredential
		_ = database.DB.Where("company_id IN ?", ids).Find(&creds).Error
		for _, cr := range creds {
			credDig[cr.CompanyID] = strings.TrimSpace(cr.Dig)
		}
	}

	statusFilter := strings.TrimSpace(p.Status)
	timelinessCtx := mailboxTimelinessCtxFor(p.PeriodYM, weekStart, slotsPerWeek)
	filteredRows := make([]SunatInboxListRow, 0, len(allCompanies))
	for _, co := range allCompanies {
		dtoSlots := buildVirtualSlots(nil, slotsPerWeek, timelinessCtx)
		var controlID, declID *uint
		if cr, ok := ctrlByCompany[co.ID]; ok {
			cid, did := cr.ControlID, cr.DeclarationID
			controlID = &cid
			declID = &did
			dtoSlots = buildVirtualSlots(slotsByControl[cr.ControlID], slotsPerWeek, timelinessCtx)
		}
		summary := summarizeCaptureSlots(dtoSlots)
		if !companyMatchesMailboxFilter(dtoSlots, statusFilter) {
			continue
		}
		filteredRows = append(filteredRows, SunatInboxListRow{
			CompanyID:         co.ID,
			Code:              strings.TrimSpace(co.InternalCode),
			Dig:               credDig[co.ID],
			BusinessName:      strings.TrimSpace(co.BusinessName),
			RUC:               strings.TrimSpace(co.RUC),
			AssistantUsername: assistantUsername(co.Assistant),
			ControlID:         controlID,
			DeclarationID:     declID,
			SummaryStatus:     summary,
			Slots:             dtoSlots,
		})
	}

	total := int64(len(filteredRows))
	offset := (page - 1) * perPage
	end := offset + perPage
	if offset > len(filteredRows) {
		offset = len(filteredRows)
	}
	if end > len(filteredRows) {
		end = len(filteredRows)
	}
	rows := filteredRows[offset:end]

	return &sunatInboxListResult{
		Meta: SunatInboxListMeta{
			CapturesPerWeek: slotsPerWeek,
			WeekStart:       formatWeekStart(weekStart),
			Weeks:           weeks,
		},
		Rows: rows, Total: total, Page: page, PerPage: perPage,
		TotalPages: sunatInboxTotalPages(total, perPage),
	}, nil
}

func sunatInboxTotalPages(total int64, perPage int) int {
	if total <= 0 {
		return 0
	}
	return int((total + int64(perPage) - 1) / int64(perPage))
}

func (s *SupervisorService) getMailboxSlotForAccess(slotID uint, allowed []uint) (*models.SupervisorMailboxCaptureSlot, error) {
	var slot models.SupervisorMailboxCaptureSlot
	if err := database.DB.
		Preload("MonthlyControl").
		Preload("SunatAttachment").
		Preload("SunafilAttachment").
		First(&slot, slotID).Error; err != nil {
		return nil, errors.New("slot no encontrado")
	}
	if slot.MonthlyControl == nil {
		return nil, errors.New("control no encontrado")
	}
	if allowed != nil {
		ok := false
		for _, id := range allowed {
			if id == slot.MonthlyControl.CompanyID {
				ok = true
				break
			}
		}
		if !ok {
			return nil, errors.New("sin acceso a esta empresa")
		}
	}
	return &slot, nil
}

// UploadMailboxCapture sube captura PDF/imagen para SUNAT o SUNAFIL en un slot.
func (s *SupervisorService) UploadMailboxCapture(
	companyID uint,
	periodYM, weekStartStr string,
	slotIndex int,
	mailboxType, fileName string,
	data []byte,
	userID uint,
) (*SunatInboxCaptureSlot, error) {
	if slotIndex < 1 || slotIndex > mailboxCapturesPerWeekMax {
		return nil, errors.New("slot_index inválido")
	}
	mailboxType, err := normalizeMailboxType(mailboxType)
	if err != nil {
		return nil, err
	}
	detail, err := s.EnsureSunatInbox(companyID, periodYM, weekStartStr)
	if err != nil {
		return nil, err
	}
	if slotIndex > detail.CapturesPerWeek {
		return nil, errors.New("slot_index fuera de rango configurado")
	}

	weekStartParsed, err := parseWeekStart(detail.WeekStart)
	if err != nil {
		return nil, err
	}

	var slot models.SupervisorMailboxCaptureSlot
	if err := database.DB.
		Preload("SunatAttachment").
		Preload("SunafilAttachment").
		Where("monthly_control_id = ? AND week_start = ? AND slot_index = ?", detail.ControlID, weekStartParsed, slotIndex).
		First(&slot).Error; err != nil {
		return nil, errors.New("slot no encontrado")
	}

	currentStatus := slot.SunatStatus
	if mailboxType == models.SupervisorMailboxTypeSunafil {
		currentStatus = slot.SunafilStatus
	}
	if currentStatus == models.SupervisorMailboxStatusVerificado {
		return nil, errors.New("no se puede reemplazar un archivo ya verificado")
	}

	url, err := s.StoreSupervisorUpload(fileName, data)
	if err != nil {
		return nil, err
	}
	att, err := s.SaveAttachment(detail.ControlID, detail.DeclarationID, userID, fileName, url)
	if err != nil {
		return nil, err
	}

	now := time.Now()
	updates := map[string]interface{}{}
	switch mailboxType {
	case models.SupervisorMailboxTypeSunat:
		updates["sunat_attachment_id"] = att.ID
		updates["sunat_status"] = models.SupervisorMailboxStatusCargado
		updates["sunat_uploaded_by_user_id"] = userID
		updates["sunat_uploaded_at"] = now
		updates["sunat_verified_by_user_id"] = nil
		updates["sunat_verified_at"] = nil
	case models.SupervisorMailboxTypeSunafil:
		updates["sunafil_attachment_id"] = att.ID
		updates["sunafil_status"] = models.SupervisorMailboxStatusCargado
		updates["sunafil_uploaded_by_user_id"] = userID
		updates["sunafil_uploaded_at"] = now
		updates["sunafil_verified_by_user_id"] = nil
		updates["sunafil_verified_at"] = nil
	}
	if err := database.DB.Model(&slot).Updates(updates).Error; err != nil {
		return nil, err
	}
	if err := database.DB.
		Preload("SunatAttachment").
		Preload("SunafilAttachment").
		First(&slot, slot.ID).Error; err != nil {
		return nil, err
	}
	timelinessCtx := mailboxTimelinessCtxFor(periodYM, weekStartParsed, detail.CapturesPerWeek)
	dto := enrichSunatInboxCaptureSlotTimeliness(captureSlotDTO(&slot, slot.SlotIndex), timelinessCtx)
	return &dto, nil
}

// VerifyMailboxCapture marca un buzón del slot como verificado (supervisor).
func (s *SupervisorService) VerifyMailboxCapture(slotID uint, mailboxType string, approverID uint, allowed []uint) (*SunatInboxCaptureSlot, error) {
	mailboxType, err := normalizeMailboxType(mailboxType)
	if err != nil {
		return nil, err
	}
	slot, err := s.getMailboxSlotForAccess(slotID, allowed)
	if err != nil {
		return nil, err
	}

	currentStatus := slot.SunatStatus
	if mailboxType == models.SupervisorMailboxTypeSunafil {
		currentStatus = slot.SunafilStatus
	}
	if currentStatus != models.SupervisorMailboxStatusCargado {
		return nil, errors.New("solo se puede verificar un buzón en estado cargado")
	}

	now := time.Now()
	updates := map[string]interface{}{}
	field := "sunat"
	if mailboxType == models.SupervisorMailboxTypeSunafil {
		field = "sunafil"
	}
	updates[field+"_status"] = models.SupervisorMailboxStatusVerificado
	updates[field+"_verified_by_user_id"] = approverID
	updates[field+"_verified_at"] = now

	if err := database.DB.Model(slot).Updates(updates).Error; err != nil {
		return nil, err
	}
	s.LogChange("mailbox_capture_slot", slot.ID, field+"_status", models.SupervisorMailboxStatusCargado, models.SupervisorMailboxStatusVerificado, approverID)

	if err := database.DB.
		Preload("SunatAttachment").
		Preload("SunafilAttachment").
		First(slot, slot.ID).Error; err != nil {
		return nil, err
	}
	timelinessCtx := mailboxTimelinessCtxFromSlot(slot, mailboxCapturesPerWeekFromConfig())
	dto := enrichSunatInboxCaptureSlotTimeliness(captureSlotDTO(slot, slot.SlotIndex), timelinessCtx)
	return &dto, nil
}

// EnsureSunatInboxDeclarationType verifica que la declaración sea sunat_inbox.
func (s *SupervisorService) EnsureSunatInboxDeclarationType(declarationID uint) error {
	var d models.SupervisorDeclaration
	if err := database.DB.Select("declaration_type").First(&d, declarationID).Error; err != nil {
		return errors.New("declaración no encontrada")
	}
	if d.DeclarationType != models.SupervisorDeclSunatInbox {
		return errors.New("no es un registro de Buzón SOL")
	}
	return nil
}
