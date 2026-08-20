# Yasal metin redline'ı — à-la-carte geçişi

**Durum:** TASLAK ANALİZ — hukuki inceleme ve onay gerekir. Bu belge tek başına yürürlüğe konulamaz.
**Hazırlanma tarihi:** 14 Ağustos 2026
**Konu:** 11 Ağustos 2026'da yürürlüğe giren ücretsiz çekirdek + à-la-carte yıllık lisans modelinin,
yürürlükteki v2.0 yasal metinlerine yansıtılmamış olması.

---

## 0. Neden acil

`backend/prisma/seeds/legal/distance-sales.tr.md` ve `refund-policy.tr.md` **v2.0, yürürlük tarihi
22 Mayıs 2026** ve checkout akışında müşteriye **onaylatılıyor**. Ticari model 11 Ağustos 2026'da
değişti (`20260811120000_free_core`, `20260811100000_alacarte_catalog`,
`20260811140000_retire_subscription_rail`). Yani müşteriler, **artık var olmayan bir hizmetin**
sözleşmesini kabul ediyor.

En ağır madde: **Mesafeli Satış Sözleşmesi §3.3**, aboneliğin "otomatik olarak yenilendiğini" ve
Üye'nin "otomatik yenilemeyi iptal edebileceğini" söylüyor. Gerçekte otomatik yenileme **yok**;
kayıtlı kart yok, otomatik tahsilat yok. Yenileme manuel
(`backend/src/modules/licensing/renewal-cycle.service.ts`). Sözleşme, tüketiciye gerçekleşmeyecek
bir tahsilat taahhüt ediyor ve olmayan bir iptal mekanizmasına yönlendiriyor.

**v2.0 metinleri DEĞİŞTİRİLMEMELİDİR.** Müşteriler o metni kabul etti; kabul kaydının karşılığı
olan metin geri alınabilir kalmalı. Doğru yol yeni bir **v3.0** yayımlamaktır
(`LegalAdminController`, SuperAdmin yayın yolu — `backend/src/modules/legal/legal.module.ts`).

---

## 1. Gerçek model (metinlerin dayanması gereken olgular)

| Konu | Gerçek | Kanıt |
|---|---|---|
| Çekirdek | POS, adisyon, KDS, menü, masa/kat planı, QR menü, sipariş, kasa, temel raporlar, ekip/rol, müşteriler, cihaz/şube paneli, özel marka+alan adı — **süresiz ücretsiz**, kullanıcı/masa/ürün/kategori/aylık sipariş **sınırsız**, ilk şube ücretsiz | `entitlements/free-baseline.const.ts` |
| Deneme süresi | **Yok.** Ücretsizlik kalıcı olduğu için deneme kavramı ortadan kalktı | — |
| Plan/kademe | **Yok.** Ürünler tek tek satın alınır | `marketplace/alacarte-catalog.const.ts` |
| Bakım, Destek ve Güncelleme (eski adı "Lisans") | 4.900₺/yıl; ücretli modülleri hem **satın almanın** hem **kullanmanın** ön koşulu. Öncelikli destek, e-Fatura gönderimi, tüm sürüm güncellemeleri ve günlük yedekleme bu kalemin içindedir (v3.6.7) | `checkout/addon-purchasability.rules.ts`, `entitlements/plan-projector.service.ts` |
| Faturalama dönemi | **Yalnızca yıllık** ve tek seferlik. Aylık dönem yok | katalogdaki `billing: "annual" \| "oneTime"` |
| Orantılama | Bakım, Destek ve Güncelleme alım günü değişmez yıl dönümü; yıl içi alımlar kalan güne orantılı; yıl dönümüne <14 gün kalmışsa sonraki döngüye taşınır; satır alt sınırı 1₺ | `licensing/anniversary.ts` |
| Yenileme | **Manuel.** Otomatik tahsilat yok, kayıtlı kart yok. Hatırlatma 30/7/1 gün kala | `licensing/renewal-cycle.service.ts`, `renewal-scheduler.service.ts` |
| Ödenmezse | 7 gün ek süre; sonra yalnızca **erişim** kararır, **veri silinmez**; ödenince aynen geri açılır | `marketplace/tenant-addon-sweeper.service.ts` |
| Ödeme | PayTR, yalnız TRY | `payments/adapters/paytr.adapter.ts` |
| KDV | Fiyatlar KDV **dahil**; faturada içeriden ayrıştırılır | `checkout/quote.service.ts` |
| Kontör | Tek seferlik, **süresi dolmaz**, tükenene kadar geçerli; başarısız üretim düşülmez | katalog `kind: "credit"` |
| Donanım kiralama | **Kapatıldı** (Temmuz 2026) | `rentalMonthlyCents` NULL |

---

## 2. Mesafeli Satış Sözleşmesi — madde madde

| Madde | Mevcut metin (v2.0) | Sorun | Önerilen v3.0 yönü |
|---|---|---|---|
| Başlık | "(Abonelik Hizmet Sözleşmesi)" | Abonelik değil | "(Yazılım Lisans ve Hizmet Sözleşmesi)" |
| §1.2 | "abonelik talebinde bulunan" | Ücretsiz çekirdek için talep/ödeme yok | "hesap oluşturan veya ücretli ürün satın alan" |
| §2 | "Hizmet kapsamı, Üye'nin seçtiği **abonelik planına** göre değişir" + "Stok takibi (planın kapsamına göre)", "Çalışan yönetimi (planın kapsamına göre)" | Plan yok; stok ve personel ayrı **ücretli modül** | Kapsamı ikiye ayır: (a) ücretsiz çekirdek — madde madde say; (b) satın alınan modül/entegrasyon/kapasite |
| **§3.1** | "abonelik bedelini ödeyip Hizmet'i kullanmaya başladığı tarihte yürürlüğe girer" | Çekirdek için ödeme yok; sözleşme ödemeden önce başlıyor | Çekirdek için hesap açılışında, ücretli kısım için lisans satın alımında yürürlük |
| **§3.2** | "aylık veya yıllık olarak belirlenir" | Aylık dönem yok | "Ücretli kalemler yıllıktır; kontör ve hizmetler tek seferliktir. Ücretsiz çekirdek süresizdir." |
| **§3.3** | "**otomatik olarak yenilenir**… Üye otomatik yenilemeyi iptal edebilir" | **YANLIŞ.** Otomatik yenileme yok, kayıtlı kart yok | "Yenileme otomatik değildir. Yıl dönümünden 30, 7 ve 1 gün önce hatırlatma gönderilir; yenileme ancak Üye'nin yeni bir ödeme yapmasıyla gerçekleşir. Ödeme yapılmazsa 7 günlük ek sürenin ardından ücretli modüllerin erişimi durur; **Üye verisi silinmez**." |
| §3.4 | "Otomatik yenileme sırasında ücret değişirse 30 gün önce bildirilir" | Otomatik yenileme yok; ama fiyat dondurma gerçeği var | "Yenileme sepeti yıl dönümünden 30 gün önce oluşturulur ve fiyat o anda **dondurulur**; sonraki katalog değişiklikleri o yenilemeye yansımaz." |
| §4.1 | "seçilen abonelik planına göre" | Plan yok | "satın alınan kalemlere göre"; KDV dahil ifadesi korunur (doğru) |
| §4.2 | PayTR, kart saklanmaz | **Doğru** — ayrıca "kayıtlı kart yoktur" vurgusu eklenmeli | Koru + güçlendir |
| §4.3 | Ödeme yapılmazsa 7 gün süre, sonra askıya alma/fesih | Süre doğru; ama "veri silinmez" ve "erişim kararır" ayrımı yok | 7 gün ek süre + erişimin durması, verinin korunması, ödeme sonrası geri açılma |
| §5.2 | Kesintide "abonelik uzatılır" | Abonelik yok | "etkilenen ücretli kalemlerin yetki süresi uzatılır" |
| **YENİ** | — | Sözleşme **fiziksel donanım satışını hiç kapsamıyor** | Aşağıda §4 |
| **YENİ** | — | Ücretsiz çekirdeğin hukuki statüsü tanımsız (bedelsiz hizmet, ayıp/SLA rejimi?) | Ayrı madde |

---

## 3. İade Politikası — madde madde

| Madde | Mevcut metin (v2.0) | Sorun | Önerilen v3.0 yönü |
|---|---|---|---|
| §1 | "abonelik bazlı bulut yazılım hizmetleri" | Abonelik değil | "ücretsiz çekirdek + satın alınan yıllık lisans, modül, kapasite, kontör ve hizmetler" |
| **§3 (tamamı)** | "Deneme Süresi (Trial)… genellikle 14 gün… otomatik geçiş" | **Deneme yok, otomatik geçiş yok** | Bölümü kaldır; yerine "Ücretsiz çekirdek — süresiz, bedelsiz, iade konusu değildir" |
| §4.3 | 7 gün gerekçesiz tam iade (iyi niyet) | Korunabilir, ama "abonelik başlangıcı" yerine "ödeme tarihi" | Koru, dili kaleme göre yaz |
| §4.4 | "yenileme, **plan yükseltme**" | Plan yükseltme yok | "yenileme veya ek modül alımı" |
| **§5 (tamamı)** | "**Aylık Abonelik** İadeleri" + §5.2 "Otomatik yenileme… iptal edilirse" | **Aylık abonelik ve otomatik yenileme yok** | Bölümü kaldır. Yerine: "Yenileme manuel olduğu için, yenilemek istemeyen Üye'nin herhangi bir işlem yapmasına gerek yoktur; tahsilat gerçekleşmez." |
| §6.1 | Yıllık: ilk 30 gün tam iade | **Korunabilir ve modele uygun** | Koru |
| **§6.2** | Orantısal iade örneği "**aylık plan fiyatı** üzerinden" (12.000₺ yıllık / 1.200₺ aylık) | Aylık fiyat diye bir şey yok; örnek hesaplanamaz | Orantıyı **gün bazlı** yeniden kur ve örneği gerçek katalog kalemiyle ver (ör. Stok & Maliyet 3.900₺/yıl) |
| §6.3 | 6 ay sonrası iade yok | Korunabilir | Koru |
| **§7 (tamamı)** | "Plan Değişiklikleri — yükseltme/düşürme" | Plan yok | Bölümü kaldır. Yerine: "Modül ekleme — yıl dönümüne orantılı ücretlendirilir. Kapasite azaltma — yalnızca yenilemede geçerli olur, dönem içi iade yapılmaz." |
| §8 | "Madde 6.3'te belirtilen süreler" | §6.3 atfı iade **yapılmayan** hali gösteriyor, döngüsel | Atfı düzelt |
| §9.2 | "**Aylık planda** 24 saati, yıllık planda 72 saati aşan kesintiler" | Aylık plan yok | Yalnız yıllık eşik bırak |
| §10 | "abonelik kimliğiniz" | Abonelik yok | "sipariş/fatura numaranız" |
| **YENİ** | — | **Kontör iadesi düzenlenmemiş** (tek seferlik, süresiz, kısmen tüketilmiş olabilir) | Ayrı madde: kullanılmamış kontör iadesi koşulları |
| **YENİ** | — | **Tek seferlik hizmet** (Yerinde Kurulum 7.500₺) iadesi düzenlenmemiş | Ayrı madde: ifa edilmiş hizmette cayma |
| **YENİ** | — | **Fiziksel donanım** iadesi hiç yok | Aşağıda §4 |

---

## 4. En büyük boşluk: fiziksel donanım

Şirket donanım satıyor (yazarkasa/YN ÖKC, termal yazıcı, KDS ekranı, tablet, barkod okuyucu,
para çekmecesi, HummyBox) ve donanımlı sepete **50₺ sabit kargo** uyguluyor. Buna karşılık:

- Mesafeli Satış Sözleşmesi baştan sona **yazılım aboneliği** için yazılmış; teslimat, kargo,
  hasarlı/ayıplı ürün, garanti ve iade gönderimi düzenlenmemiş.
- İade Politikası'nın cayma hakkı istisnası (§4.2), Mesafeli Sözleşmeler Yönetmeliği m.15(1)(ğ)
  **dijital içerik** istisnasına dayanıyor. **Bu istisna fiziksel mala uygulanamaz.** Fiziksel
  üründe tüketicinin **14 günlük cayma hakkı** kural olarak vardır.
- Sonuç: donanım alan tüketiciye, hukuken sahip olduğu cayma hakkının bulunmadığı izlenimi veren
  bir metin onaylatılıyor olabilir.

**Öneri:** donanım satışı için ayrı bir mesafeli satış sözleşmesi ya da mevcut sözleşmede ayrı bir
bölüm; teslim süresi, kargo, ayıplı mal, garanti süresi (katalogda ürün başına `warrantyMonths`
alanı mevcut) ve 14 günlük cayma hakkı açıkça yazılmalı.

---

## 5. Yapılması gerekenler

1. **Hukuki inceleme** — bu belge bir avukat tarafından değerlendirilmeli. Özellikle §4 (donanım /
   cayma hakkı) bir uyum riski olarak ele alınmalı.
2. **v3.0 metinleri** yazılıp `LegalAdminController` üzerinden yayımlanmalı. v2.0 **silinmemeli**;
   kabul kayıtlarıyla birlikte erişilebilir kalmalı.
3. **Geçiş bildirimi** — v2.0'ı kabul etmiş mevcut Üye'lere, İade Politikası §13 uyarınca önemli
   değişiklik bildirimi (en az 30 gün önce, e-posta).
4. **Checkout kontrolü** — yeni sürüm yayımlanana kadar, ödeme ekranında gösterilen özet metnin
   otomatik yenileme vaadi içermediği doğrulanmalı.

---

*Bu belge kod tabanındaki olgulardan üretilmiştir; hukuki görüş değildir.*
