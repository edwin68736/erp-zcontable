package main

import (
	"log"
	"miappfiber/config"
	"miappfiber/database"
	"miappfiber/routes"

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

	if err := database.BackfillUsernames(); err != nil {
		log.Printf("backfill usernames: %v", err)
	}

	if err := database.BackfillPaymentAllocations(); err != nil {
		log.Printf("backfill payment_allocations: %v", err)
	}

	if err := database.Seed(); err != nil {
		log.Printf("seed (puede ignorarse si ya hay datos): %v", err)
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

	addr := ":" + config.AppConfig.ServerPort
	log.Printf("Servidor en http://localhost%s", addr)
	log.Fatal(app.Listen(addr))
}
