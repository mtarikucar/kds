# 3D baskı figür hizmeti (üretim ortağı: Figurunica) — tasarım

**Tarih:** 2026-08-20
**Durum:** ONAYLANDI — kararlar kesin, bu belge kaydeder; yeniden tartışılmaz.
**Branch:** `feat/multi-country-architecture`
**Sürüm hedefi:** v3.7.0
**Değişiklik no:** CHANGE 3

> Bu spec'teki her iddia dosya okunarak doğrulandı ve `dosya:satır` ile gösterildi.
> Uygulayıcının ek keşif yapmasına gerek yoktur.

---

## 1. Amaç ve kapsam

### Ne çıkıyor

Kiracı (restoran) **kendi menüsünden** ürün seçer, seçtiği her ürün için Figurunica'nın
ürettiği bir **3D baskı figür** sipariş eder. Ödeme mevcut PayTR rayından geçer, üretim
kuyruğu superadmin panelinde görünür, kargo mevcut `Shipment` modeliyle takip edilir.

| | |
|---|---|
| Fiyat | **₺1.500 taban + ürün başına ₺50**, KDV **dahil**, kargo dahil |
| Kuruş | `150_000` taban + `5_000` × N |
| Minimum | 1 ürün |
| Maksimum | 50 ürün (`ArrayMaxSize(50)`) |
| Örnek | 1 ürün → ₺1.550 · 10 ürün → ₺2.000 · 50 ürün → ₺4.000 |
| Para birimi | TRY (tek para birimi — bkz. §8/T11) |
| Üretim referansı | Ürünün fotoğrafı varsa fotoğraf; yoksa **yalnızca ürün adı** |

### Ne ÇIKMIYOR (açıkça)

- **Stil / tarz seçimi yok.** Kullanıcı bu fikri açıkça iptal etti. Ne UI'da ne veri
  modelinde stil alanı vardır.
- **Meshy/AI 3D üretim hattı kullanılmaz.** `backend/src/modules/menu/services/product-3d.service.ts`
  ve `backend/src/modules/menu/controllers/product-3d.controller.ts` bu akışa hiç dokunmaz.
  GLB/STL üretimi yok, baskıya-hazırlık (watertight/manifold) işlemesi yok.
- **À-la-carte katalog satırı yok.** `ALACARTE_CATALOG` (`backend/src/modules/marketplace/alacarte-catalog.const.ts`)
  değişmez → T1 ve T5 tetiklenmez (§8).
- **Yeni entitlement/feature flag yok** → T4 tetiklenmez (§8).
- **Kargo ücreti yok** — hizmet satırı `shippingCents`'i tetiklemez (§4.6, doğrulandı).

### KAPSAM İÇİ ÖN KOŞUL — `acceptedDocumentIds` (takip maddesi DEĞİL)

Donanım mağazasının ödeme başlatması **bugün 400 alıyor** ve bu değişiklik onu ilk
yüzeye çıkaran iştir. Doğrulandı:

| Olgu | Yer |
|---|---|
| `CreateCheckoutIntentDto.acceptedDocumentIds` **zorunlu** (`@IsArray` + `@ArrayMinSize(3)` + `@ArrayMaxSize(3)` + `@IsUUID`, `@IsOptional` **yok**) | `backend/src/modules/checkout/dto/create-intent.dto.ts:139-144` |
| Controller gövdeyi bu DTO'ya bağlıyor → `ValidationPipe` alan yoksa **400** | `backend/src/modules/checkout/checkout.controller.ts:73-102` (`@Body() body: CreateCheckoutIntentDto` :82) |
| `useCreateCheckoutIntent` argüman tipinde `acceptedDocumentIds` **yok**, gövdeye de koymuyor | `frontend/src/features/hardware-store/storeApi.ts:285-304` |
| `StorePage.startCheckout` da vermiyor | `frontend/src/features/hardware-store/StorePage.tsx:195-224` |
| `hardware-store` dizininde `acceptedDocumentIds` **hiç geçmiyor** | `grep -rn acceptedDocumentIds frontend/src/features/hardware-store` → 0 sonuç (à-la-carte/marketplace rayları veriyor: `licensing/CatalogStore.tsx:172`, `marketplace/MarketplacePage.tsx:151`) |

Sihirbaz aynı `useCreateCheckoutIntent` kancasını kullanacağı için **bu düzeltme
olmadan 3D baskı hiç satılamaz**. Bu yüzden düzeltme bu değişikliğin kapsamındadır
(§4.9 sonu, §5/27 + 27b + 28) ve §9'a ertelenmez. Ayrıntılı risk kaydı §8/R7.

---

## 2. Kararlar (KESİN — her biri tek satır gerekçeyle)

| # | Karar | Gerekçe |
|---|---|---|
| K1 | Stil seçimi **yok**; fotoğraf varsa referans, yoksa ürün adı | Kullanıcı kararı; üretim ortağı zaten fotoğrafla çalışıyor. |
| K2 | Fiyat = 150_000 + 5_000×N kuruş, KDV **dahil**, kargo dahil | Katalogdaki tüm fiyatlar brüt; KDV `quote.service.ts:328-331`'de içeriden **çıkarılır**, üstüne eklenmez. |
| K3 | **À-la-carte add-on DEĞİL**, `HardwareProduct(category:'service')` rayı | Bir `oneTime` add-on **kiracı başına ömür boyu bir kez** satılabilir — kanıt §3.1. Hizmet tekrarlanabilir olmalı. |
| K4 | **İki hizmet SKU'su**: `print3d_base` (150_000, qty 1) + `print3d_item` (5_000, qty N) | `QuoteService` uçtan uca `unitCents × qty`; PayTR sepeti `amountCents`'e **birebir** toplanmak zorunda (`checkout-intent.service.ts:250-267`) → hesaplanan tek fiyat tek satırda ifade edilemez. |
| K5 | `CartItemDto.productIds?: string[]` alanı eklenir | `whitelist:true` (`main.ts:249-256`) tanımsız alanı **sessizce siler** (T8). |
| K6 | Adet **sunucu-otoriter**: `print3d_item.qty = productIds.length`, istemci qty **yok sayılır** | İstemci qty'sine güvenmek 50 figürü ₺50'ye satar. |
| K7 | Eşleşme zorunlu: `print3d_base` varsa `print3d_item` de olmalı ve tersi | Tek başına taban satırı = ürünsüz ₺1.500; tek başına kalem satırı = tabansız üretim. |
| K8 | Çapraz-kiracı `productId` **hata verir**, sessizce fiyatlanmaz | Başka kiracının menüsü üretim manifestosuna sızamaz. |
| K9 | Yeni Prisma modelleri `Print3dJob` + `Print3dJobItem`, `InstallationRequest` desenini aynalar, aynı `Serializable` tx içinde basılır | Ödeme ile üretim kaydı atomik olmalı (`checkout.service.ts:319,643-652`). |
| K10 | Her kalem **ad + fotoğraf URL + (varsa) `model3dUrl`** anlık görüntüsü (snapshot) tutar | Ürünler **hard-delete** ediliyor (`products.service.ts:515`) ve menü düzenlemesi geçmişi yeniden yazamaz. |
| K11 | `Print3dJobItem.productId` → `Product`, **nullable + `onDelete: SetNull`** | Hard-delete + `Restrict` olsaydı kiracı menü ürününü **hiç** silemezdi; `Cascade` olsaydı sipariş kaydı yok olurdu. |
| K12 | `Print3dJob.hwOrderId` → `HardwareOrder`, **NOT NULL + `onDelete: Cascade`** | İş yalnızca ödenmiş bir siparişin sonucu olarak doğar; başka yaratım yolu yok, `HardwareOrder` hiç silinmiyor (kod tabanında `hardwareOrder.delete` çağrısı yok). |
| K13 | İş durumu **yalnızca üretimi** izler; kargo `Shipment`'ta kalır | Tek gerçeğin tek kaynağı; iki yerde "kargolandı" tutmak kaçınılmaz olarak ayrışır. |
| K14 | Frontend'de **bağımsız sihirbaz**; paylaşılan `cartStore` kullanılmaz | `cartStore.setQty` hizmet satırlarını değiştirmiyor (`cartStore.ts:138-140`) → çoklu-ürün adedi yönetilemez. |
| K15 | Ortak URL'i **`https://figurunica.com`** (kullanıcı tarafından verildi, 2026-08-20). Kodda `PRINT3D_PARTNER_URL` sabiti olarak varsayılan, aynı adlı **backend env değişkeni** onu ezebilir | Değer artık biliniyor, yani rozet ilk günden bağlantılı çıkar. Env geçersiz kılması yine de kalıyor: ticari taraf değişirse yeniden derleme gerekmesin. `VITE_` değişkeni bundle'a gömülür, tenant-üstü ayar tablosu ise yok (§3.6) → env backend'de durur. |
| K16 | Rozet metni **asla boş değil**: URL geçerliyse `<a>`, env geçersiz bir değerle ezilmişse `<span>` | "Üretim ortağı: Figurunica" bir beyandır, bağlantıya bağlı değildir. Varsayılan URL geçerli olduğu için `<span>` dalı yalnızca hatalı env yapılandırmasında görülür — yine de test edilir. |
| K17 | `model3dUrl` varsa işe ek referans olarak **snapshot edilir** (v1'de EVET) | Bedava; yazıcının işine yarar; AI hattını çalıştırmaz — sadece varsa mevcut değeri kopyalar. |
| K18 | SKU regex'i `^[a-z0-9][a-z0-9_-]{2,63}$`'e **genişletilir** | Onaylı SKU'lar alt çizgi içeriyor; mevcut regex (`create-hardware-product.dto.ts:69`) alt çizgiyi reddeder → superadmin katalog API'sinden bu satırlar yönetilemezdi. Genişletme kesinlikle geriye dönük uyumlu (mevcut tüm SKU'lar hâlâ eşleşir). |

---

## 3. Mevcut durum — doğrulanmış çapa noktaları

### 3.1 `oneTime` add-on neden kullanılamaz (K3'ün kanıtı)

İki bağımsız mekanizma `oneTime` add-on'u "kiracı başına ömür boyu bir kez" yapar:

1. **Süpürücü hiç kapatmaz.** `backend/src/modules/marketplace/tenant-addon-sweeper.service.ts:78-79`:
   ```ts
   status: { in: ["active", "past_due"] },
   currentPeriodEnd: { lte: now, not: null },
   ```
   `oneTime` satın alım `currentPeriodEnd = null` bırakır
   (`tenant-marketplace.service.ts:261` — `let currentPeriodEnd: Date | null = null;`
   yalnızca `annual` dallarında doldurulur, :265/:270). `not: null` yüzünden satır
   **hiçbir zaman** `cancelled`/`expired` olmaz.

2. **İkinci alım reddedilir.** `backend/src/modules/checkout/addon-purchasability.rules.ts:134-139`:
   ```ts
   } else if (isOwned && !isRenewal) {
     return block("ADDON_ALREADY_OWNED", `"${addOn.name}" is already active for this account.`);
   }
   ```
   `isOwned`, `status:"active"` satırından gelir
   (`addon-purchasability.service.ts:103-117`). `kind: "credit"` ve `kind: "license"`
   muaftır (rules :96-108); `kind: "service"` **değildir**.

   Bu kapı ödeme **öncesinde** çalışır (`checkout-intent.service.ts:153-166`), yani
   kiracı ikinci figür siparişini hiç veremez.

**Sonuç:** tekrarlanabilir bir hizmet à-la-carte katalogda temsil edilemez. `HardwareProduct`
`service` kategorisi ise her seferinde yeni bir `HardwareOrder` doğurur ve zaten
`shippingAddress` + `Shipment` taşır.

### 3.2 Hizmet rayı — bugünkü davranış

| Olgu | Yer |
|---|---|
| `category: 'service'` v2.8.87'den beri var, `serviceMeta` taşır | `backend/prisma/schema.prisma:5333-5361` (yorum :5335-5337, `serviceMeta` :5361) |
| `HardwareSaleMode` enum'u | `backend/prisma/schema.prisma:5326-5331` |
| Kategori→tier varsayılan haritası, `service: "DIRECT_SALE"` | `backend/src/modules/catalog/dto/create-hardware-product.dto.ts:46-60` (service satırı :59) |
| Kategori sözlüğü, `{ value: "service", labelTr: "Kurulum & Hizmet" }` | `backend/src/modules/catalog/category-vocabulary.ts:29` |
| `serviceMeta` DTO alanı (`@IsObject`, değer kısıtı **yok**) | `create-hardware-product.dto.ts:163-172` |
| SKU regex — **alt çizgi yok** | `create-hardware-product.dto.ts:69-71` (`^[a-z0-9][a-z0-9-]{2,63}$`) ve `hardware-quote-request.dto.ts:25-26` |
| `UpdateHardwareProductDto` sku'yu **dışlar** | `update-hardware-product.dto.ts:7-8` (`OmitType(..., ["sku"])`) |
| Tohum: `SERVICES` dizisi + ortak upsert | `backend/prisma/seeds/seed-marketplace.ts:404` (dizi), `:1036-1077` (upsert), `:1102-1111` (envanter satırı) |
| Tohum `status: "published"` + `saleMode` zorlar | `seed-marketplace.ts:1062-1063` (T10 deseni — **kopyalanmayacak**) |

### 3.3 `QuoteService` — hizmet dalı

`backend/src/modules/checkout/quote.service.ts`

| Satır | Ne yapıyor |
|---|---|
| `:79` | `const qty = Math.max(1, "qty" in item && item.qty ? item.qty : 1);` — **istemci qty'si** |
| `:216` | `} else if (item.type === "service") {` |
| `:234-242` | `catalog.findBySkuOrThrow(item.code)`; `category !== "service" \|\| status !== "published"` → `service_not_purchasable` uyarısı + `continue` |
| `:250-256` | `saleMode !== "DIRECT_SALE"` → `service_not_directly_purchasable` + `continue` |
| `:269-282` | Katalog satırı yoksa 2 eski sabit koda düşer (`LEGACY_SERVICE_PRICES_CENTS`, :40-46) |
| `:283-286` | Çözülemezse `unknown_service` uyarısı + `continue` |
| `:288-307` | `lines.push({ type:"service", ..., unitCents: resolved.priceCents, subtotalCents: resolved.priceCents * qty, meta:{ branchId, serviceMeta, saleMode, preferredDates, notes } })` |
| `:309` | Ürün döngüsünün kapanışı |
| `:311-331` | Brüt toplam → net + gömülü KDV (`TR_KDV_RATE = 0.2`, :35). **KDV üste eklenmez.** |
| `:332-334` | `const hasHardware = lines.some(l => l.type === "hardware"); const shippingCents = hasHardware ? 5000 : 0;` |

Uyarı sözlüğü: `checkout.types.ts:124-136`
(`addon_not_purchasable`, `hardware_not_purchasable`, `hardware_not_directly_purchasable`,
`hardware_out_of_stock`, `service_not_purchasable`, `service_not_directly_purchasable`,
`unknown_service`).

### 3.4 `serviceType` bugün nerede okunuyor

`backend/src/modules/checkout/checkout.service.ts:332-339`:
```ts
const onsiteServiceLines = hardwareLines.filter(
  (l) => l.type === "service" &&
    (l.meta?.serviceMeta?.serviceType === "onsite" ||
     l.code.startsWith("onsite_install")),
);
```
Yalnızca `'onsite'` bir `InstallationRequest` basar (`:409-428`). `'remote'` ve
`'consultation'` hiçbir kayıt üretmez — fatura satırı olarak kalır
(`seed-marketplace.ts:392-399` yorumu).

**Kritik:** hizmet satırları **`HardwareOrderItem` üretmez** — `:380`'deki döngü
`filter((l) => l.type === "hardware")` ile sınırlıdır. Yani yalnız-hizmet siparişinin
`items` dizisi **boştur**.

### 3.5 Para rayı — doğrulanmış

| Adım | Yer |
|---|---|
| `POST /v1/checkout/intent` (ADMIN/MANAGER) | `checkout.controller.ts:73-103` |
| Yasal onam **PayTR jetonundan önce** | `checkout-intent.service.ts:121-136`; DTO zorunlu 3 UUID: `create-intent.dto.ts:138-143` |
| Fiyat dondurma + kota | `checkout-intent.service.ts:177-178`, `:283-302` |
| PayTR sepeti — her satır `qty:1`, `priceCents = subtotal + payı`, toplam `amountCents`'e **birebir** | `checkout-intent.service.ts:250-267`, `distributeOverhead` :346-370 |
| Yerleşim yeniden fiyatlar, **1 kuruş** tolerans | `checkout.service.ts:222-243` |
| `Serializable` tx | `checkout.service.ts:319-320`, `:643-652` |
| Kalemli fatura tx içinde, **tüm** quote satırları | `tenant-invoice.service.ts:104-129` |
| `hardware.order.placed.v1` olayı | `checkout.service.ts:623-641`; olay adı `outbox/event-types.ts:73` |

### 3.6 Platform ayarı yok — K15'in gerekçesi

`schema.prisma`'daki **her** `*Settings` modeli kiracıya bağlıdır:
`BankTransferSettings:1500`, `QrMenuSettings:1595`, `PosSettings:1634`,
`ReservationSettings:1666`, `SmsSettings:1712`, `IntegrationSettings:1823`,
`StockSettings:3734`, `AccountingSettings:4368`. Platform çapında bir anahtar/değer
tablosu **yoktur**. Opsiyonel env kuralı deseni: `backend/src/common/helpers/env-validation.ts:57`
(`{ key: "SENTRY_DSN", required: false, prodOnly: true }`).

### 3.7 Frontend çapaları

| Olgu | Yer |
|---|---|
| Mağaza sepeti → `/v1/checkout/intent` | `frontend/src/features/hardware-store/storeApi.ts:285-304` |
| Mağaza ödeme başlatma | `frontend/src/features/hardware-store/StorePage.tsx:195-224` |
| **Hizmet kartları ızgarası** (her `category==='service'` satırı ayrı kart) | `StorePage.tsx:331-350`, `ServiceCard` :680-718 |
| `?sku=` derin bağlantısı hizmetleri detay sayfasına yönlendirir | `StorePage.tsx:157-169` |
| Onam bileşeni + tamamlanma kancası | `frontend/src/features/legal/CheckoutConsent.tsx:19-23, 36-76, 109-111` |
| Onam kullanım örneği | `frontend/src/features/licensing/CatalogStore.tsx:53-54, 162-177, 451` |
| **Set-tabanlı modal çoklu-seçim deyimi** | `frontend/src/components/product/ImageLibraryModal.tsx:35-67` (`Set<string>` + `toggleSelection` + `handleConfirm` + `searchTerm` :38) |
| **Kontrollü dizi çoklu-seçim deyimi** | `frontend/src/pages/admin/menuManagement/CollectionMultiSelect.tsx:14-40` (`selected: string[]` + `onChange` + `toggle`) |
| Menü ürünleri kancası | `frontend/src/features/menu/menuApi.ts:195-206` |
| `Product` tipi (`image`, `images[]`, `model3dUrl`) | `frontend/src/types/index.ts:145-181` |
| `ProductFilters.search` **sunucuda uygulanmıyor** | tip `types/index.ts:948-952`; `products.service.ts:300-316` `search`'ü hiç okumaz |
| Ortak URL'i güvenli kılma deseni | `StorePage.tsx:548-553` (`/^https?:\/\//i` testi) |
| Superadmin kenar çubuğu | `frontend/src/features/superadmin/components/SuperAdminSidebar.tsx:21-32` |
| Superadmin rotaları | `frontend/src/App.tsx:872-916`; `lazyWithReload` :7 |
| Kiracı-geneli yol önekleri (aynalama gerekmiyor, §4.4) | `frontend/src/lib/api.ts:12-46` |

### 3.8 Sipariş karşılama (superadmin) — mevcut yüzeyler

| Olgu | Yer |
|---|---|
| `Shipment` modeli | `backend/prisma/schema.prisma:5542-5558` |
| `POST /v1/superadmin/shipments/:orderId`, `PATCH /:shipmentId/delivered`, `GET /:orderId` | `backend/src/modules/fulfillment/fulfillment.controller.ts:136-158` |
| `createShipment` — `paid`/`fulfillment` durumundan çalışır, `order.items` üzerinde döner (yalnız-hizmet siparişinde boş → no-op) | `backend/src/modules/fulfillment/shipment.service.ts:32-69` |
| Kiracı sipariş okuması | `backend/src/modules/checkout/hardware-orders.service.ts:14-54` |
| SPA'da superadmin kargo ekranı **yok** (yalnız backend) | `grep superadmin/shipments frontend/src` → 0 sonuç |

### 3.9 Menü ürünü — silme davranışı (K10/K11'in kanıtı)

`backend/prisma/schema.prisma:415-501` — `Product`'ta `deletedAt`/`isDeleted` **yok**.
`backend/src/modules/menu/services/products.service.ts:504-519` **gerçek silme** yapar
(`this.prisma.product.delete({ where: { id, tenantId } })`), yalnızca `OrderItem`
(`schema.prisma:1032-1033`, `onDelete: Restrict`) ve `ComboGroupItem` engelleyebilir
(`products.service.ts:521-545`).

Fotoğraf: `ProductImage` (`schema.prisma:638-655`) ↔ `ProductToImage`
(`schema.prisma:658-674`, `order` alanı :660). Birincil fotoğraf =
`productImages` `order asc` ilk kaydın `image.url`'ü (`products.service.ts:333-338`);
yoksa eski `Product.image` alanı (`schema.prisma:429`).

---

## 4. Tasarım

### 4.1 Mimari — tek bakışta

```
SPA sihirbazı (3 adım)
  └─ GET  /v1/print3d/offer                       → fiyat + ortak rozeti (sunucu otoritesi)
  └─ GET  /menu/products                          → ürün seçici
  └─ POST /v1/checkout/quote   { 2 hizmet satırı } → canlı doğrulama + gerçek toplam
  └─ POST /v1/checkout/intent  { 2 hizmet satırı + 3 onam belgesi } → PayTR
        │
        ▼  (PayTR webhook, CK- öneki)
  CheckoutSettlementService → CheckoutService.confirmAndProvision
        │  Serializable tx:
        ├─ HardwareOrder (status=paid, shippingAddress snapshot)
        ├─ Print3dJob            ← YENİ
        ├─ Print3dJobItem × N    ← YENİ (ad + foto + model3dUrl snapshot)
        ├─ TenantInvoice + 2 satır
        └─ outbox: checkout.completed.v1, hardware.order.placed.v1, print3d.job.created.v1
        │
        ▼
  Superadmin üretim paneli → Figurunica manifestosu → POST /v1/superadmin/shipments/:orderId
```

### 4.2 Katalog: iki hizmet SKU'su

`hardware_products` tablosuna iki satır (§6 migration + `SERVICES` dizisine ayna):

| Alan | `print3d_base` | `print3d_item` |
|---|---|---|
| `sku` | `print3d_base` | `print3d_item` |
| `category` | `service` | `service` |
| `name` | `3D baskı figür — hizmet bedeli` | `3D baskı figür — ürün başına` |
| `description` | `Menünüzden seçtiğiniz ürünlerin 3D baskı figürleri. Kargo dahil. Üretim ortağı: Figurunica.` | `Seçilen her menü ürünü için bir figür. Taban hizmet bedeliyle birlikte alınır.` |
| `priceCents` | `150000` | `5000` |
| `currency` | `TRY` | `TRY` |
| `status` | `published` | `published` |
| `saleMode` | `DIRECT_SALE` | `DIRECT_SALE` |
| `warrantyMonths` | `0` | `0` |
| `images` | `{/products/_fallback-service.svg}` | `{/products/_fallback-service.svg}` |
| `serviceMeta` | `{"serviceType":"print3d","partner":"figurunica","role":"base"}` | `{"serviceType":"print3d","partner":"figurunica","role":"item"}` |
| `complianceDocs` | `{"invoiceIssued": true}` (literal — `SEED_DEFAULT_COMPLIANCE` ile **birebir**, `seed-marketplace.ts:36-38`) | aynı |
| `stockStatus` | `in_stock` | `in_stock` |
| `rentalMonthlyCents` | `NULL` | `NULL` |

`serviceMeta.role` alanı, SKU dizesine ikinci kez bağımlı olmadan taban/kalem ayrımını
verir; `QuoteService` yine de SKU sabitlerini kullanır (tek okuma, iki teyit).

**`complianceDocs` neden tam olarak `{"invoiceIssued":true}`:** tohumun ortak upsert'ü
bu alanı `update: sharedData` içinde **her çalıştırmada üstüne yazıyor**
(`seed-marketplace.ts:1066-1068`), değer de `SEED_DEFAULT_COMPLIANCE`
(`seed-marketplace.ts:36-38`) yani `{ invoiceIssued: true }`. Migration başka bir şey
yazarsa (ör. `distributorName`) migre edilmiş veritabanı ile tohumlanmış veritabanı
**kalıcı olarak ayrışır** ve §7'deki `the seed SERVICES array agrees with the migration
on both SKUs` testi kırmızı olur. Tek bir anahtar `CatalogService.hasComplianceDocs`
(≥1 boş-olmayan değer) kapısını zaten geçirir.

**Sabitler** — `backend/src/modules/print3d/print3d.const.ts` (YENİ, **hiç import etmez**,
`entitlement-keys.const.ts` deseninde):

```ts
export const PRINT3D_SERVICE_TYPE = "print3d";
export const PRINT3D_PARTNER = "figurunica";
export const PRINT3D_PARTNER_LABEL = "Figurunica";
/** Varsayılan ortak sitesi; PRINT3D_PARTNER_URL env değişkeni ezebilir. */
export const PRINT3D_PARTNER_URL_DEFAULT = "https://figurunica.com";
export const PRINT3D_BASE_SKU = "print3d_base";
export const PRINT3D_ITEM_SKU = "print3d_item";
export const PRINT3D_BASE_PRICE_CENTS = 150_000;
export const PRINT3D_ITEM_PRICE_CENTS = 5_000;
export const PRINT3D_MIN_ITEMS = 1;
export const PRINT3D_MAX_ITEMS = 50;
export const PRINT3D_JOB_STATUSES = ["queued","in_production","produced","cancelled"] as const;
export const PRINT3D_ITEM_STATUSES = ["pending","printed","rejected"] as const;
```

Fiyat sabitleri **yalnızca** tohum/migration kaynağı ve sürüklenme testi içindir;
`QuoteService` fiyatı **her zaman** DB satırından okur (yeniden fiyatlama deploy istemesin).

### 4.3 Veri modeli (YENİ — `backend/prisma/schema.prisma`)

`InstallationRequest` bloğunun (`:5560-5580`) hemen ardına, `Warranty`'den (`:5582`) önce:

```prisma
/// 3D baskı figür üretim işi (üretim ortağı: Figurunica).
///
/// Bir Print3dJob, ödenmiş bir HardwareOrder'ın SONUCUDUR — başka yaratım yolu
/// yoktur (kiracı tarafında POST endpoint'i yok, InstallationRequest'ten farkı
/// budur). Bu yüzden hwOrderId NOT NULL + Cascade: sipariş yoksa iş de yoktur.
///
/// Durum YALNIZCA üretimi izler. Kargo/teslim Shipment'ta (schema.prisma:5542)
/// ve HardwareOrder.status'ta yaşar; aynı olguyu iki yerde tutmak kaçınılmaz
/// olarak ayrışır.
///   queued -> in_production -> produced
///   queued|in_production -> cancelled   (terminal)
model Print3dJob {
  id             String        @id @default(uuid())
  tenantId       String
  branchId       String?
  hwOrderId      String        @unique
  hwOrder        HardwareOrder @relation(fields: [hwOrderId], references: [id], onDelete: Cascade)
  status         String        @default("queued")
  /// Üretim ortağı kimliği. Bugün her zaman 'figurunica'; ikinci ortak
  /// geldiğinde bu kolon kuyruğu bölmeye yeter.
  partner        String        @default("figurunica")
  /// Satın alma anındaki fiyat anlık görüntüsü — SKU sonradan yeniden
  /// fiyatlansa bile bu işin ne kadara satıldığı değişmez.
  basePriceCents Int
  perItemCents   Int
  itemCount      Int
  totalCents     Int
  currency       String        @default("TRY")
  /// Alıcının sihirbazda yazdığı serbest not (üretim talimatı).
  note           String?       @db.Text
  /// Figurunica'nın kendi iş numarası; operatör panelden girer.
  partnerRef     String?
  /// Operatörün kuyruk notu (üretim/iptal gerekçesi).
  opsNote        String?       @db.Text
  producedAt     DateTime?
  cancelledAt    DateTime?
  createdAt      DateTime      @default(now())
  updatedAt      DateTime      @updatedAt

  items Print3dJobItem[]

  @@index([tenantId, status])
  @@index([status, createdAt])
  @@map("print3d_jobs")
}

/// İşin bir kalemi = seçilmiş BİR menü ürünü = BİR figür.
///
/// productId NULLABLE + SetNull: menü ürünleri GERÇEKTEN siliniyor
/// (menu/services/products.service.ts:515). Restrict olsaydı kiracı ürünü hiç
/// silemezdi; Cascade olsaydı ödenmiş siparişin kalemi yok olurdu. Snapshot
/// alanları bağ koptuğunda da manifestoyu ayakta tutar.
model Print3dJobItem {
  id        String     @id @default(uuid())
  jobId     String
  job       Print3dJob @relation(fields: [jobId], references: [id], onDelete: Cascade)
  productId String?
  product   Product?   @relation(fields: [productId], references: [id], onDelete: SetNull)
  /// Sipariş anındaki ad — sonraki menü düzenlemesi siparişi yeniden yazamaz.
  productName     String
  /// Sipariş anındaki birincil fotoğraf URL'i. NULL ise üretim yalnızca
  /// AD ile çalışır (ürün fotoğrafsızdı) — bu bilinçli bir üründür, hata değil.
  productImageUrl String?
  /// Ürün zaten bir GLB taşıyorsa yazıcıya ek referans olarak iletilir.
  /// Meshy/AI hattı BU AKIŞTA ÇALIŞTIRILMAZ; yalnızca mevcut değer kopyalanır.
  model3dUrl      String?
  position  Int
  status    String  @default("pending")
  opsNote   String? @db.Text
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([jobId, productId])
  @@index([jobId, position])
  @@map("print3d_job_items")
}
```

Ters ilişkiler (aynı dosyada):
- `HardwareOrder` (`:5421-5452`) → `print3dJob Print3dJob?` satırı `installations`
  (`:5447`) altına, `@@index([tenantId, status])` (`:5449`) öncesine.
  (`:5470` **yanlış çapaydı** — o satır `CheckoutIntent`'in doc yorumunun içinde kalıyor.)
- `Product` (`:415-501`) → `print3dJobItems Print3dJobItem[]` satırı `collections` (`:496`) altına.

### 4.4 API

#### Kiracı — `backend/src/modules/print3d/print3d.controller.ts` (YENİ)

`@Controller("v1/print3d")`, `@UseGuards(JwtAuthGuard)`, `@Roles(UserRole.ADMIN, UserRole.MANAGER)`.
**`@SkipBranchScope` YOK** — `/v1/checkout` de şube kapsamlı ve SPA zaten `X-Branch-Id`
gönderiyor; `frontend/src/lib/api.ts:12-46` listesine ekleme **yapılmaz**.
`branch-scope-contract.spec.ts` yalnızca `/me` rotalarını zorlar (`:116-127`), bu yüzden yeni
kural doğmaz.

| Metot | Yol | Döner |
|---|---|---|
| `GET` | `/v1/print3d/offer` | `{ basePriceCents, perItemCents, currency, minItems, maxItems, partnerName, partnerUrl }` — fiyatlar iki `HardwareProduct` satırından **canlı** okunur; satırlardan biri `published`+`DIRECT_SALE` değilse `available:false` döner ve SPA kartı gizler. |
| `GET` | `/v1/print3d/jobs` | Kiracının işleri: `items` (position asc), `hwOrder{ id,status,totalCents,createdAt,shippingAddress }`, `hwOrder.shipments`. |
| `GET` | `/v1/print3d/jobs/:id` | Tekil, `tenantId` bileşik WHERE ile. |

#### Superadmin — `backend/src/modules/print3d/superadmin-print3d.controller.ts` (YENİ)

`@SuperAdminRoute()` + `@UseGuards(SuperAdminGuard)`, `@Controller("v1/superadmin/print3d")`
(desen: `fulfillment.controller.ts:136-142`).

| Metot | Yol | Gövde |
|---|---|---|
| `GET` | `/jobs?status=&partner=` | — (tüm kiracılar; `tenant{ id,name }` dahil) |
| `GET` | `/jobs/:id` | — (Figurunica manifestosu: kalem adı + foto + `model3dUrl` + adres) |
| `PATCH` | `/jobs/:id/status` | `UpdatePrint3dJobStatusDto { status: PRINT3D_JOB_STATUSES, partnerRef?, opsNote? }` |
| `PATCH` | `/jobs/:id/items/:itemId` | `UpdatePrint3dJobItemDto { status: PRINT3D_ITEM_STATUSES, opsNote? }` |

Kargo için **yeni endpoint yok**: panel mevcut `POST /v1/superadmin/shipments/:orderId`
(`fulfillment.controller.ts:145-148`) çağırır.

Durum geçiş kuralları (`Print3dService.updateStatus`):
`queued → in_production | cancelled`; `in_production → produced | cancelled`;
`produced → (terminal)`; `cancelled → (terminal)`. Geçersiz geçiş `BadRequestException`
(`{ code: "PRINT3D_INVALID_TRANSITION", from, to }`). `produced` yazarken `producedAt = now()`,
`cancelled` yazarken `cancelledAt = now()`.

#### `CartItemDto` genişlemesi — `backend/src/modules/checkout/dto/cart.dto.ts`

`notes` alanından sonra (`:114` civarı):

```ts
  // v3.7.0 — 3D baskı figür hizmeti: alıcının KENDİ menüsünden seçtiği ürünler.
  // print3d_item satırının ADEDİ bu diziden TÜRETİLİR; istemcinin qty'si
  // yok sayılır (QuoteService). Alan burada BEYAN EDİLMEK ZORUNDA: main.ts'in
  // ValidationPipe'ı whitelist:true ile çalışır (main.ts:249-256) ve beyan
  // edilmemiş alanı SESSİZCE siler — dizi kaybolur, adet 1'e düşer, 50 figür
  // 50 kuruşa satılır.
  @ApiPropertyOptional({ type: [String], format: "uuid", minItems: 1, maxItems: 50 })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsUUID("all", { each: true })
  productIds?: string[];
```

`ArrayMinSize`, `ArrayMaxSize`, `IsArray`, `IsUUID` zaten import edilmiş
(`cart.dto.ts:1-17`). `CartItemService` arayüzüne (`checkout.types.ts:26-43`) aynı alan
`productIds?: string[];` olarak eklenir.

### 4.5 `QuoteService` değişikliği — tam konum ve semantik

`backend/src/modules/checkout/quote.service.ts`

**(a) Seçim çözümü — döngüden önce.** `:76` (`const licensing = await ...`) ile
`:78` (`for (const item of cart.items)`) arasına:

```ts
// v3.7.0 — 3D baskı seçimi TEK SEFERDE çözülür: adet sunucu-otoriterdir ve
// ürünlerin kiracıya ait olduğu satır fiyatlanmadan ÖNCE doğrulanır.
const print3d = await this.resolvePrint3dSelection(cart, tenantId);
```

Yeni private metot (aynı sınıfın sonuna, `quote()`'tan sonra):

```ts
private async resolvePrint3dSelection(cart: Cart, tenantId: string) {
  // TAM SAYIM, `find` DEĞİL. `CartDto.items` yalnızca ArrayMinSize(1)/
  // ArrayMaxSize(50) taşır (cart.dto.ts:117-124) — TEKİLLİK KISITI YOK.
  // `find` kullanılsaydı iki `print3d_item` satırı gönderen bir istemci
  // İKİSİNİ de ilk satırın productIds.length'iyle fiyatlatır (§4.5b tek
  // `print3d` nesnesini her eşleşen satır için okur), provizyon ise §4.7'deki
  // `find` yüzünden YALNIZ BİRİNİ basardı: alıcı 2N figür öder, N alır.
  // Aynısı çift `print3d_base` için de geçerli (2 × ₺1.500 tahsil, tek iş).
  const itemLines = cart.items.filter(
    (i) => i.type === "service" && i.code === PRINT3D_ITEM_SKU,
  ) as CartItemService[];
  if (itemLines.length === 0) return null;
  if (itemLines.length > 1) {
    throw new BadRequestException({
      code: "PRINT3D_DUPLICATE_LINE",
      message: "3D baskı siparişi eksik; lütfen sihirbazı yeniden başlatın.",
    });
  }
  const itemLine = itemLines[0];

  const ids = [...new Set(itemLine.productIds ?? [])];
  if (ids.length < PRINT3D_MIN_ITEMS) {
    throw new BadRequestException({
      code: "PRINT3D_NO_PRODUCTS",
      message: "En az bir menü ürünü seçmelisiniz.",
    });
  }
  if (ids.length > PRINT3D_MAX_ITEMS) {
    throw new BadRequestException({
      code: "PRINT3D_TOO_MANY_PRODUCTS",
      message: `En fazla ${PRINT3D_MAX_ITEMS} ürün seçebilirsiniz.`,
    });
  }

  const rows = await this.prisma.product.findMany({
    where: { id: { in: ids }, tenantId },
    select: {
      id: true, name: true, image: true, model3dUrl: true,
      productImages: {
        select: { image: { select: { url: true } } },
        orderBy: { order: "asc" },
        take: 1,
      },
    },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const missing = ids.filter((id) => !byId.has(id));

  if (missing.length > 0) {
    // "Eksik" iki farklı olgu olabilir ve MUAMELELERİ ZITTIR:
    //   a) satır BAŞKA bir kiracıya ait  -> güvenlik ihlali, HER ZAMAN reddet;
    //   b) satır hiç yok (silinmiş)      -> yerleşim anında yeniden fiyatlama
    //      sırasında olabilir (checkout.service.ts:222). Burada FIRLATMAK
    //      "kart çekildi, hiçbir şey sağlanmadı" demektir; fiyat zaten
    //      ids.length'ten türediği için tutar DEĞİŞMEZ. Kaydı bozulmuş
    //      snapshot'la sürdür.
    const foreign = await this.prisma.product.findMany({
      where: { id: { in: missing } },
      select: { id: true },
    });
    if (foreign.length > 0) {
      throw new BadRequestException({
        code: "PRINT3D_FOREIGN_PRODUCT",
        message: "Seçilen ürünlerden biri bu restorana ait değil.",
      });
    }
  }

  return {
    productIds: ids,
    snapshots: ids.map((id, i) => {
      const r = byId.get(id);
      return {
        productId: r ? r.id : null,
        name: r?.name ?? "Silinmiş ürün",
        imageUrl: r?.productImages?.[0]?.image?.url ?? r?.image ?? null,
        model3dUrl: r?.model3dUrl ?? null,
        position: i,
      };
    }),
  };
}
```

`import { BadRequestException }` zaten var (`:1`); `PrismaService` zaten enjekte
(`:51`); `Product` sorgusu için ek bağımlılık yok.

**(b) Adet türetme — hizmet dalı içinde.** `:287` (`currency = resolved.currency;`) ile
`:288` (`lines.push({`) arasına:

```ts
// Adet SUNUCU-OTORİTER. print3d_item için istemcinin qty'si (:79) yok sayılır
// ve seçilen ürün sayısından türetilir; print3d_base her zaman 1'dir.
const isPrint3d =
  (resolved.serviceMeta as any)?.serviceType === PRINT3D_SERVICE_TYPE;
const effectiveQty = !isPrint3d
  ? qty
  : item.code === PRINT3D_ITEM_SKU
    ? (print3d?.productIds.length ?? 0)
    : 1;
```
`lines.push` içinde `qty` yerine `effectiveQty`, `subtotalCents` da
`resolved.priceCents * effectiveQty` olur. `meta`'ya iki alan eklenir:
```ts
    ...(isPrint3d && item.code === PRINT3D_ITEM_SKU
      ? { print3dProductIds: print3d!.productIds,
          print3dSnapshots: print3d!.snapshots }
      : {}),
```

**(c) Eşleşme zorunluluğu — döngüden hemen sonra.** `:309`'daki `}` ile `:311`'deki
KDV yorumu arasına:

```ts
// print3d taban/kalem AYRILAMAZ. Bu kontrol döngüden SONRA, üretilmiş
// SATIRLAR üzerinde çalışır; böylece hem "istemci satırı göndermedi" hem de
// "satır bir uyarıyla düşürüldü" (service_not_purchasable / not_directly_
// purchasable / unknown_service — :240, :251, :284) durumlarını yakalar.
// Düşürülen taban satırı, alıcının ürün başına ₺50 ödeyip hizmeti almaması
// demekti; düşürülen kalem satırı ise ürünsüz ₺1.500.
//
// `some` DEĞİL, SAYIM: sepette tekillik kısıtı yok (cart.dto.ts:117-124).
// `baseCount > 1` iki kez ₺1.500 tahsil eder, `itemCount > 1` ise 2N figür
// fiyatlanıp N figür provizyonlanır (§4.7 tek satır basar). İkisi de para
// hatasıdır; tam eşitlik + tekillik istenir.
const baseCount = lines.filter((l) => l.code === PRINT3D_BASE_SKU).length;
const itemCount = lines.filter((l) => l.code === PRINT3D_ITEM_SKU).length;
if (baseCount !== itemCount || baseCount > 1) {
  throw new BadRequestException({
    code: "PRINT3D_INCOMPLETE_CART",
    message: "3D baskı siparişi eksik; lütfen sihirbazı yeniden başlatın.",
  });
}
```

> `resolvePrint3dSelection` çift **kalem** satırını `PRINT3D_DUPLICATE_LINE` ile daha
> döngüden önce keser; buradaki `baseCount > 1` ise çift **taban** satırını yakalar
> (taban satırının `productIds`'i yoktur, o yüzden çözücüye hiç uğramaz). İki kapı
> birbirinin yedeği değil, tamamlayıcısıdır.

**Yeni uyarı kodu eklenmez.** Mevcut sözlük (`checkout.types.ts:124-136`) katalog
durumunu zaten kapsıyor; print3d hataları uyarı değil **hard reject**'tir, çünkü
sessizce düşürülen bir satır doğrudan yanlış tutar tahsil eder.

**`PricedLineMeta` genişlemesi** (`checkout.types.ts:95-103`, `serviceMeta` yanına):
```ts
  /** v3.7.0 — 3D baskı: seçilen menü ürünlerinin id'leri (adet buradan türer). */
  print3dProductIds?: string[];
  /** v3.7.0 — provizyon anında dondurulacak ad/foto/model anlık görüntüleri. */
  print3dSnapshots?: {
    productId: string | null;
    name: string;
    imageUrl: string | null;
    model3dUrl: string | null;
    position: number;
  }[];
```

### 4.6 Kargo: hizmet-yalnız sepet ₺0 gönderilir — **BİLİNÇLİ**

`quote.service.ts:332-334`:
```ts
const hasHardware = lines.some((l) => l.type === "hardware");
const shippingCents = hasHardware ? 5000 : 0;
```
`type` `"service"` olduğu için sabit 5000 kuruş **tetiklenmez**. Bu, "kargo fiyata
dahil" vaadiyle **birebir örtüşür** ve bir hata değildir. Bunu "düzeltmek" ilan edilen
fiyatın üstüne ₺50 bindirir ve `checkout.service.ts:233-243`'teki 1 kuruş toleransını
patlatır. `quote-print3d.spec.ts` bunu kalıcı olarak çivileyecek (§7).

### 4.7 Provizyon — `CheckoutService` içindeki yeni dal

`backend/src/modules/checkout/checkout.service.ts`, `onsiteServiceLines` döngüsünün
kapanışı (`:428`) ile `if` bloğunun kapanışı (`:429`) arasına:

```ts
// v3.7.0 — 3D baskı figür işi. Aynı Serializable tx içinde (:319, :643-652)
// basılır: ödeme ile üretim kaydı ya birlikte var olur ya hiç. serviceType
// yalnızca 'onsite' iken InstallationRequest basılıyordu (:332-339); bu
// ikinci dal 'print3d' içindir ve InstallationRequest BASMAZ (saha ziyareti
// yok, order.installation NULL kalır).
const p3dItemLine = hardwareLines.find(
  (l) => l.type === "service" && l.code === PRINT3D_ITEM_SKU,
);
const p3dBaseLine = hardwareLines.find(
  (l) => l.type === "service" && l.code === PRINT3D_BASE_SKU,
);
if (p3dItemLine && p3dBaseLine) {
  const snapshots = p3dItemLine.meta?.print3dSnapshots ?? [];
  await tx.print3dJob.create({
    data: {
      id: uuidv7(),
      tenantId,
      branchId: validatedBranchId,
      hwOrderId: order.id,
      status: "queued",
      partner: PRINT3D_PARTNER,
      basePriceCents: p3dBaseLine.unitCents,
      perItemCents: p3dItemLine.unitCents,
      itemCount: p3dItemLine.qty,
      totalCents: p3dBaseLine.subtotalCents + p3dItemLine.subtotalCents,
      currency: quote.currency,
      note: p3dItemLine.meta?.notes ?? null,
      items: {
        create: snapshots.map((s) => ({
          id: uuidv7(),
          productId: s.productId,
          productName: s.name,
          productImageUrl: s.imageUrl,
          model3dUrl: s.model3dUrl,
          position: s.position,
          status: "pending",
        })),
      },
    },
  });
  await tx.outboxEvent.create({
    data: {
      id: uuidv7(),
      type: "print3d.job.created.v1",
      tenantId,
      payload: {
        tenantId,
        hardwareOrderId: order.id,
        itemCount: p3dItemLine.qty,
        totalCents: p3dBaseLine.subtotalCents + p3dItemLine.subtotalCents,
        partner: PRINT3D_PARTNER,
      } as any,
      idempotencyKey: `print3d-job:${order.id}`,
      status: "queued",
      nextAttemptAt: new Date(),
    },
  });
}
```

`EventTypes` (`backend/src/modules/outbox/event-types.ts`) `HardwareOrderDelivered`
satırının (**`:75`**) ardına: `Print3dJobCreated: "print3d.job.created.v1",`.

**Yinelenmezlik:** print3d sepeti her zaman bir hizmet satırı içerir → `hardwareLines`
boş değildir → `HardwareOrder` yaratılır → `confirmAndProvision`'ın
`hardwareOrder.findFirst({ tenantId, paymentRef })` idempotans kapısı (`:251-286`)
PayTR yeniden denemesinde erken döner ve ikinci iş basılmaz. `Print3dJob.hwOrderId`
üzerindeki `@unique` bunu veritabanı düzeyinde de garanti eder.

### 4.8 Sipariş e-postası düzeltmesi (zorunlu)

`checkout-notifications.service.ts:125-129` kalemleri **yalnızca** `HardwareOrderItem`'dan
okur; hizmet satırları orada yok (§3.4) → alıcı **boş kalem tablolu** bir sipariş
e-postası alır. `sendOrderPlacedEmail` içinde `include: { items: true }` (`:81`)
`include: { items: true, print3dJob: { include: { items: true } } }` yapılır ve
`items` dizisine sentetik bir satır eklenir:

```ts
const p3d = order.print3dJob;
if (p3d) {
  items.push({
    name: `3D baskı figür — ${p3d.itemCount} ürün (üretim ortağı: Figurunica)`,
    qty: p3d.itemCount,
    lineTotal: fmt(p3d.totalCents),
  });
}
```
Genel "hizmet satırları e-postada görünmüyor" boşluğu §9'da takip maddesi olarak
kayıtlıdır; burada yalnızca print3d kapatılır.

### 4.9 Frontend — mağaza sihirbazı

Yeni dizin: `frontend/src/features/print3d/`.

**Mağaza kartı.** `StorePage.tsx:331-350` hizmet ızgarası **her** `category==='service'`
satırı için bir `ServiceCard` (`:680-718`) basar → düzeltilmezse alıcı "3D baskı figür —
hizmet bedeli" ve "— ürün başına" adında **iki ayrı kart** görür ve ikisi de yanlış
detay sayfasına gider. Bu yüzden:

1. `:344`'teki filtre `.filter((p) => p.category === 'service' && !isPrint3dSku(p))`
   olur (`isPrint3dSku`, `print3d/print3dSkus.ts` içinde saf yardımcı).
2. **Bölüm kapısı da elenir.** Izgaranın bir üstündeki koşul
   `products.some((p) => p.category === 'service')` (`StorePage.tsx:332`) filtrelenmemiş
   durumda. Yalnızca `:344`'ü filtrelemek, katalogdaki tek hizmet satırları iki print3d
   SKU'su olduğunda (taze kurulum ya da operatör `install-full-pos`'u arşivlemişse)
   **boş ızgaranın üstünde "Hizmetler" başlığı + alt başlığı** bırakır. Kapı da
   `products.some((p) => p.category === 'service' && !isPrint3dSku(p))` olur.
3. Izgaranın **başına** tek bir `<Print3dStoreCard />` konur; `useGetPrint3dOffer()`
   `available:false` dönerse kart hiç basılmaz. (Kart `Print3dStoreCard` içinde
   render edildiği için 2. maddedeki kapı onu gizlemez.)
4. `:157-169` derin bağlantı etkisi: `sku` iki print3d SKU'sundan biriyse
   `/admin/store/print3d` sihirbazına yönlendirilir (detay sayfasına değil).
5. **Ham SKU'nun DETAY ROTASI da kapatılır — yoksa SKU tek başına satılabilir kalır.**
   `/admin/store/:sku` rotası (`frontend/src/App.tsx:813`) `ProductDetailPage`'e gider;
   sayfa `sku`'yu `useParams`'tan okur (`ProductDetailPage.tsx:63`), `product.category
   === 'service'` dalına girer (`:89`) ve şube seçici + tercih edilen tarihler +
   **"Sepete ekle"** düğmesi olan tam bir satın alma paneli basar (`ServiceDetail`
   `:327-510`, `addService` `:335`, "Sepete ekle" etiketi `:487`). Yani `/admin/store/print3d_base`
   doğrudan sepete girebilir ve quote motoru alıcı formu doldurduktan **sonra**
   `PRINT3D_INCOMPLETE_CART` ile reddeder. Üstelik `:379-384`'teki etiket zinciri
   bilinmeyen her `serviceType` için `'onsite'`e düşer → sayfa bir 3D baskı hizmetini
   **"Yerinde kurulum"** diye etiketler. Çözüm: `useGetProductBySku` sonrası,
   render'dan **önce**
   `if (sku && isPrint3dSku(sku)) return <Navigate to="/admin/store/print3d" replace />;`
   (React Router v6 statik segmenti dinamikten önce sıralar, `/admin/store/print3d`
   rotası zaten kazanır; bu guard yazılan/yer imlenen ham SKU URL'leri içindir).

**Sihirbaz.** `frontend/src/features/print3d/Print3dWizardPage.tsx` (rota
`/admin/store/print3d`, `App.tsx`'te `lazyWithReload` ile — SPA konvansiyonu, `App.tsx:7`).

| Adım | İçerik |
|---|---|
| 1 — Ürün seçimi | `useProducts()` (`menuApi.ts:195-206`) ile TÜM ürünler; **istemci-taraflı** arama kutusu (`ProductFilters.search` sunucuda uygulanmıyor — `products.service.ts:300-316`) + kategori `<select>`'i; kart ızgarasında küçük resim (`images[0].url ?? image`), ad, fiyat; sağ altta **canlı fiyat sayacı**. Seçim durumu `Set<string>`, `toggleSelection` + `maxSelection=50` — `ImageLibraryModal.tsx:35-67` deyiminin birebir aynısı. Sihirbazın dışına `string[]` olarak yayınlanır (`CollectionMultiSelect.tsx:14-40` kontrollü-dizi deyimi). |
| 2 — Teslimat | Mevcut `ShippingAddressForm` (`frontend/src/features/hardware-store/ShippingAddressForm.tsx`) **aynen** yeniden kullanılır (şubeye gönder / manuel adres, `branchId` döndürür) + 500 karakterlik `notes` alanı. |
| 3 — Özet → PayTR | Satır satır: `1 × Taban ₺1.500`, `N × Ürün başına ₺50`, `Kargo ₺0`, `Toplam`; `<CheckoutConsent accepted onChange />` (`legal/CheckoutConsent.tsx:36`) + `useConsentComplete` (`:109-111`) ile Öde düğmesi kilitli; ardından `POST /v1/checkout/quote` ile **sunucu toplamı** doğrulanır (istemci aritmetiği asla nihai değildir), sonra `/v1/checkout/intent`. |

**Sepet kullanılmaz** (K14): sihirbaz kendi iki satırlık `CartItem[]`'ını üretir:
```ts
[
  { type: 'service', code: 'print3d_base', qty: 1, branchId },
  { type: 'service', code: 'print3d_item', qty: selected.length,
    productIds: selected, branchId, notes },
]
```

**Onam boşluğu — MEVCUT ÜRETİM HATASI, kapsam içi ön koşul (§1).**
`storeApi.ts:285-304`'teki `useCreateCheckoutIntent` `acceptedDocumentIds`
**göndermiyor** ve `StorePage.startCheckout` (`:195-224`) da vermiyor; oysa
`CreateCheckoutIntentDto.acceptedDocumentIds` **zorunlu**
(`create-intent.dto.ts:139-144`) ve controller gövdeyi bu DTO'ya bağlıyor
(`checkout.controller.ts:82`) → `ValidationPipe` **400** veriyor. Bu değişiklik
kapsamında:
- `useCreateCheckoutIntent` argüman tipine `acceptedDocumentIds: string[]` **zorunlu**
  alan olarak eklenir (TypeScript her çağıranı derleme zamanında yakalar);
- **Derleyicinin ilk yakalayacağı çağıran bir TEST dosyasıdır:**
  `frontend/src/features/hardware-store/storeApi.test.tsx:216-227`
  (`useCreateCheckoutIntent POSTs the intent endpoint`) `mutateAsync`'i onam id'si
  olmadan çağırıyor. CI frontend job'ı `npx tsc --noEmit` çalıştırır
  (`.github/workflows/quality-gates.yml`, "Typecheck" adımı) ve `tsconfig.json`
  tüm `src`'yi kapsar → bu dosya güncellenmezse **CI kırmızı**. Kontrol listesi 27b.
- `StorePage.startCheckout` `CheckoutConsent`'i ödeme modalına ekler ve id'leri geçirir;
- `Print3dWizardPage` en baştan geçirir.

### 4.10 Frontend — superadmin üretim paneli

- Rota: `/superadmin/print3d` → `frontend/src/pages/superadmin/Print3dProductionPage.tsx` (YENİ),
  `App.tsx:911` (`/superadmin/legal`) ile `:912` (`/superadmin/settings`) arasına;
  `lazyWithReload` importu `App.tsx:43` yanına.
- Kenar çubuğu: `SuperAdminSidebar.tsx:30` ile `:31` arasına
  `{ nameKey: 'nav.print3d', href: '/superadmin/print3d', icon: Boxes, defaultLabel: '3D Üretim' }`
  (`Boxes` `lucide-react` importuna eklenir, `:5-17`). Mevcut test
  (`SuperAdminSidebar.test.tsx:35-50`) `expected.forEach(...toContain)` kullanır → yeni bağlantı
  testi bozmaz.
- API kancaları: `frontend/src/features/superadmin/api/superadminPrint3dApi.ts` (YENİ),
  `superadminMarketplaceApi.ts:237-294` desenini izler.
- Panel içeriği: durum sekmeleri (`queued` / `in_production` / `produced` / `cancelled`),
  satırda kiracı adı + kalem sayısı + tutar + tarih; detay çekmecesinde
  **Figurunica manifestosu** (küçük resim + ürün adı + `model3dUrl` bağlantısı + kalem
  durumu), teslimat adresi, ve iki eylem: durum ilerlet / `partnerRef` gir; ayrıca
  mevcut `POST /v1/superadmin/shipments/:orderId` ile kargo oluştur + `PATCH
  /v1/superadmin/shipments/:shipmentId/delivered`.
- Manifesto dışa aktarımı: istemci-taraflı CSV (`ürün adı, fotoğraf URL, model3dUrl, adet`)
  — sunucuda yeni endpoint yok.

### 4.11 Rozet: "Üretim ortağı: Figurunica"

- **Kaynak:** `PRINT3D_PARTNER_URL_DEFAULT = "https://figurunica.com"` (§4.2 sabitler bloğu),
  aynı adlı **opsiyonel** env değişkeniyle ezilebilir:
  `config.get("PRINT3D_PARTNER_URL") ?? PRINT3D_PARTNER_URL_DEFAULT`.
  `backend/src/common/helpers/env-validation.ts` `RULES` dizisine
  `{ key: "PRINT3D_PARTNER_URL", required: false }`; `backend/.env.example`'a
  `PRINT3D_PARTNER_URL=` (boş = varsayılanı kullan) yorumuyla birlikte.
- **Taşıyıcı:** `GET /v1/print3d/offer` yanıtındaki `partnerUrl`. Sunucu yalnızca
  `/^https?:\/\//i` eşleşen bir değeri yayınlar, aksi halde `null` (açık yönlendirme /
  `javascript:` yükü koruması — `StorePage.tsx:548-553` deseni).
- **Bileşen:** `frontend/src/features/print3d/PartnerBadge.tsx` (YENİ).
  `partnerUrl` varsa (normal durum — varsayılan `https://figurunica.com`) metin
  `<a href target="_blank" rel="noopener noreferrer">` içinde; env geçersiz bir değerle
  ezildiği için sunucu `null` döndürdüyse düz `<span>Üretim ortağı: Figurunica</span>`.
  **Metin hiçbir koşulda boş değil.**
- **Basıldığı dört yüzey:** mağaza kartı (`Print3dStoreCard`), sihirbazın üç adımının
  başlığı, özet adımı (`Print3dSummary`), ve dönüş/onay ekranı (`HardwareCheckoutResult`
  print3d siparişi ise).

---

## 5. Değişecek dosyalar — SIRALI kontrol listesi

Sıra bağımlılık-doğrudur: her adım yalnızca kendinden öncekilere dayanır.

> ⚠️ **ORTAK DOSYA UYARISI — bu PR üç paralel değişikliğin SONUNCUSUDUR.**
> `feat/multi-country-architecture` üzerinde Change 1 (teslimat paketi) ve Change 2
> (kartlı vardiya) aşağıdaki dosyalara da dokunuyor. **Merge sırası: Change 1 →
> Change 2 → Change 3 (bu PR)** — §6'daki migration zinciriyle aynı sıra.
>
> | Dosya | Change 1 (teslimat) | Change 2 (kartlı vardiya) | Change 3 (bu PR) |
> |---|---|---|---|
> | `backend/src/modules/catalog/dto/create-hardware-product.dto.ts` | — | `CATEGORY_DEFAULT_SALE_MODE`'a `card_reader` satırı (`:46-60`) | SKU regex `:69` genişletilir (§5/5) |
> | `frontend/src/pages/superadmin/MarketplaceAdminPage.tsx` | — | kategori `<select>`'ine `<option value="card_reader">` (`:603-611`) | **aynı** `<select>`'e `<option value="service">` (§5/35b) |
> | `docs/SISTEM_TANITIMI.md` | `:90` satırı yeniden yazılıyor | `:86`'nın **altına** yeni satır + `:217` düzeltmesi | `:97`'nin **altına** yeni satır (§5/41) |
> | `docs/PAZARLAMACI_REHBERI.md` | `:84-86` + `:91` | `:75`'in altına yeni satır, `:110-114` tablosunun **ardına** yeni "Donanım" bölümü | `:114` tablosunun **içine** yeni satır (§5/42) |
> | `help/pages/{tr,en}/marketplace/products.mdx` | tr `:173-212` üç bölüm tek bölüme **daraltılıyor** | tr `:95`'ten sonra yeni bölüm | tr `:343`/`:345`'e yeni bölüm (§5/43) |
>
> **Mutlak satır çıpaları merge sonrası GEÇERSİZDİR.** Change 1 `products.mdx`
> tr:173-212'yi tek bölüme indirdiği, `SISTEM_TANITIMI.md:90`'ı tek satıra çevirdiği ve
> Change 2 araya satır eklediği an bu belgedeki her `:NNN` kayar. Bu PR rebase
> edildiğinde çıpalar **içerik eşlemesiyle** yeniden çözülür (bölüm başlığının metni,
> tablo satırının ilk hücresi), satır numarasıyla **değil**. Tabloları ve bölümleri
> "bütünüyle yeniden üretmek" YASAK — yalnız burada adı geçen satırlar eklenir; iki
> öncekinin eklediği satırlar okunup üstüne yazılır, ezilmez.

### Backend — sözleşme ve şema

1. `backend/src/modules/print3d/print3d.const.ts` — **YENİ** (§4.2 sabitleri; hiç import etmez).
2. `backend/prisma/schema.prisma` — `Print3dJob` + `Print3dJobItem` modelleri
   (`InstallationRequest` bloğu `:5560-5580`, `Warranty` `:5582` → ikisinin arasına);
   `HardwareOrder`'a (`:5421-5452`) `print3dJob Print3dJob?` satırı `installations`
   (**`:5447`**) altına, `@@index([tenantId, status])` (`:5449`) öncesine; `Product`'a
   (`:415-501`) `print3dJobItems Print3dJobItem[]` satırı `collections` (`:496`) altına.
3. `backend/prisma/migrations/20260820170000_print3d_service/migration.sql` — **YENİ** (§6).
4. `backend/prisma/migrations/20260820170000_print3d_service/down.sql` — **YENİ** (§6).
5. `backend/src/modules/catalog/dto/create-hardware-product.dto.ts` — SKU regex `:69`
   `^[a-z0-9][a-z0-9_-]{2,63}$`, mesaj `"sku must be lowercase, alphanumeric + hyphen/underscore, 3-64 chars"`.
   ⚠️ **Ortak dosya:** kartlı-vardiya PR'ı aynı dosyada `CATEGORY_DEFAULT_SALE_MODE`'a
   (`:46-60`) `card_reader` satırı ekliyor. İki düzenleme farklı bloklarda ama aynı
   dosyada buluşur; bu PR yalnız `@Matches` satırını ve mesajını değiştirir, haritaya
   dokunmaz.
6. `backend/src/modules/catalog/dto/hardware-quote-request.dto.ts` — aynı regex `:25-26`.
7. `backend/prisma/seeds/seed-marketplace.ts` — `SERVICES` dizisine (`:404`) iki print3d
   girdisi (§4.2 tablosu). `status`/`saleMode` **elle yazılmaz**; ortak upsert (`:1062-1063`)
   zaten atar.

### Backend — fiyatlandırma ve provizyon

8. `backend/src/modules/checkout/checkout.types.ts` — `CartItemService.productIds?: string[]`
   (`:26-43`); `PricedLineMeta.print3dProductIds` + `print3dSnapshots` (`:95-103`).
9. `backend/src/modules/checkout/dto/cart.dto.ts` — `CartItemDto.productIds` (§4.4).
10. `backend/src/modules/checkout/quote.service.ts` — `resolvePrint3dSelection` + adet
    türetme + eşleşme kontrolü (§4.5 a/b/c).
11. `backend/src/modules/outbox/event-types.ts` — `Print3dJobCreated`
    (`HardwareOrderDelivered` `:75` altına).
12. `backend/src/modules/print3d/print3d.service.ts` — **YENİ** (kiracı okumaları,
    superadmin kuyruğu, durum geçişleri, `getOffer()`).
13. `backend/src/modules/print3d/dto/print3d-ops.dto.ts` — **YENİ**
    (`UpdatePrint3dJobStatusDto`, `UpdatePrint3dJobItemDto`; `@IsIn(PRINT3D_*_STATUSES)`).
14. `backend/src/modules/print3d/print3d.controller.ts` — **YENİ** (kiracı).
15. `backend/src/modules/print3d/superadmin-print3d.controller.ts` — **YENİ**.
16. `backend/src/modules/print3d/print3d.module.ts` — **YENİ** (`imports: [PrismaModule]`,
    `exports: [Print3dService]`).
17. `backend/src/modules/checkout/checkout.service.ts` — print3d provizyon dalı (§4.7).
18. `backend/src/modules/checkout/checkout.module.ts` — `imports`'a `Print3dModule` (`:22-40`).
19. `backend/src/app.module.ts` — `Print3dModule` kaydı (mevcut modül listesine).
20. `backend/src/modules/checkout/checkout-notifications.service.ts` — e-posta kalem düzeltmesi (§4.8).
20b. `backend/src/modules/checkout/hardware-orders.service.ts:14-52` — **kiracı sipariş
    okumaları da print3d'yi görmeli** (R5'in azaltması; bugün hiçbir kontrol maddesi
    bunu uygulamıyordu). `listMine` (`:14-40`) ve `getMine` (`:43-52`) `include`'ları
    yalnızca `items` / `shipments` / `installations` taşıyor; hizmet satırları
    `HardwareOrderItem` üretmediği için (§3.4, `checkout.service.ts:380`) ödenmiş bir
    ₺2.000'lik print3d siparişi **boş kalem tablosu + sıfır-olmayan toplam** gösteriyor.
    Her iki include'a eklenir:
    ```ts
    print3dJob: {
      select: {
        id: true, status: true, itemCount: true, totalCents: true, partner: true,
        items: {
          select: { productName: true, productImageUrl: true, position: true, status: true },
          orderBy: { position: "asc" },
        },
      },
    }
    ```
21. `backend/src/common/helpers/env-validation.ts` — `{ key: "PRINT3D_PARTNER_URL", required: false }`.
22. `backend/.env.example` — `PRINT3D_PARTNER_URL=` + yorum: boş bırakılırsa kod
    varsayılanı (`https://figurunica.com`) kullanılır; yalnızca ortak sitesi değişirse doldurulur.

### Frontend

22b. `frontend/public/products/_fallback-service.svg` — **YENİ** (`landing/public/products/_fallback-service.svg`
    dosyasının birebir kopyası). Katalog satırları `images` olarak
    `/products/_fallback-service.svg` taşıyor, ama `frontend/public/products/` dizini
    **yok** — varlık yalnızca `landing/public/` altında. `ServiceCard`
    (`StorePage.tsx:556`, `{p.images?.[0] && <ProductImage src={p.images[0]} …/>}`)
    bu yolu SPA'dan ister ve 404 alır. Tohumdaki mevcut hizmetler de aynı yolu
    kullanıyor (`seed-marketplace.ts:412`), dolayısıyla kopya onları da düzeltir.
23. `frontend/src/features/print3d/print3dSkus.ts` — **YENİ** (saf: `isPrint3dSku`,
    `PRINT3D_BASE_SKU`, `PRINT3D_ITEM_SKU`, `computePrint3dTotalCents(n, base, perItem)`).
24. `frontend/src/features/print3d/partnerBadge.ts` — **YENİ** (`safePartnerUrl`).
25. `frontend/src/features/print3d/PartnerBadge.tsx` — **YENİ**.
26. `frontend/src/features/print3d/print3dApi.ts` — **YENİ**
    (`useGetPrint3dOffer`, `useListPrint3dJobs`, `useGetPrint3dJob`).
27. `frontend/src/features/hardware-store/storeApi.ts` — `useCreateCheckoutIntent`
    argümanına **zorunlu** `acceptedDocumentIds: string[]` (`:285-304`); `CartItem`
    arayüzüne `productIds?: string[]` (`:78-90`).
27b. `frontend/src/features/hardware-store/storeApi.test.tsx:216-227` — 27 numaralı
    maddeyi yapan derleyicinin **ilk yakalayacağı çağıran budur.**
    `useCreateCheckoutIntent POSTs the intent endpoint` testindeki `mutateAsync({ cart:
    { items: [] }, buyer: {...} })` çağrısına `acceptedDocumentIds: ['d1','d2','d3']`
    eklenir ve `expect.objectContaining` iddiası bu alanı da kapsayacak şekilde
    genişletilir; aksi halde CI frontend job'ının `npx tsc --noEmit` adımı
    (`.github/workflows/quality-gates.yml`) **KIRMIZI** olur (`tsconfig.json` tüm
    `src`'yi kapsıyor).
28. `frontend/src/features/hardware-store/StorePage.tsx` — hizmet **bölüm kapısı**
    (`:332` → `products.some((p) => p.category === 'service' && !isPrint3dSku(p))`;
    yalnız `:344`'ü filtrelemek boş başlıklı "Hizmetler" bölümü bırakır), hizmet ızgarası
    filtresi (`:344`), `Print3dStoreCard` yerleştirme (`:331-350`), derin bağlantı
    yönlendirmesi (`:157-169`), ödeme modalına `CheckoutConsent` + `acceptedDocumentIds`
    (`:195-224`).
28b. `frontend/src/features/hardware-store/ProductDetailPage.tsx` — `useGetProductBySku`
    sonrası, render'dan **ÖNCE**:
    `if (sku && isPrint3dSku(sku)) return <Navigate to="/admin/store/print3d" replace />;`
    (`sku` `useParams`'tan, `:63`). Böylece `/admin/store/print3d_base` (`App.tsx:813`
    dinamik rotası) tek başına sepete eklenemez — `ServiceDetail` `:327-510` paneli ve
    `:487`'deki "Sepete ekle" düğmesi hiç basılmaz — ve `:379-384`'teki bilinmeyen
    `serviceType` → **"Yerinde kurulum"** etiket düşüşü tetiklenmez.
29. `frontend/src/features/print3d/Print3dProductPicker.tsx` — **YENİ** (adım 1).
30. `frontend/src/features/print3d/Print3dSummary.tsx` — **YENİ** (adım 3).
31. `frontend/src/features/print3d/Print3dWizardPage.tsx` — **YENİ**.
32. `frontend/src/features/print3d/Print3dStoreCard.tsx` — **YENİ**.
33. `frontend/src/features/hardware-store/HardwareCheckoutResult.tsx` — print3d onay
    metni + `PartnerBadge`.
33b. `frontend/src/features/hardware-store/HardwareOrderDetailPage.tsx` +
    `HardwareOrdersListPage.tsx` — 20b'nin karşılığı. Detay sayfası `order.items.map`
    ile kalem tablosu basıyor (`HardwareOrderDetailPage.tsx:87`); print3d siparişinde
    bu dizi **boş** → `items.length === 0 && print3dJob` dalında kalem tablosunun
    yerine "3D baskı figür — N ürün" bloğu (kalem adları + `PartnerBadge`) render
    edilir. Liste sayfası `order.itemCount` sütunu basıyor
    (`HardwareOrdersListPage.tsx:112, :142`) ama **backend bu alanı hiç döndürmüyor**
    (`hardware-orders.service.ts` ham Prisma satırlarını veriyor; `itemCount` yalnız
    FE tipinde var, `storeApi.ts:348`) — o sütun `print3dJob.itemCount ?? order.itemCount`
    ile beslenir. MEVCUT testler (`HardwareOrderDetailPage.test.tsx`,
    `HardwareOrdersListPage.test.tsx`) bu dalla genişletilir.
34. `frontend/src/features/superadmin/api/superadminPrint3dApi.ts` — **YENİ**.
35. `frontend/src/pages/superadmin/Print3dProductionPage.tsx` — **YENİ**.
35b. `frontend/src/pages/superadmin/MarketplaceAdminPage.tsx:602-612` — kategori
    `<select>`'ine **`<option value="service">service</option>`** (`caller_id` satırının
    ardına, `:610`). **Bu madde olmadan iki print3d satırı superadmin ürün formundan
    hiç yönetilemez:** `<select>` bugün yalnız
    `kds_screen / tablet / pos_terminal / printer / yazarkasa / bridge / scanner /
    caller_id / other` sunuyor (`:603-611`), yani `category:'service'` seçilemiyor ve
    form `category` alanını gönderdiği için (`:583`) yeni bir hizmet satırı panelden
    **açılamıyor**. SKU regex genişletmesi (§5/5, K18/R12) tek başına yetmez — regex
    yolu açar, `<select>` hâlâ kapalı tutar.
    Bu `<select>` sözlükten (`category-vocabulary.ts:16-31`, `CATEGORY_VALUES` `:33`)
    **türemiyor** ve zaten drift'te: sözlükteki `cash_drawer` / `scale` / `accessory` /
    `cable` / `service` eksik, sözlükte **olmayan** `other` fazladan. Bu PR yalnız
    **kendi** değerini (`service`) ekler; `CATEGORY_VALUES`'a dokunmaya gerek YOKTUR
    (`service` orada zaten var, `category-vocabulary.ts:29`). Mevcut driftin tamamını
    onarmak ve `<select>`'i `GET /v1/catalog/categories`'ten beslemek kapsam dışıdır
    (§9/9 — kartlı-vardiya spec'i de aynı boşluğu kaydediyor).
    ⚠️ **Ortak dosya:** kartlı-vardiya PR'ı aynı `<select>`'e `card_reader` ekliyor;
    iki düzenleme birbirine bitişik satırlara düşer, ikisi de korunur.
36. `frontend/src/features/superadmin/components/SuperAdminSidebar.tsx` — nav girdisi (`:30-31`).
37. `frontend/src/App.tsx` — `/admin/store/print3d` ve `/superadmin/print3d` rotaları
    (`:872-916` bloğu ve admin bloğu), `lazyWithReload` importları.

### i18n — BEŞ YEREL AYARIN HEPSİ (T6)

38. `frontend/src/i18n/locales/{tr,en,ru,ar,uz}/hardware.json` — `print3d.*` bloğu
    (kart, sihirbaz 3 adımı, fiyat satırları, rozet, hata kodları
    `PRINT3D_NO_PRODUCTS` / `PRINT3D_TOO_MANY_PRODUCTS` / `PRINT3D_FOREIGN_PRODUCT` /
    `PRINT3D_INCOMPLETE_CART` / `PRINT3D_DUPLICATE_LINE`).
39. `frontend/src/i18n/locales/{tr,en,ru,ar,uz}/superadmin.json` — `nav.print3d` +
    `print3d.*` (kuyruk başlıkları, durum etiketleri, manifesto alan adları).

**Her dize gerçekten çevrilecek.** `en` referans yereldir
(`scripts/check-i18n-parity.mjs:18` — `const REFERENCE = "en";`); İngilizce değere Türkçe yazmak parity'yi
geçer ama beş yerelin hepsi Türkçe render eder (T6). Yeni anahtar eklendikten sonra
`node scripts/check-i18n-value-drift.mjs --gate-new scripts/i18n-value-drift-baseline.json`
temiz dönmeli.

### Dokümantasyon

40. `docs/superpowers/specs/2026-08-20-3d-baski-figur-hizmeti-design.md` — bu belge.
41. `docs/SISTEM_TANITIMI.md:97` — mevcut tek hizmet satırının
    (`| Yerinde Kurulum & Eğitim | hizmet / tek seferlik | ₺7.500 |`) altına
    `| 3D baskı figür (taban + ürün başına) | hizmet / tek seferlik | ₺1.500 + ₺50/ürün |`.
42. `docs/PAZARLAMACI_REHBERI.md:114` — "Hizmet (tek seferlik)" tablosuna
    `| 3D Baskı Figür | **₺1.500 + ₺50/ürün** | Menüden seçilen her ürün için bir figür; KDV ve kargo dahil, üretim ortağı Figurunica |`.
43. `help/pages/tr/marketplace/products.mdx` (`## Hizmet` `:343`, mevcut
    `### Yerinde Kurulum & Eğitim (tek seferlik)` `:345`) **ve**
    `help/pages/en/marketplace/products.mdx` (`## Service` `:347`) — `### 3D Baskı Figür`
    / `### 3D Print Figurine` alt bölümü: Tür: Hizmet · Fatura: Tek seferlik · Fiyat:
    ₺1.500 + ₺50 ürün başına (KDV ve kargo dahil) · Ne işe yarar: **hak vermez**, bir
    üretim siparişidir · Bağımlılık: — · **Tekrar satın alınabilir** (à-la-carte
    `oneTime` add-on'ların aksine; gerekçe §3.1).

> Bu üç yüzey elle bakımlıdır ve bugün platformdaki **tek** hizmet satırını sayıyor;
> yeni bir satılabilir kalem eklenip buralara yazılmazsa satış ekibi ve yardım portalı
> onu hiç görmez.

---

## 6. Migration

**Dizin:** `backend/prisma/migrations/20260820170000_print3d_service/`

**Zaman damgası — v3.7.0 zincirinin TAMAMI (bağlayıcı, üç spec ortak kararı):**

| Sıra | Dizin | Değişiklik |
|---|---|---|
| 1 | `20260820120000_reprice_licence_and_stock` | CHANGE 0 — ağaçta, başka bir oturumun işi (dokunulmaz) |
| 2 | `20260820140000_delivery_platforms_bundle` | CHANGE 1 |
| 3 | `20260820150000_card_shift_schema` | CHANGE 2a |
| 4 | `20260820160000_card_shift_catalog` | CHANGE 2b |
| 5 | **`20260820170000_print3d_service`** | **CHANGE 3 — BU BELGE** |

Bu değişiklik zincirin **son halkasıdır**; hiçbir öncekiyle çakışmaz ve
`prisma migrate deploy` sırasını bozmaz. (Önceki taslaktaki `20260820140000` üç spec
arasında çakışıyordu — artık `170000`.)

Tek dizin, çünkü DDL ile katalog satırları **birlikte** inmelidir: SKU'suz tablo ölüdür,
tablosuz SKU provizyonu patlatır.

### `migration.sql`

```sql
-- @doctor:idempotent verified=CREATE TABLE/INDEX IF NOT EXISTS; FK'ler DO/EXCEPTION duplicate_object ile sarılı; iki hardware_products upsert'i ON CONFLICT (sku) DO UPDATE (status HARİÇ); hardware_inventory INSERT'ü ON CONFLICT ("productId") DO NOTHING. Yeniden çalıştırma aynı duruma yakınsar. Hiçbir tenant/ownership/order satırına dokunmaz.
--
-- 20260820170000_print3d_service
-- v3.7.0 — 3D baskı figür hizmeti (üretim ortağı: Figurunica).
--
-- İki parça:
--   1. print3d_jobs + print3d_job_items tabloları (üretim kaydı).
--   2. hardware_products'a iki hizmet SKU'su (satılabilir katalog satırı).
--
-- Neden marketplace_addons DEĞİL: bir oneTime add-on kiracı başına ömür boyu
-- BİR KEZ satılabilir — süpürücü currentPeriodEnd IS NULL satırını hiç
-- kapatmaz (tenant-addon-sweeper.service.ts:78-79) ve ikinci alım
-- ADDON_ALREADY_OWNED ile reddedilir (addon-purchasability.rules.ts:134-139).
-- Bu hizmet tekrarlanabilir olmak zorunda.
--
-- TABLO ADLARI snake_case: CI `prisma db push` kullanır ve migration SQL'ini
-- HİÇ çalıştırmaz, bu yüzden PascalCase bir ad yalnızca production deploy'da
-- 42P01 verir.

CREATE TABLE IF NOT EXISTS "print3d_jobs" (
    "id"             TEXT NOT NULL,
    "tenantId"       TEXT NOT NULL,
    "branchId"       TEXT,
    "hwOrderId"      TEXT NOT NULL,
    "status"         TEXT NOT NULL DEFAULT 'queued',
    "partner"        TEXT NOT NULL DEFAULT 'figurunica',
    "basePriceCents" INTEGER NOT NULL,
    "perItemCents"   INTEGER NOT NULL,
    "itemCount"      INTEGER NOT NULL,
    "totalCents"     INTEGER NOT NULL,
    "currency"       TEXT NOT NULL DEFAULT 'TRY',
    "note"           TEXT,
    "partnerRef"     TEXT,
    "opsNote"        TEXT,
    "producedAt"     TIMESTAMP(3),
    "cancelledAt"    TIMESTAMP(3),
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL,
    CONSTRAINT "print3d_jobs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "print3d_job_items" (
    "id"              TEXT NOT NULL,
    "jobId"           TEXT NOT NULL,
    "productId"       TEXT,
    "productName"     TEXT NOT NULL,
    "productImageUrl" TEXT,
    "model3dUrl"      TEXT,
    "position"        INTEGER NOT NULL,
    "status"          TEXT NOT NULL DEFAULT 'pending',
    "opsNote"         TEXT,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL,
    CONSTRAINT "print3d_job_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "print3d_jobs_hwOrderId_key"
    ON "print3d_jobs"("hwOrderId");
CREATE INDEX IF NOT EXISTS "print3d_jobs_tenantId_status_idx"
    ON "print3d_jobs"("tenantId", "status");
CREATE INDEX IF NOT EXISTS "print3d_jobs_status_createdAt_idx"
    ON "print3d_jobs"("status", "createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "print3d_job_items_jobId_productId_key"
    ON "print3d_job_items"("jobId", "productId");
CREATE INDEX IF NOT EXISTS "print3d_job_items_jobId_position_idx"
    ON "print3d_job_items"("jobId", "position");

-- FK'ler: ADD CONSTRAINT IF NOT EXISTS yok, bu yüzden duplicate_object yutulur
-- (20260601000000_v3_branch_scope_strict deseni).
DO $$ BEGIN
  ALTER TABLE "print3d_jobs"
    ADD CONSTRAINT "print3d_jobs_hwOrderId_fkey"
    FOREIGN KEY ("hwOrderId") REFERENCES "hardware_orders"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "print3d_job_items"
    ADD CONSTRAINT "print3d_job_items_jobId_fkey"
    FOREIGN KEY ("jobId") REFERENCES "print3d_jobs"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Menü ürünleri GERÇEKTEN siliniyor (products.service.ts:515). SET NULL:
-- Restrict kiracının ürünü silmesini sonsuza dek engellerdi, Cascade ise
-- ödenmiş siparişin kalemini yok ederdi. Snapshot kolonları manifestoyu
-- bağ koptuktan sonra da ayakta tutar.
DO $$ BEGIN
  ALTER TABLE "print3d_job_items"
    ADD CONSTRAINT "print3d_job_items_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "products"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- Katalog satırları. ON CONFLICT DO UPDATE'te "status" YOKTUR: bir operatör
-- SKU'yu bilinçli olarak 'archived' yaptıysa migration'ın yeniden çalışması
-- onu satışa geri açmamalı (seed-marketplace.ts:1062'deki zorlamayı KOPYALAMA).
--
-- complianceDocs TAM OLARAK '{"invoiceIssued":true}' — SEED_DEFAULT_COMPLIANCE
-- (seed-marketplace.ts:36-38) ile birebir. Tohumun ortak upsert'ü bu alanı
-- `update: sharedData` içinde her koşuda üstüne yazar (seed-marketplace.ts:
-- 1066-1068), bu yüzden başka bir değer yazmak migre-edilmiş ve tohumlanmış
-- veritabanlarını kalıcı olarak ayrıştırır (ve §7'deki seed↔migration
-- sürüklenme testini kırar). distributorName gibi ek anahtar EKLEME.
INSERT INTO "hardware_products" (
  "id","sku","category","name","description","priceCents","currency",
  "warrantyMonths","images","stockStatus","status","saleMode","serviceMeta",
  "complianceDocs","createdAt","updatedAt"
) VALUES (
  gen_random_uuid()::text, 'print3d_base', 'service',
  '3D baskı figür — hizmet bedeli',
  'Menünüzden seçtiğiniz ürünlerin 3D baskı figürleri. Kargo dahil. Üretim ortağı: Figurunica.',
  150000, 'TRY', 0, ARRAY['/products/_fallback-service.svg']::TEXT[],
  'in_stock', 'published', 'DIRECT_SALE',
  '{"serviceType":"print3d","partner":"figurunica","role":"base"}'::jsonb,
  '{"invoiceIssued":true}'::jsonb,
  NOW(), NOW()
), (
  gen_random_uuid()::text, 'print3d_item', 'service',
  '3D baskı figür — ürün başına',
  'Seçilen her menü ürünü için bir figür. Taban hizmet bedeliyle birlikte alınır.',
  5000, 'TRY', 0, ARRAY['/products/_fallback-service.svg']::TEXT[],
  'in_stock', 'published', 'DIRECT_SALE',
  '{"serviceType":"print3d","partner":"figurunica","role":"item"}'::jsonb,
  '{"invoiceIssued":true}'::jsonb,
  NOW(), NOW()
)
ON CONFLICT ("sku") DO UPDATE SET
  "category"       = EXCLUDED."category",
  "name"           = EXCLUDED."name",
  "description"    = EXCLUDED."description",
  "priceCents"     = EXCLUDED."priceCents",
  "currency"       = EXCLUDED."currency",
  "images"         = EXCLUDED."images",
  "saleMode"       = EXCLUDED."saleMode",
  "serviceMeta"    = EXCLUDED."serviceMeta",
  "complianceDocs" = EXCLUDED."complianceDocs",
  "updatedAt"      = NOW();

-- Tohum her katalog girdisi için bir envanter satırı açar
-- (seed-marketplace.ts:1104-1111); migre edilmiş bir veritabanı tohumlanmış
-- bir veritabanından farklı görünmesin. Hizmetler stok tüketmez: available 0.
INSERT INTO "hardware_inventory" ("id","productId","available","allocated","shipped","serialsAvailable","updatedAt")
SELECT gen_random_uuid()::text, p."id", 0, 0, 0, ARRAY[]::TEXT[], NOW()
  FROM "hardware_products" p
 WHERE p."sku" IN ('print3d_base','print3d_item')
ON CONFLICT ("productId") DO NOTHING;
```

### `down.sql`

```sql
-- 20260820170000_print3d_service geri alımı.
--
-- İKİ DEĞİŞMEZ:
--   (1) ÖDENMİŞ ÜRETİM KAYDINA ASLA DOKUNMA. Standing kural: down yalnızca
--       up'ın eklediğini kaldırır, operatör/çalışma-zamanı verisine dokunmaz.
--       Bu yüzden koşulsuz DROP TABLE YASAK: bir zamanlar bu dosyada
--       "DROP TABLE IF EXISTS print3d_jobs" vardı ve katalog DELETE'inin
--       koruduğu ödenmiş işleri — üstelik guard'ın KENDİ KANITINI — yok
--       ediyordu.
--   (2) İDEMPOTAN. İkinci koşu hata VERMEZ. Tablolar düştükten sonra
--       "NOT EXISTS (SELECT 1 FROM print3d_jobs)" ayrıştırma aşamasında
--       42P01 undefined_table verirdi; bu yüzden her print3d_jobs referansı
--       to_regclass ile korunur.

-- 0) FAIL-FAST: ödenmiş iş varsa geri alım BAŞLAMADAN, sessizce değil GÜRÜLTÜYLE
--    durur. RAISE EXCEPTION tüm down işlemini geri sarar (katalog DELETE'i de
--    dahil), yani veritabanı tutarlı kalır ve operatör ne yapacağını bilir.
DO $$
DECLARE n bigint;
BEGIN
  IF to_regclass('public.print3d_jobs') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM "print3d_jobs"' INTO n;
    IF n > 0 THEN
      RAISE EXCEPTION
        'ABORT: print3d_jobs holds % paid job(s). Export and delete them before rolling back 20260820170000_print3d_service.', n;
    END IF;
  END IF;
END $$;

-- 1) Envanter satırları — YALNIZCA bu migration'ın up'ının açtığı iki satır.
--    ÜRÜN SİLİNMEDEN ÖNCE çalışmalı, çünkü kapsam sku üzerinden join'leniyor.
--    (Kapsamsız bir "orphan sweep" platform genelinde başka SKU'ların stok
--    sayaçlarını — allocated/shipped geçmişi dahil — silebilirdi. FK zaten
--    Cascade'dir, schema.prisma:5406, ama down dar kapsamlı olmak zorunda.)
DELETE FROM "hardware_inventory" hi
 USING "hardware_products" hp
 WHERE hi."productId" = hp."id"
   AND hp."sku" IN ('print3d_base','print3d_item')
   AND hi."allocated" = 0
   AND hi."shipped" = 0;

-- 2) Katalog satırları. Guard, à-la-carte down'undaki "NOT EXISTS(tenant_addons)"
--    korumasının donanım rayındaki karşılığıdır: ödenmiş bir satın alımı ASLA
--    öksüz bırakma. Hizmet satırları hardware_order_items üretmiyor
--    (checkout.service.ts:380), bu yüzden asıl kanıt print3d_jobs'tır — ikisine
--    de bakılır. to_regclass sarmalayıcısı ikinci koşuyu (tablo artık yok)
--    hatasız kılar.
DELETE FROM "hardware_products" hp
 WHERE hp."sku" IN ('print3d_base','print3d_item')
   AND NOT EXISTS (
     SELECT 1 FROM "hardware_order_items" hoi WHERE hoi."productId" = hp."id"
   )
   AND (
     to_regclass('public.print3d_jobs') IS NULL
     OR NOT EXISTS (SELECT 1 FROM "print3d_jobs")
   );

-- 3) Tabloları düşür. Buraya ulaşıldıysa 0. adım hiçbir ödenmiş iş bulmadı.
DROP TABLE IF EXISTS "print3d_job_items";
DROP TABLE IF EXISTS "print3d_jobs";
```

> **Davranış (bilinçli, standing kurala uygun):** ödenmiş bir `print3d_jobs` satırı
> varken `down.sql` **hiçbir şey silmez ve gürültüyle durur** — `RAISE EXCEPTION`
> tüm işlemi geri sarar, iki tablo ve içindeki her satır **olduğu gibi kalır**,
> katalog satırları da silinmez. Geri alım gerçekten isteniyorsa operatörün sırası:
> işleri dışa aktar → sil → `down.sql`'i yeniden çalıştır. Boş (hiç sipariş alınmamış)
> bir ortamda down uçtan uca çalışır ve **ikinci kez** çalıştırıldığında da hata
> vermez (`to_regclass` + `IF EXISTS`). Eski taslaktaki koşulsuz `DROP TABLE`
> **kaldırıldı**: katalog guard'ının koruduğu veriyi yok ediyor ve ikinci koşuda
> `42P01 undefined_table` veriyordu.

### Idempotans + gidiş-dönüş kanıt planı

Tek seferlik atılabilir Postgres üzerinde
(`docker run --rm -d --name print3d-migtest -e POSTGRES_PASSWORD=probe -p 55433:5432 postgres:16`),
**55433** portunda — teslimat paketi değişikliğinin `mig-probe` konteyneri 55432'yi kullanıyor
ve iki kanıt aynı anda koşabilmeli:
`scripts/`'e **eklenmeyen** geçici bir kabuk oturumunda:

1. `prisma migrate deploy` → up uygulanır.
2. `psql -f migration.sql` **ikinci kez** → hata yok; `SELECT count(*) FROM hardware_products WHERE sku LIKE 'print3d%'` = 2; `priceCents` değişmemiş; `complianceDocs` = `{"invoiceIssued": true}`.
3. `UPDATE hardware_products SET status='archived' WHERE sku='print3d_base';` → `psql -f migration.sql` → `status` **hâlâ** `archived` (T10 kanıtı).
4. **Ödenmiş-iş guard'ı (ÖNCE bu, çünkü yıkıcı olan senaryo bu):** bir `hardware_orders`
   satırı + ona bağlı bir `print3d_jobs` satırı + bir `print3d_job_items` satırı ekle →
   `psql -f down.sql` → komut **`ABORT: print3d_jobs holds 1 paid job(s)…` ile hata verir**
   (`echo $?` ≠ 0), ve ardından doğrula: `print3d_jobs` ile `print3d_job_items` tabloları
   **HÂLÂ VAR**, satırlar **bozulmamış**, iki katalog satırı **silinmemiş**, envanter
   satırları yerinde. (İşlem geri sarıldığı için hiçbir adım kısmen uygulanmaz.)
5. Guard'ı temizle: `DELETE FROM print3d_jobs;` `DELETE FROM hardware_orders WHERE id=…;`
6. `psql -f down.sql` → tablolar düşer, iki katalog satırı ve iki envanter satırı silinmiş;
   **başka hiçbir** `hardware_inventory` satırına dokunulmamış (öncesi/sonrası
   `SELECT count(*) FROM hardware_inventory` farkı tam **2**).
7. `psql -f down.sql` **ikinci kez** → hata yok (`to_regclass` guard'ı `42P01`'i önler;
   `DROP TABLE IF EXISTS` zaten no-op). Eski taslak bu adımda patlıyordu.
8. `psql -f migration.sql` → up yeniden uygulanır, aynı duruma varılır (**up → down → up** kanıtlanmış).

---

## 7. Test planı

### Backend — birim / değişmez

**`backend/src/modules/checkout/quote-print3d.spec.ts`** — YENİ
(`quote-services.spec.ts:22-48` bare-construct kalıbı; `prisma.product.findMany` mock'lanır)

| Test adı | Doğrulanan |
|---|---|
| `derives the print3d_item quantity from productIds.length and IGNORES the client qty` | `productIds` 7 elemanlı + `qty: 1` gönderilir → satır `qty === 7`, `subtotalCents === 35_000` |
| `prices 1 base + N items as 150000 + 5000*N kuruş, KDV dahil` | N=10 → `totalCents === 200_000`; `subtotalCents === 166_667`; `taxCents === 33_333` |
| `charges ZERO shipping for a service-only print3d cart` | `shippingCents === 0` (§4.6 çivisi) |
| `rejects a print3d_item line with no matching print3d_base line` | `PRINT3D_INCOMPLETE_CART` fırlatır |
| `rejects a print3d_base line with no matching print3d_item line` | aynı kod |
| `rejects a cart carrying two print3d_item lines` | `PRINT3D_DUPLICATE_LINE`; iki satır 2N figür fiyatlanıp N provizyonlanmasını engeller (§4.5a) |
| `rejects a cart carrying two print3d_base lines` | `PRINT3D_INCOMPLETE_CART` (`baseCount > 1`); iki kez ₺1.500 tahsilini engeller (§4.5c) |
| `rejects a print3d line whose companion was dropped by a catalog warning` | `print3d_base` satırı `status:'draft'` → `service_not_purchasable` uyarısı + `PRINT3D_INCOMPLETE_CART` |
| `rejects a productId that belongs to another tenant` | tenant-filtreli sorgu boş, filtresiz sorgu dolu → `PRINT3D_FOREIGN_PRODUCT` |
| `prices a DELETED product without throwing so a settled payment still provisions` | tenant-filtreli sorgu boş, filtresiz sorgu **da** boş → fırlatmaz, `qty` yine `ids.length`, snapshot adı `"Silinmiş ürün"` |
| `rejects an empty productIds selection` | `PRINT3D_NO_PRODUCTS` |
| `rejects more than 50 products` | `PRINT3D_TOO_MANY_PRODUCTS` |
| `deduplicates repeated productIds before deriving the quantity` | `[a,a,b]` → `qty === 2` |
| `snapshots the primary image url, falling back to the legacy image column` | `productImages[0].image.url` öncelikli; yoksa `product.image`; ikisi de yoksa `null` |
| `snapshots model3dUrl when the product already has one` | K17 |

**`backend/src/modules/checkout/checkout-print3d-provision.spec.ts`** — YENİ
(`checkout-install-trigger.spec.ts:34-88` tx-mock kalıbı)

| Test adı | Doğrulanan |
|---|---|
| `mints one Print3dJob with one item per selected product, inside the provisioning tx` | `tx.print3dJob.create` bir kez; `items.create.length === N`; `position` 0..N-1 |
| `does NOT mint an InstallationRequest for a print3d service line` | `tx.installationRequest.create` çağrılmaz; `order.installation === null` |
| `snapshots name + image + model3dUrl so a later menu edit cannot rewrite the order` | job item alanları quote meta'sından birebir |
| `freezes basePriceCents/perItemCents/totalCents from the priced lines` | SKU sonradan yeniden fiyatlansa bile iş değişmez |
| `emits print3d.job.created.v1 with idempotencyKey print3d-job:<orderId>` | outbox |
| `an idempotent replay of the same paymentRef does not mint a second job` | `hardwareOrder.findFirst` var → erken dönüş, `print3dJob.create` çağrılmaz |

**`backend/src/modules/print3d/print3d.service.spec.ts`** — YENİ

| Test adı | Doğrulanan |
|---|---|
| `getOffer reads live prices from the two catalog rows, never the constants` | DB 160_000 dönerse teklif 160_000 |
| `getOffer reports available:false when either SKU is unpublished or not DIRECT_SALE` | kart gizlenir |
| `getOffer falls back to https://figurunica.com when PRINT3D_PARTNER_URL is unset` | K15 |
| `getOffer prefers PRINT3D_PARTNER_URL over the built-in default` | K15 |
| `getOffer rejects a non-http(s) PRINT3D_PARTNER_URL` | `javascript:alert(1)` → `null` (varsayılana **düşmez**: açık bir yanlış yapılandırma sessizce düzeltilmez) |
| `allows queued -> in_production -> produced and refuses produced -> queued` | `PRINT3D_INVALID_TRANSITION` |
| `allows cancelling from queued and in_production but not from produced` | terminal |
| `stamps producedAt / cancelledAt on the terminal transitions` | zaman damgaları |
| `listMine is tenant-fenced` | başka kiracının işi görünmez |

**`backend/src/modules/print3d/print3d-catalog-migration.spec.ts`** — YENİ
(T1'in donanım rayındaki karşılığı; `alacarte-catalog-migration.spec.ts` deseni —
yol sabitleri `:23-32`, kompozisyon/`effective` `:124-140`. **Doğrudan
`20260820170000_print3d_service/{migration,down}.sql` yollarını okur; kendi
`FOLLOW_UP_SQL` listesi YOKTUR** — bugün bu migration'ı değiştiren bir takip
migration'ı yok. İleride bir tane eklenirse liste **isimle** aranır
(`FOLLOW_UP_SQL.find((p) => p.includes("…"))`), **asla indeksle**; araya bir giriş
sokulunca iddialar sessizce başka dosyayı göstermesin.)

| Test adı | Doğrulanan |
|---|---|
| `the committed migration prices print3d_base at PRINT3D_BASE_PRICE_CENTS` | SQL yeniden ayrıştırılır |
| `the committed migration prices print3d_item at PRINT3D_ITEM_PRICE_CENTS` | aynı |
| `writes exactly SEED_DEFAULT_COMPLIANCE as complianceDocs on both rows` | ayrıştırılan jsonb === `{ invoiceIssued: true }`; `distributorName` gibi ek anahtar **yok** |
| `the seed SERVICES array agrees with the migration on both SKUs` | tohum ↔ migration sürüklenmesi (fiyat + `complianceDocs` + `serviceMeta`) |
| `uses the snake_case mapped table names everywhere` | `/"HardwareProduct"\|"Product"\|"HardwareOrder"/` **yok**; `"hardware_products"`, `"print3d_jobs"`, `"products"` **var** (T3) |
| `never DELETEs a catalog row without a NOT EXISTS guard over paid rows` | down'da `DELETE FROM "hardware_products"` → `NOT EXISTS` + `hardware_order_items` + `print3d_jobs` (T2) |
| `refuses to drop print3d_jobs while any job row exists` | down `/RAISE EXCEPTION[\s\S]*print3d_jobs/` içerir **ve** `DROP TABLE` satırlarından önce gelir (blocker regresyon çivisi) |
| `guards every print3d_jobs reference in the down with to_regclass` | down'daki her `print3d_jobs` okuması `to_regclass('public.print3d_jobs')` ile korunur → ikinci koşuda `42P01` yok |
| `never issues an unscoped DELETE on hardware_inventory` | down'un `DELETE FROM "hardware_inventory"` parçası `'print3d_base'` (ve `'print3d_item'`) içerir |
| `the ON CONFLICT DO UPDATE does not overwrite status` | `/ON CONFLICT[\s\S]*DO UPDATE[\s\S]*?;/` bloğunda `"status"` geçmez (T10) |
| `the migration directory ships both migration.sql and down.sql` | dosya varlığı (T2) |
| `sorts after 20260820120000_reprice_licence_and_stock and every sibling v3.7.0 migration` | dizin adı `20260820170000_print3d_service`; zincirdeki 120000/130000/150000/160000 damgalarından **sonra** (X1) |

**`backend/src/modules/checkout/dto/cart.dto.spec.ts`** — MEVCUT dosyaya ekleme

| Test adı | Doğrulanan |
|---|---|
| `keeps productIds on a service item (whitelist:true would otherwise delete it)` | `plainToInstance` + `validate` sonrası alan **hayatta** (T8) |
| `rejects a non-UUID entry in productIds` | `IsUUID(each)` |
| `rejects more than 50 productIds` | `ArrayMaxSize(50)` |

**`backend/src/modules/catalog/dto/hardware-sku-regex.spec.ts`** — YENİ

| Test adı | Doğrulanan |
|---|---|
| `accepts the print3d SKUs (underscore)` | `print3d_base`, `print3d_item` |
| `still accepts every SKU the seed ships` | `PRODUCTS` + `SERVICES` sku'ları döngüyle |
| `still rejects uppercase, spaces and leading punctuation` | genişletmenin daralma olmadığı |

### Backend — e2e (gerçek Postgres)

**`backend/test/print3d.e2e-spec.ts`** — YENİ
(`test/licensing.e2e-spec.ts:29-58` kalıbı: `bootHttpApp`, `resetDb`, `seedLiveTenant`, `loginAs`;
`test/jest-e2e.json` `.e2e-spec.ts$` regex'iyle toplar)

| Test adı | Doğrulanan |
|---|---|
| `POST /api/v1/checkout/quote prices a 3-product print3d cart at 165000 kuruş with zero shipping` | uçtan uca fiyat |
| `POST /api/v1/checkout/quote rejects a productId owned by a second tenant with PRINT3D_FOREIGN_PRODUCT` | gerçek iki kiracı, gerçek guard zinciri |
| `a settled intent provisions one HardwareOrder + one Print3dJob + N Print3dJobItem rows` | `confirmAndProvision` gerçek tx |
| `deleting a snapshotted menu product nulls productId but leaves productName and productImageUrl intact` | K10/K11 (gerçek `ON DELETE SET NULL`) |
| `allows two items in one job after both snapshotted products are deleted` | R8: `@@unique([jobId, productId])` NULL'ları ayrı sayar → iki `productId=NULL` kalemi çakışmaz; asıl tekilleştirme `[...new Set(ids)]`'tir |
| `GET /api/v1/print3d/jobs returns only the caller tenant's jobs` | kiracı çiti |
| `POST /api/v1/superadmin/shipments/:orderId works on a service-only order (empty items, no stock movement)` | §3.8 no-op kanıtı |

### Frontend (vitest)

| Dosya | Test adı |
|---|---|
| `frontend/src/features/print3d/print3dSkus.spec.ts` (YENİ) | `computePrint3dTotalCents returns 150000 + 5000*n`; `isPrint3dSku matches both SKUs and nothing else` |
| `frontend/src/features/print3d/partnerBadge.spec.ts` (YENİ) | `safePartnerUrl accepts https, rejects javascript: and protocol-relative` |
| `frontend/src/features/print3d/PartnerBadge.test.tsx` (YENİ) | `renders the partner text as plain span when no url is configured`; `renders an outbound link with rel=noopener when a url is configured`; `never renders empty text` |
| `frontend/src/features/print3d/Print3dProductPicker.test.tsx` (YENİ) | `filters the product list by the search box`; `filters by category`; `caps selection at 50 and disables further cards`; `updates the live price counter as products are toggled` |
| `frontend/src/features/print3d/Print3dWizardPage.test.tsx` (YENİ) | `keeps the pay button disabled until all three legal documents are ticked`; `posts exactly two service lines with productIds and acceptedDocumentIds`; `redirects to paymentLink on success` |
| `frontend/src/features/hardware-store/StorePage.test.tsx` (MEVCUT, ekleme) | `does not render the raw print3d SKUs as separate service cards`; `renders a single 3D print card that links to the wizard`; `hides the Hizmetler section heading when the only service rows are the print3d SKUs`; `sends acceptedDocumentIds with the checkout intent` |
| `frontend/src/features/hardware-store/storeApi.test.tsx` (MEVCUT, **derleme kırılır**) | `useCreateCheckoutIntent POSTs the intent endpoint` çağrısına `acceptedDocumentIds` eklenir ve iddia bu alanı da kapsar (§5/27b) |
| `frontend/src/features/hardware-store/ProductDetailPage.test.tsx` (MEVCUT, ekleme) | `redirects a print3d sku to the wizard instead of rendering a buyable service panel`; `never labels a print3d service as Yerinde kurulum` |
| `frontend/src/features/hardware-store/HardwareOrderDetailPage.test.tsx` (MEVCUT, ekleme) | `renders the 3D print block instead of an empty item table when the order carries a print3dJob` |
| `frontend/src/features/hardware-store/HardwareOrdersListPage.test.tsx` (MEVCUT, ekleme) | `shows the print3d item count for a service-only order` |
| `frontend/src/pages/superadmin/Print3dProductionPage.test.tsx` (YENİ) | `lists queued jobs with tenant, item count and total`; `shows the Figurunica manifest with product name and photo per item`; `advances a job from queued to in_production` |
| `frontend/src/pages/superadmin/MarketplaceAdminPage.test.tsx` (MEVCUT, ekleme) | `offers the service category in the product form select` — `<select>` seçenekleri arasında `service` bulunur (§5/35b; onsuz iki print3d satırı panelden hiç oluşturulamaz) |

### CI kapıları (çalıştırılacak, çıktısı görülecek)

```
cd backend && npx jest src/modules/checkout src/modules/print3d src/modules/catalog src/modules/marketplace
cd backend && npm run test:e2e -- print3d
cd frontend && npx vitest run src/features/print3d src/features/hardware-store src/pages/superadmin
cd backend && npm run lint:ci          # `npm run lint` ağacı DEĞİŞTİRİR (T9)
node scripts/check-i18n-parity.mjs
node scripts/check-i18n-value-drift.mjs --gate-new scripts/i18n-value-drift-baseline.json
node scripts/check-contract-drift.mjs
```
`cmd | tail` kullanma: çıkış kodu `tail`'in olur (T9).

---

## 8. Riskler ve tuzaklar

### Tetiklenen repo tuzakları

| Tuzak | Bu değişiklikte durumu |
|---|---|
| **T1** — `alacarte-catalog-migration.spec.ts` katalog sürüklenmesi | **TETİKLENMEZ ve tripwire ŞU AN YEŞİL.** `cd backend && npx jest src/modules/marketplace/alacarte-catalog-migration.spec.ts` → **9 passed / 0 failed** (2026-08-20'de bu ağaçta koşturuldu). Paralel oturum katlama mekanizmasını **bitirmiş** durumda: `FOLLOW_UP_SQL` (`alacarte-catalog-migration.spec.ts:42-44`), `parseRepricing`, `parseArchived`, ve `effective` (`:137-140`) yerinde; `20260820120000_reprice_licence_and_stock` hem `migration.sql` hem `down.sql` gönderiyor. **Bu değişiklik `ALACARTE_CATALOG`'a hiç dokunmaz ve `FOLLOW_UP_SQL`'e giriş EKLEMEZ** (print3d satırları `marketplace_addons`'ta değil `hardware_products`'ta). Suite bu değişiklikten sonra kırmızıya dönerse sebep bu değişikliğin kendisidir; katlamayı sıfırdan yeniden yazma, mevcut olanı genişlet. Ayrı bir konu: aynı çürüme riski donanım rayında da var ve orada **hiç tripwire yok** → §7'deki `print3d-catalog-migration.spec.ts` o boşluğu kapatır. Uygulanmış migration'ı **düzenleme**; fiyat değişirse yeni bir takip migration'ı yaz. |
| **T2** — tersinir çift + `@doctor:idempotent` başlığı + `NOT EXISTS` guard'ı | **TETİKLENİR.** §6 hem `migration.sql` hem `down.sql` verir, başlık satırı var, `DELETE FROM "hardware_products"` iki `NOT EXISTS` ile korunur, envanter silme sku ile **kapsamlıdır**, `print3d_jobs`'a her bakış `to_regclass` ile korunur (ikinci koşuda `42P01` yok) ve `DROP TABLE`'lar ödenmiş iş varken **hiç çalışmaz** (`RAISE EXCEPTION` fail-fast). 8 adımlı gidiş-dönüş kanıtı §6 sonunda; ayrıntılı gerekçe §8/R14. |
| **T3** — snake_case tablo adı | **TETİKLENİR.** `hardware_products`, `hardware_inventory`, `hardware_orders`, `products`, `print3d_jobs`, `print3d_job_items`. `print3d-catalog-migration.spec.ts` PascalCase'i statik olarak yasaklar. |
| **T4** — feature flag 14-nokta senkronu | **TETİKLENMEZ.** Yeni `FEATURE_KEYS` girdisi yok; hizmet her kiracıya açık, entitlement kapısı yok. `entitlement-keys.spec.ts` etkilenmez. |
| **T5** — katalog değişmezleri (5 yerel, benzersiz `sortOrder`, teslimat invaryantı) | **TETİKLENMEZ** (`ALACARTE_CATALOG` dokunulmuyor); `catalog-validation.spec.ts` bu PR'dan etkilenmez. **Ama invaryantın kendisi değişiyor:** bugün `:256-265` `expect(delivery.length).toBe(3)` diyor, Change 1 (teslimat paketi) bunu **tek** `delivery_platforms` satırına göre yeniden yazıyor. Merge sırası §6: Change 1 → Change 2 → bu PR, yani bu PR ağaca vardığında doğru beklenti "tam olarak bir teslimat ürünü"dür. Bu belgede `delivery.length===3` ifadesi geçen her yer o hâle göre okunmalıdır. |
| **T6** — i18n parity + value-drift | **TETİKLENİR.** İki namespace × 5 yerel. İngilizce `defaultValue`'ya Türkçe yazmak yasak. |
| **T7** — `DeliveryPlatform` elle aynalama | **TETİKLENMEZ.** Yeni enum FE'ye aynalanmıyor; SKU sabitleri saf dize ve `print3dSkus.ts` içinde tek yerde. |
| **T8** — `whitelist:true` beyan edilmeyen alanı siler | **TETİKLENİR ve en tehlikeli tekil kalem.** `CartItemDto.productIds` beyan edilmezse dizi kaybolur, `resolvePrint3dSelection` `PRINT3D_NO_PRODUCTS` fırlatır (yani gürültülü başarısız olur, sessiz para kaybı değil) — ama beyan **şart**. `cart.dto.spec.ts` testi bunu çivileyecek. |
| **T9** — `npm run lint` ağacı değiştirir; `cmd \| tail` çıkış kodunu yutar | **TETİKLENİR.** CI'da `lint:ci`. |
| **T10** — tohum `status`'ü zorlar, upsert üstüne yazar | **TETİKLENİR.** Migration `ON CONFLICT DO UPDATE`'inde `"status"` **yok**; tohumdaki `status:"published"` zorlaması kopyalanmaz. |
| **T11** — katalogda para birimi boyutu yok, çok-ülke aynı dalda | **TETİKLENİR, çözülmez.** İki fiyat da TRY sabiti. `COUNTRY_PROFILES` UZ → `UZS` tanımlıyor (`backend/src/common/country/country-profile.const.ts:105`). Bir UZ kiracısı bu SKU'yu bugün TRY olarak görür. **Bilinen takip maddesi** (§9), bu değişiklikte çözülmez. |

### Değişikliğe özgü para/veri riskleri

| # | Risk | Azaltma |
|---|---|---|
| R1 | **İstemci adedi ile fiyatlama.** `quote.service.ts:79` istemci `qty`'sini kullanıyor; print3d_item için buna güvenmek 50 figürü ₺50'ye satar. | Adet `productIds.length`'ten türetilir (§4.5b) ve `quote-print3d.spec.ts`'in ilk testi bunu çivileyecek. |
| R2 | **Yerleşimde yeniden fiyatlama fırlatırsa kart çekilir, hiçbir şey sağlanmaz.** `checkout.service.ts:222` provizyon verisini yeniden quote'tan alır; ürün ödeme ile webhook arası silinmişse naif bir "ürün bulunamadı" hatası tam bu felaketi yaratır. | Silinmiş ürün **fırlatmaz** (fiyat `ids.length`'ten türediği için tutar değişmez); yalnızca **başka kiracıya ait** id fırlatır ve bu asla meşru değildir (§4.5a). |
| R3 | **Eşleşmemiş satır.** Taban satırı bir katalog uyarısıyla düşerse (`:240`, `:251`, `:284`) alıcı ürün başına ₺50 öder, hizmeti almaz; tersi ürünsüz ₺1.500. | Eşleşme kontrolü döngüden **sonra**, üretilmiş satırlar üzerinde çalışır (§4.5c) — hem eksik gönderimi hem düşürülmüş satırı yakalar. |
| R4 | **PayTR sepeti toplamı.** Sepet her satırı `qty:1`'e çöker ve `amountCents`'e birebir toplanmak zorundadır (`checkout-intent.service.ts:250-267`). | İki satır, tam sayı çarpımları, `overhead = 0` (kargo yok) → yuvarlama artığı imkânsız. |
| R5 | **`hardware_order_items` boş.** Yalnız-hizmet siparişinde kalem yok (§3.4, `checkout.service.ts:380`) → `HardwareOrderDetailPage.tsx:87`'deki `order.items.map` **boş tablo** basar (sıfır-olmayan toplamla birlikte), `HardwareOrdersListPage.tsx:142`'deki `itemCount` sütunu boş kalır (üstelik backend bu alanı zaten hiç döndürmüyor — ayrı, önceden var olan boşluk), sipariş e-postası boş kalem listesi yollar. | **Üç somut kontrol maddesi:** backend okumaları `print3dJob`'ı include eder (§5/20b, `hardware-orders.service.ts:14-52`), iki kiracı ekranı print3d dalını render eder (§5/33b), e-posta §4.8'de düzeltilir. Önceki taslakta "kiracı ekranı `Print3dJob`'ı okur" yazıyordu ama **hiçbir kontrol maddesi bunu uygulamıyordu.** |
| R6 | **Mağaza ızgarası iki ham SKU kartı basar** (`StorePage.tsx:342-348`). | Filtre + tek `Print3dStoreCard` + derin bağlantı yönlendirmesi (§4.9). |
| R7 | **ÖNCEDEN VAR OLAN ÜRETİM HATASI — bu değişiklik onu ilk yüzeye çıkaran iştir.** `acceptedDocumentIds` donanım mağazasından hiç gönderilmiyor (`storeApi.ts:285-304`, `StorePage.startCheckout` `:195-224`; `grep -rn acceptedDocumentIds frontend/src/features/hardware-store` → **0 sonuç**), oysa DTO zorunlu kılıyor (`create-intent.dto.ts:139-144`, `@IsOptional` yok) ve controller gövdeyi o DTO'ya bağlıyor (`checkout.controller.ts:82`) → `ValidationPipe` **bugün 400 veriyor**; donanım/hizmet mağazasından PayTR ödemesi hiç başlamıyor. Sihirbaz aynı kancayı kullanacağı için düzeltilmeden 3D baskı **satılamaz**. | **Kapsam içi ön koşul (§1), takip maddesi DEĞİL.** Kanca argümanı **zorunlu** yapılır (§5/27) → derleyici her çağıranı yakalar; ilk yakalanan `storeApi.test.tsx:216-227` (§5/27b, güncellenmezse CI `npx tsc --noEmit` kırmızı); `CheckoutConsent` her iki yüzeye de eklenir (§4.9, §5/28). Bu bir regresyon değil, **halihazırda kırık bir yolun** onarımıdır — kanıt ve dosya listesi §1'de. |
| R8 | **Aynı ürün iki kez seçilirse** iki figür mü, bir figür mü? | Tekilleştirmeyi **`[...new Set(ids)]`** yapar (`resolvePrint3dSelection`, §4.5a) — tek gerçek koruma budur. `@@unique([jobId, productId])` yalnızca **ürün satırı hayattayken** ikincil bir kemerdir: `productId` nullable + `onDelete: SetNull` (K11) ve Postgres UNIQUE indeksinde NULL'lar **birbirinden ayrı** sayılır, dolayısıyla anlık görüntüsü alınmış iki ürün menüden silindiğinde ikisi de `productId = NULL`'a düşer ve indeks hiçbir şey zorlamaz. Kemer zamanla kendi kendini çözer; belde tutan `Set`'tir. Kullanıcı aynı üründen iki figür isterse yeni bir sipariş verir. |
| R9 | **Kargo ₺0'ın "düzeltilmesi".** Biri `quote.service.ts:333`'ü `type !== 'addon'` yapabilir; bu, ilan edilen fiyata ₺50 bindirir ve toleransı patlatır. | §4.6 açık kararı + `charges ZERO shipping...` testi. |
| R10 | **Kişisel veri üçüncü tarafa gidiyor.** Manifesto kiracının menü fotoğraflarını ve teslimat adresini Figurunica'ya taşır. | Manifesto yalnızca `@SuperAdminRoute()` arkasında; ürün fotoğrafı zaten kiracının halka açık QR menüsünde; sözleşme/gizlilik tarafı §9'da takip maddesi. |
| R11 | **Dalda commit edilmemiş paralel değişiklik.** `backend/prisma/migrations/20260820120000_reprice_licence_and_stock/` working tree'de **var ama git'te izlenmiyor** (`git ls-files` → 0 sonuç). Doğru tersinir çifti **gönderiyor**: `migration.sql` (4998 bayt) + `down.sql` (3277 bayt), ikisi de bugün yazılmış — önceki taslaktaki "`down.sql`'i yok, standing kurala aykırı" iddiası **YANLIŞTI** ve kaldırıldı (muhtemelen "izlenmiyor" olgusu yanlış okunmuştu). Ayrıca `alacarte-catalog-migration.spec.ts`'in `FOLLOW_UP_SQL`'i (`:42-44`) bu dizini zaten sayıyor ve suite yeşil. | O migration'a **dokunulmaz**; bizimki yalnızca ondan sonra sıralanır. Zaman damgası **`20260820170000`** (v3.7.0 zincirinin tamamı §6'da). Rapor edilecek bir ihlal yok. |
| R12 | **Superadmin katalog API'si alt çizgili SKU'yu reddeder** (`create-hardware-product.dto.ts:69`). | K18: regex genişletilir + `hardware-sku-regex.spec.ts`. |
| R13 | **PARA: yinelenen print3d sepet satırı.** `CartDto.items` yalnızca `ArrayMinSize(1)`/`ArrayMaxSize(50)` taşır (`cart.dto.ts:117-124`) — **tekillik kısıtı yok**. `find`/`some` ile yazılmış bir kontrol, iki `print3d_item` satırı gönderen istemcide **her ikisini de** ilk satırın `productIds.length`'iyle fiyatlar (§4.5b tek `print3d` nesnesini okur), provizyon ise §4.7'deki `find` yüzünden **tek** iş basar → alıcı 2N figür öder, N alır. Çift `print3d_base` ise 2 × ₺1.500 tahsil edip yine tek iş üretir. | `find`/`some` yerine **tam sayım**: `resolvePrint3dSelection` `filter` + `length > 1` → `PRINT3D_DUPLICATE_LINE` (§4.5a); eşleşme kapısı `baseCount !== itemCount \|\| baseCount > 1` (§4.5c). İki yeni test: `rejects a cart carrying two print3d_item lines`, `rejects a cart carrying two print3d_base lines`. Yeni hata kodu 5 yerele eklenir (§5/38). |
| R14 | **Geri alım ödenmiş üretim kaydını yok edebilir.** İlk taslakta `down.sql` katalog satırını `NOT EXISTS(print3d_jobs)` ile özenle koruyor, hemen ardından koşulsuz `DROP TABLE IF EXISTS "print3d_jobs"` ile korumaya çalıştığı verinin **tamamını** (ve guard'ın kendi kanıtını) siliyordu. Üstelik ikinci koşuda `DELETE … NOT EXISTS (SELECT 1 FROM "print3d_jobs")` **`42P01 undefined_table`** veriyordu → down ne tersinir ne idempotanttı. | §6 `down.sql` yeniden yazıldı: (0) `RAISE EXCEPTION` fail-fast — ödenmiş iş varsa tüm işlem geri sarılır, hiçbir tablo/satır kaybolmaz; (1) envanter silme **sku ile kapsamlı**; (2) her `print3d_jobs` referansı `to_regclass` ile korunuyor; (3) `DROP` yalnızca 0. adım temiz geçtiyse. Gidiş-dönüş kanıt planı 8 adıma çıktı, guard adımı öne alındı. |

---

## 9. Kapsam dışı / sonraki adımlar

1. **Çok para birimli fiyatlandırma (T11).** `hardware_products.currency` kolonu var ama
   katalogda para birimi **boyutu** yok; `quote.service.ts:328` TRY dışını sıfır-vergili
   sayar. Bir UZ kiracısı print3d'yi TRY olarak görür. Çok-ülke P3+ ile çözülecek.
2. **Genel "hizmet satırları sipariş e-postasında/detayında görünmüyor" boşluğu.**
   v2.8.87'den beri her `category:'service'` siparişi boş kalem tablosuyla gidiyor
   (`checkout-notifications.service.ts:125-129`, `hardware-orders.service.ts:19-40`).
   Burada yalnızca print3d kapatılıyor; genel düzeltme ayrı iş.
3. **Meshy/AI 3D hattı.** `product-3d.service.ts` bu akışta çalıştırılmaz. Kiracının
   zaten sahip olduğu `model3dUrl` yalnızca kopyalanır (K17). "Figürü menüdeki
   modelden üret" ayrı bir üründür.
4. **Otomatik ortak entegrasyonu.** Figurunica'ya iş aktarımı v1'de manuel
   (panel + CSV). Webhook/SFTP entegrasyonu ayrı iş.
5. **Yeniden baskı / iade akışı.** `Print3dJobItem.status = 'rejected'` operatöre
   sinyaldir; para iadesi rayı yoktur (platformda hiç yok).
6. **Figurunica ile veri işleme sözleşmesi (KVKK).** Manifesto adres + fotoğraf
   taşıyor; hukuki metin ürün tarafının işi.
7. **Superadmin kargo ekranının genelleştirilmesi.** Bugün SPA'da hiç yok; print3d
   paneli mevcut backend endpoint'lerini kullanan ilk yüzey olacak. Donanım siparişleri
   için aynı ekran ayrı iş.
8. **Superadmin kategori `<select>`'inin sözlükten türetilmesi.**
   `MarketplaceAdminPage.tsx:602-612` elle yazılmış ve zaten drift'te: sözlükteki
   (`category-vocabulary.ts:16-31`) `cash_drawer` / `scale` / `accessory` / `cable`
   eksik, sözlükte olmayan `other` fazladan. Bu PR yalnız `service`'i ekliyor (§5/35b),
   kartlı-vardiya PR'ı yalnız `card_reader`'ı; kalıcı çözüm `<select>`'i
   `GET /v1/catalog/categories`'ten beslemektir — ayrı iş. (Kartlı-vardiya spec'i
   §9/9'da aynı maddeyi taşıyor.)
