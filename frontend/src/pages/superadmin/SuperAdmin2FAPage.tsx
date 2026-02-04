import { useState, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { useSuperAdminAuthStore } from '../../store/superAdminAuthStore';
import { useVerify2FA, useSetup2FAWithToken, useEnable2FAWithToken } from '../../features/superadmin/api/superAdminApi';

export default function SuperAdmin2FAPage() {
  const [code, setCode] = useState('');
  const [qrData, setQrData] = useState<{ secret: string; qrCodeUrl: string } | null>(null);
  const {
    isAuthenticated,
    requires2FA,
    requires2FASetup,
    tempToken,
    logout
  } = useSuperAdminAuthStore();

  const verify2FAMutation = useVerify2FA();
  const setup2FAMutation = useSetup2FAWithToken();
  const enable2FAMutation = useEnable2FAWithToken();

  useEffect(() => {
    if (requires2FASetup && tempToken && !qrData) {
      setup2FAMutation.mutate(tempToken, {
        onSuccess: (data) => {
          setQrData(data);
        },
      });
    }
  }, [requires2FASetup, tempToken]);

  if (isAuthenticated && !requires2FA && !requires2FASetup) {
    return <Navigate to="/superadmin/dashboard" replace />;
  }

  if (!requires2FA && !requires2FASetup) {
    return <Navigate to="/superadmin/login" replace />;
  }

  if (!tempToken) {
    return <Navigate to="/superadmin/login" replace />;
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (requires2FASetup) {
      enable2FAMutation.mutate({ tempToken, code });
    } else {
      verify2FAMutation.mutate({ tempToken, code });
    }
  };

  const handleCancel = () => {
    logout();
  };

  const isLoading = verify2FAMutation.isPending || enable2FAMutation.isPending || setup2FAMutation.isPending;
  const error = verify2FAMutation.error || enable2FAMutation.error || setup2FAMutation.error;

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
            <h1 className="text-xl font-semibold text-zinc-900">
              {requires2FASetup ? 'Setup 2FA' : 'Two-Factor Authentication'}
            </h1>
            <p className="text-sm text-zinc-500 mt-1">
              {requires2FASetup
                ? 'Scan the QR code with your authenticator'
                : 'Enter the code from your authenticator'}
            </p>
          </div>

          {/* QR Code for setup mode */}
          {requires2FASetup && (
            <div className="mb-6">
              {setup2FAMutation.isPending ? (
                <div className="flex justify-center py-8">
                  <div className="w-8 h-8 border-2 border-zinc-200 border-t-zinc-900 rounded-full animate-spin" />
                </div>
              ) : qrData ? (
                <div className="space-y-4">
                  <div className="flex justify-center">
                    <div className="bg-white p-3 rounded-xl border border-zinc-200">
                      <img
                        src={qrData.qrCodeUrl}
                        alt="2FA QR Code"
                        className="w-40 h-40"
                      />
                    </div>
                  </div>
                  <div className="bg-zinc-50 rounded-lg p-3">
                    <p className="text-xs text-zinc-500 mb-1.5">Manual entry code:</p>
                    <code className="text-xs font-mono text-zinc-700 break-all select-all">
                      {qrData.secret}
                    </code>
                  </div>
                </div>
              ) : null}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="bg-red-50 border border-red-100 text-red-600 text-sm px-4 py-3 rounded-lg">
                {(error as any)?.response?.data?.message || 'Verification failed'}
              </div>
            )}

            <div>
              <label htmlFor="code" className="block text-sm font-medium text-zinc-700 mb-1.5">
                Verification Code
              </label>
              <input
                id="code"
                name="code"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                required
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                className="w-full px-3.5 py-3 bg-white border border-zinc-300 rounded-lg text-zinc-900 text-center text-xl font-mono tracking-[0.5em] placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent transition-shadow"
                placeholder="000000"
              />
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={handleCancel}
                className="flex-1 bg-white border border-zinc-300 text-zinc-700 py-2.5 px-4 rounded-lg text-sm font-medium hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-zinc-500 focus:ring-offset-2 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isLoading || code.length !== 6}
                className="flex-1 bg-zinc-900 text-white py-2.5 px-4 rounded-lg text-sm font-medium hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isLoading ? 'Verifying...' : requires2FASetup ? 'Enable 2FA' : 'Verify'}
              </button>
            </div>
          </form>
        </div>

        <p className="text-center text-xs text-zinc-400 mt-6">
          KDS Platform Administration
        </p>
      </div>
    </div>
  );
}
