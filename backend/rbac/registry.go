package rbac

// ─────────────────────────────────────────────────────────────────────────────
// FUENTE ÚNICA DE VERDAD del sistema de permisos.
//
// Todo lo demás (semilla de permisos, asociación a módulos, matriz rol→permiso,
// catálogo para la UI y tests) se DERIVA de este archivo. Agregar un permiso =
// una línea en `registryDefs`. Cambiar qué rol lo tiene = editar las listas de
// rol al final. No hay listas paralelas que mantener.
// ─────────────────────────────────────────────────────────────────────────────

// PermDef definición declarativa de un permiso.
//
//	Code   string único "modulo.accion" (identidad global; usado en rutas y frontend).
//	Module módulo OPERATIVO (igual que el sidebar): recursos, finanzas, supervisores, ventas, estudio.
//	Group  función / submenú dentro del módulo (Empresas, Deudas, Pagos, ...); agrupa las acciones.
//	Name   etiqueta legible mostrada al administrador.
//
// La estructura módulo→función→acciones refleja el menú lateral (frontend/src/navigation/sidebarConfig.ts).
// El módulo "Asistente" del sidebar NO tiene permisos propios: reutiliza los de "supervisores".
type PermDef struct {
	Code   string
	Module string
	Group  string
	Name   string
}

// Códigos de módulo operativo (coinciden con el sidebar).
const (
	ModRecursos     = "recursos"
	ModFinanzas     = "finanzas"
	ModSupervisores = "supervisores"
	ModVentas       = "ventas"
	ModEstudio      = "estudio"
)

// registryDefs — catálogo declarativo completo. El ORDEN define el orden en la matriz.
var registryDefs = []PermDef{
	// ───────────── Recursos ─────────────
	{FinanceCalendarView, ModRecursos, "Calendario", "Ver calendario contable global"},
	{FinanceCalendarManage, ModRecursos, "Calendario", "Gestionar calendario contable global"},
	{CompanyCredentialsView, ModRecursos, "Claves de acceso", "Ver claves de acceso por empresa"},
	{CompanyCredentialsManage, ModRecursos, "Claves de acceso", "Editar claves de acceso por empresa"},
	{CompanyCredentialsImport, ModRecursos, "Claves de acceso", "Importar claves de acceso desde Excel"},
	{FinanceSunatDueDatesView, ModRecursos, "Vencimientos SUNAT", "Ver cronograma de vencimientos SUNAT"},
	{FinanceSunatDueDatesManage, ModRecursos, "Vencimientos SUNAT", "Editar cronograma de vencimientos SUNAT"},

	// ───────────── Finanzas del estudio ─────────────
	{DashboardView, ModFinanzas, "Dashboard", "Ver dashboard"},

	{CompaniesView, ModFinanzas, "Empresas", "Ver empresas y detalle"},
	{CompaniesCreate, ModFinanzas, "Empresas", "Crear empresa"},
	{CompaniesUpdate, ModFinanzas, "Empresas", "Editar empresa"},
	{CompaniesStatus, ModFinanzas, "Empresas", "Cambiar estado de empresa"},
	{CompaniesDelete, ModFinanzas, "Empresas", "Eliminar empresa"},
	{CompaniesValidateRUC, ModFinanzas, "Empresas", "Validar RUC SUNAT"},
	{CompaniesValidateDNI, ModFinanzas, "Empresas", "Consultar DNI (RENIEC)"},
	{CompaniesNextCode, ModFinanzas, "Empresas", "Siguiente código interno"},
	{CompaniesImportTemplate, ModFinanzas, "Empresas", "Descargar plantilla importación"},
	{CompaniesImportSpreadsheet, ModFinanzas, "Empresas", "Importar empresas desde Excel"},
	{CompaniesAssignAccountant, ModFinanzas, "Empresas", "Puede asignarse como contador de empresa"},
	{CompaniesAssignSupervisor, ModFinanzas, "Empresas", "Puede asignarse como supervisor de empresa"},
	{CompaniesAssignAssistant, ModFinanzas, "Empresas", "Puede asignarse como asistente de empresa"},
	{CompaniesExternalView, ModFinanzas, "Clientes externos", "Ver clientes externos (POS)"},
	{CompaniesConvertToStudio, ModFinanzas, "Clientes externos", "Convertir cliente externo a cliente del estudio"},

	{ContactsView, ModFinanzas, "Contactos", "Ver contactos"},
	{ContactsCreate, ModFinanzas, "Contactos", "Crear contacto"},
	{ContactsUpdate, ModFinanzas, "Contactos", "Editar contacto"},
	{ContactsDelete, ModFinanzas, "Contactos", "Eliminar contacto"},

	{DocumentsView, ModFinanzas, "Deudas", "Ver deudas / documentos"},
	{DocumentsCreate, ModFinanzas, "Deudas", "Crear documento de deuda"},
	{DocumentsUpdate, ModFinanzas, "Deudas", "Editar documento de deuda"},
	{DocumentsDelete, ModFinanzas, "Deudas", "Eliminar documento de deuda"},

	{TaxSettlementsList, ModFinanzas, "Liquidaciones de impuestos", "Listar liquidaciones de impuestos"},
	{TaxSettlementsView, ModFinanzas, "Liquidaciones de impuestos", "Ver detalle liquidación"},
	{TaxSettlementsPreview, ModFinanzas, "Liquidaciones de impuestos", "Vista previa liquidaciones impuestos"},
	{TaxSettlementsPaymentSuggestions, ModFinanzas, "Liquidaciones de impuestos", "Sugerencias de pago liquidación"},
	{TaxSettlementsCreate, ModFinanzas, "Liquidaciones de impuestos", "Crear liquidación de impuestos"},
	{TaxSettlementsUpdate, ModFinanzas, "Liquidaciones de impuestos", "Editar liquidación de impuestos"},
	{TaxSettlementsEmit, ModFinanzas, "Liquidaciones de impuestos", "Emitir liquidación de impuestos"},
	{TaxSettlementsDelete, ModFinanzas, "Liquidaciones de impuestos", "Eliminar liquidación de impuestos"},
	{LiquidationRun, ModFinanzas, "Liquidaciones de impuestos", "Ejecutar liquidación masiva"},

	{FiscalReceiptsList, ModFinanzas, "Comprobantes", "Listar comprobantes fiscales"},
	{FiscalReceiptsCreatePayment, ModFinanzas, "Comprobantes", "Crear pago desde comprobante"},
	{FiscalReceiptsLinkPayment, ModFinanzas, "Comprobantes", "Vincular pago a comprobante"},
	{FiscalReceiptsPatchTax, ModFinanzas, "Comprobantes", "Asociar liquidación a comprobante"},
	{FiscalReceiptsDiscard, ModFinanzas, "Comprobantes", "Descartar comprobante fiscal"},

	{PaymentsView, ModFinanzas, "Pagos", "Ver pagos"},
	{PaymentsCreate, ModFinanzas, "Pagos", "Registrar pago"},
	{PaymentsUpdate, ModFinanzas, "Pagos", "Editar pago"},
	{PaymentsDelete, ModFinanzas, "Pagos", "Eliminar pago"},
	{PaymentsIssueComprobante, ModFinanzas, "Pagos", "Emitir comprobante desde pago"},
	{PaymentsUploadAttachment, ModFinanzas, "Pagos", "Subir adjunto de pago"},

	{ProductsView, ModFinanzas, "Productos", "Ver productos"},
	{ProductsCreate, ModFinanzas, "Productos", "Crear producto"},
	{ProductsUpdate, ModFinanzas, "Productos", "Editar producto"},
	{ProductsDelete, ModFinanzas, "Productos", "Eliminar producto"},
	{ProductCategoriesView, ModFinanzas, "Productos", "Ver categorías de producto"},
	{ProductCategoriesCreate, ModFinanzas, "Productos", "Crear categoría de producto"},

	{SubscriptionPlansView, ModFinanzas, "Planes", "Ver planes de suscripción"},
	{SubscriptionPlansCreate, ModFinanzas, "Planes", "Crear plan de suscripción"},
	{SubscriptionPlansUpdate, ModFinanzas, "Planes", "Editar plan de suscripción"},
	{SubscriptionPlansTiers, ModFinanzas, "Planes", "Gestionar tramos del plan"},
	{SubscriptionPlansDelete, ModFinanzas, "Planes", "Eliminar plan de suscripción"},
	{PlanCategoriesView, ModFinanzas, "Planes", "Ver categorías de plan"},
	{PlanCategoriesCreate, ModFinanzas, "Planes", "Crear categoría de plan"},
	{PlanCategoriesUpdate, ModFinanzas, "Planes", "Editar categoría de plan"},
	{PlanCategoriesDelete, ModFinanzas, "Planes", "Eliminar categoría de plan"},

	{ReportsFinancialView, ModFinanzas, "Informes", "Reporte financiero resumido"},

	// ───────────── Supervisores (también los usa el rol Asistente) ─────────────
	{SupervisorsDashboardView, ModSupervisores, "General", "Dashboard supervisores"},
	{SupervisorsReportsView, ModSupervisores, "General", "Reportes supervisores"},
	{SupervisorsHistoryView, ModSupervisores, "General", "Ver historial de cambios"},
	{SupervisorsAttachmentsUpload, ModSupervisores, "General", "Subir adjuntos supervisores"},
	{SupervisorsNotificationsView, ModSupervisores, "General", "Ver notificaciones supervisores"},

	{SupervisorsPeriodsView, ModSupervisores, "Períodos", "Ver períodos contables"},
	{SupervisorsPeriodsCreate, ModSupervisores, "Períodos", "Crear período contable"},
	{SupervisorsPeriodsUpdate, ModSupervisores, "Períodos", "Editar período contable"},
	{SupervisorsPeriodsDelete, ModSupervisores, "Períodos", "Eliminar período contable"},
	{SupervisorsPeriodsClose, ModSupervisores, "Períodos", "Cerrar período contable"},
	{SupervisorsPeriodsBootstrap, ModSupervisores, "Períodos", "Generar controles masivos del período"},

	{SupervisorsControlsView, ModSupervisores, "Control de actividades", "Ver control mensual"},
	{SupervisorsControlsCreate, ModSupervisores, "Control de actividades", "Crear control mensual"},
	{SupervisorsControlsUpdate, ModSupervisores, "Control de actividades", "Editar control mensual"},
	{SupervisorsControlsDelete, ModSupervisores, "Control de actividades", "Eliminar control mensual"},

	{SupervisorsDeclarationsView, ModSupervisores, "Declaraciones", "Ver declaraciones"},
	{SupervisorsDeclarationsCreate, ModSupervisores, "Declaraciones", "Crear declaración"},
	{SupervisorsDeclarationsUpdate, ModSupervisores, "Declaraciones", "Editar declaración"},
	{SupervisorsDeclarationsDelete, ModSupervisores, "Declaraciones", "Eliminar declaración"},
	{SupervisorsDeclarationsApprove, ModSupervisores, "Declaraciones", "Aprobar declaración"},
	{SupervisorsDeclarationsObserve, ModSupervisores, "Declaraciones", "Observar declaración"},

	{SupervisorsLiquidationsView, ModSupervisores, "Liquidaciones", "Ver liquidación tributaria"},
	{SupervisorsLiquidationsCreate, ModSupervisores, "Liquidaciones", "Crear liquidación tributaria"},
	{SupervisorsLiquidationsUpdate, ModSupervisores, "Liquidaciones", "Editar liquidación tributaria"},
	{SupervisorsLiquidationsDelete, ModSupervisores, "Liquidaciones", "Eliminar liquidación tributaria"},
	{SupervisorsLiquidationsApprove, ModSupervisores, "Liquidaciones", "Aprobar liquidación tributaria"},

	{SupervisorsNPSView, ModSupervisores, "NPS", "Ver NPS"},
	{SupervisorsNPSCreate, ModSupervisores, "NPS", "Crear NPS"},
	{SupervisorsNPSUpdate, ModSupervisores, "NPS", "Editar NPS"},
	{SupervisorsNPSDelete, ModSupervisores, "NPS", "Eliminar NPS"},
	{SupervisorsNPSGenerate, ModSupervisores, "NPS", "Generar código NPS"},
	{SupervisorsNPSRegisterPayment, ModSupervisores, "NPS", "Registrar pago NPS"},

	{SupervisorsObservationsView, ModSupervisores, "Observaciones", "Ver observaciones"},
	{SupervisorsObservationsCreate, ModSupervisores, "Observaciones", "Registrar observaciones"},

	// ───────────── Ventas (POS) ─────────────
	{SalesEmit, ModVentas, "Punto de venta", "Emitir comprobante (venta rápida)"},
	{SalesHistory, ModVentas, "Punto de venta", "Historial de ventas emitidas"},
	{SalesCatalogPick, ModVentas, "Punto de venta", "Buscar productos en venta"},
	{SalesCompaniesPick, ModVentas, "Punto de venta", "Seleccionar cliente en venta"},
	{SalesLinePriceEdit, ModVentas, "Punto de venta", "Modificar precio al vender"},

	// ───────────── Estudio ─────────────
	{SettingsFirmView, ModEstudio, "Configuración", "Ver configuración fiscal completa"},
	{SettingsFirmBrandingView, ModEstudio, "Configuración", "Ver branding / datos públicos"},
	{SettingsFirmUpdate, ModEstudio, "Configuración", "Actualizar configuración del estudio"},
	{SettingsFirmUploadLogo, ModEstudio, "Configuración", "Subir logo del estudio"},
	{SettingsFirmUploadBankLogo, ModEstudio, "Configuración", "Subir logo banco en estado de cuenta"},
	{SettingsFirmUploadPaymentQR, ModEstudio, "Configuración", "Subir QR de pagos en estado de cuenta"},

	{UsersView, ModEstudio, "Usuarios", "Ver usuarios"},
	{UsersCreate, ModEstudio, "Usuarios", "Crear usuario"},
	{UsersUpdate, ModEstudio, "Usuarios", "Editar usuario"},
	{UsersDelete, ModEstudio, "Usuarios", "Eliminar usuario"},

	{RBACRolesView, ModEstudio, "Roles y permisos", "Ver roles y matriz de permisos"},
	{RBACRolesManage, ModEstudio, "Roles y permisos", "Administrar roles y permisos"},
	{RBACPermissionsCatalog, ModEstudio, "Roles y permisos", "Ver catálogo de permisos"},

	{FiscalSeriesView, ModEstudio, "Series y correlativos", "Ver series y correlativos"},
	{FiscalSeriesManage, ModEstudio, "Series y correlativos", "Gestionar series y correlativos"},

	{AccessStudio, ModEstudio, "Alcance del estudio", "Ver TODAS las empresas del estudio (ignora el filtro por asignación)"},
}

// ─────────────────────────── Roles del sistema ────────────────────────────

// Códigos de rol de sistema (fuente única; antes duplicados en database/rbac_seed.go).
const (
	RoleSuperusuario       = "super_usuario"
	RoleAdministrador      = "Administrador"
	RoleSupervisor         = "Supervisor"
	RoleContador           = "Contador"
	RoleAsistente          = "Asistente"
	RoleAnalista           = "Analista"
	RoleGerencia           = "Gerencia"
	RoleEmisorComprobantes = "EmisorComprobantes"
)

// SystemRoleCodes todos los roles de sistema (para semilla y reconciliación).
func SystemRoleCodes() []string {
	return []string{
		RoleSuperusuario, RoleAdministrador, RoleSupervisor, RoleContador,
		RoleAsistente, RoleAnalista, RoleGerencia, RoleEmisorComprobantes,
	}
}

// DefaultRoleCode rol asignado a usuarios sin roles.
const DefaultRoleCode = RoleAsistente

// supervisorDeny lo que NO tienen Supervisor / Administrador / Gerencia (tienen el resto).
// Nota: FinanceSunatDueDatesManage NO está aquí a propósito — Administrador lo tiene
// (ver administradorCodes) pero Supervisor y Gerencia no (ver gerenciaSupervisorCodes):
// es el primer permiso del sistema con separación real entre estos tres roles.
var supervisorDeny = []string{
	AccessStudio,
	UsersView, UsersCreate, UsersUpdate, UsersDelete,
	RBACRolesView, RBACRolesManage, RBACPermissionsCatalog,
	SettingsFirmView, SettingsFirmUpdate, SettingsFirmUploadLogo, SettingsFirmUploadBankLogo, SettingsFirmUploadPaymentQR,
	CompaniesDelete, SubscriptionPlansDelete, PlanCategoriesDelete, PaymentsDelete,
	FinanceCalendarManage, CompanyCredentialsManage, CompanyCredentialsImport,
}

// contadorDeny lo que NO tiene Contador (además de todo el módulo supervisores, ver contadorCodes).
var contadorDeny = []string{
	AccessStudio,
	UsersView, UsersCreate, UsersUpdate, UsersDelete,
	RBACRolesView, RBACRolesManage, RBACPermissionsCatalog,
	SettingsFirmView, SettingsFirmUpdate, SettingsFirmUploadLogo, SettingsFirmUploadBankLogo, SettingsFirmUploadPaymentQR,
	CompaniesValidateRUC, CompaniesNextCode, CompaniesImportTemplate, CompaniesImportSpreadsheet,
	CompaniesCreate, CompaniesUpdate, CompaniesStatus, CompaniesDelete,
	SubscriptionPlansCreate, SubscriptionPlansUpdate, SubscriptionPlansTiers, SubscriptionPlansDelete,
	PlanCategoriesDelete, PaymentsDelete, ProductsDelete,
	FinanceSunatDueDatesManage,
}

// asistenteCodes lista cerrada del rol Asistente.
var asistenteCodes = []string{
	DashboardView,
	CompaniesView, CompaniesAssignAssistant,
	ContactsView, ContactsCreate, ContactsUpdate, ContactsDelete,
	DocumentsView,
	PaymentsView, PaymentsCreate, PaymentsIssueComprobante, PaymentsUploadAttachment,
	ProductsView, ProductCategoriesView, PlanCategoriesView, SubscriptionPlansView,
	FiscalSeriesView, FiscalReceiptsList, FiscalReceiptsCreatePayment, FiscalReceiptsLinkPayment,
	FiscalReceiptsPatchTax, FiscalReceiptsDiscard,
	TaxSettlementsPreview, TaxSettlementsList, TaxSettlementsView, TaxSettlementsPaymentSuggestions,
	FinanceCalendarView, CompanyCredentialsView, FinanceSunatDueDatesView,
	SupervisorsDashboardView, SupervisorsPeriodsView,
	SupervisorsControlsView, SupervisorsControlsUpdate,
	SupervisorsDeclarationsView, SupervisorsDeclarationsUpdate,
	SupervisorsLiquidationsView, SupervisorsLiquidationsUpdate,
	SupervisorsNPSView, SupervisorsNPSUpdate,
	SupervisorsObservationsView, SupervisorsObservationsCreate,
	SupervisorsHistoryView, SupervisorsAttachmentsUpload, SupervisorsNotificationsView,
}

// analistaCodes lista cerrada del rol Analista (avance de trabajo; sin asignar).
var analistaCodes = []string{
	SupervisorsDashboardView, SupervisorsPeriodsView,
	SupervisorsControlsView, SupervisorsControlsUpdate,
	SupervisorsDeclarationsView, SupervisorsDeclarationsUpdate,
	SupervisorsLiquidationsView, SupervisorsLiquidationsCreate, SupervisorsLiquidationsUpdate,
	SupervisorsNPSView, SupervisorsNPSUpdate,
	SupervisorsReportsView,
	SupervisorsObservationsView, SupervisorsObservationsCreate,
	SupervisorsHistoryView, SupervisorsAttachmentsUpload, SupervisorsNotificationsView,
	FinanceCalendarView, CompanyCredentialsView, FinanceSunatDueDatesView,
	FiscalSeriesView, FiscalReceiptsList, FiscalReceiptsLinkPayment,
	FiscalReceiptsPatchTax, FiscalReceiptsDiscard, PaymentsIssueComprobante,
}

// emisorCodes lista cerrada del rol Emisor de Comprobantes (POS).
var emisorCodes = []string{
	SalesEmit, SalesHistory, SalesCatalogPick, SalesCompaniesPick, SalesLinePriceEdit,
	SettingsFirmBrandingView,
}

// ─────────────────────────── Derivados (init) ────────────────────────────

var (
	// AllPermissionCodes lista completa (derivada del registro). Se conserva como var
	// para compatibilidad con quien la consume; ya no se mantiene a mano.
	AllPermissionCodes []string
	permByCode         map[string]PermDef
)

func init() {
	permByCode = make(map[string]PermDef, len(registryDefs))
	AllPermissionCodes = make([]string, 0, len(registryDefs))
	for _, d := range registryDefs {
		if _, dup := permByCode[d.Code]; dup {
			panic("rbac: permiso duplicado en el registro: " + d.Code)
		}
		permByCode[d.Code] = d
		AllPermissionCodes = append(AllPermissionCodes, d.Code)
	}
	// Validación de arranque: toda lista de rol debe referenciar permisos existentes.
	for _, rc := range SystemRoleCodes() {
		for _, code := range RolePermissionCodes(rc) {
			if _, ok := permByCode[code]; !ok {
				panic("rbac: rol " + rc + " referencia permiso inexistente: " + code)
			}
		}
	}
}

// PermDefs devuelve el catálogo declarativo (para la semilla).
func PermDefs() []PermDef { return registryDefs }

// LookupPerm devuelve la definición de un código.
func LookupPerm(code string) (PermDef, bool) {
	d, ok := permByCode[code]
	return d, ok
}

func codesExcept(deny []string) []string {
	skip := make(map[string]struct{}, len(deny))
	for _, c := range deny {
		skip[c] = struct{}{}
	}
	out := make([]string, 0, len(AllPermissionCodes))
	for _, c := range AllPermissionCodes {
		if _, ok := skip[c]; !ok {
			out = append(out, c)
		}
	}
	return out
}

func contadorCodes() []string {
	deny := append([]string(nil), contadorDeny...)
	for _, d := range registryDefs {
		if d.Module == ModSupervisores {
			deny = append(deny, d.Code)
		}
	}
	return codesExcept(deny)
}

// administradorCodes: todo lo del grupo "administración de área" (supervisorDeny) MÁS los
// permisos exclusivos de Administrador (hoy: gestionar el cronograma de vencimientos SUNAT).
func administradorCodes() []string {
	return codesExcept(supervisorDeny)
}

// gerenciaSupervisorCodes: mismo alcance que Administrador, salvo los permisos que son
// exclusivos de Administrador. Función compartida por Gerencia y Supervisor — hoy tienen
// exactamente el mismo conjunto entre sí, pero cada uno se resuelve por su propia función
// para poder diferenciarlos sin tocar Administrador si en el futuro hace falta.
func gerenciaSupervisorCodes() []string {
	deny := append([]string(nil), supervisorDeny...)
	deny = append(deny, FinanceSunatDueDatesManage)
	return codesExcept(deny)
}

// RolePermissionCodes conjunto canónico de permisos de un rol de sistema.
// FUENTE ÚNICA: semilla, reconciliación y tests derivan de aquí.
func RolePermissionCodes(roleCode string) []string {
	switch roleCode {
	case RoleSuperusuario:
		return append([]string(nil), AllPermissionCodes...)
	case RoleAdministrador:
		return administradorCodes()
	case RoleGerencia, RoleSupervisor:
		return gerenciaSupervisorCodes()
	case RoleContador:
		return contadorCodes()
	case RoleAsistente:
		return append([]string(nil), asistenteCodes...)
	case RoleAnalista:
		return append([]string(nil), analistaCodes...)
	case RoleEmisorComprobantes:
		return append([]string(nil), emisorCodes...)
	default:
		return nil
	}
}
