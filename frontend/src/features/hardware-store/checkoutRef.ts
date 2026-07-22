/**
 * Bridges the hardware checkout's PayTR round-trip back to a specific
 * CheckoutIntent.paymentRef so the return screen knows which order to look
 * for.
 *
 * Why this indirection is needed: PayTR's okUrl/failUrl are BOTH set to the
 * exact `returnUrl` the /v1/checkout/intent request carries (see
 * paytr-payment-provider.ts — `okUrl: req.returnUrl, failUrl: req.returnUrl`),
 * and that request has to be built and sent BEFORE CheckoutIntentService
 * mints the paymentRef server-side (`CK-<uuid7>`, generated inside the same
 * call). So the real ref can never be embedded in the URL PayTR redirects
 * back to — it doesn't exist yet when we choose that URL.
 *
 * Instead we stash it client-side the moment the /intent response arrives
 * (still on this page, before `window.location.assign(paymentLink)` sends
 * the browser away), keyed on a single fixed sessionStorage slot — a tenant
 * only ever has one hardware checkout in flight per browser tab, so there's
 * no need for a per-attempt key.
 */

const PENDING_REF_KEY = 'hardware-store-pending-checkout-ref';

export function stashPendingCheckoutRef(paymentRef: string): void {
  try {
    window.sessionStorage.setItem(PENDING_REF_KEY, paymentRef);
  } catch {
    // Private mode / storage quota — non-fatal. The result screen falls
    // back to treating the `intent` query value as the ref directly.
  }
}

export function clearPendingCheckoutRef(): void {
  try {
    window.sessionStorage.removeItem(PENDING_REF_KEY);
  } catch {
    // ignore
  }
}

/**
 * Resolve the actual paymentRef the result screen should poll for.
 * `intentParam` is whatever the `?intent=` query value is (today a fixed
 * 'pending' sentinel — see StorePage's returnUrl construction). Prefers the
 * stashed real ref; falls back to the query value itself so a direct
 * `/admin/store?intent=<realRef>` link (or a unit test that never went
 * through stashPendingCheckoutRef) still resolves without the sessionStorage
 * bridge.
 */
export function resolvePendingCheckoutRef(intentParam: string): string {
  try {
    return window.sessionStorage.getItem(PENDING_REF_KEY) ?? intentParam;
  } catch {
    return intentParam;
  }
}
