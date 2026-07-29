import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

/**
 * Specs for CartPage — the QR customer order-submit flow. The submit
 * handler has the real logic: it opens table selection when no table +
 * tableless mode is off, submits with a SERVER-MINTED session id (C1) via
 * withCustomerSession, threads the order-level notes (C4), latches against
 * double-taps synchronously (C6), maps cart items into the customer-orders
 * POST body, and on success clears the cart and navigates to the orders
 * page. We mock the layout/content/modal, the cart store, the session rail,
 * geolocation, axios, toast and router.
 */

const post = vi.fn();
vi.mock("axios", () => ({
  default: { post: (...a: unknown[]) => post(...a) },
}));

// Review C1: the session rail is its own module (unit-tested in
// features/qr-menu/customerSession.test.ts). Here we assert the page routes
// its POST through it and uses the id the rail returns.
const MINTED_SESSION = "f".repeat(64);
const ensureCustomerSession = vi.fn();
vi.mock("../../features/qr-menu/customerSession", () => ({
  ensureCustomerSession: (...a: unknown[]) => ensureCustomerSession(...a),
  withCustomerSession: async (fn: (sid: string) => Promise<unknown>) =>
    fn(await ensureCustomerSession()),
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
  default: ({ onSubmitOrder, onSpecialNotesChange }: any) => (
    <div>
      <button onClick={() => onSpecialNotesChange("less salt please")}>
        type-notes
      </button>
      <button onClick={onSubmitOrder}>submit</button>
    </div>
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
  ensureCustomerSession.mockResolvedValue(MINTED_SESSION);
  tableIdParam = null;
  cart = {
    items: [{ product: { id: "p1" }, quantity: 2, modifiers: [], notes: "x" }],
    sessionId: null,
    tableId: null,
    clearCart,
    setTableId: vi.fn(),
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
  it("toasts and aborts when the server session cannot be minted (C1)", async () => {
    ensureCustomerSession.mockRejectedValue(new Error("mint down"));
    await loadAndSubmit();
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("messages.operationFailed"),
    );
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
  it("POSTs the mapped cart with the SERVER-MINTED session id (C1 flow), clears it and navigates", async () => {
    post.mockResolvedValue({ data: {} });
    await loadAndSubmit();

    await waitFor(() => expect(post).toHaveBeenCalled());
    const [url, body] = post.mock.calls[0] as [string, any];
    expect(url).toContain("/customer-orders");
    expect(body).toMatchObject({
      tenantId: "t-1",
      // Review C1: the id on the wire is EXACTLY what the mint rail returned
      // (64-hex server token) — never a locally fabricated UUID.
      sessionId: MINTED_SESSION,
      items: [{ productId: "p1", quantity: 2, modifiers: [], notes: "x" }],
    });
    expect(ensureCustomerSession).toHaveBeenCalled();
    await waitFor(() => expect(clearCart).toHaveBeenCalled());
    expect(toastSuccess).toHaveBeenCalledWith("cart.orderSubmitted");
    expect(navigate).toHaveBeenCalledWith(
      expect.stringContaining("/qr-menu/t-1/orders"),
    );
  });

  it("threads the typed order-level notes into the POST body (C4)", async () => {
    post.mockResolvedValue({ data: {} });
    render(<CartPage />);
    fireEvent.click(screen.getByText("load"));
    fireEvent.click(screen.getByText("type-notes"));
    fireEvent.click(screen.getByText("submit"));

    await waitFor(() => expect(post).toHaveBeenCalled());
    const [, body] = post.mock.calls[0] as [string, any];
    expect(body.notes).toBe("less salt please");
  });

  it("omits order-level notes when none were typed (C4)", async () => {
    post.mockResolvedValue({ data: {} });
    await loadAndSubmit();
    await waitFor(() => expect(post).toHaveBeenCalled());
    const [, body] = post.mock.calls[0] as [string, any];
    expect(body.notes).toBeUndefined();
  });

  it("two rapid submit taps produce exactly ONE POST (C6 latch)", async () => {
    // Make the session mint span a tick so the second tap lands inside the
    // async window that used to double-post.
    ensureCustomerSession.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(MINTED_SESSION), 20)),
    );
    post.mockResolvedValue({ data: {} });
    render(<CartPage />);
    fireEvent.click(screen.getByText("load"));
    fireEvent.click(screen.getByText("submit"));
    fireEvent.click(screen.getByText("submit"));

    await waitFor(() => expect(post).toHaveBeenCalled());
    // Give any (buggy) second submission time to land before asserting.
    await new Promise((r) => setTimeout(r, 50));
    expect(post).toHaveBeenCalledTimes(1);
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
