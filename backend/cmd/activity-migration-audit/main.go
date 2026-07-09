// Auditoría de migración catálogo ↔ calendario (Fase 8+).
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"

	"miappfiber/config"
	"miappfiber/database"
)

type migrationAuditReport struct {
	TemplatesCreated          int64                              `json:"templates_created"`
	ActivitiesLinked          int64                              `json:"activities_linked"`
	ActivitiesWithoutTemplate int64                              `json:"activities_without_template"`
	EmptyNameSnapshots        int64                              `json:"empty_name_snapshots"`
	EmptyTypeSnapshots        int64                              `json:"empty_type_snapshots"`
	EmptyPrioritySnapshots    int64                              `json:"empty_priority_snapshots"`
	EmptyColorSnapshots       int64                              `json:"empty_color_snapshots"`
	OrphanTemplateReferences  int64                              `json:"orphan_template_references"`
	TotalActivities           int64                              `json:"total_activities"`
	SchemaMatchesModel        bool                               `json:"schema_matches_model"`
	Schema                    *database.CalendarActivitySchemaAudit `json:"schema"`
	ReadyForPhase9            bool                               `json:"ready_for_phase9"`
	Notes                     []string                           `json:"notes,omitempty"`
}

func main() {
	jsonOut := flag.Bool("json", false, "salida JSON")
	flag.Parse()

	if err := config.Load(); err != nil {
		log.Fatal(err)
	}
	if err := database.Connect(); err != nil {
		log.Fatalf("connect: %v", err)
	}

	db := database.DB
	rep := migrationAuditReport{}

	db.Table("activity_templates").Where("deleted_at IS NULL").Count(&rep.TemplatesCreated)
	db.Table("finance_calendar_activities").Count(&rep.TotalActivities)
	db.Table("finance_calendar_activities").Where("activity_template_id IS NOT NULL").Count(&rep.ActivitiesLinked)
	db.Table("finance_calendar_activities").Where("activity_template_id IS NULL").Count(&rep.ActivitiesWithoutTemplate)

	db.Table("finance_calendar_activities").Where("TRIM(COALESCE(name_snapshot, '')) = ''").Count(&rep.EmptyNameSnapshots)
	db.Table("finance_calendar_activities").Where("TRIM(COALESCE(activity_type_snapshot, '')) = ''").Count(&rep.EmptyTypeSnapshots)
	db.Table("finance_calendar_activities").Where("TRIM(COALESCE(priority_snapshot, '')) = ''").Count(&rep.EmptyPrioritySnapshots)
	db.Table("finance_calendar_activities").Where("TRIM(COALESCE(text_color_snapshot, '')) = ''").Count(&rep.EmptyColorSnapshots)

	db.Raw(`
		SELECT COUNT(*) FROM finance_calendar_activities a
		LEFT JOIN activity_templates t ON t.id = a.activity_template_id AND t.deleted_at IS NULL
		WHERE a.activity_template_id IS NOT NULL AND t.id IS NULL
	`).Scan(&rep.OrphanTemplateReferences)

	schemaAudit, err := database.AuditFinanceCalendarActivitySchema(db)
	if err != nil {
		log.Fatalf("schema audit: %v", err)
	}
	rep.Schema = schemaAudit
	rep.SchemaMatchesModel = schemaAudit.SchemaMatchesModel

	emptySnapshots := rep.EmptyNameSnapshots + rep.EmptyTypeSnapshots + rep.EmptyPrioritySnapshots + rep.EmptyColorSnapshots
	rep.ReadyForPhase9 = rep.ActivitiesWithoutTemplate == 0 &&
		emptySnapshots == 0 &&
		rep.OrphanTemplateReferences == 0 &&
		rep.SchemaMatchesModel

	if rep.ActivitiesWithoutTemplate > 0 {
		rep.Notes = append(rep.Notes, fmt.Sprintf("%d actividades sin activity_template_id", rep.ActivitiesWithoutTemplate))
	}
	if emptySnapshots > 0 {
		rep.Notes = append(rep.Notes, fmt.Sprintf("%d campos snapshot vacíos (name=%d type=%d priority=%d color=%d)",
			emptySnapshots, rep.EmptyNameSnapshots, rep.EmptyTypeSnapshots, rep.EmptyPrioritySnapshots, rep.EmptyColorSnapshots))
	}
	if rep.OrphanTemplateReferences > 0 {
		rep.Notes = append(rep.Notes, fmt.Sprintf("%d FK huérfanas a plantillas inexistentes", rep.OrphanTemplateReferences))
	}
	if !rep.SchemaMatchesModel && schemaAudit != nil {
		for _, issue := range schemaAudit.Issues {
			rep.Notes = append(rep.Notes, issue)
		}
	}
	if rep.ReadyForPhase9 {
		rep.Notes = append(rep.Notes, "Datos y esquema alineados al modelo")
	}

	if *jsonOut {
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		_ = enc.Encode(rep)
		return
	}

	fmt.Println("=== Auditoría migración catálogo / calendario ===")
	fmt.Printf("Plantillas creadas:              %d\n", rep.TemplatesCreated)
	fmt.Printf("Actividades totales:             %d\n", rep.TotalActivities)
	fmt.Printf("Actividades vinculadas (FK):     %d\n", rep.ActivitiesLinked)
	fmt.Printf("Actividades sin plantilla:       %d\n", rep.ActivitiesWithoutTemplate)
	fmt.Printf("Snapshots name vacíos:           %d\n", rep.EmptyNameSnapshots)
	fmt.Printf("Snapshots type vacíos:           %d\n", rep.EmptyTypeSnapshots)
	fmt.Printf("Snapshots priority vacíos:       %d\n", rep.EmptyPrioritySnapshots)
	fmt.Printf("Snapshots color vacíos:          %d\n", rep.EmptyColorSnapshots)
	fmt.Printf("FK huérfanas:                    %d\n", rep.OrphanTemplateReferences)
	fmt.Printf("schema_matches_model:          %v\n", rep.SchemaMatchesModel)
	if rep.Schema != nil {
		for _, c := range rep.Schema.Columns {
			nullLabel := "NOT NULL"
			if c.Nullable {
				nullLabel = "NULL"
			}
			match := "OK"
			if !c.Matches {
				match = "MISMATCH"
			}
			fmt.Printf("  · %-26s BD=%-8s modelo=NOT NULL [%s]\n", c.Column, nullLabel, match)
		}
	}
	fmt.Printf("Listo (datos + esquema):         %v\n", rep.ReadyForPhase9)
	for _, n := range rep.Notes {
		fmt.Printf("  · %s\n", n)
	}
}
