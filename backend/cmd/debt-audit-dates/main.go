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

	type row struct {
		C          int64
		MaxCreated string
	}
	var r row
	db.Raw(`SELECT COUNT(*) c, COALESCE(MAX(created_at),'') mc FROM documents WHERE deleted_at IS NULL AND number LIKE 'DEU-LIQ-%'`).Scan(&r)
	fmt.Println("DEU-LIQ total / max_created:", r.C, r.MaxCreated)

	var r2 row
	db.Raw(`SELECT COUNT(*) c, COALESCE(MAX(created_at),'') mc FROM documents WHERE deleted_at IS NULL AND source='liquidacion' AND number NOT LIKE 'DEU-LIQ-%'`).Scan(&r2)
	fmt.Println("liquidacion nueva (sin DEU-LIQ) / max_created:", r2.C, r2.MaxCreated)

	var n int64
	db.Raw(`SELECT COUNT(*) FROM documents WHERE deleted_at IS NULL AND number LIKE 'DEU-LIQ-%' AND created_at >= '2026-05-30 07:42:00'`).Scan(&n)
	fmt.Println("DEU-LIQ creados despues ultima migracion local (07:42):", n)

	db.Raw(`SELECT COUNT(*) FROM documents WHERE deleted_at IS NULL AND source='liquidacion' AND number NOT LIKE 'DEU-LIQ-%' AND created_at >= '2026-05-30 07:42:00'`).Scan(&n)
	fmt.Println("deudas liquidacion nuevas post-migracion:", n)
}
