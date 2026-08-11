# À-la-carte yıllık lisans — tasarım

**Tarih:** 2026-08-11
**Durum:** Onaylandı, uygulanıyor
**Başlangıç sürümü:** v3.2.148

---

## 1. Neden

Sistem bugün 4 kademeli pakete satılıyor (TRIAL / BASIC / PRO / BUSINESS; FREE emekli).
Her paket 13 boolean feature + 9 sayısal limitin sabit bir demetini açıyor:

- Müşteri istediği tek modülü alamıyor — ihtiyacı olmayan 10 şey için üst pakete zıplıyor.
- Sunucuya hiç yük bindirmeyen temel işlevler (POS, KDS, menü, masa, QR, sipariş) de
  paketin arkasında kilitli.
- Fiyat, gerçek maliyetle (AI üretimi, entegrasyon trafiği, ağır rapor sorguları) hizalı değil.

**Hedef:** Paket kavramını kaldırmak. Çekirdeği sınırsız ve ücretsiz yapmak; ağır ve
birim maliyeti olan her şeyi tek tek, yıllık, kalem kalem satmak.

Canlı ödeyen abone **yok** → temiz kesim, grandfathering mantığı gerekmez.

---

## 2. Ticari model

| Konu | Karar |
|---|---|
| Paketler | TRIAL/BASIC/PRO/BUSINESS/FREE tamamen kalkar |
| Çekirdek | Ücretsiz, **sınırsız**, lisans bile gerekmez |
| Sayısal limitler | `maxUsers`, `maxTables`, `maxProducts`, `maxCategories`, `maxMonthlyOrders` **silinir**; sadece `maxBranches` kalır |
| Lisans | **₺2.990/yıl ücretli**; ücretli feature almanın **ve kullanmanın** ön koşulu |
| Yıl dönümü | Lisansın ilk satın alma tarihi = tenant'ın değişmez *anniversary* çapası |
| Feature satın alma | Yıllık, gün bazlı **orantılı**, lisans yıl dönümüne hizalı, kalem kalem |
| Yenileme | **Manuel**; yıl dönümünde tek kalem-kalem sepet + fatura; 30/7/1 gün önce hatırlatma |
| Ödenmezse | 7 gün ek süre → erişim kararır, **hiçbir veri silinmez** |
| Tüketim | AI görsel/video/3D + SMS = **kontör** (tek seferlik, tükenene kadar) |
| Kapasite | Sadece **ek şube** ücretli (1. şube bedava) |

### 2.1 Ücretsiz çekirdek (lisans gerekmez, sınırsız)

POS · KDS · Menü yönetimi · Masa & kat planı · QR menü · Sipariş · Kasa/Nakit ·
Temel dashboard raporları · Ekip & rol yönetimi · Müşteriler · Cihaz & şube hub'ı ·
Özel marka & subdomain · Ödeme terminali ayarları · 1. şube

### 2.2 Katalog (seed fiyatları; hepsi superadmin'den düzenlenebilir, TRY, KDV dahil)

**Lisans** — `license_annual` ₺2.990/yıl

**Modüller** (yıllık, ayrı ayrı)

| Kod | Feature | ₺/yıl |
|---|---|---|
| `module_reports` | `advancedReports` | 1.290 |
| `module_inventory` | `inventoryTracking` | 1.490 |
| `module_reservations` | `reservationSystem` | 990 |
| `module_personnel` | `personnelManagement` | 990 |
| `module_ai_studio` | `aiContentGeneration` | 1.990 |
| `module_api_access` | `apiAccess` | 2.490 |
| `module_external_display` | `externalDisplay` | 1.990 |
| `module_priority_support` | `prioritySupport` | 1.990 |

**Entegrasyonlar** (yıllık, her biri ayrı)

| Kod | Grant | ₺/yıl |
|---|---|---|
| `delivery_yemeksepeti` | `integration.delivery:["yemeksepeti"]` + `feature.deliveryIntegration` | 2.490 |
| `delivery_getir` | `integration.delivery:["getir"]` + `feature.deliveryIntegration` | 2.490 |
| `delivery_trendyol_yemek` | `integration.delivery:["trendyol_yemek"]` + `feature.deliveryIntegration` | 2.490 |
| `fiscal_efatura` | `integration.fiscal:["efatura"]` | 1.990 |
| `fiscal_hugin` | `integration.fiscal:["hugin"]` | 2.990 |
| `caller_id_integration` | `integration.caller:["generic"]` | 1.490 |
| `sms_integration` | `integration.sms:["*"]` | 990 |

**Kapasite** — `extra_branch` `limit.maxBranches:+1` + `feature.multiLocation` ₺3.990/yıl/adet

**Kontör** (tek seferlik, tükenene kadar)

| Kod | kind / units | ₺ |
|---|---|---|
| `credit_ai_photo_100` | `AI_PHOTO` / 100 | 690 |
| `credit_ai_video_20` | `AI_VIDEO` / 20 | 890 |
| `credit_ai_3d_10` | `AI_3D` / 10 | 790 |
| `credit_sms_500` | `SMS` / 500 | 490 |

Emekliye ayrılan (arşivlenir, silinmez — `TenantAddOn.addOnId` `onDelete: Restrict`):
`kds_extra_screen`, `kds_extra_station`, `extra_tablet` — bugün grant ediyorlar ama
`limit.kdsScreens` / `limit.kdsStations` / `limit.tablets` anahtarlarını **hiçbir kod okumuyor**.

---

## 3. Mimari: motor zaten à-la-carte

`feature_entitlements` + `entitlement-engine.ts` zaten kaynak-anahtarlı: her grant
`plan:X` / `addon:CODE:ID` / `override:admin` kaynağından gelir ve
`feature.*`=OR, `limit.*`=SUM (`-1`=sınırsız baskın), `integration.*`=UNION ile katlanır.

Bunun iki büyük sonucu var:

1. **85 `@RequiresFeature`/`@RequiresIntegration` çağrı noktası metinsel olarak hiç
   değişmiyor.** Dekoratörler mevcut ama kullanılmayan `@RequireEntitlement`'a
   *alias*'lanıyor; `EntitlementGuard` global olarak `PlanFeatureGuard`'ın yerine geçiyor.
   40 controller'ı elle düzenlemek yerine 2 dosya değişiyor.
2. **`FeatureGate` bileşeninin API'si aynı kalıyor** — sadece arkasındaki upsell
   mesajı "PRO'ya yükselt" yerine katalogdan gelen "bu modül ₺X/yıl" oluyor.

Lisans ön koşulu da bedava geliyor: `tenant-marketplace.service.ts`'in `deps`
çözümleyicisi zaten çıplak add-on kodlarını aktif `TenantAddOn` satırlarına karşı
doğruluyor.

---

## 4. Veri modeli

### 4.1 Lisans = katalog satırı + değişmez çapa

Lisans **yeni bir yaşam döngüsü makinesi değil**: `kind:'license'` olan bir
`MarketplaceAddOn` satırı, sahiplik `TenantAddOn` üzerinden. Böylece grant
projeksiyonu, `addon:` geri alınabilir kaynağı, 7 günlük grace, sweeper,
paymentRef idempotency, yerinde-yenileme ve Serializable dup-guard bedava gelir.

Çapa **`TenantAddOn` satırında tutulamaz**: `purchase()` yenileme dalında
`activatedAt: now` yazıyor — çapa oradan türetilseydi 3 gün geç ödenen bir yenileme
tenant'ın yıl dönümünü kalıcı olarak kaydırırdı. Çapa bir *write-once* olgudur:

```prisma
model Tenant {
  /// Değişmez yıl dönümü çapası. İlk lisans provision'ında BİR KEZ yazılır
  /// (soğuk yeniden başlatma dışında). Satın alma anının TENANT-YEREL takvim
  /// gününün UTC gece yarısı olarak saklanır — böylece yıl dönümü aritmetiği
  /// saf takvim matematiği olur.
  licenseAnchorAt DateTime?
}
```

Canlı lisans durumu **asla denormalize edilmez**; lisans satırı
`{"feature.license": true}` grant ettiği için `hasLicense` = 30sn önbellekli,
Redis-invalidate edilen bir motor okuması ve grace'i `validUntil` üzerinden zaten yönetiyor.

### 4.2 Katalog genişletmesi (`MarketplaceAddOn`)

```
kind:    software|integration|capacity|support  →  license|module|integration|capacity|credit|service
billing: recurring|oneTime                      →  annual|oneTime
+ requiresLicense Boolean @default(true)
+ creditKind      String?   // AI_PHOTO | AI_VIDEO | AI_3D | SMS
+ creditUnits     Int?
+ maxQuantity     Int?
+ sortOrder       Int       @default(0)
+ i18n            Json?     // { tr:{name,description}, en:…, ar, ru, uz }
+ commissionRate  Decimal   @default(0.10) @db.Decimal(5,4)
```

`kind` ve `billing` zaten serbest `String` (projenin "String + yorum" enum geleneği),
dolayısıyla değer geçişi bir `UPDATE`, tip değişimi değil.

Katalog metni **DB'de** (`i18n`) tutulur, locale dosyalarında değil — "her şey
superadmin'den düzenlenebilir" bunu gerektiriyor ve yeni bir ürün çıkarmak artık
5 dilli bir frontend PR'ı istemiyor.

### 4.3 Sahiplik genişletmesi (`TenantAddOn`)

```
+ chargedCents    Int?      // fiilen tahsil edilen (orantılı); comp'ta 0
+ currency        String    @default("TRY")
+ pricingMeta     Json?     // { annualPriceCents, proratedDays, cycleDays, anchorAt,
                            //   mode, quantityHistory: [...] }
+ pendingQuantity Int?      // düşüşler yalnız yenilemede uygulanır
+ origin          String    @default("purchase")   // purchase | comp | migration
+ compReason      String?
+ compActorId     String?
```

### 4.4 Kontör: `CreditLot` (satın alma) + `CreditLedger` (tüketim)

`ai_generation_usage` **aylık pencereli** ve lot/bakiye kavramı yok; ama iade
makinesi (`voided`, ürün cascade'lerinden sağ çıkan soft `jobId`, orphan sweep)
değerli. Karar: **ledger'ı genelleştir, lot tablosu ekle, aylık pencereyi kaldır.**

```prisma
model CreditLot {
  id, tenantId, kind, units,
  source     String    // purchase:<code> | comp:admin:<id> | migration:legacy
  addOnCode  String?
  paymentRef String?
  priceCents Int?      currency String @default("TRY")
  expiresAt  DateTime? // iş kuralı: tükenene kadar geçerli (null)
  voided     Boolean   @default(false)
  @@unique([tenantId, paymentRef, addOnCode])   // checkout idempotency
  @@map("credit_lots")
}

model CreditLedger {
  id, tenantId, kind, units Int @default(1),
  lotId   String?           // FIFO atıf
  refType String?           // media_job | sms_message
  refId   String?           // soft ref — FK YOK (cascade'lerden sağ çıkmalı)
  voided  Boolean @default(false)
  @@map("credit_ledger")
}
```

`bakiye = Σ lot.units (!voided) − Σ ledger.units (!voided)`

**Kontör bilerek entitlement DEĞİL.** Motor önbelleği 30 saniye; bir patlama anında
bayat bakiye gerçek bir para hatası (bir Meshy 3D modeli ≈ ₺12 tedarikçi maliyeti).
Bakiye, `MenuAiQuotaService.claim()`'in bugün yaptığı gibi advisory-lock'lu işlem
**içinde canlı** okunur. UI'a ayrı `GET /v1/credits/me` ile açılır.

### 4.5 `RenewalCycle` — "yıl dönümünde tek kalem-kalem sepet"

```prisma
model RenewalCycle {
  id, tenantId,
  anniversaryAt DateTime,
  status        String   @default("open")   // open | paid | lapsed | cancelled
  cartJson      Json     // T-30'da dondurulmuş Cart
  quoteJson     Json     // dondurulmuş CartQuote (settlement'ta yeniden fiyatlanır)
  totalCents    Int      currency String @default("TRY")
  graceEndsAt   DateTime // anniversaryAt + 7g
  remindersSent Int[]    @default([])       // [30,7,1] — cron idempotency
  invoiceId, paymentRef, generatedAt, paidAt, lapsedAt
  @@unique([tenantId, anniversaryAt])
  @@map("renewal_cycles")
}
```

Bu satır olmadan "30/7/1 hatırlatma"nın kararlı bir hedefi, "yıl dönümünde TEK
kalem-kalem fatura"nın yaşayacağı yer ve grace/expiry cron'unun neyin borçlu
olduğuna dair kaydı olmaz.

### 4.6 Faturalar: **`Invoice`'a dokunma**, yeni tablolar

VUK fatura saklama zorunluluğu var (5–10 yıl) ve `Invoice.subscriptionId` NOT NULL +
cascade FK. Nullable'a gevşetmek **yazılamaz bir `down.sql`** üretir (à-la-carte
satırları varken `NOT NULL`'u geri koyamazsınız; proje kuralı da down'ın runtime
verisini silmesini yasaklıyor).

Karar: `Invoice` / `SubscriptionPayment` **salt-okunur eski arşiv** olarak dondurulur;
yeni `TenantInvoice` + `TenantInvoiceLine` eklenir (kalem başına `prorationMeta`,
dönem, gross birim fiyat).

Numaralandırma **paylaşılır**: `generateInvoiceNumber` `billing.service.ts`'ten
`common/helpers/invoice-number.helper.ts`'e çıkarılır. Aynı `INV-{YYYYMM}-{seq}-{hex}`
biçimi için iki bağımsız sayaç er ya da geç `@unique` üzerinde çakışır — ve bu
çakışma **kart çekildikten sonra** settlement'ta P2002 olarak patlar.

### 4.7 Eski tabloların akıbeti

| Tablo | Akıbet |
|---|---|
| `pending_plan_changes` | **Drop** (P8) — tamamen geçici, `expiresAt` ile TTL'li |
| `subscriptions` | **Kalır, inert** — eski `invoices` arşivinin FK bütünlüğü için |
| `subscription_plans` | **Kalır, inert** (`isActive=false, isPublic=false`) — `subscriptions.planId` FK'sı `onDelete: Restrict` |
| `tenants.currentPlanId` | Kolon kalır, **yazılmaz**; P3 hepsini NULL'lar (önceki değerler arşivlenir) |
| `invoices`, `invoice_counters`, `subscription_payments` | **Kalıcı** (vergi saklama). `invoice_counters` aktif olarak paylaşılıyor |

`subscription_plans`'ı fiilen düşürmek `down.sql`'i yalan yapardı. Üç inert satır
hiçbir maliyet üretmiyor — bırakılıyorlar.

---

## 5. Orantı ve yıl dönümü matematiği

Saf modül: `backend/src/modules/licensing/anniversary.ts` (Nest bağımlılığı yok,
`entitlement-engine.ts` üslubunda).

```
periodDays    = daysBetweenUtc(previousAnniversary, nextAnniversary)   // 365 VEYA 366
daysRemaining = daysBetweenUtc(anchorDateFor(now), nextAnniversary)
unitCents     = clamp(round(annualPriceCents * daysRemaining / periodDays), MIN_LINE_CENTS)
subtotalCents = unitCents * qty
```

| Kural | Karar | Gerekçe |
|---|---|---|
| **Zaman dilimi** | Çapa, satın alma anının *tenant-yerel* takvim gününün UTC gece yarısı | TR UTC+3, DST yok. 10 Mart 01:00 TRT = `2026-03-09T22:00Z` — ham an saklansa yıl dönümü 9 Mart'a düşerdi |
| **Döngü uzunluğu** | Gerçek gün farkı (365 **veya** 366) | Sabit 365, artık döngüde bir günlük fazla tahsil eder ve "yıl dönümünde al" işlemini `366/365 = %100,27` yapar |
| **Yıl dönümü günü alım** | Tam fiyat, tam taze yıl | `nextAnniversary` aday `<= from` ise `anchor+1yıl` döner → `daysRemaining === periodDays` |
| **İlk satın alma** | Çapa yoksa lisans satırı çapayı tanımlar; **aynı sepetteki** diğer satırlar da tam fiyat olur | Etkili çapa quote başına **bir kez** çözülür, satır fiyatlamadan önce |
| **≤14 gün kaldıysa** | Bir sonraki yıl dönümüne taşınır, `annual × (days + periodDays) / periodDays` | 2 gün kala ₺990'lık modül ₺5,42 eder, hemen yenileme sepetine düşer — destek talebi ve PayTR minimum tutar sorunu |
| **Yuvarlama** | Birim başına yuvarla, **sonra** çarp | `unit × qty === subtotal` tam eşitliği PayTR sepet üreticisi, fatura PDF'i ve re-quote toleransının hepsinin dayandığı şey. Sapma en fazla `qty` kuruş |
| **29 Şubat çapası** | Normal yıllarda **28 Şubat**'a kırpılır | 1 Mart ay sınırını geçer ve fatura dönemleri için "her yıl aynı gün"ü bozar |
| **Şube adedi artışı** | Yalnız delta fiyatlanır; `quantity: {increment}` + `quantityHistory` | Ödenmiş birimler asla yeniden orantılanmaz |
| **Şube adedi düşüşü** | `pendingQuantity` — yalnız yenilemede | Dönem içi iade yok |
| **Yenileme sepeti** | Tam yıllık liste fiyatı, orantı yok; fiyatlar üretim anında **canlı** katalogdan okunur, sonra `RenewalCycle`'a dondurulur | Müşteri hatırlatma e-postasındaki tutarı öder |

**Örnek (spec):** çapa 2026-03-10, 2026-03-20'de Gelişmiş Rapor (₺1.290 = `129000`).
`periodDays=365`, `daysRemaining=355` → `round(129000 × 355/365) = 125466` → **₺1.254,66**,
`periodEnd = 2027-03-10`.

### 5.1 Lisans biterse ücretli feature'lar ne olur?

Her şey yıl dönümüne hizalı olduğu için lisans ve modüller aynı `periodEnd`'i paylaşır;
ayrışma yalnızca tenant yenileme satırlarının *bir kısmını* ödeyip lisansı ödemezse oluşur.
İki katman:

1. **Sepet katmanı:** `QuoteService`, tenant'ın aktif lisansı yoksa ve aynı sepette
   lisans satırı da yoksa `requiresLicense` içeren sepeti `LICENSE_REQUIRED` ile reddeder.
2. **Projektör katmanı (asıl emniyet):** `feature.license` canlı değilken
   `projectAddOnsTx`, `requiresLicense: true` olan **her** add-on'un grant'larını bastırır.
   Sönük lisans her şeyi söndürür — **sıfır veri mutasyonuyla**. `TenantAddOn` satırları
   `active` kalır, `chargedCents` durur; stok, rezervasyon, personel, üretilmiş AI medya
   hepsi yerinde. Lisans geri ödenince bir sonraki projeksiyonda her şey yanar.

---

## 6. Guard / enforcement

### 6.1 `SubscriptionStatusGuard` → sil, yerine `TenantStatusGuard`

`auth.module.ts` APP_GUARD zincirinden çıkar, dosya silinir. **Ama slot boş kalmamalı:**
`TenantGuard` `Tenant.status`'ü kontrol etmiyor, dolayısıyla `SubscriptionStatusGuard`
tek global kilitti. Çekirdek bedava olunca superadmin askıya alma, kötüye kullanıma karşı
**tek** kaldıraç haline gelir. Aynı pozisyona minimal bir `TenantStatusGuard` gelir:
sadece `ACTIVE` geçer, `SUSPENDED`/`DELETED` → 403 `TENANT_SUSPENDED`, aynı kurtarma
allowlist'i (`/auth`, `/me`, `/legal`, `/health`, `/webhooks`), ~60sn önbellekli.

### 6.2 `PlanFeatureGuard` → sil; dekoratörleri alias'la (85 çağrı noktası **dokunulmaz**)

```ts
// requires-feature.decorator.ts (yerinde yeniden yazılır)
export const RequiresFeature = (...features: string[]) =>
  RequireEntitlement(...features.map((f) => ({ feature: `feature.${f}` })));

// requires-integration.decorator.ts
export const RequiresIntegration = (...domains: string[]) =>
  RequireEntitlement(...domains.map((d) => ({ integration: `integration.${d}` })));
```

`PlanFeature.ADVANCED_REPORTS === "advancedReports"` → `feature.advancedReports`;
eşleme **birebir**. 40 controller'ı elle düzenlemek ~1.500 satırlık mekanik diff
üretir, her uçuşta olan dalla çakışır ve asıl riskli projektör değişimini gömer.

`EntitlementGuard`'a iki küçük ekleme şart:

1. **`{ integration }`, `provider` olmadan** = "domain'de ≥1 satıcı var". Bugün
   `allowsIntegration(set, key, provider)` provider zorunlu kılıyor; mevcut 3 sitenin
   semantiği aynen korunmalı.
2. **Superadmin kaçışı.** `EntitlementGuard` `req.user.tenantId` yokken
   `ForbiddenException("Authentication required")` fırlatıyor; `PlanFeatureGuard`
   tenant'sız superadmin realm'ini geçiriyordu. Global kaydedilirse dekoratörlü her
   superadmin isteği 403 alır. `if (!tenantId) return true;` + `@RequiresFeature`
   taşıyan superadmin controller'larını grep'le.

**Yapılandırılmış 403 + satın alınabilir teklif** — frontend'in `featurePlanMap`'i
silmesini sağlayan asıl yenilik:

```ts
class EntitlementRequiredException extends ForbiddenException {
  requirement: { type: "feature"|"limit"|"integration"; key: string; usage?; cap? };
  offer: OfferSummary | null;   // katalogdan çözülen kalem + orantılı fiyat
  licenseRequired: boolean;
  reason: "not_owned" | "lapsed";   // "Satın al" mı "Yenile" mi
}
```

`reason:'lapsed'`, teklifin koduna ait süresi dolmuş/past_due bir `TenantAddOn`
satırından türetilir — çıkmaz sokak 403'ünü tek tıkla yenilemeye çeviren şey budur.

### 6.3 Ücretsiz temel: **projekte edilmiş grant'lar**, guard allowlist'i değil

```ts
export const FREE_BASELINE_SOURCE = "free:baseline";
export const FREE_BASELINE_GRANTS = {
  "feature.posAccess": true,
  "feature.kdsIntegration": true,
  "feature.customBranding": true,
  "feature.multiLocation": true,   // şube hub'ı/seçici BEDAVA; KAPASİTE ücretli
  "limit.maxUsers": -1,
  "limit.maxTables": -1,
  "limit.maxProducts": -1,
  "limit.maxCategories": -1,
  "limit.maxMonthlyOrders": -1,
  "limit.maxBranches": 1,          // hayatta kalan TEK sayısal limit
};
```

Neden veri, neden allowlist değil:
- `feature.*`=OR sayesinde temel, ücretli grant'larla kendiliğinden birleşir; yanlış
  yapılacak bir öncelik kuralı yok.
- `-1`, `limit.*` katlamasında **baskın** — bayat bir `plan:*` satırı toplama girse
  bile sınırsız temeli düşüremez. Mükemmel hata modu.
- FE `/entitlements/me` okuyor; veri içindeki temel sıfır frontend özel-durumu ister.
- Ops yine de `override:admin` `__replace` ile tenant bazında bastırabilir.

Şubelerdeki kasıtlı ayrım: `feature.multiLocation = true` (bedava — hub, seçici) ama
`limit.maxBranches = 1` (ücretli kapasite). `extra_branch`'in çift grant'ı
`{limit.maxBranches:1, feature.multiLocation:true}` tam da bu yüzden doğru şekil.

### 6.4 Projektör (`plan-projector` → `entitlement-projector`)

Tam olarak üç kaynak projekte edilir:

```
free:baseline    → FREE_BASELINE_GRANTS            (her tenant, koşulsuz)
addon:<code>:<id>→ katalog grant'ları × quantity   (lisans-bastırmalı)
override:admin   → tenant override'ları            (yalnız bastırma, §8)
```

Silinen: `FEATURE_COLUMNS`, `LIMIT_COLUMNS`, `resolveFreePlan` + 5dk önbelleği,
`activeSub` sorgusu, `plan:*` kaynağı ve bayat-kaynak süpürmesi.

**`validUntil` düzeltmesi (kritik).** Bugün `projectAddOnsTx`, `active` satırlara
`validUntil = currentPeriodEnd`, yalnız `past_due`'ya `+7g` veriyor. `sweepExpired`
**5 dakikada bir**, add-on sweeper ise **03:00**'te çalışıyor. Yıl dönümünde bu
**her tenant için, her yıl, 3 saatlik erişim karartması** üretir. İki uçtan düzelt:
`active` satırlara da `validUntil = currentPeriodEnd + GRACE_DAYS`, ve sweeper
`@Cron("5 0 * * *")`'a taşınır.

### 6.5 `@CheckLimit` kaldırma + şube kapasitesi

Dekoratör, `LimitType` ve 7 sitenin tamamı silinir (`orders`, `menu/categories`,
`menu/products`, `tables`, `device-mesh/branches`, `users` ×2). `menu-import.service.ts`
içindeki elle yazılmış toplu ürün-limiti ön kontrolü de.

Şube kapasitesi guard'a **taşınmaz**: `EntitlementGuard`'ın `usage` callback'i yalnız
`req` alıyor, Prisma'ya erişemiyor; ayrıca guard kontrolü, yarışın para hatası olduğu
tek limitte TOCTOU'dur. Yaratma işleminin **içinde** enforce edilir:

```ts
await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`branch-cap:${tenantId}`}, 0))`;
const cap = set.limits["limit.maxBranches"] ?? 1;
if (cap !== -1 && used >= cap) throw new EntitlementRequiredException({...});
```

`MenuAiQuotaService.claim()` ile aynı advisory-lock + say + yaz şekli.

### 6.6 Muhasebe / e-Fatura kapısı ayrışması

`SettingsLayout` muhasebeyi `integration:accounting` ile, `App.tsx` aynı yüzeyi
`feature:advancedReports` ile kapatıyor; e-document ve accounting-settings endpoint'leri
ise `@RequiresFeature(ADVANCED_REPORTS)` altında. e-Fatura artık ₺1.990'a
`integration.fiscal:['efatura']` olarak satıldığında **yalnız e-Fatura alan tenant
hiçbir şey açamaz.** ~40 `ADVANCED_REPORTS` sitesi denetlenip ayrılmalı: gerçek
raporlama/analitik `advancedReports` kalır; e-document + muhasebe ayarları
`@RequiresIntegration('fiscal')` olur.

---

## 7. Satın alma yolu

**Yeni ödeme altyapısı yok.** `POST /v1/checkout/intent` → `QuoteService` → PayTR →
`CK-` webhook → `CheckoutSettlementService` → `CheckoutService.confirmAndProvision`
→ `tenantMarketplace.purchase()` zinciri tam olarak gereken şey.

### 7.1 Yeni satır tipi **yok**

`CartItemPlan` silinir (bugün zaten hard-reject ediliyor). Tek `type:'addon'` satırı
kalır; **davranışı katalog satırının `kind`'i belirler.** Yeni DTO yok, yeni FE sepet
tipi yok, yeni provisioning dalı yok — ve yenileme sepeti sıradan çok satırlı bir
addon sepetinden ibaret olur.

### 7.2 Donmuş fiyat (kritik para hatası)

`confirmAndProvision` settlement'ta yeniden fiyatlıyor ve >1 kuruş sapmada provision'ı
reddediyor. **Orantı `now`'a bağlı.** 23:58'de oluşan bir intent 00:03'te settle
olursa `daysRemaining` bir gün kaybeder → re-quote ~₺8 sapar → **kart çekilir ve
hiçbir şey provision edilmez.** Her gece.

```prisma
model CheckoutIntent {
  + pricedAt   DateTime @default(now())   // dondurulmuş fiyatlama anı
  + quoteJson  Json?                      // fatura + denetim izi
  + expiresAt  DateTime?                  // now + 48s; sonrası settlement reddi
  + referralCode String?
  + referredByMarketingUserId String?
}
```

Settlement `quote(cart, tenantId, { now: intent.pricedAt })` ile yeniden fiyatlar —
böylece 1 kuruşluk tolerans asıl işini yapmaya devam eder: intent ile settlement
arasındaki **katalog fiyat düzenlemelerini** yakalamak.

Ayrıca `checkout-intent.service.ts` sepet metni `oneTime` olmayan her şeye `"(aylık)"`
basıyor — PayTR barındırılan sayfasında ₺2.990'lık **yıllık** lisansın yanında
alıcının okuduğu şey bu. `"(yıllık)"` olmalı.

### 7.3 `QuoteService`

```ts
async quote(cart: Cart, tenantId: string, opts?: { now?: Date; allowRenewal?: boolean })
```

1. Tek seferde yükle: `tenant.licenseAnchorAt`, aktif/past_due `TenantAddOn`'lar, `hasLicense`.
2. `requiresLicense` satırı var + lisans yok + sepette lisans yok → `LICENSE_REQUIRED` + teklif.
3. `effectiveAnchor = licenseAnchorAt ?? (licenseInCart ? anchorDateFor(now) : null)` — **quote başına bir kez**.
4. `kind`'e göre: `license|module|integration|capacity` → `prorate(...)`, `cadence:'yearly'`;
   `capacity` mevcut satırda → yalnız yeni birimler, `maxQuantity` doğrulaması;
   `credit` → düz `priceCents × qty`, `cadence:'oneTime'`; `service|hardware` → değişmez.
5. Zaten sahip olunan (kapasite/kontör dışı) → `addon_already_owned` uyarısı, satır düşer.
6. KDV bugünkü gibi gross'tan **türetilir**, üstüne eklenmez.

### 7.4 `purchase()` değişiklikleri

- `deps`'te `plan:` işlemesi silinir; `requiresLicense` + canlı lisans kontrolü gelir.
  **`fiscal_hugin`'in `deps:['plan:PRO']`'su P1'de temizlenmeli** yoksa
  `tenant.currentPlan` NULL olur olmaz her Hugin alımı 400 döner.
- `currentPeriodEnd = input.periodEnd ?? nextAnniversary(...)` — `now + 30g` yerine.
- `kind:'license'` soğuk başlangıçta `tenant.licenseAnchorAt` aynı tx'te set edilir
  (`licenseAnchorAt ?? anchorDate` — yenilemeler asla üzerine yazmaz).
- `kind:'credit'` → `TenantAddOn` yaratmaz; `purchaseCredits()` bir `CreditLot` yazar.
- `kind:'capacity'` mevcut aktif satırda → `quantity: {increment: qty}`. Bugünkü sert
  `BadRequestException("...change quantity instead")`'in karşılık gelen bir yolu **yok**
  → kapasite 1 birimden fazla satılamıyor.
- **Comp:** para guard'ı (`priceCents>0 && !paymentRef → Forbidden`) kalır, açık bir
  `opts.comp` baypası `origin:'comp'`, `chargedCents:0`, `compActorId`, `compReason`
  yazar. Override zehirinin (§8) çözümü budur.
- `includedInPlan` → `owned` olarak yeniden adlandırılır, entitlement katlamasından
  değil `TenantAddOn` satırlarından hesaplanır. `feature.license` kapsam kontrolünden
  hariç tutulmalı, yoksa lisans "dahil" görünüp satılamaz hale gelir.

### 7.5 Settlement

- Add-on satırları `line.meta.kind`'e göre yönlendirilir; **lisans satırları önce
  sıralanır** ki aynı sepetteki kardeş modüller dönemlerini hesaplarken çapa var olsun.
- `chargedCents`, `pricingMeta`, `periodStart/End` `purchase()`'a geçirilir.
- `cart.renewalCycleId` varsa `renewalCycles.markPaid(...)` aynı tx'te.
- `TenantInvoice` + satırları **tx içinde** yaratılır.
- **`PaymentSucceeded` emit edilir** — bu ray bunu hiç yaymadı ve pazarlamacı
  komisyonunun tek girdisi bu. `commissionRate` artık `MarketplaceAddOn`'dan.
  Idempotency anahtarı `payment-succeeded:{paymentRef}`.

### 7.6 Havale

`bank-transfer.service.ts` plan-merkezliden sepet-merkezliye. `createIntent({cart, buyer})`
`paymentRef = 'HVL-' + uuidv7()` ile bir `CheckoutIntent` üretir; superadmin
`confirm(paymentRef)` **PayTR ile birebir aynı** `CheckoutSettlementService.handleSuccess`
yolunu çağırır. Bugünkü paralel `SubscriptionPayment` + `resolvePlanAmount` + elle
aktivasyon kodu yerine tek settlement yolu, tek idempotency modeli, tek fatura üreteci.

### 7.7 `SUB` rayı

`/subscriptions/change-plan` ve plan `create-intent` kaldırıldıktan sonra hiçbir şey
`SUB` merchant OID üretmez. Webhook dalı ve `paytr-settlement.service.ts` **bir sürüm
boyunca dokunulmadan bırakılır** ki uçuştaki retry'lar settle olabilsin; P8'de silinir.

---

## 8. Superadmin ve `{__replace:false}` zehri

Bugün `Tenant.featureOverrides` `Record<string, boolean>` ve projektör **her** anahtar
için `{__replace: v}` yayıyor — yani `{advancedReports:false}` feature'ı kalıcı olarak
bastırıyor, **meşru bir satın alma sonrasında bile**. Daha kötüsü:
`auth-provisioning.service.ts` kayıt sırasında `featureOverrides`'ı **planın TRUE
feature'larıyla tohumluyor** → P3'ten sonra mevcut her tenant `__replace:true` grant'ları
taşır ve ücretli modülleri sonsuza dek bedava alır.

Üç parçalı çözüm:

1. **Arşivle ve temizle** — P3 migration'ı `legacy_tenant_overrides` tablosuna alır,
   `tenants.featureOverrides/limitOverrides/currentPlanId`'yi NULL'lar; `down` geri yazar.
   Pazarlık konusu değil.
2. **Override'ları üç-durumlu yap:**
   ```ts
   type FeatureOverride = { mode: "grant" | "suppress"; note?: string; expiresAt?: string };
   ```
   `mode:'grant'` düz `true` projekte eder (OR ile katlanır, sonraki satın almayı asla
   engellemez). `mode:'suppress'` `{__replace:false}` projekte eder — zehirleyebilen tek
   şekil, artık açıkça adlandırılmış, `expiresAt`'li ve zorunlu notlu.
3. **Comp bir override değildir.** "Bu tenant'a X ver" için belgelenmiş operatör yolu
   gerçek bir comp'lanmış `TenantAddOn`'dur: denetlenebilir, yıl dönümünde herkes gibi
   biter, tenant'ın sahip olduğu kalemler listesinde görünür, ₺0 fatura satırı üretir ve
   gelecekteki satın almaları zehirleyemez.

`PlansPage.tsx` (732 satır) silinir; `MarketplaceAdminPage` "Katalog" olur.
`AddOnCatalogService`'e katalog doğrulayıcı eklenir: `kind:'integration'` → `integration.*`
grant etmeli; `kind:'credit'` → `creditKind`+`creditUnits` zorunlu; `kind:'license'`
tekil ve `requiresLicense=false`; yayınlanmış satırlarda `priceCents > 0`; ilk
`TenantAddOn`'dan sonra `code` değişmez; **`plan:` önekli dep reddedilir.**

---

## 9. Yaşam döngüsü cron'ları

`subscription-scheduler.service.ts`'teki 10 işten 7'si **silinir** (trial-expirations,
period-end, expiry-reminders, pending-cancellations, past-due, trial-reminders,
scheduled-downgrades), 2'si **yeniden hedeflenir** (`paytr-orphan-cleanup` →
checkout-intent temizliği; `paytr-pending-recovery` → `succeeded` ama provision
edilememiş `CheckoutIntent` kurtarma — bu gerçekten değerli ve bugün yalnız SUB rayını
kapsıyor), 1'i SUB rayıyla birlikte P8'de gider.

Hayatta kalan motor `tenant-addon-sweeper.service.ts`, `@Cron("5 0 * * *")`'a taşınmış:
`active → past_due` (`currentPeriodEnd`), `past_due → expired` (`+ADDON_GRACE_DAYS`).

Yeni `licensing/renewal-scheduler.service.ts` (hepsi `withAdvisoryLock`):

```
@Cron("0 6 * * *")  generateRenewalCycles()   // T-30, sepet+quote dondurur
@Cron("0 9 * * *")  sendRenewalReminders()    // [30,7,1], remindersSent ile idempotent
@Cron("30 0 * * *") lapseUnpaidCycles()       // graceEndsAt geçti → lapsed + expired
```

Geri alma **yalnız** `FeatureEntitlement` satırlarına ve `TenantAddOn.status`'e dokunur.
Hiçbir iş tablosu yazılmaz: stok, rezervasyon, personel, üretilmiş AI medya, faturalar
ve siparişler yerinde kalır.

---

## 10. Frontend

| Bugün | Olacak |
|---|---|
| `/subscription/plans`, `/subscription/change-plan` | **silinir** |
| `/subscription/manage` | → `/admin/billing` (yalnız fatura + ödeme geçmişi) |
| `/admin/plan` | → `/admin/license` "Lisans & Erişim" |
| `/admin/store` | **Mağaza**: Lisans · Modüller · Entegrasyonlar · Kontör · Şube · Donanım · Siparişler |
| `/admin/marketplace` | **silinir**, kartlar StoreHub'a taşınır |
| `/subscription/checkout` | → `/store/checkout`, `POST /v1/checkout/intent`'e bağlanır |
| — | **yeni** `/admin/license/renewal/:cycleId` |

Bugünkü üç sorgu (`/subscriptions/plans` + `/current` + `/effective-features`) tek
endpoint'e iner:

```
GET /v1/me/licensing → { entitlements, license, credits, owned[], renewal, offers }
```

`SubscriptionContext` → `EntitlementContext`. `hasFeature` **yüklenirken kapalı
kalmaya devam eder** (kasıtlı FL2 davranışı). `useSubscription` bir sürüm boyunca
deprecated alias olarak kalır ki ~25 tüketici dosya codemod'la geçsin.

`FeatureGate`'in API'si değişmez — `App.tsx`'teki 17 rota sarmalayıcısından yalnız
`planName="BASIC|PRO|BUSINESS"` prop'u silinir. `UpgradePrompt`'taki `featurePlanMap`
silinir; yerine `offerFor(key)`'den gelen *"Gelişmiş Rapor & Analitik — ₺1.290/yıl.
Bugün alırsanız ₺1.254,66 (10 Mart 2027'ye kadar)."*

Silinen bileşenler: `SubscriptionGate`, `PlanCard`, `PlanComparisonMatrix`,
`ScheduledDowngradeAlert`, `CancelSubscriptionModal`, `LimitWarning`, `UsageMeters`,
`TaxIdReminderModal`. `SubscriptionStatusBanner` → `RenewalBanner`.

`types/index.ts`'ten `SubscriptionPlanType`, `PlanLimits`, `Plan`, `TenantOverrides`
silinir. Tip güvenliği, aynalanmış `entitlement-keys.const.ts`'ten üretilen bir
`EntitlementFeatureKey` union'ıyla korunur — `FeatureGate`'in prop'unu çıplak `string`'e
gevşetmek 20+ çağrı noktasında derleme zamanı kontrolünü kaybettirir.

**i18n:** katalog metni DB'den gelir. Locale dosyalarında yalnız chrome kalır; yeni
`licensing.json` **beş dilde birden** (`tr/en/ar/ru/uz`) yoksa `check-i18n-parity.mjs`
kırılır. Ayrıca `scripts/i18n-value-drift-baseline.json` aynı PR'da yenilenmeli.
(Not: `check-contract-drift.mjs` yalnız `UserRole`, `HARD_RESTRICTED_ROLES`,
`OrderStatus`, `OrderType`, `PaymentStatus` aynalıyor — plan sabitleri orada değil.)

**Pazarlama:** yeni public `GET /v1/catalog/pricing`. Hem SPA `/fiyatlandirma` hem
Next.js `landing/` aynı endpoint'i tüketir — gösterilen fiyat checkout fiyatından
asla sapamaz. `marketing/data/plans.ts` silinir.

---

## 11. Fazlar

| Faz | Tag | Dal | İçerik |
|---|---|---|---|
| **P0** | v3.3.0 | `feat/alacarte-groundwork` | Additive migration'lar + `anniversary.ts` + spec + `entitlement-keys.const.ts` + `invoice-number.helper.ts` çıkarımı. Yeni kolonları hiçbir şey okumaz |
| **P1** | v3.3.1 | `feat/alacarte-catalog` | Katalog data migration + seed + validator + superadmin katalog UI. **`limit.branches`→`limit.maxBranches` ve `deps:['plan:PRO']` düzeltmesi.** Yeni satırlar `draft` iner |
| **P2** | v3.3.2 | `feat/proration-checkout` | Orantı, lisans ön koşulu, `pricedAt`, `purchase()` dalları, `TenantInvoice`+PDF, havale→sepet, `PaymentSucceeded` emit |
| **P3** | v3.4.0 | `feat/free-core` | **Tek atomik PR.** Override arşivle+temizle, projektör yeniden yazımı, dekoratör alias, `EntitlementGuard` global, guard silmeleri, `TenantStatusGuard`, şube kapasitesi, provisioning+demo, muhasebe/fiscal ayrımı |
| **P4** | v3.4.1 | `feat/credits` | `CreditService`, `/v1/credits/me`, SMS tüketimi |
| **P5** | v3.4.2 | `feat/renewal-cycles` | `RenewalCycleService`, 3 cron, sweeper 05:00, ölü işlerin silinmesi |
| **P6** | v3.5.0 | `feat/store-ia` | `EntitlementContext`, `/v1/me/licensing`, mağaza IA, 5 dil |
| **P7** | v3.5.1 | `feat/public-pricing` | `/v1/catalog/pricing`, SPA + landing fiyat sayfaları |
| **P8** | v3.5.2 | `chore/retire-subscription-rail` | Eski ray silme, `pending_plan_changes` drop |

P3'ün parçaları **ayrılamaz**: bölünürse ya "her şey bedava ve kapısız" ya da
"her şey kilitli" olur. P3'ün projektör/guard flip'i tek bir `ALACARTE_ENTITLEMENTS`
env bayrağıyla korunur ve P4'te kaldırılır — bir hatanın her tenant'ı ardına kadar
açtığı ya da kilitlediği tek değişiklikte yeniden deploy'suz geri dönüş sağlar.

---

## 12. Tuzaklar

| # | Tuzak | Etki |
|---|---|---|
| L1 | `auth-provisioning` `featureOverrides`'ı TRUE feature'larla tohumluyor | P3 sonrası **her mevcut tenant her modülü bedava alır**, nightly reconcile yeniden yazar |
| L2 | Donmuş fiyat yok | Gece yarısını geçen her intent: **kart çekilir, provision edilmez** |
| L3 | `CK-` rayı `PaymentSucceeded` yaymıyor | Pazarlamacı komisyonu **sessizce sıfırlanır** (relay yapılandırılmamışken satırları *park ediyor*, hata vermiyor). `tenant-provisioning.types.ts::commissionRate` ayrı `kds-marketing` deployable'ıyla **servisler arası port kontratı** — v2 event düşün |
| L4 | Yıl dönümü karartması | Her tenant, her yıl **3 saat** kilitli |
| L5 | `limit.branches` ≠ `limit.maxBranches` | P1, P3'ten önce inmezse ödeyen tenant 1 şubede kalır |
| L6 | `fiscal_hugin` `deps:['plan:PRO']` | `currentPlan` NULL olunca her Hugin alımı 400 |
| L7 | `EntitlementGuard` tenant'sız istekte fırlatıyor | Global kayıt **superadmin'i 403'ler** |
| L8 | `resolveFreePlan()` 5dk önbellek, miss'te `plan:NONE` = sıfır grant | P3 bu kod yolunu silmeden plan satırlarını deaktive etme |
| L9 | `demo.service.ts` plan upsert + ALL_FEATURES override | Demo tenant'ta bedava-her-şey zehri |
| L10 | Referral snapshot `SubscriptionPayment`'ta | CK rayında yok → `CheckoutIntent`→`TenantInvoice`→emit boyunca taşı |
| L11 | `TenantGuard` `Tenant.status` bakmıyor | `SubscriptionStatusGuard` silinince global kilit kalmaz |
| L12 | `includedInPlan` temel grant'larla | `feature.license` hariç tutulmazsa lisans "dahil" görünüp satılamaz |
| L13 | `TenantAddOn`'da partial unique index yok | Dup-guard Serializable'a bağlı; kontör *tüketimi* checkout tx'ine sokulmamalı (P2034) |
| L14 | `capacity` dup hatasının kaçış yolu yok | Kapasite 1 birimden fazla satılamaz |
| L15 | Sepet metni `"(aylık)"` | Alıcı PayTR sayfasında ₺2.990 yıllık lisansın yanında "aylık" okuyor |
| L16 | Muhasebe/e-Fatura kapısı ayrışması | Yalnız e-Fatura alan tenant hiçbir şey açamaz |
| L17 | Operatör yazımı `plan:*` dep | Sessizce satın almayı bloklar → katalog validator |
| L18 | Arşivlenecek kodlar **silinmemeli** | `code` yeniden kullanımı yasak, `addOnId` `onDelete: Restrict` |
| L19 | Drift-snapshot spec'leri temasla kırılır | `feature-plan-matrix.spec.ts`, `plan-projector.service.spec.ts` P3 **içinde** yeniden yazılmalı |
| L20 | `i18n-value-drift-baseline.json` | Locale değeri değişen her PR'da yenilenmeli |
| L21 | `menu-import.service.ts` elle ürün-limiti ön kontrolü | `@CheckLimit` silmesinden sağ çıkar |
| L22 | `QuoteService` imza değişimi | Çıplak kurulan her spec kırılır (geniş ama mekanik) |
| L23 | `entitlementsApi.ts`'in tek tüketicisi `SetupChecklist.tsx` | Context yeniden adlandırmasında sessizce kırılır |
| L24 | `CheckoutIntent.paymentRef` ve `SubscriptionPayment.paytrMerchantOid` ayrı tablolarda `@unique` | `HVL-` yeniden yazımı eski taraftaki bir ref'i kullanmamalı |
| L25 | El-yazımı migration `@@map` adı | `UPDATE marketplace_addons`, `UPDATE "MarketplaceAddOn"` **değil** (geçmiş prod olayı: 42P01 → rollback) |

---

## 13. Doğrulama

**Birim.** `anniversary.spec.ts` tablo-güdümlü: çapa 2026-03-10 → 03-10 (tam, 365),
03-20 (355/365 → `125466`), 2027-03-08 (roll-forward), 29 Şubat çapası (28'e kırpma),
2027→2028 (`periodDays === 366`), `qty=3` (`unit×3===subtotal`), TZ
(2026-03-10T01:00+03:00 → 03-10, 03-09 değil). Özellik testleri:
`prorate(anchor, anchor) === annual`; döngü boyunca monotonik azalış.

`entitlement-projector.service.spec.ts` yeniden yazılır — `FREE_BASELINE_GRANTS`
snapshot'ı **yeni drift tripwire**'ı olur (plan-kolonu snapshot'ının yerine).
`checkout.service.spec.ts`'e **L2 regresyonu**: `T`'de fiyatlanan intent `T+26s`'te
settle olur, re-quote **birebir** eşleşmeli.
`catalog-invariants.spec.ts`: yayınlanmış her satır için tip/fiyat/grant tutarlılığı
**ve seed dosyası fiyatlarının P1 data migration'ıyla birebir eşleşmesi** (sapma =
dev ile prod farklı fiyatlıyor).

**Migration round-trip.** Her dizin için scratch DB'de:
öncekiler → `pg_dump --schema-only` → `migration.sql` → `down.sql` → diff → tekrar up.
`credit_tables` için ek olarak `ai_generation_usage` satırları tohumlanıp up→down→up
boyunca satır-satır korunma iddia edilir.

**e2e (gerçek Postgres, `PAYTR_USE_FAKE_ADAPTER`).** Yeni `specs/licensing/`;
eskiler **silinmeden önce** yazılır ki CI kapısı hiç açıkta kalmasın.

1. Sıfır satın almalı tenant → POS/KDS/menü/masa/QR/sipariş/kasa/dashboard/ekip/
   müşteriler/şube hub'ı/marka erişilebilir; 200 ürün + 60 masa yaratılır (limitler gitti).
2. Lisanssız modül alımı → `400 LICENSE_REQUIRED` + teklif.
3. Lisans alımı → `licenseAnchorAt` set, `feature.license` canlı, 1 satırlık ₺2.990 fatura.
4. 10 gün sonra modül → `round(129000 × rem/cycle)`, `periodEnd === anniversary`,
   fatura satırında `prorationMeta`.
5. 2 ek şube → 3. şube açılır, 4. yapılandırılmış 403 + `extra_branch` teklifi.
6. Kontör: 100 al → 100 → üret → 99 → job fail → 100 → 100 üret → `402` + teklif.
7. Yenileme: çapası 30 gün ilerideki tenant → cron `RenewalCycle` üretir → öde →
   tüm `periodEnd`'ler ilerler, tek çok satırlı fatura.
8. Lapse: ödeme yok → +7g → modül 403 `reason:'lapsed'`; **veri bütünlüğü iddia edilir**
   (stok/rezervasyon/personel hâlâ sorgulanabilir); yeniden öde → erişim döner.
9. Superadmin comp → sahip, `chargedCents:0`, `origin:'comp'`; **sonradan aynı kalemi
   gerçekten satın alma hâlâ mümkün** (zehir regresyonu).
10. Askıya alınmış tenant → allowlist dışı her rotada 403 `TENANT_SUSPENDED`.

**CI kapıları:** `check-contract-drift.mjs`, `check-i18n-parity.mjs` (5 dil),
`check-i18n-value-drift.mjs` (baseline yenilenmiş), her migration'dan sonra
`prisma generate` + `tsc` (lokalde `migrate dev` kırık).

---

## 14. Açık kararlar

1. **Kısmi yenileme** — tenant yenilemede tek tek modül düşürebilir; lisansı düşürmek
   her şeyi düşürür. (Varsayılan kabul; tamamen "hep ya da hiç" istenirse değişir.)
2. **`SubscriptionPlan`/`Subscription` sonsuza dek inert** — vergi saklamalı
   `invoices` arşivinin FK bütünlüğü için fiziksel drop önerilmiyor.
