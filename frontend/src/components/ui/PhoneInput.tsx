import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AsYouType, type CountryCode } from 'libphonenumber-js';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import {
  buildCountryOptions,
  countryDialCode,
  deriveE164,
  getFlagEmoji,
  splitE164,
} from './phoneInputLogic';

export interface PhoneInputProps {
  /** Controlled value in E.164 ("+905551234567"). Empty until a valid number. */
  value: string;
  /** Fired with the canonical E.164 (or '' while the number is incomplete). */
  onChange: (e164: string) => void;
  label?: string;
  error?: string;
  hint?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  /** Region used to interpret a number typed without an explicit country. */
  defaultCountry?: CountryCode;
  id?: string;
  name?: string;
  placeholder?: string;
  /** Notified whenever the validity of the current input changes. */
  onValidityChange?: (valid: boolean) => void;
}

/**
 * Professional, reusable phone field.
 *
 * - A country selector (flag + dial code; Turkey first) sets the region.
 * - The user types the national number in ANY natural format — spaces, dashes,
 *   parens, a leading 0 — and it's formatted on blur and emitted as canonical
 *   E.164 via `onChange`. No more "valid international format" dead-ends.
 * - Styling mirrors ui/Input (label / focus ring / error+hint) so it drops
 *   into existing forms.
 *
 * Output contract: `onChange` always emits E.164 or '' (never a half-typed
 * string), so callers submit `value` directly and gate on it being non-empty.
 */
const PhoneInput = React.forwardRef<HTMLInputElement, PhoneInputProps>(
  (
    {
      value,
      onChange,
      label,
      error,
      hint,
      disabled,
      autoFocus,
      defaultCountry = 'TR',
      id,
      name,
      placeholder,
      onValidityChange,
    },
    ref,
  ) => {
    const { t, i18n } = useTranslation('common');
    const autoId = React.useId();
    const inputId = id ?? autoId;
    const messageId = `${inputId}-message`;
    const hasMessage = Boolean(error || hint);

    const seed = useMemo(() => splitE164(value), []); // eslint-disable-line react-hooks/exhaustive-deps
    const [country, setCountry] = useState<CountryCode>(seed?.country ?? defaultCountry);
    const [national, setNational] = useState<string>(
      seed ? new AsYouType(seed.country).input(seed.nationalNumber) : '',
    );
    // Track what we last emitted so an EXTERNAL value change (form reset, parent
    // clearing the field) re-seeds the inputs, but our own emits don't.
    const lastEmitted = useRef(value);

    useEffect(() => {
      if (value === lastEmitted.current) return;
      lastEmitted.current = value;
      const s = splitE164(value);
      if (s) {
        setCountry(s.country);
        setNational(new AsYouType(s.country).input(s.nationalNumber));
      } else if (!value) {
        setNational('');
      }
    }, [value]);

    const emit = (rawNational: string, region: CountryCode) => {
      const e164 = deriveE164(rawNational, region);
      lastEmitted.current = e164;
      onChange(e164);
      onValidityChange?.(Boolean(e164));
    };

    const handleNationalChange = (raw: string) => {
      setNational(raw);
      emit(raw, country);
    };

    const handleBlur = () => {
      // Reformat to the canonical national layout once the user pauses, so the
      // field reads cleanly without fighting the cursor while typing.
      if (national.trim()) setNational(new AsYouType(country).input(national));
    };

    const handleCountryChange = (next: CountryCode) => {
      setCountry(next);
      emit(national, next);
    };

    // i18n may be absent when a consumer's test mocks useTranslation to return
    // only { t } — don't hard-crash; fall back to the Turkish-first locale.
    const locale = i18n?.language ?? 'tr';
    const countries = useMemo(
      () => buildCountryOptions(locale, [defaultCountry]),
      [locale, defaultCountry],
    );

    return (
      <div className="w-full">
        {label && (
          <label htmlFor={inputId} className="block text-sm font-medium text-slate-700 mb-1.5">
            {label}
          </label>
        )}
        <div
          className={cn(
            'flex items-stretch w-full rounded-lg border border-slate-200 bg-white shadow-sm transition-all duration-200',
            'focus-within:ring-2 focus-within:ring-primary-500/20 focus-within:border-primary-500',
            'hover:border-slate-300',
            disabled && 'bg-slate-50 cursor-not-allowed',
            error && 'border-red-300 focus-within:ring-red-500/20 focus-within:border-red-500',
          )}
        >
          {/* Country selector — overlaid native select for full a11y + a
              compact flag + dial-code display. */}
          <div className="relative flex items-center gap-1.5 pl-3 pr-2 border-r border-slate-200 text-slate-700">
            <span aria-hidden className="text-base leading-none">{getFlagEmoji(country)}</span>
            <span className="text-sm tabular-nums">+{countryDialCode(country)}</span>
            <select
              aria-label={t('phoneInput.country', 'Ülke kodu')}
              value={country}
              disabled={disabled}
              onChange={(e) => handleCountryChange(e.target.value as CountryCode)}
              className="absolute inset-0 w-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
            >
              {countries.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.flag} {c.name} (+{c.dialCode})
                </option>
              ))}
            </select>
          </div>
          <input
            id={inputId}
            name={name}
            ref={ref}
            type="tel"
            inputMode="tel"
            autoComplete="tel-national"
            autoFocus={autoFocus}
            disabled={disabled}
            aria-invalid={error ? true : undefined}
            aria-describedby={hasMessage ? messageId : undefined}
            value={national}
            placeholder={placeholder ?? '555 123 45 67'}
            onChange={(e) => handleNationalChange(e.target.value)}
            onBlur={handleBlur}
            className={cn(
              'flex-1 min-w-0 px-3.5 py-2.5 bg-transparent rounded-r-lg text-slate-900 placeholder:text-slate-400',
              'focus:outline-none',
              'disabled:text-slate-500 disabled:cursor-not-allowed',
            )}
          />
        </div>
        {hint && !error && (
          <p id={messageId} className="mt-1.5 text-sm text-slate-500">{hint}</p>
        )}
        {error && (
          <p id={messageId} className="mt-1.5 text-sm text-red-600">{error}</p>
        )}
      </div>
    );
  },
);

PhoneInput.displayName = 'PhoneInput';

export { PhoneInput };
export default PhoneInput;
