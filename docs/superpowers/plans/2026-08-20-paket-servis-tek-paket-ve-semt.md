# Paket servis tek paket + Semt (yakında) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Platform başına satılan üç teslimat eklentisini tek bir `delivery_platforms` paketine (249.900 kuruş, dört sağlayıcı) indirmek, mevcut sahipliği tersine çevrilebilir bir migration ile yeni pakete taşımak ve Semt'i satılmayan, her yazma yolunda fail-closed kapatılmış bir "yakında" platformu olarak sözlüğe eklemek.

**Architecture:** Üç ray. **(1) Katalog rayı:** `alacarte-catalog.const.ts` tek paket satırını taşır, `20260820140000_delivery_platforms_bundle` migration'ı üç eski SKU'yu arşivler, sahipliği pakete taşır, açık yenileme döngülerini temizler ve uçuşta ödeme niyeti varsa çalışmayı reddeder; `alacarte-catalog-migration.spec.ts` katlama (fold) mekanizmasıyla katalog sabitini migration zincirinin **bileşik** sonucuyla karşılaştırır. **(2) Sözlük rayı:** `DeliveryPlatform` enum'una `SEMT` eklenir ve yeni `PLATFORM_AVAILABILITY` haritası DTO + adapter fabrikası + simülatör olmak üzere üç katmanda fail-closed kapatır. **(3) Vitrin rayı:** frontend enum aynası (artık sözleşme-drift muhafızıyla korunuyor), ayarlar sayfasında beşinci kart, mağazada satın alınamaz bilgi kartı, ve 24 elle senkronlanan doküman yüzeyi.

**Tech Stack:** NestJS + Prisma + Postgres (backend), React + TanStack Query + i18next (frontend), jest / vitest, hand-written SQL migration + `psql` round-trip.

**Spec:** `docs/superpowers/specs/2026-08-20-paket-servis-tek-paket-ve-semt-design.md`

## Global Constraints

- **Tek paket:** `delivery_platforms`, **249.900 kuruş (₺2.499, KDV DAHİL)**, `kind: "integration"`, `billing: "annual"`, `requiresLicense: true`, `deps: []`, `sortOrder: 20`.
- **Grants tam olarak:** `{"integration.delivery":["yemeksepeti","getir","trendyol_yemek","migros"],"feature.deliveryIntegration":true}` — vendor id sırası bu, bu sırayla pinlenir.
- **Üç eski kod ARŞİVLENİR, asla silinmez** (`status='archived'`) ve `RETIRED_ADDON_CODES`'a eklenir: `delivery_yemeksepeti`, `delivery_getir`, `delivery_trendyol_yemek`.
- **Mülkiyet geçişi, `RenewalCycle` temizliği ve uçuş-öncesi `checkout_intents` kilidi KAPSAM İÇİNDEDİR ve ONAYLANMIŞTIR** (§2 K5b, 2026-08-20 kullanıcı kararı). Hepsi **koşulsuz** yazılır; hiçbir adım ayrı bir onaya bağlı değildir.
- **Migration klasörü:** `backend/prisma/migrations/20260820140000_delivery_platforms_bundle/` — üç değişikliğin **1. sırası**. Yetkili zincir: `20260820100000_tenant_country_code` (mevcut) → `20260820120000_reprice_licence_and_stock` (mevcut) → `20260820130000_widen_money_decimal_precision` (mevcut) → **`20260820140000_delivery_platforms_bundle` (Change 1)** → `20260820150000_card_shift_schema` (Change 2a) → `20260820160000_card_shift_catalog` (Change 2b) → `20260820170000_print3d_service` (Change 3). Damga tahsis edilmiştir, "boş slot" diye yeniden seçilmez.
- **Damga çakışması ÇÖZÜLDÜ.** Bu migration ilk taslakta `20260820130000` idi; ağaçta çok-ülkeli işten gelen `20260820130000_widen_money_decimal_precision` zaten o damgayı tuttuğu için **yeniden numaralandırıldı** ve `20260820140000` oldu. Çözüm sıralama şansına (Prisma'nın klasörleri ada göre sıralamasına) bırakılmadı; damga değiştirildi. Klasör adını tekrar değiştirme.
- Her migration **tersine çevrilebilir up/down çifti**: `migration.sql` + `down.sql`, ev usulü `-- @doctor:idempotent verified=…` başlığı. Down idempotent, dar kapsamlı, tam olarak up'ın eklediğini kaldırır, ikinci çalıştırmada no-op, operatör/kiracı verisine dokunmaz. Up pratik olduğu her yerde idempotent (`IF NOT EXISTS`, `ON CONFLICT DO NOTHING/DO UPDATE`).
- **Elle yazılan SQL yalnız snake_case `@@map` tablo adlarını kullanır**: `marketplace_addons`, `tenant_addons`, `renewal_cycles`, `checkout_intents`, `audit_logs`. PascalCase bir ad **yalnız production deploy'unda** 42P01 verir (CI `prisma db push` kullanır, migration SQL'ini hiç çalıştırmaz).
- **`i18n` jsonb literalindeki her apostrof İKİYE KATLANIR** (`to'rtta` → `to''rtta`); aynı kural `RAISE EXCEPTION` metnindeki `SKU''suna` için de geçerlidir.
- **Semt satılmaz:** katalog satırı YOK, fiyat YOK. `PLATFORM_AVAILABILITY[SEMT] = "coming_soon"` ve üç katman fail-closed (DTO / fabrika / simülatör).
- **Fabrika kapısı `platform in PLATFORM_AVAILABILITY` ile daraltılır.** Koşulsuz `!isPlatformAvailable(platform)` yazılırsa `adapter-factory.spec.ts:49-59`'daki iki mevcut test (`"Unknown delivery platform: DOORDASH"`, `"Unknown delivery platform: "`) kırılır.
- **Lisans fiyatı ₺4.900 (490.000 kuruş) ve DOĞRUDUR** — bu değişiklik lisansa dair hiçbir sayıya dokunmaz. Görev brifinglerinde geçen "₺2.990 / 299_000" bayattır.
- Kullanıcıya görünen her yeni metin **beş dile** (`tr`, `en`, `ru`, `ar`, `uz`) **gerçek çeviriyle** eklenir. Türkçe `defaultValue` parity'yi geçirir ama dört dile Türkçe gösterir — bu repoda daha önce yaşandı.
- **Backend testi:** `cd /home/tarik/Projects/kds/backend && npx jest <path>`. **Lint doğrulaması `npm run lint:ci`** — `npm run lint` `--fix` uygular ve hatayı gizler. Tipler: `cd backend && npx tsc --noEmit`.
- **Frontend testi:** `cd /home/tarik/Projects/kds/frontend && npx vitest run <path>`. Tipler: `cd frontend && npx tsc --noEmit -p tsconfig.json`.
- **Repo kökünden kapılar:** `node scripts/check-i18n-parity.mjs`, `node scripts/check-i18n-value-drift.mjs --gate-new scripts/i18n-value-drift-baseline.json`, `node scripts/check-contract-drift.mjs`.
- Boru hattı kullanırken **`set -o pipefail`** — yoksa `$?` `tail`'in kodudur.
- **Merge sırası: BU PR → kartlı vardiya → 3D baskı.** `alacarte-catalog-migration.spec.ts` katlama mekanizmasının ve `introduced` hesabının **tek biçimi** bu PR'da belirlenir; kartlı vardiya yalnız `FOLLOW_UP_SQL`'e damga sırasına göre bir satır ekler, hesabı yeniden yazmaz. 3D baskı bu dosyaya hiç dokunmaz.
- `FOLLOW_UP_SQL` girdilerine **asla indeksle** erişilmez (`FOLLOW_UP_SQL[1]` bir sonraki eklemede başka bir migration'ı gösterir); dosyalar **ada göre** aranır.
- Ortak doküman yüzeylerinde (`docs/SISTEM_TANITIMI.md`, `docs/PAZARLAMACI_REHBERI.md`, `help/pages/{tr,en}/marketplace/products.mdx`) **tabloları/bölümleri bütünüyle yeniden üretmek YASAK** — yalnız bu planda adı geçen satırlar düzenlenir.
- **DOKUNULMAYACAKLAR:** `backend/prisma/seed-demo.ts:1711-1718` (`platforms = ["YEMEKSEPETI","GETIR","TRENDYOL","MIGROS"]`) — demo config üretir, adaptörü olmayan SEMT **eklenmez**. `backend/src/modules/marketplace/catalog-validation.ts:242-250` sıfır-fiyat doğrulayıcısı — Semt'in katalog satırı olmadığı için gerek yok. `dto/update-platform-config.dto.ts` — platformu yol parametresinden alır. `backend/src/modules/entitlements/entitlement-keys.const.ts` — `deliveryIntegration` ve `delivery` **zaten var**, yeni anahtar eklenmiyor (§3 C1), yani 14 noktalı feature-flag senkronu bu değişiklikte uygulanmaz.

---

## File Structure

**Yeni**

| Dosya | Sorumluluk |
|---|---|
| `backend/prisma/migrations/20260820140000_delivery_platforms_bundle/migration.sql` | Uçuş-öncesi kilit + paket satırı + arşivleme + mülkiyet geçişi + açık yenileme döngüsü temizliği (up). |
| `backend/prisma/migrations/20260820140000_delivery_platforms_bundle/down.sql` | Aynı beş adımın damgadan geri sarımı (down). |
| `backend/src/modules/marketplace/delivery-bundle.spec.ts` | Paketin vendor id'leri ile `AVAILABLE_DELIVERY_PLATFORMS` arasındaki köprüyü pinler; Semt'in satılmadığını kanıtlar. |
| `frontend/src/components/delivery-platforms/platformDisplay.test.ts` | Semt marka rengi + `coming_soon` platformun POS filtre çiplerinden elenmesi. |
| `frontend/src/features/licensing/CatalogStore.semt.test.tsx` | Mağazadaki satın alınamaz Semt kartı (dolu katalog + boş katalog dalı). |

**Değişen (ana)**

| Dosya | Değişiklik |
|---|---|
| `backend/src/modules/marketplace/alacarte-catalog.const.ts` | 364-412 map bloğu → tek `delivery_platforms` nesnesi; `RETIRED_ADDON_CODES` (759-765) üç kodla genişler. |
| `backend/src/modules/marketplace/catalog-validation.spec.ts` | 256-265 teslimat invaryantı yeniden yazılır (tek satır, dört vendor, 249_900). |
| `backend/src/modules/marketplace/alacarte-catalog-migration.spec.ts` | `FOLLOW_UP_SQL`'e damga sırasına göre giriş; katlama INSERT'leri kapsar; `introduced` taban migration'ın `parsed` çıktısından hesaplanır; sekiz yeni tripwire. |
| `backend/src/modules/delivery-platforms/constants/platform.enum.ts` | `SEMT`, `PlatformAvailability`, `PLATFORM_AVAILABILITY`, `AVAILABLE_DELIVERY_PLATFORMS`, `isPlatformAvailable`. |
| `backend/src/modules/delivery-platforms/adapters/adapter-factory.ts` | `getAdapter` başına erişilebilirlik kapısı (503, yalnız sözlükte tanımlı platformlar için). |
| `backend/src/modules/delivery-platforms/dto/create-platform-config.dto.ts` | `@IsEnum(DeliveryPlatform)` → `@IsIn(AVAILABLE_DELIVERY_PLATFORMS)`. |
| `backend/src/modules/delivery-platforms/services/delivery-test.service.ts` | Simülatör doğrulaması `AVAILABLE_DELIVERY_PLATFORMS` üzerinden. |
| `backend/prisma/schema.prisma` | 3032 / 3099 / 3141 `platform String` yorumlarına `SEMT (coming_soon…)` — **şema değişikliği değil**. |
| `frontend/src/types/index.ts` | `DeliveryPlatform.SEMT` + aynalanmış `PLATFORM_AVAILABILITY`; 674'teki `source?:` yorumu. |
| `scripts/check-contract-drift.mjs` | `CHECKS`'e `DeliveryPlatform` girişi — bugün hiç guard yok. |
| `frontend/src/components/delivery-platforms/platformDisplay.ts` | `PLATFORM_DISPLAY.SEMT` + `ORDERABLE_PLATFORM_KEYS`. |
| `frontend/src/components/pos/PendingOrdersPanel.tsx` | `PLATFORM_FILTERS` `ORDERABLE_PLATFORM_KEYS`'ten türer. |
| `frontend/src/pages/settings/DeliveryPlatformsSettingsPage.tsx` | `ALL_PLATFORMS`'a `'SEMT'` (en sonda). |
| `frontend/src/components/delivery-platforms/PlatformCard.tsx` | `PLATFORM_INFO.SEMT`, `comingSoon` dalı, üç handler guard'ı, `data-availability`. |
| `frontend/src/features/licensing/CatalogStore.tsx` | Yerel `SemtComingSoonRow`; `integration` bölümünün ilk `<li>`'si **ve** `grouped.size === 0` erken dönüşü. |
| `frontend/src/i18n/locales/{tr,en,ru,ar,uz}/settings.json` | `onlineOrders.platformDescriptions.SEMT`, `onlineOrders.availability.{comingSoon,comingSoonNote}`. |
| `frontend/src/i18n/locales/{tr,en,ru,ar,uz}/licensing.json` | `store.semt.{title,description,badge}`. |
| `frontend/src/marketing/data/{faq.ts,integrations.ts,modules.ts,moduleContent.generated.ts}` · `frontend/src/pages/LandingPage.tsx` · `frontend/src/App.tsx` | "her platform ayrı satılır" iddialarının tek pakete çevrilmesi + Semt "yakında". |
| `docs/PAZARLAMACI_REHBERI.md` · `docs/SISTEM_TANITIMI.md` · `presentation/HummyTummy_Presentation_{TR,EN}.md` · `landing/**` | Fiyat ve toplam düzeltmeleri (D1-D5). |
| `developer/pages/{tr,en}/**` · `help/pages/{tr,en}/**` | 4 + 18 portal yüzeyi (D6-D7). |
| `backend/SUBSCRIPTION_SYSTEM.md` · `docs/api/hummytummy-v1.md` · `backend/src/modules/entitlements/integration-coverage.ts` · `backend/src/modules/delivery-platforms/controllers/delivery-platforms.controller.ts` · `backend/prisma/seeds/seed-marketplace.ts` | Üç kod adı geçen kod-içi ve backend doküman yorumları. |
| `backend/test/licensing.e2e-spec.ts` | Paketin dört vendor'ü açtığını ve SEMT config'inin 400 aldığını gerçek DB üzerinde kanıtlayan senaryo. |

---

## Görev 1: Katalog satırı — üç SKU tek `delivery_platforms` paketine

**Files:**
- Modify: `backend/src/modules/marketplace/alacarte-catalog.const.ts` (satır 364-412 map bloğu; satır 759-765 `RETIRED_ADDON_CODES`)
- Modify: `backend/src/modules/marketplace/catalog-validation.spec.ts` (satır 256-265)
- Modify: `backend/prisma/seeds/seed-marketplace.ts` (satır 992-995 yorum)
- Modify: `backend/src/modules/entitlements/integration-coverage.ts` (satır 11-12)
- Modify: `backend/src/modules/delivery-platforms/controllers/delivery-platforms.controller.ts` (satır 28-35)
- Modify: `backend/SUBSCRIPTION_SYSTEM.md` (satır 104)
- Modify: `docs/api/hummytummy-v1.md` (satır 157-158)
- Test: `backend/src/modules/marketplace/catalog-validation.spec.ts`, `backend/src/modules/device-mesh/kds-tablet-limit.spec.ts`

**Interfaces:**
- Consumes: yok (ilk görev). Mevcut tipler: `AlaCarteProduct` (`alacarte-catalog.const.ts:22-43`), yardımcı `t(tr, en, ru, ar, uz)` (satır 45-57) — her argüman `[name, description]` ikilisi.
- Produces (sonraki görevler bunlara dayanır):
  - `ALACARTE_CATALOG` içinde `code: "delivery_platforms"`, `name: "Paket Servis Entegrasyonları"`, `kind: "integration"`, `billing: "annual"`, `priceCents: 249_900`, `requiresLicense: true`, `deps: []`, `sortOrder: 20`
  - `grants["integration.delivery"] = ["yemeksepeti", "getir", "trendyol_yemek", "migros"]` (bu sırayla), `grants["feature.deliveryIntegration"] = true`
  - `RETIRED_ADDON_CODES` artık `"delivery_yemeksepeti" | "delivery_getir" | "delivery_trendyol_yemek"` de içerir
  - Beş locale `name`/`description` metinleri — **Görev 2'nin migration `i18n` jsonb literali bu metinlerin birebir aynısını taşır.**

- [ ] **Adım 1: Teslimat invaryantını başarısız testle yeniden yaz**

`backend/src/modules/marketplace/catalog-validation.spec.ts` satır 256-265'teki `it("lights up the delivery feature flag on every delivery platform", …)` bloğunu **tamamen** şununla değiştir:

```ts
  it("ships exactly one delivery product covering all four platforms", () => {
    // Per-platform pricing was fiction: the route gate is domain-wide
    // (@RequiresIntegration("delivery") with no provider), so buying ANY one
    // platform already unlocked all four. One honest ₺2.499 line replaces it.
    const delivery = ALACARTE_CATALOG.filter((p) =>
      p.code.startsWith("delivery_"),
    );
    expect(delivery.map((p) => p.code)).toEqual(["delivery_platforms"]);
    const bundle = delivery[0];
    expect(bundle.grants["feature.deliveryIntegration"]).toBe(true);
    expect(bundle.grants["integration.delivery"]).toEqual([
      "yemeksepeti",
      "getir",
      "trendyol_yemek",
      "migros",
    ]);
    expect(bundle.priceCents).toBe(249_900);
  });
```

- [ ] **Adım 2: Testi çalıştır ve kırmızıyı gör**

Çalıştır: `cd /home/tarik/Projects/kds/backend && npx jest src/modules/marketplace/catalog-validation.spec.ts`

Beklenen: FAIL — `● the shipped à-la-carte catalog › ships exactly one delivery product covering all four platforms`,
`Expected: ["delivery_platforms"]` / `Received: ["delivery_yemeksepeti", "delivery_getir", "delivery_trendyol_yemek"]`.

- [ ] **Adım 3: Katalog satırını yaz**

`backend/src/modules/marketplace/alacarte-catalog.const.ts` satır 364-412 arasındaki `...([...] as const).map(...)` bloğunun **tamamını** sil ve yerine şunu koy (`// --------- INTEGRATIONS` yorum satırı yerinde kalır):

```ts
  {
    code: "delivery_platforms",
    name: "Paket Servis Entegrasyonları",
    description:
      "Yemeksepeti, Getir, Trendyol Yemek ve Migros Yemek siparişlerinin otomatik olarak POS ve mutfağa düşmesi.",
    kind: "integration",
    billing: "annual",
    // Selling ₺2.490 PER PLATFORM was fiction: the delivery route gate is
    // domain-wide (@RequiresIntegration("delivery") on the controller class,
    // carrying no provider), so a tenant who bought one platform could already
    // use all four. One package is the honest shape — and it now includes
    // Migros, whose adapter has shipped and worked all along without ever
    // having a SKU.
    priceCents: 249_900,
    grants: {
      "integration.delivery": [
        "yemeksepeti",
        "getir",
        "trendyol_yemek",
        "migros",
      ],
      "feature.deliveryIntegration": true,
    },
    deps: [],
    requiresLicense: true,
    sortOrder: 20,
    i18n: t(
      [
        "Paket Servis Entegrasyonları",
        "Yemeksepeti, Getir, Trendyol Yemek ve Migros Yemek siparişleri otomatik olarak POS ve mutfağa düşer. Tek pakette dört platform.",
      ],
      [
        "Delivery Platform Integrations",
        "Yemeksepeti, Getir, Trendyol Yemek and Migros Yemek orders flow automatically into the POS and the kitchen. Four platforms in one package.",
      ],
      [
        "Интеграции служб доставки",
        "Заказы Yemeksepeti, Getir, Trendyol Yemek и Migros Yemek автоматически поступают в POS и на кухню. Четыре платформы в одном пакете.",
      ],
      [
        "تكاملات منصات التوصيل",
        "تصل طلبات Yemeksepeti وGetir وTrendyol Yemek وMigros Yemek تلقائيًا إلى نقطة البيع والمطبخ. أربع منصات في باقة واحدة.",
      ],
      [
        "Yetkazib berish platformalari integratsiyasi",
        "Yemeksepeti, Getir, Trendyol Yemek va Migros Yemek buyurtmalari avtomatik ravishda POS va oshxonaga tushadi. Bitta paketda to'rtta platforma.",
      ],
    ),
  },
```

- [ ] **Adım 4: Testi çalıştır ve yeşili gör**

Çalıştır: `cd /home/tarik/Projects/kds/backend && npx jest src/modules/marketplace/catalog-validation.spec.ts`

Beklenen: PASS. Aynı dosyadaki dört regresyon nöbetçisi de yeşil kalmalı: `"has unique codes and unique sort orders"` (sortOrder 20 artık tekil, 21/22 boşaldı), `"carries copy in all five supported locales"`, `"prices every annual product above the PayTR minimum"`, `"every product satisfies the catalog invariants"`.

- [ ] **Adım 5: `RETIRED_ADDON_CODES`'u üç kodla genişlet**

`backend/src/modules/marketplace/alacarte-catalog.const.ts` satır 759-765'teki diziyi şununla değiştir:

```ts
export const RETIRED_ADDON_CODES = [
  "kds_extra_screen",
  "kds_extra_station",
  "extra_tablet",
  "priority_support",
  "fiscal_efatura",
  // v3.6.8: the three per-platform delivery SKUs folded into the single
  // `delivery_platforms` package. ARCHIVED, never deleted — `code` is not
  // reusable and TenantAddOn.addOnId is onDelete: Restrict. The projector
  // reads TenantAddOn without consulting the catalog row's status, so an
  // existing owner keeps the grant mid-cycle; the migration additionally
  // MOVES ownership onto the package row so the renewal invoice does not
  // silently lose the line at the anniversary.
  "delivery_yemeksepeti",
  "delivery_getir",
  "delivery_trendyol_yemek",
] as const;
```

- [ ] **Adım 6: Emeklilik nöbetçilerini çalıştır**

Çalıştır: `cd /home/tarik/Projects/kds/backend && npx jest src/modules/marketplace/catalog-validation.spec.ts src/modules/device-mesh/kds-tablet-limit.spec.ts`

Beklenen: PASS. `"does not resurrect a retired code"` üç yeni kodun katalogda **olmadığını**, `kds-tablet-limit.spec.ts:29-37` ise `ADDONS` (= `ALACARTE_CATALOG`) içinde bulunmadığını doğrular.

- [ ] **Adım 7: İlk yeşil noktayı commit'le**

```bash
cd /home/tarik/Projects/kds
git add backend/src/modules/marketplace/alacarte-catalog.const.ts \
        backend/src/modules/marketplace/catalog-validation.spec.ts
git commit -m "feat(delivery): üç teslimat SKU'su tek 2.499 TL'lik pakete indi"
```

- [ ] **Adım 8: Seed yorumunu güncelle**

`backend/prisma/seeds/seed-marketplace.ts` satır 992-995'teki yorumu (kod **değişmez**; `RETIRED_ADDON_CODES` + `ALACARTE_CATALOG` üzerinden otomatik doğru davranır) şununla değiştir:

```ts
  // Retire every code in RETIRED_ADDON_CODES. ARCHIVED, never deleted:
  // `code` is not reusable and TenantAddOn.addOnId is onDelete: Restrict.
  // The list started as the pre-3.3 device-capacity products (they granted
  // limit.kdsScreens / limit.kdsStations / limit.tablets, keys no enforcement
  // code has ever read); v3.6.7 added priority_support + fiscal_efatura when
  // they folded into the licence, and v3.6.8 added the three per-platform
  // delivery SKUs when they folded into `delivery_platforms`.
```

- [ ] **Adım 9: `integration-coverage.ts` yorumundaki üç kodu düzelt**

`backend/src/modules/entitlements/integration-coverage.ts` satır 11-12'de geçen üç kod adını tek pakete çevir. Mevcut iki satır:

```ts
 * Meanwhile the delivery add-ons (`delivery_yemeksepeti` / `delivery_getir` /
 * `delivery_trendyol_yemek`) grant `integration.delivery: [<vendor>]`. Two
```

şununla değişir:

```ts
 * Meanwhile the delivery package (`delivery_platforms`, v3.6.8 — it replaced
 * the three per-platform SKUs) grants
 * `integration.delivery: ["yemeksepeti","getir","trendyol_yemek","migros"]`. Two
```

- [ ] **Adım 10: Controller'ın DEF-3 yorumundaki üç kodu düzelt**

`backend/src/modules/delivery-platforms/controllers/delivery-platforms.controller.ts` satır 33-34'teki

```ts
// INTEGRATION_COVERED_BY_FEATURE) — so a BASIC tenant who buys
// delivery_yemeksepeti/getir/trendyol_yemek actually unlocks this
```

şununla değişir (kapı davranışı **aynı**, yalnız kod adı değişti):

```ts
// INTEGRATION_COVERED_BY_FEATURE) — so a BASIC tenant who buys
// delivery_platforms actually unlocks this
```

- [ ] **Adım 11: `SUBSCRIPTION_SYSTEM.md` katalog tablosunu düzelt**

`backend/SUBSCRIPTION_SYSTEM.md` satır 104'teki `integration` satırını şununla değiştir (paralel v3.6.7 işiyle uyumlu: `fiscal_efatura` artık arşivli, listede yer almaz):

```md
| `integration` | `delivery_platforms` (v3.6.8: üç `delivery_*` SKU'sunun yerini aldı), `fiscal_hugin`, `caller_id_integration`, `sms_integration` |
```

- [ ] **Adım 12: `docs/api/hummytummy-v1.md` grant örneğini düzelt**

`docs/api/hummytummy-v1.md` satır 157-158'deki

```json
{ "integration.delivery": ["yemeksepeti"],
  "feature.deliveryIntegration": true }                       // delivery_yemeksepeti (integration)
```

şununla değişir:

```json
{ "integration.delivery": ["yemeksepeti","getir","trendyol_yemek","migros"],
  "feature.deliveryIntegration": true }                       // delivery_platforms (integration)
```

- [ ] **Adım 13: Drift tripwire'ının kırmızıya döndüğünü GÖR — bu Görev 2'nin başarısız testidir**

Çalıştır: `cd /home/tarik/Projects/kds/backend && npx jest src/modules/marketplace/alacarte-catalog-migration.spec.ts`

Beklenen: FAIL, **2 test**:
1. `● à-la-carte catalog migration › upserts exactly the products in the catalog constant` — bileşik migration hâlâ üç eski kodu satıyor, sabit ise `delivery_platforms` diyor.
2. `● à-la-carte catalog migration › carries the same kind, billing and PRICE as the constant` — `TypeError: Cannot read properties of undefined (reading 'code')`, çünkü `ALACARTE_CATALOG_BY_CODE.get("delivery_yemeksepeti")` artık `undefined`.

**Bu kırmızı bilinçlidir ve Görev 2'nin giriş koşuludur.** "Testi düzeltmek" YASAK: uygulanmış migration'ı düzenlemek `prisma migrate deploy` checksum'unu kırar. Görev 2 yeni bir takip migration'ı yazar ve katlamayı genişletir.

- [ ] **Adım 14: Tip ve lint kapılarını geç, commit'le**

```bash
cd /home/tarik/Projects/kds/backend && npx tsc --noEmit && npm run lint:ci
cd /home/tarik/Projects/kds
git add backend/prisma/seeds/seed-marketplace.ts \
        backend/src/modules/entitlements/integration-coverage.ts \
        backend/src/modules/delivery-platforms/controllers/delivery-platforms.controller.ts \
        backend/SUBSCRIPTION_SYSTEM.md \
        docs/api/hummytummy-v1.md
git commit -m "docs(delivery): kod-içi ve backend dokümanlarında üç SKU adını tek pakete çevir"
```

---

## Görev 2: `20260820140000_delivery_platforms_bundle` migration'ı ve drift tripwire'ı

**Files:**
- Modify: `backend/src/modules/marketplace/alacarte-catalog-migration.spec.ts` (satır 42-44 `FOLLOW_UP_SQL`; satır 129-140 `parsed`/`effective` bloğu; satır 254-282 `introduced`; dosya sonuna sekiz yeni test)
- Create: `backend/prisma/migrations/20260820140000_delivery_platforms_bundle/migration.sql`
- Create: `backend/prisma/migrations/20260820140000_delivery_platforms_bundle/down.sql`
- Test: `backend/src/modules/marketplace/alacarte-catalog-migration.spec.ts`

**Interfaces:**
- Consumes (Görev 1): `delivery_platforms` kodu, `priceCents: 249_900`, dört vendor'lük `grants`, `sortOrder: 20`, beş locale metinleri, genişletilmiş `RETIRED_ADDON_CODES`.
- Consumes (mevcut spec dosyası): `executableSql(sql: string): string`, `parseUpserts(sql: string): ParsedRow[]`, `updateStatements(sql: string): string[]`, `parseRepricing(sql: string): Map<string, number>`, `parseArchived(sql: string): string[]`, `interface ParsedRow { code: string; kind: string; billing: string; priceCents: number; status: string; requiresLicense: boolean }`.
- Produces (Görev 3 ve kartlı-vardiya PR'ı bunlara dayanır):
  - `const FOLLOW_UP_SQL: string[]` — **damga sırasına göre sıralı** mutlak yollar
  - `const BUNDLE_UP: string`, `const BUNDLE_DOWN: string` — ada göre çözülmüş yollar
  - `const insertedLater: ParsedRow[]` = `followUps.flatMap(parseUpserts)`
  - `const effective` = `[...parsed, ...insertedLater]` üzerinden hesaplanır
  - `const introduced: string[]` = **taban migration'ın `parsed` çıktısından** hesaplanır (kartlı vardiya bunu birebir kullanır, yeniden yazmaz)
  - Migration klasörü `20260820140000_delivery_platforms_bundle` ve içindeki `migration.sql` + `down.sql`

- [ ] **Adım 1: `FOLLOW_UP_SQL`'e damga sırasına göre gir ve dosyaları ada göre çöz**

`alacarte-catalog-migration.spec.ts` satır 42-44'ü şununla değiştir:

```ts
const FOLLOW_UP_SQL = [
  // ALWAYS ordered by migration folder stamp. Insert, never append: the fold
  // lets a later row overwrite an earlier one, so an out-of-order entry makes
  // the composed state disagree with what `prisma migrate deploy` produces.
  "20260820120000_reprice_licence_and_stock/migration.sql",
  "20260820140000_delivery_platforms_bundle/migration.sql",
].map((rel) => join(__dirname, "../../../prisma/migrations", rel));

// Addressed BY NAME, never by index. `FOLLOW_UP_SQL[1]` points at a different
// migration the moment someone inserts one above it, and the assertions below
// would then silently verify the wrong file.
const BUNDLE_UP = FOLLOW_UP_SQL.find((f) =>
  f.includes("delivery_platforms_bundle"),
)!;
const BUNDLE_DOWN = BUNDLE_UP.replace("migration.sql", "down.sql");
```

- [ ] **Adım 2: Katlamayı INSERT'leri kapsayacak şekilde genişlet**

Aynı dosyada satır 137-140'taki `effective` bloğunu şununla değiştir:

```ts
  // Codes a follow-up migration INSERTS (not just reprices/archives). Before
  // v3.6.8 every catalog row was born in the base migration, so the fold only
  // needed reprice + archive; `delivery_platforms` is the first row introduced
  // by a follow-up.
  const insertedLater = followUps.flatMap(parseUpserts);

  /** What a fully migrated database actually holds, as sellable rows. */
  const effective = [...parsed, ...insertedLater]
    .filter((r) => !archivedLater.has(r.code))
    .map((r) => ({ ...r, priceCents: reprices.get(r.code) ?? r.priceCents }));
```

- [ ] **Adım 3: `introduced` hesabını taban migration'ın kendi INSERT'lerine sabitle**

**Bu tek biçim bağlayıcıdır — kartlı vardiya PR'ı (Change 2) aynı hesabı birebir kullanır ve yeniden yazmaz; 3D baskı PR'ı (Change 3) bu dosyaya hiç dokunmaz.**

Satır 271-273'teki

```ts
    const introduced = ALACARTE_CATALOG.map((p) => p.code)
      .filter((c) => !preExisting.has(c))
      .sort();
```

şununla değişir:

```ts
    // The codes the BASE migration actually created. Deriving them from the
    // catalog constant is wrong: every code a FOLLOW-UP migration inserts
    // (delivery_platforms today, the card-shift row next) would join this list
    // and then be looked for in P1's down — which never created it, so it can
    // never delete it. `parsed` is the base file's own INSERTs.
    const introduced = parsed
      .map((r) => r.code)
      .filter((c) => !preExisting.has(c))
      .sort();
```

- [ ] **Adım 4: Sekiz yeni tripwire'ı dosyanın sonuna ekle**

`describe("à-la-carte catalog migration", …)` bloğunun **içinde**, son `it(...)`'in ardına ekle:

```ts
  it("keeps every follow-up migration on snake_case table names", () => {
    // A hand-written migration that says "TenantAddOn" takes 42P01 in
    // production and passes every test that runs against a db-push database.
    for (const f of followUps) {
      expect(executableSql(f)).not.toMatch(
        /"MarketplaceAddOn"|"TenantAddOn"|"Tenant"|"RenewalCycle"|"CheckoutIntent"|"AuditLog"/,
      );
    }
  });

  it("moves delivery ownership instead of stranding it at renewal", () => {
    // Archiving alone keeps the grant (the projector never reads the catalog
    // row's status) but silently drops the line from the renewal invoice:
    // RenewalCycleService builds the cart from owned codes, QuoteService drops
    // an unpublished row with "addon_not_purchasable", the sweeper expires the
    // ownership row, and addon-purchasability then BLOCKS buying the package
    // with ADDON_ALREADY_GRANTED. So ownership has to move.
    const exec = executableSql(readFileSync(BUNDLE_UP, "utf8"));
    expect(exec).toMatch(/UPDATE "tenant_addons"[\s\S]*SET "addOnId"/);
    expect(exec).toContain("'migratedFrom'");
    expect(exec).toMatch(/DELETE FROM "renewal_cycles"[\s\S]*'open'/);
  });

  it("guards the bundle up against in-flight checkout intents", () => {
    // A paid-but-unprovisioned intent names an archived SKU; settlement
    // re-quotes, the row drops out, the 1-kuruş tolerance blows and provision
    // is REFUSED with the card already charged (checkout.service.ts:233-243).
    // There is no automatic refund rail, so the migration must refuse to run.
    const exec = executableSql(readFileSync(BUNDLE_UP, "utf8"));
    expect(exec).toMatch(/"checkout_intents"[\s\S]*RAISE EXCEPTION/);
  });

  it("only deletes renewal cycles the 06:00 generator can rebuild", () => {
    // nextAnniversary() (anniversary.ts:114-121) jumps to NEXT year once today
    // >= the anniversary, so deleting an already-due open cycle destroys both
    // the invoice and the only trigger lapseUnpaidCycles has.
    const exec = executableSql(readFileSync(BUNDLE_UP, "utf8"));
    const del = exec.slice(exec.indexOf('DELETE FROM "renewal_cycles"'));
    expect(del).toMatch(/"anniversaryAt"\s*>\s*NOW\(\)/);
  });

  it("never deletes a marketplace_addons row from the bundle up", () => {
    expect(executableSql(readFileSync(BUNDLE_UP, "utf8"))).not.toMatch(
      /DELETE FROM "marketplace_addons"/,
    );
  });

  it("guards the bundle down's delete with a tenant_addons NOT EXISTS", () => {
    const down = executableSql(readFileSync(BUNDLE_DOWN, "utf8"));
    expect(down).toMatch(
      /DELETE FROM "marketplace_addons"[\s\S]*NOT EXISTS[\s\S]*"tenant_addons"/,
    );
  });

  it("restores the archived catalog rows to their stamped prior status", () => {
    // The down must NOT write 'published' unconditionally: the up only
    // archives rows that WERE published, so a row an operator archived before
    // the migration must not come back on sale. The stamp lives in audit_logs
    // because marketplace_addons has no free-form meta column.
    const up = executableSql(readFileSync(BUNDLE_UP, "utf8"));
    const down = executableSql(readFileSync(BUNDLE_DOWN, "utf8"));
    expect(up).toMatch(/INSERT INTO "audit_logs"[\s\S]*migratedPriorStatus/);
    expect(down).toContain("migratedPriorStatus");
    expect(down).not.toMatch(/SET "status" = 'published'/);
  });

  it("restores the dedupe timestamps instead of nulling them", () => {
    // A faithful inverse writes the pre-migration cancelledAt/endedAt back
    // from the stamp. The negative lookahead matters: NULLIF(...) legitimately
    // starts with NULL, and a bare /= NULL/ would flag the correct code.
    const down = executableSql(readFileSync(BUNDLE_DOWN, "utf8"));
    expect(down).toContain("migratedPriorCancelledAt");
    expect(down).toContain("migratedPriorEndedAt");
    expect(down).not.toMatch(/"cancelledAt"\s*=\s*NULL(?![A-Z])/);
  });
```

- [ ] **Adım 5: Testi çalıştır — dosya yokluğundan patlamalı**

Çalıştır: `cd /home/tarik/Projects/kds/backend && npx jest src/modules/marketplace/alacarte-catalog-migration.spec.ts`

Beklenen: FAIL — suite hiç başlamadan `ENOENT: no such file or directory, open '…/prisma/migrations/20260820140000_delivery_platforms_bundle/migration.sql'` (dosya `describe` gövdesinde `readFileSync(p, "utf8")` ile okunuyor).

- [ ] **Adım 6: `migration.sql`'in başlığını, uçuş-öncesi kilidini ve paket satırını yaz**

`backend/prisma/migrations/20260820140000_delivery_platforms_bundle/migration.sql` oluştur:

```sql
-- @doctor:idempotent verified=a read-only pre-flight guard (statement 0, writes nothing), one INSERT ... ON CONFLICT (code) DO UPDATE (status excluded), one NOT EXISTS-guarded prior-status stamp into audit_logs (statement 2a, written once per addon row), one status-guarded UPDATE on marketplace_addons, and ownership moves on tenant_addons guarded by the pre-move addOnId plus a NOT EXISTS bundle check so a second run matches nothing. Deletes only OPEN, UNPAID renewal_cycles whose anniversaryAt is still in the FUTURE — exactly the set the 06:00 UTC generator recreates.
--
-- Paket servis: üç SKU -> tek paket.
--
-- Teslimat kapısı ALAN-GENELİ: delivery-platforms.controller.ts sınıf
-- seviyesinde @RequiresIntegration("delivery") taşıyor ve sağlayıcı adı
-- YOK (delivery-gate.spec.ts bunu pinliyor). Yani tek platform satın alan
-- kiracı dördünü de kullanabiliyordu; platform başına ₺2.490 kurguydu.
-- ₺2.499'luk tek paket satılanı gerçekte teslim edilenle hizalar.
--
-- MÜLKİYET NEDEN TAŞINIYOR
-- Arşivlemek grant'i kaldırmaz (projektör TenantAddOn'u katalog satırının
-- status'una bakmadan okur), ama yenileme sepetini SESSİZCE eksiltir:
-- RenewalCycleService sahip olunan kodları QuoteService'e verir, QuoteService
-- yayımlanmamış satırı "addon_not_purchasable" uyarısıyla düşürür. Fatura
-- teslimat kalemi olmadan çıkar, sweeper satırı past_due -> expired yapar ve
-- müşteri ödediği şeyi kaybeder. Bu yüzden sahiplik yeni pakete taşınır.
--
-- Tablo adları snake_case @@map adlarıdır — "marketplace_addons" /
-- "tenant_addons" / "renewal_cycles"; PascalCase bir ad yalnızca production
-- deploy'unda 42P01 verir (CI `prisma db push` kullanır, migration SQL'ini
-- hiç çalıştırmaz).

-- ---------------------------------------------------------------------------
-- 0. UÇUŞ-ÖNCESİ KİLİT. Emekliye ayrılan bir SKU'yu adlandıran, ödenmiş ama
--    provision edilmemiş (ya da hâlâ ödenebilir) bir checkout intent varken
--    ÇALIŞMAYI REDDET. Sepet intent anında donuyor
--    (checkout-intent.service.ts:283) ve TTL 48 saat (:53); settlement
--    katalogu YENİDEN okuyor (checkout.service.ts:193, 221-223), arşivli satır
--    quote.service.ts:81-85'te sessizce düşüyor, 1 kuruş toleransı aşılıyor
--    (:233-243) ve PayTR tahsilatı yapılmışken provision REDDEDİLİYOR.
--    Otomatik iade rayı YOK.
-- ---------------------------------------------------------------------------
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n
    FROM "checkout_intents" ci
   WHERE ci."status" IN ('pending', 'succeeded')
     AND ci."provisionedAt" IS NULL
     AND (ci."expiresAt" IS NULL OR ci."expiresAt" > NOW())
     AND EXISTS (
           SELECT 1
             FROM jsonb_array_elements(ci."cartJson" -> 'items') AS it
            WHERE it ->> 'code' IN ('delivery_yemeksepeti', 'delivery_getir', 'delivery_trendyol_yemek')
         );
  IF n > 0 THEN
    RAISE EXCEPTION 'ABORT: % adet uçuşta checkout intent emekliye ayrılan bir teslimat SKU''suna referans veriyor. Hepsi settle olduktan veya süresi dolduktan sonra tekrar çalıştır (INTENT_TTL_HOURS=48).', n;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. Paket satırı. status DO UPDATE listesinde DEĞİL: bir operatör satırı
--    arşivlediyse yeniden çalıştırma onu geri yayımlamamalı.
-- ---------------------------------------------------------------------------
INSERT INTO "marketplace_addons" (
  "id", "code", "name", "description", "kind", "billing", "priceCents",
  "currency", "grants", "deps", "status", "requiresLicense", "creditKind",
  "creditUnits", "maxQuantity", "sortOrder", "i18n", "commissionRate",
  "createdAt", "updatedAt"
) VALUES (
  gen_random_uuid()::text, 'delivery_platforms', 'Paket Servis Entegrasyonları', 'Yemeksepeti, Getir, Trendyol Yemek ve Migros Yemek siparişlerinin otomatik olarak POS ve mutfağa düşmesi.',
  'integration', 'annual', 249900, 'TRY',
  '{"integration.delivery":["yemeksepeti","getir","trendyol_yemek","migros"],"feature.deliveryIntegration":true}'::jsonb, ARRAY[]::TEXT[], 'published', true,
  NULL, NULL,
  NULL, 20,
  '{"tr":{"name":"Paket Servis Entegrasyonları","description":"Yemeksepeti, Getir, Trendyol Yemek ve Migros Yemek siparişleri otomatik olarak POS ve mutfağa düşer. Tek pakette dört platform."},"en":{"name":"Delivery Platform Integrations","description":"Yemeksepeti, Getir, Trendyol Yemek and Migros Yemek orders flow automatically into the POS and the kitchen. Four platforms in one package."},"ru":{"name":"Интеграции служб доставки","description":"Заказы Yemeksepeti, Getir, Trendyol Yemek и Migros Yemek автоматически поступают в POS и на кухню. Четыре платформы в одном пакете."},"ar":{"name":"تكاملات منصات التوصيل","description":"تصل طلبات Yemeksepeti وGetir وTrendyol Yemek وMigros Yemek تلقائيًا إلى نقطة البيع والمطبخ. أربع منصات في باقة واحدة."},"uz":{"name":"Yetkazib berish platformalari integratsiyasi","description":"Yemeksepeti, Getir, Trendyol Yemek va Migros Yemek buyurtmalari avtomatik ravishda POS va oshxonaga tushadi. Bitta paketda to''rtta platforma."}}'::jsonb,
  0.10,
  NOW(), NOW()
)
ON CONFLICT ("code") DO UPDATE SET
  "name"            = EXCLUDED."name",  -- NOT: "status" bilerek YOK
  "description"     = EXCLUDED."description",
  "kind"            = EXCLUDED."kind",
  "billing"         = EXCLUDED."billing",
  "priceCents"      = EXCLUDED."priceCents",
  "grants"          = EXCLUDED."grants",
  "deps"            = EXCLUDED."deps",
  "requiresLicense" = EXCLUDED."requiresLicense",
  "creditKind"      = EXCLUDED."creditKind",
  "creditUnits"     = EXCLUDED."creditUnits",
  "maxQuantity"     = EXCLUDED."maxQuantity",
  "sortOrder"       = EXCLUDED."sortOrder",
  "i18n"            = EXCLUDED."i18n",
  "updatedAt"       = NOW();
```

⚠️ **Tek tırnak kuralı:** Özbekçe açıklamadaki `to''rtta` ve adım 0'daki `SKU''suna` **iki apostrofludur**. Tek apostrofa indirirsen deploy sözdizimi hatasıyla ölür. Emsal: `20260820120000_reprice_licence_and_stock/migration.sql:40` (`qo''llab-quvvatlash`).

⚠️ **INSERT'in şekli `parseUpserts`'ün regex'ine (satır 71-72) çakılıdır:** `gen_random_uuid()::text, '<code>', …` / yeni satırda `'<kind>', '<billing>', <price>, 'TRY',` / yeni satırda `…::jsonb, ARRAY[]::TEXT[], '<status>', <bool>,`. Satır kırılımlarını değiştirme.

- [ ] **Adım 7: Arşivleme ve statü damgasını (2a/2b) ekle**

Aynı dosyanın sonuna ekle:

```sql
-- ---------------------------------------------------------------------------
-- 2a. ARŞİVLEMEDEN ÖNCE her satırın MEVCUT statüsünü damgala.
--     Neden: 2b yalnız 'published' satırları arşivliyor, dolayısıyla down koşulsuz
--     'published' yazarsa operatörün migration'dan ÖNCE elle arşivlediği (ya da
--     'draft'ta bıraktığı) bir satırı geri yayına sokar — down sadık bir ters
--     işlem olmaktan çıkar.
--     Damga NEREYE: marketplace_addons'ta `pricingMeta` gibi serbest bir meta
--     kolonu YOK (grants ve i18n ürün verisidir, damga taşıyamaz). Bu yüzden
--     statü değişimi için zaten var olan tabloya — audit_logs — yazılır.
--     actorId bu migration'a özel bir sabittir; down yalnız o actorId'li
--     satırları okur ve siler.
-- ---------------------------------------------------------------------------
INSERT INTO "audit_logs" (
  "id", "action", "entityType", "entityId", "actorId", "actorEmail",
  "previousData", "newData", "metadata", "createdAt"
)
SELECT gen_random_uuid()::text,
       'UPDATE',
       'MARKETPLACE_ADDON',
       m."id",
       'migration:20260820140000_delivery_platforms_bundle',
       'migration@system.local',
       jsonb_build_object('migratedPriorStatus', m."status"),
       jsonb_build_object('status', 'archived'),
       jsonb_build_object('migration', '20260820140000_delivery_platforms_bundle',
                          'code', m."code"),
       NOW()
  FROM "marketplace_addons" m
 WHERE m."code" IN ('delivery_yemeksepeti', 'delivery_getir', 'delivery_trendyol_yemek')
   AND NOT EXISTS (
         SELECT 1 FROM "audit_logs" a
          WHERE a."actorId" = 'migration:20260820140000_delivery_platforms_bundle'
            AND a."entityId" = m."id"
       );

-- ---------------------------------------------------------------------------
-- 2b. Üç SKU arşivlenir. ARŞİV, ASLA SİLME: `code` yeniden kullanılamaz ve
--     TenantAddOn.addOnId onDelete: Restrict.
-- ---------------------------------------------------------------------------
UPDATE "marketplace_addons"
   SET "status" = 'archived',
       "updatedAt" = NOW()
 WHERE "status" = 'published'
   AND "code" IN ('delivery_yemeksepeti', 'delivery_getir', 'delivery_trendyol_yemek');
```

- [ ] **Adım 8: Mülkiyet geçişini (3a/3b/3c) ekle**

Aynı dosyanın sonuna ekle:

```sql
-- ---------------------------------------------------------------------------
-- 3a. Taşımadan ÖNCE kökeni damgala. addOnId üzerine yazıldığında hangi
--     platformun satıldığı bilgisi kaybolur; down.sql'in geri dönebilmesi
--     için tek kaynak budur.
-- ---------------------------------------------------------------------------
UPDATE "tenant_addons" t
   SET "pricingMeta" = COALESCE(t."pricingMeta", '{}'::jsonb)
                       || jsonb_build_object('migratedFrom', m."code")
  FROM "marketplace_addons" m
 WHERE t."addOnId" = m."id"
   AND m."code" IN ('delivery_yemeksepeti', 'delivery_getir', 'delivery_trendyol_yemek')
   AND t."status" IN ('active', 'past_due')
   AND NOT (COALESCE(t."pricingMeta", '{}'::jsonb) ? 'migratedFrom');

-- 3b. Bir kiracı birden fazla platform tutuyorsa BİRİ hariç hepsi kapatılır —
--     paket zaten dördünü de kapsıyor, iki satır iki kez faturalanır
--     (renewal-cycle.service.ts:103-122; TenantAddOn'da (tenantId,addOnId)
--     unique YOK).
--     HAYATTA KALAN = EN UZAĞA ÖDENMİŞ satır. plan-projector.service.ts:295-299
--     validUntil'i currentPeriodEnd'den türetir; "en eski aktive edilen kalsın"
--     demek, Getir'i altı ay sonra alan kiracının ÖDEDİĞİ GÜNLERİ yakmak olur.
--     Önceki status VE zaman damgaları geri alınabilsin diye pricingMeta'ya
--     yazılır — down bunları NULL'lamaz, geri yazar.
WITH old AS (
  SELECT "id" FROM "marketplace_addons"
   WHERE "code" IN ('delivery_yemeksepeti', 'delivery_getir', 'delivery_trendyol_yemek')
), ranked AS (
  SELECT ta."id",
         ta."status"      AS prior_status,
         ta."cancelledAt" AS prior_cancelled_at,
         ta."endedAt"     AS prior_ended_at,
         ROW_NUMBER() OVER (
           PARTITION BY ta."tenantId"
           ORDER BY ta."currentPeriodEnd" DESC NULLS LAST,
                    ta."activatedAt" ASC,
                    ta."id" ASC
         ) AS rn
    FROM "tenant_addons" ta
   WHERE ta."addOnId" IN (SELECT "id" FROM old)
     AND ta."status" IN ('active', 'past_due')
)
UPDATE "tenant_addons" t
   SET "status" = 'cancelled',
       "cancelledAt" = NOW(),
       "endedAt" = NOW(),
       "pricingMeta" = COALESCE(t."pricingMeta", '{}'::jsonb)
                       || jsonb_build_object(
                            'migratedPriorStatus',      r.prior_status,
                            'migratedPriorCancelledAt', to_jsonb(r.prior_cancelled_at),
                            'migratedPriorEndedAt',     to_jsonb(r.prior_ended_at)
                          )
  FROM ranked r
 WHERE t."id" = r."id"
   AND r.rn > 1;

-- 3c. Hayatta kalan satır pakete taşınır — ama kiracıda ZATEN bir paket satırı
--     varsa TAŞINMAZ. (tenantId, addOnId) unique olmadığı için ikinci bir satır
--     yenileme sepetine ikinci kez ₺2.499 yazardı; kısmi rollback / yeniden
--     çalıştırma bunu gerçekten üretir.
UPDATE "tenant_addons"
   SET "addOnId" = (SELECT "id" FROM "marketplace_addons" WHERE "code" = 'delivery_platforms')
 WHERE "status" IN ('active', 'past_due')
   AND "addOnId" IN (
         SELECT "id" FROM "marketplace_addons"
          WHERE "code" IN ('delivery_yemeksepeti', 'delivery_getir', 'delivery_trendyol_yemek')
       )
   AND NOT EXISTS (
         SELECT 1
           FROM "tenant_addons" x
          WHERE x."tenantId" = "tenant_addons"."tenantId"
            AND x."addOnId" = (SELECT "id" FROM "marketplace_addons" WHERE "code" = 'delivery_platforms')
            AND x."status" IN ('active', 'past_due')
       );
```

- [ ] **Adım 9: Açık yenileme döngüsü temizliğini (4) ekle**

Aynı dosyanın sonuna ekle:

```sql
-- ---------------------------------------------------------------------------
-- 4. Eski kodları taşıyan AÇIK, ÖDENMEMİŞ ve YIL DÖNÜMÜ HENÜZ GELMEMİŞ
--    yenileme döngüleri silinir.
--    Silinmezse: müşteri donuk totalCents'i öder, settlement yeniden teklif
--    alır (arşivli satır düşer), 1 kuruş toleransı aşılır ve provision
--    reddedilir — para alınmış, hizmet verilmemiş olur.
--    (tenantId, anniversaryAt) unique olduğu ve generate() varsa erken
--    döndüğü için UPDATE değil DELETE gerekir; 06:00 UTC cron'u paket
--    satırıyla yeniden üretir.
--
--    "anniversaryAt > NOW() + 1 gün" ŞARTI HAYATİ:
--    nextAnniversary() (anniversary.ts:114-121) bugün >= yıl dönümü olduğunda
--    BİR SONRAKİ YILA atlar, yani üretici o döngüyü asla geri getirmez. Yıl
--    dönümü gelmiş/geçmiş bir open döngüyü silmek hem faturayı yok eder hem de
--    lapseUnpaidCycles'ın (renewal-scheduler.service.ts:144-153) tek tetikleyicisini
--    siler: bayat TenantAddOn satırları hiç 'expired' olmaz ve kiracı ödediği her
--    yetkiyi SÜRESİZ BEDAVA kullanmaya devam eder. O satırlar ELLE mutabık kılınır.
-- ---------------------------------------------------------------------------
DELETE FROM "renewal_cycles" rc
 WHERE rc."status" = 'open'
   AND rc."paymentRef" IS NULL
   AND rc."anniversaryAt" > NOW() + INTERVAL '1 day'
   AND EXISTS (
         SELECT 1
           FROM jsonb_array_elements(rc."cartJson" -> 'items') AS it
          WHERE it ->> 'code' IN ('delivery_yemeksepeti', 'delivery_getir', 'delivery_trendyol_yemek')
       );
```

- [ ] **Adım 10: `down.sql`'i yaz**

`backend/prisma/migrations/20260820140000_delivery_platforms_bundle/down.sql` oluştur:

```sql
-- Paket servis tek-paket geçişinin geri alınması.
--
-- Her ifade up'ın ürettiği TAM son-durumla korunur, iki kez çalıştırılınca
-- no-op olur ve operatörün elle değiştirdiği bir fiyatı/statüyü ezmez.
-- Kiracı verisine yalnızca up'ın dokunduğu yerde dokunur: taşınan
-- `addOnId`'yi `pricingMeta.migratedFrom` damgasından geri yazar ve damgaları
-- temizler. Katalog statüsü de damgadan gelir: üç SKU koşulsuz 'published'
-- yapılmaz, up'ın 2a adımında audit_logs'a yazdığı `migratedPriorStatus`
-- değerine döner. Silinen açık yenileme döngüleri geri getirilmez —
-- türetilmiş veridir, 06:00 UTC üreticisi yeniden yaratır.
--
-- down'ın adım 0 karşılığı YOKTUR ve olmamalıdır: uçuş-öncesi kilit yalnız bir
-- okuma kapısıdır, hiçbir şey yazmaz, geri alınacak bir şey bırakmaz.

-- 1. Dedupe ile kapatılan satırları eski statülerine döndür (bunlar hiç
--    taşınmadı: 3c yalnız active/past_due satırları taşıdı).
--    cancelledAt/endedAt NULL'lanMAZ, damgadan GERİ YAZILIR: satırın up'tan
--    önce zaten bir cancelledAt'i olabilir ve onu silmek down'ı sadık bir ters
--    işlem olmaktan çıkarır. to_jsonb(NULL) 'null' ürettiği için NULLIF ile
--    tekrar NULL'a çevrilir.
UPDATE "tenant_addons" t
   SET "status" = t."pricingMeta" ->> 'migratedPriorStatus',
       "cancelledAt" = NULLIF(t."pricingMeta" ->> 'migratedPriorCancelledAt', 'null')::timestamp,
       "endedAt"     = NULLIF(t."pricingMeta" ->> 'migratedPriorEndedAt', 'null')::timestamp,
       "pricingMeta" = ((((t."pricingMeta" - 'migratedPriorStatus')
                          - 'migratedPriorCancelledAt')
                          - 'migratedPriorEndedAt')
                          - 'migratedFrom')
 WHERE t."pricingMeta" ? 'migratedPriorStatus';

-- 2. Taşınan satırları özgün SKU'larına geri yaz.
UPDATE "tenant_addons" t
   SET "addOnId" = m."id",
       "pricingMeta" = t."pricingMeta" - 'migratedFrom'
  FROM "marketplace_addons" m
 WHERE m."code" = t."pricingMeta" ->> 'migratedFrom'
   AND t."pricingMeta" ? 'migratedFrom'
   AND t."addOnId" = (SELECT "id" FROM "marketplace_addons" WHERE "code" = 'delivery_platforms');

-- 3. Üç SKU up'tan ÖNCEKİ statüsüne döner — koşulsuz 'published'a DEĞİL.
--    Kaynak: up'ın 2a adımında audit_logs'a yazdığı `migratedPriorStatus`.
--    `IS DISTINCT FROM` sayesinde damgadaki değer zaten yazılıysa satır hiç
--    güncellenmez.
UPDATE "marketplace_addons" m
   SET "status" = a."previousData" ->> 'migratedPriorStatus',
       "updatedAt" = NOW()
  FROM "audit_logs" a
 WHERE a."actorId" = 'migration:20260820140000_delivery_platforms_bundle'
   AND a."entityId" = m."id"
   AND m."code" IN ('delivery_yemeksepeti', 'delivery_getir', 'delivery_trendyol_yemek')
   AND (a."previousData" ->> 'migratedPriorStatus') IS NOT NULL
   AND m."status" IS DISTINCT FROM (a."previousData" ->> 'migratedPriorStatus');

-- 3b. Damgayı temizle. Down "yalnız up'ın eklediğini kaldırır" kuralı gereği bu
--     satırları silmek zorundadır: bırakılırsa bir sonraki up->down turunda bayat
--     bir "önceki statü" geri yazılır. Kapsam actorId ile bu migration'a çakılıdır;
--     başka hiçbir audit satırına dokunulmaz. İkinci çalıştırmada 0 satır siler.
DELETE FROM "audit_logs"
 WHERE "actorId" = 'migration:20260820140000_delivery_platforms_bundle';

-- 4. Paket satırı silinir — ama ASLA bir satın almayı sahipsiz bırakmadan.
--    (2. adım başarısız olduysa NOT EXISTS bu DELETE'i no-op yapar: fail-safe.)
DELETE FROM "marketplace_addons" ma
 WHERE ma."code" = 'delivery_platforms'
   AND NOT EXISTS (
         SELECT 1 FROM "tenant_addons" ta WHERE ta."addOnId" = ma."id"
       );

-- 5. Paketi referanslayan açık/ödenmemiş yenileme döngüleri temizlenir.
--    up'ın 4. adımıyla AYNI daraltma: yıl dönümü gelmiş/geçmiş bir open
--    döngüyü silmek faturayı da lapse tetikleyicisini de yok eder.
DELETE FROM "renewal_cycles" rc
 WHERE rc."status" = 'open'
   AND rc."paymentRef" IS NULL
   AND rc."anniversaryAt" > NOW() + INTERVAL '1 day'
   AND EXISTS (
         SELECT 1
           FROM jsonb_array_elements(rc."cartJson" -> 'items') AS it
          WHERE it ->> 'code' = 'delivery_platforms'
       );
```

- [ ] **Adım 11: Tripwire suite'ini çalıştır ve tamamen yeşil gör**

Çalıştır: `cd /home/tarik/Projects/kds/backend && npx jest src/modules/marketplace/alacarte-catalog-migration.spec.ts`

Beklenen: PASS, **17 passed / 17 total** (9 mevcut + 8 yeni). Kırmızı dönerse sebep bu görevdeki düzenlemendir — "zaten kırıktı" mazereti yoktur; suite bu daldan devralınırken 9/9 yeşildi.

Kırmızıysa ilk bakılacak yer: `parseUpserts` regex'i INSERT'i yakalayamamış olabilir. Doğrula:

```bash
cd /home/tarik/Projects/kds/backend && node -e "
const {readFileSync}=require('fs');
const sql=readFileSync('prisma/migrations/20260820140000_delivery_platforms_bundle/migration.sql','utf8');
const re=/gen_random_uuid\(\)::text, '([a-z0-9_]+)',[\s\S]*?\n\s+'(\w+)', '(\w+)', (\d+), 'TRY',\n[\s\S]*?::jsonb, (?:ARRAY\[[^\]]*\]::TEXT\[\]), '(\w+)', (true|false),/g;
console.log([...sql.matchAll(re)].map(m=>m.slice(1,7)));
"
```
Beklenen çıktı: `[ [ 'delivery_platforms', 'integration', 'annual', '249900', 'published', 'true' ] ]`

- [ ] **Adım 12: Tip + lint kapısı ve commit**

```bash
cd /home/tarik/Projects/kds/backend && npx tsc --noEmit && npm run lint:ci
cd /home/tarik/Projects/kds
git add backend/prisma/migrations/20260820140000_delivery_platforms_bundle \
        backend/src/modules/marketplace/alacarte-catalog-migration.spec.ts
git commit -m "feat(delivery): paket migration'ı — arşivle, sahipliği taşı, uçuştaki ödemeleri kilitle"
```

---

## Görev 3: `up → down → up` gidiş-dönüş kanıtı (tek kullanımlık Postgres)

**Files:**
- Test: `backend/prisma/migrations/20260820140000_delivery_platforms_bundle/{migration.sql,down.sql}` — kod değişikliği yok, **kanıt** üretilir
- Modify (yalnız bulgu çıkarsa): aynı iki dosya

**Interfaces:**
- Consumes (Görev 2): `20260820140000_delivery_platforms_bundle/migration.sql` ve `down.sql`; `pricingMeta` damga adları `migratedFrom`, `migratedPriorStatus`, `migratedPriorCancelledAt`, `migratedPriorEndedAt`; `audit_logs.actorId = 'migration:20260820140000_delivery_platforms_bundle'`.
- Produces: kanıtlanmış round-trip. **Bu tablonun tamamı yeşil olmadan migration "bitti" sayılmaz** (standing kullanıcı kuralı).

> Bu görev **asla** dev/staging veritabanına dokunmaz. Her şey tek kullanımlık bir Docker Postgres'inde çalışır.

- [ ] **Adım 1: Tek kullanımlık Postgres'i ayağa kaldır ve tüm zinciri uygula**

```bash
docker run --rm -d --name mig-probe -e POSTGRES_PASSWORD=probe -p 55432:5432 postgres:16
until docker exec mig-probe pg_isready -U postgres >/dev/null 2>&1; do :; done
cd /home/tarik/Projects/kds/backend
DATABASE_URL='postgresql://postgres:probe@localhost:55432/postgres?schema=public' npx prisma migrate deploy
```
Beklenen: tüm migration'lar `applied`, aralarında `20260820140000_delivery_platforms_bundle`.

Kısaltma için (bu görevin geri kalanında kullanılır):
```bash
export PSQL='docker exec -i mig-probe psql -U postgres -d postgres -v ON_ERROR_STOP=1'
export MIG=/home/tarik/Projects/kds/backend/prisma/migrations/20260820140000_delivery_platforms_bundle
```

- [ ] **Adım 2: Katalog son-durumunu doğrula (§6.3 adım 1)**

```bash
docker exec -i mig-probe psql -U postgres -d postgres -c \
  "SELECT code,status,\"priceCents\",\"sortOrder\" FROM marketplace_addons WHERE code LIKE 'delivery%' ORDER BY code"
```
Beklenen: `delivery_getir | archived`, `delivery_platforms | published | 249900 | 20`, `delivery_trendyol_yemek | archived`, `delivery_yemeksepeti | archived`.

- [ ] **Adım 3: Seed'in migration ile aynı sonucu verdiğini doğrula**

```bash
cd /home/tarik/Projects/kds/backend
DATABASE_URL='postgresql://postgres:probe@localhost:55432/postgres?schema=public' npx ts-node prisma/seeds/seed-marketplace.ts
docker exec -i mig-probe psql -U postgres -d postgres -c \
  "SELECT code,status,\"priceCents\" FROM marketplace_addons WHERE code LIKE 'delivery%' ORDER BY code"
```
Beklenen: adım 2 ile **birebir aynı** çıktı — seed üç kodu arşivler, paketi published bırakır.

- [ ] **Adım 4: İdempotanlık — up'ı ikinci kez çalıştır (§6.3 adım 2)**

```bash
docker exec -i mig-probe psql -U postgres -d postgres -v ON_ERROR_STOP=1 < "$MIG/migration.sql"
docker exec -i mig-probe psql -U postgres -d postgres -c \
  "SELECT code,status,\"priceCents\" FROM marketplace_addons WHERE code LIKE 'delivery%' ORDER BY code"
```
Beklenen: hata yok; çıktı adım 2 ile aynı. `UPDATE 0` satırları normaldir (arşivleme `status='published'` şartıyla korunuyor).

- [ ] **Adım 5: Uçuş-öncesi kilidin ÖLDÜĞÜNÜ kanıtla (§6.3 adım 0)**

```bash
docker exec -i mig-probe psql -U postgres -d postgres -v ON_ERROR_STOP=1 <<'SQL'
INSERT INTO "tenants" ("id","name","updatedAt") VALUES ('t-probe','Probe Restaurant', NOW())
  ON CONFLICT ("id") DO NOTHING;
INSERT INTO "checkout_intents" ("id","tenantId","paymentRef","cartJson","amountCents","status","provisionedAt","expiresAt")
VALUES ('ci-probe','t-probe','pay-probe',
        '{"items":[{"type":"addon","code":"delivery_getir","qty":1}]}'::jsonb,
        249000,'succeeded',NULL, NOW() + INTERVAL '1 hour');
SQL
docker exec -i mig-probe psql -U postgres -d postgres -v ON_ERROR_STOP=1 < "$MIG/migration.sql"; echo "exit=$?"
```
Beklenen: `ERROR: ABORT: 1 adet uçuşta checkout intent emekliye ayrılan bir teslimat SKU'suna referans veriyor…` ve `exit=3` (psql `ON_ERROR_STOP` hata kodu). **Hiçbir satır değişmez.**

Sonra kilidi aç ve geçtiğini gör:
```bash
docker exec -i mig-probe psql -U postgres -d postgres -c \
  "UPDATE checkout_intents SET \"provisionedAt\" = NOW() WHERE id='ci-probe'"
docker exec -i mig-probe psql -U postgres -d postgres -v ON_ERROR_STOP=1 < "$MIG/migration.sql"; echo "exit=$?"
```
Beklenen: `exit=0`.

- [ ] **Adım 6: Elle mutabakat listesini üret (§6.3 adım 0b)**

```bash
docker exec -i mig-probe psql -U postgres -d postgres -c \
  "SELECT rc.id, rc.\"tenantId\", rc.\"anniversaryAt\", rc.\"totalCents\" FROM renewal_cycles rc WHERE rc.status='open' AND rc.\"paymentRef\" IS NULL AND rc.\"anniversaryAt\" <= NOW() + INTERVAL '1 day' AND EXISTS (SELECT 1 FROM jsonb_array_elements(rc.\"cartJson\"->'items') it WHERE it->>'code' IN ('delivery_yemeksepeti','delivery_getir','delivery_trendyol_yemek'))"
```
Beklenen: `(0 rows)`. **Bu sorgu prod'da deploy'dan ÖNCE de çalıştırılır** (§8 R16): boş değilse migration'ın dokunmadığı döngüler vardır ve operatör her biri için ya döngüyü elle `cancelled` yapıp yeni yıl dönümü döngüsünü bekler ya da farkı elle tahsil eder.

- [ ] **Adım 7: Hayatta-kalan seçimi ve dedupe fikstürünü kur (§6.3 adım 3 + 3b)**

Önce ağacı up öncesi hâle getir (paketi ve damgaları temizle), sonra fikstürü kur:

```bash
docker exec -i mig-probe psql -U postgres -d postgres -v ON_ERROR_STOP=1 < "$MIG/down.sql"
docker exec -i mig-probe psql -U postgres -d postgres -v ON_ERROR_STOP=1 <<'SQL'
DELETE FROM "tenant_addons" WHERE "tenantId" = 't-probe';
-- ESKİ aktive edilen ama YAKIN ödenmiş satır (yemeksepeti)
INSERT INTO "tenant_addons" ("id","tenantId","addOnId","status","activatedAt","currentPeriodEnd")
SELECT 'ta-old','t-probe', m."id", 'active', NOW() - INTERVAL '200 days', NOW() + INTERVAL '30 days'
  FROM "marketplace_addons" m WHERE m."code" = 'delivery_yemeksepeti';
-- YENİ aktive edilen ama UZAĞA ödenmiş satır (getir) — hayatta kalması gereken bu
INSERT INTO "tenant_addons" ("id","tenantId","addOnId","status","activatedAt","currentPeriodEnd")
SELECT 'ta-new','t-probe', m."id", 'active', NOW() - INTERVAL '20 days', NOW() + INTERVAL '200 days'
  FROM "marketplace_addons" m WHERE m."code" = 'delivery_getir';
SQL
docker exec -i mig-probe psql -U postgres -d postgres -c \
  "SELECT id, \"addOnId\", status, \"cancelledAt\", \"endedAt\", \"pricingMeta\" FROM tenant_addons WHERE \"tenantId\"='t-probe' ORDER BY id"
```
Bu çıktıyı **kaydet** — adım 9 bununla karşılaştırılacak.

- [ ] **Adım 8: Up'ı çalıştır, doğru satırın hayatta kaldığını doğrula**

```bash
docker exec -i mig-probe psql -U postgres -d postgres -v ON_ERROR_STOP=1 < "$MIG/migration.sql"
docker exec -i mig-probe psql -U postgres -d postgres -c \
  "SELECT ta.id, m.code AS now_points_at, ta.status, ta.\"pricingMeta\" FROM tenant_addons ta JOIN marketplace_addons m ON m.id = ta.\"addOnId\" WHERE ta.\"tenantId\"='t-probe' ORDER BY ta.id"
```
Beklenen:
- `ta-new` → `now_points_at = delivery_platforms`, `status = active`, `pricingMeta` içinde `"migratedFrom": "delivery_getir"` (bugün+200g olan **hayatta kaldı**; "en eski aktive edilen kalsın" deseydik kiracının ödediği 170 günü yakardık — `plan-projector.service.ts:295-299` `validUntil`'i `currentPeriodEnd`'den türetir).
- `ta-old` → `now_points_at = delivery_yemeksepeti`, `status = cancelled`, `pricingMeta` içinde `"migratedPriorStatus": "active"`, `migratedPriorCancelledAt`, `migratedPriorEndedAt`.

- [ ] **Adım 9: Down'ı çalıştır ve bayt-bayt geri dönüşü doğrula (§6.3 adım 4)**

```bash
docker exec -i mig-probe psql -U postgres -d postgres -v ON_ERROR_STOP=1 < "$MIG/down.sql"
docker exec -i mig-probe psql -U postgres -d postgres -c \
  "SELECT id, \"addOnId\", status, \"cancelledAt\", \"endedAt\", \"pricingMeta\" FROM tenant_addons WHERE \"tenantId\"='t-probe' ORDER BY id"
docker exec -i mig-probe psql -U postgres -d postgres -c \
  "SELECT code,status FROM marketplace_addons WHERE code LIKE 'delivery%' ORDER BY code"
```
Beklenen:
- İki `tenant_addons` satırı **adım 7'de kaydettiğin çıktının aynısı** — `addOnId`, `status`, `cancelledAt` (NULL), `endedAt` (NULL) dahil; `pricingMeta`'da hiçbir `migrated*` anahtarı kalmamış.
- Üç eski kod `published`, `delivery_platforms` satırı **yok** (hiçbir `tenant_addons` satırı onu göstermediği için `NOT EXISTS` korumasından geçti).

- [ ] **Adım 10: Down'ı ikinci kez çalıştır (§6.3 adım 5)**

```bash
docker exec -i mig-probe psql -U postgres -d postgres -v ON_ERROR_STOP=1 < "$MIG/down.sql"
```
Beklenen: hata yok, her ifade `UPDATE 0` / `DELETE 0`.

- [ ] **Adım 11: Yeniden up (§6.3 adım 6)**

```bash
docker exec -i mig-probe psql -U postgres -d postgres -v ON_ERROR_STOP=1 < "$MIG/migration.sql"
docker exec -i mig-probe psql -U postgres -d postgres -c \
  "SELECT code,status,\"priceCents\",\"sortOrder\" FROM marketplace_addons WHERE code LIKE 'delivery%' ORDER BY code"
```
Beklenen: adım 2'deki duruma **birebir** dönüş.

- [ ] **Adım 12: Çift-satır koruması (§6.3 adım 7)**

```bash
docker exec -i mig-probe psql -U postgres -d postgres -v ON_ERROR_STOP=1 <<'SQL'
DELETE FROM "tenant_addons" WHERE "tenantId" = 't-probe';
INSERT INTO "tenant_addons" ("id","tenantId","addOnId","status","activatedAt")
SELECT 'ta-bundle','t-probe', m."id", 'active', NOW() FROM "marketplace_addons" m WHERE m."code"='delivery_platforms';
INSERT INTO "tenant_addons" ("id","tenantId","addOnId","status","activatedAt")
SELECT 'ta-legacy','t-probe', m."id", 'active', NOW() FROM "marketplace_addons" m WHERE m."code"='delivery_getir';
SQL
docker exec -i mig-probe psql -U postgres -d postgres -v ON_ERROR_STOP=1 < "$MIG/migration.sql"
docker exec -i mig-probe psql -U postgres -d postgres -c \
  "SELECT count(*) FROM tenant_addons ta JOIN marketplace_addons m ON m.id=ta.\"addOnId\" WHERE ta.\"tenantId\"='t-probe' AND m.code='delivery_platforms' AND ta.status='active'"
```
Beklenen: `1`. `ta-legacy` **taşınmadı** (`NOT EXISTS` koruması) — taşınsaydı `renewableItems` yenileme sepetine ₺2.499'u iki kez yazardı (`TenantAddOn`'da `(tenantId, addOnId)` unique **yok**).

- [ ] **Adım 13: Yıl dönümü geçmiş açık döngüye DOKUNULMADIĞINI kanıtla (§6.3 adım 8)**

```bash
docker exec -i mig-probe psql -U postgres -d postgres -v ON_ERROR_STOP=1 <<'SQL'
INSERT INTO "renewal_cycles" ("id","tenantId","anniversaryAt","status","cartJson","quoteJson","totalCents","graceEndsAt","paymentRef")
VALUES ('rc-past','t-probe', NOW() - INTERVAL '2 days', 'open',
        '{"items":[{"type":"addon","code":"delivery_getir","qty":1}]}'::jsonb,
        '{}'::jsonb, 249000, NOW() + INTERVAL '5 days', NULL);
INSERT INTO "renewal_cycles" ("id","tenantId","anniversaryAt","status","cartJson","quoteJson","totalCents","graceEndsAt","paymentRef")
VALUES ('rc-future','t-probe', NOW() + INTERVAL '20 days', 'open',
        '{"items":[{"type":"addon","code":"delivery_getir","qty":1}]}'::jsonb,
        '{}'::jsonb, 249000, NOW() + INTERVAL '27 days', NULL);
SQL
docker exec -i mig-probe psql -U postgres -d postgres -v ON_ERROR_STOP=1 < "$MIG/migration.sql"
docker exec -i mig-probe psql -U postgres -d postgres -c "SELECT id FROM renewal_cycles ORDER BY id"
```
Beklenen: yalnız `rc-past` durur; `rc-future` silinmiştir. `rc-past` silinseydi ne fatura çıkardı (`nextAnniversary()` bir sonraki yıla atlar) ne de `lapseUnpaidCycles` tetiklenirdi — kiracı ödediği yetkiyi süresiz bedava kullanırdı.

- [ ] **Adım 14: Statü damgası sadakati (§6.3 adım 9) — taze DB**

```bash
docker rm -f mig-probe
docker run --rm -d --name mig-probe -e POSTGRES_PASSWORD=probe -p 55432:5432 postgres:16
until docker exec mig-probe pg_isready -U postgres >/dev/null 2>&1; do :; done
cd /home/tarik/Projects/kds/backend
DATABASE_URL='postgresql://postgres:probe@localhost:55432/postgres?schema=public' npx prisma migrate deploy
docker exec -i mig-probe psql -U postgres -d postgres -v ON_ERROR_STOP=1 < "$MIG/down.sql"
docker exec -i mig-probe psql -U postgres -d postgres -c \
  "UPDATE marketplace_addons SET status='archived' WHERE code='delivery_getir'"
docker exec -i mig-probe psql -U postgres -d postgres -v ON_ERROR_STOP=1 < "$MIG/migration.sql"
docker exec -i mig-probe psql -U postgres -d postgres -v ON_ERROR_STOP=1 < "$MIG/down.sql"
docker exec -i mig-probe psql -U postgres -d postgres -c \
  "SELECT code,status FROM marketplace_addons WHERE code LIKE 'delivery%' ORDER BY code"
docker exec -i mig-probe psql -U postgres -d postgres -c \
  "SELECT count(*) FROM audit_logs WHERE \"actorId\"='migration:20260820140000_delivery_platforms_bundle'"
```
Beklenen: `delivery_getir` **hâlâ `archived`** (up öncesi statüsüne döndü, `published` OLMADI); `delivery_trendyol_yemek` ve `delivery_yemeksepeti` `published`; audit sayacı **0** (damga temizlendi). Down'ı bir kez daha çalıştır → 0 satır.

- [ ] **Adım 15: Temizle ve kanıtı commit'le**

```bash
docker rm -f mig-probe
cd /home/tarik/Projects/kds
git commit --allow-empty -m "test(delivery): paket migration'ı up->down->up turu tek kullanımlık Postgres'te doğrulandı"
```

Bir bulgu çıktıysa (herhangi bir adım beklenenden saparsa) önce `migration.sql`/`down.sql`'i düzelt, Görev 2 Adım 11'deki jest suite'ini tekrar çalıştır, sonra **bu görevin tamamını baştan** koştur — kısmi tekrar yeterli değildir.

---

## Görev 4: Semt sözlüğü ve üç katmanlı fail-closed kapı

**Files:**
- Modify: `backend/src/modules/delivery-platforms/constants/platform.enum.ts` (satır 1-6)
- Modify: `backend/src/modules/delivery-platforms/constants/platform.enum.spec.ts` (ekleme)
- Modify: `backend/src/modules/delivery-platforms/adapters/adapter-factory.ts` (satır 18)
- Modify: `backend/src/modules/delivery-platforms/adapters/adapter-factory.spec.ts` (ekleme; satır 49-59 **değişmez**)
- Modify: `backend/src/modules/delivery-platforms/dto/create-platform-config.dto.ts` (satır 15-17)
- Modify: `backend/src/modules/delivery-platforms/dto/platform-config.dto.spec.ts` (ekleme)
- Modify: `backend/src/modules/delivery-platforms/services/delivery-test.service.ts` (satır 66-71)
- Modify: `backend/src/modules/delivery-platforms/services/delivery-test.service.spec.ts` (ekleme)
- Modify: `backend/prisma/schema.prisma` (satır 3032, 3099, 3141 — **yalnız yorum**)

**Interfaces:**
- Consumes: yok (Görev 1-3'ten bağımsız; katalogla teması Görev 5'te kurulur).
- Produces (Görev 5 ve 6 bunlara dayanır, adları birebir):
  - `enum DeliveryPlatform` artık `SEMT = "SEMT"` içerir
  - `export type PlatformAvailability = "available" | "coming_soon"`
  - `export const PLATFORM_AVAILABILITY: Readonly<Record<DeliveryPlatform, PlatformAvailability>>` (`Object.freeze`'li)
  - `export const AVAILABLE_DELIVERY_PLATFORMS: readonly DeliveryPlatform[]` — sırası `["YEMEKSEPETI","GETIR","TRENDYOL","MIGROS"]`
  - `export function isPlatformAvailable(platform: string): boolean`
  - `AdapterFactory.getAdapter(platform: string): PlatformAdapter` — `coming_soon` için `ServiceUnavailableException`, bilinmeyen dize için hâlâ çıplak `Error`

- [ ] **Adım 1: Sözlük testini başarısız hâlde yaz**

`backend/src/modules/delivery-platforms/constants/platform.enum.spec.ts` importunu genişlet ve iki test ekle:

```ts
import {
  DeliveryPlatform,
  PlatformLogDirection,
  PlatformLogAction,
  PLATFORM_AVAILABILITY,
  AVAILABLE_DELIVERY_PLATFORMS,
} from "./platform.enum";
```

`describe("platform.enum", …)` içine, son `it`'ten sonra:

```ts
  it("carries SEMT as a coming-soon platform with no adapter", () => {
    // Being in the enum means "appears in the shop window", NOT "a config can
    // be opened". Semt has no adapter, no webhook route and no credentials.
    expect(DeliveryPlatform.SEMT).toBe("SEMT");
    expect(PLATFORM_AVAILABILITY[DeliveryPlatform.SEMT]).toBe("coming_soon");
    expect(AVAILABLE_DELIVERY_PLATFORMS).not.toContain(DeliveryPlatform.SEMT);
    expect(AVAILABLE_DELIVERY_PLATFORMS).toEqual([
      "YEMEKSEPETI",
      "GETIR",
      "TRENDYOL",
      "MIGROS",
    ]);
  });

  it("declares availability for every enum member (no silent gap)", () => {
    // A member with no entry would read `undefined`, which the factory gate
    // treats as "not in the map" and lets straight through to the switch.
    for (const p of Object.values(DeliveryPlatform)) {
      expect(PLATFORM_AVAILABILITY[p]).toBeDefined();
    }
    expect(Object.isFrozen(PLATFORM_AVAILABILITY)).toBe(true);
  });
```

- [ ] **Adım 2: Testi çalıştır ve kırmızıyı gör**

Çalıştır: `cd /home/tarik/Projects/kds/backend && npx jest src/modules/delivery-platforms/constants/platform.enum.spec.ts`

Beklenen: FAIL — derleme hatası `TS2305: Module '"./platform.enum"' has no exported member 'PLATFORM_AVAILABILITY'`.

- [ ] **Adım 3: Sözlüğü yaz**

`backend/src/modules/delivery-platforms/constants/platform.enum.ts` satır 1-6'yı şununla değiştir:

```ts
export enum DeliveryPlatform {
  YEMEKSEPETI = "YEMEKSEPETI",
  GETIR = "GETIR",
  TRENDYOL = "TRENDYOL",
  MIGROS = "MIGROS",
  /** Bağımsız teslimat platformu. Adaptörü YOK — availability ile kapalı. */
  SEMT = "SEMT",
}

export type PlatformAvailability = "available" | "coming_soon";

/**
 * Whether a platform has a WORKING adapter. Every `coming_soon` platform is
 * REFUSED on every write/execute path: being in the enum means "appears in the
 * shop window", not "a config can be opened".
 */
export const PLATFORM_AVAILABILITY: Readonly<
  Record<DeliveryPlatform, PlatformAvailability>
> = Object.freeze({
  [DeliveryPlatform.YEMEKSEPETI]: "available",
  [DeliveryPlatform.GETIR]: "available",
  [DeliveryPlatform.TRENDYOL]: "available",
  [DeliveryPlatform.MIGROS]: "available",
  [DeliveryPlatform.SEMT]: "coming_soon",
});

export const AVAILABLE_DELIVERY_PLATFORMS: readonly DeliveryPlatform[] =
  Object.values(DeliveryPlatform).filter(
    (p) => PLATFORM_AVAILABILITY[p] === "available",
  );

/**
 * NOTE: returns false for an UNKNOWN string too (`undefined !== "available"`).
 * That is deliberate, but callers must not confuse it with "coming soon" — the
 * factory gate narrows with `platform in PLATFORM_AVAILABILITY` for exactly
 * this reason.
 */
export function isPlatformAvailable(platform: string): boolean {
  return PLATFORM_AVAILABILITY[platform as DeliveryPlatform] === "available";
}
```

- [ ] **Adım 4: Testi çalıştır ve yeşili gör, commit'le**

Çalıştır: `cd /home/tarik/Projects/kds/backend && npx jest src/modules/delivery-platforms/constants/platform.enum.spec.ts`

Beklenen: PASS. Mevcut `"uses value===name for the platform enums"` ve `"enumerates the supported delivery platforms"` (satır 22-26, `arrayContaining` olduğu için SEMT'ten etkilenmez) değişmeden geçmeli.

```bash
cd /home/tarik/Projects/kds
git add backend/src/modules/delivery-platforms/constants/platform.enum.ts \
        backend/src/modules/delivery-platforms/constants/platform.enum.spec.ts
git commit -m "feat(delivery): Semt sözlüğe eklendi, PLATFORM_AVAILABILITY haritası"
```

- [ ] **Adım 5: Katman 2 (fabrika) için başarısız testleri yaz**

`backend/src/modules/delivery-platforms/adapters/adapter-factory.spec.ts` importuna ekle:

```ts
import { ServiceUnavailableException } from "@nestjs/common";
```

`describe("AdapterFactory", …)` içine, mevcut `"throws for an empty platform string"` testinden **sonra**:

```ts
  it("fails closed for a coming-soon platform (no adapter exists)", () => {
    // Adding SEMT to the enum opened POST /delivery-platforms/configs to it
    // via @IsEnum; without this gate order-polling.scheduler.ts:102 would call
    // getAdapter("SEMT") on every tick and raise a bare Error -> HTTP 500.
    expect(() => factory.getAdapter("SEMT")).toThrow(ServiceUnavailableException);
  });

  it("still throws for a genuinely unknown platform", () => {
    // The gate must be narrowed by `platform in PLATFORM_AVAILABILITY`. Written
    // unconditionally it would swallow typos into a 503 "coming soon", which is
    // a lie, and would break the two DOORDASH/"" specs above.
    expect(() => factory.getAdapter("NOPE")).toThrow(/Unknown delivery platform/);
  });
```

- [ ] **Adım 6: Çalıştır ve kırmızıyı gör**

Çalıştır: `cd /home/tarik/Projects/kds/backend && npx jest src/modules/delivery-platforms/adapters/adapter-factory.spec.ts`

Beklenen: FAIL — `● AdapterFactory › fails closed for a coming-soon platform (no adapter exists)`,
`Expected constructor: ServiceUnavailableException` / `Received constructor: Error` (`Unknown delivery platform: SEMT`).

- [ ] **Adım 7: Fabrika kapısını yaz**

`backend/src/modules/delivery-platforms/adapters/adapter-factory.ts` importunu ve `getAdapter`'ın ilk satırlarını değiştir:

```ts
import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import {
  DeliveryPlatform,
  PLATFORM_AVAILABILITY,
  isPlatformAvailable,
} from "../constants/platform.enum";
```

```ts
  getAdapter(platform: string): PlatformAdapter {
    // Single choke point for all 11 call sites (schedulers, webhook
    // controller, config/menu/order/moderation/test services). A platform we
    // have declared but not built yet answers 503, not 500 — and NOT the
    // `default:` Error below, which stays reserved for values we never heard
    // of. The `in` narrowing is load-bearing: isPlatformAvailable("DOORDASH")
    // is also false, and an unconditional gate would turn every typo into a
    // "coming soon" lie.
    if (platform in PLATFORM_AVAILABILITY && !isPlatformAvailable(platform)) {
      throw new ServiceUnavailableException(
        `Delivery platform ${platform} is not available yet`,
      );
    }
    switch (platform) {
```

Dosyanın geri kalanı (`case` dalları ve `default: throw new Error(...)`) **aynen kalır**.

- [ ] **Adım 8: Çalıştır ve yeşili gör**

Çalıştır: `cd /home/tarik/Projects/kds/backend && npx jest src/modules/delivery-platforms/adapters/adapter-factory.spec.ts`

Beklenen: PASS, **8 passed / 8 total**. Mevcut `"throws for an unknown platform"` (`Unknown delivery platform: DOORDASH`) ve `"throws for an empty platform string"` (`Unknown delivery platform: `) **değişmeden** geçmeli — geçmiyorsa kapıyı `platform in PLATFORM_AVAILABILITY` ile daraltmadın.

- [ ] **Adım 9: Katman 1 (DTO) için başarısız testi yaz**

`backend/src/modules/delivery-platforms/dto/platform-config.dto.spec.ts` içindeki `describe("CreatePlatformConfigDto", …)`'ya ekle:

```ts
  it("rejects a coming-soon platform on config create", async () => {
    // Adding SEMT to the enum would otherwise make @IsEnum accept it instantly
    // and a SEMT config row could exist with no adapter behind it.
    const dto = plainToInstance(CreatePlatformConfigDto, { platform: "SEMT" });
    expect((await errs(dto)).some((m) => /platform/.test(m))).toBe(true);
  });
```

- [ ] **Adım 10: Çalıştır ve kırmızıyı gör**

Çalıştır: `cd /home/tarik/Projects/kds/backend && npx jest src/modules/delivery-platforms/dto/platform-config.dto.spec.ts`

Beklenen: FAIL — `● CreatePlatformConfigDto › rejects a coming-soon platform on config create`, `Expected: true / Received: false` (`@IsEnum(DeliveryPlatform)` SEMT'i kabul ediyor).

- [ ] **Adım 11: DTO'yu daralt**

`backend/src/modules/delivery-platforms/dto/create-platform-config.dto.ts` satır 12 ve 15-17:

```ts
import {
  AVAILABLE_DELIVERY_PLATFORMS,
  DeliveryPlatform,
} from "../constants/platform.enum";
```

```ts
  // @IsIn, not @IsEnum: the enum now carries coming-soon platforms too, and
  // POST /delivery-platforms/configs must answer 400 for those so a config row
  // can never exist without an adapter behind it.
  @ApiProperty({ enum: AVAILABLE_DELIVERY_PLATFORMS })
  @IsIn(AVAILABLE_DELIVERY_PLATFORMS as readonly string[])
  platform: DeliveryPlatform;
```

`IsEnum` importu bu dosyada başka bir alanda kullanılmıyorsa `class-validator` import listesinden **çıkar** (yoksa `lint:ci` `no-unused-vars` verir). `IsIn` zaten satır 5'te içeri alınmış durumda.

`update-platform-config.dto.ts` platformu gövdeden almaz (yol parametresi) — **dokunulmaz**.

- [ ] **Adım 12: Çalıştır, yeşili gör, iki kapıyı commit'le**

```bash
cd /home/tarik/Projects/kds/backend && npx jest src/modules/delivery-platforms/dto/platform-config.dto.spec.ts src/modules/delivery-platforms/adapters/adapter-factory.spec.ts
```
Beklenen: iki suite de PASS.

```bash
cd /home/tarik/Projects/kds
git add backend/src/modules/delivery-platforms/adapters/adapter-factory.ts \
        backend/src/modules/delivery-platforms/adapters/adapter-factory.spec.ts \
        backend/src/modules/delivery-platforms/dto/create-platform-config.dto.ts \
        backend/src/modules/delivery-platforms/dto/platform-config.dto.spec.ts
git commit -m "feat(delivery): yakında platformlar için DTO ve adaptör fabrikası fail-closed"
```

- [ ] **Adım 13: Katman 3 (simülatör) için başarısız testi yaz**

`backend/src/modules/delivery-platforms/services/delivery-test.service.spec.ts` içinde, `'rejects an unknown platform before touching the config'` testinin **hemen ardına**:

```ts
  it('rejects a coming-soon platform before touching the config', async () => {
    // Semt is in the enum but has no adapter; the simulator must refuse it at
    // the same place it refuses a typo, before findOneInternal is reached.
    await expect(svc.simulateOrder('t1', 'SEMT')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(configService.findOneInternal).not.toHaveBeenCalled();
    expect(orderService.processIncomingOrder).not.toHaveBeenCalled();
  });
```

- [ ] **Adım 14: Çalıştır ve kırmızıyı gör**

Çalıştır: `cd /home/tarik/Projects/kds/backend && npx jest src/modules/delivery-platforms/services/delivery-test.service.spec.ts`

Beklenen: FAIL — `● DeliveryTestService › rejects a coming-soon platform before touching the config`; `configService.findOneInternal` çağrılmış (`Object.values(DeliveryPlatform).includes("SEMT")` artık `true`), test `expect(...).not.toHaveBeenCalled()`'da patlar.

- [ ] **Adım 15: Simülatör doğrulamasını daralt**

`backend/src/modules/delivery-platforms/services/delivery-test.service.ts` satır 66-71'i şununla değiştir (mesaj **bilerek** `Unknown delivery platform` olarak kalıyor — simülatör bir operatör aracıdır, "yakında" ile "yanlış yazdın" ayrımını taşımaz):

```ts
    if (
      !AVAILABLE_DELIVERY_PLATFORMS.includes(platform as DeliveryPlatform)
    ) {
      throw new BadRequestException(`Unknown delivery platform: ${platform}`);
    }
```

ve dosyanın `platform.enum` importunu güncelle:

```ts
import {
  AVAILABLE_DELIVERY_PLATFORMS,
  DeliveryPlatform,
} from "../constants/platform.enum";
```

`DeliveryPlatform` bu dosyada başka yerde kullanılmıyorsa import listesinden çıkar; `npm run lint:ci` bunu söyler.

- [ ] **Adım 16: Çalıştır, yeşili gör**

Çalıştır: `cd /home/tarik/Projects/kds/backend && npx jest src/modules/delivery-platforms/services/delivery-test.service.spec.ts`

Beklenen: PASS — hem yeni test hem de mevcut `'rejects an unknown platform before touching the config'` (DOORDASH).

- [ ] **Adım 17: Şema yorumlarını güncelle (migration GEREKMEZ)**

`backend/prisma/schema.prisma` satır 3032, 3099 ve 3141'deki üç yorumu şununla değiştir:

```prisma
  platform  String // YEMEKSEPETI, GETIR, TRENDYOL, MIGROS, SEMT (SEMT: coming_soon, config yazılamaz)
```

(3141'deki alan `platform       String` hizalamasını korur.) **Prisma enum'u yok, CHECK constraint yok** — bu yalnız yorumdur, `prisma migrate` çıktısı üretmez. Doğrula:

```bash
cd /home/tarik/Projects/kds/backend && npx prisma format && git diff --stat prisma/schema.prisma
```
Beklenen: yalnız üç satır değişmiş.

- [ ] **Adım 18: Modül genelinde tam tarama ve commit**

```bash
cd /home/tarik/Projects/kds/backend && set -o pipefail && npx jest src/modules/delivery-platforms && npx tsc --noEmit && npm run lint:ci
cd /home/tarik/Projects/kds
git add backend/src/modules/delivery-platforms/services/delivery-test.service.ts \
        backend/src/modules/delivery-platforms/services/delivery-test.service.spec.ts \
        backend/prisma/schema.prisma
git commit -m "feat(delivery): simülatör de yalnız erişilebilir platformları kabul ediyor"
```

---

## Görev 5: Paket ↔ platform sözlüğü köprüsü

**Files:**
- Create: `backend/src/modules/marketplace/delivery-bundle.spec.ts`
- Test: `backend/src/modules/marketplace/delivery-bundle.spec.ts`

**Interfaces:**
- Consumes (Görev 1): `ALACARTE_CATALOG`, `ALACARTE_CATALOG_BY_CODE` (`ReadonlyMap<string, AlaCarteProduct>`), `delivery_platforms` satırı ve dört vendor id'si.
- Consumes (Görev 4): `AVAILABLE_DELIVERY_PLATFORMS`.
- Produces: bugün var olmayan tek koruma — grant vendor id'leri ile enum arasındaki **açık** eşleme. §9 A1'deki Semt PR'ı bu eşlemeyi tek yerde tanımlarken bu testi çıpa olarak kullanır.

- [ ] **Adım 1: Köprü testini yaz**

`backend/src/modules/marketplace/delivery-bundle.spec.ts` oluştur:

```ts
import {
  ALACARTE_CATALOG,
  ALACARTE_CATALOG_BY_CODE,
} from "./alacarte-catalog.const";
import { AVAILABLE_DELIVERY_PLATFORMS } from "../delivery-platforms/constants/platform.enum";

/**
 * The bridge between what we SELL and what we can RUN.
 *
 * The bundle grant lists lowercase vendor ids while the adapter dictionary is
 * an uppercase enum, and the two do not map by case alone (TRENDYOL <->
 * "trendyol_yemek"). Nothing in the codebase joins them, so the day a fifth
 * platform ships, one side can move without the other and the only symptom is
 * a tenant who bought "all four" and cannot use one of them. This spec is that
 * join, written down.
 */
describe("delivery bundle <-> platform dictionary", () => {
  it("the bundle's vendor ids cover exactly the available platforms", () => {
    const bundle = ALACARTE_CATALOG_BY_CODE.get("delivery_platforms")!;
    const vendors = bundle.grants["integration.delivery"] as string[];
    expect(vendors.length).toBe(AVAILABLE_DELIVERY_PLATFORMS.length);
    // The pairing is pinned EXPLICITLY because it cannot be derived: vendor
    // ids are lowercase and TRENDYOL's id carries a "_yemek" suffix.
    expect(vendors).toEqual([
      "yemeksepeti",
      "getir",
      "trendyol_yemek",
      "migros",
    ]);
  });

  it("does not sell Semt", () => {
    // Semt is free and not built. A published zero-price catalog row would
    // punch straight through purchase()'s payment gate, so there is no row at
    // all — and the bundle must not smuggle it in as a fifth vendor.
    const bundle = ALACARTE_CATALOG_BY_CODE.get("delivery_platforms")!;
    expect(bundle.grants["integration.delivery"]).not.toContain("semt");
    expect(ALACARTE_CATALOG.some((p) => p.code.includes("semt"))).toBe(false);
  });
});
```

- [ ] **Adım 2: Çalıştır ve yeşili gör**

Çalıştır: `cd /home/tarik/Projects/kds/backend && npx jest src/modules/marketplace/delivery-bundle.spec.ts`

Beklenen: PASS, 2 passed / 2 total. Kırmızı dönerse iki olasılık var: (a) Görev 1'deki vendor sırası farklı yazılmış, (b) Görev 4'te `AVAILABLE_DELIVERY_PLATFORMS` filtresi Semt'i elemiyor. İkisi de bu testin yakalaması gereken gerçek hatadır — testi gevşetme, kaynağı düzelt.

- [ ] **Adım 3: Commit**

```bash
cd /home/tarik/Projects/kds/backend && npx tsc --noEmit && npm run lint:ci
cd /home/tarik/Projects/kds
git add backend/src/modules/marketplace/delivery-bundle.spec.ts
git commit -m "test(delivery): paketin vendor id'leri ile platform sözlüğü arasındaki köprü pinlendi"
```

---

## Görev 6: Frontend sözlük aynası, sözleşme-drift muhafızı ve POS filtresi

**Files:**
- Modify: `frontend/src/types/index.ts` (satır 674 yorumu; satır 692-697 enum)
- Modify: `scripts/check-contract-drift.mjs` (satır 43-47 sabitler; satır 48-81 `CHECKS`)
- Modify: `frontend/src/components/delivery-platforms/platformDisplay.ts` (satır 17-38 harita; dosya sonu)
- Modify: `frontend/src/components/pos/PendingOrdersPanel.tsx` (satır 15 import; satır 25 `PLATFORM_FILTERS`)
- Create: `frontend/src/components/delivery-platforms/platformDisplay.test.ts`
- Test: `frontend/src/components/delivery-platforms/platformDisplay.test.ts`, `node scripts/check-contract-drift.mjs`

**Interfaces:**
- Consumes (Görev 4): backend `DeliveryPlatform` enum'unun üye listesi (`YEMEKSEPETI, GETIR, TRENDYOL, MIGROS, SEMT`) ve `PLATFORM_AVAILABILITY` değerleri — frontend bunları **aynalar**, API'den okumaz.
- Produces (Görev 7 ve 8 bunlara dayanır, adları birebir):
  - `frontend/src/types/index.ts` → `export enum DeliveryPlatform { …, SEMT = 'SEMT' }`, `export type PlatformAvailability = 'available' | 'coming_soon'`, `export const PLATFORM_AVAILABILITY: Record<string, PlatformAvailability>`
  - `frontend/src/components/delivery-platforms/platformDisplay.ts` → `PLATFORM_DISPLAY.SEMT`, `export const ORDERABLE_PLATFORM_KEYS: string[]`
  - `scripts/check-contract-drift.mjs` → `CHECKS` içinde `{ name: "DeliveryPlatform", … }`

- [ ] **Adım 1: Drift muhafızını önce yaz — bu, aynanın başarısız testidir**

`scripts/check-contract-drift.mjs` satır 43-47'ye yeni sabiti ekle:

```js
const BACKEND_ROLES = "backend/src/common/constants/roles.enum.ts";
const BACKEND_ORDER = "backend/src/common/constants/order-status.enum.ts";
const BACKEND_DELIVERY =
  "backend/src/modules/delivery-platforms/constants/platform.enum.ts";
const FRONTEND_TYPES = "frontend/src/types/index.ts";
const FRONTEND_ROLES = "frontend/src/types/roles.ts";
```

ve `CHECKS` dizisinin sonuna (`PaymentStatus` girişinden sonra) ekle:

```js
  {
    // Hand-mirrored on both sides with no guard until v3.6.8. Adding SEMT to
    // one side only makes PlatformCard read PLATFORM_INFO[platform] as
    // undefined and blow up on info.bgColor — a TypeError, in settings, for
    // every tenant.
    name: "DeliveryPlatform",
    backend: () =>
      enumValues(read(BACKEND_DELIVERY), "DeliveryPlatform", BACKEND_DELIVERY),
    frontend: () =>
      enumValues(read(FRONTEND_TYPES), "DeliveryPlatform", FRONTEND_TYPES),
  },
```

- [ ] **Adım 2: Muhafızı çalıştır ve kırmızıyı gör**

Çalıştır: `node scripts/check-contract-drift.mjs`

Beklenen: FAIL — `DeliveryPlatform` satırı için backend `[YEMEKSEPETI, GETIR, TRENDYOL, MIGROS, SEMT]` / frontend `[YEMEKSEPETI, GETIR, TRENDYOL, MIGROS]` farkı raporlanır ve script sıfırdan farklı kodla çıkar.

- [ ] **Adım 3: Frontend aynasını yaz**

`frontend/src/types/index.ts` satır 692-697'yi şununla değiştir:

```ts
export enum DeliveryPlatform {
  YEMEKSEPETI = 'YEMEKSEPETI',
  GETIR = 'GETIR',
  TRENDYOL = 'TRENDYOL',
  MIGROS = 'MIGROS',
  SEMT = 'SEMT',
}

export type PlatformAvailability = 'available' | 'coming_soon';

// Mirror of backend/src/modules/delivery-platforms/constants/platform.enum.ts.
// Drift guard: scripts/check-contract-drift.mjs -> "DeliveryPlatform".
// The API never returns availability — it is not a DTO field (main.ts runs
// ValidationPipe({ whitelist: true }), so an undeclared field is dropped
// silently); the UI reads it from this mirror.
export const PLATFORM_AVAILABILITY: Record<string, PlatformAvailability> = {
  YEMEKSEPETI: 'available',
  GETIR: 'available',
  TRENDYOL: 'available',
  MIGROS: 'available',
  SEMT: 'coming_soon',
};
```

ve satır 674'teki yorumu güncelle:

```ts
  source?: string | null; // YEMEKSEPETI, GETIR, TRENDYOL, MIGROS, SEMT (null = internal/POS)
```

- [ ] **Adım 4: Muhafızı çalıştır ve yeşili gör**

Çalıştır: `cd /home/tarik/Projects/kds && node scripts/check-contract-drift.mjs`

Beklenen: PASS — `DeliveryPlatform ✓` dahil altı sözleşme de eşleşiyor, çıkış kodu 0.

- [ ] **Adım 5: Marka rengi ve POS filtresi için başarısız testi yaz**

`frontend/src/components/delivery-platforms/platformDisplay.test.ts` oluştur:

```ts
import { describe, it, expect } from 'vitest';
import {
  PLATFORM_DISPLAY,
  ORDERABLE_PLATFORM_KEYS,
  getPlatformDisplay,
} from './platformDisplay';

describe('platformDisplay', () => {
  it('brands Semt instead of falling back to slate', () => {
    // The fallback already keeps the KDS/POS badge from crashing, but a
    // Semt-tagged order should read as Semt, not as an unrecognised source.
    expect(PLATFORM_DISPLAY.SEMT).toBeDefined();
    expect(getPlatformDisplay('SEMT').label).toBe('Semt');
    expect(getPlatformDisplay('SEMT').className).toContain('sky');
  });

  it('keeps a coming-soon platform out of the POS filter chips', () => {
    // A Semt chip can never match an order: no adapter, no webhook route. It
    // would sit in the delivery inbox permanently empty. The badge map still
    // needs the entry, so the filtering happens here, not by omission.
    expect(Object.keys(PLATFORM_DISPLAY)).toContain('SEMT');
    expect(ORDERABLE_PLATFORM_KEYS).not.toContain('SEMT');
    expect(ORDERABLE_PLATFORM_KEYS).toEqual([
      'YEMEKSEPETI',
      'GETIR',
      'TRENDYOL',
      'MIGROS',
    ]);
  });
});
```

- [ ] **Adım 6: Çalıştır ve kırmızıyı gör**

Çalıştır: `cd /home/tarik/Projects/kds/frontend && npx vitest run src/components/delivery-platforms/platformDisplay.test.ts`

Beklenen: FAIL — `Error: No "ORDERABLE_PLATFORM_KEYS" export is defined on the "./platformDisplay" mock` benzeri bir çözümleme hatası; en azından `PLATFORM_DISPLAY.SEMT` `undefined` olduğu için ilk test `expected undefined to be defined` ile patlar.

- [ ] **Adım 7: `platformDisplay.ts`'i genişlet**

Dosyanın başına import ekle:

```ts
import { PLATFORM_AVAILABILITY } from '../../types';
```

`PLATFORM_DISPLAY` haritasının **sonuna** (MIGROS girdisinden sonra) ekle:

```ts
  SEMT: {
    label: 'Semt',
    className: 'bg-sky-100 text-sky-700 ring-1 ring-sky-200',
    kioskClassName: 'bg-sky-500/20 text-sky-200 ring-1 ring-sky-500/40',
  },
```

ve `getPlatformDisplay`'in **altına**:

```ts
/**
 * Platforms that can actually produce an order today — the source of the POS
 * delivery-inbox filter chips.
 *
 * A `coming_soon` platform has no adapter and no webhook route, so a chip for
 * it would be permanently empty. It still keeps its PLATFORM_DISPLAY entry so
 * that the day its orders start arriving they render branded rather than
 * falling back to slate.
 */
export const ORDERABLE_PLATFORM_KEYS: string[] = Object.keys(
  PLATFORM_DISPLAY,
).filter((p) => PLATFORM_AVAILABILITY[p] !== 'coming_soon');
```

- [ ] **Adım 8: POS panelini yeni sabite bağla**

`frontend/src/components/pos/PendingOrdersPanel.tsx` satır 15 importunu ve satır 25'i değiştir:

```ts
import { ORDERABLE_PLATFORM_KEYS } from '../delivery-platforms/platformDisplay';
```

```ts
const PLATFORM_FILTERS = ['ALL', ...ORDERABLE_PLATFORM_KEYS];
```

`PLATFORM_DISPLAY` bu dosyada başka yerde kullanılmıyorsa importtan çıkar; kullanılıyorsa iki adı tek satırda içeri al.

- [ ] **Adım 9: Çalıştır, yeşili gör, tipleri ve muhafızı doğrula, commit'le**

```bash
cd /home/tarik/Projects/kds/frontend && npx vitest run src/components/delivery-platforms/platformDisplay.test.ts
cd /home/tarik/Projects/kds/frontend && npx tsc --noEmit -p tsconfig.json
cd /home/tarik/Projects/kds && node scripts/check-contract-drift.mjs
```
Beklenen: test PASS (2/2), tsc temiz, drift muhafızı 0 ile çıkar.

```bash
cd /home/tarik/Projects/kds
git add frontend/src/types/index.ts \
        scripts/check-contract-drift.mjs \
        frontend/src/components/delivery-platforms/platformDisplay.ts \
        frontend/src/components/delivery-platforms/platformDisplay.test.ts \
        frontend/src/components/pos/PendingOrdersPanel.tsx
git commit -m "feat(delivery): frontend Semt aynası, DeliveryPlatform drift muhafızı ve ölü POS çipinin elenmesi"
```

---

## Görev 7: Ayarlar sayfasında beşinci kart ve `PlatformCard`'ın "yakında" dalı

**Files:**
- Modify: `frontend/src/pages/settings/DeliveryPlatformsSettingsPage.tsx` (satır 10)
- Modify: `frontend/src/pages/settings/DeliveryPlatformsSettingsPage.test.tsx` (satır 48; yeni test)
- Modify: `frontend/src/components/delivery-platforms/PlatformCard.tsx` (satır 18-19 import; 71-96 `PLATFORM_INFO`; 105 civarı; 150/178/226 handler'lar; 293-300 header; 325-345 toggle)
- Modify: `frontend/src/components/delivery-platforms/PlatformCard.test.tsx` (hoisted mock'a `createMutateAsync` + yeni `describe`)
- Modify: `frontend/src/App.tsx` (satır 736-737 yorumu)
- Modify: `frontend/src/i18n/locales/{tr,en,ru,ar,uz}/settings.json`
- Test: iki vitest suite'i + `node scripts/check-i18n-parity.mjs` + `node scripts/check-i18n-value-drift.mjs --gate-new scripts/i18n-value-drift-baseline.json`

**Interfaces:**
- Consumes (Görev 6): `PLATFORM_AVAILABILITY` (`frontend/src/types`), değeri `'coming_soon'`.
- Produces:
  - `ALL_PLATFORMS = ['GETIR', 'YEMEKSEPETI', 'TRENDYOL', 'MIGROS', 'SEMT']` (SEMT **en sonda** — `DeliveryPlatformsSettingsPage.test.tsx:48` sıralı eşitlik iddia eder)
  - `PLATFORM_INFO.SEMT = { name: 'Semt', platform: 'SEMT', color: 'text-sky-700', bgColor: 'bg-sky-50' }`
  - `PlatformCard` kök `<div>`'inin header'ında `data-availability="coming_soon" | "available"`
  - i18n anahtarları: `onlineOrders.platformDescriptions.SEMT`, `onlineOrders.availability.comingSoon`, `onlineOrders.availability.comingSoonNote`

- [ ] **Adım 1: i18n anahtarlarını beş locale'e yaz**

`frontend/src/i18n/locales/<loc>/settings.json` içinde `onlineOrders.platformDescriptions`'a `SEMT` anahtarı ekle (mevcut dört anahtarın yanına, alfabetik gerek yok):

| locale | `onlineOrders.platformDescriptions.SEMT` |
|---|---|
| tr | `Semt siparişleri POS ve mutfağa düşecek. Entegrasyon yakında.` |
| en | `Semt orders will flow into the POS and the kitchen. Integration coming soon.` |
| ru | `Заказы Semt будут поступать в POS и на кухню. Интеграция скоро.` |
| ar | `ستصل طلبات Semt إلى نقطة البيع والمطبخ. التكامل قريبًا.` |
| uz | `Semt buyurtmalari POS va oshxonaga tushadi. Integratsiya tez orada.` |

Aynı beş dosyaya `onlineOrders` altına **yeni** bir `availability` nesnesi ekle (`platformDescriptions`'ın hemen ardına):

| locale | `availability.comingSoon` | `availability.comingSoonNote` |
|---|---|---|
| tr | `Yakında · Ücretsiz` | `Bu platform henüz bağlanamıyor. Hazır olduğunda ücretsiz açılacak.` |
| en | `Coming soon · Free` | `This platform cannot be connected yet. It will be enabled free of charge when ready.` |
| ru | `Скоро · Бесплатно` | `Эту платформу пока нельзя подключить. Она будет включена бесплатно, когда будет готова.` |
| ar | `قريبًا · مجانًا` | `لا يمكن ربط هذه المنصة بعد. سيتم تفعيلها مجانًا عندما تصبح جاهزة.` |
| uz | `Tez orada · Bepul` | `Bu platformani hozircha ulab bo'lmaydi. Tayyor bo'lganda bepul yoqiladi.` |

⚠️ Türkçe metni İngilizce/Rusça/Arapça/Özbekçe dosyaya `defaultValue` olarak koymak YASAK — parity geçer, dört dil Türkçe görür. Bu repoda daha önce yaşandı.

- [ ] **Adım 2: i18n kapılarını çalıştır**

```bash
cd /home/tarik/Projects/kds
node scripts/check-i18n-parity.mjs
node scripts/check-i18n-value-drift.mjs --gate-new scripts/i18n-value-drift-baseline.json
```
Beklenen: ikisi de 0 ile çıkar. Value-drift kırmızıysa **baseline'ı şişirme** — beş değer birbirinden farklı olduğu için temiz geçmeli; geçmiyorsa bir dosyaya yanlış dili yapıştırmışsındır. `scripts/i18n-value-drift-baseline.json`'a yeni anahtar **eklenmez**.

- [ ] **Adım 3: Ayarlar sayfası testini başarısız hâle getir**

`frontend/src/pages/settings/DeliveryPlatformsSettingsPage.test.tsx` satır 48'i güncelle ve altına yeni test ekle:

```tsx
    expect(platforms).toEqual(['GETIR', 'YEMEKSEPETI', 'TRENDYOL', 'MIGROS', 'SEMT']);
  });

  it('passes SEMT through with no config row', () => {
    // Deliberately NOT named "renders the coming-soon card": this suite stubs
    // PlatformCard (see the vi.mock above, which only emits data-testid /
    // data-platform / data-has-config), so nothing about the badge or the
    // disabled toggle is observable from here. Those live in PlatformCard.test.
    render(<DeliveryPlatformsSettingsPage />);
    const cards = screen.getAllByTestId('platform-card');
    const platforms = cards.map((c) => c.getAttribute('data-platform'));
    expect(platforms).toContain('SEMT');
    const semt = cards.find((c) => c.getAttribute('data-platform') === 'SEMT')!;
    expect(semt.getAttribute('data-has-config')).toBe('false');
  });
```

- [ ] **Adım 4: Çalıştır ve kırmızıyı gör**

Çalıştır: `cd /home/tarik/Projects/kds/frontend && npx vitest run src/pages/settings/DeliveryPlatformsSettingsPage.test.tsx`

Beklenen: FAIL — `renders a card for each known platform`, `Expected: [… , "SEMT"]` / `Received: ["GETIR","YEMEKSEPETI","TRENDYOL","MIGROS"]`; ayrıca `passes SEMT through with no config row` `expected [...] to contain 'SEMT'`.

- [ ] **Adım 5: `ALL_PLATFORMS`'a SEMT ekle**

`frontend/src/pages/settings/DeliveryPlatformsSettingsPage.tsx` satır 10:

```ts
// SEMT last, deliberately: it is the one card you cannot connect yet, so it
// sits after the four working platforms instead of interrupting them.
const ALL_PLATFORMS = ['GETIR', 'YEMEKSEPETI', 'TRENDYOL', 'MIGROS', 'SEMT'];
```

- [ ] **Adım 6: Çalıştır, yeşili gör**

Çalıştır: `cd /home/tarik/Projects/kds/frontend && npx vitest run src/pages/settings/DeliveryPlatformsSettingsPage.test.tsx`

Beklenen: PASS, 5 passed / 5 total.

- [ ] **Adım 7: `PlatformCard`'ın yakında davranışı için başarısız testleri yaz**

Önce mock'u genişlet: `handleToggleEnabled` **`createConfig.mutateAsync`** çağırır, ama mevcut `mutationStub` her render'da taze bir `mutateAsync` üretir, dolayısıyla ona dışarıdan iddia edilemez. `vi.hoisted` nesnesine bir alan ekle (satır 14-25):

```tsx
const h = vi.hoisted(() => ({
  updateMutate: vi.fn(),
  updateMutateAsync: vi.fn(),
  createMutate: vi.fn(),
  // Hoisted like updateMutateAsync: handleToggleEnabled/handleSave call
  // createConfig.mutateAsync, and the coming-soon guard has to be provable
  // against the SAME fn across renders.
  createMutateAsync: vi.fn(),
  testMutate: vi.fn(),
  toggleMutate: vi.fn(),
  sendTestOrderMutate: vi.fn(),
  syncMenuMutate: vi.fn(),
  toastError: vi.fn(),
}));
```

ve `useCreatePlatformConfig` mock'unu şununla değiştir (diğer beş mock aynen kalır):

```tsx
  useCreatePlatformConfig: () => ({
    mutate: h.createMutate,
    mutateAsync: h.createMutateAsync,
    isPending: false,
  }),
```

`createMutateAsync` bir `Promise` döndürmelidir; `beforeEach`'teki `mockReset()` döngüsü onu da sıfırlar, o yüzden aynı `beforeEach`'in sonuna ekle:

```tsx
  h.createMutateAsync.mockResolvedValue(undefined);
  h.updateMutateAsync.mockResolvedValue(undefined);
```

Sonra dosyanın sonuna ekle:

```tsx
describe('PlatformCard coming-soon (Semt)', () => {
  it('shows the free/coming-soon badge and disables connecting', () => {
    render(<PlatformCard platform="SEMT" />);
    expect(
      screen.getByText('onlineOrders.availability.comingSoon'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('onlineOrders.availability.comingSoonNote'),
    ).toBeInTheDocument();
    const toggle = screen.getByRole('button', {
      name: 'onlineOrders.aria.enablePlatform',
    }) as HTMLButtonElement;
    expect(toggle).toBeDisabled();
    expect(toggle).toHaveAttribute('aria-disabled', 'true');
  });

  it('does not expand into the credentials form when clicked', () => {
    render(<PlatformCard platform="SEMT" />);
    fireEvent.click(screen.getByRole('heading', { level: 3 }));
    // The credentials form renders the platform's field labels; for a
    // coming-soon platform the card must stay collapsed entirely.
    expect(screen.queryByText('onlineOrders.autoAccept')).toBeNull();
  });

  it('never reaches createConfig, through the toggle or the header', () => {
    // Two paths, two assertions. `fireEvent.click` on a DISABLED button does
    // not fire onClick at all, so the toggle line alone proves little — it is
    // the header click that actually exercises the `if (comingSoon) return;`
    // guard in handleToggleEnabled/handleSave, because the header is a live
    // div whose onClick runs and must no-op.
    render(<PlatformCard platform="SEMT" />);
    fireEvent.click(
      screen.getByRole('button', { name: 'onlineOrders.aria.enablePlatform' }),
    );
    fireEvent.click(screen.getByRole('heading', { level: 3 }));
    expect(h.createMutateAsync).not.toHaveBeenCalled();
    expect(h.updateMutateAsync).not.toHaveBeenCalled();
    expect(h.createMutate).not.toHaveBeenCalled();
    expect(h.updateMutate).not.toHaveBeenCalled();
    // And nothing opened that could take credentials.
    expect(screen.queryByText('onlineOrders.autoAccept')).toBeNull();
  });

  it('still creates a config for a live platform — the guard is not a blanket off-switch', () => {
    // Control case. Without it, the assertions above would pass even if the
    // guard accidentally short-circuited every platform.
    render(<PlatformCard platform="MIGROS" />);
    fireEvent.click(
      screen.getByRole('button', { name: 'onlineOrders.aria.enablePlatform' }),
    );
    // No credentials yet, so the card asks for them instead of posting — the
    // point is that it REACHED handleToggleEnabled's body at all.
    expect(h.toastError).toHaveBeenCalledWith('onlineOrders.fillCredentials');
  });

  it('marks the header with data-availability for the four live platforms too', () => {
    const { container, unmount } = render(<PlatformCard platform="SEMT" />);
    expect(
      container.querySelector('[data-availability="coming_soon"]'),
    ).not.toBeNull();
    unmount();
    const live = render(<PlatformCard platform="GETIR" />);
    expect(
      live.container.querySelector('[data-availability="available"]'),
    ).not.toBeNull();
  });
});
```

> Not: bu suite `useTranslation` mock'u anahtarları aynen döndürür (`t: (k) => k`), bu yüzden `aria-label` da `onlineOrders.aria.enablePlatform` olarak okunur — mevcut mock interpolasyon argümanını yok sayar.

- [ ] **Adım 8: Çalıştır ve kırmızıyı gör**

Çalıştır: `cd /home/tarik/Projects/kds/frontend && npx vitest run src/components/delivery-platforms/PlatformCard.test.tsx`

Beklenen: FAIL — ilk test `TypeError: Cannot read properties of undefined (reading 'bgColor')`, çünkü `PLATFORM_INFO['SEMT']` yok (B12). Bu, drift muhafızının neden zorunlu olduğunun canlı kanıtıdır.

- [ ] **Adım 9: `PLATFORM_INFO`'ya SEMT ekle**

`frontend/src/components/delivery-platforms/PlatformCard.tsx`, `PLATFORM_INFO` haritasının sonuna (MIGROS'tan sonra):

```tsx
  // Semt has no adapter yet. It gets an entry here — and NOT in
  // REQUIRED_CREDENTIALS or PLATFORMS_WITH_REAL_SANDBOX — because the card
  // still renders and `info.bgColor` would otherwise throw.
  SEMT: {
    name: 'Semt',
    platform: 'SEMT',
    color: 'text-sky-700',
    bgColor: 'bg-sky-50',
  },
```

- [ ] **Adım 10: `comingSoon` bayrağını ve üç handler guard'ını yaz**

Aynı dosyada importlara ekle:

```tsx
import Badge from '../ui/Badge';
import { PLATFORM_AVAILABILITY } from '../../types';
```

`const info = PLATFORM_INFO[platform];` satırının **hemen altına**:

```tsx
  // A coming-soon platform is a shop-window entry, not a connectable one: the
  // backend answers 400 on POST /delivery-platforms/configs and 503 from the
  // adapter factory. The UI must not offer an action that can only fail.
  const comingSoon = PLATFORM_AVAILABILITY[platform] === 'coming_soon';
```

`handleToggleEnabled`, `handleSave` ve `handleTestConnection`'ın **ilk satırı** olarak (buton devre dışıyken bile programatik çağrıya karşı):

```tsx
    if (comingSoon) return;
```

- [ ] **Adım 11: Header'ı, rozeti, notu ve toggle'ı yaz**

Header `<div>`'ini (satır ~293-300) şununla değiştir:

```tsx
      <div
        className={`flex items-center justify-between p-4 transition-colors ${
          comingSoon ? '' : 'cursor-pointer hover:bg-slate-50'
        }`}
        data-availability={comingSoon ? 'coming_soon' : 'available'}
        onClick={() => {
          if (comingSoon) return;
          setExpanded(!expanded);
        }}
      >
```

Başlık satırındaki `<PlatformStatusBadge … />`'in **hemen ardına**:

```tsx
              {comingSoon && (
                <Badge variant="default">
                  {t('onlineOrders.availability.comingSoon')}
                </Badge>
              )}
```

Açıklama `<p>`'sinin **hemen ardına**:

```tsx
            {comingSoon && (
              <p className="text-xs text-sky-700">
                {t('onlineOrders.availability.comingSoonNote')}
              </p>
            )}
```

Enable/Disable toggle butonuna `disabled` + `aria-disabled` ekle ve kapalı görünümü sabitle:

```tsx
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleToggleEnabled();
            }}
            disabled={comingSoon}
            aria-disabled={comingSoon}
            aria-label={
              config?.isEnabled
                ? t('onlineOrders.aria.disablePlatform', { name: info.name })
                : t('onlineOrders.aria.enablePlatform', { name: info.name })
            }
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              config?.isEnabled ? 'bg-primary-600' : 'bg-slate-300'
            } ${comingSoon ? 'cursor-not-allowed opacity-50' : ''}`}
          >
```

Chevron'u da yalnız bağlanabilir platformlarda göster:

```tsx
          {!comingSoon &&
            (expanded ? (
              <ChevronUp className="h-4 w-4 text-slate-400" />
            ) : (
              <ChevronDown className="h-4 w-4 text-slate-400" />
            ))}
```

- [ ] **Adım 12: Çalıştır ve yeşili gör**

Çalıştır: `cd /home/tarik/Projects/kds/frontend && npx vitest run src/components/delivery-platforms/PlatformCard.test.tsx`

Beklenen: PASS — yeni **beş** test (dördü Semt, biri MIGROS kontrol vakası) **ve** mevcut sandbox-fail-closed testleri (MIGROS / GETIR / YEMEKSEPETI / TRENDYOL) değişmeden.

- [ ] **Adım 13: `App.tsx`'teki yanlışa dönmüş yorumu düzelt**

`frontend/src/App.tsx` satır 736-737:

```tsx
                      /* Üç platform modülünden herhangi biri bu ekranı açar;
                         fiyat/isim en ucuz teklife göre çözülür. */
```

şununla değişir:

```tsx
                      /* Tek `delivery_platforms` paketi bu ekranı açar;
                         fiyat/isim tek satırdan çözülür. */
```

- [ ] **Adım 14: Tam frontend kapısı ve commit**

```bash
cd /home/tarik/Projects/kds/frontend && npx vitest run src/pages/settings/DeliveryPlatformsSettingsPage.test.tsx src/components/delivery-platforms
cd /home/tarik/Projects/kds/frontend && npx tsc --noEmit -p tsconfig.json
node scripts/check-i18n-parity.mjs
```
Beklenen: hepsi temiz.

```bash
cd /home/tarik/Projects/kds
git add frontend/src/pages/settings/DeliveryPlatformsSettingsPage.tsx \
        frontend/src/pages/settings/DeliveryPlatformsSettingsPage.test.tsx \
        frontend/src/components/delivery-platforms/PlatformCard.tsx \
        frontend/src/components/delivery-platforms/PlatformCard.test.tsx \
        frontend/src/App.tsx \
        frontend/src/i18n/locales/tr/settings.json \
        frontend/src/i18n/locales/en/settings.json \
        frontend/src/i18n/locales/ru/settings.json \
        frontend/src/i18n/locales/ar/settings.json \
        frontend/src/i18n/locales/uz/settings.json
git commit -m "feat(delivery): ayarlarda Semt kartı — yakında rozeti, bağlanma devre dışı"
```

---

## Görev 8: Mağazada satın alınamaz Semt bilgi kartı

**Files:**
- Modify: `frontend/src/features/licensing/CatalogStore.tsx` (satır 28 civarı yeni bileşen; satır 183-185 erken dönüş; satır 205-211 bölüm döngüsü)
- Create: `frontend/src/features/licensing/CatalogStore.semt.test.tsx`
- Modify: `frontend/src/i18n/locales/{tr,en,ru,ar,uz}/licensing.json`
- Test: yeni vitest suite'i + mevcut `CatalogStore.test.tsx` + i18n kapıları

**Interfaces:**
- Consumes: `useTranslation(['licensing', 'common'])` (`CatalogStore.tsx:46` bunu zaten çağırıyor), `grouped: Map<string, PricingProduct[]>` (satır 90-97), `KIND_ORDER` (satır 15-22).
- Produces: yerel (export edilmeyen) `SemtComingSoonRow` bileşeni ve `data-testid="semt-coming-soon"` çıpası; i18n anahtarları `store.semt.title`, `store.semt.description`, `store.semt.badge`.

> ⚠️ **Doğru dosya `features/licensing/CatalogStore.tsx`'tir.** `features/marketplace/MarketplacePage.tsx` **hiçbir rotaya bağlı değildir** (`/admin/store` → `StoreHubPage` → `CatalogStore`; `/admin/marketplace` → `/admin/store?tab=catalog` redirect). Kart oraya konursa müşteri onu asla göremez.

- [ ] **Adım 1: `licensing.json`'a beş locale çeviri yaz**

Her `frontend/src/i18n/locales/<loc>/licensing.json` dosyasında **mevcut `store` nesnesinin içine** `semt` alt nesnesi ekle:

| locale | `store.semt.title` | `store.semt.badge` |
|---|---|---|
| tr | `Semt (yakında)` | `Yakında · Ücretsiz` |
| en | `Semt (coming soon)` | `Coming soon · Free` |
| ru | `Semt (скоро)` | `Скоро · Бесплатно` |
| ar | `Semt (قريبًا)` | `قريبًا · مجانًا` |
| uz | `Semt (tez orada)` | `Tez orada · Bepul` |

`store.semt.description`:
- tr: `Bağımsız teslimat platformu. Entegrasyon hazır olduğunda paket servis paketine ücretsiz dahil edilecek.`
- en: `The independent delivery platform. When the integration is ready it will be included in the delivery package free of charge.`
- ru: `Независимая платформа доставки. Когда интеграция будет готова, она войдёт в пакет доставки бесплатно.`
- ar: `منصة التوصيل المستقلة. عندما يصبح التكامل جاهزًا سيُضاف إلى باقة التوصيل مجانًا.`
- uz: `Mustaqil yetkazib berish platformasi. Integratsiya tayyor bo'lganda yetkazib berish paketiga bepul qo'shiladi.`

⚠️ `CatalogStore.tsx`'te **hiç `defaultValue` yok** (grep ile doğrulandı) — o deseni buraya taşıma. Rotaya bağlı olmayan `MarketplacePage.tsx` bu hatayı hâlihazırda içeriyor (`catalogEmpty` defaultValue'su Türkçe); örnek alınmaz.

- [ ] **Adım 2: Başarısız testi yaz**

`frontend/src/features/licensing/CatalogStore.semt.test.tsx` oluştur:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import CatalogStore from './CatalogStore';

/**
 * Semt has no catalog row on purpose: it is free and unbuilt, and a published
 * zero-price row would punch through purchase()'s payment gate. So the shop
 * window carries a static line instead — one the customer can read and cannot
 * buy. Two render sites matter, because a tenant whose filtered catalog is
 * empty takes the early-return branch and would otherwise never see it.
 */
let products: any[];
const purchaseAsync = vi.fn();

vi.mock('./licensingApi', async () => {
  const actual = await vi.importActual<typeof import('./licensingApi')>(
    './licensingApi',
  );
  return {
    ...actual,
    useCatalogPricing: () => ({ data: products, isLoading: false }),
  };
});

vi.mock('../../contexts/SubscriptionContext', () => ({
  useEntitlements: () => ({
    owned: [],
    license: { status: 'active' },
    snapshot: { offers: {}, purchasability: {} },
    offerFor: () => null,
  }),
}));

vi.mock('../marketplace/marketplaceApi', () => ({
  usePurchaseAddOnViaCheckout: () => ({ mutateAsync: purchaseAsync }),
}));

vi.mock('../legal/CheckoutConsent', () => ({
  default: () => null,
  useConsentComplete: () => true,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const bundle = {
  code: 'delivery_platforms',
  name: 'Paket Servis Entegrasyonları',
  description: null,
  kind: 'integration',
  billing: 'annual',
  priceCents: 249_900,
  currency: 'TRY',
  creditKind: null,
  creditUnits: null,
  requiresLicense: true,
  sortOrder: 20,
};

beforeEach(() => {
  products = [bundle];
  purchaseAsync.mockReset();
});

describe('CatalogStore — Semt coming-soon row', () => {
  it('renders as the FIRST line of the integration section', () => {
    render(<CatalogStore />);
    const card = screen.getByTestId('semt-coming-soon');
    const list = card.closest('ul')!;
    expect(list.firstElementChild).toBe(card);
  });

  it('still renders when the catalog comes back empty', () => {
    // grouped.size === 0 takes an early return; without a second render site
    // a tenant with a filtered-empty catalog would never learn Semt exists.
    products = [];
    render(<CatalogStore />);
    expect(screen.getByTestId('semt-coming-soon')).toBeInTheDocument();
    expect(screen.getByText('licensing:store.empty')).toBeInTheDocument();
  });

  it('offers no way to buy it', () => {
    render(<CatalogStore />);
    const card = screen.getByTestId('semt-coming-soon');
    expect(within(card).queryByRole('button')).toBeNull();
    expect(within(card).queryByRole('checkbox')).toBeNull();
  });

  it('touches no API and leaves the paid bundle line alone', () => {
    render(<CatalogStore />);
    fireEvent.click(screen.getByTestId('semt-coming-soon'));
    expect(purchaseAsync).not.toHaveBeenCalled();
    // The real, purchasable delivery product is still on the bill.
    expect(document.getElementById('product-delivery_platforms')).not.toBeNull();
  });
});
```

- [ ] **Adım 3: Çalıştır ve kırmızıyı gör**

Çalıştır: `cd /home/tarik/Projects/kds/frontend && npx vitest run src/features/licensing/CatalogStore.semt.test.tsx`

Beklenen: FAIL — dört testin ilk üçü `Unable to find an element by: [data-testid="semt-coming-soon"]` ile patlar.

- [ ] **Adım 4: `SemtComingSoonRow` bileşenini yaz**

`frontend/src/features/licensing/CatalogStore.tsx` içinde, `const LICENCE_CODE = 'license_annual';` satırının **hemen altına**:

```tsx
/**
 * Semt is in the delivery bundle's future, not in the catalog.
 *
 * It has no `marketplace_addons` row, no price and nothing to tick: a
 * published zero-price row would punch straight through purchase()'s payment
 * gate (catalog-validation.ts:242-250). So the storefront advertises it as a
 * static, unbuyable line — no button, no checkbox, no network call.
 */
const SemtComingSoonRow = () => {
  const { t } = useTranslation(['licensing', 'common']);
  return (
    <li
      data-testid="semt-coming-soon"
      className="flex items-start justify-between gap-4 px-4 py-3"
    >
      <div>
        <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
          {t('licensing:store.semt.title')}
        </p>
        <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
          {t('licensing:store.semt.description')}
        </p>
      </div>
      <span className="shrink-0 rounded-full bg-sky-50 px-2.5 py-0.5 text-xs font-medium text-sky-700 ring-1 ring-inset ring-sky-200/60 dark:bg-sky-950/40 dark:text-sky-300">
        {t('licensing:store.semt.badge')}
      </span>
    </li>
  );
};
```

- [ ] **Adım 5: İki render noktasına bağla**

`grouped.size === 0` erken dönüşünü (satır 183-185) şununla değiştir:

```tsx
  if (grouped.size === 0) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-gray-500">{t('licensing:store.empty')}</p>
        {/* Second render site, and not optional: a tenant whose filtered
            catalog is empty takes this branch and would otherwise never see
            that Semt is coming. */}
        <ul className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 bg-white dark:divide-gray-800 dark:border-gray-800 dark:bg-gray-900">
          <SemtComingSoonRow />
        </ul>
      </div>
    );
  }
```

ve bölüm döngüsündeki `<ul …>`'un **ilk çocuğu** olarak (satır 209 civarı, `{grouped.get(kind)!.map(…)}`'in hemen üstü):

```tsx
              {kind === 'integration' && <SemtComingSoonRow />}
```

- [ ] **Adım 6: Çalıştır, yeşili gör, mevcut suite'i de koştur**

```bash
cd /home/tarik/Projects/kds/frontend && npx vitest run src/features/licensing
```
Beklenen: `CatalogStore.semt.test.tsx` 4/4 PASS **ve** mevcut `CatalogStore.test.tsx` değişmeden yeşil (Semt satırı bir `<li>` ekler ama hiçbir fiyat/toplam iddiasına dokunmaz).

- [ ] **Adım 7: i18n ve tip kapıları, commit**

```bash
cd /home/tarik/Projects/kds && node scripts/check-i18n-parity.mjs && node scripts/check-i18n-value-drift.mjs --gate-new scripts/i18n-value-drift-baseline.json
cd /home/tarik/Projects/kds/frontend && npx tsc --noEmit -p tsconfig.json
cd /home/tarik/Projects/kds
git add frontend/src/features/licensing/CatalogStore.tsx \
        frontend/src/features/licensing/CatalogStore.semt.test.tsx \
        frontend/src/i18n/locales/tr/licensing.json \
        frontend/src/i18n/locales/en/licensing.json \
        frontend/src/i18n/locales/ru/licensing.json \
        frontend/src/i18n/locales/ar/licensing.json \
        frontend/src/i18n/locales/uz/licensing.json
git commit -m "feat(store): mağazada satın alınamaz Semt bilgi kartı (dolu ve boş katalog dalları)"
```

---

## Görev 9: Pazarlama yüzeyleri — "her platform ayrı satılır" iddiaları

**Files:**
- Modify: `frontend/src/marketing/data/faq.ts` (satır 32)
- Modify: `frontend/src/marketing/data/integrations.ts` (satır 42-68)
- Modify: `frontend/src/marketing/data/modules.ts` (satır 253)
- Modify: `frontend/src/pages/LandingPage.tsx` (satır 89)
- Modify: `frontend/src/marketing/data/moduleContent.generated.ts` (satır 1-2 başlık notu; 1147, 1153-1154, 1156, 1215)
- Test: `frontend/src/marketing/data/moduleContent.test.ts` + tam `npx vitest run src/marketing`

**Interfaces:**
- Consumes: yok — bunlar saf içerik dosyaları. `integrations.ts:17`'deki `IntegrationStatus = "entegre" | "yakinda"` union'ı **değişmez**; Semt zaten var olan `"yakinda"` değerini kullanır.
- Produces: yok (aşağı yönde tüketen kod yok).

- [ ] **Adım 1: `faq.ts:32`'deki olgusal olarak yanlış cümleyi düzelt**

`frontend/src/marketing/data/faq.ts` satır 32'deki cevabın **ikinci cümlesini** ("Platform entegrasyonu yıllık ücretli bir kalemdir…" ile başlayan) şununla değiştir; ilk cümle ve son cümle **aynen kalır**:

```ts
    a: "Evet. Yemeksepeti, Getir, Trendyol Yemek ve Migros Yemek siparişleri tek panelde toplanır; siparişleri ayrı ayrı ekranlarda takip etmek zorunda kalmazsınız. Dört platform tek bir yıllık kalemde satılır: Paket Servis Entegrasyonları (lisans ön koşuluyla) — platform başına ayrı ücret yoktur. Semt entegrasyonu yakında geliyor ve ücretsiz dahil edilecek. Entegrasyon açmadan da siparişleri POS’a kendiniz girip aynı adisyon akışında toplayabilirsiniz — sipariş yönetimi ücretsiz çekirdeğin parçasıdır.",
```

- [ ] **Adım 2: `integrations.ts`'te dört markanın notunu güncelle ve Semt'i ekle**

`frontend/src/marketing/data/integrations.ts` satır 42-68 arasındaki `brands` dizisini şununla değiştir:

```ts
    brands: [
      {
        name: "Yemeksepeti",
        status: "entegre",
        note: "Tek pakette dört platform",
        logo: "/brand/logos/yemeksepeti.png",
      },
      {
        name: "Getir",
        status: "entegre",
        note: "Tek pakette dört platform",
        logo: "/brand/logos/getir.png",
      },
      {
        name: "Trendyol Yemek",
        status: "entegre",
        note: "Tek pakette dört platform",
        logo: "/brand/logos/trendyol.png",
      },
      // v3.6.8: Migros is no longer the odd one out. The three per-platform
      // SKUs folded into `delivery_platforms` (₺2.499/yr) and Migros is one of
      // the four vendors it grants — which matches what the domain-wide route
      // gate (`@RequiresIntegration("delivery")`, no provider) always did.
      {
        name: "Migros Yemek",
        status: "entegre",
        note: "Tek pakette dört platform",
        logo: "/brand/logos/migros.png",
      },
      {
        name: "Semt",
        status: "yakinda",
        note: "Entegrasyon yakında — ücretsiz",
      },
    ],
```

`IntegrationStatus` union'ına (satır 17) **dokunma** — `"yakinda"` zaten tanımlı.

- [ ] **Adım 3: `modules.ts` ve `LandingPage.tsx` satırlarına Semt "yakında" ibaresi ekle**

`frontend/src/marketing/data/modules.ts` satır 253:

```ts
      "Yemeksepeti, Getir, Trendyol Yemek ve Migros Yemek tek panelde (Semt yakında)",
```

`frontend/src/pages/LandingPage.tsx` satır 89:

```ts
  "Yemeksepeti/Getir/Trendyol/Migros tek panelde, Semt yakında",
```

- [ ] **Adım 4: `moduleContent.generated.ts`'in dört bayat iddiasını elle düzelt**

Dosya başlığı "AUTO-GENERATED … regenerate" diyor; deep-dive workflow'unu yeniden koşturmak **kapsam dışıdır** (§9 A6 takip işi olarak kayıtlı). Satır 1-2'yi şununla değiştir:

```ts
// AUTO-GENERATED by the deep-dive workflows. Rich, honesty-verified TR module
// copy for /ozellikler/:slug. Do not edit by hand — regenerate.
// v3.6.8: teslimat paketi satırları elle düzeltildi (regenerate ederken koru).
```

Satır 1146 `subtitle` (üç platform sayan):

```ts
      subtitle:
        "Yemeksepeti, Getir, Trendyol Yemek ve Migros Yemek'ten gelen paket siparişler, e-Fatura entegratörünüz, partner ekranlarınız ve online tahsilat aynı çatı altında. Ayrı tabletler, elle yeniden giriş ve dağınık sistemler yerine tek, düzenli bir akış.",
```

Satır 1153 blok başlığı ve 1154 gövdesi:

```ts
        title: "Dört teslimat platformu, tek paket, tek sipariş paneli",
        body: "Yemeksepeti, Getir, Trendyol Yemek ve Migros Yemek gerçek üretim adaptörleriyle entegredir ve dördü birden tek bir yıllık kalemde gelir: Paket Servis Entegrasyonları (lisans ön koşuluyla). Platform başına ayrı ücret yoktur; hangisini kullanıyorsanız aynı paketle açarsınız. Her platformun ayrı tabletine bakıp siparişi elle adisyona geçirmek yerine, bağladığınız kanallardan gelen siparişler HummyTummy'nin tek paneline akar; otomatik olarak sisteme düşer ve mutfak ekranına işlenir. Çok şubeli işletmelerde her şube kendi platform hesaplarıyla eşleşir, böylece gelen her sipariş ait olduğu şubenin mutfağına yönlendirilir. Entegrasyonu canlıya almadan önce sandbox simülatörüyle tüm akışı gerçek sipariş göndermeden deneyebilir, her şeyin doğru çalıştığını görebilirsiniz. Semt entegrasyonu yakında geliyor ve pakete ücretsiz dahil edilecek.",
```

Satır 1156 (bullets'ın ilk maddesi):

```ts
          "Yemeksepeti, Getir, Trendyol Yemek ve Migros Yemek için gerçek üretim adaptörleri",
```

Satır 1215 (SSS cevabı):

```ts
        a: "Yemeksepeti, Getir, Trendyol Yemek ve Migros Yemek. Dördü de gerçek üretim adaptörleriyle çalışır ve gelen siparişler tek panelde birleşir. Dördü tek bir yıllık kalemde satılır: Paket Servis Entegrasyonları (lisans ön koşuluyla) — platform başına ayrı ücret yoktur. Semt yakında, ücretsiz.",
```

- [ ] **Adım 5: Pazarlama suite'ini çalıştır**

Çalıştır: `cd /home/tarik/Projects/kds/frontend && npx vitest run src/marketing`

Beklenen: PASS. `moduleContent.test.ts` 17 modülün tamamını render eder; bir tırnak/kaçış hatası burada patlar.

- [ ] **Adım 6: Tip kapısı ve commit**

```bash
cd /home/tarik/Projects/kds/frontend && npx tsc --noEmit -p tsconfig.json
cd /home/tarik/Projects/kds
git add frontend/src/marketing/data/faq.ts \
        frontend/src/marketing/data/integrations.ts \
        frontend/src/marketing/data/modules.ts \
        frontend/src/marketing/data/moduleContent.generated.ts \
        frontend/src/pages/LandingPage.tsx
git commit -m "docs(marketing): teslimat metinleri tek pakete çevrildi, Semt yakında olarak eklendi"
```

---

## Görev 10: Ürün dokümantasyonu, sunumlar ve landing (D1-D5)

**Files:**
- Modify: `docs/PAZARLAMACI_REHBERI.md` (satır 84-86, satır 91)
- Modify: `docs/SISTEM_TANITIMI.md` (satır 90)
- Modify: `presentation/HummyTummy_Presentation_TR.md` (satır 575-577, 643-644, 646)
- Modify: `presentation/HummyTummy_Presentation_EN.md` (satır 576-578, 640-641, 642, 704, 707, 827)
- Modify: `landing/src/i18n/messages/{tr,en,ru,ar,uz}.json` (`platforms.items` dizisi, ~695-752), `landing/public/llms.txt` (satır 5, 11)
- Test: aşağıdaki grep kapıları

**Interfaces:**
- Consumes (Görev 1): tek paket fiyatı **₺2.499**, dört sağlayıcı, ürün adı **"Paket Servis Entegrasyonları"**.
- Produces: yok — bunlar yaprak yüzeylerdir. **Hiçbirini bağlayan test yoktur** (§9 A4 bir `scripts/check-price-drift.mjs` öneriyor, bu PR'ın kapsamı değil), bu yüzden görevin sonundaki grep kapıları tek güvencedir.

> ⚠️ **Üç PR aynı iki dosyada buluşuyor.** `docs/SISTEM_TANITIMI.md`'ye kartlı vardiya `:86`'nın altına, 3D baskı `:97`'nin altına satır ekleyecek; `docs/PAZARLAMACI_REHBERI.md`'ye kartlı vardiya `:75`'in altına ve `:110-114` tablosunun ardına, 3D baskı `:114` tablosunun içine ekleyecek. **Tabloları bütünüyle yeniden üretmek YASAK** — yalnız burada adı geçen satırları düzenle. Merge sırası: bu PR → kartlı vardiya → 3D baskı.

- [ ] **Adım 1: `docs/PAZARLAMACI_REHBERI.md` üç satırı tek satıra indir**

Satır 84-86'daki üç tablo satırını **tek** satırla değiştir:

```md
| Paket Servis Entegrasyonları | **₺2.499** | Yemeksepeti, Getir, Trendyol Yemek ve Migros Yemek siparişleri otomatik POS ve mutfağa düşer |
```

- [ ] **Adım 2: Aynı dosyada 91. satırdaki artık yanlış cümleyi değiştir**

"Teslimat entegrasyonları birikir: müşteri üç platformu da alabilir, hepsi tek mutfak akışına düşer." cümlesini **sil** ve yerine yaz:

```md
Teslimat artık tek kalem: dört platform (Yemeksepeti, Getir, Trendyol Yemek, Migros Yemek) tek ₺2.499'luk pakette gelir, platform başına ayrı ücret yoktur. Semt entegrasyonu yakında ve pakete **ücretsiz** dahil edilecek.
```

- [ ] **Adım 3: `docs/SISTEM_TANITIMI.md` satır 90'ı düzelt — tablonun geri kalanına DOKUNMA**

Satır 90:

```md
| Yemeksepeti / Getir / Trendyol Yemek | entegrasyon / yıllık | her biri ₺2.490 |
```

şununla değişir ve **hemen altına** Semt notu eklenir:

```md
| Paket Servis Entegrasyonları (Yemeksepeti, Getir, Trendyol Yemek, Migros Yemek) | entegrasyon / yıllık | ₺2.499 |
| Semt | entegrasyon / — | yakında, ücretsiz |
```

**Tablonun geri kalanı v3.6.7 ile zaten günceldir** (`:82` Bakım/Destek ₺4.900, `:84` Stok ₺3.900, ayrı öncelikli-destek / e-Fatura satırı yok). Dokunma.

- [ ] **Adım 4: `presentation/HummyTummy_Presentation_TR.md` — yalnız teslimat rakamları**

Satır 575-577'deki üç satır **tek** satıra:

```md
| Paket Servis (Yemeksepeti, Getir, Trendyol Yemek, Migros Yemek) | 2.499₺/yıl | Siparişler otomatik POS ve mutfağa düşer |
```

Satır 643-644'teki iki satır (`| Yemeksepeti | 2.490₺/yıl |` + `| Getir | 2.490₺/yıl |`) **tek** satıra:

```md
| Paket Servis (dört platform) | 2.499₺/yıl |
```

Satır 646'daki toplam `12.360₺/yıl` → **`9.879₺/yıl`** (4.900 + 2.499 + 1.490 + 990).

**₺4.900 lisans rakamları bu dosyada zaten doğrudur — düzeltme.**

- [ ] **Adım 5: `presentation/HummyTummy_Presentation_EN.md` — beş nokta**

- Satır 576-578'deki üç satır tek satıra: `| Delivery Platforms (Yemeksepeti, Getir, Trendyol Yemek, Migros Yemek) | ₺2.499/year |`
- Satır 640-641'deki iki satır tek satıra: `| Delivery Platforms (all four) | ₺2.499 |`
- Satır 642 toplamı `₺15.070` → **`₺12.589`** (4.900 + 3.900 + 2.499 + 1.290)
- Satır 704: "Each platform is a separate ₺2.490/year integration — buy only the ones you sell on" → `All four platforms come in one ₺2.499/year package`
- Satır 707: "₺4.900 maintenance & support + ₺2.490 per platform" → `₺4.900 maintenance & support + ₺2.499 for all delivery platforms`
- Satır 827: "delivery-platform integrations are ₺2.490/year each" → `the delivery-platform package is ₺2.499/year for all four`

- [ ] **Adım 6: Landing — marka listelerine Semt, FİYAT YAZMA**

`landing/` içinde teslimat **fiyatı yoktur** (grep ile doğrulandı: `2.490`/`249000` eşleşmesi sıfır). Yalnız marka listeleri var.

Beş `landing/src/i18n/messages/<loc>.json` dosyasında `platforms.items` dizisinin **sonuna** beşinci girdiyi ekle (her dilde kendi dilinde):

- tr: `{ "name": "Semt", "description": "Semt entegrasyonu yakında — hazır olduğunda ücretsiz açılacak." }`
- en: `{ "name": "Semt", "description": "The Semt integration is coming soon — it will be enabled free of charge when ready." }`
- ru: `{ "name": "Semt", "description": "Интеграция Semt скоро — она будет включена бесплатно, когда будет готова." }`
- ar: `{ "name": "Semt", "description": "تكامل Semt قريبًا — سيتم تفعيله مجانًا عندما يصبح جاهزًا." }`
- uz: `{ "name": "Semt", "description": "Semt integratsiyasi tez orada — tayyor bo'lganda bepul yoqiladi." }`

`landing/public/llms.txt` satır 11'de dört markanın sayıldığı cümlenin sonuna ekle: `Semt integration coming soon (free).` Satır 5'e **dokunma** (arama sorgusu listesi, marka envanteri değil).

- [ ] **Adım 7: Grep kapısı — bu beş yüzeyde bayat rakam kalmadığını kanıtla**

Filtre **marka adına** göre yapılır, "api" kelimesine göre DEĞİL: `| Fiyat | ₺2.490,00 |` gibi bir satır `api_access` bölümüne ait olsa bile kendi üzerinde "api" yazmaz, o yüzden kelime filtresi yanlış pozitif üretir.

```bash
cd /home/tarik/Projects/kds && set -o pipefail
grep -rn "2\.490\|2,490" docs/SISTEM_TANITIMI.md docs/PAZARLAMACI_REHBERI.md presentation/ \
  | grep -iE "yemeksepeti|getir|trendyol|migros|teslimat|delivery|paket servis|per platform|her biri"
```
Beklenen: **çıktı yok**. Hayatta kalan her `₺2.490`, `API & Webhook Erişimi` kalemine aittir ve **doğrudur**.

```bash
grep -rn "12\.360\|15\.070" docs/ presentation/
```
Beklenen: **çıktı yok** — iki bayat toplam da düzeltilmiş olmalı (`9.879₺` ve `₺12.589`).

```bash
grep -rn "her biri ₺2\|ayrı ayrı satılır\|Teslimat entegrasyonları birikir" docs/
```
Beklenen: **çıktı yok** — "platform başına" anlatısının `docs/` içinde kalıntısı olmamalı.

- [ ] **Adım 8: D4 — üretilmiş PDF'i bilinen bayat olarak kaydet**

`HummyTummy-Ozellikler-Sunumu.pdf` (repo kökü) `presentation/` kaynaklarından üretilmiş **bayat bir ikilidir** ve otomasyonu yoktur. Adım 4-5'ten sonra yeniden üretilmesi gerekir; bu **elle yapılacak iş** olarak PR açıklamasına yazılır:

```bash
cd /home/tarik/Projects/kds && ls -la HummyTummy-Ozellikler-Sunumu.pdf
```
PR gövdesine şu satırı ekle: `[ ] HummyTummy-Ozellikler-Sunumu.pdf presentation/ kaynaklarından yeniden üretilecek (otomasyon yok, elle iş).`

- [ ] **Adım 9: Commit**

```bash
cd /home/tarik/Projects/kds
git add docs/PAZARLAMACI_REHBERI.md docs/SISTEM_TANITIMI.md \
        presentation/HummyTummy_Presentation_TR.md \
        presentation/HummyTummy_Presentation_EN.md \
        landing/src/i18n/messages/tr.json landing/src/i18n/messages/en.json \
        landing/src/i18n/messages/ru.json landing/src/i18n/messages/ar.json \
        landing/src/i18n/messages/uz.json landing/public/llms.txt
git commit -m "docs(pricing): iç dokümanlar, sunumlar ve landing tek pakete ve 2.499 TL'ye hizalandı"
```

---

## Görev 11: Portal dokümantasyonu — developer (4 dosya) ve help (18 yüzey)

**Files:**
- Modify: `developer/pages/tr/developer/marketplace-api.mdx` (satır 141-143), `developer/pages/en/developer/marketplace-api.mdx` (satır 142-144)
- Modify: `developer/pages/tr/reference/plan-matrix.mdx` (satır 108-110 + hemen ardındaki `<Callout type="info">`), `developer/pages/en/reference/plan-matrix.mdx` (satır 109-111 + Callout)
- Modify: `help/pages/tr/plans/index.mdx` (86-88) · `help/pages/en/plans/index.mdx` (88-90)
- Modify: `help/pages/tr/plans/choosing-and-upgrading.mdx` (31, 54) · `help/pages/en/plans/choosing-and-upgrading.mdx` (30, 53)
- Modify: `help/pages/tr/plans/feature-matrix.mdx` (48) · `help/pages/en/plans/feature-matrix.mdx` (48)
- Modify: `help/pages/tr/marketplace/index.mdx` (70-72) · `help/pages/en/marketplace/index.mdx` (68-70)
- Modify: `help/pages/tr/marketplace/products.mdx` (173-212) · `help/pages/en/marketplace/products.mdx` (175-210)
- Modify: `help/pages/tr/marketplace/purchase-flow.mdx` (76-77) · `help/pages/en/marketplace/purchase-flow.mdx` (76-77)
- Modify: `help/pages/tr/admin-guide/online-orders.mdx` (12, 19-20) · `help/pages/en/admin-guide/online-orders.mdx` (12, 19-20)
- Modify: `help/pages/tr/admin-guide/index.mdx` (71) · `help/pages/en/admin-guide/index.mdx` (71)
- Modify: `help/pages/tr/admin-guide/settings.mdx` (37) · `help/pages/en/admin-guide/settings.mdx` (37)
- Test: aşağıdaki grep kapıları

**Interfaces:**
- Consumes (Görev 1): kod `delivery_platforms`, fiyat **₺2.499 / `249900`**, dört vendor id (`yemeksepeti`, `getir`, `trendyol_yemek`, `migros`), grant anahtarları `integration.delivery` + `feature.deliveryIntegration`, `requiresLicense: true`, dep yok.
- Produces: yok.

> ⚠️ `help/pages/{tr,en}/marketplace/products.mdx` **üç PR'ın da düzenlediği** bir dosyadır: bu PR `tr:173-212`'yi tek bölüme **daraltıyor**, kartlı vardiya `tr:95`'ten sonra yeni bölüm açıyor, 3D baskı `tr:343/:345`'e yeni bölüm ekliyor. Bu PR daralttığı an sonraki her mutlak satır numarası kayar — sonra merge olan PR kendi çıpalarını **içerik eşlemesiyle** yeniden çözer.

- [ ] **Adım 1: Developer portalı — `marketplace-api.mdx` (iki dil)**

`developer/pages/tr/developer/marketplace-api.mdx` satır 141-143'teki üç satırı şununla değiştir:

```md
| `delivery_platforms` | integration | yıllık | ₺2.499 (`249900`) | `integration.delivery` += `yemeksepeti`, `getir`, `trendyol_yemek`, `migros`; `feature.deliveryIntegration` | ✅ | — |
| `delivery_yemeksepeti` | — | — | v3.6.8 arşivlendi — `delivery_platforms` içine alındı | — | — | — |
| `delivery_getir` | — | — | v3.6.8 arşivlendi — `delivery_platforms` içine alındı | — | — | — |
| `delivery_trendyol_yemek` | — | — | v3.6.8 arşivlendi — `delivery_platforms` içine alındı | — | — | — |
```

`developer/pages/en/developer/marketplace-api.mdx` satır 142-144 için aynı yapı, İngilizce:

```md
| `delivery_platforms` | integration | annual | ₺2,499 (`249900`) | `integration.delivery` += `yemeksepeti`, `getir`, `trendyol_yemek`, `migros`; `feature.deliveryIntegration` | ✅ | — |
| `delivery_yemeksepeti` | — | — | archived in v3.6.8 — folded into `delivery_platforms` | — | — | — |
| `delivery_getir` | — | — | archived in v3.6.8 — folded into `delivery_platforms` | — | — | — |
| `delivery_trendyol_yemek` | — | — | archived in v3.6.8 — folded into `delivery_platforms` | — | — | — |
```

Kolon sayısını mevcut tablo başlığıyla eşleştir — üç eski kod **silinmez**, `priority_support` desenindeki gibi arşiv satırına dönüşür.

- [ ] **Adım 2: Developer portalı — `plan-matrix.mdx` (iki dil) ve UNION anlatısı**

`developer/pages/tr/reference/plan-matrix.mdx` satır 108-110 → tek satır:

```md
| `delivery_platforms` | ₺2.499/yıl | `integration.delivery` += `yemeksepeti`, `getir`, `trendyol_yemek`, `migros`; `feature.deliveryIntegration` | ✅ |
```

Hemen ardındaki `<Callout type="info">` ("Üç `delivery_*` ürünü aynı `integration.delivery` anahtarına yazar…") şununla değişir:

```md
<Callout type="info">
Teslimat artık **tek** ürün: `delivery_platforms` `integration.delivery` anahtarına dört vendor id'sini birden yazar. UNION katlaması hâlâ geçerlidir ama artık yalnız `fiscal_*` ailesinde gözlemlenir (lisansın `["efatura"]`'sı ile `fiscal_hugin`'in `["hugin"]`'i birleşir). Teslimat kapısı zaten alan-geneliydi (`@RequiresIntegration("delivery")`, sağlayıcı taşımaz) — tek paket satılanı gerçekte teslim edilenle hizalar.
</Callout>
```

`developer/pages/en/reference/plan-matrix.mdx` satır 109-111 ve Callout için aynısının İngilizcesi ("All three `delivery_*` products write to the same…" cümlesi yerine tek ürün + UNION yalnız `fiscal_*` anlatısı).

- [ ] **Adım 3: Help — `plans/index.mdx` (iki dil)**

`help/pages/tr/plans/index.mdx` satır 86-88 → tek satır:

```md
| Paket Servis Entegrasyonları | **₺2.499** | Yemeksepeti, Getir, Trendyol Yemek ve Migros Yemek siparişleri otomatik olarak POS ve mutfağa düşer (Semt yakında, ücretsiz) |
```

`help/pages/en/plans/index.mdx` satır 88-90 → tek satır:

```md
| Delivery Platform Integrations | **₺2,499** | Yemeksepeti, Getir, Trendyol Yemek and Migros Yemek orders flow automatically into the POS and the kitchen (Semt coming soon, free) |
```

- [ ] **Adım 4: Help — `plans/choosing-and-upgrading.mdx` satırı VE paket toplamı (iki dil)**

`tr:31` → `| Yemeksepeti / Getir / Trendyol / Migros siparişlerinin mutfağa düşmesi | Paket Servis Entegrasyonları | ₺2.499 (dört platform) |`
`en:30` → `| Yemeksepeti / Getir / Trendyol / Migros orders reaching the kitchen | Delivery Platform Integrations | ₺2,499 (all four) |`

`tr:54` toplamı `₺9.460` → **`₺8.889`** ve kalem adı: `Lisans + Paket Servis + Çağrı-ID`
`en:53` toplamı `₺9,460` → **`₺8,889`** ve kalem adı: `Licence + Delivery Platforms + Caller-ID`

(4.900 + 2.499 + 1.490 = 8.889.)

- [ ] **Adım 5: Help — `plans/feature-matrix.mdx:48` (iki dil)**

tr: `| Teslimat entegrasyonu | Paket Servis Entegrasyonları (Yemeksepeti · Getir · Trendyol Yemek · Migros Yemek) | ₺2.499 |`
en: `| Delivery integration | Delivery Platform Integrations (Yemeksepeti · Getir · Trendyol Yemek · Migros Yemek) | ₺2,499 |`

- [ ] **Adım 6: Help — `marketplace/index.mdx` üç tablo satırı tek satıra (iki dil)**

`tr:70-72` → `| Paket Servis Entegrasyonları | Entegrasyon | Yıllık | ₺2.499,00 | Yemeksepeti, Getir, Trendyol Yemek ve Migros Yemek siparişleri otomatik olarak POS ve mutfağa |`
`en:68-70` → `| Delivery Platform Integrations | Integration | Annual | ₺2,499.00 | Yemeksepeti, Getir, Trendyol Yemek and Migros Yemek orders flow automatically into the POS and kitchen |`

- [ ] **Adım 7: Help — `marketplace/products.mdx` üç ürün bölümü tek bölüme (iki dil)**

`help/pages/tr/marketplace/products.mdx` satır 173-212 arasındaki üç bölümü (`### Yemeksepeti Entegrasyonu`, `### Getir Entegrasyonu`, `### Trendyol Yemek Entegrasyonu` — her biri kendi `| Fiyat | ₺2.490,00 |` satırıyla, sırasıyla `:181`, `:193`, `:205`) **tek** bölümle değiştir:

```md
### Paket Servis Entegrasyonları

| Alan | Değer |
|---|---|
| Kod | `delivery_platforms` |
| Tür | Entegrasyon |
| Faturalama | Yıllık |
| Fiyat | ₺2.499,00 |
| Lisans gerekir | Evet |

Yemeksepeti, Getir, Trendyol Yemek ve Migros Yemek siparişleri otomatik olarak POS ve mutfağa düşer. Dört platform tek pakette; platform başına ayrı ücret yoktur. **Semt** entegrasyonu yakında geliyor ve pakete ücretsiz dahil edilecek.
```

Bölümün kapanış `<Callout>`'undaki **"Her platform ayrı bir kalemdir ve ayrı fiyatlanır."** cümlesini **sil**.

`help/pages/en/marketplace/products.mdx` satır 175-210 için aynı sadeleştirme (fiyat `₺2,499.00`), ve kapanış Callout'undaki **"…each platform is a separate line item…"** cümlesini **sil**.

Diğer `₺2.490,00` satırları (`tr:133` / `en:135` — `api_access`) **DOĞRUDUR, dokunma**.

- [ ] **Adım 8: Help — `marketplace/purchase-flow.mdx:76-77` (iki dil)**

Cümledeki **teslimat** ibaresini sil; birikme kuralı `fiscal_*` için doğru kalır:

tr: `Entegrasyonlar (e-Fatura, ÖKC, Çağrı-ID, SMS) → hepsi yan yana birikir; aynı anda birden çok entegrasyon kullanabilirsiniz. Teslimat artık tek pakettir: `delivery_platforms` dört platformu birden açar.`
en: `Integrations (e-invoice, fiscal printer, caller-ID, SMS) → they stack; you can run several at once. Delivery is now a single package: `delivery_platforms` unlocks all four platforms.`

- [ ] **Adım 9: Help — `admin-guide/online-orders.mdx` :12 ve :19-20 (iki dil)**

`tr:12` → `**Gereksinim:** `deliveryIntegration` — **Paket Servis Entegrasyonları** (₺2.499/yıl, dört platform; lisans ön koşuluyla).`
`en:12` → `**Requires:** `deliveryIntegration` — the **Delivery Platform Integrations** package (₺2,499/year, all four platforms; licence prerequisite).`

`:19-20` Callout'undaki "Katalogda … ayrı ayrı satılır" / "…sold separately…" cümlesi:

tr: `Katalogda tek bir kalem vardır: Paket Servis Entegrasyonları (₺2.499/yıl). Yemeksepeti, Getir, Trendyol Yemek ve Migros Yemek bu tek pakette gelir. Semt yakında, ücretsiz.`
en: `The catalogue carries a single line: Delivery Platform Integrations (₺2,499/year). Yemeksepeti, Getir, Trendyol Yemek and Migros Yemek all come in that one package. Semt is coming soon, free.`

- [ ] **Adım 10: Help — `admin-guide/index.mdx:71` ve `admin-guide/settings.mdx:37` (iki dil)**

`admin-guide/index.mdx:71`:
tr → `| Online Sipariş (teslimat platformları) | `deliveryIntegration` | Paket Servis Entegrasyonları — **2.499 ₺/yıl** (Yemeksepeti, Getir, Trendyol Yemek, Migros Yemek — dört platform tek pakette; Semt yakında, ücretsiz) |`
en → `| Online Ordering (delivery platforms) | `deliveryIntegration` | Delivery Platform Integrations — **₺2,499/year** (Yemeksepeti, Getir, Trendyol Yemek, Migros Yemek — all four in one package; Semt coming soon, free) |`

`admin-guide/settings.mdx:37`: aynı düzeltme, o satırın kolon yapısına uyarlanmış (`Teslimat platformları (Yemeksepeti/Getir/Trendyol Yemek/Migros Yemek, Semt yakında)` + `Paket Servis Entegrasyonları — 2.499 ₺/yıl`).

`:32-33` satırları (`API & Webhook Erişimi` ₺2.490) **DOĞRUDUR, dokunma**.

- [ ] **Adım 11: Grep kapısı — portallarda bayat teslimat rakamı kalmadı**

Kapı 1 — marka adına göre filtrele, "api" kelimesine göre DEĞİL. `help/pages/tr/marketplace/products.mdx:133`'teki satır tam olarak `| Fiyat | ₺2.490,00 |`'dır: `api_access` bölümüne aittir ama satırın kendisinde "api" geçmez, dolayısıyla kelime filtresi onu yanlış pozitif olarak raporlar.

```bash
cd /home/tarik/Projects/kds && set -o pipefail
grep -rn "2\.490\|2,490" help/pages developer/pages \
  | grep -iE "yemeksepeti|getir|trendyol|migros|teslimat|delivery|paket servis"
```
Beklenen: **çıktı yok**.

Kapı 2 — üç ürün bölümünün gerçekten tek bölüme indiğini kanıtla (bu, kapı 1'in göremeyeceği çıplak `| Fiyat | ₺2.490,00 |` satırlarını yakalar: bölüm kalkınca fiyat satırı da kalkar).

```bash
grep -rn "### Yemeksepeti Entegrasyonu\|### Getir Entegrasyonu\|### Trendyol Yemek Entegrasyonu\|### Yemeksepeti Integration\|### Getir Integration\|### Trendyol Yemek Integration" help/pages
```
Beklenen: **çıktı yok** — üçü de `### Paket Servis Entegrasyonları` / `### Delivery Platform Integrations` içinde eridi.

Kapı 3 — "platform başına" anlatısının kalıntısı yok.

```bash
grep -rniE "her biri|ayrı ayrı satılır|separate line item|each platform is a separate|per platform|\(each\)" help/pages developer/pages \
  | grep -iE "delivery|teslimat|yemeksepeti|getir|trendyol|migros"
```
Beklenen: **çıktı yok**.

Kapı 4 — bayat paket toplamı yok.

```bash
grep -rn "9\.460\|9,460" help/pages
```
Beklenen: **çıktı yok** (`₺8.889` / `₺8,889` ile değiştirildi).

Kapı 5 — yeni kod adı gerçekten yazıldı.

```bash
grep -rln "delivery_platforms" developer/pages help/pages
```
Beklenen: en az `developer/pages/tr/developer/marketplace-api.mdx`, `developer/pages/en/developer/marketplace-api.mdx`, `developer/pages/tr/reference/plan-matrix.mdx`, `developer/pages/en/reference/plan-matrix.mdx`, `help/pages/tr/marketplace/products.mdx`, `help/pages/en/marketplace/products.mdx`, `help/pages/tr/marketplace/purchase-flow.mdx`, `help/pages/en/marketplace/purchase-flow.mdx`.

- [ ] **Adım 12: Commit**

```bash
cd /home/tarik/Projects/kds
git add developer/pages help/pages
git commit -m "docs(portal): geliştirici ve yardım portallarında teslimat tek pakete indi"
```

---

## Görev 12: e2e senaryosu, operatör prosedürü ve tam kapı taraması

**Files:**
- Modify: `backend/test/licensing.e2e-spec.ts` (yeni `describe` bloğu)
- Test: `cd backend && npm run test:e2e` + tüm CI kapıları

**Interfaces:**
- Consumes (Görev 1): `delivery_platforms` kodu ve dört vendor id'si.
- Consumes (Görev 4): DTO'nun `@IsIn(AVAILABLE_DELIVERY_PLATFORMS)` daraltması.
- Consumes (mevcut e2e yardımcıları): `bootHttpApp()`, `resetDb(prisma)`, `seedLiveTenant(prisma)`, `loginAs(app, email, password)`, `upsertProduct(prisma, {...})`, `ownProduct(prisma, tenantId, addOnId)`, `grantLicence(prisma, tenantId)`, `project(app, tenantId)`.
- Produces: yok — bu son görev.

> e2e ortamı `prisma db push` kullanır ve **migration SQL'ini hiç çalıştırmaz**. Migration davranışı bu yüzden e2e ile değil, **Görev 3**'ün gidiş-dönüş prosedürüyle kanıtlanır. Buradaki senaryo yalnız katalog satırının ve DTO kapısının canlı rayda ne yaptığını gösterir.

- [ ] **Adım 1: e2e senaryosunu yaz**

`backend/test/licensing.e2e-spec.ts`'in sonuna, mevcut `describe`'ın **dışına** yeni bir blok ekle:

```ts
/**
 * The delivery package, end to end.
 *
 * Two claims are only checkable here. First, that ONE purchase lights up all
 * four vendors — the observable proof that Migros needed no SKU of its own,
 * which is the whole argument for collapsing three products into one. Second,
 * that Semt is refused at the DTO before any config row can exist, because
 * the enum now contains it and @IsEnum would have waved it straight through.
 */
describe("Delivery bundle (HTTP, real DB, real guards)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenant: Awaited<ReturnType<typeof seedLiveTenant>>;
  let token: string;

  beforeAll(async () => {
    ({ app, prisma } = await bootHttpApp());
    await resetDb(prisma);
    tenant = await seedLiveTenant(prisma);
    await grantLicence(prisma, tenant.tenantId);
    const bundle = await upsertProduct(prisma, {
      code: "delivery_platforms",
      name: "Paket Servis Entegrasyonları",
      kind: "integration",
      priceCents: 249_900,
      grants: {
        "integration.delivery": [
          "yemeksepeti",
          "getir",
          "trendyol_yemek",
          "migros",
        ],
        "feature.deliveryIntegration": true,
      },
      requiresLicense: true,
    });
    await ownProduct(prisma, tenant.tenantId, bundle.id);
    await project(app, tenant.tenantId);
    token = await loginAs(app, tenant.email, tenant.password);
  });

  afterAll(async () => {
    await app.close();
  });

  it("grants all four vendors from the single package", async () => {
    const res = await request(app.getHttpServer())
      .get("/api/v1/entitlements/me")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    // The engine folds integration.* with UNION and returns them sorted.
    expect(res.body.integrations["integration.delivery"]).toEqual([
      "getir",
      "migros",
      "trendyol_yemek",
      "yemeksepeti",
    ]);
    expect(res.body.features.deliveryIntegration).toBe(true);
  });

  it("opens the delivery settings route", async () => {
    await request(app.getHttpServer())
      .get("/api/delivery-platforms/configs")
      .set("Authorization", `Bearer ${token}`)
      .set("X-Branch-Id", tenant.branchId)
      .expect(200);
  });

  it("refuses a config for the coming-soon platform", async () => {
    await request(app.getHttpServer())
      .post("/api/delivery-platforms/configs")
      .set("Authorization", `Bearer ${token}`)
      .set("X-Branch-Id", tenant.branchId)
      .send({ platform: "SEMT", credentials: { apiKey: "x" } })
      .expect(400);
  });

  it("accepts a Migros config — the observable proof that the package covers it", async () => {
    await request(app.getHttpServer())
      .post("/api/delivery-platforms/configs")
      .set("Authorization", `Bearer ${token}`)
      .set("X-Branch-Id", tenant.branchId)
      .send({ platform: "MIGROS", credentials: { apiKey: "x" } })
      .expect(201);
  });
});
```

- [ ] **Adım 2: e2e'yi çalıştır**

Çalıştır: `cd /home/tarik/Projects/kds/backend && npm run test:e2e -- licensing`

Beklenen: PASS. `seedLiveTenant`'ın döndürdüğü alan adı `branchId` değilse (helper `backend/test/helpers/e2e-db.ts:165`'te tanımlı) doğru alan adını oradan oku ve testte onu kullan — uydurma.

- [ ] **Adım 3: Backend tam taraması**

```bash
cd /home/tarik/Projects/kds/backend && set -o pipefail && npx jest --silent && npx tsc --noEmit && npm run lint:ci
```
Beklenen: hepsi yeşil. `npm run lint` **kullanma** — `--fix` uygular ve hatayı gizler.

- [ ] **Adım 4: Frontend tam taraması**

```bash
cd /home/tarik/Projects/kds/frontend && npx vitest run && npx tsc --noEmit -p tsconfig.json
```
Beklenen: hepsi yeşil.

- [ ] **Adım 5: Sözleşme ve i18n kapıları**

```bash
cd /home/tarik/Projects/kds
node scripts/check-contract-drift.mjs
node scripts/check-i18n-parity.mjs
node scripts/check-i18n-value-drift.mjs --gate-new scripts/i18n-value-drift-baseline.json
```
Beklenen: üçü de 0 ile çıkar. Value-drift kırmızıysa **baseline'ı şişirme**, çeviriyi düzelt.

- [ ] **Adım 6: Operatör prosedürünü PR gövdesine yaz (R15 + R16)**

Bu iki madde koda girmez, deploy'a girer. PR açıklamasına aynen ekle:

```md
## Deploy prosedürü — atlanamaz

**1. Uçuş-öncesi kilit (R15).** `INTENT_TTL_HOURS = 48`. Migration, emekliye ayrılan
bir SKU'yu adlandıran ödenmiş-ama-provision-edilmemiş bir checkout intent varken
`RAISE EXCEPTION` ile çalışmayı reddeder. Deploy penceresini düşük trafikli saate al
ve **önceden** prod'da şunu çalıştır:

    SELECT count(*) FROM checkout_intents ci
     WHERE ci.status IN ('pending','succeeded') AND ci."provisionedAt" IS NULL
       AND (ci."expiresAt" IS NULL OR ci."expiresAt" > NOW())
       AND EXISTS (SELECT 1 FROM jsonb_array_elements(ci."cartJson"->'items') it
                    WHERE it->>'code' IN ('delivery_yemeksepeti','delivery_getir','delivery_trendyol_yemek'));

Sıfır dönene kadar bekle (en fazla 48 saat), sonra deploy et. **Kilit kaldırılmaz** —
kaldırmak sessiz para/hizmet uyuşmazlığını geri getirir (kart çekilir, provision reddedilir,
otomatik iade rayı yoktur).

**2. Yıl dönümü gelmiş açık döngüler (R16).** Migration yalnız **gelecek** yıl dönümlü açık
döngüleri siler. Deploy'dan önce prod'da şunu çalıştır:

    SELECT rc.id, rc."tenantId", rc."anniversaryAt", rc."totalCents" FROM renewal_cycles rc
     WHERE rc.status='open' AND rc."paymentRef" IS NULL
       AND rc."anniversaryAt" <= NOW() + INTERVAL '1 day'
       AND EXISTS (SELECT 1 FROM jsonb_array_elements(rc."cartJson"->'items') it
                    WHERE it->>'code' IN ('delivery_yemeksepeti','delivery_getir','delivery_trendyol_yemek'));

Liste **boş olmalıdır**. Boş değilse operatör her satır için ya döngüyü elle `cancelled`
yapıp yeni yıl dönümü döngüsünü bekler ya da farkı elle tahsil eder. Bu satırlar
migration tarafından **silinmez**: silinseydi hem fatura hem de `lapseUnpaidCycles`
tetikleyicisi yok olur, kiracı ödediği yetkiyi süresiz bedava kullanırdı.

**3. Sıfır-satır varsayımı (R17).** Bugün canlı ödeyen kiracı yoktur; yukarıdaki iki sorgu
da 0 dönmelidir. Bu bir **varsayımdır, garanti değil**. Sıfırdan farklı dönen olursa
deploy durur ve 1./2. prosedür işletilir. "Nasılsa boş" diyerek atlamak, bu değişikliğin
kapattığı para/hizmet uyuşmazlığını geri getirir.

**4. Elle reprojection GEREKMEZ.** Mülkiyet taşındığında projektör kaynağı
`addon:<eski_kod>:<id>`'den `addon:delivery_platforms:<id>`'ye kayar. Gece 03:15
reconcile (`plan-projector.service.ts`, `@Cron("15 3 * * *")`) bayat kaynağı süpürür;
deploy sonrası `POST /superadmin/entitlements/reproject` çağırmaya gerek yoktur.
Grant kesintisi de olmaz: projektör `TenantAddOn`'u katalog satırının `status`'una
bakmadan okur, arşivli satır döngü ortasında hiçbir şeyi kapatmaz.

**5. Elle yapılacak iş.** `HummyTummy-Ozellikler-Sunumu.pdf` `presentation/` kaynaklarından
yeniden üretilecek (otomasyon yok).

**6. Merge sırası.** Bu PR → kartlı vardiya → 3D baskı. `alacarte-catalog-migration.spec.ts`
katlama mekanizmasının ve `introduced` hesabının sahibi bu PR'dır.
```

- [ ] **Adım 7: Manuel duman testi — çalışan uygulama**

- `/admin/settings/online-orders`: beş kart görünür, Semt en sonda, "Yakında · Ücretsiz" rozeti var, aç/kapat kapalı, karta tıklayınca **açılmıyor**.
- `/admin/store`: `integration` bölümünün ilk satırı "Semt (yakında)" bilgi kartı, buton/onay kutusu yok, "Paket Servis Entegrasyonları ₺2.499" satırı normal biçimde satın alınabilir.
- POS teslimat gelen-kutusu: filtre çipleri `Tümü / Yemeksepeti / Getir / Trendyol / Migros` — **Semt çipi YOK**.
- Dili `en`, `ru`, `ar`, `uz` yap: hiçbir ekranda Türkçe metin kalmadığını doğrula.

- [ ] **Adım 8: Son commit**

```bash
cd /home/tarik/Projects/kds
git add backend/test/licensing.e2e-spec.ts
git commit -m "test(delivery): paketin dört vendor'ü açtığı ve Semt'in 400 aldığı gerçek DB üzerinde kanıtlandı"
```

---

## Self-Review

**Spec coverage**

| Spec bölümü / gereksinim | Görev |
|---|---|
| §1.1, §4.1 tek paket SKU'su + fiyat + grants | 1 |
| §1.2 Migros ayrı SKU değil, pakete dahil | 1 (grants), 5 (köprü testi), 12 (e2e kanıtı) |
| §1.3 üç kod arşivlenir + `RETIRED_ADDON_CODES` | 1 (sabit), 2 (SQL) |
| §1.4 / §2 K5b / §4.2 mülkiyet geçişi | 2 (3a/3b/3c), 3 (kanıt) |
| §1.5 Semt = ücretsiz/yakında, katalog satırı yok | 4 (sözlük), 5 (satılmadığı testi), 8 (vitrin) |
| §2 K1-K10 kararları | 1, 2, 4, 6 |
| §3 A1-A22, B1-B21, C1, E1-E6 çıpaları | ilgili görevlerin adım gövdelerinde satır numaralarıyla |
| §4.3 üç katmanlı fail-closed (DTO / fabrika / simülatör) | 4 |
| §4.4 frontend (types, ayarlar, PlatformCard, mağaza, POS) | 6, 7, 8 |
| §4.2 son paragraf: projektör kaynağı kayar, 03:15 reconcile süpürür, elle reproject yok | 12 Adım 6 (PR gövdesi madde 4) |
| §4.5 para akışı değişmez | değişiklik yok — Görev 2 katalog satırı dışında hiçbir raya dokunmuyor |
| §3 B16 `seed-demo.ts` SEMT eklenmez · §1 "ne ÇIKMIYOR" listesi · §3 C1 (T4 uygulanmaz) | Global Constraints "DOKUNULMAYACAKLAR" |
| §5 B1-B15 backend dosyaları | 1 (B1, B6, B12-B15), 2 (B2-B5), 4 (B7-B11) |
| §5 F1-F9 frontend dosyaları | 6 (F1, F4, F4b, F9), 7 (F2, F2b, F3), 8 (F5), 9 (F6, F7, F8, F8b) |
| §5 T1-T5 i18n (5 locale) | 1 (T4 katalog i18n), 7 (T1-T3 settings), 8 (T5 licensing) |
| §5 D1-D7 doküman süpürmesi | 10 (D1-D5), 11 (D6-D7) |
| §6.1 migration up (adım 0/1/2a/2b/3a/3b/3c/4) | 2 |
| §6.2 down.sql | 2 |
| §6.3 idempotanlık + gidiş-dönüş (adım 0-9) | 3 |
| §7 T1 catalog-validation invaryantı | 1 |
| §7 T2 drift spec katlaması + `introduced` + 8 yeni test | 2 |
| §7 T3 platform.enum.spec | 4 |
| §7 T4 adapter-factory.spec | 4 |
| §7 T5 platform-config.dto.spec | 4 |
| §7 T6 delivery-bundle.spec | 5 |
| §7 T7 delivery-test.service.spec | 4 |
| §7 T8 kds-tablet-limit.spec (etkilenir, değişmez) | 1 Adım 6 |
| §7 T9 DeliveryPlatformsSettingsPage.test | 7 |
| §7 T10 PlatformCard.test | 7 |
| §7 T11 CatalogStore.semt.test | 8 |
| §7 T12 licensing e2e | 12 |
| §7 sözleşme/CI kapıları | 6 (drift), 7 + 8 (i18n), 12 (tam tarama) |
| §8 R1-R2, R5 (kapsam içi düzeltmeler) | 2, 3 |
| §8 R3 (merge sırası) · R14 (dört değişiklik, ortak dosyalar) | Global Constraints + Görev 2/12 notları |
| §8 R4 snake_case | 2 (yeni tripwire) |
| §8 R6 bayat lisans fiyatı | Global Constraints + Görev 10/11 (₺4.900'e dokunulmaz) |
| §8 R7-R8 (drift guard yok, enum yazma yollarını açar) | 4, 6 |
| §8 R9-R11 (fiyat reklamı, pazarlama, gelir etkisi) | 9, 10, 11 |
| §8 R15 (48 saatlik pencere) · R16 (elle mutabakat) · R17 (sıfır-satır varsayımı) | 3 Adım 5/6 + 12 Adım 6 |
| §9 A1-A7 kapsam dışı | görev yok, aşağıda gerekçelendirildi |

**Spec'te olup göreve dönüşmeyenler (ve nedeni)**

- **§9 A1** Semt'in alan-geneli teslimat kapısından muafiyeti — bugün var olmayan bir vendor→enum haritası gerekiyor; Semt entegrasyonu PR'ının ilk işi. Görev 5'in `delivery-bundle.spec.ts`'i eşlemeyi şimdiden pinliyor, yani o PR bir çıpayla başlıyor.
- **§9 A2** Semt adaptörü / webhook / menü senkronu / sandbox host'u — spec'te açıkça kapsam dışı.
- **§9 A3** katalogda para birimi boyutu — `priceCents` tek para birimi varsayıyor; çok-ülkeli iş aynı dalda ama ayrı plan.
- **§9 A4** fiyat reklamı için drift testi (`scripts/check-price-drift.mjs`) — spec kapsam dışı diyor. Bu değişikliğin 24 elle düzenlenen yüzeyi maliyeti kanıtlıyor; Görev 10/11'in grep kapıları yerine geçmiyor, yalnız bu turu koruyor.
- **§9 A5** `20260811100000_alacarte_catalog/down.sql`'in bayatlığı — üç aşamalı geri sarma zincirinin belgelenmesi ayrı iş.
- **§9 A6** `moduleContent.generated.ts` üretecinin kaynak istemi — Görev 9 dosyayı elle düzeltiyor ve başlığa koruma notu yazıyor; üreteci güncellemek ayrı iş.
- **§9 A7** uçuş-öncesi kilidin yeniden kullanılabilir bir parçacığa genelleştirilmesi — bu migration'a özel kaldı; sonraki emeklilik işinin ilk maddesi.
- **§5 D4** kök dizindeki `HummyTummy-Ozellikler-Sunumu.pdf`'in yeniden üretimi — otomasyonu yok, göreve çevrilemez; Görev 10 Adım 8 ve Görev 12 Adım 6 bunu PR gövdesinde **elle yapılacak iş** olarak kayda geçiriyor.

**Öz-denetimin yakaladığı ve düzelttiği şeyler**

1. **Spec'in test kodunda gerçek bir hata vardı.** §7 T2'deki `expect(down).not.toMatch(/"cancelledAt"\s*=\s*NULL/)` iddiası, `down.sql`'in **doğru** satırında da eşleşiyor: `"cancelledAt" = NULLIF(...)` — `NULL`, `NULLIF`'in ön ekidir. Yazıldığı gibi bırakılsaydı test doğru kodu suçlar ve uygulayıcıyı down'ı bozmaya iterdi. Görev 2 Adım 4'te negatif ileri-bakışla düzeltildi: `/"cancelledAt"\s*=\s*NULL(?![A-Z])/`, gerekçesi test yorumunda.
2. **`onlineOrders.availability.comingSoonNote` anahtarının render yeri yoktu.** Spec (§5 T3) anahtarı beş dile tanımlıyor ama §4.4 onu hiçbir yere basmıyor — parity'yi geçen, hiç görünmeyen bir anahtar. Görev 7 Adım 11 ona bir render sitesi verdi (açıklama satırının altında `text-xs text-sky-700` notu) ve Adım 7'deki test onu iddia ediyor.
3. **F4b'nin satır içi ifadesi test edilemezdi.** Spec `PLATFORM_FILTERS`'ı `PendingOrdersPanel.tsx` içinde satır içi filtreyle tanımlıyor; o dosya export etmediği için kural yalnız tam panel render'ıyla (çok sayıda mock) sınanabilirdi. Görev 6 kuralı `platformDisplay.ts`'te `ORDERABLE_PLATFORM_KEYS` olarak dışa aldı — aynı davranış, üç satırlık bir birim testiyle kanıtlanabilir hâlde. Panel yalnız onu tüketiyor.
4. **Migration damgası çakışması — çözüldü.** Ağaçta çok-ülkeli işten gelen `20260820130000_widen_money_decimal_precision` var; spec bunu bilmiyordu ve bu migration'a da `20260820130000` veriyordu. Çakışma **yeniden numaralandırmayla** kapatıldı: klasör `20260820140000_delivery_platforms_bundle` oldu ve yeni damga altı spec+plan dosyasında da güncellendi. Sıralama şansına (Prisma'nın klasörleri ada göre sıralamasına) dayanan eski gerekçe kaldırıldı; artık iki damga farklıdır. Zincirin kalanı bir basamak kaydı: kartlı vardiya `150000`/`160000`, 3D baskı `170000`.
5. **e2e helper alan adı belirsizliği.** `tenant.branchId` `seedLiveTenant`'ın dönüşünden okunuyor; Görev 12 Adım 2 uygulayıcıya alan adını helper'dan **okumasını** (uydurmamasını) söylüyor.
6. **`IsEnum` / `DeliveryPlatform` ölü importları.** DTO ve `delivery-test.service.ts` daraltıldıktan sonra eski import kullanılmayabilir; Görev 4 Adım 11 ve 15 bunu açıkça söylüyor, aksi hâlde `lint:ci` `no-unused-vars` ile patlardı.
7. **Görev 1'in bilinçli kırmızısı belgelendi.** Katalog sabiti değişince `alacarte-catalog-migration.spec.ts` zorunlu olarak kırmızıya döner. Bu, gizlenmek yerine Görev 1 Adım 13'te **iki testin tam adı ve hata metniyle** kayda geçirildi ve Görev 2'nin giriş koşulu ilan edildi; Görev 2 Adım 5 ise kendi başarısız testini (`ENOENT`) ayrıca üretiyor.
8. **İki doküman grep kapısı yanlış pozitif üretiyordu.** İlk yazımda süpürme kapıları `| grep -iv "api\|webhook"` ile filtreleniyordu, ama `help/pages/tr/marketplace/products.mdx:133` satırı tam olarak `| Fiyat | ₺2.490,00 |`'dır — `api_access` bölümüne aittir, satırın kendisinde "api" geçmez, dolayısıyla kapı her koşuda kırmızı raporlardı ve uygulayıcı doğru bir satırı "düzeltmeye" giderdi. Görev 10 Adım 7 ve Görev 11 Adım 11 **marka adına göre** filtreleyecek biçimde yeniden yazıldı, ve Görev 11'e üç ürün başlığının gerçekten eridiğini kanıtlayan ikinci bir kapı eklendi (çıplak fiyat satırlarını yakalar).
9. **`createConfig.mutateAsync`'e iddia edilemiyordu.** `PlatformCard.test.tsx`'in `mutationStub`'ı her render'da taze bir `mutateAsync` üretiyor; `handleToggleEnabled` ise `mutate` değil `mutateAsync` çağırıyor. İlk yazımdaki "never calls createConfig" testi bu yüzden **boş bir iddiaydı** (hiçbir platformda çağrılmayan bir fn'i kontrol ediyordu). Görev 7 Adım 7 mock'a hoisted bir `createMutateAsync` ekliyor, gerçek yolu (header tıklaması, canlı bir `div`) kullanıyor, ve guard'ın toptan kapatıcı olmadığını kanıtlayan bir **MIGROS kontrol vakası** ekliyor.
10. **Üç "dokunulmayacak" yüzey açıkça yazıldı.** Spec bunları dağınık yerlerde söylüyordu; Global Constraints'e tek blokta toplandı: `seed-demo.ts:1711-1718` (SEMT demo config'i üretilmez), `catalog-validation.ts:242-250` (sıfır-fiyat doğrulayıcısı), `update-platform-config.dto.ts`, ve `entitlement-keys.const.ts` (§3 C1 — yeni anahtar yok, 14 noktalı feature-flag senkronu **uygulanmaz**).
11. **§4.2'nin son paragrafı hiçbir göreve düşmüyordu.** "Projektör kaynağı kayar, 03:15 reconcile bayat kaynağı süpürür, elle reproject gerekmez" bilgisi bir kod adımı değil bir **deploy bilgisi**; Görev 12 Adım 6'daki PR gövdesine 4. madde olarak eklendi.

**Placeholder taraması:** "TBD", "TODO", "sonra doldur", "uygun hata yönetimi ekle", "edge case'leri ele al", "yukarıdakiler için test yaz", "Görev N'e benzer" — **sıfır eşleşme**. Her kod adımı gerçek kod taşıyor; tekrar eden bloklar (örn. `SemtComingSoonRow`'un iki render sitesi, üç handler guard'ı) her seferinde **tam olarak** yazıldı, "yukarıdaki gibi" denmedi. Tek "sonra yapılacak" ifadeleri §9'un kapsam-dışı maddeleri ve D4'ün PDF'i — ikisi de spec'te kapsam dışı ilan edilmiş ve yukarıda gerekçelendirilmiş durumda.

**Tip tutarlılığı**

- `PLATFORM_AVAILABILITY` — Görev 4'te backend'de `Readonly<Record<DeliveryPlatform, PlatformAvailability>>`, Görev 6'da frontend'de `Record<string, PlatformAvailability>` olarak üretiliyor; Görev 6 (POS), Görev 7 (PlatformCard) tüketiyor. İsim iki tarafta **aynı**, drift muhafızı (Görev 6) enum üyelerini karşılaştırıyor.
- `AVAILABLE_DELIVERY_PLATFORMS` — Görev 4'te üretiliyor; Görev 4 (DTO, simülatör) ve Görev 5 (köprü testi) tüketiyor. `isPlatformAvailable` yalnız Görev 4'ün fabrika kapısında kullanılıyor.
- `ORDERABLE_PLATFORM_KEYS` — Görev 6'da üretiliyor, aynı görevde `PendingOrdersPanel` tüketiyor. Başka ad varyantı (`orderablePlatforms`, `ACTIVE_PLATFORM_KEYS`) planda **geçmiyor**.
- `BUNDLE_UP` / `BUNDLE_DOWN` / `insertedLater` / `introduced` — hepsi Görev 2'de üretiliyor ve yalnız aynı dosyada tüketiliyor; kartlı vardiya PR'ı için sözleşme olarak Görev 2'nin **Interfaces** bloğunda adlarıyla ilan edildi.
- `SemtComingSoonRow` — Görev 8'de üretiliyor, aynı dosyada iki yerde tüketiliyor; export edilmiyor, `data-testid="semt-coming-soon"` çıpası testte birebir aynı.
- `comingSoon` yerel bayrağı — Görev 7 içinde tanımlanıp aynı bileşende beş yerde kullanılıyor; `isComingSoon` gibi bir varyant planda yok.
- Migration damga adları — `migratedFrom`, `migratedPriorStatus`, `migratedPriorCancelledAt`, `migratedPriorEndedAt`, `migration:20260820140000_delivery_platforms_bundle`: Görev 2'nin up'ı, down'ı, tripwire'ları ve Görev 3'ün psql iddiaları **birebir aynı** dizeleri kullanıyor.
- Katalog `i18n` metinleri — Görev 1'in `t(...)` çağrısı ile Görev 2'nin jsonb literali **aynı beş metni** taşıyor (Özbekçe apostrof migration tarafında `to''rtta` olarak ikiye katlanmış hâliyle).

**Doğal sevkiyat sınırı:** Görev 1-5 (backend katalog + migration + sözlük) tek başına tutarlı ve gönderilebilir — satılan şey doğru, kapılar kapalı. Görev 6-8 vitrini, Görev 9-11 anlatıyı hizalar. Görev 12 hepsinin kapısıdır ve **atlanamaz**: fiyat reklamı yüzeylerini bağlayan hiçbir test yoktur, bu yüzden Görev 10/11'in grep kapıları tek güvencedir.
