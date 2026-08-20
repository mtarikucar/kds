import * as iconv from "iconv-lite";
import { EscPosBuilderUzService } from "./escpos-builder-uz.service";
import { EscPosBuilderRegistry } from "./escpos-builder.registry";
import type {
  ReceiptSnapshotV1,
  KitchenTicketSnapshotV1,
} from "../orders/services/receipt-snapshot.builder";

/**
 * Spec for the UZ ESC/POS byte builder (Task 13). The shared TR builder
 * (EscPosBuilderService, CP857) turns every character it doesn't recognise
 * into '?' — CP857 cannot represent Cyrillic at all, so a Cyrillic product
 * name on a UZ receipt printed as a row of question marks. This builder
 * selects CP866 (DOS Cyrillic #2) instead, and self-registers under a
 * DIFFERENT id ("escpos-uz") so it doesn't touch the TR path.
 *
 * Mirrors escpos-builder.service.spec.ts's fixtures/structure so the two
 * specs are easy to compare side by side.
 */
describe("EscPosBuilderUzService", () => {
  const receipt: ReceiptSnapshotV1 = {
    version: 1,
    restaurant: { name: "Somsa Xontaxta", currency: "UZS" },
    order: {
      id: "order-1",
      orderNumber: "A-007",
      type: "DINE_IN",
      tableNumber: "5",
      notes: null,
    },
    items: [
      {
        // Cyrillic product name — the exact failure mode this builder fixes.
        name: "Плов Ташкентский",
        quantity: 2,
        unitPrice: "30000.00",
        totalPrice: "60000.00",
        modifiers: ["Острый"],
        notes: null,
      },
      {
        // Uzbek Latin with the modifier-apostrophe letters (oʻ / gʻ).
        name: "Norin qozon-oʻsha",
        quantity: 1,
        unitPrice: "40000.00",
        totalPrice: "40000.00",
        modifiers: [],
        notes: "gʻalati",
      },
    ],
    totals: {
      subtotal: "100000.00",
      tax: "12000.00",
      discount: "0.00",
      total: "112000.00",
    },
    payment: {
      method: "CASH",
      transactionId: null,
      paidAt: "2026-04-27T10:30:00.000Z",
    },
    printedAt: "2026-04-27T10:30:00.000Z",
  };

  const kitchen: KitchenTicketSnapshotV1 = {
    version: 1,
    order: {
      id: "order-1",
      orderNumber: "A-007",
      type: "DINE_IN",
      tableNumber: "5",
    },
    items: [
      { name: "Плов Ташкентский", quantity: 2, modifiers: ["Острый"], notes: null },
      { name: "Norin", quantity: 1, modifiers: [], notes: "oʻta achchiq" },
    ],
    specialInstructions: "Аллергия: орехи",
    createdAt: "2026-04-27T10:00:00.000Z",
  };

  const makeService = () =>
    new EscPosBuilderUzService({} as EscPosBuilderRegistry);

  const ESC = 0x1b;
  const GS = 0x1d;
  const has = (bytes: Uint8Array, seq: number[]): boolean => {
    for (let i = 0; i + seq.length <= bytes.length; i++) {
      let ok = true;
      for (let j = 0; j < seq.length; j++) {
        if (bytes[i + j] !== seq[j]) {
          ok = false;
          break;
        }
      }
      if (ok) return true;
    }
    return false;
  };
  const questionMarkCount = (bytes: Uint8Array): number =>
    Array.from(bytes).filter((b) => b === 0x3f).length;

  describe("registration", () => {
    it('self-registers under "escpos-uz" — NOT the shared TR id', () => {
      const register = jest.fn();
      const svc = new EscPosBuilderUzService({
        register,
      } as unknown as EscPosBuilderRegistry);
      svc.onModuleInit();
      expect(register).toHaveBeenCalledWith(svc);
      expect(svc.id).toBe("escpos-uz");
    });
  });

  describe("codepage", () => {
    it("starts with ESC @ init and selects the CP866 (Cyrillic #2) codepage — ESC t 17", () => {
      const job = makeService().buildReceipt(receipt);
      expect(job.bytes[0]).toBe(ESC);
      expect(job.bytes[1]).toBe(0x40); // ESC @
      expect(has(job.bytes, [ESC, 0x74, 17])).toBe(true); // ESC t 17 = PC866
      expect(job.codepage).toBe("CP866");
    });
  });

  describe("Cyrillic text", () => {
    it("a Cyrillic product name does not become '?' on a UZ receipt", () => {
      const job = makeService().buildReceipt(receipt);
      const text = iconv.decode(Buffer.from(job.bytes), "cp866");
      expect(text).toContain("Плов Ташкентский");
      expect(text).toContain("Острый");
    });

    it("carries zero '?' bytes for a receipt that is entirely Cyrillic + ASCII", () => {
      const cyrillicOnly: ReceiptSnapshotV1 = {
        ...receipt,
        items: [
          {
            name: "Плов Ташкентский",
            quantity: 1,
            unitPrice: "10000.00",
            totalPrice: "10000.00",
            modifiers: ["Острый", "Без лука"],
            notes: "быстро",
          },
        ],
      };
      const job = makeService().buildReceipt(cyrillicOnly);
      expect(questionMarkCount(job.bytes)).toBe(0);
    });

    it("round-trips the full Russian Cyrillic alphabet (33 letters incl. Ё) through CP866, no '?'", () => {
      const svc = makeService();
      const upper = "АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ";
      const lower = "абвгдеёжзийклмнопрстуфхцчшщъыьэюя";
      // Carried as MODIFIER lines (`   + <text>`), not the item-name/price
      // two-column line — a 42-column receipt legitimately truncates a
      // too-long two-column row (same pre-existing behaviour as the TR
      // builder), which is a column-width constraint, not an encoding
      // defect; this test isolates the encoding question from that layout
      // concern by using a short item name and putting the full alphabets
      // on their own lines instead.
      const job = svc.buildReceipt({
        ...receipt,
        items: [
          {
            name: "Alifbo",
            quantity: 1,
            unitPrice: "1.00",
            totalPrice: "1.00",
            modifiers: [upper, lower],
            notes: null,
          },
        ],
      });
      const text = iconv.decode(Buffer.from(job.bytes), "cp866");
      expect(text).toContain(upper);
      expect(text).toContain(lower);
      expect(questionMarkCount(job.bytes)).toBe(0);
    });
  });

  describe("Uzbek Latin", () => {
    it("degrades the oʻ/gʻ modifier-apostrophe letters to a plain ASCII apostrophe, not '?'", () => {
      const job = makeService().buildReceipt(receipt);
      const ascii = Buffer.from(job.bytes).toString("latin1");
      expect(ascii).toContain("Norin qozon-o'sha");
      expect(ascii).toContain("g'alati");
      expect(ascii).not.toContain("Norin qozon-o?sha");
    });
  });

  describe("labels", () => {
    it("uses ASCII-safe field labels (no Turkish diacritics — CP866 cannot encode them, they'd become '?')", () => {
      const job = makeService().buildReceipt(receipt);
      const ascii = Buffer.from(job.bytes).toString("latin1");
      expect(ascii).not.toContain("?");
      expect(ascii).toContain("Fis No");
      expect(ascii).toContain("Odeme");
    });
  });

  describe("money", () => {
    it("renders UZS with zero decimals and the ISO code suffix — never a wrong symbol, never '$'", () => {
      const job = makeService().buildReceipt(receipt);
      // uz-UZ groups thousands with U+00A0 (NBSP) — decode through the real
      // codepage rather than assume an ungrouped ASCII string.
      const text = iconv.decode(Buffer.from(job.bytes), "cp866");
      expect(text).toContain("112 000 UZS");
      expect(text).not.toContain("112000.00");
      expect(text).not.toContain("112000,00");
      expect(text).not.toContain("$");
    });
  });

  describe("timestamp", () => {
    it('defaults to "Asia/Tashkent" (this dialect\'s own default) when no timezone option is given', () => {
      const job = makeService().buildReceipt(receipt);
      const ascii = Buffer.from(job.bytes).toString("latin1");
      // printedAt 10:30 UTC → 15:30 in Asia/Tashkent (UTC+5). uz-UZ's Intl
      // date pattern is "DD/MM/YYYY, HH:mm" — genuinely different from
      // tr-TR's "DD.MM.YYYY HH:mm" (verified via Intl.DateTimeFormat, not
      // assumed) — exactly the locale-driven behaviour Task 13 wants.
      expect(ascii).toContain("27/04/2026, 15:30");
    });

    it("honours an explicit BRANCH timezone override", () => {
      const job = makeService().buildReceipt(receipt, {
        timezone: "Europe/Istanbul",
      });
      const ascii = Buffer.from(job.bytes).toString("latin1");
      expect(ascii).toContain("27/04/2026, 13:30");
    });
  });

  describe("buildKitchenTicket", () => {
    it("prints Cyrillic items and instructions with zero '?' bytes", () => {
      const job = makeService().buildKitchenTicket(kitchen);
      expect(questionMarkCount(job.bytes)).toBe(0);
      const text = iconv.decode(Buffer.from(job.bytes), "cp866");
      expect(text).toContain("Плов Ташкентский");
      expect(text).toContain("Аллергия: орехи");
    });

    it("selects CP866 for the kitchen ticket too", () => {
      const job = makeService().buildKitchenTicket(kitchen);
      expect(has(job.bytes, [ESC, 0x74, 17])).toBe(true);
    });
  });

  describe("drawerKick and command wrappers", () => {
    it("produces a bare ESC p pulse (no ESC @ reset)", () => {
      const job = makeService().drawerKick();
      expect(Array.from(job.bytes.slice(0, 3))).toEqual([ESC, 0x70, 0]);
      expect(has(job.bytes, [ESC, 0x40])).toBe(false);
    });

    it("toPrintCommand reports the CP866 codepage", () => {
      const svc = makeService();
      const cmd = svc.toPrintCommand(svc.buildReceipt(receipt));
      expect(cmd.payload.codepage).toBe("CP866");
      expect(cmd.payload.contentHash).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe("determinism", () => {
    it("same snapshot → byte-identical output", () => {
      const a = makeService().buildReceipt(receipt);
      const b = makeService().buildReceipt(receipt);
      expect(Buffer.from(a.bytes)).toEqual(Buffer.from(b.bytes));
    });
  });

  describe("GS cut / QR", () => {
    it("ends with a GS V paper cut by default", () => {
      const job = makeService().buildReceipt(receipt);
      expect(has(job.bytes, [GS, 0x56])).toBe(true);
    });
  });
});
