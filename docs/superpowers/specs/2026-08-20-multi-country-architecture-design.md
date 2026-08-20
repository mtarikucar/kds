# Çok ülkeli mimari (P1 + P2) — tasarım

**Tarih:** 2026-08-20
**Durum:** onaylandı, plana geçilecek
**Branch:** `feat/multi-country-architecture`
**Kapsam:** P1 (ülke profili + parametre toplama) ve P2 (yetenek seçimi). P3–P7 ayrı spec'ler.

## Problem

Platform bir Türk restoran POS/KDS ürünü ve Türkiye kodun içine dokunmuş durumda. Özbekistan'da bir
kafe sistemi kullanacak; ardından **birden fazla ülkeye, farklı regülasyonlar ve farklı parametrelerle**
hizmet verilecek.

Asıl ölçüt ikinci ülke değil, **üçüncüsü**: üçüncü ülkeyi eklemek ikincisi kadar pahalıysa mimari
yanlıştır.

## Ayrım: parametre vs regülasyon

Bu tasarımın bel kemiği. **Parametre** veriyle çözülür (para birimi, vergi oranı, telefon biçimi, saat
dilimi, vergi-no şekli). **Regülasyon** kodla çözülür (fiskal fiş rejimi, e-fatura formatı, ödeme
sağlayıcısı, yazıcı diyalekti). Birincisini koda gömersen her ülke bir deploy olur; ikincisini veriye
gömersen hiç çalışmaz.

## Bugünkü durum — kanıtlanmış

63 ajanlı bir tarama, her bulgusu ayrıca düşman gözüyle doğrulanarak çıkarıldı.

### İyi haber: regüle katman zaten doğru şekilde

| Seam | Yer |
|---|---|
| `PaymentProviderRegistry` — id-anahtarlı Map, adapter'lar `onModuleInit`'te kendini kaydeder | `payments-core/payment-provider.registry.ts:12-36` |
| `FiscalProviderRegistry` — aynı şekil, sağlayıcı başına `capabilities` | `fiscal-core/fiscal-provider.registry.ts:5-25` |
| `EscPosBuilderRegistry` — id-anahtarlı yazıcı diyalekti | `device-mesh/printing/escpos-builder.registry.ts:11-29` |
| `AccountingAdapter` arayüzü — 4 adapter | `accounting/adapters/accounting-adapter.interface.ts:42-66` |
| `EDocumentSigner` / `MUKELLEF_QUERY` DI sembolleri | `accounting/providers/e-document-signer.ts:3`, `mukellef-query.provider.ts:3` |
| `ReceiptSnapshotV1` — sürümlü, yazıcıdan bağımsız, para birimini taşıyor | `orders/services/receipt-snapshot*` |

Para matematiği de temiz ve **ellenmeyecek**: `TaxCalculationService` tamamen oran-parametreli;
`apportionDiscount` (`orders/services/fiscal-line-builder.ts:41-60`), combo apportionment
(`orders/services/combo-pricing.ts:224-238`), `prorate()` (`licensing/anniversary.ts:140-208`) ve
`toIntCents` (`common/money/to-int-cents.ts`) ülkeden bağımsız tamsayı aritmetiği.

Frontend tarafı da hazır: `useFormatCurrency` (`frontend/src/hooks/useFormatCurrency.ts:25-50`) yerel
ayarı `useLocale()`'den, para birimini `useCurrency()` → `Tenant.currency`'den alıyor. Boru hattı uçtan
uca kurulu; kapalı olan tek şey seçicinin TRY'ye kısılmış olması.

### Kötü haber: seçim yok, parametreler dağınık

**Vergi kuralının dört ayrı aynası var:**

| # | Yer | Ne yapıyor |
|---|---|---|
| 1 | `checkout/quote.service.ts:35,317` | `TR_KDV_RATE = 0.2`; `currency === "TRY" ? TR_KDV_RATE : 0` |
| 2 | `common/helpers/kdv.helper.ts:3` | `DEFAULT_KDV_RATE = 0.2`, `toDecimalPlaces(2, ROUND_HALF_UP)` |
| 3 | `subscriptions/services/billing.service.ts:68` | `isTurkish = currency.toUpperCase() === "TRY"` → non-TRY hiç vergi kaydetmiyor |
| 4 | `accounting/constants/accounting.enum.ts:1-6` | `enum TaxRate { ZERO=0, ONE=1, TEN=10, TWENTY=20 }` |

Ve ürün girişinde `menu/dto/create-product.dto.ts:223` `@IsIn([0, 1, 10, 20])` — **Özbekistan'ın %12
QQS'i sisteme hiç girilemiyor.** Bu tek başına blocker.

**PayTR bağlantısı yedi yerden sızıyor:**

| Tip | Yer |
|---|---|
| Somut sınıf enjeksiyonu (registry atlanıyor) | `customer-orders/services/self-pay-intent.service.ts:52` |
| Somut sınıf enjeksiyonu | `customer-orders/services/self-pay-recovery.service.ts:68` |
| Literal sağlayıcı id'si çağrı yerinde | `checkout/checkout-intent.service.ts:304` `createIntent("paytr", …)` |
| Adapter girişinde TRY kapısı (×2) | `payments/adapters/paytr.adapter.ts:384,488` |
| Sağlayıcı-bağımsız shim'de İKİNCİ TRY kapısı | `payments-core/adapters/paytr-payment-provider.ts:89-93` |
| Kiracı para birimine göre self-pay reddi | `customer-orders/services/self-pay-intent.service.ts:216-222` |
| Kolon varsayılanı | `CheckoutIntent.provider` → PayTR |
| Prod açılışında zorunlu env | `common/helpers/env-validation.ts:62-66` → `process.exit(1)` |

**Ayna sayıları — drift riskinin gerçek ölçüsü:**

| Kavram | Kaç yerde |
|---|---|
| ×100 minor-unit sınırı (hepsi tam 2 ondalık varsayıyor) | 16 |
| E.164 telefon regex'i (iki farklı varyantta) | 23 |
| `@NormalizePhone("TR")` / literal `"TR"` bölge | 21 + 21 |
| VKN/TCKN kuralı (7 kod + 2 HTML pattern + 20 çeviri metni) | 29 |
| `'tr-TR'` sayı biçimi | 17 |
| `<html lang="tr">` e-posta şablonu / Türkçe konu satırı | 24 / 25 |
| Ad-hoc `process.env` okuması (ConfigService var ama tek kapı değil) | 100 |

**Diğer blocker'lar:** `accounting/providers/ubl-tr-builder.ts` tek e-fatura biçimi ve UBL-TR'ye çivili
(`CustomizationID TR1.2`, `TaxTypeCode 0015`, `InvoiceTypeCode SATIS`, her satır `unitCode="C62"`);
fiskal satırda ürün sınıflandırma kodu alanı **yok** (`FiscalReceiptItem` / `FiscalLine`), Özbekistan'da
IKPU/MXIK her fiş ve ЭСФ satırında zorunlu; `escpos-builder.service.ts:64-90` CP857 tablosu 20 Türkçe
girdi taşıyor ve `:467-468` tanımadığı her karakteri `0x3f` yani `?` yapıyor; aynı dosyada `:425-432`
fiş zaman damgası `tr-TR` + `Europe/Istanbul`'a çivili ve **şubenin kendi saat dilimini hiç okumuyor**.

## Karar: ülke kiracıda

Kullanıcı kararı. Bir kiracı tek ülkede çalışır; çok ülkeli zincir ayrı kiracı açar.

Bunun kazandırdığı şey önemli: bir kiracının tüm şubeleri tek para biriminde olduğu için **kiracı geneli
raporlar doğal olarak toplanır** ve kur dönüşümü sorunu hiç doğmaz. Şube ülkeyi kiracısından okur ve
ondan sapamaz.

Bilinen bedeli: fiskal cihaz kaydı (`FiscalDeviceRecord`) ve fiş basımı zaten şube gerçekliği. Bugün
sorun değil çünkü şube kiracının ülkesini miras alıyor; ileride bir kiracının iki ülkede şubesi olması
istenirse bu karar yeniden açılır.

**`Tenant.currency` kalıyor ama artık seçilmiyor — türetiliyor.** 15 belge modeli ve frontend'deki
`useCurrency()` onu zaten okuyor; sökmek gereksiz churn olur. Bundan sonra kolon yalnızca ülke
profilinden **yazılır** ve bağımsız düzenlenemez; ülkeden sapamayacağı bir invariant testiyle korunur.
Belge modellerindeki `currency` kolonları olduğu gibi kalır — onlar düzenlenme anındaki para birimini
tarihsel olarak saklıyor ve bu doğru davranış.

**Para birimi seçicisi tamamen kalkıyor.** `SUPPORTED_CURRENCIES` (`common/constants/currencies.const.ts`)
v3.2.9'da TRY'ye kısılmıştı; artık kullanıcıya hiç sorulmayacak, çünkü para birimi ülkenin sonucu. Sabit,
sembol tablosu (`CURRENCY_INFO`) olarak kalır — biçimlendirme onu kullanıyor.

## Mimari

### Katman 1 — Ülke profili (kod sabiti)

`backend/src/common/country/country-profile.const.ts`, ISO-3166-1 alpha-2 ile anahtarlı.

**Neden veritabanı değil kod:** bu repoda emsali var — `marketplace/alacarte-catalog.const.ts` platform
fiyatlandırmasının tek doğruluk kaynağı olarak kodda duruyor, seed ve invariant testleri ondan besleniyor.
Ülkeler nadiren değişir; veritabanı satırına yanlış yazılmış bir vergi oranı **para olayıdır**. Kod sabiti
review'dan, testten ve sürümden geçer. Veri olan tek şey `Tenant.countryCode`.

Mevcut kiracılar için migration varsayılanı `"TR"` — bugünkü her kiracı Türk. Kolon `NOT NULL DEFAULT 'TR'`
olarak eklenir, böylece geri alınabilir ve hiçbir satır belirsiz kalmaz.

Profilin taşıdığı alanlar:

```ts
interface CountryProfile {
  code: string;                    // "TR" | "UZ" — ISO-3166-1 alpha-2
  currency: string;                // "TRY" | "UZS" — ISO-4217
  displayDecimals: number;         // TR 2, UZ 0 — YALNIZ görüntüleme
  taxRates: number[];              // TR [0,1,10,20] · UZ [0,6,12]
  defaultTaxRate: number;          // TR 10 · UZ 12
  phoneRegion: string;             // "TR" | "UZ" — libphonenumber bölgesi
  taxIdRules: { name: string; pattern: RegExp; label: string }[];
  defaultLocale: string;           // "tr" | "uz-Latn"
  intlLocale: string;              // "tr-TR" | "uz-UZ"
  defaultTimezone: string;         // "Europe/Istanbul" | "Asia/Tashkent"
  capabilities: {                  // Katman 2 — sağlayıcı ADLARI, sınıf değil
    fiscalProviderId: string | null;
    paymentProviderIds: string[];
    eDocumentAdapterId: string | null;
    escposBuilderId: string;
    smsProviderId: string;
  };
}
```

**Saklama üssü profilde YOK, ve bu bilinçli.** İlk taslakta `storageMinorExponent` diye bir alan
vardı; çıkardım. Saklama her para biriminde **daima ×100** — bu bir değişmez, parametre değil. UZS'de
ekran 0 ondalık ama Payme/Uzum kabloda tiyin (×100) bekliyor, yani saklama sınırı zaten doğru yerde.
Profilde ayarlanabilir bir üs bırakmak, birinin onu değiştirip o **16 ×100 aynasını sessizce bozmasına**
davetiye olurdu. Ülkeden türeyen tek şey görüntüleme; saklama sınırı hiç ellenmiyor. Bu, korkulandan çok
daha küçük bir iş ve tasarımın en önemli kazancı.

**Taşma ayrı bir sorun ve gerçek.** `Product.price` gibi major birimi `Decimal(10, 2)`'de tutan 74 kolon
var; tavan 99.999.999,99 ve UZS'de bu yaklaşık 8.000 dolar. Ürün fiyatı oraya varmaz, ama **günlük ciro,
fatura toplamı ve sipariş tutarı varır** — yoğun bir kafenin bir günü rahatça 100M so'm eder. Toplam
tutan kolonlar `Decimal(14, 2)`'ye genişletilir (geri alınabilir migration).

### Katman 2 — Yetenek seçimi

Registry'ler zaten var; eksik olan **çağıranın oraya uğraması**.

Tek bir `CountryCapabilityResolver` kiracı id'sinden profili bulur ve sağlayıcı id'sini verir. Her çağıran
literal yerine bunu kullanır:

- `checkout-intent.service.ts:304` `createIntent("paytr", …)` → profilden gelen id
- `self-pay-intent.service.ts:52` ve `self-pay-recovery.service.ts:68` somut `PaytrAdapter` enjeksiyonunu
  bırakır, `PaymentProviderRegistry` üzerinden çözer
- `sms.service.ts:18` süreç-başına env seçimini bırakır, kiracı başına çözer
- Fiskal, e-belge ve ESC/POS dispatch'leri aynı şekilde

**Yeni ülke eklemenin maliyeti bu tasarımda:** Katman 1'e bir sabit satırı; Katman 2'ye **hiçbir şey**;
yalnızca gerçekten yeni olan rejimler için adapter. Üçüncü ülke ikincisinden ucuz olur — ölçüt buydu.

### Katman 3 — Dağıtım / veri yerleşimi

**Bu spec'in kapsamı dışında, ama karıştırılmaması için burada anılıyor.** Bir ülkenin kendi stack'i
gerekip gerekmediği (veri yerleşimi, gecikme, yerel partner) ayrı bir eksendir ve Katman 1-2 ile
ilgisizdir. Özbekistan'da biyometrik personel verisinin ülkede kalması bir dağıtım kararıdır.

Bugünkü engel kayda geçiriliyor: `env-validation.ts:62-66` prod açılışında PayTR kimlik bilgilerini
**koşulsuz** zorunlu tutuyor ve yoksa `process.exit(1)` yapıyor. PayTR'siz bir dağıtım bugün açılamaz.
Bu kural ülke koşullu hale gelmeli — P1'in parçası, çünkü UZ stack'i onsuz boot edemez.

## Bu spec'in kapsamı dışı

| Dilim | Neden ayrı |
|---|---|
| P3 UZ fiskal (OFD) + IKPU/MXIK alanı | Yeni rejim + veri iş kolu; tüzel kişilik bekler |
| P4 UZ ödeme (Payme/Click/Uzum) | Merchant hesabı bekler |
| P5 UZ e-fatura (ЭСФ) + E-IMZO imza kararı | Lisanslı operatör + imza mimarisi kararı bekler |
| P6 SMS/e-posta yerelleştirmesi | 24 şablon + 25 konu satırı; ayrı ve mekanik |
| P7 Dağıtım / veri yerleşimi | Altyapı ekseni |

**Kod dışı ana bağımlılık:** P3, P4, P5'in hiçbiri Özbekistan'da **yerel tüzel kişilik** olmadan
bitmez — EDS, KKM kaydı, merchant hesabı, alpha-name hepsi ona bağlı. P1+P2 bittiğinde kod hazır olur;
o kafe yasal fiş kesemez.

## Değişmeyecekler

Bunlar zaten doğru; dokunulmayacak ve regresyon testiyle korunacak:

- `TaxCalculationService`, `apportionDiscount`, combo apportionment, `prorate()`, `toIntCents`
- `useFormatCurrency` / `useLocale` boru hattı (yalnız seçici açılacak)
- Üç registry ve dört adapter arayüzü (yalnız çağıranlar yönlendirilecek)
- `generateInvoiceNumber` — zaten ülke-nötr
- **Türkiye davranışı**: P1+P2 sonunda TR kiracı için görünen hiçbir şey değişmemeli. Bu, kabul ölçütü.

## Test

| Ne | Nasıl |
|---|---|
| TR regresyonu | Mevcut süit yeşil kalmalı; ayrıca TR profiliyle vergi/telefon/biçim çıktılarının bit-aynı olduğunu pinleyen testler |
| Vergi tek kaynak | Dört aynanın da profilden okuduğu; `%12` girilebildiği; non-TRY'nin artık %0 vergilenmediği |
| Minor unit | UZS 0 ondalık gösterir ama ×100 saklar; tur gidiş-dönüş kaybı yok |
| Taşma | `Decimal(14,2)` migration'ının up→down→up turu; 100M so'm'luk toplamın saklandığı |
| Sağlayıcı seçimi | UZ profilli kiracının PayTR'ye **hiç** ulaşmadığı; üç kaçağın da kapandığı |
| Profil bütünlüğü | Her profilin adlandırdığı sağlayıcı id'sinin registry'de gerçekten var olduğu (aksi hâlde çalışma anında 404) |
| Boot | Prod açılışının PayTR'siz bir ülke profiliyle ayağa kalktığı |
