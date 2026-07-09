package rbac

// Códigos de permiso (module.action). Usar en rutas y frontend.
const (
	// AccessStudio ver todas las empresas / datos globales del estudio (antes ligado solo al rol administrador).
	AccessStudio = "access.studio"

	DashboardView = "dashboard.view"

	SettingsFirmView           = "settings.firm_view"
	SettingsFirmBrandingView   = "settings.firm_branding_view"
	SettingsFirmUpdate         = "settings.firm_update"
	SettingsFirmUploadLogo     = "settings.firm_upload_logo"
	SettingsFirmUploadBankLogo = "settings.firm_upload_bank_logo"
	SettingsFirmUploadPaymentQR = "settings.firm_upload_payment_qr"

	CompaniesValidateRUC     = "companies.validate_ruc"
	CompaniesNextCode        = "companies.next_code"
	CompaniesImportTemplate  = "companies.import_template"
	CompaniesImportSpreadsheet = "companies.import_spreadsheet"
	CompaniesCreate          = "companies.create"
	CompaniesUpdate          = "companies.update"
	CompaniesStatus          = "companies.status"
	CompaniesDelete          = "companies.delete"
	CompaniesView            = "companies.view"
	CompaniesAssignAccountant = "companies.assign_accountant"
	CompaniesAssignSupervisor = "companies.assign_supervisor"
	CompaniesAssignAssistant  = "companies.assign_assistant"
	CompaniesExternalView     = "companies.external_view"
	CompaniesConvertToStudio  = "companies.convert_to_studio"
	CompaniesValidateDNI      = "companies.validate_dni"

	ContactsView   = "contacts.view"
	ContactsCreate = "contacts.create"
	ContactsUpdate = "contacts.update"
	ContactsDelete = "contacts.delete"

	DocumentsView        = "documents.view"
	DocumentsCreate      = "documents.create"
	DocumentsUpdate      = "documents.update"
	DocumentsDelete      = "documents.delete"
	DocumentsSyncTukifac = "documents.sync_tukifac"

	PaymentsView             = "payments.view"
	PaymentsCreate           = "payments.create"
	PaymentsUpdate           = "payments.update"
	PaymentsDelete           = "payments.delete"
	PaymentsIssueTukifac     = "payments.issue_tukifac" // legacy (migrado a issue_comprobante)
	PaymentsIssueComprobante = "payments.issue_comprobante"
	PaymentsUploadAttachment = "payments.upload_attachment"

	UsersView   = "users.view"
	UsersCreate = "users.create"
	UsersUpdate = "users.update"
	UsersDelete = "users.delete"

	ReportsFinancialView = "reports.financial_view"

	FiscalSeriesView           = "fiscal.series_view"
	FiscalSeriesManage         = "fiscal.series_manage"
	FiscalReceiptsList         = "fiscal.receipts_list"
	FiscalReceiptsCreatePayment  = "fiscal.receipts_create_payment"
	FiscalReceiptsLinkPayment    = "fiscal.receipts_link_payment"
	FiscalReceiptsPatchTax       = "fiscal.receipts_patch_tax_settlement"
	FiscalReceiptsDiscard        = "fiscal.receipts_discard"

	// Alias legacy (misma pantalla de comprobantes)
	TukifacFiscalReceiptsList  = FiscalReceiptsList
	TukifacFiscalCreatePayment = FiscalReceiptsCreatePayment
	TukifacFiscalLinkPayment   = FiscalReceiptsLinkPayment
	TukifacFiscalPatchTax      = FiscalReceiptsPatchTax
	TukifacFiscalDiscard       = FiscalReceiptsDiscard

	ProductsView        = "products.view"
	ProductsCreate      = "products.create"
	ProductsUpdate      = "products.update"
	ProductsDelete      = "products.delete"

	ProductCategoriesView   = "product_categories.view"
	ProductCategoriesCreate = "product_categories.create"

	PlanCategoriesView   = "plan_categories.view"
	PlanCategoriesCreate = "plan_categories.create"
	PlanCategoriesUpdate = "plan_categories.update"
	PlanCategoriesDelete = "plan_categories.delete"

	SubscriptionPlansView   = "subscription_plans.view"
	SubscriptionPlansCreate = "subscription_plans.create"
	SubscriptionPlansUpdate = "subscription_plans.update"
	SubscriptionPlansTiers  = "subscription_plans.tiers"
	SubscriptionPlansDelete = "subscription_plans.delete"

	LiquidationRun = "liquidation.run"

	TaxSettlementsPreview            = "tax_settlements.preview"
	TaxSettlementsList               = "tax_settlements.list"
	TaxSettlementsView               = "tax_settlements.view"
	TaxSettlementsPaymentSuggestions = "tax_settlements.payment_suggestions"
	TaxSettlementsCreate             = "tax_settlements.create"
	TaxSettlementsUpdate             = "tax_settlements.update"
	TaxSettlementsEmit               = "tax_settlements.emit"
	TaxSettlementsDelete             = "tax_settlements.delete"

	RBACRolesView           = "rbac.roles_view"
	RBACRolesManage         = "rbac.roles_manage"
	RBACPermissionsCatalog  = "rbac.permissions_catalog"

	SupervisorsDashboardView = "supervisors.dashboard_view"

	SupervisorsPeriodsView   = "supervisors.periods_view"
	SupervisorsPeriodsCreate = "supervisors.periods_create"
	SupervisorsPeriodsUpdate = "supervisors.periods_update"
	SupervisorsPeriodsDelete = "supervisors.periods_delete"
	SupervisorsPeriodsClose     = "supervisors.periods_close"
	SupervisorsPeriodsBootstrap = "supervisors.periods_bootstrap"

	SupervisorsControlsView   = "supervisors.controls_view"
	SupervisorsControlsCreate = "supervisors.controls_create"
	SupervisorsControlsUpdate = "supervisors.controls_update"
	SupervisorsControlsDelete = "supervisors.controls_delete"

	SupervisorsDeclarationsView    = "supervisors.declarations_view"
	SupervisorsDeclarationsCreate    = "supervisors.declarations_create"
	SupervisorsDeclarationsUpdate    = "supervisors.declarations_update"
	SupervisorsDeclarationsDelete    = "supervisors.declarations_delete"
	SupervisorsDeclarationsApprove   = "supervisors.declarations_approve"
	SupervisorsDeclarationsObserve   = "supervisors.declarations_observe"

	SupervisorsLiquidationsView    = "supervisors.liquidations_view"
	SupervisorsLiquidationsCreate  = "supervisors.liquidations_create"
	SupervisorsLiquidationsUpdate  = "supervisors.liquidations_update"
	SupervisorsLiquidationsDelete  = "supervisors.liquidations_delete"
	SupervisorsLiquidationsApprove = "supervisors.liquidations_approve"

	SupervisorsNPSView     = "supervisors.nps_view"
	SupervisorsNPSCreate   = "supervisors.nps_create"
	SupervisorsNPSUpdate   = "supervisors.nps_update"
	SupervisorsNPSDelete   = "supervisors.nps_delete"
	SupervisorsNPSGenerate = "supervisors.nps_generate"

	SupervisorsReportsView = "supervisors.reports_view"

	SupervisorsObservationsView   = "supervisors.observations_view"
	SupervisorsObservationsCreate = "supervisors.observations_create"
	SupervisorsHistoryView        = "supervisors.history_view"
	SupervisorsAttachmentsUpload  = "supervisors.attachments_upload"
	SupervisorsNotificationsView  = "supervisors.notifications_view"
	SupervisorsNPSRegisterPayment = "supervisors.nps_register_payment"

	FinanceCalendarView   = "finance.calendar_view"
	FinanceCalendarManage = "finance.calendar_manage"

	CompanyCredentialsView   = "finance.company_credentials_view"
	CompanyCredentialsManage = "finance.company_credentials_manage"
	CompanyCredentialsImport = "finance.company_credentials_import"

	SalesEmit           = "sales.emit"
	SalesHistory        = "sales.history"
	SalesCatalogPick    = "sales.catalog_pick"
	SalesCompaniesPick  = "sales.companies_pick"
	SalesLinePriceEdit  = "sales.line_price_edit"
)

// AllPermissionCodes lista completa para seed y tests.
var AllPermissionCodes = []string{
	AccessStudio,
	DashboardView,
	SettingsFirmView, SettingsFirmBrandingView, SettingsFirmUpdate, SettingsFirmUploadLogo, SettingsFirmUploadBankLogo, SettingsFirmUploadPaymentQR,
	CompaniesValidateRUC, CompaniesValidateDNI, CompaniesNextCode, CompaniesImportTemplate, CompaniesImportSpreadsheet, CompaniesCreate, CompaniesUpdate, CompaniesStatus, CompaniesDelete, CompaniesView,
	CompaniesAssignAccountant, CompaniesAssignSupervisor, CompaniesAssignAssistant, CompaniesExternalView, CompaniesConvertToStudio,
	ContactsView, ContactsCreate, ContactsUpdate, ContactsDelete,
	DocumentsView, DocumentsCreate, DocumentsUpdate, DocumentsDelete,
	PaymentsView, PaymentsCreate, PaymentsUpdate, PaymentsDelete, PaymentsIssueTukifac, PaymentsIssueComprobante, PaymentsUploadAttachment,
	UsersView, UsersCreate, UsersUpdate, UsersDelete,
	ReportsFinancialView,
	FiscalSeriesView, FiscalSeriesManage, FiscalReceiptsList, FiscalReceiptsCreatePayment, FiscalReceiptsLinkPayment, FiscalReceiptsPatchTax, FiscalReceiptsDiscard,
	ProductsView, ProductsCreate, ProductsUpdate, ProductsDelete,
	ProductCategoriesView, ProductCategoriesCreate,
	PlanCategoriesView, PlanCategoriesCreate, PlanCategoriesUpdate, PlanCategoriesDelete,
	SubscriptionPlansView, SubscriptionPlansCreate, SubscriptionPlansUpdate, SubscriptionPlansTiers, SubscriptionPlansDelete,
	LiquidationRun,
	TaxSettlementsPreview, TaxSettlementsList, TaxSettlementsView, TaxSettlementsPaymentSuggestions, TaxSettlementsCreate, TaxSettlementsUpdate, TaxSettlementsEmit, TaxSettlementsDelete,
	RBACRolesView, RBACRolesManage, RBACPermissionsCatalog,
	SupervisorsDashboardView,
	SupervisorsPeriodsView, SupervisorsPeriodsCreate, SupervisorsPeriodsUpdate, SupervisorsPeriodsDelete, SupervisorsPeriodsClose, SupervisorsPeriodsBootstrap,
	SupervisorsControlsView, SupervisorsControlsCreate, SupervisorsControlsUpdate, SupervisorsControlsDelete,
	SupervisorsDeclarationsView, SupervisorsDeclarationsCreate, SupervisorsDeclarationsUpdate, SupervisorsDeclarationsDelete, SupervisorsDeclarationsApprove, SupervisorsDeclarationsObserve,
	SupervisorsLiquidationsView, SupervisorsLiquidationsCreate, SupervisorsLiquidationsUpdate, SupervisorsLiquidationsDelete, SupervisorsLiquidationsApprove,
	SupervisorsNPSView, SupervisorsNPSCreate, SupervisorsNPSUpdate, SupervisorsNPSDelete, SupervisorsNPSGenerate,
	SupervisorsReportsView,
	SupervisorsObservationsView, SupervisorsObservationsCreate, SupervisorsHistoryView,
	SupervisorsAttachmentsUpload, SupervisorsNotificationsView, SupervisorsNPSRegisterPayment,
	FinanceCalendarView, FinanceCalendarManage,
	CompanyCredentialsView, CompanyCredentialsManage, CompanyCredentialsImport,
	SalesEmit, SalesHistory, SalesCatalogPick, SalesCompaniesPick, SalesLinePriceEdit,
}
