import { EscPosBuilderService } from "./escpos-builder.service";
import { EscPosBuilderRegistry } from "./escpos-builder.registry";
import type { KitchenTicketSnapshotV1 } from "../orders/services/receipt-snapshot.builder";
import {
  TR_GOLDEN_RECEIPT_FIXTURE,
  TR_GOLDEN_RECEIPT_BASE64,
} from "./__fixtures__/tr-golden-receipt.fixture";

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
  // Shared with tr-unchanged.spec.ts (Task 14) via TR_GOLDEN_RECEIPT_FIXTURE
  // — see that fixture file's doc comment for why this is imported rather
  // than redefined here.
  const receipt = TR_GOLDEN_RECEIPT_FIXTURE;

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

  // ── Task 13: country-profile-driven money/timestamp ─────────────────────
  describe("Task 13 — country-profile-driven formatting", () => {
    // Byte-for-byte golden output, captured from this exact builder BEFORE
    // Task 13 touched money()/date formatting (git rev preceding the Task
    // 13 commit — see task-13-report.md). Mandatory regression pin: a
    // Turkish receipt is printed on physical hardware in live restaurants,
    // so a subtle shift in spacing/column-width/rounding is a real-world
    // failure no unit test written AFTER the fact could catch. This one
    // can, because it was captured BEFORE.
    const GOLDEN = {
      receipt: TR_GOLDEN_RECEIPT_BASE64,
      receiptWithOptions:
        "G0AbdBMbYQEbRQEdIRGAaacgS5RmdGVjaSCZbWVyCh0hABtFAEFEmFNZT04gLyBGmJ4KG2EALS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tCkZpnyBObyA6IEEtMDA3ClSBciAgICA6IE1hc2FkYQpNYXNhICAgOiA1ClRhcmloICA6IDI3LjA0LjIwMjYgMTM6MzAKLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tCjIgeCBBZGFuYSBLZWJhcCAgICAgICAgICAgICAgICAgICA2MCwwMCBUTAogICArIEFjjWyNCjEgeCBQaWRlICAgICAgICAgICAgICAgICAgICAgICAgICA0MCwwMCBUTAogICBub3Q6IHR1enN1egotLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0KQXJhIFRvcGxhbSAgICAgICAgICAgICAgICAgICAgICAgMTAwLDAwIFRMCktEViAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAxOCwwMCBUTAobRQEdIQFUT1BMQU0gICAgICAxMTgsMDAgVEwKHSEAG0UALS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tCplkZW1lICA6IE5ha2l0Ci0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLQobYQFDdXN0b20gZm9vdGVyChthABtwABn6CgoKG2EBHShrBAAxQTIAHShrAwAxQwYdKGsDADFFMR0oax8AMVAwaHR0cHM6Ly92ZXJpZnkuZXhhbXBsZS9BLTAwNx0oawMAMVEwG2EAHVZCAA==",
      kitchen:
        "G0AbdBMbYQEbRQEdIRFNVVRGQUsKHSEAI0EtMDA3ChtFABthAFSBciAgOiBNYXNhZGEKG0UBTUFTQSA6IDUKG0UAMjcuMDQuMjAyNiAxMzowMAotLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0KG0UBHSEBMiB4IEFkYW5hIEtlYmFwCh0hABtFACAgICsgQWONbI0KG0UBHSEBMSB4IJ5pnwodIQAbRQAbRQEgICA+PiBheiBwaZ9taZ8KG0UALS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tChtFAU5PVDogQWxlcmppc2kgdmFyOiBmjXN0jWsKG0UACgoKHVZCAA==",
      takeaway:
        "G0AbdBMbYQEbRQEdIRGAaacgS5RmdGVjaSCZbWVyCh0hABtFAEFEmFNZT04gLyBGmJ4KG2EALS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tCkZpnyBObyA6IEEtMDA3ClSBciAgICA6IFBha2V0ClRhcmloICA6IDI3LjA0LjIwMjYgMTM6MzAKLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tCjIgeCBBZGFuYSBLZWJhcCAgICAgICAgICAgICAgICAgICA2MCwwMCBUTAogICArIEFjjWyNCjEgeCBQaWRlICAgICAgICAgICAgICAgICAgICAgICAgICA0MCwwMCBUTAogICBub3Q6IHR1enN1egotLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0KQXJhIFRvcGxhbSAgICAgICAgICAgICAgICAgICAgICAgMTAwLDAwIFRMCphuZGlyaW0gICAgICAgICAgICAgICAgICAgICAgICAgIC0xMCwwMCBUTApLRFYgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgMTgsMDAgVEwKG0UBHSEBVE9QTEFNICAgICAgMTE4LDAwIFRMCh0hABtFAC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLQqZZGVtZSAgOiBOYWtpdAotLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0KG2EBQml6aSB0ZXJjaWggZXR0aadpbml6IGmHaW4KdGWfZWtrgXIgZWRlcml6LgobYQAKCgodVkIA",
    };

    it("renders a Turkish receipt byte-identically to before (default options — regression pin)", () => {
      const job = makeService().buildReceipt(receipt);
      expect(job.base64).toBe(GOLDEN.receipt);
    });

    it("renders byte-identically with explicit options too (qr/footer/drawer)", () => {
      const job = makeService().buildReceipt(receipt, {
        qr: { data: "https://verify.example/A-007" },
        footerLines: ["Custom footer"],
        kickDrawerAfter: true,
      });
      expect(job.base64).toBe(GOLDEN.receiptWithOptions);
    });

    it("renders a kitchen ticket byte-identically to before", () => {
      const job = makeService().buildKitchenTicket(kitchen);
      expect(job.base64).toBe(GOLDEN.kitchen);
    });

    it("renders a takeaway + discount receipt byte-identically to before", () => {
      const job = makeService().buildReceipt({
        ...receipt,
        order: { ...receipt.order, type: "TAKEAWAY", tableNumber: null },
        totals: { ...receipt.totals, discount: "10.00" },
      });
      expect(job.base64).toBe(GOLDEN.takeaway);
    });

    it("the receipt timestamp uses the BRANCH timezone, not a hardcoded Europe/Istanbul", () => {
      // printedAt 10:30 UTC is 13:30 in Istanbul (UTC+3) — the golden/
      // default output above. Asia/Tashkent is UTC+5 → 15:30. Passing the
      // branch's own timezone must change the printed hour; today's code
      // hardcodes "Europe/Istanbul" and never looks at this option at all.
      const job = makeService().buildReceipt(receipt, {
        timezone: "Asia/Tashkent",
      });
      const ascii = Buffer.from(job.bytes).toString("latin1");
      expect(ascii).toContain("27.04.2026 15:30");
      expect(ascii).not.toContain("13:30");
    });

    it("the kitchen ticket timestamp also honours an explicit timezone", () => {
      const job = makeService().buildKitchenTicket(kitchen, {
        timezone: "Asia/Tashkent",
      });
      const ascii = Buffer.from(job.bytes).toString("latin1");
      // kitchen.createdAt is 10:00 UTC → 15:00 in Tashkent, 13:00 in Istanbul.
      expect(ascii).toContain("27.04.2026 15:00");
      expect(ascii).not.toContain("13:00");
    });

    it("an explicit intlLocale + displayDecimals drives money grouping (still ASCII 'TL' suffix — CP857 can't print ₺)", () => {
      // Same currency (TRY) but a different locale/decimals pairing proves
      // money() no longer hardcodes "tr-TR"+2 internally — it reads both
      // from options. (uz-UZ grouping-with-0dp on a TRY amount is a
      // synthetic combination for the purpose of this unit test only; a
      // real UZ tenant is a different currency entirely, covered by the
      // escpos-builder-uz spec.)
      const job = makeService().buildReceipt(receipt, {
        intlLocale: "uz-UZ",
        displayDecimals: 0,
      });
      const ascii = Buffer.from(job.bytes).toString("latin1");
      expect(ascii).toContain("118 TL");
      expect(ascii).not.toContain("118,00 TL");
    });

    it("omitting the new options reproduces the pre-existing tr-TR/2dp/Istanbul defaults exactly", () => {
      const withDefaults = makeService().buildReceipt(receipt);
      const withExplicitTrDefaults = makeService().buildReceipt(receipt, {
        intlLocale: "tr-TR",
        displayDecimals: 2,
        timezone: "Europe/Istanbul",
      });
      expect(withDefaults.base64).toBe(withExplicitTrDefaults.base64);
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
