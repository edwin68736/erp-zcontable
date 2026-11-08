package middleware

import (
	"path"
	"strings"

	"github.com/gofiber/fiber/v3"
)

// SecurityHeaders cabeceras de seguridad para toda respuesta de la API: el navegador no adivina tipos de archivo, no
// deja incrustar la API en otra página y no filtra la dirección completa al navegar a otro sitio.
func SecurityHeaders() fiber.Handler {
	return func(c fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Referrer-Policy", "strict-origin-when-cross-origin")
		c.Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
		return c.Next()
	}
}

// StorageHeaders para los archivos subidos (/storage). Imágenes y PDF se sirven normal (el visor de PDF de Chrome no
// funciona dentro de un documento con sandbox), pero lo que un navegador podría EJECUTAR (HTML, SVG, XML, JavaScript)
// se fuerza a descarga y queda aislado, así que un archivo malicioso subido no corre en nuestro dominio. En todos los
// casos el navegador no adivina el tipo de archivo.
func StorageHeaders() fiber.Handler {
	return func(c fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Robots-Tag", "noindex")
		switch strings.ToLower(path.Ext(c.Path())) {
		case ".html", ".htm", ".xhtml", ".svg", ".svgz", ".xml", ".js", ".mjs", ".json":
			c.Set("Content-Security-Policy", "default-src 'none'; sandbox")
			c.Set("Content-Disposition", "attachment")
		}
		return c.Next()
	}
}
