import { describe, it, expect, beforeAll } from 'vitest';
import i18next from './config';
import { SUPPORTED_LANGUAGES } from './config';

/**
 * Guard against the "raw key word" validation-message regression (sweep finding #13).
 *
 * The auth (login/register/forgot/reset), /welcome onboarding and CRM customer
 * forms build their zod messages via t('validation:validation.<key>'). The
 * validation.json files nest every leaf under a top-level "validation" object,
 * so the flat form t('validation:<key>') silently rendered the bare token
 * ("email", "minLength", "required", "nameMin") in EVERY locale — and the CI
 * key-set parity check structurally cannot catch it (all locales are identically
 * wrong). This test resolves the exact keys those forms use, in every supported
 * locale, against the REAL i18next instance and asserts each yields a localized
 * sentence rather than the trailing token.
 */

// The keys (with their interpolation needs) actually consumed by the 13 form
// validation call sites this finding covers.
const FORM_VALIDATION_KEYS: Array<{ key: string; options?: Record<string, unknown> }> = [
  { key: 'validation:validation.email' },
  { key: 'validation:validation.required' },
  { key: 'validation:validation.nameMin' },
  { key: 'validation:validation.minLength', options: { count: 8 } },
];

describe('form validation i18n keys resolve to real messages (finding #13)', () => {
  beforeAll(async () => {
    // i18next from config initializes async; make sure resources are loaded.
    if (!i18next.isInitialized) {
      await new Promise<void>((resolve) => i18next.on('initialized', () => resolve()));
    }
  });

  for (const lng of SUPPORTED_LANGUAGES) {
    describe(`locale: ${lng}`, () => {
      for (const { key, options } of FORM_VALIDATION_KEYS) {
        it(`${key} resolves to a localized message (not a raw token)`, () => {
          const t = i18next.getFixedT(lng);
          const value = t(key, options);
          // When a key is missing, i18next returns the bare trailing segment
          // (after the namespace `:` separator and any `.` nesting). e.g. the
          // regressed flat form t('validation:email') renders "email".
          const trailingToken = key.split(/[:.]/).pop() as string;
          expect(value).not.toBe(trailingToken);
          expect(value).not.toBe(key);
          // Must be a non-empty human string.
          expect(typeof value).toBe('string');
          expect((value as string).trim().length).toBeGreaterThan(1);
        });
      }

      it('validation:validation.minLength interpolates {{count}}', () => {
        const t = i18next.getFixedT(lng);
        const value = t('validation:validation.minLength', { count: 8 }) as string;
        expect(value).toContain('8');
        expect(value).not.toContain('{{count}}');
      });
    });
  }
});
