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
	PaymentsIssueTukifac     = "payments.issue_tukifac"
	PaymentsUploadAttachment = "payments.upload_attachment"

	UsersView   = "users.view"
	UsersCreate = "users.create"
	UsersUpdate = "users.update"
	UsersDelete = "users.delete"

	ReportsFinancialView = "reports.financial_view"

	TukifacDocumentsList        = "tukifac.documents_list"
	TukifacDocumentSeries       = "tukifac.document_series"
	TukifacSaleNoteLists        = "tukifac.sale_note_lists"
	TukifacSaleNoteSync         = "tukifac.sale_note_sync"
	TukifacFiscalReceiptsList   = "tukifac.fiscal_receipts_list"
	TukifacFiscalCreatePayment  = "tukifac.fiscal_create_payment"
	TukifacFiscalLinkPayment    = "tukifac.fiscal_link_payment"
	TukifacFiscalPatchTax       = "tukifac.fiscal_patch_tax_settlement"
	TukifacFiscalDiscard        = "tukifac.fiscal_discard"
	TukifacSellnowItems         = "tukifac.sellnow_items"

	ProductsView        = "products.view"
	ProductsCreate      = "products.create"
	ProductsUpdate      = "products.update"
	ProductsDelete      = "products.delete"
	ProductsSyncTukifac = "products.sync_tukifac"

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
)

// AllPermissionCodes lista completa para seed y tests.
var AllPermissionCodes = []string{
	AccessStudio,
	DashboardView,
	SettingsFirmView, SettingsFirmBrandingView, SettingsFirmUpdate, SettingsFirmUploadLogo, SettingsFirmUploadBankLogo, SettingsFirmUploadPaymentQR,
	CompaniesValidateRUC, CompaniesNextCode, CompaniesImportTemplate, CompaniesImportSpreadsheet, CompaniesCreate, CompaniesUpdate, CompaniesStatus, CompaniesDelete, CompaniesView,
	CompaniesAssignAccountant, CompaniesAssignSupervisor, CompaniesAssignAssistant,
	ContactsView, ContactsCreate, ContactsUpdate, ContactsDelete,
	DocumentsView, DocumentsCreate, DocumentsUpdate, DocumentsDelete, DocumentsSyncTukifac,
	PaymentsView, PaymentsCreate, PaymentsUpdate, PaymentsDelete, PaymentsIssueTukifac, PaymentsUploadAttachment,
	UsersView, UsersCreate, UsersUpdate, UsersDelete,
	ReportsFinancialView,
	TukifacDocumentsList, TukifacDocumentSeries, TukifacSaleNoteLists, TukifacSaleNoteSync, TukifacFiscalReceiptsList, TukifacFiscalCreatePayment, TukifacFiscalLinkPayment, TukifacFiscalPatchTax, TukifacFiscalDiscard, TukifacSellnowItems,
	ProductsView, ProductsCreate, ProductsUpdate, ProductsDelete, ProductsSyncTukifac,
	ProductCategoriesView, ProductCategoriesCreate,
	PlanCategoriesView, PlanCategoriesCreate, PlanCategoriesUpdate, PlanCategoriesDelete,
	SubscriptionPlansView, SubscriptionPlansCreate, SubscriptionPlansUpdate, SubscriptionPlansTiers, SubscriptionPlansDelete,
	LiquidationRun,
	TaxSettlementsPreview, TaxSettlementsList, TaxSettlementsView, TaxSettlementsPaymentSuggestions, TaxSettlementsCreate, TaxSettlementsUpdate, TaxSettlementsEmit, TaxSettlementsDelete,
	RBACRolesView, RBACRolesManage, RBACPermissionsCatalog,
}
