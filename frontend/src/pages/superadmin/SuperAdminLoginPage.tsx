import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useSuperAdminAuthStore } from '../../store/superAdminAuthStore';
import { useSuperAdminLogin } from '../../features/superadmin/api/superAdminApi';

export default function SuperAdminLoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { isAuthenticated, requires2FA, requires2FASetup } = useSuperAdminAuthStore();
  const loginMutation = useSuperAdminLogin();

  if (isAuthenticated) {
    return <Navigate to="/superadmin/dashboard" replace />;
  }

  if (requires2FA || requires2FASetup) {
    return <Navigate to="/superadmin/2fa" replace />;
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    loginMutation.mutate({ email, password });
  };

  return (
    <div className="min-h-screen bg-zinc-50 flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex justify-center mb-8">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 bg-zinc-900 rounded-xl flex items-center justify-center">
              <span className="text-white text-lg font-semibold">K</span>
            </div>
            <span className="text-zinc-900 text-xl font-semibold tracking-tight">KDS Admin</span>
          </div>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl border border-zinc-200 p-8">
          <div className="text-center mb-6">
            <h1 className="text-xl font-semibold text-zinc-900">Welcome back</h1>
            <p className="text-sm text-zinc-500 mt-1">Sign in to your admin account</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {loginMutation.isError && (
              <div className="bg-red-50 border border-red-100 text-red-600 text-sm px-4 py-3 rounded-lg">
                {(loginMutation.error as any)?.response?.data?.message || 'Invalid credentials'}
              </div>
            )}

            <div>
              <label htmlFor="email" className="block text-sm font-medium text-zinc-700 mb-1.5">
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-white border border-zinc-300 rounded-lg text-zinc-900 text-sm placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent transition-shadow"
                placeholder="admin@example.com"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-zinc-700 mb-1.5">
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-white border border-zinc-300 rounded-lg text-zinc-900 text-sm placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent transition-shadow"
                placeholder="••••••••"
              />
            </div>

            <button
              type="submit"
              disabled={loginMutation.isPending}
              className="w-full bg-zinc-900 text-white py-2.5 px-4 rounded-lg text-sm font-medium hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loginMutation.isPending ? 'Signing in...' : 'Sign in'}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-zinc-400 mt-6">
          KDS Platform Administration
        </p>
      </div>
    </div>
  );
}
