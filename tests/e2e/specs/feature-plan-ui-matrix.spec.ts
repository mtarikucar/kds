import { test, expect, Page, APIRequestContext } from '@playwright/test';
import { loginAsSuperAdmin } from '../helpers/api';
import { registerFreshTenant } from '../helpers/fresh-tenant';
import {
  switchTenantPlan,
  clearFeatureOverrides,
  PLAN_FEATURES,
  PlanName,
} from '../helpers/plans';

/**
 * LIVE BROWSER feature × plan matrix.
 *
 * Registers ONE fresh tenant (TRIALING BUSINESS, no data → downgrades never
 * trip an over-limit refusal), walks it down every tier via the superadmin
 * plan switch, and for EACH tier:
 *   1. verifies the tenant's effective-features API reflects EXACTLY the
 *      plan's full 11-feature set (the source both the guard and the UI read),
 *   2. drives the REAL app in Chromium (fresh context + fresh login per tier —
 *      the dev stack is cross-origin so a full reload can't restore the
 *      httpOnly refresh cookie) and asserts the UI gates match: the top-level
 *      sidebar nav, the universal Kitchen link, and the settings sub-nav.
 *
 * The plan→feature truth table is the shared helper PLAN_FEATURES (mirrors
 * seed.ts, cross-checked in the backend matrix spec against the seeded DB).
 */

// Top-level sidebar nav gates (Sidebar.tsx SECTIONS gate.feature → route).
const SIDEBAR_GATES: { feature: string; href: string }[] = [
  { feature: 'posAccess', href: '/pos' },
  { feature: 'advancedReports', href: '/admin/reports' },
  { feature: 'multiLocation', href: '/admin/branches' },
  { feature: 'inventoryTracking', href: '/admin/stock' },
  { feature: 'reservationSystem', href: '/admin/reservations' },
  { feature: 'personnelManagement', href: '/admin/personnel' },
];

// Settings sub-nav gates (SettingsLayout settingsNavItems gate.feature).
const SETTINGS_GATES: { feature: string; href: string }[] = [
  { feature: 'customBranding', href: '/admin/settings/branding' },
  { feature: 'apiAccess', href: '/admin/settings/integrations' },
  { feature: 'deliveryIntegration', href: '/admin/settings/online-orders' },
];

const ALL_FEATURES = Object.keys(PLAN_FEATURES.BUSINESS);

// Descending so every step after BUSINESS is a downgrade (forceDowngrade).
const PLANS: PlanName[] = ['BUSINESS', 'PRO', 'BASIC', 'FREE'];

test.describe.configure({ mode: 'serial' });

test.describe('Feature × Plan UI gating (live browser)', () => {
  let superApi: APIRequestContext;
  let freshApi: APIRequestContext;
  let tenantId: string;
  let email: string;
  let password: string;

  test.beforeAll(async () => {
    ({ api: superApi } = await loginAsSuperAdmin());
    const fresh = await registerFreshTenant('featmatrix');
    freshApi = fresh.api;
    tenantId = fresh.user.tenantId;
    email = fresh.email;
    password = fresh.password;

    // Registration seeds warm-up featureOverrides (all BUSINESS flags) so the
    // PlanFeatureGuard fallback resolves during the projector's warm-up. Those
    // overrides REPLACE the plan values and would mask every downgrade — clear
    // them so each tier is exercised on its real plan grants.
    await clearFeatureOverrides(superApi, tenantId);
  });

  // Poll the tenant's effective-features until the entitlement projection
  // reflects EVERY feature of the target plan (the projector reprojects async
  // after a switch; the engine cache TTL is 30s, so allow past the fail-safe).
  async function waitForEffectiveFeatures(plan: PlanName): Promise<void> {
    const want = PLAN_FEATURES[plan];
    await expect
      .poll(
        async () => {
          const res = await freshApi.get('subscriptions/effective-features');
          if (!res.ok()) return false;
          const feats = (await res.json()).features ?? {};
          return ALL_FEATURES.every(
            (f) => !!feats[f] === !!want[f],
          );
        },
        { timeout: 70_000, message: `effective-features did not settle to ${plan}` },
      )
      .toBe(true);
  }

  async function assertGate(
    page: Page,
    scope: string,
    feature: string,
    href: string,
    plan: PlanName,
  ): Promise<void> {
    const expected = PLAN_FEATURES[plan][feature];
    const count = () => page.locator(`${scope} a[href$="${href}"]`).count();
    if (expected) {
      await expect
        .poll(count, {
          timeout: 20_000,
          message: `${plan}: ${feature} (${href}) should be VISIBLE`,
        })
        .toBeGreaterThanOrEqual(1);
    } else {
      await expect
        .poll(count, {
          timeout: 20_000,
          message: `${plan}: ${feature} (${href}) should be HIDDEN`,
        })
        .toBe(0);
    }
  }

  for (const plan of PLANS) {
    test(`${plan}: API + UI gating match the plan`, async ({ browser }) => {
      if (plan !== 'BUSINESS') {
        await switchTenantPlan(superApi, tenantId, plan);
      }
      // (1) Every feature in the live effective-features API matches the plan.
      await waitForEffectiveFeatures(plan);

      // (2) Live UI: fresh context + fresh login → current-plan entitlements.
      const context = await browser.newContext();
      const page = await context.newPage();
      try {
        await page.goto('login');
        await page.getByPlaceholder('you@example.com').fill(email);
        await page.getByPlaceholder('••••••••').fill(password);
        await page.getByRole('button', { name: /giriş|login|sign in/i }).click();
        await page.waitForURL(/\/dashboard(\b|$)/, { timeout: 30_000 });
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible({
          timeout: 30_000,
        });

        // Top-level sidebar gates (scope to <aside> — the dashboard body has
        // ungated upsell quick-links to the same routes).
        for (const { feature, href } of SIDEBAR_GATES) {
          await assertGate(page, 'aside', feature, href, plan);
        }

        // kdsIntegration is universal (true on every tier) — Kitchen link
        // must always be present.
        expect(PLAN_FEATURES[plan].kdsIntegration).toBe(true);
        await expect
          .poll(() => page.locator('aside a[href$="/kitchen"]').count(), {
            timeout: 20_000,
            message: `${plan}: Kitchen link should always be visible`,
          })
          .toBeGreaterThanOrEqual(1);

        // Settings sub-nav gates — navigate via the SPA (clicking the sidebar
        // link) NOT page.goto: a full reload can't restore the cross-origin
        // httpOnly session cookie in this dev stack and would bounce to login.
        await page.locator('aside a[href$="/admin/settings"]').first().click();
        await page.waitForURL(/\/admin\/settings/, { timeout: 30_000 });
        // The settings sub-nav renders twice (mobile drawer + desktop column);
        // assert by COUNT (visibility-agnostic) rather than the hidden .first().
        await expect
          .poll(() => page.locator('nav[data-tour="settings-nav"]').count(), {
            timeout: 30_000,
          })
          .toBeGreaterThanOrEqual(1);
        for (const { feature, href } of SETTINGS_GATES) {
          await assertGate(
            page,
            'nav[data-tour="settings-nav"]',
            feature,
            href,
            plan,
          );
        }
      } finally {
        await context.close();
      }
    });
  }
});
