# Kartlı vardiya modülü (`module_personnel_card_shift`) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** RFID kart okutarak personel giriş-çıkışı damgalayan gerçek bir yazılım rayı ile onu satan ₺4.000 tek seferlik katalog ürününü, mevcut `Attendance` modellerinin üstüne kurarak ve satışı bugün patlatacak iki latent hatayı aynı PR'da kapatarak çıkarmak.

**Architecture:** Üç katman. **(1)** Ucuz USB HID okuyucu, kart UID'sini klavye gibi bir input'a yazar; istasyon ekranı `POST /personnel/attendance/card-tap`'e gönderir. **(2)** `CardShiftService` yalnız "hangi kullanıcı, hangi eylem" sorusunu çözer (peppered HMAC ile UID→kullanıcı, 10 sn debounce, toggle) ve mevcut `AttendanceService.clockIn/clockOut/breakEnd` metotlarını çağırır — geç kalma, mola, fazla mesai, gece aşan vardiya ve P2002 yarış korumaları olduğu gibi devralınır; paralel bir devam sistemi kurulmaz. **(3)** Ticari taraf katalog satırı + `feature.cardShift` grant'i + `card_reader` donanım SKU'sudur; satın alma yolu çalışsın diye vitrin `deps`'i görür ve provizyon rütbe içinde topolojik sıralanır.

**Tech Stack:** NestJS + Prisma + Postgres (backend), React + TanStack Query + i18next (frontend), jest / vitest, hand-written reversible SQL migrations.

**Spec:** `docs/superpowers/specs/2026-08-20-kartli-vardiya-modulu-design.md`

## Global Constraints

- **Bu değişiklik zincirin 2. halkasıdır ve İKİNCİ merge olur:** Change 1 (teslimat paketi) → **bu PR** → Change 3 (3D baskı). Yetkili migration zinciri: `20260820100000_tenant_country_code` (mevcut) → `20260820120000_reprice_licence_and_stock` (mevcut) → `20260820130000_widen_money_decimal_precision` (mevcut) → `20260820140000_delivery_platforms_bundle` (Change 1) → **`20260820150000_card_shift_schema` (Change 2a)** → **`20260820160000_card_shift_catalog` (Change 2b)** → `20260820170000_print3d_service` (Change 3). `20260820130000` ve `20260820140000` **bu PR'da kullanılmaz** — biri çok-ülkeli işin, öbürü Change 1'in damgasıdır.
- **İki ön koşul düzeltmesi (Görev 2 ve Görev 3) katalog satırından ÖNCE gelir.** Bunlar olmadan satır satılırsa: kart alınır, PayTR settle eder, `purchase()` "requires: module_personnel" fırlatır, Serializable tx geri sarılır → **para alınmış, hiçbir şey verilmemiş, iade rayı yok**.
- Kart UID'si **düz metin saklanmaz**. Saklanan: `ENCRYPTION_MASTER_KEY`'den türeyen pepper ile HMAC-SHA256 (`staffcard:v1:<tenantId>:<UID>`) + AES-256-GCM geri döndürülebilir kopya (AAD `staffcard:v1:<tenantId>:<userId>`) + yalnız son 4 hane.
- Hiçbir yanıt, hiçbir log, hiçbir uç ham UID veya hash taşımaz. Tanınmayan kart → `404 CARD_NOT_RECOGNISED`; log'da yalnız `tenantId` + `last4`.
- Fiyatlar **KDV-DAHİL brüt**: `module_personnel_card_shift` = `priceCents: 400_000` (₺4.000, tek seferlik), donanım SKU = `129_000` (₺1.290). Üstüne %20 **eklenmez**.
- `sortOrder: 18`. `maxQuantity` **verilmez**. `deps: ["module_personnel"]`, `requiresLicense: true`, `grants: { "feature.cardShift": true }`.
- Metot düzeyinde `@RequiresFeature(...)` sınıf düzeyini **ezer** (`entitlement.guard.ts:62-66`) — bu yüzden `card-tap` ucunda **iki bayrak birden** tek çağrıda listelenir.
- **`SubscriptionPlan` tablosuna yeni feature kolonu EKLENMEZ** (K7): projektör plan satırından tek bir feature kolonu okumuyor.
- Her migration **tersine çevrilebilir up/down çifti**: `migration.sql` + `down.sql`, başlıkta `-- @doctor:idempotent verified=…`. Down idempotent, dar kapsamlı, tam olarak up'ın eklediğini geri alır, ikinci çalıştırmada no-op, operatör/kiracı verisine dokunmaz. Up mümkün olduğunca idempotent (`IF NOT EXISTS`, `ON CONFLICT`).
- **Elle yazılan SQL snake_case `@@map` tablo adı kullanır**: `"users"`, `"attendances"`, `"marketplace_addons"`, `"tenant_addons"`, `"hardware_products"`, `"hardware_inventory"`, `"hardware_order_items"`. PascalCase bir ad CI'da (`db push`) görünmez, yalnız prod deploy'unda 42P01 verir.
- **Katalog drift spec'i (`alacarte-catalog-migration.spec.ts`) YEŞİLDİR (bugün 9/9; Change 1 sekiz tripwire daha ekler → merge sonrası 17, bu PR'dan sonra 20) ve "düzeltilmez"** — yalnız genişletilir. **Ortak dosya:** teslimat satırları, `BUNDLE_UP`/`BUNDLE_DOWN` sabitleri ve `introduced` hesabının biçimi Change 1'e aittir; bu PR onları silmez, yeniden yazmaz. Uygulanmış bir migration dosyası **düzenlenmez** (`prisma migrate deploy` checksum doğrular). `FOLLOW_UP_SQL` girdileri **adıyla** aranır, asla indeksle.
- **`node scripts/check-contract-drift.mjs` Görev 1 ile Görev 8 arasında BEKLENEN biçimde KIRMIZIDIR.** Görev 1 `cardShift`'i `FEATURE_KEYS`'e yazar ama `"feature.cardShift"` grant'ı `alacarte-catalog.const.ts`'e ancak Görev 9'da girer; kapı `unreachable`'ı "FEATURE_KEYS eksi katalog + free-baseline grant'ları" olarak hesapladığı için (`scripts/check-contract-drift.mjs:280-303`) arada kalan her commit'te `feature.cardShift` ulaşılamaz görünür. Bu kapı **Görev 9 tamamlanmadan çalıştırılmaz** ve ara commit'ler **push edilmez** — dal ancak Görev 9'dan sonra yeşile döner.
- Backend testi: `cd /home/tarik/Projects/kds/backend && npx jest <path>`. Backend tipleri: `cd /home/tarik/Projects/kds/backend && npx tsc --noEmit`. **Lint doğrulaması `npm run lint:ci`** — `npm run lint` `--fix` taşır ve hatayı gizler.
- Frontend testi: `cd /home/tarik/Projects/kds/frontend && npx vitest run <path>`. Frontend tipleri: `cd /home/tarik/Projects/kds/frontend && npx tsc --noEmit -p tsconfig.json`.
- Kapılar (repo kökünden): `node scripts/check-i18n-parity.mjs`, `node scripts/check-i18n-value-drift.mjs --gate-new scripts/i18n-value-drift-baseline.json`, `node scripts/check-contract-drift.mjs`.
- Boru hattı kullanırken `set -o pipefail` — yoksa `$?` son aşamanın (ör. `tail`'in) kodudur. Test komutları boru içermez.
- Kullanıcıya görünen her yeni metin beş dile (`tr`, `en`, `ru`, `ar`, `uz`) **gerçek çeviriyle** eklenir. Değerler spec §5/38-41b tablolarında yazılıdır; uygulama anında hiçbiri uydurulmaz. **Hiçbir yeni anahtar `scripts/i18n-value-drift-baseline.json`'a eklenmez.**
- Commit mesajları conventional-commit, Türkçe, scope `card-shift`. **Hiçbir commit'e AI/Claude izi (trailer, "Generated with", Co-Authored-By) eklenmez.**

---

## File Structure

**Yeni**

| Dosya | Sorumluluk |
|---|---|
| `backend/prisma/migrations/20260820150000_card_shift_schema/migration.sql` | `users`'a 6 kart kolonu + unique + FK, `attendances`'a 2 kaynak kolonu. |
| `backend/prisma/migrations/20260820150000_card_shift_schema/down.sql` | Aynı kolonları/indeksleri düşürür; başında zorunlu yedek komutu. |
| `backend/prisma/migrations/20260820160000_card_shift_catalog/migration.sql` | Katalog ürünü + donanım SKU'su + stok satırı. |
| `backend/prisma/migrations/20260820160000_card_shift_catalog/down.sql` | `NOT EXISTS` korumalı silmeler — ödenmiş satıra dokunmaz. |
| `backend/src/modules/personnel/card-uid.ts` | Saf fonksiyonlar: normalize / doğrula / HMAC / last4 / AAD. IO yok. |
| `backend/src/modules/personnel/card-uid.spec.ts` | Normalizasyon, tenant ayrımı, rotasyon dayanıklılığı. |
| `backend/src/modules/personnel/dto/card-shift.dto.ts` | `CardTapDto`, `AssignCardDto` — `whitelist:true` altında açık alanlar. |
| `backend/src/modules/personnel/services/card-shift.service.ts` | Tap toggle + debounce + kart ata/iptal/liste. Devam yazmaz, delege eder. |
| `backend/src/modules/personnel/services/card-shift.service.spec.ts` | Tap davranışı, sızıntı yasağı, delegasyon. |
| `backend/src/modules/personnel/controllers/card-shift.controller.ts` | `/personnel/cards` — ata / iptal / liste. Sınıf düzeyinde iki bayrak. |
| `backend/src/modules/checkout/provision-order.ts` | `KIND_RANK` + rütbe içi Kahn topolojik sıralaması. |
| `backend/src/modules/checkout/provision-order.spec.ts` | Sıralama invariant'ları, döngüde fail-open. |
| `backend/src/modules/licensing/licensing.controller.pricing.spec.ts` | `/v1/catalog/pricing` yanıtının `deps` taşıdığı. |
| `backend/test/card-shift.e2e-spec.ts` | Gerçek Postgres + gerçek guard zinciri. |
| `frontend/src/components/personnel/CardShiftTab.tsx` | Kart atama tablosu (yalnız son 4 hane) + istasyon linki. |
| `frontend/src/components/personnel/CardShiftTab.test.tsx` | Son-4 gösterimi, iptal onayı. |
| `frontend/src/pages/personnel/CardShiftStationPage.tsx` | Kiosk: görünmez daima-odaklı input, büyük sonuç, oturum kilidi. |
| `frontend/src/pages/personnel/CardShiftStationPage.test.tsx` | Enter'da gönderim, temizleme, hata mesajı, yeniden odaklanma. |
| `docs/hardware/10-kart-okuyucu.md` | RFID okuyucu donanım kılavuzu (kılavuzsuz SKU satılmaz). |

**Değişen**

| Dosya | Değişiklik |
|---|---|
| `backend/src/modules/entitlements/entitlement-keys.const.ts` | `FEATURE_KEYS`'e `"cardShift"`. |
| `backend/src/common/constants/subscription.enum.ts` | `PlanFeature.CARD_SHIFT = "cardShift"`. |
| `backend/src/modules/superadmin/dto/update-tenant-overrides.dto.ts` | `FeatureOverridesDto.cardShift`. |
| `backend/src/modules/demo/demo.service.ts` | `ALL_FEATURES`'a `cardShift: true`. |
| `backend/src/modules/entitlements/entitlement-keys.spec.ts` | Çift yönlü pin'e açık `cardShift` iddiası. |
| `backend/prisma/schema.prisma` | `User`: 6 kolon + self-relation + `@@unique` + `@@index`; `Attendance`: 2 kolon. |
| `backend/src/modules/personnel/constants/personnel.enum.ts` | `AttendanceSource`. |
| `backend/src/modules/personnel/dto/attendance-query.dto.ts` | `source?: AttendanceSource`. |
| `backend/src/modules/personnel/services/attendance.service.ts` | `clockIn`/`clockOut` kaynak parametresi, `cardClockIns`, CSV kolonu, `source` filtresi. |
| `backend/src/modules/personnel/services/attendance.service.spec.ts` | CSV başlığı + veri satırı, iki yeni iddia. |
| `backend/src/modules/personnel/controllers/attendance.controller.ts` | `POST card-tap` (metotta iki bayrak). |
| `backend/src/modules/personnel/controllers/attendance.controller.spec.ts` | K15 regresyon kilidi. |
| `backend/src/modules/personnel/personnel.module.ts` | Yeni controller + service kaydı. |
| `backend/src/modules/checkout/checkout.types.ts` | `PricedLineMeta.deps?: string[]`. |
| `backend/src/modules/checkout/quote.service.ts` | Her iki addon dalına `deps: addOn.deps`. |
| `backend/src/modules/checkout/checkout.service.ts` | Elle sıralama yerine `orderAddOnLinesForProvisioning`. |
| `backend/src/modules/checkout/checkout.service.spec.ts` | Sepet sırasından bağımsız provizyon sırası entegrasyon kanıtı. |
| `backend/src/modules/licensing/licensing.controller.ts` | `pricing()` select + yanıtına `deps`. |
| `backend/src/modules/catalog/category-vocabulary.ts` | `card_reader` kategorisi. |
| `backend/src/modules/catalog/dto/create-hardware-product.dto.ts` | `CATEGORY_DEFAULT_SALE_MODE.card_reader`. |
| `backend/src/modules/catalog/category-vocabulary.spec.ts` | Sözlük↔saleMode boşluk testi. |
| `backend/src/modules/marketplace/alacarte-catalog.const.ts` | `module_personnel_card_shift` satırı. |
| `backend/src/modules/marketplace/catalog-validation.spec.ts` | İki yeni invariant testi. |
| `backend/src/modules/marketplace/alacarte-catalog-migration.spec.ts` | `FOLLOW_UP_SQL`'e **bir satır ekleme** (Change 1'in satırı ve `BUNDLE_UP`/`BUNDLE_DOWN` korunur) + `insertedLater` + üç yeni iddia. |
| `backend/prisma/seeds/seed-marketplace.ts` | `PRODUCTS`'a `card-reader-rfid-usb-hid`. |
| `frontend/src/types/index.ts` | `PlanFeatures.cardShift`, `Attendance` kaynak alanları, `AttendanceSummary.cardClockIns`, `CardAssignment`, `CardTapResponse`. |
| `frontend/src/features/superadmin/types.ts` | `cardShift?: boolean`. |
| `frontend/src/pages/superadmin/TenantDetailPage.tsx` | `FEATURE_LABELS.cardShift`. |
| `frontend/src/pages/superadmin/MarketplaceAdminPage.tsx` | Kategori `<select>`'ine `card_reader`. |
| `frontend/src/features/licensing/licensingApi.ts` | `PricingProduct.deps: string[]`. |
| `frontend/src/features/licensing/CatalogStore.tsx` | `depAutoAdded` + bloklu dep durumu. |
| `frontend/src/features/licensing/CatalogStore.test.tsx` | Beş yeni dep testi. |
| `frontend/src/features/personnel/personnelApi.ts` | `useCardAssignments`, `useAssignCard`, `useRevokeCard`, `useCardTap`. |
| `frontend/src/pages/admin/TeamPage.tsx` | Üçüncü sekme "Kartlı Vardiya". |
| `frontend/src/components/personnel/AttendanceTab.tsx` | Kaynak rozeti + özet sütunu. |
| `frontend/src/App.tsx` | `/card-shift` rotası (FeatureGate + UpsellCard). |
| `frontend/src/components/layout/Sidebar.tsx` | Kiosk gezinme girdisi. |
| `frontend/src/i18n/locales/{tr,en,ru,ar,uz}/personnel.json` | `cardShift.*` bloğu (19 anahtar). |
| `frontend/src/i18n/locales/{tr,en,ru,ar,uz}/superadmin.json` | `tenantDetail.featureLabels.cardShift`. |
| `frontend/src/i18n/locales/{tr,en,ru,ar,uz}/subscriptions.json` | `subscriptions.comparison.features.cardShift`. |
| `frontend/src/i18n/locales/{tr,en,ru,ar,uz}/licensing.json` | `store.blocked.dependencyUnavailable`, `store.depAutoAddedNote`. |
| `frontend/src/i18n/locales/{tr,en,ru,ar,uz}/common.json` | `navigation.cardShift`. |
| `docs/SISTEM_TANITIMI.md` | Yanlış "QR/NFC" iddiasının düzeltilmesi + katalog tablosu satırı. |
| `docs/PAZARLAMACI_REHBERI.md` | Modül tablosu satırı + yeni donanım tablosu. |
| `docs/hardware/README.md` | Kılavuz indeksine bağlantı. |
| `developer/pages/{tr,en}/developer/marketplace-api.mdx` | Catalogue summary satırı. |
| `developer/pages/{tr,en}/reference/plan-matrix.mdx` | Modules satırı. |
| `help/pages/{tr,en}/marketplace/products.mdx` | Ürün ansiklopedisi bölümü. |
| `help/pages/{tr,en}/marketplace/index.mdx` | Fiyat tablosu satırı. |
| `help/pages/{tr,en}/plans/index.mdx` | Modül fiyat listesi satırı. |
| `help/pages/{tr,en}/plans/feature-matrix.mdx` | Özellik→ürün→fiyat satırı. |
| `help/pages/{tr,en}/admin-guide/personnel.mdx` | "Kart ile damgalama" alt bölümü. |

---

## Görev 1: Yetenek bayrağı `cardShift` — 8 backend + 3 frontend + 2 i18n ailesi × 5 dil

Yeni bir feature bayrağı bu depoda **13 yerde** yaşar. Eksik kalan her yer sessiz bir hatadır: DTO'da yoksa operatör override'ı `whitelist:true` ile silinir, i18n'de yanlış yolda ise UI beş dilde İngilizce literale düşer, `FEATURE_KEYS`'de yoksa `@RequiresFeature` hiç kimsenin vermediği bir anahtara çözülür ve uç herkese 403 verir.

**Bayrağın adı `cardShift`'in geçtiği TAM liste** (bu görev 1-4 + FE 1-3 + i18n 1-2'yi yazar; 5-8 kendi görevlerinde yazılır ama listeden düşmez):

| # | Yer | Sahibi |
|---|---|---|
| BE 1 | `backend/src/modules/entitlements/entitlement-keys.const.ts` → `FEATURE_KEYS` | **bu görev** |
| BE 2 | `backend/src/common/constants/subscription.enum.ts` → `PlanFeature.CARD_SHIFT` | **bu görev** |
| BE 3 | `backend/src/modules/superadmin/dto/update-tenant-overrides.dto.ts` → `FeatureOverridesDto.cardShift` | **bu görev** |
| BE 4 | `backend/src/modules/demo/demo.service.ts` → `ALL_FEATURES.cardShift` | **bu görev** |
| BE 5 | `backend/src/modules/marketplace/alacarte-catalog.const.ts` → `grants: { "feature.cardShift": true }` | Görev 9 |
| BE 6 | `backend/prisma/migrations/20260820160000_card_shift_catalog/migration.sql` → `'{"feature.cardShift":true}'::jsonb` | Görev 10 |
| BE 7 | `backend/src/modules/personnel/controllers/card-shift.controller.ts` → sınıf `@RequiresFeature(PERSONNEL_MANAGEMENT, CARD_SHIFT)` | Görev 7 |
| BE 8 | `backend/src/modules/personnel/controllers/attendance.controller.ts` → `card-tap` metot `@RequiresFeature(PERSONNEL_MANAGEMENT, CARD_SHIFT)` | Görev 7 |
| FE 1 | `frontend/src/types/index.ts` → `PlanFeatures.cardShift: boolean` | **bu görev** |
| FE 2 | `frontend/src/features/superadmin/types.ts` → `cardShift?: boolean` | **bu görev** |
| FE 3 | `frontend/src/pages/superadmin/TenantDetailPage.tsx` → `FEATURE_LABELS.cardShift` | **bu görev** |
| i18n 1 | `frontend/src/i18n/locales/{tr,en,ru,ar,uz}/superadmin.json` → `tenantDetail.featureLabels.cardShift` | **bu görev** |
| i18n 2 | `frontend/src/i18n/locales/{tr,en,ru,ar,uz}/subscriptions.json` → `subscriptions.comparison.features.cardShift` | **bu görev** |

**Çift yönlü CI pin'i:** `backend/src/modules/entitlements/entitlement-keys.spec.ts` iki yönde de kırılır — `:14-25` `PlanFeature ⊆ FEATURE_KEYS`, `:27-32` fark yalnız `["license"]`. BE 1 ve BE 2 **aynı commit'te** olmak zorundadır; bu görev pin'i önce kırmızıya sürerek bunu kanıtlar.

**Files:**
- Modify: `backend/src/common/constants/subscription.enum.ts` (`PERSONNEL_MANAGEMENT` satırı `:112`'nin hemen ardı)
- Modify: `backend/src/modules/entitlements/entitlement-keys.const.ts` (`FEATURE_KEYS`, `"deliveryIntegration"` yorumundan önce)
- Modify: `backend/src/modules/superadmin/dto/update-tenant-overrides.dto.ts` (`FeatureOverridesDto` sonu)
- Modify: `backend/src/modules/demo/demo.service.ts` (`ALL_FEATURES`)
- Modify: `frontend/src/types/index.ts` (`PlanFeatures`, `personnelManagement` `:1075`'in yanı)
- Modify: `frontend/src/features/superadmin/types.ts` (`aiContentGeneration` `:214`'ün ardı)
- Modify: `frontend/src/pages/superadmin/TenantDetailPage.tsx` (`FEATURE_LABELS` `:47-61`)
- Modify: `frontend/src/i18n/locales/{tr,en,ru,ar,uz}/superadmin.json`, `.../subscriptions.json`
- Test: `backend/src/modules/entitlements/entitlement-keys.spec.ts`

**Interfaces:**
- Consumes: yok (ilk görev)
- Produces: `PlanFeature.CARD_SHIFT` (değeri `"cardShift"`), `FEATURE_KEYS` içinde `"cardShift"` literali, `featureKey(PlanFeature.CARD_SHIFT) === "feature.cardShift"`, FE `PlanFeatures.cardShift: boolean`, i18n yolları `tenantDetail.featureLabels.cardShift` ve `subscriptions.comparison.features.cardShift`

- [ ] **Adım 1: Pin'i tek taraflı kırarak kırmızıya sür — yalnız `PlanFeature`'a ekle**

`backend/src/common/constants/subscription.enum.ts`, `PERSONNEL_MANAGEMENT` satırının hemen ardına:

```ts
  // Paid module: module_personnel_card_shift (₺4.000 one-time). RFID card
  // clock-in on TOP of module_personnel — the guard on /personnel/attendance/
  // card-tap and /personnel/cards/* lists BOTH flags, because a method-level
  // @RequiresFeature OVERRIDES the class-level one (entitlement.guard.ts:62-66)
  // rather than adding to it.
  CARD_SHIFT = "cardShift",
```

- [ ] **Adım 2: Pin'in kırıldığını gör**

Çalıştır: `cd /home/tarik/Projects/kds/backend && npx jest src/modules/entitlements/entitlement-keys.spec.ts`
Beklenen: FAIL — `covers every PlanFeature value` testi `expect(missing).toEqual([])` üzerinde patlar, çıktı `Expected: []` / `Received: ["cardShift"]`.

- [ ] **Adım 3: `FEATURE_KEYS`'e ekle ve pin'i yeşile al**

`backend/src/modules/entitlements/entitlement-keys.const.ts`, paid modules bloğunda `"prioritySupport"` ile `deliveryIntegration` yorumu arasına:

```ts
  /**
   * RFID staff-card clock-in. Granted ONLY by `module_personnel_card_shift`
   * (₺4.000 one-time), which itself depends on `module_personnel` — the card
   * rail writes onto that module's Attendance rows rather than owning any.
   * requiresLicense: true, so a lapsed licence darkens it like every other
   * paid module; the ownership row and the card assignments survive.
   */
  "cardShift",
```

- [ ] **Adım 4: Testi tekrar çalıştır ve geçtiğini gör**

Çalıştır: `cd /home/tarik/Projects/kds/backend && npx jest src/modules/entitlements/entitlement-keys.spec.ts`
Beklenen: PASS — tüm testler yeşil.

- [ ] **Adım 5: Pin'e açık iddiayı yaz (regresyon kilidi)**

`backend/src/modules/entitlements/entitlement-keys.spec.ts`, `it("has no duplicates in any namespace", …)`'ten önce:

```ts
  it("carries cardShift on BOTH sides of the pin", () => {
    // The two implicit assertions above already catch a one-sided add, but
    // only as a diff of two lists — which reads as "some key is missing".
    // This one names the key, so the next person to grep `cardShift` finds
    // the contract instead of inferring it.
    expect(PlanFeature.CARD_SHIFT).toBe("cardShift");
    expect(FEATURE_KEYS as readonly string[]).toContain("cardShift");
    expect(isKnownGrantKey("feature.cardShift")).toBe(true);
    expect(featureKey("cardShift")).toBe("feature.cardShift");
  });
```

- [ ] **Adım 6: Çalıştır ve geçtiğini gör**

Çalıştır: `cd /home/tarik/Projects/kds/backend && npx jest src/modules/entitlements/entitlement-keys.spec.ts`
Beklenen: PASS — `carries cardShift on BOTH sides of the pin` dahil hepsi yeşil.

- [ ] **Adım 7: Superadmin override DTO'suna ekle**

`backend/src/modules/superadmin/dto/update-tenant-overrides.dto.ts`, `aiContentGeneration` alanının ardına:

```ts

  // Not optional decoration: ValidationPipe runs with whitelist:true, so a
  // field that is not declared here is SILENTLY STRIPPED from the body. An
  // operator toggling Card Shift on a tenant would see the switch move and
  // the override never arrive.
  @StringToBoolean()
  @IsOptional()
  @IsBoolean()
  cardShift?: boolean | null;
```

- [ ] **Adım 8: Demo kiracısının yetenek aynasına ekle**

`backend/src/modules/demo/demo.service.ts`, `ALL_FEATURES` içinde `posAccess: true,` satırının ardına:

```ts
    // Card Shift: the demo must be able to open /card-shift like every other
    // screen. The demo owns no products, so the projector has nothing to
    // suppress — this mirror is the only thing that grants it.
    cardShift: true,
```

- [ ] **Adım 9: Backend tarafını derle ve commit'le**

Çalıştır: `cd /home/tarik/Projects/kds/backend && npx tsc --noEmit`
Beklenen: hata yok.

```bash
cd /home/tarik/Projects/kds
git add backend/src/common/constants/subscription.enum.ts backend/src/modules/entitlements/entitlement-keys.const.ts backend/src/modules/entitlements/entitlement-keys.spec.ts backend/src/modules/superadmin/dto/update-tenant-overrides.dto.ts backend/src/modules/demo/demo.service.ts
git commit -m "feat(card-shift): cardShift yetenek anahtarı — backend sözlüğü ve aynaları"
```

> ⚠️ Bu commit'ten itibaren `node scripts/check-contract-drift.mjs` **beklenen biçimde kırmızıdır**: `feature.cardShift` artık `FEATURE_KEYS`'tedir ama onu veren grant (`alacarte-catalog.const.ts`) ancak **Görev 9**'da yazılır, kapı da `unreachable`'ı "FEATURE_KEYS eksi katalog + free-baseline grant'ları" olarak hesaplar (`scripts/check-contract-drift.mjs:280-303`). Kapıyı **Görev 9 bitmeden çalıştırma**; Görev 1–8 arasındaki ara commit'ler **push edilmez**, dal ancak Görev 9'dan sonra yeşile döner.

- [ ] **Adım 10: Frontend `PlanFeatures` tipine ekle**

`frontend/src/types/index.ts`, `personnelManagement: boolean;` satırının hemen ardına:

```ts
  /** Paid — "Kartlı Vardiya" module (`module_personnel_card_shift`, ₺4.000
   *  one-time). RFID card clock-in; rides ON TOP of personnelManagement, so
   *  both flags must be live for the card surfaces to open. */
  cardShift: boolean;
```

- [ ] **Adım 11: Superadmin plan tipine ve etiket haritasına ekle**

`frontend/src/features/superadmin/types.ts`, `aiContentGeneration?: boolean;` satırının ardına:

```ts
  // Card Shift (RFID clock-in) gate. Optional so older cached payloads
  // without the field still typecheck.
  cardShift?: boolean;
```

`frontend/src/pages/superadmin/TenantDetailPage.tsx`, `FEATURE_LABELS` içinde `personnelManagement` satırının ardına:

```ts
  cardShift: 'Card Shift (RFID clock-in)',
```

- [ ] **Adım 12: `tenantDetail.featureLabels.cardShift`'i beş dile ekle**

`TenantDetailPage.tsx:556` `` t(`tenantDetail.featureLabels.${key}`, FEATURE_LABELS[key]) `` çağırıyor — anahtar **`tenantDetail` bloğunun içindedir**, üst düzey `featureLabels` parity'yi geçer ama UI beş dilde de İngilizce literale düşer. Her dosyada `tenantDetail.featureLabels` nesnesine `personnelManagement`'ın ardına ekle:

| Dosya | Değer |
|---|---|
| `frontend/src/i18n/locales/tr/superadmin.json` | `"cardShift": "Kartlı Vardiya (RFID ile damgalama)"` |
| `frontend/src/i18n/locales/en/superadmin.json` | `"cardShift": "Card Shift (RFID clock-in)"` |
| `frontend/src/i18n/locales/ru/superadmin.json` | `"cardShift": "Смена по карте (отметка RFID)"` |
| `frontend/src/i18n/locales/ar/superadmin.json` | `"cardShift": "الوردية بالبطاقة (تسجيل RFID)"` |
| `frontend/src/i18n/locales/uz/superadmin.json` | `"cardShift": "Karta bilan smena (RFID bilan qayd)"` |

Mevcut `tenantDetail.featureLabels.*` satırları ru/ar/uz'da İngilizce taşıyor ve `scripts/i18n-value-drift-baseline.json:245+` içinde baseline'lı. **Yeni anahtar gerçek çeviri taşır ve baseline'a EKLENMEZ** — eklenirse `--gate-new` kapısının anlamı kalmaz.

- [ ] **Adım 13: `subscriptions.comparison.features.cardShift`'i beş dile ekle**

`subscriptions.features` **bir string'dir** ("Özellikler") — oraya nesne yazmak string/nesne çakışması yaratır. Doğru yol `subscriptions.comparison.features`. Her dosyada o nesneye `personnelManagement`'ın ardına ekle:

| Dosya | Değer |
|---|---|
| `frontend/src/i18n/locales/tr/subscriptions.json` | `"cardShift": "Kart ile giriş-çıkış"` |
| `frontend/src/i18n/locales/en/subscriptions.json` | `"cardShift": "Card clock-in/out"` |
| `frontend/src/i18n/locales/ru/subscriptions.json` | `"cardShift": "Отметка прихода/ухода по карте"` |
| `frontend/src/i18n/locales/ar/subscriptions.json` | `"cardShift": "تسجيل الدخول/الخروج بالبطاقة"` |
| `frontend/src/i18n/locales/uz/subscriptions.json` | `"cardShift": "Karta bilan kelish-ketish qaydi"` |

- [ ] **Adım 14: i18n kapılarını ve tipleri çalıştır**

Çalıştır (üçü ayrı ayrı, boru yok):
```bash
cd /home/tarik/Projects/kds && node scripts/check-i18n-parity.mjs
cd /home/tarik/Projects/kds && node scripts/check-i18n-value-drift.mjs --gate-new scripts/i18n-value-drift-baseline.json
cd /home/tarik/Projects/kds/frontend && npx tsc --noEmit -p tsconfig.json
```
Beklenen: parity 0 eksik anahtar; value-drift yeni anahtar için ihlal yok (beş değer birbirinden farklı); tsc hatasız.

- [ ] **Adım 15: Frontend tarafını commit'le**

```bash
cd /home/tarik/Projects/kds
git add frontend/src/types/index.ts frontend/src/features/superadmin/types.ts frontend/src/pages/superadmin/TenantDetailPage.tsx frontend/src/i18n/locales/tr/superadmin.json frontend/src/i18n/locales/en/superadmin.json frontend/src/i18n/locales/ru/superadmin.json frontend/src/i18n/locales/ar/superadmin.json frontend/src/i18n/locales/uz/superadmin.json frontend/src/i18n/locales/tr/subscriptions.json frontend/src/i18n/locales/en/subscriptions.json frontend/src/i18n/locales/ru/subscriptions.json frontend/src/i18n/locales/ar/subscriptions.json frontend/src/i18n/locales/uz/subscriptions.json
git commit -m "feat(card-shift): cardShift bayrağının frontend ve i18n aynaları"
```

---

## Görev 2: Ön koşul (a) — vitrin `deps`'i görüyor

**Bugün latent.** `/v1/catalog/pricing` `deps` seçmiyor, `PricingProduct` tipinde alan yok ve `CatalogStore` yalnız lisansı sepete kendiliğinden ekliyor. Kartlı vardiya kataloğun **ilk modül→modül bağımlılığıdır**; düzeltilmezse müşteri kart satırını işaretler, `module_personnel` sepete girmez, `assertDeps` intent'te 409 verir ve sepetin tamamı ölür.

`/v1/me/licensing` katalog select'i **değişmez**: oradaki `buildPurchasability` dep kuralı çalıştırmıyor ve çalıştırmamalı — aynı kuralın ikinci bir kopyası `assertDeps` ile ayrışırdı.

**Files:**
- Modify: `backend/src/modules/licensing/licensing.controller.ts` (`pricing()`, select `:204-218`, yanıt `:221-236`)
- Create: `backend/src/modules/licensing/licensing.controller.pricing.spec.ts`
- Modify: `frontend/src/features/licensing/licensingApi.ts` (`PricingProduct`, `:112-126`)
- Modify: `frontend/src/features/licensing/CatalogStore.tsx`
- Modify: `frontend/src/features/licensing/CatalogStore.test.tsx`
- Modify: `frontend/src/i18n/locales/{tr,en,ru,ar,uz}/licensing.json`
- Test: yukarıdaki iki spec

**Interfaces:**
- Consumes: yok
- Produces: `/v1/catalog/pricing` yanıt nesnesinde `deps: string[]`; FE `PricingProduct.deps: string[]`; i18n anahtarları `licensing:store.blocked.dependencyUnavailable` (interpolasyon `{{dep}}`) ve `licensing:store.depAutoAddedNote`

- [ ] **Adım 1: Başarısız backend testini yaz**

`backend/src/modules/licensing/licensing.controller.pricing.spec.ts`:

```ts
import {
  mockPrismaClient,
  MockPrismaClient,
} from "../../common/test/prisma-mock.service";
import { LicensingController } from "./licensing.controller";

/**
 * The public price list is what the storefront builds a basket from. It has
 * always omitted `deps`, which was harmless while the only dependencies in
 * the catalog were credit-pack → module (credits are bought from the module's
 * own screen). `module_personnel_card_shift` is the first MODULE that depends
 * on another module, and the store cannot add a prerequisite it cannot see:
 * the customer ticks one line, checkout's assertDeps 409s the whole cart.
 */
describe("LicensingController.pricing — dependency projection", () => {
  let prisma: MockPrismaClient;
  let ctrl: LicensingController;

  const row = (over: Record<string, unknown> = {}) => ({
    code: "module_personnel_card_shift",
    name: "Kartlı Vardiya",
    description: "RFID kart ile damgalama",
    kind: "module",
    billing: "oneTime",
    priceCents: 400_000,
    currency: "TRY",
    creditKind: null,
    creditUnits: null,
    requiresLicense: true,
    sortOrder: 18,
    deps: ["module_personnel"],
    i18n: null,
    ...over,
  });

  beforeEach(() => {
    prisma = mockPrismaClient();
    ctrl = new LicensingController(
      prisma as any,
      { getForTenant: jest.fn() } as any,
      { loadContext: jest.fn(), price: jest.fn() } as any,
      { balances: jest.fn() } as any,
      { openFor: jest.fn() } as any,
      { listForTenant: jest.fn() } as any,
    );
  });

  it("projects deps on the public pricing endpoint", async () => {
    (prisma.marketplaceAddOn.findMany as any).mockResolvedValue([row()]);

    const res = await ctrl.pricing("tr");

    expect(res.products[0].deps).toEqual(["module_personnel"]);
  });

  it("SELECTS deps from the database rather than defaulting it", async () => {
    // A response that hardcodes `deps: []` would pass the assertion above for
    // a dependency-free product and silently drop every real dependency.
    (prisma.marketplaceAddOn.findMany as any).mockResolvedValue([row()]);

    await ctrl.pricing("tr");

    const select = (prisma.marketplaceAddOn.findMany as any).mock.calls[0][0]
      .select;
    expect(select.deps).toBe(true);
  });

  it("returns an empty array — never undefined — for a product with no deps", () => {
    // The storefront walks `product.deps` in a loop; undefined would throw on
    // the first render of a catalog that predates this column being selected.
    (prisma.marketplaceAddOn.findMany as any).mockResolvedValue([
      row({ code: "module_personnel", deps: [] }),
    ]);

    return ctrl.pricing("tr").then((res) => {
      expect(res.products[0].deps).toEqual([]);
    });
  });
});
```

- [ ] **Adım 2: Çalıştır ve başarısız olduğunu gör**

Çalıştır: `cd /home/tarik/Projects/kds/backend && npx jest src/modules/licensing/licensing.controller.pricing.spec.ts`
Beklenen: FAIL — `projects deps on the public pricing endpoint` üzerinde `Expected: ["module_personnel"]` / `Received: undefined`.

- [ ] **Adım 3: `pricing()` select ve yanıtına `deps` ekle**

`backend/src/modules/licensing/licensing.controller.ts`, `pricing()` içindeki `select` bloğunda `requiresLicense: true,` satırının ardına:

```ts
        // The storefront needs the prerequisite graph to build a legal basket.
        // Without it the first module→module dependency in the catalog
        // (module_personnel_card_shift → module_personnel) produces a cart
        // checkout's assertDeps rejects, killing every other line with it.
        deps: true,
```

ve yanıt eşlemesinde `requiresLicense: r.requiresLicense,` satırının ardına:

```ts
          deps: r.deps,
```

- [ ] **Adım 4: Çalıştır ve geçtiğini gör**

Çalıştır: `cd /home/tarik/Projects/kds/backend && npx jest src/modules/licensing/licensing.controller.pricing.spec.ts`
Beklenen: PASS — 3 test yeşil.

- [ ] **Adım 5: Backend'i commit'le**

```bash
cd /home/tarik/Projects/kds
git add backend/src/modules/licensing/licensing.controller.ts backend/src/modules/licensing/licensing.controller.pricing.spec.ts
git commit -m "fix(checkout): /v1/catalog/pricing bağımlılıkları da yayınlasın"
```

- [ ] **Adım 6: Frontend tipine `deps` ekle**

`frontend/src/features/licensing/licensingApi.ts`, `PricingProduct` içinde `requiresLicense: boolean;` satırının ardına:

```ts
  /** Catalog codes that must be owned (ACTIVE) or in the same cart. */
  deps: string[];
```

- [ ] **Adım 7: Başarısız CatalogStore testlerini yaz**

`frontend/src/features/licensing/CatalogStore.test.tsx`: önce `product()` fabrikasına alan ekle — `sortOrder: 0,` satırının ardına `deps: [],` — ve `useEntitlements` mock'unun `snapshot`'ına `owned`'ı da koy (bileşen dep sahipliğini `snapshot?.owned`'dan okur):

```ts
vi.mock('../../contexts/SubscriptionContext', () => ({
  useEntitlements: () => ({
    owned,
    license: { status: licenseStatus },
    snapshot: { offers, purchasability, owned },
    offerFor: () => null,
  }),
}));
```

Ardından dosyanın sonuna yeni bir describe bloğu:

```tsx
describe('CatalogStore — module dependencies', () => {
  const CARD = product({
    code: 'module_personnel_card_shift',
    name: 'Kartlı Vardiya',
    kind: 'module',
    billing: 'oneTime',
    priceCents: 400_000,
    deps: ['module_personnel'],
  });

  beforeEach(() => {
    licenseStatus = 'active';
    products = [LICENCE, product(), CARD];
  });

  it('adds the parent module to the bill when a dependent line is ticked', () => {
    render(<CatalogStore />);
    tick('Kartlı Vardiya');

    // 4000 + 990
    expect(within(bill()).getByText('Personel Yönetimi')).toBeInTheDocument();
    expect(within(bill()).getByText('₺4.990,00')).toBeInTheDocument();
  });

  it('does not re-add a parent module the tenant already owns ACTIVELY', () => {
    owned = [{ code: 'module_personnel', status: 'active' }];
    render(<CatalogStore />);
    tick('Kartlı Vardiya');

    expect(within(bill()).queryByText('Personel Yönetimi')).not.toBeInTheDocument();
  });

  it('does NOT treat a past_due parent as satisfying the dependency', () => {
    // purchase()'s dep check is ACTIVE-only (tenant-marketplace.service.ts:
    // 229-242). Counting past_due as "owned" builds a cart the server refuses.
    owned = [{ code: 'module_personnel', status: 'past_due' }];
    render(<CatalogStore />);
    tick('Kartlı Vardiya');

    expect(within(bill()).getByText('Personel Yönetimi')).toBeInTheDocument();
  });

  it('blocks the dependent line when the parent is unpurchasable', () => {
    // Nothing may build a basket the server will reject. If the parent cannot
    // be bought AND is not actively owned, the child is not tickable.
    purchasability = { module_personnel: { ok: false, reason: 'ADDON_ALREADY_GRANTED' } };
    render(<CatalogStore />);
    tick('Kartlı Vardiya');

    expect(within(bill()).getByText('licensing:store.billEmpty')).toBeInTheDocument();
    expect(
      screen.getByText(/store\.blocked\.dependencyUnavailable/),
    ).toBeInTheDocument();
  });

  it('does not double-add when the parent is ticked by hand', () => {
    render(<CatalogStore />);
    tick('Personel Yönetimi');
    tick('Kartlı Vardiya');

    fireEvent.click(screen.getByRole('button', { name: /store\.payTotal/ }));
    const codes = purchaseAsync.mock.calls[0][0].items.map((i: any) => i.code);
    expect(codes.filter((c: string) => c === 'module_personnel')).toHaveLength(1);
  });
});
```

- [ ] **Adım 8: Çalıştır ve başarısız olduklarını gör**

Çalıştır: `cd /home/tarik/Projects/kds/frontend && npx vitest run src/features/licensing/CatalogStore.test.tsx`
Beklenen: FAIL — `adds the parent module to the bill when a dependent line is ticked` üzerinde `Unable to find an element with the text: Personel Yönetimi` (faturada yok, çünkü otomatik ekleme henüz yok).

- [ ] **Adım 9: `depAutoAdded`'ı uygula**

`frontend/src/features/licensing/CatalogStore.tsx`, `licenceAutoAdded` tanımının hemen ardına:

```tsx
  // Codes that SATISFY a dependency: ACTIVE ownership only. purchase()'s dep
  // check is ACTIVE-only (tenant-marketplace.service.ts:229-242), so treating
  // a past_due parent as "owned" would leave the prerequisite off the bill and
  // the whole cart would 409 at intent.
  const activeOwnedCodes = useMemo(
    () =>
      new Set(
        (snapshot?.owned ?? [])
          .filter((o) => o.status === 'active')
          .map((o) => o.code),
      ),
    [snapshot],
  );

  /** Transitively collect the prerequisites of every ticked line. */
  const depAutoAdded = useMemo(() => {
    const out = new Map<string, PricingProduct>();
    const seen = new Set<string>();
    const walk = (code: string) => {
      if (seen.has(code)) return;
      seen.add(code);
      for (const dep of byCode.get(code)?.deps ?? []) {
        if (activeOwnedCodes.has(dep) || dep in picked || out.has(dep)) {
          walk(dep);
          continue;
        }
        const depProduct = byCode.get(dep);
        // Putting a line the server calls unpurchasable into the cart makes
        // the server reject the ENTIRE cart. Such a row is shown blocked
        // instead (see dependencyBlocked below) and never auto-added.
        if (!depProduct || blockedReason(dep)) continue;
        out.set(dep, depProduct);
        walk(dep);
      }
    };
    for (const code of Object.keys(picked)) walk(code);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked, byCode, activeOwnedCodes, snapshot]);

  /**
   * The dependency this product needs but cannot get — neither actively owned
   * nor purchasable. Returning the dep CODE (not a boolean) lets the row name
   * it in the message.
   */
  const dependencyBlocked = (product: PricingProduct): string | null => {
    for (const dep of product.deps ?? []) {
      if (activeOwnedCodes.has(dep) || dep in picked) continue;
      if (!byCode.has(dep) || blockedReason(dep)) return dep;
    }
    return null;
  };
```

- [ ] **Adım 10: Faturaya doğru sırada yerleştir**

Aynı dosyada `billLines` memo'sunu şununla değiştir:

```tsx
  const licenceProduct = byCode.get(LICENCE_CODE);
  const billLines = useMemo(() => {
    const lines = [...pickedLines];
    // Reading order on the receipt: licence → parent module → what was ticked.
    for (const product of [...depAutoAdded.values()].reverse()) {
      lines.unshift({ product, qty: 1 });
    }
    if (licenceAutoAdded && licenceProduct) {
      lines.unshift({ product: licenceProduct, qty: 1 });
    }
    return lines;
  }, [pickedLines, depAutoAdded, licenceAutoAdded, licenceProduct]);
```

- [ ] **Adım 11: Satırı bloklu göster ve tıklamayı engelle**

Aynı dosyada, `const blocked = blockedReason(product.code);` satırının ardına:

```tsx
                const depBlocked = dependencyBlocked(product);
```

`const isOwned = …` satırını şununla değiştir:

```tsx
                const isOwned = !!blocked && blocked !== 'LICENSE_REQUIRED';
                const unbuyable = isOwned || !!depBlocked;
```

Satırın `<label>` bloğunda `checked`/`disabled`'ı süren yeri `isOwned` yerine `unbuyable` okuyacak biçimde güncelle ve ürün adının altına bloklu mesajı ekle:

```tsx
                {depBlocked && (
                  <span className="block text-xs text-amber-600 dark:text-amber-400">
                    {t('licensing:store.blocked.dependencyUnavailable', {
                      dep: byCode.get(depBlocked)?.name ?? depBlocked,
                    })}
                  </span>
                )}
```

Faturada otomatik eklenen dep satırı için, mevcut lisans rozetinin hemen ardına:

```tsx
                  {depAutoAdded.has(line.product.code) && (
                    <span className="block text-xs text-amber-600 dark:text-amber-400">
                      {t('licensing:store.depAutoAddedNote')}
                    </span>
                  )}
```

- [ ] **Adım 12: Beş dile iki yeni anahtarı ekle**

`store.blocked` alt ağacı bugün **yok** — `store` nesnesine yeni bir `blocked` nesnesi ve `depAutoAddedNote` string'i eklenir. Değerler:

| Dosya | `store.blocked.dependencyUnavailable` | `store.depAutoAddedNote` |
|---|---|---|
| `tr/licensing.json` | `Önce {{dep}} kalemi gerekiyor, ancak şu anda satın alınamıyor.` | `gerekli — otomatik eklendi` |
| `en/licensing.json` | `This needs {{dep}} first, but that item cannot be purchased right now.` | `required — added automatically` |
| `ru/licensing.json` | `Сначала требуется {{dep}}, но сейчас его нельзя купить.` | `обязательно — добавлено автоматически` |
| `ar/licensing.json` | `يتطلب هذا {{dep}} أولًا، لكن لا يمكن شراؤه الآن.` | `مطلوب — أُضيف تلقائيًا` |
| `uz/licensing.json` | `Avval {{dep}} kerak, ammo hozir uni sotib bo‘lmaydi.` | `kerak — avtomatik qo‘shildi` |

- [ ] **Adım 13: Testleri çalıştır ve geçtiklerini gör**

Çalıştır: `cd /home/tarik/Projects/kds/frontend && npx vitest run src/features/licensing/CatalogStore.test.tsx`
Beklenen: PASS — mevcut lisans testleri dahil hepsi yeşil, yeni 5 test dahil.

- [ ] **Adım 14: Tipleri ve i18n kapılarını çalıştır**

```bash
cd /home/tarik/Projects/kds/frontend && npx tsc --noEmit -p tsconfig.json
cd /home/tarik/Projects/kds && node scripts/check-i18n-parity.mjs
cd /home/tarik/Projects/kds && node scripts/check-i18n-value-drift.mjs --gate-new scripts/i18n-value-drift-baseline.json
```
Beklenen: üçü de temiz.

- [ ] **Adım 15: Commit'le**

```bash
cd /home/tarik/Projects/kds
git add frontend/src/features/licensing/licensingApi.ts frontend/src/features/licensing/CatalogStore.tsx frontend/src/features/licensing/CatalogStore.test.tsx frontend/src/i18n/locales/tr/licensing.json frontend/src/i18n/locales/en/licensing.json frontend/src/i18n/locales/ru/licensing.json frontend/src/i18n/locales/ar/licensing.json frontend/src/i18n/locales/uz/licensing.json
git commit -m "fix(store): bağımlı ürün seçilince ebeveyn modül faturaya eklensin"
```

---

## Görev 3: Ön koşul (b) — provizyon sırası rütbe içinde topolojik

**Bugün latent, PARA yolunda.** `KIND_RANK`'te `module` ve `integration` aynı rütbede (1) ve `Array.prototype.sort` **kararlı**; `[card_shift, module_personnel]` sıralı bir sepette bağımlı ürün ÖNCE provizyonlanır, `purchase()`'ın ACTIVE-only dep kontrolü fırlar ve tüm Serializable tx — PayTR tahsilatından SONRA — geri sarılır. Sepet sırası `Object.entries(picked)` yani **tıklama sırasıdır**; "pratikte olmaz" denemez.

**Files:**
- Create: `backend/src/modules/checkout/provision-order.ts`
- Create: `backend/src/modules/checkout/provision-order.spec.ts`
- Modify: `backend/src/modules/checkout/checkout.types.ts` (`PricedLineMeta`)
- Modify: `backend/src/modules/checkout/quote.service.ts` (annual dalı `:100-114`, oneTime dalı `:136-146`)
- Modify: `backend/src/modules/checkout/checkout.service.ts` (`:444-456`)
- Modify: `backend/src/modules/checkout/checkout.service.spec.ts`
- Test: yukarıdaki iki spec

**Interfaces:**
- Consumes: yok
- Produces: `export const KIND_RANK: Record<string, number>`, `export function orderAddOnLinesForProvisioning<T extends { code: string; meta?: { kind?: string; deps?: string[] } }>(lines: T[]): T[]`, `PricedLineMeta.deps?: string[]`

- [ ] **Adım 1: Başarısız saf birim testini yaz**

`backend/src/modules/checkout/provision-order.spec.ts`:

```ts
import { orderAddOnLinesForProvisioning, KIND_RANK } from "./provision-order";

const line = (code: string, kind: string, deps: string[] = []) => ({
  code,
  meta: { kind, deps },
});

describe("orderAddOnLinesForProvisioning", () => {
  it("provisions the licence before everything else", () => {
    const out = orderAddOnLinesForProvisioning([
      line("module_personnel", "module"),
      line("license_annual", "license"),
    ]);
    expect(out.map((l) => l.code)).toEqual([
      "license_annual",
      "module_personnel",
    ]);
  });

  it("provisions module_personnel before module_personnel_card_shift even when the cart lists the card first", () => {
    // THE MONEY BUG. Both are kind:'module' → equal KIND_RANK → a stable sort
    // preserves the cart order → purchase() looks for an ACTIVE parent that
    // does not exist yet → the whole Serializable tx rolls back AFTER PayTR
    // has already settled.
    const out = orderAddOnLinesForProvisioning([
      line("module_personnel_card_shift", "module", ["module_personnel"]),
      line("module_personnel", "module"),
    ]);
    expect(out.map((l) => l.code)).toEqual([
      "module_personnel",
      "module_personnel_card_shift",
    ]);
  });

  it("keeps credit packs last", () => {
    const out = orderAddOnLinesForProvisioning([
      line("credit_ai_photo_100", "credit", ["module_ai_studio"]),
      line("module_ai_studio", "module"),
      line("license_annual", "license"),
    ]);
    expect(out.map((l) => l.code)).toEqual([
      "license_annual",
      "module_ai_studio",
      "credit_ai_photo_100",
    ]);
  });

  it("is stable for lines with no dependency relationship", () => {
    const out = orderAddOnLinesForProvisioning([
      line("module_inventory", "module"),
      line("module_reservations", "module"),
      line("delivery_getir", "integration"),
    ]);
    expect(out.map((l) => l.code)).toEqual([
      "module_inventory",
      "module_reservations",
      "delivery_getir",
    ]);
  });

  it("falls back to input order on a dependency cycle instead of dropping a line", () => {
    // Ordering is not a money decision — the guard is. A cycle (only reachable
    // from corrupt catalog data) must never make a paid line vanish.
    const out = orderAddOnLinesForProvisioning([
      line("a", "module", ["b"]),
      line("b", "module", ["a"]),
    ]);
    expect(out.map((l) => l.code)).toEqual(["a", "b"]);
    expect(out).toHaveLength(2);
  });

  it("ignores a dep that is not in this cart", () => {
    // An already-owned parent is not a cart line. Treating its absence as a
    // missing node would strand the dependent line.
    const out = orderAddOnLinesForProvisioning([
      line("module_personnel_card_shift", "module", ["module_personnel"]),
    ]);
    expect(out.map((l) => l.code)).toEqual(["module_personnel_card_shift"]);
  });

  it("ranks an unknown kind last rather than first", () => {
    const out = orderAddOnLinesForProvisioning([
      line("mystery", "wat"),
      line("license_annual", "license"),
    ]);
    expect(out.map((l) => l.code)).toEqual(["license_annual", "mystery"]);
  });

  it("exports the rank table the checkout used to inline", () => {
    expect(KIND_RANK).toEqual({
      license: 0,
      module: 1,
      integration: 1,
      capacity: 2,
      service: 3,
      credit: 4,
    });
  });
});
```

- [ ] **Adım 2: Çalıştır ve başarısız olduğunu gör**

Çalıştır: `cd /home/tarik/Projects/kds/backend && npx jest src/modules/checkout/provision-order.spec.ts`
Beklenen: FAIL — `Cannot find module './provision-order' from 'src/modules/checkout/provision-order.spec.ts'`.

- [ ] **Adım 3: `provision-order.ts`'i yaz**

```ts
/**
 * Order catalog lines for provisioning.
 *
 * KIND_RANK alone is not enough: `module` and `integration` share rank 1 and
 * Array.prototype.sort is STABLE, so the cart order can place a dependent
 * before its parent. purchase()'s dep check looks for an ACTIVE ownership row,
 * and at that moment the parent has not been written yet: the Serializable
 * transaction rolls back AFTER PayTR settled — money taken, nothing granted,
 * and there is no refund rail.
 *
 * Fix: a Kahn topological sort WITHIN a rank. Ranks keep their relative order
 * (licence always first, credits always last), and a cycle or a missing dep
 * leaves the input order untouched (fail-open: ordering makes no money
 * decision — the guard does).
 */

/** Catalog kind → provisioning rank. Lower goes first. */
export const KIND_RANK: Record<string, number> = {
  license: 0,
  module: 1,
  integration: 1,
  capacity: 2,
  service: 3,
  credit: 4,
};

/** Unknown kinds sort after everything we know about. */
const UNKNOWN_RANK = 9;

export function orderAddOnLinesForProvisioning<
  T extends { code: string; meta?: { kind?: string; deps?: string[] } },
>(lines: T[]): T[] {
  const rankOf = (l: T) => KIND_RANK[l.meta?.kind ?? ""] ?? UNKNOWN_RANK;

  // 1) Group by rank, preserving input order inside each group.
  const groups = new Map<number, T[]>();
  for (const l of lines) {
    const rank = rankOf(l);
    if (!groups.has(rank)) groups.set(rank, []);
    groups.get(rank)!.push(l);
  }

  const out: T[] = [];
  for (const rank of [...groups.keys()].sort((a, b) => a - b)) {
    out.push(...topoWithinGroup(groups.get(rank)!));
  }
  return out;
}

function topoWithinGroup<
  T extends { code: string; meta?: { kind?: string; deps?: string[] } },
>(group: T[]): T[] {
  if (group.length < 2) return group;

  const byCode = new Map<string, T>();
  for (const l of group) byCode.set(l.code, l);

  // 2) Edges only between lines that are BOTH in this group. A dep satisfied
  //    by an already-owned product is not a node here and must not block.
  const indegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const l of group) indegree.set(l.code, 0);
  for (const l of group) {
    for (const dep of l.meta?.deps ?? []) {
      if (!byCode.has(dep) || dep === l.code) continue;
      indegree.set(l.code, (indegree.get(l.code) ?? 0) + 1);
      if (!dependents.has(dep)) dependents.set(dep, []);
      dependents.get(dep)!.push(l.code);
    }
  }

  // 3) Kahn — the ready queue keeps INPUT order, so the result is
  //    deterministic for a cart whose lines are unrelated.
  const ordered: T[] = [];
  const emitted = new Set<string>();
  const queue = group.filter((l) => (indegree.get(l.code) ?? 0) === 0);
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (emitted.has(current.code)) continue;
    emitted.add(current.code);
    ordered.push(current);
    for (const dependent of dependents.get(current.code) ?? []) {
      const left = (indegree.get(dependent) ?? 0) - 1;
      indegree.set(dependent, left);
      if (left === 0) queue.push(byCode.get(dependent)!);
    }
  }

  // 4) A cycle leaves nodes unemitted. Append them in input order rather than
  //    dropping a paid line.
  for (const l of group) if (!emitted.has(l.code)) ordered.push(l);
  return ordered;
}
```

- [ ] **Adım 4: Çalıştır ve geçtiğini gör**

Çalıştır: `cd /home/tarik/Projects/kds/backend && npx jest src/modules/checkout/provision-order.spec.ts`
Beklenen: PASS — 8 test yeşil.

- [ ] **Adım 5: `PricedLineMeta`'ya `deps` ekle**

`backend/src/modules/checkout/checkout.types.ts`, `requiresLicense?: boolean;` satırının ardına:

```ts
  /**
   * Catalog prerequisites of this add-on, forwarded from the SAME catalog read
   * the price came from. Carried on the line so provisioning can be ordered
   * without opening another query inside the Serializable transaction.
   * Never persisted: tenant-invoice.service.ts:107-125 reads named fields only.
   */
  deps?: string[];
```

- [ ] **Adım 6: `quote.service.ts`'in HER İKİ addon dalına `deps` yaz**

Annual dalında (`meta` içinde `requiresLicense: addOn.requiresLicense,` satırının ardına) ve oneTime dalında (aynı satırın ardına) ekle:

```ts
              deps: addOn.deps,
```

- [ ] **Adım 7: `checkout.service.ts`'teki elle sıralamayı değiştir**

`backend/src/modules/checkout/checkout.service.ts`: `const KIND_RANK: Record<string, number> = { … };` bloğu ile `const orderedAddOnLines = [...addOnLines].sort(…);` ifadesini **tek satırla** değiştir:

```ts
        // Rank alone tied `module` with `integration`, and a stable sort then
        // preserved the cart order — provisioning a dependent before its
        // parent. See provision-order.ts for the money bug this closes.
        const orderedAddOnLines = orderAddOnLinesForProvisioning(addOnLines);
```

Dosyanın importlarına ekle:

```ts
import { orderAddOnLinesForProvisioning } from "./provision-order";
```

Yukarıdaki yorum bloğunun ("ORDER MATTERS, in two independent ways…") **korunması** gerekir: iki gerekçeyi (lisans çapası + bağımlılık) hâlâ o anlatıyor.

- [ ] **Adım 8: Entegrasyon kanıtı testini yaz**

`backend/src/modules/checkout/checkout.service.spec.ts` dosyasının son `it(...)`'inin ardına:

```ts
  it("provisions a dependent module after its parent regardless of cart order", async () => {
    // The unit-level proof is provision-order.spec.ts; this pins that
    // confirmAndProvision actually USES it. Cart order is click order, so the
    // customer decides it.
    quoteSvc.quote.mockResolvedValue(
      makeQuote({
        lines: [
          {
            type: "addon",
            code: "module_personnel_card_shift",
            name: "Kartlı Vardiya",
            qty: 1,
            unitCents: 400_000,
            subtotalCents: 400_000,
            meta: { kind: "module", deps: ["module_personnel"] },
          },
          {
            type: "addon",
            code: "module_personnel",
            name: "Personel Yönetimi",
            qty: 1,
            unitCents: 99_000,
            subtotalCents: 99_000,
            meta: { kind: "module", deps: [] },
          },
        ],
        subtotalCents: 415_833,
        taxCents: 83_167,
        shippingCents: 0,
        totalCents: 499_000,
      }),
    );
    prisma.checkoutIntent.findFirst.mockResolvedValue({
      status: "succeeded",
      cartJson: { branchId: undefined },
      amountCents: 499_000,
    });

    await svc.confirmAndProvision(TENANT, {} as any, PAYMENT_REF);

    const codes = tenantMarketplace.purchase.mock.calls.map(
      (c: any[]) => c[1].addOnCode,
    );
    expect(codes).toEqual(["module_personnel", "module_personnel_card_shift"]);
  });
```

- [ ] **Adım 9: Checkout süitini çalıştır**

Çalıştır: `cd /home/tarik/Projects/kds/backend && npx jest src/modules/checkout`
Beklenen: PASS — yeni test dahil tüm checkout süiti yeşil. (Eğer `purchase` çağrısındaki argüman şekli `c[1].addOnCode` değilse, `console.log(tenantMarketplace.purchase.mock.calls[0])` ile bir kez bak ve iddiayı gerçek şekle uyarla — kodu değil iddiayı düzelt.)

- [ ] **Adım 10: Tipleri kontrol et ve commit'le**

```bash
cd /home/tarik/Projects/kds/backend && npx tsc --noEmit
cd /home/tarik/Projects/kds
git add backend/src/modules/checkout/provision-order.ts backend/src/modules/checkout/provision-order.spec.ts backend/src/modules/checkout/checkout.types.ts backend/src/modules/checkout/quote.service.ts backend/src/modules/checkout/checkout.service.ts backend/src/modules/checkout/checkout.service.spec.ts
git commit -m "fix(checkout): provizyon sırası rütbe içinde topolojik olsun"
```

---

## Görev 4: Şema — `20260820150000_card_shift_schema` (up/down) + Prisma modelleri + round-trip kanıtı

Kart rayı **mevcut** personel modellerinin üstüne biner: `User`'a kart kimliği, `Attendance`'a damganın kaynağı. Yeni tablo yok, yeni devam modeli yok.

**Files:**
- Modify: `backend/prisma/schema.prisma` (`model User` `:243-346`, `model Attendance` `:3769-3810`)
- Create: `backend/prisma/migrations/20260820150000_card_shift_schema/migration.sql`
- Create: `backend/prisma/migrations/20260820150000_card_shift_schema/down.sql`
- Test: atılabilir Postgres'te up → down×2 → up×2 → down×2 → up turu (Adım 6-8)

**Interfaces:**
- Consumes: yok
- Produces: Prisma alanları `User.staffCardUidHash: string | null`, `User.staffCardUidEnc: string | null`, `User.staffCardHashVersion: number` (default 1), `User.staffCardLast4: string | null`, `User.staffCardAssignedAt: Date | null`, `User.staffCardAssignedById: string | null`, `User.staffCardAssignedBy` / `User.staffCardAssignments` (`"StaffCardAssigner"` relation), `@@unique([tenantId, staffCardUidHash])`; `Attendance.clockInSource: string` (default `"manual"`), `Attendance.clockOutSource: string | null`

- [ ] **Adım 1: Zincirde çakışma olmadığını doğrula**

Çalıştır: `ls /home/tarik/Projects/kds/backend/prisma/migrations | grep 202608201`
Beklenen: `20260820100000_tenant_country_code`, `20260820120000_reprice_licence_and_stock`, `20260820130000_widen_money_decimal_precision` ve — Change 1 merge edildiyse — `20260820140000_delivery_platforms_bundle` görünür; **`20260820150000_*` ve `20260820160000_*` YOKTUR**. Varsa dur ve zinciri (spec §6.0) yeniden çöz — timestamp'i kendi başına değiştirme.

- [ ] **Adım 2: `User` modeline kart alanlarını ekle**

`backend/prisma/schema.prisma`, `model User` içinde `branchAssignments` / `grantedBranchAssignments` bloğunun ardına, `@@index` satırlarından önce:

```prisma
  // --- Kartlı vardiya (v3.6.8) ---
  // The card UID is an identity-like identifier: it is NEVER stored in clear.
  // What is stored is an HMAC-SHA256 under a pepper derived from
  // ENCRYPTION_MASTER_KEY, with tenantId mixed into the input so the SAME
  // physical card hashes differently in two tenants (no cross-tenant
  // correlation). A bare sha256 would not do: a typical card UID carries 32
  // bits of entropy and falls in seconds.
  staffCardUidHash      String?
  /// AES-256-GCM copy of the normalised UID (`encryptString`, "v2:" form,
  /// AAD = "staffcard:v1:<tenantId>:<userId>"). It exists ONLY so an
  /// ENCRYPTION_MASTER_KEY rotation can "decrypt → re-HMAC" (K22): without it
  /// a rotation would kill every card in the field at once. Never read on the
  /// tap path, never returned by any endpoint, never logged. TEXT because
  /// encryptString returns one compact string.
  staffCardUidEnc       String?
  /// Hash scheme version. The rotation job finds rows on an old version.
  staffCardHashVersion  Int       @default(1)
  /// The ONLY display affordance for matching a physical card to a person.
  staffCardLast4        String?
  staffCardAssignedAt   DateTime?
  staffCardAssignedById String?
  staffCardAssignedBy   User?     @relation("StaffCardAssigner", fields: [staffCardAssignedById], references: [id], onDelete: SetNull)
  staffCardAssignments  User[]    @relation("StaffCardAssigner")
```

ve aynı modelin `@@index([approvedById])` satırının ardına:

```prisma
  // NULLs are distinct in Postgres, so an unlimited number of card-less staff
  // coexist; within one tenant two people cannot carry the same card.
  @@unique([tenantId, staffCardUidHash])
  @@index([staffCardAssignedById])
```

- [ ] **Adım 3: `Attendance` modeline kaynak kolonlarını ekle**

`backend/prisma/schema.prisma`, `model Attendance` içinde `notes String?` satırının ardına:

```prisma
  /// manual | card — which rail stamped this punch. Clock-in and clock-out can
  /// come from different rails (tap in, clock out from the app), so they are
  /// two columns rather than one. No new index: reports already narrow by
  /// tenantId + branchId + date, and this column has cardinality 2.
  clockInSource  String  @default("manual")
  clockOutSource String?
```

- [ ] **Adım 4: Şemayı doğrula**

Çalıştır: `cd /home/tarik/Projects/kds/backend && npx prisma validate`
Beklenen: `The schema at prisma/schema.prisma is valid 🚀`

- [ ] **Adım 5: Migration çiftini yaz**

`backend/prisma/migrations/20260820150000_card_shift_schema/migration.sql`:

```sql
-- @doctor:idempotent verified=IF NOT EXISTS'li ADD COLUMN + CREATE UNIQUE INDEX; hiçbir satır güncellenmiyor, hiçbir tenant verisine dokunulmuyor. Tekrar çalıştırma no-op.
--
-- Kartlı vardiya (v3.6.8) şeması. Tablo adları snake_case @@map adlarıdır
-- ("users", "attendances") — PascalCase bir ad CI'da (db push) görünmez,
-- yalnız prod deploy'unda 42P01 verir.
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "staffCardUidHash"      TEXT,
  -- K22: ENCRYPTION_MASTER_KEY rotasyonunda "çöz -> yeniden HMAC'le" işini mümkün
  -- kılan geri döndürülebilir kopya (AES-256-GCM, encryptString "v2:" biçimi).
  -- Tap yolunda okunmaz, hiçbir uç döndürmez.
  ADD COLUMN IF NOT EXISTS "staffCardUidEnc"       TEXT,
  ADD COLUMN IF NOT EXISTS "staffCardHashVersion"  INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "staffCardLast4"        TEXT,
  ADD COLUMN IF NOT EXISTS "staffCardAssignedAt"   TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "staffCardAssignedById" TEXT;

-- NULL'lar Postgres'te birbirinden farklı sayılır: kartsız personel sayısı sınırsız.
CREATE UNIQUE INDEX IF NOT EXISTS "users_tenantId_staffCardUidHash_key"
  ON "users" ("tenantId", "staffCardUidHash");

CREATE INDEX IF NOT EXISTS "users_staffCardAssignedById_idx"
  ON "users" ("staffCardAssignedById");

DO $$ BEGIN
  ALTER TABLE "users"
    ADD CONSTRAINT "users_staffCardAssignedById_fkey"
    FOREIGN KEY ("staffCardAssignedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "attendances"
  ADD COLUMN IF NOT EXISTS "clockInSource"  TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS "clockOutSource" TEXT;
```

`backend/prisma/migrations/20260820150000_card_shift_schema/down.sql`:

```sql
-- Rollback: card_shift_schema. YALNIZ bu migration'ın eklediği kolonları/indeksleri
-- düşürür. Kart atamaları bu kolonların İÇİNDE yaşıyor, yani geri alma onları da
-- siler — bilinçli: kolon kalırsa şema Prisma ile tutarsız kalır. Operatör/işletme
-- verisinin hiçbiri (puantaj satırları, kullanıcılar) silinmez.
--
-- >>> ZORUNLU ADIM 0 — BU DOSYAYI ÇALIŞTIRMADAN ÖNCE ATAMALARI DIŞA AKTAR. <<<
-- UID hiçbir yerde düz metin tutulmaz (K8), bu yüzden atamalar başka bir tablodan
-- geri getirilemez; yedek alınmazsa her tenant her kartı elle yeniden kaydeder.
--   psql "$DATABASE_URL" -c "\copy (SELECT id, \"staffCardUidHash\", \"staffCardUidEnc\", \"staffCardHashVersion\", \"staffCardLast4\", \"staffCardAssignedAt\", \"staffCardAssignedById\" FROM users WHERE \"staffCardUidHash\" IS NOT NULL) TO 'staff-cards-backup.csv' CSV HEADER"
--
-- Idempotent: IF EXISTS'ler ikinci çalıştırmayı no-op yapar.
ALTER TABLE "attendances" DROP COLUMN IF EXISTS "clockOutSource";
ALTER TABLE "attendances" DROP COLUMN IF EXISTS "clockInSource";

ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_staffCardAssignedById_fkey";
DROP INDEX IF EXISTS "users_staffCardAssignedById_idx";
DROP INDEX IF EXISTS "users_tenantId_staffCardUidHash_key";
ALTER TABLE "users"
  DROP COLUMN IF EXISTS "staffCardAssignedById",
  DROP COLUMN IF EXISTS "staffCardAssignedAt",
  DROP COLUMN IF EXISTS "staffCardLast4",
  DROP COLUMN IF EXISTS "staffCardHashVersion",
  DROP COLUMN IF EXISTS "staffCardUidEnc",
  DROP COLUMN IF EXISTS "staffCardUidHash";
```

- [ ] **Adım 6: Atılabilir bir Postgres ayağa kaldır ve zinciri uygula**

```bash
docker run -d --rm --name kds-cardshift-migtest -e POSTGRES_PASSWORD=migtest -p 5455:5432 postgres:16
until docker exec kds-cardshift-migtest pg_isready -U postgres; do :; done
cd /home/tarik/Projects/kds/backend
export DATABASE_URL="postgresql://postgres:migtest@localhost:5455/postgres?schema=public"
npx prisma migrate deploy
```
Beklenen: `All migrations have been successfully applied.` — zincirdeki son dosya `20260820150000_card_shift_schema`.

- [ ] **Adım 7: Kolonların geldiğini doğrula**

```bash
cd /home/tarik/Projects/kds/backend
export DATABASE_URL="postgresql://postgres:migtest@localhost:5455/postgres?schema=public"
p() { psql -v ON_ERROR_STOP=1 "$DATABASE_URL" "$@"; }
p -c "select count(*) from information_schema.columns where table_name='users' and column_name like 'staffCard%'"
p -c "select count(*) from information_schema.columns where table_name='attendances' and column_name in ('clockInSource','clockOutSource')"
p -c "select indexname from pg_indexes where tablename='users' and indexname in ('users_tenantId_staffCardUidHash_key','users_staffCardAssignedById_idx')"
```
Beklenen: sırasıyla `6`, `2` ve iki indeks adının ikisi de listelenir.
`ON_ERROR_STOP=1` şart: onsuz psql hatayı ekrana basar ama çıkış kodu 0 kalır ve idempotans kanıtı sessizce yalan söyler.

- [ ] **Adım 8: down×2 → up×2 → down×2 → up turunu koştur**

```bash
cd /home/tarik/Projects/kds/backend
export DATABASE_URL="postgresql://postgres:migtest@localhost:5455/postgres?schema=public"
p() { psql -v ON_ERROR_STOP=1 "$DATABASE_URL" "$@"; }
M=prisma/migrations/20260820150000_card_shift_schema

p -f $M/down.sql
p -f $M/down.sql            # idempotent: no-op, hata YOK
p -c "select count(*) from information_schema.columns where table_name='users' and column_name like 'staffCard%'"          # 0
p -c "select count(*) from information_schema.columns where table_name='attendances' and column_name in ('clockInSource','clockOutSource')"  # 0

p -f $M/migration.sql
p -f $M/migration.sql       # idempotent: no-op, hata YOK
p -c "select count(*) from information_schema.columns where table_name='users' and column_name like 'staffCard%'"          # 6

p -f $M/down.sql            # down→up→down turu da temiz
p -f $M/down.sql            # ve yine no-op
p -f $M/migration.sql       # zinciri geri kur
p -c "select count(*) from information_schema.columns where table_name='users' and column_name like 'staffCard%'"          # 6
```
Beklenen: hiçbir komut hata vermez (`ON_ERROR_STOP=1` altında çıkış kodu 0), sayaçlar yorumdaki değerleri verir.

- [ ] **Adım 9: Kart verisinin geri alımda gerçekten gittiğini ve puantajın kaldığını doğrula**

```bash
cd /home/tarik/Projects/kds/backend
export DATABASE_URL="postgresql://postgres:migtest@localhost:5455/postgres?schema=public"
p() { psql -v ON_ERROR_STOP=1 "$DATABASE_URL" "$@"; }
p -c "select count(*) from attendances"
p -f prisma/migrations/20260820150000_card_shift_schema/down.sql
p -c "select count(*) from attendances"
p -f prisma/migrations/20260820150000_card_shift_schema/migration.sql
```
Beklenen: `attendances` sayısı down'dan önce ve sonra **aynı** (boş bir DB'de `0` ve `0`; seed'li bir DB'de aynı sayı). Down yalnız kolon düşürür, satır silmez.

- [ ] **Adım 10: Prisma istemcisini üret, derle ve commit'le**

```bash
cd /home/tarik/Projects/kds/backend && npx prisma generate
cd /home/tarik/Projects/kds/backend && npx tsc --noEmit
docker stop kds-cardshift-migtest
cd /home/tarik/Projects/kds
git add backend/prisma/schema.prisma backend/prisma/migrations/20260820150000_card_shift_schema
git commit -m "feat(card-shift): kart kimliği ve damga kaynağı için şema migration'ı"
```
Beklenen: `prisma generate` başarılı, `tsc --noEmit` hatasız.

---

## Görev 5: `card-uid.ts` — normalize / doğrula / HMAC / last4 (+ rotasyon kanıtı)

Okuyucular aynı fiziksel kartı 10 haneli ondalık, 8/14 haneli hex, iki nokta ayraçlı veya küçük harfli yazabilir; normalize edilmezse aynı kart iki farklı hash üretir ve "kart tanınmadı" görünür. Hash bir HMAC'tir çünkü tipik UID 32 bit entropidir — ev üslubu deterministik kimlik-hash'leri için sha256 kullanır (`partner-api-key.service.ts:42-44`), buradaki sapmanın gerekçesi düşük entropidir ve yorumda yazılıdır.

**Files:**
- Create: `backend/src/modules/personnel/card-uid.ts`
- Create: `backend/src/modules/personnel/card-uid.spec.ts`
- Test: `backend/src/modules/personnel/card-uid.spec.ts`

**Interfaces:**
- Consumes: `encryptString` / `decryptString` (`backend/src/common/helpers/encryption.helper.ts:134`, `:143`) — yalnız testte
- Produces: `normalizeCardUid(raw: string): string`, `isValidCardUid(v: string): boolean`, `cardUidHash(tenantId: string, uid: string): string`, `cardUidLast4(uid: string): string`, `staffCardAad(tenantId: string, userId: string): string`, `STAFF_CARD_HASH_VERSION: number`

- [ ] **Adım 1: Başarısız testi yaz**

`backend/src/modules/personnel/card-uid.spec.ts`:

```ts
import {
  cardUidHash,
  cardUidLast4,
  isValidCardUid,
  normalizeCardUid,
  staffCardAad,
  STAFF_CARD_HASH_VERSION,
} from "./card-uid";
import {
  decryptString,
  encryptString,
} from "../../common/helpers/encryption.helper";

/**
 * The card UID is an identity-like secret with ~32 bits of entropy. Everything
 * here exists so that (a) the same physical card always resolves to the same
 * person, (b) the same physical card in two tenants never correlates, and
 * (c) an ENCRYPTION_MASTER_KEY rotation does not kill every card in the field.
 */
describe("card-uid", () => {
  const KEY_A = "a".repeat(48);
  const KEY_B = "b".repeat(48);

  beforeEach(() => {
    process.env.ENCRYPTION_MASTER_KEY = KEY_A;
  });

  it("normalizes separators, whitespace and case to one canonical UID", () => {
    // The SAME card, as five different readers write it.
    const forms = [
      "04:a2:2b:9c",
      "04 A2 2B 9C",
      " 04a22b9c ",
      "04-a2-2b-9c",
      "04A22B9C",
    ];
    const canonical = forms.map(normalizeCardUid);
    expect(new Set(canonical).size).toBe(1);
    expect(canonical[0]).toBe("04A22B9C");
  });

  it("rejects a UID shorter than 4 or longer than 32 after normalization", () => {
    expect(isValidCardUid("04A2")).toBe(true);
    expect(isValidCardUid("0:4:A")).toBe(false); // 3 chars once stripped
    expect(isValidCardUid("A".repeat(32))).toBe(true);
    expect(isValidCardUid("A".repeat(33))).toBe(false);
    expect(isValidCardUid("::::")).toBe(false); // 0 chars once stripped
  });

  it("produces a DIFFERENT hash for the same card in two tenants", () => {
    // tenantId is mixed INTO the HMAC input, so a stolen database cannot be
    // joined across tenants to say "this person also works there".
    expect(cardUidHash("tenant-a", "04A22B9C")).not.toBe(
      cardUidHash("tenant-b", "04A22B9C"),
    );
  });

  it("is deterministic for the same tenant + card, whatever the reader wrote", () => {
    expect(cardUidHash("t1", "04:a2:2b:9c")).toBe(cardUidHash("t1", "04A22B9C"));
  });

  it("is an HMAC under the master key, not a bare digest", () => {
    // A bare sha256 of a 32-bit UID falls in seconds; the pepper is what makes
    // the stored value useless without the key.
    const withA = cardUidHash("t1", "04A22B9C");
    process.env.ENCRYPTION_MASTER_KEY = KEY_B;
    expect(cardUidHash("t1", "04A22B9C")).not.toBe(withA);
  });

  it("refuses to hash when the master key is absent instead of hashing under ''", () => {
    delete process.env.ENCRYPTION_MASTER_KEY;
    expect(() => cardUidHash("t1", "04A22B9C")).toThrow(
      /ENCRYPTION_MASTER_KEY/,
    );
  });

  it("never returns the raw UID from last4", () => {
    expect(cardUidLast4("04:a2:2b:9c")).toBe("2B9C");
    expect(cardUidLast4("04:a2:2b:9c")).toHaveLength(4);
  });

  it("binds the encrypted copy to tenant AND user", () => {
    expect(staffCardAad("t1", "u1")).toBe("staffcard:v1:t1:u1");
    expect(staffCardAad("t1", "u2")).not.toBe(staffCardAad("t1", "u1"));
  });

  it("can re-derive the hash from the encrypted UID after a key change", () => {
    // K22, the whole reason staffCardUidEnc exists. Without it a rotation
    // kills every card in the field at once and every tenant re-enrols by hand.
    const uid = normalizeCardUid("04:a2:2b:9c");
    const aad = staffCardAad("t1", "u1");
    const blobUnderA = encryptString(uid, aad);
    const hashUnderA = cardUidHash("t1", uid);

    // ...key rotates.
    const recovered = decryptString(blobUnderA, aad); // still the OLD key
    process.env.ENCRYPTION_MASTER_KEY = KEY_B;
    const hashUnderB = cardUidHash("t1", recovered);

    expect(recovered).toBe(uid);
    expect(hashUnderB).not.toBe(hashUnderA);
    expect(hashUnderB).toBe(cardUidHash("t1", "04A22B9C"));
  });

  it("pins the hash scheme version the rotation job filters on", () => {
    expect(STAFF_CARD_HASH_VERSION).toBe(1);
  });
});
```

- [ ] **Adım 2: Çalıştır ve başarısız olduğunu gör**

Çalıştır: `cd /home/tarik/Projects/kds/backend && npx jest src/modules/personnel/card-uid.spec.ts`
Beklenen: FAIL — `Cannot find module './card-uid' from 'src/modules/personnel/card-uid.spec.ts'`.

- [ ] **Adım 3: `card-uid.ts`'i yaz**

```ts
import { createHmac } from "crypto";

/**
 * Pure card-UID helpers. No IO, no Nest, no Prisma — so the rotation script
 * (§8 Risk 12) can import them standalone.
 *
 * WHY HMAC AND NOT sha256. The house style for deterministic identity hashes
 * is a bare sha256 (partner-api-key.service.ts:42-44, local-bridge.service.ts:
 * 50). A card UID is different: it carries about 32 bits of entropy, so a bare
 * digest is exhaustible in seconds from a database dump. The pepper is derived
 * from ENCRYPTION_MASTER_KEY, which is not in the dump.
 *
 * WHY tenantId IS IN THE INPUT. The same physical card handed to two tenants
 * must not produce the same stored value — otherwise a dump correlates staff
 * across customers. It is also what makes @@unique([tenantId,
 * staffCardUidHash]) a per-tenant uniqueness rule rather than a global one.
 */

/** Bumped only when the hashing scheme itself changes. */
export const STAFF_CARD_HASH_VERSION = 1;

/**
 * One canonical form for a UID, whatever the reader wrote.
 *
 * Cheap USB HID readers emit the same card as 10-digit decimal, 8/14-digit
 * hex, colon- or space-separated, upper or lower case. Two spellings hashing
 * differently surfaces to the staff member as "card not recognised".
 */
export function normalizeCardUid(raw: string): string {
  return raw.replace(/[^0-9A-Za-z]/g, "").toUpperCase();
}

/** 4..32 characters AFTER normalization. */
export function isValidCardUid(v: string): boolean {
  const n = normalizeCardUid(v);
  return n.length >= 4 && n.length <= 32;
}

/** Peppered, tenant-scoped HMAC of the normalised UID. */
export function cardUidHash(tenantId: string, uid: string): string {
  const key = process.env.ENCRYPTION_MASTER_KEY;
  if (!key) {
    // Hashing under "" would produce a value that looks fine, matches nothing
    // written under the real key, and silently unenrols every card.
    throw new Error(
      "ENCRYPTION_MASTER_KEY is not configured — cannot hash a staff card UID",
    );
  }
  return createHmac("sha256", key)
    .update(`staffcard:v1:${tenantId}:${normalizeCardUid(uid)}`)
    .digest("hex");
}

/** The ONLY part of a UID that may ever be displayed or logged. */
export function cardUidLast4(uid: string): string {
  return normalizeCardUid(uid).slice(-4);
}

/**
 * AAD for the reversible copy in `users.staffCardUidEnc`. Binding to tenant
 * AND user means a ciphertext moved to another row fails the GCM tag instead
 * of decrypting into someone else's card.
 */
export function staffCardAad(tenantId: string, userId: string): string {
  return `staffcard:v1:${tenantId}:${userId}`;
}
```

- [ ] **Adım 4: Çalıştır ve geçtiğini gör**

Çalıştır: `cd /home/tarik/Projects/kds/backend && npx jest src/modules/personnel/card-uid.spec.ts`
Beklenen: PASS — 10 test yeşil.

- [ ] **Adım 5: Commit'le**

```bash
cd /home/tarik/Projects/kds
git add backend/src/modules/personnel/card-uid.ts backend/src/modules/personnel/card-uid.spec.ts
git commit -m "feat(card-shift): kart UID normalizasyonu ve peppered HMAC'i"
```

---

## Görev 6: `AttendanceSource` + `AttendanceService` (kaynak parametreleri, `cardClockIns`, CSV, filtre)

Kart rayı devam yazmaz — mevcut `AttendanceService` metotlarını çağırır. Bu görev o metotlara **varsayılanlı** bir kaynak parametresi ekler (mevcut çağıranlar değişmez), raporlamayı kart ile uygulamayı ayırt edebilir hâle getirir.

**Files:**
- Modify: `backend/src/modules/personnel/constants/personnel.enum.ts`
- Modify: `backend/src/modules/personnel/dto/attendance-query.dto.ts` (`AttendanceQueryDto`)
- Modify: `backend/src/modules/personnel/services/attendance.service.ts` (`clockIn` `:98`, `clockOut` `:200`, `getAttendanceHistory` `:437`, `getAttendanceSummary` `:477`, `getAttendanceSummaryCsv` `:534`)
- Modify: `backend/src/modules/personnel/services/attendance.service.spec.ts` (CSV bloğu `:206-230`)
- Test: `backend/src/modules/personnel/services/attendance.service.spec.ts`

**Interfaces:**
- Consumes: `Attendance.clockInSource` / `clockOutSource` (Görev 4)
- Produces: `enum AttendanceSource { MANUAL = "manual", CARD = "card" }`; `AttendanceService.clockIn(tenantId: string, userId: string, notes?: string, source?: AttendanceSource)`; `AttendanceService.clockOut(tenantId: string, userId: string, source?: AttendanceSource)`; `getAttendanceSummary()` satırlarında `cardClockIns: number`; `AttendanceQueryDto.source?: AttendanceSource`; CSV başlığı `Staff,Role,Total Days,Worked Minutes,Overtime Minutes,Break Minutes,Late Days,Late Minutes,Card Clock-ins`

- [ ] **Adım 1: Enum'u ekle**

`backend/src/modules/personnel/constants/personnel.enum.ts`, `AttendanceStatus`'un ardına:

```ts
/**
 * Which rail stamped an attendance punch.
 *
 * NOT covered by scripts/check-contract-drift.mjs (it pins a fixed list of
 * enums, and this one is not on it). The frontend therefore mirrors these
 * strings by hand — and does so as a BADGE lookup (`clockInSource === 'card'`),
 * never as a union type, so an unknown value degrades to "App" instead of
 * throwing.
 */
export enum AttendanceSource {
  MANUAL = "manual",
  CARD = "card",
}
```

- [ ] **Adım 2: Başarısız testleri yaz (CSV + özet + varsayılan kaynak)**

`backend/src/modules/personnel/services/attendance.service.spec.ts`: mevcut `getAttendanceSummaryCsv …` testinde başlık iddiasını ve veri satırını güncelle, ardından iki yeni test ekle.

Başlık iddiası şu olur:

```ts
    expect(lines[0]).toBe(
      "Staff,Role,Total Days,Worked Minutes,Overtime Minutes,Break Minutes,Late Days,Late Minutes,Card Clock-ins",
    );
```

Veri satırı iddiası şu olur (mock satırda `clockInSource` yok → 0):

```ts
    expect(lines[1]).toBe("Ada Lovelace,WAITER,1,480,60,30,1,15,0");
```

Para-kolonu yasağı iddiası (`expect(csv.toLowerCase()).not.toMatch(/wage|salary|pay|cost|rate/)`) **olduğu gibi korunur** — `Card Clock-ins` bu kelimelerin hiçbirini içermez.

CSV testinin bulunduğu `describe` bloğunun sonuna (aynı dosya, aynı blok — `prisma`, `svc` ve `scope` orada zaten tanımlı):

```ts
  it("counts card clock-ins separately in the summary", async () => {
    (prisma.attendance.findMany as any).mockResolvedValue([
      {
        userId: "u-1",
        user: { id: "u-1", firstName: "Ada", lastName: "Lovelace", role: "WAITER" },
        totalWorkedMinutes: 480,
        totalBreakMinutes: 30,
        overtimeMinutes: 0,
        isLate: false,
        lateMinutes: 0,
        clockInSource: "card",
      },
      {
        userId: "u-1",
        user: { id: "u-1", firstName: "Ada", lastName: "Lovelace", role: "WAITER" },
        totalWorkedMinutes: 480,
        totalBreakMinutes: 30,
        overtimeMinutes: 0,
        isLate: false,
        lateMinutes: 0,
        clockInSource: "manual",
      },
    ]);

    const [row] = await svc.getAttendanceSummary(scope, {} as any);

    expect(row.totalDays).toBe(2);
    expect(row.cardClockIns).toBe(1);
  });

  it("defaults clockInSource to manual for an app clock-in", async () => {
    // The 82 existing call sites pass no source. If the default were 'card',
    // every app punch would be reported as a card punch.
    prisma.tenant.findUnique.mockResolvedValue({
      timezone: "Europe/Istanbul",
    } as any);
    prisma.attendance.findFirst.mockResolvedValue(null);
    prisma.shiftAssignment.findFirst.mockResolvedValue(null);
    prisma.user.findUnique.mockResolvedValue({
      primaryBranchId: "branch-1",
    } as any);
    (prisma.attendance.create as any).mockResolvedValue({
      id: "a-1",
      branchId: "branch-1",
    });

    await svc.clockIn("t-1", "u-1");

    const data = (prisma.attendance.create as any).mock.calls[0][0].data;
    expect(data.clockInSource).toBe("manual");
  });

  it("stamps clockOutSource from the source argument", async () => {
    (prisma.attendance.findFirst as any).mockResolvedValue({
      id: "a-1",
      status: "CLOCKED_IN",
      clockIn: new Date(Date.now() - 60 * 60 * 1000),
      totalBreakMinutes: 0,
      shiftAssignment: null,
    });
    (prisma.attendance.updateMany as any).mockResolvedValue({ count: 1 });
    (prisma.attendance.findUniqueOrThrow as any).mockResolvedValue({
      id: "a-1",
      branchId: "branch-1",
    });

    await svc.clockOut("t-1", "u-1", AttendanceSource.CARD);

    const data = (prisma.attendance.updateMany as any).mock.calls[0][0].data;
    expect(data.clockOutSource).toBe("card");
  });
```

Dosyanın importlarına ekle:

```ts
import { AttendanceSource } from "../constants/personnel.enum";
```

> `scope` değişkeni bu dosyada zaten tanımlı (`{ tenantId: "t-1", branchId: "b-1" }`); yeni testler onu yeniden tanımlamaz.

- [ ] **Adım 3: Çalıştır ve başarısız olduklarını gör**

Çalıştır: `cd /home/tarik/Projects/kds/backend && npx jest src/modules/personnel/services/attendance.service.spec.ts`
Beklenen: FAIL — CSV başlık iddiası `Received: "Staff,Role,Total Days,Worked Minutes,Overtime Minutes,Break Minutes,Late Days,Late Minutes"` (sonda `,Card Clock-ins` yok) ve `counts card clock-ins separately in the summary` üzerinde `Received: undefined`.

- [ ] **Adım 4: `clockIn` imzasına ve create verisine kaynağı ekle**

`backend/src/modules/personnel/services/attendance.service.ts`, `clockIn` imzası:

```ts
  async clockIn(
    tenantId: string,
    userId: string,
    notes?: string,
    // Defaulted so the 82 existing call sites (controller, tests) keep their
    // meaning: anything that does not say otherwise is an in-app punch.
    source: AttendanceSource = AttendanceSource.MANUAL,
  ) {
```

ve `prisma.attendance.create` içindeki `data` bloğunda `notes,` satırının ardına:

```ts
          clockInSource: source,
```

Dosyanın importlarına `AttendanceSource`'u ekle (aynı `constants/personnel.enum` importuna).

- [ ] **Adım 5: `clockOut` imzasına ve updateMany verisine kaynağı ekle**

```ts
  async clockOut(
    tenantId: string,
    userId: string,
    source: AttendanceSource = AttendanceSource.MANUAL,
  ) {
```

ve `updateMany`'nin `data` bloğunda `overtimeMinutes,` satırının ardına:

```ts
        clockOutSource: source,
```

Bileşik WHERE (`status: attendance.status`) **korunur** — blok zaten yarış-güvenlidir, semantiği değişmez. `breakEnd` **değişmez**: mola bitişi bir giriş/çıkış damgası değildir, kaynak kolonuna dokunmaz.

- [ ] **Adım 6: Özete `cardClockIns` ekle**

`getAttendanceSummary` içinde grup başlatmada `totalLateMinutes: 0,` satırının ardına:

```ts
          // "Card-based attendance reporting" is only possible if the source
          // is distinguishable. Counted on clock-IN because that is the punch
          // the card rail always owns (a shift can be closed from the app).
          cardClockIns: 0,
```

ve toplamada `summary.totalOvertimeMinutes += a.overtimeMinutes;` satırının ardına:

```ts
      if (a.clockInSource === AttendanceSource.CARD) summary.cardClockIns++;
```

- [ ] **Adım 7: CSV başlığına ve satırına kolonu ekle**

`getAttendanceSummaryCsv` içinde `header` dizisinin sonuna:

```ts
      // Attendance/hours only — still no wage/pay/salary/cost/rate column.
      "Card Clock-ins",
```

ve satır üretiminde `escape(r.totalLateMinutes),` satırının ardına:

```ts
          escape(r.cardClockIns ?? 0),
```

- [ ] **Adım 8: Geçmiş sorgusuna `source` filtresini ekle**

`getAttendanceHistory` içinde `if (query.status) where.status = query.status;` satırının ardına:

```ts
    if (query.source) where.clockInSource = query.source;
```

`backend/src/modules/personnel/dto/attendance-query.dto.ts`, `AttendanceQueryDto` içinde `status` alanının ardına:

```ts
  // Declared explicitly because ValidationPipe runs with whitelist:true — an
  // undeclared query field is silently stripped and the filter never arrives.
  @ApiPropertyOptional({ enum: AttendanceSource })
  @IsOptional()
  @IsEnum(AttendanceSource)
  source?: AttendanceSource;
```

ve aynı dosyanın importunu `import { AttendanceSource, AttendanceStatus } from "../constants/personnel.enum";` yap.

- [ ] **Adım 9: Testleri çalıştır ve geçtiklerini gör**

Çalıştır: `cd /home/tarik/Projects/kds/backend && npx jest src/modules/personnel`
Beklenen: PASS — personel süitinin tamamı yeşil (CSV başlığı + veri satırı + üç yeni test dahil).

- [ ] **Adım 10: Derle ve commit'le**

```bash
cd /home/tarik/Projects/kds/backend && npx tsc --noEmit
cd /home/tarik/Projects/kds
git add backend/src/modules/personnel/constants/personnel.enum.ts backend/src/modules/personnel/dto/attendance-query.dto.ts backend/src/modules/personnel/services/attendance.service.ts backend/src/modules/personnel/services/attendance.service.spec.ts
git commit -m "feat(card-shift): puantajda damga kaynağı, kart girişi sayacı ve CSV kolonu"
```

---

## Görev 7: `CardShiftService` + `card-shift.controller.ts` + `card-tap` ucu + modül kaydı

Tap **toggle**'dır: açık kayıt yoksa `clockIn`, `CLOCKED_IN` ise `clockOut`, `ON_BREAK` ise `breakEnd`. Kiosk'ta başka kontrol yoktur; molada kalan personeli hata mesajıyla kilitlemek kabul edilemez. Mola **başlatma** uygulama içi kalır.

**K15 — metot düzeyi dekoratör sınıfı EZER** (`entitlement.guard.ts:62-66` `getAllAndOverride`). Bu yüzden `card-tap` metodunda **iki bayrak birden** tek çağrıda listelenir; yeni controller sınıf düzeyinde iki bayrağı taşır ve metotlarında entitlement dekoratörü **yoktur**.

**Files:**
- Create: `backend/src/modules/personnel/dto/card-shift.dto.ts`
- Create: `backend/src/modules/personnel/services/card-shift.service.ts`
- Create: `backend/src/modules/personnel/services/card-shift.service.spec.ts`
- Create: `backend/src/modules/personnel/controllers/card-shift.controller.ts`
- Modify: `backend/src/modules/personnel/controllers/attendance.controller.ts`
- Modify: `backend/src/modules/personnel/controllers/attendance.controller.spec.ts`
- Modify: `backend/src/modules/personnel/personnel.module.ts`
- Test: yukarıdaki iki spec

**Interfaces:**
- Consumes: `normalizeCardUid`, `isValidCardUid`, `cardUidHash`, `cardUidLast4`, `staffCardAad`, `STAFF_CARD_HASH_VERSION` (Görev 5); `AttendanceSource` ve `AttendanceService.clockIn(tenantId, userId, notes?, source?)` / `clockOut(tenantId, userId, source?)` / `breakEnd(tenantId, userId)` (Görev 6); `User.staffCard*` kolonları (Görev 4); `PlanFeature.CARD_SHIFT` (Görev 1)
- Produces:
  - `class CardTapDto { cardUid: string; notes?: string }`, `class AssignCardDto { cardUid: string }`
  - `type CardTapAction = "clockIn" | "clockOut" | "breakEnd" | "ignored"`
  - `interface CardTapResult { action: CardTapAction; user: CardStaffRef; attendance: Awaited<ReturnType<AttendanceService["clockIn"]>> | null }`
  - `interface CardStaffRef { id: string; firstName: string; lastName: string; role: string }`
  - `interface CardAssignmentView { userId: string; firstName: string; lastName: string; role: string; last4: string | null; assignedAt: Date | null; assignedById: string | null }`
  - `CardShiftService.tap(tenantId: string, dto: CardTapDto): Promise<CardTapResult>`
  - `CardShiftService.assign(tenantId: string, userId: string, actorUserId: string, dto: AssignCardDto): Promise<CardAssignmentView>`
  - `CardShiftService.revoke(tenantId: string, userId: string): Promise<{ userId: string; revoked: true }>`
  - `CardShiftService.list(tenantId: string): Promise<CardAssignmentView[]>`
  - HTTP: `POST /personnel/attendance/card-tap`, `POST /personnel/cards/:userId`, `DELETE /personnel/cards/:userId`, `GET /personnel/cards`

- [ ] **Adım 1: DTO'ları yaz**

`backend/src/modules/personnel/dto/card-shift.dto.ts`:

```ts
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from "class-validator";

// The reader types the UID like a keyboard: digits, letters, and whatever
// separator the vendor chose (colon, dot, hyphen, space). Anything else is not
// a card. Every field is declared because ValidationPipe runs with
// whitelist:true and silently strips what it does not know.
const CARD_UID_PATTERN = /^[0-9A-Za-z\s:.\-]{4,64}$/;

export class CardTapDto {
  @ApiProperty({ example: "04:A2:2B:9C" })
  @IsString()
  @MinLength(4)
  @MaxLength(64)
  @Matches(CARD_UID_PATTERN, {
    message: "cardUid contains unsupported characters",
  })
  cardUid: string;

  // Same cap as ClockInDto.notes.
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class AssignCardDto {
  @ApiProperty({ example: "04:A2:2B:9C" })
  @IsString()
  @MinLength(4)
  @MaxLength(64)
  @Matches(CARD_UID_PATTERN, {
    message: "cardUid contains unsupported characters",
  })
  cardUid: string;
}
```

- [ ] **Adım 2: Başarısız servis testini yaz**

`backend/src/modules/personnel/services/card-shift.service.spec.ts`:

```ts
import { ConflictException, NotFoundException } from "@nestjs/common";
import {
  mockPrismaClient,
  MockPrismaClient,
} from "../../../common/test/prisma-mock.service";
import { AttendanceService } from "./attendance.service";
import { CardShiftService } from "./card-shift.service";
import { AttendanceSource, AttendanceStatus } from "../constants/personnel.enum";
import { cardUidHash } from "../card-uid";

/**
 * The tap endpoint is the only thing standing between a plastic card and an
 * attendance row. Two properties carry the weight: it must never leak whether
 * an unknown card exists somewhere else, and it must never write attendance
 * itself — every late/break/overtime/overnight rule lives in AttendanceService
 * and a second implementation would drift from it silently.
 */
describe("CardShiftService.tap", () => {
  let prisma: MockPrismaClient;
  let attendance: jest.Mocked<Pick<AttendanceService, "clockIn" | "clockOut" | "breakEnd">>;
  let svc: CardShiftService;
  let warn: jest.SpyInstance;

  const TENANT = "t-1";
  const UID = "04:A2:2B:9C";
  const STAFF = {
    id: "u-1",
    firstName: "Ada",
    lastName: "Lovelace",
    role: "WAITER",
  };

  beforeEach(() => {
    process.env.ENCRYPTION_MASTER_KEY = "k".repeat(48);
    prisma = mockPrismaClient();
    attendance = {
      clockIn: jest.fn().mockResolvedValue({ id: "a-1" }),
      clockOut: jest.fn().mockResolvedValue({ id: "a-1" }),
      breakEnd: jest.fn().mockResolvedValue({ id: "a-1" }),
    } as any;
    svc = new CardShiftService(prisma as any, attendance as any);
    warn = jest.spyOn((svc as any).logger, "warn").mockImplementation(() => {});
    (prisma.user.findFirst as any).mockResolvedValue(STAFF);
    (prisma.attendance.findFirst as any).mockResolvedValue(null);
  });

  afterEach(() => warn.mockRestore());

  it("clocks in on the first tap of the day", async () => {
    const res = await svc.tap(TENANT, { cardUid: UID });

    expect(res.action).toBe("clockIn");
    expect(attendance.clockIn).toHaveBeenCalledWith(
      TENANT,
      "u-1",
      undefined,
      AttendanceSource.CARD,
    );
  });

  it("clocks out on the second tap", async () => {
    (prisma.attendance.findFirst as any).mockResolvedValue({
      id: "a-1",
      status: AttendanceStatus.CLOCKED_IN,
      updatedAt: new Date(Date.now() - 60_000),
    });

    const res = await svc.tap(TENANT, { cardUid: UID });

    expect(res.action).toBe("clockOut");
    expect(attendance.clockOut).toHaveBeenCalledWith(
      TENANT,
      "u-1",
      AttendanceSource.CARD,
    );
  });

  it("ends the break when the staff member is ON_BREAK", async () => {
    // Locking a staff member out with an error because they are on a break is
    // not acceptable at a kiosk with no other control.
    (prisma.attendance.findFirst as any).mockResolvedValue({
      id: "a-1",
      status: AttendanceStatus.ON_BREAK,
      updatedAt: new Date(Date.now() - 60_000),
    });

    const res = await svc.tap(TENANT, { cardUid: UID });

    expect(res.action).toBe("breakEnd");
    expect(attendance.breakEnd).toHaveBeenCalledWith(TENANT, "u-1");
  });

  it("ignores a duplicate tap inside the 10s debounce window", async () => {
    // HID readers can write one card twice. The second write would otherwise
    // close the shift the first one just opened.
    (prisma.attendance.findFirst as any).mockResolvedValue({
      id: "a-1",
      status: AttendanceStatus.CLOCKED_IN,
      updatedAt: new Date(Date.now() - 2_000),
    });

    const res = await svc.tap(TENANT, { cardUid: UID });

    expect(res.action).toBe("ignored");
    expect(res.attendance).toBeNull();
    expect(attendance.clockOut).not.toHaveBeenCalled();
  });

  it("404s an unknown card without revealing whether it exists in another tenant", async () => {
    (prisma.user.findFirst as any).mockResolvedValue(null);

    await expect(svc.tap(TENANT, { cardUid: UID })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    const where = (prisma.user.findFirst as any).mock.calls[0][0].where;
    expect(where.tenantId).toBe(TENANT);
  });

  it("404s a card belonging to an INACTIVE user", async () => {
    // Same body as an unknown card: a distinct error would confirm the card
    // exists and only the person is disabled.
    await svc.tap(TENANT, { cardUid: UID }).catch(() => undefined);
    const where = (prisma.user.findFirst as any).mock.calls[0][0].where;
    expect(where.status).toBe("ACTIVE");
  });

  it("400s a UID that is too short once normalised", async () => {
    await expect(svc.tap(TENANT, { cardUid: "0:4:A" })).rejects.toThrow(
      /CARD_UID_INVALID|geçersiz/i,
    );
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
  });

  it("never logs or returns the raw UID or the hash", async () => {
    (prisma.user.findFirst as any).mockResolvedValue(null);

    await svc.tap(TENANT, { cardUid: UID }).catch(() => undefined);

    const logged = warn.mock.calls.flat().join(" ");
    expect(logged).toContain("2B9C"); // last4 is the only affordance
    expect(logged).not.toContain("04A22B9C");
    expect(logged).not.toContain(cardUidHash(TENANT, UID));
  });

  it("matches on the tenant-scoped hash, never on a stored plaintext UID", async () => {
    await svc.tap(TENANT, { cardUid: UID });
    const where = (prisma.user.findFirst as any).mock.calls[0][0].where;
    expect(where.staffCardUidHash).toBe(cardUidHash(TENANT, UID));
  });

  it("repackages an already-clocked-out day as 409 ALREADY_CLOCKED_OUT_TODAY", async () => {
    const { BadRequestException } = await import("@nestjs/common");
    attendance.clockIn.mockRejectedValue(
      new BadRequestException("Already clocked out today. Cannot clock in again."),
    );

    await expect(svc.tap(TENANT, { cardUid: UID })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it("delegates to AttendanceService rather than writing attendance itself", async () => {
    await svc.tap(TENANT, { cardUid: UID });
    expect(prisma.attendance.create).not.toHaveBeenCalled();
    expect(prisma.attendance.updateMany).not.toHaveBeenCalled();
  });
});

describe("CardShiftService assignment surface", () => {
  let prisma: MockPrismaClient;
  let svc: CardShiftService;
  const TENANT = "t-1";

  beforeEach(() => {
    process.env.ENCRYPTION_MASTER_KEY = "k".repeat(48);
    prisma = mockPrismaClient();
    svc = new CardShiftService(prisma as any, {} as any);
  });

  it("stores hash + reversible copy + last4, never the raw UID", async () => {
    (prisma.user.findFirst as any).mockResolvedValue({ id: "u-1" });
    (prisma.user.update as any).mockResolvedValue({
      id: "u-1",
      firstName: "Ada",
      lastName: "Lovelace",
      role: "WAITER",
      staffCardLast4: "2B9C",
      staffCardAssignedAt: new Date("2026-08-20T10:00:00Z"),
      staffCardAssignedById: "u-admin",
    });

    const view = await svc.assign(TENANT, "u-1", "u-admin", {
      cardUid: "04:A2:2B:9C",
    });

    const data = (prisma.user.update as any).mock.calls[0][0].data;
    expect(data.staffCardUidHash).toHaveLength(64);
    expect(data.staffCardUidEnc.startsWith("v2:")).toBe(true);
    expect(data.staffCardLast4).toBe("2B9C");
    expect(data.staffCardHashVersion).toBe(1);
    expect(JSON.stringify(data)).not.toContain("04A22B9C");
    expect(view.last4).toBe("2B9C");
    expect(JSON.stringify(view)).not.toContain("staffCardUidHash");
  });

  it("nulls every card column on revoke and keeps past attendance", async () => {
    (prisma.user.updateMany as any).mockResolvedValue({ count: 1 });

    await svc.revoke(TENANT, "u-1");

    const data = (prisma.user.updateMany as any).mock.calls[0][0].data;
    expect(data).toEqual({
      staffCardUidHash: null,
      staffCardUidEnc: null,
      staffCardLast4: null,
      staffCardAssignedAt: null,
      staffCardAssignedById: null,
    });
    expect(prisma.attendance.deleteMany).not.toHaveBeenCalled();
  });

  it("404s revoking a user that is not in this tenant", async () => {
    (prisma.user.updateMany as any).mockResolvedValue({ count: 0 });
    await expect(svc.revoke(TENANT, "u-other")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("lists only the last 4 digits — never the hash or the ciphertext", async () => {
    (prisma.user.findMany as any).mockResolvedValue([
      {
        id: "u-1",
        firstName: "Ada",
        lastName: "Lovelace",
        role: "WAITER",
        staffCardLast4: "2B9C",
        staffCardAssignedAt: new Date("2026-08-20T10:00:00Z"),
        staffCardAssignedById: "u-admin",
      },
    ]);

    const rows = await svc.list(TENANT);

    const select = (prisma.user.findMany as any).mock.calls[0][0].select;
    expect(select.staffCardUidHash).toBeUndefined();
    expect(select.staffCardUidEnc).toBeUndefined();
    expect(rows[0]).toEqual({
      userId: "u-1",
      firstName: "Ada",
      lastName: "Lovelace",
      role: "WAITER",
      last4: "2B9C",
      assignedAt: new Date("2026-08-20T10:00:00Z"),
      assignedById: "u-admin",
    });
  });
});
```

- [ ] **Adım 3: Çalıştır ve başarısız olduğunu gör**

Çalıştır: `cd /home/tarik/Projects/kds/backend && npx jest src/modules/personnel/services/card-shift.service.spec.ts`
Beklenen: FAIL — `Cannot find module './card-shift.service' from 'src/modules/personnel/services/card-shift.service.spec.ts'`.

- [ ] **Adım 4: `CardShiftService`'i yaz**

`backend/src/modules/personnel/services/card-shift.service.ts`:

```ts
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../../../prisma/prisma.service";
import { AttendanceService } from "./attendance.service";
import { AttendanceSource, AttendanceStatus } from "../constants/personnel.enum";
import {
  cardUidHash,
  cardUidLast4,
  isValidCardUid,
  normalizeCardUid,
  staffCardAad,
  STAFF_CARD_HASH_VERSION,
} from "../card-uid";
import { encryptString } from "../../../common/helpers/encryption.helper";
import { AssignCardDto, CardTapDto } from "../dto/card-shift.dto";

export type CardTapAction = "clockIn" | "clockOut" | "breakEnd" | "ignored";

export interface CardStaffRef {
  id: string;
  firstName: string;
  lastName: string;
  role: string;
}

export interface CardTapResult {
  action: CardTapAction;
  user: CardStaffRef;
  /** The row AttendanceService produced, or null for an ignored tap. */
  attendance: Awaited<ReturnType<AttendanceService["clockIn"]>> | null;
}

export interface CardAssignmentView {
  userId: string;
  firstName: string;
  lastName: string;
  role: string;
  last4: string | null;
  assignedAt: Date | null;
  assignedById: string | null;
}

/**
 * Resolves "which staff member, which action" for a card tap and then DELEGATES
 * to AttendanceService.
 *
 * It deliberately writes no attendance of its own: lateness, breaks, overtime,
 * overnight shifts, the branch fallback and the P2002 race guard all live in
 * AttendanceService, and a second implementation would drift from them without
 * anything failing.
 */
@Injectable()
export class CardShiftService {
  private readonly logger = new Logger(CardShiftService.name);

  /**
   * Cheap HID readers can emit one physical tap twice. Without this window the
   * second write closes the shift the first one opened, one second later.
   */
  private static readonly DEBOUNCE_MS = 10_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly attendance: AttendanceService,
  ) {}

  async tap(tenantId: string, dto: CardTapDto): Promise<CardTapResult> {
    const uid = normalizeCardUid(dto.cardUid);
    if (!isValidCardUid(uid)) {
      throw new BadRequestException({
        code: "CARD_UID_INVALID",
        message: "Kart numarası geçersiz",
      });
    }

    const staff = await this.prisma.user.findFirst({
      where: {
        tenantId,
        // A disabled staff member gets the SAME answer as an unknown card:
        // a distinct error would confirm the card exists.
        status: "ACTIVE",
        staffCardUidHash: cardUidHash(tenantId, uid),
      },
      select: { id: true, firstName: true, lastName: true, role: true },
    });

    if (!staff) {
      // last4 is the only affordance that ever leaves this method. Never the
      // raw UID (it would enrol from the log) and never the hash.
      this.logger.warn(
        `Unrecognised staff card tenant=${tenantId} last4=${cardUidLast4(uid)}`,
      );
      throw new NotFoundException({
        code: "CARD_NOT_RECOGNISED",
        message: "Kart tanınmadı",
      });
    }

    // Same query shape clockOut uses — by STATUS, newest first, NOT by today's
    // date — so an overnight shift (date = yesterday) is found.
    const open = await this.prisma.attendance.findFirst({
      where: {
        tenantId,
        userId: staff.id,
        status: {
          in: [AttendanceStatus.CLOCKED_IN, AttendanceStatus.ON_BREAK],
        },
      },
      orderBy: { clockIn: "desc" },
    });

    if (
      open &&
      Date.now() - open.updatedAt.getTime() < CardShiftService.DEBOUNCE_MS
    ) {
      return { action: "ignored", user: staff, attendance: null };
    }

    try {
      if (!open) {
        const row = await this.attendance.clockIn(
          tenantId,
          staff.id,
          dto.notes,
          AttendanceSource.CARD,
        );
        return { action: "clockIn", user: staff, attendance: row };
      }
      if (open.status === AttendanceStatus.ON_BREAK) {
        // Ending a break is not a punch, so it stamps no source column.
        // Starting one stays in the app: a kiosk cannot tell the difference
        // between "going on a break" and "going home".
        const row = await this.attendance.breakEnd(tenantId, staff.id);
        return { action: "breakEnd", user: staff, attendance: row };
      }
      const row = await this.attendance.clockOut(
        tenantId,
        staff.id,
        AttendanceSource.CARD,
      );
      return { action: "clockOut", user: staff, attendance: row };
    } catch (err) {
      // attendance.service.ts:111-115 throws a prose BadRequest. At a kiosk it
      // has to become a code the screen can translate.
      if (
        err instanceof BadRequestException &&
        String(err.message).includes("Already clocked out today")
      ) {
        throw new ConflictException({
          code: "ALREADY_CLOCKED_OUT_TODAY",
          message: "Bugün çıkış yapılmış",
        });
      }
      throw err;
    }
  }

  async assign(
    tenantId: string,
    userId: string,
    actorUserId: string,
    dto: AssignCardDto,
  ): Promise<CardAssignmentView> {
    const uid = normalizeCardUid(dto.cardUid);
    if (!isValidCardUid(uid)) {
      throw new BadRequestException({
        code: "CARD_UID_INVALID",
        message: "Kart numarası geçersiz",
      });
    }

    const target = await this.prisma.user.findFirst({
      where: { id: userId, tenantId },
      select: { id: true },
    });
    if (!target) throw new NotFoundException("User not found");

    try {
      const row = await this.prisma.user.update({
        where: { id: userId },
        data: {
          staffCardUidHash: cardUidHash(tenantId, uid),
          // K22: the ONLY thing that makes an ENCRYPTION_MASTER_KEY rotation
          // survivable. Never read on the tap path, never returned.
          staffCardUidEnc: encryptString(uid, staffCardAad(tenantId, userId)),
          staffCardHashVersion: STAFF_CARD_HASH_VERSION,
          staffCardLast4: cardUidLast4(uid),
          staffCardAssignedAt: new Date(),
          staffCardAssignedById: actorUserId,
        },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          role: true,
          staffCardLast4: true,
          staffCardAssignedAt: true,
          staffCardAssignedById: true,
        },
      });
      return this.toView(row);
    } catch (err: any) {
      if (err?.code === "P2002") {
        throw new ConflictException({
          code: "CARD_ALREADY_ASSIGNED",
          message: "Bu kart başka bir personele atanmış",
        });
      }
      throw err;
    }
  }

  async revoke(
    tenantId: string,
    userId: string,
  ): Promise<{ userId: string; revoked: true }> {
    // updateMany with tenantId in the WHERE, not update-by-id: a bare id write
    // is a cross-tenant IDOR.
    const claim = await this.prisma.user.updateMany({
      where: { id: userId, tenantId },
      data: {
        staffCardUidHash: null,
        staffCardUidEnc: null,
        staffCardLast4: null,
        staffCardAssignedAt: null,
        staffCardAssignedById: null,
      },
    });
    if (claim.count === 0) throw new NotFoundException("User not found");
    // Past Attendance rows keep clockInSource='card' on purpose: they really
    // were stamped with a card.
    return { userId, revoked: true };
  }

  async list(tenantId: string): Promise<CardAssignmentView[]> {
    const rows = await this.prisma.user.findMany({
      where: { tenantId, status: "ACTIVE" },
      // staffCardUidHash / staffCardUidEnc are NOT selected. They must not be
      // able to reach a response by accident.
      select: {
        id: true,
        firstName: true,
        lastName: true,
        role: true,
        staffCardLast4: true,
        staffCardAssignedAt: true,
        staffCardAssignedById: true,
      },
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
    });
    return rows.map((r) => this.toView(r));
  }

  private toView(row: {
    id: string;
    firstName: string;
    lastName: string;
    role: string;
    staffCardLast4: string | null;
    staffCardAssignedAt: Date | null;
    staffCardAssignedById: string | null;
  }): CardAssignmentView {
    return {
      userId: row.id,
      firstName: row.firstName,
      lastName: row.lastName,
      role: row.role,
      last4: row.staffCardLast4,
      assignedAt: row.staffCardAssignedAt,
      assignedById: row.staffCardAssignedById,
    };
  }
}
```

- [ ] **Adım 5: Servis testini çalıştır ve geçtiğini gör**

Çalıştır: `cd /home/tarik/Projects/kds/backend && npx jest src/modules/personnel/services/card-shift.service.spec.ts`
Beklenen: PASS — 15 test yeşil.

- [ ] **Adım 6: `card-shift.controller.ts`'i yaz**

```ts
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Request,
  UseGuards,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { TenantGuard } from "../../auth/guards/tenant.guard";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { Roles } from "../../auth/decorators/roles.decorator";
import { UserRole } from "../../../common/constants/roles.enum";
import { RequiresFeature } from "../../subscriptions/decorators/requires-feature.decorator";
import { PlanFeature } from "../../../common/constants/subscription.enum";
import { CardShiftService } from "../services/card-shift.service";
import { AssignCardDto } from "../dto/card-shift.dto";

/**
 * Staff-card enrolment. Both flags are listed at CLASS level and no method
 * carries an entitlement decorator: the guard reads
 * getAllAndOverride([handler, class]) (entitlement.guard.ts:62-66), so a
 * method-level @RequiresFeature would OVERRIDE this pair rather than add to it.
 */
@ApiTags("personnel/cards")
@ApiBearerAuth()
@Controller("personnel/cards")
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@RequiresFeature(PlanFeature.PERSONNEL_MANAGEMENT, PlanFeature.CARD_SHIFT)
export class CardShiftController {
  constructor(private readonly cardShift: CardShiftService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: "Staff card assignments (last 4 digits only)" })
  list(@Request() req) {
    return this.cardShift.list(req.tenantId);
  }

  @Post(":userId")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  // Enrolment is a handful of taps per shift at most; 20/min leaves room for a
  // fumbled card and none for scanning a UID space.
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: "Assign (or replace) a staff card" })
  assign(
    @Request() req,
    @Param("userId") userId: string,
    @Body() dto: AssignCardDto,
  ) {
    return this.cardShift.assign(req.tenantId, userId, req.user.id, dto);
  }

  @Delete(":userId")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: "Revoke a staff card (attendance history is kept)" })
  revoke(@Request() req, @Param("userId") userId: string) {
    return this.cardShift.revoke(req.tenantId, userId);
  }
}
```

- [ ] **Adım 7: `card-tap` ucunu attendance controller'ına ekle**

`backend/src/modules/personnel/controllers/attendance.controller.ts`, `clockIn` metodunun hemen ardına:

```ts
  /**
   * The kiosk endpoint. The station tablet runs on an ADMIN/MANAGER session
   * (there is no device-token rail yet — §9/1), so the roles are theirs.
   *
   * BOTH flags in ONE call: the guard uses getAllAndOverride, so writing
   * @RequiresFeature here OVERRIDES the class-level personnelManagement
   * requirement instead of adding to it. Listing only cardShift would sell the
   * card rail to a tenant with no attendance module underneath it.
   */
  @Post("card-tap")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @RequiresFeature(PlanFeature.PERSONNEL_MANAGEMENT, PlanFeature.CARD_SHIFT)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: "Clock in/out by tapping an RFID staff card" })
  cardTap(@Request() req, @Body() dto: CardTapDto) {
    return this.cardShiftService.tap(req.tenantId, dto);
  }
```

Aynı dosyada importlara ekle:

```ts
import { Throttle } from "@nestjs/throttler";
import { CardTapDto } from "../dto/card-shift.dto";
import { CardShiftService } from "../services/card-shift.service";
```

ve constructor'ı genişlet:

```ts
  constructor(
    private readonly attendanceService: AttendanceService,
    private readonly cardShiftService: CardShiftService,
  ) {}
```

- [ ] **Adım 8: K15 regresyon kilidini yaz**

`backend/src/modules/personnel/controllers/attendance.controller.spec.ts`: `beforeEach` içinde controller'ı iki bağımlılıkla kur —

```ts
    ctrl = new AttendanceController(
      svc as unknown as AttendanceService,
      { tap: jest.fn().mockResolvedValue({}) } as any,
    );
```

ve dosyanın sonuna:

```ts
  it("card-tap requires BOTH personnelManagement and cardShift", () => {
    // K15. @RequiresFeature on a METHOD overrides the class-level decorator
    // (entitlement.guard.ts:62-66) instead of adding to it. Listing only
    // cardShift here would open the card rail on a tenant that never bought
    // the attendance module the rows are written onto.
    const meta = Reflect.getMetadata(
      REQUIRE_ENTITLEMENT_KEY,
      AttendanceController.prototype.cardTap,
    );
    expect(meta).toEqual([
      { feature: "feature.personnelManagement" },
      { feature: "feature.cardShift" },
    ]);
  });

  it("card-tap forwards the tenant and the body, never req.user.id", () => {
    // The tap identifies the person by CARD. Using the logged-in actor would
    // clock the manager in every time a waiter taps.
    const cardShift = (ctrl as any).cardShiftService;
    ctrl.cardTap({ tenantId: "t1", user: { id: "u1" } }, { cardUid: "04A2" } as any);
    expect(cardShift.tap).toHaveBeenCalledWith("t1", { cardUid: "04A2" });
  });
```

Dosyanın importlarına ekle:

```ts
import { REQUIRE_ENTITLEMENT_KEY } from "../../entitlements/require-entitlement.decorator";
```

- [ ] **Adım 9: Modül kaydını yap**

`backend/src/modules/personnel/personnel.module.ts`: `CardShiftController`'ı `controllers` dizisine, `CardShiftService`'i `providers` ve `exports` dizilerine ekle; importları da ekle:

```ts
import { CardShiftController } from "./controllers/card-shift.controller";
import { CardShiftService } from "./services/card-shift.service";
```

- [ ] **Adım 10: Personel süitini çalıştır ve geçtiğini gör**

Çalıştır: `cd /home/tarik/Projects/kds/backend && npx jest src/modules/personnel`
Beklenen: PASS — controller ve servis testleri dahil hepsi yeşil.

- [ ] **Adım 11: Derle, lint'le ve commit'le**

```bash
cd /home/tarik/Projects/kds/backend && npx tsc --noEmit
cd /home/tarik/Projects/kds/backend && npm run lint:ci
cd /home/tarik/Projects/kds
git add backend/src/modules/personnel/dto/card-shift.dto.ts backend/src/modules/personnel/services/card-shift.service.ts backend/src/modules/personnel/services/card-shift.service.spec.ts backend/src/modules/personnel/controllers/card-shift.controller.ts backend/src/modules/personnel/controllers/attendance.controller.ts backend/src/modules/personnel/controllers/attendance.controller.spec.ts backend/src/modules/personnel/personnel.module.ts
git commit -m "feat(card-shift): kart okutma ucu, kart atama yüzeyi ve modül kaydı"
```

---

## Görev 8: Donanım — `card_reader` kategorisi + saleMode varsayılanı + seed SKU'su

Mevcut en yakın değer `scanner` = "Barkod Okuyucu"; kart okuyucuyu oraya koymak vitrin filtresinde yalan olurdu ve sözlük tam da tek noktadan genişletilmek için var. Kılavuzsuz SKU satılmaz — kılavuz Görev 15'te yazılır, SKU'nun kendisi burada.

**Files:**
- Modify: `backend/src/modules/catalog/category-vocabulary.ts` (`HARDWARE_CATEGORIES`, `scanner`'ın hemen ardı)
- Modify: `backend/src/modules/catalog/dto/create-hardware-product.dto.ts` (`CATEGORY_DEFAULT_SALE_MODE` `:46-60`)
- Modify: `backend/src/modules/catalog/category-vocabulary.spec.ts`
- Modify: `backend/prisma/seeds/seed-marketplace.ts` (`PRODUCTS`, scanner bloğunun ardı)
- Modify: `frontend/src/pages/superadmin/MarketplaceAdminPage.tsx` (`:602-612`)
- Test: `backend/src/modules/catalog/category-vocabulary.spec.ts`

**Interfaces:**
- Consumes: yok
- Produces: `HARDWARE_CATEGORIES` içinde `{ value: "card_reader", labelTr: "Kart Okuyucu" }`; `CATEGORY_DEFAULT_SALE_MODE["card_reader"] === "DIRECT_SALE"`; seed SKU `card-reader-rfid-usb-hid` (fiyat `129_000`, garanti 12 ay, `stockStatus: "in_stock"`)

- [ ] **Adım 1: Başarısız testi yaz**

`backend/src/modules/catalog/category-vocabulary.spec.ts`, importa `CATEGORY_DEFAULT_SALE_MODE`'u ekle ve dosyanın sonuna:

```ts
  it('carries the card-reader category AND its saleMode default', () => {
    // Two lists, one concept. The vocabulary decides what the @IsIn gate and
    // the storefront filter accept; CATEGORY_DEFAULT_SALE_MODE decides the
    // regulatory tier applied when an admin omits saleMode. A value present in
    // one and missing from the other publishes a product with an undefined
    // tier — which the DIRECT_SALE publish gate then fails, silently, at
    // create time.
    expect(CATEGORY_VALUES).toContain('card_reader');
    expect(CATEGORY_DEFAULT_SALE_MODE['card_reader']).toBe('DIRECT_SALE');
  });

  it('gives every vocabulary value a default sale mode', () => {
    // The general form of the bug above, so the next category cannot repeat it.
    const missing = CATEGORY_VALUES.filter(
      (v) => !(v in CATEGORY_DEFAULT_SALE_MODE),
    );
    expect(missing).toEqual([]);
  });
```

Import satırı:

```ts
import { CATEGORY_DEFAULT_SALE_MODE } from './dto/create-hardware-product.dto';
```

- [ ] **Adım 2: Çalıştır ve başarısız olduğunu gör**

Çalıştır: `cd /home/tarik/Projects/kds/backend && npx jest src/modules/catalog/category-vocabulary.spec.ts`
Beklenen: FAIL — `carries the card-reader category AND its saleMode default` üzerinde `expect(CATEGORY_VALUES).toContain('card_reader')` patlar (dizide yok).

- [ ] **Adım 3: Sözlüğe ve saleMode haritasına ekle**

`backend/src/modules/catalog/category-vocabulary.ts`, `{ value: "scanner", labelTr: "Barkod Okuyucu" },` satırının hemen ardına:

```ts
  // Staff RFID card reader (13.56 MHz Mifare, USB HID). NOT `scanner`: that
  // value renders as "Barkod Okuyucu" in the storefront filter, which would be
  // a lie on a product that reads no barcodes.
  { value: "card_reader", labelTr: "Kart Okuyucu" },
```

`backend/src/modules/catalog/dto/create-hardware-product.dto.ts`, `CATEGORY_DEFAULT_SALE_MODE` içinde `scanner: "DIRECT_SALE",` satırının ardına:

```ts
  card_reader: "DIRECT_SALE", // Tier 3 — not a fiscal device, sold outright
```

> **Ortak dosya uyarısı:** bu DTO'yu 3D baskı PR'ı da düzenliyor (SKU regex'i, `:69-71`). Merge sırasında iki düzenleme aynı dosyada buluşur; ikisi de korunur.

- [ ] **Adım 4: Çalıştır ve geçtiğini gör**

Çalıştır: `cd /home/tarik/Projects/kds/backend && npx jest src/modules/catalog/category-vocabulary.spec.ts`
Beklenen: PASS — 6 test yeşil.

- [ ] **Adım 5: Seed'e SKU'yu ekle**

`backend/prisma/seeds/seed-marketplace.ts`, `PRODUCTS` içinde `scanner-zebra-ds2208` girdisinin ardına, `// ── Caller ID` yorumundan önce:

```ts
  // ── RFID Personel Kart Okuyucu ───────────────────────────────────────
  {
    sku: "card-reader-rfid-usb-hid",
    category: "card_reader",
    name: "RFID Personel Kart Okuyucu (USB HID) + 10 Kart",
    description:
      "Masaüstü 13.56 MHz (Mifare) USB kart okuyucu. Bilgisayara klavye gibi bağlanır, sürücü gerektirmez: kartı okuttuğunuzda numarayı ekrandaki alana yazar. Kartlı Vardiya modülü ile personel giriş-çıkışı için 10 adet personel kartı dahildir.",
    specs: {
      headlineSpecs: ["13.56 MHz Mifare", "USB HID — sürücüsüz", "10 kart dahil"],
    },
    compat: { requiredAddOn: ["module_personnel_card_shift"] },
    priceCents: 129_000,
    warrantyMonths: 12,
    images: [],
    stockStatus: "in_stock",
  },
```

- [ ] **Adım 6: Superadmin kategori `<select>`'ine ekle**

`frontend/src/pages/superadmin/MarketplaceAdminPage.tsx`, `<option value="scanner">scanner</option>` satırının hemen ardına:

```tsx
              <option value="card_reader">card_reader</option>
```

> Bu `<select>` sözlükten türemiyor ve **zaten drift'te** (`cash_drawer`/`scale`/`accessory`/`cable`/`service` eksik, sözlükte olmayan `other` fazladan). Bu PR yalnız **kendi** değerini ekler; mevcut drift'i onarmak kapsam dışıdır (§9/9).
> ⚠️ **Ortak dosya:** 3D baskı PR'ı **aynı** `<select>`'e `<option value="service">` ekliyor. İki ekleme bitişik satırlara düşer; ikinci merge olan taraf diğerinin seçeneğini **silmez**.

- [ ] **Adım 7: Doğrula ve commit'le**

```bash
cd /home/tarik/Projects/kds/backend && npx tsc --noEmit
cd /home/tarik/Projects/kds/frontend && npx tsc --noEmit -p tsconfig.json
cd /home/tarik/Projects/kds
git add backend/src/modules/catalog/category-vocabulary.ts backend/src/modules/catalog/category-vocabulary.spec.ts backend/src/modules/catalog/dto/create-hardware-product.dto.ts backend/prisma/seeds/seed-marketplace.ts frontend/src/pages/superadmin/MarketplaceAdminPage.tsx
git commit -m "feat(card-shift): card_reader donanım kategorisi ve RFID okuyucu SKU'su"
```

---

## Görev 9: Katalog satırı `module_personnel_card_shift` + katalog invariant testleri

**Bu göreve Görev 1 (bayrak), Görev 2 (vitrin `deps`) ve Görev 3 (topolojik sıra) tamamlanmadan başlanmaz.** Satır bunlar olmadan satılırsa kart çekilir ve tx geri sarılır.

`sortOrder: 18` seçildi: bugün kullanılan sıralar 0, 10–16, 20–22, 24, 25, 26, 30, 40–43, 50 → 17/18/19/23 boş. Change 1 ayrıca 21 ve 22'yi boşaltıyor; 18 **her iki durumda da** boştur.

**Files:**
- Modify: `backend/src/modules/marketplace/alacarte-catalog.const.ts` (modüller bloğunun sonu, `module_external_display`'in ardı — `:359` civarı)
- Modify: `backend/src/modules/marketplace/catalog-validation.spec.ts`
- Test: `backend/src/modules/marketplace/catalog-validation.spec.ts`

**Interfaces:**
- Consumes: `FEATURE_KEYS` içindeki `"cardShift"` (Görev 1) — `isKnownGrantKey("feature.cardShift")` doğrulayıcının geçmesi için şart
- Produces: `ALACARTE_CATALOG_BY_CODE.get("module_personnel_card_shift")` — `kind: "module"`, `billing: "oneTime"`, `priceCents: 400_000`, `deps: ["module_personnel"]`, `requiresLicense: true`, `sortOrder: 18`, `grants: { "feature.cardShift": true }`, `maxQuantity` **undefined**, beş dilli `i18n`

- [ ] **Adım 1: Başarısız invariant testlerini yaz**

`backend/src/modules/marketplace/catalog-validation.spec.ts`, `describe("the shipped à-la-carte catalog", …)` bloğunun sonuna:

```ts
  it("binds card shift to the personnel module", () => {
    const card = ALACARTE_CATALOG_BY_CODE.get("module_personnel_card_shift")!;
    expect(card).toBeDefined();
    expect(card.deps).toEqual(["module_personnel"]);
    expect(card.billing).toBe("oneTime");
    expect(card.priceCents).toBe(400_000);
    expect(card.requiresLicense).toBe(true);
    expect(card.sortOrder).toBe(18);
    expect(card.grants).toEqual({ "feature.cardShift": true });
    // maxQuantity is read ONLY for kind:'capacity'
    // (addon-purchasability.rules.ts:124-133); a module's second purchase is
    // blocked by isOwned instead. Setting it here would be inert noise.
    expect(card.maxQuantity).toBeUndefined();
  });

  it("accepts a oneTime cadence for kind:'module'", () => {
    // K5. catalog-validation.ts only pins a cadence for license (→annual),
    // credit and service (→oneTime); `case "module"` asks for at least one
    // feature.* grant and nothing else. This locks that in, because a
    // well-meaning "modules are annual" rule would make this product illegal.
    expect(
      validateCatalogRow(
        base({
          kind: "module",
          billing: "oneTime",
          grants: { "feature.cardShift": true },
        }),
      ),
    ).toEqual([]);
  });

  it("keeps every description's licence sentence — a one-time price is not forever", () => {
    // K21/§8 Risk 3: paying ₺4.000 once and then letting the licence lapse
    // DARKENS the module (plan-projector.service.ts:282). The five locale
    // descriptions are the only place the customer is told before they pay.
    const card = ALACARTE_CATALOG_BY_CODE.get("module_personnel_card_shift")!;
    const promises: Record<string, RegExp> = {
      tr: /lisansınız aktif olduğu sürece geçerlidir/i,
      en: /as long as your licence is active/i,
      ru: /пока действует ваша лицензия/i,
      ar: /ما دام ترخيصك ساريًا/,
      uz: /litsenziyangiz faol bo'lgunicha amal qiladi/i,
    };
    for (const [locale, pattern] of Object.entries(promises)) {
      expect(card.i18n[locale].description).toMatch(pattern);
    }
  });
```

> ⚠️ **Ortak dosya:** teslimat PR'ı (Change 1) aynı dosyadaki `delivery_*` invaryantını (`:256-265`, bugün `expect(delivery.length).toBe(3)`) tek `delivery_platforms` satırına göre yeniden yazıyor. **O testin sahibi Change 1'dir; bu PR ona dokunmaz** — üç yeni `it()` bloğunu merge sonrası hâlin üstüne ekler.

- [ ] **Adım 2: Çalıştır ve başarısız olduğunu gör**

Çalıştır: `cd /home/tarik/Projects/kds/backend && npx jest src/modules/marketplace/catalog-validation.spec.ts`
Beklenen: FAIL — `binds card shift to the personnel module` üzerinde `expect(card).toBeDefined()` patlar (`Received: undefined`).

- [ ] **Adım 3: Katalog satırını ekle**

`backend/src/modules/marketplace/alacarte-catalog.const.ts`, `module_external_display` nesnesinin ardına (`priority_support` yorumundan önce). **Beş dilin metni normatiftir — bu baytlar Görev 10'un migration'ına birebir kopyalanacak:**

```ts
  {
    code: "module_personnel_card_shift",
    name: "Kartlı Vardiya",
    description:
      "Personel giriş-çıkışını RFID kart okutarak damgalar. Ucuz USB kart okuyucularla çalışır; puantaj, mola ve fazla mesai hesabı Personel Yönetimi modülündeki kayıtların üstüne yazılır. Tek seferlik satın alma — yenileme ücreti yoktur, lisansınız aktif olduğu sürece geçerlidir.",
    kind: "module",
    // oneTime is legal for a module: catalog-validation.ts pins a cadence only
    // for license/credit/service. The lock is permanent — purchase() leaves
    // currentPeriodEnd NULL, the sweeper only scans `not: null`, and the
    // projector writes validUntil = null.
    billing: "oneTime",
    priceCents: 400_000,
    grants: { "feature.cardShift": true },
    // The catalog's FIRST module→module dependency. The storefront projects
    // deps (licensing.controller.ts) and provisioning sorts on them
    // (checkout/provision-order.ts) precisely so this row is sellable.
    deps: ["module_personnel"],
    requiresLicense: true,
    sortOrder: 18,
    i18n: t(
      [
        "Kartlı Vardiya",
        "Personel giriş-çıkışını RFID kart okutarak damgalar. Ucuz USB kart okuyucularla çalışır; puantaj, mola ve fazla mesai hesabı Personel Yönetimi modülündeki kayıtların üstüne yazılır. Tek seferlik satın alma — yenileme ücreti yoktur, lisansınız aktif olduğu sürece geçerlidir.",
      ],
      [
        "Card Shift",
        "Staff clock in and out by tapping an RFID card. It works with inexpensive USB readers; attendance, breaks and overtime are written onto the records of the Staff Management module. One-time purchase — there is no renewal fee, and it stays available for as long as your licence is active.",
      ],
      [
        "Смена по карте",
        "Сотрудники отмечают приход и уход, прикладывая RFID-карту. Работает с недорогими USB-считывателями; учёт времени, перерывы и сверхурочные пишутся поверх записей модуля «Управление персоналом». Разовая покупка — плата за продление отсутствует, доступ сохраняется, пока действует ваша лицензия.",
      ],
      [
        "الوردية بالبطاقة",
        "يسجّل الموظفون الدخول والخروج بتمرير بطاقة RFID. يعمل مع قارئات USB غير المكلفة؛ تُكتب سجلات الحضور والاستراحات والعمل الإضافي فوق سجلات وحدة إدارة الموظفين. شراء لمرة واحدة — لا توجد رسوم تجديد، ويظل متاحًا ما دام ترخيصك ساريًا.",
      ],
      [
        "Karta bilan smena",
        "Xodimlar RFID kartani o'qitib kelish-ketishni qayd etadi. Arzon USB o'quvchilar bilan ishlaydi; davomat, tanaffus va qo'shimcha ish vaqti Xodimlarni boshqarish moduli yozuvlari ustiga yoziladi. Bir martalik xarid — yangilash to'lovi yo'q, litsenziyangiz faol bo'lgunicha amal qiladi.",
      ],
    ),
  },
```

- [ ] **Adım 4: Katalog testlerini çalıştır**

Çalıştır: `cd /home/tarik/Projects/kds/backend && npx jest src/modules/marketplace/catalog-validation.spec.ts`
Beklenen: PASS — üç yeni test ve mevcut invariant'lar (`:203` geçerlilik, `:226` benzersiz kod+sortOrder, `:238` dep çözünürlüğü, `:273` beş dil, `:285` ≥100 kuruş) yeşil.

- [ ] **Adım 5: Drift tripwire'ının BEKLENDİĞİ GİBİ kızardığını gör**

Çalıştır: `cd /home/tarik/Projects/kds/backend && npx jest src/modules/marketplace/alacarte-catalog-migration.spec.ts`
Beklenen: FAIL — `upserts exactly the products in the catalog constant` üzerinde küme farkı: sabitte `module_personnel_card_shift` var, katlanmış migration durumunda yok. **Bu doğru davranıştır** ve Görev 10'da katlayıcı genişletilerek kapanır. Testi "düzeltme".

- [ ] **Adım 6: Commit'le**

```bash
cd /home/tarik/Projects/kds
git add backend/src/modules/marketplace/alacarte-catalog.const.ts backend/src/modules/marketplace/catalog-validation.spec.ts
git commit -m "feat(card-shift): Kartlı Vardiya katalog satırı (₺4.000 tek seferlik)"
```

---

## Görev 10: `20260820160000_card_shift_catalog` (up/down) + drift spec genişletmesi + round-trip

İki ayrı migration çiftinin nedeni: DDL geri alınabilir olmalı ama bir tenant tarafından satın alınmış bir veri satırı geri **alınmamalı**; tek dosyada bu iki politika çatışır.

**Katlayıcı ZATEN VAR ve yeşil (bugün 9/9; Change 1 sekiz tripwire daha ekler → merge sonrası 17).** Bu görev onu sıfırdan yazmaz — `FOLLOW_UP_SQL`'e **bir satır** ekler ve `effective`'e INSERT'leri öğretir. `parseRepricing` / `parseArchived` **hiç ellenmez**. Uygulanmış `20260820120000_reprice_licence_and_stock` **düzenlenmez** (checksum'lı).

**Files:**
- Create: `backend/prisma/migrations/20260820160000_card_shift_catalog/migration.sql`
- Create: `backend/prisma/migrations/20260820160000_card_shift_catalog/down.sql`
- Modify: `backend/src/modules/marketplace/alacarte-catalog-migration.spec.ts`
- Test: `backend/src/modules/marketplace/alacarte-catalog-migration.spec.ts` + Adım 6-8'in psql turu

**Interfaces:**
- Consumes: `ALACARTE_CATALOG` satırı (Görev 9), `card_reader` kategorisi (Görev 8), `HardwareSaleMode` PG enum'u (`20260603110000_add_hardware_sale_mode/migration.sql:2`)
- Produces: `marketplace_addons` satırı `module_personnel_card_shift`; `hardware_products` satırı `card-reader-rfid-usb-hid` + `hardware_inventory` satırı (`available: 25`); drift spec'inde `insertedLater` katlaması

- [ ] **Adım 1: `migration.sql`'i yaz**

Üslup `20260811100000_alacarte_catalog/migration.sql:1-90`'dan **birebir** devralınır — aynı kolon listesi, aynı satır kırılımı, aynı `ON CONFLICT` bloğu — çünkü `parseUpserts` regex'i (`:67-89`) tam olarak bu şekli çözümlüyor. **Satır sonlarını değiştirmek tripwire'ı sessizce kör eder.**

`backend/prisma/migrations/20260820160000_card_shift_catalog/migration.sql`:

```sql
-- @doctor:idempotent verified=marketplace_addons/hardware_products'a ON CONFLICT (code|sku) DO UPDATE ile yazar, hardware_inventory'ye ON CONFLICT DO NOTHING; tenant_addons'a, entitlement'lara ve siparişlere dokunmaz. Tekrar çalıştırma aynı kataloğa yakınsar.
--
-- Kartlı Vardiya (v3.6.8): katalog ürünü + USB HID RFID okuyucu SKU'su.
--
-- STATUS NEDEN "DO UPDATE" LİSTESİNDE DEĞİL
-- 20260811100000 satırı ON CONFLICT'te "status"u da ezer; bir superadmin ürünü
-- arşivledikten sonra migration tekrar oynatılırsa ürün kendiliğinden yeniden
-- yayına girer. Burada "status" DO UPDATE listesinden ÇIKARILDI: ilk INSERT
-- 'published' yazar, sonraki her çalıştırma operatörün seçimini korur.
--
-- Tablo adları snake_case @@map adlarıdır.

-- 1) Katalog ürünü ------------------------------------------------------------
INSERT INTO "marketplace_addons" (
  "id", "code", "name", "description", "kind", "billing", "priceCents",
  "currency", "grants", "deps", "status", "requiresLicense", "creditKind",
  "creditUnits", "maxQuantity", "sortOrder", "i18n", "commissionRate",
  "createdAt", "updatedAt"
) VALUES (
  gen_random_uuid()::text, 'module_personnel_card_shift', 'Kartlı Vardiya', 'Personel giriş-çıkışını RFID kart okutarak damgalar. Ucuz USB kart okuyucularla çalışır; puantaj, mola ve fazla mesai hesabı Personel Yönetimi modülündeki kayıtların üstüne yazılır. Tek seferlik satın alma — yenileme ücreti yoktur, lisansınız aktif olduğu sürece geçerlidir.',
  'module', 'oneTime', 400000, 'TRY',
  '{"feature.cardShift":true}'::jsonb, ARRAY['module_personnel']::TEXT[], 'published', true,
  NULL, NULL,
  NULL, 18, '{"tr":{"name":"Kartlı Vardiya","description":"Personel giriş-çıkışını RFID kart okutarak damgalar. Ucuz USB kart okuyucularla çalışır; puantaj, mola ve fazla mesai hesabı Personel Yönetimi modülündeki kayıtların üstüne yazılır. Tek seferlik satın alma — yenileme ücreti yoktur, lisansınız aktif olduğu sürece geçerlidir."},"en":{"name":"Card Shift","description":"Staff clock in and out by tapping an RFID card. It works with inexpensive USB readers; attendance, breaks and overtime are written onto the records of the Staff Management module. One-time purchase — there is no renewal fee, and it stays available for as long as your licence is active."},"ru":{"name":"Смена по карте","description":"Сотрудники отмечают приход и уход, прикладывая RFID-карту. Работает с недорогими USB-считывателями; учёт времени, перерывы и сверхурочные пишутся поверх записей модуля «Управление персоналом». Разовая покупка — плата за продление отсутствует, доступ сохраняется, пока действует ваша лицензия."},"ar":{"name":"الوردية بالبطاقة","description":"يسجّل الموظفون الدخول والخروج بتمرير بطاقة RFID. يعمل مع قارئات USB غير المكلفة؛ تُكتب سجلات الحضور والاستراحات والعمل الإضافي فوق سجلات وحدة إدارة الموظفين. شراء لمرة واحدة — لا توجد رسوم تجديد، ويظل متاحًا ما دام ترخيصك ساريًا."},"uz":{"name":"Karta bilan smena","description":"Xodimlar RFID kartani o''qitib kelish-ketishni qayd etadi. Arzon USB o''quvchilar bilan ishlaydi; davomat, tanaffus va qo''shimcha ish vaqti Xodimlarni boshqarish moduli yozuvlari ustiga yoziladi. Bir martalik xarid — yangilash to''lovi yo''q, litsenziyangiz faol bo''lgunicha amal qiladi."}}'::jsonb, 0.10,
  NOW(), NOW()
)
ON CONFLICT ("code") DO UPDATE SET
  "name"            = EXCLUDED."name",
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

-- 2) Donanım SKU'su -----------------------------------------------------------
-- category='card_reader' (yeni sözlük değeri), saleMode=DIRECT_SALE.
-- complianceDocs, seed'in SEED_DEFAULT_COMPLIANCE'ı ile aynı: {"invoiceIssued":true}
-- (DIRECT_SALE yayın kapısı en az bir dolu alan ister).
INSERT INTO "hardware_products" (
  "id", "sku", "category", "name", "brand", "model", "description", "specs",
  "compat", "details", "serviceMeta", "priceCents", "rentalMonthlyCents",
  "currency", "warrantyMonths", "images", "stockStatus", "shippingProfile",
  "status", "saleMode", "partnerRedirect", "complianceDocs", "createdAt", "updatedAt"
) VALUES (
  gen_random_uuid()::text, 'card-reader-rfid-usb-hid', 'card_reader',
  'RFID Personel Kart Okuyucu (USB HID) + 10 Kart', NULL, NULL,
  'Masaüstü 13.56 MHz (Mifare) USB kart okuyucu. Bilgisayara klavye gibi bağlanır, sürücü gerektirmez: kartı okuttuğunuzda numarayı ekrandaki alana yazar. Kartlı Vardiya modülü ile personel giriş-çıkışı için 10 adet personel kartı dahildir.',
  '{"headlineSpecs":["13.56 MHz Mifare","USB HID — sürücüsüz","10 kart dahil"]}'::jsonb,
  '{"requiredAddOn":["module_personnel_card_shift"]}'::jsonb,
  NULL, NULL, 129000, NULL, 'TRY', 12, ARRAY[]::TEXT[], 'in_stock', NULL,
  'published', 'DIRECT_SALE'::"HardwareSaleMode", NULL,
  '{"invoiceIssued":true}'::jsonb, NOW(), NOW()
)
ON CONFLICT ("sku") DO UPDATE SET
  "category" = EXCLUDED."category", "name" = EXCLUDED."name",
  "description" = EXCLUDED."description", "specs" = EXCLUDED."specs",
  "compat" = EXCLUDED."compat", "priceCents" = EXCLUDED."priceCents",
  "warrantyMonths" = EXCLUDED."warrantyMonths", "updatedAt" = NOW();

-- 3) Stok satırı --------------------------------------------------------------
-- Seed'in create-only davranışıyla aynı (seed-marketplace.ts:1104-1110): var olan
-- bir stok satırı ASLA ezilmez — gerçek receiveStock/allocate hareketi silinirdi.
INSERT INTO "hardware_inventory" ("id", "productId", "available", "allocated", "shipped", "updatedAt")
SELECT gen_random_uuid()::text, hp."id", 25, 0, 0, NOW()
  FROM "hardware_products" hp
 WHERE hp."sku" = 'card-reader-rfid-usb-hid'
   AND NOT EXISTS (SELECT 1 FROM "hardware_inventory" hi WHERE hi."productId" = hp."id");
```

- [ ] **Adım 2: `down.sql`'i yaz**

`backend/prisma/migrations/20260820160000_card_shift_catalog/down.sql`:

```sql
-- Rollback: card_shift_catalog.
--
-- Silme, PARASI ÖDENMİŞ hiçbir satıra dokunamaz: TenantAddOn.addOnId
-- onDelete: Restrict, yani sahiplenilmiş bir katalog satırını silmek ya hata
-- verir ya da ödenmiş bir yetkiyi öksüz bırakır. NOT EXISTS guard'ı olmadan bu
-- rollback bir müşterinin ₺4.000'ını yok edebilir. Aynı mantık donanımda sipariş
-- kalemi için geçerlidir.
-- Idempotent: ikinci çalıştırma hiçbir satır bulmaz.

DELETE FROM "marketplace_addons" m
 WHERE m."code" = 'module_personnel_card_shift'
   AND NOT EXISTS (SELECT 1 FROM "tenant_addons" ta WHERE ta."addOnId" = m."id");

-- Sipariş edilmemiş SKU'nun stok satırı ve kendisi gider; sipariş görmüşse kalır.
DELETE FROM "hardware_inventory" hi
 USING "hardware_products" hp
 WHERE hi."productId" = hp."id"
   AND hp."sku" = 'card-reader-rfid-usb-hid'
   AND hi."allocated" = 0 AND hi."shipped" = 0
   AND NOT EXISTS (SELECT 1 FROM "hardware_order_items" oi WHERE oi."productId" = hp."id");

DELETE FROM "hardware_products" hp
 WHERE hp."sku" = 'card-reader-rfid-usb-hid'
   AND NOT EXISTS (SELECT 1 FROM "hardware_order_items" oi WHERE oi."productId" = hp."id")
   AND NOT EXISTS (SELECT 1 FROM "hardware_inventory" hi WHERE hi."productId" = hp."id");
```

- [ ] **Adım 3: Drift spec'ini genişlet (üç düzenleme, sıfırdan yazma yok)**

`backend/src/modules/marketplace/alacarte-catalog-migration.spec.ts`:

**(a)** `FOLLOW_UP_SQL` dizisine, zincirdeki sırasına göre **bir satır**:

> ⚠️ **Ortak dosya — Change 1 önce merge olur.** Bu dizinin sahibi teslimat PR'ıdır (Change 1); o PR diziye `20260820140000_delivery_platforms_bundle` satırını **ve altındaki `BUNDLE_UP` / `BUNDLE_DOWN` sabitlerini** yazar. Aşağıdaki blok, Change 1 merge **olduktan sonraki** hâldir: **bir satır eklenir, hiçbir satır silinmez.** Diziyi iki girdiye indirirsen teslimat satırı düşer → `BUNDLE_UP` / `BUNDLE_DOWN` `find(...)!` üzerinden `undefined` döner ve Change 1'in sekiz tripwire'ı `ReferenceError`/`TypeError` ile patlar, `insertedLater` da `delivery_platforms`'ı görmez olur; süitin tamamı kızarır. Aynı kural Görev 10'un başındaki uyarıyla birebir aynıdır: **o dosyanın teslimat kısımlarının sahibi Change 1'dir; bu PR onlara dokunmaz.**

```ts
const FOLLOW_UP_SQL = [
  "20260820120000_reprice_licence_and_stock/migration.sql",
  "20260820140000_delivery_platforms_bundle/migration.sql",  // Change 1 — SİLME
  "20260820160000_card_shift_catalog/migration.sql",
].map((rel) => join(__dirname, "../../../prisma/migrations", rel));
```

Bu bloğun **hemen altındaki** `const BUNDLE_UP = FOLLOW_UP_SQL.find((f) => f.includes("delivery_platforms_bundle"))!` ve `const BUNDLE_DOWN = BUNDLE_UP.replace("migration.sql", "down.sql")` satırları **Change 1'e aittir ve olduğu gibi bırakılır** — bu PR onları ne siler, ne yeniden yazar, ne de indeksli bir erişimle değiştirir.

**Doğrulama (bu alt adımın çıkış koşulu):**

```bash
cd /home/tarik/Projects/kds/backend && npx jest src/modules/marketplace/alacarte-catalog-migration.spec.ts
```
Beklenen: **20 test** (9 taban + 8 teslimat + 3 yeni). Sayı **12** çıkıyorsa teslimat satırı ve sabitleri silinmiştir — diziyi yukarıdaki üç girdili hâline geri al.

**(b)** `effective`'i INSERT'leri de kapsayacak hâle getir — **tek ekleme, iki satır**. Bu blok teslimat spec'inin §7 T2/2'sindeki blokla **birebir aynı baytlardır**; sahibi teslimat PR'ıdır, ikinci merge olan taraf onu **yeniden yazmaz**:

```ts
  const insertedLater = followUps.flatMap(parseUpserts);
  const effective = [...parsed, ...insertedLater]
    .filter((r) => !archivedLater.has(r.code))
    .map((r) => ({ ...r, priceCents: reprices.get(r.code) ?? r.priceCents }));
```

**(c)** Dosya başındaki `FOLLOW_UP_SQL` yorumuna **follow-up sözleşmesini** yaz (yasak listesi değil, *tanınan biçimler* listesi):

```ts
/**
 * Follow-up migrations that change what the base catalog migration wrote.
 *
 * The tripwire compares the constant against the COMPOSED state — base
 * migration plus every follow-up listed here — rather than against the base
 * alone. Comparing against the base alone would make any legitimate reprice
 * impossible without rewriting an already-applied migration, which is the one
 * thing a migration may never do. Add a file here whenever a new migration
 * changes a catalog price, retires a product, or introduces one.
 *
 * RECOGNISED SHAPES (this is not a ban list — extend the folder, never lower
 * the expectation):
 *   - a partial `UPDATE … SET "priceCents" = …` reprices        → parseRepricing
 *   - `UPDATE … SET "status" = 'archived'` retires              → parseArchived
 *   - a FULL-row `INSERT … ON CONFLICT ("code") DO UPDATE` in the P1
 *     generator's exact line shape introduces a product          → parseUpserts
 *
 * A rule saying "only full-row upserts are allowed" must NOT be written, and
 * neither must a test enforcing it: the one applied follow-up
 * (20260820120000_reprice_licence_and_stock) violates exactly that ban at :38
 * and :47, is checksummed by `prisma migrate deploy`, and therefore cannot be
 * edited. Such a test would be born red.
 */
```

- [ ] **Adım 4: Yeni iddiaları yaz**

Aynı dosyada, `it("uses the snake_case mapped table name everywhere", …)`'in ardına:

```ts
  it("keeps a paid row alive in the new product's down", () => {
    // A follow-up is found BY NAME, never by index: a file that lands between
    // them later (the delivery bundle, or any future catalog migration) would
    // silently point an indexed assertion at a different file and the test
    // would start lying.
    const upPath = FOLLOW_UP_SQL.find((p) => p.includes("card_shift_catalog"))!;
    expect(upPath).toBeDefined();
    const cardDown = executableSql(
      readFileSync(upPath.replace("migration.sql", "down.sql"), "utf8"),
    );
    expect(cardDown).toMatch(
      /DELETE FROM "marketplace_addons"[\s\S]*NOT EXISTS[\s\S]*"tenant_addons"/,
    );
    // The hardware half has the same duty towards a placed order.
    expect(cardDown).toMatch(
      /DELETE FROM "hardware_products"[\s\S]*NOT EXISTS[\s\S]*"hardware_order_items"/,
    );
  });

  it("uses snake_case mapped table names in both card-shift migrations", () => {
    // A hand-written migration that says "MarketplaceAddOn" takes 42P01 in
    // production and passes every test that runs against a db-push database.
    const dirs = [
      "20260820150000_card_shift_schema",
      "20260820160000_card_shift_catalog",
    ];
    for (const dir of dirs) {
      for (const file of ["migration.sql", "down.sql"]) {
        const body = executableSql(
          readFileSync(
            join(__dirname, "../../../prisma/migrations", dir, file),
            "utf8",
          ),
        );
        expect(body).not.toMatch(
          /"MarketplaceAddOn"|"TenantAddOn"|"Tenant"|"User"|"Attendance"|"HardwareProduct"|"HardwareInventory"/,
        );
      }
    }
  });

  it("declares @doctor:idempotent on both new migration ups", () => {
    for (const dir of [
      "20260820150000_card_shift_schema",
      "20260820160000_card_shift_catalog",
    ]) {
      const head = readFileSync(
        join(__dirname, "../../../prisma/migrations", dir, "migration.sql"),
        "utf8",
      ).split("\n")[0];
      expect(head).toMatch(/^-- @doctor:idempotent verified=/);
    }
  });
```

- [ ] **Adım 5: `introduced` hesabının taban dosyaya sabitlendiğini DOĞRULA (yazma — kontrol et)**

`it("deletes in the down exactly the codes the up introduced", …)` içindeki `introduced` hesabı, merge sonrası şu biçimde olmalıdır (biçimin sahibi teslimat PR'ıdır, §7 T2/3 — bu PR onu **yazmaz, doğrular**):

```ts
    // Taban migration'ın GERÇEKTEN yarattığı kodlar. Katalog sabitinden
    // türetmek yanlış: sonraki her migration'ın eklediği kod da listeye
    // girer ve P1'in down'ında aranır.
    const introduced = parsed
      .map((r) => r.code)
      .filter((c) => !preExisting.has(c))
      .sort();
```

Ağaçta hâlâ `ALACARTE_CATALOG.map((p) => p.code)` biçiminde ise (Change 1 henüz merge olmamışsa) **bu PR onu yukarıdaki hâle getirir** — aksi hâlde `module_personnel_card_shift` P1'in down'ında aranır ve test kızarır.

- [ ] **Adım 6: Drift süitini çalıştır ve yeşile döndüğünü gör**

Çalıştır: `cd /home/tarik/Projects/kds/backend && npx jest src/modules/marketplace/alacarte-catalog-migration.spec.ts`
Beklenen: **PASS — 20 test (9 taban + 8 teslimat + 3 yeni)**; Görev 9/Adım 5'te kızaran `upserts exactly the products in the catalog constant` dahil hepsi yeşil. Sayı 20'nin altındaysa Adım 3(a)'da Change 1'in `FOLLOW_UP_SQL` satırı ya da `BUNDLE_UP`/`BUNDLE_DOWN` sabitleri düşürülmüştür.

- [ ] **Adım 7: Katalog çiftinin round-trip'ini kanıtla**

```bash
docker run -d --rm --name kds-cardshift-migtest -e POSTGRES_PASSWORD=migtest -p 5455:5432 postgres:16
until docker exec kds-cardshift-migtest pg_isready -U postgres; do :; done
cd /home/tarik/Projects/kds/backend
export DATABASE_URL="postgresql://postgres:migtest@localhost:5455/postgres?schema=public"
p() { psql -v ON_ERROR_STOP=1 "$DATABASE_URL" "$@"; }
M=prisma/migrations/20260820160000_card_shift_catalog

npx prisma migrate deploy
p -c "select code,kind,billing,\"priceCents\",status,\"sortOrder\" from marketplace_addons where code='module_personnel_card_shift'"
p -c "select sku,category,\"priceCents\",\"saleMode\" from hardware_products where sku='card-reader-rfid-usb-hid'"

p -f $M/down.sql
p -f $M/down.sql            # idempotent: no-op, hata YOK
p -c "select count(*) from marketplace_addons where code='module_personnel_card_shift'"   # 0
p -c "select count(*) from hardware_products where sku='card-reader-rfid-usb-hid'"        # 0

p -f $M/migration.sql
p -f $M/migration.sql       # idempotent: no-op, hata YOK
p -c "select count(*) from marketplace_addons where code='module_personnel_card_shift'"   # 1
p -c "select count(*) from hardware_products where sku='card-reader-rfid-usb-hid'"        # 1
p -c "select available from hardware_inventory hi join hardware_products hp on hp.id=hi.\"productId\" where hp.sku='card-reader-rfid-usb-hid'"  # 25
```
Beklenen: ilk `select` `module | oneTime | 400000 | published | 18` verir; ikinci `card_reader | 129000 | DIRECT_SALE`; sayaçlar yorumdaki değerleri.

- [ ] **Adım 8: Para güvenliği kanıtını koştur (down ödenmiş satırı KORUMALI)**

```bash
cd /home/tarik/Projects/kds/backend
export DATABASE_URL="postgresql://postgres:migtest@localhost:5455/postgres?schema=public"
p() { psql -v ON_ERROR_STOP=1 "$DATABASE_URL" "$@"; }

# Bir tenant bu ürünü satın almış gibi davran.
p -c "insert into tenants (id,name,subdomain,status,\"createdAt\",\"updatedAt\") values ('tt-money','Money Test','money-test','ACTIVE',now(),now()) on conflict (id) do nothing"
p -c "insert into tenant_addons (id,\"tenantId\",\"addOnId\",quantity,status,\"currentPeriodStart\",\"currentPeriodEnd\",\"createdAt\",\"updatedAt\") select 'ta-money','tt-money',m.id,1,'active',now(),NULL,now(),now() from marketplace_addons m where m.code='module_personnel_card_shift'"

p -f prisma/migrations/20260820160000_card_shift_catalog/down.sql
p -c "select count(*) from marketplace_addons where code='module_personnel_card_shift'"   # 1 — SİLİNMEDİ
p -c "select count(*) from tenant_addons where id='ta-money'"                             # 1 — SAHİPLİK DURUYOR

# Temizle ve ürünü geri kur.
p -c "delete from tenant_addons where id='ta-money'"
p -c "delete from tenants where id='tt-money'"
p -f prisma/migrations/20260820160000_card_shift_catalog/migration.sql
docker stop kds-cardshift-migtest
```
Beklenen: down'dan sonra katalog satırı **duruyor** (sayaç `1`) ve sahiplik satırı **silinmemiş**. Bu iki çıktı PR açıklamasına yapıştırılır.

- [ ] **Adım 9: Commit'le**

```bash
cd /home/tarik/Projects/kds
git add backend/prisma/migrations/20260820160000_card_shift_catalog backend/src/modules/marketplace/alacarte-catalog-migration.spec.ts
git commit -m "feat(card-shift): katalog ve donanım satırlarının tersine çevrilebilir migration'ı"
```

---

## Görev 11: FE — `personnelApi` kart hook'ları + `CardShiftTab` + `TeamPage` üçüncü sekme + personel i18n

**Files:**
- Modify: `frontend/src/types/index.ts` (`CardAssignment`, `CardTapResponse`)
- Modify: `frontend/src/features/personnel/personnelApi.ts`
- Create: `frontend/src/components/personnel/CardShiftTab.tsx`
- Create: `frontend/src/components/personnel/CardShiftTab.test.tsx`
- Modify: `frontend/src/pages/admin/TeamPage.tsx`
- Modify: `frontend/src/i18n/locales/{tr,en,ru,ar,uz}/personnel.json`
- Test: `frontend/src/components/personnel/CardShiftTab.test.tsx`

**Interfaces:**
- Consumes: HTTP uçları `GET /personnel/cards`, `POST /personnel/cards/:userId`, `DELETE /personnel/cards/:userId`, `POST /personnel/attendance/card-tap` ve gövde/yanıt şekilleri (Görev 7); `PlanFeatures.cardShift` (Görev 1)
- Produces:
  - `interface CardAssignment { userId: string; firstName: string; lastName: string; role: string; last4: string | null; assignedAt: string | null; assignedById: string | null }`
  - `interface CardTapResponse { action: 'clockIn' | 'clockOut' | 'breakEnd' | 'ignored'; user: { id: string; firstName: string; lastName: string; role: string }; attendance: Attendance | null }`
  - `useCardAssignments(): UseQueryResult<CardAssignment[]>`
  - `useAssignCard(): UseMutationResult<CardAssignment, unknown, { userId: string; cardUid: string }>`
  - `useRevokeCard(): UseMutationResult<{ userId: string; revoked: true }, unknown, string>`
  - `useCardTap(): UseMutationResult<CardTapResponse, unknown, { cardUid: string }>`
  - `CardShiftTab` bileşeni (default export)
  - i18n `personnel:cardShift.*` (24 anahtar)

- [ ] **Adım 1: Tipleri ekle**

`frontend/src/types/index.ts`, `AttendanceSummary` arayüzünün ardına:

```ts
/** One staff member's card enrolment. The API returns the last 4 digits and
 *  nothing else — never the hash, never the ciphertext, never the raw UID. */
export interface CardAssignment {
  userId: string;
  firstName: string;
  lastName: string;
  role: string;
  last4: string | null;
  assignedAt: string | null;
  assignedById: string | null;
}

/** What POST /personnel/attendance/card-tap answers. `ignored` is the 10s
 *  debounce swallowing a reader's duplicate write, not an error. */
export interface CardTapResponse {
  action: 'clockIn' | 'clockOut' | 'breakEnd' | 'ignored';
  user: { id: string; firstName: string; lastName: string; role: string };
  attendance: Attendance | null;
}
```

- [ ] **Adım 2: Hook'ları ekle**

`frontend/src/features/personnel/personnelApi.ts`, ATTENDANCE bölümünün sonuna (`useClockOut`'un ardına):

```ts
// ========================================
// CARD SHIFT
// ========================================

export const useCardAssignments = () => {
  return useQuery<CardAssignment[]>({
    // Enrolment is tenant-wide (a card follows the person, not the branch), so
    // the key carries no branchId.
    queryKey: ['personnel', 'cards'],
    queryFn: async () => {
      const response = await api.get<CardAssignment[]>('/personnel/cards');
      return response.data;
    },
  });
};

export const useAssignCard = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId, cardUid }: { userId: string; cardUid: string }) => {
      const response = await api.post<CardAssignment>(`/personnel/cards/${userId}`, {
        cardUid,
      });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['personnel', 'cards'] });
      toast.success(i18n.t('personnel:cardShift.assigned'));
    },
    onError: (error: any) => {
      toast.error(getApiErrorMessage(error, i18n.t('common:notifications.operationFailed')));
    },
  });
};

export const useRevokeCard = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (userId: string) => {
      const response = await api.delete<{ userId: string; revoked: true }>(
        `/personnel/cards/${userId}`,
      );
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['personnel', 'cards'] });
      toast.success(i18n.t('personnel:cardShift.revoked'));
    },
    onError: (error: any) => {
      toast.error(getApiErrorMessage(error, i18n.t('common:notifications.operationFailed')));
    },
  });
};

export const useCardTap = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ cardUid }: { cardUid: string }) => {
      const response = await api.post<CardTapResponse>(
        '/personnel/attendance/card-tap',
        { cardUid },
      );
      return response.data;
    },
    onSuccess: () => {
      // A tap writes an attendance row; every attendance view must re-read.
      // No toast: the station screen renders the outcome itself, in large type.
      queryClient.invalidateQueries({ queryKey: ['personnel', 'attendance'] });
    },
    // Deliberately no onError toast either — the station shows the error on
    // the card, where the person tapping is actually looking.
  });
};
```

`import type { … }` bloğuna `CardAssignment,` ve `CardTapResponse,` ekle.

- [ ] **Adım 3: `personnel.json`'a `cardShift` bloğunu ekle — tr**

`frontend/src/i18n/locales/tr/personnel.json`, kök nesneye:

```json
  "cardShift": {
    "title": "Kartlı Vardiya",
    "tapPrompt": "Kartınızı okutun",
    "assign": "Kart ata",
    "assigned": "Kart atandı",
    "revoke": "Kartı iptal et",
    "revoked": "Kart iptal edildi",
    "revokeConfirm": "{{name}} adlı personelin kartı iptal edilsin mi? Geçmiş puantaj kayıtları silinmez.",
    "noCard": "Kart yok",
    "cardLast4": "Kart (son 4)",
    "assignedAt": "Atama tarihi",
    "assignedBy": "Atayan",
    "sourceCard": "Kart",
    "sourceManual": "Uygulama",
    "cardClockIns": "Kartla giriş",
    "openStation": "İstasyon ekranını aç",
    "errors": {
      "notRecognised": "Kart tanınmadı — yöneticinize başvurun",
      "invalidUid": "Kart numarası geçersiz",
      "alreadyClockedOut": "Bugün çıkış yapılmış"
    },
    "station": {
      "title": "Kartlı Vardiya İstasyonu",
      "welcome": "Hoş geldin, {{name}} — giriş {{time}}",
      "goodbye": "İyi çalışmalar, {{name}} — çıkış {{time}}",
      "breakEnded": "Mola bitti, {{name}} — {{time}}",
      "ignored": "Kart az önce okutuldu",
      "lock": "Oturumu kilitle",
      "locked": "Ekran kilitli",
      "unlock": "Devam etmek için dokunun"
    }
  }
```

- [ ] **Adım 4: `personnel.json`'a `cardShift` bloğunu ekle — en**

```json
  "cardShift": {
    "title": "Card Shift",
    "tapPrompt": "Tap your card",
    "assign": "Assign card",
    "assigned": "Card assigned",
    "revoke": "Revoke card",
    "revoked": "Card revoked",
    "revokeConfirm": "Revoke the card assigned to {{name}}? Past attendance records are kept.",
    "noCard": "No card",
    "cardLast4": "Card (last 4)",
    "assignedAt": "Assigned at",
    "assignedBy": "Assigned by",
    "sourceCard": "Card",
    "sourceManual": "App",
    "cardClockIns": "Card clock-ins",
    "openStation": "Open the station screen",
    "errors": {
      "notRecognised": "Card not recognised — please contact your manager",
      "invalidUid": "Invalid card number",
      "alreadyClockedOut": "Already clocked out today"
    },
    "station": {
      "title": "Card Shift Station",
      "welcome": "Welcome, {{name}} — clocked in at {{time}}",
      "goodbye": "Goodbye, {{name}} — clocked out at {{time}}",
      "breakEnded": "Break ended, {{name}} — {{time}}",
      "ignored": "Card was just tapped",
      "lock": "Lock the session",
      "locked": "Screen locked",
      "unlock": "Touch to continue"
    }
  }
```

- [ ] **Adım 5: `personnel.json`'a `cardShift` bloğunu ekle — ru**

```json
  "cardShift": {
    "title": "Смена по карте",
    "tapPrompt": "Приложите карту",
    "assign": "Назначить карту",
    "assigned": "Карта назначена",
    "revoke": "Отозвать карту",
    "revoked": "Карта отозвана",
    "revokeConfirm": "Отозвать карту сотрудника {{name}}? Прошлые записи учёта времени сохранятся.",
    "noCard": "Нет карты",
    "cardLast4": "Карта (последние 4)",
    "assignedAt": "Дата назначения",
    "assignedBy": "Кем назначено",
    "sourceCard": "Карта",
    "sourceManual": "Приложение",
    "cardClockIns": "Входы по карте",
    "openStation": "Открыть экран станции",
    "errors": {
      "notRecognised": "Карта не распознана — обратитесь к руководителю",
      "invalidUid": "Неверный номер карты",
      "alreadyClockedOut": "Сегодня выход уже отмечен"
    },
    "station": {
      "title": "Станция смены по карте",
      "welcome": "Добро пожаловать, {{name}} — приход в {{time}}",
      "goodbye": "До свидания, {{name}} — уход в {{time}}",
      "breakEnded": "Перерыв окончен, {{name}} — {{time}}",
      "ignored": "Карта только что была приложена",
      "lock": "Заблокировать сеанс",
      "locked": "Экран заблокирован",
      "unlock": "Коснитесь, чтобы продолжить"
    }
  }
```

- [ ] **Adım 6: `personnel.json`'a `cardShift` bloğunu ekle — ar**

```json
  "cardShift": {
    "title": "الوردية بالبطاقة",
    "tapPrompt": "مرّر بطاقتك",
    "assign": "تعيين بطاقة",
    "assigned": "تم تعيين البطاقة",
    "revoke": "إلغاء البطاقة",
    "revoked": "تم إلغاء البطاقة",
    "revokeConfirm": "هل تريد إلغاء بطاقة {{name}}؟ تُحفظ سجلات الحضور السابقة.",
    "noCard": "لا توجد بطاقة",
    "cardLast4": "البطاقة (آخر 4)",
    "assignedAt": "تاريخ التعيين",
    "assignedBy": "عيّنها",
    "sourceCard": "بطاقة",
    "sourceManual": "التطبيق",
    "cardClockIns": "تسجيلات الدخول بالبطاقة",
    "openStation": "فتح شاشة المحطة",
    "errors": {
      "notRecognised": "لم يتم التعرف على البطاقة — يرجى مراجعة مديرك",
      "invalidUid": "رقم البطاقة غير صالح",
      "alreadyClockedOut": "تم تسجيل الخروج اليوم بالفعل"
    },
    "station": {
      "title": "محطة الوردية بالبطاقة",
      "welcome": "أهلًا {{name}} — تسجيل الدخول {{time}}",
      "goodbye": "إلى اللقاء {{name}} — تسجيل الخروج {{time}}",
      "breakEnded": "انتهت الاستراحة، {{name}} — {{time}}",
      "ignored": "تم تمرير البطاقة للتو",
      "lock": "قفل الجلسة",
      "locked": "الشاشة مقفلة",
      "unlock": "المس للمتابعة"
    }
  }
```

- [ ] **Adım 7: `personnel.json`'a `cardShift` bloğunu ekle — uz**

```json
  "cardShift": {
    "title": "Karta bilan smena",
    "tapPrompt": "Kartangizni o‘qiting",
    "assign": "Karta biriktirish",
    "assigned": "Karta biriktirildi",
    "revoke": "Kartani bekor qilish",
    "revoked": "Karta bekor qilindi",
    "revokeConfirm": "{{name}} kartasi bekor qilinsinmi? Oldingi davomat yozuvlari saqlanadi.",
    "noCard": "Karta yo‘q",
    "cardLast4": "Karta (oxirgi 4)",
    "assignedAt": "Biriktirilgan sana",
    "assignedBy": "Biriktirgan",
    "sourceCard": "Karta",
    "sourceManual": "Ilova",
    "cardClockIns": "Karta bilan kirishlar",
    "openStation": "Stansiya ekranini ochish",
    "errors": {
      "notRecognised": "Karta tanilmadi — rahbaringizga murojaat qiling",
      "invalidUid": "Karta raqami yaroqsiz",
      "alreadyClockedOut": "Bugun chiqish allaqachon qayd etilgan"
    },
    "station": {
      "title": "Karta bilan smena stansiyasi",
      "welcome": "Xush kelibsiz, {{name}} — kirish {{time}}",
      "goodbye": "Xayr, {{name}} — chiqish {{time}}",
      "breakEnded": "Tanaffus tugadi, {{name}} — {{time}}",
      "ignored": "Karta hozirgina o‘qitildi",
      "lock": "Seansni qulflash",
      "locked": "Ekran qulflangan",
      "unlock": "Davom etish uchun teging"
    }
  }
```

- [ ] **Adım 8: Başarısız `CardShiftTab` testini yaz**

`frontend/src/components/personnel/CardShiftTab.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CardShiftTab from './CardShiftTab';

/**
 * The enrolment table is the one screen that could leak a card UID. It must
 * show the last four digits and nothing else, and revoking has to be a
 * deliberate act: a revoked card locks a staff member out of the kiosk until
 * an admin re-enrols them.
 */
let assignments: any[];
const assignAsync = vi.fn();
const revokeAsync = vi.fn();

vi.mock('../../features/personnel/personnelApi', () => ({
  useCardAssignments: () => ({ data: assignments, isLoading: false }),
  useAssignCard: () => ({ mutateAsync: assignAsync, isPending: false }),
  useRevokeCard: () => ({ mutateAsync: revokeAsync, isPending: false }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, arg?: any) =>
      arg && typeof arg === 'object' && Object.keys(arg).length
        ? `${key}::${Object.values(arg).join(',')}`
        : key,
  }),
}));

vi.mock('react-router-dom', () => ({
  Link: ({ children, ...rest }: any) => <a {...rest}>{children}</a>,
}));

beforeEach(() => {
  assignAsync.mockReset().mockResolvedValue({});
  revokeAsync.mockReset().mockResolvedValue({});
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  assignments = [
    {
      userId: 'u-1',
      firstName: 'Ada',
      lastName: 'Lovelace',
      role: 'WAITER',
      last4: '2B9C',
      assignedAt: '2026-08-20T10:00:00.000Z',
      assignedById: 'u-admin',
    },
    {
      userId: 'u-2',
      firstName: 'Grace',
      lastName: 'Hopper',
      role: 'KITCHEN',
      last4: null,
      assignedAt: null,
      assignedById: null,
    },
  ];
});

describe('CardShiftTab', () => {
  it('lists only the last 4 digits, never a full UID', () => {
    render(<CardShiftTab />);
    expect(screen.getByText('•••• 2B9C')).toBeInTheDocument();
    expect(screen.getByText('personnel:cardShift.noCard')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('04A22B9C');
  });

  it('sends the typed UID on submit and clears the field', async () => {
    render(<CardShiftTab />);
    fireEvent.click(screen.getAllByText('personnel:cardShift.assign')[1]);
    const input = screen.getByLabelText('personnel:cardShift.tapPrompt') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '04:A2:2B:9C' } });
    fireEvent.submit(input.closest('form')!);

    expect(assignAsync).toHaveBeenCalledWith({
      userId: 'u-2',
      cardUid: '04:A2:2B:9C',
    });
    // The UID must not linger in the DOM after submit.
    expect(input.value).toBe('');
  });

  it('asks for confirmation before revoking', () => {
    render(<CardShiftTab />);
    fireEvent.click(screen.getByText('personnel:cardShift.revoke'));

    expect(window.confirm).toHaveBeenCalledWith(
      'personnel:cardShift.revokeConfirm::Ada Lovelace',
    );
    expect(revokeAsync).toHaveBeenCalledWith('u-1');
  });

  it('does not revoke when the confirmation is declined', () => {
    (window.confirm as any).mockReturnValue(false);
    render(<CardShiftTab />);
    fireEvent.click(screen.getByText('personnel:cardShift.revoke'));

    expect(revokeAsync).not.toHaveBeenCalled();
  });

  it('links to the station screen — the kiosk tablet is opened from here', () => {
    render(<CardShiftTab />);
    const link = screen.getByText('personnel:cardShift.openStation').closest('a')!;
    expect(link.getAttribute('href')).toBe('/card-shift');
  });
});
```

- [ ] **Adım 9: Çalıştır ve başarısız olduğunu gör**

Çalıştır: `cd /home/tarik/Projects/kds/frontend && npx vitest run src/components/personnel/CardShiftTab.test.tsx`
Beklenen: FAIL — `Failed to resolve import "./CardShiftTab"`.

- [ ] **Adım 10: `CardShiftTab.tsx`'i yaz**

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { CreditCard, ExternalLink } from 'lucide-react';
import {
  useAssignCard,
  useCardAssignments,
  useRevokeCard,
} from '../../features/personnel/personnelApi';

/**
 * Staff-card enrolment.
 *
 * The UID never round-trips: it is typed by the reader into a field that is
 * cleared on submit, sent once, and stored as a peppered HMAC. The table can
 * therefore only ever show the last four digits — enough to match a plastic
 * card to a person, useless for enrolling a clone.
 */
const CardShiftTab = () => {
  const { t } = useTranslation(['personnel', 'common']);
  const { data: assignments, isLoading } = useCardAssignments();
  const assign = useAssignCard();
  const revoke = useRevokeCard();
  const [enrolling, setEnrolling] = useState<string | null>(null);
  const [uid, setUid] = useState('');

  const submit = async (userId: string) => {
    if (!uid.trim()) return;
    const cardUid = uid;
    // Clear FIRST: an await that rejects must not leave the UID on screen.
    setUid('');
    setEnrolling(null);
    await assign.mutateAsync({ userId, cardUid });
  };

  const onRevoke = (row: { userId: string; firstName: string; lastName: string }) => {
    const name = `${row.firstName} ${row.lastName}`;
    if (!window.confirm(t('personnel:cardShift.revokeConfirm', { name }))) return;
    revoke.mutateAsync(row.userId);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <CreditCard className="h-4 w-4" />
          {t('personnel:cardShift.title')}
        </h2>
        {/* The kiosk tablet is opened from here in practice; the sidebar entry
            exists too, but an admin enrolling cards is already on this screen. */}
        <Link
          to="/card-shift"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-sm text-primary-600 hover:underline"
        >
          <ExternalLink className="h-4 w-4" />
          {t('personnel:cardShift.openStation')}
        </Link>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-slate-500">
                {t('personnel:attendance.staff')}
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-slate-500">
                {t('personnel:cardShift.cardLast4')}
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-slate-500">
                {t('personnel:cardShift.assignedAt')}
              </th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-slate-500">
                  {t('common:common.loading')}
                </td>
              </tr>
            ) : (
              (assignments ?? []).map((row) => (
                <tr key={row.userId}>
                  <td className="px-4 py-3 text-sm font-medium text-slate-900">
                    {row.firstName} {row.lastName}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-600">
                    {row.last4 ? (
                      <span className="font-mono">{`•••• ${row.last4}`}</span>
                    ) : (
                      <span className="text-slate-400">
                        {t('personnel:cardShift.noCard')}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-600">
                    {row.assignedAt
                      ? new Date(row.assignedAt).toLocaleDateString()
                      : '—'}
                  </td>
                  <td className="px-4 py-3 text-right text-sm">
                    {enrolling === row.userId ? (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          submit(row.userId);
                        }}
                      >
                        <input
                          autoFocus
                          aria-label={t('personnel:cardShift.tapPrompt')}
                          placeholder={t('personnel:cardShift.tapPrompt')}
                          value={uid}
                          onChange={(e) => setUid(e.target.value)}
                          className="rounded border border-slate-300 px-2 py-1 font-mono text-sm"
                        />
                      </form>
                    ) : (
                      <div className="flex justify-end gap-3">
                        <button
                          type="button"
                          className="text-primary-600 hover:underline"
                          onClick={() => {
                            setUid('');
                            setEnrolling(row.userId);
                          }}
                        >
                          {t('personnel:cardShift.assign')}
                        </button>
                        {row.last4 && (
                          <button
                            type="button"
                            className="text-red-600 hover:underline"
                            onClick={() => onRevoke(row)}
                          >
                            {t('personnel:cardShift.revoke')}
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default CardShiftTab;
```

- [ ] **Adım 11: Çalıştır ve geçtiğini gör**

Çalıştır: `cd /home/tarik/Projects/kds/frontend && npx vitest run src/components/personnel/CardShiftTab.test.tsx`
Beklenen: PASS — 5 test yeşil.

- [ ] **Adım 12: `TeamPage`'e üçüncü sekmeyi ekle**

`frontend/src/pages/admin/TeamPage.tsx`:

`type Tab = 'users' | 'attendance';` → `type Tab = 'users' | 'attendance' | 'cards';`

`const hasPersonnel = …` satırının ardına:

```tsx
  // Card Shift rides ON TOP of personnel: without the attendance module there
  // are no rows for a tap to write onto, so both flags gate the tab.
  const hasCardShift = hasPersonnel && hasFeature('cardShift');
```

`tabs` dizisinin sonuna:

```tsx
    ...(hasCardShift
      ? [
          {
            id: 'cards' as const,
            label: t('personnel:cardShift.title', 'Kartlı Vardiya'),
            icon: CreditCard,
          },
        ]
      : []),
```

İçerik seçicisini şununla değiştir:

```tsx
      {tab === 'users' && <UserManagementPage embedded />}
      {tab === 'attendance' && <AttendanceTab />}
      {tab === 'cards' && <CardShiftTab />}
```

ve importlara ekle:

```tsx
import { UsersRound, Clock, CreditCard } from 'lucide-react';
import CardShiftTab from '../../components/personnel/CardShiftTab';
```

- [ ] **Adım 13: Kapıları çalıştır ve commit'le**

```bash
cd /home/tarik/Projects/kds/frontend && npx vitest run src/components/personnel
cd /home/tarik/Projects/kds/frontend && npx tsc --noEmit -p tsconfig.json
node scripts/check-i18n-parity.mjs
cd /home/tarik/Projects/kds && node scripts/check-i18n-value-drift.mjs --gate-new scripts/i18n-value-drift-baseline.json
```
Beklenen: dördü de temiz.

```bash
cd /home/tarik/Projects/kds
git add frontend/src/types/index.ts frontend/src/features/personnel/personnelApi.ts frontend/src/components/personnel/CardShiftTab.tsx frontend/src/components/personnel/CardShiftTab.test.tsx frontend/src/pages/admin/TeamPage.tsx frontend/src/i18n/locales/tr/personnel.json frontend/src/i18n/locales/en/personnel.json frontend/src/i18n/locales/ru/personnel.json frontend/src/i18n/locales/ar/personnel.json frontend/src/i18n/locales/uz/personnel.json
git commit -m "feat(card-shift): kart atama sekmesi, API hook'ları ve beş dilli metinler"
```

---

## Görev 12: FE — `CardShiftStationPage` + `/card-shift` rotası + Sidebar girdisi

İstasyon ekranı ADMIN/MANAGER oturumu üzerinde çalışır (cihaz-token rayı §9/1'de sonraki adım). Bu, ekranı bırakan personelin `/admin` yüzeyine gidebilmesi demektir; karşı önlem sayfanın kendi üstündeki "Oturumu kilitle" butonu ve 60 sn hareketsizlikte tam ekran overlay'dir.

Kenar çubuğu uygulamanın **tek** gezinme kaydıdır — yazılmazsa kiosk'a yalnız URL yazarak erişilir.

**Files:**
- Create: `frontend/src/pages/personnel/CardShiftStationPage.tsx`
- Create: `frontend/src/pages/personnel/CardShiftStationPage.test.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/components/layout/Sidebar.tsx`
- Modify: `frontend/src/i18n/locales/{tr,en,ru,ar,uz}/common.json`
- Test: `frontend/src/pages/personnel/CardShiftStationPage.test.tsx`

**Interfaces:**
- Consumes: `useCardTap()` ve `CardTapResponse` (Görev 11), `personnel:cardShift.station.*` (Görev 11), `PlanFeatures.cardShift` (Görev 1)
- Produces: `CardShiftStationPage` (default export), rota `/card-shift`, i18n `common:navigation.cardShift`

- [ ] **Adım 1: `navigation.cardShift`'i beş dile ekle**

`frontend/src/i18n/locales/{tr,en,ru,ar,uz}/common.json`, `navigation` bloğuna `team`'in ardına:

| Dosya | Değer |
|---|---|
| `tr/common.json` | `"cardShift": "Kartlı Vardiya"` |
| `en/common.json` | `"cardShift": "Card Shift"` |
| `ru/common.json` | `"cardShift": "Смена по карте"` |
| `ar/common.json` | `"cardShift": "الوردية بالبطاقة"` |
| `uz/common.json` | `"cardShift": "Karta bilan smena"` |

- [ ] **Adım 2: Başarısız istasyon testini yaz**

`frontend/src/pages/personnel/CardShiftStationPage.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import CardShiftStationPage from './CardShiftStationPage';

/**
 * The kiosk. Nobody is logged in as themselves here — a staff member walks up,
 * taps, and reads one line of large type. Three things therefore matter:
 * the hidden input must ALWAYS have focus (a reader types into whatever has
 * focus; a blurred field sends the UID into the void), the field must be
 * cleared after every tap, and a rejected card must never echo its number back
 * onto a screen standing in a corridor.
 */
const tapAsync = vi.fn();

vi.mock('../../features/personnel/personnelApi', () => ({
  useCardTap: () => ({ mutateAsync: tapAsync, isPending: false }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, arg?: any) =>
      arg && typeof arg === 'object' && Object.keys(arg).length
        ? `${key}::${Object.values(arg).join(',')}`
        : key,
  }),
}));

const hiddenInput = () =>
  screen.getByLabelText('personnel:cardShift.tapPrompt') as HTMLInputElement;

const type = (value: string) => {
  const input = hiddenInput();
  fireEvent.change(input, { target: { value } });
  fireEvent.keyDown(input, { key: 'Enter' });
  return input;
};

beforeEach(() => {
  tapAsync.mockReset().mockResolvedValue({
    action: 'clockIn',
    user: { id: 'u-1', firstName: 'Ada', lastName: 'Lovelace', role: 'WAITER' },
    attendance: { id: 'a-1', clockIn: '2026-08-20T09:03:00.000Z' },
  });
});

afterEach(() => vi.useRealTimers());

describe('CardShiftStationPage', () => {
  it('posts the typed UID on Enter and clears the input', async () => {
    render(<CardShiftStationPage />);
    const input = type('04:A2:2B:9C');

    expect(tapAsync).toHaveBeenCalledWith({ cardUid: '04:A2:2B:9C' });
    await act(async () => undefined);
    expect(input.value).toBe('');
  });

  it('shows the staff name and action on success', async () => {
    render(<CardShiftStationPage />);
    type('04A22B9C');
    await act(async () => undefined);

    expect(
      screen.getByText(/personnel:cardShift\.station\.welcome::Ada Lovelace/),
    ).toBeInTheDocument();
  });

  it('shows an unrecognised-card message without echoing the UID', async () => {
    tapAsync.mockRejectedValue({
      response: { status: 404, data: { code: 'CARD_NOT_RECOGNISED' } },
    });
    render(<CardShiftStationPage />);
    type('04A22B9C');
    await act(async () => undefined);

    expect(
      screen.getByText('personnel:cardShift.errors.notRecognised'),
    ).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('04A22B9C');
  });

  it('maps a 409 to the already-clocked-out message', async () => {
    tapAsync.mockRejectedValue({
      response: { status: 409, data: { code: 'ALREADY_CLOCKED_OUT_TODAY' } },
    });
    render(<CardShiftStationPage />);
    type('04A22B9C');
    await act(async () => undefined);

    expect(
      screen.getByText('personnel:cardShift.errors.alreadyClockedOut'),
    ).toBeInTheDocument();
  });

  it('reports an ignored tap as a notice, not as a punch', async () => {
    tapAsync.mockResolvedValue({
      action: 'ignored',
      user: { id: 'u-1', firstName: 'Ada', lastName: 'Lovelace', role: 'WAITER' },
      attendance: null,
    });
    render(<CardShiftStationPage />);
    type('04A22B9C');
    await act(async () => undefined);

    expect(
      screen.getByText('personnel:cardShift.station.ignored'),
    ).toBeInTheDocument();
  });

  it('refocuses the hidden input after a blur', () => {
    render(<CardShiftStationPage />);
    const input = hiddenInput();
    input.blur();
    fireEvent.blur(input);
    expect(document.activeElement).toBe(input);
  });

  it('locks the screen after 60s of inactivity', () => {
    vi.useFakeTimers();
    render(<CardShiftStationPage />);
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByText('personnel:cardShift.station.locked')).toBeInTheDocument();
  });
});
```

- [ ] **Adım 3: Çalıştır ve başarısız olduğunu gör**

Çalıştır: `cd /home/tarik/Projects/kds/frontend && npx vitest run src/pages/personnel/CardShiftStationPage.test.tsx`
Beklenen: FAIL — `Failed to resolve import "./CardShiftStationPage"`.

- [ ] **Adım 4: `CardShiftStationPage.tsx`'i yaz**

```tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CreditCard, Lock } from 'lucide-react';
import { useCardTap } from '../../features/personnel/personnelApi';
import type { CardTapResponse } from '../../types';

type Outcome =
  | { tone: 'ok' | 'amber'; text: string }
  | { tone: 'error'; text: string }
  | null;

/** How long a result stays on screen before the prompt returns. */
const RESULT_MS = 8_000;
/** Idle window before the session-lock overlay drops (§8 Risk 5). */
const IDLE_MS = 60_000;

/**
 * The Card Shift station.
 *
 * It runs on an ADMIN/MANAGER session because there is no device-token rail
 * yet, which is exactly why it locks itself: a tablet left on a counter is an
 * admin session left on a counter. The real fix is a paired device token
 * (§9/1); this is the mitigation that ships with the product.
 */
const CardShiftStationPage = () => {
  const { t } = useTranslation(['personnel', 'common']);
  const tap = useCardTap();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uid, setUid] = useState('');
  const [outcome, setOutcome] = useState<Outcome>(null);
  const [locked, setLocked] = useState(false);
  const idleRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const focus = useCallback(() => inputRef.current?.focus(), []);

  const resetIdle = useCallback(() => {
    if (idleRef.current) clearTimeout(idleRef.current);
    idleRef.current = setTimeout(() => setLocked(true), IDLE_MS);
  }, []);

  useEffect(() => {
    focus();
    resetIdle();
    return () => {
      if (idleRef.current) clearTimeout(idleRef.current);
    };
  }, [focus, resetIdle]);

  const timeOf = (iso?: string | null) =>
    iso
      ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : '';

  const describe = (res: CardTapResponse): Outcome => {
    const name = `${res.user.firstName} ${res.user.lastName}`;
    const time = timeOf(
      res.action === 'clockOut'
        ? (res.attendance?.clockOut ?? null)
        : (res.attendance?.clockIn ?? null),
    );
    if (res.action === 'clockIn')
      return { tone: 'ok', text: t('personnel:cardShift.station.welcome', { name, time }) };
    if (res.action === 'clockOut')
      return { tone: 'ok', text: t('personnel:cardShift.station.goodbye', { name, time }) };
    if (res.action === 'breakEnd')
      return { tone: 'ok', text: t('personnel:cardShift.station.breakEnded', { name, time }) };
    // 'ignored' — the 10s debounce swallowed a reader's duplicate write.
    return { tone: 'amber', text: t('personnel:cardShift.station.ignored') };
  };

  const errorText = (err: any): string => {
    const code = err?.response?.data?.code;
    if (code === 'CARD_NOT_RECOGNISED')
      return t('personnel:cardShift.errors.notRecognised');
    if (code === 'ALREADY_CLOCKED_OUT_TODAY')
      return t('personnel:cardShift.errors.alreadyClockedOut');
    if (code === 'CARD_UID_INVALID')
      return t('personnel:cardShift.errors.invalidUid');
    return t('common:notifications.operationFailed');
  };

  const submit = async () => {
    const cardUid = uid.trim();
    // Clear BEFORE the await: the UID must not sit on a screen in a corridor
    // while the request is in flight.
    setUid('');
    if (!cardUid) return;
    resetIdle();
    try {
      const res = await tap.mutateAsync({ cardUid });
      setOutcome(describe(res));
    } catch (err) {
      setOutcome({ tone: 'error', text: errorText(err) });
    } finally {
      focus();
      setTimeout(() => setOutcome(null), RESULT_MS);
    }
  };

  const tone =
    outcome?.tone === 'ok'
      ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
      : outcome?.tone === 'amber'
        ? 'bg-amber-50 text-amber-800 border-amber-200'
        : 'bg-red-50 text-red-800 border-red-200';

  return (
    <div
      className="relative flex min-h-[70vh] flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white p-8"
      onMouseMove={resetIdle}
      onKeyDown={resetIdle}
    >
      <button
        type="button"
        onClick={() => setLocked(true)}
        className="absolute right-4 top-4 inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1 text-sm text-slate-600"
      >
        <Lock className="h-4 w-4" />
        {t('personnel:cardShift.station.lock')}
      </button>

      <CreditCard className="h-16 w-16 text-primary-500" />
      <h1 className="mt-6 text-3xl font-bold text-slate-900">
        {t('personnel:cardShift.station.title')}
      </h1>
      <p className="mt-2 text-xl text-slate-500">
        {t('personnel:cardShift.tapPrompt')}
      </p>

      {/* Visually hidden, never unmounted, always refocused: the reader types
          into whatever has focus, so a blurred field silently drops the tap.
          Not type="password" — a masked field confuses the operator debugging a
          reader — but it is cleared on submit and never rendered anywhere. */}
      <input
        ref={inputRef}
        aria-label={t('personnel:cardShift.tapPrompt')}
        value={uid}
        autoComplete="off"
        className="absolute h-px w-px opacity-0"
        onChange={(e) => setUid(e.target.value)}
        onBlur={() => focus()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            submit();
          }
        }}
      />

      {outcome && (
        <div className={`mt-10 w-full max-w-2xl rounded-2xl border p-8 text-center text-2xl font-semibold ${tone}`}>
          {outcome.text}
        </div>
      )}

      {locked && (
        <div
          role="button"
          tabIndex={0}
          onClick={() => {
            setLocked(false);
            resetIdle();
            focus();
          }}
          onKeyDown={() => {
            setLocked(false);
            resetIdle();
            focus();
          }}
          className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 rounded-2xl bg-slate-900/95 text-white"
        >
          <Lock className="h-12 w-12" />
          <p className="text-2xl font-semibold">
            {t('personnel:cardShift.station.locked')}
          </p>
          <p className="text-slate-300">
            {t('personnel:cardShift.station.unlock')}
          </p>
        </div>
      )}
    </div>
  );
};

export default CardShiftStationPage;
```

- [ ] **Adım 5: Çalıştır ve geçtiğini gör**

Çalıştır: `cd /home/tarik/Projects/kds/frontend && npx vitest run src/pages/personnel/CardShiftStationPage.test.tsx`
Beklenen: PASS — 7 test yeşil.

- [ ] **Adım 6: Rotayı ekle**

`frontend/src/App.tsx`, lazy import bloğuna (`StockPage`'in yanına):

```ts
const CardShiftStationPage = lazyWithReload(
  () => import("./pages/personnel/CardShiftStationPage"),
);
```

ve `/admin/team` yönlendirmesinin yakınına, ADMIN+MANAGER `Layout` bloğunun içine:

```tsx
            <Route
              path="/card-shift"
              element={
                <FeatureGate
                  feature="cardShift"
                  fallback={
                    <UpsellCard
                      addOnCode="module_personnel_card_shift"
                      featureKey="cardShift"
                    />
                  }
                >
                  <CardShiftStationPage />
                </FeatureGate>
              }
            />
```

`lazyWithReload` konvansiyonu zorunludur: yeni lazy rota `React.lazy` ile eklenirse açık bir sekme, deploy sonrası eskimiş chunk yüzünden beyaz ekrana düşer.

- [ ] **Adım 7: Sidebar girdisini ekle**

`frontend/src/components/layout/Sidebar.tsx`, `operation` bölümünde `/admin/team` girdisinin hemen ardına. **`NavItem` tipinde `label` alanı YOKTUR** — `labelKey` + `labelFallback` vardır:

```ts
      {
        // The station tablet's ONLY navigation entry. The sidebar is the app's
        // single navigation record; without this line the kiosk is reachable
        // only by typing the URL.
        to: '/card-shift',
        icon: CreditCard,
        labelKey: 'navigation.cardShift',
        labelFallback: 'Kartlı Vardiya',
        roles: [UserRole.ADMIN, UserRole.MANAGER],
        gate: { feature: 'cardShift' },
      },
```

`lucide-react` importuna `CreditCard` ekle. Kapı `itemVisible` içinde değerlendirilir (`:321`), yani ürün alınmadan girdi görünmez.

- [ ] **Adım 8: Kapıları çalıştır ve commit'le**

```bash
cd /home/tarik/Projects/kds/frontend && npx vitest run src/pages/personnel
cd /home/tarik/Projects/kds/frontend && npx tsc --noEmit -p tsconfig.json
node scripts/check-i18n-parity.mjs
cd /home/tarik/Projects/kds && node scripts/check-i18n-value-drift.mjs --gate-new scripts/i18n-value-drift-baseline.json
```
Beklenen: dördü de temiz.

```bash
cd /home/tarik/Projects/kds
git add frontend/src/pages/personnel/CardShiftStationPage.tsx frontend/src/pages/personnel/CardShiftStationPage.test.tsx frontend/src/App.tsx frontend/src/components/layout/Sidebar.tsx frontend/src/i18n/locales/tr/common.json frontend/src/i18n/locales/en/common.json frontend/src/i18n/locales/ru/common.json frontend/src/i18n/locales/ar/common.json frontend/src/i18n/locales/uz/common.json
git commit -m "feat(card-shift): kiosk istasyon ekranı, /card-shift rotası ve gezinme girdisi"
```

---

## Görev 13: FE — `AttendanceTab` kaynak rozeti + özet sütunu + puantaj tipleri

**Files:**
- Modify: `frontend/src/types/index.ts` (`Attendance`, `AttendanceSummary`)
- Modify: `frontend/src/components/personnel/AttendanceTab.tsx`
- Test: `frontend/src/components/personnel` (mevcut süit + tsc)

**Interfaces:**
- Consumes: `Attendance.clockInSource` / `clockOutSource` ve `AttendanceSummary.cardClockIns`'in backend'de üretilmesi (Görev 6); `personnel:cardShift.sourceCard` / `sourceManual` / `cardClockIns` (Görev 11)
- Produces: `Attendance.clockInSource: string`, `Attendance.clockOutSource?: string`, `AttendanceSummary.cardClockIns: number`

- [ ] **Adım 1: Tipleri genişlet**

`frontend/src/types/index.ts`, `Attendance` içinde `notes?: string;` satırının ardına:

```ts
  /** manual | card — mirrored by hand from the backend AttendanceSource enum.
   *  Deliberately a plain string, not a union: check-contract-drift.mjs does
   *  not cover this enum, so an unknown value must degrade to the "App" badge
   *  rather than break a type. */
  clockInSource: string;
  clockOutSource?: string;
```

`AttendanceSummary` içinde `totalLateMinutes: number;` satırının ardına:

```ts
  /** How many of totalDays were clocked in with a card. */
  cardClockIns: number;
```

- [ ] **Adım 2: Geçmiş tablosuna kaynak rozetini ekle**

`frontend/src/components/personnel/AttendanceTab.tsx`, geçmiş tablosunun `<thead>` satırında `attendance.late` başlığının ardına:

```tsx
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('cardShift.sourceCard')}</th>
```

ve gövde satırında `late` hücresinin ardına:

```tsx
                          <td className="px-4 py-3 text-sm">
                            {/* Unknown values fall through to "App": the enum is
                                not covered by the contract-drift script, so a
                                future value must not blank the column. */}
                            {a.clockInSource === 'card' ? (
                              <span className="rounded bg-primary-50 px-2 py-0.5 text-xs font-medium text-primary-700">
                                {t('cardShift.sourceCard')}
                              </span>
                            ) : (
                              <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                                {t('cardShift.sourceManual')}
                              </span>
                            )}
                          </td>
```

Aynı tablodaki iki `colSpan={7}` değerini **`colSpan={8}`** yap (yükleniyor ve boş-durum satırları) — aksi hâlde boş tablo bir sütun eksik hizalanır.

- [ ] **Adım 3: Özet tablosuna kart sütununu ekle**

Özet tablosunun `<thead>`'inde `attendance.lateDays` başlığının ardına:

```tsx
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('cardShift.cardClockIns')}</th>
```

ve gövde satırında `lateDays` hücresinin ardına:

```tsx
                          <td className="px-4 py-3 text-sm text-gray-600">{s.cardClockIns ?? 0}</td>
```

Aynı tablodaki iki `colSpan={5}` değerini **`colSpan={6}`** yap.

- [ ] **Adım 4: Doğrula ve commit'le**

```bash
cd /home/tarik/Projects/kds/frontend && npx tsc --noEmit -p tsconfig.json
cd /home/tarik/Projects/kds/frontend && npx vitest run src/components/personnel
```
Beklenen: tsc hatasız, mevcut personel bileşen testleri yeşil.

```bash
cd /home/tarik/Projects/kds
git add frontend/src/types/index.ts frontend/src/components/personnel/AttendanceTab.tsx
git commit -m "feat(card-shift): puantaj listesinde kaynak rozeti ve özet sütunu"
```

---

## Görev 14: e2e — `card-shift.e2e-spec.ts` (gerçek Postgres, gerçek guard zinciri)

K15 (iki bayrak) ve K6 (kalıcı kilit) birim testinde ifade edilemez: grant'in katalog satırı → sahiplik satırı → projektör → `feature_entitlements` → `EntitlementGuard` → HTTP durumu yolunu kat etmesi gerekir. Her halka daha önce sessizce kırıldığı için bu süit gerçek veritabanında koşar.

**Files:**
- Create: `backend/test/card-shift.e2e-spec.ts`
- Test: `cd /home/tarik/Projects/kds/backend && npx jest --config test/jest-e2e.json test/card-shift.e2e-spec.ts`

**Interfaces:**
- Consumes: `bootHttpApp`, `resetDb`, `seedLiveTenant`, `loginAs` (`test/helpers/e2e-db.ts`); `grantLicence`, `ownProduct`, `project`, `upsertProduct` (`test/helpers/e2e-entitlements.ts`); `TenantMarketplaceService.purchase`, `TenantAddOnSweeperService.runOnce`; `POST /api/personnel/attendance/card-tap` ve `POST /api/personnel/cards/:userId` (Görev 7); `users.staffCard*` kolonları (Görev 4)
- Produces: yok (yaprak süit)

- [ ] **Adım 1: Süiti yaz**

`backend/test/card-shift.e2e-spec.ts`:

```ts
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { PrismaService } from "../src/prisma/prisma.service";
import { bootHttpApp, resetDb, seedLiveTenant, loginAs } from "./helpers/e2e-db";
import {
  grantLicence,
  ownProduct,
  project,
  upsertProduct,
} from "./helpers/e2e-entitlements";
import { TenantMarketplaceService } from "../src/modules/marketplace/tenant-marketplace.service";
import { TenantAddOnSweeperService } from "../src/modules/marketplace/tenant-addon-sweeper.service";
import { cardUidHash, cardUidLast4, normalizeCardUid } from "../src/modules/personnel/card-uid";

/**
 * The card rail, end to end.
 *
 * Two properties are only expressible here. (1) The tap endpoint requires BOTH
 * personnelManagement and cardShift — a method-level @RequiresFeature OVERRIDES
 * the class-level one, so owning only the card product must NOT open it.
 * (2) A one-time purchase leaves currentPeriodEnd NULL, which makes the sweeper
 * skip the row forever and the projector write validUntil = null: the ₺4.000
 * lock is permanent, while a lapsed LICENCE still darkens it without deleting
 * anything.
 */
describe("Card shift (HTTP, real DB, real guards)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenant: Awaited<ReturnType<typeof seedLiveTenant>>;
  let token: string;

  const TAP = "/api/personnel/attendance/card-tap";
  const UID = "04:A2:2B:9C";

  beforeAll(async () => {
    ({ app, prisma } = await bootHttpApp());
    await resetDb(prisma);
    tenant = await seedLiveTenant(prisma);
    await project(app, tenant.tenantId);
    token = await loginAs(app, tenant.email, tenant.password);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await prisma.attendance.deleteMany({ where: { tenantId: tenant.tenantId } });
    await prisma.tenantAddOn.deleteMany({ where: { tenantId: tenant.tenantId } });
    await prisma.user.update({
      where: { id: tenant.userId },
      data: {
        staffCardUidHash: null,
        staffCardUidEnc: null,
        staffCardLast4: null,
        staffCardAssignedAt: null,
        staffCardAssignedById: null,
      },
    });
    await project(app, tenant.tenantId);
  });

  const personnelModule = () =>
    upsertProduct(prisma, {
      code: "module_personnel",
      name: "Personel Yönetimi",
      kind: "module",
      priceCents: 99_000,
      grants: { "feature.personnelManagement": true },
      requiresLicense: true,
    });

  const cardModule = () =>
    upsertProduct(prisma, {
      code: "module_personnel_card_shift",
      name: "Kartlı Vardiya",
      kind: "module",
      billing: "oneTime",
      priceCents: 400_000,
      grants: { "feature.cardShift": true },
      requiresLicense: true,
    });

  const tap = (cardUid: string) =>
    request(app.getHttpServer())
      .post(TAP)
      .set("Authorization", `Bearer ${token}`)
      .set("X-Branch-Id", tenant.branchId)
      .send({ cardUid });

  /** Enrol a card straight onto the row — the assignment endpoint is gated the
   *  same way as the tap, and this suite is about the tap. */
  async function enrol(uid = UID) {
    await prisma.user.update({
      where: { id: tenant.userId },
      data: {
        staffCardUidHash: cardUidHash(tenant.tenantId, uid),
        staffCardLast4: cardUidLast4(uid),
        staffCardAssignedAt: new Date(),
      },
    });
  }

  async function fullyEntitled() {
    const personnel = await personnelModule();
    const card = await cardModule();
    await grantLicence(prisma, tenant.tenantId);
    await ownProduct(prisma, tenant.tenantId, personnel.id);
    await ownProduct(prisma, tenant.tenantId, card.id, { periodEnd: undefined });
    await project(app, tenant.tenantId);
  }

  it("card-tap is 403 without the cardShift product, with an offer attached", async () => {
    const personnel = await personnelModule();
    await cardModule();
    await grantLicence(prisma, tenant.tenantId);
    await ownProduct(prisma, tenant.tenantId, personnel.id);
    await project(app, tenant.tenantId);

    const res = await tap(UID).expect(403);

    expect(res.body.actionable).toMatchObject({
      requirement: expect.objectContaining({ key: "feature.cardShift" }),
    });
    expect(res.body.actionable.offer).toMatchObject({
      code: "module_personnel_card_shift",
    });
  });

  it("card-tap is 403 when cardShift is owned but personnelManagement is not", async () => {
    // K15. If the method decorator listed only cardShift it would OVERRIDE the
    // class-level personnelManagement requirement and this would be 404/200.
    const card = await cardModule();
    await grantLicence(prisma, tenant.tenantId);
    await ownProduct(prisma, tenant.tenantId, card.id);
    await project(app, tenant.tenantId);

    await tap(UID).expect(403);
  });

  it("an unknown card returns 404 CARD_NOT_RECOGNISED and writes no attendance row", async () => {
    await fullyEntitled();

    const res = await tap("99:99:99:99").expect(404);

    expect(res.body.code ?? res.body.message?.code).toBe("CARD_NOT_RECOGNISED");
    const rows = await prisma.attendance.count({
      where: { tenantId: tenant.tenantId },
    });
    expect(rows).toBe(0);
  });

  it("a full tap cycle clocks in then clocks out on a real database", async () => {
    await fullyEntitled();
    await enrol();

    const first = await tap(UID).expect(201);
    expect(first.body.action).toBe("clockIn");

    // Step outside the 10s debounce window without sleeping the suite.
    await prisma.attendance.updateMany({
      where: { tenantId: tenant.tenantId },
      data: { updatedAt: new Date(Date.now() - 60_000) },
    });

    const second = await tap(UID).expect(201);
    expect(second.body.action).toBe("clockOut");

    const row = await prisma.attendance.findFirstOrThrow({
      where: { tenantId: tenant.tenantId },
    });
    expect(row.status).toBe("CLOCKED_OUT");
    expect(row.clockInSource).toBe("card");
    expect(row.clockOutSource).toBe("card");
  });

  it("a second tap inside the debounce window is ignored, not a clock-out", async () => {
    await fullyEntitled();
    await enrol();

    await tap(UID).expect(201);
    const dup = await tap(UID).expect(201);

    expect(dup.body.action).toBe("ignored");
    const row = await prisma.attendance.findFirstOrThrow({
      where: { tenantId: tenant.tenantId },
    });
    expect(row.status).toBe("CLOCKED_IN");
  });

  it("a one-time cardShift purchase leaves currentPeriodEnd NULL and the grant validUntil NULL", async () => {
    // K6: the sweeper filters on `currentPeriodEnd: { lte: now, not: null }`,
    // so a NULL row is never scanned and the lock never expires.
    await personnelModule();
    await cardModule();
    await grantLicence(prisma, tenant.tenantId);
    const marketplace = app.get(TenantMarketplaceService);
    await marketplace.purchase(tenant.tenantId, { addOnCode: "module_personnel" });
    await marketplace.purchase(tenant.tenantId, {
      addOnCode: "module_personnel_card_shift",
    });
    await project(app, tenant.tenantId);

    const owned = await prisma.tenantAddOn.findFirstOrThrow({
      where: { tenantId: tenant.tenantId, addOn: { code: "module_personnel_card_shift" } },
    });
    expect(owned.currentPeriodEnd).toBeNull();

    await app.get(TenantAddOnSweeperService).runOnce();

    const after = await prisma.tenantAddOn.findUniqueOrThrow({
      where: { id: owned.id },
    });
    expect(after.status).toBe("active");

    const grant = await prisma.featureEntitlement.findFirst({
      where: { tenantId: tenant.tenantId, key: "feature.cardShift" },
    });
    expect(grant).not.toBeNull();
    expect(grant!.validUntil).toBeNull();
  });

  it("a lapsed licence darkens card-tap but keeps the ownership row and the card assignment", async () => {
    await fullyEntitled();
    await enrol();
    await tap(UID).expect(201);

    const licence = await prisma.tenantAddOn.findFirstOrThrow({
      where: { tenantId: tenant.tenantId, addOn: { kind: "license" } },
    });
    await prisma.tenantAddOn.update({
      where: { id: licence.id },
      data: {
        status: "expired",
        currentPeriodEnd: new Date(Date.now() - 30 * 24 * 3600 * 1000),
      },
    });
    await project(app, tenant.tenantId);

    await tap(UID).expect(403);

    // K21: nothing is deleted. Paying restores it; nobody re-enrols a card.
    const stillOwned = await prisma.tenantAddOn.findFirst({
      where: {
        tenantId: tenant.tenantId,
        addOn: { code: "module_personnel_card_shift" },
      },
    });
    expect(stillOwned?.status).toBe("active");
    const staff = await prisma.user.findUniqueOrThrow({
      where: { id: tenant.userId },
    });
    expect(staff.staffCardUidHash).toBe(
      cardUidHash(tenant.tenantId, normalizeCardUid(UID)),
    );
  });
});
```

> **Not:** `featureEntitlement` model adı bu depoda `feature_entitlements` tablosuna eşlenir; Prisma istemcisindeki tam ad `prisma.featureEntitlement` değilse (`npx prisma studio` ya da `grep -n 'feature_entitlements' backend/prisma/schema.prisma` ile modelin adını doğrula) **iddiayı** o ada uyarla — üretim kodunu değil.

- [ ] **Adım 2: e2e süitini çalıştır**

Çalıştır: `cd /home/tarik/Projects/kds/backend && npx jest --config test/jest-e2e.json test/card-shift.e2e-spec.ts`
Beklenen: PASS — 7 test yeşil. İlk çalıştırmada gerçek Postgres gerekir; `DATABASE_URL` e2e yapılandırmasının beklediği veritabanına bakmalıdır (diğer e2e süitleriyle aynı kurulum: `npx jest --config test/jest-e2e.json test/licensing.e2e-spec.ts` yeşilse ortam hazırdır).

- [ ] **Adım 3: Commit'le**

```bash
cd /home/tarik/Projects/kds
git add backend/test/card-shift.e2e-spec.ts
git commit -m "test(card-shift): gerçek veritabanı ve guard zinciri üzerinde uçtan uca süit"
```

---

## Görev 15: Dokümantasyon — kataloğu elle sayan yüzeyler + donanım kılavuzu + yanlış iddianın düzeltilmesi

Hiçbir CI kapısı yeni bir ürünü bu yüzeylere yazmaya zorlamıyor. ₺4.000'lık bir modülü ve ₺1.290'lık bir SKU'yu satış rehberinin ve yetki matrisinin hiç saymaması, bu spec'in kendi uyardığı sessiz-eskime sınıfının ta kendisidir. Ayrıca `docs/SISTEM_TANITIMI.md:217` bugün var **olmayan** bir şeyi ("QR/NFC kart ile damgalar") satıyor.

> ⚠️ **Ortak dosyalar:** `docs/SISTEM_TANITIMI.md`, `docs/PAZARLAMACI_REHBERI.md` ve `help/pages/{tr,en}/marketplace/products.mdx` üç PR'da da elleniyor ve Change 1 satır **siliyor**. Buradaki mutlak `:NNN` çapaları rebase sonrası kayar — çapaları **içerik eşlemesiyle** çöz, satır numarasıyla değil.

**Files:**
- Modify: `docs/SISTEM_TANITIMI.md`
- Modify: `docs/PAZARLAMACI_REHBERI.md`
- Create: `docs/hardware/10-kart-okuyucu.md`
- Modify: `docs/hardware/README.md`
- Modify: `developer/pages/{tr,en}/developer/marketplace-api.mdx`
- Modify: `developer/pages/{tr,en}/reference/plan-matrix.mdx`
- Modify: `help/pages/{tr,en}/marketplace/products.mdx`
- Modify: `help/pages/{tr,en}/marketplace/index.mdx`
- Modify: `help/pages/{tr,en}/plans/index.mdx`
- Modify: `help/pages/{tr,en}/plans/feature-matrix.mdx`
- Modify: `help/pages/{tr,en}/admin-guide/personnel.mdx`
- Test: Adım 8'in grep denetimi

**Interfaces:**
- Consumes: katalog satırının kanonik metni ve fiyatı (Görev 9), SKU değerleri (Görev 8)
- Produces: yok (belge yüzeyleri)

- [ ] **Adım 1: `docs/SISTEM_TANITIMI.md` — yanlış iddiayı düzelt**

"Giriş-çıkış (clock-in/out): personel kendi şifresi ile veya QR/NFC kart ile damgalar" satırını (bugün `:217`) **iki maddeye** ayır:

```markdown
- **Giriş-çıkış (clock-in/out)**: personel kendi hesabıyla uygulama üzerinden damgalar (Personel Yönetimi modülü)
- **RFID kart ile damgalama**: **Kartlı Vardiya** modülü (₺4.000 tek seferlik) ile personel, ucuz bir USB kart okuyucuya kartını okutarak giriş-çıkış yapar. QR ile damgalama **yoktur**
```

- [ ] **Adım 2: `docs/SISTEM_TANITIMI.md` — katalog tablosuna satır ekle**

"Ücretli katalog (TRY, KDV dahil)" tablosunda `| Personel Yönetimi | modül / yıllık | ₺990 |` satırının hemen altına:

```markdown
| Kartlı Vardiya (RFID kart ile giriş-çıkış) | modül / tek seferlik | ₺4.000 |
```

- [ ] **Adım 3: `docs/PAZARLAMACI_REHBERI.md` — modül satırı + donanım tablosu**

Modül tablosunda `| Personel Yönetimi | **₺990** | …` satırının altına:

```markdown
| Kartlı Vardiya (tek seferlik) | **₺4.000** | RFID kart okutarak personel giriş-çıkışı; Personel Yönetimi modülü ön koşuldur, yenileme ücreti yoktur |
```

"Hizmet (tek seferlik)" tablosundan **sonra** yeni bir bölüm (rehberde bugün donanım tablosu hiç yok):

```markdown
### Donanım (tek seferlik, kargolu)

| Donanım | Tutar | İçerik |
|---|---:|---|
| RFID Personel Kart Okuyucu (USB HID) + 10 Kart | **₺1.290** | Kartlı Vardiya modülü için masaüstü 13.56 MHz okuyucu ve 10 personel kartı |
```

- [ ] **Adım 4: `docs/hardware/10-kart-okuyucu.md`'yi yaz**

Numara **10**'dur: dizin bugün `00-genel-cerceve.md` … `09-pos-terminal.md` şeklinde kesintisizdir. Kılavuzsuz SKU satılmaz.

```markdown
# RFID Personel Kart Okuyucu (USB HID)

> Bu belge, HummyTummy KDS/POS platformunda **Kartlı Vardiya** modülü
> (`module_personnel_card_shift`, ₺4.000 tek seferlik) ile birlikte satılan
> **13.56 MHz Mifare USB HID personel kart okuyucusu** için restoran
> operatörüne ve kurulumu yapan bayiye yönelik kullanım ve uyumluluk
> yönergesidir. Katalog SKU'su: `card-reader-rfid-usb-hid`.
>
> Fiyat, garanti süresi ve tedarik bilgileri **satış öncesi güncel resmi
> kaynaktan doğrulanmalıdır**.

---

## 1. Genel bakış

Cihaz, personel kartındaki 13.56 MHz (ISO/IEC 14443-A, Mifare) etiketin
benzersiz kimliğini (UID) okur ve **USB HID klavye emülasyonu** ile host'a
"yazar": kart okutulduğunda, o an odakta olan alana UID yazılır ve ardından
Enter gönderilir. **Sürücü kurulumu gerekmez**; işletim sistemi cihazı klavye
olarak görür.

**Sistemdeki rolü:** Kartlı Vardiya istasyon ekranı (`/card-shift`) görünmez
ama daima odaklı bir alan tutar; okuyucunun yazdığı UID doğrudan
`POST /personnel/attendance/card-tap` isteğine gider. Sunucu UID'yi düz metin
saklamaz — normalize eder ve peppered HMAC'ini yazar.

**Bu cihaz mali bir cihaz DEĞİLDİR.** Yazarkasa/ÖKC mevzuatı kapsamında
değildir, fiş kesmez, GİB'e bağlanmaz; yalnızca personel devam kaydı üretir.

## 2. Paket içeriği ve teknik özellikler

| Özellik | Değer |
|---|---|
| SKU | `card-reader-rfid-usb-hid` |
| Katalog fiyatı | ₺1.290 (KDV dahil, gösterge açılış fiyatı; superadmin panelinden düzenlenebilir) |
| Paket | 1 × masaüstü okuyucu + 10 × Mifare personel kartı |
| Frekans / standart | 13.56 MHz, ISO/IEC 14443-A (Mifare Classic/NTAG) |
| Host arayüzü | USB Tip-A, HID klavye emülasyonu (sürücüsüz) |
| Çıktı | Kart UID'si + Enter |
| Okuma mesafesi | ~2–5 cm (temassız, temas gerektirmez) |
| Besleme | USB üzerinden (harici adaptör yok) |
| Garanti | 12 ay (üretici/bayi taahhüdü) |

## 3. Kurulum

1. Okuyucuyu istasyon tabletinin/PC'sinin USB portuna tak. Sürücü kurulumu
   yoktur; cihaz birkaç saniye içinde klavye olarak tanınır.
2. Tarayıcıda **Kartlı Vardiya** istasyon ekranını aç: sol menü → **Kartlı
   Vardiya**, ya da Ekip → Kartlı Vardiya sekmesindeki "İstasyon ekranını aç".
3. Bir kartı okut. Ekranda "Kart tanınmadı" görünüyorsa cihaz doğru çalışıyor
   demektir — kart henüz bir personele atanmamıştır.
4. Kartları ata: **Ekip → Kartlı Vardiya** sekmesinde personelin satırındaki
   "Kart ata"ya bas, alan odaklanınca kartı okut. Tablo yalnız kartın **son 4
   hanesini** gösterir.

## 4. Günlük kullanım

- **İlk okutma** günün girişini damgalar, **ikinci okutma** çıkışını.
- Personel molada ise okutma **molayı bitirir**. Mola **başlatma** uygulama
  içinden yapılır: kiosk "molaya çıkıyorum" ile "eve gidiyorum"u ayırt edemez.
- Aynı kart 10 saniye içinde iki kez okutulursa ikincisi **yok sayılır**
  (bazı okuyucular tek okutmada iki kez yazar).

## 5. Sorun giderme

| Belirti | Olası neden | Çözüm |
|---|---|---|
| Kart okutunca hiçbir şey olmuyor | İstasyon ekranındaki gizli alan odakta değil | Ekrana bir kez dokun; alan otomatik yeniden odaklanır |
| Ekranda "Kart tanınmadı" | Kart hiçbir personele atanmamış veya personel pasif | Ekip → Kartlı Vardiya'dan kartı ata / personeli aktifleştir |
| Ekranda "Bugün çıkış yapılmış" | Aynı gün zaten giriş **ve** çıkış damgalanmış | Düzeltme gerekiyorsa yönetici puantaj kaydını elden düzenler |
| UID her okutmada farklı yazılıyor | Okuyucu rastgele UID (RID) veren kart okuyor | Sabit UID'li Mifare kart kullan (pakette gelen kartlar sabittir) |
| Menü'de "Kartlı Vardiya" görünmüyor | Modül alınmamış veya lisans sönmüş | Mağaza → Kartlı Vardiya; lisans aktif olmalı |

## 6. Güvenlik notu

Kart, bir **devam kaydı** anahtarıdır; kasa veya kapı erişimi değildir. 13.56
MHz Mifare kartlar kopyalanabilir — riski "arkadaşına kartını verip
damgalatma" düzeyindedir ve bu manuel damgalamada da vardır. Kartlı damgalama
bir **güvenlik kontrolü olarak pazarlanmaz**.

Kart numarası sistemde **düz metin saklanmaz**; yalnızca kiracıya özel bir
HMAC'i ve son 4 hanesi tutulur. Kart iptal edildiğinde geçmiş puantaj kayıtları
silinmez.

## 7. Satış ve devreye alma kontrol listesi

- [ ] Müşteride **Personel Yönetimi** modülü ve **aktif lisans** var mı?
- [ ] **Kartlı Vardiya** modülü satın alındı mı (₺4.000, tek seferlik)?
- [ ] Okuyucu paketi kargolandı mı (okuyucu + 10 kart)?
- [ ] İstasyon cihazı belirlendi mi (tablet/PC) ve tarayıcıda `/card-shift`
      açıldı mı?
- [ ] Tüm personele kart atandı mı, her biri bir kez test okutuldu mu?
- [ ] Müşteriye "tek seferlik ödeme, ama lisans sönerse erişim kapanır"
      açıkça söylendi mi?
```

- [ ] **Adım 5: `docs/hardware/README.md` indeksine bağla**

`## 3. Çevre Birimleri (Peripherals)` bölümündeki bağlantı listesine ekle:

```markdown
- [RFID Personel Kart Okuyucu (USB HID)](./10-kart-okuyucu.md) — 13.56 MHz Mifare, sürücüsüz HID; Kartlı Vardiya modülüyle çalışır, mali cihaz DEĞİLDİR.
```

- [ ] **Adım 6: Geliştirici portalının iki tablosuna satır ekle**

`developer/pages/en/developer/marketplace-api.mdx` "Catalogue summary" tablosunda `module_personnel` satırının altına (ve `tr` aynasına aynısını):

```markdown
| `module_personnel_card_shift` | module | **one-time** | ₺4,000 (`400000`) | `feature.cardShift` | ✅ | `module_personnel` |
```

`developer/pages/en/reference/plan-matrix.mdx` "Modules" tablosunda `module_personnel` satırının altına (ve `tr` aynasına):

```markdown
| `module_personnel_card_shift` | ₺4,000 tek seferlik | `feature.cardShift` | ✅ |
```

`Dependency` sütunu bugün yalnız kontör satırlarında dolu; bu **modül→modül** bağımlılığı taşıyan ilk satırdır. `plan-matrix.mdx`'teki fiyatların tümü `₺…/yr` biçiminde olduğu için "tek seferlik" ibaresi satır metnine açıkça yazılır.

- [ ] **Adım 7: Yardım portalının beş yüzeyine satır/bölüm ekle**

**(a)** `help/pages/tr/marketplace/products.mdx` — `### Personel Yönetimi` bölümünden sonra (ve `en` aynası):

```markdown
### Kartlı Vardiya (tek seferlik)

Personel giriş-çıkışını RFID kart okutarak damgalar. Ucuz USB kart
okuyucularla çalışır; puantaj, mola ve fazla mesai hesabı Personel Yönetimi
modülündeki kayıtların üstüne yazılır.

| Alan | Değer |
| --- | --- |
| Tür | Modül |
| Fatura | **Tek seferlik** |
| Fiyat | ₺4.000,00 |
| Ne işe yarar | RFID kart okutarak giriş-çıkış damgalama |
| Bağımlılık | **Personel Yönetimi** + aktif lisans |

<Callout type="warning">
  Yenileme ücreti yoktur, ancak **lisansınız sönerse erişim kapanır**. Sahiplik
  kaydınız ve kart atamalarınız silinmez; lisans geri geldiğinde modül yeniden
  açılır.
</Callout>
```

**(b)** `help/pages/tr/marketplace/index.mdx` fiyat tablosuna, Personel Yönetimi satırının altına (ve `en`):

```markdown
| Kartlı Vardiya | Modül | **Tek seferlik** | ₺4.000,00 | RFID kart okutarak personel giriş-çıkışı (Personel Yönetimi ön koşuldur) |
```

**(c)** `help/pages/tr/plans/index.mdx` modül listesine, Personel Yönetimi satırının altına (ve `en`):

```markdown
| Kartlı Vardiya | **₺4.000 tek seferlik** | RFID kart okutarak personel giriş-çıkışı; Personel Yönetimi modülü ön koşuldur |
```

**(d)** `help/pages/tr/plans/feature-matrix.mdx` matrisine, Personel yönetimi satırının altına (ve `en`):

```markdown
| Kart ile giriş-çıkış | Kartlı Vardiya | ₺4.000 tek seferlik |
```

**(e)** `help/pages/en/admin-guide/personnel.mdx` (ve `tr` aynası) — bugün damgalamanın **tek** yolu olarak uygulama içi giriş-çıkışı anlatıyor. Tabs tablosuna bir satır ve dosyanın sonuna bir alt bölüm ekle:

```markdown
| **Card Shift** | RFID card enrolment — one row per staff member, last 4 digits only |
```

```markdown
## Clocking in with a card

Requires the **Card Shift** module (`cardShift`, ₺4,000 one-time, with the
licence as a prerequisite) **in addition to** `personnelManagement`.

1. **Enrol the cards.** Team → Card Shift → "Assign card", then tap the card
   into the focused field. Only the last four digits are ever displayed.
2. **Open the station screen.** Sidebar → Card Shift (`/card-shift`), on the
   tablet or PC the reader is plugged into. Leave it open.
3. **Tapping.** The first tap of the day clocks the person in, the second
   clocks them out, and a tap while on a break ends the break. Starting a
   break stays in the app.
4. **Duplicate taps.** A second tap within **10 seconds** is ignored — some
   readers write one card twice.
5. **Unrecognised cards.** A card that belongs to nobody (or to a deactivated
   person) shows "Card not recognised". The number is never echoed on screen
   or written to a log.

Revoking a card keeps every past attendance record, including the fact that it
was stamped with a card.
```

- [ ] **Adım 8: Belge denetimini koştur**

```bash
cd /home/tarik/Projects/kds
grep -rl "module_personnel_card_shift\|Kartlı Vardiya\|Card Shift" docs developer/pages help/pages
grep -rn "QR/NFC" docs/SISTEM_TANITIMI.md
```
Beklenen: ilk komut en az şu 15 dosyayı listeler — `docs/SISTEM_TANITIMI.md`, `docs/PAZARLAMACI_REHBERI.md`, `docs/hardware/10-kart-okuyucu.md`, `docs/hardware/README.md`, `developer/pages/{tr,en}/developer/marketplace-api.mdx`, `developer/pages/{tr,en}/reference/plan-matrix.mdx`, `help/pages/{tr,en}/marketplace/products.mdx`, `help/pages/{tr,en}/marketplace/index.mdx`, `help/pages/{tr,en}/plans/index.mdx`, `help/pages/{tr,en}/plans/feature-matrix.mdx`, `help/pages/{tr,en}/admin-guide/personnel.mdx`. İkinci komut **hiçbir şey döndürmez** (yanlış iddia kalktı).

- [ ] **Adım 9: Commit'le**

```bash
cd /home/tarik/Projects/kds
git add docs/SISTEM_TANITIMI.md docs/PAZARLAMACI_REHBERI.md docs/hardware/10-kart-okuyucu.md docs/hardware/README.md developer/pages help/pages
git commit -m "docs(card-shift): katalog yüzeyleri, donanım kılavuzu ve QR iddiasının düzeltilmesi"
```

---

## Görev 16: Kabul — tam süitler, kapılar ve elle doğrulama

**Files:**
- Test: tüm depo (aşağıdaki komutlar)

**Interfaces:**
- Consumes: Görev 1-15'in tamamı
- Produces: yok (kabul kapısı)

- [ ] **Adım 1: Backend birim + entegrasyon süitleri**

```bash
cd /home/tarik/Projects/kds/backend && npx jest src/modules/personnel src/modules/marketplace src/modules/checkout src/modules/entitlements src/modules/catalog src/modules/licensing
```
Beklenen: hepsi yeşil, 0 başarısız.

- [ ] **Adım 2: Backend e2e**

```bash
cd /home/tarik/Projects/kds/backend && npx jest --config test/jest-e2e.json test/card-shift.e2e-spec.ts
cd /home/tarik/Projects/kds/backend && npx jest --config test/jest-e2e.json test/licensing.e2e-spec.ts
```
Beklenen: ikisi de yeşil (ikincisi kartlı vardiya değişikliklerinin lisans rayını bozmadığını gösterir).

- [ ] **Adım 3: Backend tam süit + tipler + lint**

```bash
cd /home/tarik/Projects/kds/backend && npx jest --silent
cd /home/tarik/Projects/kds/backend && npx tsc --noEmit
cd /home/tarik/Projects/kds/backend && npm run lint:ci
```
Beklenen: üçü de temiz. **`npm run lint` kullanma** — `--fix` taşır ve hatayı gizler.

- [ ] **Adım 4: Frontend tam süit + tipler**

```bash
cd /home/tarik/Projects/kds/frontend && npx vitest run
cd /home/tarik/Projects/kds/frontend && npx tsc --noEmit -p tsconfig.json
```
Beklenen: ikisi de temiz.

- [ ] **Adım 5: Depo kapıları**

```bash
node scripts/check-i18n-parity.mjs
cd /home/tarik/Projects/kds && node scripts/check-i18n-value-drift.mjs --gate-new scripts/i18n-value-drift-baseline.json
cd /home/tarik/Projects/kds && node scripts/check-contract-drift.mjs
```
Beklenen: üçü de temiz. Value-drift **yeni hiçbir anahtarı baseline'a eklemeden** geçmelidir; geçmiyorsa çeviriyi düzelt, baseline'ı değil.

- [ ] **Adım 6: `git diff`'te baseline'ın büyümediğini doğrula**

```bash
cd /home/tarik/Projects/kds && git diff origin/main -- scripts/i18n-value-drift-baseline.json
```
Beklenen: **boş çıktı**. Bu dosyaya bir satır eklendiyse `--gate-new` kapısının anlamı kalmamıştır — geri al ve gerçek çeviriyi yaz.

- [ ] **Adım 7: Elle — modül alınmamış bir kiracı**

Uygulamayı çalıştır, `cardShift` sahibi olmayan bir kiracıyla giriş yap:
- Sol menüde **Kartlı Vardiya** girdisi **görünmemeli**.
- `/card-shift` adresine elle git → `UpsellCard` (`module_personnel_card_shift`) görünmeli, istasyon ekranı **açılmamalı**.
- Ekip sayfasında üçüncü sekme **olmamalı**.
- Mağazada "Kartlı Vardiya" satırını işaretle → faturaya **Personel Yönetimi** (gerekiyorsa) ve **lisans** otomatik eklenmeli, toplam doğru olmalı.

- [ ] **Adım 8: Elle — modülü olan bir kiracı, gerçek okutma**

`module_personnel` + `module_personnel_card_shift` + aktif lisansı olan bir kiracıda:
- Ekip → Kartlı Vardiya → bir personele kart ata (klavyeden UID yazmak okuyucuyla aynı şeydir). Tabloda **yalnız son 4 hane** görünmeli.
- `/card-shift`'i aç, aynı UID'yi yaz + Enter → "Hoş geldin, … — giriş HH:mm" yeşil kartta görünmeli.
- Hemen tekrar yaz + Enter → "Kart az önce okutuldu" (kehribar) görünmeli, vardiya **kapanmamalı**.
- 10 sn sonra tekrar → "İyi çalışmalar, … — çıkış HH:mm".
- Ekip → Puantaj → geçmişte satırın kaynağı **Kart** rozetiyle, özet sekmesinde **Kartla giriş** sütunu dolu olmalı.
- Tanınmayan bir numara yaz → "Kart tanınmadı" görünmeli ve **yazdığın numara ekranda hiçbir yerde olmamalı**.
- 60 sn dokunma → kilit overlay'i düşmeli.

- [ ] **Adım 9: Elle — CSV dışa aktarımı**

Ekip → Puantaj → Özet → CSV indir. Başlık satırı `…,Late Days,Late Minutes,Card Clock-ins` olmalı ve dosyada **hiçbir para kolonu** bulunmamalı.

- [ ] **Adım 10: Sürüm ve PR**

`package.json` sürümlerini `v3.6.8`'e taşı, PR açıklamasına Görev 4/Adım 8-9 ve Görev 10/Adım 7-8'in **gerçek psql çıktılarını** yapıştır (round-trip + para güvenliği kanıtı). PR'da AI/Claude izi **yok**.

---

## Self-Review

### 1. Spec kapsamı

| Spec bölümü / gereksinim | Görev |
|---|---|
| §1/1 + §2 K1-K5, K21 — katalog ürünü `module_personnel_card_shift` | T9 |
| §1/2 + §2 K7, §5/1-2,4-5 + T4 — `cardShift` bayrağı ve 13 senkron noktası | T1 |
| §1/3 + §4.1-4.2 — gerçek yazılım rayı, `Attendance` üstüne | T4, T6, T7 |
| §1/4a + §4.8 — vitrin `deps` körlüğü (ön koşul a) | T2 |
| §1/4b + §4.9 — provizyon sırası (ön koşul b) | T3 |
| §1/5 + §2 K16-K17 + §5/23-25 — `card_reader` kategorisi ve donanım SKU'su | T8, T10 |
| §1/6 + §3.5 — `SISTEM_TANITIMI.md:217` yanlış iddiası | T15 |
| §1/7 + §3.6 + §5/42-49 — kataloğu elle sayan 11 yüzey | T15 |
| §2 K6 — oneTime → `currentPeriodEnd` NULL, süpürücü görmez | T14 (e2e kanıtı) |
| §2 K8-K9, K22 + §4.3 — HMAC, tenant-scoped unique, geri döndürülebilir kopya | T4, T5, T7 |
| §2 K10-K13 + §4.4 — toggle, debounce, 404, throttle | T7 |
| §2 K14-K15 + §4.4 — roller ve iki bayrağın birlikte listelenmesi | T7 (birim), T14 (e2e) |
| §2 K18 + §4.2 — `clockInSource` / `clockOutSource` | T4, T6 |
| §2 K19 + §6.3 — drift spec'inin genişletilmesi | T10 |
| §2 K20 + §4.8 — yalnız `active` sahiplik dep'i karşılar | T2 |
| §4.5a — `TeamPage` üçüncü sekmesi, kart ata/iptal | T11 |
| §4.5b — istasyon ekranı, rota, `FeatureGate` + `UpsellCard` | T12 |
| §4.5c — `AttendanceTab` rozeti ve özet sütunu | T13 |
| §4.6 — `cardClockIns`, CSV kolonu, `source` filtresi | T6, T13 |
| §4.7 — uçtan uca para akışı | T2, T3, T9, T14 |
| §5/6-8 + §6.1-6.2 + §6.4 — iki migration çifti ve round-trip kanıtı | T4, T10 |
| §5/9-17 — personel rayının dokuz backend dosyası | T5, T6, T7 |
| §5/18-22 — checkout ve licensing düzeltmeleri | T2, T3 |
| §5/26-37b — 13 frontend dosyası | T1, T2, T11, T12, T13 |
| §5/38-41b — beş i18n ailesi × beş dil | T1, T2, T11, T12 |
| §7.1-7.4 — sözlük/katalog/birim/frontend testleri | T1, T3, T5, T6, T7, T8, T9, T10, T11, T12 |
| §7.5 — e2e süiti ve komut listesi | T14, T16 |
| §8 T1-T11 tuzakları | Global Constraints + T10 (T1), T4/T10 (T2, T3), T1 (T4), T9 (T5), T1/T2/T11/T12 (T6), T13 (T7), T6/T7/T1 (T8), T16 (T9), T10 (T10), T15 (T11 — TRY literal notu) |
| §8 Risk 1-14 | T3 (1), T2 (2), T9/T15 (3), T15 (4), T12 (5), T7 (6), T7 (7), T15 (8), Global Constraints (9), T6 (10), T4 (11), T5 (12), T15 (13), T12 (14) |

**Kapsam dışı olduğu spec'te yazılı ve burada da görev yok** (§9): cihaz-token rayı, katalogda para birimi boyutu, `AttendanceSource`'un contract-drift script'ine eklenmesi, `seed-marketplace.ts:1006` zorla-yayınlama davranışı, QR ile damgalama, kart ile POS oturumu, `SubscriptionPlan` feature kolonlarının emekliye ayrılması, `UZ_EXPANSION_BENCHMARK.md` (düzeltilecek bir şey yok — doğrulandı), superadmin kategori `<select>`'inin sözlükten türetilmesi, `ENCRYPTION_MASTER_KEY` rotasyon script'i.

**Somut göreve dönüştürülemeyen tek şey:** §9/10'un rotasyon **job**'ı. K22 kolonları T4'te açılıyor ve T5 rotasyonun matematiksel olarak mümkün olduğunu test ediyor, ama script'in kendisi spec'te açıkça kapsam dışıdır (§9/10) — bu yüzden görev yok, yalnız `card-uid.ts` yorumunda ve `down.sql` başlığında prosedür yazılı.

### 2. Placeholder taraması

"TBD", "TODO", "sonra doldur", "uygun hata yönetimi ekle", "edge case'leri ele al", "yukarıdakiler için test yaz", "Görev N'e benzer" ifadelerinin hiçbiri planda geçmiyor; her kod adımı gerçek kod, her test adımı gerçek test taşıyor. Üç yerde kasıtlı **koşullu** talimat var ve hiçbiri placeholder değil:

- T3/Adım 9: `purchase` mock'unun argüman şekli farklıysa **iddiayı** gerçek şekle uyarla (kodu değil). Gerçek şekil `purchase(tenantId, { addOnCode, … }, tx)`; iddia buna göre yazılı.
- T10/Adım 5: `introduced` bloğunun sahibi Change 1; bu PR onu **doğrular**, farklıysa yazar. İki durum da tam kodla verilmiş.
- T14/Adım 1'in notu: `prisma.featureEntitlement` model adı doğrulanmalı. Bu bir isim doğrulaması, eksik içerik değil.

**Tarama sırasında bulunup düzeltilenler:**
- Spec §5/38'in i18n tablosu **Risk 5'in karşı önlemini kapsamıyordu** (istasyonun "Oturumu kilitle" butonu ve hareketsizlik overlay'i) ve §5/37b'nin "İstasyon ekranını aç" butonunu da. Bu dört anahtar (`station.lock`, `station.locked`, `station.unlock`, `openStation`) beş dilde gerçek çeviriyle T11'e eklendi — aksi hâlde uygulayıcı bunları uydurmak zorunda kalırdı.
- Aynı şekilde `cardShift.assigned` ve `cardShift.revoked` toast metinleri spec tablosunda yoktu; hook'lar onları çağırdığı için beş dilde eklendi.
- Spec'in `depAutoAdded` taslağı `snapshot?.owned`'ı okuyor, ama `CatalogStore.test.tsx`'in mevcut mock'u `snapshot`'a `owned` koymuyor. T2/Adım 7 mock'un düzeltilmesini açıkça yazıyor; olmasaydı beş yeni test anlaşılmaz biçimde kızarırdı.
- Spec'in prisma bloğu `@@index([staffCardAssignedById])`'i listelemiyordu ama migration o indeksi yaratıyor. T4/Adım 2 indeksi şemaya da ekliyor — aksi hâlde ilk `prisma migrate dev` şema-drift bildirirdi.
- `AttendanceTab`'ın `colSpan` değerleri: kolon eklenince `7→8` ve `5→6` yapılmazsa boş-durum satırları kayar. T13/Adım 2-3'te açıkça yazılı.

### 3. Tip tutarlılığı

Görevler arası her ad tek yazımla kullanılıyor:

| Ad | Üreten | Tüketen |
|---|---|---|
| `PlanFeature.CARD_SHIFT` / `"cardShift"` | T1 | T7 (dekoratörler), T9 (grant), T10 (jsonb), T11-T13 (`hasFeature`), T14 |
| `PricingProduct.deps: string[]` | T2 | T2 (`CatalogStore`) |
| `orderAddOnLinesForProvisioning` / `KIND_RANK` | T3 | T3 (`checkout.service.ts`) |
| `PricedLineMeta.deps?: string[]` | T3 | T3 (sıralama) |
| `User.staffCardUidHash / staffCardUidEnc / staffCardHashVersion / staffCardLast4 / staffCardAssignedAt / staffCardAssignedById` | T4 | T7 (servis), T14 (e2e) |
| `Attendance.clockInSource / clockOutSource` | T4 | T6 (servis), T13 (FE tip) |
| `normalizeCardUid / isValidCardUid / cardUidHash / cardUidLast4 / staffCardAad / STAFF_CARD_HASH_VERSION` | T5 | T7, T14 |
| `AttendanceSource.MANUAL / CARD` | T6 | T7 (`AttendanceSource.CARD`), T6 (DTO) |
| `clockIn(tenantId, userId, notes?, source?)` / `clockOut(tenantId, userId, source?)` | T6 | T7 (delegasyon) — parametre sırası ve varsayılanlar birebir aynı |
| `CardTapDto / AssignCardDto` | T7 | T7 (controller), T12 (gövde şekli) |
| `CardTapResult { action, user, attendance }` | T7 | T11 (`CardTapResponse` aynası — aynı üç alan, aynı `action` birleşimi) |
| `CardAssignmentView { userId, firstName, lastName, role, last4, assignedAt, assignedById }` | T7 | T11 (`CardAssignment` aynası — aynı yedi alan; `assignedAt` BE'de `Date`, FE'de JSON üzerinden `string`) |
| `useCardAssignments / useAssignCard / useRevokeCard / useCardTap` | T11 | T11 (`CardShiftTab`), T12 (`CardShiftStationPage` yalnız `useCardTap`) |
| i18n `personnel:cardShift.*` | T11 | T11, T12, T13 — T13'ün `t('cardShift.sourceCard')` çağrısı `AttendanceTab`'ın `personnel` ad alanı varsayılanıyla çözülür |
| `card-reader-rfid-usb-hid` SKU'su | T8 (seed) | T10 (migration), T15 (belgeler) — üç yerde de birebir aynı dize |
| `module_personnel_card_shift` kodu | T9 | T10, T12 (`UpsellCard`), T14, T15 — beş yerde birebir aynı |

Tespit edilip düzeltilen tutarsızlık: ilk taslakta servis `CardTapResult.attendance` alanını `any` bırakıyordu; `Awaited<ReturnType<AttendanceService["clockIn"]>> | null` yapıldı, böylece T6'nın imza değişikliği T7'yi derleme zamanında sürüklüyor. Ayrıca FE tarafında `CardTapResponse.attendance` `Attendance | null` olarak yazıldı — `undefined` değil — çünkü `ignored` yolu açıkça `null` döndürüyor.

### 4. Doğal sevkiyat sınırı

T1-T3 tek başına tutarlı ve gönderilebilir: bayrak sözlüğü + iki latent para hatasının düzeltmesi. Ürün henüz satışta olmadığı için bu üçü kendi başına bir "hardening" PR'ı olarak da anlamlıdır. T4-T14 ürünün kendisidir ve **T9 (katalog satırı) T2 ve T3'ten sonra gelmek ZORUNDADIR** — sıra pazarlık konusu değildir. T15-T16 kapanış.
