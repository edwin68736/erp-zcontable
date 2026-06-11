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
import Users from './pages/Users';
import UserForm from './pages/UserForm';
import RolePermissions from './pages/RolePermissions';
import Login from './pages/Login';
import Placeholder from './pages/Placeholder';
import ModuleComingSoon from './pages/ModuleComingSoon';
import SupervisorDashboard from './pages/supervisors/SupervisorDashboard';
import SupervisorPeriods from './pages/supervisors/SupervisorPeriods';
import SupervisorControls from './pages/supervisors/SupervisorControls';
import SupervisorControlDetail from './pages/supervisors/SupervisorControlDetail';
import SupervisorReports from './pages/supervisors/SupervisorReports';
import SupervisorNotifications from './pages/supervisors/SupervisorNotifications';
import FinanceCalendar from './pages/finance/FinanceCalendar';
import CompanyAccessCredentials from './pages/finance/CompanyAccessCredentials';
import AssistantWorkspace from './pages/assistant/AssistantWorkspace';
import AssistantControls from './pages/assistant/AssistantControls';
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
            <Route path="supervisors/controls" element={<SupervisorControls />} />
            <Route path="supervisors/controls/:id" element={<SupervisorControlDetail />} />
            <Route path="supervisors/reports" element={<SupervisorReports />} />
            <Route path="supervisors/notifications" element={<SupervisorNotifications />} />
            <Route path="finance/calendar" element={<FinanceCalendar />} />
            <Route path="finance/claves-sol" element={<CompanyAccessCredentials />} />
            <Route path="assistant" element={<AssistantWorkspace />} />
            <Route path="assistant/controls" element={<AssistantControls />} />
            <Route path="assistant/controls/:id" element={<SupervisorControlDetail />} />
            <Route path="pos" element={<PosSale />} />
            <Route path="pos/history" element={<PosHistory />} />
            <Route path="settings/firm" element={<Settings />} />
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
