package config

import (
	"os"
	"strings"
)

// defaultCORSOrigins los únicos sitios web que pueden llamar a la API desde un navegador: producción, pruebas y el
// desarrollo local. Cualquier otro origen queda bloqueado por el navegador.
var defaultCORSOrigins = []string{
	"https://zcontables.net",
	"https://www.zcontables.net",
	"https://zcontables.gestionweb.cloud",
	"http://localhost:5173", "http://localhost:5174", "http://localhost:5175", "http://localhost:4173", "http://localhost:3000",
	"http://127.0.0.1:5173", "http://127.0.0.1:5174", "http://127.0.0.1:5175", "http://127.0.0.1:4173", "http://127.0.0.1:3000",
}

// CORSOrigins orígenes permitidos: los de siempre más los que se agreguen en CORS_ALLOWED_ORIGINS (separados por
// coma). Con el valor «*» se vuelve a permitir cualquiera (solo para emergencias o desarrollo).
func CORSOrigins() []string {
	return corsOriginsFrom(os.Getenv("CORS_ALLOWED_ORIGINS"))
}

func corsOriginsFrom(extra string) []string {
	out := append([]string(nil), defaultCORSOrigins...)
	for _, o := range strings.Split(extra, ",") {
		o = strings.TrimRight(strings.TrimSpace(o), "/")
		if o == "" {
			continue
		}
		if o == "*" {
			return []string{"*"}
		}
		out = append(out, o)
	}
	return out
}
