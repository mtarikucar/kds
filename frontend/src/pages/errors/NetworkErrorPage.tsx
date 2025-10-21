import { useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';

export default function NetworkErrorPage() {
  const navigate = useNavigate();
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [isRetrying, setIsRetrying] = useState(false);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const handleRetry = async () => {
    setIsRetrying(true);
    try {
      const response = await fetch('/api/health', { method: 'HEAD' });
      if (response.ok) {
        window.location.reload();
      }
    } catch (error) {
      // Still offline
      setIsRetrying(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="max-w-md w-full text-center">
        {/* Network Icon */}
        <div className="mb-8">
          <div className="mx-auto h-32 w-32 flex items-center justify-center rounded-full bg-yellow-100">
            <svg
              className="h-20 w-20 text-yellow-600"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M18.364 5.636a9 9 0 010 12.728m0 0l-2.829-2.829m2.829 2.829L21 21M15.536 8.464a5 5 0 010 7.072m0 0l-2.829-2.829m-4.243 2.829a4.978 4.978 0 01-1.414-2.83m-1.414 5.658a9 9 0 01-2.167-9.238m7.824 2.167a1 1 0 111.414 1.414m-1.414-1.414L3 3m8.293 8.293l1.414 1.414"
              />
            </svg>
          </div>
        </div>

        {/* Content */}
        <h2 className="text-2xl font-bold text-gray-900 mb-2">
          {isOnline ? 'Connection Error' : 'No Internet Connection'}
        </h2>
        <p className="text-gray-600 mb-8">
          {isOnline
            ? 'Unable to reach the server. The service might be temporarily unavailable.'
            : 'Please check your internet connection and try again.'}
        </p>

        {/* Status indicator */}
        <div className="mb-6">
          <div className="flex items-center justify-center space-x-2">
            <div
              className={`h-3 w-3 rounded-full ${
                isOnline ? 'bg-yellow-500' : 'bg-red-500'
              } animate-pulse`}
            />
            <span className="text-sm text-gray-600">
              {isOnline ? 'Server Unreachable' : 'Offline'}
            </span>
          </div>
        </div>

        {/* Actions */}
        <div className="space-y-3">
          <button
            onClick={handleRetry}
            disabled={isRetrying}
            className="w-full flex justify-center items-center py-3 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-yellow-600 hover:bg-yellow-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-yellow-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isRetrying ? (
              <>
                <svg
                  className="animate-spin -ml-1 mr-2 h-4 w-4 text-white"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  ></circle>
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  ></path>
                </svg>
                Retrying...
              </>
            ) : (
              <>
                <svg
                  className="mr-2 h-4 w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                  />
                </svg>
                Try Again
              </>
            )}
          </button>

          <button
            onClick={() => navigate('/')}
            className="w-full flex justify-center py-3 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-yellow-500 transition-colors"
          >
            Go to Homepage
          </button>
        </div>

        {/* Tips */}
        <div className="mt-8 p-4 bg-yellow-50 rounded-lg text-left">
          <p className="text-sm font-medium text-yellow-800 mb-2">Troubleshooting tips:</p>
          <ul className="text-xs text-yellow-700 space-y-1 list-disc list-inside">
            <li>Check your Wi-Fi or mobile data connection</li>
            <li>Try disabling VPN if you're using one</li>
            <li>Clear your browser cache and cookies</li>
            <li>Contact support if the problem persists</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
