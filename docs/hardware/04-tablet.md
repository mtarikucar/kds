# Tablet (Garson ve Musteri/Masa Tableti)

> HummyTummy donanım kataloğu — cihaz tipi: `tablet_waiter` / `tablet_customer`
> Belge tipi: device · Bağlantı: **cloud-direct** (köprü gerekmez) · Sürüm: 2026-07
> Hedef okuyucu: restoran operatörü **ve** yetkili bayi/satıcı.

Bu belge iki farklı kullanım senaryosunu tek başlık altında toplar:

- **Garson tableti / el terminali (`tablet_waiter`)** — personelin masada sipariş aldığı, adisyon açtığı, KDS'e mutfak/bar çıktısı gönderdiği cihaz. Sunmi V2 Pro (dahili yazıcılı el terminali) bu rol için tipik üründür; Samsung Galaxy Tab A9+ de garson tableti olarak kullanılabilir.
- **Müşteri / masa tableti (`tablet_customer`)** — masaya sabitlenen, misafirin kendi kendine menüyü gezip sipariş verdiği kiosk-kilitli tablet. Genellikle Samsung Galaxy Tab A9+ bu rol için tercih edilir. Bu senaryoda **KVKK** ve **kiosk/MDM kilidi** kritik hale gelir.

---

## 1. Genel bakış

**Cihaz nedir?** Android tabanlı, dokunmatik bir tablet ya da yazıcılı el terminali. HummyTummy SaaS'ın kiosk istemcisini (Tauri kabuğu içinde React uygulama — referans: `apps/kds-kiosk`) veya web SPA'yı tam ekran çalıştırır ve **doğrudan buluta** (cloud-direct) bağlanır.

**Sistemdeki rolü.** HummyTummy'de her fiziksel cihaz veritabanında bir `Device` kaydıdır ve `Device.kind` alanıyla tiplenir. Tablet iki kind değerinden birini alır:

| `Device.kind` | Rol | Tipik ürün |
|---|---|---|
| `tablet_waiter` | Garson el terminali / sipariş tableti | Sunmi V2 Pro, Galaxy Tab A9+ |
| `tablet_customer` | Masaya sabit müşteri self-servis tableti | Galaxy Tab A9+ |

**Hangi akışlara girer?**
- **Sipariş / adisyon akışı:** Garson tableti POS akışını sürer — masa seç, ürün ekle, modifiye et, mutfağa/bara gönder. Gönderilen kalemler Device Mesh üzerinden `kds_screen` / `bar_screen` cihazlarına düşer.
- **Self-servis akışı (müşteri tableti):** Misafir menüyü gezer, sepet oluşturur, sipariş verir; istenirse QR/self-pay ödeme akışına bağlanır.
- **Bağlantı topolojisi:** Tablet **cloud-direct** bir cihazdır — `Device.bridgeId = null`. Yani WSS/HTTP ile doğrudan bulut backend'e (NestJS) bağlanır; HummyBox köprüsü ARKASINDA çalışmaz. (Köprü yalnızca LAN çevre birimleri — yazarkasa, ESC/POS yazıcı, kart POS terminali — için gereklidir.)
- **Sahiplik / kapasite alanları:** `Device.ownership` = `sold` (satıldı) / `rented` (kiralandı) / `byo` (müşterinin kendi cihazı). `Device.warrantyUntil` garanti bitiş tarihi. `Device.capabilities[]` yetenek etiketleri taşır (ör. Sunmi için `['print_58mm','scan_barcode','nfc']`; sade tablet için genelde boş ya da yalnızca ekran).

**Önemli mali not.** Sunmi V2 Pro'nun dahili 58mm termal yazıcısı yalnızca **bilgi fişi / adisyon (hesap sureti)** basabilir. Bilgi fişi **mali belge DEĞİLDİR.** Mali fiş yalnızca onaylı ÖKC/yazarkasadan (Hugin/Beko adaptörleri, GMP-3 `fiscal_coupled` akışı) kesilir. Garson tabletinden alınan sipariş, mali fiş kesimi için köprü arkasındaki yazarkasaya/e-Fatura rayına yönlendirilir.

---

## 2. Modeller ve teknik özellikler

Katalogda tablet kategorisi altında iki SKU vardır. Her ikisi de mağazadan (`/admin/store`) satın alınabilir; ödeme tamamlanınca device-mesh cihaz slotu otomatik açılır (bkz. Bölüm 4).

> **Fiyat/garanti notu:** Güncel perakende fiyat **katalogdan/QuoteService'ten** gelir (tek yetkili kaynak; **KDV %20 dahil**). Aşağıdaki rakamlar yalnızca bağlayıcı-olmayan örnek değerlerdir; alış maliyeti ve marj distribütör teklifine göre değişir ve burada bağlayıcı değildir. Garanti süresi tarafların kararlaştırdığı süredir: **Mağaza (`/admin/store`) satışı restoran işletmesine yapılan B2B satıştır**, tüketici asgari garanti kuralları kural olarak uygulanmaz (yatay kural için bkz. Bölüm 8 ve `00-genel-cerceve.md`).

### SKU-1 — Sunmi V2 Pro (yazıcılı Android el terminali)

Garson/adisyon için birincil öneri. Tek elde tutulur, dahili 58mm yazıcı + barkod tarayıcı + NFC içerir.

| Özellik | Değer |
|---|---|
| Kategori fiyatı (katalog) | Katalog/QuoteService'ten gelir (**KDV %20 dahil**); örnek/bağlayıcı-olmayan değer **~14.000 TL** *(güncel fiyat katalogdan; burada bağlayıcı değil)* |
| Garanti süresi | Üretici garantisi **12 ay** — **B2B satışta geçerlidir** (taraflarca kararlaştırılan süre; tüketici 2 yıl asgarisi tacirler arası satışta kural olarak uygulanmaz, bkz. Bölüm 8) |
| Ekran | 5,99" HD+ IPS, 1440×720, kapasitif çoklu dokunma *(datasheet'ten teyit edilmeli)* |
| İşlemci | Qualcomm Snapdragon quad-core (Cortex-A53, ~1,4 GHz) *(teyit edilmeli)* |
| Bellek | 2 GB RAM / 16 GB ROM (parti sürümüne göre değişebilir — **teyit edilmeli**) |
| İşletim sistemi | Android tabanlı SUNMI OS (genelde Android 7.1/9; sipariş partisine göre — **teyit edilmeli**) |
| Dahili yazıcı | 58mm termal, ~70 mm/s, kağıt rulo çapı ~40 mm, kağıt genişliği 57,5±0,5 mm |
| Barkod | Dahili 1D/2D tarayıcı |
| Kablosuz | Wi-Fi 2,4/5 GHz (802.11 a/b/g/n), Bluetooth (BLE), 4G/LTE, NFC |
| Batarya | Li-Po, çıkarılamaz, ~7,6 V / 2580 mAh |
| Fiziksel | ~13 mm ince gövde; avuç içi el terminali formu |
| Bağlantı topolojisi | **cloud-direct** (`bridgeId = null`), WSS/HTTP |
| Tipik `capabilities[]` | `print_58mm`, `scan_barcode`, `nfc` |

> **Satış-kritik uyumluluk kontrolü:** HummyTummy kiosk istemcisinin (Tauri/WebView) Android 7.1 gibi eski bir sürümde çalışıp çalışmayacağı (min-SDK / WebView / Tauri uyumu) teslim edilen partinin OS sürümüne göre **teyit edilmeli.**

### SKU-2 — Samsung Galaxy Tab A9+ 11" (Wi-Fi: SM-X210 / hücresel: SM-X216)

Masa/müşteri tableti veya geniş ekranlı garson tableti. Büyük ekran, uzun garanti.

> **Varyant/model uyarısı (giderildi):** Bu cihaz burada Wi-Fi bağlantılı bir masa/kiosk tableti olarak konumlanır. Model eşlemesi doğrulanmıştır: **SM-X210 = yalnızca Wi-Fi varyant**, **SM-X216 = hücresel (5G) varyant**. Yalnızca Wi-Fi kullanılacaksa doğru SKU **SM-X210**'dur (genelde daha ucuz). Hücresel SM-X216, ek telsiz modülü içerdiğinden RED/BTK tip onayı kapsamı genişleyebilir. Doğru varyant sipariş öncesi kesinleştirilmeli.

| Özellik | Değer |
|---|---|
| Kategori fiyatı (katalog) | Katalog/QuoteService'ten gelir (**KDV %20 dahil**); örnek/bağlayıcı-olmayan değer **~11.000 TL** *(güncel fiyat katalogdan; burada bağlayıcı değil)* |
| Garanti süresi | Üretici garantisi **24 ay** (Samsung TR tipik); B2B satışta taraflarca kararlaştırılan süre geçerlidir *(kurumsal kanalda kapsam farklı olabilir — teyit edilmeli)* |
| Ekran | 11" TFT LCD, 1920×1200, 90 Hz, ~206 ppi |
| İşlemci | Qualcomm Snapdragon 695 5G (SM6375), sekiz çekirdek |
| Bellek | 4/8 GB RAM, 64/128/256 GB depolama (varyanta göre; microSD ile genişletilebilir) |
| İşletim sistemi | Android 13 + One UI (çıkışta); OS/güvenlik güncelleme destek süresi *(Samsung resmi destek takviminden teyit edilmeli — kaç major OS + kaç yıl güvenlik yaması)* |
| Batarya | 7040 mAh, ~15W şarj |
| Bağlantı | Wi-Fi (dual-band), Bluetooth. Hücresel gerekiyorsa SM-X216 varyantı (LTE/5G). |
| Ses/kamera | Dört hoparlör (Dolby Atmos), ön/arka kamera |
| Bağlantı topolojisi | **cloud-direct** (`bridgeId = null`), WSS/HTTP |
| Tipik `capabilities[]` | (boş — sade ekran cihazı; yazıcı/tarayıcı yeteneği yok) |

**Seçim rehberi (bayi için):**
- Masada dolaşan garson, hesap sureti/adisyon bassın isteniyorsa → **Sunmi V2 Pro** (dahili yazıcı bilgi fişi için yeterli).
- Menü gezme, self-servis sipariş, büyük görsel menü, masa tableti → **Galaxy Tab A9+** (11" büyük ekran, kiosk kilidi ile).
- İkisi de cloud-direct'tir; ikisi de köprü olmadan çalışır.

---

## 3. Kullanim / operasyon

### 3.1 Garson tableti (`tablet_waiter`) — günlük akış

1. **Vardiya başı:** Cihazı şarjdan al, aç. HummyTummy uygulaması açık (kiosk kilidi varsa doğrudan açılır). Personel PIN/parolayla oturum açar.
2. **Masa seç:** Salon/kat planı veya masa listesinden masayı seç. (Floor-plan canlı harita etkinse masa durumu renkli görünür.)
3. **Sipariş al:** Menüden ürün ekle, modifiye et (porsiyon, ekstra, not), adet gir. Kalemler adisyona işlenir.
4. **Mutfağa/bara gönder:** "Gönder"e bas → kalemler Device Mesh üzerinden ilgili `kds_screen`/`bar_screen` ekranlarına düşer; kategori bazlı yönlendirme (mutfak/bar) uygulanır.
5. **Adisyon/hesap sureti (opsiyonel):** Sunmi V2 Pro'da dahili yazıcıdan **bilgi fişi** (hesap sureti) bası alınabilir. Bu MALİ FİŞ DEĞİLDİR.
6. **Ödeme:** "Ödemeye geç" → nakit/kart/QR. Kart entegre terminalle çekilecekse GMP-3 `fiscal_coupled` akışı köprü arkasındaki kart POS terminaline gider. Mali fiş yazarkasadan kesilir.
7. **Masa kapatma:** Ödeme onaylanınca masa serbest kalır; canlı harita güncellenir.
8. **Vardiya sonu:** Oturumu kapat, cihazı şarja tak. Sunmi'de kağıt rulosunu kontrol et.

### 3.2 Müşteri/masa tableti (`tablet_customer`) — günlük akış

1. **Açılışta** cihaz kiosk modunda tek uygulamaya kilitli açılır (misafir başka uygulamaya/ayarlara çıkamaz).
2. **Misafir** menüyü gezer, ürün seçer, sepete ekler, notlar girer.
3. **Sipariş verir;** sipariş doğrudan mutfağa/POS'a düşer.
4. **Ödeme (varsa)** self-pay/QR akışıyla yapılır.
5. **Masa değişiminde** oturum otomatik/elle temizlenir — bir sonraki misafir önceki sepeti/veriyi görmez (KVKK gereği; bkz. Bölüm 10).
6. **Kapanışta** personel tabletleri toplar/şarj eder, ekranı siler.

---

## 4. Kurulum ve sisteme baglama

### 4.1 Fiziksel kurulum

**Sunmi V2 Pro (garson):**
- Kutudan çıkar, tam şarj et (ilk şarj tavsiye edilir).
- Kağıt rulosunu tak (58mm, ~40 mm çap). Kapağı klik sesiyle kapat.
- Wi-Fi'a bağla; kapsama zayıfsa 4G SIM tak (hücresel veri kullanılacaksa).
- İsteğe bağlı: masa üstü şarj/dock, boyun/bel askısı, koruyucu kılıf.

**Galaxy Tab A9+ (müşteri/masa):**
- Şarj et. Masa tableti ise **hırsızlık önleyici stand + Kensington/kilit** ve masaya sabit **şarj kablosu geçişi** (kablo kanalı) planla.
- Wi-Fi'a bağla (kurumsal SSID önerilir; misafir Wi-Fi'ından ayrı).
- **Kiosk/MDM** profili uygula (bkz. 4.4).

### 4.2 Provizyon (otomatik slot açılması — satış akışı)

HummyTummy satış akışı cihaz slotunu otomatik hazırlar:

1. Bayi/operatör **Mağaza** (`/admin/store`) üzerinden tableti sepete ekler → **PayTR** ödemesi.
2. Sipariş **ÖDENİNCE** device-mesh cihaz slotu **otomatik açılır** — deterministik `provisionKey` + PostgreSQL advisory-lock ile, **idempotent** (aynı sipariş iki kez slot açmaz).
3. Kategori→cihaz eşlemesi: **`tablet` kategorisi → `tablet_waiter`** olarak provizyon edilir. (Müşteri tableti isteniyorsa slot sonradan `tablet_customer` olarak ayarlanır/etiketlenir.)
4. Bu adımın sonunda admin panelde cihaz için bir slot ve eşleştirmeye hazır durum oluşur.

> Not: `cash_drawer`, `other`, `service` kategorileri provizyon edilmez; tablet edilir.

### 4.3 Eşleştirme (pairing) — cihazı hesaba bağlama

Referans istemci `apps/kds-kiosk` ile birebir aynı akış (tablet uygulaması aynı `/v1/devices/*` API'sini kullanır):

1. **Admin panelde** cihaz slotu için bir **pairCode** üretilir.
   - pairCode **6 karakterlik ALFANUMERİK** bir koddur — alfabe `A-Z` + `0-9` (ör. `a4f9k2`). **Salt numerik değildir**; kullanıcıya "numerik keypad" beklentisi yaratılmamalı, "6 karakterlik (harf+rakam) kod" olarak sunulmalı.
   - pairCode **10 dakika** geçerlidir.
   - Şube başına en çok **10 bekleyen (pending) slot** olabilir (spam/kirlenme koruması).
2. **Tablet uygulaması** ilk açılışta API URL + pairCode ister; `POST /v1/devices/pair` çağırır.
3. Bulut tarafında **tek-kullanımlık atomik claim** yapılır (aynı pairCode ikinci kez kullanılamaz).
4. Yanıtta **sha256-hash'li, dönen (rotating) bearer token** döner:
   - **Ham token yalnızca BİR kez** döner; sunucuda **at-rest hash'lenmiş** saklanır (düz metin token DB'de tutulmaz).
   - **Token TTL: varsayılan 24 saat** (`DEVICE_TOKEN_TTL_MS`) ve token **yalnızca pair anında** verilir; bu varsayılan **pairCode ile eşleşen cihaz `Device.kind`'leri** için geçerlidir — **`local_bridge` HARİÇTİR** (köprü bu 24 saatlik DEVICE token'ını taşımaz; kendi **30 günlük** bearer token'ını taşır — `LOCAL_BRIDGE_TOKEN_TTL_MS`). **Heartbeat token süresini UZATMAZ:** `heartbeat()` metodu SADECE `status` ve `lastSeenAt` alanlarını günceller, `tokenExpiresAt`'e DOKUNMAZ (kayan/sliding TTL **değildir**). Token pair'den **24 saat sonra dolar**; süresi dolan token `authenticateToken` tarafından reddedilir. Main/prod dalında token yenileme (refresh) yoktur; bu yüzden cihaz devam edebilmek için **yeniden pair** olmalıdır (yeni 6 karakterlik pairCode).
   - **Operasyonel gereklilik:** Token pair'den 24 saat sonra dolduğundan, cihaz düzenli heartbeat atsa bile token süresi uzamaz; çalışmaya devam edebilmesi için token 24 saatte bir **yeniden pair** ile tazelenmelidir. **ÖNEMLİ NOT:** "heartbeat token süresini uzatır / kayan TTL" davranışı yalnızca **henüz merge edilmemiş** `fix/device-mesh-token-renewal` dalında vardır; main/prod'da **geçerli değildir**.
5. Tablet token'ı güvenli depoya (OS keyring / güvenli tercih deposu) yazar → yeniden başlatmada oturum korunur (TTL süresince).
6. Cihaz düzenli **heartbeat** atar (`heartbeat()` yalnızca `status` ve `lastSeenAt` günceller; **token süresini uzatmaz**) ve komut/verisini bulut backend'den çeker. Tablet **cloud-direct** olduğu için köprüye ihtiyaç yoktur.

**Sorun anında:** pairCode 10 dk içinde girilmezse yenisini üret. "Zaten claim edilmiş" hatası → slot başka cihaza bağlanmış; yeni slot aç veya mevcut cihazı retire et.

### 4.4 Kiosk / MDM kilidi (özellikle müşteri tableti — satış değeri + güvenlik)

- **Tek-uygulama pinning:** Cihazı yalnızca HummyTummy uygulamasına kilitle (misafir ayarlara/başka uygulamaya çıkamaz).
- **Uzaktan kilit/silme (remote lock/wipe):** Kayıp/çalınan cihazı uzaktan kilitle veya sil.
- **Politika:** Ekran her zaman açık, otomatik güncelleme penceresi, USB/harici erişim kısıtı, mağaza dışı kurulum engeli.
- **Uygulama yolları:** Samsung tarafında **Knox** tabanlı MDM (Knox Manage / uyumlu 3. parti MDM) ile kurumsal kiosk profili; Android **COSU/kiosk** (Fully Kiosk gibi araçlar) alternatif. Sunmi'de üretici cihaz-yönetim araçları ile benzer kilit.
- **Bayi satış argümanı:** Kiosk + uzaktan yönetim, hem misafirin cihazı kurcalamasını engeller hem de KVKK oturum temizleme + hırsızlık riskini yönetir. Bu, tablet satışını "kurulumlu paket" olarak yükseltir.

---

## 5. Tedarik ve saglayici

> Fiyat/marj ve stok rakamları piyasaya ve tarihe göre hızla değişir; güncel perakende fiyat için **katalog/QuoteService** yetkili kaynaktır (KDV %20 dahil). Alış maliyeti/marj distribütör teklifine bağlıdır; her somut rakam **teyit edilmeli** olarak işaretlenmiştir. Nihai teklif öncesi distribütörden güncel liste alın.

### Sunmi V2 Pro

- **Üretici:** SUNMI (Shanghai Sunmi Technology).
- **Türkiye kanalı:** Yetkili çözüm ortağı/distribütör kanalı üzerinden temin edilir. Arama sonuçlarında öne çıkan bir satıcı: **Desnet Teknoloji** (desnet.com.tr, el terminali/barkod odaklı). Ancak bu tek bir arama-sonucu satıcıdır; **SUNMI'nin resmî/tek Türkiye distribütör kimliği doğrulanmamıştır** *(resmi kaynaktan teyit edilmeli).* Ayrıca çözüm entegratörleri ve pazaryerleri (n11, Trendyol) üzerinden de bulunur. Gri ithal/belgesiz cihaz garanti ve piyasaya arz riski taşıdığından, CE+AEEE işaretli, faturalı ve resmî kanaldan tedarik esastır; garanti RMA'sının hangi tüzel kişi üzerinden yürüdüğü sözleşmede netleşmeli.
- **Tedarik süresi:** Stoktan genelde birkaç iş günü; ithalat/parti gerekiyorsa daha uzun — **distribütörden teyit edilmeli.**
- **Alış maliyeti ve marj:** Güncel perakende satış fiyatı **katalogdan/QuoteService'ten** gelir (tek yetkili kaynak, KDV %20 dahil); bölüm 2'deki ~14.000 TL yalnızca bağlayıcı-olmayan örnektir. Bayi **NET alış maliyeti distribütör teklifine bağlıdır ve burada bağlayıcı değildir — teyit edilmeli.** Marj = satış − alış − (nakliye + garanti karşılığı + kur riski); alış girdisi olmadan marj hesaplanamaz. Kesin oran uydurulmamalı, sözleşmeden alınmalı.
- **Alternatif kaynak:** Sunmi'nin muadil yazıcılı el terminalleri (ör. aynı ailenin diğer modelleri) veya farklı marka Android el terminalleri; ancak dahili 58mm yazıcı + entegrasyon uyumu doğrulanmalı.

### Samsung Galaxy Tab A9+ (SM-X210 Wi-Fi / SM-X216 hücresel)

- **Üretici:** Samsung Electronics.
- **Türkiye kanalı:** Samsung Türkiye yetkili distribütör/bayi ağı (yaygın kurumsal ve perakende kanal). Kurumsal alımda **Samsung B2B / yetkili iş ortağı** kanalı garanti ve toplu fiyat için önerilir. **Yetkili distribütör listesi teyit edilmeli.**
- **Model teyidi:** **SM-X210** = yalnızca Wi-Fi varyant; **SM-X216** = hücresel (LTE/5G) varyant. Wi-Fi kullanılacaksa **SM-X210** teklif edin (maliyet daha düşük olabilir). Doğru varyant sipariş öncesi netleştirilmeli.
- **Tedarik süresi:** Yaygın ürün olduğundan genelde kısa; toplu adet için **teyit edilmeli.**
- **Alış maliyeti ve marj:** Güncel perakende satış fiyatı **katalogdan/QuoteService'ten** gelir (tek yetkili kaynak, KDV %20 dahil); bölüm 2'deki ~11.000 TL yalnızca bağlayıcı-olmayan örnektir. Tabletlerde marj el terminaline göre daha incedir (yaygın tüketici ürünü, fiyat şeffaf); bayi değeri **kiosk kurulumu + MDM + stand/aksesuar + hizmet paketinden** gelir. **Kesin alış/marj distribütör teklifine bağlıdır, burada bağlayıcı değildir.**
- **Alternatif kaynak:** Aynı sınıf Android tabletler (Lenovo Tab, diğer Galaxy Tab modelleri); ancak Knox/MDM ve garanti kanalı farkı değerlendirilmeli.

---

## 6. Bakim ve sarf malzeme

### Sunmi V2 Pro

- **Sarf — termal kağıt rulo:** 58mm genişlik, ~40 mm çap. Yalnızca **termal** rulo kullanın (mürekkep/şerit yoktur). Rulo bittiğinde yenisi takılır — vardiya başı stok kontrolü önerilir.
- **Termal kafa temizliği:** Cihaz kapalıyken izopropil alkol + pamuk ile baskı kafası silinir (soluk/çizgili baskıda). Kesici/kağıt yolunda toz/etiket artığı temizlenir.
- **Batarya:** Çıkarılamaz Li-Po. Tam boşaltıp aşırı ısıtmaktan kaçının; gün içi ara şarj ömrü uzatır. Şişme/deformasyon görülürse kullanımı durdurun (bkz. Bölüm 9 pil güvenliği).
- **Firmware/uygulama:** SUNMI OS güncellemelerini kontrollü (vardiya dışı) uygulayın. HummyTummy uygulaması OTA/paket ile güncellenir. Güncelleme öncesi token/keyring bozulmadığını doğrulayın (bozulursa yeniden pair gerekir).
- **Fiziksel:** Ekran ve gövde nemli mikrofiber ile silinir; aşındırıcı kullanmayın. Kılıf/askı aşınmasını kontrol edin.

### Galaxy Tab A9+

- **Sarf:** Yok (yazıcısız). Aksesuar ömrü: şarj kablosu/adaptör, stand, koruyucu cam.
- **Batarya:** Masa tableti sürekli takılı çalışıyorsa **%100'de sürekli tutmak** yerine akıllı şarj/limit (varsa) kullanın; ısınmayı azaltın, iyi havalandırılan stand seçin.
- **Ekran/temizlik:** Yoğun dokunulan müşteri tableti için gün içi hijyen silme (ekrana uygun, alkol oranı üreticinin izin verdiği düzeyde) *(teyit edilmeli).*
- **Yazılım:** Samsung güvenlik yamaları ve One UI güncellemeleri; MDM ile merkezî ve kontrollü dağıtım. Kiosk uygulaması güncellemesini pilot cihazda test edip filoya yayın. *(Desteklenmeyen OS = yamalanmayan güvenlik açığı → veri güvenliği riski; destek süresi Samsung takviminden teyit edilmeli.)*

---

## 7. Sorun giderme ve ariza

| Belirti | Olası neden | Çözüm | Ne zaman RMA |
|---|---|---|---|
| Eşleştirme "kod geçersiz/süresi doldu" | pairCode 10 dk'yı geçti veya yanlış (6 karakterlik harf+rakam kodu) | Admin panelde yeni pairCode üret, tekrar dene | — |
| "Zaten claim edilmiş" | Slot başka cihaza bağlandı (tek-kullanımlık claim) | Yeni slot aç; eski cihazı retire et | — |
| Oturum düşüyor / 401 | **Token TTL doldu** — token yalnızca pair anında verilir ve pair'den 24 saat sonra dolar; heartbeat süresini uzatmaz | **Cihazı yeniden pair et** (yeni 6 karakterlik pairCode). Prod'da token yenileme yoktur; token 24 saatte bir yeniden pair ile tazelenir | Ağ/pair ile çözülüyorsa RMA gerekmez |
| Ürün göremiyor / senkron yok | Wi-Fi/4G kesik (cloud-direct) | Bağlantıyı düzelt; kapsama zayıfsa AP ekle/4G'ye geç | — |
| Sunmi baskı soluk/boş | Termal kağıt ters takılı / kafa kirli / rulo bitti | Ruloyu doğru yönde tak, kafayı temizle, rulo değiştir | Temizlik sonrası hâlâ basmıyorsa yazıcı arızası → RMA |
| Sunmi kağıt sıkışması | Yanlış çap/kalite kağıt, artık | Kağıt yolunu temizle, uygun 58mm rulo | Kesici mekanik arızası → RMA |
| Barkod okumuyor (Sunmi) | Lens kirli / uygulama izni | Lensi temizle, tarayıcı iznini kontrol et | Donanım tarayıcı ölü → RMA |
| Tablet aşırı ısınıyor / şişme | Batarya arızası / sürekli %100 şarj | Kullanımı durdur, şarjdan çek, izole et | **Şişme = derhal RMA/güvenli imha** |
| Dokunmatik çalışmıyor / ölü piksel bant | Panel arızası veya donma | Yeniden başlat, güncelle | Donanımsa RMA |
| Kiosk kilidinden çıkılabiliyor | MDM/pinning profili eksik | Kiosk profilini yeniden uygula | — |
| Şarj tutmuyor / kapanıyor | Batarya yıpranması | Şarj çevrimini test et | Garanti içi batarya arızası → RMA |

**RMA eşiği:** Yazılım/ağ/sarf kaynaklı sorunlar sahada çözülür. **Donanım arızası** (yazıcı mekanik, tarayıcı ölü, panel, batarya şişme/tutmama, anakart) → RMA. **Batarya şişmesi/aşırı ısınma her zaman acil durumdur** ve cihaz derhal servise/güvenli imhaya yönlendirilir.

---

## 8. Garanti ve RMA sureci

- **Garanti süreleri (katalog):** Sunmi V2 Pro **12 ay**, Galaxy Tab A9+ **24 ay**. Sistemde `Device.warrantyUntil` alanına bu tarih işlenir; bayi teslimde tarihi doğru girmeli.
- **Garanti rejimi (B2B — düzeltildi):** Mağaza (`/admin/store`) üzerinden **restoran işletmesine** yapılan donanım satışı **B2B'dir** (satıcı: HummyTummy/bayi; alıcı: kural olarak **tacir**). 6502 s. Tüketicinin Korunması Hakkında Kanun (Resmî Gazete 28.11.2013, sayı 28835) yalnızca **tüketiciyi** — m.3'e göre "ticari veya mesleki olmayan amaçlarla hareket eden gerçek/tüzel kişi"yi — korur; restorana satış ticari amaçlı olduğundan bu tüketici korumaları (ayıplı maldan uzun süreli sorumluluk, Garanti Belgesi Yönetmeliği'nin (Resmî Gazete 13.6.2014, sayı 29029) tüketici ürünleri için öngördüğü asgari süreler) tacirler arası satışta **kural olarak uygulanmaz.** Bunun yerine 6098 s. Türk Borçlar Kanunu'nun ayıp hükümleri — **m.219** (satıcı ayıptan sorumludur), **m.223** (alıcının muayene ve ihbar külfeti) — ve **tarafların kararlaştırdığı garanti süresi** geçerlidir; TBK ayıp hükümleri emredici olmadığından (m.221 ağır kusur hâli hariç) sözleşmeyle sorumsuzluk/sınırlama kaydı da geçerlidir. Bu nedenle üreticinin verdiği **Sunmi 12 ay / Galaxy 24 ay garanti GEÇERLİDİR ve bağlayıcıdır**; önceki metindeki "12 ay tüketici 2 yıl asgarisine aykırı/uygunsuz" ifadesi **hatalıdır ve kaldırılmıştır.** NOT: (a) alıcı istisnaen **tüketici** sayılırsa (şahıs, ticari amaç dışı), 6502 devreye girer ve Garanti Belgesi Yönetmeliği'nin (Resmî Gazete 13.6.2014, sayı 29029) asgari süreleri gündeme gelir; (b) **tacir alıcı**, TBK m.223 uyarınca ayıbı **muayene ve süresinde ihbar** külfetine tabidir; TTK m.23/1-c bu ihbar için **kesin süreler** koyar — açık (belirgin) ayıpta teslimden itibaren **2 gün**, gizli ayıpta ise ortaya çıkınca **8 gün** içinde ihbar (usulüne uygun ihbar edilmezse mal kabul edilmiş sayılır). Yatay kural için bkz. `00-genel-cerceve.md`.
- **Kapsam:** Üretim/malzeme kaynaklı donanım arızaları. **Kapsam dışı** (genel kural, sözleşmeyle teyit): fiziksel/sıvı hasar, yetkisiz açma/onarım, kullanıcı hatası, sarf (termal kağıt) aşınması, batarya normal yıpranması (üreticiye göre değişir — **teyit edilmeli**).
- **Tüketici istisnası (yalnızca alıcı tüketiciyse):** Alıcı istisnaen tüketici sayılırsa, 6502 s. Kanun (Resmî Gazete 28.11.2013, sayı 28835) ve Garanti Belgesi Yönetmeliği (Resmî Gazete 13.6.2014, sayı 29029) uyarınca genel kural olarak: (1) tabletler garanti belgesi düzenlenmesi zorunlu mallar arasında olabilir (yönetmelik ekindeki listeye tabi — *resmi kaynaktan teyit edilmeli*); (2) yönetmeliğe tabi tüketici ürünlerinde yasal **asgari garanti süresi 2 yıldır (24 ay)**; (3) azami tamir süresi içinde ayıp giderilemezse ücretsiz değişim/iade hakkı doğabilir *(azami tamir süresi eşiği resmi kaynaktan teyit edilmeli)*; (4) satıcı/üretici/ithalatçı müteselsilen sorumlu olabilir *(resmi kaynaktan teyit edilmeli).* **B2B (tacir alıcı) satışta ise** bu tüketici eşikleri yerine TBK ayıp hükümleri + sözleşme serbestisi (tarafların kararlaştırdığı garanti) geçerlidir.
- **RMA akışı (bayi yükümlülükleri):**
  1. Arıza kaydı: cihaz seri no + `deviceId` + `warrantyUntil` + arıza tanımı + görsel.
  2. Ön eleme: yazılım/ağ/sarf mı, donanım mı (Bölüm 7).
  3. Garanti içi ise üretici/distribütör RMA kanalına yönlendir; garanti dışı ise ücretli onarım teklifi.
  4. **Yedek/loaner cihaz:** Kesintisiz operasyon için garson tabletinde yedek cihaz bulundurun; slot yeniden pair edilerek dakikalar içinde devreye alınır.
  5. Değişim/iade: yeni cihaz pair edilir, eskisi sistemde **retire** edilir (canlı pairCode temizlenir, anti-resurrection).
  6. Kayıp/çalıntı: MDM ile uzaktan kilit/silme + sistemde cihazı retire et.
- **Veri:** RMA'ya giden cihazda (özellikle müşteri tableti) oturum/veri temizlenmeli, token iptal edilmeli (KVKK — Bölüm 10).

---

## 9. Regulasyon ve uyumluluk

> Türkiye mevzuatına dayanır. Aşağıdaki her sayısal eşik/tarih/zorunluluk **resmî kaynaktan (Resmî Gazete, ilgili Bakanlık/Kurum) teyit edilmelidir**; kesin rakam/tarih uydurulmamıştır.

- **CE işareti (ithalat şartı):** Tablet ve el terminali gibi elektronik cihazlar **CE işareti** taşımadan ithal edilemez/piyasaya arz edilemez. İthalatçı, üreticinin teknik dosyayı hazırladığını ve uygunluk değerlendirmesini yaptığını güvence altına almalıdır. *(Kolay Ticaret / Ticaret Bakanlığı ithalat denetim rehberi — resmi kaynaktan teyit edilmeli.)*
- **RED / Telsiz Ekipmanları Yönetmeliği (2014/53/AB uyumu):** Wi-Fi/Bluetooth/4G/NFC içeren cihazlar telsiz ekipmanıdır ve Türkiye'nin RED aktarımı olan **Telsiz Ekipmanları Yönetmeliği (2014/53/AB)** kapsamına girer; yönetmelik **Resmî Gazete 5.11.2020, sayı 31295**'te yayımlanmış olup yetkili kurum **BTK (Bilgi Teknolojileri ve İletişim Kurumu)**'dur. Hücresel varyantta (SM-X216) ek telsiz modülü bulunduğundan ek tip onayı gerekebilir.
- **TSE / uygunluk:** İlgili ürün grubuna göre TSE/uygunluk belgeleri gerekebilir — *(ürün ve tarih için resmi kaynaktan teyit edilmeli).*
- **AEEE (WEEE) — elektronik atık:** Güncel referans **Atık Elektrikli ve Elektronik Eşyaların Yönetimi Hakkında Yönetmelik** (Resmî Gazete 26.12.2022, sayı 32055; 2012 tarih ve 28300 sayılı eski "Kontrolü" yönetmeliğinin yerine geçmiştir); üretici/ithalatçı **EÇBS (Entegre Çevre Bilgi Sistemi) portalı** üzerinden kayıt ve toplama yükümlülüğüne tabidir. Cihazlar **üstü çizili tekerlekli çöp kutusu (AEEE)** simgesi taşımalı. Ömrünü tamamlayan tabletler **evsel atığa atılmaz**, lisanslı toplama/geri dönüşüm kanalına verilir. RoHS (zararlı madde kısıtı) da ilgili yönetmelikle bağlantılıdır. Yatay kural için bkz. `00-genel-cerceve.md`.
- **Li-ion pil güvenliği ve taşıma (UN38.3):** Her iki cihaz da lityum-iyon/polimer batarya içerir. Li-ion/Li-Po ürünler (UN3481 — ekipman içi/ile) UN38.3 test uygunluğu, kısa devre koruması ve uygun paketleme gerektirir; hava (IATA-DGR) ve kara (ADR) taşımada tehlikeli madde kuralları uygulanır; hasarlı/şişmiş batarya taşınamaz. Somut Wh/adet eşikleri, ambalaj ve etiketleme (Cargo / PI 966-967 vb.) *(güncel DGR ve taşıyıcıdan teyit edilmeli).*
- **Pil güvenliği (saha):** Şişme, aşırı ısınma, sıvı hasarı gören cihaz kullanımdan alınır; batarya delinmez/yakılmaz; güvenli imhaya (AEEE + atık pil kanalı) verilir.

**Bayi eylem listesi:** CE + AEEE simgeli, faturası/uygunluk belgeli, Türkiye kanalından ürün tedarik edin; belgesiz gri ürün satmayın (ithalat/piyasaya arz ve garanti riski).

---

## 10. KVKK ve veri gizliligi

**Bağlam:** Garson tableti personel tarafından kullanılır (kimlik/oturum, satış verisi). **Müşteri/masa tableti (`tablet_customer`) doğrudan misafirle temas ettiği için KVKK riski en yüksektir.**

- **Kişisel veri riskleri:**
  - Müşteri tableti: sipariş/sepet, self-pay ödeme adımı, olası ad/telefon/e-posta (fiş/çağrı), önceki misafirin oturumu.
  - Garson tableti: personel kimliği, satış/masa verisi; kaybolursa yetkisiz erişim.
  - Kart verisi: **kart bilgisi tablette tutulmaz/işlenmez** — ödeme, GMP-3/PayTR ve köprü arkası kart POS terminali üzerinden yürür (PCI kapsamı cihaz dışında).
- **Oturum temizleme (kritik):** Her masa devrinde müşteri tableti oturumu **temizlenmeli** — bir sonraki misafir öncekinin sepetini/verisini görmemeli. Otomatik oturum sıfırlama + inaktivite zaman aşımı yapılandırın.
- **Aydınlatma/açık rıza:** Telefon numarası ve e-posta gibi veriler **6698 s. KVKK m.3 uyarınca kişisel veridir** ("kimliği belirli veya belirlenebilir gerçek kişiye ilişkin her türlü bilgi"). Müşteri tabletinde kişisel veri alınıyorsa **aydınlatma yükümlülüğü (KVKK m.10)** her hâlde yerine getirilmeli — bu yükümlülük açık rıza olsun olmasın **her veri işlemede** geçerlidir. İşleme KVKK m.5/2'deki hukuki sebeplerden birine (ör. sözleşmenin ifası, kanunda öngörülme, hukuki yükümlülük, meşru menfaat) dayanmıyorsa **açık rıza (KVKK m.3)** alınmalı. Yalnızca gerekli veri, gereken kadar (veri minimizasyonu).
- **Erişim/güvenlik:** Kiosk kilidi ile OS/dosya sistemine erişim engellenir; token **OS keyring/güvenli depoda** ve at-rest hash'li sunucu tarafında tutulur; ham token yalnızca bir kez döner. Desteklenmeyen/yamalanmayan OS bir güvenlik riskidir (bkz. Bölüm 6). Cihaz kaybında **uzaktan kilit/silme** + sistemde **retire** (token iptal) uygulanır.
- **Saklama/imha:** RMA/hurdaya çıkışta cihaz **fabrika ayarına** döndürülür ve token iptal edilir; hiçbir misafir/personel verisi cihazda kalmaz. AEEE imhasından önce veri silme zorunlu.
- **Sorumluluk:** Restoran işletmesi veri sorumlusudur; HummyTummy veri işleyen rolündedir. Bayi, kurulumda oturum temizleme + MDM + aydınlatma akışını **devreye alıp operatöre teslim etmeli.**

---

## 11. Satis ve devreye alma kontrol listesi

**Satış öncesi / tedarik**
- [ ] Doğru SKU ve varyant seçildi (Sunmi V2 Pro garson; Galaxy Tab A9+ — **SM-X210 Wi-Fi mi, SM-X216 hücresel mi** netleştirildi).
- [ ] Ürün CE + AEEE işaretli, faturalı, Türkiye yetkili kanalından; uygunluk belgeleri mevcut.
- [ ] Garanti süresi ve rejimi teyit edildi (**B2B satış** — taraflarca kararlaştırılan üretici garantisi geçerli: Sunmi 12 ay / Galaxy 24 ay; alıcı istisnaen tüketiciyse 6502 devreye girer — Bölüm 8).
- [ ] Kullanım rolü belirlendi: `tablet_waiter` mı `tablet_customer` mı.
- [ ] Aksesuar planı: Sunmi termal rulo stoğu / kılıf-askı; tablet stand-kilit-şarj kanalı.

**Provizyon ve eşleştirme**
- [ ] Mağaza (`/admin/store`) siparişi PayTR ile ödendi → cihaz slotu otomatik açıldı (idempotent).
- [ ] Slot doğru `kind` olarak ayarlandı (müşteri tableti ise `tablet_customer`).
- [ ] Admin panelde **6 karakterlik (harf+rakam) pairCode** üretildi (10 dk geçerli; şube pending ≤ 10).
- [ ] Tablet uygulaması API URL + pairCode ile `POST /v1/devices/pair` yaptı; token keyring'e yazıldı.
- [ ] **Token davranışı doğrulandı:** TTL varsayılan 24 saat (`DEVICE_TOKEN_TTL_MS`); token yalnızca pair anında verilir ve heartbeat süresini uzatmaz. Prod'da token yenileme olmadığından cihazın 24 saatte bir yeniden pair gerektiği operatöre anlatıldı.
- [ ] Heartbeat çalışıyor, senkron ve sipariş/mutfak akışı doğrulandı.
- [ ] `Device.ownership` (sold/rented/byo) ve `warrantyUntil` doğru girildi; `capabilities[]` etiketlendi.

**Fonksiyonel test**
- [ ] Garson: masa seç → ürün ekle → mutfağa/bara gönder → KDS'e düştü.
- [ ] Sunmi: dahili yazıcıdan **bilgi fişi** başarılı (mali fiş beklenmiyor — yazarkasa rayı ayrı doğrulandı).
- [ ] Müşteri tableti: menü gezme + sipariş + (varsa) self-pay çalışıyor; **masa devrinde oturum temizleniyor.**
- [ ] Kart ödemesi gerekiyorsa GMP-3 `fiscal_coupled` / köprü arkası POS terminali doğrulandı (tablet cloud-direct, terminal köprü arkası).
- [ ] (Sunmi) Kiosk istemcisinin teslim edilen OS sürümünde (Android 7.1/9) çalıştığı doğrulandı.

**Güvenlik / KVKK / kiosk**
- [ ] Kiosk/MDM: tek-uygulama pinning aktif; uzaktan kilit/silme test edildi.
- [ ] Müşteri tabletinde KVKK aydınlatma + oturum temizleme + inaktivite zaman aşımı ayarlı.
- [ ] Kurumsal Wi-Fi'a bağlı (misafir ağından ayrı); yedek 4G planı (Sunmi) değerlendirildi.

**Teslim / operasyon**
- [ ] Operatöre eğitim: pairCode yenileme (token 24 saatte bir dolduğundan yeniden pair dahil), rulo değişimi, temizlik, kayıp cihaz prosedürü.
- [ ] Garanti kartı + `warrantyUntil` teslim edildi; RMA/yedek cihaz süreci anlatıldı.
- [ ] Ömür sonu: AEEE geri dönüşüm + veri silme prosedürü paylaşıldı.

---

### Kaynaklar / doğrulama notu

Ürün teknik özellikleri üretici spec sayfaları ve dağıtıcı listelerinden derlenmiştir (SUNMI V2 Pro resmî spec; Galaxy Tab A9+ GSMArena/Samsung) ve **parti bağımlı değerler (RAM/ROM, OS sürümü, OS destek süresi) teslim datasheet'inden/Samsung destek takviminden teyit edilmelidir.** Güncel perakende fiyat **katalog/QuoteService** (tek yetkili kaynak, KDV %20 dahil) üzerinden alınır; belgedeki rakamlar bağlayıcı-olmayan örnektir. Türkiye tedarik örneği: Desnet Teknoloji (desnet.com.tr) ve pazaryerleri (resmî/tek distribütör kimliği doğrulanmamıştır). Mevzuat referansları: Telsiz Ekipmanları Yönetmeliği (2014/53/AB, RED uyumu — Resmî Gazete 5.11.2020, sayı 31295; yetkili BTK), Atık Elektrikli ve Elektronik Eşyaların Yönetimi Hakkında Yönetmelik (Resmî Gazete 26.12.2022, sayı 32055) + EÇBS (Entegre Çevre Bilgi Sistemi) portalı, B2B satışta 6098 s. Türk Borçlar Kanunu ayıp hükümleri (m.219/m.223/m.221) + TTK m.23/1-c muayene-ihbar süreleri + tarafların kararlaştırdığı garanti (alıcının istisnaen tüketici olması hâlinde 6502 s. Kanun — Resmî Gazete 28.11.2013, sayı 28835 + Garanti Belgesi Yönetmeliği — Resmî Gazete 13.6.2014, sayı 29029), KVKK 6698 s. Kanun (m.3/m.5/m.10 — müşteri tableti), Ticaret Bakanlığı ithalat denetim rehberi.

#### Doğrulanmış mevzuat kaynakları (birincil, URL)

- Telsiz Ekipmanları Yönetmeliği (2014/53/AB) — RG 5.11.2020, sayı 31295: https://www.resmigazete.gov.tr/eskiler/2020/11/20201105-6.htm
- Atık Elektrikli ve Elektronik Eşyaların Yönetimi Hakkında Yönetmelik — RG 26.12.2022, sayı 32055: https://www.mevzuat.gov.tr/MevzuatMetin/yonetmelik/7.5.40055.pdf
- 6698 sayılı Kişisel Verilerin Korunması Kanunu (KVKK): https://mevzuat.gov.tr/mevzuatmetin/1.5.6698.pdf
- KVKK — Aydınlatma Yükümlülüğü (m.10): https://www.kvkk.gov.tr/Icerik/2033/Aydinlatma-Yukumlulugu-
- 6502 sayılı Tüketicinin Korunması Hakkında Kanun — RG 28.11.2013, sayı 28835: https://www.resmigazete.gov.tr/eskiler/2013/11/20131128-1.htm
- Garanti Belgesi Yönetmeliği — RG 13.6.2014, sayı 29029: https://www.resmigazete.gov.tr/eskiler/2014/06/20140613-2.htm

Eşleştirme/token davranışı `backend/src/modules/device-mesh/device.service.ts` (main dalı) ile doğrulanmıştır: pairCode = 6 karakterlik alfanumerik ([A-Z0-9], 10 dk geçerli); token TTL varsayılan 24 saat = `DEVICE_TOKEN_TTL_MS` ve token yalnızca pair anında verilir; `heartbeat()` yalnızca `status`/`lastSeenAt` günceller, `tokenExpiresAt`'e dokunmaz — yani heartbeat token süresini **uzatmaz** (kayan TTL değildir) ve prod'da token yenileme yoktur (süre dolunca yeniden pair gerekir). "Heartbeat token süresini uzatır" iddiası yanlıştır; bu davranış yalnızca henüz merge edilmemiş `fix/device-mesh-token-renewal` dalında vardır. Fiyat, garanti kapsamı, distribütör kimliği ve tüm mevzuat eşik/tarihleri satış öncesi resmî kaynaktan **teyit edilmelidir.**

> Son guncelleme: 2026-07-02 - surum taslagi. Regulasyon/mali bilgiler bilgilendirme amaclidir; guncel resmi mevzuat (GIB, BKM, KVKK Kurumu, Ticaret Bakanligi, ilgili yonetmelikler) esastir.
