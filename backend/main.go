package main

import (
	"log"
	"miappfiber/config"
	"miappfiber/database"
	"miappfiber/routes"
	"miappfiber/services"

	"github.com/gofiber/fiber/v3"
	"github.com/gofiber/fiber/v3/middleware/cors"
	"github.com/gofiber/fiber/v3/middleware/static"
)

func main() {
	if err := config.Load(); err != nil {
		log.Fatalf("config: %v", err)
	}

	if err := database.Connect(); err != nil {
		log.Fatalf("database: %v", err)
	}

	if err := database.AutoMigrate(); err != nil {
		log.Fatalf("migrate: %v", err)
	}

	if err := database.RunCompanyMigrations(database.DB); err != nil {
		log.Printf("company migrations: %v", err)
	}

	if err := database.BackfillUsernames(); err != nil {
		log.Printf("backfill usernames: %v", err)
	}

	if err := database.BackfillPaymentAllocations(); err != nil {
		log.Printf("backfill payment_allocations: %v", err)
	}

	if err := database.Seed(); err != nil {
		log.Printf("seed (puede ignorarse si ya hay datos): %v", err)
	}

	if err := database.SeedRBAC(database.DB); err != nil {
		log.Printf("ERROR seed rbac: %v", err)
	} else {
		services.Authz().InvalidateAll()
		log.Print("seed rbac: OK (caché de permisos reiniciada)")
	}

	app := fiber.New()

	app.Use(cors.New(cors.Config{
		AllowOrigins: []string{"*"},
		AllowHeaders: []string{"Origin", "Content-Type", "Accept", "Authorization"},
		AllowMethods: []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
	}))

	app.Get("/", func(c fiber.Ctx) error {
		return c.JSON(fiber.Map{
			"ok":      true,
			"message": "Backend OK 👋",
		})
	})

	app.Use("/storage", static.New(config.AppConfig.StoragePath))

	routes.Setup(app)

	services.StartSupervisorAutomationLoop()

	addr := ":" + config.AppConfig.ServerPort
	log.Printf("Servidor en http://localhost%s", addr)
	log.Fatal(app.Listen(addr))
}
