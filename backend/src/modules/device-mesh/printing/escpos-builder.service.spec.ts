import { EscPosBuilderService } from "./escpos-builder.service";
import { EscPosBuilderRegistry } from "./escpos-builder.registry";
import type {
  ReceiptSnapshotV1,
  KitchenTicketSnapshotV1,
} from "../../orders/services/receipt-snapshot.builder";

/**
 * Spec for the cloud-side ESC/POS byte builder (the REAL impl behind the
 * EscPosBuilder seam). Load-bearing contracts: a well-formed command stream
 * (ESC @ init + ESC t 19 CP857 codepage + GS V cut + ESC p drawer kick);
 * Turkish characters encoded to their CP857 codepoints (not "?"); the base64
 * payload exactly equals the bytes; determinism (same snapshot → identical
 * bytes → identical contentHash) for the bridge's redelivery dedupe; and it
 * self-registers on init.
 *
 * Mirrors mock-fiscal-provider.spec.ts: construct with a mocked registry, no
 * Nest container, assert the contract directly.
 */
describe("EscPosBuilderService", () => {
  // ── Fixtures ────────────────────────────────────────────────────────────
  const receipt: ReceiptSnapshotV1 = {
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

  const kitchen: KitchenTicketSnapshotV1 = {
    version: 1,
    order: {
      id: "order-1",
      orderNumber: "A-007",
      type: "DINE_IN",
      tableNumber: "5",
    },
    items: [
      {
        name: "Adana Kebap",
        quantity: 2,
        modifiers: ["Acılı"],
        notes: null,
      },
      { name: "Şiş", quantity: 1, modifiers: [], notes: "az pişmiş" },
    ],
    specialInstructions: "Alerjisi var: fıstık",
    createdAt: "2026-04-27T10:00:00.000Z",
  };

  const makeService = () =>
    new EscPosBuilderService({} as EscPosBuilderRegistry);

  // ESC/POS control codes the bytes MUST contain.
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

  // ── buildReceipt ──────────────────────────────────────────────────────
  describe("buildReceipt", () => {
    it("starts with ESC @ init and selects the CP857 (PC857 Turkish) codepage", () => {
      const job = makeService().buildReceipt(receipt);
      expect(job.bytes[0]).toBe(ESC);
      expect(job.bytes[1]).toBe(0x40); // ESC @
      expect(has(job.bytes, [ESC, 0x74, 19])).toBe(true); // ESC t 19 = PC857
      expect(job.codepage).toBe("CP857");
    });

    it("encodes Turkish letters to their CP857 codepoints, never to '?'", () => {
      const job = makeService().buildReceipt(receipt);
      // "Çiğ Köfteci Ömer": Ç=0x80, ğ=0xA7, Ö=0x99, ç=0x87 must all appear.
      expect(has(job.bytes, [0x80])).toBe(true); // Ç
      expect(has(job.bytes, [0xa7])).toBe(true); // ğ
      expect(has(job.bytes, [0x99])).toBe(true); // Ö
      // Acılı → 'ı' is 0x8D
      expect(has(job.bytes, [0x8d])).toBe(true);
    });

    it("emits bold (ESC E) + size (GS !) for the header and grand total", () => {
      const job = makeService().buildReceipt(receipt);
      expect(has(job.bytes, [ESC, 0x45, 1])).toBe(true); // bold on
      expect(has(job.bytes, [GS, 0x21])).toBe(true); // size select
    });

    it("renders money as Turkish-grouped 'TL' (no ₺ glyph that CP857 lacks)", () => {
      const job = makeService().buildReceipt(receipt);
      const ascii = Buffer.from(job.bytes).toString("latin1");
      expect(ascii).toContain("118,00 TL");
      expect(ascii).not.toContain("₺");
      expect(ascii).toContain("TOPLAM");
    });

    it("includes the KDV (tax) breakdown line", () => {
      const job = makeService().buildReceipt(receipt);
      const ascii = Buffer.from(job.bytes).toString("latin1");
      expect(ascii).toContain("KDV");
      expect(ascii).toContain("18,00 TL");
    });

    it("ends with a GS V paper cut by default and omits it when cut=false", () => {
      const withCut = makeService().buildReceipt(receipt);
      expect(has(withCut.bytes, [GS, 0x56])).toBe(true);
      const noCut = makeService().buildReceipt(receipt, { cut: false });
      expect(has(noCut.bytes, [GS, 0x56])).toBe(false);
    });

    it("appends an ESC p drawer kick only when kickDrawerAfter is set", () => {
      const plain = makeService().buildReceipt(receipt);
      expect(has(plain.bytes, [ESC, 0x70])).toBe(false);
      const kick = makeService().buildReceipt(receipt, {
        kickDrawerAfter: true,
      });
      expect(has(kick.bytes, [ESC, 0x70])).toBe(true);
    });

    it("emits a GS ( k QR sequence when a qr option is supplied", () => {
      const job = makeService().buildReceipt(receipt, {
        qr: { data: "https://verify.example/A-007" },
      });
      expect(has(job.bytes, [GS, 0x28, 0x6b])).toBe(true);
    });

    it("rejects an oversized QR payload instead of overflowing the 16-bit length field", () => {
      // > 0xfffc bytes would overflow the GS ( k pL/pH length field and desync
      // the printer; the builder must throw rather than emit a corrupt stream.
      const huge = "x".repeat(0xfffc + 1);
      expect(() =>
        makeService().buildReceipt(receipt, { qr: { data: huge } }),
      ).toThrow(/QR payload too large/);
      // A payload at the boundary still builds.
      expect(() =>
        makeService().buildReceipt(receipt, {
          qr: { data: "x".repeat(0xfffc) },
        }),
      ).not.toThrow();
    });

    it("base64 exactly round-trips the bytes and reports byteLength", () => {
      const job = makeService().buildReceipt(receipt);
      expect(job.base64).toBe(Buffer.from(job.bytes).toString("base64"));
      expect(Buffer.from(job.base64, "base64")).toEqual(Buffer.from(job.bytes));
      expect(job.byteLength).toBe(job.bytes.length);
    });

    it("is deterministic: same snapshot → byte-identical output", () => {
      const a = makeService().buildReceipt(receipt);
      const b = makeService().buildReceipt(receipt);
      expect(Buffer.from(a.bytes)).toEqual(Buffer.from(b.bytes));
    });

    it("handles a takeaway order with no table and a discount line", () => {
      const job = makeService().buildReceipt({
        ...receipt,
        order: { ...receipt.order, type: "TAKEAWAY", tableNumber: null },
        totals: { ...receipt.totals, discount: "10.00" },
      });
      const ascii = Buffer.from(job.bytes).toString("latin1");
      expect(ascii).toContain("Paket");
      expect(ascii).not.toContain("Masa");
      expect(ascii).toContain("-10,00 TL");
    });
  });

  // ── buildKitchenTicket ──────────────────────────────────────────────────
  describe("buildKitchenTicket", () => {
    it("inits + sets CP857 and prints the MUTFAK header, no prices", () => {
      const job = makeService().buildKitchenTicket(kitchen);
      expect(has(job.bytes, [ESC, 0x40])).toBe(true);
      expect(has(job.bytes, [ESC, 0x74, 19])).toBe(true);
      const ascii = Buffer.from(job.bytes).toString("latin1");
      expect(ascii).toContain("MUTFAK");
      expect(ascii).toContain("A-007");
      expect(ascii).not.toContain("TL"); // kitchen ticket carries no money
    });

    it("renders the special-instructions note in bold", () => {
      const job = makeService().buildKitchenTicket(kitchen);
      const ascii = Buffer.from(job.bytes).toString("latin1");
      expect(ascii).toContain("NOT:");
      expect(has(job.bytes, [ESC, 0x45, 1])).toBe(true);
    });

    it("encodes the Turkish 'Ş' in 'Şiş' to CP857 (0x9E / 0x9F), not '?'", () => {
      const job = makeService().buildKitchenTicket(kitchen);
      expect(has(job.bytes, [0x9e])).toBe(true); // Ş
      expect(has(job.bytes, [0x9f])).toBe(true); // ş
    });
  });

  // ── drawerKick ────────────────────────────────────────────────────────
  describe("drawerKick", () => {
    it("produces a bare ESC p pulse on pin 0 by default (no ESC @ reset)", () => {
      const job = makeService().drawerKick();
      expect(Array.from(job.bytes.slice(0, 3))).toEqual([ESC, 0x70, 0]);
      expect(has(job.bytes, [ESC, 0x40])).toBe(false); // no init/reset
      expect(job.artifact).toBe("drawer_kick");
    });

    it("targets pin 1 when requested", () => {
      const job = makeService().drawerKick(1);
      expect(job.bytes[2]).toBe(1);
    });
  });

  // ── command-payload wrappers ──────────────────────────────────────────
  describe("command wrappers", () => {
    it("toPrintCommand wraps a receipt into a print_receipt command with base64 + sha256", () => {
      const svc = makeService();
      const job = svc.buildReceipt(receipt);
      const cmd = svc.toPrintCommand(job);
      expect(cmd.kind).toBe("print_receipt");
      expect(cmd.payload.data).toBe(job.base64);
      expect(cmd.payload.codepage).toBe("CP857");
      expect(cmd.payload.artifact).toBe("receipt");
      expect(cmd.payload.contentHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it("toDrawerCommand wraps a kick into open_drawer carrying the pin", () => {
      const svc = makeService();
      const job = svc.drawerKick(1);
      const cmd = svc.toDrawerCommand(job, 1);
      expect(cmd.kind).toBe("open_drawer");
      expect(cmd.payload.pin).toBe(1);
      expect(cmd.payload.data).toBe(job.base64);
    });

    it("contentHash is stable across identical jobs (bridge redelivery dedupe)", () => {
      const svc = makeService();
      const h1 = svc.toPrintCommand(svc.buildReceipt(receipt)).payload
        .contentHash;
      const h2 = svc.toPrintCommand(svc.buildReceipt(receipt)).payload
        .contentHash;
      expect(h1).toBe(h2);
    });
  });

  // ── registration ────────────────────────────────────────────────────────
  describe("onModuleInit", () => {
    it("self-registers into the EscPosBuilderRegistry under its id", () => {
      const register = jest.fn();
      const svc = new EscPosBuilderService({
        register,
      } as unknown as EscPosBuilderRegistry);
      svc.onModuleInit();
      expect(register).toHaveBeenCalledWith(svc);
      expect(svc.id).toBe("escpos-tr");
    });
  });
});
