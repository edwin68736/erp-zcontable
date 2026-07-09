// Comando: go run ./cmd/debt-audit
// Lee DB_* desde .env o variables de entorno (mismos defaults que la app).
package main

import (
	"encoding/json"
	"fmt"
	"log"
	"os"

	"miappfiber/config"
	"miappfiber/database"
	"miappfiber/services"
	debtsvc "miappfiber/services/debt"
)

func main() {
	if err := config.Load(); err != nil {
		log.Fatalf("config: %v", err)
	}
	if err := database.Connect(); err != nil {
		log.Fatalf("database: %v", err)
	}

	fmt.Println("Aplicando AutoMigrate y migraciones de deudas (idempotente)...")
	if err := database.AutoMigrate(); err != nil {
		log.Fatalf("automigrate: %v", err)
	}
	if err := services.EnsureDocumentMigrationsOnStartup(); err != nil {
		log.Fatalf("document migrations: %v", err)
	}
	fmt.Println("Migraciones OK. Ejecutando auditoría...\n")

	summary, err := debtsvc.RunIntegrityAudit(database.DB)
	if err != nil {
		log.Fatalf("audit: %v", err)
	}

	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	_ = enc.Encode(summary)

	fmt.Println()
	if summary.HasIssues {
		fmt.Println("RESULTADO: se encontraron inconsistencias (revisar métricas > 0).")
		os.Exit(1)
	}
	fmt.Println("RESULTADO: dominio consistente (sin issues críticos).")
	if summary.DEULIQCount > 0 {
		fmt.Printf("NOTA: %d filas DEU-LIQ-* históricas (promovidas=%d, fusionadas=%d); activos pendientes=%d.\n",
			summary.DEULIQCount, summary.DEULIQPromotedCount, summary.DEULIQMergedCount, summary.LegacyPendingCount)
	}
}
