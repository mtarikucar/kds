import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GoogleOAuthProvider } from '@react-oauth/google';
import { Toaster } from 'sonner';
import { I18nextProvider } from 'react-i18next';
import ErrorBoundary from './components/ErrorBoundary';
import App from './App';
import i18n from './i18n/config';
import { initSentry } from './sentry.config';
import './index.css';

// Initialize Sentry as early as possible
initSentry();

// Google OAuth Client ID - validate format (should not contain @ and should end with .apps.googleusercontent.com)
const rawGoogleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';
const isValidGoogleClientId = rawGoogleClientId &&
  !rawGoogleClientId.includes('@') &&
  rawGoogleClientId.endsWith('.apps.googleusercontent.com');
const googleClientId = isValidGoogleClientId ? rawGoogleClientId : '';

if (!isValidGoogleClientId && rawGoogleClientId) {
  console.warn('Invalid Google Client ID format detected. Google Sign-In will be disabled.');
}

// Router basename - use /app for web builds, empty for Tauri desktop
const routerBasename = import.meta.env.BASE_URL === '/' ? undefined : import.meta.env.BASE_URL.replace(/\/$/, '');

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 5 * 60 * 1000, // 5 minutes
    },
  },
});

// Wrapper component that conditionally includes Google OAuth
const AppWithProviders = ({ children }: { children: React.ReactNode }) => {
  if (googleClientId) {
    return <GoogleOAuthProvider clientId={googleClientId}>{children}</GoogleOAuthProvider>;
  }
  return <>{children}</>;
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <I18nextProvider i18n={i18n}>
      <AppWithProviders>
        <ErrorBoundary>
          <QueryClientProvider client={queryClient}>
            <BrowserRouter basename={routerBasename}>
              <App />
              <Toaster position="top-right" richColors />
            </BrowserRouter>
          </QueryClientProvider>
        </ErrorBoundary>
      </AppWithProviders>
    </I18nextProvider>
  </React.StrictMode>
);
