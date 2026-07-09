// Auditoría read-only de backfill activity_rule_id (plantillas ↔ calendario).
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"time"

	"miappfiber/config"
	"miappfiber/database"
)

type ruleBackfillRow struct {
	ActivityID           uint   `json:"activity_id"`
	CalendarID           uint   `json:"calendar_id"`
	PeriodYM             string `json:"period_ym"`
	ActivityTypeSnapshot string `json:"activity_type_snapshot"`
	NameSnapshot         string `json:"name_snapshot"`
	TemplateID           *uint  `json:"template_id,omitempty"`
	TemplateName         string `json:"template_name,omitempty"`
	TemplateRuleID       *uint  `json:"template_rule_id,omitempty"`
}

type ruleBackfillReport struct {
	GeneratedAt                    time.Time         `json:"generated_at"`
	TotalCalendarActivities        int64             `json:"total_calendar_activities"`
	ActivitiesWithoutRuleID        int64             `json:"activities_without_rule_id"`
	ActivitiesWithRuleID           int64             `json:"activities_with_rule_id"`
	TemplateHasRuleActivityMissing int64             `json:"template_has_rule_activity_missing_snapshot"`
	OrphanRuleReferences           int64             `json:"orphan_rule_references"`
	MissingSnapshotRows            []ruleBackfillRow `json:"missing_snapshot_rows,omitempty"`
	ActivitiesWithoutRuleSample    []ruleBackfillRow `json:"activities_without_rule_sample,omitempty"`
	Notes                          []string          `json:"notes,omitempty"`
	BackfillHealthy                bool              `json:"backfill_healthy"`
}

func main() {
	jsonOut := flag.Bool("json", false, "salida JSON")
	fix := flag.Bool("fix", false, "copiar activity_rule_id desde plantilla a actividades sin snapshot")
	sampleLimit := flag.Int("sample", 50, "máximo de filas detalladas en el reporte")
	flag.Parse()

	if err := config.Load(); err != nil {
		log.Fatal(err)
	}
	if err := database.Connect(); err != nil {
		log.Fatalf("connect: %v", err)
	}

	db := database.DB
	if *fix {
		if err := database.BackfillCalendarActivityRuleFromTemplate(db); err != nil {
			log.Fatalf("backfill: %v", err)
		}
		if !*jsonOut {
			fmt.Println("Backfill aplicado: activity_rule_id copiado desde plantillas donde faltaba.")
			fmt.Println()
		}
	}

	rep := ruleBackfillReport{GeneratedAt: time.Now()}

	db.Table("finance_calendar_activities").
		Where("deleted_at IS NULL").
		Count(&rep.TotalCalendarActivities)

	db.Table("finance_calendar_activities").
		Where("deleted_at IS NULL AND (activity_rule_id IS NULL OR activity_rule_id = 0)").
		Count(&rep.ActivitiesWithoutRuleID)

	rep.ActivitiesWithRuleID = rep.TotalCalendarActivities - rep.ActivitiesWithoutRuleID

	db.Raw(`
		SELECT COUNT(*) FROM finance_calendar_activities AS a
		INNER JOIN activity_templates AS t ON t.id = a.activity_template_id AND t.deleted_at IS NULL
		WHERE a.deleted_at IS NULL
		  AND (a.activity_rule_id IS NULL OR a.activity_rule_id = 0)
		  AND t.activity_rule_id IS NOT NULL AND t.activity_rule_id > 0
	`).Scan(&rep.TemplateHasRuleActivityMissing)

	db.Raw(`
		SELECT COUNT(*) FROM finance_calendar_activities AS a
		LEFT JOIN activity_rules AS r ON r.id = a.activity_rule_id AND r.deleted_at IS NULL
		WHERE a.deleted_at IS NULL
		  AND a.activity_rule_id IS NOT NULL AND a.activity_rule_id > 0
		  AND r.id IS NULL
	`).Scan(&rep.OrphanRuleReferences)

	limit := *sampleLimit
	if limit < 1 {
		limit = 50
	}

	var missing []ruleBackfillRow
	db.Raw(`
		SELECT
			a.id AS activity_id,
			a.calendar_id,
			c.period_ym,
			a.activity_type_snapshot,
			a.name_snapshot,
			a.activity_template_id AS template_id,
			t.name AS template_name,
			t.activity_rule_id AS template_rule_id
		FROM finance_calendar_activities AS a
		INNER JOIN finance_calendars AS c ON c.id = a.calendar_id AND c.deleted_at IS NULL
		INNER JOIN activity_templates AS t ON t.id = a.activity_template_id AND t.deleted_at IS NULL
		WHERE a.deleted_at IS NULL
		  AND (a.activity_rule_id IS NULL OR a.activity_rule_id = 0)
		  AND t.activity_rule_id IS NOT NULL AND t.activity_rule_id > 0
		ORDER BY c.period_ym DESC, a.id ASC
		LIMIT ?
	`, limit).Scan(&missing)
	rep.MissingSnapshotRows = missing

	var withoutRule []ruleBackfillRow
	db.Raw(`
		SELECT
			a.id AS activity_id,
			a.calendar_id,
			c.period_ym,
			a.activity_type_snapshot,
			a.name_snapshot,
			a.activity_template_id AS template_id,
			t.name AS template_name,
			t.activity_rule_id AS template_rule_id
		FROM finance_calendar_activities AS a
		INNER JOIN finance_calendars AS c ON c.id = a.calendar_id AND c.deleted_at IS NULL
		LEFT JOIN activity_templates AS t ON t.id = a.activity_template_id AND t.deleted_at IS NULL
		WHERE a.deleted_at IS NULL
		  AND (a.activity_rule_id IS NULL OR a.activity_rule_id = 0)
		ORDER BY c.period_ym DESC, a.id ASC
		LIMIT ?
	`, limit).Scan(&withoutRule)
	rep.ActivitiesWithoutRuleSample = withoutRule

	if rep.ActivitiesWithoutRuleID > 0 {
		rep.Notes = append(rep.Notes, fmt.Sprintf("%d actividades de calendario sin activity_rule_id", rep.ActivitiesWithoutRuleID))
	}
	if rep.TemplateHasRuleActivityMissing > 0 {
		rep.Notes = append(rep.Notes, fmt.Sprintf("%d actividades con plantilla con regla pero sin snapshot de regla", rep.TemplateHasRuleActivityMissing))
	}
	if rep.OrphanRuleReferences > 0 {
		rep.Notes = append(rep.Notes, fmt.Sprintf("%d actividades referencian activity_rule_id inexistente o eliminado", rep.OrphanRuleReferences))
	}
	if rep.TemplateHasRuleActivityMissing == 0 && rep.OrphanRuleReferences == 0 {
		if rep.ActivitiesWithoutRuleID == 0 {
			rep.Notes = append(rep.Notes, "Todas las actividades de calendario tienen activity_rule_id asignado")
		} else {
			rep.Notes = append(rep.Notes, "Actividades sin regla no tienen plantilla con regla asignada (puede ser esperado)")
		}
	}

	rep.BackfillHealthy = rep.TemplateHasRuleActivityMissing == 0 && rep.OrphanRuleReferences == 0

	if *jsonOut {
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		_ = enc.Encode(rep)
		return
	}

	fmt.Println("=== Auditoría backfill activity_rule_id ===")
	fmt.Printf("Generado:                                        %s\n", rep.GeneratedAt.Format(time.RFC3339))
	fmt.Printf("Actividades calendario (activas):                %d\n", rep.TotalCalendarActivities)
	fmt.Printf("Con activity_rule_id:                            %d\n", rep.ActivitiesWithRuleID)
	fmt.Printf("Sin activity_rule_id:                            %d\n", rep.ActivitiesWithoutRuleID)
	fmt.Printf("Plantilla con regla, actividad sin snapshot:     %d\n", rep.TemplateHasRuleActivityMissing)
	fmt.Printf("Referencias huérfanas a activity_rules:          %d\n", rep.OrphanRuleReferences)
	fmt.Printf("Backfill saludable:                              %v\n", rep.BackfillHealthy)
	for _, n := range rep.Notes {
		fmt.Printf("  · %s\n", n)
	}

	if len(rep.MissingSnapshotRows) > 0 {
		fmt.Println("\n--- Inconsistencias plantilla→calendario (muestra) ---")
		for _, r := range rep.MissingSnapshotRows {
			tplRule := "NULL"
			if r.TemplateRuleID != nil {
				tplRule = fmt.Sprintf("%d", *r.TemplateRuleID)
			}
			fmt.Printf("  act=%d period=%s type=%s tpl=%q rule_tpl=%s\n",
				r.ActivityID, r.PeriodYM, r.ActivityTypeSnapshot, r.TemplateName, tplRule)
		}
	}

	if len(rep.ActivitiesWithoutRuleSample) > 0 && rep.ActivitiesWithoutRuleID > int64(len(rep.MissingSnapshotRows)) {
		fmt.Println("\n--- Actividades sin regla (muestra adicional) ---")
		shown := make(map[uint]struct{})
		for _, r := range rep.MissingSnapshotRows {
			shown[r.ActivityID] = struct{}{}
		}
		for _, r := range rep.ActivitiesWithoutRuleSample {
			if _, ok := shown[r.ActivityID]; ok {
				continue
			}
			fmt.Printf("  act=%d period=%s type=%s name=%q\n",
				r.ActivityID, r.PeriodYM, r.ActivityTypeSnapshot, r.NameSnapshot)
		}
	}
}
