# adisyo Paritesi — Tam Envanter & Sayfa Yapılacaklar Listesi

**Tarih:** 2026-07-07 · Kaynak: 7-ajanlı araştırma (adisyo.com taraması + kod tabanı taraması, koddan doğrulanmış).

Amaç: adisyo'nun **tüm** sayfa/başlık taksonomisini çıkarmak, **HummyTummy'nin gerçekten sunabildiği her şeyi** durumuyla listelemek ve hangi sayfaları **dürüstçe** yapabileceğimizi belirlemek. Sonra sayfaları tek tek yaparız.

---

## BÖLÜM 1 — adisyo.com'un tüm sayfa taksonomisi

### 1.A Ürün / Modül sayfaları (11)
| Sayfa | Ana konular |
|---|---|
| QR Kod / Dijital / Tablet Menü | QR & karekod, tablet menü, anlık güncelleme, hijyen, baskı maliyeti sıfır |
| Stok ve Maliyet (Kritik Stok Uyarı) | gerçek zamanlı stok, kritik uyarı, reçete düşümü, tedarik, talep tahmini, israf, maliyet |
| Mutfak Yönetimi (KDS) | sipariş takibi, ürün/bölüm bazlı yazdırma, çoklu ekran/yazıcı, hazır bildirimi, performans |
| Gelişmiş Entegrasyonlar | YS/Getir/Trendyol/Migros/Fuudy/RestaJet/Hemenyolda + e-Fatura + Caller ID + Ingenico + API |
| e-Dönüşüm | e-Fatura, e-Arşiv, e-İrsaliye, e-Adisyon |
| Zincir / Çoklu Şube | merkezi yönetim, şube takibi, toplu fiyat/menü, B2B stok transfer, karşılaştırma |
| **Kurye Takip** | kurye atama, canlı harita (Adisyo Harita), rota optimizasyonu, teslimat istatistiği |
| **Cari Hesap / Müşteri** | müşteri/tedarikçi/personel cari, borç-alacak, veresiye, açık hesap, ekstre |
| Raporlama ve Analiz | gün sonu, ürün satış, stok durum, istatistik, vardiya, Rapor Sihirbazı |
| Garson Çağrı / El Terminali | QR garson çağrı, el terminaliyle masada sipariş |
| Donanım (POS Terminal & Fiş Yazıcı) | Possafe POS, POSSIFY yazıcı, personel tableti, Caller ID, Ingenico |

### 1.B Ek modüller / uygulamalar (fiyat sayfasında, ayrı sayfası yok)
Kiosk (self-servis) · **Patron App & Garson App (native mobil)** · **Otel Yönetim modülü** · Kuver & Garsoniye · Müşteri Sadakat (BOOSTFEEL) · Rapor Sihirbazı · Maliyet & Karlılık.

### 1.C Sektör / Çözüm sayfaları (9)
Restoran · Cafe · Şubeli Restaurant & Cafe · Cloud Kitchen (Bulut Mutfak) · Fast Food · Pizza · Burger · **Otel Cafe & Restoran** · Sezonluk İşletmeler.

### 1.D Entegrasyon / Donanım / e-Dönüşüm sayfaları
- **Teslimat:** Yemeksepeti, Getir, Trendyol Yemek, Migros Yemek, Fuudy, RestaJet, Hemenyolda, Paket Servisi
- **Otel PMS:** Hotel Runner, HMS Hotel, Hotelier 101, Butiksoft (oda hesabına/folio aktarım)
- **Muhasebe:** Bizim Hesap, Paraşüt
- **e-Dönüşüm:** e-Fatura, e-Arşiv, e-İrsaliye, e-Adisyon
- **Sadakat:** BOOSTFEEL
- **Caller ID:** cihaz + Android Caller ID
- **Harita/Lojistik:** Adisyo Harita (canlı kurye)
- **Yazarkasa/ÖKC:** Ingenico TSM+GMP3; ÖKC rehber blogları (Beko/Hugin/Pax/Pavo)
- **Donanım:** Possafe HD 185 POS, POSSIFY FY-200E yazıcı, Samsung Tab A7, Caller ID CID 812
- **API:** Veri Aktarımı & API (developers.adisyo.com — Products/Orders/Payments/Couriers/Tables + Webhook)

### 1.E Kurumsal / Kaynaklar / Destek (27 sayfa)
Fiyatlar (Lite/Standard/Pro) · Kampanya · Banka Bilgileri · Blog (~61 makale) · Bilgi Merkezi (video/kılavuz/SSS) · Sizi Arayalım · **Akademi** (akademi.adisyo.com) · **API/Developers** · Bayilik · Hakkımızda/Şirketimiz · Müşterilerimiz · İletişim · **Müşteri Hikayeleri** (Durumle, Moston, Cafe Sabor, Köfteci Emir, Zest, Vivaldi, Mogaf…) · Yasal (Kullanıcı Sözleşmesi, KVKK, Gizlilik, İptal-İade) · **Mobil App** (App Store + Play Store).

---

## BÖLÜM 2 — HummyTummy'nin sunabildiği her şey (koddan doğrulanmış)

Durum: **shipped** (canlı) · **flag** (plan özelliği) · **opt-in** (açık ama konfig gerekli) · **inert** (anahtar/sertifika bekliyor).

### 2.A Ön salon & sipariş
QR Menü `shipped` · Menü/katalog + modifier `shipped` · POS + POS ayarları `shipped` · sipariş indirimi `shipped` · Masa yönetimi `shipped` · **2B kat planı editörü + canlı harita** `shipped` (3B YOK) · Rezervasyon (dahili + public) `shipped` · **QR self-pay** `opt-in` · Kasa/cash-drawer `shipped` · Garson çağrı (QR) `shipped`.

### 2.B Mutfak
KDS `shipped` · KDS routing (cihaz/istasyon) `shipped` *(pazarlamada "şube başına tek ekran" de — istasyon-bazlı ızgara/bar ayrımı garanti etme)*.

### 2.C Stok
Stok/envanter `shipped` · Reçete `shipped` · Satınalma `shipped` · Tedarikçi `shipped` · Sayım `shipped` · Fire/waste `shipped`.

### 2.D Rapor & analiz
Raporlar `shipped` · Z-rapor `shipped` · **Analytics: doluluk ısı haritası + insights** `shipped` *(kural-tabanlı, "AI" deme)* · Kamera analitiği `opt-in`.

### 2.E Personel & müşteri
Personel (mesai/vardiya/performans) `shipped` · Müşteri/CRM `shipped` · **Sadakat (puan + Bronze→Platinum kademe)** `shipped` · Referral `shipped` · SMS/telefon doğrulama `opt-in`.

### 2.F Çok şube, cihaz, donanım
Çoklu şube (device-mesh/branches) `flag` · **ESC/POS yazıcı (bulut builder + Rust bridge sürücüsü)** `shipped` · Local bridge (on-prem) `opt-in` · Health dashboard `shipped` · **Masaüstü uygulaması (Tauri, gerçek Bluetooth/ESC-POS)** `shipped`.

### 2.G Ödeme & mali
**PayTR** `shipped` · Havale aboneliği `opt-in` · Muhasebe (vergi + satış faturası) `shipped` · Ödeme terminali soyutlaması + **simülatör** `shipped` · Gerçek kart terminalleri (Paygo/GMP-3/bank-ECR/SoftPOS) `inert` · Fiscal-core / ÖKC (Hugin/Beko/Paygo) `inert`.

### 2.H Entegrasyonlar
**Teslimat: Yemeksepeti/Getir/Trendyol/Migros** (gerçek adaptör) `opt-in` · **e-Fatura/e-Arşiv: Paraşüt/Foriba/Logo** (gerçek adaptör) `opt-in` · Partner Display API `flag` · Webhooks outbound `flag` · Integration-gateway (eski iskele) `inert` · Caller ingest `inert`.

### 2.I Marketplace & platform
Marketplace add-on `shipped` · Store hub `shipped` · Hardware store `shipped` · Checkout/abonelik/plan `shipped` · Entitlements engine `shipped` · Fulfillment (kurulum kuyruğu) `shipped` · **Demo tenant (tek-tık keşfet)** `shipped` · Onboarding/TRIAL `shipped` · Superadmin `shipped` · Auth + Google OAuth `shipped` · Notifications `shipped` · Legal/KVKK `shipped` · Upload `shipped` · KMS `shipped` · Outbox `shipped`.

### 2.J Uyum, dil, güvenlik, altyapı
**5 dil** (tr/en/ru/uz/ar-RTL) `shipped` · AES-256-GCM at-rest `shipped` · bcrypt `shipped` · KVKK rıza + belgeler `shipped` · DB yedekleme (14g, offsite YOK) `shipped` · Observability (Prometheus/Grafana/Loki) `opt-in`.

### 2.K INERT (anahtar/sertifika bekliyor — pazarlamada "mevcut" deme)
AI menü OCR · 3B/AR ürün (Meshy) · gerçek kart terminali · ÖKC yazarkasa (Hugin/Beko/Paygo).

---

## BÖLÜM 3 — Eşleştirme + Önerilen Sayfa Yapılacaklar (dürüst)

### ✅ Zaten yapıldı (8 modül + fiyat + ana sayfa)
QR Menü · POS & Ödeme · KDS · Masa & Sipariş · Stok & Envanter · Raporlar · Çoklu Şube · Entegrasyonlar · /fiyatlandirma · ana sayfa.

### ➕ YENİ modül sayfaları — bizde GERÇEKTEN var, yapabiliriz
1. **Rezervasyon** (dahili + public) — `shipped`
2. **Personel Yönetimi** (mesai/vardiya/performans) — `shipped`
3. **Müşteri & Sadakat / CRM** (puan + kademe + referral) — `shipped` ← adisyo'nun BOOSTFEEL'ine denk, bizde yerleşik
4. **Garson Çağrı & Self-Pay** (QR'dan çağrı + masadan kendi hesabını öde) — `shipped`/`opt-in` ← **farklılaştırıcı**
5. **Analitik & Doluluk Isı Haritası** — `shipped` ← **adisyo'da yok, farklılaştırıcı**
6. **e-Fatura / e-Dönüşüm** (Paraşüt/Foriba/Logo entegrasyonu) — `opt-in`, dürüst çerçevele
7. **Donanım & Cihaz Ağı** (ESC/POS yazıcı, device-mesh, masaüstü Tauri, yerel köprü) — `shipped`
8. **Marketplace / Eklentiler** (add-on mağazası) — `shipped`
9. **Ödeme & Kasa** (PayTR + cash-drawer + hesap bölme) — `shipped` *(POS sayfasına da katılabilir)*
10. **Güvenlik & Uyum** (AES-256, KVKK, 5 dil, yedekleme) — `shipped` *(şu an ana sayfada bölüm; ayrı sayfa olabilir)*

### ⚠️ Dikkatli/dürüst çerçeveyle (henüz tam canlı değil)
- **Ödeme Terminali / ÖKC** — simülatör canlı, gerçek sertifikasyon sürüyor → "hazır, sertifikasyon aşamasında" veya şimdilik atla.
- **AI Menü / 3B-AR Menü** — `inert` → "yakında" etiketiyle veya atla (anahtar gelene kadar iddia etme).

### 🏢 Sektör sayfaları — yapabiliriz (dürüst kopya ile)
Restoran · Cafe · Bar · Pastane/Fırın · Fast Food · Pizza · Burger · Şubeli/Zincir · **Bulut Mutfak** *(sadece kendi kuryemiz yok — "teslimat platformları tek panelde" vurgusu, "kendi kurye takibi" DEME)*.
- **Otel** sektör sayfası: **YAPMA** — PMS/oda-hesabı entegrasyonumuz yok.

### 🏛️ Kurumsal / Kaynak sayfaları
- **Entegrasyonlar hub** (teslimat + e-fatura + partner ekran) — var, yapılabilir.
- **Hakkımızda · İletişim** — yapılabilir (gerçek bilgiyle).
- **Müşteri Hikayeleri / Referanslar** — gerçek veri gelene kadar YAPMA (uydurma yorum yok).
- **Blog / Bilgi Merkezi / Akademi** — içerik operasyonu gerektirir; help./developer. portalları zaten var (linkle).
- **API / Geliştirici** — developer.hummytummy.com zaten var, linkle.
- **Bayilik, Kampanya** — iş kararı; şimdilik ertele.

### ❌ YAPMA — bizde GERÇEKTE yok (iddia etmek yanıltıcı olur)
1. **Kurye Takip** (kendi kuryeni ata + canlı GPS harita) — YOK (sadece aggregator'a durum forward)
2. **Cari Hesap / Veresiye** (açık hesap borç-alacak, sonra öde) — YOK
3. **Otel PMS Entegrasyonu** (oda hesabına/folio yazma) — YOK
4. **Patron / Garson Native Mobil Uygulama** (iOS/Android App Store) — YOK (sadece responsive web + Tauri masaüstü)
5. **Yemek Kartı Ağı** (Multinet/Sodexo/Setcard/Edenred online tahsilat) — YOK (sadece fiş üzerinde etiket)

> Bu 5 eksik gerçek ürün açığıdır. İsterseniz ayrı bir "yol haritası/geliştirme" konusu olarak ele alınır; pazarlama sayfası olarak **yapılmaz**.

---

## Önerilen yapım sırası (tek tek)
**Dalga 1 (bizde net var, yüksek değer):** Rezervasyon · Personel · Müşteri & Sadakat · Analitik/Isı Haritası · Garson Çağrı & Self-Pay.
**Dalga 2:** e-Fatura/e-Dönüşüm · Donanım & Cihaz Ağı · Marketplace · Güvenlik & Uyum · Entegrasyonlar hub (mevcut sayfayı derinleştir).
**Dalga 3 (sektörler):** Restoran · Cafe · Bar · Pastane · Fast Food · Pizza · Burger · Şubeli · Bulut Mutfak.
**Dalga 4 (kurumsal):** Hakkımızda · İletişim · (referanslar/blog gerçek veri/içerik gelince).
