# HummyTummy — Kapsamlı Ana Sayfa + Modül Alt Sayfaları (Landing Hub)

**Tarih:** 2026-07-07
**Durum:** Onaylandı (tasarım) — uygulama planı bekliyor
**Kapsam kararı:** Ana sayfa + 8 modül alt sayfası + fiyat sayfası, **2 fazda**
**Dil:** Türkçe (mevcut `LandingPage.tsx` deseniyle tutarlı, hard-coded TR)

---

## 1. Amaç ve Bağlam

`frontend/public/` içine son commit'te (PR #274, `fd7e87c1`) **22 markalı voxel/LEGO 3D illüstrasyon** eklendi (krem `#faf6f0` + turuncu `#f97316` paleti, tekrar eden şef maskotu). Mevcut `/` ana sayfası (`frontend/src/pages/LandingPage.tsx`) marka renkleriyle uyumlu ama bu görsellerin **hiçbirini** kullanmıyor (sadece CSS mock + lucide ikonlar).

**Hedef:** adisyo.com gibi **kapsamlı, detaylı, bilgi verici** — ama "düz AI yapımı" gibi durmayan — bir ana sayfa; verilen görselleri kullanan; ve adisyo'nun **hub-and-spoke** modelini (kapsamlı ana sayfa + gerçek derinlikli modül alt sayfaları) izleyen bir yapı.

**Anti-"AI-thin" stratejisi (adisyo araştırmasından):** Sayfayı "dolu" gösteren şey tek uzun scroll değil, **gerçek, linklenebilir alt sayfa yoğunluğu** + her bölümde CTA + fayda-odaklı başlıklar + somut/gerçek ürün görselleri + esaslı SSS'lerdir.

---

## 2. Görsel Varlık Envanteri (GERÇEK içeriğe göre — dosya adları YANILTICI)

> **KRİTİK:** 22 görselden 14'ünün dosya adı içeriğiyle uyuşmuyor. Görseller **her zaman gerçek içeriğe göre** seçilecek, dosya adına göre DEĞİL.

**Kullanılacak — sahne arka planlı (çerçeveli/eğik kartta göster, cutout yapma):**
- `HummyTummy_Tatli_Menu_Cikolata.png` → **Tablet sipariş UI** (gerçek TR arayüz: Öne Çıkanlar, ₺520 sepet, "Siparişi Tamamla") + maskot. → Hero + QR/Sipariş
- `HummyTummy_Dijital_Menu_Yonetimi.png` → **POS terminali** menü grid + pinpad + kart okuyucu. → POS/Ödeme
- `HummyTummy_Premium_Guvenlik_Kalkan.png` → **QR menü masa standı** (masada, restoran). → QR Menü
- `HummyTummy_Restoran_Ic_Mekan.png` → **Şef + KDS ekranı** (okunaklı TR: #1028 Burger HAZIR / #1029 Pizza HAZIRLANIYOR). → KDS (en iyi KDS görseli)
- `HummyTummy_Fatura_Odeme_Sistemi.png` → **Şef pişiriyor + KDS panosu**. → KDS ikincil
- `HummyTummy_Rapor_Dokuman_Analiz.png` → **Şef POS terminalinde**. → POS/Ödeme hero
- `HummyTummy_Sef_Tablet_Siparis.png` → **Maskot tabak+burger sunuyor**. → CTA/menü
- `HummyTummy_Gelir_Buyume_Grafik.png` → **Maskot teslimat scooter'ında (şehir)**. → Teslimat (ikincil)

**Kullanılacak — temiz cutout (krem zemine doğrudan konur):**
- `HummyTummy_Musteri_Destek_Sef.png` → **Bağımsız maskot, başparmak yukarı** (en temiz, en dikey). → **Birincil hero maskotu / tekrar eden karakter**
- `HummyTummy_Hesap_Guvenlik_Kilit.png` → **Kalkan + kilit ikonu** (krem zemin). → Güvenlik kartı
- `HummyTummy_Hosgeldin_Sef_Karakter.png` → **Maskot + güvenlik kalkanı**. → Güvenlik split
- `HummyTummy_Satis_Komisyon_Gelir.png` → **Yükselen bar/pasta grafiği** (krem). → Rapor ikonu
- `HummyTummy_Veri_Guvenligi_SSL.png` → **Analitik grafik sahnesi** (krem). → Rapor illüstrasyonu
- `HummyTummy_Sef_Laptop_POS.png` → **Bulut-ağ diyagramı**. → Bulut/çoklu şube
- `HummyTummy_Siparis_Takip_Tablet.png` → **Bulut-sunucu ikonu**. → Altyapı/güvenilirlik
- `HummyTummy_Mutfak_Ekrani_KDS.png` → **Tüm restoran diorama** (iç mekan). → Genel bakış/sektör
- `HummyTummy_QR_Menu_Mobil_Uygulama.png` → **2 katlı restoran binası diorama**. → Çoklu şube
- `HummyTummy_Menu_Yonetimi_Yemek.png` → **Scooter, düz turuncu zemin** (temiz). → Teslimat (birincil, kompozit kolay)
- `HummyTummy_Satis_Analiz_Dashboard.png` → **Telefon: Günlük Ciro ₺38.560 + En Çok Satanlar** (gri zemin, maskelenebilir). → Rapor cihaz mockup
- `HummyTummy_Kar_Buyume_Para.png` → **Kulaklıklı destek maskotu** (turuncu zemin — renkli panel olarak kullan). → Destek

**KULLANILMAYACAK:**
- `HummyTummy_Kafe_Ortam_Kurulum.png` — ekranda **"TavernHero"** yanlış marka + **₹** para birimi (off-brand).
- `HummyTummy_Kahve_Barista_Latte.png` — App Store/Google Play butonlu bitmiş afiş; **native mobil uygulama** ima ediyor (elimizde yok: sadece web QR + masaüstü Tauri). Baked-in metin, esnek değil.

**Görsel çerçeveleme kuralı:** Görsellerin çoğu **saydam değil** (beyaz/krem/sahne zeminli). Krem sayfada dikdörtgen "yüzen kutu" gibi durmasınlar diye:
- Sahne-zeminli olanlar → yuvarlatılmış/hafif eğik **cihaz-çerçevesi kartı** (mevcut hero mock'undaki gibi: `rounded-2xl border shadow-2xl`, browser-dot başlık).
- Cutout-uygun olanlar (maskot, ikon, diorama) → doğrudan krem üstünde, hafif `drop-shadow`, gerektiğinde radyal glow arkalık.

**Görsel performansı (Faz 1 zorunlu):** Her PNG **~1.4–2.2 MB** (toplam ~37 MB). Ana sayfada ~15 görsel = kabul edilemez ağırlık. **Optimize türevler üretilecek:** `sharp` ile `frontend/public/marketing/<isim>-{sm,md,lg}.webp` (uygun genişlikler: sm≈480, md≈960, lg≈1440). Sayfalar webp türevlerini referanslar; `loading="lazy"` + `decoding="async"` + `width`/`height` (CLS önleme). Orijinal PNG'ler yerinde kalır (geri-alınabilir: sadece dosya ekleme).

---

## 3. Görsel Dil / Tasarım Sistemi

Mevcut `LandingPage.tsx` temeli **korunur ve genişletilir** (jenerik değil, elle-işlenmiş):
- **Renkler:** krem `#faf6f0`, kart-beyaz `#ffffff`, mürekkep `#1c1917`, turuncu birincil `#f97316` / hover `#ea580c`, sıcak-turuncu-açık `#fff3e8`, kenar `#ece2d4`, metin-yumuşak `#57534e`/`#78716c`.
- **Tipografi:** Başlıklar `Fraunces` (opsz serif, zaten `index.html`'de yüklü), gövde `Inter`. `display = { fontFamily: '"Fraunces", Georgia, serif' }`.
- **Doku/detay:** `ht-grain` SVG noise overlay, radial gradient arka planlar, elle-çizim altı-çizgi SVG (hero), `ht-rise` scroll-in animasyonu (`data-rise` + `animationDelay`).
- **Bölüm ritmi:** dönüşümlü sol/sağ split'ler, `max-w-6xl` konteyner, cömert dikey boşluk (`py-16`/`py-20`), hover kalkışları (`hover:-translate-y-1`).
- **Erişilebilirlik/UX:** her görselde anlamlı `alt`; yeterli kontrast; `scroll-mt` anchor offset; klavye-erişilebilir nav; `prefers-reduced-motion` ile animasyon kapatma.
- **Responsive:** mobil-öncelikli; yatay scroll YOK (`overflow-x` yalıtımı geniş içerikte); görseller `max-w-full`.

---

## 4. Bilgi Mimarisi ve Rotalar

**Ortak `MarketingLayout`** (yeni): yapışkan mega-menü nav + site-haritası footer. Ana sayfa, fiyat ve modül sayfaları bunu paylaşır.

**Rotalar** (hepsi `App.tsx` public grubunda, `lazyWithReload` ile — proje konvansiyonu):
- `/` → `LandingPage` (yeniden yazılır; giriş-yapmış kullanıcı `/dashboard`'a yönlenir — mevcut davranış korunur)
- `/fiyatlandirma` → `PricingPage` **(Faz 1)**
- `/ozellikler` → `ModulesIndexPage` **(Faz 2)**
- `/ozellikler/:slug` → `ModulePage` (veri-güdümlü, 8 modül) **(Faz 2)**

**Dosya yapısı:**
```
frontend/src/marketing/
  MarketingLayout.tsx          # nav + footer wrapper (children)
  components/
    MarketingNav.tsx           # yapışkan mega-menü
    MarketingFooter.tsx        # site-haritası footer
    Section.tsx                # başlık+alt-başlık bölüm sarmalayıcı
    SplitFeature.tsx           # sol/sağ dönüşümlü görsel+metin
    FramedShot.tsx             # sahne-zeminli görsel için cihaz-çerçevesi
    MascotFrame.tsx            # cutout maskot/ikon + glow
    TrustStrip.tsx             # dürüst güven şeridi
    ModuleCard.tsx             # modül grid kartı (link)
    SectorTile.tsx             # sektör seçici karo
    IntegrationChips.tsx       # teslimat platform çipleri (sahte logo YOK)
    PlanTable.tsx              # gerçek plan matrisi + fiyatlar
    Faq.tsx                    # accordion SSS
    CtaBand.tsx                # koyu final CTA bandı
    HowItWorks.tsx             # numaralı adımlar
  data/
    images.ts                  # gerçek-içerik görsel haritası + alt metinleri + türev yolları
    modules.ts                 # 8 modül: slug, başlık, fayda-başlığı, bullets, görsel, ikon, SSS, ilgili
    plans.ts                   # gerçek plan matrisi + TRY fiyatlar
    sectors.ts                 # sektör karoları
    faq.ts                     # ana sayfa SSS
    trust.ts                   # dürüst güven öğeleri
frontend/src/pages/
  LandingPage.tsx              # YENİDEN YAZILIR: MarketingLayout + ana sayfa bölümleri
  marketing/
    PricingPage.tsx            # Faz 1
    ModulesIndexPage.tsx       # Faz 2
    ModulePage.tsx             # Faz 2 (:slug)
```
**Neden veri-güdümlü `ModulePage`:** 8 sayfa = 1 bileşen + zengin `modules.ts` verisi. DRY + her modül gerçek derinlik taşır (hero + 3–4 fayda bloğu + "nasıl çalışır" + modül-özel SSS + ilgili modüller + CTA).

---

## 5. Ana Sayfa — Bölüm Bölüm İçerik Spesifikasyonu

Her bölüm: fayda-öncelikli başlık + esaslı kopya + görsel + CTA. Kopya **koddan doğrulanmış** gerçeklere dayanır (§7 abartma listesi zorunlu).

1. **Mega-nav** — Logo · Özellikler ▾ (modül mega-menüsü) · Çözümler ▾ (sektörler) · Entegrasyonlar · Fiyatlar · **Giriş Yap** + **7 Gün Ücretsiz Dene**. *(Faz 1'de modül linkleri ana-sayfa anchor'larına; Faz 2'de spoke sayfalara repoint edilir.)*
2. **Hero** — Başlık: *"Restoran ve cafenizi tek panelden yönetin."* Alt-başlık 3 itirazı öldürür: **kurulum yok · her cihazda (tablet/telefon/PC) · dakikalar içinde sipariş**. CTA: **7 Gün Ücretsiz Başla** + **Giriş Yap**. Alt-not: *"7 gün ücretsiz · kredi kartı gerekmez · istediğin an iptal."* Görsel: maskot cutout (`Musteri_Destek_Sef`) + çerçeveli tablet UI (`Tatli_Menu_Cikolata`).
3. **Dürüst güven şeridi** — uydurma sayı YOK: **5 dilli QR menü · 7/24 bulut erişim · AES-256 şifreleme · KVKK uyumlu · 4 teslimat platformu · Türkçe destek**.
4. **3 Ana Fayda** — (a) *Tüm siparişler tek ekranda* (masa/paket/online birleşir) (b) *Kesintisiz akış* (POS→KDS→ödeme) (c) *Her yerden erişim*. İkonlar: bulut görselleri.
5. **Modül Grid ("Hepsi tek platformda")** — 9 kart, her biri spoke'a link: QR Menü · POS & Ödeme · Mutfak Ekranı (KDS) · Masa & Sipariş · Stok & Envanter · Raporlar & Analiz · Çoklu Şube · Entegrasyonlar · Güvenlik.
6. **Amiral Spotlight — QR Menü** (split) — *"Kağıt menü masrafına elveda."* Alt-bullet'lar: telefondan sipariş, anlık fiyat/ürün güncelleme, 5 dilli arayüz *(not: menü içeriği operatörün girdiği dilde)*, garson/hesap çağrısı. Görsel: `Premium_Guvenlik_Kalkan` (QR stand) + `Dijital_Menu_Yonetimi`.
7. **Amiral Spotlight — Mutfak Ekranı (KDS)** (split) — *"Mutfakta sipariş kaosuna son."* Bullet'lar: sipariş anında mutfağa düşer (Socket.IO + eşleşen donanım ekranı), durum takibi, sesli/görsel uyarı. **Dürüst:** şube başına tek istasyon (istasyon-bazlı yönlendirme YOK — iddia etme). Görsel: `Restoran_Ic_Mekan`.
8. **Amiral Spotlight — POS & Ödeme** (split) — *"Saniyeler içinde satış, hesap ve ödeme."* Bullet'lar: hızlı satış ekranı, **nakit & kart**, hesap böl (eşit/ürün/özel), indirim, KDV-dahil satır-bazlı vergi, **PayTR self-pay** (müşteri QR ile kendi hesabını öder — opt-in). **Dürüst:** kart-terminali ile tahsilat İDDİA ETME (inert). Görsel: `Rapor_Dokuman_Analiz` + `Dijital_Menu_Yonetimi`.
9. **Teslimat Entegrasyonları** — *"Tüm siparişler tek panelde."* **Tam 4 platform: Yemeksepeti · Getir · Trendyol Yemek · Migros Yemek** (stilize isim çipleri — sahte logo YOK). Görsel: `Menu_Yonetimi_Yemek` (scooter).
10. **Raporlar & Analiz** — *"Rakamları gör, kararı hızlı ver."* Ciro/ürün/personel/saat raporları, Z-raporu, doluluk ısı haritası. **Dürüst:** kural-tabanlı ("AI insight" DEME). Görsel: `Veri_Guvenligi_SSL` + telefon `Satis_Analiz_Dashboard`.
11. **Çoklu Şube + Bulut** — *"Tüm şubeler, tek hesap."* Şube-bazlı yetki/menü/rapor, ESC/POS yazıcı, on-prem local-bridge, masaüstü provizyon. Görsel: `QR_Menu_Mobil_Uygulama` diorama + `Sef_Laptop_POS` bulut.
12. **Güvenlik & Uyum** (split) — *"Verileriniz güvende."* **Gerçek:** AES-256-GCM alan-şifreleme + kiracı-bazlı türetilmiş anahtar, bcrypt-12, httpOnly refresh cookie, KVKK/Mesafeli Satış/Gizlilik dokümanları + kayıt/ödemede onay, Cloudflare arkası TLS, **deploy-öncesi bütünlük-doğrulamalı yedek (14 gün)**, 5 dil. **Dürüst:** AWS KMS/HSM DEME, %99.9 uptime DEME, offsite/PITR yedek DEME. Görsel: `Hesap_Guvenlik_Kilit` + `Hosgeldin_Sef_Karakter`.
13. **Sektör Seçici** — karolar: Restoran · Kafe · Bar · Pastane/Fırın · Fast Food · Pizza · Şubeli İşletme · Bulut Mutfak. *(Faz 1: ana-sayfa anchor; sektör spoke'ları kapsam DIŞI — gelecekte.)*
14. **İtiraz Bölümü** — *"Geleneksel POS'u zorlaştıran ne?"* (yüksek maliyet · karmaşık kurulum · cihaz kilidi · kopuk entegrasyon) → HummyTummy çözümü.
15. **Fiyat Teaser** — 4 planın (TRIAL/BASIC/PRO/BUSINESS) kısaltılmış karşılaştırması + **gerçek TRY fiyatlar** (§6) + "7 Gün Ücretsiz" + `/fiyatlandirma`'ya link.
16. **Destek** — *"Gerçek Türkçe destek."* Yardım merkezi (help.) + geliştirici portalı (developer.) linkleri. Görsel: `Kar_Buyume_Para` (kulaklıklı maskot, turuncu panel).
17. **SSS** (6–8 esaslı soru) + **Final CTA bandı** (koyu `#1c1917` + grain) + **site-haritası footer** (modül linkleri, yasal: /privacy /terms /legal/kvkk, help/developer, © yıl).

---

## 6. Gerçek Plan Matrisi ve Fiyatlar (koddan doğrulanmış)

Kaynak: `backend/src/common/constants/subscription-plans.const.ts` + `backend/prisma/seed.ts`. Fiyatlar **TRY, KDV-dahil**. `∞` = sınırsız (`-1`).

| | **TRIAL** (Deneme) | **BASIC** (Başlangıç) | **PRO** (Profesyonel) | **BUSINESS** (Kurumsal) |
|---|---|---|---|---|
| Aylık | 0 ₺ | **499 ₺** | **1.299 ₺** | **2.999 ₺** |
| Yıllık (indirimli) | 0 ₺ | **4.490 ₺** | **12.990 ₺** | **29.990 ₺** |
| Satın alınabilir | Hayır (kayıtta oto, 7 gün) | Evet | Evet | Evet |
| Kullanıcı | ∞ | 5 | 15 | ∞ |
| Masa | ∞ | 20 | 50 | ∞ |
| Şube | ∞ | 1 | 3 | ∞ |
| Ürün | ∞ | 100 | 500 | ∞ |
| Aylık sipariş | ∞ | 500 | 2.000 | ∞ |
| POS · KDS · Stok | ✅ | ✅ | ✅ | ✅ |
| Gelişmiş rapor | ✅ | ❌ | ✅ | ✅ |
| Rezervasyon | ✅ | ❌ | ✅ | ✅ |
| Personel yönetimi | ✅ | ❌ | ✅ | ✅ |
| Teslimat entegrasyonu | ✅ | ❌ | ✅ | ✅ |
| Çoklu şube | ✅ | ❌ | ✅ | ✅ |
| Özel marka | ✅ | ❌ | ✅ | ✅ |
| Öncelikli destek | ✅ | ❌ | ✅ | ✅ |
| API erişimi | ✅ | ❌ | ❌ | ✅ |
| Partner ekran (dış) | ✅ | ❌ | ❌ | ✅ |

Pazarlama özeti (kod `description`'larından):
- **BASIC** — "Kafe ve küçük restoranlar için temel POS + stok takibi."
- **PRO** — "Şehir merkezi restoranlar için rezervasyon + delivery + personel takibi."
- **BUSINESS** — "Çok şubeli zincirler için sınırsız + API erişimi + öncelikli destek."

**Deneme mantığı (dürüst kopya):** Kayıtta **7 gün TRIAL**, tüm özellikler açık, kredi kartı gerekmez. Bitişte hesap **kilitlenir** (ücretsiz fallback YOK) → ücretli plana geçilir. Ödeme başarısızsa **7 gün ödemesiz kullanım (grace)**. Ödeme rayı: **PayTR** (TR self-servis) + havale/e-posta (kurumsal). Fiyat sayfası CTA: **7 Gün Ücretsiz Başla** (kayıt) + **Bize Ulaşın**.

---

## 7. Dürüstlük Korumaları (do-not-overclaim — sayfa metnine ZORUNLU)

1. Kart **ödeme terminali** ile tahsilat İDDİA ETME (adaptörler inert).
2. **KDS istasyon-bazlı yönlendirme** İDDİA ETME (şube başına tek istasyon).
3. **AI menü OCR / 3D-AR** "mevcut" DEME (API key'siz inert).
4. **e-Fatura** = Paraşüt/Foriba/Logo entegrasyonuyla (turnkey "otomatik keser" DEME).
5. **PostGIS / AWS KMS / offsite-PITR yedek / HA** YOK — tek VPS + Cloudflare.
6. Ölçülen **uptime %** YOK — "%99.9" YAZMA ("7/24 bulut" + "sürekli izleme" de).
7. Analitik "insight"'lar **kural-tabanlı** — "AI" DEME.
8. Menü **içerik metni** 5 dile oto-çevrilmez (arayüz çevrilir; içerik operatör-girişi).
9. **Müşteri sayısı / yorum / referans logosu UYDURMA** — dürüst güven öğeleri kullan.
10. Native **mobil uygulama** ima etme (App Store/Play Store rozeti YOK).

---

## 8. Modül Alt Sayfaları (Faz 2) — Ortak Şablon

`ModulePage` (`/ozellikler/:slug`) her modül için `modules.ts`'den render eder:
- **Hero** (fayda-başlığı + alt-başlık + görsel + CTA)
- **3–4 fayda bloğu** (başlık + açıklama + opsiyonel görsel)
- **"Nasıl çalışır"** (numaralı 3–4 adım)
- **Modül-özel SSS** (3–5)
- **İlgili modüller** + **CTA bandı**

8 slug: `qr-menu`, `pos-odeme`, `mutfak-ekrani-kds`, `masa-siparis`, `stok-envanter`, `raporlar`, `coklu-sube`, `entegrasyonlar`. `/ozellikler` = tüm modülleri listeleyen index. Tüm kopya §7'ye uyar.

---

## 9. Fazlar / Teslim

**Faz 1 (ilk PR + tag):** `src/marketing/` (layout + bileşenler + home & pricing verisi) · `LandingPage` yeniden yazımı · `PricingPage` · rota kaydı · görsel optimizasyon türevleri (webp). Ana sayfa + `/fiyatlandirma` canlıya hazır.

**Faz 2 (ikinci PR + tag):** `ModulePage` + `ModulesIndexPage` + `modules.ts` zengin verisi + rotalar + nav mega-menü linklerini spoke'lara repoint. 8 modül derin-dalış.

Her faz: **branch → PR → main merge → `vX.Y.Z` tag → CI deploy** (kullanıcının standart release akışı). Doğrulama in-app sürüm footer'ından.

---

## 10. Doğrulama / Test

- **`tsc` typecheck** temiz + **eslint/prettier** geçer (frontend prettier gate).
- **Vitest** hafif render smoke testi (LandingPage, PricingPage, ModulePage mount + anahtar metin).
- **Görsel QA:** dev server + Playwright ile mobil (375), tablet (768), masaüstü (1280) ekran görüntüsü; yatay scroll yok; görsel-çerçeveler düzgün; framed shot'lar `object-contain`.
- **Performans:** webp türevleri + `loading="lazy"`; ana sayfa toplam görsel ağırlığı makul (< ~2–3 MB ilk görünüm).
- **Regresyon:** giriş-yapmış kullanıcı `/` → `/dashboard` yönlenmesi korunur; footer yasal linkleri (/privacy, /terms, /legal/kvkk) çalışır.

---

## 11. Kapsam Dışı (gelecek)

- Sektör-özel spoke sayfaları (restoran/kafe/bar/pastane...) — şimdilik ana-sayfa anchor.
- Blog / içerik merkezi.
- Görsel dosya adlarının gerçek içeriğe göre yeniden adlandırılması (kullanıcı işi; not düşülür).
- `Kafe_Ortam_Kurulum` görselindeki "TavernHero"/₹ düzeltmesi (kullanıcı işi).
- i18n çoklu-dil landing (mevcut desen: hard-coded TR).
- AI menü OCR / 3D-AR pazarlaması (key gelene kadar).
