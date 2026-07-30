import { BrowserRouter as Router, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { useEffect, type ReactElement } from 'react';
import Layout from './layouts/Layout';
import Dashboard from './pages/Dashboard';
import Companies from './pages/Companies';
import ExternalClients from './pages/ExternalClients';
import CompanyForm from './pages/CompanyForm';
import CompanyStatement from './pages/CompanyStatement';
import CompanyContacts from './pages/CompanyContacts';
import CompanyContactForm from './pages/CompanyContactForm';
import Documents from './pages/Documents';
import FiscalDocumentSeries from './pages/FiscalDocumentSeries';
import FiscalReceipts from './pages/FiscalReceipts';
import TaxSettlements from './pages/TaxSettlements';
import TaxSettlementNew from './pages/TaxSettlementNew';
import TaxSettlementDetail from './pages/TaxSettlementDetail';
import Comprobantes from './pages/Comprobantes';
import PlanCategories from './pages/PlanCategories';
import PlanCategoryForm from './pages/PlanCategoryForm';
import SubscriptionPlansList from './pages/SubscriptionPlansList';
import SubscriptionPlanForm from './pages/SubscriptionPlanForm';
import Products from './pages/Products';
import ProductForm from './pages/ProductForm';
import DocumentForm from './pages/DocumentForm';
import Payments from './pages/Payments';
import PaymentForm from './pages/PaymentForm';
import Reports from './pages/Reports';
import Settings from './pages/Settings';
import ActivityConfigurationSettings from './pages/settings/ActivityConfigurationSettings';
import Users from './pages/Users';
import UserForm from './pages/UserForm';
import RolePermissions from './pages/RolePermissions';
import Login from './pages/Login';
import Placeholder from './pages/Placeholder';
import ModuleComingSoon from './pages/ModuleComingSoon';
import SupervisorDashboard from './pages/supervisors/SupervisorDashboard';
import SupervisorPeriods from './pages/supervisors/SupervisorPeriods';
import SupervisorCompaniesPage from './pages/supervisors/SupervisorCompaniesPage';
import SupervisorSunatInboxListPage from './pages/supervisors/activities/SupervisorSunatInboxListPage';
import SupervisorSunatInboxDetailPage from './pages/supervisors/activities/SupervisorSunatInboxDetailPage';
import SupervisorDetraccionesListPage from './pages/supervisors/activities/SupervisorDetraccionesListPage';
import SupervisorDetraccionesDetailPage from './pages/supervisors/activities/SupervisorDetraccionesDetailPage';
import SupervisorPdt601ListPage from './pages/supervisors/activities/SupervisorPdt601ListPage';
import SupervisorPdt601DetailPage from './pages/supervisors/activities/SupervisorPdt601DetailPage';
import SupervisorPdt621ListPage from './pages/supervisors/activities/SupervisorPdt621ListPage';
import SupervisorPdt621DetailPage from './pages/supervisors/activities/SupervisorPdt621DetailPage';
import SupervisorControlDetail from './pages/supervisors/SupervisorControlDetail';
import SupervisorReports from './pages/supervisors/SupervisorReports';
import SupervisorNotifications from './pages/supervisors/SupervisorNotifications';
import SupervisorLiquidacionesListPage from './pages/supervisors/SupervisorLiquidacionesListPage';
import SupervisorLiquidacionCreatePage from './pages/supervisors/SupervisorLiquidacionCreatePage';
import FinanceCalendar from './pages/finance/FinanceCalendar';
import ActivityTemplates from './pages/finance/ActivityTemplates';
import ActivityTemplateForm from './pages/finance/ActivityTemplateForm';
import CompanyAccessCredentials from './pages/finance/CompanyAccessCredentials';
import SunatDueDatesCalendar from './pages/finance/SunatDueDatesCalendar';
import AssistantWorkspace from './pages/assistant/AssistantWorkspace';
import AssistantCompaniesPage from './pages/assistant/AssistantCompaniesPage';
import AssistantSunatInboxListPage from './pages/assistant/activities/AssistantSunatInboxListPage';
import AssistantSunatInboxDetailPage from './pages/assistant/activities/AssistantSunatInboxDetailPage';
import AssistantDetraccionesListPage from './pages/assistant/activities/AssistantDetraccionesListPage';
import AssistantDetraccionesDetailPage from './pages/assistant/activities/AssistantDetraccionesDetailPage';
import { LegacyDetraccionesRedirect } from './components/activity/LegacyDetraccionesRedirect';
import AssistantPdt601ListPage from './pages/assistant/activities/AssistantPdt601ListPage';
import AssistantPdt601DetailPage from './pages/assistant/activities/AssistantPdt601DetailPage';
import AssistantPdt621ListPage from './pages/assistant/activities/AssistantPdt621ListPage';
import AssistantPdt621DetailPage from './pages/assistant/activities/AssistantPdt621DetailPage';
import ProtectedRoute from './components/ProtectedRoute';
import HomeRedirect from './components/HomeRedirect';
import PosSale from './pages/pos/PosSale';
import PosHistory from './pages/pos/PosHistory';
import { auth } from './services/auth';
import { RequirePermission } from './rbac/access';
import { P } from './rbac/codes';

/** Envuelve un elemento de ruta con la guarda de permiso (string) o alguno-de (array). */
const guard = (perm: string | string[], el: ReactElement): ReactElement =>
  Array.isArray(perm) ? (
    <RequirePermission anyOf={perm}>{el}</RequirePermission>
  ) : (
    <RequirePermission permission={perm}>{el}</RequirePermission>
  );

const Logout = () => {
  const navigate = useNavigate();

  useEffect(() => {
    auth.logout().finally(() => {
      navigate('/login', { replace: true });
    });
  }, [navigate]);

  return null;
};

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/login" element={<Login />} />
        
        <Route element={<ProtectedRoute />}>
          <Route path="/" element={<Layout />}>
            <Route index element={<HomeRedirect />} />
            <Route path="logout" element={<Logout />} />
            <Route path="dashboard" element={guard(P.dashboardView, <Dashboard />)} />
            <Route path="m/:slug" element={<ModuleComingSoon />} />
            <Route path="companies" element={guard(P.companiesView, <Companies />)} />
            <Route path="companies/external" element={guard([P.companiesExternalView, P.accessStudio], <ExternalClients />)} />
            <Route path="companies/new" element={guard(P.companiesView, <CompanyForm />)} />
            <Route path="companies/:id/edit" element={guard(P.companiesView, <CompanyForm />)} />
            <Route path="companies/:id/statement" element={guard(P.companiesView, <CompanyStatement />)} />
            <Route path="companies/:companyID/contacts" element={guard(P.companiesView, <CompanyContacts />)} />
            <Route path="companies/:companyID/contacts/new" element={guard(P.companiesView, <CompanyContactForm />)} />
            <Route path="companies/:companyID/contacts/:id/edit" element={guard(P.companiesView, <CompanyContactForm />)} />
            <Route path="documents" element={guard(P.documentsView, <Documents />)} />
            <Route path="tax-settlements" element={guard(P.taxSettlementsList, <TaxSettlements />)} />
            <Route path="tax-settlements/new" element={guard(P.taxSettlementsList, <TaxSettlementNew />)} />
            <Route path="tax-settlements/:id/edit" element={guard(P.taxSettlementsList, <TaxSettlementNew />)} />
            <Route path="tax-settlements/:id" element={guard(P.taxSettlementsList, <TaxSettlementDetail />)} />
            <Route path="comprobantes" element={guard(P.fiscalReceiptsList, <Comprobantes />)} />
            <Route path="tukifac/documentos" element={<Navigate to="/comprobantes" replace />} />
            <Route path="documents/tukifac" element={<Navigate to="/comprobantes" replace />} />
            <Route path="documents/fiscal-receipts" element={guard(P.fiscalReceiptsList, <FiscalReceipts />)} />
            <Route path="fiscal-receipts" element={<Navigate to="/comprobantes?status=pendiente_vincular" replace />} />
            <Route path="plan-categories" element={guard(P.planCategoriesView, <PlanCategories />)} />
            <Route path="plan-categories/new" element={guard(P.planCategoriesView, <PlanCategoryForm />)} />
            <Route path="plan-categories/:id/edit" element={guard(P.planCategoriesView, <PlanCategoryForm />)} />
            <Route path="subscription-plans" element={guard(P.subscriptionPlansView, <SubscriptionPlansList />)} />
            <Route path="subscription-plans/new" element={guard(P.subscriptionPlansView, <SubscriptionPlanForm />)} />
            <Route path="subscription-plans/:id/edit" element={guard(P.subscriptionPlansView, <SubscriptionPlanForm />)} />
            <Route path="products" element={guard(P.productsView, <Products />)} />
            <Route path="products/new" element={guard(P.productsView, <ProductForm />)} />
            <Route path="products/:id/edit" element={guard(P.productsView, <ProductForm />)} />
            <Route path="documents/new" element={guard(P.documentsView, <DocumentForm />)} />
            <Route path="documents/:id/edit" element={guard(P.documentsView, <DocumentForm />)} />
            <Route path="payments" element={guard(P.paymentsView, <Payments />)} />
            <Route path="payments/new" element={guard(P.paymentsView, <PaymentForm />)} />
            <Route path="payments/:id/edit" element={guard(P.paymentsView, <PaymentForm />)} />
            <Route path="reports/financial" element={guard(P.reportsFinancialView, <Reports />)} />
            <Route path="supervisors/dashboard" element={guard(P.supervisorsDashboardView, <SupervisorDashboard />)} />
            <Route path="supervisors/periods" element={guard(P.supervisorsPeriodsView, <SupervisorPeriods />)} />
            <Route path="supervisors/companies" element={guard(P.supervisorsControlsView, <SupervisorCompaniesPage />)} />
            <Route path="supervisors/liquidaciones" element={guard(P.supervisorsLiquidationsView, <SupervisorLiquidacionesListPage />)} />
            <Route path="supervisors/liquidaciones/crear/:companyId" element={guard(P.supervisorsLiquidationsView, <SupervisorLiquidacionCreatePage />)} />
            <Route path="supervisors/liquidaciones/editar/:settlementId" element={guard(P.supervisorsLiquidationsView, <SupervisorLiquidacionCreatePage />)} />
            <Route path="supervisors/liquidaciones/ver/:settlementId" element={guard(P.supervisorsLiquidationsView, <SupervisorLiquidacionCreatePage />)} />
            <Route path="supervisors/activities" element={<Navigate to="/supervisors/dashboard" replace />} />
            <Route path="supervisors/activities/pdt-601" element={guard(P.supervisorsControlsView, <SupervisorPdt601ListPage />)} />
            <Route path="supervisors/activities/pdt-601/:companyId" element={guard(P.supervisorsControlsView, <SupervisorPdt601DetailPage />)} />
            <Route path="supervisors/activities/pdt-621" element={guard(P.supervisorsControlsView, <SupervisorPdt621ListPage />)} />
            <Route path="supervisors/activities/pdt-621/:companyId" element={guard(P.supervisorsControlsView, <SupervisorPdt621DetailPage />)} />
            <Route path="supervisors/activities/sunat-inbox" element={guard(P.supervisorsControlsView, <SupervisorSunatInboxListPage />)} />
            <Route path="supervisors/activities/sunat-inbox/:companyId" element={guard(P.supervisorsControlsView, <SupervisorSunatInboxDetailPage />)} />
            <Route path="supervisors/activities/detracciones" element={guard(P.supervisorsControlsView, <SupervisorDetraccionesListPage />)} />
            <Route path="supervisors/activities/detracciones/:companyId" element={guard(P.supervisorsControlsView, <SupervisorDetraccionesDetailPage />)} />
            <Route path="supervisors/activities/distractions" element={<LegacyDetraccionesRedirect workspace="supervisor" />} />
            <Route path="supervisors/activities/distractions/:companyId" element={<LegacyDetraccionesRedirect workspace="supervisor" />} />
            <Route path="supervisors/controls" element={<Navigate to="/supervisors/dashboard" replace />} />
            <Route path="supervisors/controls/:id" element={guard(P.supervisorsControlsView, <SupervisorControlDetail />)} />
            <Route path="supervisors/reports" element={guard(P.supervisorsReportsView, <SupervisorReports />)} />
            <Route path="supervisors/notifications" element={guard(P.supervisorsNotificationsView, <SupervisorNotifications />)} />
            <Route path="finance/calendar" element={guard(P.financeCalendarView, <FinanceCalendar />)} />
            <Route path="finance/activity-templates">
              <Route index element={guard([P.financeCalendarManage, P.settingsFirmView], <ActivityTemplates />)} />
              <Route path="new" element={guard([P.financeCalendarManage, P.settingsFirmView], <ActivityTemplateForm />)} />
              <Route path=":id/edit" element={guard([P.financeCalendarManage, P.settingsFirmView], <ActivityTemplateForm />)} />
            </Route>
            <Route path="finance/claves-sol" element={guard(P.companyCredentialsView, <CompanyAccessCredentials />)} />
            <Route path="finance/sunat-due-dates" element={guard(P.financeSunatDueDatesView, <SunatDueDatesCalendar />)} />
            <Route path="assistant" element={guard(P.supervisorsControlsView, <AssistantWorkspace />)} />
            <Route path="assistant/companies" element={guard(P.supervisorsControlsView, <AssistantCompaniesPage />)} />
            <Route path="assistant/activities" element={<Navigate to="/assistant" replace />} />
            <Route path="assistant/activities/pdt-601" element={guard(P.supervisorsControlsView, <AssistantPdt601ListPage />)} />
            <Route path="assistant/activities/pdt-601/:companyId" element={guard(P.supervisorsControlsView, <AssistantPdt601DetailPage />)} />
            <Route path="assistant/activities/pdt-621" element={guard(P.supervisorsControlsView, <AssistantPdt621ListPage />)} />
            <Route path="assistant/activities/pdt-621/:companyId" element={guard(P.supervisorsControlsView, <AssistantPdt621DetailPage />)} />
            <Route path="assistant/activities/sunat-inbox" element={guard(P.supervisorsControlsView, <AssistantSunatInboxListPage />)} />
            <Route path="assistant/activities/sunat-inbox/:companyId" element={guard(P.supervisorsControlsView, <AssistantSunatInboxDetailPage />)} />
            <Route path="assistant/activities/detracciones" element={guard(P.supervisorsControlsView, <AssistantDetraccionesListPage />)} />
            <Route path="assistant/activities/detracciones/:companyId" element={guard(P.supervisorsControlsView, <AssistantDetraccionesDetailPage />)} />
            <Route path="assistant/activities/distractions" element={<LegacyDetraccionesRedirect workspace="assistant" />} />
            <Route path="assistant/activities/distractions/:companyId" element={<LegacyDetraccionesRedirect workspace="assistant" />} />
            <Route path="assistant/notifications" element={guard(P.supervisorsNotificationsView, <SupervisorNotifications />)} />
            <Route path="assistant/controls" element={<Navigate to="/assistant" replace />} />
            <Route path="assistant/controls/:id" element={guard(P.supervisorsControlsView, <SupervisorControlDetail />)} />
            <Route path="pos" element={guard(P.salesEmit, <PosSale />)} />
            <Route path="pos/history" element={guard(P.salesHistory, <PosHistory />)} />
            <Route path="settings/firm" element={guard(P.settingsFirmView, <Settings />)} />
            <Route path="settings/activity-configuration" element={guard(P.settingsFirmView, <ActivityConfigurationSettings />)} />
            <Route path="settings/fiscal-series" element={guard(P.fiscalSeriesView, <FiscalDocumentSeries />)} />
            <Route path="users" element={guard(P.usersView, <Users />)} />
            <Route path="users/roles" element={guard(P.rbacRolesView, <RolePermissions />)} />
            <Route path="users/new" element={guard(P.usersView, <UserForm />)} />
            <Route path="users/:id/edit" element={guard(P.usersView, <UserForm />)} />
            
            {/* Rutas anidadas para formularios (por ahora placeholders) */}
            <Route path="profile" element={<Placeholder title="Mi Perfil" />} />
          </Route>
        </Route>
      </Routes>
    </Router>
  );
}

export default App;
