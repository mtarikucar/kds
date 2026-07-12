# Dış Talep Taslakları (Checklist #12, #18–19, #21–25)

> Bu maddeler **kodla kapanmaz** — sözleşme, resmi kayıt, SDK/NDA gerektirir.
> Aşağıdaki taslakları doldurup ( `[…]` alanları ) ilgili yere **sen** gönder.
> Ben senin adına e-posta/başvuru göndermem. Güncelleme: 2026-07-12

İçindekiler:
- [#12 — PayTR "Kart Saklama / Tekrarlayan Ödeme" yetki talebi](#12)
- [#21 / #24 — Token/Paygo GMP-3 (mevcut taslağa bağlantı)](#2124)
- [#22 — Hugin yazarkasa SDK / seri protokol talebi](#22)
- [#23 — Beko/Token yazarkasa SDK talebi](#23)
- [#25 — GİB-yetkili ÖKC bayi anlaşması sorusu](#25)
- [#18–19 — GİB e-Arşiv / e-Fatura kayıt runbook](#1819)

---

<a name="12"></a>
## #12 — PayTR "Kart Saklama / Tekrarlayan Ödeme" yetki talebi

**Neden:** Abonelik yenilemeleri şu an **manuel** (kart saklanmıyor; süre bitince
PAST_DUE + e-posta ile yeniden satın alma). Otomatik yenileme için PayTR'nin
**Kart Saklama / Tekrarlayan Ödeme (utoken)** yetkisi gerekiyor. Yetki açılınca
kod tarafı hazır: adaptörde `chargeRecurring` + `cancelRecurringToken` +
`recurring-payment` imza üreticileri mevcut (yalnızca token yakalama + cron job
eklenecek — bkz. `paytr.adapter.ts`).

**Kime:** PayTR Üye İşyeri / Entegrasyon destek (destek@paytr.com veya panel →
Destek Talebi)
**Konu:** [Mağaza No] — Kart Saklama / Tekrarlayan Ödeme (utoken) yetkisi talebi

```
Merhaba,

[Firma adı] — PayTR Mağaza No: [mağaza no] hesabımız için SaaS abonelik
yenilemelerini otomatikleştirmek üzere Kart Saklama / Tekrarlayan Ödeme
(recurring / utoken) yetkisinin açılmasını talep ediyoruz.

Kullanım senaryomuz: Kullanıcı ilk abonelik ödemesini iFrame API ile yapıyor;
onayıyla kartını saklayıp (utoken) her dönem sonunda aynı tutarı tekrarlayan
ödeme API'si ile çekmek istiyoruz. İşlem tutarı ve para birimi sabittir; kullanıcı
istediğinde iptal edebilir (token iptali).

Lütfen bildirin:
1. Hesabımızda Kart Saklama / Tekrarlayan Ödeme yetkisi nasıl aktifleştirilir,
   ek sözleşme/onay gerekiyor mu?
2. get-token çağrısında kart saklama için gönderilecek parametreler
   (store_card / recurring_payment vb.) ve bildirim (callback) yanıtında utoken
   hangi alanda döner?
3. recurring-payment ve recurring-payment-cancel uç noktaları için güncel
   dokümantasyon + test (sandbox) ortamı.

Teşekkürler,
[Ad Soyad] — [Firma] — [telefon] — [e-posta]
```

---

<a name="2124"></a>
## #21 / #24 — Token/Paygo GMP-3 (SDK + SP630PRO test ünitesi + TSM firma kodu)

Taslak **zaten hazır**: `docs/integrations/paygo-token-request-email.md`
(iş-ortaklığı başvurusu; SDK + mesaj-eşleme dokümanı, sertifikalı test cihazı,
TSM firma kodu, PÖKC sertifika zinciri, yazılı eşleştirme yetkisini ister).
Onboarding runbook: `docs/integrations/paygo-token-gmp3-onboarding.md`.
→ `[…]` alanlarını doldurup gönder.

---

<a name="22"></a>
## #22 — Hugin yazarkasa SDK / seri protokol talebi (NDA'lı)

**Kime:** Hugin Yeni Nesil ÖKC — entegrasyon/iş-ortaklığı birimi (bayi üzerinden
de yönlendirilebilir)
**Konu:** [Firma] — Hugin YN ÖKC (Tiger T300 vb.) yazılım entegrasyonu / SDK talebi

```
Merhaba,

[Firma adı] olarak restoran/işletme POS-adisyon yazılımı geliştiriyoruz.
Yazılımımızı Hugin Yeni Nesil ÖKC cihazlarıyla (ör. Tiger T300) entegre edip
adisyondan başlatılan satışı cihaz üzerinden mali fiş olarak tamamlamak
istiyoruz.

Talebimiz:
1. GMP-3 uyumlu seri/ECR protokol dokümanı veya entegrasyon SDK'sı (gerekiyorsa
   NDA ile),
2. Test için sertifikalı bir cihaz/emülatör ve varsa TSM/pairing süreci,
3. Entegrasyon iş-ortaklığı / bayi yönlendirmesi.

Cihaz mimarimiz: bulut backend → yerel köprü (on-prem bridge) → cihaz (GMP-3).
Detaylı teknik soru listesini paylaşabiliriz.

[Ad Soyad] — [Firma] — [telefon] — [e-posta]
```

---

<a name="23"></a>
## #23 — Beko/Token yazarkasa SDK talebi (NDA'lı)

`#22` ile aynı gövde; "Hugin (Tiger T300)" yerine **"Beko 300TR"** yaz ve Beko
Yeni Nesil ÖKC entegrasyon birimine gönder. (Beko cihazlarının fintech tarafı
sıklıkla **Token** olduğundan, `#21` Token/Paygo başvurusu bu kalemi de kısmen
karşılayabilir — önce onu netleştir.)

---

<a name="25"></a>
## #25 — GİB-yetkili ÖKC bayi anlaşması

**Amaç:** YN ÖKC satışı/aktivasyonu GİB-yetkili bayi üzerinden yürür. Yukarıdaki
vendor görüşmelerinde şunu sor:

```
- Bölgemizde [il/ilçe] GİB-yetkili YN ÖKC bayiniz kim?
- Yazılım firması olarak entegrasyon iş ortaklığı + cihaz tedarik/aktivasyon
  için bayi anlaşması şartlarınız neler?
- Cihaz aktivasyonu (GİB YN ÖKC kaydı, #26) sizin tarafınızda mı yapılıyor?
```

---

<a name="1819"></a>
## #18–19 — GİB e-Arşiv / e-Fatura kayıt runbook

> ⚠ Seçilen özel entegratör **Nilvera** (kodda primary — PR #298; Foriba/Sovos
> yedek). Entegratör genelde bu başvuruları **senin adına** yapar. Önce sor:
> "e-Arşiv/e-Fatura mükellefiyet başvurusunu + mali mühür sealing'i siz mi
> yürütüyorsunuz?" Evet ise aşağıdaki adımların çoğunu entegratör halleder.

**#18 e-Arşiv (B2C — ilk ihtiyaç):**
1. GİB İnteraktif Vergi Dairesi / e-Arşiv portalına giriş (mali mühür veya
   e-imza ile).
2. e-Arşiv Fatura başvurusu → özel entegratör = **Nilvera** olarak beyan.
3. Onay sonrası entegratör senin adına e-Arşiv fatura keser (B2C tüm perakende).

**#19 e-Fatura mükellefiyeti (B2B):**
1. GİB e-Fatura portalı → mükellef başvurusu → entegratör = **Nilvera**.
2. Onay sonrası VKN'li kurumsal alıcılara e-Fatura kesilir; mükellef olmayan
   alıcı e-Arşiv'e düşer (yönlendirme kodda Nilvera'nın `GlobalCompany/Check`
   ucuyla otomatik).

**Ön koşul:** #17 **mali mühür** (TÜBİTAK KamuSM) — hem başvuru hem imzalama için
gerekli. Sipariş: kamusm.gov.tr → Mali Mühür Başvurusu (tüzel kişi bilgilerini
[firma / VKN] kendi kayıtlarından gir).
