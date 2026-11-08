package config

import (
	"os"
	"strings"
)

// DefaultJWTSecret el valor de ejemplo que trae el código: quien conozca el código puede fabricar tokens válidos si el
// servidor lo usa, así que en un servidor real DEBE cambiarse.
const DefaultJWTSecret = "your-super-secret-key-change-in-production"

// WeakJWTSecret true si el secreto de los tokens es el de ejemplo o es demasiado corto (menos de 32 caracteres).
func WeakJWTSecret(secret string) bool {
	s := strings.TrimSpace(secret)
	return s == "" || s == DefaultJWTSecret || len(s) < 32
}

// EnforceStrongSecrets con ENFORCE_STRONG_SECRETS=true el servidor se niega a arrancar con un secreto débil.
func EnforceStrongSecrets() bool {
	v := strings.ToLower(strings.TrimSpace(os.Getenv("ENFORCE_STRONG_SECRETS")))
	return v == "1" || v == "true" || v == "si" || v == "sí"
}
