package main

import (
	"log"
	"miappfiber/config"
	"miappfiber/database"
	"miappfiber/middleware"
	"miappfiber/routes"
	"miappfiber/services"
	// Zona horaria embebida: America/Lima resuelve igual aunque el servidor no tenga tzdata
	// (sin esto limaLoc cae a UTC en silencio y, p. ej., la recepción PDT 621 quedaría 5 h corrida).
	_ "time/tzdata"

	"github.com/gofiber/fiber/v3"
	"github.com/gofiber/fiber/v3/middleware/cors"
	"github.com/gofiber/fiber/v3/middleware/static"
)

func main() {
	if err := config.Load(); err != nil {
		log.Fatalf("config: %v", err)
	}

	// El secreto con el que se firman los tokens no puede ser el de ejemplo del código: con él cualquiera que conozca
	// el código fabricaría sesiones válidas. Por defecto solo se avisa (para no tumbar un servidor que aún lo usa);
	// con ENFORCE_STRONG_SECRETS=true el servidor se niega a arrancar.
	if config.WeakJWTSecret(config.AppConfig.JWTSecret) {
		log.Print("⚠ SEGURIDAD: JWT_SECRET es el valor de ejemplo o es demasiado corto. Cámbielo por uno propio de 32+ caracteres (openssl rand -base64 48).")
		if config.EnforceStrongSecrets() {
			log.Fatal("ENFORCE_STRONG_SECRETS está activo y JWT_SECRET es débil: el servidor no arranca.")
		}
	}

	if err := database.Connect(); err != nil {
		log.Fatalf("database: %v", err)
	}

	if err := database.PrepareActivityTemplateSchema(database.DB); err != nil {
		log.Fatalf("prepare activity templates: %v", err)
	}

	if err := database.PrepareSupervisorPreliminarVentasSlotSchema(database.DB); err != nil {
		log.Fatalf("prepare preliminar ventas slots: %v", err)
	}

	if err := database.AutoMigrate(); err != nil {
		log.Fatalf("migrate: %v", err)
	}

	if err := database.RunCompanyMigrations(database.DB); err != nil {
		log.Printf("company migrations: %v", err)
	}

	if err := database.RunSupervisorMigrations(database.DB); err != nil {
		log.Printf("supervisor migrations: %v", err)
	}

	if err := database.RunActivityTemplateMigrations(database.DB); err != nil {
		log.Printf("activity template migrations: %v", err)
	}

	if err := database.RunActivityRuleMigrations(database.DB); err != nil {
		log.Printf("activity rule migrations: %v", err)
	}

	if err := services.EnsureDocumentMigrationsOnStartup(); err != nil {
		log.Printf("document migrations: %v", err)
	}

	if err := services.EnsurePaymentMigrationsOnStartup(); err != nil {
		log.Printf("payment migrations: %v", err)
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

	app.Use(middleware.SecurityHeaders())
	app.Use(cors.New(cors.Config{
		// Solo producción, pruebas y desarrollo local (ver config/cors.go; CORS_ALLOWED_ORIGINS agrega más).
		AllowOrigins: config.CORSOrigins(),
		AllowHeaders: []string{"Origin", "Content-Type", "Accept", "Authorization"},
		AllowMethods: []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
	}))

	app.Get("/", func(c fiber.Ctx) error {
		return c.JSON(fiber.Map{
			"ok":      true,
			"message": "Backend OK 👋",
		})
	})

	app.Use("/storage", middleware.StorageHeaders(), static.New(config.AppConfig.StoragePath))

	routes.Setup(app)

	services.StartAuthEventsPurgeLoop()
	services.StartSupervisorAutomationLoop()
	services.StartSunatBuzonNightlySync()

	addr := ":" + config.AppConfig.ServerPort
	log.Printf("Servidor en http://localhost%s", addr)
	log.Fatal(app.Listen(addr))
}
