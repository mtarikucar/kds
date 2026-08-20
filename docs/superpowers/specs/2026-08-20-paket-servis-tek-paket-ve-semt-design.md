# Paket servis tek paket + Semt (yakında) — tasarım

> **Durum:** ONAYLI tasarım. Kararlar kullanıcıyla birlikte alındı ve KESİNDİR.
> Bu belge kararları kayda geçirir; yeniden tartışmaz, alternatif önermez.
> Uygulayıcının ek keşif yapmasına gerek kalmayacak kadar kesin olmak zorundadır:
> tam dosya yolları, tam tanımlayıcılar, kuruş cinsinden tam fiyatlar, tam
> migration klasör adı, tam test adları.
>
> **Tarih:** 2026-08-20 · **Dal:** `feat/multi-country-architecture`

---

## 1. Amaç ve kapsam

### Ne çıkıyor

1. **Tek paket teslimat SKU'su.** Platform başına satılan üç eklenti
   (`delivery_yemeksepeti`, `delivery_getir`, `delivery_trendyol_yemek` —
   her biri 249.000 kuruş) yerini **tek** bir satıra bırakır:
   `delivery_platforms`, **249.900 kuruş (₺2.499, KDV DAHİL)**, dört sağlayıcıyı
   birden açar (yemeksepeti, getir, trendyol_yemek, **migros**).
2. **Migros'a ayrı SKU yok.** Adaptör zaten var
   (`backend/src/modules/delivery-platforms/adapters/migros.adapter.ts:22`,
   fabrikada kayıtlı: `adapters/adapter-factory.ts:27`), pakete dahil edilir.
3. **Üç eski kod ARŞİVLENİR, asla silinmez** (`status='archived'`), ve
   `RETIRED_ADDON_CODES`'a eklenir.
4. **Mevcut sahiplerin mülkiyeti korunur** — ancak yalnızca arşivlemek yetmez
   (bkz. §2 K5b — ONAYLANDI ve §8 R1): aynı migration mevcut `tenant_addons`
   satırlarını yeni paket satırına **taşır**, açık yenileme döngülerini temizler ve
   uçuştaki ödeme niyetleri varsa **çalışmayı reddeder**; yoksa müşteri yıl
   dönümünde erişimi sessizce kaybeder ya da kartı çekilmişken provision reddi alır.
5. **Semt** `DeliveryPlatform` sözlüğüne **ÜCRETSİZ / YAKINDA** olarak eklenir.
   Katalog satırı YOK, fiyat YOK. Yeni `PLATFORM_AVAILABILITY` haritası
   (`'available' | 'coming_soon'`) her yazma yolunu **fail-closed** kapatır.
   Ayarlar sayfasında beşinci kart "Yakında · Ücretsiz" rozetiyle ve devre dışı
   bağlan aksiyonuyla; mağazada satın alınamaz bilgi kartı.

### Ne ÇIKMIYOR (bilinçli olarak)

- **Semt adaptörü, webhook'u, kimlik doğrulaması, menü senkronu.** Hiçbiri.
  Bu değişiklik yalnızca sözlük + vitrin + fail-closed kapıdır.
- **Semt'in alan-geneli teslimat kapısından muafiyeti.** Semt entegrasyonu
  indiğinde gerekecek; bugün gereken vendor→enum haritası yok (§9 A1).
- **Para iadesi / kredi.** İki veya üç platform sahibi olan kiracıya fark iadesi
  yapılmaz; taşınan satır bir sonraki yıl dönümünde ₺2.499'dan yenilenir.
- **Çoklu para birimi.** Yeni fiyat TRY-only bir literaldir (T11, §9 A3).
- **Katalog 0-fiyat doğrulayıcısına dokunmak.** `catalog-validation.ts:242-250`
  aynen kalır; Semt'in katalog satırı olmadığı için gerek yok.

---

## 2. Kararlar

| # | Karar | Tek satır gerekçe |
|---|---|---|
| K1 | Tek `delivery_platforms` satırı, **249.900 kuruş** | Kapı zaten alan-geneli; platform başına fiyat kurguydu (K2). |
| K2 | Platform başına fiyatlandırma kurgusaldı, kaldırılıyor | `@RequiresIntegration("delivery")` sınıf seviyesinde ve **sağlayıcı taşımıyor** (`delivery-platforms.controller.ts:40`, `delivery-gate.spec.ts:52-61`: `[{ integration: "integration.delivery" }]`) — herhangi bir platformu alan dördünü birden açıyordu. |
| K3 | Migros ayrı SKU değil, pakete dahil | Adaptör çalışıyor ama hiç satılmadı; pazarlama zaten "delivery entegrasyonuna dahil" diyor (`frontend/src/marketing/data/integrations.ts:61-64`). |
| K4 | `kind:"integration"`, `billing:"annual"`, `requiresLicense:true`, `deps:[]`, `sortOrder:20` | 20 numara üç satırın kaldırılmasıyla boşalıyor; entegrasyon bloğunun başı (kullanılan sıralar: 0,10-16,20-22,24,25,26,30,40-43,50). |
| K5 | Üç eski kod arşivlenir + `RETIRED_ADDON_CODES`'a eklenir | Projektör arşivli satırın grant'ini okumaya devam eder (§3 A6), yani döngü ortasında kimse kaybetmez. |
| **K5b** | **Mülkiyet yeni paket satırına TAŞINIR** (tersine çevrilebilir migration adımı) + açık `RenewalCycle` temizliği + uçuş-öncesi `checkout_intents` kilidi | **ONAYLANDI (2026-08-20, kullanıcı kararı) — üçü de kapsam içindedir.** Yalnızca arşivlemek yenilemede sessiz kayba yol açıyor; ayrıntı ve sıfır-satır gerekçesi hemen aşağıda. |
| K6 | Semt: enum + `PLATFORM_AVAILABILITY`, katalog satırı YOK | Ücretsiz ve yakında; 0 fiyatlı yayımlanmış satır `purchase()`'ın ödeme kapısını delerdi (`catalog-validation.ts:242-250`). |
| K7 | Fail-closed: DTO `@IsIn(AVAILABLE_DELIVERY_PLATFORMS)` + `AdapterFactory` erişilebilirlik kapısı | Enum'a SEMT eklemek `@IsEnum` sayesinde `POST /delivery-platforms/configs`'u anında SEMT'e açardı; sonrasında `getAdapter("SEMT")` çıplak `Error` fırlatıp 500 verirdi (`adapter-factory.ts:29`). |
| K8 | Drift spec'i **katlama** (fold) ile yeniden hedeflenir, "testi düzelt" yasak | Uygulanmış migration'ı düzenlemek `prisma migrate deploy` checksum'unu kırar; katlama mekanizması paralel oturumda **tamamlandı ve YEŞİL** (9/9 — §3 A4), bu değişiklik onu INSERT'leri de kapsayacak şekilde **genişletir**, sıfırdan yazmaz. |
| K9 | `DeliveryPlatform` sözleşme-drift muhafızına eklenir | T7: bugün elle aynalanıyor ve hiçbir guard yok; SEMT'i eklerken iki tarafın ayrışması için mükemmel fırsat. |
| K10 | `FOLLOW_UP_SQL` girdileri **ada göre** aranır, indeksle DEĞİL | Dizi büyüyecek (hemen ardından kartlı vardiya bir satır ekliyor) ve damga sırasına göre araya girilecek; `FOLLOW_UP_SQL[1]` bir gün başka bir migration'ı gösterir ve iddialar sessizce yanlış dosyayı doğrular (§7 T2). |

### K5b — ONAYLANDI (2026-08-20): mülkiyet geçişi, `RenewalCycle` temizliği ve uçuş-öncesi kilit KAPSAM İÇİNDE

**Karar (kullanıcı, 2026-08-20):** mülkiyet geçişi (§6.1 adım 3a/3b/3c), açık
`RenewalCycle` temizliği (§6.1 adım 4) ve uçuş-öncesi `checkout_intents` kilidi
(§6.1 adım 0) **kapsam içindedir ve onaylanmıştır**. Uygulayıcı bu ifadelerin
hepsini **koşulsuz** yazar; §6.1, §6.2 ve §6.3 olduğu gibi uygulanır, hiçbir adım
ayrı bir onaya bağlı değildir.

**Onayın gerekçesi (kayda geçirilir):** üründe bugün **SIFIR canlı ödeyen kiracı**
vardır, dolayısıyla bu ifadelerin her biri bugünkü veride **sıfır satır eşler ve
no-op'tur** — ama migration, satın alacak **ilk** kiracı için daha şimdiden doğru
olmak zorundadır ve her ifade korumalı ve tersine çevrilebilir olduğundan, işi
baştan doğru göndermenin **hiçbir maliyeti yoktur**.

Onaylanan asıl karar "üç kod arşivlenir, mevcut sahipler mülkiyetini korur" idi.
Uygulama öncesi doğrulama, **arşivlemenin tek başına bu vaadi tutmadığını**
kanıtladı. Zincir dosya dosya izlendi (§3 A6→A12, §4.2): yıl dönümünde
`renewal-cycle.service.ts` yenileme sepetini **sahip olunan kodlardan** kurar,
`quote.service.ts:81-85` arşivli satırı `addon_not_purchasable` uyarısıyla
**sessizce düşürür**, fatura teslimat kalemi olmadan çıkar, sweeper satırı
`past_due` → 7 gün → `expired` yapar, ve `addon-purchasability.rules.ts:112-120`
grace penceresi boyunca yeni paketin satın alınmasını `ADDON_ALREADY_GRANTED`
ile **bloklar**. Yani müşteri hem erişimi kaybeder hem de yerine geçen ürünü
satın alamaz.

Bu yüzden migration'a **tersine çevrilebilir bir MÜLKİYET GEÇİŞİ** eklenir:
`TenantAddOn.addOnId` yeni paket satırına çevrilir, köken
`pricingMeta.migratedFrom` damgasına yazılır (down'ın tek bilgi kaynağı),
iki-üç eski SKU'yu birden tutan kiracılar tekilleştirilir, ve yeniden
fiyatlamadan sonra 1-kuruş yeniden-teklif toleransını (§3 A12) patlatacak
**açık `RenewalCycle` satırları** ile **uçuştaki `checkout_intents`** temizlenir
/ kilitlenir. `down.sql`, her satırın özgün `addOnId`'sini `migratedFrom`
damgasından geri yazar.

**Yapılmazsa ne olur:** üç eski SKU'nun sahibi olan her kiracı, migration'dan
sonraki ilk yıl dönümünde teslimat entegrasyonunu **sessizce** kaybeder —
faturasında o kalem hiç görünmediği için ödeme yapamaz, grace penceresinde
paketi satın alamaz, ve destek çağrısı ancak erişim kesildikten sonra gelir.
Ek olarak, migration anında uçuşta olan bir ödeme (48 saatlik intent TTL'i)
kart çekildikten sonra provision reddi alır — para alınmış, hizmet verilmemiş
olur ve otomatik iade rayı **yoktur**.

---

## 3. Mevcut durum (doğrulanmış çıpalar)

Aşağıdaki her satır dosya açılarak doğrulandı.

### Katalog & para

| # | Çıpa | Gerçek |
|---|---|---|
| A1 | `backend/src/modules/marketplace/alacarte-catalog.const.ts:364-412` | Üç teslimat satırı `...([...] as const).map(...)` ile **tek paylaşılan literalden** üretiliyor: `priceCents: 249_000` (satır 378), `grants: { "integration.delivery": [vendor], "feature.deliveryIntegration": true }` (satır 382-385), `sortOrder` 20/21/22 (satır 367-369). |
| A2 | `alacarte-catalog.const.ts:759-765` | `RETIRED_ADDON_CODES = ["kds_extra_screen","kds_extra_station","extra_tablet","priority_support","fiscal_efatura"]` — arşivleme deseninin **yaşayan örneği**. |
| A3 | `alacarte-catalog.const.ts:63-86` | Lisans kodu `LICENSE_ADDON_CODE = "license_annual"`, fiyat **490.000 kuruş (₺4.900)** — v3.6.7 yeniden fiyatlama. *(Görev brifingindeki "₺2.990 / 299_000" artık YANLIŞ, bkz. §8 R6.)* |
| A4 | `backend/src/modules/marketplace/alacarte-catalog-migration.spec.ts:42-44, 100-140` | Drift spec'i `FOLLOW_UP_SQL` katlaması yapıyor: `FOLLOW_UP_SQL` (satır 42-44, bugün tek girdi: `20260820120000_reprice_licence_and_stock/migration.sql`), `parseRepricing()` (satır 100-111), `parseArchived()` (satır 113-122), `parsed` (129), `followUps` (131), `reprices` (132-134), `archivedLater` (135), `effective` (137-140). **Suite bugün YEŞİL: `cd backend && npx jest src/modules/marketplace/alacarte-catalog-migration.spec.ts` → 9 passed / 9 total** (bu oturumda çalıştırılarak doğrulandı). Eksik olan tek şey: **INSERT eden takip migration'ı için parser devrede değil** (`parseUpserts` yalnız taban dosyaya uygulanıyor). |
| A5 | `backend/src/modules/marketplace/catalog-validation.spec.ts:256-265` | `expect(delivery.length).toBe(3)` + her satır için `toHaveLength(1)`. Değişiklik bunu kırar. |
| A6 | `backend/src/modules/entitlements/plan-projector.service.ts:244-246, 278` | `tenantAddOn.findMany({ where: { tenantId, status: { in: ["active","past_due"] } }, include: { addOn: true } })` → `ta.addOn.grants`. **Katalog satırının `status`'una hiç bakmıyor.** ⇒ Arşivlemek grant'i kaldırmaz. Karar K5'in ilk yarısı DOĞRU. |
| A7 | `backend/src/modules/marketplace/tenant-marketplace.service.ts:192-202` | `if (addOn.status !== "published") throw` — arşivli satır **satın alınamaz** ("This add-on is no longer available for purchase"). |
| A8 | `backend/src/modules/checkout/quote.service.ts:81-85` | Arşivli satır teklifte `warnings.push({ code: "addon_not_purchasable" }); continue;` — satır **sessizce düşer**, hata yok. |
| A9 | `backend/src/modules/licensing/renewal-cycle.service.ts:59-79, 103-122` | Yenileme sepeti sahip olunan `active`/`past_due` satırlardan kuruluyor ve `quotes.quote(...)`'a veriliyor ⇒ A8 ile birleşince **arşivli ürün yenileme faturasından sessizce düşer**. |
| A10 | `backend/src/modules/checkout/addon-purchasability.rules.ts:112-120` | `isIncludedInEntitlements` true ise `ADDON_ALREADY_GRANTED` ile **checkout'ta bloklanır** (yalnız UI rozeti değil). Eski satırı hâlâ canlı olan kiracı paketi satın **alamaz**. |
| A11 | `backend/src/modules/entitlements/integration-coverage.ts:37-40` | `INTEGRATION_COVERED_BY_FEATURE = { delivery: "deliveryIntegration" }` — A10'un neden tetiklendiğinin sebebi. |
| A12 | `backend/src/modules/checkout/checkout.service.ts:221-243` | Settlement'ta yeniden teklif (`:221-223`); **1 kuruş** toleransı aşan fark → `BadRequestException`, provision REDDEDİLİR (para alınmışken) `:232-243`. Açık `RenewalCycle` satırları **ve** uçuştaki `checkout_intents` için kritik (§6 adım 0 ve adım 4). |
| A13 | `backend/src/modules/checkout/quote.service.ts:316-330` | Fiyatlar KDV **DAHİL** brüt; vergi içeriden türetiliyor (`netCents = gross / (1 + TR_KDV_RATE)`). **Üstüne %20 EKLENMEZ.** |
| A14 | `backend/prisma/seeds/seed-marketplace.ts:56, 992-1030` | `export { ALACARTE_CATALOG as ADDONS }`; seed `RETIRED_ADDON_CODES`'u arşivliyor (992-999) ve kalan her satırı **`const status = "published"`** ile upsert ediyor (1006). |
| A15 | `backend/prisma/schema.prisma:4705-4784, 4786-4851` | `MarketplaceAddOn` → `@@map("marketplace_addons")`, `TenantAddOn` → `@@map("tenant_addons")`, `addOn ... onDelete: Restrict` (4790). `TenantAddOn`'da `(tenantId, addOnId)` **unique YOK**, sadece index'ler (4846-4849). |
| A16 | `backend/prisma/schema.prisma:4942-4974` | `RenewalCycle` → `@@map("renewal_cycles")` (4974), `@@unique([tenantId, anniversaryAt])`, `cartJson`/`quoteJson`/`totalCents` donuk. Üretici: `renewal-scheduler.service.ts:46` (`@Cron("0 6 * * *")`). |
| A17 | `backend/src/modules/checkout/checkout-intent.service.ts:53, 283, 297` | `INTENT_TTL_HOURS = 48` (:53); sepet `cartJson: cart as any` ile **donuyor** (:283); `expiresAt = pricedAt + 48s` (:297). Model: `schema.prisma:5474-5519`, `@@map("checkout_intents")`, statüler `pending \| succeeded \| provisioned \| failed` + `provisionedAt`. ⇒ **Migration anında uçuşta 48 saatlik ödeme niyeti olabilir.** |
| A18 | `backend/src/modules/checkout/checkout.service.ts:170-186, 193, 221-243` | Settlement `intent.cartJson`'ı provision eder (:193), `pricedAt`'i dondurup yeniden teklif alır (:221-223) ve `Math.abs(quote.totalCents - chargedAmountCents) > 1` ise `BadRequestException` atar (:233-243). Donuk `pricedAt` yalnız orantı farkını nötrler; **arşivlenen satırın sepetten düşmesini nötrlemez.** ⇒ A8 + A17 + A18 = kart çekilmiş, provision reddedilmiş. |
| A19 | `backend/src/modules/licensing/anniversary.ts:114-121` | `nextAnniversary()`: `candidate > today ? candidate : anniversaryIn(year + 1)`. ⇒ Yıl dönümü **geldiyse veya geçtiyse bir sonraki yıla atlar**. |
| A20 | `backend/src/modules/licensing/renewal-scheduler.service.ts:46-77, 144-153` | `renewal-generate` (`@Cron("0 6 * * *")`) yalnız `anniversary <= now + RENEWAL_LEAD_DAYS` (=30, `renewal-cycle.service.ts:11`) olanlar için `generate()` çağırır; `generate()` var olan döngüyü bulursa erken döner (`renewal-cycle.service.ts:54-57`). `lapseUnpaidCycles` (`@Cron("30 0 * * *")`) `{status:'open', graceEndsAt: {lte: now}}` satırlarını arar ve **bayat `TenantAddOn` satırlarını `expired` yapan tek yer budur**. ⇒ **Yıl dönümü geçmiş bir `open` döngüyü SİLMEK hem faturayı hem de tek expiry tetikleyicisini yok eder.** |
| A21 | `backend/prisma/schema.prisma:4813-4816` + `plan-projector.service.ts:295-299` | `TenantAddOn.currentPeriodEnd` ödenmiş-tarih; projektör `validUntil = currentPeriodEnd + ADDON_GRACE_DAYS`. ⇒ Dedupe'ta **hayatta kalacak satır en uzağa ödenmiş olandır**, en eski aktive edilen değil. |
| A22 | `backend/src/modules/licensing/renewal-cycle.service.ts:103-122` | `renewableItems` her `active`/`past_due`, `cancelAtPeriodEnd:false`, `billing:'annual'` satırı sepete koyar. `TenantAddOn`'da `(tenantId, addOnId)` unique **YOK** (A15) ⇒ aynı koddan iki satır **iki kez faturalanır**. |

### Teslimat platformu sözlüğü

| # | Çıpa | Gerçek |
|---|---|---|
| B1 | `backend/src/modules/delivery-platforms/constants/platform.enum.ts:1-6` | `export enum DeliveryPlatform { YEMEKSEPETI, GETIR, TRENDYOL, MIGROS }` — value===name. |
| B2 | `backend/prisma/schema.prisma:3032, 3099, 3141` | **Prisma enum YOK.** `platform String // YEMEKSEPETI, GETIR, TRENDYOL, MIGROS` üç modelde (`DeliveryPlatformConfig`, `DeliveryPlatformLog`, ve 3141'deki `MenuItemMapping`). Hiçbir CHECK constraint yok (`grep` ile migration'larda doğrulandı). ⇒ **Semt için şema migration'ı GEREKMEZ.** |
| B3 | `backend/src/modules/delivery-platforms/adapters/adapter-factory.ts:18-31` | `getAdapter(platform: string)`; `default: throw new Error(...)` — tiplenmemiş, 500 üretir. |
| B4 | `getAdapter` çağrı yerleri (11 adet, spec'ler hariç) | `schedulers/order-polling.scheduler.ts:102`, `schedulers/retry.scheduler.ts:146`, `services/delivery-status-sync.service.ts:67`, `services/delivery-auth.service.ts:29`, `services/delivery-menu-sync.service.ts:49,151`, `services/delivery-config.service.ts:130,347,356`, `services/delivery-order.service.ts:310,1073`, `services/delivery-moderation.service.ts:323`, `controllers/delivery-webhook.controller.ts:74,223,439`, `services/delivery-test.service.ts:98`. |
| B5 | `backend/src/modules/delivery-platforms/dto/create-platform-config.dto.ts:15-17` | `@ApiProperty({ enum: DeliveryPlatform }) @IsEnum(DeliveryPlatform) platform` — enum'a SEMT eklenince **anında kabul eder**. |
| B6 | `backend/src/modules/delivery-platforms/services/delivery-test.service.ts:66-71` | `Object.values(DeliveryPlatform).includes(platform)` — aynı sorun. |
| B7 | `backend/src/modules/delivery-platforms/controllers/delivery-webhook.controller.ts` | Webhook rotaları **platform bazında sabit yol** (`yemeksepeti/...` :50, `trendyol/...` :201); genel `:platform` rotası yok. Semt için yeni yol açılmaz. |
| B8 | `backend/src/modules/delivery-platforms/constants/platform.enum.spec.ts:22-26` | `expect(Object.values(DeliveryPlatform)).toEqual(expect.arrayContaining([...4 platform]))` — `arrayContaining` olduğu için SEMT eklemek bunu KIRMAZ. |
| B9 | `frontend/src/types/index.ts:692-697` | Elle aynalanmış `export enum DeliveryPlatform { ... }` — **hiçbir drift guard'ı yok** (T7: `scripts/check-contract-drift.mjs:48-81` yalnız UserRole, HARD_RESTRICTED_ROLES, OrderStatus, OrderType, PaymentStatus). |
| B10 | `frontend/src/pages/settings/DeliveryPlatformsSettingsPage.tsx:10, 64-70` | `const ALL_PLATFORMS = ['GETIR','YEMEKSEPETI','TRENDYOL','MIGROS']` → `PlatformCard` map'i. |
| B11 | `frontend/src/pages/settings/DeliveryPlatformsSettingsPage.test.tsx:48` | `expect(platforms).toEqual(['GETIR','YEMEKSEPETI','TRENDYOL','MIGROS'])` — sıralı eşitlik, kırılacak. |
| B12 | `frontend/src/components/delivery-platforms/PlatformCard.tsx:32-37, 46, 71-93, 105` | `REQUIRED_CREDENTIALS`, `PLATFORMS_WITH_REAL_SANDBOX`, `PLATFORM_INFO` haritaları; **satır 105 `const info = PLATFORM_INFO[platform]`** — SEMT girdisi olmazsa `info.bgColor` TypeError. |
| B13 | `frontend/src/components/delivery-platforms/platformDisplay.ts:17-38, 40-49` | `PLATFORM_DISPLAY` + `getPlatformDisplay` — bilinmeyen kaynak için slate fallback'i **var**, yani KDS/POS rozeti Semt'te patlamaz. |
| B14 | `frontend/src/components/delivery-platforms/PlatformCredentialsForm.tsx:14-42` | `PLATFORM_FIELDS: Record<string, CredentialField[]>` — SEMT'te alan tanımı olmayacak (kart genişlemeyeceği için çağrılmaz). |
| B15 | 5 locale × `frontend/src/i18n/locales/<loc>/settings.json` | `onlineOrders.platformDescriptions` altında tam olarak `GETIR, MIGROS, TRENDYOL, YEMEKSEPETI` anahtarları var (beşinde de aynı). |
| B16 | `backend/prisma/seed-demo.ts:1711-1718` | `const platforms = ["YEMEKSEPETI","GETIR","TRENDYOL","MIGROS"]` — demo config üretiyor. **SEMT eklenmeyecek** (adaptör yok). |
| B17 | `backend/src/modules/delivery-platforms/adapters/adapter-factory.spec.ts:49-59` | İki **mevcut** test: `"throws for an unknown platform"` → `"Unknown delivery platform: DOORDASH"` ve `"throws for an empty platform string"` → `"Unknown delivery platform: "`. ⇒ Erişilebilirlik kapısı **koşulsuz** yazılırsa (`!isPlatformAvailable(x)`) `undefined !== "available"` olduğu için ikisi de **KIRILIR**. Kapı yalnız `PLATFORM_AVAILABILITY`'de **tanımlı** platformları kapsamalı (§4.3 katman 2). |
| B18 | `frontend/src/components/pos/PendingOrdersPanel.tsx:25, 175-190` | `const PLATFORM_FILTERS = ['ALL', ...Object.keys(PLATFORM_DISPLAY)]` → her girdi için bir filtre çipi. ⇒ `PLATFORM_DISPLAY`'e SEMT eklemek POS teslimat gelen-kutusuna **hiç sipariş üretemeyecek ölü bir çip** düşürür (F4b). |
| B19 | `frontend/src/App.tsx:807-812` + `frontend/src/features/store/StoreHubPage.tsx` | Mağaza rotası `/admin/store` → `StoreHubPage` → **`features/licensing/CatalogStore.tsx`**. `/admin/marketplace` → `/admin/store?tab=catalog` redirect. `grep -rn MarketplacePage frontend/src` yalnız kendi dosyasını ve kendi testini buluyor: **`features/marketplace/MarketplacePage.tsx` HİÇBİR ROTAYA BAĞLI DEĞİL.** ⇒ Semt kartı oraya konursa müşteri onu asla göremez. |
| B20 | `frontend/src/features/licensing/CatalogStore.tsx:15-22, 185-187, 205-211` | `KIND_ORDER = ['license','module','integration','capacity','credit','service']`; `grouped.size === 0` iken **erken dönüş** `store.empty` metniyle (185-187); bölümler `KIND_ORDER.filter((k) => grouped.has(k)).map((kind) => …)` ile basılıyor (205-211). ⇒ Semt kartı hem `integration` bölümünün başına hem de **boş-katalog erken dönüşüne** konmalı. |
| B21 | `frontend/src/App.tsx:736-737` | Online-sipariş `FeatureGate` fallback'inde satır içi yorum: "Üç platform modülünden herhangi biri bu ekranı açar; fiyat/isim en ucuz teklife göre çözülür." — tek pakete geçince **yanlış** olur. |

### Entitlement sözlüğü

| # | Çıpa | Gerçek |
|---|---|---|
| C1 | `backend/src/modules/entitlements/entitlement-keys.const.ts:50-51, 83` | `FEATURE_KEYS`'te `deliveryIntegration`, `INTEGRATION_KEYS`'te `delivery` **zaten var**. ⇒ **T4 (14 noktalı feature-flag senkronu) bu değişiklikte UYGULANMAZ**; yeni anahtar eklenmiyor. |

### Fiyat reklamı yüzeyleri (drift testi YOK)

| # | Çıpa | Gerçek |
|---|---|---|
| E1 | `developer/pages/tr/developer/marketplace-api.mdx:141-143` · `developer/pages/en/developer/marketplace-api.mdx:142-144` | Üç `delivery_*` satırı hâlâ `₺2.490 (249000)`. Bu iki dosya çalışma ağacında zaten `M` (paralel v3.6.7 işi `priority_support`/`fiscal_efatura` satırlarını "v3.6.7 arşivlendi" yaptı) ⇒ **canlı, aktif bakımı yapılan yüzey**. |
| E2 | `developer/pages/tr/reference/plan-matrix.mdx:108-110` · `developer/pages/en/reference/plan-matrix.mdx:109-111` + hemen ardından gelen `<Callout type="info">` | Üç satır `₺2.490/yıl`; Callout: "Üç `delivery_*` ürünü aynı `integration.delivery` anahtarına yazar…" / "All three `delivery_*` products write to the same `integration.delivery` key…" ⇒ tek pakette **olgusal olarak yanlış**. |
| E3 | `help/pages/{tr,en}/…` — 18 yüzey | Doğrulanan satırlar §5 D7'de tek tek listelendi. İki dosya ayrıca **paket toplamı** taşıyor: `tr/plans/choosing-and-upgrading.mdx:54` `₺9.460` ve `en/plans/choosing-and-upgrading.mdx:53` `₺9,460` (Lisans + Yemeksepeti + Getir + Çağrı-ID) ⇒ tek pakette `4.900 + 2.499 + 1.490 = ₺8.889`. |
| E4 | `frontend/src/marketing/data/moduleContent.generated.ts:1147, 1153-1154, 1156, 1215` | Dört "her platform ayrı satılır" iddiası + Migros hiç anılmıyor. Dosya başlığı (satır 1-2): `// AUTO-GENERATED … Do not edit by hand — regenerate.` `moduleContent.test.ts` 17 modülün tamamını render ediyor. |
| E5 | `presentation/HummyTummy_Presentation_TR.md:575-577, 643-644, 646` · `presentation/HummyTummy_Presentation_EN.md:576-578, 640-642, 704, 707, 827` | Yalnız **teslimat** rakamları bayat. Lisans rakamı **her iki dosyada da zaten ₺4.900** (TR:557,630,642… · EN:558,627,638…) ⇒ lisansa dokunulmayacak. Değişen satırların bağlı olduğu **toplamlar** da düzeltilir: TR:646 `12.360₺` → `9.879₺`; EN:642 `₺15.070` → `₺12.589`. |
| E6 | `docs/SISTEM_TANITIMI.md:90` · `docs/PAZARLAMACI_REHBERI.md:84-86, 91` | SISTEM_TANITIMI tablosunun geri kalanı v3.6.7 ile **zaten güncel** (`:82` Bakım/Destek ₺4.900, `:84` Stok ₺3.900, ayrı öncelikli-destek / e-Fatura satırı **yok**). Bayat olan tek satır `:90`. PAZARLAMACI'da üç satır `:84-86`, "Teslimat entegrasyonları birikir…" cümlesi `:91`. |

---

## 4. Tasarım

### 4.1 Katalog satırı (tek gerçek kaynak)

`backend/src/modules/marketplace/alacarte-catalog.const.ts` içinde satır 364-412
arası `...(...).map(...)` bloğu **tamamen silinir**, yerine tek nesne konur:

```ts
  // ----------------------------------------------------------- INTEGRATIONS
  {
    code: "delivery_platforms",
    name: "Paket Servis Entegrasyonları",
    description:
      "Yemeksepeti, Getir, Trendyol Yemek ve Migros Yemek siparişlerinin otomatik olarak POS ve mutfağa düşmesi.",
    kind: "integration",
    billing: "annual",
    // Platform başına ₺2.490 satmak kurguydu: teslimat kapısı alan-geneli
    // (@RequiresIntegration("delivery"), sağlayıcı taşımıyor), yani tek
    // platform alan zaten dördünü de kullanabiliyordu. Tek paket dürüst olanı.
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
    i18n: t(/* 5 locale — §5 T4 */),
  },
```

`RETIRED_ADDON_CODES` (satır 759-765) üç kodla genişler ve gerekçe yorumu eklenir.

### 4.2 Sahiplik geçişi (mimarinin göbeği)

Arşivleme **tek başına yetersizdir**. Zincir:

```
katalog satırı archived
        │
        ├── projektör  → grant devam eder            (A6)  ✅ döngü ortası güvenli
        │
        └── yıl dönümü → RenewalCycleService.generate (A9)
                          → QuoteService satırı düşürür (A8, "addon_not_purchasable")
                          → yenileme faturası teslimat satırını İÇERMEZ
                          → sweeper: active → past_due → 7 gün → expired
                          → projektör grant'i geri alır
                          → müşteri teslimatı KAYBEDER
                          → paketi satın alamaz da:      (A10) ADDON_ALREADY_GRANTED
                             (grace bitene kadar bloklu; bittikten sonra
                              tam fiyat + erişim boşluğu)
```

Bu yüzden migration mülkiyeti **taşır** (§2 K5b — ONAYLANDI; aşağıdaki 0/1/2/3/4
adımlarının hepsi koşulsuz yazılır):

0. **Uçuş-öncesi kilit.** Eski kodlardan birini taşıyan, **ödenip henüz
   provision edilmemiş veya hâlâ ödenebilir** bir `checkout_intents` satırı
   varsa migration `RAISE EXCEPTION` ile **çalışmayı reddeder**. Sepet intent
   anında donuyor (A17) ve settlement katalogu yeniden okuyor (A18): arşivli
   satır sepetten düşer, 1-kuruş toleransı patlar, **kart çekilmişken provision
   reddedilir** ve otomatik iade rayı yoktur. Intent TTL'i 48 saat olduğundan
   deploy penceresi buna göre seçilir (§8 R15).
1. Her `active`/`past_due` `tenant_addons` satırına, taşımadan **önce**,
   `pricingMeta.migratedFrom = <eski kod>` damgalanır (down'ın geri dönebilmesi
   için tek bilgi kaynağı — `addOnId` üzerine yazılınca eski kod kaybolur).
2. Bir kiracı birden fazla teslimat satırı tutuyorsa, **en uzağa ödenmiş olan**
   (`currentPeriodEnd DESC NULLS LAST, activatedAt ASC, id ASC`) hariç diğerleri
   `cancelled` yapılır. Sıralama kritiği A21'dir: projektör `validUntil`'i
   `currentPeriodEnd`'den türetir, dolayısıyla "en eski satır kalsın" demek
   Getir'i altı ay sonra alan kiracının **ödediği günleri yakmak** demektir.
   Kapatılan satırın `status`/`cancelledAt`/`endedAt` **önceki değerleri**
   `pricingMeta.migratedPriorStatus` / `migratedPriorCancelledAt` /
   `migratedPriorEndedAt` olarak damgalanır — down bunları `NULL`'lamaz,
   **geri yazar**.
3. Hayatta kalan satırın `addOnId`'si `delivery_platforms`'a çevrilir.
   Böylece yenileme sepeti yayımlanmış bir kod görür, fatura eksilmez.
   Taşıma, kiracıda **zaten bir paket satırı varsa** yapılmaz (`NOT EXISTS`
   koruması): `TenantAddOn`'da `(tenantId, addOnId)` unique yoktur (A15) ve
   `renewableItems` iki satırı **iki kez faturalar** (A22). Bu durum kısmi
   rollback / yeniden çalıştırmada gerçekten oluşur — §6.3 adım 7 kanıtlar.
4. Eski kodları referanslayan **açık, ödenmemiş ve yıl dönümü HENÜZ GELMEMİŞ**
   `RenewalCycle` satırları silinir; `renewal-generate` cron'u (06:00 UTC) paket
   satırıyla yeniden üretir. Silinmezse A12 devreye girer: müşteri donuk
   `totalCents`'i öder, yeniden teklif daha düşük çıkar, 1-kuruş toleransı aşılır
   ve **para alındıktan sonra provision reddedilir**.

   ⚠️ **Yıl dönümü GELMİŞ veya GEÇMİŞ açık döngülere DOKUNULMAZ.** `nextAnniversary()`
   bugün ≥ yıl dönümü olduğunda **bir sonraki yıla atlar** (A19), yani 06:00 cron'u
   o döngüyü **asla yeniden üretmez**. Silinirse (a) kiracı o yenileme için hiç
   faturalanmaz ve (b) `lapseUnpaidCycles` tetiklenmez, bayat `TenantAddOn`
   satırları hiç `expired` olmaz ve kiracı ödediği her yetkiyi **süresiz bedava**
   kullanmaya devam eder (A20). Bu satırlar operatör tarafından **elle** mutabık
   kılınır; §6.3 adım 0b onları listeler, §8 R16 prosedürü tarif eder.

Projektör kaynağı `addon:<code>:<id>`'den `addon:delivery_platforms:<id>`'ye
kayar; gece 03:15 reconcile (`plan-projector.service.ts` `@Cron("15 3 * * *")`)
bayat kaynağı süpürür, ayrıca migration sonrası elle
`POST /superadmin/entitlements/reproject` gerekmez.

### 4.3 Semt sözlüğü ve fail-closed kapı

`backend/src/modules/delivery-platforms/constants/platform.enum.ts`:

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
 * Bir platformun ÇALIŞAN adaptörü var mı. `coming_soon` olan her platform
 * her yazma/çalıştırma yolunda REDDEDİLİR: enum'da olmak "vitrine çıkar"
 * demektir, "config açılabilir" demek değildir.
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

export function isPlatformAvailable(platform: string): boolean {
  return (
    PLATFORM_AVAILABILITY[platform as DeliveryPlatform] === "available"
  );
}
```

> `isPlatformAvailable` **bilinmeyen** bir dize için de `false` döner
> (`undefined !== "available"`). Bu bilinçlidir ama çağıranın onu "yakında" ile
> karıştırmaması gerekir: fabrika kapısı bu yüzden `platform in
> PLATFORM_AVAILABILITY` ile daraltılır (B17).

**Kapatma noktaları (fail-closed, üç katman):**

| Katman | Dosya | Davranış |
|---|---|---|
| 1. DTO | `dto/create-platform-config.dto.ts:15-17` | `@IsEnum(DeliveryPlatform)` → `@IsIn(AVAILABLE_DELIVERY_PLATFORMS)`, `@ApiProperty({ enum: AVAILABLE_DELIVERY_PLATFORMS })`. `POST /delivery-platforms/configs` SEMT'i **400** ile reddeder ⇒ SEMT config satırı hiç oluşamaz. |
| 2. Fabrika | `adapters/adapter-factory.ts:18` | `switch`'ten ÖNCE, **yalnız SÖZLÜKTE TANIMLI ama hazır olmayan** platform için: `if (platform in PLATFORM_AVAILABILITY && !isPlatformAvailable(platform)) throw new ServiceUnavailableException(\`Delivery platform ${platform} is not available yet\`);` — B4'teki 11 çağrı yerinin tamamı tek noktadan kapanır ve 500 yerine **503** döner. `default: throw new Error("Unknown delivery platform: …")` aynen kalır (bilinmeyen değer ≠ yakında). **`platform in PLATFORM_AVAILABILITY` şartı zorunludur:** koşulsuz yazılırsa `isPlatformAvailable("DOORDASH")` ve `isPlatformAvailable("")` de `false` döner ve B17'deki iki mevcut test kırılır. |
| 3. Simülatör | `services/delivery-test.service.ts:66-71` | `Object.values(DeliveryPlatform)` → `AVAILABLE_DELIVERY_PLATFORMS`; mesaj `Unknown delivery platform` olarak kalır. |

`update-platform-config.dto.ts` platformu gövdeden almıyor (yol parametresi),
ek değişiklik gerekmez. `GET /delivery-platforms/configs/SEMT` zaten
`NotFoundException` verir (config satırı hiç yok).

> **T8 notu:** `main.ts` `ValidationPipe({ whitelist: true })` — DTO'ya
> tanımlanmamış alan sessizce silinir. Bu değişiklik hiçbir DTO alanı EKLEMİYOR;
> `availability` istemciye **hesaplanmış** olarak gitmez, frontend kendi
> aynasından okur (§4.4).

### 4.4 Frontend

`frontend/src/types/index.ts:692-697` enum'a `SEMT = 'SEMT'` eklenir ve hemen
altına aynalanmış harita:

```ts
export type PlatformAvailability = 'available' | 'coming_soon';

// Backend aynası: backend/src/modules/delivery-platforms/constants/platform.enum.ts
// Drift muhafızı: scripts/check-contract-drift.mjs → "DeliveryPlatform"
export const PLATFORM_AVAILABILITY: Record<string, PlatformAvailability> = {
  YEMEKSEPETI: 'available',
  GETIR: 'available',
  TRENDYOL: 'available',
  MIGROS: 'available',
  SEMT: 'coming_soon',
};
```

**Ayarlar sayfası** (`DeliveryPlatformsSettingsPage.tsx:10`):
`ALL_PLATFORMS = ['GETIR','YEMEKSEPETI','TRENDYOL','MIGROS','SEMT']` (SEMT en
sonda; B11 testinde sıralı eşitlik var, sıra kararlaştırılmıştır).

**PlatformCard** (`PlatformCard.tsx`):
- `PLATFORM_INFO`'ya `SEMT: { name: 'Semt', platform: 'SEMT', color: 'text-sky-700', bgColor: 'bg-sky-50' }` (B12 TypeError'ı önler).
- `REQUIRED_CREDENTIALS`/`PLATFORMS_WITH_REAL_SANDBOX`'a **eklenmez**.
- Bileşenin başında: `const comingSoon = PLATFORM_AVAILABILITY[platform] === 'coming_soon';`
- `comingSoon` iken: başlığın yanında `<Badge variant="default">{t('onlineOrders.availability.comingSoon')}</Badge>`,
  aç/kapat toggle'ı `disabled` + `aria-disabled`, kartın tıklanıp genişlemesi kapalı
  (`onClick` no-op), `data-availability="coming_soon"` özniteliği (test çıpası),
  açıklama satırı `onlineOrders.platformDescriptions.SEMT`.
- `handleToggleEnabled`/`handleSave`/`handleTestConnection` en başta
  `if (comingSoon) return;` ile korunur (buton devre dışıyken bile programatik
  çağrıya karşı).

**Mağaza** — doğru dosya **`frontend/src/features/licensing/CatalogStore.tsx`**'tir.
`features/marketplace/MarketplacePage.tsx` **hiçbir rotaya bağlı değildir** (B19):
`/admin/store` → `StoreHubPage` → `CatalogStore`, `/admin/marketplace` ise
`/admin/store?tab=catalog`'a yönlenir. Kart oraya konursa müşteri asla göremez.

`CatalogStore.tsx` içinde yerel bir `SemtComingSoonRow` bileşeni tanımlanır ve
**iki yerde** render edilir:

1. `KIND_ORDER.filter((k) => grouped.has(k)).map((kind) => …)` bloğunda
   (satır 205-211), `kind === 'integration'` iken bölümün `<ul>`'unun **ilk
   `<li>`'si** olarak.
2. `grouped.size === 0` **erken dönüşünde** (satır 185-187) — katalog boşken
   `store.empty` metninin yanında. Bu ikinci yer olmadan, filtrelenmiş katalog
   boş olan bir kiracı kartı hiç görmez.

Kart statik ve satın alınamazdır: başlık `t('licensing:store.semt.title')`,
açıklama `t('licensing:store.semt.description')`, rozet
`t('licensing:store.semt.badge')`, `data-testid="semt-coming-soon"`,
**buton yok**. (Namespace seçimi zorunlu: `CatalogStore.tsx:46`
`useTranslation(['licensing', 'common'])` çağırıyor ve mevcut anahtarları
`licensing:store.*` altında tutuyor.) `useCatalogPricing`/`useListAddOns` yanıtından beslenmez,
API'ye dokunmaz — katalog satırı olmadığı için doğru olan budur.

**POS teslimat gelen-kutusu** (`frontend/src/components/pos/PendingOrdersPanel.tsx:25`):
`PLATFORM_FILTERS` `Object.keys(PLATFORM_DISPLAY)`'den türediği için `coming_soon`
platformlar **elenir** — aksi halde hiç sipariş üretemeyecek ölü bir "Semt" çipi
düşer (B18).

### 4.5 Para akışı (değişmeyen ray)

SPA → `POST /v1/checkout/intent` → `QuoteService` (yetkili fiyat) → `CheckoutIntent`
(donuk sepet + `pricedAt` + `amountCents`) → PayTR → callback →
`CheckoutService.confirmAndProvision` (Serializable tx, 1 kuruş tolerans).
**Bu ray değişmez.** Değişen tek şey katalogdaki satır kümesidir:
₺2.499 brüt (KDV dahil), yıl dönümüne gün-bazlı orantılanır
(`quote.service.ts:88-92` `licensing.price(...)`), vergi içeriden türetilir (A13).

---

## 5. Değişecek dosyalar (sıralı, bağımlılık-doğru)

> Sıra bağlayıcıdır: sabit → migration → drift spec → tüketiciler → UI → i18n → docs.
> `YENİ` işaretli olanlar dışında her yol açılıp doğrulandı.

### Backend — sabitler ve veri

- [ ] **B1.** `backend/src/modules/marketplace/alacarte-catalog.const.ts`
      — satır 364-412 map bloğu → tek `delivery_platforms` nesnesi (§4.1);
      `RETIRED_ADDON_CODES` (759-765) üç kodla genişler.
- [ ] **B2.** `backend/prisma/migrations/20260820130000_delivery_platforms_bundle/migration.sql` **YENİ** (§6)
- [ ] **B3.** `backend/prisma/migrations/20260820130000_delivery_platforms_bundle/down.sql` **YENİ** (§6)
- [ ] **B4.** `backend/src/modules/marketplace/alacarte-catalog-migration.spec.ts`
      — `FOLLOW_UP_SQL`'e (satır 42-44) yeni migration **timestamp sırasına
      GÖRE EKLENİR** (append değil, insert: dizi her zaman migration klasör
      damgasına göre sıralı kalmalı, çünkü katlamada sonraki satır öncekini ezer);
      katlamaya `parseUpserts` ile INSERT desteği; `introduced` hesabı taban
      dosyanın `parsed` çıktısına sabitlenir (§7 T2).
      ⚠️ **Ortak dosya:** kartlı-vardiya PR'ı bu dosyaya
      `20260820160000_card_shift_catalog/migration.sql` satırını ekleyecek.
      Mekanizmanın sahibi **bu PR**'dır; kartlı vardiya yalnız `FOLLOW_UP_SQL`'e
      damga sırasına göre bir satır ekler, `effective`/`introduced` hesabını
      yeniden yazmaz (§8 R14). **3D baskı PR'ı bu dosyaya HİÇ dokunmaz**:
      satırları `hardware_products`'a gidiyor, `marketplace_addons`'a değil;
      kendi ayrı tripwire'ını (`print3d-catalog-migration.spec.ts`) getiriyor.
- [ ] **B5.** `backend/src/modules/marketplace/catalog-validation.spec.ts:256-265`
      — teslimat invaryantı yeniden yazılır (§7 T1).
      ⚠️ **Ortak dosya:** kartlı-vardiya PR'ı aynı dosyaya iki yeni `it()` bloğu
      ekliyor. `delivery_*` invaryantının sahibi **bu PR**'dır; kartlı vardiya
      `delivery_` önekli hiçbir kod eklemediği için o testin şekline dokunmaz.
      İkinci merge olan taraf birleştirmeden önce diğerinin halini okur.
- [ ] **B6.** `backend/prisma/seeds/seed-marketplace.ts` — **kod değişikliği yok**;
      `ALACARTE_CATALOG` + `RETIRED_ADDON_CODES` üzerinden otomatik doğru davranır
      (992-999 arşivler, 1001-1027 paketi published olarak upsert eder). Yalnızca
      992'deki yorum "device-capacity" ifadesinden arındırılıp güncellenir.

### Backend — teslimat platformu sözlüğü

- [ ] **B7.** `backend/src/modules/delivery-platforms/constants/platform.enum.ts`
      — `SEMT`, `PlatformAvailability`, `PLATFORM_AVAILABILITY`,
      `AVAILABLE_DELIVERY_PLATFORMS`, `isPlatformAvailable` (§4.3).
- [ ] **B8.** `backend/src/modules/delivery-platforms/adapters/adapter-factory.ts`
      — `getAdapter` başına erişilebilirlik kapısı: `if (platform in PLATFORM_AVAILABILITY && !isPlatformAvailable(platform)) throw new ServiceUnavailableException(...)`.
- [ ] **B8b.** `backend/src/modules/delivery-platforms/adapters/adapter-factory.spec.ts`
      — mevcut `:49-59` iki testi (`"throws for an unknown platform"` →
      `"Unknown delivery platform: DOORDASH"`, `"throws for an empty platform string"`)
      **DEĞİŞMEDEN** geçmeli. Kapı yalnız `PLATFORM_AVAILABILITY`'de tanımlı ama
      `coming_soon` olan platformu 503'ler; bilinmeyen dize hâlâ `default`
      dalındaki çıplak `Error`'a düşer (B17). Dosyaya §7 T4'teki iki test eklenir.
- [ ] **B9.** `backend/src/modules/delivery-platforms/dto/create-platform-config.dto.ts:15-17`
      — `@IsEnum(DeliveryPlatform)` → `@IsIn(AVAILABLE_DELIVERY_PLATFORMS)`.
- [ ] **B10.** `backend/src/modules/delivery-platforms/services/delivery-test.service.ts:66-71`
      — `AVAILABLE_DELIVERY_PLATFORMS` ile doğrulama.
- [ ] **B11.** `backend/prisma/schema.prisma:3032, 3099, 3141` — üç yorumu
      `// YEMEKSEPETI, GETIR, TRENDYOL, MIGROS, SEMT (SEMT: coming_soon, config yazılamaz)`
      yap. **Şema değişikliği değil, migration gerektirmez** (B2 çıpası).

### Backend — dokümantasyon (kod içi)

- [ ] **B12.** `backend/src/modules/entitlements/integration-coverage.ts:11-12`
      — üç kod adı geçen yorum `delivery_platforms` olarak güncellenir.
- [ ] **B13.** `backend/src/modules/delivery-platforms/controllers/delivery-platforms.controller.ts:29-35`
      — DEF-3 yorumundaki üç kod `delivery_platforms` olur (kapı davranışı aynı).
- [ ] **B14.** `backend/SUBSCRIPTION_SYSTEM.md:104` — `integration` satırı:
      üç kod → `delivery_platforms`; `priority_support`/`fiscal_efatura` da
      artık arşivli (paralel v3.6.7 işiyle uyumlu hale getir).
- [ ] **B15.** `docs/api/hummytummy-v1.md:157-158` — örnek grant JSON'u
      dört sağlayıcılı `delivery_platforms` olur.

### Frontend

- [ ] **F1.** `frontend/src/types/index.ts:692-697` — `SEMT` + `PLATFORM_AVAILABILITY` (§4.4);
      satır 674'teki `source?:` yorumu da güncellenir.
- [ ] **F2.** `frontend/src/pages/settings/DeliveryPlatformsSettingsPage.tsx:10` — `ALL_PLATFORMS`.
- [ ] **F2b.** `frontend/src/App.tsx:736-737` — satır içi yorum
      `/* Tek `delivery_platforms` paketi bu ekranı açar; fiyat/isim tek satırdan
      çözülür. */` olarak güncellenir (B21).
- [ ] **F3.** `frontend/src/components/delivery-platforms/PlatformCard.tsx`
      — `PLATFORM_INFO.SEMT`, `comingSoon` dalı, guard'lar, `data-availability`.
- [ ] **F4.** `frontend/src/components/delivery-platforms/platformDisplay.ts:17-38`
      — `SEMT: { label: 'Semt', className: 'bg-sky-100 text-sky-700 ring-1 ring-sky-200', kioskClassName: 'bg-sky-500/20 text-sky-200 ring-1 ring-sky-500/40' }`
      (fallback zaten var ama marka rengi kararlaştırıldı).
- [ ] **F4b.** `frontend/src/components/pos/PendingOrdersPanel.tsx:25` —
      `PLATFORM_FILTERS` `coming_soon` platformları eler:
      `['ALL', ...Object.keys(PLATFORM_DISPLAY).filter((p) => PLATFORM_AVAILABILITY[p] !== 'coming_soon')]`.
      F4 olmadan da gerekli değildir, ama F4 uygulandığı an zorunludur: aksi
      halde POS teslimat gelen-kutusuna hiç sipariş üretemeyecek **ölü bir
      "Semt" filtre çipi** düşer (B18).
- [ ] **F5.** `frontend/src/features/licensing/CatalogStore.tsx` — Semt bilgi
      kartı (§4.4): yerel `SemtComingSoonRow`, `integration` bölümünün ilk
      `<li>`'si (satır 205-211 bloğu, `kind === 'integration'` koşuluyla) **ve**
      `grouped.size === 0` erken dönüşü (satır 185-187).
      ⚠️ `features/marketplace/MarketplacePage.tsx` **kullanılmaz** — rotaya bağlı
      değil (B19).
- [ ] **F6.** `frontend/src/marketing/data/faq.ts:32` — "katalogda Yemeksepeti, Getir
      ve Trendyol Yemek ayrı ayrı satılır, Migros Yemek ise ayrı bir ürün olarak
      satılmaz" cümlesi **artık YANLIŞ**: tek paket + Semt yakında metniyle değişir.
- [ ] **F7.** `frontend/src/marketing/data/integrations.ts:42-68` — dört markanın
      `note`'ları "Tek pakette dört platform" olur; 61-64'teki Migros yorumu
      güncellenir; `brands`'e `{ name: 'Semt', status: 'yakinda', note: 'Entegrasyon yakında — ücretsiz' }`
      eklenir (`IntegrationStatus = "entegre" | "yakinda"`, satır 17 — union değişmez).
- [ ] **F8.** `frontend/src/marketing/data/modules.ts:253` ve
      `frontend/src/pages/LandingPage.tsx:89` — "Yemeksepeti/Getir/Trendyol/Migros
      tek panelde" satırlarına Semt "yakında" ibaresi.
- [ ] **F8b.** `frontend/src/marketing/data/moduleContent.generated.ts:1147,
      1153-1154, 1156, 1215` — dört "her platform ayrı satılır" iddiası tek pakete
      çevrilir ve Migros dört sağlayıcıya eklenir (`:1153` başlığı "Üç teslimat
      platformu…" → "Dört teslimat platformu, tek paket, tek sipariş paneli").
      Dosya başlığı (satır 1-2) "AUTO-GENERATED … regenerate" diyor; deep-dive
      workflow'unu yeniden koşturmak **kapsam dışıdır**, bu PR'da **ELLE**
      düzeltilir ve başlığa `// v3.6.8: teslimat paketi satırları elle düzeltildi
      (regenerate ederken koru).` notu eklenir. `moduleContent.test.ts` 17 modülü
      render ettiği için değişiklikten sonra o suite koşulur (E4).
- [ ] **F9.** `scripts/check-contract-drift.mjs:48-81` — `CHECKS`'e yeni giriş
      (T7'yi bu değişiklik için kapatır):
      ```js
      const BACKEND_DELIVERY =
        "backend/src/modules/delivery-platforms/constants/platform.enum.ts";
      // ...
      {
        name: "DeliveryPlatform",
        backend: () =>
          enumValues(read(BACKEND_DELIVERY), "DeliveryPlatform", BACKEND_DELIVERY),
        frontend: () =>
          enumValues(read(FRONTEND_TYPES), "DeliveryPlatform", FRONTEND_TYPES),
      },
      ```
      (`enumValues` `export enum X { A = "A" }` şeklini okur — iki taraf da bu şekilde.)

### i18n (BEŞ locale, istisnasız)

- [ ] **T1.** `frontend/src/i18n/locales/{tr,en,ru,ar,uz}/settings.json`
      → `onlineOrders.platformDescriptions.SEMT`:
      - tr: `"Semt siparişleri POS ve mutfağa düşecek. Entegrasyon yakında."`
      - en: `"Semt orders will flow into the POS and the kitchen. Integration coming soon."`
      - ru: `"Заказы Semt будут поступать в POS и на кухню. Интеграция скоро."`
      - ar: `"ستصل طلبات Semt إلى نقطة البيع والمطبخ. التكامل قريبًا."`
      - uz: `"Semt buyurtmalari POS va oshxonaga tushadi. Integratsiya tez orada."`
- [ ] **T2.** aynı beş dosya → `onlineOrders.availability.comingSoon`:
      tr `"Yakında · Ücretsiz"` · en `"Coming soon · Free"` · ru `"Скоро · Бесплатно"` ·
      ar `"قريبًا · مجانًا"` · uz `"Tez orada · Bepul"`
- [ ] **T3.** aynı beş dosya → `onlineOrders.availability.comingSoonNote`:
      tr `"Bu platform henüz bağlanamıyor. Hazır olduğunda ücretsiz açılacak."` ·
      en `"This platform cannot be connected yet. It will be enabled free of charge when ready."` ·
      ru `"Эту платформу пока нельзя подключить. Она будет включена бесплатно, когда будет готова."` ·
      ar `"لا يمكن ربط هذه المنصة بعد. سيتم تفعيلها مجانًا عندما تصبح جاهزة."` ·
      uz `"Bu platformani hozircha ulab bo'lmaydi. Tayyor bo'lganda bepul yoqiladi."`
- [ ] **T4.** Katalog satırının `i18n` bloğu (`alacarte-catalog.const.ts`, `t(...)` çağrısı):
      | locale | name | description |
      |---|---|---|
      | tr | Paket Servis Entegrasyonları | Yemeksepeti, Getir, Trendyol Yemek ve Migros Yemek siparişleri otomatik olarak POS ve mutfağa düşer. Tek pakette dört platform. |
      | en | Delivery Platform Integrations | Yemeksepeti, Getir, Trendyol Yemek and Migros Yemek orders flow automatically into the POS and the kitchen. Four platforms in one package. |
      | ru | Интеграции служб доставки | Заказы Yemeksepeti, Getir, Trendyol Yemek и Migros Yemek автоматически поступают в POS и на кухню. Четыре платформы в одном пакете. |
      | ar | تكاملات منصات التوصيل | تصل طلبات Yemeksepeti وGetir وTrendyol Yemek وMigros Yemek تلقائيًا إلى نقطة البيع والمطبخ. أربع منصات في باقة واحدة. |
      | uz | Yetkazib berish platformalari integratsiyasi | Yemeksepeti, Getir, Trendyol Yemek va Migros Yemek buyurtmalari avtomatik ravishda POS va oshxonaga tushadi. Bitta paketda to'rtta platforma. |
- [ ] **T5.** `frontend/src/i18n/locales/{tr,en,ru,ar,uz}/licensing.json` →
      `store.semt.{title,description,badge}` (mevcut `store.*` bloğunun içine;
      `CatalogStore.tsx` `licensing` namespace'ini kullanıyor):
      - title: tr `"Semt (yakında)"` · en `"Semt (coming soon)"` · ru `"Semt (скоро)"` · ar `"Semt (قريبًا)"` · uz `"Semt (tez orada)"`
      - description: tr `"Bağımsız teslimat platformu. Entegrasyon hazır olduğunda paket servis paketine ücretsiz dahil edilecek."` ·
        en `"The independent delivery platform. When the integration is ready it will be included in the delivery package free of charge."` ·
        ru `"Независимая платформа доставки. Когда интеграция будет готова, она войдёт в пакет доставки бесплатно."` ·
        ar `"منصة التوصيل المستقلة. عندما يصبح التكامل جاهزًا سيُضاف إلى باقة التوصيل مجانًا."` ·
        uz `"Mustaqil yetkazib berish platformasi. Integratsiya tayyor bo'lganda yetkazib berish paketiga bepul qo'shiladi."`
      - badge: T2 ile aynı beş değer.

> **T6 tuzağı:** hiçbir yerde Türkçe metin `defaultValue` olarak İngilizceye
> konmayacak. Rotaya bağlı olmayan `features/marketplace/MarketplacePage.tsx` bu
> hatayı hâlihazırda içeriyor (`catalogEmpty` defaultValue'su Türkçe). Hedef
> dosya `features/licensing/CatalogStore.tsx`'te **hiç `defaultValue` yok**
> (grep ile doğrulandı) — bu desen oraya taşınmaz; beş locale'e gerçek çeviri
> yazılır.

### Docs / pazarlama (drift testi YOK — elle senkron)

- [ ] **D1.** `docs/PAZARLAMACI_REHBERI.md:84-86` — üç satır tek satıra
      (`| Paket Servis Entegrasyonları | **₺2.499** | Yemeksepeti, Getir, Trendyol Yemek ve Migros Yemek siparişleri otomatik POS ve mutfağa düşer |`);
      **91. satırdaki** "Teslimat entegrasyonları birikir: müşteri üç platformu da
      alabilir, hepsi tek mutfak akışına düşer." cümlesi **silinir** (artık yanlış)
      ve yerine Semt için "yakında, ücretsiz" notu yazılır (E6).
- [ ] **D2.** `docs/SISTEM_TANITIMI.md:90` — **yalnız bu satır**:
      `| Yemeksepeti / Getir / Trendyol Yemek | entegrasyon / yıllık | her biri ₺2.490 |`
      → `| Paket Servis Entegrasyonları (Yemeksepeti, Getir, Trendyol Yemek, Migros Yemek) | entegrasyon / yıllık | ₺2.499 |`
      + altına Semt "yakında, ücretsiz" notu. **Tablonun geri kalanına DOKUNULMAZ:**
      v3.6.7 ile zaten güncel (`:82` Bakım/Destek ₺4.900, `:84` Stok ₺3.900, ayrı
      öncelikli-destek / e-Fatura satırı yok) — E6.
- [ ] **D3.** Sunumlar — **yalnız teslimat rakamları**, lisansa DOKUNULMAZ (E5):
      - `presentation/HummyTummy_Presentation_TR.md:575-577` üç satır → tek
        `| Paket Servis (Yemeksepeti, Getir, Trendyol Yemek, Migros Yemek) | 2.499₺/yıl | … |`;
        `:643-644` (Yemeksepeti + Getir satırları) tek satıra iner ve `:646`
        toplamı `12.360₺` → **`9.879₺`** olur.
      - `presentation/HummyTummy_Presentation_EN.md:576-578` üç satır → tek satır;
        `:640-641` tek satıra iner ve `:642` toplamı `₺15.070` → **`₺12.589`**;
        `:704` ("Each platform is a separate ₺2.490/year integration — buy only
        the ones you sell on") → "All four platforms come in one ₺2.499/year
        package"; `:707` ("₺4.900 maintenance & support + ₺2.490 per platform")
        → "₺4.900 maintenance & support + ₺2.499 for all delivery platforms";
        `:827` cümlesindeki "delivery-platform integrations are ₺2.490/year each"
        → "the delivery-platform package is ₺2.499/year for all four".
      - Bu iki dosyadaki **₺4.900 lisans rakamları zaten doğrudur** — düzeltilmez.
- [ ] **D4.** `HummyTummy-Ozellikler-Sunumu.pdf` (repo kökü) — `presentation/`
      kaynaklarından üretilmiş **bayat ikili**; D3'ten sonra yeniden üretilir.
      Otomasyon yok, elle yapılacak iş olarak kaydedildi.
- [ ] **D5.** `landing/` — grep ile doğrulandı: **hiçbir teslimat FİYATI yok**
      (`2.490`/`249000` eşleşmesi sıfır). Yalnız marka listeleri var
      (`landing/src/i18n/messages/{tr,en,ru,ar,uz}.json` ~695-752,
      `landing/public/llms.txt:5,11`) → Semt "yakında" olarak eklenir, fiyat yazılmaz.
- [ ] **D6.** **Geliştirici portalı** (`developer.hummytummy.com`) — E1/E2:
      - `developer/pages/tr/developer/marketplace-api.mdx:141-143` ve
        `developer/pages/en/developer/marketplace-api.mdx:142-144` — üç satır tek
        satıra: `delivery_platforms` / `integration` / yıllık / **₺2.499 (`249900`)** /
        `integration.delivery` += `yemeksepeti`, `getir`, `trendyol_yemek`, `migros`
        + `feature.deliveryIntegration` / requiresLicense ✅ / dep —. Üç eski kod
        `priority_support` desenindeki gibi **"v3.6.8 arşivlendi — `delivery_platforms`
        içine alındı"** satırlarına dönüştürülür (silinmez).
      - `developer/pages/tr/reference/plan-matrix.mdx:108-110` ve
        `developer/pages/en/reference/plan-matrix.mdx:109-111` — aynı sadeleştirme;
        hemen ardından gelen `<Callout type="info">` ("Üç `delivery_*` ürünü aynı
        `integration.delivery` anahtarına yazar…" / "All three `delivery_*`
        products write to the same `integration.delivery` key…") tek pakete göre
        **yeniden yazılır**: artık tek satır dört vendor id yazıyor, UNION anlatısı
        yalnız `fiscal_*` için geçerli.
- [ ] **D7.** **Yardım portalı** (`help.hummytummy.com`) — E3, 18 yüzey:
      - `help/pages/tr/plans/index.mdx:86-88` · `en/plans/index.mdx:88-90` — üç
        satır tek `Paket Servis Entegrasyonları | ₺2.499` satırına.
      - `help/pages/tr/plans/choosing-and-upgrading.mdx:31` · `en/…:30` — "her biri
        ₺2.490" → tek paket ₺2.499; **ayrıca `tr:54` `₺9.460` / `en:53` `₺9,460`
        paket toplamı → `₺8.889`** (4.900 + 2.499 + 1.490).
      - `help/pages/{tr,en}/plans/feature-matrix.mdx:48` — "Yemeksepeti · Getir ·
        Trendyol Yemek | ₺2.490 (her biri)" → dört platform, ₺2.499 tek paket.
      - `help/pages/tr/marketplace/index.mdx:70-72` · `en/…:68-70` — üç tablo
        satırı tek satıra.
      - `help/pages/tr/marketplace/products.mdx:173-212` · `en/…:175-210` — üç ürün
        bölümü (`### Yemeksepeti/Getir/Trendyol Yemek Entegrasyonu`) **tek
        `### Paket Servis Entegrasyonları` bölümüne** iner (₺2.499, dört sağlayıcı);
        kapanış `<Callout>`'undaki "Her platform ayrı bir kalemdir ve ayrı
        fiyatlanır." / "…each platform is a separate line item…" cümlesi **silinir**.
      - `help/pages/tr/marketplace/purchase-flow.mdx:76-77` · `en/…:76-77` —
        "Entegrasyonlar (…) → hepsi yan yana birikir; aynı anda birden çok teslimat
        entegrasyonu kullanabilirsiniz." cümlesindeki **teslimat** ibaresi silinir
        (birikme kuralı `fiscal_*` için doğru kalır).
      - `help/pages/{tr,en}/admin-guide/online-orders.mdx:12` ve `:19-20` —
        "en az bir teslimat platformu entegrasyonu (… her biri 2.490 ₺/yıl)" →
        "Paket Servis Entegrasyonları (₺2.499/yıl, dört platform)"; `:19-20`
        Callout'undaki "Katalogda … ayrı ayrı satılır" cümlesi tek pakete çevrilir.
      - `help/pages/{tr,en}/admin-guide/index.mdx:71` — "Platform entegrasyonu —
        **2.490 ₺/yıl** (…; platform başına)" → "**2.499 ₺/yıl** (dört platform tek pakette)".
      - `help/pages/{tr,en}/admin-guide/settings.mdx:37` — aynı düzeltme.
      - Her yüzeyde **Migros dört sağlayıcıya eklenir** ve Semt "yakında, ücretsiz"
        olarak anılır.

> ⚠️ **D1-D7 ortak uyarı — üç PR aynı doküman yüzeylerinde buluşuyor.**
> Bu PR'a ek olarak **kartlı vardiya** (Change 2) ve **3D baskı** (Change 3) da
> aynı dosyaları düzenliyor:
> - `docs/SISTEM_TANITIMI.md` — bu PR `:90`'ı yeniden yazıyor, kartlı vardiya
>   `:86`'nın **altına** satır ekliyor, 3D baskı `:97`'nin **altına** satır ekliyor.
> - `docs/PAZARLAMACI_REHBERI.md` — bu PR `:84-86` + `:91`, kartlı vardiya `:75`'in
>   altına ve `:110-114` tablosunun **ardına** yeni bölüm, 3D baskı `:114`
>   tablosunun **içine** yeni satır.
> - `help/pages/{tr,en}/marketplace/products.mdx` — bu PR `tr:173-212`'yi tek
>   bölüme daraltıyor, kartlı vardiya `tr:95`'ten sonra yeni bölüm açıyor, 3D baskı
>   `tr:343/:345`'e yeni bölüm ekliyor.
>
> Bu tabloları/bölümleri "bütünüyle yeniden üretmek" YASAK — yalnız burada adı geçen
> satırlar düzenlenir. **Merge sırası: bu PR → kartlı vardiya → 3D baskı** (§6
> migration zinciriyle aynı sıra). Sonra merge olan PR, kendi mutlak satır çıpalarını
> **içerik eşlemesiyle** yeniden çözer; bu PR `tr:173-212`'yi daralttığı ve `:90`'ı
> tek satıra indirdiği an sonraki her mutlak numara kayar (§8 R14).

---

## 6. Migration

**Klasör:** `backend/prisma/migrations/20260820130000_delivery_platforms_bundle/`

**Bu daldaki BAĞLAYICI migration zinciri.** `feat/multi-country-architecture`
üzerinde dört değişiklik aynı anda migration yazıyor. Damgalar çakışmayacak
şekilde **tahsis edildi**; hiçbiri "reprice'tan sonraki ilk boş slot" diye
kendi başına seçilmez:

| # | Klasör | Sahip |
|---|---|---|
| 0 | `20260820120000_reprice_licence_and_stock` | v3.6.7 yeniden fiyatlama (**ağaçta zaten var**, başka oturum) |
| **1** | **`20260820130000_delivery_platforms_bundle`** | **BU DEĞİŞİKLİK** |
| 2a | `20260820150000_card_shift_schema` | kartlı vardiya |
| 2b | `20260820160000_card_shift_catalog` | kartlı vardiya |
| 3 | `20260820170000_print3d_service` | 3D baskı |

`prisma migrate deploy` klasörleri ada göre sırayla uygular; bu değişiklik
**zincirin 1. sırasındadır** — reprice'tan hemen sonra, diğer ikisinden önce.
Aynı sıra `alacarte-catalog-migration.spec.ts`'teki `FOLLOW_UP_SQL` dizisinde
de korunur (§7 T2).

**Dosyalar:** `migration.sql` (up) + `down.sql` — çift, ev usulü başlık zorunlu.

### 6.1 `migration.sql`

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
  "name"            = EXCLUDED."name",  -- NOT: "status" bilerek YOK (§8 R5)
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

-- ---------------------------------------------------------------------------
-- 2a. ARŞİVLEMEDEN ÖNCE her satırın MEVCUT statüsünü damgala.
--     Neden: 2b yalnız 'published' satırları arşivliyor, dolayısıyla down koşulsuz
--     'published' yazarsa operatörün migration'dan ÖNCE elle arşivlediği (ya da
--     'draft'ta bıraktığı) bir satırı geri yayına sokar — down sadık bir ters
--     işlem olmaktan çıkar ve kendi başlığındaki iddiayı çürütür.
--     Damga NEREYE: marketplace_addons'ta `pricingMeta` gibi serbest bir meta
--     kolonu YOK (schema.prisma:4705-4784; grants ve i18n ürün verisidir, damga
--     taşıyamaz). Bu yüzden 3a'daki `migratedPriorStatus` deyimi, statü değişimi
--     için zaten var olan tabloya — `audit_logs` (schema.prisma:2675-2694) —
--     yazılır: aynı anahtar adı, aynı "önceki değeri sakla, down'da geri yaz"
--     sözleşmesi. actorId bu migration'a özel bir sabittir; down yalnız o
--     actorId'li satırları okur ve siler.
-- ---------------------------------------------------------------------------
INSERT INTO "audit_logs" (
  "id", "action", "entityType", "entityId", "actorId", "actorEmail",
  "previousData", "newData", "metadata", "createdAt"
)
SELECT gen_random_uuid()::text,
       'UPDATE',
       'MARKETPLACE_ADDON',
       m."id",
       'migration:20260820130000_delivery_platforms_bundle',
       'migration@system.local',
       jsonb_build_object('migratedPriorStatus', m."status"),
       jsonb_build_object('status', 'archived'),
       jsonb_build_object('migration', '20260820130000_delivery_platforms_bundle',
                          'code', m."code"),
       NOW()
  FROM "marketplace_addons" m
 WHERE m."code" IN ('delivery_yemeksepeti', 'delivery_getir', 'delivery_trendyol_yemek')
   AND NOT EXISTS (
         SELECT 1 FROM "audit_logs" a
          WHERE a."actorId" = 'migration:20260820130000_delivery_platforms_bundle'
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
--     çalıştırma bunu gerçekten üretir (§6.3 adım 7).
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
--    yetkiyi SÜRESİZ BEDAVA kullanmaya devam eder. O satırlar ELLE mutabık kılınır
--    (§6.3 adım 0b, §8 R16).
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

> **Tek tırnak kuralı.** `i18n` jsonb literalindeki her apostrof **İKİYE
> KATLANIR**: Özbekçe açıklamada `to'rtta` → `to''rtta`. Kaçırılmazsa deploy
> sözdizimi hatasıyla ölür ya da JSON bozulur. Emsal hemen yan klasörde:
> `20260820120000_reprice_licence_and_stock/migration.sql:40`
> (`qo''llab-quvvatlash`, `bo''ladi`). Aynı kural adım 0'daki `RAISE EXCEPTION`
> metnindeki `SKU''suna` için de geçerlidir.

### 6.2 `down.sql`

```sql
-- Paket servis tek-paket geçişinin geri alınması.
--
-- Her ifade up'ın ürettiği TAM son-durumla korunur, iki kez çalıştırılınca
-- no-op olur ve operatörün elle değiştirdiği bir fiyatı/statüyü ezmez.
-- Kiracı verisine yalnızca up'ın dokunduğu yerde dokunur: taşınan
-- `addOnId`'yi `pricingMeta.migratedFrom` damgasından geri yazar ve damgaları
-- temizler. Katalog statüsü de damgadan gelir: üç SKU koşulsuz 'published'
-- yapılmaz, up'ın 2a adımında audit_logs'a yazdığı `migratedPriorStatus`
-- değerine döner (operatör migration'dan önce bir satırı arşivlediyse arşivli
-- kalır). Silinen açık yenileme döngüleri geri getirilmez — türetilmiş
-- veridir, 06:00 UTC üreticisi yeniden yaratır.

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
--    up'ın 2b adımı yalnız 'published' satırları arşivledi; koşulsuz republish,
--    operatörün migration'dan önce zaten arşivlediği (ya da hiç yayımlamadığı)
--    bir satırı satışa açar ve down'ı sadık bir ters işlem olmaktan çıkarır.
--    Kaynak: up'ın 2a adımında audit_logs'a yazdığı `migratedPriorStatus` damgası
--    (3a'daki tenant_addons deyiminin aynısı; marketplace_addons'ta serbest bir
--    meta kolonu yok).
--    `IS DISTINCT FROM` sayesinde damgadaki değer zaten yazılıysa satır hiç
--    güncellenmez.
UPDATE "marketplace_addons" m
   SET "status" = a."previousData" ->> 'migratedPriorStatus',
       "updatedAt" = NOW()
  FROM "audit_logs" a
 WHERE a."actorId" = 'migration:20260820130000_delivery_platforms_bundle'
   AND a."entityId" = m."id"
   AND m."code" IN ('delivery_yemeksepeti', 'delivery_getir', 'delivery_trendyol_yemek')
   AND (a."previousData" ->> 'migratedPriorStatus') IS NOT NULL
   AND m."status" IS DISTINCT FROM (a."previousData" ->> 'migratedPriorStatus');

-- 3b. Damgayı temizle. Down "yalnız up'ın eklediğini kaldırır" kuralı gereği bu
--     satırları silmek zorundadır: bırakılırsa bir sonraki up→down turunda bayat
--     bir "önceki statü" geri yazılır. Kapsam actorId ile bu migration'a çakılıdır;
--     başka hiçbir audit satırına dokunulmaz. İkinci çalıştırmada 0 satır siler.
DELETE FROM "audit_logs"
 WHERE "actorId" = 'migration:20260820130000_delivery_platforms_bundle';

-- 4. Paket satırı silinir — ama ASLA bir satın almayı sahipsiz bırakmadan.
--    (2. adım başarısız olduysa NOT EXISTS bu DELETE'i no-op yapar: fail-safe.)
DELETE FROM "marketplace_addons" ma
 WHERE ma."code" = 'delivery_platforms'
   AND NOT EXISTS (
         SELECT 1 FROM "tenant_addons" ta WHERE ta."addOnId" = ma."id"
       );

-- 5. Paketi referanslayan açık/ödenmemiş yenileme döngüleri temizlenir.
--    up'ın 4. adımıyla AYNI daraltma: yıl dönümü gelmiş/geçmiş bir open
--    döngüyü silmek faturayı da lapse tetikleyicisini de yok eder
--    (anniversary.ts:114-121, renewal-scheduler.service.ts:144-153).
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

> **down'ın adım 0 karşılığı yoktur ve olmamalıdır.** Uçuş-öncesi kilit yalnız
> bir okuma kapısıdır; hiçbir şey yazmaz, dolayısıyla geri alınacak bir şey de
> bırakmaz.

### 6.3 İdempotanlık + gidiş-dönüş kanıt planı

Tek kullanımlık Postgres'te (asla dev/staging DB'sinde değil):

```bash
docker run --rm -d --name mig-probe -e POSTGRES_PASSWORD=probe -p 55432:5432 postgres:16
export DATABASE_URL='postgresql://postgres:probe@localhost:55432/postgres?schema=public'
cd backend
npx prisma migrate deploy                    # tüm zincir, yeni migration dahil
npx ts-node prisma/seeds/seed-marketplace.ts # seed = migration ile aynı sonuç mu
```

Sonra sırayla, her adımda `psql` doğrulaması:

| Adım | Komut | Beklenen |
|---|---|---|
| 0 | Uçuş-öncesi kilit: bir `checkout_intents` satırı ekle (`status='succeeded'`, `provisionedAt=NULL`, `expiresAt=NOW()+'1 hour'`, `cartJson={"items":[{"type":"addon","code":"delivery_getir","qty":1}]}`), `psql -f migration.sql` | **`ABORT: 1 adet uçuşta checkout intent…` ile ölür**, hiçbir satır değişmez. Satırı `provisionedAt=NOW()` yapıp tekrar çalıştır → geçer. |
| 0b | Elle mutabakat listesi: `psql -c "SELECT rc.id, rc.\"tenantId\", rc.\"anniversaryAt\", rc.\"totalCents\" FROM renewal_cycles rc WHERE rc.status='open' AND rc.\"paymentRef\" IS NULL AND rc.\"anniversaryAt\" <= NOW() + INTERVAL '1 day' AND EXISTS (SELECT 1 FROM jsonb_array_elements(rc.\"cartJson\"->'items') it WHERE it->>'code' IN ('delivery_yemeksepeti','delivery_getir','delivery_trendyol_yemek'))"` | Migration'ın **dokunmadığı** döngüler. Boş değilse operatöre teslim edilir (§8 R16); prod'da bu sorgu deploy öncesi çalıştırılır. |
| 1 | `psql -c "SELECT code,status,\"priceCents\",\"sortOrder\" FROM marketplace_addons WHERE code LIKE 'delivery%'"` | `delivery_platforms/published/249900/20` + üç kod `archived` |
| 2 | up'ı ikinci kez elle çalıştır (`psql -f migration.sql`) | 0 satır etkilenir (INSERT ON CONFLICT dışında), fiyat/status değişmez |
| 3 | Sahiplik fikstürü: iki `tenant_addons` satırı (yemeksepeti + getir, `active`) ekle, up'ı çalıştır | biri `cancelled` (`migratedPriorStatus:"active"`), diğeri `addOnId=<paket>` ve `migratedFrom:"delivery_yemeksepeti"` |
| 3b | Hayatta-kalan seçimi: iki satır, **eski** `activatedAt`'li olanın `currentPeriodEnd` = bugün+30g, **yeni** olanınki bugün+200g; up'ı çalıştır | **Bugün+200g olan hayatta kalır** ve pakete taşınır; eski olan `cancelled`. down'dan sonra iki satır da up öncesi haliyle **bayt-bayt aynı** (`cancelledAt`/`endedAt` dahil). |
| 4 | `psql -f down.sql` | iki satır eski `addOnId`/`status`/`cancelledAt`/`endedAt`'ına döner, `pricingMeta`'da `migrated*` damgası kalmaz, üç SKU `published`, paket satırı silinmiş |
| 5 | `psql -f down.sql` (ikinci kez) | 0 satır etkilenir |
| 6 | `psql -f migration.sql` (yeniden up) | 1. adımdaki duruma birebir döner |
| 7 | Çift-satır koruması: kiracıya **hem** bir `delivery_platforms` `active` satırı **hem** bir `delivery_getir` `active` satırı ekle, up'ı çalıştır | Kiracıda **tam olarak bir** `active` paket satırı kalır; eski satır taşınmaz (`NOT EXISTS` koruması) — yenileme sepeti ₺2.499'u iki kez yazmaz. |
| 8 | Yıl dönümü geçmiş döngü: `anniversaryAt = NOW() - INTERVAL '2 days'`, `status='open'`, `paymentRef IS NULL`, sepetinde `delivery_getir` olan bir `renewal_cycles` satırı ekle, up'ı çalıştır | Satır **hâlâ durur** (silinmemiş). Silinseydi ne fatura ne de `lapseUnpaidCycles` tetiklenirdi. |
| 9 | Statü damgası sadakati (taze DB): `psql -c "UPDATE marketplace_addons SET status='archived' WHERE code='delivery_getir'"` → `psql -f migration.sql` → `psql -f down.sql` | `delivery_getir` **hâlâ `archived`** (up öncesi statüsüne döndü, `published` OLMADI); diğer iki kod `published`. Ardından `psql -c "SELECT count(*) FROM audit_logs WHERE \"actorId\"='migration:20260820130000_delivery_platforms_bundle'"` → **0** (damga temizlendi). down'ı ikinci kez çalıştır → 0 satır etkilenir. |

`docker rm -f mig-probe` ile temizle. **Bu tablonun tamamı yeşil olmadan
migration "bitti" sayılmaz** (standing kullanıcı kuralı: her migration ve seed
tersine çevrilebilir olmalı ve round-trip doğrulanmalı).

---

## 7. Test planı

### Birim / invaryant (jest, `cd backend && npx jest <path>`)

**T1 — `backend/src/modules/marketplace/catalog-validation.spec.ts`**
`"lights up the delivery feature flag on every delivery platform"` (satır 256-265)
şununla değiştirilir:

```ts
it("ships exactly one delivery product covering all four platforms", () => {
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

> ⚠️ Bu dosyayı kartlı-vardiya PR'ı da düzenliyor (iki yeni `it()` bloğu ekliyor).
> `delivery_*` invaryantının sahibi **bu PR**'dır; kartlı vardiya `delivery_`
> önekli kod eklemediği için testin şekline dokunmaz (§8 R14).

Ayrıca değişmeden geçmesi gereken (regresyon nöbetçileri):
`"has unique codes and unique sort orders"` (sortOrder 20 tekil kalmalı),
`"does not resurrect a retired code"` (üç kod artık `RETIRED_ADDON_CODES`'ta ve
katalogda **olmamalı**), `"carries copy in all five supported locales"`,
`"prices every annual product above the PayTR minimum"`.

**T2 — `backend/src/modules/marketplace/alacarte-catalog-migration.spec.ts`**
(T1 tuzağı: "sadece testi düzelt" YASAK — mekanizma genişletilir.)

> **Başlangıç durumu:** suite bu ağaçta **YEŞİL, 9/9**. Katlama mekanizması
> (`FOLLOW_UP_SQL` :42-44, `parseRepricing` :100-111, `parseArchived` :113-122,
> `effective` :137-140) paralel oturumda **tamamlandı**. Bu değişiklik onu
> sıfırdan yazmaz, **genişletir**. Düzenlemeden sonra suite kırmızıya dönerse,
> sebep senin düzenlemendir.
> Dosya ayrıca **kartlı-vardiya** PR'ıyla ortaktır: mekanizmanın sahibi bu PR,
> o yalnız `FOLLOW_UP_SQL`'e bir satır ekler (§8 R14). **3D baskı PR'ı bu dosyaya
> dokunmaz** (`hardware_products` rayı; kendi `print3d-catalog-migration.spec.ts`
> tripwire'ını getiriyor).

1. `FOLLOW_UP_SQL` (satır 42-44) listesine **migration damgası sırasına göre**
   eklenir — append değil, insert. Katlamada sonraki satır öncekini ezdiği için
   dizi her zaman klasör damgasına göre sıralı kalmalıdır; merge sırası ne olursa
   olsun bu kural bozulmaz:
   ```ts
   const FOLLOW_UP_SQL = [
     // Her zaman migration klasör damgasına göre SIRALI. Ekleme yaparken
     // araya gir, sona atma: katlamada sonraki satır öncekini ezer.
     "20260820120000_reprice_licence_and_stock/migration.sql",
     "20260820130000_delivery_platforms_bundle/migration.sql",
   ].map((rel) => join(__dirname, "../../../prisma/migrations", rel));
   ```
   Bu değişikliğin dosyalarına **asla indeksle** erişilmez (`FOLLOW_UP_SQL[1]`
   bir sonraki eklemede başka bir migration'ı gösterir ve iddialar sessizce
   yanlış dosyayı doğrular). Ada göre aranır:
   ```ts
   const BUNDLE_UP = FOLLOW_UP_SQL.find((f) =>
     f.includes("delivery_platforms_bundle"),
   )!;
   const BUNDLE_DOWN = BUNDLE_UP.replace("migration.sql", "down.sql");
   ```
2. Katlama INSERT'leri de kapsar (bugün yalnız reprice + archive var):
   ```ts
   const insertedLater = followUps.flatMap(parseUpserts);
   const effective = [...parsed, ...insertedLater]
     .filter((r) => !archivedLater.has(r.code))
     .map((r) => ({ ...r, priceCents: reprices.get(r.code) ?? r.priceCents }));
   ```
   Bunun çalışması için **B2'deki INSERT, P1 üretecinin şekliyle birebir aynı
   olmalıdır** (`gen_random_uuid()::text, '<code>', ...` / `'<kind>', '<billing>', <price>, 'TRY',`
   / `...::jsonb, ARRAY[]::TEXT[], '<status>', <bool>,`) — `parseUpserts`'ün
   regex'i (satır 71-72) buna çakılıdır.
3. `"deletes in the down exactly the codes the up introduced"` (satır **254-282**):
   `introduced` artık `ALACARTE_CATALOG`'dan değil, **taban migration'ın kendi
   INSERT'lerinden** hesaplanır. P1'in down'ı P1'in yaratmadığı bir kodu silemez;
   sabitten türetmek her yeni INSERT'li takip migration'ında bu testi kırar.
   Bu **tek biçim** bağlayıcıdır: kartlı-vardiya PR'ı (§6.3/5) aynı hesabı
   birebir kullanır ve yeniden yazmaz; 3D baskı PR'ı bu dosyaya hiç dokunmaz
   (§8 R14):
   ```ts
   // Taban migration'ın GERÇEKTEN yarattığı kodlar. Katalog sabitinden
   // türetmek yanlış: sonraki her migration'ın eklediği kod da listeye
   // girer ve P1'in down'ında aranır.
   const introduced = parsed
     .map((r) => r.code)
     .filter((c) => !preExisting.has(c))
     .sort();
   ```
4. **YENİ** testler aynı dosyada:
   ```ts
   it("keeps every follow-up migration on snake_case table names", () => {
     for (const f of followUps) {
       expect(executableSql(f)).not.toMatch(
         /"MarketplaceAddOn"|"TenantAddOn"|"Tenant"|"RenewalCycle"/,
       );
     }
   });

   it("moves delivery ownership instead of stranding it at renewal", () => {
     const exec = executableSql(readFileSync(BUNDLE_UP, "utf8"));
     // sahiplik taşınıyor…
     expect(exec).toMatch(/UPDATE "tenant_addons"[\s\S]*SET "addOnId"/);
     // …ve kökeni geri alınabilir şekilde damgalanıyor
     expect(exec).toContain("'migratedFrom'");
     // arşivli koda ait açık yenileme döngüsü bırakılmıyor
     expect(exec).toMatch(/DELETE FROM "renewal_cycles"[\s\S]*'open'/);
   });

   it("guards the bundle up against in-flight checkout intents", () => {
     // Ödenmiş ama provision edilmemiş bir intent varken migration çalışmamalı:
     // yeniden teklif arşivli satırı düşürür, 1 kuruş toleransı patlar ve kart
     // çekilmişken provision reddedilir (checkout.service.ts:233-243).
     const exec = executableSql(readFileSync(BUNDLE_UP, "utf8"));
     expect(exec).toMatch(/"checkout_intents"[\s\S]*RAISE EXCEPTION/);
   });

   it("only deletes renewal cycles the 06:00 generator can rebuild", () => {
     // nextAnniversary() (anniversary.ts:114-121) bugün >= yıl dönümü olduğunda
     // bir sonraki yıla atlar; geçmiş yıl dönümlü bir open döngüyü silmek hem
     // faturayı hem de lapseUnpaidCycles tetiğini yok eder.
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
     // down KOŞULSUZ 'published' yazmamalı: up yalnız 'published' satırları
     // arşivliyor, dolayısıyla operatörün migration'dan önce arşivlediği bir
     // satır geri yayına girmemeli. Damga up'ta audit_logs'a yazılır.
     const up = executableSql(readFileSync(BUNDLE_UP, "utf8"));
     const down = executableSql(readFileSync(BUNDLE_DOWN, "utf8"));
     expect(up).toMatch(/INSERT INTO "audit_logs"[\s\S]*migratedPriorStatus/);
     expect(down).toContain("migratedPriorStatus");
     expect(down).not.toMatch(/SET "status" = 'published'/);
   });

   it("restores the dedupe timestamps instead of nulling them", () => {
     // down sadık bir ters işlem olmalı: up öncesi cancelledAt/endedAt
     // değerleri damgadan geri yazılır, NULL'lanmaz.
     const down = executableSql(readFileSync(BUNDLE_DOWN, "utf8"));
     expect(down).toContain("migratedPriorCancelledAt");
     expect(down).toContain("migratedPriorEndedAt");
     expect(down).not.toMatch(/"cancelledAt"\s*=\s*NULL/);
   });
   ```
   `"retires products only through RETIRED_ADDON_CODES"` (satır **142-148**) **hiç
   değişmez** ve üç kodun `RETIRED_ADDON_CODES`'a eklenmesini zorunlu kılar.

**T3 — `backend/src/modules/delivery-platforms/constants/platform.enum.spec.ts`** (mevcut dosya, ekleme)
```ts
it("carries SEMT as a coming-soon platform with no adapter", () => {
  expect(DeliveryPlatform.SEMT).toBe("SEMT");
  expect(PLATFORM_AVAILABILITY[DeliveryPlatform.SEMT]).toBe("coming_soon");
  expect(AVAILABLE_DELIVERY_PLATFORMS).not.toContain(DeliveryPlatform.SEMT);
  expect(AVAILABLE_DELIVERY_PLATFORMS).toEqual([
    "YEMEKSEPETI", "GETIR", "TRENDYOL", "MIGROS",
  ]);
});

it("declares availability for every enum member (no silent gap)", () => {
  for (const p of Object.values(DeliveryPlatform)) {
    expect(PLATFORM_AVAILABILITY[p]).toBeDefined();
  }
  expect(Object.isFrozen(PLATFORM_AVAILABILITY)).toBe(true);
});
```
Mevcut `"uses value===name for the platform enums"` ve
`"enumerates the supported delivery platforms"` (`arrayContaining`, satır 22-26)
değişmeden geçmelidir.

**T4 — `backend/src/modules/delivery-platforms/adapters/adapter-factory.spec.ts`** (ekleme)
```ts
it("fails closed for a coming-soon platform (no adapter exists)", () => {
  expect(() => factory.getAdapter("SEMT")).toThrow(ServiceUnavailableException);
});

it("still throws for a genuinely unknown platform", () => {
  expect(() => factory.getAdapter("NOPE")).toThrow(/Unknown delivery platform/);
});
```
**Mevcut iki test DEĞİŞMEDEN geçmelidir** (satır 49-59, B17):
`"throws for an unknown platform"` → `"Unknown delivery platform: DOORDASH"` ve
`"throws for an empty platform string"` → `"Unknown delivery platform: "`.
Bu ancak kapı `platform in PLATFORM_AVAILABILITY` ile daraltılırsa mümkündür;
koşulsuz `!isPlatformAvailable(platform)` yazılırsa `undefined !== "available"`
olduğu için ikisi de `ServiceUnavailableException` alır ve **kırılır** — o
takdirde yukarıdaki `"still throws for a genuinely unknown platform"` testi de
tasarımı gereği geçemez.

**T5 — `backend/src/modules/delivery-platforms/dto/platform-config.dto.spec.ts`** (ekleme)
```ts
it("rejects a coming-soon platform on config create", async () => {
  const dto = plainToInstance(CreatePlatformConfigDto, { platform: "SEMT" });
  const errors = await validate(dto);
  expect(errors.some((e) => e.property === "platform")).toBe(true);
});
```

**T6 — YENİ `backend/src/modules/marketplace/delivery-bundle.spec.ts`**
Sözlük köprüsü (bugün var olmayan tek koruma):
```ts
it("the bundle's vendor ids cover exactly the available platforms", () => {
  const bundle = ALACARTE_CATALOG_BY_CODE.get("delivery_platforms")!;
  const vendors = bundle.grants["integration.delivery"] as string[];
  expect(vendors.length).toBe(AVAILABLE_DELIVERY_PLATFORMS.length);
  // vendor id'ler küçük harf ve enum ile bire bir eşleşmiyor
  // (TRENDYOL <-> "trendyol_yemek") — eşleme burada AÇIKÇA pinlenir.
  expect(vendors).toEqual([
    "yemeksepeti", "getir", "trendyol_yemek", "migros",
  ]);
});

it("does not sell Semt", () => {
  const bundle = ALACARTE_CATALOG_BY_CODE.get("delivery_platforms")!;
  expect(bundle.grants["integration.delivery"]).not.toContain("semt");
  expect(ALACARTE_CATALOG.some((p) => p.code.includes("semt"))).toBe(false);
});
```

**T7 — `backend/src/modules/delivery-platforms/services/delivery-test.service.spec.ts`** (ekleme)
`simulateOrder(tenant, "SEMT")` → `BadRequestException`, `configService.findOneInternal`
**hiç çağrılmamalı**.

**T8 — `backend/src/modules/device-mesh/kds-tablet-limit.spec.ts:29-37`**
Değiştirilmez ama **etkilenir**: `RETIRED_ADDON_CODES`'a eklenen üç kod
`ADDONS`'ta bulunmamalıdır. B1 doğru yapıldıysa yeşil kalır; bu, "arşivlenen
kod katalogda kalmasın" güvencesidir.

### Frontend (vitest, `cd frontend && npx vitest run <path>`)

**T9 — `frontend/src/pages/settings/DeliveryPlatformsSettingsPage.test.tsx:48`**
```ts
expect(platforms).toEqual(['GETIR', 'YEMEKSEPETI', 'TRENDYOL', 'MIGROS', 'SEMT']);
```
ve YENİ:
```ts
it('passes SEMT through with no config row', () => {
  render(<DeliveryPlatformsSettingsPage />);
  const cards = screen.getAllByTestId('platform-card');
  const platforms = cards.map((c) => c.getAttribute('data-platform'));
  expect(platforms).toContain('SEMT');
  const semt = cards.find((c) => c.getAttribute('data-platform') === 'SEMT')!;
  expect(semt.getAttribute('data-has-config')).toBe('false');
});
```
Test adı bilinçli olarak "coming-soon kartı render eder" DEĞİL: bu suite
`PlatformCard`'ı stub'lıyor (`DeliveryPlatformsSettingsPage.test.tsx:14-18`,
yalnız `data-testid`/`data-platform`/`data-has-config` basıyor), dolayısıyla
buradan "yakında" davranışı hakkında hiçbir şey gözlemlenemez. Rozet ve devre
dışı toggle iddiaları **T10**'a aittir.

**T10 — `frontend/src/components/delivery-platforms/PlatformCard.test.tsx`** (ekleme)
```ts
describe('PlatformCard coming-soon (Semt)', () => {
  it('shows the free/coming-soon badge and disables connecting', () => { /* rozet metni: onlineOrders.availability.comingSoon */ });
  it('does not expand into the credentials form when clicked', () => { /* PlatformCredentialsForm render EDİLMEZ */ });
  it('never calls createConfig even if the toggle is force-clicked', () => { /* createConfig mock çağrılmamalı */ });
});
```

**T11 — YENİ `frontend/src/features/licensing/CatalogStore.semt.test.tsx`**
(`MarketplacePage` DEĞİL: o dosya hiçbir rotaya bağlı değil — B19.)
1. Katalogda `integration` türünde en az bir ürün varken: `semt-coming-soon`
   kartı `integration` bölümünün **ilk** öğesi olarak render olur.
2. `useCatalogPricing` boş liste döndürdüğünde (`grouped.size === 0`, erken
   dönüş dalı) kart **yine de** render olur.
3. Kartta **satın al / ekle kontrolü yok**: `within(card).queryByRole('button')`
   `null`, `queryByRole('checkbox')` `null`.
4. Kart hiçbir ağ çağrısı tetiklemez ve `delivery_platforms` satırının
   fiyatını/durumunu değiştirmez.

### Sözleşme / CI kapıları

- `node scripts/check-contract-drift.mjs` — F9'dan sonra `DeliveryPlatform`
  girişi iki tarafı karşılaştırır; `SEMT` yalnız bir tarafa eklenirse CI kırmızı.
- `node scripts/check-i18n-parity.mjs` — referans locale `en`; T1-T3, T5'teki
  her anahtar beş locale'de bulunmalı.
- `node scripts/check-i18n-value-drift.mjs --gate-new scripts/i18n-value-drift-baseline.json`
  — **CI'ın çalıştırdığı tam komut budur** (`.github/workflows/quality-gates.yml:174`);
  çıplak çalıştırmak var olan bütün drift satırlarını raporlar ve CI hükmünü
  yeniden üretmez. Yeni anahtarlar
  `scripts/i18n-value-drift-baseline.json`'a **eklenmez**; farklı diller farklı
  değer taşıdığı için temiz geçer. Geçmezse baseline'ı şişirmek yerine çeviriyi
  düzelt.
- `cd backend && npm run lint:ci` (T9 tuzağı: `npm run lint` `--fix` uygular ve
  ağacı değiştirir; ayrıca `cmd | tail` çıkış kodunu `tail`'den alır — pipe'sız çalıştır).

### e2e (gerçek Postgres, `cd backend && npm run test:e2e`)

**T12 — `backend/test/licensing.e2e-spec.ts`** (mevcut dosyaya senaryo)
1. Kiracıya lisans + `delivery_platforms` sağla; `GET /v1/entitlements`
   `integration.delivery` dizisinde dört sağlayıcıyı da döndürsün.
2. `GET /delivery-platforms/configs` **200** (kapı açık).
3. `POST /delivery-platforms/configs { platform: "SEMT" }` → **400**.
4. `POST /delivery-platforms/configs { platform: "MIGROS", ... }` → **201**
   (paket Migros'u kapsıyor; bu, K3'ün gözlemlenebilir kanıtı).

> e2e ortamı `prisma db push` kullanır, migration SQL'ini çalıştırmaz (T3'ün
> kökeni). Migration davranışı bu yüzden e2e ile değil, §6.3 gidiş-dönüş
> prosedürüyle kanıtlanır.

---

## 8. Riskler ve tuzaklar

### R1 — 🔴 Sadece arşivlemek mevcut müşteriyi yıl dönümünde karanlığa gömer
*(Bu riskin çözümü §2 K5b'dir ve **ONAYLANDI** — kapsam içindedir, koşulsuz uygulanır.)*
Onaylı kararın "mevcut sahipler erişimi kaybetmez" kısmı **döngü ortası için
doğru** (A6), **yıl dönümünde yanlış** (A8+A9+A10 zinciri, §4.2). Bu yüzden
migration mülkiyeti taşır. Taşıma yapılmazsa: yenileme faturası sessizce eksilir,
7 günlük grace sonrası teslimat kapanır ve müşteri grace bitene kadar paketi
**satın bile alamaz** (`ADDON_ALREADY_GRANTED`).

### R2 — 🔴 Açık `RenewalCycle` satırları settlement'ı para alındıktan sonra reddettirir
30 gün önceden üretilen döngüler eski kodları donuk taşır (A9). Migration'dan
sonra yeniden teklif düşük çıkar, 1 kuruş toleransı aşılır ve
`confirmAndProvision` provision'ı **reddeder** (A12) — PayTR tahsilatı olmuş
olur. §6.1 adım 4 bunu kapatır; atlanırsa canlıda para/hizmet uyuşmazlığı.

### R3 — 🟠 (T1) Drift spec'i YEŞİL; risk merge sırası, kırık suite değil
`cd backend && npx jest src/modules/marketplace/alacarte-catalog-migration.spec.ts`
bu ağaçta **9 passed / 9 total** veriyor (bu spec yazılırken çalıştırılarak
doğrulandı). Paralel oturumun katlama mekanizması **tamamlandı**:
`FOLLOW_UP_SQL` :42-44, `parseRepricing` :100-111, `parseArchived` :113-122,
`effective` :137-140; `20260820120000_reprice_licence_and_stock` hem
`migration.sql` hem `down.sql` ile ağaçta.

Gerçek risk **merge sırasıdır**: Change-1 (repricing + katlama) commit edilmemiş
ve takip edilmeyen dosyalar halinde duruyor. Bu PR o işten ÖNCE açılırsa
katlamayı kendisi taşımak zorunda kalır. Sıra doğruysa bu değişiklik yalnızca
`FOLLOW_UP_SQL`'e bir satır ekler ve katlamayı INSERT'leri kapsayacak şekilde
genişletir — **sıfırdan yazmaz**. Düzenlemeden sonra suite kırmızıya dönerse
sebep senin düzenlemendir, "zaten kırıktı" mazereti yoktur.
Uygulanmış migration'ı (`20260811100000_alacarte_catalog`) düzenlemek yasaktır —
`prisma migrate deploy` checksum doğrular ve production deploy'u patlar.

### R4 — 🟠 (T3) PascalCase tablo adı yalnız production'da patlar
CI `prisma db push` kullanır ve migration SQL'ini **hiç çalıştırmaz**. Yeni SQL
yalnız `marketplace_addons`, `tenant_addons`, `renewal_cycles` yazmalı. T2'deki
yeni snake_case testi bunu takip migration'ları için de pinler.

### R5 — 🟠 (T10) Seed `status`'u zorla `published` yapar; ON CONFLICT statüyü ezer
`seed-marketplace.ts:1006` `const status = "published"` ve P1 migration'ının
`DO UPDATE` listesi `status`'u içerir. Yeni migration bu deseni **kopyalamaz**:
`status` `DO UPDATE`'ten çıkarılmıştır (§6.1). Aksi halde operatörün arşivlediği
paket bir sonraki deploy'da kendiliğinden geri yayımlanır.

### R6 — 🟠 Görev brifingindeki lisans fiyatı bayat
Brifing "₺2.990 / 299_000" diyor; ağaçtaki gerçek **490.000 kuruş (₺4.900)**
(`alacarte-catalog.const.ts:75`) ve `priority_support` + `fiscal_efatura`
lisansa katlanıp arşivlendi (`RETIRED_ADDON_CODES`, satır 759-765). Bu spec'te
lisansa dair hiçbir sayı **değiştirilmez**; yalnız D2/D3'teki bayat doküman
tabloları düzeltilirken doğru rakam kullanılır.

### R7 — 🟠 (T7) `DeliveryPlatform` elle aynalanıyor, guard yok
`scripts/check-contract-drift.mjs` yalnız 5 sözleşmeyi kontrol ediyor;
`DeliveryPlatform` ikisinde de elle yazılı (B9). SEMT tek tarafa eklenirse
`PlatformCard` `PLATFORM_INFO[platform]` üzerinden **TypeError** verir (B12).
F9 bu boşluğu kapatır — bu değişiklikte opsiyonel değil, zorunlu.

### R8 — 🟠 Enum'a SEMT eklemek yazma yollarını kendiliğinden açar
`@IsEnum(DeliveryPlatform)` (B5) ve `Object.values(DeliveryPlatform)` (B6)
"enum'daysa geçerlidir" varsayar. Üç katmanlı fail-closed (§4.3) olmadan bir
kiracı SEMT config'i oluşturabilir; sonra `order-polling.scheduler.ts:102`
her turda `getAdapter("SEMT")` deneyip **çıplak `Error` ile 500** üretir.

### R9 — 🟡 Fiyat reklamı SEKİZ ayrı yüzeyde, drift testi YOK
₺2.490 şurada geçiyor (hepsi bu oturumda satır satır doğrulandı):
`docs/PAZARLAMACI_REHBERI.md:84-86` (+ `:91` cümlesi),
`docs/SISTEM_TANITIMI.md:90`,
`presentation/HummyTummy_Presentation_TR.md:575-577, 643-644` (+ `:646` toplamı),
`presentation/HummyTummy_Presentation_EN.md:576-578, 640-641, 704, 707, 827`
(+ `:642` toplamı), kök dizindeki üretilmiş `HummyTummy-Ozellikler-Sunumu.pdf`,
`frontend/src/marketing/data/moduleContent.generated.ts:1147, 1153-1154, 1156, 1215`,
**`developer/pages/{tr,en}/…` (4 dosya)** ve **`help/pages/{tr,en}/…` (18 yüzey)**.
Son iki grup ilk taramada gözden kaçmıştı; ikisi de canlı portal ve ikisi de
paralel v3.6.7 işiyle bu ağaçta `M` durumunda.
**Hiçbirini bağlayan test yok** — elle senkron edilecek: D1-D7.
Lisans rakamları (₺4.900) her iki sunumda ve `SISTEM_TANITIMI.md`'de **zaten
doğrudur**; bu PR onlara dokunmaz (E5/E6).

### R10 — 🟡 Pazarlama metinleri artık olgusal olarak yanlış
`frontend/src/marketing/data/faq.ts:32` açıkça "Yemeksepeti, Getir ve Trendyol
Yemek ayrı ayrı satılır" diyor; `docs/PAZARLAMACI_REHBERI.md:91` "Teslimat
entegrasyonları birikir". İkisi de yanlışa dönüşür (F6, D1).

### R11 — 🟡 Çoklu platform sahibi için yenileme fiyatı düşer, tek platform sahibi için ₺9 artar
Taşıma sonrası herkes ₺2.499'dan yenilenir: iki platform tutan kiracı
₺4.980 → ₺2.499 (gelir düşüşü, bilinçli), tek platform tutan ₺2.490 → ₺2.499
(₺9 artış). İade yok, duyuru pazarlama tarafının işi.

### R12 — 🟡 (T11) Yeni fiyat TRY-only literal
`ALACARTE_CATALOG`'un para birimi boyutu yok; migration `'TRY'` yazar. Çok
ülkeli iş aynı dalda (`backend/src/common/country/country-profile.const.ts` UZ →
UZS). Bilinen takip işi (§9 A3), burada çözülmez.

### R13 — 🟡 (T8) `whitelist: true` bildirilmeyen alanı sessizce siler
Bu değişiklik DTO alanı eklemiyor; `availability` bilgisi API'den
dönmez, frontend kendi aynasından okur. İleride bir alan eklenirse DTO'ya
bildirilmeden gönderilmesi sessiz veri kaybı olur.

### R14 — 🟠 Aynı dalda dört değişiklik, iki ortak dosya, çakışan damgalar
`feat/multi-country-architecture` üzerinde bu PR'ın yanı sıra **kartlı vardiya**
ve **3D baskı** değişiklikleri de migration yazıyor. İki test dosyası bu PR ile
**kartlı vardiya** arasında ortaktır (`alacarte-catalog-migration.spec.ts`,
`catalog-validation.spec.ts`); 3D baskı ikisine de dokunmaz ama **üç PR birden**
aynı doküman yüzeylerini düzenler (`docs/SISTEM_TANITIMI.md`,
`docs/PAZARLAMACI_REHBERI.md`, `help/pages/{tr,en}/marketplace/products.mdx`).
Bağlayıcı kurallar:

1. **Migration damgaları tahsis edildi** (§6 tablosu):
   `20260820120000_reprice_licence_and_stock` →
   **`20260820130000_delivery_platforms_bundle`** →
   `20260820150000_card_shift_schema` →
   `20260820160000_card_shift_catalog` →
   `20260820170000_print3d_service`.
   Hiçbir PR "reprice'tan sonraki ilk boş slot" diye kendi damgasını seçmez.
2. **`alacarte-catalog-migration.spec.ts`**: katlama mekanizmasının sahibi
   **bu PR**'dır. `introduced` hesabı tek biçimde yazılır (taban dosyanın
   `parsed` çıktısı, §7 T2/3); **kartlı vardiya** yalnız `FOLLOW_UP_SQL`'e
   **damga sırasına göre** bir satır ekler ve aynı `effective`/`introduced`
   bloklarını birebir kullanır (kartlı vardiya spec'i §6.3/2 ve §6.3/5). **3D
   baskı bu dosyaya dokunmaz.** Dosya yolları **asla indeksle** adreslenmez
   (§2 K10).
3. **`catalog-validation.spec.ts`**: `delivery_*` invaryantının sahibi bu PR.
   Kartlı vardiya aynı dosyaya iki yeni `it()` ekliyor ama `delivery_*`
   testinin şekline dokunmuyor; 3D baskı bu dosyaya dokunmuyor.
4. **`docs/SISTEM_TANITIMI.md`, `docs/PAZARLAMACI_REHBERI.md` ve
   `help/pages/{tr,en}/marketplace/products.mdx`**: **üç PR birden** bu üç
   yüzeyi düzenliyor (bu PR satır *değiştiriyor/daraltıyor*, kartlı vardiya ve
   3D baskı satır *ekliyor*). Tabloları/bölümleri "bütünüyle yeniden üretmek"
   YASAK. Merge sırası: **bu PR → kartlı vardiya → 3D baskı**. Sonra merge olan
   PR, kendi mutlak satır çıpalarını **içerik eşlemesiyle** yeniden çözer, satır
   numarasına güvenmez: bu PR `products.mdx` tr:173-212'yi tek bölüme
   daralttığı an sonraki her mutlak numara kayar.

### R15 — 🔴 48 saatlik deploy penceresi: uçuştaki ödeme niyetleri
`INTENT_TTL_HOURS = 48` (A17). Migration anında ödenmiş ama provision edilmemiş
bir intent eski bir SKU adını taşıyorsa, settlement yeniden teklif alır, arşivli
satır düşer, 1-kuruş toleransı aşılır ve **kart çekilmişken provision reddedilir**
(A18). Otomatik iade rayı **yoktur**. §6.1 adım 0 bunu `RAISE EXCEPTION` ile
kilitler: migration çalışmaz, deploy durur. Operatör prosedürü: deploy penceresini
düşük trafikli saate al, adım 0'ın sorgusunu **önceden** çalıştır, sıfır dönene
kadar bekle (en fazla 48 saat), sonra deploy et. Kilit kaldırılmaz — kaldırmak
sessiz para/hizmet uyuşmazlığını geri getirir.

### R16 — 🟠 Yıl dönümü gelmiş/geçmiş açık yenileme döngüleri ELLE mutabık kılınır
§6.1 adım 4 yalnız **gelecek** yıl dönümlü açık döngüleri siler.
`nextAnniversary()` bugün ≥ yıl dönümü olduğunda bir sonraki yıla atladığından
(A19), yıl dönümü gelmiş bir döngüyü silmek onu **kalıcı olarak** yok eder:
kiracı o yenileme için hiç faturalanmaz ve `lapseUnpaidCycles` tetiklenmediği için
bayat `TenantAddOn` satırları hiç `expired` olmaz — ödediği her yetkiyi süresiz
bedava kullanır (A20). Bu yüzden o satırlara **dokunulmaz**; bedeli, kiracı ödemeye
kalkarsa settlement'ın 1-kuruş toleransında reddetmesidir. §6.3 adım 0b sorgusu bu
satırları listeler; operatör her biri için ya döngüyü elle `cancelled` yapıp yeni
yıl dönümü döngüsünü bekler ya da farkı elle tahsil eder. Deploy öncesi bu liste
**boş olmalıdır**; boş değilse karar operatörün.

### R17 — 🟡 K5b adımları bugünkü veride SIFIR satır eşler; yine de doğru olmak zorundalar
§2 K5b **onaylandı** (2026-08-20) ve §6.1'in 0/3a/3b/3c/4 adımları koşulsuz yazılır.
Kalan risk teknik değil **operasyoneldir** ve iki maddeden ibarettir:

1. **Sıfır-satır beklentisi.** Üründe bugün canlı ödeyen kiracı yoktur; adım 0'ın
   sorgusu, adım 3a/3b/3c'nin `tenant_addons` eşleşmeleri ve adım 4'ün
   `renewal_cycles` eşleşmeleri **0 satır** döndürmelidir. Bu bir varsayımdır,
   garanti değil: deploy öncesi §6.3 adım 0 ve adım 0b sorguları **prod'da**
   çalıştırılır. Herhangi biri sıfırdan farklı dönerse varsayım bayatlamıştır —
   deploy durur, sonuç okunur ve §8 R15/R16 prosedürleri işletilir. "Nasılsa boş"
   diyerek atlamak, bu spec'in kapattığı para/hizmet uyuşmazlığını geri getirir.
2. **Deploy penceresi.** Adım 0 bir `RAISE EXCEPTION` kapısıdır ve uçuşta bir ödeme
   niyeti varsa migration'ı **çalıştırmaz** (`INTENT_TTL_HOURS = 48`, A17). Pencere
   buna göre seçilir: düşük trafikli saat, adım 0 sorgusu önceden sıfır dönene kadar
   bekleme (en fazla 48 saat), sonra deploy. Ayrıntı R15.

Her ifade korumalı (`WHERE`/`NOT EXISTS`/status filtresi) ve tersine çevrilebilirdir
(§6.2), bu yüzden sıfır satır eşleseler bile göndermenin maliyeti yoktur; ilk ödeyen
kiracı geldiğinde migration zaten doğrudur.

---

## 9. Kapsam dışı / sonraki adımlar

- **A1 — Semt rotalarının alan-geneli teslimat kapısından muafiyeti.**
  Semt ücretsiz olacak, ama `@RequiresIntegration("delivery")` sınıf
  seviyesinde ve sağlayıcı taşımıyor (`delivery-platforms.controller.ts:40`) —
  yani Semt entegrasyonu indiğinde, paketi satın almamış bir kiracı Semt
  ayarlarına dahi erişemez. Çözüm için bugün **var olmayan** bir vendor→platform
  haritası gerekir. Sözlük uyuşmazlığı da burada patlar: grant vendor id'leri
  küçük harf (`"trendyol_yemek"`) iken enum `TRENDYOL`, ve **bugün `"migros"`
  diye bir vendor id hiç yok** (paket onu ilk kez tanıtıyor). Bu haritayı
  `entitlement-keys.const.ts` ile `platform.enum.ts` arasında tek yerde tanımlamak
  Semt PR'ının ilk işi olmalı; T6 testi eşlemeyi şimdiden pinliyor.
- **A2 — Semt adaptörü, webhook'u, menü senkronu, sandbox host'u.** Yok.
  `PLATFORM_AVAILABILITY[SEMT]`'i `'available'` yapmak, adaptör + fabrika kaydı +
  `REQUIRED_CREDENTIALS` + `PLATFORM_FIELDS` + webhook rotası + `PLATFORMS_WITH_REAL_SANDBOX`
  kararı olmadan yapılmamalıdır.
- **A3 — Katalogda para birimi boyutu.** `AlaCarteProduct.priceCents` tek
  para birimi varsayıyor; UZ/KG açılımı bunu kıracak (T11).
- **A4 — Fiyat reklamı için drift testi.** R9'daki sekiz yüzeyi
  (`docs/`, `presentation/`, kök PDF, `frontend/src/marketing/`, `developer/pages/`,
  `help/pages/`, `landing/`) `ALACARTE_CATALOG`'a bağlayan bir script
  (ör. `scripts/check-price-drift.mjs`) bu tür sessiz bayatlamayı bitirir; bu PR'ın
  kapsamında değil. Bu değişiklik tek başına **24 elle düzenlenen doküman yüzeyi**
  gerektiriyor — maliyeti kanıtlayan en iyi örnek budur.
- **A6 — `moduleContent.generated.ts` üreteci.** F8b dosyayı **elle** düzeltiyor,
  oysa başlığı "regenerate" diyor. Deep-dive workflow'unun kaynak istemini tek
  pakete göre güncellemek ayrı bir iştir; yapılmazsa bir sonraki yeniden üretim
  "her platform ayrı satılır" iddiasını geri getirir.
- **A7 — `checkout_intents` için uçuş-öncesi kilidin genelleştirilmesi.** §6.1
  adım 0 bu migration'a özeldir. Katalog satırı arşivleyen HER migration aynı
  tuzağa düşer; kilidi yeniden kullanılabilir bir SQL parçacığına (veya bir
  `@doctor:` kuralına) çevirmek sonraki emeklilik işlerinin ilk maddesi olmalı.
- **A5 — `20260811100000_alacarte_catalog/down.sql`'in bayatlığı.** P1'in down'ı
  `delivery_yemeksepeti` vb. satırları ₺249,00 (24900 kuruş) "recurring" haline
  geri döndürür (satır 46-61) — bu, v3.3 öncesi gerçek durumdu ve doğrudur;
  ama artık üç aşamalı bir geri sarma zinciri var (paket → reprice → P1). Tam
  rollback prosedürünün belgelenmesi ayrı bir iş.
