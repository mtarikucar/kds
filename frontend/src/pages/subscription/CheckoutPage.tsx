import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ShieldCheck, Lock, ExternalLink, Phone, X } from 'lucide-react';
import { useCreatePaymentIntent } from '../../api/paymentsApi';
import { useGetCurrentLegalDocument } from '../../features/legal/legalApi';
import { useUpdateProfile } from '../../features/users/usersApi';
import Spinner from '../../components/ui/Spinner';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import { BillingCycle } from '../../types';

const AUTO_REDIRECT_MS = 3000;

/**
 * Subscription checkout flow. Four phases:
 *   0. Legal consent — KVKK + Mesafeli Satış + İade Politikası. Tenant
 *      must tick all three before backend will mint a PayTR token. The
 *      ids of the *current* documents are submitted alongside planId so
 *      the backend can verify the user accepted the version they were
 *      actually shown (handled by ConsentService.verifyAndRecord).
 *   1. Create intent (spinner).
 *   2. Confirm screen (3s countdown to PayTR's hosted page).
 *   3. (Trial short-circuit) — skip phase 2 entirely.
 */
const CheckoutPage = () => {
  const { t } = useTranslation('subscriptions');
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const planId = params.get('planId');
  const billingCycle = (params.get('billingCycle') ?? BillingCycle.MONTHLY) as BillingCycle;
  const createIntent = useCreatePaymentIntent();

  // Phase 0 state — consent checkboxes
  const kvkkQ = useGetCurrentLegalDocument('KVKK');
  const distanceQ = useGetCurrentLegalDocument('DISTANCE_SALES');
  const refundQ = useGetCurrentLegalDocument('REFUND_POLICY');
  const [acceptedKvkk, setAcceptedKvkk] = useState(false);
  const [acceptedDistance, setAcceptedDistance] = useState(false);
  const [acceptedRefund, setAcceptedRefund] = useState(false);
  const allChecked = acceptedKvkk && acceptedDistance && acceptedRefund;
  const docsLoading = kvkkQ.isLoading || distanceQ.isLoading || refundQ.isLoading;
  const docsError = kvkkQ.error || distanceQ.error || refundQ.error;

  // Phase 1+ state
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paymentLink, setPaymentLink] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(AUTO_REDIRECT_MS / 1000);

  // Inline phone-prompt state: when the backend rejects the payment
  // intent with PROFILE_PHONE_REQUIRED, we collect the missing phone
  // here instead of bouncing the user to /profile. After save we
  // automatically re-fire handleSubmit so the checkout flow continues
  // without the user having to re-tick the consents or click again.
  const [phonePromptOpen, setPhonePromptOpen] = useState(false);
  const [phoneValue, setPhoneValue] = useState('');
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const { mutate: updateProfile, isPending: phoneSaving } = useUpdateProfile();

  useEffect(() => {
    if (!planId) navigate('/subscription/plans', { replace: true });
  }, [planId, navigate]);

  const submitIntent = () => {
    if (!planId || !kvkkQ.data || !distanceQ.data || !refundQ.data) return;
    createIntent.mutate(
      {
        planId,
        billingCycle,
        acceptedDocumentIds: [
          kvkkQ.data.id,
          distanceQ.data.id,
          refundQ.data.id,
        ],
      },
      {
        onSuccess: (data) => {
          if (data.provider === 'TRIAL') {
            navigate('/admin/settings/subscription', { replace: true });
            return;
          }
          if (data.paymentLink) {
            setPaymentLink(data.paymentLink);
          } else {
            setError(t('subscriptions.checkout.missingLink', 'Ödeme bağlantısı oluşturulamadı.'));
          }
        },
        onError: (err: any) => {
          const code = err?.response?.data?.code;
          if (code === 'PROFILE_PHONE_REQUIRED') {
            // Inline collection instead of redirecting to /profile. We
            // re-fire submitIntent() once the phone PATCH succeeds —
            // the user stays on the checkout page, keeps their consent
            // ticks, and doesn't have to navigate the page graph.
            setPhoneValue('');
            setPhoneError(null);
            setPhonePromptOpen(true);
            setSubmitted(false);
            return;
          }
          if (code === 'LEGAL_CONSENT_REQUIRED') {
            // Backend rejected our consent shape — surface the message so
            // the user re-reads the docs and re-checks. Reset submit lock.
            setSubmitted(false);
            setError(
              err?.response?.data?.message ??
                t(
                  'subscriptions.checkout.consentRequired',
                  'KVKK, Mesafeli Satış ve İade politikalarını onaylamanız gerekiyor.',
                ),
            );
            return;
          }
          setError(err?.response?.data?.message ?? err?.message ?? 'Payment intent failed');
        },
      },
    );
  };

  const handleSubmit = () => {
    if (!planId || !allChecked || submitted) return;
    if (!kvkkQ.data || !distanceQ.data || !refundQ.data) return;
    setSubmitted(true);
    submitIntent();
  };

  const handlePhoneSave = () => {
    const trimmed = phoneValue.trim();
    // Light validation: digits/+/spaces/dashes/parens, 7-20 chars. PayTR
    // will validate the strict format server-side; this just blocks the
    // obvious-typo paths so the user doesn't burn another round-trip.
    if (!/^[+0-9\s()-]{7,20}$/.test(trimmed)) {
      setPhoneError(
        t(
          'subscriptions.checkout.phoneInvalid',
          'Geçerli bir telefon numarası girin (örn. +90 555 123 45 67).',
        ),
      );
      return;
    }
    setPhoneError(null);
    updateProfile(
      { phone: trimmed },
      {
        onSuccess: () => {
          // Profile cache invalidated by the hook. Close + re-fire intent
          // immediately — user doesn't have to re-tick or re-click.
          setPhonePromptOpen(false);
          setSubmitted(true);
          submitIntent();
        },
        onError: (err: any) => {
          setPhoneError(
            err?.response?.data?.message ??
              t(
                'subscriptions.checkout.phoneSaveFailed',
                'Telefon kaydedilemedi. Lütfen tekrar deneyin.',
              ),
          );
        },
      },
    );
  };

  // Auto-redirect countdown for phase 2
  useEffect(() => {
    if (!paymentLink) return;
    const tick = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          clearInterval(tick);
          window.location.href = paymentLink;
          return 0;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(tick);
  }, [paymentLink]);

  if (error) {
    return (
      <div className="max-w-md mx-auto mt-20 text-center">
        <h1 className="text-2xl font-bold text-slate-900 mb-4">
          {t('subscriptions.checkout.errorTitle', 'Hata')}
        </h1>
        <p className="text-slate-600 mb-6">{error}</p>
        <Button variant="primary" onClick={() => navigate('/subscription/plans')}>
          {t('subscriptions.checkout.backToPlans', 'Planlara dön')}
        </Button>
      </div>
    );
  }

  // Phase 2: confirm screen.
  if (paymentLink) {
    return (
      <div className="max-w-md mx-auto mt-20 px-4">
        <div className="bg-white rounded-2xl shadow-lg p-8 text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-indigo-100 flex items-center justify-center">
            <ShieldCheck className="w-8 h-8 text-indigo-600" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 mb-2">
            {t('subscriptions.checkout.confirmTitle', 'Ödemeye yönlendiriliyorsunuz')}
          </h1>
          <p className="text-slate-600 mb-6">
            {t('subscriptions.checkout.confirmBody', 'PayTR güvenli ödeme sayfasına gidiyorsunuz.')}
          </p>
          <div className="flex items-center justify-center gap-2 text-sm text-slate-500 mb-6">
            <Lock className="w-4 h-4" />
            <span>{t('subscriptions.checkout.secureNote', 'Bağlantı SSL ile şifrelidir')}</span>
          </div>
          <Button
            variant="primary"
            className="w-full"
            onClick={() => {
              window.location.href = paymentLink;
            }}
          >
            {t('subscriptions.checkout.proceedNow', { seconds: countdown, defaultValue: `Şimdi öde (${countdown}sn)` })}
          </Button>
          <button
            onClick={() => navigate('/subscription/plans')}
            className="mt-3 text-sm text-slate-500 hover:text-slate-700 underline"
          >
            {t('subscriptions.checkout.cancel', 'Vazgeç')}
          </button>
        </div>
      </div>
    );
  }

  // Phase 1: creating intent
  if (submitted && createIntent.isPending) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh]">
        <Spinner size="lg" />
        <p className="mt-6 text-slate-600">
          {t('subscriptions.checkout.preparing', 'Ödeme hazırlanıyor...')}
        </p>
      </div>
    );
  }

  // Phase 0: legal consent
  if (docsLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh]">
        <Spinner size="lg" />
        <p className="mt-6 text-slate-600">
          {t('subscriptions.checkout.loadingConsents', 'Sözleşmeler yükleniyor...')}
        </p>
      </div>
    );
  }

  if (docsError) {
    return (
      <div className="max-w-md mx-auto mt-20 text-center">
        <h1 className="text-2xl font-bold text-slate-900 mb-4">
          {t('subscriptions.checkout.consentLoadErrorTitle', 'Sözleşmeler yüklenemedi')}
        </h1>
        <p className="text-slate-600 mb-6">
          {t(
            'subscriptions.checkout.consentLoadError',
            'KVKK, Mesafeli Satış ve İade politikaları yüklenirken bir sorun oluştu. Lütfen tekrar deneyin.',
          )}
        </p>
        <Button variant="primary" onClick={() => navigate('/subscription/plans')}>
          {t('subscriptions.checkout.backToPlans', 'Planlara dön')}
        </Button>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto mt-12 px-4 pb-16">
      <div className="bg-white rounded-2xl shadow-lg p-8">
        <div className="flex items-center gap-3 mb-6">
          <ShieldCheck className="w-7 h-7 text-indigo-600" />
          <h1 className="text-2xl font-bold text-slate-900">
            {t('subscriptions.checkout.consentTitle', 'Sözleşme Onayları')}
          </h1>
        </div>
        <p className="text-slate-600 mb-6">
          {t(
            'subscriptions.checkout.consentIntro',
            'Aboneliğinize devam edebilmek için aşağıdaki üç belgeyi onaylamanız gerekiyor. Tüm kutuları işaretledikten sonra "Devam et" butonu ile ödeme adımına geçebilirsiniz.',
          )}
        </p>

        <ConsentRow
          checked={acceptedKvkk}
          onChange={setAcceptedKvkk}
          docId="kvkk"
          label={t('subscriptions.checkout.consentKvkk', 'KVKK Aydınlatma Metni')}
          docLink="/legal/kvkk"
          version={kvkkQ.data?.version}
        />
        <ConsentRow
          checked={acceptedDistance}
          onChange={setAcceptedDistance}
          docId="distance"
          label={t('subscriptions.checkout.consentDistance', 'Mesafeli Satış Sözleşmesi')}
          docLink="/legal/distance-sales"
          version={distanceQ.data?.version}
        />
        <ConsentRow
          checked={acceptedRefund}
          onChange={setAcceptedRefund}
          docId="refund"
          label={t('subscriptions.checkout.consentRefund', 'İade Politikası ve 14 Gün Cayma Hakkı')}
          docLink="/legal/refund-policy"
          version={refundQ.data?.version}
        />

        <div className="mt-8 flex items-center gap-3">
          <Button
            variant="primary"
            className="flex-1"
            disabled={!allChecked || submitted}
            onClick={handleSubmit}
          >
            {t('subscriptions.checkout.proceedToPayment', 'Devam et — Ödemeye geç')}
          </Button>
          <button
            onClick={() => navigate('/subscription/plans')}
            className="text-sm text-slate-500 hover:text-slate-700 underline"
          >
            {t('subscriptions.checkout.cancel', 'Vazgeç')}
          </button>
        </div>

        <p className="mt-6 text-xs text-slate-500 text-center">
          {t(
            'subscriptions.checkout.consentLegalFooter',
            'Onayınız KVKK denetimi için cihaz bilginiz ve IP adresinizle birlikte kayıt altına alınır.',
          )}
        </p>
      </div>

      {/* Phone-prompt modal. Opens when the backend rejects the payment
          intent with PROFILE_PHONE_REQUIRED. We collect the phone here,
          PATCH it to the user's profile, and auto-resume the intent —
          no navigation away from checkout. */}
      {phonePromptOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center">
                  <Phone className="w-5 h-5 text-indigo-600" />
                </div>
                <h2 className="text-lg font-semibold text-slate-900">
                  {t('subscriptions.checkout.phonePromptTitle', 'Telefon numarası gerekli')}
                </h2>
              </div>
              <button
                onClick={() => {
                  setPhonePromptOpen(false);
                  setPhoneError(null);
                }}
                className="text-slate-400 hover:text-slate-600"
                aria-label={t('common.close', 'Kapat')}
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-slate-600 mb-4">
              {t(
                'subscriptions.checkout.phonePromptBody',
                'PayTR fatura için geçerli bir telefon numarası talep ediyor. Numaranızı girin, ödeme adımına devam edelim.',
              )}
            </p>
            <Input
              type="tel"
              value={phoneValue}
              onChange={(e) => {
                setPhoneValue(e.target.value);
                if (phoneError) setPhoneError(null);
              }}
              placeholder="+90 555 123 45 67"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !phoneSaving) handlePhoneSave();
              }}
              disabled={phoneSaving}
              error={phoneError ?? undefined}
            />
            <div className="mt-5 flex items-center gap-2">
              <Button
                variant="primary"
                className="flex-1"
                onClick={handlePhoneSave}
                disabled={phoneSaving || !phoneValue.trim()}
              >
                {phoneSaving
                  ? t('subscriptions.checkout.phoneSaving', 'Kaydediliyor...')
                  : t('subscriptions.checkout.phoneSaveAndContinue', 'Kaydet ve devam et')}
              </Button>
              <button
                onClick={() => {
                  setPhonePromptOpen(false);
                  setPhoneError(null);
                }}
                className="text-sm text-slate-500 hover:text-slate-700 px-3 py-2"
                disabled={phoneSaving}
              >
                {t('subscriptions.checkout.cancel', 'Vazgeç')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

interface ConsentRowProps {
  checked: boolean;
  onChange: (v: boolean) => void;
  docId: string;
  label: string;
  docLink: string;
  version?: string;
}

function ConsentRow({
  checked,
  onChange,
  docId,
  label,
  docLink,
  version,
}: ConsentRowProps) {
  return (
    <label
      htmlFor={`consent-${docId}`}
      className={`flex items-start gap-3 p-4 rounded-lg border cursor-pointer transition-colors mb-3 ${
        checked
          ? 'border-indigo-300 bg-indigo-50'
          : 'border-slate-200 bg-white hover:bg-slate-50'
      }`}
    >
      <input
        id={`consent-${docId}`}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 w-5 h-5 text-indigo-600 rounded focus:ring-indigo-500"
      />
      <div className="flex-1">
        <div className="font-medium text-slate-900">{label}</div>
        <a
          href={docLink}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center gap-1 text-sm text-indigo-600 hover:text-indigo-700 mt-1"
        >
          Belgeyi yeni sekmede aç
          <ExternalLink className="w-3 h-3" />
        </a>
        {version && (
          <div className="text-xs text-slate-400 mt-1">
            Sürüm: {version}
          </div>
        )}
      </div>
    </label>
  );
}

export default CheckoutPage;
