import { Routes, Route, Navigate } from 'react-router-dom';
import LoginPage from './pages/auth/LoginPage';
import RegisterPage from './pages/auth/RegisterPage';
import QRMenuPage from './pages/qr-menu/QRMenuPage';
import DashboardPage from './pages/DashboardPage';
import POSPage from './pages/pos/POSPage';
import KitchenDisplayPage from './pages/kitchen/KitchenDisplayPage';
import MenuManagementPage from './pages/admin/MenuManagementPage';
import TableManagementPage from './pages/admin/TableManagementPage';
import UserManagementPage from './pages/admin/UserManagementPage';
import ReportsPage from './pages/admin/ReportsPage';
import SubscriptionPlansPage from './pages/subscription/SubscriptionPlansPage';
import SubscriptionManagementPage from './pages/subscription/SubscriptionManagementPage';
import SubscriptionPaymentPage from './pages/subscription/SubscriptionPaymentPage';
import Layout from './components/layout/Layout';
import ProtectedRoute from './components/ProtectedRoute';

function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/qr-menu/:tenantId" element={<QRMenuPage />} />

      <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/pos" element={<POSPage />} />
        <Route path="/kitchen" element={<KitchenDisplayPage />} />
        <Route path="/admin/menu" element={<MenuManagementPage />} />
        <Route path="/admin/tables" element={<TableManagementPage />} />
        <Route path="/admin/users" element={<UserManagementPage />} />
        <Route path="/admin/reports" element={<ReportsPage />} />
        <Route path="/subscription/plans" element={<SubscriptionPlansPage />} />
        <Route path="/subscription/manage" element={<SubscriptionManagementPage />} />
        <Route path="/subscription/payment" element={<SubscriptionPaymentPage />} />
      </Route>
    </Routes>
  );
}

export default App;
