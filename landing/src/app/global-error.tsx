'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

interface GlobalErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function GlobalError({ error, reset }: GlobalErrorProps) {
  useEffect(() => {
    // Log the error to Sentry
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'linear-gradient(to bottom right, #0f172a, #1e293b)',
          }}
        >
          <div
            style={{
              maxWidth: '28rem',
              margin: '0 auto',
              textAlign: 'center',
              padding: '0 1.5rem',
            }}
          >
            <div style={{ marginBottom: '2rem' }}>
              <div
                style={{
                  width: '5rem',
                  height: '5rem',
                  margin: '0 auto',
                  backgroundColor: 'rgba(239, 68, 68, 0.1)',
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <svg
                  style={{ width: '2.5rem', height: '2.5rem', color: '#ef4444' }}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                  />
                </svg>
              </div>
            </div>

            <h1 style={{ fontSize: '1.875rem', fontWeight: 'bold', color: 'white', marginBottom: '1rem' }}>
              Something went wrong
            </h1>

            <p style={{ color: '#94a3b8', marginBottom: '2rem' }}>
              We apologize for the inconvenience. Our team has been notified and is working to fix the issue.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', justifyContent: 'center' }}>
              <button
                onClick={reset}
                style={{
                  padding: '0.75rem 1.5rem',
                  backgroundColor: '#f97316',
                  color: 'white',
                  fontWeight: '500',
                  borderRadius: '0.5rem',
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                Try Again
              </button>

              <a
                href="/"
                style={{
                  padding: '0.75rem 1.5rem',
                  backgroundColor: '#334155',
                  color: 'white',
                  fontWeight: '500',
                  borderRadius: '0.5rem',
                  textDecoration: 'none',
                }}
              >
                Go Home
              </a>
            </div>

            {/* Error details for debugging */}
            <div style={{
              marginTop: '1.5rem',
              textAlign: 'left',
              backgroundColor: 'rgba(30,41,59,0.5)',
              borderRadius: '0.5rem',
              padding: '1rem',
              border: '1px solid #334155',
              maxHeight: '16rem',
              overflowY: 'auto',
            }}>
              <p style={{ fontSize: '0.75rem', color: '#f87171', fontFamily: 'monospace', fontWeight: 700, marginBottom: '0.25rem' }}>
                {error.name}: {error.message}
              </p>
              {error.digest && (
                <p style={{ fontSize: '0.75rem', color: '#64748b', fontFamily: 'monospace', marginBottom: '0.5rem' }}>
                  Digest: {error.digest}
                </p>
              )}
              {error.stack && (
                <pre style={{ fontSize: '0.625rem', color: '#64748b', fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-all', lineHeight: 1.5 }}>
                  {error.stack}
                </pre>
              )}
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}
