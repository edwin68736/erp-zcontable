package database

import (
	"errors"
	"fmt"
	"strings"

	"miappfiber/models"
	"miappfiber/rbac"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// Códigos de rol usados solo en semilla / migración de datos (no en reglas de negocio en servicios).
const (
	seedRoleSuperusuario  = "super_usuario"
	seedRoleAdministrador = "Administrador"
	seedRoleSupervisor    = "Supervisor"
	seedRoleContador      = "Contador"
	seedRoleAsistente     = "Asistente"
	seedRoleAnalista      = "Analista"
	seedRoleGerencia          = "Gerencia"
	seedRoleEmisorComprobantes = "EmisorComprobantes"
)

// SeedRBAC crea módulos, permisos, roles del sistema, matriz role↔permiso y asigna roles por defecto a usuarios sin user_roles.
func SeedRBAC(db *gorm.DB) error {
	if err := seedRBACModules(db); err != nil {
		return err
	}
	if err := seedRBACPermissions(db); err != nil {
		return err
	}
	if err := seedRBACSystemRoles(db); err != nil {
		return err
	}
	var rpCount int64
	if err := db.Model(&models.RolePermission{}).Count(&rpCount).Error; err != nil {
		return err
	}
	if rpCount == 0 {
		if err := seedRBACRolePermissions(db); err != nil {
			return err
		}
	}
	if err := RunRBACMigrations(db); err != nil {
		return err
	}
	if err := ensureFinanceCalendarRolePermissions(db); err != nil {
		return err
	}
	if err := ensureFiscalComprobanteRolePermissions(db); err != nil {
		return err
	}
	if err := ensureEmisorComprobantesRolePermissions(db); err != nil {
		return err
	}
	if err := ensureRBACUserRoleAssignments(db); err != nil {
		return err
	}
	return ensureAdminSuperusuarioUser(db)
}

func seedRBACModules(db *gorm.DB) error {
	rows := []models.Module{
		{Code: "dashboard", Name: "Dashboard", Icon: "fas fa-th-large", SortOrder: 0, Active: true},
		{Code: "access", Name: "Alcance del estudio", Icon: "fas fa-globe", SortOrder: 5, Active: true},
		{Code: "settings", Name: "Configuración del estudio", Icon: "fas fa-gear", SortOrder: 10, Active: true},
		{Code: "companies", Name: "Empresas", Icon: "fas fa-building", SortOrder: 20, Active: true},
		{Code: "contacts", Name: "Contactos", Icon: "fas fa-address-book", SortOrder: 30, Active: true},
		{Code: "documents", Name: "Deudas / documentos", Icon: "fas fa-file-invoice-dollar", SortOrder: 40, Active: true},
		{Code: "payments", Name: "Pagos", Icon: "fas fa-wallet", SortOrder: 50, Active: true},
		{Code: "users", Name: "Usuarios", Icon: "fas fa-users-cog", SortOrder: 60, Active: true},
		{Code: "reports", Name: "Reportes", Icon: "fas fa-chart-line", SortOrder: 70, Active: true},
		{Code: "fiscal", Name: "Comprobantes fiscales", Icon: "fas fa-file-invoice", SortOrder: 80, Active: true},
		{Code: "products", Name: "Productos", Icon: "fas fa-box-open", SortOrder: 90, Active: true},
		{Code: "product_categories", Name: "Categorías de producto", Icon: "fas fa-tags", SortOrder: 100, Active: true},
		{Code: "plan_categories", Name: "Categorías de plan", Icon: "fas fa-folder", SortOrder: 110, Active: true},
		{Code: "subscription_plans", Name: "Planes de suscripción", Icon: "fas fa-layer-group", SortOrder: 120, Active: true},
		{Code: "liquidation", Name: "Liquidación masiva", Icon: "fas fa-calculator", SortOrder: 130, Active: true},
		{Code: "tax_settlements", Name: "Liquidaciones de impuestos", Icon: "fas fa-file-signature", SortOrder: 140, Active: true},
		{Code: "rbac", Name: "Roles y permisos", Icon: "fas fa-user-shield", SortOrder: 150, Active: true},
		{Code: "supervisors", Name: "Supervisores contables", Icon: "fas fa-user-check", SortOrder: 155, Active: true},
		{Code: "finance", Name: "Calendario y finanzas operativas", Icon: "fas fa-calendar-days", SortOrder: 45, Active: true},
		{Code: "sales", Name: "Ventas / POS", Icon: "fas fa-cash-register", SortOrder: 25, Active: true},
	}
	for i := range rows {
		r := rows[i]
		if err := db.Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "code"}},
			DoUpdates: clause.AssignmentColumns([]string{"name", "icon", "sort_order", "active", "updated_at"}),
		}).Create(&r).Error; err != nil {
			return fmt.Errorf("module %s: %w", r.Code, err)
		}
	}
	return nil
}

func moduleIDByCode(db *gorm.DB, code string) (uint, error) {
	var m models.Module
	if err := db.Where("code = ?", code).First(&m).Error; err != nil {
		return 0, err
	}
	return m.ID, nil
}

func seedRBACPermissions(db *gorm.DB) error {
	meta := map[string]struct{ Mod, Name string }{
		rbac.AccessStudio: {Mod: "access", Name: "Vista global del estudio (todas las empresas)"},

		rbac.DashboardView: {Mod: "dashboard", Name: "Ver dashboard"},

		rbac.SettingsFirmView:            {Mod: "settings", Name: "Ver configuración fiscal completa"},
		rbac.SettingsFirmBrandingView:   {Mod: "settings", Name: "Ver branding / datos públicos"},
		rbac.SettingsFirmUpdate:         {Mod: "settings", Name: "Actualizar configuración del estudio"},
		rbac.SettingsFirmUploadLogo:     {Mod: "settings", Name: "Subir logo del estudio"},
		rbac.SettingsFirmUploadBankLogo: {Mod: "settings", Name: "Subir logo banco en estado de cuenta"},
		rbac.SettingsFirmUploadPaymentQR: {Mod: "settings", Name: "Subir QR de pagos en estado de cuenta"},

		rbac.CompaniesValidateRUC:          {Mod: "companies", Name: "Validar RUC SUNAT"},
		rbac.CompaniesNextCode:           {Mod: "companies", Name: "Siguiente código interno"},
		rbac.CompaniesImportTemplate:     {Mod: "companies", Name: "Descargar plantilla importación"},
		rbac.CompaniesImportSpreadsheet:  {Mod: "companies", Name: "Importar empresas desde Excel"},
		rbac.CompaniesCreate:             {Mod: "companies", Name: "Crear empresa"},
		rbac.CompaniesUpdate:             {Mod: "companies", Name: "Editar empresa"},
		rbac.CompaniesStatus:             {Mod: "companies", Name: "Cambiar estado de empresa"},
		rbac.CompaniesDelete:             {Mod: "companies", Name: "Eliminar empresa"},
		rbac.CompaniesView:               {Mod: "companies", Name: "Ver empresas y detalle"},
		rbac.CompaniesAssignAccountant:   {Mod: "companies", Name: "Puede asignarse como contador de empresa"},
		rbac.CompaniesAssignSupervisor:   {Mod: "companies", Name: "Puede asignarse como supervisor de empresa"},
		rbac.CompaniesAssignAssistant:    {Mod: "companies", Name: "Puede asignarse como asistente de empresa"},
		rbac.CompaniesExternalView:       {Mod: "companies", Name: "Ver clientes externos (POS)"},
		rbac.CompaniesConvertToStudio:    {Mod: "companies", Name: "Convertir cliente externo a cliente del estudio"},
		rbac.CompaniesValidateDNI:        {Mod: "companies", Name: "Consultar DNI (RENIEC)"},

		rbac.ContactsView:   {Mod: "contacts", Name: "Ver contactos"},
		rbac.ContactsCreate: {Mod: "contacts", Name: "Crear contacto"},
		rbac.ContactsUpdate: {Mod: "contacts", Name: "Editar contacto"},
		rbac.ContactsDelete: {Mod: "contacts", Name: "Eliminar contacto"},

		rbac.DocumentsView:        {Mod: "documents", Name: "Ver deudas / documentos"},
		rbac.DocumentsCreate:      {Mod: "documents", Name: "Crear documento de deuda"},
		rbac.DocumentsUpdate:      {Mod: "documents", Name: "Editar documento de deuda"},
		rbac.DocumentsDelete:      {Mod: "documents", Name: "Eliminar documento de deuda"},
		rbac.PaymentsView:             {Mod: "payments", Name: "Ver pagos"},
		rbac.PaymentsCreate:           {Mod: "payments", Name: "Registrar pago"},
		rbac.PaymentsUpdate:           {Mod: "payments", Name: "Editar pago"},
		rbac.PaymentsDelete:           {Mod: "payments", Name: "Eliminar pago"},
		rbac.PaymentsIssueTukifac:     {Mod: "payments", Name: "Emitir comprobante (legacy)"},
		rbac.PaymentsIssueComprobante: {Mod: "payments", Name: "Emitir comprobante desde pago"},
		rbac.PaymentsUploadAttachment: {Mod: "payments", Name: "Subir adjunto de pago"},

		rbac.UsersView:   {Mod: "users", Name: "Ver usuarios"},
		rbac.UsersCreate: {Mod: "users", Name: "Crear usuario"},
		rbac.UsersUpdate: {Mod: "users", Name: "Editar usuario"},
		rbac.UsersDelete: {Mod: "users", Name: "Eliminar usuario"},

		rbac.ReportsFinancialView: {Mod: "reports", Name: "Reporte financiero resumido"},

		rbac.FiscalSeriesView:            {Mod: "fiscal", Name: "Ver series y correlativos"},
		rbac.FiscalSeriesManage:          {Mod: "fiscal", Name: "Gestionar series y correlativos"},
		rbac.FiscalReceiptsList:          {Mod: "fiscal", Name: "Listar comprobantes fiscales"},
		rbac.FiscalReceiptsCreatePayment: {Mod: "fiscal", Name: "Crear pago desde comprobante"},
		rbac.FiscalReceiptsLinkPayment:   {Mod: "fiscal", Name: "Vincular pago a comprobante"},
		rbac.FiscalReceiptsPatchTax:      {Mod: "fiscal", Name: "Asociar liquidación a comprobante"},
		rbac.FiscalReceiptsDiscard:       {Mod: "fiscal", Name: "Descartar comprobante fiscal"},

		rbac.ProductsView:        {Mod: "products", Name: "Ver productos"},
		rbac.ProductsCreate:      {Mod: "products", Name: "Crear producto"},
		rbac.ProductsUpdate:      {Mod: "products", Name: "Editar producto"},
		rbac.ProductsDelete:      {Mod: "products", Name: "Eliminar producto"},
		rbac.ProductCategoriesView:   {Mod: "product_categories", Name: "Ver categorías de producto"},
		rbac.ProductCategoriesCreate: {Mod: "product_categories", Name: "Crear categoría de producto"},

		rbac.PlanCategoriesView:   {Mod: "plan_categories", Name: "Ver categorías de plan"},
		rbac.PlanCategoriesCreate: {Mod: "plan_categories", Name: "Crear categoría de plan"},
		rbac.PlanCategoriesUpdate: {Mod: "plan_categories", Name: "Editar categoría de plan"},
		rbac.PlanCategoriesDelete: {Mod: "plan_categories", Name: "Eliminar categoría de plan"},

		rbac.SubscriptionPlansView:   {Mod: "subscription_plans", Name: "Ver planes de suscripción"},
		rbac.SubscriptionPlansCreate: {Mod: "subscription_plans", Name: "Crear plan de suscripción"},
		rbac.SubscriptionPlansUpdate: {Mod: "subscription_plans", Name: "Editar plan de suscripción"},
		rbac.SubscriptionPlansTiers: {Mod: "subscription_plans", Name: "Gestionar tramos del plan"},
		rbac.SubscriptionPlansDelete: {Mod: "subscription_plans", Name: "Eliminar plan de suscripción"},

		rbac.LiquidationRun: {Mod: "liquidation", Name: "Ejecutar liquidación masiva"},

		rbac.TaxSettlementsPreview:            {Mod: "tax_settlements", Name: "Vista previa liquidaciones impuestos"},
		rbac.TaxSettlementsList:               {Mod: "tax_settlements", Name: "Listar liquidaciones de impuestos"},
		rbac.TaxSettlementsView:               {Mod: "tax_settlements", Name: "Ver detalle liquidación"},
		rbac.TaxSettlementsPaymentSuggestions: {Mod: "tax_settlements", Name: "Sugerencias de pago liquidación"},
		rbac.TaxSettlementsCreate:             {Mod: "tax_settlements", Name: "Crear liquidación de impuestos"},
		rbac.TaxSettlementsUpdate:             {Mod: "tax_settlements", Name: "Editar liquidación de impuestos"},
		rbac.TaxSettlementsEmit:               {Mod: "tax_settlements", Name: "Emitir liquidación de impuestos"},
		rbac.TaxSettlementsDelete:             {Mod: "tax_settlements", Name: "Eliminar liquidación de impuestos"},

		rbac.RBACRolesView:          {Mod: "rbac", Name: "Ver roles y matriz de permisos"},
		rbac.RBACRolesManage:        {Mod: "rbac", Name: "Administrar roles y permisos"},
		rbac.RBACPermissionsCatalog: {Mod: "rbac", Name: "Ver catálogo de permisos"},

		rbac.SupervisorsDashboardView: {Mod: "supervisors", Name: "Dashboard supervisores"},

		rbac.SupervisorsPeriodsView:   {Mod: "supervisors", Name: "Ver períodos contables"},
		rbac.SupervisorsPeriodsCreate: {Mod: "supervisors", Name: "Crear período contable"},
		rbac.SupervisorsPeriodsUpdate: {Mod: "supervisors", Name: "Editar período contable"},
		rbac.SupervisorsPeriodsDelete: {Mod: "supervisors", Name: "Eliminar período contable"},
		rbac.SupervisorsPeriodsClose:     {Mod: "supervisors", Name: "Cerrar período contable"},
		rbac.SupervisorsPeriodsBootstrap: {Mod: "supervisors", Name: "Generar controles masivos del período"},

		rbac.SupervisorsControlsView:   {Mod: "supervisors", Name: "Ver control mensual"},
		rbac.SupervisorsControlsCreate: {Mod: "supervisors", Name: "Crear control mensual"},
		rbac.SupervisorsControlsUpdate: {Mod: "supervisors", Name: "Editar control mensual"},
		rbac.SupervisorsControlsDelete: {Mod: "supervisors", Name: "Eliminar control mensual"},

		rbac.SupervisorsDeclarationsView:  {Mod: "supervisors", Name: "Ver declaraciones"},
		rbac.SupervisorsDeclarationsCreate:  {Mod: "supervisors", Name: "Crear declaración"},
		rbac.SupervisorsDeclarationsUpdate:  {Mod: "supervisors", Name: "Editar declaración"},
		rbac.SupervisorsDeclarationsDelete:  {Mod: "supervisors", Name: "Eliminar declaración"},
		rbac.SupervisorsDeclarationsApprove: {Mod: "supervisors", Name: "Aprobar declaración"},
		rbac.SupervisorsDeclarationsObserve: {Mod: "supervisors", Name: "Observar declaración"},

		rbac.SupervisorsLiquidationsView:    {Mod: "supervisors", Name: "Ver liquidación tributaria"},
		rbac.SupervisorsLiquidationsCreate:  {Mod: "supervisors", Name: "Crear liquidación tributaria"},
		rbac.SupervisorsLiquidationsUpdate:  {Mod: "supervisors", Name: "Editar liquidación tributaria"},
		rbac.SupervisorsLiquidationsDelete:  {Mod: "supervisors", Name: "Eliminar liquidación tributaria"},
		rbac.SupervisorsLiquidationsApprove: {Mod: "supervisors", Name: "Aprobar liquidación tributaria"},

		rbac.SupervisorsNPSView:     {Mod: "supervisors", Name: "Ver NPS"},
		rbac.SupervisorsNPSCreate:   {Mod: "supervisors", Name: "Crear NPS"},
		rbac.SupervisorsNPSUpdate:   {Mod: "supervisors", Name: "Editar NPS"},
		rbac.SupervisorsNPSDelete:   {Mod: "supervisors", Name: "Eliminar NPS"},
		rbac.SupervisorsNPSGenerate: {Mod: "supervisors", Name: "Generar código NPS"},

		rbac.SupervisorsReportsView: {Mod: "supervisors", Name: "Reportes supervisores"},

		rbac.SupervisorsObservationsView:   {Mod: "supervisors", Name: "Ver observaciones"},
		rbac.SupervisorsObservationsCreate: {Mod: "supervisors", Name: "Registrar observaciones"},
		rbac.SupervisorsHistoryView:        {Mod: "supervisors", Name: "Ver historial de cambios"},
		rbac.SupervisorsAttachmentsUpload:  {Mod: "supervisors", Name: "Subir adjuntos supervisores"},
		rbac.SupervisorsNotificationsView:  {Mod: "supervisors", Name: "Ver notificaciones supervisores"},
		rbac.SupervisorsNPSRegisterPayment: {Mod: "supervisors", Name: "Registrar pago NPS"},

		rbac.FinanceCalendarView:   {Mod: "finance", Name: "Ver calendario contable global"},
		rbac.FinanceCalendarManage: {Mod: "finance", Name: "Gestionar calendario contable global"},

		rbac.SalesEmit:          {Mod: "sales", Name: "Emitir comprobante (venta rápida)"},
		rbac.SalesHistory:       {Mod: "sales", Name: "Historial de ventas emitidas"},
		rbac.SalesCatalogPick:   {Mod: "sales", Name: "Buscar productos en venta"},
		rbac.SalesCompaniesPick: {Mod: "sales", Name: "Seleccionar cliente en venta"},
		rbac.SalesLinePriceEdit: {Mod: "sales", Name: "Modificar precio al vender"},
	}

	for _, code := range rbac.AllPermissionCodes {
		mn, ok := meta[code]
		if !ok {
			return fmt.Errorf("falta meta para permiso %s", code)
		}
		mid, err := moduleIDByCode(db, mn.Mod)
		if err != nil {
			return fmt.Errorf("módulo %s: %w", mn.Mod, err)
		}
		parts := strings.SplitN(code, ".", 2)
		action := parts[1]
		p := models.Permission{
			ModuleID:    mid,
			Code:        code,
			Action:      action,
			Name:        mn.Name,
			Description: "",
		}
		if err := db.Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "code"}},
			DoUpdates: clause.AssignmentColumns([]string{"module_id", "action", "name", "updated_at"}),
		}).Create(&p).Error; err != nil {
			return fmt.Errorf("permiso %s: %w", code, err)
		}
	}
	return nil
}

func seedRBACSystemRoles(db *gorm.DB) error {
	system := []models.Role{
		{Code: seedRoleSuperusuario, Name: "Super usuario", Description: "Acceso total al sistema y alcance global del estudio", IsSystem: true},
		{Code: seedRoleAdministrador, Name: "Administrador", Description: "Administración de área o equipo (permisos configurables)", IsSystem: true},
		{Code: seedRoleSupervisor, Name: "Supervisor", Description: "Supervisión operativa", IsSystem: true},
		{Code: seedRoleContador, Name: "Contador", Description: "Gestión contable y fiscal", IsSystem: true},
		{Code: seedRoleAsistente, Name: "Asistente", Description: "Apoyo operativo", IsSystem: true},
		{Code: seedRoleAnalista, Name: "Analista", Description: "Analista contable (avance y liquidaciones)", IsSystem: true},
		{Code: seedRoleGerencia, Name: "Gerencia", Description: "Gerencia — supervisión y cierre (mismo alcance que supervisor)", IsSystem: true},
		{Code: seedRoleEmisorComprobantes, Name: "Emisor de Comprobantes", Description: "Emisión rápida de comprobantes (POS)", IsSystem: true},
	}
	for i := range system {
		r := system[i]
		if err := db.Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "code"}},
			DoNothing: true,
		}).Create(&r).Error; err != nil {
			return fmt.Errorf("rol %s: %w", r.Code, err)
		}
	}
	return nil
}

func permissionIDsAll(db *gorm.DB) ([]uint, error) {
	var ids []uint
	if err := db.Model(&models.Permission{}).Order("id ASC").Pluck("id", &ids).Error; err != nil {
		return nil, err
	}
	return ids, nil
}

func permissionIDsByCodes(db *gorm.DB, codes []string) ([]uint, error) {
	if len(codes) == 0 {
		return nil, nil
	}
	var perms []models.Permission
	if err := db.Where("code IN ?", codes).Find(&perms).Error; err != nil {
		return nil, err
	}
	ids := make([]uint, 0, len(perms))
	for _, p := range perms {
		ids = append(ids, p.ID)
	}
	return ids, nil
}

// ensureFinanceCalendarRolePermissions enlaza permisos de calendario en roles del sistema (idempotente en cada arranque).
func ensureFinanceCalendarRolePermissions(db *gorm.DB) error {
	var viewP, manageP models.Permission
	if err := db.Where("code = ?", rbac.FinanceCalendarView).First(&viewP).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil
		}
		return err
	}
	if err := db.Where("code = ?", rbac.FinanceCalendarManage).First(&manageP).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil
		}
		return err
	}
	link := func(roleCode string, permIDs ...uint) error {
		var role models.Role
		if err := db.Where("code = ?", roleCode).First(&role).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return nil
			}
			return err
		}
		for _, pid := range permIDs {
			var cnt int64
			if err := db.Model(&models.RolePermission{}).
				Where("role_id = ? AND permission_id = ?", role.ID, pid).
				Count(&cnt).Error; err != nil {
				return err
			}
			if cnt > 0 {
				continue
			}
			if err := db.Create(&models.RolePermission{RoleID: role.ID, PermissionID: pid}).Error; err != nil {
				return fmt.Errorf("rol %s permiso %d: %w", roleCode, pid, err)
			}
		}
		return nil
	}
	viewRoles := []string{
		seedRoleSuperusuario, seedRoleContador, seedRoleSupervisor, seedRoleAdministrador,
		seedRoleGerencia, seedRoleAsistente, seedRoleAnalista,
	}
	for _, rc := range viewRoles {
		if err := link(rc, viewP.ID); err != nil {
			return err
		}
	}
	for _, rc := range []string{seedRoleSuperusuario, seedRoleContador} {
		if err := link(rc, manageP.ID); err != nil {
			return err
		}
	}
	return nil
}

// ensureFiscalComprobanteRolePermissions asigna permisos de series/emisión local a roles operativos (idempotente).
func ensureFiscalComprobanteRolePermissions(db *gorm.DB) error {
	codes := []string{
		rbac.FiscalSeriesView, rbac.FiscalSeriesManage,
		rbac.FiscalReceiptsList, rbac.FiscalReceiptsCreatePayment, rbac.FiscalReceiptsLinkPayment,
		rbac.FiscalReceiptsPatchTax, rbac.FiscalReceiptsDiscard,
		rbac.PaymentsIssueComprobante,
	}
	var perms []models.Permission
	if err := db.Where("code IN ?", codes).Find(&perms).Error; err != nil {
		return err
	}
	if len(perms) == 0 {
		return nil
	}
	permByCode := make(map[string]uint, len(perms))
	for _, p := range perms {
		permByCode[p.Code] = p.ID
	}
	link := func(roleCode string, permCodes ...string) error {
		var role models.Role
		if err := db.Where("code = ?", roleCode).First(&role).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return nil
			}
			return err
		}
		for _, pc := range permCodes {
			pid, ok := permByCode[pc]
			if !ok {
				continue
			}
			var cnt int64
			if err := db.Model(&models.RolePermission{}).Where("role_id = ? AND permission_id = ?", role.ID, pid).Count(&cnt).Error; err != nil {
				return err
			}
			if cnt > 0 {
				continue
			}
			if err := db.Create(&models.RolePermission{RoleID: role.ID, PermissionID: pid}).Error; err != nil {
				return fmt.Errorf("rol %s permiso %s: %w", roleCode, pc, err)
			}
		}
		return nil
	}
	viewOnly := []string{
		rbac.FiscalSeriesView, rbac.FiscalReceiptsList, rbac.FiscalReceiptsLinkPayment,
		rbac.FiscalReceiptsPatchTax, rbac.FiscalReceiptsDiscard,
	}
	manage := append(viewOnly, rbac.FiscalSeriesManage, rbac.FiscalReceiptsCreatePayment, rbac.PaymentsIssueComprobante)
	for _, rc := range []string{seedRoleSuperusuario, seedRoleContador} {
		if err := link(rc, manage...); err != nil {
			return err
		}
	}
	for _, rc := range []string{seedRoleSupervisor, seedRoleAdministrador, seedRoleGerencia, seedRoleAsistente, seedRoleAnalista} {
		if err := link(rc, viewOnly...); err != nil {
			return err
		}
		if err := link(rc, rbac.PaymentsIssueComprobante); err != nil {
			return err
		}
	}
	// Migrar roles que tenían payments.issue_tukifac → issue_comprobante
	var legacyPerm models.Permission
	if err := db.Where("code = ?", rbac.PaymentsIssueTukifac).First(&legacyPerm).Error; err == nil {
		var roleIDs []uint
		_ = db.Model(&models.RolePermission{}).Where("permission_id = ?", legacyPerm.ID).Distinct("role_id").Pluck("role_id", &roleIDs)
		newID, ok := permByCode[rbac.PaymentsIssueComprobante]
		if ok {
			for _, rid := range roleIDs {
				var cnt int64
				_ = db.Model(&models.RolePermission{}).Where("role_id = ? AND permission_id = ?", rid, newID).Count(&cnt)
				if cnt == 0 {
					_ = db.Create(&models.RolePermission{RoleID: rid, PermissionID: newID}).Error
				}
			}
		}
	}
	return nil
}

// ensureEmisorComprobantesRolePermissions asigna permisos mínimos al rol emisor POS (idempotente).
func ensureEmisorComprobantesRolePermissions(db *gorm.DB) error {
	codes := []string{
		rbac.SalesEmit, rbac.SalesHistory, rbac.SalesCatalogPick, rbac.SalesCompaniesPick, rbac.SalesLinePriceEdit,
		rbac.SettingsFirmBrandingView,
	}
	var perms []models.Permission
	if err := db.Where("code IN ?", codes).Find(&perms).Error; err != nil {
		return err
	}
	if len(perms) == 0 {
		return nil
	}
	permByCode := make(map[string]uint, len(perms))
	for _, p := range perms {
		permByCode[p.Code] = p.ID
	}
	var role models.Role
	if err := db.Where("code = ?", seedRoleEmisorComprobantes).First(&role).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil
		}
		return err
	}
	for _, pc := range codes {
		pid, ok := permByCode[pc]
		if !ok {
			continue
		}
		var cnt int64
		if err := db.Model(&models.RolePermission{}).Where("role_id = ? AND permission_id = ?", role.ID, pid).Count(&cnt).Error; err != nil {
			return err
		}
		if cnt > 0 {
			continue
		}
		if err := db.Create(&models.RolePermission{RoleID: role.ID, PermissionID: pid}).Error; err != nil {
			return fmt.Errorf("emisor permiso %s: %w", pc, err)
		}
	}
	return nil
}

func permissionCodesExcept(excl map[string]struct{}) []string {
	out := make([]string, 0, len(rbac.AllPermissionCodes))
	for _, c := range rbac.AllPermissionCodes {
		if _, skip := excl[c]; !skip {
			out = append(out, c)
		}
	}
	return out
}

// supervisorPermissionCodes conjunto de permisos del rol Supervisor y del Administrador de área (sin access.studio).
func supervisorPermissionCodes() []string {
	exclSupervisor := map[string]struct{}{
		rbac.AccessStudio: {},
		rbac.UsersView: {}, rbac.UsersCreate: {}, rbac.UsersUpdate: {}, rbac.UsersDelete: {},
		rbac.RBACRolesView: {}, rbac.RBACRolesManage: {}, rbac.RBACPermissionsCatalog: {},
		rbac.SettingsFirmView: {}, rbac.SettingsFirmUpdate: {}, rbac.SettingsFirmUploadLogo: {},
		rbac.SettingsFirmUploadBankLogo: {}, rbac.SettingsFirmUploadPaymentQR: {},
		rbac.CompaniesDelete: {}, rbac.SubscriptionPlansDelete: {}, rbac.PlanCategoriesDelete: {},
		rbac.PaymentsDelete: {},
		rbac.FinanceCalendarManage: {},
	}
	return permissionCodesExcept(exclSupervisor)
}

// analistaPermissionCodes permisos del analista: actualizar avance, sin asignar ni aprobar.
func analistaPermissionCodes() []string {
	return []string{
		rbac.SupervisorsDashboardView,
		rbac.SupervisorsPeriodsView,
		rbac.SupervisorsControlsView, rbac.SupervisorsControlsUpdate,
		rbac.SupervisorsDeclarationsView, rbac.SupervisorsDeclarationsUpdate,
		rbac.SupervisorsLiquidationsView, rbac.SupervisorsLiquidationsUpdate,
		rbac.SupervisorsNPSView, rbac.SupervisorsNPSUpdate,
		rbac.SupervisorsReportsView,
		rbac.SupervisorsObservationsView, rbac.SupervisorsObservationsCreate,
		rbac.SupervisorsHistoryView, rbac.SupervisorsAttachmentsUpload,
		rbac.SupervisorsNotificationsView,
		rbac.FinanceCalendarView,
	}
}

func seedRBACRolePermissions(db *gorm.DB) error {
	type roleBind struct {
		roleCode string
		codes    []string
	}

	exclContador := map[string]struct{}{
		rbac.AccessStudio: {},
		rbac.UsersView: {}, rbac.UsersCreate: {}, rbac.UsersUpdate: {}, rbac.UsersDelete: {},
		rbac.RBACRolesView: {}, rbac.RBACRolesManage: {}, rbac.RBACPermissionsCatalog: {},
		rbac.SettingsFirmView: {}, rbac.SettingsFirmUpdate: {},
		rbac.SettingsFirmUploadLogo: {}, rbac.SettingsFirmUploadBankLogo: {}, rbac.SettingsFirmUploadPaymentQR: {},
		rbac.CompaniesValidateRUC: {}, rbac.CompaniesNextCode: {}, rbac.CompaniesImportTemplate: {},
		rbac.CompaniesImportSpreadsheet: {}, rbac.CompaniesCreate: {}, rbac.CompaniesUpdate: {}, rbac.CompaniesStatus: {}, rbac.CompaniesDelete: {},
		rbac.SubscriptionPlansCreate: {}, rbac.SubscriptionPlansUpdate: {}, rbac.SubscriptionPlansTiers: {}, rbac.SubscriptionPlansDelete: {},
		rbac.PlanCategoriesDelete: {},
		rbac.PaymentsDelete: {},
		rbac.ProductsDelete: {},
	}

	asistenteAllow := []string{
		rbac.DashboardView,
		rbac.CompaniesView,
		rbac.ContactsView, rbac.ContactsCreate, rbac.ContactsUpdate, rbac.ContactsDelete,
		rbac.DocumentsView,
		rbac.PaymentsView, rbac.PaymentsCreate, rbac.PaymentsIssueComprobante, rbac.PaymentsUploadAttachment,
		rbac.ProductsView, rbac.ProductCategoriesView,
		rbac.PlanCategoriesView,
		rbac.SubscriptionPlansView,
		rbac.FiscalSeriesView, rbac.FiscalReceiptsList, rbac.FiscalReceiptsCreatePayment, rbac.FiscalReceiptsLinkPayment,
		rbac.TaxSettlementsPreview, rbac.TaxSettlementsList, rbac.TaxSettlementsView, rbac.TaxSettlementsPaymentSuggestions,
		rbac.CompaniesAssignAssistant,
		rbac.FinanceCalendarView,
		rbac.SupervisorsDashboardView,
		rbac.SupervisorsPeriodsView,
		rbac.SupervisorsControlsView, rbac.SupervisorsControlsUpdate,
		rbac.SupervisorsDeclarationsView, rbac.SupervisorsDeclarationsUpdate,
		rbac.SupervisorsLiquidationsView, rbac.SupervisorsLiquidationsUpdate,
		rbac.SupervisorsNPSView, rbac.SupervisorsNPSUpdate,
		rbac.SupervisorsObservationsView, rbac.SupervisorsObservationsCreate,
		rbac.SupervisorsHistoryView, rbac.SupervisorsAttachmentsUpload,
		rbac.SupervisorsNotificationsView,
	}

	allIDs, err := permissionIDsAll(db)
	if err != nil {
		return err
	}
	supervisorCodes := supervisorPermissionCodes()
	contadorCodes := permissionCodesExcept(exclContador)
	supervisorIDs, err := permissionIDsByCodes(db, supervisorCodes)
	if err != nil {
		return err
	}
	contadorIDs, err := permissionIDsByCodes(db, contadorCodes)
	if err != nil {
		return err
	}
	asistenteIDs, err := permissionIDsByCodes(db, asistenteAllow)
	if err != nil {
		return err
	}
	analistaIDs, err := permissionIDsByCodes(db, analistaPermissionCodes())
	if err != nil {
		return err
	}

	binds := []roleBind{
		{roleCode: seedRoleSuperusuario, codes: rbac.AllPermissionCodes},
		{roleCode: seedRoleAdministrador, codes: supervisorCodes},
		{roleCode: seedRoleGerencia, codes: supervisorCodes},
		{roleCode: seedRoleSupervisor, codes: supervisorCodes},
		{roleCode: seedRoleContador, codes: contadorCodes},
		{roleCode: seedRoleAsistente, codes: asistenteAllow},
		{roleCode: seedRoleAnalista, codes: analistaPermissionCodes()},
	}

	for _, b := range binds {
		var role models.Role
		if err := db.Where("code = ?", b.roleCode).First(&role).Error; err != nil {
			return fmt.Errorf("rol %s: %w", b.roleCode, err)
		}
		var ids []uint
		switch b.roleCode {
		case seedRoleSuperusuario:
			ids = allIDs
		case seedRoleAdministrador, seedRoleGerencia, seedRoleSupervisor:
			ids = supervisorIDs
		case seedRoleContador:
			ids = contadorIDs
		case seedRoleAsistente:
			ids = asistenteIDs
		case seedRoleAnalista:
			ids = analistaIDs
		}
		if err := db.Model(&role).Association("Permissions").Replace([]models.Permission{}); err != nil {
			return err
		}
		if len(ids) == 0 {
			continue
		}
		var plist []models.Permission
		if err := db.Where("id IN ?", ids).Find(&plist).Error; err != nil {
			return err
		}
		if err := db.Model(&role).Association("Permissions").Append(plist); err != nil {
			return err
		}
	}
	return nil
}

func ensureRBACUserRoleAssignments(db *gorm.DB) error {
	return assignDefaultRoleWhereNoRoles(db)
}

// ensureSuperusuarioFullPermissions deja el rol super_usuario con todos los permisos del catálogo (idempotente).
func ensureSuperusuarioFullPermissions(db *gorm.DB) error {
	var superRole models.Role
	if err := db.Where("code = ?", seedRoleSuperusuario).First(&superRole).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil
		}
		return err
	}
	allIDs, err := permissionIDsAll(db)
	if err != nil {
		return err
	}
	if len(allIDs) == 0 {
		return nil
	}
	var plist []models.Permission
	if err := db.Where("id IN ?", allIDs).Find(&plist).Error; err != nil {
		return err
	}
	return db.Model(&superRole).Association("Permissions").Replace(plist)
}

func findUserByAdminUsername(db *gorm.DB) (*models.User, error) {
	var admin models.User
	err := db.Where("LOWER(TRIM(username)) = ?", "admin").First(&admin).Error
	if err == nil {
		return &admin, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	return nil, nil
}

func ensureSuperusuarioRole(db *gorm.DB) (*models.Role, error) {
	var superRole models.Role
	if err := db.Where("code = ?", seedRoleSuperusuario).First(&superRole).Error; err == nil {
		return &superRole, nil
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	if err := seedRBACSystemRoles(db); err != nil {
		return nil, err
	}
	if err := db.Where("code = ?", seedRoleSuperusuario).First(&superRole).Error; err != nil {
		return nil, fmt.Errorf("falta rol %s tras semilla: %w", seedRoleSuperusuario, err)
	}
	return &superRole, nil
}

func assignUserRolesExplicit(db *gorm.DB, userID, roleID uint) error {
	return db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("user_id = ?", userID).Delete(&models.UserRole{}).Error; err != nil {
			return err
		}
		return tx.Create(&models.UserRole{UserID: userID, RoleID: roleID}).Error
	})
}

// ensureAdminSuperusuarioUser: si existe username "admin" (sin distinguir mayúsculas), super_usuario con todos los permisos.
func ensureAdminSuperusuarioUser(db *gorm.DB) error {
	admin, err := findUserByAdminUsername(db)
	if err != nil {
		return err
	}
	if admin == nil {
		return nil
	}
	superRole, err := ensureSuperusuarioRole(db)
	if err != nil {
		return fmt.Errorf("usuario admin: %w", err)
	}
	if err := ensureSuperusuarioFullPermissions(db); err != nil {
		return fmt.Errorf("admin super_usuario permisos: %w", err)
	}
	if err := assignUserRolesExplicit(db, admin.ID, superRole.ID); err != nil {
		return fmt.Errorf("usuario admin: asignar rol: %w", err)
	}
	// Mantener asociación GORM coherente para otros flujos.
	if err := db.Model(admin).Association("Roles").Replace([]models.Role{*superRole}); err != nil {
		return fmt.Errorf("usuario admin: sync roles: %w", err)
	}
	return nil
}

func assignDefaultRoleWhereNoRoles(db *gorm.DB) error {
	var def models.Role
	if err := db.Where("is_default = ?", true).First(&def).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil
		}
		return err
	}
	var users []models.User
	if err := db.Preload("Roles").Find(&users).Error; err != nil {
		return err
	}
	for i := range users {
		u := &users[i]
		if len(u.Roles) == 0 {
			if err := db.Model(u).Association("Roles").Replace([]models.Role{def}); err != nil {
				return fmt.Errorf("usuario %d: %w", u.ID, err)
			}
		}
	}
	return nil
}

// migrateLegacyAdministradorToSuperusuario: si el rol Administrador aún tenía access.studio (modelo antiguo),
// crea el conjunto completo en super_usuario, mueve usuarios con ese rol a super_usuario y deja Administrador como rol de área.
func migrateLegacyAdministradorToSuperusuario(db *gorm.DB) error {
	var adm models.Role
	if err := db.Where("code = ?", seedRoleAdministrador).First(&adm).Error; err != nil {
		return nil
	}
	var studioPerm models.Permission
	if err := db.Where("code = ?", rbac.AccessStudio).First(&studioPerm).Error; err != nil {
		return nil
	}
	var n int64
	if err := db.Model(&models.RolePermission{}).
		Where("role_id = ? AND permission_id = ?", adm.ID, studioPerm.ID).
		Count(&n).Error; err != nil {
		return err
	}
	if n == 0 {
		return nil
	}
	var superRole models.Role
	if err := db.Where("code = ?", seedRoleSuperusuario).First(&superRole).Error; err != nil {
		return fmt.Errorf("migración RBAC: falta rol %s: %w", seedRoleSuperusuario, err)
	}
	allIDs, err := permissionIDsAll(db)
	if err != nil {
		return err
	}
	var plistAll []models.Permission
	if err := db.Where("id IN ?", allIDs).Find(&plistAll).Error; err != nil {
		return err
	}
	if err := db.Model(&superRole).Association("Permissions").Replace(plistAll); err != nil {
		return fmt.Errorf("migración RBAC: permisos super usuario: %w", err)
	}
	var userIDs []uint
	if err := db.Table("user_roles").Distinct("user_id").Where("role_id = ?", adm.ID).Pluck("user_id", &userIDs).Error; err != nil {
		return err
	}
	for _, uid := range userIDs {
		var u models.User
		if err := db.Preload("Roles").First(&u, uid).Error; err != nil {
			continue
		}
		newRoles := make([]models.Role, 0, len(u.Roles))
		replaced := false
		for _, rr := range u.Roles {
			if rr.Code == seedRoleAdministrador {
				replaced = true
				continue
			}
			newRoles = append(newRoles, rr)
		}
		if !replaced {
			continue
		}
		newRoles = append(newRoles, superRole)
		if err := db.Model(&u).Association("Roles").Replace(newRoles); err != nil {
			return fmt.Errorf("migración RBAC usuario %d: %w", uid, err)
		}
	}
	superCodes := supervisorPermissionCodes()
	ids, err := permissionIDsByCodes(db, superCodes)
	if err != nil {
		return err
	}
	var plistAdm []models.Permission
	if err := db.Where("id IN ?", ids).Find(&plistAdm).Error; err != nil {
		return err
	}
	var admReload models.Role
	if err := db.First(&admReload, adm.ID).Error; err != nil {
		return err
	}
	if err := db.Model(&admReload).Association("Permissions").Replace(plistAdm); err != nil {
		return fmt.Errorf("migración RBAC: ajustar administrador: %w", err)
	}
	return nil
}
