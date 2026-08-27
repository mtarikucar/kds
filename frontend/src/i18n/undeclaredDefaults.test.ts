import { describe, it, expect, beforeAll } from 'vitest';
import i18next from './config';
import { SUPPORTED_LANGUAGES } from './config';

/**
 * Guard the keys that used to leak their English/Turkish `defaultValue`.
 *
 * `t('some.key', 'Some default')` renders the default when NO locale file
 * declares the key — silently, in every language. 103 such keys sat in
 * scripts/i18n-undeclared-default-baseline.json: the QR-menu phone
 * verification flow, the 3D/AR panels, the bulk product add-modal, the
 * receipt-reprint rail, the public /legal/* pages. A key-set parity check
 * cannot see them (all five locales are identically missing the key), so this
 * test asks the REAL i18next instance whether each key exists as a resource —
 * `exists()` is false exactly when the call site would fall back to its
 * literal.
 *
 * Each entry is written in the `ns:key` form its call site uses, so a future
 * move of the key between namespaces fails here too.
 */
const PREVIOUSLY_LEAKING_KEYS = [
  // QR menu — guest-facing, the most damaging place to render English
  'common:phoneVerification.title',
  'common:phoneVerification.codeLabel',
  'common:phoneVerification.verifyFailed',
  'common:qrMenu.arView',
  'common:qrMenu.ingredients',
  'common:payment.paid',
  // public legal pages, which asked for a `legal` namespace that never existed
  'common:legal.backToHome',
  'common:legal.fetchFailed',
  'common:legal.versionLabel',
  // admin chrome
  'common:qrDesigner.logoUploaded',
  'common:showingPage',
  'common:admin.reactivateUser',
  // POS
  'pos:add',
  'pos:menu.increase',
  'pos:payment.amountTendered',
  'pos:payment.receiptPrintFailed',
  'pos:reprint.label',
  'pos:reprint.notReprintable',
  // menu editor / AI studio
  'menu:menu.aiStudio',
  'menu:menu.bulk.subtitle',
  'menu:ai.lockedTitle',
  'menu:ar.viewOnTable',
  'menu:threeD.generate',
  // the rest of the app
  'auth:register.phone',
  'auth:verifyEmail.codeLabel',
  'settings:customerSelfPay.title',
  'superadmin:login.sessionExpired',
  'superadmin:nav.openMenu',
  'personnel:performance.avgScore',
] as const;

/**
 * `common.loading` was declared ONLY by personnel.json. The QR-menu loyalty
 * panel, the self-pay modal and the QR menu shell all read it off the `common`
 * namespace, where it did not exist — and the parity guard passed them because
 * it matched keys against one global pile instead of per namespace.
 */
const CROSS_NAMESPACE_FALSE_PASSES = [
  'common:common.loading',
  'common:common.sending',
  'common:common.verifying',
  'common:common.backHome',
] as const;

describe('t() defaultValue keys are declared in every locale', () => {
  beforeAll(async () => {
    // i18next from config initializes async; make sure resources are loaded.
    if (!i18next.isInitialized) {
      await new Promise<void>((resolve) => i18next.on('initialized', () => resolve()));
    }
  });

  for (const lng of SUPPORTED_LANGUAGES) {
    describe(`locale: ${lng}`, () => {
      for (const key of [...PREVIOUSLY_LEAKING_KEYS, ...CROSS_NAMESPACE_FALSE_PASSES]) {
        it(`${key} is a declared resource, not a defaultValue fallback`, () => {
          expect(i18next.exists(key, { lng })).toBe(true);
          const value = i18next.getFixedT(lng)(key);
          expect(typeof value).toBe('string');
          expect((value as string).trim().length).toBeGreaterThan(0);
          // A missing key resolves to its own trailing segment.
          expect(value).not.toBe(key.split(/[:.]/).pop());
        });
      }
    });
  }
});

/**
 * Counted strings need their language's full plural family, not the two forms
 * English gets. Arabic distinguishes six categories and Russian four; the QR
 * menu's order list interpolates an item count, so it must go through the
 * pluralised `cart.itemCount` rather than concatenating a bare number with a
 * static noun.
 */
describe('counted strings carry a per-language plural family', () => {
  const PLURAL_SUFFIXES: Record<string, string[]> = {
    en: ['one', 'other'],
    tr: ['one', 'other'],
    uz: ['one', 'other'],
    ru: ['one', 'few', 'many', 'other'],
    ar: ['zero', 'one', 'two', 'few', 'many', 'other'],
  };

  for (const [lng, suffixes] of Object.entries(PLURAL_SUFFIXES)) {
    it(`${lng} declares every cart.itemCount form it can select`, () => {
      const bundle = i18next.getResourceBundle(lng, 'common');
      for (const suffix of suffixes) {
        expect(bundle.cart[`itemCount_${suffix}`]).toBeTruthy();
      }
    });
  }

  it('Arabic selects a different form for 0, 1, 2, 3 and 11 items', () => {
    const t = i18next.getFixedT('ar');
    const rendered = [0, 1, 2, 3, 11].map((count) => t('common:cart.itemCount', { count }));
    // Six categories exist; these five counts land in five distinct ones, so
    // no two of them may render the same string.
    expect(new Set(rendered).size).toBe(rendered.length);
  });

  it('Russian selects a different form for 1, 2 and 5 items', () => {
    const t = i18next.getFixedT('ru');
    const rendered = [1, 2, 5].map((count) => t('common:cart.itemCount', { count }));
    expect(new Set(rendered).size).toBe(rendered.length);
  });
});
