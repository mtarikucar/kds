import { useTranslation } from 'react-i18next';

export default function MaintenancePage() {
  const { t } = useTranslation('errors');
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-50 to-primary-100 px-4">
      <div className="max-w-md w-full text-center">
        {/* Maintenance Icon */}
        <div className="mb-8">
          <div className="mx-auto h-32 w-32 flex items-center justify-center rounded-full bg-white shadow-lg">
            <svg
              className="h-20 w-20 text-primary-500"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
          </div>
        </div>

        {/* Content */}
        <h1 className="text-3xl font-extrabold font-heading text-foreground mb-2">{t('pages.maintenance.title')}</h1>
        <p className="text-lg text-muted-foreground mb-8">
          {t('pages.maintenance.description')}
        </p>

        {/* Timeline */}
        <div className="mb-8 p-6 bg-white rounded-lg shadow-md">
          <div className="flex items-center justify-center space-x-2 mb-4">
            <svg
              className="h-5 w-5 text-primary-500 animate-spin"
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
            <span className="text-sm font-medium text-gray-700">{t('app:messages.pleaseWait')}</span>
          </div>
          <p className="text-sm text-gray-500">
            {t('pages.maintenance.expectedCompletion')}: <span className="font-semibold text-gray-700">{t('pages.maintenance.soon')}</span>
          </p>
        </div>

        {/* Info */}
        <div className="space-y-4 text-sm text-gray-600">
          <p>{t('pages.maintenance.apology')}</p>

          <div className="pt-4 border-t border-gray-200">
            <p className="font-medium text-gray-700 mb-2">{t('pages.maintenance.whatsHappening')}</p>
            <ul className="text-left space-y-2 max-w-xs mx-auto">
              <li className="flex items-start">
                <svg
                  className="h-5 w-5 text-primary-500 mr-2 flex-shrink-0"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
                <span>{t('pages.maintenance.upgrade1')}</span>
              </li>
              <li className="flex items-start">
                <svg
                  className="h-5 w-5 text-primary-500 mr-2 flex-shrink-0"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
                <span>{t('pages.maintenance.upgrade2')}</span>
              </li>
              <li className="flex items-start">
                <svg
                  className="h-5 w-5 text-primary-500 mr-2 flex-shrink-0"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
                <span>{t('pages.maintenance.upgrade3')}</span>
              </li>
            </ul>
          </div>
        </div>

        {/* Contact */}
        <div className="mt-8 p-4 bg-primary-50 rounded-lg">
          <p className="text-sm text-primary-800">
            {t('pages.maintenance.needHelp')}{' '}
            <a href="mailto:support@example.com" className="font-medium underline hover:text-primary-900 transition-colors duration-200">
              {t('pages.maintenance.contactSupport')}
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
