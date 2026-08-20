# Çok ülkeli mimari (P1 + P2) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Türkiye'yi koddan çıkarıp bir ülke profiline taşımak ve her sağlayıcı seçimini mevcut registry'lerden çözdürmek — böylece ikinci ülke (Özbekistan) bir profil satırı + gerçekten yeni olan adapter'lar, üçüncü ülke ise yalnızca bir satır olur.

**Architecture:** Üç katman. **(1)** `COUNTRY_PROFILES` kod sabiti parametreleri taşır (para birimi, ekran ondalığı, vergi oranları, telefon bölgesi, vergi-no kuralları, yerel ayar, saat dilimi) ve `Tenant.countryCode` hangi profilin geçerli olduğunu söyler. **(2)** Aynı profil sağlayıcı **id'lerini adlandırır**; çağıranlar literal yerine mevcut `PaymentProviderRegistry` / `FiscalProviderRegistry` / `EscPosBuilderRegistry` üzerinden çözer. **(3)** Dağıtım ayrı eksendir ve bu planın kapsamı dışıdır.

**Tech Stack:** NestJS + Prisma + Postgres (backend), React + TanStack Query (frontend), jest / vitest.

**Spec:** `docs/superpowers/specs/2026-08-20-multi-country-architecture-design.md`

## Global Constraints

- **Kabul ölçütü: Türk kiracı için görünen hiçbir şey değişmeyecek.** Her görevin son adımı bunu doğrular.
- Saklama daima ×100. Bu bir **değişmez**, parametre değil — profilde saklama üssü alanı YOK. Ülkeden türeyen tek şey `displayDecimals`.
- Ülke kiracıda: `Tenant.countryCode`. Şube ülkeyi kiracısından okur ve ondan sapamaz.
- `Tenant.currency` yalnız profilden **yazılır**, bağımsız düzenlenemez. Belge modellerindeki `currency` kolonları tarihsel; ellenmez.
- Şunlar zaten doğru, **dokunulmayacak**: `TaxCalculationService`, `apportionDiscount` (`orders/services/fiscal-line-builder.ts:41-60`), combo apportionment (`orders/services/combo-pricing.ts:224-238`), `prorate()` (`licensing/anniversary.ts:140-208`), `toIntCents` (`common/money/to-int-cents.ts`), `generateInvoiceNumber`.
- Her migration reversible up/down çifti; down idempotent ve tam olarak up'ın eklediğini geri alır.
- Backend testi: `cd /home/tarik/Projects/kds/backend && npx jest <path>`; **lint doğrulaması `npm run lint:ci`** (`npm run lint` `--fix` taşır ve hatayı gizler). Boru hattı kullanırken `set -o pipefail` — yoksa `$?` `tail`'in kodudur.
- Frontend testi: `cd /home/tarik/Projects/kds/frontend && npx vitest run <path>`; `npx tsc --noEmit -p tsconfig.json`; `node scripts/check-i18n-parity.mjs` (repo kökünden).
- Kullanıcıya görünen her yeni metin beş dile (`tr`, `en`, `ru`, `uz`, `ar`) **gerçek çeviriyle** eklenir. Türkçe `defaultValue` parity'yi geçirir ama dört dile Türkçe gösterir — bu repoda daha önce yaşandı.

---

## File Structure

**Yeni**

| Dosya | Sorumluluk |
|---|---|
| `backend/src/common/country/country-profile.const.ts` | `CountryProfile` tipi + `COUNTRY_PROFILES` sabiti (TR, UZ). Tek doğruluk kaynağı. |
| `backend/src/common/country/country-profile.const.spec.ts` | Profil bütünlüğü invariant'ları. |
| `backend/src/common/country/country.service.ts` | `forCode()`, `forTenant(tenantId)`, `ambient()` — profil çözümü tek kapı. |
| `backend/src/common/country/country-capability.resolver.ts` | Profilin adlandırdığı sağlayıcı id'sini registry'den çözer. |
| `backend/src/common/phone/e164.const.ts` | Tek E.164 kuralı — 23 regex kopyasının yerine. |
| `backend/src/common/country/tax-id.validator.ts` | Profil kurallarıyla vergi-no doğrulaması — 7 kod sitesinin yerine. |
| `frontend/src/hooks/useCountryProfile.ts` | Frontend'in profil okuma kapısı. |

**Değişen (ana)**

| Dosya | Değişiklik |
|---|---|
| `backend/prisma/schema.prisma` | `Tenant.countryCode`; toplam tutan `Decimal(10,2)` → `Decimal(14,2)` |
| `backend/src/common/context/request-context.ts` | Store'a `countryCode` |
| `checkout/quote.service.ts`, `common/helpers/kdv.helper.ts`, `subscriptions/services/billing.service.ts`, `accounting/constants/accounting.enum.ts`, `menu/dto/create-product.dto.ts` | Dört vergi aynası + ürün bandı profilden |
| `common/dto/normalize-phone.ts` | Varsayılan bölge ambient ülkeden |
| `customer-orders/services/self-pay-intent.service.ts`, `self-pay-recovery.service.ts`, `checkout/checkout-intent.service.ts` | Somut PayTR yerine registry |
| `customers/sms.service.ts` | Süreç-tekili yerine kiracı başına sağlayıcı |
| `common/helpers/env-validation.ts` | PayTR zorunluluğu ülke koşullu |
| `device-mesh/printing/escpos-builder.service.ts` | Kod sayfası + zaman damgası profilden |

---

## Task 1: Ülke profili sabiti

**Files:**
- Create: `backend/src/common/country/country-profile.const.ts`
- Test: `backend/src/common/country/country-profile.const.spec.ts`

**Interfaces:**
- Consumes: yok (ilk görev)
- Produces: `export interface CountryProfile`, `export const COUNTRY_PROFILES` (yazımı `satisfies Record<string, CountryProfile>`, anotasyon DEĞİL), `export const DEFAULT_COUNTRY = "TR"`, `export type CountryProfileCode = keyof typeof COUNTRY_PROFILES`, `export type _CountryCodeIsNarrow` (derleme-zamanı daralma kanıtı)

- [ ] **Step 1: Write the failing test**

```ts
import {
  COUNTRY_PROFILES,
  DEFAULT_COUNTRY,
  CountryProfileCode,
} from "./country-profile.const";

describe("COUNTRY_PROFILES", () => {
  it("has TR and UZ", () => {
    expect(Object.keys(COUNTRY_PROFILES).sort()).toEqual(["TR", "UZ"]);
  });

  it("TR keeps today's behaviour exactly — this is the regression pin", () => {
    const tr = COUNTRY_PROFILES.TR;
    expect(tr.currency).toBe("TRY");
    expect(tr.displayDecimals).toBe(2);
    expect(tr.taxRates).toEqual([0, 1, 10, 20]);
    expect(tr.defaultTaxRate).toBe(10);
    expect(tr.phoneRegion).toBe("TR");
    expect(tr.intlLocale).toBe("tr-TR");
    expect(tr.defaultTimezone).toBe("Europe/Istanbul");
  });

  it("UZ carries the Uzbek parameters", () => {
    const uz = COUNTRY_PROFILES.UZ;
    expect(uz.currency).toBe("UZS");
    expect(uz.displayDecimals).toBe(0); // so'm shows no decimals
    expect(uz.taxRates).toContain(12);  // QQS
    expect(uz.defaultTaxRate).toBe(12);
    expect(uz.phoneRegion).toBe("UZ");
    expect(uz.defaultTimezone).toBe("Asia/Tashkent");
  });

  it("every profile's defaultTaxRate is one of its own taxRates", () => {
    for (const [code, p] of Object.entries(COUNTRY_PROFILES)) {
      expect(p.taxRates).toContain(p.defaultTaxRate);
    }
  });

  it("every profile declares at least one tax-id rule", () => {
    for (const p of Object.values(COUNTRY_PROFILES)) {
      expect(p.taxIdRules.length).toBeGreaterThan(0);
    }
  });

  it("TR tax-id rules accept VKN(10) and TCKN(11) and reject 9 digits", () => {
    const rules = COUNTRY_PROFILES.TR.taxIdRules;
    const ok = (v: string) => rules.some((r) => r.pattern.test(v));
    expect(ok("1234567890")).toBe(true);
    expect(ok("12345678901")).toBe(true);
    expect(ok("123456789")).toBe(false);
  });

  it("UZ tax-id rules accept STIR(9) and PINFL(14)", () => {
    const rules = COUNTRY_PROFILES.UZ.taxIdRules;
    const ok = (v: string) => rules.some((r) => r.pattern.test(v));
    expect(ok("123456789")).toBe(true);
    expect(ok("12345678901234")).toBe(true);
    expect(ok("1234567890")).toBe(false);
  });

  it("DEFAULT_COUNTRY exists in the map", () => {
    expect(COUNTRY_PROFILES[DEFAULT_COUNTRY]).toBeDefined();
  });

  it("names the exact provider ids the adapters register under", () => {
    // These four strings were ALL wrong in the first draft ("generic",
    // "hugin", "nilvera", "eskiz"). They are plain strings, so nothing but
    // an explicit assertion catches a typo here. Task 9 adds the stronger
    // check that walks these against the live registries.
    const tr = COUNTRY_PROFILES.TR.capabilities;
    expect(tr.escposBuilderId).toBe("escpos-tr");        // escpos-builder.service.ts
    expect(tr.fiscalProviderIds).toContain("fiscal_hugin"); // hugin-fiscal-provider.ts
    expect(tr.paymentProviderIds).toEqual(["paytr"]);    // paytr-payment-provider.ts
    expect(tr.eDocumentAdapterId).toBe("NILVERA");       // AccountingProvider enum
    expect(tr.smsProviderId).toBe("netgsm");             // SMS_PROVIDER value
  });

  it("lists fiscal providers as a SET, because the device is a tenant choice", () => {
    // Turkey has four registered fiscal adapters; naming one in the country
    // profile would silently pick a device the restaurant may not own.
    expect(COUNTRY_PROFILES.TR.capabilities.fiscalProviderIds.length).toBeGreaterThan(1);
  });

  it("UZ declares nothing it has not built — no silent fallback to Turkish providers", () => {
    const uz = COUNTRY_PROFILES.UZ.capabilities;
    expect(uz.fiscalProviderIds).toEqual([]);
    expect(uz.paymentProviderIds).toEqual([]);
    expect(uz.eDocumentAdapterId).toBeNull();
    expect(uz.smsProviderId).toBeNull();
  });

  it("CountryProfileCode narrows to the real keys, not to string", () => {
    // Guards the `satisfies` form. With a Record<string, …> annotation this
    // compiles, and every downstream task loses compile-time safety.
    const codes: CountryProfileCode[] = ["TR", "UZ"];
    // @ts-expect-error "XX" is not a country we have a profile for
    const bad: CountryProfileCode = "XX";
    expect(codes).toHaveLength(2);
    expect(bad).toBe("XX");
  });

  it("every profile's locale fields are populated", () => {
    for (const p of Object.values(COUNTRY_PROFILES)) {
      expect(p.defaultLocale).toBeTruthy();
      expect(p.intlLocale).toBeTruthy();
      expect(p.defaultTimezone).toBeTruthy();
    }
  });

  it("no profile declares a storage minor-unit exponent — storage is always x100", () => {
    for (const p of Object.values(COUNTRY_PROFILES)) {
      expect(p).not.toHaveProperty("storageMinorExponent");
      expect(p).not.toHaveProperty("minorUnitExponent");
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/tarik/Projects/kds/backend && npx jest src/common/country/country-profile.const.spec.ts`
Expected: FAIL — modül yok

- [ ] **Step 3: Implement**

```ts
/**
 * Per-country PARAMETERS. The single source of truth for everything that
 * varies by country but is not a regulation — currency, display precision,
 * tax bands, phone region, tax-id shapes, locale, timezone — plus the NAMES
 * of the providers that implement this country's regulations.
 *
 * Why a code constant and not a table: this repo already keeps platform
 * pricing in code (marketplace/alacarte-catalog.const.ts) for the same
 * reason. Countries change rarely, but a wrong tax rate typed into a
 * database row is a money incident. A constant goes through review, tests
 * and a release. The only DATA is Tenant.countryCode.
 *
 * NOTE — there is deliberately NO storage minor-unit exponent here. Money is
 * stored and wired as x100 for EVERY currency, always. That is an invariant,
 * not a parameter: UZS shows zero decimals but Payme/Uzum expect tiyin
 * (x100), so the storage boundary is already correct. Making it configurable
 * would invite someone to change it and silently break the 16 call sites that
 * cross that boundary. Only DISPLAY varies by country.
 */
export interface CountryTaxIdRule {
  /** Machine name, e.g. "VKN" | "TCKN" | "STIR" | "PINFL". */
  name: string;
  pattern: RegExp;
  /** i18n key for the human label shown next to the field. */
  labelKey: string;
}

export interface CountryCapabilities {
  /**
   * FiscalProviderRegistry ids that are LEGAL in this country. Plural on
   * purpose: which fiscal device a restaurant owns is a tenant fact, not a
   * country fact — Turkey alone has four registered adapters. The country
   * constrains the legal set; the tenant picks from within it.
   * Empty = no fiscal device applies here yet.
   */
  fiscalProviderIds: string[];
  /** PaymentProviderRegistry ids, in preference order. Empty = none built. */
  paymentProviderIds: string[];
  /** AccountingProvider enum value for e-invoicing, or null where none. */
  eDocumentAdapterId: string | null;
  /** EscPosBuilderRegistry id. */
  escposBuilderId: string;
  /** SMS_PROVIDER value, or null where no local provider is built yet. */
  smsProviderId: string | null;
}

export interface CountryProfile {
  code: string;
  currency: string;
  /** DISPLAY decimals only. Storage is always x100 — see the note above. */
  displayDecimals: number;
  taxRates: number[];
  defaultTaxRate: number;
  /** libphonenumber-js region for parsing a locally-typed number. */
  phoneRegion: string;
  taxIdRules: CountryTaxIdRule[];
  /** i18n locale key. */
  defaultLocale: string;
  /** Intl.NumberFormat / DateTimeFormat locale. */
  intlLocale: string;
  defaultTimezone: string;
  capabilities: CountryCapabilities;
}

// `satisfies` rather than a `Record<string, …>` annotation: the annotation
// widens the key type to `string`, so `CountryCode` would accept any string
// and every downstream task would lose compile-time safety.
export const COUNTRY_PROFILES = {
  TR: {
    code: "TR",
    currency: "TRY",
    displayDecimals: 2,
    // KDV bands. Kept EXACTLY as the pre-existing TaxRate enum and the
    // product DTO's @IsIn — this profile must not change TR behaviour.
    taxRates: [0, 1, 10, 20],
    defaultTaxRate: 10,
    phoneRegion: "TR",
    taxIdRules: [
      { name: "VKN", pattern: /^\d{10}$/, labelKey: "country.taxId.vkn" },
      { name: "TCKN", pattern: /^\d{11}$/, labelKey: "country.taxId.tckn" },
    ],
    defaultLocale: "tr",
    intlLocale: "tr-TR",
    defaultTimezone: "Europe/Istanbul",
    capabilities: {
      // Every id below is verbatim what the adapter registers itself under.
      // Task 9 adds a test that walks every profile and asserts the registry
      // actually has each id — a typo here is otherwise invisible until a
      // payment or a receipt fails in production.
      fiscalProviderIds: ["fiscal_hugin", "fiscal_paygo", "fiscal_beko", "efatura"],
      paymentProviderIds: ["paytr"],
      eDocumentAdapterId: "NILVERA", // AccountingProvider enum value, upper-case
      escposBuilderId: "escpos-tr",
      smsProviderId: "netgsm", // the SMS_PROVIDER value sms.service.ts checks
    },
  },

  UZ: {
    code: "UZ",
    currency: "UZS",
    // So'm is quoted without decimals in practice even though ISO-4217 gives
    // it two. Storage stays x100 (tiyin) because that is what Payme/Uzum
    // expect on the wire.
    displayDecimals: 0,
    // QQS is 12% (fixed through 2028). Catering may elect a 6% no-credit
    // rate from 2026-06, so both are offered plus exempt.
    taxRates: [0, 6, 12],
    defaultTaxRate: 12,
    phoneRegion: "UZ",
    // UNVERIFIED AGAINST A PRIMARY SOURCE. The repo's own Uzbekistan
    // benchmark corroborates the currency, the 12% QQS, the 6% catering
    // rate, the timezone and the phone region — but NOT these two digit
    // counts. Confirm with the local partner before the first UZ tenant
    // takes real money.
    taxIdRules: [
      { name: "STIR", pattern: /^\d{9}$/, labelKey: "country.taxId.stir" },
      { name: "PINFL", pattern: /^\d{14}$/, labelKey: "country.taxId.pinfl" },
    ],
    defaultLocale: "uz",
    intlLocale: "uz-UZ",
    defaultTimezone: "Asia/Tashkent",
    capabilities: {
      // No Uzbek fiscal/payment/e-document/SMS adapter exists yet — those are
      // P3+ and each waits on a local legal entity. Empty/null here is
      // honest: the resolver refuses rather than silently falling back to
      // the Turkish provider.
      fiscalProviderIds: [],
      paymentProviderIds: [],
      eDocumentAdapterId: null,
      // The ESC/POS builder is shared for now; Task 13 gives it a codepage
      // that does not turn Cyrillic into '?'.
      escposBuilderId: "escpos-tr",
      smsProviderId: null,
    },
  },
} satisfies Record<string, CountryProfile>;

export const DEFAULT_COUNTRY = "TR";
/**
 * Named CountryProfileCode, not CountryCode: libphonenumber-js already
 * exports a `CountryCode` that normalize-phone.ts imports, and two different
 * `CountryCode`s in the same codebase is a foot-gun for Task 5.
 */
export type CountryProfileCode = keyof typeof COUNTRY_PROFILES;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/tarik/Projects/kds/backend && npx jest src/common/country/country-profile.const.spec.ts`
Expected: PASS (15 test)

- [ ] **Step 5: Commit**

```bash
git add backend/src/common/country/
git commit -m "feat(country): ülke profili sabiti — parametrelerin tek kaynağı

Ülkeye göre değişen ama regülasyon olmayan her şey burada: para birimi,
ekran ondalığı, vergi bantları, telefon bölgesi, vergi-no şekilleri, yerel
ayar, saat dilimi. Ayrıca bu ülkenin regülasyonlarını uygulayan sağlayıcı
ADLARI — sınıflar değil.

Veritabanı değil kod sabiti, çünkü emsali repoda var (alacarte-catalog) ve
çünkü bir DB satırına yanlış yazılmış vergi oranı para olayıdır.

Saklama üssü BİLEREK yok: para her para biriminde daima x100 saklanır ve
kablolanır. UZS ekranda 0 ondalık gösterir ama Payme/Uzum tiyin bekler,
yani sınır zaten doğru yerde. Ayarlanabilir bırakmak o sınırı geçen 16
çağrı yerini sessizce bozmaya davetiye olurdu."
```

---

## Task 2: `Tenant.countryCode` + türetilen para birimi

**Files:**
- Modify: `backend/prisma/schema.prisma` (model `Tenant`)
- Create: `backend/prisma/migrations/<ver>_tenant_country_code/migration.sql` + `down.sql`
- Create: `backend/src/common/country/country.service.ts`
- Test: `backend/src/common/country/country.service.spec.ts`

**Interfaces:**
- Consumes: `COUNTRY_PROFILES`, `DEFAULT_COUNTRY` (Task 1)
- Produces: `CountryService.forCode(code: string): CountryProfile`, `CountryService.forTenant(tenantId: string): Promise<CountryProfile>`, `CountryService.ambient(): CountryProfile` (Task 3'te dolar; şimdilik DEFAULT döner)

- [ ] **Step 1: Add the column to the schema**

`model Tenant` içinde, mevcut `currency` satırının hemen üstüne:

```prisma
  // ISO-3166-1 alpha-2. The single piece of country DATA — everything else
  // (currency, tax bands, phone region, locale, providers) is derived from
  // COUNTRY_PROFILES in code. Defaults to TR because every tenant that
  // existed when this shipped was Turkish.
  countryCode String @default("TR")
```

- [ ] **Step 2: Write the reversible migration**

`migration.sql`:

```sql
ALTER TABLE "tenants"
  ADD COLUMN IF NOT EXISTS "countryCode" TEXT NOT NULL DEFAULT 'TR';
```

`down.sql`:

```sql
ALTER TABLE "tenants" DROP COLUMN IF EXISTS "countryCode";
```

- [ ] **Step 3: Verify the round trip**

Bunu **atılabilir bir Postgres'te** doğrula, geliştirme veritabanında değil — bu repoda daha önce data migration'ı böyle doğrulamak kural oldu:

```bash
cd /home/tarik/Projects/kds/backend
DB=multicountry_migtest
PGPASSWORD=Merhabalar06 psql -h localhost -U tarik -d template1 -c "DROP DATABASE IF EXISTS $DB" 2>/dev/null || true
DATABASE_URL="postgresql://tarik:Merhabalar06@localhost:5432/$DB?schema=public" npx prisma db push --skip-generate
PGPASSWORD=Merhabalar06 psql -h localhost -U tarik -d $DB -f prisma/migrations/<ver>_tenant_country_code/down.sql
PGPASSWORD=Merhabalar06 psql -h localhost -U tarik -d $DB -f prisma/migrations/<ver>_tenant_country_code/migration.sql
PGPASSWORD=Merhabalar06 psql -h localhost -U tarik -d $DB -c "\d tenants" | grep countryCode
```
Expected: `countryCode | text | not null | 'TR'::text` — up→down→up temiz.

- [ ] **Step 4: Write the failing service test**

```ts
import { CountryService } from "./country.service";
import { mockPrismaClient, MockPrismaClient } from "../test/prisma-mock.service";

describe("CountryService", () => {
  let prisma: MockPrismaClient;
  let svc: CountryService;

  beforeEach(() => {
    prisma = mockPrismaClient();
    svc = new CountryService(prisma as any);
  });

  it("forCode returns the profile", () => {
    expect(svc.forCode("UZ").currency).toBe("UZS");
  });

  it("forCode falls back to the default for an unknown code rather than throwing", () => {
    // A tenant row can only hold what we wrote, but a bad manual UPDATE must
    // not take the whole request down — fall back and log.
    expect(svc.forCode("XX").code).toBe("TR");
  });

  it("forTenant reads the tenant's countryCode", async () => {
    (prisma.tenant.findUnique as any).mockResolvedValue({ countryCode: "UZ" });
    const p = await svc.forTenant("t1");
    expect(p.currency).toBe("UZS");
  });

  it("forTenant falls back to the default when the tenant is missing", async () => {
    (prisma.tenant.findUnique as any).mockResolvedValue(null);
    expect((await svc.forTenant("nope")).code).toBe("TR");
  });

  it("currencyForTenant is derived from the profile, never read off Tenant.currency", async () => {
    // Tenant.currency is a WRITTEN mirror; the profile is the truth. A row
    // whose currency disagrees with its country must resolve to the profile.
    (prisma.tenant.findUnique as any).mockResolvedValue({
      countryCode: "UZ",
      currency: "TRY", // stale/corrupt
    });
    expect(await svc.currencyForTenant("t1")).toBe("UZS");
  });
});
```

- [ ] **Step 5: Run it and confirm it fails**

Run: `cd /home/tarik/Projects/kds/backend && npx jest src/common/country/country.service.spec.ts`
Expected: FAIL — modül yok

- [ ] **Step 6: Implement**

```ts
import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import {
  COUNTRY_PROFILES,
  DEFAULT_COUNTRY,
  CountryProfile,
} from "./country-profile.const";
import { RequestContext } from "../context/request-context";

/**
 * The one door to a country profile. Nothing else may index COUNTRY_PROFILES
 * directly — that keeps the fallback behaviour and the logging in one place.
 */
@Injectable()
export class CountryService {
  private readonly logger = new Logger(CountryService.name);

  constructor(private readonly prisma: PrismaService) {}

  forCode(code: string | null | undefined): CountryProfile {
    const profile = code ? COUNTRY_PROFILES[code] : undefined;
    if (!profile) {
      if (code) {
        this.logger.warn(`Unknown countryCode "${code}" — using ${DEFAULT_COUNTRY}`);
      }
      return COUNTRY_PROFILES[DEFAULT_COUNTRY];
    }
    return profile;
  }

  async forTenant(tenantId: string): Promise<CountryProfile> {
    const t = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { countryCode: true },
    });
    return this.forCode(t?.countryCode);
  }

  /** Currency is DERIVED. Tenant.currency is a written mirror, never the truth. */
  async currencyForTenant(tenantId: string): Promise<string> {
    return (await this.forTenant(tenantId)).currency;
  }

  /**
   * The profile for the request in flight, resolved synchronously from the
   * ambient RequestContext. Outside a request (cron, bootstrap) this is the
   * default profile. Populated by Task 3.
   */
  ambient(): CountryProfile {
    return this.forCode(RequestContext.get()?.countryCode);
  }
}
```

- [ ] **Step 7: Expose countryCode to the frontend**

`backend/src/modules/tenants/tenants.service.ts:22` civarındaki `TENANT_SETTINGS_SELECT` bugün `currency: true` veriyor ama ülkeyi vermiyor — Task 7'nin frontend biçimlendiricisi profili bu select olmadan hiç göremez. `countryCode: true` eklenir ve `frontend/src/hooks/useCurrency.ts`'teki `TenantSettings` arayüzüne `countryCode: string` eklenir.

`currency` alanı select'te **kalır** (türetilmiş ayna; frontend hâlâ okuyor), ama Task 7 onu yazılabilir olmaktan çıkaracak.

- [ ] **Step 8: Run tests + typecheck**

Run: `cd /home/tarik/Projects/kds/backend && npx jest src/common/country && npx tsc --noEmit -p tsconfig.json`
Expected: PASS, tsc 0

- [ ] **Step 9: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations backend/src/common/country/ backend/src/modules/tenants/ frontend/src/hooks/useCurrency.ts
git commit -m "feat(country): Tenant.countryCode + profil çözüm servisi

Ülkenin tek VERİ hâli countryCode; para birimi, vergi, telefon, yerel ayar
hepsi profilden türer. Mevcut kiracılar TR varsayılanıyla göç ediyor —
bugünkü her kiracı Türk. Migration up/down çifti atılabilir bir Postgres'te
tur ettirilerek doğrulandı.

currencyForTenant bilerek Tenant.currency'yi OKUMUYOR: o kolon bundan sonra
profilden yazılan bir ayna, doğruluk kaynağı değil. Bozuk bir satır profile
göre çözülür."
```

---

## Task 3: Ambient ülke — `RequestContext.countryCode`

**Files:**
- Modify: `backend/src/common/context/request-context.ts`
- Modify: `backend/src/common/context/request-context.interceptor.ts`
- Test: `backend/src/common/context/request-context.spec.ts`

**Interfaces:**
- Consumes: `CountryService.forTenant` (Task 2). **Task 2'nin iki eksiğini de bu görev kapatıyor** — servisin modül kaydı ve `set()`'in `countryCode`'u iletmesi (Step 0).
- Produces: `RequestContextStore.countryCode?: string` (tip alanını Task 2 zaten ekledi — bu görev onu **dolduruyor**), `CountryService.cachedCodeFor(tenantId): string | null`, `CountryService.invalidate(tenantId): void`

**Neden bu görev var:** `@NormalizePhone("TR")` gibi decorator'lar **tanımlama anında** sabitlenir ve transform **senkron** çalışır — bir DB okuması yapamazlar. Nest'te sıralama guard → interceptor → pipe olduğu için, interceptor `countryCode`'u store'a yazdığında ValidationPipe'ın DTO transform'u onu senkron okuyabilir. Ambient ülkeyi mümkün kılan tek şey bu.

- [ ] **Step 0: Two prerequisites Task 2's review exposed — do these FIRST**

Task 2 shipped a service nobody can inject and a `set()` that would silently swallow this task's whole point. Both bite here, so they belong to this task.

**0a — `RequestContext.set()` hand-lists its fields and drops `countryCode`.**

```ts
set(patch: Partial<RequestContextStore>): void {
  const store = storage.getStore();
  if (!store) return;
  if (patch.requestId !== undefined) store.requestId = patch.requestId;
  if (patch.tenantId !== undefined) store.tenantId = patch.tenantId;
  if (patch.branchId !== undefined) store.branchId = patch.branchId;
  // ... userId ... and NO countryCode
}
```

As written, `set({ countryCode: "UZ" })` is a **silent no-op** — every ambient read would return TR and every test in this task would still pass, because the fallback is TR. This is the exact "looks-working-but-isn't" shape this repo has been bitten by before. Add the `countryCode` line.

Write a test that fails first:

```ts
it("set() actually forwards countryCode — it hand-lists fields and silently dropped it", () => {
  RequestContext.run({ tenantId: "t1" }, () => {
    RequestContext.set({ countryCode: "UZ" });
    expect(RequestContext.get()?.countryCode).toBe("UZ");
  });
});
```

**0b — `CountryService` is registered in no module.** Injecting it throws `UnknownDependenciesException` at bootstrap. Add it to `src/common/common.module.ts`, which is already `@Global()` and holds exactly this kind of shared service:

```ts
providers: [ EmailService, /* … */, CountryService ],
exports:   [ EmailService, /* … */, CountryService ],
```

Prove it with a DI-resolution test rather than a hand-constructed instance — Task 2's tests all did `new CountryService(prisma as any)`, which is precisely why this was invisible. Note the repo hazard: a module that imports `PrismaModule` directly beats a `@Global()` stub, and `new PrismaClient()` throws without `DATABASE_URL` (green locally, red in CI). Use `.overrideProvider(PrismaService).useValue({})`.

- [ ] **Step 1: Write the failing test**

```ts
import { RequestContext } from "./request-context";

describe("RequestContextInterceptor country resolution", () => {
  it("does NOT hit the database when the tenant's code is already cached", async () => {
    // The single most important test in this task. This interceptor runs on
    // every request; a naive implementation adds a query per request.
    // Warm the cache, then assert prisma is never touched again.
    expect(prisma.tenant.findUnique).toHaveBeenCalledTimes(1);
    // ... second request through the same interceptor ...
    expect(prisma.tenant.findUnique).toHaveBeenCalledTimes(1);
  });

  it("resolves and caches on the first request for a tenant", async () => {});

  it("passes an anonymous request straight through with no query at all", async () => {
    expect(prisma.tenant.findUnique).not.toHaveBeenCalled();
  });

  it("invalidate() forces the next request to re-read", async () => {});

  it("still calls next.handle() exactly once on both the cached and uncached paths", async () => {
    // A switchMap mistake here would either drop the request or run it twice.
  });
});

describe("RequestContext.countryCode", () => {
  it("carries a country through the async continuation", async () => {
    await RequestContext.run({ tenantId: "t1", countryCode: "UZ" }, async () => {
      await Promise.resolve();
      expect(RequestContext.get()?.countryCode).toBe("UZ");
    });
  });

  it("is undefined outside a request", () => {
    expect(RequestContext.get()?.countryCode).toBeUndefined();
  });

  it("set() merges a country resolved after the guards ran", () => {
    RequestContext.run({ tenantId: "t1" }, () => {
      expect(RequestContext.get()?.countryCode).toBeUndefined();
      RequestContext.set({ countryCode: "UZ" });
      expect(RequestContext.get()?.countryCode).toBe("UZ");
    });
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd /home/tarik/Projects/kds/backend && npx jest src/common/context/request-context.spec.ts`
Expected: FAIL — `countryCode` tipte yok

- [ ] **Step 3: Add the field**

`request-context.ts`, `RequestContextStore` içine:

```ts
  /**
   * ISO-3166-1 alpha-2 for the tenant in flight, filled by
   * RequestContextInterceptor once the guard chain has resolved tenantId.
   *
   * This exists so SYNCHRONOUS code — class-transformer decorators,
   * formatters — can reach the country without a database read. Nest runs
   * interceptors before pipes, so a DTO transform sees this already set.
   */
  countryCode?: string;
```

- [ ] **Step 4: Populate it in the interceptor — WITHOUT adding a query per request**

**Bu adımın planlanmamış bir tuzağı var ve önce onu okuman gerekiyor.** `RequestContextInterceptor` bugün **tamamen senkrondur** — `next.handle()`'ı doğrudan döndürür — ve global `APP_INTERCEPTOR` olarak **her HTTP isteğinde** çalışır. Oraya düz bir `await this.country.forTenant(tenantId)` koymak, bir POS sisteminde her siparişe, her ödemeye, her ekran yenilemesine fazladan bir veritabanı sorgusu eklemek demektir.

**Karar: `CountryService`'e süreç-içi bir önbellek, interceptor'a senkron hızlı yol.**

Bir kiracının ülkesi pratikte hiç değişmez, yani önbellek kiracı başına **süreç ömründe bir kez** ıskalar. Hızlı yol senkron kalır ve interceptor'ın bugünkü şekli korunur:

```ts
intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
  if (context.getType() !== "http") return next.handle();

  const req: any = context.switchToHttp().getRequest();
  const tenantId = req?.user?.tenantId ?? req?.tenantId;
  RequestContext.set({
    tenantId,
    branchId: req?.scope?.branchId,
    userId: req?.user?.id ?? req?.user?.sub,
  });

  if (!tenantId) return next.handle(); // anonymous — ambient() falls back

  // Fast path: a tenant's country never changes in practice, so this misses
  // exactly once per tenant per process. Keeping it synchronous is the whole
  // point — this interceptor runs on EVERY request.
  const cached = this.country.cachedCodeFor(tenantId);
  if (cached) {
    RequestContext.set({ countryCode: cached });
    return next.handle();
  }

  return from(this.country.forTenant(tenantId)).pipe(
    switchMap((profile) => {
      RequestContext.set({ countryCode: profile.code });
      return next.handle();
    }),
    // MANDATORY. Without this, a rejected forTenant() means the switchMap
    // projector never fires, next.handle() is never called, and the request
    // dies as a bare 500 with the real route handler — an order, a payment —
    // never executing. Before this task the interceptor was synchronous and
    // could not fail this way; the cache makes that failure mode reachable
    // for every tenant's FIRST request after a process restart, Turkish ones
    // included. Country is a nice-to-have; the request is not.
    catchError((err) => {
      this.logger.warn(
        `Country resolution failed for tenant ${tenantId}, continuing without it: ${err?.message ?? err}`,
      );
      return next.handle();
    }),
  );
}
```

Bu `catchError`'ın kendi testi olmalı ve test, hatanın yutulduğunu değil **isteğin tamamlandığını** iddia etmeli:

```ts
it("still runs the request when country resolution fails — a DB blip must not 500 every route", async () => {
  (prisma.tenant.findUnique as any).mockRejectedValue(new Error("connection reset"));
  const handled = await runThroughInterceptor({ tenantId: "t1" });
  expect(handled).toBe(HANDLER_RESULT);        // the route actually ran
  expect(RequestContext.get()?.countryCode).toBeUndefined(); // degraded, not wrong
});
```

`CountryService` kazandığı iki üye:

```ts
private readonly codeCache = new Map<string, string>();

/** Synchronous peek for the request hot path. Null = not yet resolved. */
cachedCodeFor(tenantId: string): string | null {
  return this.codeCache.get(tenantId) ?? null;
}

/** Called wherever Tenant.countryCode is written, so the cache cannot go stale. */
invalidate(tenantId: string): void {
  this.codeCache.delete(tenantId);
}
```

`forTenant` bulduğu kodu `codeCache`'e yazar.

**Önbellek bayatlaması:** `countryCode`'u yazan her yer `invalidate(tenantId)` çağırmalı. Bugün onu yazan tek yer kiracı oluşturmadır (varsayılan `'TR'`), ama bir superadmin ileride değiştirebilir — `invalidate` o günün hatasını şimdiden kapatır.

Tenant yoksa (kimliksiz istek) `countryCode` yazılmaz — `ambient()` varsayılana düşer.

- [ ] **Step 5: Run tests**

Run: `cd /home/tarik/Projects/kds/backend && npx jest src/common/context && npx tsc --noEmit -p tsconfig.json`
Expected: PASS, tsc 0

- [ ] **Step 6: Commit**

```bash
git add backend/src/common/context/
git commit -m "feat(country): istek bağlamına ambient ülke

Decorator'lar tanımlama anında sabitlenir ve transform senkron çalışır —
DB okuyamazlar. Nest sıralaması guard → interceptor → pipe olduğu için,
interceptor countryCode'u store'a yazdığında DTO transform'u onu senkron
okuyabiliyor. Telefon bölgesinin ve vergi-no kuralının ülkeden gelmesini
mümkün kılan tek mekanizma bu."
```

---

## Task 4: Ürün vergi bandı ülkeden — ve platform faturasına DOKUNMA

**Files:**
- Modify: `backend/src/modules/menu/dto/create-product.dto.ts:217-225`
- Modify: `backend/src/modules/menu/dto/update-product.dto.ts` (aynı bant varsa)
- Modify: `backend/src/modules/accounting/constants/accounting.enum.ts`
- Create: `backend/src/common/country/country-tax-rate.validator.ts`
- Test: `backend/src/modules/menu/dto/create-product.dto.spec.ts`

**Interfaces:**
- Consumes: `CountryService.ambient()` (T2/T3)
- Produces: `@IsCountryTaxRate()` decorator

### Planın ilk hâli yanlıştı — önce bunu oku

Bu görev başlangıçta "dört vergi aynasını tek kaynağa indir" diyordu ve `quote.service`, `kdv.helper`, `billing.service`'i de kapsıyordu. **Kod okununca bu kavramsal bir hata çıktı.** İki tamamen ayrı vergi var ve plan bunları birbirine karıştırmıştı:

| | Kim kime | Hangi ülkenin kuralı | Nerede |
|---|---|---|---|
| **Restoran vergisi** | restoran → müşteri | **restoranın** ülkesi | `Product.taxRate` → `OrderItem.taxRate` |
| **Platform faturası** | HummyTummy → restoran | **Türkiye** + sınır-ötesi hizmet kuralları | `quote.service`, `billing.service`, `kdv.helper` |

`quote.service` `CatalogService`/`AddOnCatalogService`/`LicensingService` import ediyor, "licence anniversary"e göre orantılıyor ve donanım kargosu hesaplıyor — yani **platformun kendi satışı**. `billing.service` abonelik faturası kesiyor. İkisi de Türk bir şirketin müşterisine kestiği faturadır.

**Karar: platform faturasına dokunulmayacak.**

`billing.service:68`'deki `isTurkish ? splitGrossAmount(...) : tax 0` bir hata değil, bir **hukuki ayrım**. Özbek bir müşteri Türk bir SaaS lisansı satın aldığında bu sınır-ötesi hizmet ihracıdır; Türk KDV'si açısından tipik olarak istisna/sıfır oranlıdır ve **kesinlikle %12 QQS değildir**. Planın ilk hâli uygulansaydı HummyTummy, kayıtlı olmadığı ve iade edemeyeceği bir Özbek vergisini tahsil ediyor görünecekti — bu, düzeltmesi kod hatasından çok daha pahalı bir sorundur.

Bu satırlar yerinde kalıyor. Yapılan tek şey, oradaki yorumun bunun bilinçli bir karar olduğunu söylemesi (bugün "per-jurisdiction VAT is out of scope" diyor, ki bu bir eksiklik gibi okunuyor; oysa doğru davranış bu).

**Ayrıca `DEFAULT_TAX_RATE` bir ayna değilmiş:** `grep` gösteriyor ki yalnız kendi dosyasında kullanılıyor. "Dört ayna" diye bir şey yok.

### Geriye kalan gerçek iş

Restoranın vergisi zaten **veri**: operatör her ürüne `taxRate` giriyor, o `OrderItem`'a akıyor, `TaxCalculationService` doğru hesaplıyor. Özbekistan'ı engelleyen **tek** şey ürün girişindeki sabit bant.

- [ ] **Step 1: Write the failing test**

```ts
import { validate } from "class-validator";
import { plainToInstance } from "class-transformer";
import { CreateProductDto } from "./create-product.dto";
import { RequestContext } from "../../../common/context/request-context";

const make = (taxRate: number) =>
  plainToInstance(CreateProductDto, {
    name: "X",
    price: 10,
    categoryId: "c1",
    taxRate,
  });

const errorsFor = async (taxRate: number, countryCode: string) =>
  RequestContext.run({ countryCode }, () => validate(make(taxRate)));

describe("CreateProductDto taxRate is country-scoped", () => {
  it("accepts every Turkish band under a TR tenant", async () => {
    for (const r of [0, 1, 10, 20]) {
      expect(await errorsFor(r, "TR")).toHaveLength(0);
    }
  });

  it("rejects 12 under a TR tenant", async () => {
    expect((await errorsFor(12, "TR")).length).toBeGreaterThan(0);
  });

  it("ACCEPTS 12 under a UZ tenant — the QQS rate that was impossible before", async () => {
    expect(await errorsFor(12, "UZ")).toHaveLength(0);
  });

  it("accepts the UZ catering rate of 6", async () => {
    expect(await errorsFor(6, "UZ")).toHaveLength(0);
  });

  it("rejects 20 under a UZ tenant — Turkey's rate is not Uzbekistan's", async () => {
    expect((await errorsFor(20, "UZ")).length).toBeGreaterThan(0);
  });

  it("falls back to the Turkish bands outside any request", async () => {
    // Cron, seeds, bootstrap. Must not start rejecting everything.
    expect(await validate(make(20))).toHaveLength(0);
    expect((await validate(make(12))).length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx jest src/modules/menu/dto/create-product.dto.spec.ts`
Expected: FAIL — UZ vakaları düşer, çünkü bant bugün sabit `[0, 1, 10, 20]`

- [ ] **Step 3: Implement the validator**

`country-tax-rate.validator.ts`, ambient profilin `taxRates`'ine karşı doğrulayan bir `registerDecorator` sarmalayıcısı. Hata mesajı ülkenin kendi bantlarını saymalı ("izin verilen oranlar: 0, 6, 12"), yoksa Özbek operatör neden reddedildiğini anlayamaz.

- [ ] **Step 4: Swap the DTO band and the default**

`create-product.dto.ts:220-223`'te `enum: [0, 1, 10, 20]` (Swagger) ve `@IsIn([0, 1, 10, 20])` yerine `@IsCountryTaxRate()`. Varsayılan da profilin `defaultTaxRate`'i olur. `update-product.dto.ts`'te aynı bant varsa o da.

`accounting.enum.ts`'te `TaxRate` enum'u **kalır** (TR bantlarının adlandırılmış hâli, hâlâ okunabilir) ama üstüne bir yorum: bunlar yalnız TR içindir ve doğruluk kaynağı `COUNTRY_PROFILES.TR.taxRates`'tir. `DEFAULT_TAX_RATE` profilden türetilir.

- [ ] **Step 4b: The FRONTEND dropdown — without this the task's goal is not met**

Backend'in %12'yi kabul etmesi tek başına hiçbir işe yaramaz: operatör onu **seçemiyorsa** ürün yine girilemez. İki yerde sabit liste var:

- `frontend/src/pages/admin/ProductEditorPage.tsx:579-591` — elle yazılmış `<option value={0}>%0</option> … %20`
- `frontend/src/pages/admin/menuManagement/MenuDraftReviewGrid.tsx:7` — `export const TAX_RATES = [0, 1, 10, 20]`

Backend `SETTINGS_SELECT` zaten `countryCode` döndürüyor ama `taxRates` döndürmüyor. Doğruluk kaynağı backend'de kalsın diye oranları **backend yayınlasın**: ayarlar yanıtına ülkenin profilinden `taxRates` (ve `defaultTaxRate`) eklenir — kolon değil, türetilmiş alan.

Frontend'de `useCountryProfile()` kancası oluşturulur:

```ts
// frontend/src/hooks/useCountryProfile.ts
export function useCountryProfile() {
  const { data } = useTenantSettings();
  return {
    countryCode: data?.countryCode ?? "TR",
    taxRates: data?.taxRates ?? [0, 1, 10, 20],
    defaultTaxRate: data?.defaultTaxRate ?? 10,
  };
}
```

Her iki bileşen de listeyi bu kancadan üretir. **Task 7 bu kancayı `currency` ve `displayDecimals` ile genişletecek** — sıfırdan yazmayacak.

Fallback'ler bilerek Türk değerleri: ayarlar henüz yüklenmemişken bugünkü davranış görünür.

- [ ] **Step 4c: Remove the duplicated fallback**

`resolveCountryProfile()` ile `CountryService.forCode()` aynı fallback ternary'sinin **iki ayrı kopyasını** taşıyor — tam olarak bu projenin ortadan kaldırmaya çalıştığı drift. `forCode()` `resolveCountryProfile()`'a delege etsin ve kendi log'unu üstüne eklesin. `resolveCountryProfile`'ın docstring'i "tüm kod tabanında tek uygulama" diyor; delege edilene kadar bu **yanlış**.

- [ ] **Step 5: Pin the platform-billing decision in code**

`billing.service.ts:64-74` ve `quote.service.ts:313-317`'deki yorumları, bunun bilinçli bir hukuki ayrım olduğunu söyleyecek şekilde güncelle — bir sonraki okuyucunun "eksik kalmış, ülkeye bağlayalım" diye düşünmemesi için. Kod değişmiyor.

Ve bunu bir testle çivile:

```ts
it("platform billing does NOT charge the customer country's VAT", async () => {
  // HummyTummy is a Turkish company. Invoicing an Uzbek tenant for a licence
  // is a cross-border service export — zero-rated for Turkish VAT, and
  // certainly not 12% QQS, which HummyTummy is not registered to collect and
  // could not remit. This test exists so nobody "fixes" it later.
  const invoice = await billing.issue({ tenantCountry: "UZ", currency: "USD", amount: 100 });
  expect(invoice.tax.toNumber()).toBe(0);
});
```

- [ ] **Step 6: Verify**

Run: `cd /home/tarik/Projects/kds/backend && npx jest src/modules/menu src/modules/checkout src/modules/subscriptions src/modules/accounting && npx tsc --noEmit -p tsconfig.json && npm run lint:ci`
Expected: PASS — TR davranışı bit-aynı, UZ %12 ve %6 artık girilebilir

- [ ] **Step 7: Commit**

```bash
git add backend/src
git commit -m "feat(country): ürün vergi bandı kiracının ülkesinden

@IsIn([0,1,10,20]) Özbekistan'ın %12 QQS'ini ve %6 ikram oranını sisteme
girmeyi tümden imkansız kılıyordu. Artık ambient profilin bantlarına karşı
doğrulanıyor; hata mesajı da ülkenin kendi oranlarını sayıyor.

PLATFORM FATURASINA DOKUNULMADI ve bu bilinçli. billing.service ile
quote.service, HummyTummy'nin (Türk şirket) restorana kestiği faturadır —
restoranın müşterisine kestiği değil. Özbek bir müşteriye lisans satmak
sınır-ötesi hizmet ihracıdır; Türk KDV'si açısından sıfır oranlıdır ve
%12 QQS değildir. Müşterinin ülke oranını uygulamak, HummyTummy'yi kayıtlı
olmadığı ve iade edemeyeceği bir vergiyi tahsil eder duruma sokardı.
Oradaki yorumlar artık bunun bir eksiklik değil karar olduğunu söylüyor,
ve bir test kararı çiviliyor."
```

## Task 5: Telefon — 18 regex + 21 "TR" tek kurala

**Files:**
- Create: `backend/src/common/phone/e164.const.ts`
- Modify: `backend/src/common/dto/normalize-phone.ts:39`
- Modify: 18 regex tanımının bulunduğu DTO'lar (aşağıda sayılı)
- Test: `backend/src/common/phone/e164.const.spec.ts`

**Interfaces:**
- Consumes: `RequestContext` (Task 3), `CountryService.ambient()`
- Produces: `export const E164_PATTERN: RegExp`, `export const E164_MESSAGE: string`

- [ ] **Step 1: Find every copy and pick the winning variant**

```bash
cd /home/tarik/Projects/kds/backend
grep -rn '\[1-9\]' src --include=*.ts | grep -v '\.spec\.' | grep -v normalize-phone.ts \
  | tee /tmp/e164-sites.txt | wc -l
```
Expected: **18** tanım, ve bunlar **iki ayrı varyant**:

| Varyant | Nerede | Ne kabul eder |
|---|---|---|
| `/^\+[1-9]\d{6,14}$/` | 10 yer (reservations, customers, auth, users, checkout, supplier) | `+` **zorunlu**, 7-15 hane |
| `/^\+?[1-9]\d{7,14}$/` | 8 yer (orders, customer-orders, partner, accounting, phone-verification) | `+` **opsiyonel**, 8-15 hane |

Aynı alanın iki farklı kuralı var — biri `905551234567`'yi kabul eder, diğeri reddeder. Bu yüzden birleştirme saf bir refactor değil, bir **karar**.

**Karar: kazanan `/^\+[1-9]\d{6,14}$/`.** Gerekçe: `@NormalizePhone` transform'u `@Matches` doğrulamasından **önce** çalışır (class-transformer sonra class-validator), yani regex'e ulaşan her değer libphonenumber'ın ürettiği E.164'tür ve `+` daima vardır. `\+?` varyantı ölü müsamaha. `{6,14}` ile `{7,14}` arasından daha geniş olanı almak bugün geçen hiçbir girdiyi reddetmez; daha darını almak `+9xxxxxxx` biçimli 7 haneli bir numarayı reddedebilirdi. **Önerdiğim `\d{1,14}` alt sınırı kullanılmıyor** — bugünkü en dar davranıştan daha gevşek olurdu ve bu bir genişletme demekti.

- [ ] **Step 2: Write the failing test**

```ts
import { E164_PATTERN } from "./e164.const";
import { normalizePhoneToE164 } from "../dto/normalize-phone";
import { RequestContext } from "../context/request-context";

describe("E164_PATTERN", () => {
  it("accepts a Turkish and an Uzbek number", () => {
    expect(E164_PATTERN.test("+905551234567")).toBe(true);
    expect(E164_PATTERN.test("+998901234567")).toBe(true);
  });
  it("rejects a leading zero and a local-format number", () => {
    expect(E164_PATTERN.test("+0555123")).toBe(false);
    expect(E164_PATTERN.test("05551234567")).toBe(false);
  });
});

describe("normalizePhoneToE164 ambient region", () => {
  it("parses a locally-typed Uzbek number under a UZ tenant", () => {
    RequestContext.run({ countryCode: "UZ" }, () => {
      expect(normalizePhoneToE164("90 123 45 67")).toBe("+998901234567");
    });
  });
  it("still parses a locally-typed Turkish number under a TR tenant", () => {
    RequestContext.run({ countryCode: "TR" }, () => {
      expect(normalizePhoneToE164("0555 123 45 67")).toBe("+905551234567");
    });
  });
  it("falls back to TR outside a request — cron and bootstrap keep working", () => {
    expect(normalizePhoneToE164("0555 123 45 67")).toBe("+905551234567");
  });
});
```

- [ ] **Step 3: Run and confirm failure**

Run: `cd /home/tarik/Projects/kds/backend && npx jest src/common/phone`
Expected: FAIL — modül yok; ambient bölge okunmuyor

- [ ] **Step 4: Implement**

`e164.const.ts`:

```ts
/**
 * The ONE E.164 rule. This was written out 18 separate times across the DTOs
 * in TWO different variants — `/^\+[1-9]\d{6,14}$/` in ten places and
 * `/^\+?[1-9]\d{7,14}$/` in eight — so the same field accepted a bare
 * "905551234567" through some endpoints and rejected it through others.
 *
 * The strict variant wins. @NormalizePhone transforms before @Matches
 * validates, so everything reaching this regex is already E.164 out of
 * libphonenumber and always carries the '+'. The optional-'+' variant was
 * dead permissiveness. Import this; do not retype it.
 */
export const E164_PATTERN = /^\+[1-9]\d{6,14}$/;
export const E164_MESSAGE = "phone must be in E.164 format, e.g. +905551234567";
```

`normalize-phone.ts` — varsayılan bölge artık ambient ülkeden gelir:

```ts
export function normalizePhoneToE164(
  value: string,
  defaultRegion?: CountryCode,
): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  // The region is what makes a locally-typed number parseable ("0555…" is
  // Turkish, "90 123…" is Uzbek). It comes from the tenant in flight, read
  // synchronously off the ambient request context — a decorator is fixed at
  // definition time and cannot await a database read.
  const region =
    defaultRegion ??
    ((RequestContext.get()?.countryCode as CountryCode | undefined) ?? "TR");
  ...
}
```

**Dikkat — buradaki `CountryCode` libphonenumber-js'in tipidir**, Task 1'in `CountryProfileCode`'u değil. `normalize-phone.ts` onu zaten import ediyor ve libphonenumber'a geçiriyor; ikisi karıştırılmamalı. (Task 1'in tipi bu yüzden `CountryProfileCode` diye adlandırıldı.)

`NormalizePhone` decorator'ının imzası `(defaultRegion?: CountryCode)` olur; **21 çağrı yerindeki `@NormalizePhone("TR")` argümanı kaldırılır** ki ambient devreye girsin.

- [ ] **Step 5: Sweep the 18 regex definitions**

`/tmp/e164-sites.txt`'teki her satırda yerel `PHONE_REGEX` sabiti ve satır-içi regex `E164_PATTERN` ile, mesaj `E164_MESSAGE` ile değiştirilir. `@Matches(PHONE_REGEX, …)` çağrı yerleri (16 adet) sabitin adı korunarak import'a döner ya da doğrudan `E164_PATTERN` kullanır — hangisi daha az gürültü yaratıyorsa.

Sekiz gevşek varyantın sıkıya dönmesi **davranış değişikliğidir**: bu uçlar artık `+` içermeyen bir numarayı reddeder. Transform önce çalıştığı için gerçek istemcilerde bu değer zaten oluşmuyor; yine de her birine bir test eklenir.

- [ ] **Step 6: Run the full backend suite**

Run: `cd /home/tarik/Projects/kds/backend && npx jest && npx tsc --noEmit -p tsconfig.json`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add backend/src
git commit -m "feat(country): telefon kuralı tek yerde, bölge ülkeden

Aynı E.164 kuralı 18 ayrı yerde, üstelik iki farklı varyantta yazılıydı:
10 yerde `+` zorunlu, 8 yerde opsiyonel. Yani aynı alan bazı uçlardan
\"905551234567\"ü kabul ederken bazılarından reddediyordu. Sıkı varyant
kazandı — transform doğrulamadan önce çalıştığı için regex'e ulaşan her
değer zaten libphonenumber'ın ürettiği E.164 ve '+' daima var; gevşek
varyant ölü müsamahaydı.

@NormalizePhone artık bölgeyi ambient istek bağlamından alıyor; 21 çağrı
yerindeki sabit \"TR\" argümanı kaldırıldı. Yerel biçimde yazılmış bir
numarayı ayrıştırabilmenin tek yolu bölgeyi bilmek: \"0555…\" Türk,
\"90 123…\" Özbek. İstek dışında (cron, bootstrap) TR'ye düşer."
```

---

## Task 6: Vergi kimlik numarası — GİRDİ doğrulaması profile

**Files:**
- Create: `backend/src/common/country/tax-id.validator.ts`
- Modify: `backend/src/modules/tenants/dto/update-tenant-settings.dto.ts:263`
- Modify: `backend/src/modules/accounting/dto/accounting-settings.dto.ts:25-36`
- Modify: `backend/src/modules/accounting/dto/create-sales-invoice.dto.ts:22,39,44`
- Modify: `frontend/src/pages/settings/AccountingSettingsPage.tsx:46,256`
- Modify: `frontend/src/pages/admin/invoices/CreateInvoiceFromOrderModal.tsx:15`
- Modify: `frontend/src/pages/settings/BrandingSettingsPage.tsx:34,164`
- Test: `backend/src/common/country/tax-id.validator.spec.ts`

**BU GÖREVDE DEĞİŞMEYECEK — bilerek TR'ye özel kalan yerler:**

| Dosya | Neden kalıyor |
|---|---|
| `accounting/e-document-routing.ts:32,62` | e-Fatura mı e-Arşiv mi kararı **Türk regülasyonu**. VKN kontrolü burada iş kuralının kendisi, girdi doğrulaması değil. |
| `accounting/providers/ubl-tr-builder.ts:133,162-178` | UBL-TR şeması. `PartyTaxScheme/CompanyID` tanım gereği VKN. |
| `accounting/providers/mukellef-query.provider.ts:18-19` | GİB mükellef sorgusu. |
| `accounting/adapters/nilvera.adapter.ts:26,34,201` | Nilvera'nın kendi API'si. |
| `accounting/services/accounting-sync.service.ts:194,473` | Yukarıdakileri çağırıyor. |

Bunlar genelleştirilmez çünkü **genelleştirilecek bir şey yok**: Özbekistan'ın e-fatura formatı UBL-TR değil, tamamen ayrı bir adapter. Task 9'un çözücüsü UZ için `eDocumentAdapterId: null` verdiğinden bu modüller UZ kiracıda **hiç çalışmaz** — doğru izolasyon budur. Spec bu genelleştirmeyi zaten P3+'a bırakmıştı.

Değişen şey yalnızca **operatörün elle girdiği** vergi numarasının doğrulanması.

**Interfaces:**
- Consumes: `CountryProfile.taxIdRules`, `CountryService.ambient()`
- Produces: `isValidTaxId(value: string, profile: CountryProfile): boolean`, `@IsCountryTaxId()` decorator

Frontend'de `pattern="\d{10,11}"` HTML nitelikleri kaldırılır — doğrulama profile bağlı olduğu için istemcide sabit bir pattern yanlış olur; hata mesajı sunucudan gelir. Vergi-no etiketi profilin `labelKey`'inden i18n ile gelir (beş dil).

- [ ] **Step 1: Write the failing test**

```ts
import { isValidTaxId } from "./tax-id.validator";
import { COUNTRY_PROFILES } from "./country-profile.const";

describe("isValidTaxId", () => {
  const TR = COUNTRY_PROFILES.TR;
  const UZ = COUNTRY_PROFILES.UZ;

  it("TR accepts VKN(10) and TCKN(11)", () => {
    expect(isValidTaxId("1234567890", TR)).toBe(true);
    expect(isValidTaxId("12345678901", TR)).toBe(true);
  });
  it("TR rejects the Uzbek shapes", () => {
    expect(isValidTaxId("123456789", TR)).toBe(false);
    expect(isValidTaxId("12345678901234", TR)).toBe(false);
  });
  it("UZ accepts STIR(9) and PINFL(14) and rejects the Turkish shapes", () => {
    expect(isValidTaxId("123456789", UZ)).toBe(true);
    expect(isValidTaxId("12345678901234", UZ)).toBe(true);
    expect(isValidTaxId("1234567890", UZ)).toBe(false);
  });
  it("rejects non-digits and empty regardless of country", () => {
    expect(isValidTaxId("abc", TR)).toBe(false);
    expect(isValidTaxId("", UZ)).toBe(false);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `cd /home/tarik/Projects/kds/backend && npx jest src/common/country/tax-id.validator.spec.ts`
Expected: FAIL — modül yok

- [ ] **Step 3: Implement and sweep**

Doğrulayıcı profilin `taxIdRules`'unu dolaşır; `@IsCountryTaxId()` ambient profili kullanır. Yukarıdaki **3 backend girdi DTO'su + 3 frontend sitesi** ona döner — yukarıdaki tabloda sayılan e-fatura içleri değil. Hata mesajı profilin kural adlarından üretilir ("VKN (10) veya TCKN (11)" / "STIR (9) yoki PINFL (14)").

- [ ] **Step 4: i18n**

`country.taxId.vkn`, `.tckn`, `.stir`, `.pinfl` anahtarları beş dile **gerçek çeviriyle** eklenir (`tr`, `en`, `ru`, `uz`, `ar` — hepsi `settings.json`'da VKN metni taşıyor, önce onları say:
`grep -rn 'VKN' frontend/src/i18n/locales/*/settings.json`). Sabit "10 hane / 11 hane" serbest metinleri profilin kural adlarından üretilen etikete döner.

Türkçe `defaultValue` ile geçiştirme yok: parity testi geçer ama dört dil Türkçe görür — bu repoda daha önce yaşandı.

- [ ] **Step 5: Verify**

Run: `cd /home/tarik/Projects/kds/backend && npx jest && cd ../frontend && npx vitest run && npx tsc --noEmit -p tsconfig.json && cd .. && node scripts/check-i18n-parity.mjs`
Expected: hepsi PASS

- [ ] **Step 6: Commit**

```bash
git add backend/src frontend/src
git commit -m "feat(country): vergi kimlik numarası profilden doğrulanıyor

Operatörün elle girdiği vergi numarası 3 backend DTO'su ve 3 frontend
sitesinde sabit VKN/TCKN şekliyle doğrulanıyordu. Özbekistan'ın STIR'i 9,
PINFL'i 14 hane — hepsi tarafından reddediliyordu. Artık profilin
taxIdRules'u doğruluyor.

e-Fatura içleri (e-document-routing, ubl-tr-builder, mükellef sorgusu,
Nilvera) BİLEREK TR'ye özel kaldı: orada VKN kontrolü girdi doğrulaması
değil, Türk regülasyonunun kendisi. Özbekistan'ın e-fatura formatı UBL-TR
değil, ayrı bir adapter — ve UZ profili eDocumentAdapterId: null verdiği
için o modüller UZ kiracıda hiç çalışmıyor.

Frontend'deki sabit pattern nitelikleri kaldırıldı: doğrulama ülkeye bağlı
olduğu için istemcide sabit bir pattern yanlış olur; mesaj sunucudan gelir."
```

---

## Task 7: Para gösterimi — ondalık ülkeden, seçici kalkıyor

**Files:**
- Modify: `frontend/src/hooks/useCurrency.ts`
- Modify: `frontend/src/hooks/useFormatCurrency.ts`
- Modify: `frontend/src/hooks/useCountryProfile.ts` — **Task 4 bu kancayı zaten oluşturdu** (`countryCode`, `taxRates`, `defaultTaxRate`); bu görev `currency` ve `displayDecimals` ekliyor
- Modify: `backend/src/common/constants/currencies.const.ts`
- Modify: `backend/src/modules/tenants/dto/update-tenant-settings.dto.ts` — `currency` alanı **kaldırılır**
- Modify: `frontend/src/hooks/useCurrency.ts` — `UpdateTenantSettingsDto.currency` kaldırılır
- Modify: para birimi seçicisini gösteren ayar sayfaları
- Test: `frontend/src/hooks/useFormatCurrency.test.ts`

**Interfaces:**
- Consumes: `Tenant.countryCode` (ayarlar endpoint'inden)
- Produces: `useCountryProfile()` → `{ currency, displayDecimals, intlLocale }`

`useFormatCurrency` zaten doğru şekilde (`useLocale()` + `useCurrency()`); tek eksik `displayDecimals`'ı `minimumFractionDigits`/`maximumFractionDigits` olarak geçirmek. `SUPPORTED_CURRENCIES` backend'de **seçim listesi olmaktan çıkar**; `CURRENCY_INFO` sembol tablosu olarak kalır.

Para birimi **yazılabilir olmaktan da çıkar**: `UpdateTenantSettingsDto.currency` kaldırılır. Bir kiracının para birimini ülkesinden bağımsız değiştirebilmesi, Task 2'nin kurduğu "currency türetilir" değişmezini deler. Okuma tarafı (`TENANT_SETTINGS_SELECT.currency`) kalır.

- [ ] **Step 1: Write the failing test**

```ts
it("formats TRY with two decimals", () => { /* ₺1.234,56 */ });
it("formats UZS with NO decimals — so'm is quoted whole", () => {
  // 123456789 minor units (tiyin) → "1 234 568 so'm", not "1.234.567,89"
});
it("round-trips: a UZS amount stored x100 displays whole and re-parses to the same integer", () => {});
```

- [ ] **Step 2-5:** çalıştır-düşsün → uygula → çalıştır-geçsin → commit.

Commit mesajı, para biriminin artık seçilmediğini ve ülkenin sonucu olduğunu; `SUPPORTED_CURRENCIES`'in v3.2.9'da TRY'ye kısıldığını ve artık seçim listesi olmaktan tümden çıktığını anlatır.

---

## Task 8: `Decimal(10,2)` taşması

**Files:**
- Modify: `backend/prisma/schema.prisma` (toplam tutan kolonlar)
- Create: migration + down
- Test: `backend/src/common/country/decimal-overflow.spec.ts`

**Interfaces:**
- Consumes: yok
- Produces: şema değişikliği

`Decimal(10,2)` tavanı 99.999.999,99 ve UZS'de bu ~8.000 dolar. **Ürün fiyatı oraya varmaz ama günlük ciro, fatura toplamı ve sipariş tutarı varır.**

- [ ] **Step 1: The classification is already done — verify it, don't redo it**

```bash
cd /home/tarik/Projects/kds/backend
grep -c "Decimal(10, 2)" prisma/schema.prisma   # 74
```

74 eşleşmenin **73'ü gerçek kolon**; biri (`schema.prisma:4114`) `LeadOffer.discount`'ın üstündeki yorumun içinde geçen metin — kolon değil, atla.

**73'ün hepsi paradır ve hepsi genişletilecek.** Planın ilk hâli "oran kolonları kalsın" diyordu; ağaca bakıldığında şemada **`Decimal(10, 2)` kullanan tek bir oran kolonu yok** — oranlar `Decimal(5, 4)` kullanıyor (`commissionRate`, iki yerde). `User.hourlyRate` isminde "Rate" geçse de saatlik **ücret**tir, para. Yani sınıflandırılacak bir şey kalmadı; ayrım yapmaya çalışmak sadece hata üretir.

Genişletmenin gerekçesi büyüklük sırasına göre (1 USD ≈ 12.150 UZS, `Decimal(10,2)` tavanı 99.999.999,99 so'm ≈ **8.230 USD**):

| Grup | Kolonlar | Neden taşar |
|---|---|---|
| `ZReport` | 20 kolon (`totalSales`, `netSales`, `totalTax`, `cashPayments`, …) | Günlük toplam. 8.000 USD/gün ciro yapan bir restoran **97M so'm** eder — tavanın dibinde. Yoğun bir gün taşar. |
| `CashierSession` | 7 kolon (`expectedCash`, `cashSales`, `overShort`, …) | Vardiya toplamı, ZReport ile aynı mertebe. |
| `Customer` | `totalSpent`, `averageOrder` | **Ömür boyu** toplam. Sadık bir müşteride kaçınılmaz taşar. |
| `Order` / `SalesInvoice` / `Invoice` | 12 kolon | Tek bir büyük ikram/etkinlik siparişi 8.230 USD'yi geçebilir. |
| `TableAnalytics` | `revenueGenerated`, `avgOrderValue` | Dönemsel toplam. |
| Kalan birim fiyatlar | `Product.price`, `OrderItem.unitPrice`, … | Tek başına taşmaz **ama** 8.230 USD'lik bir ikram kalemi mümkün; ayrıca bir kolonu dar bırakmak, toplamı geniş olan bir alanla asimetri yaratır. |

`Decimal(14, 2)` seçimi keyfi değil: şemada **zaten bir `Decimal(14, 2)` var**, yani bu repoda kurulu bir hassasiyet. (Ayrıca 8 adet `Decimal(12, 2)` var — bunlar bu görevin kapsamı dışında, ama tutarsızlık olarak rapora yazılsın.)

- [ ] **Step 1b: Fix the comment that this task makes false**

`schema.prisma:4112-4114`'teki yorum şöyle diyor: *"Aligned with every other money column in the schema (Decimal(10, 2))."* Bu görev tamamlandığında bu cümle **yanlış** olur. Yorumu güncelle.

- [ ] **Step 2: Write the failing test**

Atılabilir bir veritabanında 100.000.000 so'm'luk bir toplamın saklanabildiğini iddia eden bir test; genişletmeden önce numeric overflow ile düşer.

- [ ] **Step 3-5:** genişlet (`Decimal(14, 2)`), up→down→up turunu atılabilir Postgres'te doğrula (Task 2'deki komut bloğunun aynısı — bakım veritabanı `template1`, `postgres` diye bir DB **yok**), commit.

---

## Task 9: Yetenek çözücü (P2 başlangıcı)

**Files:**
- Create: `backend/src/common/country/country-capability.resolver.ts`
- Test: `backend/src/common/country/country-capability.resolver.spec.ts`

**Interfaces:**
- Consumes: `CountryService`, `PaymentProviderRegistry`, `FiscalProviderRegistry`, `EscPosBuilderRegistry`
- Produces: `paymentProviderFor(tenantId): Promise<PaymentProvider>`, `fiscalProviderFor(tenantId)` (kiracının seçtiği cihazı ülkenin izinli kümesine karşı doğrular), `escposBuilderFor(tenantId)`, `smsProviderIdFor(tenantId)`

**Kritik davranış:** profil bir yetenek için `null` diyorsa çözücü **açık bir hata fırlatır**, sessizce Türk sağlayıcısına düşmez. UZ'de bugün `fiscalProviderId: null` — bu doğru ve dürüst; o kafe yasal fiş kesemez ve sistem bunu saklamamalı.

- [ ] **Step 1: Write the failing test**

```ts
it("resolves the Turkish payment provider for a TR tenant", async () => { /* "paytr" */ });
it("REFUSES for a UZ tenant instead of silently falling back to PayTR", async () => {
  await expect(resolver.paymentProviderFor("uz-tenant")).rejects.toThrow(
    /no payment provider configured for UZ/i,
  );
});
it("throws a clear error when a profile names a provider the registry does not have", async () => {
  // A typo in the profile must fail loudly at call time, not 404 deep inside a payment.
});

// THE IMPORTANT ONE. Task 1's review caught four wrong ids ("generic" vs
// "escpos-tr", "hugin" vs "fiscal_hugin", "nilvera" vs "NILVERA", and an
// "eskiz" that existed nowhere) that no unit test could see, because a
// profile is just strings. This test walks every profile against the real
// DI container and closes that hole for every country added later.
it("every id named by every profile actually exists in its registry", async () => {
  for (const profile of Object.values(COUNTRY_PROFILES)) {
    for (const id of profile.capabilities.fiscalProviderIds) {
      expect(fiscalRegistry.list().map((p) => p.id)).toContain(id);
    }
    for (const id of profile.capabilities.paymentProviderIds) {
      expect(paymentRegistry.list().map((p) => p.id)).toContain(id);
    }
    expect(escposRegistry.list().map((b) => b.id)).toContain(
      profile.capabilities.escposBuilderId,
    );
    if (profile.capabilities.eDocumentAdapterId) {
      expect(Object.values(AccountingProvider)).toContain(
        profile.capabilities.eDocumentAdapterId,
      );
    }
  }
});
```

- [ ] **Step 2-5:** çalıştır-düşsün → uygula → çalıştır-geçsin → commit.

---

## Task 10: Ödeme — yedi sızıntı registry'ye

**Files:**
- Modify: `backend/src/modules/checkout/checkout-intent.service.ts:304`
- Modify: `backend/src/modules/customer-orders/services/self-pay-intent.service.ts:52,216-222,546`
- Modify: `backend/src/modules/customer-orders/services/self-pay-recovery.service.ts:68`
- Modify: `backend/src/modules/payments-core/adapters/paytr-payment-provider.ts:89-93`
- Test: ilgili spec'ler

**Interfaces:**
- Consumes: `CountryCapabilityResolver.paymentProviderFor` (Task 9)

Yedi sızıntı:

| # | Ne | Nasıl kapanıyor |
|---|---|---|
| 1 | `self-pay-intent.service.ts:52` somut `PaytrAdapter` enjeksiyonu | çözücü + registry |
| 2 | `self-pay-recovery.service.ts:68` aynısı | çözücü + registry |
| 3 | `checkout-intent.service.ts:304` `createIntent("paytr", …)` | çözücüden gelen id |
| 4-5 | `paytr.adapter.ts:384,488` TRY kapısı | **kalır** — adapter kendi sınırını savunmalı |
| 6 | `paytr-payment-provider.ts:89-93` ikinci TRY kapısı | **kalır**, aynı gerekçe |
| 7 | `self-pay-intent.service.ts:216-222` kiracı para birimine göre red | kalkar — çözücü zaten doğru sağlayıcıyı verir; para birimi kontrolü sağlayıcının işi |

**4, 5 ve 6 bilerek kalıyor:** adapter'ın kendi para birimi sınırını savunması doğru davranıştır. Kalkan şey, *çağıranın* PayTR olduğunu varsayması.

- [ ] **Step 1: Write the failing test**

```ts
it("a UZ tenant's self-pay never reaches the PayTR adapter", async () => {
  // paytrAdapter.getIframeToken must not be called; a clear refusal instead.
});
it("a TR tenant's checkout still resolves to paytr — behaviour unchanged", async () => {});
```

- [ ] **Step 2-5:** çalıştır-düşsün → uygula → çalıştır-geçsin → commit.

---

## Task 11: SMS — süreç tekilinden kiracı başına

**Files:**
- Modify: `backend/src/modules/customers/sms.service.ts:14-84`
- Test: `backend/src/modules/customers/sms.service.spec.ts`

`initializeProvider()` constructor'da bir kez çalışıyor ve sağlayıcıyı süreç başına seçiyor; auto-detect yorumu açıkça "NetGSM önce (TR için ucuz)" diyor. Tek dağıtım TR kiracılarını NetGSM'e, UZ kiracılarını başka bir sağlayıcıya yönlendiremiyor.

Sağlayıcılar bir registry'ye kaydolur; seçim `send()` anında kiracıdan çözülür. Süreç-başına `mockMode` prod-red mantığı **korunur** — o güvenlik davranışı doğru.

- [ ] **Step 1-5:** test → düşsün → uygula → geçsin → commit.

---

## Task 12: Boot — PayTR zorunluluğu ülke koşullu

**Files:**
- Modify: `backend/src/common/helpers/env-validation.ts:62-66`
- Test: `backend/src/common/helpers/env-validation.spec.ts`

Bugün prod açılışı PayTR kimlik bilgileri yoksa `process.exit(1)` yapıyor, hiçbir ülke koşulu olmadan. **PayTR'siz bir dağıtım bugün ayağa kalkamaz** — UZ stack'i bu yüzden boot edemez.

**Bu görevin tanımsız girdisi vardı ve ön-uçuş taramasında yakalandı:** doğrulama boot'ta, herhangi bir kiracı bilinmeden çalışır — "bu dağıtım hangi ülkelere hizmet ediyor" sorusunun kodda bir cevabı yok.

**Karar: yeni bir `DEPLOYMENT_COUNTRIES` ortam değişkeni, varsayılanı `"TR"`.** Virgülle ayrılmış ISO kodları. Doğrulama, o ülkelerin profillerinin `capabilities`'inde adı geçen sağlayıcıların kimlik bilgilerini zorunlu tutar.

Neden ortam değişkeni: boot zamanı bir dağıtım gerçeğidir, kiracı gerçeği değil. Veritabanından "hangi ülkelerin kiracısı var" diye sormak, doğrulamayı DB'ye bağımlı kılar ve ilk UZ kiracısı yaratıldığı an prod boot'unu kırar.

Varsayılan `"TR"` olduğu için **bugünkü davranış bit-aynı**: PayTR kimlik bilgileri hâlâ zorunlu. `DEPLOYMENT_COUNTRIES=UZ` olan bir stack ise PayTR'siz açılır.

- [ ] **Step 1: Write the failing test**

```ts
it("still refuses to boot without PayTR when DEPLOYMENT_COUNTRIES is unset — today's behaviour", () => {});
it("still refuses to boot without PayTR when DEPLOYMENT_COUNTRIES=TR", () => {});
it("boots without PayTR credentials when DEPLOYMENT_COUNTRIES=UZ", () => {});
it("requires BOTH countries' providers when DEPLOYMENT_COUNTRIES=TR,UZ", () => {});
it("refuses to boot on an unknown country code rather than silently serving nothing", () => {});
```

- [ ] **Step 2-5:** çalıştır-düşsün → uygula → çalıştır-geçsin → commit.

---

## Task 13: Yazıcı — kod sayfası ve zaman damgası profilden

**Files:**
- Modify: `backend/src/modules/device-mesh/printing/escpos-builder.service.ts:64-90,425-432,462-472`
- Test: `backend/src/modules/device-mesh/printing/escpos-builder.service.spec.ts`

İki kusur:
1. CP857 tablosu 20 Türkçe girdi taşıyor ve `:467-468` tanımadığı her karakteri `0x3f` (`?`) yapıyor — Kiril ve Özbek Latin metni fişte okunmaz hâle geliyor.
2. `:425-432` `trDateTime` zaman damgasını `tr-TR` + `Europe/Istanbul`'a çiviliyor ve **şubenin kendi saat dilimini hiç okumuyor** — bu bugün Türkiye için bile yanlış olabilir (şube `timezone` alanı var ve kullanılmıyor).

Kod sayfası profilin `escposBuilderId`'sinden gelen builder'a, zaman damgası profilin `intlLocale`'ine ve **şubenin** `timezone`'una bağlanır.

- [ ] **Step 1: Write the failing test**

```ts
it("a Cyrillic product name does not become '?' on a UZ receipt", () => {});
it("the receipt timestamp uses the BRANCH timezone, not Europe/Istanbul", () => {});
it("a Turkish receipt is byte-identical to before — regression pin", () => {});
```

- [ ] **Step 2-5:** çalıştır-düşsün → uygula → çalıştır-geçsin → commit.

---

## Task 14: Türkiye regresyonu — kabul ölçütü

**Files:**
- Create: `backend/src/common/country/tr-unchanged.spec.ts`
- Test: manuel, çalışan uygulamada

**Bu planın kabul ölçütü:** P1+P2 sonunda Türk kiracı için görünen hiçbir şey değişmemiş olmalı.

- [ ] **Step 1: Automated pin**

TR kiracısı için vergi oranı, telefon normalizasyonu, vergi-no doğrulaması, para biçimi, sağlayıcı seçimi ve fiş çıktısının değişmediğini iddia eden bir spec.

- [ ] **Step 2: Full suites**

```bash
cd /home/tarik/Projects/kds/backend && set -o pipefail && npx jest --silent && npx tsc --noEmit -p tsconfig.json && npm run lint:ci
cd /home/tarik/Projects/kds/frontend && npx vitest run && npx tsc --noEmit -p tsconfig.json
cd /home/tarik/Projects/kds && node scripts/check-i18n-parity.mjs
```

- [ ] **Step 3: Manual — a TR tenant**

Menü, POS, sipariş, fiş, fatura: her yerde ₺, %20/%10 KDV, `+90` telefon, VKN/TCKN. Hiçbiri değişmemiş olmalı.

- [ ] **Step 4: Manual — a UZ tenant**

`countryCode='UZ'` yapılmış bir test kiracısında: so'm ondalıksız görünür, %12 ürün vergisi girilebilir, `+998` telefon ayrıştırılır, STIR/PINFL kabul edilir, self-pay PayTR'ye **hiç** ulaşmaz ve açık bir hata verir.

---

## Self-Review

**Spec coverage**

| Spec bölümü | Görev |
|---|---|
| Ülke profili kod sabiti | T1 |
| `Tenant.countryCode`, TR varsayılanı, türetilen currency | T2 |
| Ambient ülke (senkron okuma) | T3 |
| Dört vergi aynası + ürün bandı | T4 |
| Telefon (23 regex, 21 "TR") | T5 |
| Vergi-no (7 kod + 2 pattern + 20 metin) | T6 |
| `displayDecimals`, seçicinin kalkması | T7 |
| `Decimal(10,2)` taşması | T8 |
| Yetenek çözücü, `null` = açık red | T9 |
| Ödeme: yedi sızıntı | T10 |
| SMS kiracı başına | T11 |
| Ülke koşullu boot | T12 |
| Kod sayfası + şube saat dilimi | T13 |
| TR değişmedi kabul ölçütü | T14 |

Kapsam dışı olduğu spec'te yazılı ve burada da görev yok: UBL-TR'nin genelleştirilmesi, IKPU/MXIK alanı, UZ fiskal/ödeme/e-fatura adapter'ları, e-posta şablonlarının yerelleştirilmesi, dağıtım. Bunlar P3-P7.

**Placeholder scan:** "TBD"/"TODO" yok. T7, T8, T10-T13'te adım gövdeleri özet — bu bilinçli: o görevler bir süpürme ve dokunulacak yerler dosya:satır olarak sayılmış durumda; uygulayan ajan listeyi grep ile üretip rapora yazacak. T1-T6 ve T9 tam kod taşıyor çünkü orada tasarım kararı var.

**Type consistency:** `CountryProfile` T1'de üretilir, T2-T13'te tüketilir. `CountryService.ambient()` T2'de tanımlanır, T3'te anlamlı hale gelir, T4-T6'da kullanılır. `CountryCapabilityResolver` T9'da üretilir, T10-T13'te tüketilir. `E164_PATTERN` T5'te üretilir ve yalnız orada süpürülür.

**Doğal sevkiyat sınırı:** T1-T8 (P1) tek başına tutarlı ve gönderilebilir — ülke profili, parametreler, TR değişmemiş. T9-T13 (P2) onun üstüne biner. İstenirse iki ayrı sevkiyat yapılabilir.
