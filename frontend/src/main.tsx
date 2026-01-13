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

// Google OAuth Client ID
const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';

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

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <I18nextProvider i18n={i18n}>
      <GoogleOAuthProvider clientId={googleClientId}>
        <ErrorBoundary>
          <QueryClientProvider client={queryClient}>
            <BrowserRouter basename={routerBasename}>
              <App />
              <Toaster position="top-right" richColors />
            </BrowserRouter>
          </QueryClientProvider>
        </ErrorBoundary>
      </GoogleOAuthProvider>
    </I18nextProvider>
  </React.StrictMode>
);
