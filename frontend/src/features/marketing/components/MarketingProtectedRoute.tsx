import { useEffect } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useMarketingAuthStore } from '../../../store/marketingAuthStore';

export default function MarketingProtectedRoute() {
  const { isAuthenticated, accessToken, logout } = useMarketingAuthStore();

  useEffect(() => {
    if (accessToken) {
      try {
        const payload = JSON.parse(atob(accessToken.split('.')[1]));
        if (payload.exp * 1000 < Date.now()) {
          logout();
        }
      } catch {
        logout();
      }
    }
  }, [accessToken, logout]);

  if (!isAuthenticated) {
    return <Navigate to="/marketing/login" replace />;
  }

  return <Outlet />;
}
