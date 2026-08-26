import { useState, useEffect, useRef } from "react";
import QRMenuLayout, { MenuData } from "./QRMenuLayout";
import CartContent from "../../components/qr-menu/CartContent";
import TableSelectionModal from "../../components/qr-menu/TableSelectionModal";
import { useCartStore } from "../../store/cartStore";
import { withCustomerSession } from "../../features/qr-menu/customerSession";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import axios from "axios";
import { toast } from "sonner";
import { MapPinOff } from "lucide-react";
import { useGeolocation } from "../../hooks";
import { getApiErrorMessage } from "../../lib/api-error";

const CartPage = () => {
  const { t } = useTranslation("common");
  const navigate = useNavigate();
  const { tenantId } = useParams<{ tenantId: string }>();
  const [searchParams] = useSearchParams();
  const tableId = searchParams.get("tableId");

  const [menuData, setMenuData] = useState<MenuData | null>(null);
  const [isShowingTableSelection, setIsShowingTableSelection] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [locationRequested, setLocationRequested] = useState(false);
  // A tenant that has coordinates on file refuses any order placed without a
  // position — in hardcoded Turkish, whatever language the guest is reading.
  // The menu payload doesn't say whether THIS tenant geofences, so instead of
  // posting blind and forwarding that sentence, we stop, explain it in the
  // guest's own language, and offer the retry that actually fixes it.
  const [locationBlocked, setLocationBlocked] = useState(false);
  // Read synchronously by the submit handler: "order anyway" submits in the
  // same tick it is set, before a state update could land.
  const skipLocationRef = useRef(false);
  // Review C4: order-level special notes live on the page (not inside
  // CartContent) so the table-selection detour can't lose them and the POST
  // body can actually carry them.
  const [specialNotes, setSpecialNotes] = useState("");
  // Review C6: synchronous double-tap latch. isSubmitting is React state and
  // only flips AFTER the (potentially multi-second) geolocation await — every
  // tap in that window used to POST a duplicate order. The ref latches on the
  // very first statement (mirrors SelfPayModal's inflight pattern);
  // isSubmitting stays for the button spinner.
  const submitLockRef = useRef(false);

  const { items, tableId: cartTableId, clearCart, setTableId } = useCartStore();
  const {
    latitude,
    longitude,
    loading: locationLoading,
    getCurrentPosition,
  } = useGeolocation();

  // Request location when page loads. Surfacing the refusal here — not on the
  // tap that would have dead-ended — is the point: the guest sees the problem
  // while they still have their hands on the phone.
  useEffect(() => {
    if (locationRequested) return;
    setLocationRequested(true);
    void getCurrentPosition().then((position) => {
      if (!position && !skipLocationRef.current) setLocationBlocked(true);
    });
  }, [locationRequested, getCurrentPosition]);

  const handleRetryLocation = async () => {
    const position = await getCurrentPosition();
    if (position) setLocationBlocked(false);
  };

  const handleOrderWithoutLocation = () => {
    skipLocationRef.current = true;
    setLocationBlocked(false);
    void handleSubmitOrder();
  };

  const handleSubmitOrder = async (selectedTableId?: string) => {
    // Review C6: latch synchronously before ANY await.
    if (submitLockRef.current) return;
    submitLockRef.current = true;
    try {
      // Honor a table chosen in the modal (dine-in path with no QR table),
      // otherwise the modal would re-open forever and no order could be
      // placed. Type-guard the arg: this handler is also wired directly to
      // the submit button's onClick, which would pass a MouseEvent — ignore
      // anything that isn't an explicit string tableId.
      const tableOverride =
        typeof selectedTableId === "string" ? selectedTableId : undefined;
      const effectiveTableId = tableOverride || tableId || undefined;

      if (!effectiveTableId && !menuData?.enableTablelessMode) {
        setIsShowingTableSelection(true);
        return;
      }

      // Try to get location if not already available. Null checks, not
      // falsiness: 0 is a real coordinate (equator / prime meridian) and the
      // old `!orderLat` threw such a fix away.
      let orderLat = latitude;
      let orderLng = longitude;

      if (orderLat === null || orderLng === null) {
        const position = await getCurrentPosition();
        if (position) {
          orderLat = position.latitude;
          orderLng = position.longitude;
          setLocationBlocked(false);
        } else if (!skipLocationRef.current) {
          // Stop here: the server would refuse this order in a language the
          // guest may not read. The banner offers retry, or ordering anyway
          // for the (common) tenant that never geofenced in the first place.
          setLocationBlocked(true);
          return;
        }
      }

      setIsSubmitting(true);
      const API_URL =
        import.meta.env.VITE_API_URL || "http://localhost:3000/api";
      const orderUrl = API_URL + "/customer-orders";

      // Review C1: the sessionId is ALWAYS a server-minted 64-hex token —
      // ensured (minted on demand if the bootstrap mint hasn't landed) and
      // transparently re-minted + retried once on 401. The locally invented
      // UUID the store used to fabricate is gone and is never sent.
      await withCustomerSession((sessionId) =>
        axios.post(orderUrl, {
          tenantId,
          tableId: effectiveTableId,
          sessionId,
          // Review C4: order-level notes were captured but silently dropped.
          notes: specialNotes.trim() || undefined,
          latitude: orderLat ?? undefined,
          longitude: orderLng ?? undefined,
          items: items.map((item) => ({
            productId: item.product.id,
            quantity: item.quantity,
            // Remap the cart's CartModifier (keyed `id`) to the server contract
            // (`modifierId`). Posting raw left modifierId undefined → the
            // whitelist ValidationPipe stripped the rest → 400, so ANY
            // customized item failed to order. Mirrors the staff POS path.
            modifiers: (item.modifiers ?? []).map((m) => ({
              modifierId: m.id,
              quantity: m.quantity,
            })),
            // Combo slot picks — the backend explodes the combo into its
            // component order lines with per-line KDV. Review C2: send the
            // field whenever the cart line carries one (even empty) so a
            // deselected optional default is an EXPLICIT "none" and the
            // server never re-adds and charges it.
            ...(item.comboSelections
              ? { comboSelections: item.comboSelections }
              : {}),
            notes: item.notes,
          })),
        }),
      );

      // Keep the store's table in sync with the modal pick so the orders page
      // re-init doesn't rotate the session away from the just-placed order.
      if (effectiveTableId && cartTableId !== effectiveTableId) {
        setTableId(effectiveTableId);
      }

      toast.success(t("cart.orderSubmitted"));
      clearCart();

      const ordersUrl =
        "/qr-menu/" +
        tenantId +
        "/orders" +
        (effectiveTableId ? "?tableId=" + effectiveTableId : "");
      navigate(ordersUrl);
    } catch (error) {
      // Same rail as the subdomain cart: getApiErrorMessage localizes known
      // error codes and never forwards 429/5xx server internals to a diner.
      toast.error(getApiErrorMessage(error, t("messages.operationFailed")));
    } finally {
      submitLockRef.current = false;
      setIsSubmitting(false);
    }
  };

  return (
    <QRMenuLayout currentPage="cart" onMenuDataLoaded={setMenuData}>
      {menuData && (
        <>
          {locationBlocked && items.length > 0 && (
            <div
              role="alert"
              className="mx-4 mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
            >
              <p className="flex items-start gap-2">
                <MapPinOff className="mt-0.5 h-4 w-4 shrink-0" />
                {t("cart.location.unavailable")}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleRetryLocation}
                  disabled={locationLoading}
                  className="rounded-lg bg-amber-600 px-3 py-1.5 font-semibold text-white disabled:opacity-60"
                >
                  {locationLoading
                    ? t("cart.location.checking")
                    : t("cart.location.retry")}
                </button>
                <button
                  type="button"
                  onClick={handleOrderWithoutLocation}
                  className="rounded-lg border border-amber-300 px-3 py-1.5 font-semibold text-amber-900"
                >
                  {t("cart.location.orderAnyway")}
                </button>
              </div>
            </div>
          )}
          <CartContent
            settings={menuData.settings}
            enableCustomerOrdering={menuData.enableCustomerOrdering}
            currency={menuData.tenant.currency || "TRY"}
            onSubmitOrder={handleSubmitOrder}
            onShowTableSelection={() => setIsShowingTableSelection(true)}
            isSubmitting={isSubmitting}
            tenantId={tenantId}
            tableId={tableId}
            specialNotes={specialNotes}
            onSpecialNotesChange={setSpecialNotes}
          />
          {isShowingTableSelection && (
            <TableSelectionModal
              isOpen={isShowingTableSelection}
              onClose={() => setIsShowingTableSelection(false)}
              onSelectTable={(id) => {
                setIsShowingTableSelection(false);
                handleSubmitOrder(id);
              }}
              // Review C5: without the tenant the modal fetched
              // /tables/public/undefined and dead-ended the dine-in flow.
              tenantId={tenantId!}
              primaryColor={menuData.settings.primaryColor}
            />
          )}
        </>
      )}
    </QRMenuLayout>
  );
};

export default CartPage;
