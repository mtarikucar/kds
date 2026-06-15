import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GoogleOAuthProvider } from '@react-oauth/google';
import { Toaster } from 'sonner';
import { I18nextProvider } from 'react-i18next';
import * as Sentry from '@sentry/react';
import ErrorBoundary from './components/ErrorBoundary';
import { ActionableErrorProvider } from './components/common/actionable-errors/ActionableErrorProvider';
import App from './App';
import i18n from './i18n/config';
import { initSentry } from './sentry.config';
import { detectSubdomain } from './utils/subdomain';
import './index.css';

// Initialize Sentry as early as possible
initSentry();

// React's <ErrorBoundary> only catches errors thrown during render. Promise
// rejections and async listener exceptions slip past it entirely. Forward
// both to Sentry so async failures surface in the same dashboard as render
// errors instead of disappearing into the console.
window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason;
  const err = reason instanceof Error ? reason : new Error(String(reason));
  Sentry.captureException(err, { tags: { source: 'unhandledrejection' } });
});
window.addEventListener('error', (event) => {
  // event.error can be null if a non-Error was thrown (e.g. a string).
  const err = event.error instanceof Error ? event.error : new Error(event.message);
  Sentry.captureException(err, { tags: { source: 'window.onerror' } });
});

// Google OAuth Client ID
const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';

// Detect if we're accessing via subdomain
const subdomainInfo = detectSubdomain();

// Router basename - subdomain access uses root path, normal access uses /app
const routerBasename = subdomainInfo.isSubdomainAccess
  ? undefined
  : (import.meta.env.BASE_URL === '/' ? undefined : import.meta.env.BASE_URL.replace(/\/$/, ''));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 5 * 60 * 1000, // 5 minutes
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <I18nextProvider i18n={i18n}>
      <GoogleOAuthProvider clientId={googleClientId}>
        <ErrorBoundary>
          <QueryClientProvider client={queryClient}>
            <BrowserRouter basename={routerBasename}>
              <ActionableErrorProvider>
                <App />
              </ActionableErrorProvider>
              <Toaster position="top-right" richColors />
            </BrowserRouter>
          </QueryClientProvider>
        </ErrorBoundary>
      </GoogleOAuthProvider>
    </I18nextProvider>
  </React.StrictMode>
);
