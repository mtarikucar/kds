# KDS Pazarlamacı Rehberi

> **Not (Phase-5 ayrışması):** Marketing/pazarlama paneli ve backend'i bu
> repodan ayrılarak bağımsız **kds-marketing** projesine taşındı. Bu rehber
> içerik olarak geçerlidir; kurulum/çalıştırma için kds-marketing reposuna,
> teknik ayrıntılar için `backend/docs/marketing-phase5-split-runbook.md`
> dosyasına bakın.

Bu döküman, KDS Restoran Yönetim Sistemi'ni sahaya çıkaran pazarlama ekibi içindir. Sistemi tanımak, sattığın aboneliklerden komisyon kazanmak ve müşteri portföyünü panelden takip etmek için referans olarak kullan.

---

## 1. KDS Nedir, Niye Satılır?

KDS, Türkiye'deki kafe ve restoranlar için tek bir hesapta:

- **POS** (kasa ve adisyon),
- **Mutfak ekranı (KDS)** — siparişin garson tabletinden mutfak ekranına anlık geçmesi,
- **QR menü ve self-pay** — müşteri masadan QR ile menüyü açar, sipariş verir, telefonundan öder,
- **Online rezervasyon** — herkese açık rezervasyon sayfası, masa tutma ve no-show takibi,
- **Stok ve reçete** — ürüne reçete bağla, satış stoktan otomatik düşsün,
- **Personel** — vardiya, mola, mesai,
- **Online sipariş entegrasyonları** — Yemeksepeti, Trendyol Yemek,
- **Çok şube** — tek panelden farklı lokasyonların raporları

bütününü sağlayan SaaS bir üründür. Müşteri PayTR üzerinden 14 günlük ücretsiz deneme ile başlar, otomatik aylık/yıllık yenilenir.

**Neden satması kolay?**

- Tek üründe POS + QR menü + rezervasyon + stok. Müşteri 3 farklı yazılım almak yerine tek faturayla halledir.
- 14 gün denemeli — riski sıfır.
- Türkçe arayüz, Türkiye'ye özel KDV split, PayTR'la entegre tahsilat.
- Aylık iptal — sözleşme zorunluluğu yok.

---

## 2. Planlar ve Fiyatlar

Aşağıdaki fiyatlar `subscription_plans` tablosundaki canlı kayıtlardır; superadmin değiştirmediği sürece bunlar geçerlidir.

| Plan | Aylık | Yıllık (2 ay bedava) | Trial | Hedef Profil |
|---|---:|---:|:---:|---|
| **Ücretsiz** (FREE) | ₺0 | ₺0 | — | Sadece deneme sonrası fallback; satılmaz |
| **Başlangıç** (BASIC) | ₺499 | ₺4 490 | 14 gün | 1–2 masalı kafe, küçük büfe |
| **Profesyonel** (PRO) | ₺1 299 | ₺12 990 | 14 gün | Şehir merkezi restoran, rezervasyon + delivery |
| **Kurumsal** (BUSINESS) | ₺2 999 | ₺29 990 | 14 gün | Çok şubeli zincir, sınırsız + API + öncelikli destek |

### Plan Karşılaştırma Tablosu

| Özellik | BASIC | PRO | BUSINESS |
|---|:---:|:---:|:---:|
| Kullanıcı sayısı | 5 | 15 | Sınırsız |
| Masa sayısı | 20 | 50 | Sınırsız |
| Ürün sayısı | 100 | 500 | Sınırsız |
| Aylık sipariş | 500 | 2 000 | Sınırsız |
| Stok takibi | ✓ | ✓ | ✓ |
| KDS mutfak ekranı | ✓ | ✓ | ✓ |
| Gelişmiş raporlar | — | ✓ | ✓ |
| Çok şube | — | ✓ | ✓ |
| Özel marka (logo/renk) | — | ✓ | ✓ |
| Rezervasyon sistemi | — | ✓ | ✓ |
| Personel takibi | — | ✓ | ✓ |
| Yemeksepeti/Trendyol | — | ✓ | ✓ |
| Öncelikli destek | — | ✓ | ✓ |
| API erişimi | — | — | ✓ |

### Satış Konuşmasında Plana Yön Verme

- **Müşteri "sadece kasa istiyorum" diyorsa** → BASIC, 14 gün dene, sonra ay başında upgrade'i öner.
- **Rezervasyon, motokurye, delivery uygulaması ile çalışıyorsa** → PRO. PRO'nun rezervasyon + delivery + personel modülleri kendi başına bir uygulamanın yerini tutar.
- **2+ şubesi var, zincirleşmiş** → BUSINESS. Çok şube tek panelde, API ile muhasebe / kendi mobil uygulaması ile entegrasyon, öncelikli destek.

---

## 3. Pazarlamacı Kazanç Modeli

### Komisyon Oranı

Her plan satışından plan'ın `commissionRate` değeri kadar komisyon kazanırsın. Varsayılan **%10**; superadmin yüksek-marjlı planlarda bunu artırabilir.

### Komisyon Tipleri (3'ü de senin cebine girer)

| Tip | Ne zaman? | Örnek (PRO aylık) |
|---|---|---:|
| **SIGNUP** | Müşteri ilk kez ücretli aboneliğe geçtiğinde | ₺1 299 × %10 = **₺129,90** |
| **RENEWAL** | Müşteri her ay/yıl yenilediğinde | ₺1 299 × %10 = **₺129,90** |
| **UPSELL** | Müşteri daha yüksek plana çıktığında | ₺2 999 × %10 = **₺299,90** |

**Kritik:** Komisyon **ömür boyu** akar. Müşteri 3 yıl boyunca PRO kalırsa, **36 ay × ₺129,90 = ₺4 676,40** kazanırsın — tek satıştan.

### Senaryolar

**1 ayda 5 PRO satıyorsun, hepsi yıllık seçiyor:**
- SIGNUP: 5 × ₺12 990 × %10 = **₺6 495** (ilk ay)
- 2. yıl yenilemeler aynı: **₺6 495** (12 ay sonra otomatik düşer)

**1 ayda 10 BASIC + 3 PRO + 1 BUSINESS aylık satarsan:**
- BASIC: 10 × ₺49,90 = ₺499
- PRO: 3 × ₺129,90 = ₺389,70
- BUSINESS: 1 × ₺299,90 = ₺299,90
- **Toplam ilk ay: ₺1 188,60 + her ay aynısı yenilemeden tekrar**

Bir müşteri PRO → BUSINESS'a geçerse: ₺299,90 UPSELL + sonraki yenilemeler ₺299,90 olur (PRO'dan ₺129,90 değil).

### Komisyon Onay Akışı

```
SIGNUP olur (PENDING)
   ↓
Manager paneline düşer, gözden geçirir
   ↓
APPROVED (manager onay) — kazancın muhasebe için kesinleşir
   ↓
PAID (manager ödedi işaretler) — hesabına yatırıldı
```

Her durum değişikliği audit log'a düşer ("kim, ne zaman, hangi tutarla onayladı"). Detay panelinde tüm geçmişi görürsün.

---

## 4. Referans Kodu Sistemi (Self-Serve Satış)

Her pazarlamacının panelinde **kişisel referans kodu** vardır (örn. `MRT9X3K`). Bu kodla:

### A. Link Paylaşımı (En Hızlı Yol)

Pazarlamacı paneli → Dashboard → ReferralCodeCard üzerinden:

- **Kodu kopyala**: `MRT9X3K`
- **Linki kopyala**: `https://kds.app/?ref=MRT9X3K`

Linki WhatsApp grubuna, Instagram bio'na, e-postaya, kartvizite koy. Müşteri tıkladığında kod 30 gün boyunca tarayıcısında tutulur. Daha sonra kayıt olup ödeme yaparsa otomatik sana yazılır.

### B. Manuel Kod (Tanıdıktan Tanıdığa)

Müşteri checkout sayfasına geldiğinde "Pazarlamacı kodu (opsiyonel)" alanına kodunu girer. Cookie ile gelmemişse bu yedek yoldur.

### Akış (Arka Planda Ne Oluyor?)

1. Müşteri `?ref=MRT9X3K` ile gelir → cookie set edilir.
2. Müşteri 14 günlük trial alır → arka planda sana **otomatik bir Lead** yaratılır (kaynak: REFERRAL, durum: WON).
3. Müşteri trial bitince ilk ödemeyi yapar → **SIGNUP commission** (PENDING) yazılır + sana bildirim gelir.
4. Müşteri yenileme yaptıkça → her seferinde **RENEWAL commission**.
5. Müşteri plan yükseltirse → **UPSELL commission**.

**Yanlış / geçersiz kod ne olur?** Sessizce yok sayılır. Müşterinin checkout'u bloklanmaz, sen de boş bir kayıt almamış olursun. Riziko sıfır.

**Müşteri yöneticinin elle dönüştürdüğü bir lead'e zaten sahipse?** Yönetici ataması her zaman kazanır — kodun yarış koşulunda overwrite edilmez.

---

## 5. Pazarlamacı Paneli Turu (`/marketing`)

| Sayfa | Ne yapar? |
|---|---|
| **Dashboard** | Lead sayıları, dönüşüm oranı, aylık özet, referans kodun, lifetime komisyon toplamı |
| **Leads** | CRM — soğuk arama listesi, durum pipeline'ı (NEW → CONTACTED → ... → WON/LOST) |
| **Lead Detail** | Tek müşterinin geçmişi: aramalar, ziyaretler, gönderilen teklifler, açık görevler |
| **Tasks** | "Şu müşteriyi cuma ara" gibi görevler — vadesi gelince hatırlatılır |
| **Calendar** | Görevlerin aylık görünümü |
| **Offers** | Lead'e özel fiyat / trial gün uzatma teklifi gönder |
| **Commissions** | Tüm komisyon hareketleri — tip, durum, periyot, detay modal |
| **Reports** | Lead kaynak dağılımı, bölgesel performans, conversion funnel (yöneticiye özel) |

### Commission Detay Modal'da Ne Var?

Komisyon listesinde bir satıra tıkladığında:

- **Tutar** (büyük, vurgulu)
- **Tip + Durum** badge'leri
- **Müşteri** (tenant adı + subdomain)
- **Plan** (commissionRate ile birlikte: PRO %10)
- **Periyot** (2026-05)
- **Hesaplama**: `Ödenen ₺1 299 × %10 = ₺129,90`
- **Bağlı Lead** (kaynağı ve dönüşüm tarihi)
- **Audit Log Timeline**: "Oluşturuldu → Manager X tarafından onaylandı → Manager Y tarafından ödendi"

---

## 6. Sahaya Çıkış Stratejisi

### Hedef Müşteri Profili Önceliği

1. **Yeni açılan kafe/restoran** — POS henüz yok, ihtiyaç akut. En kısa satış döngüsü.
2. **Eski POS'tan şikayetçi olan işletme** — özellikle Adisyon/Sterm gibi yıllardır güncellenmeyen sistemlerden geçenler.
3. **QR menü kullanmayan restoran** — pandemi sonrası eksik kalmış işletme.
4. **2+ şube açmak isteyen** — BUSINESS'ın çok-şube modülü ile direkt eşleşir.

### Satış Argümanları (Soğuk Aramada İlk 30 Saniye)

- "Tek hesapta hem kasa, hem mutfak ekranı, hem QR menü çalışıyor — Yemeksepeti'yle de entegre."
- "14 gün ücretsiz deneyebilirsiniz, kart bilgisi istemiyoruz."
- "Aylık ₺499'dan başlıyor. İstediğiniz an iptal edebilirsiniz."
- "Türkçe arayüz, KDV split otomatik, e-fatura entegrasyonu var."

### Beklenmedik İtirazlar İçin Cevaplar

- **"Adisyon yazılımım var, değiştirmek istemem"** → 14 gün deneme süresince mevcudunuzu kapatmıyoruz. Test edin, beğenmezseniz hiçbir ücret çıkmaz.
- **"Çok pahalı"** → BASIC ₺499/ay. Yıllık alırsanız 2 ay bedava — pratikte ₺374/ay'a denk geliyor.
- **"İnternet keserse?"** → POS offline-first çalışır, internet gelince senkronize olur.
- **"Personelim Türkçe konuşmuyor"** → Uygulama TR/EN/RU/UZ/AR dilinde.

---

## 7. CRM Disiplinleri

### Lead Pipeline'ı (Durum Geçişleri)

```
NEW → CONTACTED → MEETING_DONE → DEMO_SCHEDULED → OFFER_SENT → WAITING → WON
                                                                       ↘ LOST
```

- Her temas (telefon, ziyaret, WhatsApp) **mutlaka** Activity olarak kaydedilir. "Hatırımda" sayılmaz.
- Teklif gönderdiyseniz Offer kaydı açılır + `validUntil` belirleyin. Sistem 30 dakikada bir vadesi geçenleri otomatik EXPIRED'a düşürür.
- Görev (Task) atadığınız zaman bir dueDate vermek zorunludur — vadesi yaklaştığında size bildirim gider.

### "Lead'i kaybettim" demeden önce

- En az 3 farklı kanaldan (telefon + WhatsApp + e-posta) iletişim denenmemişse LOST'a atmayın.
- LOST'a atarken `lostReason` zorunlu (örn: `no_budget`, `competitor_chosen`, `closed_business`, `not_reachable`). Bu veri sonraki ay'ın funnel raporunda görünür.

### Yöneticinin Beklediği

- Haftalık takip: kaç yeni lead, kaç dönüştürüldü, kaç komisyon onayda
- Aylık plan: hedef satış sayısı (hangi planı, hangi şehirde)
- Geri besleme: iptal eden müşterinin nedeni (refund/cancellation reason)

---

## 8. Sıkça Sorulan Sorular

**S: Komisyonum ne zaman hesabıma yatıyor?**
A: SIGNUP/RENEWAL/UPSELL oluştuğunda **PENDING** olarak panelinde görünür. Manager APPROVED'a aldıktan sonra muhasebe sürecine girer. PAID olduğunda hesabınıza yatmıştır. Tipik olarak ay sonunda toplu ödeme yapılır.

**S: Referans kodum sızdırılırsa ne olur?**
A: Manager panelinden "Kodumu yenile" diyebilirsiniz. Eski kod ölür, yeni kod aktif olur. Eski linkle gelen yeni kayıtlar çözülmez ama eski satışlarınızdan komisyon akmaya devam eder (link kişiye değil, kayda bağlı).

**S: Müşteri trial'da iptal ederse komisyon kazanırım mı?**
A: Hayır. Komisyon ilk **gerçek ödeme** ile yazılır. Trial sırasında müşteri kart vermez, ödeme olmaz.

**S: Müşteri kart bilgilerini değiştirip benim kodumu silmiyorsa kendi başına ne yapacak?**
A: Müşterinin checkout'unda kod alanı vardır — istediği zaman değiştirebilir/silebilir. Ama girdiği kod **ödeme anında** snapshot olarak kayda alınır. Sonradan müşteri kod değiştirse de ilk satışın komisyonu sizde kalır.

**S: Müşterim BUSINESS'tan PRO'ya düştü, ne olur?**
A: Bu downgrade'dir — UPSELL değil. Yeni komisyon yazılmaz. Bir sonraki yenilemeden itibaren PRO oranında (₺1 299 × %10 = ₺129,90) komisyon alırsınız (daha önce ₺299,90 alıyordunuz).

**S: Yöneticim olmadan kendim onay yapabilir miyim?**
A: Hayır. SIGNUP/RENEWAL/UPSELL otomatik olarak PENDING düşer; APPROVE ve MARK_PAID aksiyonları sadece manager rolündedir. Şeffaflık ve denetim için.

**S: Aynı müşterinin tekrar kayıtlanmasını engelliyor musunuz?**
A: Evet — `Lead.convertedTenantId` unique. Aynı tenant'a ikinci bir Lead bağlanmaz. Müşteri eski hesabını silip yenisini açarsa farklı bir tenant olur — kim ilk getirirse o alır.

**S: Komisyon kaybetmemek için ne yapayım?**
A: Üç şey:
1. Müşteriye **link** ver — kod yazmayı unutabilir.
2. Müşteri **trial'a başladığını** sana doğrula (panel'de yeni lead göründü mü?). Görünmediyse, kod kayboldu demektir — manuel attach için manager'a yaz.
3. Müşterinin profil mailini doğruladığından emin ol — doğrulanmamışsa ödeme yapamaz.

---

## 9. İlk Hafta Yapılacaklar

- [ ] **Gün 1**: Pazarlamacı paneline gir, kişisel referans kodunu öğren ve link'ini hazır tut. WhatsApp durumuna, Instagram bio'ya koy.
- [ ] **Gün 1**: Demo restoran hesabıyla gir (`marketing@e2e.local`), sistemi göz at. Bir abone gibi POS akışını tıkla.
- [ ] **Gün 2**: Çevrenden 5 kişiye/işletmeye demo yap. Bu pratik turu sahaya hazırlık.
- [ ] **Gün 3–5**: Mahallenizdeki yeni açılan/küçük 10 işletmeyi listele. CRM'e Lead olarak gir.
- [ ] **Gün 5**: İlk 3 ziyaret/aramayı yap, Activity olarak panele kaydet.
- [ ] **Hafta sonu**: Yöneticinle 15 dakikalık görüşme — pipeline'ı birlikte gözden geçirin.

**İlk ay hedefi:** En az **1 ücretli abonelik** (BASIC veya üzeri). Trial'a alıp ay sonunda ödemeye dönen müşteri = senin SIGNUP komisyonun + her ay yenilemeden gelen RENEWAL.

---

## 10. Acil Durum / Destek

- **Pazarlamacı paneline erişemiyorum** → manager'a yaz, parola sıfırlatsın
- **Müşterim ödeme yapamıyor (PayTR hatası)** → ekran görüntüsü + hata kodu ile manager'a ulaş, billing ekibi inceler
- **Komisyon yanlış hesaplanmış görünüyor** → komisyon detay modal'ından hesaplamayı kontrol et (`Ödenen × Oran`). Hâlâ uyuşmuyorsa, manager'a `commissionId` ile yaz
- **Referans kodum çalışmıyor** → müşteri linki açtığında DevTools → Application → Cookies → `kds_ref` değeri kodunu içermeli. Yoksa cookie tarayıcı tarafından bloklanmış olabilir; müşteriden manuel kod girmesini iste

---

*Bu döküman canlı bir referanstır. Komisyon oranları, plan fiyatları veya akışları değiştiğinde manager güncelleyecektir. Son güncelleme: 2026-05-20.*
