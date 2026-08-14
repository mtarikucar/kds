/**
 * Web-chat launcher configuration.
 *
 * Shared on purpose: `WebChatWidget` renders the loader tag and
 * `next.config.ts` has to widen the CSP for the very same origin. Keeping the
 * key and host in one place is what stops the header and the tag from drifting
 * apart — a drift whose only symptom is a launcher that silently never appears,
 * because the script tag is in the DOM but the browser refuses to run it.
 *
 * Blank the key (NEXT_PUBLIC_WEBCHAT_WIDGET_KEY="") on staging and preview: the
 * widget stops rendering AND the CSP stops being widened, so test traffic can
 * neither open real conversations nor pull a third-party script.
 */
export const WEBCHAT_WIDGET_KEY =
  process.env.NEXT_PUBLIC_WEBCHAT_WIDGET_KEY ??
  'wc_b6fe4a2d8c1d42cc9643b5136892ae18';

export const WEBCHAT_HOST = (
  process.env.NEXT_PUBLIC_WEBCHAT_HOST ?? 'https://jeetagrowth.com'
).replace(/\/+$/, '');

/** Empty when the widget is switched off, so the CSP stays as tight as it was. */
export const WEBCHAT_CSP_ORIGIN = WEBCHAT_WIDGET_KEY ? WEBCHAT_HOST : '';
