import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useVerifyEmail, useResendVerificationEmail } from '../../features/auth/authApi';
import Button from '../../components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card';
import { useAuthStore } from '../../store/authStore';

const VerifyEmailPage = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);

  const [verificationState, setVerificationState] = useState<'verifying' | 'success' | 'error'>('verifying');
  const [errorMessage, setErrorMessage] = useState<string>('');

  const { mutate: verifyEmail } = useVerifyEmail();
  const { mutate: resendVerification, isPending: isResending } = useResendVerificationEmail();

  useEffect(() => {
    if (token) {
      // Verify the email with the token from URL
      verifyEmail(token, {
        onSuccess: () => {
          setVerificationState('success');
          // Redirect to dashboard if authenticated, or login if not
          setTimeout(() => {
            navigate(isAuthenticated ? '/dashboard' : '/login');
          }, 3000);
        },
        onError: (error: any) => {
          setVerificationState('error');
          setErrorMessage(
            error.response?.data?.message ||
            'Email verification failed. The link may be expired or invalid.'
          );
        },
      });
    } else if (!isAuthenticated) {
      // No token and not authenticated - redirect to login
      navigate('/login');
    }
    // If no token but authenticated, show resend verification option
  }, [token, verifyEmail, navigate, isAuthenticated]);

  const handleResendVerification = () => {
    resendVerification();
  };

  // Verifying state
  if (verificationState === 'verifying' && token) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="text-center text-2xl">Verifying Email</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-center">
              <div className="mx-auto w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mb-4 animate-pulse">
                <svg
                  className="w-8 h-8 text-blue-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              </div>
              <p className="text-gray-600">Please wait while we verify your email...</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Success state
  if (verificationState === 'success') {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="text-center text-2xl">Email Verified</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="text-center">
                <div className="mx-auto w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-4">
                  <svg
                    className="w-8 h-8 text-green-600"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                </div>
                <p className="text-gray-600 mb-4">
                  Your email has been successfully verified!
                </p>
                <p className="text-sm text-gray-500 mb-6">
                  Redirecting you now...
                </p>
              </div>

              <Link to={isAuthenticated ? '/dashboard' : '/login'}>
                <Button className="w-full">
                  {isAuthenticated ? 'Go to Dashboard' : 'Go to Login'}
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Error state
  if (verificationState === 'error') {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="text-center text-2xl">Verification Failed</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="text-center">
                <div className="mx-auto w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mb-4">
                  <svg
                    className="w-8 h-8 text-red-600"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </div>
                <p className="text-gray-600 mb-4">{errorMessage}</p>
              </div>

              {isAuthenticated && (
                <Button
                  onClick={handleResendVerification}
                  className="w-full"
                  isLoading={isResending}
                >
                  Resend Verification Email
                </Button>
              )}

              <div className="pt-4 border-t text-center space-y-2">
                <Link to="/login">
                  <Button variant="outline" className="w-full">
                    Back to Login
                  </Button>
                </Link>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Resend verification (no token, authenticated user)
  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-center text-2xl">Verify Your Email</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="text-center">
              <div className="mx-auto w-16 h-16 bg-yellow-100 rounded-full flex items-center justify-center mb-4">
                <svg
                  className="w-8 h-8 text-yellow-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                  />
                </svg>
              </div>
              <p className="text-gray-600 mb-4">
                Please verify your email address to access all features.
              </p>
              <p className="text-sm text-gray-500 mb-6">
                Check your inbox for the verification link or request a new one below.
              </p>
            </div>

            <Button
              onClick={handleResendVerification}
              className="w-full"
              isLoading={isResending}
            >
              Send Verification Email
            </Button>

            <div className="pt-4 border-t text-center">
              <Link to="/dashboard">
                <Button variant="outline" className="w-full">
                  Back to Dashboard
                </Button>
              </Link>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default VerifyEmailPage;
