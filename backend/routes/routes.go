package routes

import (
	"miappfiber/controllers"
	"miappfiber/middleware"

	"github.com/gofiber/fiber/v3"
)

func Setup(app *fiber.App) {
	authCtrl := controllers.NewAuthController()
	dashboardCtrl := controllers.NewDashboardController()
	companyCtrl := controllers.NewCompanyController()
	contactCtrl := controllers.NewContactController()
	documentCtrl := controllers.NewDocumentController()
	paymentCtrl := controllers.NewPaymentController()
	configCtrl := controllers.NewConfigController()
	tukifacCtrl := controllers.NewTukifacController()
	userCtrl := controllers.NewUserController()
	reportCtrl := controllers.NewReportController()
	planCatCtrl := controllers.NewPlanCategoryController()
	subPlanCtrl := controllers.NewSubscriptionPlanController()
	liqCtrl := controllers.NewLiquidationController()
	productCtrl := controllers.NewProductController()
	productCatCtrl := controllers.NewProductCategoryController()
	taxSettleCtrl := controllers.NewTaxSettlementController()

	// API pública (auth)
	app.Post("/api/login", authCtrl.LoginAPI)

	// API protegida con JWT
	api := app.Group("/api", middleware.JWTProtected())
	api.Get("/dashboard", dashboardCtrl.HomeAPI)
	api.Get("/logout", authCtrl.LogoutAPI)

	// Configuración API
	api.Get("/firm-config", middleware.RequireRole("Administrador"), configCtrl.FirmConfigAPI)
	api.Get("/firm-config/branding", middleware.RequireRole("Administrador", "Supervisor", "Contador", "Asistente"), configCtrl.FirmBrandingAPI)
	api.Put("/firm-config", middleware.RequireRole("Administrador"), configCtrl.UpdateFirmConfigAPI)
	api.Post("/firm-config/logo", middleware.RequireRole("Administrador"), configCtrl.UploadFirmLogoAPI)
	api.Post("/firm-config/statement-bank-logo", middleware.RequireRole("Administrador"), configCtrl.UploadStatementBankLogoAPI)
	api.Post("/firm-config/statement-payment-qr", middleware.RequireRole("Administrador"), configCtrl.UploadStatementPaymentQrAPI)

	// Companies
	api.Post("/companies/validate-ruc", middleware.RequireRole("Administrador", "Supervisor"), companyCtrl.ValidateRUCAPI)
	api.Get("/companies/next-internal-code", middleware.RequireRole("Administrador", "Supervisor"), companyCtrl.NextInternalCodeAPI)
	api.Get("/companies/import/template", middleware.RequireRole("Administrador", "Supervisor"), companyCtrl.ImportTemplateAPI)
	api.Post("/companies/import", middleware.RequireRole("Administrador", "Supervisor"), companyCtrl.ImportCompaniesAPI)
	api.Get("/companies", companyCtrl.ListAPI)
	api.Get("/companies/:id", companyCtrl.GetAPI)
	api.Get("/companies/:id/statement", companyCtrl.StatementAPI)
	api.Post("/companies", middleware.RequireRole("Administrador", "Supervisor"), companyCtrl.CreateAPI)
	api.Put("/companies/:id", middleware.RequireRole("Administrador", "Supervisor"), companyCtrl.UpdateAPI)
	api.Patch("/companies/:id/status", middleware.RequireRole("Administrador", "Supervisor"), companyCtrl.PatchStatusAPI)
	api.Delete("/companies/:id", middleware.RequireRole("Administrador"), companyCtrl.DeleteAPI)

	// Contacts
	api.Get("/companies/:companyID/contacts", contactCtrl.ListByCompanyAPI)
	api.Get("/companies/:companyID/contacts/:id", contactCtrl.GetAPI)
	api.Post("/companies/:companyID/contacts", contactCtrl.CreateAPI)
	api.Put("/companies/:companyID/contacts/:id", contactCtrl.UpdateAPI)
	api.Delete("/companies/:companyID/contacts/:id", contactCtrl.DeleteAPI)

	// Documents
	api.Get("/documents", documentCtrl.ListAPI)
	api.Get("/documents/:id", documentCtrl.GetAPI)
	api.Post("/documents", middleware.RequireRole("Administrador", "Supervisor", "Contador"), documentCtrl.CreateAPI)
	api.Put("/documents/:id", middleware.RequireRole("Administrador", "Supervisor", "Contador"), documentCtrl.UpdateAPI)
	api.Delete("/documents/:id", middleware.RequireRole("Administrador", "Supervisor"), documentCtrl.DeleteAPI)

	// Payments
	api.Get("/payments", paymentCtrl.ListAPI)
	api.Get("/payments/:id", paymentCtrl.GetAPI)
	api.Post("/payments", middleware.RequireRole("Administrador", "Supervisor", "Contador", "Asistente"), paymentCtrl.CreateAPI)
	api.Post("/payments/:id/issue-tukifac", middleware.RequireRole("Administrador", "Supervisor", "Contador"), paymentCtrl.IssueTukifacAPI)
	api.Put("/payments/:id", middleware.RequireRole("Administrador", "Supervisor", "Contador"), paymentCtrl.UpdateAPI)
	api.Delete("/payments/:id", middleware.RequireRole("Administrador"), paymentCtrl.DeleteAPI)
	api.Post("/payments/upload-attachment", middleware.RequireRole("Administrador", "Supervisor", "Contador", "Asistente"), paymentCtrl.UploadAttachmentAPI)

	// Users API (solo administradores)
	api.Get("/users", middleware.RequireRole("Administrador"), userCtrl.ListAPI)
	api.Get("/users/:id", middleware.RequireRole("Administrador"), userCtrl.GetAPI)
	api.Post("/users", middleware.RequireRole("Administrador"), userCtrl.CreateAPI)
	api.Put("/users/:id", middleware.RequireRole("Administrador"), userCtrl.UpdateAPI)
	api.Delete("/users/:id", middleware.RequireRole("Administrador"), userCtrl.DeleteAPI)

	// Reports API
	api.Get("/reports/financial", middleware.RequireRole("Administrador", "Supervisor", "Contador"), reportCtrl.FinancialSummaryAPI)

	// Tukifac sync
	api.Get("/tukifac/documents/lists", middleware.RequireRole("Administrador", "Supervisor", "Contador", "Asistente"), tukifacCtrl.ListDocumentsAPI)
	api.Get("/document/series", middleware.RequireRole("Administrador", "Supervisor", "Contador", "Asistente"), tukifacCtrl.DocumentSeriesAPI)
	api.Get("/sale-note/series", middleware.RequireRole("Administrador", "Supervisor", "Contador", "Asistente"), tukifacCtrl.SaleNoteSeriesAPI)
	api.Get("/tukifac/sale-note/lists", middleware.RequireRole("Administrador", "Supervisor", "Contador", "Asistente"), tukifacCtrl.ListSaleNotesAPI)
	api.Post("/documents/sync-tukifac", tukifacCtrl.SyncDocumentsAPI)
	api.Post("/tukifac/sale-note/sync", middleware.RequireRole("Administrador", "Supervisor", "Contador", "Asistente"), tukifacCtrl.SyncSaleNotesAPI)
	api.Get("/tukifac/fiscal-receipts", middleware.RequireRole("Administrador", "Supervisor", "Contador", "Asistente"), tukifacCtrl.ListFiscalReceiptsAPI)
	api.Post("/tukifac/fiscal-receipts/:id/create-payment", middleware.RequireRole("Administrador", "Supervisor", "Contador", "Asistente"), tukifacCtrl.CreatePaymentFromReceiptAPI)
	api.Post("/tukifac/fiscal-receipts/:id/link-payment", middleware.RequireRole("Administrador", "Supervisor", "Contador", "Asistente"), tukifacCtrl.LinkReceiptAPI)
	api.Patch("/tukifac/fiscal-receipts/:id/tax-settlement", middleware.RequireRole("Administrador", "Supervisor", "Contador"), tukifacCtrl.PatchReceiptTaxSettlementAPI)
	api.Post("/tukifac/fiscal-receipts/:id/discard", middleware.RequireRole("Administrador", "Supervisor", "Contador"), tukifacCtrl.DiscardReceiptAPI)
	api.Get("/tukifac/sellnow/items", middleware.RequireRole("Administrador", "Supervisor", "Contador", "Asistente"), tukifacCtrl.ListSellnowItemsAPI)

	// Productos y servicios (SUNAT / Tukifac)
	api.Get("/products", productCtrl.ListAPI)
	api.Get("/products/:id", productCtrl.GetAPI)
	api.Post("/products", middleware.RequireRole("Administrador", "Supervisor", "Contador"), productCtrl.CreateAPI)
	api.Put("/products/:id", middleware.RequireRole("Administrador", "Supervisor", "Contador"), productCtrl.UpdateAPI)
	api.Delete("/products/:id", middleware.RequireRole("Administrador", "Supervisor"), productCtrl.DeleteAPI)
	api.Post("/products/sync-tukifac", middleware.RequireRole("Administrador", "Supervisor", "Contador"), productCtrl.SyncTukifacAPI)

	api.Get("/product-categories", productCatCtrl.ListAPI)
	api.Post("/product-categories", middleware.RequireRole("Administrador", "Supervisor", "Contador"), productCatCtrl.CreateAPI)

	// Planes y liquidación
	api.Get("/plan-categories", planCatCtrl.ListAPI)
	api.Get("/plan-categories/:id", planCatCtrl.GetAPI)
	api.Post("/plan-categories", middleware.RequireRole("Administrador", "Supervisor"), planCatCtrl.CreateAPI)
	api.Put("/plan-categories/:id", middleware.RequireRole("Administrador", "Supervisor"), planCatCtrl.UpdateAPI)
	api.Delete("/plan-categories/:id", middleware.RequireRole("Administrador"), planCatCtrl.DeleteAPI)

	api.Get("/subscription-plans", subPlanCtrl.ListAPI)
	api.Get("/subscription-plans/:id", subPlanCtrl.GetAPI)
	api.Post("/subscription-plans", middleware.RequireRole("Administrador", "Supervisor"), subPlanCtrl.CreateAPI)
	api.Put("/subscription-plans/:id", middleware.RequireRole("Administrador", "Supervisor"), subPlanCtrl.UpdateAPI)
	api.Put("/subscription-plans/:id/tiers", middleware.RequireRole("Administrador", "Supervisor"), subPlanCtrl.ReplaceTiersAPI)
	api.Delete("/subscription-plans/:id", middleware.RequireRole("Administrador"), subPlanCtrl.DeleteAPI)

	api.Post("/liquidation/run", middleware.RequireRole("Administrador", "Supervisor", "Contador"), liqCtrl.RunLiquidationAPI)

	// Liquidaciones de impuestos (presentación al cliente; no sustituye Document)
	api.Get("/companies/:id/settlements/preview", middleware.RequireRole("Administrador", "Supervisor", "Contador", "Asistente"), taxSettleCtrl.PreviewSettlementsAPI)
	api.Get("/tax-settlements", middleware.RequireRole("Administrador", "Supervisor", "Contador", "Asistente"), taxSettleCtrl.ListAPI)
	api.Post("/tax-settlements", middleware.RequireRole("Administrador", "Supervisor", "Contador"), taxSettleCtrl.CreateAPI)
	api.Get("/tax-settlements/:id/payment-suggestions", middleware.RequireRole("Administrador", "Supervisor", "Contador", "Asistente"), taxSettleCtrl.PaymentSuggestionsAPI)
	api.Get("/tax-settlements/:id", middleware.RequireRole("Administrador", "Supervisor", "Contador", "Asistente"), taxSettleCtrl.GetAPI)
	api.Put("/tax-settlements/:id", middleware.RequireRole("Administrador", "Supervisor", "Contador"), taxSettleCtrl.UpdateAPI)
	api.Post("/tax-settlements/:id/emit", middleware.RequireRole("Administrador", "Supervisor", "Contador"), taxSettleCtrl.EmitAPI)
	api.Delete("/tax-settlements/:id", middleware.RequireRole("Administrador", "Supervisor", "Contador"), taxSettleCtrl.DeleteAPI)
}
