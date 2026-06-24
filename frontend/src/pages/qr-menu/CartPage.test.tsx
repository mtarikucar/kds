import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

/**
 * Specs for CartPage — the QR customer order-submit flow. The submit
 * handler has the real logic: it blocks without a session (toast), opens
 * table selection when no table + tableless mode is off, maps cart items
 * into the customer-orders POST body, and on success clears the cart and
 * navigates to the orders page. We mock the layout/content/modal, the
 * cart store, geolocation, axios, toast and router.
 */

const post = vi.fn();
vi.mock("axios", () => ({
  default: { post: (...a: unknown[]) => post(...a) },
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (...a: unknown[]) => toastSuccess(...a),
    error: (...a: unknown[]) => toastError(...a),
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

const navigate = vi.fn();
let tableIdParam: string | null = null;
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<any>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => navigate,
    useParams: () => ({ tenantId: "t-1" }),
    useSearchParams: () => [
      { get: (k: string) => (k === "tableId" ? tableIdParam : null) },
    ],
  };
});

let cart: any;
vi.mock("../../store/cartStore", () => ({ useCartStore: () => cart }));

const getCurrentPosition = vi
  .fn()
  .mockResolvedValue({ latitude: 1, longitude: 2 });
vi.mock("../../hooks", () => ({
  useGeolocation: () => ({
    latitude: 1,
    longitude: 2,
    error: null,
    loading: false,
    getCurrentPosition,
    permissionStatus: "granted",
  }),
}));

const clearCart = vi.fn();
let menuFixture: any;
vi.mock("./QRMenuLayout", () => ({
  default: ({ children, onMenuDataLoaded }: any) => (
    <div>
      <button onClick={() => onMenuDataLoaded(menuFixture)}>load</button>
      {children}
    </div>
  ),
}));
vi.mock("../../components/qr-menu/CartContent", () => ({
  default: ({ onSubmitOrder }: any) => (
    <button onClick={onSubmitOrder}>submit</button>
  ),
}));
vi.mock("../../components/qr-menu/TableSelectionModal", () => ({
  default: ({ isOpen, onSelectTable }: any) =>
    isOpen ? (
      <div data-testid="table-modal">
        <button onClick={() => onSelectTable("table-x")}>pick-table</button>
      </div>
    ) : null,
}));

import CartPage from "./CartPage";

beforeEach(() => {
  vi.clearAllMocks();
  tableIdParam = null;
  cart = {
    items: [{ product: { id: "p1" }, quantity: 2, modifiers: [], notes: "x" }],
    sessionId: "sess-1",
    tableId: null,
    clearCart,
  };
  menuFixture = {
    settings: { primaryColor: "#fff" },
    tenant: { id: "t-1", currency: "TRY" },
    enableCustomerOrdering: true,
    enableTablelessMode: true,
  };
});

async function loadAndSubmit() {
  render(<CartPage />);
  fireEvent.click(screen.getByText("load"));
  fireEvent.click(screen.getByText("submit"));
}

describe("CartPage — submit guards", () => {
  it("toasts and aborts when there is no session", async () => {
    cart.sessionId = null;
    await loadAndSubmit();
    expect(toastError).toHaveBeenCalledWith("cart.sessionExpired");
    expect(post).not.toHaveBeenCalled();
  });

  it("opens table selection when no table id and tableless mode is off", async () => {
    tableIdParam = null;
    menuFixture.enableTablelessMode = false;
    await loadAndSubmit();
    expect(await screen.findByTestId("table-modal")).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });

  it("places the order with the table chosen in the modal (no dead-lock)", async () => {
    // Regression: the modal's selected tableId was discarded, so submit
    // re-opened the modal forever. Picking a table must now place the order.
    tableIdParam = null;
    menuFixture.enableTablelessMode = false;
    post.mockResolvedValue({ data: {} });
    await loadAndSubmit();
    fireEvent.click(await screen.findByText("pick-table"));
    await waitFor(() => expect(post).toHaveBeenCalled());
    const [, body] = post.mock.calls[0] as [string, any];
    expect(body.tableId).toBe("table-x");
  });
});

describe("CartPage — order submission", () => {
  it("POSTs the mapped cart, clears it and navigates to orders on success", async () => {
    post.mockResolvedValue({ data: {} });
    await loadAndSubmit();

    await waitFor(() => expect(post).toHaveBeenCalled());
    const [url, body] = post.mock.calls[0] as [string, any];
    expect(url).toContain("/customer-orders");
    expect(body).toMatchObject({
      tenantId: "t-1",
      sessionId: "sess-1",
      items: [{ productId: "p1", quantity: 2, modifiers: [], notes: "x" }],
    });
    await waitFor(() => expect(clearCart).toHaveBeenCalled());
    expect(toastSuccess).toHaveBeenCalledWith("cart.orderSubmitted");
    expect(navigate).toHaveBeenCalledWith(
      expect.stringContaining("/qr-menu/t-1/orders"),
    );
  });

  it("remaps selected modifiers from cart `id` to server `modifierId` (sweep-3 B1)", async () => {
    // Regression: the cart posted modifiers raw (keyed `id`); the server DTO
    // requires `modifierId`, and the whitelist ValidationPipe stripped the
    // rest → 400, so ANY customized item failed to order. The existing tests
    // only ever asserted `modifiers: []`, so they never caught it.
    cart.items = [
      {
        product: { id: "p1" },
        quantity: 1,
        modifiers: [
          { id: "m1", name: "Large", displayName: "Large", priceAdjustment: 5, quantity: 1 },
          { id: "m2", name: "Extra cheese", displayName: "Extra cheese", priceAdjustment: 3, quantity: 2 },
        ],
        notes: "",
      },
    ];
    post.mockResolvedValue({ data: {} });
    await loadAndSubmit();

    await waitFor(() => expect(post).toHaveBeenCalled());
    const [, body] = post.mock.calls[0] as [string, any];
    expect(body.items[0].modifiers).toEqual([
      { modifierId: "m1", quantity: 1 },
      { modifierId: "m2", quantity: 2 },
    ]);
  });

  it("toasts the server error and does NOT clear the cart on failure", async () => {
    post.mockRejectedValue({
      response: { data: { message: "kitchen closed" } },
    });
    await loadAndSubmit();

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("kitchen closed"),
    );
    expect(clearCart).not.toHaveBeenCalled();
  });
});
