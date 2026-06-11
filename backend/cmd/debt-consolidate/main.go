// Comando: go run ./cmd/debt-consolidate [--dry-run]
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"time"

	"miappfiber/config"
	"miappfiber/database"
	debtsvc "miappfiber/services/debt"
	"miappfiber/services"
)

func main() {
	dryRun := flag.Bool("dry-run", false, "simular sin escribir en BD")
	outDir := flag.String("out", "scripts/consolidation_output", "directorio para reportes JSON")
	flag.Parse()

	if err := config.Load(); err != nil {
		log.Fatal(err)
	}
	if err := database.Connect(); err != nil {
		log.Fatal(err)
	}
	if err := database.AutoMigrate(); err != nil {
		log.Fatal(err)
	}

	fmt.Println("=== Consolidación DEU-LIQ ===")
	report, err := debtsvc.RunLegacyDEULIQConsolidation(database.DB, *dryRun)
	if err != nil {
		log.Fatal(err)
	}
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	_ = enc.Encode(report)

	var freezeReport *services.ReceiptFreezeReport
	if !*dryRun {
		fmt.Println("\n=== Backfill comprobantes ===")
		freezeReport, err = services.BackfillFragileFiscalReceipts(database.DB)
		if err != nil {
			log.Fatal(err)
		}
		_ = enc.Encode(freezeReport)
	}

	fmt.Println("\n=== Auditoría final ===")
	audit, err := debtsvc.RunIntegrityAudit(database.DB)
	if err != nil {
		log.Fatal(err)
	}
	_ = enc.Encode(audit)

	if !*dryRun && *outDir != "" {
		_ = os.MkdirAll(*outDir, 0o755)
		ts := time.Now().Format("20060102_150405")
		writeJSON(filepath.Join(*outDir, "consolidation_"+ts+".json"), report)
		if freezeReport != nil {
			writeJSON(filepath.Join(*outDir, "receipt_freeze_"+ts+".json"), freezeReport)
		}
		writeJSON(filepath.Join(*outDir, "audit_"+ts+".json"), audit)
		fmt.Printf("\nReportes guardados en %s\n", *outDir)
	}

	if audit.HasIssues {
		os.Exit(1)
	}
}

func writeJSON(path string, v interface{}) {
	f, err := os.Create(path)
	if err != nil {
		log.Printf("no se pudo escribir %s: %v", path, err)
		return
	}
	defer f.Close()
	enc := json.NewEncoder(f)
	enc.SetIndent("", "  ")
	if err := enc.Encode(v); err != nil {
		log.Printf("encode %s: %v", path, err)
	}
}
