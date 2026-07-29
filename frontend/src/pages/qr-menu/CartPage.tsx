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
import { useGeolocation } from "../../hooks";

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
    error: locationError,
    loading: locationLoading,
    getCurrentPosition,
    permissionStatus,
  } = useGeolocation();

  // Request location when page loads
  useEffect(() => {
    if (!locationRequested) {
      setLocationRequested(true);
      getCurrentPosition();
    }
  }, [locationRequested, getCurrentPosition]);

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

      // Try to get location if not already available
      let orderLat = latitude;
      let orderLng = longitude;

      if (!orderLat || !orderLng) {
        const position = await getCurrentPosition();
        if (position) {
          orderLat = position.latitude;
          orderLng = position.longitude;
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
          latitude: orderLat || undefined,
          longitude: orderLng || undefined,
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
    } catch (error: any) {
      toast.error(
        error.response?.data?.message || t("messages.operationFailed"),
      );
    } finally {
      submitLockRef.current = false;
      setIsSubmitting(false);
    }
  };

  return (
    <QRMenuLayout currentPage="cart" onMenuDataLoaded={setMenuData}>
      {menuData && (
        <>
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
