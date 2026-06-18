// Herramienta CLI: dry-run, similitud y execute del backfill de plantillas.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"

	"miappfiber/config"
	"miappfiber/database"
	"miappfiber/services"
)

func main() {
	execute := flag.Bool("execute", false, "ejecutar backfill (por defecto solo dry-run)")
	rollback := flag.Bool("rollback", false, "revertir backfill registrado en log")
	migrate := flag.Bool("migrate", false, "AutoMigrate esquema requerido antes de reportar/ejecutar")
	flag.Parse()

	if err := config.Load(); err != nil {
		log.Fatal(err)
	}
	if err := database.Connect(); err != nil {
		log.Fatalf("connect: %v", err)
	}

	if *migrate || *execute {
		if err := services.EnsureBackfillSchema(database.DB); err != nil {
			log.Fatalf("migrate: %v", err)
		}
		if err := database.RunActivityTemplateMigrations(database.DB); err != nil {
			log.Fatalf("activity template migrations: %v", err)
		}
	}

	if *rollback {
		if err := services.RollbackBackfill(database.DB); err != nil {
			log.Fatalf("rollback: %v", err)
		}
		fmt.Fprintln(os.Stderr, "rollback OK")
		return
	}

	if *execute {
		rep, err := services.ExecuteBackfill(database.DB)
		emit(rep, err)
		if err != nil {
			os.Exit(1)
		}
		fmt.Fprintln(os.Stderr, "execute OK")
		return
	}

	rep, err := services.DryRunBackfill(database.DB)
	emit(rep, err)
	if err != nil {
		os.Exit(1)
	}
	fmt.Fprintln(os.Stderr, "dry-run OK (sin cambios)")
}

func emit(rep *services.BackfillReport, err error) {
	if err != nil && rep == nil {
		log.Fatal(err)
	}
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	if encErr := enc.Encode(rep); encErr != nil {
		log.Fatal(encErr)
	}
	if err != nil {
		fmt.Fprintf(os.Stderr, "error: %v\n", err)
	}
}
