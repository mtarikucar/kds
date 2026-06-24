import { useState, useEffect } from "react";
import QRMenuLayout, { MenuData } from "./QRMenuLayout";
import CartContent from "../../components/qr-menu/CartContent";
import TableSelectionModal from "../../components/qr-menu/TableSelectionModal";
import { useCartStore } from "../../store/cartStore";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import axios from "axios";
import { toast } from "sonner";
import { useGeolocation } from "../../hooks";
import { buildQRMenuUrl } from "../../utils/subdomain";
import { getApiErrorMessage } from "../../lib/api-error";

interface SubdomainCartPageProps {
  subdomain: string;
}

const SubdomainCartPage: React.FC<SubdomainCartPageProps> = ({ subdomain }) => {
  const { t } = useTranslation("common");
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const tableId = searchParams.get("tableId");

  const [menuData, setMenuData] = useState<MenuData | null>(null);
  const [isShowingTableSelection, setIsShowingTableSelection] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [locationRequested, setLocationRequested] = useState(false);

  const { items, sessionId, clearCart } = useCartStore();
  const { latitude, longitude, getCurrentPosition } = useGeolocation();

  // Request location when page loads
  useEffect(() => {
    if (!locationRequested) {
      setLocationRequested(true);
      getCurrentPosition();
    }
  }, [locationRequested, getCurrentPosition]);

  const handleSubmitOrder = async (selectedTableId?: string) => {
    // Prevent double submission
    if (isSubmitting) return;

    if (!sessionId || !menuData) {
      toast.error(t("cart.sessionExpired"));
      return;
    }

    const tenantId = menuData.tenant.id;

    // The table can come from the QR URL OR from the TableSelectionModal the
    // dine-in path opens when the URL has none. Without honoring the modal's
    // pick the order could never be placed (the modal would just re-open).
    // Type-guard the arg: this handler is also wired directly to the submit
    // button's onClick, which would pass a MouseEvent — ignore anything that
    // isn't an explicit string tableId.
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
    try {
      const API_URL =
        import.meta.env.VITE_API_URL || "http://localhost:3000/api";
      const orderUrl = API_URL + "/customer-orders";

      await axios.post(orderUrl, {
        tenantId,
        tableId: effectiveTableId,
        sessionId,
        latitude: orderLat || undefined,
        longitude: orderLng || undefined,
        items: items.map((item) => ({
          productId: item.product.id,
          quantity: item.quantity,
          // Remap CartModifier `id` → server `modifierId` (see CartPage): raw
          // posting made every customized order 400 under the whitelist pipe.
          modifiers: (item.modifiers ?? []).map((m) => ({
            modifierId: m.id,
            quantity: m.quantity,
          })),
          notes: item.notes,
        })),
      });

      toast.success(t("cart.orderSubmitted"));
      clearCart();

      const ordersUrl = buildQRMenuUrl("orders", {
        subdomain,
        tableId: effectiveTableId,
        sessionId,
      });
      navigate(ordersUrl);
    } catch (error) {
      toast.error(getApiErrorMessage(error, t("messages.operationFailed")));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <QRMenuLayout
      currentPage="cart"
      onMenuDataLoaded={setMenuData}
      subdomain={subdomain}
    >
      {menuData && (
        <>
          <CartContent
            settings={menuData.settings}
            enableCustomerOrdering={menuData.enableCustomerOrdering}
            currency={menuData.tenant.currency || "TRY"}
            onSubmitOrder={handleSubmitOrder}
            onShowTableSelection={() => setIsShowingTableSelection(true)}
            isSubmitting={isSubmitting}
            tenantId={menuData.tenant.id}
            tableId={tableId}
            subdomain={subdomain}
          />
          {isShowingTableSelection && (
            <TableSelectionModal
              isOpen={isShowingTableSelection}
              onClose={() => setIsShowingTableSelection(false)}
              onSelectTable={(id) => {
                setIsShowingTableSelection(false);
                handleSubmitOrder(id);
              }}
              primaryColor={menuData.settings.primaryColor}
            />
          )}
        </>
      )}
    </QRMenuLayout>
  );
};

export default SubdomainCartPage;
