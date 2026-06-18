package database

import (
	"testing"

	"miappfiber/rbac"
)

func TestCanonicalPermissionCodesForRole_counts(t *testing.T) {
	expect := map[string]int{
		seedRoleSuperusuario:  len(rbac.AllPermissionCodes),
		seedRoleAdministrador: 101,
		seedRoleGerencia:      101,
		seedRoleSupervisor:    101,
		seedRoleContador:      59,
		seedRoleAsistente:     41,
		seedRoleAnalista:      18,
	}
	for code, want := range expect {
		got, ok := canonicalPermissionCodesForRole(code)
		if !ok {
			t.Fatalf("rol %s: no canónico", code)
		}
		if len(got) != want {
			t.Fatalf("rol %s: len=%d want=%d", code, len(got), want)
		}
	}
}

func TestSystemRolesForCanonicalRepair_excludesEmisor(t *testing.T) {
	for _, code := range systemRolesForCanonicalRepair() {
		if code == seedRoleEmisorComprobantes {
			t.Fatal("EmisorComprobantes no debe estar en reparación canónica")
		}
	}
	if len(systemRolesForCanonicalRepair()) != 7 {
		t.Fatalf("esperados 7 roles, got %d", len(systemRolesForCanonicalRepair()))
	}
}

func TestAsistenteCanonical_hasSupervisorModulePermissions(t *testing.T) {
	codes, ok := canonicalPermissionCodesForRole(seedRoleAsistente)
	if !ok {
		t.Fatal("asistente no canónico")
	}
	have := make(map[string]struct{}, len(codes))
	for _, c := range codes {
		have[c] = struct{}{}
	}
	for _, required := range []string{
		rbac.SupervisorsControlsView,
		rbac.SupervisorsNotificationsView,
		rbac.CompanyCredentialsView,
	} {
		if _, ok := have[required]; !ok {
			t.Fatalf("asistente falta permiso canónico %s", required)
		}
	}
}
