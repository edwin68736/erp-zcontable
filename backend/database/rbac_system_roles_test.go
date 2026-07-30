package database

import (
	"strings"
	"testing"

	"miappfiber/rbac"
)

// TestRolePermissionCodes_invariants valida propiedades estructurales de la matriz
// canónica (derivada del registro), sin números mágicos que se desincronicen.
func TestRolePermissionCodes_invariants(t *testing.T) {
	all := make(map[string]struct{}, len(rbac.AllPermissionCodes))
	for _, c := range rbac.AllPermissionCodes {
		all[c] = struct{}{}
	}

	for _, roleCode := range rbac.SystemRoleCodes() {
		codes := rbac.RolePermissionCodes(roleCode)
		if len(codes) == 0 {
			t.Fatalf("rol %s: sin permisos canónicos", roleCode)
		}
		seen := make(map[string]struct{}, len(codes))
		for _, c := range codes {
			if _, ok := all[c]; !ok {
				t.Fatalf("rol %s referencia permiso inexistente %q", roleCode, c)
			}
			if _, dup := seen[c]; dup {
				t.Fatalf("rol %s tiene permiso duplicado %q", roleCode, c)
			}
			seen[c] = struct{}{}
		}
	}
}

// TestSuperusuarioHasAllPermissions super_usuario debe tener el catálogo completo.
func TestSuperusuarioHasAllPermissions(t *testing.T) {
	codes := rbac.RolePermissionCodes(rbac.RoleSuperusuario)
	if len(codes) != len(rbac.AllPermissionCodes) {
		t.Fatalf("super_usuario tiene %d permisos, catálogo tiene %d", len(codes), len(rbac.AllPermissionCodes))
	}
}

// TestContadorHasNoSupervisorPermissions el rol Contador no debe tener el módulo supervisores.
func TestContadorHasNoSupervisorPermissions(t *testing.T) {
	for _, c := range rbac.RolePermissionCodes(rbac.RoleContador) {
		if strings.HasPrefix(c, "supervisors.") {
			t.Fatalf("Contador no debería tener %q", c)
		}
	}
}

// TestPrivilegedRolesExcludeStudioAndUsers roles operativos no deben tener alcance global ni gestión de usuarios/roles.
func TestPrivilegedRolesExcludeStudioAndUsers(t *testing.T) {
	for _, roleCode := range []string{rbac.RoleSupervisor, rbac.RoleAdministrador, rbac.RoleGerencia, rbac.RoleContador} {
		for _, forbidden := range []string{rbac.AccessStudio, rbac.UsersView, rbac.RBACRolesManage} {
			for _, c := range rbac.RolePermissionCodes(roleCode) {
				if c == forbidden {
					t.Fatalf("rol %s no debería tener %q", roleCode, forbidden)
				}
			}
		}
	}
}

// TestSunatDueDatesManageIsAdministradorOnly: solo Administrador (y super_usuario) puede editar
// el cronograma de vencimientos SUNAT. Supervisor, Gerencia y Contador NO, aunque compartan
// otros permisos con Administrador — es la primera separación real entre esos roles.
func TestSunatDueDatesManageIsAdministradorOnly(t *testing.T) {
	hasManage := func(roleCode string) bool {
		for _, c := range rbac.RolePermissionCodes(roleCode) {
			if c == rbac.FinanceSunatDueDatesManage {
				return true
			}
		}
		return false
	}
	if !hasManage(rbac.RoleAdministrador) {
		t.Fatal("Administrador debería poder editar el cronograma SUNAT")
	}
	if !hasManage(rbac.RoleSuperusuario) {
		t.Fatal("super_usuario debería poder editar el cronograma SUNAT")
	}
	for _, roleCode := range []string{rbac.RoleSupervisor, rbac.RoleGerencia, rbac.RoleContador, rbac.RoleAsistente, rbac.RoleAnalista} {
		if hasManage(roleCode) {
			t.Fatalf("rol %s NO debería poder editar el cronograma SUNAT", roleCode)
		}
	}
	// Pero la VISTA sí es compartida por todos los roles operativos.
	hasView := func(roleCode string) bool {
		for _, c := range rbac.RolePermissionCodes(roleCode) {
			if c == rbac.FinanceSunatDueDatesView {
				return true
			}
		}
		return false
	}
	for _, roleCode := range []string{
		rbac.RoleAdministrador, rbac.RoleSupervisor, rbac.RoleGerencia,
		rbac.RoleContador, rbac.RoleAsistente, rbac.RoleAnalista,
	} {
		if !hasView(roleCode) {
			t.Fatalf("rol %s debería poder VER el cronograma SUNAT", roleCode)
		}
	}
}

// TestAsistenteHasKeyPermissions el Asistente debe conservar permisos clave de su flujo.
func TestAsistenteHasKeyPermissions(t *testing.T) {
	have := make(map[string]struct{})
	for _, c := range rbac.RolePermissionCodes(rbac.RoleAsistente) {
		have[c] = struct{}{}
	}
	for _, required := range []string{
		rbac.SupervisorsControlsView,
		rbac.SupervisorsNotificationsView,
		rbac.CompanyCredentialsView,
	} {
		if _, ok := have[required]; !ok {
			t.Fatalf("Asistente falta permiso %q", required)
		}
	}
}
