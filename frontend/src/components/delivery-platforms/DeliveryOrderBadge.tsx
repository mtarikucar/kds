import { cn } from '../../lib/utils';
import { getPlatformDisplay } from './platformDisplay';

/**
 * Operator-facing badge that marks an order as coming from an external
 * delivery platform (Yemeksepeti / Getir / Trendyol / Migros). Shown on the
 * KDS order card, the admin delivery-orders queue and the POS pending list so
 * staff instantly recognise "this is a Yemeksepeti order" together with the
 * platform's own order id.
 *
 * Pure presentational — no i18n string needed for the platform name (it's a
 * proper noun / brand), but the optional "external id" prefix can be localised
 * by the caller via the `idLabel` prop. Returns null for internal/POS orders
 * (source falsy) so callers can render it unconditionally. Platform branding
 * lives in the sibling platformDisplay.ts module.
 */

interface DeliveryOrderBadgeProps {
  /** Order.source — e.g. "YEMEKSEPETI". Null/empty renders nothing. */
  source?: string | null;
  /** Order.externalOrderId — the platform's own id, shown when present. */
  externalOrderId?: string | null;
  /** Dark high-contrast theme for the KDS kiosk board. */
  kiosk?: boolean;
  /**
   * Optional localised prefix for the external id (e.g. "No:"). Passed by the
   * caller so this component stays i18n-free.
   */
  idLabel?: string;
  className?: string;
}

const DeliveryOrderBadge = ({
  source,
  externalOrderId,
  kiosk = false,
  idLabel,
  className,
}: DeliveryOrderBadgeProps) => {
  if (!source) return null;

  const display = getPlatformDisplay(source);

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold rounded-full whitespace-nowrap',
        kiosk ? display.kioskClassName : display.className,
        className,
      )}
      title={externalOrderId ? `${display.label} · ${externalOrderId}` : display.label}
    >
      <span>{display.label}</span>
      {externalOrderId && (
        <span className="font-mono font-normal opacity-80">
          {idLabel ? `${idLabel} ` : ''}
          {externalOrderId}
        </span>
      )}
    </span>
  );
};

export default DeliveryOrderBadge;
