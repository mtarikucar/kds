import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CreditCard, Lock } from 'lucide-react';
import { useCardTap } from '../../features/personnel/personnelApi';
import type { CardTapResponse } from '../../types';

type Outcome =
  | { tone: 'ok' | 'amber'; text: string }
  | { tone: 'error'; text: string }
  | null;

/** How long a result stays on screen before the prompt returns. */
const RESULT_MS = 8_000;
/** Idle window before the session-lock overlay drops (§8 Risk 5). */
const IDLE_MS = 60_000;

/**
 * The Card Shift station.
 *
 * It runs on an ADMIN/MANAGER session because there is no device-token rail
 * yet, which is exactly why it locks itself: a tablet left on a counter is an
 * admin session left on a counter. The real fix is a paired device token
 * (§9/1); this is the mitigation that ships with the product.
 */
const CardShiftStationPage = () => {
  const { t } = useTranslation(['personnel', 'common']);
  const tap = useCardTap();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uid, setUid] = useState('');
  const [outcome, setOutcome] = useState<Outcome>(null);
  const [locked, setLocked] = useState(false);
  const idleRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const focus = useCallback(() => inputRef.current?.focus(), []);

  const resetIdle = useCallback(() => {
    if (idleRef.current) clearTimeout(idleRef.current);
    idleRef.current = setTimeout(() => setLocked(true), IDLE_MS);
  }, []);

  useEffect(() => {
    focus();
    resetIdle();
    return () => {
      if (idleRef.current) clearTimeout(idleRef.current);
    };
  }, [focus, resetIdle]);

  const timeOf = (iso?: string | null) =>
    iso
      ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : '';

  const describe = (res: CardTapResponse): Outcome => {
    const name = `${res.user.firstName} ${res.user.lastName}`;
    const time = timeOf(
      res.action === 'clockOut'
        ? (res.attendance?.clockOut ?? null)
        : (res.attendance?.clockIn ?? null),
    );
    if (res.action === 'clockIn')
      return { tone: 'ok', text: t('personnel:cardShift.station.welcome', { name, time }) };
    if (res.action === 'clockOut')
      return { tone: 'ok', text: t('personnel:cardShift.station.goodbye', { name, time }) };
    if (res.action === 'breakEnd')
      return { tone: 'ok', text: t('personnel:cardShift.station.breakEnded', { name, time }) };
    // 'ignored' — the 10s debounce swallowed a reader's duplicate write.
    return { tone: 'amber', text: t('personnel:cardShift.station.ignored') };
  };

  const errorText = (err: any): string => {
    const code = err?.response?.data?.code;
    if (code === 'CARD_NOT_RECOGNISED')
      return t('personnel:cardShift.errors.notRecognised');
    if (code === 'ALREADY_CLOCKED_OUT_TODAY')
      return t('personnel:cardShift.errors.alreadyClockedOut');
    if (code === 'CARD_UID_INVALID')
      return t('personnel:cardShift.errors.invalidUid');
    return t('common:notifications.operationFailed');
  };

  const submit = async () => {
    const cardUid = uid.trim();
    // Clear BEFORE the await: the UID must not sit on a screen in a corridor
    // while the request is in flight.
    setUid('');
    if (!cardUid) return;
    resetIdle();
    try {
      const res = await tap.mutateAsync({ cardUid });
      setOutcome(describe(res));
    } catch (err) {
      setOutcome({ tone: 'error', text: errorText(err) });
    } finally {
      focus();
      setTimeout(() => setOutcome(null), RESULT_MS);
    }
  };

  const tone =
    outcome?.tone === 'ok'
      ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
      : outcome?.tone === 'amber'
        ? 'bg-amber-50 text-amber-800 border-amber-200'
        : 'bg-red-50 text-red-800 border-red-200';

  return (
    <div
      className="relative flex min-h-[70vh] flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white p-8"
      onMouseMove={resetIdle}
      onKeyDown={resetIdle}
    >
      <button
        type="button"
        onClick={() => setLocked(true)}
        className="absolute right-4 top-4 inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1 text-sm text-slate-600"
      >
        <Lock className="h-4 w-4" />
        {t('personnel:cardShift.station.lock')}
      </button>

      <CreditCard className="h-16 w-16 text-primary-500" />
      <h1 className="mt-6 text-3xl font-bold text-slate-900">
        {t('personnel:cardShift.station.title')}
      </h1>
      <p className="mt-2 text-xl text-slate-500">
        {t('personnel:cardShift.tapPrompt')}
      </p>

      {/* Visually hidden, never unmounted, always refocused: the reader types
          into whatever has focus, so a blurred field silently drops the tap.
          Not type="password" — a masked field confuses the operator debugging a
          reader — but it is cleared on submit and never rendered anywhere. */}
      <input
        ref={inputRef}
        aria-label={t('personnel:cardShift.tapPrompt')}
        value={uid}
        autoComplete="off"
        className="absolute h-px w-px opacity-0"
        onChange={(e) => setUid(e.target.value)}
        onBlur={() => focus()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            submit();
          }
        }}
      />

      {outcome && (
        <div className={`mt-10 w-full max-w-2xl rounded-2xl border p-8 text-center text-2xl font-semibold ${tone}`}>
          {outcome.text}
        </div>
      )}

      {locked && (
        <div
          role="button"
          tabIndex={0}
          onClick={() => {
            setLocked(false);
            resetIdle();
            focus();
          }}
          onKeyDown={() => {
            setLocked(false);
            resetIdle();
            focus();
          }}
          className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 rounded-2xl bg-slate-900/95 text-white"
        >
          <Lock className="h-12 w-12" />
          <p className="text-2xl font-semibold">
            {t('personnel:cardShift.station.locked')}
          </p>
          <p className="text-slate-300">
            {t('personnel:cardShift.station.unlock')}
          </p>
        </div>
      )}
    </div>
  );
};

export default CardShiftStationPage;
