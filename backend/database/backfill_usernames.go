package database

import (
	"fmt"
	"strings"

	"miappfiber/models"
)

// BackfillUsernames asigna username a filas antiguas (p. ej. tras añadir la columna).
func BackfillUsernames() error {
	var users []models.User
	if err := DB.Find(&users).Error; err != nil {
		return err
	}
	for _, u := range users {
		if strings.TrimSpace(u.Username) != "" {
			continue
		}
		base := "usuario"
		if u.Email != nil {
			p := strings.Split(strings.TrimSpace(*u.Email), "@")
			if len(p) > 0 && strings.TrimSpace(p[0]) != "" {
				base = sanitizeUsernamePart(p[0])
			}
		}
		if base == "" {
			base = "usuario"
		}
		cand := base
		if err := assignUniqueUsername(u.ID, &cand); err != nil {
			return err
		}
		if err := DB.Model(&models.User{}).Where("id = ?", u.ID).Update("username", cand).Error; err != nil {
			return err
		}
	}
	return nil
}

func sanitizeUsernamePart(s string) string {
	var b strings.Builder
	for _, r := range strings.TrimSpace(s) {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '.' || r == '_' || r == '-' {
			b.WriteRune(r)
		}
	}
	out := b.String()
	if len(out) < 3 {
		return ""
	}
	if len(out) > 32 {
		out = out[:32]
	}
	return out
}

func assignUniqueUsername(userID uint, base *string) error {
	if *base == "" {
		*base = "usuario"
	}
	orig := *base
	cand := orig
	for i := 0; i < 5000; i++ {
		if i > 0 {
			cand = fmt.Sprintf("%s_%d", orig, i)
		}
		var n int64
		if err := DB.Model(&models.User{}).Where("username = ? AND id <> ?", cand, userID).Count(&n).Error; err != nil {
			return err
		}
		if n == 0 {
			*base = cand
			return nil
		}
	}
	return fmt.Errorf("no se pudo generar username único para usuario %d", userID)
}
