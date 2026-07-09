import { BrowserRouter as Router, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { useEffect } from 'react';
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
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="m/:slug" element={<ModuleComingSoon />} />
            <Route path="companies" element={<Companies />} />
            <Route path="companies/external" element={<ExternalClients />} />
            <Route path="companies/new" element={<CompanyForm />} />
            <Route path="companies/:id/edit" element={<CompanyForm />} />
            <Route path="companies/:id/statement" element={<CompanyStatement />} />
            <Route path="companies/:companyID/contacts" element={<CompanyContacts />} />
            <Route path="companies/:companyID/contacts/new" element={<CompanyContactForm />} />
            <Route path="companies/:companyID/contacts/:id/edit" element={<CompanyContactForm />} />
            <Route path="documents" element={<Documents />} />
            <Route path="tax-settlements" element={<TaxSettlements />} />
            <Route path="tax-settlements/new" element={<TaxSettlementNew />} />
            <Route path="tax-settlements/:id/edit" element={<TaxSettlementNew />} />
            <Route path="tax-settlements/:id" element={<TaxSettlementDetail />} />
            <Route path="comprobantes" element={<Comprobantes />} />
            <Route path="tukifac/documentos" element={<Navigate to="/comprobantes" replace />} />
            <Route path="documents/tukifac" element={<Navigate to="/comprobantes" replace />} />
            <Route path="documents/fiscal-receipts" element={<FiscalReceipts />} />
            <Route path="fiscal-receipts" element={<Navigate to="/comprobantes?status=pendiente_vincular" replace />} />
            <Route path="plan-categories" element={<PlanCategories />} />
            <Route path="plan-categories/new" element={<PlanCategoryForm />} />
            <Route path="plan-categories/:id/edit" element={<PlanCategoryForm />} />
            <Route path="subscription-plans" element={<SubscriptionPlansList />} />
            <Route path="subscription-plans/new" element={<SubscriptionPlanForm />} />
            <Route path="subscription-plans/:id/edit" element={<SubscriptionPlanForm />} />
            <Route path="products" element={<Products />} />
            <Route path="products/new" element={<ProductForm />} />
            <Route path="products/:id/edit" element={<ProductForm />} />
            <Route path="documents/new" element={<DocumentForm />} />
            <Route path="documents/:id/edit" element={<DocumentForm />} />
            <Route path="payments" element={<Payments />} />
            <Route path="payments/new" element={<PaymentForm />} />
            <Route path="payments/:id/edit" element={<PaymentForm />} />
            <Route path="reports/financial" element={<Reports />} />
            <Route path="supervisors/dashboard" element={<SupervisorDashboard />} />
            <Route path="supervisors/periods" element={<SupervisorPeriods />} />
            <Route path="supervisors/companies" element={<SupervisorCompaniesPage />} />
            <Route path="supervisors/liquidaciones" element={<SupervisorLiquidacionesListPage />} />
            <Route path="supervisors/liquidaciones/crear/:companyId" element={<SupervisorLiquidacionCreatePage />} />
            <Route path="supervisors/liquidaciones/editar/:settlementId" element={<SupervisorLiquidacionCreatePage />} />
            <Route path="supervisors/liquidaciones/ver/:settlementId" element={<SupervisorLiquidacionCreatePage />} />
            <Route path="supervisors/activities" element={<Navigate to="/supervisors/dashboard" replace />} />
            <Route path="supervisors/activities/pdt-601" element={<SupervisorPdt601ListPage />} />
            <Route path="supervisors/activities/pdt-601/:companyId" element={<SupervisorPdt601DetailPage />} />
            <Route path="supervisors/activities/pdt-621" element={<SupervisorPdt621ListPage />} />
            <Route path="supervisors/activities/pdt-621/:companyId" element={<SupervisorPdt621DetailPage />} />
            <Route path="supervisors/activities/sunat-inbox" element={<SupervisorSunatInboxListPage />} />
            <Route path="supervisors/activities/sunat-inbox/:companyId" element={<SupervisorSunatInboxDetailPage />} />
            <Route path="supervisors/activities/detracciones" element={<SupervisorDetraccionesListPage />} />
            <Route path="supervisors/activities/detracciones/:companyId" element={<SupervisorDetraccionesDetailPage />} />
            <Route path="supervisors/activities/distractions" element={<LegacyDetraccionesRedirect workspace="supervisor" />} />
            <Route path="supervisors/activities/distractions/:companyId" element={<LegacyDetraccionesRedirect workspace="supervisor" />} />
            <Route path="supervisors/controls" element={<Navigate to="/supervisors/dashboard" replace />} />
            <Route path="supervisors/controls/:id" element={<SupervisorControlDetail />} />
            <Route path="supervisors/reports" element={<SupervisorReports />} />
            <Route path="supervisors/notifications" element={<SupervisorNotifications />} />
            <Route path="finance/calendar" element={<FinanceCalendar />} />
            <Route path="finance/activity-templates">
              <Route index element={<ActivityTemplates />} />
              <Route path="new" element={<ActivityTemplateForm />} />
              <Route path=":id/edit" element={<ActivityTemplateForm />} />
            </Route>
            <Route path="finance/claves-sol" element={<CompanyAccessCredentials />} />
            <Route path="assistant" element={<AssistantWorkspace />} />
            <Route path="assistant/companies" element={<AssistantCompaniesPage />} />
            <Route path="assistant/activities" element={<Navigate to="/assistant" replace />} />
            <Route path="assistant/activities/pdt-601" element={<AssistantPdt601ListPage />} />
            <Route path="assistant/activities/pdt-601/:companyId" element={<AssistantPdt601DetailPage />} />
            <Route path="assistant/activities/pdt-621" element={<AssistantPdt621ListPage />} />
            <Route path="assistant/activities/pdt-621/:companyId" element={<AssistantPdt621DetailPage />} />
            <Route path="assistant/activities/sunat-inbox" element={<AssistantSunatInboxListPage />} />
            <Route path="assistant/activities/sunat-inbox/:companyId" element={<AssistantSunatInboxDetailPage />} />
            <Route path="assistant/activities/detracciones" element={<AssistantDetraccionesListPage />} />
            <Route path="assistant/activities/detracciones/:companyId" element={<AssistantDetraccionesDetailPage />} />
            <Route path="assistant/activities/distractions" element={<LegacyDetraccionesRedirect workspace="assistant" />} />
            <Route path="assistant/activities/distractions/:companyId" element={<LegacyDetraccionesRedirect workspace="assistant" />} />
            <Route path="assistant/notifications" element={<SupervisorNotifications />} />
            <Route path="assistant/controls" element={<Navigate to="/assistant" replace />} />
            <Route path="assistant/controls/:id" element={<SupervisorControlDetail />} />
            <Route path="pos" element={<PosSale />} />
            <Route path="pos/history" element={<PosHistory />} />
            <Route path="settings/firm" element={<Settings />} />
            <Route path="settings/activity-configuration" element={<ActivityConfigurationSettings />} />
            <Route path="settings/fiscal-series" element={<FiscalDocumentSeries />} />
            <Route path="users" element={<Users />} />
            <Route path="users/roles" element={<RolePermissions />} />
            <Route path="users/new" element={<UserForm />} />
            <Route path="users/:id/edit" element={<UserForm />} />
            
            {/* Rutas anidadas para formularios (por ahora placeholders) */}
            <Route path="profile" element={<Placeholder title="Mi Perfil" />} />
          </Route>
        </Route>
      </Routes>
    </Router>
  );
}

export default App;
