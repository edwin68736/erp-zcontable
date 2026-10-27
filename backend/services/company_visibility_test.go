package services

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"miappfiber/models"
)

// Guardia contra una regresión que ya ocurrió: una consulta que lee `companies` con Table(...) o con JOIN
// a mano NO excluye las empresas eliminadas (el soft delete de GORM solo actúa con Model), y la lista de
// Preliminar de ventas mostró empresas eliminadas. Toda consulta así debe usar los helpers de
// company_visibility.go (o filtrar deleted_at de forma explícita).
func TestRawCompanyQueriesUseVisibilityScope(t *testing.T) {
	files, err := filepath.Glob("*.go")
	if err != nil {
		t.Fatal(err)
	}
	raw := regexp.MustCompile(`(?i)Table\("companies|JOIN companies`)
	ok := regexp.MustCompile(`companyVisibleSQL|companyStudioVisibleSQL|scopeVisibleCompanies|deleted_at`)
	for _, f := range files {
		if strings.HasSuffix(f, "_test.go") || f == "company_visibility.go" {
			continue
		}
		b, err := os.ReadFile(f)
		if err != nil {
			t.Fatal(err)
		}
		lines := strings.Split(string(b), "\n")
		for i, line := range lines {
			if !raw.MatchString(line) {
				continue
			}
			end := i + 12
			if end > len(lines) {
				end = len(lines)
			}
			start := i - 3
			if start < 0 {
				start = 0
			}
			if !ok.MatchString(strings.Join(lines[start:end], "\n")) {
				t.Errorf("%s:%d consulta a companies sin el filtro de empresas visibles (usa companyStudioVisibleSQL/companyVisibleSQL): %s", f, i+1, strings.TrimSpace(line))
			}
		}
	}
}

func TestCompanyVisibleSQL(t *testing.T) {
	if got := companyVisibleSQL("comp"); got != "comp.status = 'activo' AND comp.deleted_at IS NULL" {
		t.Fatalf("companyVisibleSQL = %q", got)
	}
	want := "co.status = 'activo' AND co.deleted_at IS NULL AND co.client_type = '" + models.CompanyClientTypeEstudio + "'"
	if got := companyStudioVisibleSQL("co"); got != want {
		t.Fatalf("companyStudioVisibleSQL = %q", got)
	}
}
