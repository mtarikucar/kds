import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { toast } from 'sonner';
import { ShieldCheck, Lock, ExternalLink, CreditCard, Landmark, Copy, Check } from 'lucide-react';
import {
  useCreatePaymentIntent,
  useBankTransferDetails,
  useCreateBankTransferIntent,
  type BankTransferIntentResponse,
} from '../../api/paymentsApi';
import { useGetPlans } from '../../features/subscriptions/subscriptionsApi';
import { useGetCurrentLegalDocument } from '../../features/legal/legalApi';
import { useActionableError } from '../../components/common/actionable-errors/ActionableErrorProvider';
import { getApiErrorCode, getApiErrorMessage } from '../../lib/api-error';
import { useAuthStore } from '../../store/authStore';
import Spinner from '../../components/ui/Spinner';
import Button from '../../components/ui/Button';
import { BillingCycle } from '../../types';

type PaymentMethod = 'CARD' | 'BANK_TRANSFER';

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
  const demoMode = useAuthStore((state) => state.demoMode);
  const [params] = useSearchParams();
  const planId = params.get('planId');
  const billingCycle = (params.get('billingCycle') ?? BillingCycle.MONTHLY) as BillingCycle;
  const createIntent = useCreatePaymentIntent();
  const createBankTransferIntent = useCreateBankTransferIntent();

  // Plan + bank-transfer availability. We need the plan's currency to
  // decide whether the PayTR (card) option can be offered at all — PayTR
  // only settles in TRY, so a non-TRY plan is havale-only.
  const plansQ = useGetPlans();
  const plan = plansQ.data?.find((p) => p.id === planId);
  const currency = plan?.currency ?? 'TRY';
  const isTry = currency === 'TRY';
  const bankTransferQ = useBankTransferDetails();
  const havaleEnabled = bankTransferQ.data?.enabled === true;
  // Card is offered only for TRY plans (PayTR settles in TRY only); havale
  // only when the superadmin has switched the channel on. If NEITHER is
  // available we must NOT let the user reach the consent gate — we render a
  // dead-end-free "no payment method" card below instead.
  const cardAvailable = isTry;
  const showMethodChoice = cardAvailable && havaleEnabled;
  const noPaymentMethod = !cardAvailable && !havaleEnabled;
  // We can only trust the availability decision once both feeds have settled —
  // before that `havaleEnabled` is falsy simply because the query is still in
  // flight, which would wrongly trip the no-payment-method card.
  const availabilityLoading = plansQ.isLoading || bankTransferQ.isLoading;

  // Selected payment method. Lazy init so the first render already reflects
  // the only viable channel: when card isn't available but havale is, start on
  // BANK_TRANSFER instead of flashing CARD then correcting via an effect.
  const [method, setMethod] = useState<PaymentMethod>(() =>
    !cardAvailable && havaleEnabled ? 'BANK_TRANSFER' : 'CARD',
  );
  // Keep the selection consistent if availability resolves after mount (the
  // bank-transfer query may settle a tick later than the initial render): if
  // card is the only option force CARD, if havale is the only option force
  // BANK_TRANSFER. When both exist we leave the user's pick alone.
  useEffect(() => {
    if (cardAvailable && !havaleEnabled) {
      setMethod('CARD');
    } else if (!cardAvailable && havaleEnabled) {
      setMethod('BANK_TRANSFER');
    }
  }, [cardAvailable, havaleEnabled]);

  // Phase 0 state — consent checkboxes
  const kvkkQ = useGetCurrentLegalDocument('KVKK');
  const distanceQ = useGetCurrentLegalDocument('DISTANCE_SALES');
  const refundQ = useGetCurrentLegalDocument('REFUND_POLICY');
  const [acceptedKvkk, setAcceptedKvkk] = useState(false);
  const [acceptedDistance, setAcceptedDistance] = useState(false);
  const [acceptedRefund, setAcceptedRefund] = useState(false);
  const allChecked = acceptedKvkk && acceptedDistance && acceptedRefund;
  // Clear the consent ticks only on a *successful* intent (the page is about to
  // navigate / swap to a confirm panel anyway). On error we deliberately leave
  // them ticked so the user can retry without re-reading + re-checking.
  const clearConsents = () => {
    setAcceptedKvkk(false);
    setAcceptedDistance(false);
    setAcceptedRefund(false);
  };
  const docsLoading = kvkkQ.isLoading || distanceQ.isLoading || refundQ.isLoading;
  const docsError = kvkkQ.error || distanceQ.error || refundQ.error;

  // Phase 1+ state
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paymentLink, setPaymentLink] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(AUTO_REDIRECT_MS / 1000);
  // Havale success → render the bank-transfer instructions panel.
  const [bankTransfer, setBankTransfer] = useState<BankTransferIntentResponse | null>(null);

  // Missing-info errors (e.g. PROFILE_PHONE_REQUIRED) are completed inline by
  // the app-wide actionable-error provider: it collects the missing field and
  // auto-resumes the original action, so the user never leaves checkout or
  // has to re-tick the consents.
  const actionableError = useActionableError();

  useEffect(() => {
    if (!planId) navigate('/subscription/plans', { replace: true });
  }, [planId, navigate]);

  // Belt-and-suspenders guard for a demo-tenant admin reaching checkout via a
  // direct URL — the money CTAs that normally link here are already disabled
  // in demo (see SubscriptionSettingsPage), and the backend 403s any
  // real-money initiation for the shared demo tenant regardless. Toast +
  // bounce back rather than let them tick consents into a dead-end.
  useEffect(() => {
    if (demoMode) {
      toast.error(t('errors:apiCodes.DEMO_PAYMENT_BLOCKED'));
      navigate('/admin/settings/subscription', { replace: true });
    }
  }, [demoMode, navigate, t]);

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
          // Success: safe to drop the consent ticks now (page navigates away
          // or swaps to the confirm panel).
          clearConsents();
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
        onError: (err: unknown) => {
          // Actionable inline-fix: a missing required field (e.g. phone) is
          // collected inline by the provider and the intent auto-resumes —
          // the user keeps their consent ticks and doesn't navigate away.
          // Re-lock the submit button for the resumed attempt.
          if (
            actionableError.handleApiError(err, () => {
              setSubmitted(true);
              submitIntent();
            })
          ) {
            setSubmitted(false);
            return;
          }
          if (getApiErrorCode(err) === 'PAYTR_ONLY_SUPPORTS_TRY') {
            // The plan is priced in a non-TRY currency so PayTR (card) can't
            // process it. Steer the user to havale when available — auto-switch
            // the method so a single tap on "Devam et" retries via the right
            // channel — otherwise surface a clear, localized explanation.
            setSubmitted(false);
            if (havaleEnabled) {
              setMethod('BANK_TRANSFER');
            }
            setError(null);
            toast.error(
              t(
                'subscriptions.checkout.cardCurrencyUnsupported',
                'Bu plan {{currency}} ile fiyatlandırıldığı için kart ile ödeme yapılamıyor. Havale/EFT seçeneğini kullanın veya TRY bir plan seçin.',
              ).replace('{{currency}}', currency),
            );
            return;
          }
          if (getApiErrorCode(err) === 'LEGAL_CONSENT_REQUIRED') {
            // Backend rejected our consent shape — surface the message so
            // the user re-reads the docs and re-checks. Reset submit lock.
            setSubmitted(false);
            setError(
              getApiErrorMessage(
                err,
                t(
                  'subscriptions.checkout.consentRequired',
                  'KVKK, Mesafeli Satış ve İade politikalarını onaylamanız gerekiyor.',
                ),
              ),
            );
            return;
          }
          setError(
            getApiErrorMessage(err, t('subscriptions.checkout.intentFailed', 'Payment intent failed')),
          );
        },
      },
    );
  };

  const submitBankTransfer = () => {
    if (!planId || !kvkkQ.data || !distanceQ.data || !refundQ.data) return;
    createBankTransferIntent.mutate(
      {
        planId,
        billingCycle,
        acceptedDocumentIds: [kvkkQ.data.id, distanceQ.data.id, refundQ.data.id],
      },
      {
        onSuccess: (data) => {
          // Success: instructions panel is about to render — drop the ticks.
          clearConsents();
          setBankTransfer(data);
        },
        onError: (err: unknown) => {
          // Same actionable inline-fix path as the card flow (e.g. a missing
          // required profile field): collect inline, auto-resume the havale
          // intent, keep the consent ticks. Re-lock submit for the retry.
          if (
            actionableError.handleApiError(err, () => {
              setSubmitted(true);
              submitBankTransfer();
            })
          ) {
            setSubmitted(false);
            return;
          }
          if (getApiErrorCode(err) === 'PAYTR_ONLY_SUPPORTS_TRY') {
            // Shouldn't normally surface on the havale path (havale is
            // currency-agnostic), but handle it defensively so the code is
            // never raw: surface the same friendly guidance and ensure we're
            // on the havale method.
            setSubmitted(false);
            if (havaleEnabled) {
              setMethod('BANK_TRANSFER');
            }
            setError(null);
            toast.error(
              t(
                'subscriptions.checkout.cardCurrencyUnsupported',
                'Bu plan {{currency}} ile fiyatlandırıldığı için kart ile ödeme yapılamıyor. Havale/EFT seçeneğini kullanın veya TRY bir plan seçin.',
              ).replace('{{currency}}', currency),
            );
            return;
          }
          if (getApiErrorCode(err) === 'LEGAL_CONSENT_REQUIRED') {
            setSubmitted(false);
            setError(
              getApiErrorMessage(
                err,
                t(
                  'subscriptions.checkout.consentRequired',
                  'KVKK, Mesafeli Satış ve İade politikalarını onaylamanız gerekiyor.',
                ),
              ),
            );
            return;
          }
          setError(
            getApiErrorMessage(err, t('subscriptions.checkout.intentFailed', 'Payment intent failed')),
          );
        },
      },
    );
  };

  const handleSubmit = () => {
    if (!planId || !allChecked || submitted) return;
    if (!kvkkQ.data || !distanceQ.data || !refundQ.data) return;
    setSubmitted(true);
    if (method === 'BANK_TRANSFER') {
      submitBankTransfer();
    } else {
      submitIntent();
    }
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

  // Render nothing while the demo-guard effect above redirects away.
  if (demoMode) {
    return null;
  }

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

  // Havale success: bank-transfer instructions panel.
  if (bankTransfer) {
    return (
      <BankTransferInstructions
        data={bankTransfer}
        onDone={() => navigate('/admin/settings/subscription', { replace: true })}
        t={t}
      />
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

  // Phase 1: creating intent (card or havale)
  if (submitted && (createIntent.isPending || createBankTransferIntent.isPending)) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh]">
        <Spinner size="lg" />
        <p className="mt-6 text-slate-600">
          {t('subscriptions.checkout.preparing', 'Ödeme hazırlanıyor...')}
        </p>
      </div>
    );
  }

  // Wait for plan + havale availability before deciding anything that depends
  // on them (the no-payment-method gate, the method picker) so we never flash a
  // wrong state while the bank-transfer query is still in flight.
  if (availabilityLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh]">
        <Spinner size="lg" />
        <p className="mt-6 text-slate-600">
          {t('subscriptions.checkout.loadingConsents', 'Sözleşmeler yükleniyor...')}
        </p>
      </div>
    );
  }

  // Pre-flight: no payment method available for this plan. This happens when
  // the plan is priced in a non-TRY currency (so PayTR/card is out — it only
  // settles in TRY) AND the superadmin hasn't enabled the havale channel yet.
  // Render a clear dead-end-free card BEFORE the consent gate so the user is
  // never asked to tick consents only to find there's no way to pay.
  if (noPaymentMethod) {
    return (
      <div className="max-w-md mx-auto mt-20 px-4 text-center">
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-amber-100 flex items-center justify-center">
          <Landmark className="w-8 h-8 text-amber-600" />
        </div>
        <h1 className="text-2xl font-bold text-slate-900 mb-3">
          {t(
            'subscriptions.checkout.noPaymentMethodTitle',
            'Bu plan için ödeme yöntemi kullanılamıyor',
          )}
        </h1>
        <p className="text-slate-600 mb-6">
          {t(
            'subscriptions.checkout.noPaymentMethodBody',
            'Bu plan {{currency}} para biriminde fiyatlandırıldığı için kart ile ödeme (PayTR, yalnızca TRY) kullanılamıyor ve havale / EFT kanalı henüz etkin değil.',
          ).replace('{{currency}}', currency)}
        </p>
        <Button
          variant="primary"
          className="w-full"
          onClick={() => navigate('/subscription/plans')}
        >
          {t('subscriptions.checkout.viewPlans', 'Planları gör')}
        </Button>
        <p className="mt-4 text-xs text-slate-500">
          {t(
            'subscriptions.checkout.noPaymentMethodSupportHint',
            'TRY bir plan seçebilir veya bu plan için ödeme yöntemlerini etkinleştirmek üzere destek ile iletişime geçebilirsiniz.',
          )}
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

        {(showMethodChoice || (havaleEnabled && !cardAvailable)) && (
          <div className="mt-8">
            <h2 className="text-sm font-semibold text-slate-700 mb-3">
              {t('subscriptions.checkout.methodTitle', 'Ödeme yöntemi')}
            </h2>
            {!cardAvailable && (
              <p className="text-xs text-slate-500 mb-3">
                {t(
                  'subscriptions.checkout.cardUnavailableNote',
                  'Bu plan {{currency}} para biriminde olduğu için kart ile ödeme kullanılamıyor. Havale / EFT ile ödeyebilirsiniz.',
                ).replace('{{currency}}', currency)}
              </p>
            )}
            <div className="grid sm:grid-cols-2 gap-3">
              {cardAvailable && (
                <MethodOption
                  selected={method === 'CARD'}
                  onSelect={() => setMethod('CARD')}
                  icon={<CreditCard className="w-5 h-5" />}
                  label={t('subscriptions.checkout.methodCard', 'Kart ile öde')}
                  hint={t('subscriptions.checkout.methodCardHint', 'PayTR güvenli ödeme')}
                />
              )}
              {havaleEnabled && (
                <MethodOption
                  selected={method === 'BANK_TRANSFER'}
                  onSelect={() => setMethod('BANK_TRANSFER')}
                  icon={<Landmark className="w-5 h-5" />}
                  label={t('subscriptions.checkout.methodBankTransfer', 'Havale / EFT')}
                  hint={t('subscriptions.checkout.methodBankTransferHint', 'Banka havalesi ile öde')}
                />
              )}
            </div>
          </div>
        )}

        <div className="mt-8 flex items-center gap-3">
          <Button
            variant="primary"
            className="flex-1"
            disabled={!allChecked || submitted}
            onClick={handleSubmit}
          >
            {method === 'BANK_TRANSFER'
              ? t('subscriptions.checkout.proceedToBankTransfer', 'Devam et — Havale bilgilerini gör')
              : t('subscriptions.checkout.proceedToPayment', 'Devam et — Ödemeye geç')}
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

interface MethodOptionProps {
  selected: boolean;
  onSelect: () => void;
  icon: ReactNode;
  label: string;
  hint: string;
}

function MethodOption({ selected, onSelect, icon, label, hint }: MethodOptionProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`flex items-center gap-3 p-4 rounded-lg border text-left transition-colors ${
        selected
          ? 'border-indigo-400 bg-indigo-50 ring-1 ring-indigo-300'
          : 'border-slate-200 bg-white hover:bg-slate-50'
      }`}
    >
      <span className={selected ? 'text-indigo-600' : 'text-slate-500'}>{icon}</span>
      <span className="flex-1">
        <span className="block font-medium text-slate-900">{label}</span>
        <span className="block text-xs text-slate-500">{hint}</span>
      </span>
      {selected && <Check className="w-5 h-5 text-indigo-600" />}
    </button>
  );
}

interface BankTransferInstructionsProps {
  data: BankTransferIntentResponse;
  onDone: () => void;
  t: TFunction<'subscriptions'>;
}

function BankTransferInstructions({ data, onDone, t }: BankTransferInstructionsProps) {
  const { bankDetails } = data;
  return (
    <div className="max-w-xl mx-auto mt-12 px-4 pb-16">
      <div className="bg-white rounded-2xl shadow-lg p-8">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-12 h-12 rounded-full bg-indigo-100 flex items-center justify-center">
            <Landmark className="w-6 h-6 text-indigo-600" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900">
            {t('subscriptions.checkout.bankTransfer.title', 'Havale / EFT bilgileri')}
          </h1>
        </div>
        <p className="text-slate-600 mb-6">
          {t('subscriptions.checkout.bankTransfer.intro', 'Aşağıdaki hesaba ödeme yapın. Açıklama kısmına referans kodunu yazmayı unutmayın.')}
        </p>

        {/* Amount */}
        <div className="rounded-lg border border-slate-200 p-4 mb-4">
          <div className="text-xs text-slate-500">
            {t('subscriptions.checkout.bankTransfer.amount', 'Tutar')}
            {data.planName ? ` — ${data.planName}` : ''}
          </div>
          <div className="text-2xl font-bold text-slate-900">
            {data.amount} {data.currency}
          </div>
        </div>

        {/* Reference — prominent + copyable */}
        <CopyRow
          label={t('subscriptions.checkout.bankTransfer.reference', 'Referans kodu (açıklamaya yazın)')}
          value={data.reference}
          emphasized
          t={t}
        />

        {/* Bank details */}
        {bankDetails.bankName && (
          <DetailRow
            label={t('subscriptions.checkout.bankTransfer.bankName', 'Banka')}
            value={bankDetails.bankName}
          />
        )}
        {bankDetails.accountHolder && (
          <DetailRow
            label={t('subscriptions.checkout.bankTransfer.accountHolder', 'Hesap sahibi')}
            value={bankDetails.accountHolder}
          />
        )}
        {bankDetails.iban && (
          <CopyRow
            label={t('subscriptions.checkout.bankTransfer.iban', 'IBAN')}
            value={bankDetails.iban}
            t={t}
          />
        )}

        {bankDetails.instructions && (
          <div className="rounded-lg border border-slate-200 p-4 mt-4 text-sm text-slate-600 whitespace-pre-line">
            {bankDetails.instructions}
          </div>
        )}

        <div className="mt-6 rounded-lg bg-amber-50 border border-amber-200 p-4 text-sm text-amber-800">
          {t(
            'subscriptions.checkout.bankTransfer.confirmationNote',
            'Erişiminiz, havale ekibimiz tarafından onaylandıktan sonra açılacaktır. Onay genellikle kısa sürede tamamlanır.',
          )}
        </div>

        <Button variant="primary" className="w-full mt-6" onClick={onDone}>
          {t('subscriptions.checkout.bankTransfer.done', 'Tamam / panele dön')}
        </Button>
      </div>
    </div>
  );
}

interface DetailRowProps {
  label: string;
  value: string;
}

function DetailRow({ label, value }: DetailRowProps) {
  return (
    <div className="rounded-lg border border-slate-200 p-4 mt-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="font-medium text-slate-900 break-all">{value}</div>
    </div>
  );
}

interface CopyRowProps {
  label: string;
  value: string;
  emphasized?: boolean;
  t: TFunction<'subscriptions'>;
}

function CopyRow({ label, value, emphasized, t }: CopyRowProps) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success(t('subscriptions.checkout.bankTransfer.copied', 'Kopyalandı'));
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable (e.g. insecure context) — silently no-op; the
      // value is still visible for manual copy.
    }
  };
  return (
    <div
      className={`rounded-lg border p-4 mt-3 flex items-center gap-3 ${
        emphasized ? 'border-indigo-300 bg-indigo-50' : 'border-slate-200'
      }`}
    >
      <div className="flex-1 min-w-0">
        <div className="text-xs text-slate-500">{label}</div>
        <div
          className={`font-mono break-all ${emphasized ? 'text-lg font-bold text-slate-900' : 'font-medium text-slate-900'}`}
        >
          {value}
        </div>
      </div>
      <button
        type="button"
        onClick={handleCopy}
        aria-label={t('subscriptions.checkout.bankTransfer.copy', 'Kopyala')}
        className="shrink-0 inline-flex items-center gap-1 text-sm text-indigo-600 hover:text-indigo-700 px-2 py-1 rounded"
      >
        {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
        {t('subscriptions.checkout.bankTransfer.copy', 'Kopyala')}
      </button>
    </div>
  );
}

export default CheckoutPage;
