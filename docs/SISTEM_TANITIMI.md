# KDS — Sistem Tanıtımı

Bu döküman, KDS Restoran Yönetim Sistemi'nin tüm modüllerini ve yeteneklerini özetler. Her başlık altta önce kısa bir tanıtım, sonra detay maddeleri içerir. Pazarlama, ürün, destek ve satış-öncesi teknik konuşmalarda referans olarak kullanılmak üzere hazırlanmıştır.

## İçindekiler

1. [Genel Bakış](#1-genel-bakış)
2. [Mimari ve Teknoloji](#2-mimari-ve-teknoloji)
3. [Abonelik ve Planlar](#3-abonelik-ve-planlar)
4. [POS — Kasa ve Sipariş](#4-pos--kasa-ve-sipariş)
5. [Mutfak Ekranı (KDS)](#5-mutfak-ekranı-kds)
6. [QR Menü ve Self-Pay](#6-qr-menü-ve-self-pay)
7. [Rezervasyon Sistemi](#7-rezervasyon-sistemi)
8. [Stok ve Reçete Yönetimi](#8-stok-ve-reçete-yönetimi)
9. [Personel Yönetimi](#9-personel-yönetimi)
10. [Müşteri ve Sadakat](#10-müşteri-ve-sadakat)
11. [Online Sipariş Entegrasyonları](#11-online-sipariş-entegrasyonları)
12. [Çok Şube ve Markalaşma](#12-çok-şube-ve-markalaşma)
13. [Raporlar ve Analitik](#13-raporlar-ve-analitik)
14. [Yönetim Panelleri](#14-yönetim-panelleri)
15. [Pazarlama / Satış Modülü](#15-pazarlama--satış-modülü)
16. [Güvenlik ve Yasal Uyumluluk](#16-güvenlik-ve-yasal-uyumluluk)
17. [Bildirimler ve Bağlantı](#17-bildirimler-ve-bağlantı)
18. [Operasyon ve Destek](#18-operasyon-ve-destek)

---

## 1. Genel Bakış

KDS, kafe ve restoranlar için tek bir hesapta POS, mutfak ekranı, QR menü, rezervasyon, stok, personel, raporlar ve çok şube yönetimini birleştiren bir SaaS üründür. Müşteri 14 gün ücretsiz dener, PayTR üzerinden aylık veya yıllık aboneliğe geçer. Sistem Türkiye'ye özel olarak tasarlanmıştır: TR vergi kuralları, e-fatura entegrasyon hazırlığı, KVKK uyumlu veri saklama, Türkçe arayüz ve destek.

**Detay**

- Hedef segment: kafe, restoran, pastane, bar, fast-food (1-100+ masa)
- Çok kiracılı (multi-tenant) yapı: her işletmenin verisi izole; admin sadece kendi tenant'ını görür
- Tek hesapta tüm fonksiyon: ek modül satın alma yok, plan limit'leri her şeye uyarlanır
- Tarayıcı tabanlı; herhangi bir donanım veya kurulum gerekmez
- Mobil-uyumlu UI (tablet/telefon dahil)
- Offline-first POS: internet kesilse bile sipariş alınır, bağlantı gelince senkronize olur
- 5 dilde arayüz: Türkçe, İngilizce, Rusça, Özbekçe, Arapça
- Tüm modüllerde gerçek-zamanlı (WebSocket) güncelleme: bir kasa sipariş yazınca aynı anda mutfak ekranı görür

---

## 2. Mimari ve Teknoloji

Backend NestJS + PostgreSQL + Prisma, frontend React + Vite + TanStack Query + Tailwind temelinde çalışan modern bir SaaS yığını. Tüm kritik akışlar arka planda cron job, WebSocket ve atomic transaction ile güvence altına alınmıştır. Sistem hem self-hosted hem cloud deploy edilebilir.

**Detay**

- **Backend**: NestJS 10, TypeScript, modüler yapı (20+ feature modülü), Prisma ORM
- **Veritabanı**: PostgreSQL 15+, schema migration tabanlı (`prisma migrate`)
- **Frontend**: React 18, Vite, TanStack Query (cache + invalidation), Zustand (auth state)
- **UI**: Tailwind CSS, Headless UI, Lucide ikonları
- **Gerçek zaman**: Socket.IO; sipariş/ödeme/masa durumu olayları anında yayımlanır
- **Auth**: JWT erişim + refresh token rotation, üç ayrı realm (tenant kullanıcısı, SuperAdmin, Marketing personeli)
- **Ödeme**: PayTR (Türk lirası, 3D secure, recurring token, kart-saklamadan otomatik yenileme)
- **Arkaplan görevleri**: `@nestjs/schedule` cron — trial bitirme, abonelik yenileme, fatura çıkarma, teklif süresi dolması, bildirim temizleme
- **Sentry**: hata izleme, kritik aksiyonlarda manual capture
- **Test**: Jest (birim), Playwright (e2e 460+ spec, sequential, fixture-driven, globalSetup'lı)
- **i18n**: i18next + react-i18next, 5 dilde lokal JSON bundle
- **Deploy**: Docker + Docker Compose; container CI/CD hazır

---

## 3. Abonelik ve Planlar

Sistem dört planlı: **Ücretsiz**, **Başlangıç**, **Profesyonel**, **Kurumsal**. Müşteri kayıt olunca otomatik 14 günlük BUSINESS trial başlar, deneme bitince ücretli bir plana geçer veya FREE'ye düşer. Plan değişimi (upgrade/downgrade) PayTR üzerinden anında çalışır.

**Detay**

| Plan | Aylık | Yıllık | Hedef |
|---|---:|---:|---|
| Ücretsiz | ₺0 | ₺0 | Deneme sonrası fallback |
| Başlangıç | ₺499 | ₺4 490 | 1–2 masalı kafe / büfe |
| Profesyonel | ₺1 299 | ₺12 990 | Şehir merkezi restoran |
| Kurumsal | ₺2 999 | ₺29 990 | Çok şubeli zincir |

- **14 günlük trial** — tüm ücretli planlarda, kart bilgisi istenmez
- **Yıllık 2 ay bedava** — yıllık ödemede 10 ay fiyatına 12 ay
- **Plan limit'leri**: maxUsers, maxTables, maxProducts, maxCategories, maxMonthlyOrders. Limit aşıldığında ilgili create endpoint'leri 403 döner
- **Feature flag'lar**: rezervasyon, çok şube, gelişmiş raporlar, özel marka, API erişimi, öncelikli destek, stok takibi, personel, delivery
- **Tenant-bazlı override**: SuperAdmin belirli müşteriye plan dışı özel limit/feature tanımlayabilir
- **Lifecycle**: TRIALING → ACTIVE → PAST_DUE (7 gün grace) → EXPIRED. Cron her gün çalışır
- **Otomatik yenileme**: PayTR recurring token ile, müşteri elle ödeme yapmaz; başarısızsa PAST_DUE
- **Trial tek-seferlik**: tenant başına bir trial, kötüye kullanım engeli

---

## 4. POS — Kasa ve Sipariş

POS modülü, masadan sipariş alma, ürün ekleme, indirim uygulama, ödeme alma (nakit/kart/çoklu yöntem) ve siparişi mutfak/bara yönlendirme akışını kapsar. Hem masalı (dine-in) hem masasız (takeaway) modda çalışır.

**Detay**

- **Masa seçimi veya takeaway**: ayarlardan tableless mode açılırsa "Takeaway Order" CTA görünür
- **Sipariş durumları**: PENDING → PREPARING → READY → SERVED → PAID. Atlamalı geçiş reddedilir (state machine)
- **Modifier'lar**: zorunlu/opsiyonel, fiyat farkı, çoklu seçim (ör. "pizza boyutu" zorunlu, "ekstra peynir" opsiyonel)
- **Stok-bağlı ürünler**: reçeteyle bağlı ürün siparişe girdiğinde malzeme stoğu otomatik düşer; yetersizse 400
- **İki-adımlı checkout**: "Sipariş oluştur" + "Ödemeye geç" iki ayrı buton — ayarlardan açılır
- **İndirim**: tutar veya yüzde, ürün-bazlı veya sipariş-bazlı. Sipariş toplamından büyük indirim reddedilir
- **Self-pay engeli**: ayardan `requireServedForDineInPayment=true` ise sipariş SERVED olmadan ödeme alınamaz
- **Pay-by-items**: çok kişilik masada her birinin kendi yediği ödenir
- **Idempotency key**: aynı `idempotencyKey` ile yeniden POST → aynı payment satırı (rapid-click koruması)
- **Rezerve masa koruması**: rezervasyon saatine 30 dk kala masaya walk-in sipariş reddedilir; "override dialog" ile manuel açılabilir
- **Masa otomasyonu**: aktif sipariş yaratıldığında masa OCCUPIED, son sipariş kapanınca AVAILABLE
- **Masa transferi**: bir masadaki tüm aktif siparişler başka masaya taşınabilir, target rezerveyse `allowMerge` flag'i gerek

---

## 5. Mutfak Ekranı (KDS)

KDS, mutfak personelinin garson tabletinden gelen siparişleri büyük ekranda görmesi, durumunu güncellemesi ve hazırlık süresini takip etmesi için tasarlanmıştır. Tüm değişimler WebSocket ile anında garsonun ekranına yansır.

**Detay**

- **Sipariş kartı**: masa adı, ürünler, modifier'lar, özel notlar, geçen süre
- **Durum butonları**: PENDING → PREPARING → READY → SERVED, tek tıkla
- **Renk-kodlu süre uyarısı**: 10 dk üstü sarı, 20 dk üstü kırmızı
- **Filtre**: durum bazlı (yalnız PREPARING) veya istasyon bazlı (sıcak / soğuk / bar)
- **Çoklu istasyon**: her ürüne `station` etiketi (örneğin "bar" — kahve/içecek; "kitchen" — sıcak yemek). KDS sadece kendi istasyonunun kartlarını gösterir
- **Ses uyarısı**: yeni sipariş geldiğinde
- **Yetkilendirme**: yalnızca KITCHEN ve ADMIN rolündeki kullanıcılar erişebilir
- **Tablet/TV uyumlu**: tam ekran modu, geniş tipografi, dokunmatik öncelikli

---

## 6. QR Menü ve Self-Pay

Müşterinin masa QR'ı okuyup menüyü açtığı, sipariş verdiği, telefonundan PayTR ile ödediği "garson çağırmadan deneyim" akışı. Pandemi sonrası standart hale gelen self-service modelini bütünüyle destekler.

**Detay**

- **Erişim biçimleri**:
  - Path-based: `/qr-menu/:tenantId?table=12`
  - Subdomain-based: `sultanahmet.kds.app?table=12` (özel marka için)
- **Menü görünümü**: kategoriler, ürün kartları (fotoğraf + fiyat + açıklama), modifier seçimi, çoklu dil
- **Sepete ekle → sipariş oluştur**: müşteri kendi sepetini yapar; sipariş garson sistemine PENDING olarak düşer
- **Self-pay**: ayar açıkken, müşteri kendi siparişini PayTR ile öder. Webhook ile başarılı/başarısız akışı senkron
- **Sadakat (loyalty)**: müşteri telefonunu doğrularsa loyalty puanı toplar, indirim/ücretsiz ürün kazanır
- **Branding**: tenant logosu, ana rengi, banner görseli, açılış mesajı özelleştirilir (PRO/BUSINESS)
- **Tenant ayarları**: fotoğraf gösterme aç/kapa, fiyat gösterme aç/kapa, alerji/içerik etiketleri
- **WiFi paylaşımı**: tenant SSID + parolası QR menü altında gösterilebilir
- **Sosyal**: Instagram/Facebook/Twitter/TikTok/WhatsApp ikonları menü altına eklenir

---

## 7. Rezervasyon Sistemi

Müşterilerin halka açık bir sayfadan masa rezerve edebileceği, restoranın no-show ve kapasite yönetimini yapabileceği modül. PRO ve BUSINESS planlarında.

**Detay**

- **Halka açık rezervasyon sayfası**: `/reserve/:tenantId` — telefon, isim, kişi sayısı, tarih/saat, opsiyonel masa
- **Onay modeli**: `requireApproval=true` ile rezervasyon PENDING düşer, admin onaylar; false ile otomatik CONFIRMED
- **Operating hours**: günlük açılış/kapanış saatleri; bunun dışındaki saatler reddedilir
- **Slot kapasitesi**: `maxReservationsPerSlot` ile aynı dakikada sınırlı rezervasyon
- **Min advance booking**: rezervasyonun şimdiden en az kaç dk sonrası için yapılabileceği
- **Cancellation deadline**: müşteri kendisi kaç dk önce iptal edebilir
- **Masa tutma (hold)**: rezervasyon saatinden `holdOffsetMinutes` (default 30 dk) önce masa otomatik RESERVED'a geçer; walk-in sipariş alınmaz
- **No-show takibi**: başlangıçtan 30 dk sonra hâlâ gelmeyen rezervasyonlar otomatik NO_SHOW (`@Cron`)
- **Görsel yer planı**: admin paneli rezervasyonu seçtiğinde POS'taki masa kartında "yaklaşan rezervasyon" banner'ı görünür
- **Hatırlatma e-postası**: rezervasyon saatinden bir gün önce müşteriye otomatik e-posta
- **Bayan**: banner görseli, başlık, açıklama özelleştirilebilir
- **Geçmiş sorgu**: müşteri kendisi `/reserve/:tenantId/lookup` üzerinden rezervasyonunu telefonu+kod ile görebilir

---

## 8. Stok ve Reçete Yönetimi

Hammadde stoğunu takip etmek, ürünleri reçeteye bağlamak ve satışla beraber stoğun otomatik düşmesini sağlamak için kapsamlı modül. BASIC ve üzeri planlarda.

**Detay**

- **Stok kalemleri (StockItem)**: kahve çekirdeği, süt, sebze gibi hammaddeler; birim (kg, lt, adet), tedarikçi, son alış fiyatı
- **Stok hareketi (StockMovement)**: alım (IN), tüketim (OUT), düzeltme (ADJUST), iade (RETURN). Her hareket audit log'a yazılır
- **Reçete (Recipe)**: ürün → birden çok ingredient; "1 cappuccino = 7g kahve + 150ml süt"
- **Otomatik düşüş**: sipariş PAID olduğunda reçete üzerinden stok hareketleri yaratılır. Stok yetersizse sipariş reddedilir (`check-stock` probe)
- **Düşük stok uyarısı**: `minStockLevel` altına düşen kalem için dashboard rozeti
- **Sayım**: admin manuel sayım yapar, sistem fark için ADJUST movement yaratır
- **Maliyet hesabı**: ürün maliyeti reçete üzerinden çıkarılır; satış-maliyet karşılaştırması raporlarda
- **Stok-takipsiz ürünler**: tatlı, alkol gibi reçetesiz ürünler `stockTracked=false` ile takibe alınmaz
- **Tedarikçi yönetimi**: alımlar tedarikçiye bağlanır, ay-sonu tedarikçi raporu çıkarılır

---

## 9. Personel Yönetimi

Garson, kasiyer, mutfak personeli için vardiya, mola, mesai takibi. PRO ve BUSINESS planlarında.

**Detay**

- **Çalışan kaydı**: ad-soyad, TC, telefon, pozisyon, başlama tarihi, saat ücreti
- **Vardiya planlama**: haftalık/aylık vardiya grid'i, çakışma kontrolü
- **Giriş-çıkış (clock-in/out)**: personel kendi şifresi ile veya QR/NFC kart ile damgalar
- **Mola takibi**: yasal mola süresi, fazla mesai otomatik hesabı
- **Personel takas (swap consent)**: vardiya değişikliği iki çalışanın onayı ile, audit log'a yazılır
- **Mesai raporu**: ay-sonu toplam mesai, ücretlendirme tablosu
- **Geç gelme/erken çıkma**: vardiya saatine göre flag'lenir
- **Rol-tabanlı görünüm**: yalnız ADMIN/MANAGER personel listesini düzenleyebilir; WAITER kendi vardiyasını görür

---

## 10. Müşteri ve Sadakat

Tenant'ın kendi müşteri veritabanı; geçmiş siparişler, harcama, sadakat puanı ve etiketler. Müşteri-bazlı kampanya ve hatırlatma için temel veri.

**Detay**

- **Müşteri kaydı**: isim, telefon (zorunlu), e-posta, doğum günü, etiketler (VIP, Kurumsal, vs.)
- **Sadakat seviyeleri (LoyaltyTier)**: BRONZE → SILVER → GOLD → PLATINUM. Kümülatif harcamayla otomatik yükselir
- **Puan kazanma**: her ödenen lira için X puan (ayarlanır); özel kampanyalarda 2x/3x
- **Puan harcama**: indirim olarak siparişe uygulanır
- **Referans kodu** (müşteri-müşteri): mevcut müşteri kendi kodunu paylaşarak yeni müşteri davet eder; her ikisine bonus puan
- **Tag-bazlı filtreleme**: "VIP" müşterilere özel kampanya, "Yeni" müşterilere hoşgeldin indirimi
- **Müşteri-sipariş bağı**: POS'ta sipariş açılırken müşteri seçilir; siparişin geçmişine müşteri kartından erişilir
- **Müşteri istatistikleri**: toplam sipariş, toplam harcama, ortalama sepet, son ziyaret
- **GDPR/KVKK**: müşteri "verimi sil" talebi ile kayıt anonimleştirilir, geçmiş siparişlere "Silinmiş müşteri" etiketi düşer

---

## 11. Online Sipariş Entegrasyonları

Yemeksepeti ve Trendyol Yemek gibi platformlardan gelen siparişleri tek panelden yönetme. PRO ve BUSINESS planlarında.

**Detay**

- **Yemeksepeti webhook**: yeni sipariş otomatik POS'a düşer (PENDING). Restoran kabul/red ederse durum platforma yazılır
- **Trendyol Yemek webhook**: aynı akış
- **Sipariş eşleştirme**: platform ürün adı ↔ kendi menü ürün adı, manuel eşleştirme veya otomatik fuzzy match
- **Fiyat senkronizasyonu** (manuel): platformdaki fiyat farklı olabilir; kendi sistem fiyatı bağımsızdır
- **Sipariş hazır bildirimi**: kurye çağırma (Yemeksepeti API)
- **Çoklu hesap**: birden fazla restoran hesabı tek tenant'a bağlanabilir
- **Hata izleme**: platform bağlantısı koparsa webhook retry + Sentry alarmı

---

## 12. Çok Şube ve Markalaşma

PRO ve BUSINESS planlarında, aynı sahibe ait birden çok şubeyi tek panelden yönetme + her şubeye özel marka. Zincir restoranlar için.

**Detay**

- **Multi-location**: PRO 5 şubeye kadar, BUSINESS sınırsız. Her şube ayrı bir Tenant değil, ana tenant altında bir lokasyon kaydı
- **Lokasyon-bazlı menü override**: bir şubenin fiyatı farklı olabilir; ana menü temel, lokasyon override'lar üstüne biner
- **Birleşik raporlar**: tüm şubelerin satışı, en iyi performans gösteren şube, lokasyon-kıyaslama
- **Özel marka (custom branding)**: logo, ana renk, font, QR menü banner görseli — PRO/BUSINESS
- **Subdomain**: `restoranadi.kds.app` ile özel QR menü URL'i; tenant subdomain alanından set edilir
- **WiFi paylaşımı**: lokasyon-bazlı SSID/parola
- **Sosyal medya linkleri**: Instagram, Facebook, Twitter, TikTok, YouTube, WhatsApp — QR menü altında

---

## 13. Raporlar ve Analitik

Satış, ürün, kategori, saat, gün, çalışan, ödeme yöntemi ve müşteri bazlı detaylı raporlar. Z-Raporu (gün-sonu kapanışı) yasal kayıt olarak finalize edilir.

**Detay**

- **Z-Raporu**: gün sonunda admin "Z-Raporu Al" der; o gün'ün tüm PAID siparişleri kilitlenir, snapshot olarak saklanır
- **Saatlik satış**: bugün/dün/haftalık saatlik bar
- **Ürün performansı**: en çok satılan, en kârlı, en çok iptal edilen
- **Kategori dağılımı**: pasta tablosu — yemek/içecek/tatlı yüzdeleri
- **Ödeme yöntemi**: nakit/kart/havale/QR self-pay dağılımı
- **Çalışan performansı**: garson başına satış, ortalama servis süresi
- **İptal raporu**: hangi nedenle, hangi ürün, hangi saat
- **Gelişmiş raporlar (advancedReports)**: PRO/BUSINESS — yıllık karşılaştırma, sezonsallık analizi, demografik müşteri segmentasyonu
- **Export**: PDF (yazdırma için), CSV (muhasebeye dış aktarım), JSON (entegrasyon)
- **E-posta raporu**: tenant ayarından "günlük rapor" açılırsa belirtilen adreslere her gece otomatik gönderilir

---

## 14. Yönetim Panelleri

Sistemin üç farklı yönetim arayüzü vardır: tenant'ın kendi admin paneli, platformun SuperAdmin paneli, pazarlama ekibinin Marketing paneli. Her biri farklı kimlik doğrulama realm'ı ve farklı tema kullanır.

**Detay**

### a. Admin Paneli (`/admin/*`) — Tenant Yöneticisi

Tenant'ın admin/manager rolündeki kullanıcıları kullanır. Mavi-beyaz tema, mod boyutu yönetimi.

- Menu Management: kategori/ürün/modifier CRUD, fotoğraf yükleme
- Table Management: masa ekle, kapasite, durum, layout
- User Management: tenant personeli, rol atama, şifre sıfırlama
- QR Management: masa QR kodları, indirilebilir PDF
- Reports & Analytics: yukarıdaki rapor modülleri
- Reservations: gelen rezervasyon listesi, onay/red
- Personnel Management: vardiya, mesai
- Stock Management: stok kalemleri, reçete, alım/sayım
- Invoices: ödeme + KDV split + PDF
- Settings: POS toggle'ları, QR menü görünümü, branding, rezervasyon ayarları, SMS sağlayıcı, muhasebe entegrasyonu, abonelik yönetimi

### b. SuperAdmin Paneli (`/superadmin/*`) — Platform Operatörü

Tüm tenant'ları üst seviyeden yöneten platform-sahibi paneli. Koyu zinc teması, 2FA zorunlu (TOTP).

- Dashboard: platform geneli KPI (toplam tenant, aktif abonelik, MRR, churn)
- Tenants: tüm restoranlar listesi, plan, durum, son giriş
- Users: tüm tenant kullanıcıları, email doğrulama override, kilit açma
- Plans: plan CRUD, fiyat değişimi, komisyon oranı override
- Subscriptions: tüm abonelikler — plan değiştir, iptal et, iade et, deneme bitir
- Audit Logs: tüm platform aksiyonları (kim, ne zaman, hangi tenant, hangi alanı değiştirdi)
- Legal Documents: KVKK / Mesafeli Satış / İade politikası versiyon yönetimi (audit history)
- Settings: platform genelinde global ayarlar

> **Not:** Marketers ve Commissions ekranları, marketing paneliyle birlikte
> bağımsız **kds-marketing** projesine taşındı (Phase-5 ayrışması); pazarlama
> ekibi ve komisyon yönetimi artık o projede yaşar.

### c. Marketing Paneli — Satış Personeli

> **Not:** Marketing paneli ve backend'i bu repodan ayrılarak bağımsız
> **kds-marketing** projesine taşındı (Phase-5 ayrışması). Aşağıdaki özellik
> listesi artık o projede yaşar; core ile entegrasyon
> `backend/docs/marketing-phase5-split-runbook.md` üzerinden yürür.

Pazarlamacıların kendi lead'lerini takip ettiği CRM. Indigo teması, ayrı login.

- Dashboard: kendi performansı, referans kodu, lifetime komisyon
- Leads: pipeline (NEW → ... → WON/LOST), filtreleme, arama
- Lead Detail: aktiviteler, teklifler, görevler, müşteriye dönüştür
- Tasks: yapılacaklar, vade hatırlatması
- Calendar: görevlerin aylık görünümü
- Offers: lead'e özel fiyat/trial gün uzatma
- Commissions: kendi komisyonları, detay modal, audit timeline
- Reports: kaynak dağılımı, bölgesel performans, conversion funnel (manager-only)
- Users: ekip üyeleri (manager-only)

---

## 15. Pazarlama / Satış Modülü

Pazarlamacıların yeni müşteri kazanırken referans kodu kullanması ve **ömür boyu komisyon** alması için kurulu satış modülü. Lead → Convert → Commission zinciri ile çalışır.

**Detay**

- **Referans kodu**: her pazarlamacının panelinde benzersiz kod (örn. `MRT9X3K`)
- **URL paylaşımı**: `kds.app/?ref=MRT9X3K` — cookie 30 gün saklar, checkout'ta otomatik dolar
- **Manuel giriş**: müşteri checkout'ta kodu elle de girebilir
- **Komisyon tipleri**:
  - **SIGNUP** — ilk ücretli abonelik
  - **RENEWAL** — her yenileme
  - **UPSELL** — plan yükseltme
- **Lifetime model**: müşteri abonelik aldığı sürece her yenileme sana komisyon yazar
- **Onay akışı**: PENDING → APPROVED (manager onay) → PAID (ödeme yapıldı). Audit log her geçişi kayıt eder
- **Per-plan oran**: her plana ayrı komisyon yüzdesi (default %10), SuperAdmin değiştirebilir
- **Otomatik Lead**: ref kodla gelen müşteriye otomatik Lead yaratılır (status=WON, source=REFERRAL)
- **Manager öncelikli**: SuperAdmin/manager elle convert ettiyse kod yarışı bırakılır
- **Bildirimler**: pazarlamacıya komisyon kaydı düştüğünde in-app bildirim
- **CRM**: lead pipeline, activity log, teklif, görev — tüm satış sürecini panelden yönetir
- **Ekip yapısı**: SALES_MANAGER (onay yetkili) ve SALES_REP (üye)

---

## 16. Güvenlik ve Yasal Uyumluluk

Türkiye'deki yasal gereksinimler (KVKK, mesafeli satış, e-fatura) ve uluslararası güvenlik standartları için tasarlandı.

**Detay**

- **KVKK uyumu**: müşteri verisi kayıt sırasında açık rıza (consent) ile alınır, audit'lenir
- **Mesafeli satış sözleşmesi**: abonelik checkout'unda zorunlu onay; sözleşme metni LegalDocument modelinde versiyonlu saklanır
- **İade ve cayma politikası**: aynı şekilde versiyonlu onay
- **Consent versiyonlama**: doküman güncellenirse müşteri checkout'ta yeni versiyonu onaylar; eski onayları audit'te kalır
- **Şifre güvenliği**: bcrypt cost 12, min 8 karakter, büyük/küçük + rakam zorunlu
- **JWT realm ayrımı**: tenant, marketing, superadmin — her birinin kendi secret'ı; secret eşit olamaz
- **Refresh token rotation**: her refresh'te token yenilenir, eski token revoked olur
- **Rate limiting (throttler)**: payment-intent 5/dk, login 10/dk, global 100/dk
- **2FA (SuperAdmin)**: TOTP zorunlu; replay guard (60 sn aynı kod kullanılamaz)
- **Audit log**: kritik aksiyonlar (plan değişimi, kullanıcı silme, komisyon onay) audit_logs tablosuna yazılır
- **IP allowlist**: PayTR webhook'u IP-allowlist guard ile (defence in depth, HMAC ana güvenlik)
- **HMAC doğrulama**: PayTR webhook'unda merchant key + salt ile hash kontrol
- **Veritabanı şifreleme**: PayTR recurring token at-rest şifreli; Tenant.paytrRecurringToken plaintext değil
- **Soft-delete**: tenant ve kullanıcı silme INACTIVE statüsü ile (veri korunur, erişim kapatılır)
- **CORS**: prod domain whitelist
- **CSP & headers**: helmet middleware ile default secure headers

---

## 17. Bildirimler ve Bağlantı

Sistem içinde e-posta, in-app bildirimler ve WebSocket olayları ile kullanıcı ve müşteriler güncel tutulur.

**Detay**

- **E-posta**: NestJS Mailer + Handlebars şablon (Türkçe), SMTP sağlayıcı (dev mockMail)
  - Hoşgeldin e-postası (kayıt)
  - Email doğrulama kodu
  - Şifre sıfırlama
  - Abonelik aktive (trial başladı)
  - Abonelik yenilendi
  - Ödeme başarısız (PAST_DUE uyarısı)
  - Trial bitti (FREE'ye düştü)
  - Rezervasyon onayı / hatırlatma
  - Z-Raporu (günlük)
- **WebSocket olayları**:
  - `order:created` → mutfak ekranı + garson tabletleri
  - `order:status` → tüm bağlı clientler
  - `payment:success` → kasiyer + admin
  - `table:status` → POS masa kartları
  - `kitchen:ready` → garson uyarısı
- **In-app bildirimler**:
  - Marketing: yeni komisyon, takip görevi, teklif yanıtı
  - Admin: düşük stok, vadesi geçen ödeme, yeni rezervasyon
- **SMS** (ayar): rezervasyon onay/hatırlatma SMS, sadakat puanı SMS
- **Push** (gelecek): mobil uygulama bildirimi için altyapı hazır

---

## 18. Operasyon ve Destek

Sistemi yöneten ekip için izleme, müdahale ve destek araçları.

**Detay**

- **Sentry**: kritik hata yakalama (duplicate-active-subscription, payment failures, webhook bad-hash, marketing commission credit failures)
- **Logging**: NestJS Logger her servis için, request middleware ile tüm HTTP istek logları
- **Health endpoint**: `/api/health` — Docker liveness/readiness probe
- **Cron izleme**: her cron job log mesajı atar, `subscription-scheduler.log` arşivlenir
- **Manuel-tetik endpoint'leri** (SuperAdmin): expire-trials, run-renewals, cancel-orphans, expire-offers
- **Backup**: PostgreSQL günlük snapshot (deploy dışında ayrı süreç)
- **Migration**: `prisma migrate deploy` ile prod; downtime sıfır (forward-only)
- **Seed**: `seed.ts` (plan + base data), `seed-platform-users.ts` (e2e users), `seed-demo.ts` (Sultanahmet demo tenant)
- **Destek seviyeleri**:
  - Standart (BASIC/PRO): e-posta, iş günü saatlerinde
  - Öncelikli (PRO): garantili 4 saat yanıt
  - Kurumsal (BUSINESS): 7/24, telefon, atanmış destek müdürü
- **API erişimi (BUSINESS)**: müşteri kendi entegrasyonu için API key (apiKeyHash ile saklanır)
- **Deployment**: Docker Compose (db + backend + frontend + redis); CI build → image registry → docker swarm / k8s deploy
- **CI/CD**: GitHub Actions; PR → typecheck + unit tests + e2e suite + lint
- **Monitoring**: Grafana + Prometheus (deploy ortamında)

---

*Bu döküman canlı bir referanstır — modüller eklendikçe veya plan/fiyat değişiklikleri olursa güncellenir. Pazarlama, satış, ürün ve destek ekipleri sahaya çıkmadan önce buradan bir bakış geçirebilir.*
