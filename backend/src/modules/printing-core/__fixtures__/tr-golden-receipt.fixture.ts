import type { ReceiptSnapshotV1 } from "../../orders/services/receipt-snapshot.builder";

/**
 * Task 13's byte-for-byte Turkish receipt fixture + golden output, captured
 * from EscPosBuilderService BEFORE Task 13 touched money()/date formatting
 * (see escpos-builder.service.spec.ts's "Task 13 — country-profile-driven
 * formatting" describe block for the full explanation). That file's
 * `receiptWithOptions`/`kitchen`/`takeaway` goldens stay local to it — they
 * are Task 13's own extended checks and not part of Task 14's contract.
 *
 * Task 14 (common/country/tr-unchanged.spec.ts) imports EXACTLY this
 * fixture + golden value instead of capturing a second one: a golden
 * captured fresh from the CURRENT code would only prove "the code agrees
 * with itself today", not "the code still agrees with what shipped before
 * this project touched it" — which is the entire point of a regression pin.
 * One constant, two specs, zero risk of the two silently drifting apart.
 */
export const TR_GOLDEN_RECEIPT_FIXTURE: ReceiptSnapshotV1 = {
  version: 1,
  restaurant: { name: "Çiğ Köfteci Ömer", currency: "TRY" },
  order: {
    id: "order-1",
    orderNumber: "A-007",
    type: "DINE_IN",
    tableNumber: "5",
    notes: null,
  },
  items: [
    {
      name: "Adana Kebap",
      quantity: 2,
      unitPrice: "30.00",
      totalPrice: "60.00",
      modifiers: ["Acılı"],
      notes: null,
    },
    {
      name: "Pide",
      quantity: 1,
      unitPrice: "40.00",
      totalPrice: "40.00",
      modifiers: [],
      notes: "tuzsuz",
    },
  ],
  totals: {
    subtotal: "100.00",
    tax: "18.00",
    discount: "0.00",
    total: "118.00",
  },
  payment: {
    method: "CASH",
    transactionId: null,
    paidAt: "2026-04-27T10:30:00.000Z",
  },
  printedAt: "2026-04-27T10:30:00.000Z",
};

/** Task 13's default-options golden output for {@link TR_GOLDEN_RECEIPT_FIXTURE}. */
export const TR_GOLDEN_RECEIPT_BASE64 =
  "G0AbdBMbYQEbRQEdIRGAaacgS5RmdGVjaSCZbWVyCh0hABtFAEFEmFNZT04gLyBGmJ4KG2EALS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tCkZpnyBObyA6IEEtMDA3ClSBciAgICA6IE1hc2FkYQpNYXNhICAgOiA1ClRhcmloICA6IDI3LjA0LjIwMjYgMTM6MzAKLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tCjIgeCBBZGFuYSBLZWJhcCAgICAgICAgICAgICAgICAgICA2MCwwMCBUTAogICArIEFjjWyNCjEgeCBQaWRlICAgICAgICAgICAgICAgICAgICAgICAgICA0MCwwMCBUTAogICBub3Q6IHR1enN1egotLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0KQXJhIFRvcGxhbSAgICAgICAgICAgICAgICAgICAgICAgMTAwLDAwIFRMCktEViAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAxOCwwMCBUTAobRQEdIQFUT1BMQU0gICAgICAxMTgsMDAgVEwKHSEAG0UALS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tCplkZW1lICA6IE5ha2l0Ci0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLQobYQFCaXppIHRlcmNpaCBldHRpp2luaXogaYdpbgp0ZZ9la2uBciBlZGVyaXouChthAAoKCh1WQgA=";
