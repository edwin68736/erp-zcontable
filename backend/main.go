package main

import (
	"log"
	"strings"

	"miappfiber/config"
	"miappfiber/database"
	"miappfiber/routes"

	"github.com/gofiber/fiber/v3"
	"github.com/gofiber/fiber/v3/middleware/cors"
	"github.com/gofiber/fiber/v3/middleware/static"
)

// rootStatusHandler responde en la raíz con un mensaje claro de que el API está operativo.
// Navegadores reciben HTML; clientes con Accept JSON (o sin text/html) reciben JSON.
func rootStatusHandler(c fiber.Ctx) error {
	payload := fiber.Map{
		"ok":       true,
		"servicio": "ZContable API",
		"estado":   "en_linea",
		"mensaje":  "El backend está en ejecución y respondiendo correctamente.",
	}

	accept := c.Get("Accept")
	if strings.Contains(accept, "text/html") {
		html := `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ZContable API</title>
<style>
  body{font-family:system-ui,Segoe UI,sans-serif;max-width:36rem;margin:3rem auto;padding:0 1.25rem;line-height:1.5;color:#1f2937;background:#f9fafb;}
  h1{font-size:1.35rem;font-weight:600;color:#111827;margin:0 0 .5rem;}
  p{margin:0 0 1rem;}
  .ok{display:inline-block;background:#d1fae5;color:#065f46;padding:.35rem .65rem;border-radius:.375rem;font-size:.875rem;font-weight:500;}
  footer{font-size:.8rem;color:#6b7280;margin-top:2rem;}
</style>
</head>
<body>
  <p class="ok">Servicio operativo</p>
  <h1>API ZContable</h1>
  <p>El backend está en ejecución y respondiendo correctamente. Puedes usar los endpoints bajo <code>/api</code> según la documentación del proyecto.</p>
  <footer>Respuesta HTML · Para JSON usa el header <code>Accept: application/json</code></footer>
</body>
</html>`
		return c.Type("html").SendString(html)
	}

	return c.JSON(payload)
}

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

	app.Get("/", rootStatusHandler)

	app.Use("/storage", static.New(config.AppConfig.StoragePath))

	routes.Setup(app)

	addr := ":" + config.AppConfig.ServerPort
	log.Printf("Servidor en http://localhost%s", addr)
	log.Fatal(app.Listen(addr))
}
