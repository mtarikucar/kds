import { Navigate, Outlet } from 'react-router-dom';
import { useMarketingAuthStore } from '../../../store/marketingAuthStore';

export default function MarketingProtectedRoute() {
  const { isAuthenticated } = useMarketingAuthStore();

  if (!isAuthenticated) {
    return <Navigate to="/marketing/login" replace />;
  }

  return <Outlet />;
}
