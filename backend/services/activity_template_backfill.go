package services

import (
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"
	"unicode"

	"miappfiber/models"

	"gorm.io/gorm"
)

const backfillSimilarityMinScore = 0.35

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}

var backfillHexColorRe = regexp.MustCompile(`^#[0-9A-Fa-f]{6}$`)

// BackfillExactGroup agrupamiento exacto (name TRIM, kind/priority TRIM, color LOWER TRIM).
type BackfillExactGroup struct {
	Key              BackfillExactKey `json:"key"`
	ActivityCount    int64            `json:"activity_count"`
	ActivityIDs      []uint           `json:"activity_ids"`
	RepresentativeID uint             `json:"representative_id"`
	TemplateExists   bool             `json:"template_exists"`
	WouldCreate      bool             `json:"would_create_template"`
}

// BackfillExactKey clave normalizada de agrupamiento exacto.
type BackfillExactKey struct {
	Name         string `json:"name"`
	ActivityKind string `json:"activity_kind"`
	Priority     string `json:"priority"`
	TextColor    string `json:"text_color"`
}

// BackfillSimilarityHint posible duplicado funcional (informativo; sin fusión automática).
type BackfillSimilarityHint struct {
	ActivityKind string                   `json:"activity_kind"`
	Priority     string                   `json:"priority"`
	TextColor    string                   `json:"text_color"`
	Names        []BackfillSimilarityName `json:"names"`
	MaxScore     float64                  `json:"max_similarity_score"`
	Reason       string                   `json:"reason"`
}

// BackfillSimilarityName nombre original con conteo de instancias.
type BackfillSimilarityName struct {
	Name          string `json:"name"`
	ActivityCount int    `json:"activity_count"`
}

// BackfillReport resultado DryRun / Execute.
type BackfillReport struct {
	TotalActivities      int64                    `json:"total_activities"`
	AlreadyLinked        int64                    `json:"already_linked"`
	AlreadySnapshotted   int64                    `json:"already_snapshotted"`
	PendingActivities    int64                    `json:"pending_activities"`
	ExactGroups          int64                    `json:"exact_groups"`
	TemplatesWouldCreate int64                    `json:"templates_would_create"`
	TemplatesWouldReuse  int64                    `json:"templates_would_reuse"`
	ActivitiesWouldLink  int64                    `json:"activities_would_link"`
	ActivitiesSkipped    int64                    `json:"activities_skipped"`
	SimilarityHints      []BackfillSimilarityHint `json:"similarity_hints"`
	Groups               []BackfillExactGroup     `json:"groups"`
	Executed             bool                     `json:"executed,omitempty"`
	GroupsProcessed      int64                    `json:"groups_processed,omitempty"`
	GroupsFailed         int64                    `json:"groups_failed,omitempty"`
	LastError            string                   `json:"last_error,omitempty"`
}

type backfillActivityRow struct {
	ID           uint
	Name         string
	ActivityKind string
	Priority     string
	TextColor    string
	TemplateID   uint
	NameSnap     string
	TypeSnap     string
}

func NormBackfillKind(s string) string {
	return strings.TrimSpace(s)
}

func NormBackfillPriority(s string) string {
	return strings.TrimSpace(s)
}

func NormBackfillColor(s string) string {
	c := strings.ToLower(strings.TrimSpace(s))
	if backfillHexColorRe.MatchString(c) {
		return c
	}
	return "#1d4ed8"
}

func NormBackfillNameKey(s string) string {
	return strings.TrimSpace(s)
}

func normBackfillNameSimilarity(s string) string {
	s = strings.TrimSpace(s)
	var b strings.Builder
	prevSpace := false
	for _, r := range strings.ToLower(s) {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			b.WriteRune(r)
			prevSpace = false
			continue
		}
		if !prevSpace && b.Len() > 0 {
			b.WriteByte(' ')
			prevSpace = true
		}
	}
	return strings.TrimSpace(b.String())
}

func tokenSet(s string) map[string]struct{} {
	out := make(map[string]struct{})
	for _, w := range strings.Fields(s) {
		if len(w) < 3 {
			continue
		}
		out[w] = struct{}{}
	}
	return out
}

func jaccardSimilarity(a, b string) float64 {
	ta, tb := tokenSet(a), tokenSet(b)
	if len(ta) == 0 || len(tb) == 0 {
		return 0
	}
	inter := 0
	for w := range ta {
		if _, ok := tb[w]; ok {
			inter++
		}
	}
	union := len(ta) + len(tb) - inter
	if union == 0 {
		return 0
	}
	return float64(inter) / float64(union)
}

// NameSimilarityScore solo para reporte informativo (no fusiona).
func NameSimilarityScore(a, b string) float64 {
	na, nb := normBackfillNameSimilarity(a), normBackfillNameSimilarity(b)
	if na == nb {
		return 1
	}
	if na == "" || nb == "" {
		return 0
	}
	score := jaccardSimilarity(na, nb)
	if strings.Contains(na, nb) || strings.Contains(nb, na) {
		if score < 0.55 {
			score = 0.55
		}
	}
	la, lb := strings.ToLower(na), strings.ToLower(nb)
	if (strings.Contains(la, "nps") && strings.Contains(lb, "npos")) ||
		(strings.Contains(la, "npos") && strings.Contains(lb, "nps")) {
		if score < 0.4 {
			score = 0.4
		}
	}
	return score
}

func loadBackfillActivities(db *gorm.DB) ([]backfillActivityRow, error) {
	var acts []models.FinanceCalendarActivity
	if err := db.Unscoped().Order("id ASC").Find(&acts).Error; err != nil {
		return nil, err
	}
	rows := make([]backfillActivityRow, 0, len(acts))
	for _, a := range acts {
		rows = append(rows, backfillActivityRow{
			ID:           a.ID,
			Name:         strings.TrimSpace(a.NameSnapshot),
			ActivityKind: strings.TrimSpace(a.ActivityTypeSnapshot),
			Priority:     strings.TrimSpace(a.PrioritySnapshot),
			TextColor:    strings.TrimSpace(a.TextColorSnapshot),
			TemplateID:   a.ActivityTemplateID,
			NameSnap:     a.NameSnapshot,
			TypeSnap:     a.ActivityTypeSnapshot,
		})
	}
	return rows, nil
}

func buildExactGroups(rows []backfillActivityRow) map[BackfillExactKey][]backfillActivityRow {
	m := make(map[BackfillExactKey][]backfillActivityRow)
	for _, r := range rows {
		k := BackfillExactKey{
			Name:         NormBackfillNameKey(r.Name),
			ActivityKind: NormBackfillKind(r.ActivityKind),
			Priority:     NormBackfillPriority(r.Priority),
			TextColor:    NormBackfillColor(r.TextColor),
		}
		m[k] = append(m[k], r)
	}
	return m
}

func activityNeedsBackfill(r backfillActivityRow) bool {
	if r.TemplateID > 0 && strings.TrimSpace(r.NameSnap) != "" && strings.TrimSpace(r.TypeSnap) != "" {
		return false
	}
	return true
}

func findExistingTemplate(db *gorm.DB, key BackfillExactKey) (*models.ActivityTemplate, error) {
	if !db.Migrator().HasTable(&models.ActivityTemplate{}) {
		return nil, nil
	}
	var tpl models.ActivityTemplate
	err := db.Where(
		"TRIM(name) = ? AND activity_type = ? AND priority = ? AND text_color = ?",
		key.Name, key.ActivityKind, key.Priority, key.TextColor,
	).First(&tpl).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &tpl, nil
}

func representativeOriginalName(items []backfillActivityRow) string {
	pick := items[0]
	for _, it := range items[1:] {
		if it.ID < pick.ID {
			pick = it
		}
	}
	return pick.Name
}

func buildSimilarityHints(groups map[BackfillExactKey][]backfillActivityRow) []BackfillSimilarityHint {
	type meta struct {
		kind, priority, color string
	}
	metaNames := make(map[meta]map[string]int)

	for key, items := range groups {
		m := meta{key.ActivityKind, key.Priority, key.TextColor}
		if metaNames[m] == nil {
			metaNames[m] = make(map[string]int)
		}
		origName := representativeOriginalName(items)
		metaNames[m][origName] += len(items)
	}

	var hints []BackfillSimilarityHint
	for m, nameCounts := range metaNames {
		if len(nameCounts) < 2 {
			continue
		}
		names := make([]string, 0, len(nameCounts))
		for n := range nameCounts {
			names = append(names, n)
		}
		maxScore := 0.0
		reason := ""
		for i := 0; i < len(names); i++ {
			for j := i + 1; j < len(names); j++ {
				sc := NameSimilarityScore(names[i], names[j])
				if sc > maxScore {
					maxScore = sc
					reason = fmt.Sprintf("similitud %.2f entre %q y %q", sc, names[i], names[j])
				}
			}
		}
		if maxScore < backfillSimilarityMinScore {
			continue
		}
		entries := make([]BackfillSimilarityName, 0, len(nameCounts))
		for n, c := range nameCounts {
			entries = append(entries, BackfillSimilarityName{Name: n, ActivityCount: c})
		}
		hints = append(hints, BackfillSimilarityHint{
			ActivityKind: m.kind,
			Priority:     m.priority,
			TextColor:    m.color,
			Names:        entries,
			MaxScore:     maxScore,
			Reason:       reason,
		})
	}
	return hints
}

// DryRunBackfill reporte sin modificar datos.
func DryRunBackfill(db *gorm.DB) (*BackfillReport, error) {
	return buildBackfillReport(db, false)
}

func buildBackfillReport(db *gorm.DB, executed bool) (*BackfillReport, error) {
	rows, err := loadBackfillActivities(db)
	if err != nil {
		return nil, err
	}

	rep := &BackfillReport{
		TotalActivities: int64(len(rows)),
		Executed:        executed,
	}
	groupMap := buildExactGroups(rows)

	for key, items := range groupMap {
		g := BackfillExactGroup{
			Key:           key,
			ActivityCount: int64(len(items)),
		}
		for _, it := range items {
			g.ActivityIDs = append(g.ActivityIDs, it.ID)
			if g.RepresentativeID == 0 || it.ID < g.RepresentativeID {
				g.RepresentativeID = it.ID
			}
			if !activityNeedsBackfill(it) {
				rep.ActivitiesSkipped++
				continue
			}
			rep.ActivitiesWouldLink++
		}

		tpl, err := findExistingTemplate(db, key)
		if err != nil {
			return nil, err
		}
		g.TemplateExists = tpl != nil
		g.WouldCreate = tpl == nil
		if tpl != nil {
			rep.TemplatesWouldReuse++
		} else {
			rep.TemplatesWouldCreate++
		}
		rep.Groups = append(rep.Groups, g)
	}

	rep.ExactGroups = int64(len(rep.Groups))
	rep.SimilarityHints = buildSimilarityHints(groupMap)
	rep.PendingActivities = rep.ActivitiesWouldLink

	for _, r := range rows {
		if r.TemplateID > 0 {
			rep.AlreadyLinked++
		}
		if strings.TrimSpace(r.NameSnap) != "" && strings.TrimSpace(r.TypeSnap) != "" {
			rep.AlreadySnapshotted++
		}
	}
	return rep, nil
}

// CreateInTx crea plantilla dentro de una transacción existente (backfill por grupo).
func (s *ActivityTemplateService) CreateInTx(tx *gorm.DB, in ActivityTemplateInput) (*models.ActivityTemplate, error) {
	if err := s.normalizeInput(&in); err != nil {
		return nil, err
	}
	isValidatable := in.ActivityType != models.CalendarActivityOther
	if in.IsValidatable != nil {
		isValidatable = *in.IsValidatable
	}
	active := true
	if in.Active != nil {
		active = *in.Active
	}
	n, err := s.reserveNextActivityNumber(tx)
	if err != nil {
		return nil, err
	}
	created := models.ActivityTemplate{
		Code:          FormatActivityCode(n),
		Name:          in.Name,
		Description:   in.Description,
		ActivityType:  in.ActivityType,
		Priority:      in.Priority,
		TextColor:     in.TextColor,
		Icon:          in.Icon,
		SortOrder:     in.SortOrder,
		IsValidatable: isValidatable,
		Active:        active,
	}
	if err := tx.Create(&created).Error; err != nil {
		return nil, err
	}
	return &created, nil
}

// ExecuteBackfill idempotente: una transacción por grupo exacto.
func ExecuteBackfill(db *gorm.DB) (*BackfillReport, error) {
	if !db.Migrator().HasColumn(&models.FinanceCalendarActivity{}, "activity_template_id") {
		return nil, errors.New("ejecute AutoMigrate antes del backfill (faltan columnas snapshot)")
	}
	if err := db.AutoMigrate(&models.ActivityTemplateBackfillLog{}); err != nil {
		return nil, err
	}

	dry, err := DryRunBackfill(db)
	if err != nil {
		return nil, err
	}
	if dry.ActivitiesWouldLink == 0 {
		if err := markBackfillMigrationDone(db); err != nil {
			return nil, err
		}
		dry.Executed = true
		return dry, nil
	}

	tplSvc := NewActivityTemplateService()
	rep := *dry
	rep.Executed = true

	for _, g := range dry.Groups {
		var groupRows []backfillActivityRow
		if err := db.Unscoped().Model(&models.FinanceCalendarActivity{}).
			Select("id, name, activity_kind, priority, text_color, activity_template_id, name_snapshot, activity_type_snapshot").
			Where("id IN ?", g.ActivityIDs).
			Scan(&groupRows).Error; err != nil {
			rep.GroupsFailed++
			rep.LastError = err.Error()
			return &rep, err
		}

		needsAny := false
		for _, r := range groupRows {
			if activityNeedsBackfill(r) {
				needsAny = true
				break
			}
		}
		if !needsAny {
			continue
		}

		err := db.Transaction(func(tx *gorm.DB) error {
			tpl, err := findExistingTemplate(tx, g.Key)
			if err != nil {
				return err
			}
			if tpl == nil {
				created, err := tplSvc.CreateInTx(tx, ActivityTemplateInput{
					Name:         representativeOriginalName(groupRows),
					ActivityType: g.Key.ActivityKind,
					Priority:     g.Key.Priority,
					TextColor:    g.Key.TextColor,
				})
				if err != nil {
					return err
				}
				tpl = created
			}

			for _, row := range groupRows {
				if !activityNeedsBackfill(row) {
					continue
				}
				var act models.FinanceCalendarActivity
				if err := tx.Unscoped().First(&act, row.ID).Error; err != nil {
					return err
				}
				if err := tx.Model(&act).Updates(map[string]interface{}{
					"activity_template_id":   tpl.ID,
					"name_snapshot":          firstNonEmpty(strings.TrimSpace(act.NameSnapshot), row.Name),
					"activity_type_snapshot": NormBackfillKind(firstNonEmpty(strings.TrimSpace(act.ActivityTypeSnapshot), row.ActivityKind)),
					"priority_snapshot":      NormBackfillPriority(firstNonEmpty(strings.TrimSpace(act.PrioritySnapshot), row.Priority)),
					"text_color_snapshot":    NormBackfillColor(firstNonEmpty(strings.TrimSpace(act.TextColorSnapshot), row.TextColor)),
					"icon_snapshot":          strings.TrimSpace(act.IconSnapshot),
				}).Error; err != nil {
					return err
				}
				if err := tx.Create(&models.ActivityTemplateBackfillLog{
					ActivityID:    act.ID,
					TemplateID:    tpl.ID,
					TemplateCode:  tpl.Code,
					Action:        "linked",
					MigrationName: models.ActivityTemplateBackfillMigrationName,
				}).Error; err != nil {
					return err
				}
			}
			return nil
		})
		if err != nil {
			rep.GroupsFailed++
			rep.LastError = err.Error()
			return &rep, fmt.Errorf("grupo %q: %w", g.Key.Name, err)
		}
		rep.GroupsProcessed++
	}

	if err := markBackfillMigrationDone(db); err != nil {
		return &rep, err
	}
	return &rep, nil
}

func markBackfillMigrationDone(db *gorm.DB) error {
	var n int64
	if err := db.Model(&models.SchemaMigration{}).
		Where("name = ?", models.ActivityTemplateBackfillMigrationName).
		Count(&n).Error; err != nil {
		return err
	}
	if n > 0 {
		return nil
	}
	return db.Create(&models.SchemaMigration{
		Name:      models.ActivityTemplateBackfillMigrationName,
		AppliedAt: time.Now(),
	}).Error
}

// RollbackBackfill revierte FK/snapshots del log de backfill.
func RollbackBackfill(db *gorm.DB) error {
	if !db.Migrator().HasTable(&models.ActivityTemplateBackfillLog{}) {
		return errors.New("no hay log de backfill")
	}
	var logs []models.ActivityTemplateBackfillLog
	if err := db.Where("migration_name = ?", models.ActivityTemplateBackfillMigrationName).Find(&logs).Error; err != nil {
		return err
	}
	if len(logs) == 0 {
		return errors.New("log de backfill vacío")
	}

	tplIDs := make(map[uint]struct{})
	for _, l := range logs {
		tplIDs[l.TemplateID] = struct{}{}
	}

	tplSvc := NewActivityTemplateService()
	return db.Transaction(func(tx *gorm.DB) error {
		for _, l := range logs {
			if err := tx.Model(&models.FinanceCalendarActivity{}).Where("id = ?", l.ActivityID).Updates(map[string]interface{}{
				"activity_template_id":   nil,
				"name_snapshot":          "",
				"activity_type_snapshot": "",
				"priority_snapshot":      "",
				"text_color_snapshot":    "",
				"icon_snapshot":          nil,
			}).Error; err != nil {
				return err
			}
		}
		for tid := range tplIDs {
			n, err := tplSvc.CountCalendarReferences(tid)
			if err != nil {
				return err
			}
			if n == 0 {
				if err := tx.Unscoped().Delete(&models.ActivityTemplate{}, tid).Error; err != nil {
					return err
				}
			}
		}
		if err := tx.Where("migration_name = ?", models.ActivityTemplateBackfillMigrationName).
			Delete(&models.ActivityTemplateBackfillLog{}).Error; err != nil {
			return err
		}
		return tx.Where("name = ?", models.ActivityTemplateBackfillMigrationName).
			Delete(&models.SchemaMigration{}).Error
	})
}

// EnsureBackfillSchema AutoMigrate tablas/columnas requeridas.
func EnsureBackfillSchema(db *gorm.DB) error {
	return db.AutoMigrate(
		&models.ActivityTemplate{},
		&models.ActivityCodeSequence{},
		&models.FinanceCalendarActivity{},
		&models.ActivityTemplateBackfillLog{},
	)
}
