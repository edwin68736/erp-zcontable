package services

import (
	"errors"
	"fmt"
	"strings"
	"unicode"

	"miappfiber/models"

	"gorm.io/gorm"
)

// slugRoleCode genera un identificador interno estable a partir del nombre visible.
func slugRoleCode(name string) string {
	s := strings.TrimSpace(name)
	if s == "" {
		return ""
	}
	var b strings.Builder
	prevUnderscore := false
	for _, r := range strings.ToLower(s) {
		switch {
		case r >= 'a' && r <= 'z':
			b.WriteRune(r)
			prevUnderscore = false
		case r >= '0' && r <= '9':
			b.WriteRune(r)
			prevUnderscore = false
		case unicode.IsLetter(r):
			b.WriteRune(r)
			prevUnderscore = false
		default:
			if !prevUnderscore && b.Len() > 0 {
				b.WriteByte('_')
				prevUnderscore = true
			}
		}
	}
	out := strings.Trim(b.String(), "_")
	if len(out) > 40 {
		out = out[:40]
		out = strings.TrimRight(out, "_")
	}
	return out
}

func normalizeRoleCode(code string) string {
	return strings.TrimSpace(strings.ToLower(code))
}

// generateUniqueRoleCode crea un código único en BD (solo uso interno; no es regla de negocio).
func generateUniqueRoleCode(db *gorm.DB, name string) (string, error) {
	base := slugRoleCode(name)
	if base == "" || !roleCodePattern.MatchString(base) {
		base = "rol"
	}
	for i := 0; i < 100; i++ {
		candidate := base
		if i > 0 {
			candidate = fmt.Sprintf("%s_%d", base, i+1)
		}
		if len(candidate) > 63 {
			candidate = candidate[:63]
			candidate = strings.TrimRight(candidate, "_")
		}
		var n int64
		if err := db.Model(&models.Role{}).Where("code = ?", candidate).Count(&n).Error; err != nil {
			return "", err
		}
		if n == 0 {
			return candidate, nil
		}
	}
	return "", errors.New("no se pudo generar un identificador único para el rol; intente otro nombre")
}
