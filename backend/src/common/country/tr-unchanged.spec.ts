import { plainToInstance } from "class-transformer";
import { IsInt, IsOptional, validate } from "class-validator";
import { CountryService, resolveCountryProfile } from "./country.service";
import { COUNTRY_PROFILES } from "./country-profile.const";
import { CountryCapabilityResolver } from "./country-capability.resolver";
import { IsCountryTaxRate } from "./country-tax-rate.validator";
import { isValidTaxId } from "./tax-id.validator";
import { formatMoneyNumber, formatMoneyForDocument } from "./money-format";
import { RequestContext } from "../context/request-context";
import { normalizePhoneToE164 } from "../dto/normalize-phone";
import { E164_PATTERN } from "../phone/e164.const";
import { mockPrismaClient } from "../test/prisma-mock.service";
import { PaymentProviderRegistry } from "../../modules/payments-core/payment-provider.registry";
import { PaymentProvider } from "../../modules/payments-core/payment-provider.interface";
import { FiscalProviderRegistry } from "../../modules/fiscal-core/fiscal-provider.registry";
import { FiscalProvider } from "../../modules/fiscal-core/fiscal-provider.interface";
import { EscPosBuilderRegistry } from "../../modules/printing-core/escpos-builder.registry";
import { EscPosBuilder } from "../../modules/printing-core/escpos.types";
import { EscPosBuilderService } from "../../modules/printing-core/escpos-builder.service";
import {
  TR_GOLDEN_RECEIPT_FIXTURE,
  TR_GOLDEN_RECEIPT_BASE64,
} from "../../modules/printing-core/__fixtures__/tr-golden-receipt.fixture";

/**
 * TASK 14 — the acceptance criterion for the whole multi-country project:
 * "nothing visible changed for a Turkish tenant."
 *
 * Tasks 1-13 each touched one seam (tax validation, phone parsing, tax-id
 * rules, money display, Decimal column width, payment routing, SMS
 * provider selection, boot validation, receipt rendering) and each was
 * verified IN ISOLATION by its own spec. This file is the one place that
 * asserts, together, in one read, that none of them collectively moved a
 * Turkish tenant's behaviour. Read top to bottom as documentation of what
 * "unchanged for Turkey" means — every `describe` below is one row of the
 * acceptance table, in the same order.
 *
 * Deliberately NOT covered here (out of this project's scope, see the
 * plan's self-review): Decimal(10,2)->Decimal(14,2) column widening
 * (decimal-overflow.spec.ts, gated on a real Postgres — not a behaviour a
 * Turkish OPERATOR can observe, so it has no row in this contract either).
 *
 * Deliberately built WITHOUT Nest DI: every class under test here takes
 * plain constructor args (a mocked PrismaClient, bare registry instances),
 * so `new X(...)` is enough and there is no PrismaModule/@Global() stub
 * race to work around. The one real-DI proof that every profile's provider
 * ids actually exist in the live registries already lives in
 * country-capability.resolver.spec.ts ("real DI wiring") — this file does
 * not duplicate it.
 */
describe("Türkiye değişmedi — acceptance pin (Task 14)", () => {
  const TR = COUNTRY_PROFILES.TR;
  const UZ = COUNTRY_PROFILES.UZ;

  // ── Tax bands ────────────────────────────────────────────────────────
  // Product taxRate accepts exactly 0, 1, 10, 20 and rejects 12; default 10.
  describe("Tax bands", () => {
    class TaxRateTestDto {
      @IsInt()
      @IsCountryTaxRate()
      @IsOptional()
      taxRate?: number;
    }
    const errorsFor = (taxRate: number, countryCode: string) =>
      RequestContext.run({ countryCode }, () =>
        validate(plainToInstance(TaxRateTestDto, { taxRate })),
      );

    it("TR accepts exactly 0, 1, 10, 20", async () => {
      for (const rate of [0, 1, 10, 20]) {
        expect(await errorsFor(rate, "TR")).toHaveLength(0);
      }
    });

    it("TR rejects 12", async () => {
      expect((await errorsFor(12, "TR")).length).toBeGreaterThan(0);
    });

    it("TR's default is 10", () => {
      expect(TR.defaultTaxRate).toBe(10);
      expect(TR.taxRates).toEqual([0, 1, 10, 20]);
    });
  });

  // ── Phone ────────────────────────────────────────────────────────────
  // A locally-typed "0555 123 45 67" normalises to +905551234567; the
  // strict E.164 pattern accepts +90… and rejects a bare 905551234567.
  describe("Phone", () => {
    it('normalises a locally-typed TR number to E.164', () => {
      const normalized = RequestContext.run({ countryCode: "TR" }, () =>
        normalizePhoneToE164("0555 123 45 67"),
      );
      expect(normalized).toBe("+905551234567");
    });

    it("the strict E.164 pattern accepts a +90 number", () => {
      expect(E164_PATTERN.test("+905551234567")).toBe(true);
    });

    it("the strict E.164 pattern rejects the same number without the '+'", () => {
      expect(E164_PATTERN.test("905551234567")).toBe(false);
    });
  });

  // ── Tax ID ───────────────────────────────────────────────────────────
  // 10 and 11 digits accepted (VKN / TCKN), 9 and 14 rejected.
  describe("Tax ID", () => {
    it("accepts 10 digits (VKN) and 11 digits (TCKN)", () => {
      expect(isValidTaxId("1234567890", TR)).toBe(true);
      expect(isValidTaxId("12345678901", TR)).toBe(true);
    });

    it("rejects 9 digits and 14 digits (the Uzbek STIR/PINFL shapes)", () => {
      expect(isValidTaxId("123456789", TR)).toBe(false);
      expect(isValidTaxId("12345678901234", TR)).toBe(false);
    });
  });

  // ── Money display ────────────────────────────────────────────────────
  // TRY renders with two decimals.
  describe("Money display", () => {
    it("TRY has 2 display decimals", () => {
      expect(TR.displayDecimals).toBe(2);
    });

    it("a grouped number renders with exactly 2 decimal places", () => {
      expect(formatMoneyNumber("1234.5", TR)).toBe("1.234,50");
    });

    it("a document amount renders in the pre-existing '₺<amount>' shape, 2dp", () => {
      expect(formatMoneyForDocument(1234.5, TR)).toBe("₺1234.50");
    });
  });

  // ── Currency ─────────────────────────────────────────────────────────
  // Resolves to TRY from the country, and Tenant.currency is not consulted.
  describe("Currency", () => {
    it("currencyForTenant resolves TRY from countryCode alone, even when Tenant.currency disagrees", async () => {
      const prisma = mockPrismaClient();
      (prisma.tenant.findUnique as any).mockResolvedValue({
        countryCode: "TR",
        currency: "UZS", // stale/corrupt mirror — must be ignored
      });
      const svc = new CountryService(prisma as any);
      expect(await svc.currencyForTenant("t1")).toBe("TRY");
    });

    it("Tenant.currency is never even SELECTed — countryCode is the only column read", async () => {
      const prisma = mockPrismaClient();
      (prisma.tenant.findUnique as any).mockResolvedValue({ countryCode: "TR" });
      const svc = new CountryService(prisma as any);
      await svc.forTenant("t1");
      expect(prisma.tenant.findUnique).toHaveBeenCalledWith({
        where: { id: "t1" },
        select: { countryCode: true },
      });
    });
  });

  // ── Providers ────────────────────────────────────────────────────────
  // Payment -> paytr, SMS -> netgsm, ESC/POS -> escpos-tr, fiscal set
  // contains the four Turkish adapters.
  describe("Providers", () => {
    const fakePayment = (id: string): PaymentProvider =>
      ({ id, modes: ["online"] }) as unknown as PaymentProvider;
    const fakeEscpos = (id: string): EscPosBuilder => ({ id }) as unknown as EscPosBuilder;

    function makeResolver(tenantCountry: Record<string, string>) {
      const prisma = mockPrismaClient();
      (prisma.tenant.findUnique as any).mockImplementation(
        async ({ where }: any) => {
          const code = tenantCountry[where.id];
          return code ? { countryCode: code } : null;
        },
      );
      const country = new CountryService(prisma as any);
      const paymentRegistry = new PaymentProviderRegistry();
      const fiscalRegistry = new FiscalProviderRegistry();
      const escposRegistry = new EscPosBuilderRegistry();
      paymentRegistry.register(fakePayment("paytr"));
      escposRegistry.register(fakeEscpos("escpos-tr"));
      escposRegistry.register(fakeEscpos("escpos-uz"));
      const resolver = new CountryCapabilityResolver(
        country,
        paymentRegistry,
        fiscalRegistry,
        escposRegistry,
        prisma as any,
      );
      return { resolver };
    }

    it("payment resolves to paytr for a TR tenant", async () => {
      const { resolver } = makeResolver({ "tr-tenant": "TR" });
      expect((await resolver.paymentProviderFor("tr-tenant")).id).toBe("paytr");
    });

    it("SMS resolves to netgsm for a TR tenant", async () => {
      const { resolver } = makeResolver({ "tr-tenant": "TR" });
      expect(await resolver.smsProviderIdFor("tr-tenant")).toBe("netgsm");
    });

    it("ESC/POS resolves to escpos-tr for a TR tenant", async () => {
      const { resolver } = makeResolver({ "tr-tenant": "TR" });
      expect((await resolver.escposBuilderFor("tr-tenant")).id).toBe("escpos-tr");
    });

    it("the fiscal set contains exactly the four Turkish adapters", () => {
      expect([...TR.capabilities.fiscalProviderIds].sort()).toEqual(
        ["efatura", "fiscal_beko", "fiscal_hugin", "fiscal_paygo"].sort(),
      );
    });
  });

  // ── Boot ─────────────────────────────────────────────────────────────
  // With DEPLOYMENT_COUNTRIES unset, PayTR credentials are still required
  // in production. Fresh-module pattern per env-validation.deployment-
  // countries.spec.ts's note: IS_PROD/RULES are computed at module load,
  // so exercising the prod branch needs jest.resetModules() + a fresh
  // require() inside the test, not the top-level import.
  describe("Boot", () => {
    const ORIGINAL = { ...process.env };
    let exitSpy: jest.SpyInstance;
    let errorSpy: jest.SpyInstance;

    beforeEach(() => {
      jest.resetModules();
      exitSpy = jest.spyOn(process, "exit").mockImplementation((() => undefined) as never);
      errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
      jest.spyOn(console, "warn").mockImplementation(() => {});
    });

    afterEach(() => {
      process.env = { ...ORIGINAL };
      jest.restoreAllMocks();
    });

    it("with DEPLOYMENT_COUNTRIES unset, PayTR credentials are still required in production", () => {
      process.env.NODE_ENV = "production";
      delete process.env.DEPLOYMENT_COUNTRIES;
      process.env.DATABASE_URL = "postgres://localhost:5432/db";
      process.env.JWT_SECRET = "a".repeat(32);
      process.env.JWT_REFRESH_SECRET = "b".repeat(32);
      process.env.SUPERADMIN_JWT_SECRET = "c".repeat(32);
      process.env.SUPERADMIN_JWT_REFRESH_SECRET = "d".repeat(32);
      process.env.ENCRYPTION_MASTER_KEY = "e".repeat(32);
      process.env.INTEGRATION_KEY = "f".repeat(32);
      process.env.CORS_ORIGIN = "https://example.com";
      process.env.EMAIL_HOST = "smtp.example.com";
      process.env.EMAIL_USER = "smtp-user";
      process.env.EMAIL_PASSWORD = "smtp-pass";
      process.env.PAYTR_TEST_MODE = "0";
      // "", not deleted — see env-validation.deployment-countries.spec.ts's
      // note: dotenv only backfills undefined keys, so a local .env with
      // real sandbox PAYTR_* values would otherwise leak into this test.
      process.env.PAYTR_MERCHANT_ID = "";
      process.env.PAYTR_MERCHANT_KEY = "";
      process.env.PAYTR_MERCHANT_SALT = "";
      process.env.PAYTR_OK_URL = "";
      process.env.PAYTR_FAIL_URL = "";

      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { validateEnv } = require("../helpers/env-validation") as typeof import("../helpers/env-validation");
      validateEnv();

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(errorSpy.mock.calls[0][0]).toEqual(
        expect.stringContaining("PAYTR_MERCHANT_ID"),
      );
    });
  });

  // ── Receipt ──────────────────────────────────────────────────────────
  // A Turkish receipt renders byte-identically. Reuses Task 13's golden
  // capture (TR_GOLDEN_RECEIPT_FIXTURE / TR_GOLDEN_RECEIPT_BASE64, shared
  // via __fixtures__/tr-golden-receipt.fixture.ts with
  // escpos-builder.service.spec.ts) rather than capturing a second one —
  // see that fixture file's doc comment for why a freshly-captured golden
  // would prove nothing.
  describe("Receipt", () => {
    it("renders byte-identically to the pre-project golden capture", () => {
      const job = new EscPosBuilderService({} as EscPosBuilderRegistry).buildReceipt(
        TR_GOLDEN_RECEIPT_FIXTURE,
      );
      expect(job.base64).toBe(TR_GOLDEN_RECEIPT_BASE64);
    });
  });
});

/**
 * MIRROR IMAGE — the UZ smoke test.
 *
 * The TR pin above proves nothing moved for Turkey. On its own that could
 * be true for the wrong reason: every "country-derived" value could
 * secretly still be a hardcoded TR literal that happens to match. This
 * section proves the architecture is actually reading the country —
 * these values are genuinely different for Uzbekistan, and where nothing
 * has been built yet (payment), the system REFUSES rather than silently
 * reusing Turkey's.
 */
describe("Özbekistan (UZ) smoke test — proves country-derived, not TR-shaped", () => {
  const UZ = COUNTRY_PROFILES.UZ;

  it("accepts UZ's own tax rates (12 QQS, 6 catering) and rejects Turkey's 20", async () => {
    class TaxRateTestDto {
      @IsInt()
      @IsCountryTaxRate()
      @IsOptional()
      taxRate?: number;
    }
    const errorsFor = (taxRate: number) =>
      RequestContext.run({ countryCode: "UZ" }, () =>
        validate(plainToInstance(TaxRateTestDto, { taxRate })),
      );

    expect(await errorsFor(12)).toHaveLength(0);
    expect(await errorsFor(6)).toHaveLength(0);
    expect((await errorsFor(20)).length).toBeGreaterThan(0);
  });

  it("accepts STIR (9 digits) and PINFL (14 digits)", () => {
    expect(isValidTaxId("123456789", UZ)).toBe(true);
    expect(isValidTaxId("12345678901234", UZ)).toBe(true);
  });

  it("UZS renders with zero decimals and the real so'm glyph, never '$'", () => {
    expect(UZ.displayDecimals).toBe(0);
    const rendered = formatMoneyForDocument(150000, UZ);
    expect(rendered).not.toContain("$");
    expect(rendered).toBe("150000 soʻm");
  });

  it("payment resolution REFUSES explicitly — no Uzbek provider is built, and it never falls back to PayTR", async () => {
    const fakePayment = (id: string): PaymentProvider =>
      ({ id, modes: ["online"] }) as unknown as PaymentProvider;
    const prisma = mockPrismaClient();
    (prisma.tenant.findUnique as any).mockResolvedValue({ countryCode: "UZ" });
    const country = new CountryService(prisma as any);
    const paymentRegistry = new PaymentProviderRegistry();
    // paytr IS registered in this process (as it is in production) — the
    // refusal must come from the UZ profile naming no provider, never from
    // the registry happening to be empty.
    paymentRegistry.register(fakePayment("paytr"));
    const resolver = new CountryCapabilityResolver(
      country,
      paymentRegistry,
      new FiscalProviderRegistry(),
      new EscPosBuilderRegistry(),
      prisma as any,
    );

    await expect(resolver.paymentProviderFor("uz-tenant")).rejects.toThrow(
      /no payment provider configured for uz/i,
    );
  });

  it("ESC/POS resolves to escpos-uz, not the shared Turkish CP857 builder", async () => {
    const fakeEscpos = (id: string): EscPosBuilder => ({ id }) as unknown as EscPosBuilder;
    const prisma = mockPrismaClient();
    (prisma.tenant.findUnique as any).mockResolvedValue({ countryCode: "UZ" });
    const country = new CountryService(prisma as any);
    const escposRegistry = new EscPosBuilderRegistry();
    escposRegistry.register(fakeEscpos("escpos-tr"));
    escposRegistry.register(fakeEscpos("escpos-uz"));
    const resolver = new CountryCapabilityResolver(
      country,
      new PaymentProviderRegistry(),
      new FiscalProviderRegistry(),
      escposRegistry,
      prisma as any,
    );

    expect((await resolver.escposBuilderFor("uz-tenant")).id).toBe("escpos-uz");
  });
});
