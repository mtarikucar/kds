/**
 * Jeeta web-chat launcher.
 *
 * The loader at `<host>/widget.js` reads its own `data-*` attributes off
 * `document.currentScript` and returns early when that is null. `next/script`
 * with the default `afterInteractive` strategy appends the tag programmatically,
 * which leaves `currentScript` null — so this stays a plain parser-inserted
 * `<script>`, the same way the JSON-LD block in the layout does.
 *
 * Rendering is skipped when the key is blank, which is how a staging or preview
 * deploy opts out: set NEXT_PUBLIC_WEBCHAT_WIDGET_KEY="" there so test traffic
 * does not open real conversations in the shared inbox.
 */
const WIDGET_KEY =
  process.env.NEXT_PUBLIC_WEBCHAT_WIDGET_KEY ??
  'wc_b6fe4a2d8c1d42cc9643b5136892ae18';

const WIDGET_HOST = (
  process.env.NEXT_PUBLIC_WEBCHAT_HOST ?? 'https://jeetagrowth.com'
).replace(/\/+$/, '');

export function WebChatWidget() {
  if (!WIDGET_KEY) return null;

  return (
    <script
      src={`${WIDGET_HOST}/widget.js`}
      data-widget-key={WIDGET_KEY}
      // --brand from globals.css (orange-500), so the launcher matches the site
      // instead of the loader's own #1e40af default.
      data-accent="#f97316"
      async
    />
  );
}
