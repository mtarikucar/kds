/**
 * Actionable-error registry.
 *
 * When a server action is blocked because a required piece of profile/tenant
 * data is missing, the backend throws with a stable machine `errorCode`
 * (surfaced on the wire as `data.errorCode`). Instead of showing a dead-end
 * WARNING toast ("…please add a phone to your profile and come back"), the SPA
 * pops a single-field inline prompt, saves the value, and AUTOMATICALLY
 * re-runs the original action. "Eksik bilgi uyarı ile değil aksiyon ile
 * tamamlansın" — missing info is completed with an action, not a warning.
 *
 * To make a new error code actionable: add an entry here, make the backend
 * throw that `errorCode`, and ensure `ActionableErrorModal` knows how to
 * persist the `field`. Nothing at the call site changes — any mutation that
 * routes its onError through `useActionableError().handleApiError` gets the
 * inline fix for free.
 */

/** Fields the inline-fix modal knows how to persist. Extend as needed. */
export type ActionableField = 'phone';

export interface ActionableErrorSpec {
  /** Which user/tenant field to collect + persist. */
  field: ActionableField;
  /** i18n keys (common namespace) for the prompt copy. */
  titleKey: string;
  bodyKey: string;
  labelKey: string;
  invalidKey: string;
  /** Placeholder shown in the input (literal, not a key). */
  placeholder: string;
  /** HTML input type. */
  inputType: string;
  /** Client-side pre-validation; the server still validates strictly. */
  validate: (value: string) => boolean;
}

// Loose phone check: digits / + / spaces / dashes / parens, 7–20 chars. The
// backend (PayTR / E.164 DTO) validates strictly; this just blocks obvious
// typos so the user doesn't burn a round-trip.
const PHONE_RE = /^[+0-9\s()-]{7,20}$/;

export const ACTIONABLE_ERRORS: Record<string, ActionableErrorSpec> = {
  PROFILE_PHONE_REQUIRED: {
    field: 'phone',
    titleKey: 'actionableErrors.phone.title',
    bodyKey: 'actionableErrors.phone.body',
    labelKey: 'actionableErrors.phone.label',
    invalidKey: 'actionableErrors.phone.invalid',
    placeholder: '+90 555 123 45 67',
    inputType: 'tel',
    validate: (value) => PHONE_RE.test(value.trim()),
  },
};

/**
 * Look up the inline-fix spec for an error code. Returns undefined for
 * unknown / empty codes so the caller falls back to normal error handling.
 */
export function getActionableErrorSpec(
  code: string | undefined | null,
): ActionableErrorSpec | undefined {
  if (!code) return undefined;
  return ACTIONABLE_ERRORS[code];
}
