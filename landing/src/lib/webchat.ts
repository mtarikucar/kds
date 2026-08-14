/**
 * Web-chat launcher configuration.
 *
 * Shared on purpose: `WebChatWidget` renders the loader tag and
 * `next.config.ts` has to widen the CSP for the very same origin. Keeping the
 * key and host in one place is what stops the header and the tag from drifting
 * apart — a drift whose only symptom is a launcher that silently never appears,
 * because the script tag is in the DOM but the browser refuses to run it.
 *
 * Blanking the key switches the widget off AND un-widens the CSP, so a staging
 * or preview deploy can neither open real conversations nor pull a third-party
 * script.
 */

/**
 * OFF by default, deliberately.
 *
 * The loader frames `<host>/widget?key=…`, and that route answers with
 * `X-Frame-Options: SAMEORIGIN` — so the panel cannot render on any origin but
 * Jeeta's own. Everything on our side works (the script loads, the launcher
 * paints, the iframe is created with the right URL); the browser refuses the
 * frame at the last step, leaving a chat button that opens an empty box.
 *
 * A launcher that opens nothing is worse than no launcher, so the key stays
 * empty until Jeeta serves that route with a `frame-ancestors` policy that
 * admits customer domains. Set NEXT_PUBLIC_WEBCHAT_WIDGET_KEY to the workspace
 * key (wc_…) to switch it back on — no code change needed.
 */
export const WEBCHAT_WIDGET_KEY =
  process.env.NEXT_PUBLIC_WEBCHAT_WIDGET_KEY ?? '';

export const WEBCHAT_HOST = (
  process.env.NEXT_PUBLIC_WEBCHAT_HOST ?? 'https://jeetagrowth.com'
).replace(/\/+$/, '');

/** Empty when the widget is switched off, so the CSP stays as tight as it was. */
export const WEBCHAT_CSP_ORIGIN = WEBCHAT_WIDGET_KEY ? WEBCHAT_HOST : '';
