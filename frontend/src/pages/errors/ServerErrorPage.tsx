import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

export default function ServerErrorPage() {
  const navigate = useNavigate();
  const { t } = useTranslation('errors');

  const handleReload = () => {
    window.location.reload();
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="max-w-md w-full text-center">
        {/* 500 Icon */}
        <div className="mb-8">
          <h1 className="text-9xl font-extrabold text-red-600">500</h1>
          <div className="mt-4">
            <svg
              className="mx-auto h-32 w-32 text-gray-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1}
                d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
        </div>

        {/* Content */}
        <h2 className="text-2xl font-bold text-gray-900 mb-2">{t('pages.serverError.title')}</h2>
        <p className="text-gray-600 mb-8">
          {t('pages.serverError.description')}
        </p>

        {/* Actions */}
        <div className="space-y-3">
          <button
            onClick={handleReload}
            className="w-full flex justify-center items-center py-3 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 transition-colors"
          >
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
            {t('app:buttons.reload')}
          </button>

          <button
            onClick={() => navigate('/')}
            className="w-full flex justify-center py-3 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 transition-colors"
          >
            {t('pages.serverError.goHome')}
          </button>
        </div>

        {/* Status */}
        <div className="mt-8 p-4 bg-red-50 rounded-lg">
          <p className="text-sm text-red-800">
            {t('errors:serverError')} - Internal Server Error
          </p>
          <p className="text-xs text-red-600 mt-1">
            {t('pages.serverError.contactSupport')}
          </p>
        </div>
      </div>
    </div>
  );
}
