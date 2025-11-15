import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/Card';
import Button from './ui/Button';
import Input from './ui/Input';
import { CheckCircle2, Mail, RefreshCw } from 'lucide-react';
import { useVerifyEmail, useResendVerificationEmail } from '../features/auth/authApi';

interface EmailVerificationCardProps {
  emailVerified: boolean;
  userEmail: string;
}

export function EmailVerificationCard({ emailVerified, userEmail }: EmailVerificationCardProps) {
  const [code, setCode] = useState('');
  const verifyMutation = useVerifyEmail();
  const resendMutation = useResendVerificationEmail();

  const handleVerify = () => {
    if (code.length === 6) {
      verifyMutation.mutate(code);
    }
  };

  const handleResend = () => {
    resendMutation.mutate();
    setCode(''); // Clear the code input
  };

  const handleCodeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/\D/g, '').slice(0, 6);
    setCode(value);
  };

  if (emailVerified) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-green-600" />
            Email Doğrulandı
          </CardTitle>
          <CardDescription>
            Email adresiniz ({userEmail}) başarıyla doğrulandı.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mail className="h-5 w-5" />
          Email Doğrulama
        </CardTitle>
        <CardDescription>
          Email adresinizi doğrulayarak tüm özelliklere erişebilirsiniz.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="bg-blue-50 border border-blue-200 rounded p-3 text-sm">
          <p className="text-blue-800">
            <strong>{userEmail}</strong> adresine gönderilen 6 haneli doğrulama kodunu girin.
          </p>
        </div>

        <div className="space-y-2">
          <label htmlFor="verification-code" className="text-sm font-medium">
            Doğrulama Kodu
          </label>
          <div className="flex gap-2">
            <Input
              id="verification-code"
              type="text"
              inputMode="numeric"
              placeholder="123456"
              value={code}
              onChange={handleCodeChange}
              maxLength={6}
              className="text-center text-2xl font-mono tracking-widest"
              disabled={verifyMutation.isPending}
            />
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-2">
          <Button
            onClick={handleVerify}
            disabled={code.length !== 6}
            isLoading={verifyMutation.isPending}
            className="flex-1"
          >
            Doğrula
          </Button>
          <Button
            variant="outline"
            onClick={handleResend}
            isLoading={resendMutation.isPending}
            className="flex-1"
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${resendMutation.isPending ? 'animate-spin' : ''}`} />
            Yeniden Gönder
          </Button>
        </div>

        <div className="text-xs text-muted-foreground space-y-1">
          <p>• Kod 1 saat içinde geçerlidir</p>
          <p>• Kod email ve uygulama içi bildirim olarak gönderilmiştir</p>
          <p>• Kodu alamadıysanız "Yeniden Gönder" butonuna tıklayın</p>
        </div>
      </CardContent>
    </Card>
  );
}
