# KDS — Sistem Tanıtımı

Bu döküman, KDS Restoran Yönetim Sistemi'nin tüm modüllerini ve yeteneklerini özetler. Her başlık altta önce kısa bir tanıtım, sonra detay maddeleri içerir. Pazarlama, ürün, destek ve satış-öncesi teknik konuşmalarda referans olarak kullanılmak üzere hazırlanmıştır.

## İçindekiler

1. [Genel Bakış](#1-genel-bakış)
2. [Mimari ve Teknoloji](#2-mimari-ve-teknoloji)
3. [Lisans ve Modüller](#3-lisans-ve-modüller)
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

KDS, kafe ve restoranlar için tek bir hesapta POS, mutfak ekranı, QR menü, rezervasyon, stok, personel, raporlar ve çok şube yönetimini birleştiren bir SaaS üründür. Ürünün çekirdeği (POS, KDS, menü, masa planı, QR menü, sipariş, kasa, temel raporlar, ekip, müşteriler, cihaz/şube paneli, özel marka) **süresiz ücretsizdir**; ek ihtiyaçlar tek tek, yıllık satın alınan modüllerle açılır. Sistem Türkiye'ye özel olarak tasarlanmıştır: TR vergi kuralları, e-fatura entegrasyonu, KVKK uyumlu veri saklama, Türkçe arayüz ve destek.

**Detay**

- Hedef segment: kafe, restoran, pastane, bar, fast-food (1-100+ masa)
- Çok kiracılı (multi-tenant) yapı: her işletmenin verisi izole; admin sadece kendi tenant'ını görür
- Paket/kademe yok: ücretsiz çekirdek her hesapta açıktır, ücretli kalemler à-la-carte satın alınır ve entitlement motoru tarafından açılır
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
- **Ödeme**: PayTR (yalnızca Türk lirası, 3D secure). Kart saklama / otomatik tahsilat kullanılmaz — yenileme manueldir
- **Arkaplan görevleri**: `@nestjs/schedule` cron — yenileme cycle'ının önceden oluşturulması, 30/7/1 gün hatırlatmaları, ek süre sonunda erişim kapatma, fatura çıkarma, teklif süresi dolması, bildirim temizleme
- **Sentry**: hata izleme, kritik aksiyonlarda manual capture
- **Test**: Jest (birim), Playwright (e2e 460+ spec, sequential, fixture-driven, globalSetup'lı)
- **i18n**: i18next + react-i18next, 5 dilde lokal JSON bundle
- **Deploy**: Docker + Docker Compose; container CI/CD hazır

---

## 3. Lisans ve Modüller

Paket, kademe, plan ve deneme süresi yoktur. Çekirdek her hesapta **süresiz ücretsiz** açıktır; ücretli tarafta ise yıllık bir **Bakım, Destek ve Güncelleme** kalemi (kodda `license_annual`; öncelikli destek, e-Fatura gönderimi, tüm güncellemeler ve günlük yedekleme dahildir) ve tek tek satın alınan **modül / entegrasyon / kapasite** kalemleri vardır. Tüm fiyatlar TRY ve KDV dahildir; tahsilat PayTR üzerinden yapılır.

**Detay**

### Ücretsiz çekirdek (₺0, süresiz, kart istenmez, lisans gerekmez)

POS ve adisyon · Mutfak ekranı (KDS) · Menü yönetimi · Masa ve kat planı · QR menü · Sipariş yönetimi · Kasa ve nakit · Temel raporlar · Ekip ve rol yönetimi · Müşteriler · Cihaz ve şube paneli · Özel marka ve alan adı.

Kullanıcı, masa, ürün, kategori ve **aylık sipariş sayısı sınırsızdır** (`-1` sentinel değeri, `limit.*` toplamına baskın gelir). **İlk şube ücretsizdir** (`limit.maxBranches = 1`); ücretli olan tek kapasite kalemi ikinci ve sonraki şubelerdir.

### Ücretli katalog (TRY, KDV dahil)

| Kalem | Tip | Fiyat |
|---|---|---:|
| Bakım, Destek ve Güncelleme (öncelikli destek + e-Fatura + güncellemeler dahil) | yıllık | ₺4.900 |
| Gelişmiş Rapor & Analitik | modül / yıllık | ₺1.290 |
| Stok & Maliyet Yönetimi | modül / yıllık | ₺3.900 |
| Rezervasyon Sistemi | modül / yıllık | ₺990 |
| Personel Yönetimi | modül / yıllık | ₺990 |
| Kartlı Vardiya (RFID kart ile giriş-çıkış) | modül / tek seferlik | ₺4.000 |
| AI Menü Stüdyosu | modül / yıllık | ₺1.990 |
| API & Webhook Erişimi | modül / yıllık | ₺2.490 |
| Partner Ekran API | modül / yıllık | ₺1.990 |
| Paket Servis Entegrasyonları (Yemeksepeti, Getir, Trendyol Yemek, Migros Yemek) | entegrasyon / yıllık | ₺2.499 |
| Semt | entegrasyon / — | yakında, ücretsiz |
| ÖKC / Yazarkasa (Hugin) | entegrasyon / yıllık | ₺2.990 |
| Çağrı-ID | entegrasyon / yıllık | ₺1.490 |
| SMS Bildirimleri | entegrasyon / yıllık | ₺990 |
| Ek Şube | kapasite / yıllık / adet | ₺3.990 (en fazla 100 adet) |
| 100 AI görsel · 20 AI video · 10 AI 3D model | kontör / tek seferlik | ₺690 · ₺890 · ₺790 |
| 500 SMS | kontör / tek seferlik | ₺490 |
| Yerinde Kurulum & Eğitim | hizmet / tek seferlik | ₺7.500 |
| 3D baskı figür (taban + ürün başına) | hizmet / tek seferlik | ₺1.500 + ₺50/ürün |

- **Lisans ön koşuludur**: modül, entegrasyon ve kapasite kalemleri hem satın almak hem de kullanmak için aktif lisans ister (`requiresLicense`). Lisans karardığında bu kalemlerin hakları verilmez; ücretsiz çekirdek etkilenmez
- **Kontör bağımlılığı**: AI kontörleri `module_ai_studio`, SMS kontörü `sms_integration` sahipliği ister. Kontörler süresizdir, tükenene kadar geçerlidir ve yenilemeye girmez
- **Yıl dönümü**: lisansın alındığı tenant-yerel takvim günü hesabın değişmez yıl dönümüdür (`anchorAt`)
- **Orantılı fiyat**: yıl içinde alınan yıllık kalem, yıl dönümüne kalan gün kadar fiyatlanır. Yıl dönümüne 14 günden az kalmışsa kalem sonraki tam döngüye taşınır. Hiçbir satır ₺1 altına inmez
- **Tek fatura, tek yenileme tarihi**: sahip olunan tüm yıllık kalemler tek bir yenileme cycle'ında toplanır ve tek itemize faturayla ödenir
- **Manuel yenileme**: kayıtlı kart ve otomatik çekim yoktur. Yıl dönümünden 30 / 7 / 1 gün önce hatırlatma gider, ardından 7 gün ek süre (grace) tanınır
- **Ödenmezse**: ek süre sonunda yalnızca ilgili kalemlerin **erişimi** kapanır (`active → past_due → expired`, projeksiyon grant'ı düşürür). **Veri silinmez**; ödeme yapıldığında aynı satır yeniden aktifleşir
- **Entitlement motoru**: `feature.*` anahtarları OR ile, `limit.*` anahtarları toplamla katlanır; ücretsiz çekirdek her tenant'a `free:baseline` kaynağından projekte edilir
- **Tenant-bazlı override**: SuperAdmin belirli bir müşteriye katalog dışı özel grant tanımlayabilir (`override:admin`)
- **Demo restoranı**: paylaşımlı, örnek menü/masa/sipariş ile dolu bir demo tenant'ı vardır; kullanıcı panelden tek tıkla geçer, kendi verisine dokunulmaz

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
- **Branding**: tenant logosu, ana rengi, banner görseli, açılış mesajı özelleştirilir (ücretsiz çekirdeğin parçası)
- **Tenant ayarları**: fotoğraf gösterme aç/kapa, fiyat gösterme aç/kapa, alerji/içerik etiketleri
- **WiFi paylaşımı**: tenant SSID + parolası QR menü altında gösterilebilir
- **Sosyal**: Instagram/Facebook/Twitter/TikTok/WhatsApp ikonları menü altına eklenir

---

## 7. Rezervasyon Sistemi

Müşterilerin halka açık bir sayfadan masa rezerve edebileceği, restoranın no-show ve kapasite yönetimini yapabileceği modül. **Rezervasyon Sistemi** modülü gerekir (yıllık, lisans ön koşuluyla).

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

Hammadde stoğunu takip etmek, ürünleri reçeteye bağlamak ve satışla beraber stoğun otomatik düşmesini sağlamak için kapsamlı modül. **Stok & Maliyet Yönetimi** modülü gerekir (yıllık, lisans ön koşuluyla).

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

Garson, kasiyer, mutfak personeli için vardiya, mola, mesai takibi. **Personel Yönetimi** modülü gerekir (yıllık, lisans ön koşuluyla).

**Detay**

- **Çalışan kaydı**: ad-soyad, TC, telefon, pozisyon, başlama tarihi, saat ücreti
- **Vardiya planlama**: haftalık/aylık vardiya grid'i, çakışma kontrolü
- **Giriş-çıkış (clock-in/out)**: personel kendi hesabıyla uygulama üzerinden damgalar (Personel Yönetimi modülü)
- **RFID kart ile damgalama**: **Kartlı Vardiya** modülü (₺4.000 tek seferlik) ile personel, ucuz bir USB kart okuyucuya kartını okutarak giriş-çıkış yapar. QR ile damgalama **yoktur**
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

Yemeksepeti, Getir ve Trendyol Yemek platformlarından gelen siparişleri tek panelden yönetme. Her platform **ayrı bir yıllık entegrasyon kalemidir** (lisans ön koşuluyla) ve birikir: birden fazla platform aynı anda açık olabilir, hepsi tek mutfak akışına düşer.

**Detay**

- **Yemeksepeti webhook**: yeni sipariş otomatik POS'a düşer (PENDING). Restoran kabul/red ederse durum platforma yazılır
- **Getir / Trendyol Yemek webhook**: aynı akış
- **Sipariş eşleştirme**: platform ürün adı ↔ kendi menü ürün adı, manuel eşleştirme veya otomatik fuzzy match
- **Fiyat senkronizasyonu** (manuel): platformdaki fiyat farklı olabilir; kendi sistem fiyatı bağımsızdır
- **Sipariş hazır bildirimi**: kurye çağırma (Yemeksepeti API)
- **Çoklu hesap**: birden fazla restoran hesabı tek tenant'a bağlanabilir
- **Hata izleme**: platform bağlantısı koparsa webhook retry + Sentry alarmı

---

## 12. Çok Şube ve Markalaşma

Aynı sahibe ait birden çok şubeyi tek panelden yönetme + her şubeye özel marka. Şube paneli ve özel marka **ücretsiz çekirdeğin parçasıdır**; ücretli olan tek şey ikinci ve sonraki şubelerdir (**Ek Şube** kalemi, yıllık, adet bazlı).

**Detay**

- **Multi-location**: ilk şube ücretsizdir; her **Ek Şube** kalemi kapasiteyi +1 artırır (en fazla 100 adet). Her şube ayrı bir Tenant değil, ana tenant altında bir lokasyon kaydı
- **Lokasyon-bazlı menü override**: bir şubenin fiyatı farklı olabilir; ana menü temel, lokasyon override'lar üstüne biner
- **Birleşik raporlar**: tüm şubelerin satışı, en iyi performans gösteren şube, lokasyon-kıyaslama
- **Özel marka (custom branding)**: logo, ana renk, font, QR menü banner görseli — ücretsiz
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
- **Gelişmiş raporlar (advancedReports)**: **Gelişmiş Rapor & Analitik** modülü gerekir (yıllık, lisans ön koşuluyla) — yıllık karşılaştırma, sezonsallık analizi, demografik müşteri segmentasyonu, muhasebe back-office
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
- Lisans & Erişim (`/admin/license`): lisans durumu, sahip olunan ürünler, kontör bakiyeleri, yenileme tarihi ve faturalar
- Mağaza (`/admin/store`): katalogdan kalem seçme, anlık toplam, tek ödemeyle satın alma
- Settings: POS toggle'ları, QR menü görünümü, branding, rezervasyon ayarları, SMS sağlayıcı, muhasebe entegrasyonu

### b. SuperAdmin Paneli (`/superadmin/*`) — Platform Operatörü

Tüm tenant'ları üst seviyeden yöneten platform-sahibi paneli. Koyu zinc teması, 2FA zorunlu (TOTP).

- Dashboard: platform geneli KPI (toplam tenant, aktif lisans, gelir, churn)
- Tenants: tüm restoranlar listesi, sahip olunan ürünler, durum, son giriş; tenant-bazlı grant override
- Users: tüm tenant kullanıcıları, email doğrulama override, kilit açma
- Marketplace (`/superadmin/marketplace`): à-la-carte katalog yönetimi — ürün, fiyat ve komisyon oranı. Eski `/superadmin/plans` ve `/superadmin/subscriptions` yolları buraya yönlenir
- Audit Logs: tüm platform aksiyonları (kim, ne zaman, hangi tenant, hangi alanı değiştirdi)
- Outbox: olay kuyruğu izleme ve yeniden kuyruğa alma (requeue)
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
- Offers: lead'e özel teklif, geçerlilik tarihi (`validUntil`)
- Commissions: kendi komisyonları, detay modal, audit timeline
- Reports: kaynak dağılımı, bölgesel performans, conversion funnel (manager-only)
- Users: ekip üyeleri (manager-only)

---

## 15. Pazarlama / Satış Modülü

Pazarlamacıların yeni müşteri kazanırken referans kodu kullanması ve **her gerçekleşen ödemeden komisyon** alması için kurulu satış modülü. Lead → Convert → Commission zinciri ile çalışır.

**Detay**

- **Referans kodu**: her pazarlamacının panelinde benzersiz kod (örn. `MRT9X3K`)
- **URL paylaşımı**: `kds.app/?ref=MRT9X3K`
- **Ödemeye bağlanma**: kod checkout intent'i oluşturulurken referans dizininden çözülür ve `referralCode` + `referredByMarketingUserId` olarak kayda yazılır; geçersiz kod sessizce yok sayılır, ödeme bloklanmaz
- **Komisyon tipleri**:
  - **SIGNUP** — ödenen sepette lisans olan ödeme (ücretli tarafa ilk geçiş ve yıl dönümü yenilemesi; lisans da yenilenen bir kalemdir)
  - **UPSELL** — lisansı aktif olan müşterinin yıl içinde yeni kalem eklemesi
  - **RENEWAL** — komisyon defterinin yenileme tipi
- **Hesaplama**: ödenen sepetin **toplam tutarı** × sepetteki **en yüksek tutarlı kalemin** komisyon oranı
- **Onay akışı**: PENDING → APPROVED (manager onay) → PAID (ödeme yapıldı). Audit log her geçişi kayıt eder
- **Per-product oran**: her katalog ürününe ayrı komisyon yüzdesi (`MarketplaceAddOn.commissionRate`, default %10), SuperAdmin değiştirebilir
- **Referans donması**: referans kodu ödeme anında çözülür ve kayda donar — pazarlamacı kodunu sonradan yenilese bile geçmiş satış yeniden atanmaz
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
- **Mesafeli satış sözleşmesi**: mağaza checkout'unda zorunlu onay; sözleşme metni LegalDocument modelinde versiyonlu saklanır
- **İade ve cayma politikası**: aynı şekilde versiyonlu onay
- **Consent versiyonlama**: doküman güncellenirse müşteri checkout'ta yeni versiyonu onaylar; eski onayları audit'te kalır
- **Şifre güvenliği**: bcrypt cost 12, min 8 karakter, büyük/küçük + rakam zorunlu
- **JWT realm ayrımı**: tenant, marketing, superadmin — her birinin kendi secret'ı; secret eşit olamaz
- **Refresh token rotation**: her refresh'te token yenilenir, eski token revoked olur
- **Rate limiting (throttler)**: payment-intent 5/dk, login 10/dk, global 100/dk
- **2FA (SuperAdmin)**: TOTP zorunlu; replay guard (60 sn aynı kod kullanılamaz)
- **Audit log**: kritik aksiyonlar (katalog/fiyat değişimi, kullanıcı silme, komisyon onay) audit_logs tablosuna yazılır
- **IP allowlist**: PayTR webhook'u IP-allowlist guard ile (defence in depth, HMAC ana güvenlik)
- **HMAC doğrulama**: PayTR webhook'unda merchant key + salt ile hash kontrol
- **Veritabanı şifreleme**: entegrasyon kimlik bilgileri ve webhook secret'ları AES-256-GCM ile at-rest şifreli saklanır (`common/helpers/encryption.helper.ts`). Kart bilgisi hiç saklanmaz — tahsilat PayTR tarafında yapılır, kayıtlı kart / otomatik çekim kullanılmaz
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
  - Yenileme hatırlatması (yıl dönümüne 30 / 7 / 1 gün kala, tutar ve kalem listesiyle)
  - Ödeme başarılı / fatura hazır
  - Ek süreye düşen kalem uyarısı (past due)
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
  - Admin: düşük stok, yaklaşan/geçen yenileme, yeni rezervasyon
- **SMS** (ayar): rezervasyon onay/hatırlatma SMS, sadakat puanı SMS
- **Push** (gelecek): mobil uygulama bildirimi için altyapı hazır

---

## 18. Operasyon ve Destek

Sistemi yöneten ekip için izleme, müdahale ve destek araçları.

**Detay**

- **Sentry**: kritik hata yakalama (ödeme hataları, webhook bad-hash, provisioning hataları, komisyon kredilendirme hataları)
- **Logging**: NestJS Logger her servis için, request middleware ile tüm HTTP istek logları
- **Health endpoint**: `/api/health` — Docker liveness/readiness probe
- **Cron izleme**: her cron job log mesajı atar; yenileme işleri advisory lock ile korunur, çok replikada tek kez çalışır
- **Yenileme cron'ları**: 06:00 yenileme cycle'ının oluşturulması, 09:00 hatırlatmalar, 00:30 ek süresi biten cycle'ların kapatılması, 03:00 add-on sweeper
- **Manuel müdahale** (SuperAdmin): outbox kuyruğundan olay yeniden kuyruğa alma (requeue)
- **Backup**: PostgreSQL günlük snapshot (deploy dışında ayrı süreç)
- **Migration**: `prisma migrate deploy` ile prod; downtime sıfır (forward-only)
- **Seed**: `seed.ts` (temel veri), `seeds/seed-marketplace.ts` (à-la-carte katalog), `seed-platform-users.ts` (e2e users), `seed-demo.ts` (Sultanahmet demo tenant)
- **Destek**: standart destek e-posta ile, iş günü saatlerinde ve ücretsiz çekirdek dahil herkese açıktır. **Bakım, Destek ve Güncelleme** kalemi alındığında talepler öncelikli sıraya girer ve garantili yanıt süresi uygulanır (ayrı bir modül değildir, bu kalemin içindedir)
- **API erişimi**: **API & Webhook Erişimi** modülü gerekir (yıllık, lisans ön koşuluyla) — müşteri kendi entegrasyonu için API key alır (apiKeyHash ile saklanır)
- **Deployment**: Docker Compose (db + backend + frontend + redis); CI build → image registry → docker swarm / k8s deploy
- **CI/CD**: GitHub Actions; PR → typecheck + unit tests + e2e suite + lint
- **Monitoring**: Grafana + Prometheus (deploy ortamında)

---

*Bu döküman canlı bir referanstır — modüller eklendikçe veya katalog/fiyat değişiklikleri olursa güncellenir. Pazarlama, satış, ürün ve destek ekipleri sahaya çıkmadan önce buradan bir bakış geçirebilir.*
