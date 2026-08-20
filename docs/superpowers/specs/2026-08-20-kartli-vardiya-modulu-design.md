# Kartlı vardiya modülü (`module_personnel_card_shift`) — tasarım

**Tarih:** 2026-08-20
**Durum:** ONAYLANDI — kararlar kesin, bu belge kayıt amaçlıdır (yeniden tartışılmaz)
**Branch:** `feat/multi-country-architecture` (Change 2)
**Sürüm hedefi:** v3.6.8

> **Satır numarası uyarısı.** Aşağıdaki tüm `dosya:satır` çapaları 2026-08-20 tarihli **çalışma
> ağacına** göre yeniden doğrulanmıştır. `alacarte-catalog.const.ts` ve
> `alacarte-catalog-migration.spec.ts` commit edilmemiş v3.6.7 yeniden fiyatlama düzenlemesini
> taşıyor **ve o düzenleme bitmiş durumdadır** (57 dosya + izlenmeyen
> `backend/prisma/migrations/20260820120000_reprice_licence_and_stock/`); çapalar o hâle göre
> yazılmıştır ve Change 1/2/3 merge edildikçe yeniden doğrulanmalıdır.
>
> **Katalog tripwire'ı YEŞİL — kırmızı değil.**
> `cd backend && npx jest src/modules/marketplace/alacarte-catalog-migration.spec.ts` →
> **9 passed / 0 failed** (2026-08-20'de çalıştırıldı). Katlama mekanizması **hâlihazırda vardır**:
> `FOLLOW_UP_SQL` (:42-44), `parseRepricing` (:100-111), `parseArchived` (:113-122), `effective`
> (:137-140); `20260820120000_reprice_licence_and_stock` hem `migration.sql` hem `down.sql`
> gönderiyor. Bu değişiklik katlayıcıyı **sıfırdan yazmaz** — ona bir follow-up dosyası ekler ve
> INSERT'lenen satırları görmesini öğretir (§6.3). Süit bu düzenlemeden sonra kızarırsa sebep bu
> düzenlemedir.

---

## 1. Amaç ve kapsam

### Ne çıkıyor

1. **Yeni katalog ürünü** `module_personnel_card_shift` — ₺4.000 **tek seferlik**, `module_personnel`
   bağımlılığı, lisans ön koşulu, `feature.cardShift` grant'i.
2. **Yeni yetenek anahtarı** `cardShift` — T4'ün gerektirdiği her yerde senkron.
3. **GERÇEK yazılım rayı** (vapor değil): personele kart UID'si, kart okutma ile giriş/çıkış
   endpoint'i, "Kartlı Vardiya" istasyon ekranı, kart kaynaklı puantaj raporlaması. Hepsi mevcut
   `Attendance` / `ShiftAssignment` modellerinin **üstüne** kuruluyor; paralel bir devam sistemi
   kurulmuyor.
4. **İki ön koşul düzeltmesi aynı PR'da** (ikisi de bugün latent, kartlı vardiya bunları ilk kez
   canlıya çıkarıyor çünkü katalogdaki **ilk modül→modül bağımlılığı** budur):
   - (a) Vitrin `deps`'e kör: `/v1/catalog/pricing` `deps` seçmiyor, `PricingProduct` tipinde alan
     yok, `CatalogStore` yalnız lisansı sepete kendiliğinden ekliyor.
   - (b) Provizyon sırası: `KIND_RANK`'te `module` ve `integration` aynı rütbede (1) ve
     `Array.prototype.sort` **kararlı**; `[card_shift, module_personnel]` sıralı bir sepette bağımlı
     ürün ÖNCE provizyonlanıyor, `purchase()`'ın ACTIVE-only dep kontrolü fırlıyor ve tüm
     Serializable tx — tahsilat yapıldıktan sonra — geri sarılıyor.
5. **Donanım SKU'su**: USB HID RFID personel kart okuyucu + 10 kart paketi, stoklu ve kargolu,
   ayrı satılan `HardwareProduct` satırı; yeni `card_reader` kategorisi.
6. **Yanlış pazarlama iddiasının düzeltilmesi**: `docs/SISTEM_TANITIMI.md:217` bugün var olmayan bir
   şeyi ("QR/NFC kart ile damgalar") satıyor; bu değişiklik onu doğru hale getiriyor.
7. **Kataloğu elle sayan 11 yüzeyin senkronu**: satış broşürü ve saha rehberi fiyat tabloları,
   geliştirici portalının "Catalogue summary" + yetki matrisi, yardım portalının ürün/fiyat/özellik
   sayfaları ve donanım kılavuz indeksi. Envanter §3.6, iş listesi §5/42-49. Hiçbir CI kapısı bunu
   zorlamıyor, bu yüzden spec zorluyor (§8 Risk 13).

### Ne ÇIKMIYOR (bilinçli)

- **QR ile damgalama.** Yalnız RFID/HID kart. `SISTEM_TANITIMI.md` metni de buna göre düzeltilecek
  ("QR/NFC" → "RFID kart").
- **Cihaz entegrasyonu / sürücü.** Ucuz USB HID okuyucular UID'yi klavye gibi yazar; backend'de
  cihaz protokolü yok, sadece bir metin girdisi var.
- **Kiosk için ayrı cihaz-token rayı.** İstasyon ekranı ADMIN/MANAGER oturumu üzerinde çalışır
  (§9'da sonraki adım olarak kayıtlı).
- **Bordro / ücret hesabı.** Sistemde ücret rayı yoktur; `getAttendanceSummaryCsv` bunu açıkça
  belirtir (`attendance.service.ts:528-533`) ve bu değişiklik parasal hiçbir kolon eklemez.
- **Yüz tanıma / parmak izi / PIN ile damgalama.**
- **Çoklu para birimi.** Fiyat TRY literal'i (bkz. T11, §8).
- **`SubscriptionPlan` tablosuna yeni feature kolonu** (gerekçe: §2, K7).

---

## 2. Kararlar (kesin)

| # | Karar | Tek satır gerekçe |
|---|---|---|
| K1 | Katalog kodu `module_personnel_card_shift`, `kind: "module"`, `billing: "oneTime"`, `priceCents: 400_000` | Kodlar DEĞİŞMEZ; `module_` öneki mevcut modül adlandırmasıyla aynı; ₺4.000 tek seferlik. |
| K2 | `deps: ["module_personnel"]`, `requiresLicense: true`, `grants: { "feature.cardShift": true }` | Kartlı vardiya, puantaj ekranının üstüne biner; puantaj yoksa satılacak bir şey yok. |
| K3 | `sortOrder: 18` | Bugün kullanılan sıralar: 0, 10–16, 20–22 (üç `delivery_*`, `alacarte-catalog.const.ts:367-369`), 24, 25, 26, 30, 40–43, 50 → 17/18/19/23 **zaten boş**. Change 1 ayrıca 21 ve 22'yi boşaltıp 20'yi paket satırına veriyor; 18 **her iki durumda da** boştur ve hiçbir spec onu istemiyor (çakışma testi: `catalog-validation.spec.ts:226`). |
| K4 | `maxQuantity` **verilmez** (undefined) | `evaluatePurchasability` `maxQuantity`'yi yalnız `kind:'capacity'` için okur (`addon-purchasability.rules.ts:124-133`); modülde ikinci alımı `isOwned` bloklar (a.g.e.:134-139). |
| K5 | `module` + `oneTime` **yasaldır** | `catalog-validation.ts` yalnız `license→annual` (:161), `credit→oneTime` ve `service→oneTime` kadans kuralı koyar; `case "module"` (:169-172) sadece "en az bir `feature.*` grant" ister. |
| K6 | Kilit **kalıcıdır, hiç yenilenmez** | `purchase()` `billing === "oneTime"` satırında `currentPeriodEnd`'i null bırakır (`tenant-marketplace.service.ts:261-273`); süpürücü `currentPeriodEnd: { lte: now, not: null }` filtresiyle çalışır (`tenant-addon-sweeper.service.ts:79`), yani null satır **hiç taranmaz**; projektör de `validUntil = null` yazar (`plan-projector.service.ts:295-299`). |
| K7 | Yeni `cardShift` bayrağı `SubscriptionPlan` tablosuna **kolon olarak eklenmez** | Plan rayı emekli: projektör plan satırından tek bir feature kolonu okumuyor — `include: { currentPlan: true }` (`plan-projector.service.ts:79`) dışında `plan.` erişimi yok; yeni kolon ölü ağırlık olurdu. |
| K8 | Kart UID'si **peppered HMAC** ile saklanır, düz metin saklanmaz | UID kimlik-benzeri bir sırdır; 32-bit entropili olduğu için çıplak sha256 saniyeler içinde kırılır — `ENCRYPTION_MASTER_KEY`'den türeyen HMAC anahtarı DB dump'ında yoktur. |
| K9 | Benzersizlik `@@unique([tenantId, staffCardUidHash])` | HMAC girdisine `tenantId` de karıştığı için aynı fiziksel kart iki tenant'ta farklı hash üretir (cross-tenant korelasyon yok); index tek tenant içinde iki personelin aynı kartı taşımasını engeller. |
| K10 | Tap endpoint'i **toggle**: açık kayıt yoksa `clockIn`, `CLOCKED_IN` ise `clockOut`, `ON_BREAK` ise `breakEnd` | Kiosk'ta başka kontrol yoktur; molada kalan personeli hata mesajıyla kilitlemek kabul edilemez. Mola **başlatma** uygulama içi kalır. |
| K11 | 10 saniyelik **debounce**: aynı personelin ikinci okutması `action: "ignored"` döner | HID okuyucular tek kart için iki kez yazabilir; ikinci yazma aksi halde vardiyayı anında kapatır. |
| K12 | Tanınmayan kart → `404 { code: "CARD_NOT_RECOGNISED" }`, log'da yalnız son 4 hane | Kart numarası enumerasyonuna ve log sızıntısına kapalı. |
| K13 | Tap endpoint'i `@Throttle({ default: { limit: 30, ttl: 60_000 } })` | `default` profili canlı (`common/config/throttler.config.ts:31-36`); 30/dk bir personel girişi için fazlasıyla yeterli, brute-force için değil. |
| K14 | İstasyon endpoint'i `@Roles(ADMIN, MANAGER)` + `@RequiresFeature(PERSONNEL_MANAGEMENT, CARD_SHIFT)` | Yeni bir cihaz-kimlik rayı icat etmemek için; istasyon tableti yönetici oturumunda durur. |
| K15 | Metot düzeyi `@RequiresFeature` **iki bayrağı birden** listeler | Guard `getAllAndOverride([handler, class])` kullanır (`entitlement.guard.ts:62-66`): metot dekoratörü sınıf dekoratörünü **ezer**, eklemez. |
| K16 | Donanım kategorisi olarak **yeni `card_reader` değeri** eklenir | Mevcut en yakın değer `scanner` = "Barkod Okuyucu" (`category-vocabulary.ts:22`); vitrin filtresinde yalan olurdu ve sözlük tam da tek noktadan genişletilmek için var. |
| K17 | Donanım fiyatı **₺1.290** (129_000 kuruş), okuyucu + 10 Mifare kart paketi | TR perakendede 13.56 MHz USB HID okuyucu ~₺700–1.100, 10 kart ~₺200; paket maliyeti ~₺900, ₺1.290 makul donanım marjı bırakır. **Gösterge niteliğinde açılış fiyatıdır; superadmin panelinden düzenlenebilir.** |
| K18 | `Attendance`'a `clockInSource` / `clockOutSource` kolonları | "Kart bazlı puantaj raporlaması" ancak kaynağı ayırt edebilirsen mümkündür; giriş ve çıkış farklı kaynaklardan gelebilir. |
| K19 | Drift spec'inin **mevcut katlayıcısı (fold) GENİŞLETİLİR** — sıfırdan yazılmaz, uygulanmış migration **düzenlenmez** | Katlayıcı ağaçta zaten var ve yeşil (`FOLLOW_UP_SQL` :42-44, `parseRepricing` :100-111, `parseArchived` :113-122, `effective` :137-140; 9/9 passed). Prod `prisma migrate deploy` checksum doğrular; uygulanmış bir dosyayı düzenlemek deploy'u kırar. Bu değişiklik yalnız follow-up INSERT'lerini görünür kılar (§6.3). Testi "düzeltmek" spec'in kendi başlığıyla yasak. |
| K20 | Bağımlılık otomatik sepete eklenirken **yalnız `status === "active"`** sahiplik dep'i karşılar | `purchase()` dep kontrolü ACTIVE-only'dir (`tenant-marketplace.service.ts:229-242`); `past_due` bir `module_personnel` "sahip" görünüp provizyonda patlar. |
| K21 | ₺4.000'lık **kalıcı** kilit, yıllık lisans sönerse **kararır** — bilinçli ve kabul edilmiş sonuç | `requiresLicense: true` olan her ürünün grant'i lisans karanlıkken bastırılır (`plan-projector.service.ts:282`); kartlı vardiyayı istisna yapmak tek bir ödenmiş modülü lisans rayının dışına çıkarır ve "lisans ücretli modülleri açar" kuralını kataloğun tamamı için delerdi. Sahiplik satırı ve kart verisi silinmez, lisans dönünce yeniden yanar; mağaza metni ve yardım sayfası bunu açıkça yazar (§8 Risk 3). |
| K22 | Kart UID'sinin HMAC'inin yanına **geri döndürülebilir bir kopya** da yazılır: `staffCardUidEnc` (AES-256-GCM, AAD = `staffcard:v1:<tenantId>:<userId>`) | `ENCRYPTION_MASTER_KEY` bugün **yalnız** geri döndürülebilir şifreleme için kullanılıyor (`encryption.helper.ts:53-64` anahtar türetme, `:66-82` `encryptJson`+AAD, `:134-141` `encryptString`); anahtar döndüğünde HMAC yeniden türetilemez ve sahadaki **her kart aynı anda ölürdü**. Kopya yalnız yeniden-hash işi tarafından okunur: tap yolunda okunmaz, hiçbir uç onu döndürmez. |

---

## 3. Mevcut durum (doğrulanmış çapalar)

### 3.1 Katalog ve yetenek sözlüğü

| Gerçek | Yer |
|---|---|
| `AlaCarteProduct` arayüzü (code…i18n) | `backend/src/modules/marketplace/alacarte-catalog.const.ts:22-44` |
| `ALACARTE_CATALOG` dizisi | a.g.e.:60 |
| `module_personnel` (annual, 99_000, `feature.personnelManagement`, `sortOrder: 13`) | a.g.e.:221-255 |
| `t(tr, en, ru, ar, uz)` yardımcısı — beş dilin `[name, description]` ikilisi | a.g.e.:46-58 |
| Literal `sortOrder` 16'dan doğrudan 24'e atlıyor; **aradaki 20/21/22 literal DEĞİL**, üç `delivery_*` satırını üreten `...map(...)` bloğundan geliyor (`:364-412`, damgalar `:367-369`) → gerçekte boş olanlar **17, 18, 19, 23** | a.g.e.:337 (`16`), :367-369 (20/21/22), :431 (`24`) |
| En büyük kullanılan `sortOrder` = 50 (`onsite_install_full`) | a.g.e.:707-717 |
| `module` için tek kural: en az bir `feature.*` grant — **kadans kuralı YOK** | `backend/src/modules/marketplace/catalog-validation.ts:169-172` |
| `license` için `billing !== "annual"` hatası (tek kadans kuralı) | a.g.e.:161-163 |
| `FEATURE_KEYS` listesi (`personnelManagement` :45) | `backend/src/modules/entitlements/entitlement-keys.const.ts:26-51` |
| `isKnownGrantKey` — bilinmeyen anahtarı reddeder | a.g.e.:132-142 |
| `PlanFeature.PERSONNEL_MANAGEMENT = "personnelManagement"` | `backend/src/common/constants/subscription.enum.ts:112` |
| Çift yönlü tripwire: `PlanFeature` ⊆ `FEATURE_KEYS` **ve** fark yalnız `["license"]` | `backend/src/modules/entitlements/entitlement-keys.spec.ts:14-32` |
| `@RequiresFeature` = `@RequireEntitlement({feature:...})` alias'ı | `backend/src/modules/subscriptions/decorators/requires-feature.decorator.ts:28` |
| Guard `getAllAndOverride([handler, class])` — metot sınıfı **ezer**; birden çok gereksinim AND'lenir | `backend/src/modules/entitlements/entitlement.guard.ts:62-66`, :83-127 |
| `requiresLicense` ürünlerin grant'leri lisans karanlıkken bastırılır | `backend/src/modules/entitlements/plan-projector.service.ts:264-282` |
| oneTime satır → `validUntil: null` (süresiz) | a.g.e.:295-299 |
| Projektör plan feature kolonu **okumuyor** | a.g.e.:79 (tek `currentPlan` teması) |

### 3.2 Para rayı

| Gerçek | Yer |
|---|---|
| `annual` → gün-orantılı; `oneTime` → düz fiyat, dönem yok | `backend/src/modules/checkout/quote.service.ts:88-114`, :127-146 |
| Fiyatlar KDV-DAHİL brüt; vergi **içeriden türetilir** | a.g.e.:313-326 |
| Sepet-farkında ön-tahsilat guard'ı (kardeş satır dep'i karşılar) | `backend/src/modules/checkout/checkout-intent.service.ts:149-165` |
| `assertDeps` — **ACTIVE** sahiplik veya sepet satırı | `backend/src/modules/checkout/addon-purchasability.service.ts:126-165` |
| `ADDON_REQUIRES_DEPENDENCY` union'da var ama saf kural fonksiyonundan **hiç dönmez** | `backend/src/modules/checkout/addon-purchasability.rules.ts:9` |
| `purchase()` ikinci savunma: ACTIVE-only dep kontrolü | `backend/src/modules/marketplace/tenant-marketplace.service.ts:229-242` |
| `KIND_RANK` — `module: 1`, `integration: 1`; kararlı sıralama | `backend/src/modules/checkout/checkout.service.ts:444-456`, döngü :458 |
| oneTime satır `currentPeriodEnd = null` | `backend/src/modules/marketplace/tenant-marketplace.service.ts:261-273` |
| Süpürücü yalnız `currentPeriodEnd not null` satırları tarar | `backend/src/modules/marketplace/tenant-addon-sweeper.service.ts:76-88`; oneTime kapanış dalı :149 (bu satıra **hiç ulaşılmaz**) |
| `/v1/catalog/pricing` select listesi — `deps` **YOK** | `backend/src/modules/licensing/licensing.controller.ts:199-238` (select :204-218, yanıt eşlemesi :221-236) |
| `/v1/me/licensing` katalog select'i — `deps` **YOK** | a.g.e.:71-84 |
| `buildPurchasability` `cartCodes` olarak yalnız lisansı modeller | a.g.e.:281-287 |

### 3.3 Personel modülü (üstüne inşa edilecek olan)

| Gerçek | Yer |
|---|---|
| `Attendance` modeli: `date @db.Date`, `clockIn`, `clockOut?`, `breakStart/End?`, `totalWorkedMinutes`, `totalBreakMinutes`, `overtimeMinutes`, `status`, `isLate`, `lateMinutes`, `notes?`, `shiftAssignmentId?`, `userId`, `tenantId`, `branchId`; `@@unique([userId, date])` | `backend/prisma/schema.prisma:3769-3810` |
| `ShiftTemplate` (`startTime`/`endTime` "HH:mm", `gracePeriodMinutes`) | a.g.e.:3812-3835 |
| `ShiftAssignment` (`@@unique([userId, date, branchId])`) | a.g.e.:3838-3870 |
| `ShiftSwapRequest` (iki aşamalı onay) | a.g.e.:3873-3913 |
| `AttendanceStatus` = CLOCKED_IN / ON_BREAK / CLOCKED_OUT | `backend/src/modules/personnel/constants/personnel.enum.ts:1-5` |
| `AttendanceController` — sınıf düzeyinde `@RequiresFeature(PlanFeature.PERSONNEL_MANAGEMENT)` | `backend/src/modules/personnel/controllers/attendance.controller.ts:29-34` |
| `POST /personnel/attendance/clock-in` + `ClockInDto { notes? }` | a.g.e.:37-48; `backend/src/modules/personnel/dto/clock-in.dto.ts:5-16` |
| `clockOut` / `break-start` / `break-end` / `my-status` / `today` / `` / `summary` / `summary/export` | a.g.e.:50-146 |
| `AttendanceService.clockIn(tenantId, userId, notes?)` — tenant TZ günü, geç kalma, `primaryBranchId` fallback, P2002 yakalama | `backend/src/modules/personnel/services/attendance.service.ts:98-197` |
| `clockOut(tenantId, userId)` — **status'a göre** açık kaydı bulur (gece aşan vardiya) | a.g.e.:200-281 |
| `breakStart` :283, `breakEnd` :331, `getMyStatus` :391, `getTodayAttendance` :424 | a.g.e. |
| `getAttendanceSummary` — kullanıcı bazında toplam | a.g.e.:477-532 |
| `getAttendanceSummaryCsv` — CSV formül-enjeksiyonu koruması, **para kolonu yok** | a.g.e.:534-608 |
| CSV başlığı testte birebir sabitli | `backend/src/modules/personnel/services/attendance.service.spec.ts:206-230` (başlık iddiası :223-225, para yasağı :226, veri satırı :229) |
| `AttendanceQueryDto` (startDate/endDate/userId/status/page/limit) | `backend/src/modules/personnel/dto/attendance-query.dto.ts:15-51` |
| Modül kaydı (controller + service listeleri) | `backend/src/modules/personnel/personnel.module.ts:16-38` |
| `User` modeli — `hourlyRate`, `primaryBranchId`, `approvedBy`/`reactivatedBy` self-relation deseni | `backend/prisma/schema.prisma:243-346` (`@@map("users")` :346) |
| FE: `TeamPage` sekmeleri (`users` / `attendance`), `hasFeature('personnelManagement')` | `frontend/src/pages/admin/TeamPage.tsx:17-39, 83` |
| FE: `AttendanceTab` | `frontend/src/components/personnel/AttendanceTab.tsx` |
| FE: `personnelApi.ts` query/mutation'ları | `frontend/src/features/personnel/personnelApi.ts:26-80+` |
| FE: `usePersonnelSocket` → `personnel:attendance-update` | `frontend/src/features/personnel/usePersonnelSocket.ts:28` |
| FE: `Attendance` tipi | `frontend/src/types/index.ts:1674-1695`, `AttendanceSummary` :1742-1750 |
| FE: personel i18n ad alanı (132 anahtar, 5 dil) | `frontend/src/i18n/locales/{tr,en,ru,ar,uz}/personnel.json` |

### 3.4 Donanım rayı

| Gerçek | Yer |
|---|---|
| `HardwareProduct` — kategori sözlüğü yorumu, `saleMode`, `complianceDocs`, `stockStatus` | `backend/prisma/schema.prisma:5333-5399` |
| `HardwareInventory` (`available/allocated/shipped`, `@@unique([productId])`) | a.g.e.:5403-5418 |
| Kategori sözlüğü (tek kaynak) — `scanner` = "Barkod Okuyucu" | `backend/src/modules/catalog/category-vocabulary.ts:16-32` |
| `@IsIn` gate'i sözlükten türer | `backend/src/modules/catalog/dto/create-hardware-product.dto.ts:25-29, 76-78` |
| `CATEGORY_DEFAULT_SALE_MODE` | a.g.e.:46-60 |
| Sözlük invariant spec'i | `backend/src/modules/catalog/category-vocabulary.spec.ts:13-35` |
| `GET /v1/catalog/categories` (SPA filtresi buradan besleniyor) | `backend/src/modules/catalog/catalog.controller.ts:41-46`; `frontend/src/features/hardware-store/storeApi.ts:153-160` |
| Seed donanım satırları + `available: 25` create-only stok | `backend/prisma/seeds/seed-marketplace.ts:1070-1111` |
| Örnek scanner satırları (fiyat/garanti biçimi) | a.g.e.:269-301 |
| `HardwareSaleMode` PG enum'u | `backend/prisma/migrations/20260603110000_add_hardware_sale_mode/migration.sql:2` |
| Superadmin ürün formunda **elle yazılmış** kategori `<select>`'i (zaten drift'te: `cash_drawer`/`scale`/`accessory`/`cable`/`service` eksik, sözlükte olmayan `other` fazladan) | `frontend/src/pages/superadmin/MarketplaceAdminPage.tsx:602-612` (`<option>` satırları :603-611); sözlük `category-vocabulary.ts:16-31`, `CATEGORY_VALUES` :33 |

### 3.5 Bugün yanlış olan pazarlama metni

- `docs/SISTEM_TANITIMI.md:217` — *"**Giriş-çıkış (clock-in/out)**: personel kendi şifresi ile veya
  QR/NFC kart ile damgalar"*. Kart ile damgalama **yoktur**; `clock-in` yalnız oturum açmış
  kullanıcının kendi JWT'siyle çalışır (`attendance.controller.ts:44-48`).
- **DOĞRULAMA SONUCU — onaylı tanımda hata:** `docs/marketing/uzbekistan/UZ_EXPANSION_BENCHMARK.md`
  kartlı vardiya **iddia etmiyor**. Dosyadaki tüm "shift" geçişleri fiskal KKM vardiya aç/kapa ve
  Z-raporu ile ilgilidir (:121, :279, :491) ve "card" geçişleri kart ödemesi/UzCard-HUMO'dur.
  Bu dosyada düzeltilecek bir şey yok; §5'te ona göre yer almıyor.

### 3.6 Kataloğu **elle** sayan yüzeyler (yeni ürün buralara da yazılmazsa sessizce eskir)

| Yüzey | Yer (doğrulandı 2026-08-20) |
|---|---|
| Satış broşürü ücretli katalog tablosu (her kalem tek tek) | `docs/SISTEM_TANITIMI.md:80-97` — "Personel Yönetimi / modül · yıllık / ₺990" satırı :86, "Yerinde Kurulum & Eğitim / hizmet · tek seferlik / ₺7.500" satırı :97 |
| Saha satış rehberi modül tablosu | `docs/PAZARLAMACI_REHBERI.md:71-79` (Personel Yönetimi :75) |
| Saha satış rehberi "Hizmet (tek seferlik)" tablosu; **donanım tablosu hiç yok** | a.g.e.:110-114 |
| Geliştirici portalı "Catalogue summary" (Code/Kind/Billing/Price/Grants/Licence/Dependency) | `developer/pages/en/developer/marketplace-api.mdx:131-155` (`module_personnel` :137) + `developer/pages/tr/developer/marketplace-api.mdx` aynası |
| Geliştirici portalı yetki matrisi "Modules" tablosu (fiyat sütunu `₺…/yr` varsayıyor) | `developer/pages/en/reference/plan-matrix.mdx:92-103` (`module_personnel` :99) + `tr` aynası |
| Yardım portalı ürün ansiklopedisi (ürün başına bölüm) | `help/pages/tr/marketplace/products.mdx` — `## Modüller` :52, `### Personel Yönetimi` :95, `### Yerinde Kurulum & Eğitim (tek seferlik)` :345; `en` aynası |
| Yardım portalı fiyat tablosu | `help/pages/tr/marketplace/index.mdx:59-84` (Personel Yönetimi :65) + `en` aynası |
| Yardım portalı plan/modül fiyat listesi | `help/pages/tr/plans/index.mdx:72-81` (Personel Yönetimi :76) + `en` aynası |
| Yardım portalı özellik→ürün→fiyat matrisi | `help/pages/tr/plans/feature-matrix.mdx:40-52` (Personel yönetimi :43) + `en` aynası |
| Yardım portalı personel kılavuzu — damgalamanın **tek** yolu olarak uygulama içi giriş-çıkış | `help/pages/en/admin-guide/personnel.mdx:12` ("Requires: `personnelManagement`"), :16, :38-41; `tr` aynası |
| Donanım kılavuzları: `00-genel-cerceve.md` … `09-pos-terminal.md` + `README.md`; **sıradaki boş numara 10** | `docs/hardware/` |
| Donanım kılavuz indeksi (elle bakımlı bağlantı listesi) | `docs/hardware/README.md` — `## 3. Çevre Birimleri (Peripherals)` :27, bağlantılar :31-34 |
| Uygulamanın **tek** gezinme kaydı; her erişilebilir sayfa burada | `frontend/src/components/layout/Sidebar.tsx` — `NavItem` tipi :59-69 (`to`/`icon`/`labelKey`/`labelFallback`/`roles`/`gate`), `/admin/team` girdisi :155-165, feature kapısı `itemVisible` :321 |
| `ENCRYPTION_MASTER_KEY` bugün **yalnız** geri döndürülebilir AES-256-GCM için kullanılıyor (integrations config + delivery kimlik bilgileri) | `backend/src/common/helpers/encryption.helper.ts:53-64`, `:66-82`, `:134-141`; tüketiciler `settings/integrations/integrations.service.ts:222`, `delivery-platforms/services/delivery-config.service.ts:209` |
| Anahtar döndürmenin bilinen sonucu ("eski anahtarla şifrelenmiş satırlar çözülemez") zaten belgeli | `docs/DEPLOYMENT.md:44`, `:68-72`; `docs/infra/2026-06-25-production-readiness-audit.md:34` (tarihsel bir `.env`'de geçtiyse **döndür** talimatı) |

> **Not:** `docs/SECURITY_LEAKED_SECRETS_RUNBOOK.md` `ENCRYPTION_MASTER_KEY`'i sızmış secret olarak
> **listelemiyor** (listelenenler: `POSTGRES_PASSWORD`, `JWT_SECRET`, `JWT_REFRESH_SECRET`,
> `EMAIL_PASSWORD`, `DESKTOP_RELEASE_API_KEY`). Rotasyon yine de gerçek bir olasılıktır —
> yukarıdaki iki belge onu açıkça öngörüyor — ama "planlanmış" değildir.

---

## 4. Tasarım

### 4.1 Mimari — üç katman

```
[USB HID RFID okuyucu]  --(UID'yi klavye gibi yazar + Enter)-->  [Kartlı Vardiya istasyon ekranı]
                                                                            |
                                                    POST /api/personnel/attendance/card-tap
                                                                            v
                                          [CardShiftService: normalize -> HMAC -> user çöz]
                                                                            |
                                          mevcut AttendanceService.clockIn/clockOut/breakEnd
                                                                            v
                                     [Attendance satırı + kds gateway attendance-update yayını]
```

Yeni bir devam modeli **yok**. `CardShiftService` yalnız "hangi kullanıcı, hangi eylem" sorusunu
çözer ve mevcut `AttendanceService` metotlarını çağırır — geç kalma, mola, fazla mesai, gece aşan
vardiya, branş ataması ve P2002 yarış korumaları olduğu gibi devralınır.

### 4.2 Veri modeli

**`User` (prisma/schema.prisma, `@@map("users")`) — 4 yeni kolon + 1 unique:**

```prisma
  // --- Kartlı vardiya (v3.6.8). Kart UID'si kimlik-benzeri bir tanımlayıcıdır:
  // düz metin SAKLANMAZ. Saklanan değer ENCRYPTION_MASTER_KEY'den türeyen bir
  // pepper ile HMAC-SHA256'dır; girdiye tenantId de karışır, böylece aynı
  // fiziksel kart iki tenant'ta farklı hash üretir (cross-tenant korelasyon yok).
  // Çıplak sha256 yetmez: tipik bir kart UID'si 32 bit entropidir.
  staffCardUidHash      String?
  /// Normalize edilmiş UID'nin AES-256-GCM kopyası (`encryptString`, `v2:` biçimi,
  /// AAD = "staffcard:v1:<tenantId>:<userId>"). YALNIZCA ENCRYPTION_MASTER_KEY
  /// rotasyonunda "çöz → yeniden HMAC'le" işini mümkün kılmak için vardır (K22):
  /// tap yolunda okunmaz, hiçbir uç onu döndürmez, hiçbir log'a girmez.
  /// Kolon TEXT'tir çünkü `encryptString` tek bir kompakt string döndürür
  /// (`encryption.helper.ts:134-141`) — Json sarmalayıcıya gerek yok.
  staffCardUidEnc       String?
  /// Hash şeması sürümü. Rotasyon işi eski sürümdeki satırları bulup yeniden yazar.
  staffCardHashVersion  Int       @default(1)
  /// Fiziksel kartı personele eşlemek için gereken TEK gösterim yardımı.
  staffCardLast4        String?
  staffCardAssignedAt   DateTime?
  staffCardAssignedById String?
  staffCardAssignedBy   User?   @relation("StaffCardAssigner", fields: [staffCardAssignedById], references: [id], onDelete: SetNull)
  staffCardAssignments  User[]  @relation("StaffCardAssigner")

  @@unique([tenantId, staffCardUidHash])
```

**`Attendance` — 2 yeni kolon:**

```prisma
  /// manual | card — puantajın hangi yoldan damgalandığı. Giriş ve çıkış
  /// farklı kaynaklardan gelebilir (kartla gir, uygulamadan çık).
  clockInSource  String  @default("manual")
  clockOutSource String?
```

Yeni index **eklenmiyor**: raporlar zaten `tenantId + branchId + date` ile daralıyor ve kaynak
kolonunun kardinalitesi 2.

**Sabitler** — `backend/src/modules/personnel/constants/personnel.enum.ts`:

```ts
export enum AttendanceSource {
  MANUAL = "manual",
  CARD = "card",
}
```

### 4.3 Kart UID işleme

**Normalizasyon** (`backend/src/modules/personnel/card-uid.ts`, saf fonksiyon, IO yok):

```ts
export function normalizeCardUid(raw: string): string   // trim -> /[^0-9A-Za-z]/g sil -> toUpperCase()
export function isValidCardUid(v: string): boolean      // 4 <= uzunluk <= 32
export function cardUidHash(tenantId: string, uid: string): string
//   createHmac("sha256", process.env.ENCRYPTION_MASTER_KEY!)
//     .update(`staffcard:v1:${tenantId}:${normalizeCardUid(uid)}`).digest("hex")
export function cardUidLast4(uid: string): string       // normalize sonrası son 4 karakter
```

Gerekçe: okuyucular UID'yi 10 haneli ondalık, 8/14 haneli hex, iki nokta ayraçlı veya küçük harfli
yazabilir; aynı fiziksel kartın iki farklı hash üretmesi "kart tanınmadı" olarak görünürdü.
`ENCRYPTION_MASTER_KEY` zaten boot'ta zorunlu doğrulanıyor (`common/helpers/env-validation.ts:32`),
yani yeni bir env değişkeni yok. Ev üslubu deterministik kimlik-hash'leri için sha256 kullanıyor
(`partner-api-key.service.ts:42-44`, `local-bridge.service.ts:50`); burada düşük entropi nedeniyle
HMAC'e çıkılıyor ve bu sapma yorumda gerekçelendirilecek.

**Rotasyona dayanıklılık (K22).** Kart atama yolu hash'in yanında geri döndürülebilir kopyayı da
yazar:

```ts
// card-shift.service.ts, assign():
staffCardUidHash:    cardUidHash(tenantId, uid),
staffCardUidEnc:     encryptString(uid, `staffcard:v1:${tenantId}:${userId}`),  // encryption.helper.ts:134
staffCardHashVersion: 1,
staffCardLast4:      cardUidLast4(uid),
```

`ENCRYPTION_MASTER_KEY` döndüğünde çalıştırılacak iş (`backend/src/modules/personnel/card-uid.ts`
içindeki saf fonksiyonları kullanan tek seferlik script): **eski** anahtarla `decryptString` → **yeni**
anahtarla `cardUidHash` + `encryptString` → satırı güncelle. Bu kopya olmasaydı rotasyon sahadaki
**her kartı aynı anda** öldürürdü ve her tenant her kartı elle yeniden kaydetmek zorunda kalırdı
(§8 Risk 12). Kopya tap yolunda **hiç okunmaz**: tap yalnız hash ile eşleşir.

**Bilinmeyen kart:** `404 { code: "CARD_NOT_RECOGNISED", message: "Kart tanınmadı" }`. Log:
`logger.warn` yalnız `tenantId` + `last4`. Hiçbir yanıt/log ham UID veya hash taşımaz.

**Devre dışı personel:** `status !== "ACTIVE"` kullanıcı da `CARD_NOT_RECOGNISED` alır (varlık
sızdırmaz).

### 4.4 API

Yeni controller: `backend/src/modules/personnel/controllers/card-shift.controller.ts`
(`@Controller("personnel/cards")`) + tap ucu mevcut attendance controller'ına eklenir.

| Metot | Yol | Roller | Yetkilendirme | Notlar |
|---|---|---|---|---|
| POST | `/personnel/attendance/card-tap` | ADMIN, MANAGER | `@RequiresFeature(PlanFeature.PERSONNEL_MANAGEMENT, PlanFeature.CARD_SHIFT)` | `@Throttle({ default: { limit: 30, ttl: 60_000 } })`. Gövde `CardTapDto`. |
| POST | `/personnel/cards/:userId` | ADMIN, MANAGER | aynı ikili | Kart ata/değiştir. `@Throttle({ default: { limit: 20, ttl: 60_000 } })` |
| DELETE | `/personnel/cards/:userId` | ADMIN, MANAGER | aynı ikili | Kartı iptal et (üç kolonu da null'la). |
| GET | `/personnel/cards` | ADMIN, MANAGER | aynı ikili | Liste: `{ userId, firstName, lastName, role, last4, assignedAt, assignedById }` — **`staffCardUidHash` ve `staffCardUidEnc` asla dönmez**. |

> **K15 / T-guard:** metot düzeyinde `@RequiresFeature(...)` yazıldığı anda sınıf düzeyindeki
> `@RequiresFeature(PlanFeature.PERSONNEL_MANAGEMENT)` **ezilir** (`entitlement.guard.ts:62-66`).
> Bu yüzden her yeni uçta iki bayrak da tek çağrıda listelenir. Yeni controller sınıf düzeyinde
> `@RequiresFeature(PlanFeature.PERSONNEL_MANAGEMENT, PlanFeature.CARD_SHIFT)` taşır; metotlarında
> ayrıca entitlement dekoratörü **yoktur**.

**DTO'lar** (`backend/src/modules/personnel/dto/card-shift.dto.ts`) — T8: `whitelist: true` tanımsız
alanı sessizce siler, bu yüzden her alan açıkça tanımlıdır:

```ts
export class CardTapDto {
  @IsString() @MinLength(4) @MaxLength(64)
  @Matches(/^[0-9A-Za-z\s:.\-]{4,64}$/, { message: "cardUid contains unsupported characters" })
  cardUid: string;

  @IsOptional() @IsString() @MaxLength(500) notes?: string;   // ClockInDto.notes ile aynı sınır
}

export class AssignCardDto {
  @IsString() @MinLength(4) @MaxLength(64) @Matches(/^[0-9A-Za-z\s:.\-]{4,64}$/) cardUid: string;
}
```

**Tap yanıtı:**

```jsonc
{
  "action": "clockIn" | "clockOut" | "breakEnd" | "ignored",
  "user": { "id": "...", "firstName": "...", "lastName": "...", "role": "WAITER" },
  "attendance": { /* AttendanceService'in döndürdüğü satır */ },
  "message": "Hoş geldin, Ayşe — giriş 09:03"     // i18n anahtarı FE'de çözülür; BE sadece action döner
}
```

**Tap algoritması** (`CardShiftService.tap(tenantId, dto, actorUserId)`):

1. `uid = normalizeCardUid(dto.cardUid)`; geçersizse `400 CARD_UID_INVALID`.
2. `user = prisma.user.findFirst({ where: { tenantId, status: "ACTIVE", staffCardUidHash: cardUidHash(tenantId, uid) }, select: { id, firstName, lastName, role, primaryBranchId } })`
   → yoksa `404 CARD_NOT_RECOGNISED`.
3. Açık kaydı oku: `attendance.findFirst({ where: { tenantId, userId, status: { in: [CLOCKED_IN, ON_BREAK] } }, orderBy: { clockIn: "desc" } })` — `clockOut()`'un kullandığı sorgu şekliyle birebir aynı (gece aşan vardiya doğru çalışsın diye).
4. **Debounce:** açık kayıt varsa ve `now - updatedAt < 10_000 ms` ise `{ action: "ignored" }` (HTTP 200), yazma yok.
5. Eylem seçimi:
   - açık kayıt yok → `attendanceService.clockIn(tenantId, user.id, dto.notes)`; `clockInSource = "card"`.
   - `CLOCKED_IN` → `attendanceService.clockOut(tenantId, user.id)`; `clockOutSource = "card"`.
   - `ON_BREAK` → `attendanceService.breakEnd(tenantId, user.id)`; kaynak kolonu değişmez.
   - `clockIn` zaten "bugün çıkış yapılmış" hatası fırlatıyorsa (`attendance.service.ts:111-115`) hata `409 { code: "ALREADY_CLOCKED_OUT_TODAY" }` olarak yeniden paketlenir.
6. Yayın: `clockIn/clockOut/breakEnd` zaten `kdsGateway.emitAttendanceUpdate` çağırıyor — ek yayın yok.

`clockInSource` / `clockOutSource` yazımı: `AttendanceService.clockIn` imzası
`clockIn(tenantId, userId, notes?, source: AttendanceSource = AttendanceSource.MANUAL)` olarak,
`clockOut` ise `clockOut(tenantId, userId, source: AttendanceSource = AttendanceSource.MANUAL)`
olarak genişletilir; varsayılan değerler mevcut çağıranları (controller, testler) **değiştirmez**.
`clockOut`'taki `updateMany` data bloğuna `clockOutSource: source` eklenir — bu blok zaten
status'a bileşik WHERE ile yarış-güvenlidir (a.g.e.:249-258), semantik değişmez.

### 4.5 UI

**(a) `TeamPage` — üçüncü sekme "Kartlı Vardiya"** (`frontend/src/pages/admin/TeamPage.tsx:29-39`
desenine ekleme, `hasFeature('cardShift')` ile koşullu):

- Personel tablosu: ad, rol, kart durumu (`•••• 4F21` / "kart yok"), atama tarihi, atayan.
- "Kart ata" akışı: satırdaki butona basınca odaklanmış bir input açılır ("Kartı okutun"), okuyucu
  UID'yi yazar, Enter `POST /personnel/cards/:userId`'ye gider. Input `type="password"`
  **değildir** ama gönderimden sonra temizlenir ve UID hiçbir yerde tutulmaz.
- "Kartı iptal et" → `DELETE /personnel/cards/:userId`, onay diyaloğu ile.

**(b) İstasyon ekranı** — `frontend/src/pages/personnel/CardShiftStationPage.tsx`, rota
`/card-shift`, ADMIN+MANAGER bloğunda, `Layout` içinde, `lazyWithReload` ile
(`frontend/src/App.tsx:7` konvansiyonu):

```tsx
<Route
  path="/card-shift"
  element={
    <FeatureGate
      feature="cardShift"
      fallback={<UpsellCard addOnCode="module_personnel_card_shift" featureKey="cardShift" />}
    >
      <CardShiftStationPage />
    </FeatureGate>
  }
/>
```

Ekran: ekranı kaplayan tek kart, ortada "Kartınızı okutun" başlığı, görünmez ama daima odaklı bir
input (blur olunca yeniden odaklanır), son okutma sonucu 8 saniye boyunca büyük punto ile
(ad-soyad, eylem, saat, yeşil/kehribar/kırmızı), altında o gün kart ile damgalayanların şeridi.
Hata durumları: `CARD_NOT_RECOGNISED` → "Kart tanınmadı — yöneticinize başvurun";
`ALREADY_CLOCKED_OUT_TODAY` → "Bugün çıkış yapılmış".

**(c) `AttendanceTab`** — puantaj listesinde satır başına küçük bir "Kart" / "Uygulama" rozeti;
özet bölümünde "Kartla giriş" sütunu; CSV'ye yeni kolon (§4.6).

### 4.6 Raporlama

- `getAttendanceSummary` çıktısına `cardClockIns: number` eklenir (`clockInSource === "card"` sayısı).
- CSV başlığı `…,Late Days,Late Minutes` → `…,Late Days,Late Minutes,Card Clock-ins`. Yasak kelime
  taraması (`/wage|salary|pay|cost|rate/`) etkilenmez — yeni başlık bu kelimeleri içermez.
- `AttendanceQueryDto`'ya `@IsOptional() @IsEnum(AttendanceSource) source?: AttendanceSource` eklenir
  (T8: tanımlanmazsa sessizce silinir) ve `getAttendanceHistory`'de `where.clockInSource = source`
  olarak uygulanır.

### 4.7 Yetkilendirme / para akışı (uçtan uca)

1. Vitrin `/v1/catalog/pricing`'ten ürünleri `deps` ile birlikte alır.
2. Müşteri "Kartlı Vardiya"yı işaretler → `CatalogStore` sepete gerekirse `module_personnel`'i ve
   gerekirse `license_annual`'ı **görünür satır olarak** ekler (§4.8).
3. `POST /v1/checkout/intent` → `AddonPurchasabilityService.assertPurchasable` her satır için sepet
   farkındalığıyla çalışır; dep sepette olduğu için geçer (`checkout-intent.service.ts:149-165`).
4. `QuoteService`: `module_personnel_card_shift` `oneTime` dalından düz 400_000 kuruş **brüt** olarak
   fiyatlanır (`quote.service.ts:127-146`); `module_personnel` `annual` dalından yıl dönümüne
   orantılanır. KDV brütün içinden türetilir (a.g.e.:313-326) — **üstüne %20 eklenmez**.
5. PayTR → callback → `confirmAndProvision` → **topolojik sıralama** (§4.9) → `module_personnel`
   önce, `module_personnel_card_shift` sonra provizyonlanır.
6. `purchase()` oneTime satır için `currentPeriodEnd = null` yazar → süpürücü hiç görmez → projektör
   `validUntil = null` yazar → `feature.cardShift` **kalıcıdır**.
7. Lisans söner ise `requiresLicense: true` olduğu için grant bastırılır (`plan-projector.service.ts:282`),
   sahiplik satırı ve tüm kart verisi **silinmez**; lisans geri geldiğinde yeniden yanar.

### 4.8 Ön koşul düzeltmesi (a) — vitrin `deps`'i görüyor

1. **Backend:** `licensing.controller.ts:199-235` `pricing()` select listesine `deps: true` eklenir ve
   yanıt nesnesine `deps: r.deps` konur. (`/v1/me/licensing` katalog select'i **değişmez**: oradaki
   `buildPurchasability` dep kuralı çalıştırmıyor ve çalıştırmamalı — aynı kuralın ikinci bir kopyası
   `assertDeps` ile ayrışırdı.)
2. **Frontend tip:** `frontend/src/features/licensing/licensingApi.ts:112-126` `PricingProduct`'a
   `deps: string[]` eklenir.
3. **CatalogStore otomatik ekleme** (`frontend/src/features/licensing/CatalogStore.tsx:127-139`
   `licenceAutoAdded` deseninin ikizi):

```ts
// Sahip olunan ve dep'i KARŞILAYAN kodlar: yalnız status === 'active'.
// past_due bir ebeveyn modül purchase()'ın ACTIVE-only dep kontrolünü geçemez
// (tenant-marketplace.service.ts:229-242) — "sahip" sayarsak sepet reddedilir.
const activeOwnedCodes = new Set(
  (snapshot?.owned ?? []).filter((o) => o.status === 'active').map((o) => o.code),
);

/** Seçilen satırların dep'lerini transitif olarak topla. */
const depAutoAdded = useMemo(() => {
  const out = new Map<string, PricingProduct>();
  const seen = new Set<string>();
  const walk = (code: string) => {
    if (seen.has(code)) return;
    seen.add(code);
    for (const dep of byCode.get(code)?.deps ?? []) {
      if (activeOwnedCodes.has(dep) || dep in picked || out.has(dep)) { walk(dep); continue; }
      const product = byCode.get(dep);
      // Sunucunun satın alınamaz dediği bir dep'i sepete koymak, tüm sepeti
      // reddettirir. Böyle bir durumda satır bloklu gösterilir, eklenmez.
      if (!product || blockedReason(dep)) continue;
      out.set(dep, product);
      walk(dep);
    }
  };
  for (const code of Object.keys(picked)) walk(code);
  return out;
}, [picked, byCode, snapshot]);
```

`billLines` bu satırları `licenceAutoAdded`'dan **sonra**, seçilen satırlardan **önce** ekler
(lisans → ebeveyn modül → seçilen ürün okuma sırası). Otomatik eklenen her satır faturada
"gerekli — otomatik eklendi" rozetiyle görünür (mevcut lisans rozeti,
`CatalogStore.tsx:221` ve :412, aynı bileşenle yeniden kullanılır).

**Dep karşılanamıyorsa:** `module_personnel` ne aktif sahiplikte ne de satın alınabilir ise
(ör. `past_due`), kart satırı tıklanamaz ve `licensing:store.blocked.dependencyUnavailable`
mesajını gösterir — sunucunun reddedeceği bir sepet **hiç kurulmaz**.

### 4.9 Ön koşul düzeltmesi (b) — provizyon sırası topolojik

Yeni saf modül: **`backend/src/modules/checkout/provision-order.ts`**

```ts
/**
 * Katalog satırlarını provizyon sırasına dizer.
 *
 * KIND_RANK tek başına yetmiyor: `module` ve `integration` aynı rütbede (1) ve
 * Array.prototype.sort KARARLI, yani sepet sırası bağımlıyı ebeveyninden önce
 * getirebiliyor. purchase()'ın dep kontrolü ACTIVE sahiplik satırı arar, o an
 * ebeveyn henüz yazılmamıştır: Serializable tx PayTR tahsilatından SONRA geri
 * sarılır — para alınmış, hiçbir şey verilmemiş olur.
 *
 * Çözüm: rütbe içinde Kahn topolojik sıralaması. Rütbeler arası sıra korunur
 * (lisans hep ilk, kontör hep son) ve bir döngü/eksik dep varsa girdi sırası
 * aynen korunur (fail-open: sıralama para kararı vermez, guard verir).
 */
export function orderAddOnLinesForProvisioning<T extends {
  code: string; meta?: { kind?: string; deps?: string[] } }
>(lines: T[]): T[];
```

Algoritma: (1) satırları `KIND_RANK` ile grupla, (2) her grup içinde yalnız **aynı gruptaki** kodlara
işaret eden dep kenarlarını al, (3) Kahn — hazır kuyruğu **girdi sırasını** korur (deterministik),
(4) döngü kalırsa kalan satırlar girdi sırasıyla eklenir, (5) gruplar rütbe sırasıyla birleştirilir.

`KIND_RANK` sabiti `checkout.service.ts:444-451`'den bu dosyaya taşınır ve export edilir;
`checkout.service.ts:452-456` şuna indirgenir:

```ts
const orderedAddOnLines = orderAddOnLinesForProvisioning(addOnLines);
```

Dep verisi satırda taşınır: `PricedLineMeta`'ya (`backend/src/modules/checkout/checkout.types.ts:72-104`)
`deps?: string[]` eklenir ve `quote.service.ts`'in **her iki** addon dalında (`:100-114` annual,
`:136-146` oneTime) `deps: addOn.deps` yazılır. Gerekçe: Serializable tx içinde ek bir sorgu
açmamak ve sıralamanın fiyatla **aynı** katalog okumasından gelmesi. `meta` faturaya bütün olarak
yazılmıyor (`tenant-invoice.service.ts:107-125` yalnız adlandırılmış alanları okuyor), yani yeni
alan hiçbir kalıcı kayda sızmaz.

---

## 5. Değişecek dosyalar (bağımlılık sırasına göre)

### Backend — sözlük ve katalog (önce bunlar; testler bunlara bakıyor)

1. `backend/src/modules/entitlements/entitlement-keys.const.ts` — `FEATURE_KEYS`'e `"cardShift"`
   (paid modules bloğunun sonuna, `deliveryIntegration`'dan önce) + yorum.
2. `backend/src/common/constants/subscription.enum.ts` — `CARD_SHIFT = "cardShift"` (`:112`'nin
   hemen ardına, "Paid module: module_personnel_card_shift" yorumuyla). **1 ve 2 aynı commit'te
   olmalı**: `backend/src/modules/entitlements/entitlement-keys.spec.ts:14-32` iki yönde de kırılır.
3. `backend/src/modules/marketplace/alacarte-catalog.const.ts` — yeni satır (modüller bloğunun
   sonuna, `module_external_display`'den sonra — a.g.e.:359 civarı), aşağıdaki **kanonik** metinle:
   ```ts
   {
     code: "module_personnel_card_shift",
     name: "Kartlı Vardiya",
     description:
       "Personel giriş-çıkışını RFID kart okutarak damgalar. Ucuz USB kart okuyucularla çalışır; puantaj, mola ve fazla mesai hesabı Personel Yönetimi modülündeki kayıtların üstüne yazılır. Tek seferlik satın alma — yenileme ücreti yoktur, lisansınız aktif olduğu sürece geçerlidir.",
     kind: "module",
     billing: "oneTime",
     priceCents: 400_000,
     grants: { "feature.cardShift": true },
     deps: ["module_personnel"],
     requiresLicense: true,
     sortOrder: 18,
     i18n: t(/* aşağıdaki T4 tablosundaki beş satır, sırayla tr, en, ru, ar, uz */),
   }
   ```

   **T4 — `module_personnel_card_shift` beş dilli metin (TEK KAYNAK).** Bu tablodaki baytlar
   üç yere birebir kopyalanır: (a) yukarıdaki `t(...)` çağrısı, (b) §6.2 migration'ının
   `name`/`description` kolonları (TR satırı), (c) §6.2'nin `i18n` jsonb literal'i (beş satırın
   tamamı). Her açıklama, K21/§8 Risk 3'ün zorunlu kıldığı **lisans cümlesi** ile biter.

   | Dil | `name` | `description` |
   |---|---|---|
   | tr | Kartlı Vardiya | Personel giriş-çıkışını RFID kart okutarak damgalar. Ucuz USB kart okuyucularla çalışır; puantaj, mola ve fazla mesai hesabı Personel Yönetimi modülündeki kayıtların üstüne yazılır. Tek seferlik satın alma — yenileme ücreti yoktur, lisansınız aktif olduğu sürece geçerlidir. |
   | en | Card Shift | Staff clock in and out by tapping an RFID card. It works with inexpensive USB readers; attendance, breaks and overtime are written onto the records of the Staff Management module. One-time purchase — there is no renewal fee, and it stays available for as long as your licence is active. |
   | ru | Смена по карте | Сотрудники отмечают приход и уход, прикладывая RFID-карту. Работает с недорогими USB-считывателями; учёт времени, перерывы и сверхурочные пишутся поверх записей модуля «Управление персоналом». Разовая покупка — плата за продление отсутствует, доступ сохраняется, пока действует ваша лицензия. |
   | ar | الوردية بالبطاقة | يسجّل الموظفون الدخول والخروج بتمرير بطاقة RFID. يعمل مع قارئات USB غير المكلفة؛ تُكتب سجلات الحضور والاستراحات والعمل الإضافي فوق سجلات وحدة إدارة الموظفين. شراء لمرة واحدة — لا توجد رسوم تجديد، ويظل متاحًا ما دام ترخيصك ساريًا. |
   | uz | Karta bilan smena | Xodimlar RFID kartani o'qitib kelish-ketishni qayd etadi. Arzon USB o'quvchilar bilan ishlaydi; davomat, tanaffus va qo'shimcha ish vaqti Xodimlarni boshqarish moduli yozuvlari ustiga yoziladi. Bir martalik xarid — yangilash to'lovi yo'q, litsenziyangiz faol bo'lgunicha amal qiladi. |

   > **SQL kaçışı:** `uz` metnindeki her `'` migration literal'inde **ikiye katlanır**
   > (`o'qitib` → `o''qitib`, `o'quvchilar` → `o''quvchilar`, `qo'shimcha` → `qo''shimcha`,
   > `to'lovi` → `to''lovi`) — mevcut `module_external_display` satırı (`backend/prisma/migrations/20260811100000_alacarte_catalog/migration.sql:284`,
   > `ko''rsatishi`) aynı kuralı gösteriyor. TR/EN/RU/AR metinlerinde düz tırnak yoktur.
4. `backend/src/modules/superadmin/dto/update-tenant-overrides.dto.ts` — `FeatureOverridesDto`'ya
   `cardShift?: boolean | null` (T8: tanımsız alan `whitelist:true` ile silinir, operatör override'ı
   sessizce kaybolurdu).
5. `backend/src/modules/demo/demo.service.ts` — `ALL_FEATURES`'a `cardShift: true` (`:62-85`).

### Backend — şema ve migration

6. `backend/prisma/schema.prisma` — `User`'a 6 kolon (`staffCardUidHash`, `staffCardUidEnc`,
   `staffCardHashVersion`, `staffCardLast4`, `staffCardAssignedAt`, `staffCardAssignedById`) +
   `StaffCardAssigner` self-relation + `@@unique`; `Attendance`'a `clockInSource` / `clockOutSource`.
7. `backend/prisma/migrations/20260820150000_card_shift_schema/migration.sql` + `down.sql` — **YENİ** (§6.1).
8. `backend/prisma/migrations/20260820160000_card_shift_catalog/migration.sql` + `down.sql` — **YENİ** (§6.2).

### Backend — personel rayı

9. `backend/src/modules/personnel/constants/personnel.enum.ts` — `AttendanceSource`.
10. `backend/src/modules/personnel/card-uid.ts` — **YENİ** (normalize / validate / hash / last4).
11. `backend/src/modules/personnel/dto/card-shift.dto.ts` — **YENİ** (`CardTapDto`, `AssignCardDto`).
12. `backend/src/modules/personnel/dto/attendance-query.dto.ts` — `source?: AttendanceSource`.
13. `backend/src/modules/personnel/services/attendance.service.ts` — `clockIn`/`clockOut` imzalarına
    varsayılanlı `source`; `getAttendanceSummary`'ye `cardClockIns`; CSV'ye `Card Clock-ins`;
    `getAttendanceHistory`'ye `source` filtresi.
14. `backend/src/modules/personnel/services/card-shift.service.ts` — **YENİ** (tap + ata + iptal + liste).
15. `backend/src/modules/personnel/controllers/card-shift.controller.ts` — **YENİ**.
16. `backend/src/modules/personnel/controllers/attendance.controller.ts` — `POST card-tap` ucu
    (metotta **iki** bayrak birden, K15).
17. `backend/src/modules/personnel/personnel.module.ts` — yeni controller + service kaydı.

### Backend — checkout / vitrin düzeltmeleri

18. `backend/src/modules/checkout/checkout.types.ts` — `PricedLineMeta.deps?: string[]`.
19. `backend/src/modules/checkout/quote.service.ts` — her iki addon dalına `deps: addOn.deps`.
20. `backend/src/modules/checkout/provision-order.ts` — **YENİ** (`KIND_RANK` + topolojik sıralama).
21. `backend/src/modules/checkout/checkout.service.ts` — `:444-456` yerine `orderAddOnLinesForProvisioning`.
22. `backend/src/modules/licensing/licensing.controller.ts` — `pricing()` select + yanıtına `deps`.

### Backend — donanım

23. `backend/src/modules/catalog/category-vocabulary.ts` — `{ value: "card_reader", labelTr: "Kart Okuyucu" }`
    (`scanner`'dan hemen sonra).
24. `backend/src/modules/catalog/dto/create-hardware-product.dto.ts` — `CATEGORY_DEFAULT_SALE_MODE`'a
    (`:46-60`) `card_reader: "DIRECT_SALE"`. **Ortak dosya uyarısı:** bu dosyayı 3D baskı PR'ı da
    düzenliyor (SKU regex'i, `:69-71`) — merge sırasında iki düzenleme aynı dosyada buluşur.
25. `backend/prisma/seeds/seed-marketplace.ts` — `PRODUCTS`'a yeni SKU (§6.2 ile aynı değerler).

### Frontend

26. `frontend/src/types/index.ts` — `PlanFeatures`'a `cardShift: boolean` (`personnelManagement` `:1075`'in yanına, yorumlu);
    `Attendance`'a `clockInSource: string` + `clockOutSource?: string`; `AttendanceSummary`'ye `cardClockIns: number`.
27. `frontend/src/features/superadmin/types.ts` — `cardShift?: boolean` (`:204` deseni).
28. `frontend/src/pages/superadmin/TenantDetailPage.tsx` — `FEATURE_LABELS`'a `cardShift: 'Card Shift (RFID clock-in)'`.
29. `frontend/src/pages/superadmin/MarketplaceAdminPage.tsx:602-612` — kategori `<select>`'ine
    `<option value="card_reader">card_reader</option>` (`scanner` satırının ardına, `:609`).
    Bu `<select>` sözlükten türemiyor ve zaten drift'te (`cash_drawer`/`scale`/`accessory`/`cable`/`service`
    eksik, sözlükte olmayan `other` fazladan); bu PR yalnız **kendi** değerini ekler, mevcut drift'i
    onarmak kapsam dışıdır (§9/9).
    ⚠️ **Ortak dosya:** 3D baskı PR'ı (Change 3) **aynı** `<select>`'e `<option value="service">`
    ekliyor (o spec §5/35b) — `category:'service'` seçilemediği için iki print3d satırı panelden
    oluşturulamıyor. İki ekleme bitişik satırlara düşer; ikinci merge olan taraf diğerinin
    seçeneğini **silmez**.
30. `frontend/src/features/licensing/licensingApi.ts` — `PricingProduct.deps: string[]`.
31. `frontend/src/features/licensing/CatalogStore.tsx` — `depAutoAdded` + bloklu dep durumu (§4.8).
32. `frontend/src/features/personnel/personnelApi.ts` — `useCardAssignments`, `useAssignCard`,
    `useRevokeCard`, `useCardTap` (mutasyonlar `['personnel','attendance']` anahtarını invalidate eder).
33. `frontend/src/components/personnel/CardShiftTab.tsx` — **YENİ** (kart atama tablosu).
34. `frontend/src/pages/personnel/CardShiftStationPage.tsx` — **YENİ** (kiosk).
35. `frontend/src/pages/admin/TeamPage.tsx` — üçüncü sekme.
36. `frontend/src/components/personnel/AttendanceTab.tsx` — kaynak rozeti + özet sütunu.
37. `frontend/src/App.tsx` — `lazyWithReload` importu + `/card-shift` rotası (FeatureGate + UpsellCard).
37b. `frontend/src/components/layout/Sidebar.tsx` — kiosk'un **tek** gezinme girdisi. `/admin/team`
    girdisinin (`:155-165`) hemen ardına, `NavItem` tipinin gerçek şekliyle (`:59-69` —
    `label` alanı **yoktur**, `labelKey` + `labelFallback` vardır):
    ```ts
    {
      to: '/card-shift',
      icon: CreditCard,
      labelKey: 'navigation.cardShift',
      labelFallback: 'Kartlı Vardiya',
      roles: [UserRole.ADMIN, UserRole.MANAGER],
      gate: { feature: 'cardShift' },
    },
    ```
    Kapı `itemVisible` içinde değerlendirilir (`:321`), yani ürün alınmadan girdi görünmez.
    Ayrıca `CardShiftTab`'ın başına "İstasyon ekranını aç" butonu (`<Link to="/card-shift" target="_blank">`)
    — kiosk tableti pratikte oradan açılır.

### i18n (5 dil × 5 dosya — **hepsi gerçek çeviri, değerler burada yazılı**, T6)

> Anahtar adı yetmez: T6 tam olarak "İngilizce metni Türkçe `defaultValue` sanıp parity'yi geçmek"
> hatasını yakalamak için var. Aşağıdaki tabloların **değerleri** normatiftir; uygulama anında
> hiçbir dize uydurulmaz.

38. `frontend/src/i18n/locales/{tr,en,ru,ar,uz}/personnel.json` — `cardShift.*` bloğu:

    | Anahtar | tr | en | ru | ar | uz |
    |---|---|---|---|---|---|
    | `cardShift.title` | Kartlı Vardiya | Card Shift | Смена по карте | الوردية بالبطاقة | Karta bilan smena |
    | `cardShift.tapPrompt` | Kartınızı okutun | Tap your card | Приложите карту | مرّر بطاقتك | Kartangizni o‘qiting |
    | `cardShift.assign` | Kart ata | Assign card | Назначить карту | تعيين بطاقة | Karta biriktirish |
    | `cardShift.revoke` | Kartı iptal et | Revoke card | Отозвать карту | إلغاء البطاقة | Kartani bekor qilish |
    | `cardShift.revokeConfirm` | {{name}} adlı personelin kartı iptal edilsin mi? Geçmiş puantaj kayıtları silinmez. | Revoke the card assigned to {{name}}? Past attendance records are kept. | Отозвать карту сотрудника {{name}}? Прошлые записи учёта времени сохранятся. | هل تريد إلغاء بطاقة {{name}}؟ تُحفظ سجلات الحضور السابقة. | {{name}} kartasi bekor qilinsinmi? Oldingi davomat yozuvlari saqlanadi. |
    | `cardShift.noCard` | Kart yok | No card | Нет карты | لا توجد بطاقة | Karta yo‘q |
    | `cardShift.cardLast4` | Kart (son 4) | Card (last 4) | Карта (последние 4) | البطاقة (آخر 4) | Karta (oxirgi 4) |
    | `cardShift.assignedAt` | Atama tarihi | Assigned at | Дата назначения | تاريخ التعيين | Biriktirilgan sana |
    | `cardShift.assignedBy` | Atayan | Assigned by | Кем назначено | عيّنها | Biriktirgan |
    | `cardShift.sourceCard` | Kart | Card | Карта | بطاقة | Karta |
    | `cardShift.sourceManual` | Uygulama | App | Приложение | التطبيق | Ilova |
    | `cardShift.cardClockIns` | Kartla giriş | Card clock-ins | Входы по карте | تسجيلات الدخول بالبطاقة | Karta bilan kirishlar |
    | `cardShift.errors.notRecognised` | Kart tanınmadı — yöneticinize başvurun | Card not recognised — please contact your manager | Карта не распознана — обратитесь к руководителю | لم يتم التعرف على البطاقة — يرجى مراجعة مديرك | Karta tanilmadi — rahbaringizga murojaat qiling |
    | `cardShift.errors.invalidUid` | Kart numarası geçersiz | Invalid card number | Неверный номер карты | رقم البطاقة غير صالح | Karta raqami yaroqsiz |
    | `cardShift.errors.alreadyClockedOut` | Bugün çıkış yapılmış | Already clocked out today | Сегодня выход уже отмечен | تم تسجيل الخروج اليوم بالفعل | Bugun chiqish allaqachon qayd etilgan |
    | `cardShift.station.title` | Kartlı Vardiya İstasyonu | Card Shift Station | Станция смены по карте | محطة الوردية بالبطاقة | Karta bilan smena stansiyasi |
    | `cardShift.station.welcome` | Hoş geldin, {{name}} — giriş {{time}} | Welcome, {{name}} — clocked in at {{time}} | Добро пожаловать, {{name}} — приход в {{time}} | أهلًا {{name}} — تسجيل الدخول {{time}} | Xush kelibsiz, {{name}} — kirish {{time}} |
    | `cardShift.station.goodbye` | İyi çalışmalar, {{name}} — çıkış {{time}} | Goodbye, {{name}} — clocked out at {{time}} | До свидания, {{name}} — уход в {{time}} | إلى اللقاء {{name}} — تسجيل الخروج {{time}} | Xayr, {{name}} — chiqish {{time}} |
    | `cardShift.station.breakEnded` | Mola bitti, {{name}} — {{time}} | Break ended, {{name}} — {{time}} | Перерыв окончен, {{name}} — {{time}} | انتهت الاستراحة، {{name}} — {{time}} | Tanaffus tugadi, {{name}} — {{time}} |
    | `cardShift.station.ignored` | Kart az önce okutuldu | Card was just tapped | Карта только что была приложена | تم تمرير البطاقة للتو | Karta hozirgina o‘qitildi |

39. `frontend/src/i18n/locales/{tr,en,ru,ar,uz}/superadmin.json` → **`tenantDetail.featureLabels.cardShift`**
    (üst düzey `featureLabels` **DEĞİL**: `frontend/src/pages/superadmin/TenantDetailPage.tsx:556`
    ``t(`tenantDetail.featureLabels.${key}`, FEATURE_LABELS[key])`` çağırıyor ve blok
    `frontend/src/i18n/locales/tr/superadmin.json:171` altında `tenantDetail` içinde yaşıyor — üst düzey bir anahtar parity'yi
    geçer ama UI beş dilde de İngilizce `FEATURE_LABELS` literal'ine düşer).

    | tr | en | ru | ar | uz |
    |---|---|---|---|---|
    | Kartlı Vardiya (RFID ile damgalama) | Card Shift (RFID clock-in) | Смена по карте (отметка RFID) | الوردية بالبطاقة (تسجيل RFID) | Karta bilan smena (RFID bilan qayd) |

    > **Baseline uyarısı:** mevcut `tenantDetail.featureLabels.*` satırları ru/ar/uz'da İngilizce
    > taşıyor ve `scripts/i18n-value-drift-baseline.json:245+` içinde baseline'lı. **Yeni anahtar
    > gerçek çeviri taşır ve baseline'a EKLENMEZ** — eklenirse `--gate-new` kapısının anlamı kalmaz.

40. `frontend/src/i18n/locales/{tr,en,ru,ar,uz}/subscriptions.json` → **`subscriptions.comparison.features.cardShift`**
    (`subscriptions.features` **bir string'dir** — `:16`, "Özellikler" — oraya nesne yazmak
    string/nesne çakışması yaratır; özellik haritası `comparison` (`:214`) altındaki `features`
    (`:230`) bloğudur).

    | tr | en | ru | ar | uz |
    |---|---|---|---|---|
    | Kart ile giriş-çıkış | Card clock-in/out | Отметка прихода/ухода по карте | تسجيل الدخول/الخروج بالبطاقة | Karta bilan kelish-ketish qaydi |

41. `frontend/src/i18n/locales/{tr,en,ru,ar,uz}/licensing.json` — **iki yeni anahtar** (bugün
    `store.*` var ama `store.blocked` alt ağacı **yok**; `store.licenceAuto` mevcut ikizdir):

    | Anahtar | tr | en | ru | ar | uz |
    |---|---|---|---|---|---|
    | `store.blocked.dependencyUnavailable` | Önce {{dep}} kalemi gerekiyor, ancak şu anda satın alınamıyor. | This needs {{dep}} first, but that item cannot be purchased right now. | Сначала требуется {{dep}}, но сейчас его нельзя купить. | يتطلب هذا {{dep}} أولًا، لكن لا يمكن شراؤه الآن. | Avval {{dep}} kerak, ammo hozir uni sotib bo‘lmaydi. |
    | `store.depAutoAddedNote` | gerekli — otomatik eklendi | required — added automatically | обязательно — добавлено автоматически | مطلوب — أُضيف تلقائيًا | kerak — avtomatik qo‘shildi |

41b. `frontend/src/i18n/locales/{tr,en,ru,ar,uz}/common.json` → `navigation.cardShift`
    (`navigation` bloğu `:75`; 37b'deki `labelKey` bunu okur):

    | tr | en | ru | ar | uz |
    |---|---|---|---|---|
    | Kartlı Vardiya | Card Shift | Смена по карте | الوردية بالبطاقة | Karta bilan smena |

### Dokümantasyon (kataloğu elle sayan **her** yüzey — envanter §3.6)

42. `docs/SISTEM_TANITIMI.md` — **iki** düzenleme:
    - **(a) `:217`** satırı ikiye ayrılır: temel puantaj (ücretsiz değil, Personel Yönetimi modülü)
      "personel kendi hesabıyla damgalar"; kart ile damgalama **Kartlı Vardiya (₺4.000 tek
      seferlik)** modülüne bağlı ayrı madde olarak yazılır, "QR/NFC" ifadesi **"RFID kart"** ile
      değiştirilir (QR damgalama yok).
    - **(b) `:80-97`** "Ücretli katalog (TRY, KDV dahil)" tablosuna, Personel Yönetimi satırının
      (`:86`) hemen altına:
      `| Kartlı Vardiya (RFID kart ile giriş-çıkış) | modül / tek seferlik | ₺4.000 |`
43. `docs/hardware/10-kart-okuyucu.md` — **YENİ**. Numara **10**'dur: dizin bugün `00-genel-cerceve.md`
    … `09-pos-terminal.md` şeklinde kesintisizdir, "12" iki hayalet boşluk bırakırdı. İçerik mevcut
    kılavuz biçiminde: ne işe yarar, 13.56 MHz Mifare, USB HID (sürücüsüz), kurulum, sorun giderme,
    **mali cihaz değildir** notu. Kılavuzsuz SKU satılmıyor.
43b. `docs/hardware/README.md` — elle bakımlı indeks; `## 3. Çevre Birimleri (Peripherals)`
    bölümüne (`:27`, bağlantı listesi `:31-34`) satır eklenir:
    `- [RFID Personel Kart Okuyucu (USB HID)](./10-kart-okuyucu.md) — 13.56 MHz Mifare, sürücüsüz HID; Kartlı Vardiya modülüyle çalışır, mali cihaz DEĞİLDİR.`
    (İndekse bağlanmayan bir kılavuz, spec'in kendi giriş noktası saydığı yerden erişilemez.)
44. `developer/pages/{tr,en}/developer/marketplace-api.mdx` — "Catalogue summary" tablosuna
    (`en:131-155`), `module_personnel` satırının (`en:137`) hemen altına şu satır:

    ```markdown
    | `module_personnel_card_shift` | module | **one-time** | ₺4,000 (`400000`) | `feature.cardShift` | ✅ | `module_personnel` |
    ```

    `Dependency` sütunu bugün yalnız kontör satırlarında dolu; bu, **modül→modül** bağımlılığı
    taşıyan ilk satırdır.
45. `developer/pages/{tr,en}/reference/plan-matrix.mdx` — "Modules" tablosuna (`en:92-103`),
    `module_personnel` satırının (`en:99`) altına şu satır:

    ```markdown
    | `module_personnel_card_shift` | ₺4,000 tek seferlik | `feature.cardShift` | ✅ |
    ```

    Tablodaki tüm fiyatlar bugün `₺…/yr` biçiminde; bu ilk `oneTime` modül olduğu için
    `Price` sütununun "yıllık" varsayımı satır metninde açıkça kırılır ("tek seferlik").
46. `docs/PAZARLAMACI_REHBERI.md` — **iki** düzenleme:
    - modül tablosuna (`:71-79`), Personel Yönetimi satırının (`:75`) altına:
      `| Kartlı Vardiya (tek seferlik) | **₺4.000** | RFID kart okutarak personel giriş-çıkışı; Personel Yönetimi modülü ön koşuldur, yenileme ücreti yoktur |`
    - `:110-114` "Hizmet (tek seferlik)" tablosundan **sonra** yeni bir bölüm (rehberde bugün
      donanım tablosu **hiç yok**):
      `### Donanım (tek seferlik, kargolu)` + `| Donanım | Tutar | İçerik |` +
      `| RFID Personel Kart Okuyucu (USB HID) + 10 Kart | **₺1.290** | Kartlı Vardiya modülü için masaüstü 13.56 MHz okuyucu ve 10 personel kartı |`
47. `help/pages/{tr,en}/marketplace/products.mdx` — `## Modüller` (`tr:52`) altında,
    `### Personel Yönetimi` bölümünden (`tr:95`) sonra yeni bölüm:
    `### Kartlı Vardiya (tek seferlik)` — Tür: Modül · Fatura: **Tek seferlik** · Fiyat: ₺4.000,00 ·
    Ne işe yarar: RFID kart okutarak giriş-çıkış damgalama · Bağımlılık: **Personel Yönetimi** +
    aktif lisans · Not: yenileme ücreti yoktur, **lisans sönerse erişim kapanır** (K21).
48. `help/pages/{tr,en}/marketplace/index.mdx` (`tr:59-84`), `help/pages/{tr,en}/plans/index.mdx`
    (`tr:72-81`) ve `help/pages/{tr,en}/plans/feature-matrix.mdx` (`tr:40-52`) — üç fiyat/matris
    tablosuna aynı satır: ürün "Kartlı Vardiya", tip "Modül", fatura "**Tek seferlik**", fiyat
    "₺4.000,00", özellik satırı "Kart ile giriş-çıkış".
49. `help/pages/{tr,en}/admin-guide/personnel.mdx` — bugün damgalamanın **tek** yolu olarak uygulama
    içi giriş-çıkışı anlatıyor (`en:12` "Requires", `:16`, `:38-41`). Yeni alt bölüm
    "Kart ile damgalama": kart atama, istasyon ekranı (`/card-shift`), 10 sn debounce, "kart
    tanınmadı" davranışı ve ek gereksinim satırı (`cardShift` — Kartlı Vardiya modülü, ₺4.000 tek
    seferlik, lisans ön koşuluyla).

---

## 6. Migration

İki ayrı, tersine çevrilebilir çift. Ayrı olmalarının nedeni: DDL geri alınabilir olmalı ama veri
satırı bir tenant tarafından satın alınmışsa geri **alınmamalı**; tek dosyada bu iki politika
çatışır.

### 6.0 Zincirdeki yer (üç spec ortak kararı — ÇAKIŞMASIZ nihai sıra)

Üç paralel değişikliğin migration zaman damgaları bir kez çakıştı; nihai ve **bağlayıcı** zincir
şudur. Dizin adları birebir bunlardır:

| # | Dizin | Sahibi |
|---|---|---|
| 0 | `20260820120000_reprice_licence_and_stock` | Change 0 — **ağaçta zaten var** (başka bir oturumun v3.6.7 işi) |
| 1 | `20260820130000_delivery_platforms_bundle` | Change 1 — teslimat paketi |
| **2a** | **`20260820150000_card_shift_schema`** | **Change 2 — BU SPEC (§6.1)** |
| **2b** | **`20260820160000_card_shift_catalog`** | **Change 2 — BU SPEC (§6.2)** |
| 3 | `20260820170000_print3d_service` | Change 3 — 3D baskı hizmeti |

Bu spec zincirin **2a + 2b** halkasıdır: teslimat paketinden sonra, 3D baskıdan önce uygulanır.
`20260820140000` **kullanılmaz** (eski taslak numarası; tüm eski referanslar bu belgede
güncellenmiştir).

### 6.1 `20260820150000_card_shift_schema`

`migration.sql`:

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

`down.sql`:

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

### 6.2 `20260820160000_card_shift_catalog`

`migration.sql` — üç blok. Üslup `20260811100000_alacarte_catalog/migration.sql:1-90`'dan birebir
devralınır (aynı kolon listesi, aynı satır kırılımı, aynı `ON CONFLICT` bloğu) çünkü drift spec'inin
regex'i (`alacarte-catalog-migration.spec.ts:78-80`, `parseUpserts`) tam olarak bu şekli çözümlüyor:
`gen_random_uuid()::text, '<code>',` … `\n  '<kind>', '<billing>', <priceCents>, 'TRY',\n` …
`::jsonb, ARRAY[…]::TEXT[], '<status>', <requiresLicense>,`. **Kolonların satırlara dağılımını
değiştirmek tripwire'ı sessizce kör eder** — satır sonlarını olduğu gibi koru. (Aynı dosyadaki
donanım INSERT'i regex'e takılmaz: `sku` tire içeriyor, kod grubu ise `[a-z0-9_]+`.)

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

`down.sql`:

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

### 6.3 Drift spec'inin GENİŞLETİLMESİ (K19 / T1) — katlayıcı zaten var, sıfırdan yazılmaz

**Durum tespiti (2026-08-20'de çalıştırıldı):**
`cd backend && npx jest src/modules/marketplace/alacarte-catalog-migration.spec.ts` →
**9 passed / 0 failed**. `alacarte-catalog-migration.spec.ts` artık yalnız taban dosyaya
bakmıyor; **katlama mekanizması hâlihazırda mevcut ve yeşil**:

| Parça | Yer | Ne yapıyor |
|---|---|---|
| `FOLLOW_UP_SQL` | `:42-44` | Şu an tek girdi: `20260820120000_reprice_licence_and_stock/migration.sql` |
| `parseUpserts` | `:67-89` | P1 üretecinin birebir satır şeklini çözer |
| `updateStatements` | `:97-101` | `;` yerine `UPDATE` anahtar sözcüğünde böler (açıklama metinlerinde `;` var) |
| `parseRepricing` | `:100-111` | Kısmi `UPDATE … SET "priceCents" = …` okur → `code → yeni fiyat` |
| `parseArchived` | `:113-122` | `UPDATE … SET "status" = 'archived'` okur |
| `effective` | `:137-140` | Taban satırları arşivlenenlerden süzer ve yeniden fiyatlananları ezer |

```ts
// bugünkü hâli — DEĞİŞTİRİLMEZ, yalnız genişletilir
const parsed = parseUpserts(sql);                                      // :129 — yalnız taban dosya
const followUps = FOLLOW_UP_SQL.map((p) => readFileSync(p, "utf8"));   // :131
const reprices = new Map(followUps.flatMap((f) => [...parseRepricing(f).entries()]));
const archivedLater = new Set(followUps.flatMap(parseArchived));
const effective = parsed
  .filter((r) => !archivedLater.has(r.code))
  .map((r) => ({ ...r, priceCents: reprices.get(r.code) ?? r.priceCents }));
```

Eksik olan **tek** şey, bir follow-up'ın **INSERT ettiği yeni ürün**: `parsed` yalnız taban
dosyadan geldiği için `module_personnel_card_shift` katlanmış duruma hiç girmez ve
`"upserts exactly the products in the catalog constant"` (`:150-155`) küme farkı verirdi. Bu
değişiklik katlayıcıyı **sıfırdan yazmaz** — şu beş şeyi yapar:

1. **`FOLLOW_UP_SQL`'e tek satır eklenir**, zincirdeki (§6.0) sırasına göre:
   `"20260820160000_card_shift_catalog/migration.sql"`. `parseRepricing` ve `parseArchived`
   **hiç ellenmez**.
2. **`effective` INSERT'leri de kapsar** — tek ekleme, **iki satır**. Blok, teslimat
   spec'inin §7 T2/2'sindeki blokla **birebir aynı baytlardır** (fazladan bir yardımcı
   değişken bile yok), bu yüzden iki değişiklik aynı satırlara yazsa da temiz merge olur.
   Sahibi teslimat PR'ıdır; ikinci merge olan taraf bu bloğu **yeniden yazmaz**, olduğu
   gibi bırakır:

```ts
const insertedLater = followUps.flatMap(parseUpserts);
const effective = [...parsed, ...insertedLater]
  .filter((r) => !archivedLater.has(r.code))
  .map((r) => ({ ...r, priceCents: reprices.get(r.code) ?? r.priceCents }));
```

3. **Follow-up sözleşmesi** dosyanın başındaki yoruma yazılır. Bu bir yasak listesi **değil**,
   *tanınan biçimler* listesidir — bir follow-up:
   - kısmi `UPDATE … SET "priceCents" = …` ile **fiyat değiştirebilir** (`parseRepricing` okur);
     uygulanmış `20260820120000_reprice_licence_and_stock` tam olarak budur (`:38` = 490000,
     `:47` = 390000) ve `prisma migrate deploy` checksum'ladığı için **düzenlenemez**;
   - `UPDATE … SET "status" = 'archived'` ile **arşivleyebilir** (`parseArchived` okur);
   - P1 üretecinin birebir satır şekliyle tam satırlı `INSERT … ON CONFLICT ("code") DO UPDATE`
     ile **yeni ürün tanıtabilir** (`parseUpserts` okur).

   Bunların dışında bir şekil kullanılacaksa **katlayıcı genişletilir**, testin beklentisi
   düşürülmez. *"Tam satır upsert zorunludur, kısmi `UPDATE … SET "priceCents"` yasaktır"* kuralı
   ve onu dayatacak test **YAZILMAZ**: tek mevcut follow-up tam da o yasağı ihlal ediyor, yani
   böyle bir test doğduğu anda kırmızı olurdu ve dayandığı `parseRepricing` parser'ını da yasa
   dışı ilan ederdi.
4. `"lands every annual and credit product as draft, then publishes them in P2"` (`:175-198`)
   **yalnız taban dosya** üzerinde (`parsed`) çalışmaya devam eder: iddiası P1→P2 tarihsel geçişi
   hakkındadır ve yeni ürünler o iddianın kapsamında değildir. Testin başlığı/yorumu buna göre
   netleştirilir.
5. `"deletes in the down exactly the codes the up introduced"` (`:254-282`) **taban** dosyanın
   down'ıyla ilgilidir; yeni ürün taban down'da yoktur, bu yüzden `introduced` kümesinden
   düşmelidir. **Biçim teslimat spec'inin §7 T2/3'ünden gelir ve BAĞLAYICIDIR** — hesap
   `ALACARTE_CATALOG` sabitine değil, **taban migration'ın kendi `parsed` satırlarına**
   sabitlenir. Sabitten türetip yeni kodları tek tek elemek (`!insertedLaterCodes.has(c)`)
   aynı sonucu bugün verir ama INSERT ekleyen **her** yeni takip migration'ında elle
   bakım ister; `parsed`'e sabitlemek bunu kalıcı olarak çözer:

```ts
// Taban migration'ın GERÇEKTEN yarattığı kodlar. Katalog sabitinden
// türetmek yanlış: sonraki her migration'ın eklediği kod da listeye
// girer ve P1'in down'ında aranır.
const introduced = parsed
  .map((r) => r.code)
  .filter((c) => !preExisting.has(c))
  .sort();
```

   Bu bloğun sahibi de teslimat PR'ıdır (§6.0'daki merge sırasında ondan sonra geliyoruz);
   bu PR onu **yazmaz, doğrular** — merge sonrası şekli yukarıdaki değilse düzeltir.

> **`FOLLOW_UP_SQL` ASLA indeksle okunmaz.** Yeni iddialar girdiyi **adıyla** bulur —
> `FOLLOW_UP_SQL.find((p) => p.includes("card_shift_catalog"))` — çünkü araya sonradan girecek bir
> dosya (teslimat paketi `20260820130000_delivery_platforms_bundle`, ya da ileride başka bir
> katalog migration'ı) indeksli bir iddiayı sessizce başka dosyaya yöneltir ve test yalan
> söylemeye başlar. **3D baskı bu diziye giriş EKLEMEZ** (satırları `hardware_products`'ta,
> `marketplace_addons`'ta değil).

> **Regex uyumu doğrulandı:** yeni katalog INSERT'i `parseUpserts`'ın şekliyle eşleşir
> (`'module', 'oneTime', 400000, 'TRY',` satırı + `::jsonb, ARRAY['module_personnel']::TEXT[], 'published', true,`
> satırı). Aynı dosyadaki donanım INSERT'i eşleşmez (`sku` tire içerir, kod grubu `[a-z0-9_]+`),
> stok INSERT'i de eşleşmez (`gen_random_uuid()::text, hp."id",`). Satır kırılımlarını değiştirmek
> tripwire'ı **sessizce** kör eder.

### 6.4 Round-trip kanıt planı

**Adım 0 (ZORUNLU, canlı/staging geri alımlarında).** Şema down'ı kart atamalarını yok eder ve UID
hiçbir yerde düz metin tutulmadığı için geri getirilemez — önce dışa aktar:

```bash
psql "$DATABASE_URL" -c "\copy (SELECT id, \"staffCardUidHash\", \"staffCardUidEnc\", \"staffCardHashVersion\", \"staffCardLast4\", \"staffCardAssignedAt\", \"staffCardAssignedById\" FROM users WHERE \"staffCardUidHash\" IS NOT NULL) TO 'staff-cards-backup.csv' CSV HEADER"
```

Tek kullanımlık bir Postgres'te (`docker run --rm -e POSTGRES_PASSWORD=… -p 5455:5432 postgres:16`),
`DATABASE_URL` oraya bakarken:

**İKİ çift de kanıtlanır.** Şema down'ının başlığı "Idempotent: IF EXISTS'ler ikinci
çalıştırmayı no-op yapar" diyor; bu iddia ancak şema down'ı **iki kez** ve **ikinci
up'tan sonra tekrar** çalıştırılırsa gözlemlenmiş olur. Aşağıdaki sıra tam olarak bunu
yapar (katalog çifti için zaten yapılıyordu):

```bash
cd backend
# "hata vermez" iddiası ancak ON_ERROR_STOP ile gözlemlenebilir: onsuz psql hatayı
# ekrana basar ama çıkış kodu 0 kalır ve idempotans kanıtı sessizce yalan söyler.
p() { psql -v ON_ERROR_STOP=1 "$DATABASE_URL" "$@"; }
M=prisma/migrations

npx prisma migrate deploy                       # up (tüm zincir, §6.0)
p -c "select code,kind,billing,\"priceCents\",status,\"sortOrder\" from marketplace_addons where code='module_personnel_card_shift'"
p -c "select sku,category,\"priceCents\",\"saleMode\" from hardware_products where sku='card-reader-rfid-usb-hid'"
p -c "select count(*) from information_schema.columns where table_name='users' and column_name like 'staffCard%'"                                  # 6
p -c "select count(*) from information_schema.columns where table_name='attendances' and column_name in ('clockInSource','clockOutSource')"        # 2

# --- katalog çifti: down x2 ---
p -f $M/20260820160000_card_shift_catalog/down.sql
p -f $M/20260820160000_card_shift_catalog/down.sql          # idempotent: no-op, hata YOK

# --- şema çifti: down x2  (IF EXISTS iddiasının KANITI) ---
p -f $M/20260820150000_card_shift_schema/down.sql
p -f $M/20260820150000_card_shift_schema/down.sql           # idempotent: no-op, hata YOK
p -c "select count(*) from information_schema.columns where table_name='users' and column_name like 'staffCard%'"                                  # 0
p -c "select count(*) from information_schema.columns where table_name='attendances' and column_name in ('clockInSource','clockOutSource')"        # 0

# --- şema çifti: up x2 ---
p -f $M/20260820150000_card_shift_schema/migration.sql      # up (2. kez)
p -f $M/20260820150000_card_shift_schema/migration.sql      # idempotent: no-op, hata YOK
p -c "select count(*) from information_schema.columns where table_name='users' and column_name like 'staffCard%'"                                  # yine 6

# --- şema down'ı İKİNCİ up'tan SONRA tekrar: down→up→down turu da temiz olmalı ---
p -f $M/20260820150000_card_shift_schema/down.sql           # tekrar temiz düşer
p -f $M/20260820150000_card_shift_schema/down.sql           # ve yine no-op
p -f $M/20260820150000_card_shift_schema/migration.sql      # zinciri geri kur (kolonlar 6/2)

# --- katalog çifti: up x2 ---
p -f $M/20260820160000_card_shift_catalog/migration.sql
p -f $M/20260820160000_card_shift_catalog/migration.sql     # idempotent: no-op
p -c "select count(*) from marketplace_addons where code='module_personnel_card_shift'"                                                            # 1
p -c "select count(*) from hardware_products where sku='card-reader-rfid-usb-hid'"                                                                 # 1
```

Ek olarak **para güvenliği kanıtı**: down'dan önce elle bir `tenant_addons` satırı ekleyip
(`addOnId` = yeni ürün) down'ı çalıştır → satır **silinmemeli**; `hardware_order_items`'a satır
ekleyip down → SKU **silinmemeli**. Bu iki senaryo PR açıklamasına çıktısıyla yazılır.

---

## 7. Test planı

### 7.1 Sözlük ve katalog invariant'ları (mevcut dosyalar, yeni beklentiler)

| Dosya | Ne değişiyor / ne eklenecek |
|---|---|
| `backend/src/modules/entitlements/entitlement-keys.spec.ts` | Değişiklik gerekmez — `cardShift` iki listeye de eklendiği an **kendiliğinden** yeşil kalır; biri unutulursa `:14-25` veya `:27-32` kırılır (kasıtlı tripwire). |
| `backend/src/modules/marketplace/catalog-validation.spec.ts` | Mevcut `:203` (tüm ürünler geçerli), `:226` (benzersiz kod+sortOrder), `:238` (her dep katalogda çözülüyor), `:273` (5 dil), `:285` (≥100 kuruş) yeni satırı otomatik kapsar. **Yeni test:** `it("kart vardiya modülünü personel modülüne bağlar")` → `ALACARTE_CATALOG_BY_CODE.get("module_personnel_card_shift")!.deps` = `["module_personnel"]`, `billing` = `"oneTime"`, `priceCents` = `400_000`. **Yeni test:** `it("kind:'module' bir oneTime kadansı kabul eder")` → `validateCatalogRow(base({ kind:"module", billing:"oneTime", grants:{"feature.cardShift":true} }))` = `[]` (K5'i kilitle). ⚠️ **Ortak dosya:** teslimat PR'ı (Change 1) aynı dosyadaki `delivery_*` invaryantını (`:256-265`, bugün `expect(delivery.length).toBe(3)`) **tek** `delivery_platforms` satırına göre yeniden yazıyor. O testin sahibi Change 1'dir; bu PR ona dokunmaz, iki yeni `it()` bloğunu merge sonrası hâlin üstüne ekler (§6.0 merge sırası: Change 1 → bu PR → Change 3). |
| `backend/src/modules/marketplace/alacarte-catalog-migration.spec.ts` | Süit bugün **YEŞİL** (9/9); §6.3'e göre yalnız **genişletilir**: `FOLLOW_UP_SQL`'e bir satır, `effective`'e `insertedLater`, ve `introduced` hesabı **taban dosyanın `parsed` çıktısına** sabitlenir (§6.3/5 — biçimin sahibi teslimat PR'ı, §7 T2/3). `parseRepricing` / `parseArchived` **korunur**. **Yeni test:** `it("yeni ürünün down'ı ödenmiş satırı korur")` → dosya **adıyla** bulunur (`FOLLOW_UP_SQL.find((p) => p.includes("card_shift_catalog"))`, asla indeksle değil) ve kardeşi `down.sql` içinde `DELETE FROM "marketplace_addons"` ile `NOT EXISTS` + `"tenant_addons"` birlikte geçer. **Yeni test:** snake_case iddiası (`:217-224`) iki yeni migration dosyası için de tekrarlanır. **YAZILMAYACAK test:** "bir follow-up yalnız tam satır upsert kullanır" — uygulanmış `20260820120000_reprice_licence_and_stock` kısmi `UPDATE … SET "priceCents"` kullanıyor (`:38`, `:47`) ve checksum'lı olduğu için düzenlenemez; böyle bir iddia doğduğu anda kırmızı olur (§6.3/3). |
| `backend/src/modules/catalog/category-vocabulary.spec.ts` | **Yeni test:** `it("kart okuyucu kategorisini ve saleMode varsayılanını taşır")` → `CATEGORY_VALUES` `card_reader` içerir **ve** `CATEGORY_DEFAULT_SALE_MODE["card_reader"]` = `"DIRECT_SALE"` (sözlük ile harita arasındaki sessiz boşluğu kapatır). |

### 7.2 Yeni birim testleri

| Dosya (**YENİ**) | Test adları |
|---|---|
| `backend/src/modules/personnel/card-uid.spec.ts` | `"normalizes separators, whitespace and case to one canonical UID"`; `"rejects a UID shorter than 4 or longer than 32 after normalization"`; `"produces a DIFFERENT hash for the same card in two tenants"`; `"is deterministic for the same tenant + card"`; `"never returns the raw UID from last4"`; **`"can re-derive the hash from the encrypted UID after a key change"`** (K22 kanıtı: eski `ENCRYPTION_MASTER_KEY` ile `encryptString` → anahtarı değiştir → `decryptString` eski anahtarla → yeni anahtarla `cardUidHash` → hash değişmiş ama **yeniden türetilebilmiş** olmalı) |
| `backend/src/modules/personnel/services/card-shift.service.spec.ts` | `"clocks in on the first tap of the day"`; `"clocks out on the second tap"`; `"ends the break when the staff member is ON_BREAK"`; `"ignores a duplicate tap inside the 10s debounce window"`; `"404s an unknown card without revealing whether it exists in another tenant"`; `"404s a card belonging to an INACTIVE user"`; `"never logs or returns the raw UID or the hash"`; `"stamps clockInSource=card and clockOutSource=card"`; `"delegates to AttendanceService rather than writing attendance itself"` (spy) |
| `backend/src/modules/checkout/provision-order.spec.ts` | `"provisions the licence before everything else"`; `"provisions module_personnel before module_personnel_card_shift even when the cart lists the card first"`; `"keeps credit packs last"`; `"is stable for lines with no dependency relationship"`; `"falls back to input order on a dependency cycle instead of dropping a line"` |

### 7.3 Mevcut birim testlerine eklenecekler

| Dosya | Ekleme |
|---|---|
| `backend/src/modules/personnel/services/attendance.service.spec.ts` (test bloğu `:206-230`) | CSV başlık iddiası (`:223-225`) `…,Late Days,Late Minutes,Card Clock-ins` olarak güncellenir ve veri satırı (`:229`) `Ada Lovelace,WAITER,1,480,60,30,1,15,0` olur. **Yeni:** `"counts card clock-ins separately in the summary"`; **yeni:** `"defaults clockInSource to manual for an app clock-in"`. Para-kolonu yasağı testi (`:226`) **korunur**. |
| `backend/src/modules/personnel/controllers/attendance.controller.spec.ts` | **Yeni:** `"card-tap requires BOTH personnelManagement and cardShift"` → `Reflect.getMetadata(REQUIRE_ENTITLEMENT_KEY, handler)` = `[{feature:"feature.personnelManagement"},{feature:"feature.cardShift"}]` (K15 regresyon kilidi). |
| `backend/src/modules/checkout/checkout.service.spec.ts` (dosya mevcut — doğrulandı) | **Yeni:** `"provisions a dependent module after its parent regardless of cart order"` — `[card_shift, module_personnel]` sepetiyle `purchase()` çağrı sırası doğrulanır. Saf birim süiti ayrıca `backend/src/modules/checkout/provision-order.spec.ts`'tedir (§7.2); bu satır **entegrasyon** kanıtıdır. |
| `backend/src/modules/licensing/licensing.controller.pricing.spec.ts` (**YENİ**; kardeşi `licensing.controller.purchasability.spec.ts`) | **Yeni:** `"projects deps on the public pricing endpoint"`. |

### 7.4 Frontend testleri

| Dosya | Test |
|---|---|
| `frontend/src/features/licensing/CatalogStore.test.tsx` | `"adds the parent module to the bill when a dependent line is ticked"`; `"does not re-add a parent module the tenant already owns ACTIVELY"`; `"does NOT treat a past_due parent as satisfying the dependency"`; `"blocks the dependent line when the parent is unpurchasable"`; `"does not double-add when the parent is ticked by hand"` (mevcut lisans testlerinin — `:184-238` — ikizi). |
| `frontend/src/pages/personnel/CardShiftStationPage.test.tsx` (**YENİ**) | `"posts the typed UID on Enter and clears the input"`; `"shows the staff name and action on success"`; `"shows an unrecognised-card message without echoing the UID"`; `"refocuses the hidden input after a blur"` |
| `frontend/src/components/personnel/CardShiftTab.test.tsx` (**YENİ**) | `"lists only the last 4 digits, never a full UID"`; `"asks for confirmation before revoking"` |

### 7.5 e2e (gerçek Postgres, gerçek guard zinciri)

**YENİ** `backend/test/card-shift.e2e-spec.ts` — mevcut yardımcılarla
(`bootHttpApp, resetDb, seedLiveTenant, loginAs`, `grantLicence, ownProduct, project, upsertProduct`;
bkz. `backend/test/licensing.e2e-spec.ts:1-60`):

1. `"card-tap is 403 without the cardShift product, with an offer attached"`
2. `"card-tap is 403 when cardShift is owned but personnelManagement is not"` (K15 kanıtı)
3. `"a full tap cycle clocks in then clocks out on a real database"`
4. `"an unknown card returns 404 CARD_NOT_RECOGNISED and writes no attendance row"`
5. `"a one-time cardShift purchase leaves currentPeriodEnd NULL and the grant validUntil NULL"`
   (K6 kanıtı — süpürücüyü `runOnce()` ile elle çalıştırıp satırın hâlâ `active` olduğunu doğrula)
6. `"a lapsed licence darkens card-tap but keeps the ownership row and the card assignment"`

**Komutlar** (T9: `npm run lint` ağacı değiştirir, CI `lint:ci` çalıştırır; `cmd | tail` çıkış kodunu
yutar — her komut ayrı çalıştırılır):

```bash
cd backend && npx jest src/modules/personnel src/modules/marketplace src/modules/checkout src/modules/entitlements src/modules/catalog
cd backend && npx jest --config test/jest-e2e.json test/card-shift.e2e-spec.ts
cd frontend && npx vitest run src/features/licensing src/components/personnel src/pages/personnel
node scripts/check-i18n-parity.mjs
node scripts/check-i18n-value-drift.mjs --gate-new scripts/i18n-value-drift-baseline.json
node scripts/check-contract-drift.mjs
cd backend && npm run lint:ci
```

---

## 8. Riskler ve tuzaklar

### Depoya özgü tuzaklar (uygulanabilir olanlar)

| # | Tuzak | Bu değişiklikte nasıl karşılanıyor |
|---|---|---|
| **T1** | Katalog drift spec'i uygulanmış migration'a sabitli | Katlayıcı **zaten var ve yeşil** (9/9, 2026-08-20). §6.3 onu yalnız INSERT'lere öğretir; uygulanmış dosya **düzenlenmez**, `FOLLOW_UP_SQL`'e bir satır eklenir ve girdi **adıyla** aranır. Testi "düzeltmek" yasak. |
| **T2** | Her migration tersine çevrilebilir çift + `@doctor:idempotent` başlığı + `NOT EXISTS` korumalı DELETE | §6.1, §6.2, round-trip kanıtı §6.4. |
| **T3** | Elle yazılan SQL snake_case `@@map` adı kullanmalı | `"users"`, `"attendances"`, `"marketplace_addons"`, `"tenant_addons"`, `"hardware_products"`, `"hardware_inventory"`, `"hardware_order_items"`. Spec iddiası §7.1. |
| **T4** | Yeni feature bayrağının senkron noktaları | §5/1,2,4,5 + frontend 26,27,28 + i18n 39,40. **Sapma:** `SubscriptionPlan` kolonu, `subscription-response.dto.ts` ve `subscription.service.ts` mirror'ı **kasıtlı olarak atlanıyor** (K7): projektör plan kolonu okumuyor (`plan-projector.service.ts:79`) ve o mirror yalnız emekli plan karşılaştırma matrisini besliyor. `prisma/seed-demo.ts:140-170` `SubscriptionPlan` satırı yazdığı için **değişmiyor**; demo yetkileri `demo.service.ts` `ALL_FEATURES` üzerinden gidiyor. |
| **T5** | Katalog invariant'ları | 5 dil dolu, kod ve `sortOrder: 18` benzersiz, fiyat ≥ 100, `published` + fiyat > 0. `delivery_*` invaryantı bu PR'dan **etkilenmez** (yeni kod `delivery_` ile başlamıyor) — ama sayının kendisi **artık 3 değildir**: Change 1 (teslimat paketi) üç `delivery_*` satırını tek `delivery_platforms` satırına indiriyor ve `catalog-validation.spec.ts:256-265`'i "tam olarak bir teslimat ürünü" biçiminde yeniden yazıyor. **Merge sırasına bağlıdır** (§6.0: Change 1 → bu PR): bu PR ağaca vardığında dosyada zaten yeni invaryant durur; testin sahibi Change 1'dir, bu PR ona dokunmaz. |
| **T6** | i18n parity + value-drift CI'da bloklayıcı | **5** ad alanı × 5 dil (`personnel`, `superadmin`, `subscriptions`, `licensing`, `common`); İngilizce metni Türkçe `defaultValue` olarak kullanmak **yasak**. Tüm değerler §5/38-41b tablolarında **yazılıdır**, uygulama anında hiçbiri uydurulmaz ve hiçbiri `scripts/i18n-value-drift-baseline.json`'a eklenmez. Anahtar yolları doğrulandı: `tenantDetail.featureLabels.*` ve `subscriptions.comparison.features.*` (üst düzey `featureLabels` / `subscriptions.features` **yanlıştır**). |
| **T7** | `check-contract-drift.mjs` yalnız 5 enum'u kapsıyor | Yeni `AttendanceSource` ("manual"/"card") FE'de elle aynalanıyor ve **guard'ı yok**. Karşı önlem: FE tarafında string birleşim tipi yerine yalnız rozet eşlemesi (`clockInSource === 'card'`) kullanılıyor; bilinmeyen değer "Uygulama" olarak düşer, yani drift bir kilitlenmeye değil yanlış rozete yol açar. Drift script'ine ekleme **kapsam dışı** (§9). |
| **T8** | `whitelist:true` tanımsız DTO alanını sessizce siler | `CardTapDto`, `AssignCardDto`, `AttendanceQueryDto.source`, `FeatureOverridesDto.cardShift` — dördü de açıkça tanımlı. |
| **T9** | `npm run lint` ağacı değiştirir; `cmd \| tail` çıkış kodunu yutar | §7.5 komut listesi `lint:ci` kullanır ve boru içermez. |
| **T10** | `ON CONFLICT` `status`'u eziyor / seed zorla yayınlıyor | §6.2 `status`'u DO UPDATE listesinden **çıkarıyor**. Seed'in `const status = "published"` davranışı (`seed-marketplace.ts:1006`) bu PR'da **değiştirilmiyor** (ayrı bir sorun), ama yeni migration o deseni kopyalamıyor. |
| **T11** | Katalogda para birimi boyutu yok; çok ülkeli iş aynı branch'te | ₺4.000 ve ₺1.290 TRY literal'idir; `country-profile.const.ts` UZ→UZS tanımlıyor ama katalog hâlâ tek para birimli. **Bilinen takip işi** — bu spec çözmüyor (§9). |

### Değişikliğe özgü riskler

1. **PARA — provizyon sırası (bugün canlı, latent).** `KIND_RANK` düzeltilmeden kartlı vardiya
   satılırsa: müşteri öder, PayTR settle eder, `purchase()` "requires: module_personnel" fırlatır,
   Serializable tx geri sarılır → **para alınmış, hiçbir şey verilmemiş, iade rayı yok**. Bu yüzden
   §4.9 aynı PR'da. Sepet sırası kullanıcı etkileşimine bağlı olduğu için "pratikte olmaz"
   denemez — `CatalogStore` `Object.entries(picked)` sırasını kullanıyor ve bu tıklama sırasıdır.
2. **PARA — `past_due` ebeveyn.** Vitrin `snapshot.owned`'ı ham okursa (`active` + `past_due`),
   `past_due` bir `module_personnel` "sahip" görünür, dep sepete eklenmez ve
   `assertDeps` (ACTIVE-only) intent'te 409 verir → sepetin tamamı ölür. Para kaybı yok
   (tahsilat öncesi) ama müşteri hiçbir şey satın alamaz. K20 bunu kapatıyor.
3. **DESTEK/İLETİŞİM — "kalıcı" ama lisansa bağlı (K21).** `requiresLicense: true` olduğu için
   ₺4.000'ı **bir kez** ödeyen müşteri, yıllık lisansı yenilemeyi bıraktığı gün kart rayını
   **kaybeder**: projektör `requiresLicense` ürünlerinin tüm grant'lerini lisans karanlıkken
   bastırır (`plan-projector.service.ts:282` — `const suppressed = ta.addOn.requiresLicense && !licenceLive`).
   Bu **onaylı ve bilinçli** bir karardır (K21) ve diğer her ücretli modülle tutarlıdır; ama
   "tek seferlik ödeme = sonsuza kadar erişim" algısı yarattığı için **destek ve iade tartışması
   riski birinci sınıftır**. Sahiplik satırı, `currentPeriodEnd = NULL` ve kart verisi
   **silinmez**; lisans döndüğü an yeniden yanar. **Zorunlu karşı önlemler (üçü de bu PR'da):**
   - ürün açıklaması 5 dilde "yenileme ücreti yoktur, **lisansınız aktif olduğu sürece
     geçerlidir**" cümlesini taşır (§5/3 T4 tablosu — kanonik metin; sabit, migration ve i18n
     jsonb birebir aynı baytları taşır);
   - **mağaza metni**: vitrindeki kalem "tek seferlik" rozetinin yanında aynı cümleyi gösterir;
   - **yardım sayfası**: `help/pages/{tr,en}/marketplace/products.mdx` "Kartlı Vardiya (tek
     seferlik)" bölümü (§5/47) bunu açıkça yazar; satın alma sonrası fatura satırı tekrarlar.
4. **GÜVENLİK — kart klonlama.** 125 kHz EM4100 kartlar 200 TL'lik bir cihazla kopyalanır; 13.56 MHz
   Mifare Classic de kırılabilir. Bu bir **devam kaydı** sistemidir, kasa/kapı erişimi değildir —
   riski "arkadaşına kartını verip damgalatma" düzeyindedir ve bu manuel damgalamada da vardır.
   SKU 13.56 MHz seçildi (EM4100'e göre daha iyi), ama pazarlama metni kartlı damgalamayı bir
   **güvenlik** kontrolü olarak **sunmayacak**.
5. **GÜVENLİK — kiosk yönetici oturumu.** İstasyon tableti ADMIN/MANAGER JWT'si taşır; ekranı
   bırakan personel `/admin` yüzeyine gidebilir. Karşı önlem (bu PR): istasyon sayfası kendi
   üstünde "Oturumu kilitle" butonu ve 60 sn hareketsizlikte tam ekran overlay gösterir; asıl
   çözüm cihaz-token rayıdır (§9).
6. **VERİ — `@@unique([userId, date])`.** Aynı personel iki şubede aynı gün çalışırsa ikinci
   `clockIn` P2002 alır; bu **mevcut** davranış (`attendance.service.ts:190-196`) ve kart rayı onu
   değiştirmiyor — kiosk bu hatayı "Bugün zaten damgalanmış" olarak gösterecek.
7. **VERİ — kart iptali geçmişi silmez.** `staffCardUidHash` null'lanınca geçmiş `Attendance`
   satırlarının `clockInSource='card'` değeri kalır (doğru: geçmişte gerçekten kartla damgalandı).
8. **UYUM — `docs/SISTEM_TANITIMI.md`.** Metin düzeltilmezse ürün çıktıktan sonra bile "QR ile
   damgalama" iddiası yalan kalır (QR damgalama **yapılmıyor**). §5/42 zorunlu.
9. **ÇAKIŞMA — üç paralel değişiklik aynı iki dosyada buluşuyor.** `alacarte-catalog.const.ts`,
   `alacarte-catalog-migration.spec.ts` ve `FOLLOW_UP_SQL` dizisi Change 1/2/3'ün üçünde de
   ellenir. **Gerçek durum:** v3.6.7 yeniden fiyatlama işi (57 dosya + izlenmeyen
   `20260820120000_reprice_licence_and_stock/`) çalışma ağacında **bitmiştir** ve katlayıcı
   **yeşildir**; bu PR'ın kuracağı bir altyapı yoktur, yalnız diziye bir satır ekler. Bu yüzden
   (a) `FOLLOW_UP_SQL` girdileri **adıyla** aranır, indeksle değil (§6.3), (b) migration zaman
   damgaları §6.0'daki zincire sabitlenmiştir, (c) `create-hardware-product.dto.ts` 3D baskı PR'ı
   ile ortaktır (§5/24) ve `MarketplaceAdminPage.tsx`'in kategori `<select>`'i de öyle (§5/29),
   (d) **üç doküman yüzeyi üç PR'da da ortaktır**: `docs/SISTEM_TANITIMI.md` (Change 1 `:90`'ı
   yeniden yazıyor, bu PR `:86`'nın altına ekliyor, Change 3 `:97`'nin altına),
   `docs/PAZARLAMACI_REHBERI.md` (Change 1 `:84-86` + `:91`, bu PR `:75`'in altı ve `:110-114`
   sonrası, Change 3 `:114` tablosunun içi) ve `help/pages/{tr,en}/marketplace/products.mdx`
   (Change 1 tr:173-212'yi tek bölüme **daraltıyor**, bu PR tr:95 sonrası, Change 3
   tr:343/:345). Change 1 satır **sildiği** için bu belgedeki mutlak `:NNN` çıpaları rebase
   sonrası kayar; çıpalar **içerik eşlemesiyle** yeniden çözülür, satır numarasıyla değil.
   Merge sırası §6.0'daki sıradır: Change 1 → bu PR → Change 3.
10. **TEST — CSV başlığı sözleşmesi.** `attendance.service.spec.ts:223-225` başlığı birebir
    sabitliyor; kolon eklerken hem başlık hem de veri satırı (`:229`) iddiası güncellenmeli,
    `wage|salary|pay|cost|rate` yasağı (`:226`) korunmalı.
11. **VERİ — şema geri alımı kart atamalarını YOK EDER.**
    `20260820150000_card_shift_schema/down.sql` UID hash kolonlarını düşürür ve UID hiçbir yerde
    düz metin tutulmadığı için (K8) atamalar başka bir tablodan geri getirilemez; kolonu bırakmak
    da seçenek değil (şema Prisma ile tutarsız kalır). **Geri alımdan ÖNCE zorunlu:**
    ```bash
    psql "$DATABASE_URL" -c "\copy (SELECT id, \"staffCardUidHash\", \"staffCardUidEnc\", \"staffCardHashVersion\", \"staffCardLast4\", \"staffCardAssignedAt\", \"staffCardAssignedById\" FROM users WHERE \"staffCardUidHash\" IS NOT NULL) TO 'staff-cards-backup.csv' CSV HEADER"
    ```
    Aynı komut `down.sql`'in başındaki yoruma ve §6.4'ün **Adım 0**'ına yazılmıştır.
12. **VERİ — `ENCRYPTION_MASTER_KEY` rotasyonu yeniden-hash işi ister.** Kart hash'i bu anahtardan
    türeyen bir HMAC'tir; anahtar dönerse hash yeniden türetilemez ve sahadaki **her kart aynı anda
    tanınmaz olur**. Bugün bu anahtar depoda **yalnız** geri döndürülebilir AES-256-GCM için
    kullanılıyor (`encryption.helper.ts:53-64`, `:66-82`; tüketiciler integrations config ve
    delivery kimlik bilgileri), yani rotasyon bugüne kadar "çöz → yeniden şifrele" işiydi; kart
    rayı ilk kez **geri döndürülemez** bir kullanım getiriyor. Karşı önlem K22:
    `users.staffCardUidEnc` (AES-GCM, AAD = `staffcard:v1:<tenantId>:<userId>`) +
    `staffCardHashVersion`. Rotasyon prosedürüne şu adım eklenir: *eski anahtarla `decryptString`
    → yeni anahtarla `cardUidHash` + `encryptString` → satırı güncelle, `staffCardHashVersion`'ı
    artır.* Bu kolon olmadan rotasyon her tenant'a **her kartı elle yeniden kaydettirir**.
    **Doğrulama notu:** `docs/SECURITY_LEAKED_SECRETS_RUNBOOK.md` `ENCRYPTION_MASTER_KEY`'i sızmış
    secret olarak **listelemiyor** (listedekiler: `POSTGRES_PASSWORD`, `JWT_SECRET`,
    `JWT_REFRESH_SECRET`, `EMAIL_PASSWORD`, `DESKTOP_RELEASE_API_KEY`), yani rotasyon
    *planlanmış* değildir — ama `docs/infra/2026-06-25-production-readiness-audit.md:34`
    "tarihsel bir `.env`'de geçtiyse onu da döndür" diyor ve `docs/DEPLOYMENT.md:68-72` rotasyonun
    sonucunu ("eski anahtarla şifrelenmiş satırlar çözülemez") zaten belgeliyor. Olasılık gerçek,
    takvim belirsiz.
13. **DOKÜMAN — kataloğu elle sayan 11 yüzey.** Ürün fiyat tabloları, geliştirici portalı ve yardım
    portalı (envanter §3.6) elle bakımlıdır ve hiçbir CI kapısı yeni bir ürünü oraya yazmaya
    zorlamaz. ₺4.000'lık bir modülü ve ₺1.290'lık bir SKU'yu satış rehberinin ve yetki matrisinin
    hiç saymaması, bu spec'in kendi uyardığı sessiz-eskime sınıfının ta kendisidir. §5/42-49 bu
    yüzden **zorunludur**, "sonra yaparız" değildir.
14. **UX — kiosk'a giden yol.** İstasyon ekranı `Sidebar.tsx`'e yazılmazsa yalnız URL yazarak
    erişilir; kenar çubuğu uygulamanın **tek** gezinme kaydıdır. §5/37b zorunlu.

---

## 9. Kapsam dışı / sonraki adımlar

1. **İstasyon için cihaz-token rayı.** `device-mesh` eşleştirilmiş cihaz token'ı ile kiosk'u
   yönetici oturumundan kurtarmak (Risk 5'in gerçek çözümü).
2. **Katalogda para birimi boyutu (T11).** UZ/UZS için `priceCents`'in tek-para-birimli oluşu;
   `country-profile.const.ts` ile birlikte ayrı bir spec.
3. **`AttendanceSource`'un contract-drift script'ine eklenmesi** (T7 boşluğu).
4. **`seed-marketplace.ts:1006` zorla-yayınlama davranışı** — superadmin'in arşivlediği bir ürünü
   seed yeniden yayına sokuyor; ayrı düzeltme.
5. **QR ile damgalama** — istenirse ayrı ürün; bu modül kapsamında değil.
6. **Kart ile POS oturumu açma / yetki devri** — aynı donanım, farklı ürün.
7. **`SubscriptionPlan` feature kolonlarının tamamen emekliye ayrılması** (K7'nin işaret ettiği ölü ray).
8. **`docs/marketing/uzbekistan/UZ_EXPANSION_BENCHMARK.md`** — kartlı vardiya iddiası **yok**;
   bu belgede yapılacak bir düzeltme bulunmuyor (doğrulandı, §3.5).
9. **Superadmin kategori `<select>`'inin sözlükten türetilmesi.** `MarketplaceAdminPage.tsx:602-612`
   elle yazılmış ve zaten drift'te (`cash_drawer`/`scale`/`accessory`/`cable`/`service` eksik,
   sözlükte olmayan `other` fazladan); bu PR yalnız `card_reader`'ı ekler. Kalıcı çözüm
   `GET /v1/catalog/categories`'ten beslemektir — ayrı düzeltme. (3D baskı spec'i aynı
   `<select>`'e `service` ekliyor — o spec'te **§5/35b** kontrol maddesi ve **§9/9** takip
   maddesi olarak kayıtlı; iki PR bitişik satırlara dokunur, ikisi de korunur.)
10. **`ENCRYPTION_MASTER_KEY` rotasyon script'i** (§8 Risk 12). K22 kolonları bu PR'da açılıyor ama
    yeniden-hash job'ı yazılmıyor; rotasyon runbook'una adım eklenmesi ayrı iştir.
