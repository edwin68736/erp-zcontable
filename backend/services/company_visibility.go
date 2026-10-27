package services

import (
	"fmt"

	"miappfiber/database"
	"miappfiber/models"

	"gorm.io/gorm"
)

// Qué empresas se ven en las listas — una sola definición para todo el sistema.
//
//   - Eliminada (deleted_at no nulo): fuera de todas las listas. Solo reaparece al crear una empresa con
//     su mismo RUC, donde se ofrece reactivarla.
//   - Inactiva (status = inactivo): solo en Finanzas > Empresas, con la opción "Inactivas".
//   - Suspendida: NO es un estado de la empresa sino una marca del control mensual
//     (supervisor_monthly_controls.suspendida). Una empresa suspendida sigue activa y se muestra en todas
//     las listas con su insignia.
//
// Quien consulte `companies` con Model(&models.Company{}) ya excluye las eliminadas (soft delete de GORM)
// y solo debe sumar el estado. Las consultas con Table("companies ...") o JOIN a mano NO excluyen las
// eliminadas: deben pasar por estos helpers (hay un test que lo vigila, company_visibility_test.go).

// companyVisibleSQL condición SQL de una empresa visible en listas: activa y no eliminada.
// `alias` es el nombre o alias de la tabla en la consulta ("companies", "comp", "co").
func companyVisibleSQL(alias string) string {
	return fmt.Sprintf("%[1]s.status = 'activo' AND %[1]s.deleted_at IS NULL", alias)
}

// companyStudioVisibleSQL igual que companyVisibleSQL y además restringida a clientes del estudio.
func companyStudioVisibleSQL(alias string) string {
	return fmt.Sprintf("%s AND %s.client_type = '%s'", companyVisibleSQL(alias), alias, models.CompanyClientTypeEstudio)
}

// scopeVisibleCompanies deja en la consulta solo las empresas visibles del estudio (activas y no
// eliminadas), sobre la tabla/alias indicado.
func scopeVisibleCompanies(q *gorm.DB, alias string) *gorm.DB {
	return q.Where(companyStudioVisibleSQL(alias))
}

// applyCompanyOwnerFilters filtra una consulta de empresas por el asistente y/o el supervisor asignados a la
// empresa (companies.assistant_user_id / companies.supervisor_user_id). Id 0 = sin filtrar. Lo usan todos los
// listados de actividades (PDT 601/621, Detracciones, Buzón SOL, Preliminar, informes) para que el administrador
// filtre por supervisor y asistente, y el supervisor por asistente; siempre dentro del alcance ya aplicado.
func applyCompanyOwnerFilters(q *gorm.DB, alias string, assistantUserID, supervisorUserID uint) *gorm.DB {
	if assistantUserID > 0 {
		q = q.Where(alias+".assistant_user_id = ?", assistantUserID)
	}
	if supervisorUserID > 0 {
		q = q.Where(alias+".supervisor_user_id = ?", supervisorUserID)
	}
	return q
}

// visibleStudioCompanyIDs subconsulta con los ids de las empresas visibles del estudio, para filtrar
// tablas que solo guardan company_id sin unirse a companies (Model(&Company{}) ya excluye eliminadas).
func visibleStudioCompanyIDs() *gorm.DB {
	return database.DB.Model(&models.Company{}).Select("id").
		Where("status = ? AND client_type = ?", "activo", models.CompanyClientTypeEstudio)
}
