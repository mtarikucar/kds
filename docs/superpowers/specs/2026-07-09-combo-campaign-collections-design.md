# Kombo Ürün + Kampanya + Koleksiyon (Menü) — Tasarım Spec'i

**Tarih:** 2026-07-09 · **Durum:** Onaylandı → uygulama
**Onaylı kararlar:** Kombo = sabit içerik + seçimli slotlar · Kampanya = indirimli fiyat + tarih aralığı + rozet (ürün & kombo) · Sınıflandırma = kategoriden bağımsız koleksiyon/etiket sistemi.

Araştırma kanıtı: `wf_0dc3e2e8-415` journal (menü veri modeli, sipariş/vergi/stok, yüzeyler, kampanya izleri).

---

## 1. Amaç
Menüye üç yetenek: **(A) Kombo ürün** (ör. "2 Dürüm + 2 Ayran" sabit; "Maxi Menü" = burger + patates + içecek-seç), **(B) Kampanyalı ürün/kombo** (indirimli fiyat + opsiyonel tarih penceresi + rozet), **(C) Koleksiyon** (kategoriden bağımsız çoklu sınıflandırma: "Kampanyalar", "Menüler", "Yeni"…). Para/vergi/stok/mutfak/rapor **yapısal olarak doğru** olacak; abartma/uydurma yok.

## 2. Mimari karar — Kombo = bileşenlere "patlatma" (money-on-children)
Kombo satılınca **1 ana OrderItem (0₺ gruplama satırı) + N çocuk OrderItem** yazılır. Para çocuklarda; ana satır sadece gruplar. Neden: KDV satır-başına-doğru, reçete/ürün stok düşümü çocuk `productId`'lerden otomatik doğru, KDS bileşenleri görür, e-Fatura/Z-raporu satır bazlı tutar. (Alternatif "tek satır" reddedildi — KDV/stok kör kalıyordu; "modifier" reddedildi — modifier Product değil.)

## 3. Veri modeli (Prisma — reversible up/down migration)
```
enum ProductType { STANDARD COMBO }              // Product.productType @default(STANDARD)

Product (eklenen alanlar):
  productType     ProductType @default(STANDARD)
  campaignPrice   Decimal(10,2)?                 // KDV-dahil kampanya fiyatı (null=kampanya yok)
  campaignLabel   String?      @db.VarChar(40)   // "%20 İndirim" / "Kampanya"
  campaignStartAt DateTime?                       // null = hemen
  campaignEndAt   DateTime?                       // null = süresiz
  comboGroups     ComboGroup[]
  collections     ProductCollection[]

ComboGroup:                                       // komboya ait bir "slot"
  id, comboProductId(Product COMBO, Cascade), name(String), displayName?,
  minSelect Int @default(1), maxSelect Int @default(1), displayOrder Int @default(0),
  tenantId, items ComboGroupItem[]
  // Sabit içerik = min=max=1 tek item; "içecek seç" = min=max=1 çok item; "2 sos seç" = min=max=2

ComboGroupItem:                                   // slottaki seçilebilir bileşen
  id, groupId(Cascade), componentProductId(Product, Restrict),
  quantity Int @default(1), priceDelta Decimal(10,2) @default(0), isDefault Boolean @default(false),
  displayOrder Int @default(0), tenantId
  // priceDelta: "büyük patates +10₺". quantity: "2 Dürüm" => quantity 2 tek item.

MenuCollection:                                   // sınıflandırma (kategoriden bağımsız)
  id, name, slug, displayOrder Int @default(0), isActive Boolean @default(true), tenantId
  @@unique([tenantId, slug])

ProductCollection:                                // Product <-> Collection N-N
  id, productId(Cascade), collectionId(Cascade), displayOrder Int @default(0), tenantId
  @@unique([productId, collectionId])

OrderItem (eklenen alanlar):
  parentOrderItemId String?  // self-FK; combo children -> parent; SetNull on parent delete guarded
  parent   OrderItem?  @relation("ComboChildren", fields:[parentOrderItemId], references:[id], onDelete: Cascade)
  children OrderItem[] @relation("ComboChildren")
  listUnitPrice Decimal(10,2)?  // kampanya/kombo öncesi liste birim fiyatı (analitik + "kazandınız")
```
**Reversibility (global kural):** `migration.sql` (up) + companion **`down.sql`** aynı klasörde; down tam olarak up'ı geri alır (yeni tablolar DROP, yeni kolonlar DROP, enum DROP), operatör verisine dokunmaz. Round-trip (up→down→up) throwaway Postgres'te doğrulanacak. Proje kuralı: `prisma db push` deploy'da; migration.sql elle + generate.

## 4. Fiyat & KDV mekaniği (KRİTİK)
- **Tek fiyat kaynağı helper'ı** `resolveEffectivePrice(product, now)` → kampanya penceresi aktifse `campaignPrice`, değilse `price`. **Hem** POS/QR fiyatlama raylarında **hem** `getPublicMenu`'de aynı helper (gösterilen = çekilen; SubscriptionPlan money-bug dersi).
- **Kombo apportionment**: toplam kombo fiyatı = `comboEffectivePrice + Σ(seçili slot item priceDelta × qty)`. Bu KDV-dahil toplam, çocuklara **ağırlıklı largest-remainder** ile kuruş-kesin dağıtılır (ağırlık = child listUnitPrice × qty). `Σ(child.subtotal) === comboLineTotal` invariantı. Kalıp `fiscal-line-builder.apportionDiscount` / `sales-invoice` ile aynı teknik.
- Her **çocuk** OrderItem: `taxRate = componentProduct.taxRate`, `taxAmount = extractTax(child.subtotal, child.taxRate)` (satır-doğru KDV). `listUnitPrice` = componentin efektif liste fiyatı.
- **Ana** OrderItem (parent): `unitPrice=0, subtotal=0, taxAmount=0, taxRate=0` → **fiskal/e-Fatura/ödeme hesaplarında ATLANIR** (leaf-only). Ana satır sadece isim + kombo `listUnitPrice` taşır.
- Sipariş-seviyesi `discount` mevcut haliyle üstte çalışır (dokunulmaz); apportionDiscount leaf satırlara dağıtır.
- **QR rayı açığı kapatılır**: `customer-orders.service` OrderItem'a taxRate/taxAmount yazmıyordu → kombo işiyle birlikte yazılır (mevcut bug fix).

## 5. Sipariş akışı
- DTO (`create-order.dto` + `create-customer-order.dto` + partner `create-display-order.dto` verbatim miras): item'e opsiyonel `comboSelections?: [{ groupId, componentProductId, quantity }]`.
- Sunucu (`OrdersService.createInner` + `CustomerOrdersService` + validator — **3 senkron nokta**): item COMBO ise `comboSelections` her grubun min/max'ına uyacak şekilde doğrulanır (yeni `validateComboSelections`, mevcut modifier validator kardeşi); seçili bileşenlerin `isAvailable` + (varsa) stok kontrolü; sonra patlatma → parent + children yazımı; fiyat `OrderPricingCalculator` içinde kombo-farkında.
- **Güncelleme rayı** (`update()` item-rewrite): kombo satırları yeniden fiyatlarken kombo fiyatını korur (katalogdan bileşen tam fiyatına düşürmez). removeItem: kombo çocuğu tek başına koparılamaz — parent silinirse Cascade çocukları da siler; çocuk silme reddedilir (bütünlük).
- **Kalem-bazlı ödeme**: kombo bütün olarak ödenir; çocuk tek başına `payByItems`'a düşmez (parent/children grup kuralı).

## 6. Stok
- Çocuklar gerçek OrderItem → reçete düşümü (`stock-deduction`) + ürün-adet düşümü (`deductStockForOrder`) otomatik doğru.
- **BUG FIX**: ürün-adet düşüm idempotensi `(order, product)` → `(order, orderItem)` anahtarına taşınır (aynı üründen 2 satır — kombo kolası + tekil kola — ikinci satırın düşümünü kaybetmesin). Ters kayıt da aynı.
- Kombo müsaitliği: varsayılan bileşenlerinden türetilir; sipariş anında da bileşen `isAvailable`/stok doğrulaması.

## 7. KDS + fişler
- KDS ana satır + girintili bileşen satırları (mevcut modifier görsel dili). `receipt-snapshot.builder` + ESC/POS: kombo başlığı + girintili bileşenler. Durum yönetimi v1'de ana satırdan tek bump (çocuklar ana ile ilerler).

## 8. Raporlar / Z-raporu
- **Çift sayım önlenir**: "en çok satan ürün (ciro)" = leaf satırlar (standalone + kombo çocukları) → gerçek malzeme cirosu. "En çok satan kombo" = ana satır adedi. Z-raporu KDV kırılımı leaf `taxRate/taxAmount`'tan (zaten doğru). `groupBy`'a `parentOrderItemId` farkındalığı eklenir.

## 9. Diğer yüzeyler
- **Teslimat senkronu** (`delivery-menu-sync`): kombolar push'a **DAHİL EDİLMEZ** (sözleşme kombo/indirim taşımıyor — dürüst kısıt; operatör UI'da not). Kampanyalı normal üründe push anındaki **efektif fiyat** gönderilir. Inbound platform "menü"leri mevcut tek-satır yolunu bozmaz.
- **Partner display**: `getPublicMenu` + miras DTO sayesinde otomatik; developer portal dokümantasyonu güncellenir.
- **Public menü payload'ı** (`menu-query.service`): ürünlere `productType, effectivePrice, listPrice, campaignLabel, campaignActive, comboGroups[]`; yeni top-level `collections[]` (ürün id referanslı). Public menü ürün sıralaması `displayOrder`'ı da onurlandıracak (mevcut `name asc`-only açığı düzeltilir).

## 10. Sınırlar & i18n
- Kombolar `maxProducts` limitine normal Product gibi sayılır (kabul edilen davranış; 4 sayım noktası olduğu gibi kalır).
- Tüm yeni müşteri-yüzü metinleri 5 dile (tr/en/ru/uz/ar) mirror — CI locale-parity gate.

## 11. Dürüstlük / guardrail
- Kampanya "gösterilen fiyat = çekilen fiyat" tek helper'dan (para bug'ı önlenir).
- Kombo KDV bileşen bazlı — yanlış beyan yok.
- Teslimat platformlarına kombo gönderiliyormuş gibi gösterilmez.
- Negatif modifier/indirim yolu açılmaz (kampanya fiyatı ile çözülür).

## 12. Fazlar (her biri branch → PR → merge → vX.Y.Z tag → CI deploy)
- **Faz 1 — Backend çekirdeği**: şema + reversible migration + `resolveEffectivePrice` + kombo patlatma/doğrulama/apportion (POS+QR+partner) + fiskal/e-Fatura/Z-rapor/ödeme/stok/KDS uyarlama + idempotens fix + public menü payload + QR taxRate açığı fix + koleksiyon CRUD servis/endpoint. Kapsamlı vitest (apportion invariantı, KDV, stok, çift-sayım, kampanya penceresi).
- **Faz 2 — Yönetim UI**: ürün editöründe kombo kurucu (grup/slot/bileşen, priceDelta, varsayılan), kampanya alanları (fiyat/etiket/tarih + canlı önizleme), koleksiyon yöneticisi + ürün-koleksiyon atama.
- **Faz 3 — Satış yüzeyleri**: QR + POS kombo seçim modalları, kampanya rozeti + üstü çizili fiyat, koleksiyon şeritleri/çipleri, KDS gruplu görünüm, fiş baskıları, rapor ekranları.

## 13. Test / doğrulama
Her fazda: `tsc`, eslint, backend jest (kombo apportion/KDV/stok/idempotens spec'leri), frontend vitest, `vite build`; Faz 1 sonrası izole Postgres'te migration round-trip + kombo sipariş E2E (patlatma → KDV → stok → fiş). Prod deploy sonrası akıllıca smoke.
