package debt

import (
	"regexp"
	"strings"
)

var (
	legacyDescriptionSuffixRe = regexp.MustCompile(`(?i)\s*\[legacy_(?:promoted|merged|archived)[^\]]*\]`)
	descriptionPartSplitRe    = regexp.MustCompile(`\s*[,;]\s*`)
)

// SanitizeDocumentDescription quita marcas internas de migración legacy y normaliza repeticiones.
func SanitizeDocumentDescription(s string) string {
	s = strings.TrimSpace(legacyDescriptionSuffixRe.ReplaceAllString(s, ""))
	return dedupeDescriptionParts(s)
}

func dedupeDescriptionParts(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return ""
	}
	parts := descriptionPartSplitRe.Split(s, -1)
	if len(parts) <= 1 {
		return s
	}
	seen := make(map[string]struct{}, len(parts))
	unique := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		key := strings.ToLower(p)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		unique = append(unique, p)
	}
	if len(unique) == 0 {
		return ""
	}
	if len(unique) == 1 {
		return unique[0]
	}
	return strings.Join(unique, ", ")
}

// ContainsLegacyDescriptionMark indica si el texto aún tiene marcas de migración legacy.
func ContainsLegacyDescriptionMark(s string) bool {
	return legacyDescriptionSuffixRe.MatchString(s)
}
