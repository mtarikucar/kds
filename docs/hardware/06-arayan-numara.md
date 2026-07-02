# Arayan Numara Cihazı (Caller ID)

> Bu belge iki okuyucu için yazıldı: **restoran operatörü** (cihazı günlük kullanan) ve **bayi/satıcı** (cihazı tedarik eden, kuran, garanti/RMA'sını yöneten). Sistem tarafındaki (HummyTummy) entegrasyon adımları, üründeki gerçek pairing/provizyon akışına birebir uyacak şekilde anlatılmıştır.
>
> **Önemli uyarı (KVKK):** Bu cihaz doğrudan **telefon numarası** işler. Telefon numarası, 6698 sayılı KVKK kapsamında **kişisel veridir**. Cihazı devreye almadan önce mutlaka **10. Bölüm (KVKK ve veri gizliliği)** okunmalı ve aydınlatma/hukuki sebep süreci kurulmalıdır. Aydınlatma yükümlülüğü yerine getirilmeden numara toplamak/işlemek mevzuata aykırıdır.

---

## 1. Genel bakış

**Arayan Numara Cihazı (Caller ID)**, restorana gelen telefon çağrılarında karşı tarafın (arayanın) numarasını, PSTN/santral hattının ürettiği **Caller ID sinyalinden (FSK veya DTMF)** yakalayan ve bilgisayara/POS'a aktaran bir çevre birimidir. Amaç, telefonla sipariş alan işletmelerde:

- Telefon çaldığı anda **arayan numaranın ekranda belirmesi**,
- Numara daha önce kayıtlıysa **müşterinin tanınması** (isim, adres, geçmiş siparişler),
- Böylece **telefon-sipariş akışının hızlanması** ve adres/isim yeniden sorulmadan siparişin açılabilmesidir.

### Sistemdeki rolü (HummyTummy)

- **Cihaz tipi (`Device.kind`):** `caller_id`. Admin panelde "Arayan Numara" kategorisiyle listelenir.
- **Bağlantı modeli:** Cihazın kendisi USB/serial ile bir bilgisayara/köprüye bağlı bir **LAN çevre birimidir** (bkz. Bölüm 4). Yakaladığı çağrı verisi, HummyTummy backend'ine **imzalı bir webhook çağrısıyla** ulaşır.
- **Veri akışı (gerçek kod yolu):**
  `Caller ID cihazı → (konnektör yazılımı) → HMAC-imzalı POST /v1/caller/webhooks/:providerId/:tenantId → caller.service.ingest() → caller_events satırı + outbox olayı → gerçek-zamanlı UI çağrı bildirimi + e164 ile müşteri eşleştirmesi.`
- **Müşteri eşleştirme** en iyi çaba (best-effort) prensibiyle yapılır: gelen numara **E.164** biçiminde `Customer.phone` ile birebir eşleşirse satıra müşteri bağlanır; eşleşme yoksa çağrı yine kaydedilir (numara ham olarak yazılır), sadece "kayıtlı müşteri" etiketi görünmez.
- **Yetki ve gizlilik:** Çağrı akışı ekranı yalnızca **ADMIN/MANAGER** rollerine açıktır (gelen numaralar + eşleşen müşteri profili PII olduğu için WAITER/KITCHEN göremez). Ayrıca özellik, tenant'ın **`caller` (arayan numara) entegrasyon eklentisini** satın almış olmasına bağlıdır (`@RequiresIntegration('caller')`), aksi halde ne menüde görünür ne de backend kabul eder.
- **Güvenlik:** Webhook ucu herkese açık (`@Public`) ama **HMAC-SHA256 imza + tazelik (timestamp) doğrulaması** ister; imza/sürede taze değilse **fail-closed** reddedilir (imzasız çağrı asla kabul edilmez). `mock` sağlayıcı yalnızca dev/staging'de çalışır, **production'da 403** ile kapalıdır. Uç, global hız sınırlarına tabidir (**10 istek/sn**, **50 istek/10 sn**, **100 istek/dk**).
- **Tekrar/çift-kayıt koruması:** `(tenantId, providerId, callId, kind)` üzerinde DB seviyesinde UNIQUE index vardır; sağlayıcı aynı çağrıyı tekrar iletirse (at-least-once webhook normaldir) idempotent no-op olarak yutulur (UI'da çift bildirim/çift eşleştirme olmaz).

> **Dürüst sınır (entegrasyon):** HummyTummy'de arayan-numara ingest'i **provider-webhook modeliyle** çalışır ve şu an kod tabanında yalnızca **genel bir HMAC adaptörü** (`generic`, `twilio`, `verimor`, `netgsm`, `3cx` gibi whitelist'lenmiş providerId'lerin hepsi aynı generic HmacCallerAdapter'ı kullanır — sağlayıcıya özgü imza mantığı yoktur) ile **mock** sağlayıcı vardır; belirli bir telefon santrali/telefoni sağlayıcısına özel hazır bir adaptör yoktur. CID602 gibi seri/USB bir cihazı bu akışa bağlamak için, cihazın seri verisini okuyup **HMAC ile imzalayıp webhook'a POST eden bir "konnektör" yazılımı** gerekir (bkz. Bölüm 4). Ayrıca yerel köprünün (HummyBox) bugün sevk edilen sürücüleri **yazarkasa / ESC-POS / kart POS** içindir; caller_id için köprüye ek bir okuyucu/konnektör devreye alınması gerekir. Bunu satış öncesinde net konumlandırın (bkz. Bölüm 11).

---

## 2. Modeller ve teknik özellikler

Bu belgede tek SKU vardır: **Cidshow CID602 (2-hat Caller ID)**.

### Cidshow CID602 — teknik özellikler

| Özellik | Değer |
|---|---|
| Ürün tipi | 2-hat (çift hat) Caller ID yakalama modülü / "caller id modem" |
| Yakalama formatı | FSK ve DTMF Caller ID (CLIP — Calling Line Identification Presentation) |
| Telefon hattı girişi | 2 × analog PSTN hattı (RJ11 konnektör) *(konnektör tipi üreticiden teyit edilmeli)* |
| Bilgisayara aktarım | Arayüz varyanta göre değişir: bazı varyantlar **USB** (dahili USB-seri dönüştürücü; genellikle sanal COM portu olarak görünür), bazıları **RS-232 (DB9) seri**tir. Kesin arayüz üreticinin datasheet'inden teyit edilmeli *(resmi kaynaktan teyit edilmeli)* |
| Güç | USB varyantında bus-powered olabilir; **ancak RS-232 varyantı harici güç adaptörü isteyebilir** — bu nedenle "ayrı adaptör gerektirmez" garanti edilemez, satın alınan varyanta göre datasheet'ten teyit edilmeli *(resmi kaynaktan teyit edilmeli)* |
| Ekran | Yoktur — cihazın kendisinde ekran yok; numara bağlı bilgisayarda/POS'ta gösterilir |
| Kapasite | Aynı anda 2 hattı izler; çağrı olaylarını bağlı yazılıma aktarır |
| Kutu içeriği | 1 × CID602 modül, 2 × telefon bağlantı kablosu (RJ11), 1 × bağlantı kablosu (USB veya seri), arayan-tanıma yazılımı *(varyanta göre teyit edilmeli)* |
| İşletim sistemi | Windows için üreticinin "arayanı tanıma" yazılımı ile birlikte gelir; USB-seri çip (CH340/FTDI/Prolific vb.) ve sanal-COM sürücü uyumu varyanta bağlıdır *(Linux/macOS uyumu resmi kaynaktan teyit edilmeli)* |
| Boyut / ağırlık | Küçük masaüstü modül *(kesin ölçü/ağırlık üreticiden teyit edilmeli)* |
| Garanti | 12 ay (üretici/satıcı beyanı — bu model için bağımsız kaynaktan doğrulanamadı, datasheet/garanti belgesinden *teyit edilmeli*; yasal boyut için bkz. Bölüm 8) |
| Fiyat (bu belge referansı) | Güncel perakende satış fiyatı **katalogdan / checkout QuoteService'ten** gelir (KDV %20 dahil); burada sabit rakam bağlayıcı değildir — sipariş anında katalogdan teyit edilir (bkz. Bölüm 5) |

> **Not (işlemci/ekran/boyut):** Bu sınıf cihazlarda gömülü bir "işlemci/ekran" spesifikasyonu tüketiciye açıklanmaz; cihaz bir hat izleme + seri aktarım modülüdür, görüntüleme bağlı bilgisayarda yapılır. Datasheet'te net verilmeyen alanlar yukarıda "teyit edilmeli" olarak işaretlenmiştir.

> **Arayüz/güç uyarısı (varyant çelişkisi):** Piyasada hem USB (bus-powered, sanal-COM) hem RS-232 (harici adaptörlü) varyantlar dolaşmaktadır. Bunlar birbirinden farklı davranır; **hangi varyantın satın alındığı ve güç/sürücü davranışı sipariş öncesi üreticiden birebir teyit edilmeden** kesin ifadeyle yazılmamalıdır.

> **Kritik uyumluluk:** CID602 **analog PSTN / santral hattı** üzerindeki FSK/DTMF Caller ID sinyalini okur. **VoIP/SIP hatlarında** analog Caller ID sinyali fiziksel olarak yoktur; ancak bir ATA (Analog Telephone Adapter) veya IP santral analog port üzerinde FSK CID üretiyorsa okunabilir. Santral (PBX) arkasındaysa, santralin dış hat CID'sini iç/analog porta **geçirmesi (passthrough)** gerekir; aksi halde cihaz numara göremez. Belirli bir ATA/santralin passthrough davranışı sahada test edilmelidir. Satış öncesi hat tipini mutlaka doğrulayın (bkz. Bölüm 11).

---

## 3. Kullanım / operasyon

Günlük kullanım senaryosu (telefonla sipariş alan bir restoran):

1. **Çağrı gelir.** Müşteri restoranın sabit hattını arar. CID602, hat üzerindeki FSK/DTMF Caller ID sinyalini yakalar ve numarayı bağlı bilgisayara/POS'a aktarır.
2. **Ekranda bildirim belirir.** HummyTummy'de yetkili (ADMIN/MANAGER) kullanıcının açık olduğu ekranda gerçek-zamanlı **arayan çağrı bildirimi** görünür.
3. **Müşteri tanınır (varsa).** Numara E.164 biçiminde daha önce kayıtlı bir müşteriyle eşleşiyorsa, müşteri profili (isim, kayıtlı adres, geçmiş) gösterilir; eşleşme yoksa yalnızca ham numara ile "yeni/eşleşmeyen çağrı" olarak görünür.
4. **Personel siparişi açar.** Operatör, tanınan müşteriye adres/isim tekrar sormadan siparişi hızlıca oluşturur; yeni müşteride bilgileri girer.
5. **Çağrı geçmişi.** Son N çağrı, "çağrılar akışı" ekranından (`GET /v1/caller/recent`) görüntülenir; kaçan/yanıtlanan/biten çağrılar kayıtlıdır.

**Operasyonel notlar**
- Cihaz **her gelen aramayı** kaydeder (numara ham olarak yazılır), yalnızca kayıtlı müşteri eşleşmelerini değil. Bu, KVKK açısından bir **veri minimizasyonu** kararı gerektirir (bkz. Bölüm 10): "yalnızca kayıtlı müşteriyle eşleşen çağrıları mı, tüm aramaları mı işleyeceğiz?" sorusuna sistem varsayılanı **tüm aramaları kaydet**tir.
- Çağrı kaydı = **ses kaydı değildir**; cihaz sesi değil yalnızca **numara/çağrı olayı meta verisini** işler. Bunu personel ve müşteri iletişiminde net belirtin.

---

## 4. Kurulum ve sisteme bağlama

### 4.1 Fiziksel kurulum

1. **Hat tipini doğrula.** Restoranın telefon hattı analog PSTN mi, santral (PBX) arkasında mı, yoksa VoIP mi? (Bölüm 2 uyumluluk notu.) VoIP/santral ise CID passthrough'u test et.
2. **Telefon hatlarını bağla.** Gelen 2 analog hattı, CID602 üzerindeki **hat girişlerine (RJ11)** bağla. Genelde hat "loop-through" mantığıyla telefona/santrale de aktarılır — telefon cihazınızın çalışmaya devam ettiğini doğrula.
3. **Bağlantıyı yap.** CID602'yi köprü/bilgisayara varyantına göre **USB veya RS-232 seri** ile bağla. USB varyantı sanal COM portu (USB-seri) olarak tanınmalı; gerekirse üreticinin sürücüsünü yükle. RS-232 varyantında harici güç adaptörü gerekebilir.
4. **Test araması yap.** Başka bir telefondan restoranı arayıp numaranın yakalandığını fiziksel katmanda (üretici yazılımı / seri terminal) gör.

### 4.2 HummyTummy'ye provizyon ve eşleştirme (gerçek akış)

CID602 sistemde `Device.kind = caller_id` olarak yer alır. İki yol vardır:

**A) Mağazadan satın alarak otomatik provizyon**
- Bayi/operatör, **Mağaza (`/admin/store`)** üzerinden Caller ID ürününü sepete ekler → **PayTR** ile öder.
- Sipariş **ödenince**, device-mesh cihaz slotu **otomatik** açılır (deterministik `provisionKey` + Postgres advisory-lock, idempotent — çift slot oluşmaz).

**B) Manuel slot + eşleştirme (pairing)**
1. Admin panelde ilgili şube için **caller_id cihaz slotu** oluşturulur → **6 karakterli alfanumerik ([A-Z0-9]) `pairCode`** üretilir (**10 dk** geçerli; şube başına en çok **10 bekleyen slot**).
2. Cihaz tarafındaki uygulama/konnektör, `pairCode` ile **`POST /v1/devices/pair`** çağırır.
3. Tek-kullanımlık **atomik claim** yapılır; başarılıysa **sha256-hash'li bearer token** döner (**varsayılan 24 saat TTL** — `DEVICE_TOKEN_TTL_MS`; TTL **yalnızca pair anında** verilir, **heartbeat token süresini uzatmaz**). **Ham token yalnızca bir kez** döner; sunucuda **at-rest hash'lenmiş** tutulur.

> **Token ömrü uyarısı (nadiren-etkileşimli cihaz):** device-mesh bearer token'ının varsayılan geçerlilik süresi **24 saattir** (`DEVICE_TOKEN_TTL_MS`), **yalnızca pair anında** verilir ve **`pairCode` ile eşleşen cihazlar için — caller_id dahil — geçerlidir** (**yerel köprü/`local_bridge` hariçtir**; köprü bu 24 saatlik DEVICE token'ını taşımaz, kendi **30 günlük** bearer token'ını taşır — `LOCAL_BRIDGE_TOKEN_TTL_MS`). **`heartbeat()` yalnızca `status` ve `lastSeenAt`'i günceller; `tokenExpiresAt`'e DOKUNMAZ, yani token süresini UZATMAZ (kayan/rotating TTL değildir).** Token pair'den **24 saat sonra dolar** ve süresi dolan token `authenticateToken` tarafından reddedilir; **main/prod dalında token yenileme (refresh) yoktur**, bu yüzden cihaz devam edebilmek için **yeni bir `pairCode` ile yeniden pair edilmelidir**. Cihaz/köprüyü 7/24 açık ve ağa bağlı tutun (çağrı kaybını önler); ancak token'ın prod'da 24 saatte bir yeniden-pair gerektirdiğini unutmayın (bkz. Bölüm 6). *(Not: "heartbeat token süresini uzatır / kayan TTL" davranışı yalnızca henüz merge edilmemiş `fix/device-mesh-token-renewal` dalında vardır; prod'da geçerli değildir.)*

### 4.3 Köprü arkasında mı, cloud-direct mi?

- CID602 fiziksel olarak **USB/seri bir LAN çevre birimidir** (yazarkasa/ESC-POS yazıcı/kart POS terminali gibi). Bu nedenle mimari olarak **HummyBox köprüsü arkasında** (`bridgeId` set) konumlanır; köprü WSS heartbeat + SQLite offline kuyruk + sürücüler ile buluta bağlanır.
- **Cloud-direct değildir** (tablet/KDS ekranı gibi doğrudan buluta bağlanan bir cihaz değil).

### 4.4 Çağrı verisini HummyTummy'ye akıtan konnektör (kritik adım)

Cihaz eşleştirilse bile, **çağrı olaylarının sisteme ulaşması için** seri veriyi okuyup webhook'a POST eden bir konnektör gerekir:

- Konnektör (HummyBox köprüsüne eklenecek bir okuyucu ya da PC-tarafı küçük bir ajan) CID602'nin **seri/sanal COM portundan** çağrı olaylarını okur.
- Her olayı normalize eder ve **HMAC-SHA256** ile imzalayarak **`POST /v1/caller/webhooks/:providerId/:tenantId`** ucuna gönderir; `x-signature` ve **taze `x-timestamp`** (maks. 300 sn) başlıklarını ekler.
- `providerId` whitelist'teki bir değer olmalı (ör. `generic`); backend imzayı ve tazeliği doğrular → `caller_events` satırı + outbox olayı → gerçek-zamanlı çağrı bildirimi.
- **Sağlayıcı sırrı (webhookSecret)** o provider için ortam değişkeninde (ör. `CALLER_WEBHOOK_SECRET__<PROVIDER>[__<TENANT>]`) yapılandırılmalıdır; sır yoksa adaptör **fail-closed** çalışır (çağrı kabul edilmez).

> **Dürüst not:** Bu konnektör HummyTummy'de hazır bir "CID602 sürücüsü" olarak sevk edilmiyor; genel HMAC provider sözleşmesine uyan bir entegrasyon işidir. Satışta bunu bir **kurulum/entegrasyon kalemi** olarak konumlandırın.

---

## 5. Tedarik ve sağlayıcı

- **Ürün:** Cidshow CID602, 2-hat Caller ID modülü. Türkiye pazarında yaygın olarak "caller id modem / arayan numarayı gösteren cihaz" adıyla satılır ve genelde **arayanı-tanıma yazılımıyla** paketlenir.
- **Kanal:** Marka bir üretici modeli olmaktan çok, **çeşitli yerel toptancı/e-ticaret kanallarından** (toptan siteleri, Hepsiburada, GittiGidiyor benzeri pazaryerleri, POS/otomasyon bayileri) temin edilen bir üründür. Tek yetkili distribütör beyanı **teyit edilmeli**; pratikte çoklu kaynaktan bulunur.
- **Tedarik süresi:** Stoktan genelde hızlı (birkaç iş günü) — kanala göre değişir *(resmi/güncel kaynaktan teyit edilmeli)*.
- **Gösterge alış maliyeti (bayi):** Web'de görülen perakende/toptan aralığı yaklaşık **239–425 TL** arasında değişkendir (kaynağa göre). Bu yalnızca **gösterge niteliğinde bir alış maliyeti aralığıdır ve bağlayıcı değildir**; gerçek alış maliyeti **distribütör teklifine** göre, müşteriye yansıyan satış fiyatı ise **katalog/QuoteService**'e göre belirlenir. **Fiyatlar volatildir; sipariş anında teyit edilmeli** *(resmi/güncel kaynaktan teyit edilmeli)*.

> **Fiyatlandırma ve marj notu (mali lens):**
> - **Tek yetkili fiyat kaynağı katalogdur:** Müşteriye yansıyan güncel **perakende satış fiyatı**, ürün kataloğundan (`HardwareProduct.priceCents`) ve checkout'taki **QuoteService**'ten gelir (**KDV %20 dahil**). Bu belgedeki hiçbir rakam bağlayıcı bir satış fiyatı değildir; bağlayıcı fiyat sipariş anında katalogdan/QuoteService'ten alınır.
> - **Alış maliyeti ve marj:** Bayinin alış maliyeti ve dolayısıyla marjı **distribütör teklifine göre değişir** ve burada sabitlenemez/bağlayıcı değildir. Marj hesabı **daima KDV hariç maliyet** üzerinden kurulmalıdır; aksi halde brüt marj yanıltıcı olur.
> - **Fatura yükümlülüğü:** Bayi, sattığı cihaz için **fatura/e-Arşiv düzenlemekle yükümlüdür**; hesaplanan KDV ve belge maliyeti marjdan düşülmelidir *(GİB/KDV mevzuatı — resmi kaynaktan teyit edilmeli)*.
> - **Sonuç:** Cihaz marjı doğası gereği incedir. **Kurulum/konnektör entegrasyonunu ayrı ve baskın bir gelir kalemi** olarak fiyatlayın; cihazı maliyet-tabanlı, hizmeti ana kâr merkezi yapın.

- **Alternatif kaynak:** Aynı işlevi gören muadil "2-hat caller id modem" cihazları (farklı markalar/POSXPOWER MR-CID602 gibi yeniden etiketli varyantlar) mevcuttur; **yazılım/sürücü uyumu ve sanal-COM davranışı** modelden modele değişebileceği için, HummyTummy konnektörüyle test edilmeden muadile geçilmemeli.

> Fiyat, distribütör ve stok bilgileri hızla değişir — **her teklif öncesi güncel resmi kaynaktan teyit edilmelidir.**

---

## 6. Bakım ve sarf malzeme

- **Sarf malzeme:** Yoktur — CID602'de kağıt/rulo/pil/kartuş bulunmaz. Sarf maliyeti sıfırdır.
- **Periyodik bakım:** Konnektör (RJ11 hat kabloları ve USB/seri) gevşemesine karşı ara ara kontrol; oksitlenmeye karşı temiz tutma.
- **Temizlik:** Kuru/hafif nemli bezle dış yüzey; hat konnektörlerini temiz ve kuru tut. Sıvı/temizlik spreyini doğrudan uygulama.
- **Firmware/güncelleme:** Cihaz firmware'i genelde güncellenmez; asıl güncelleme **PC-tarafı sürücü/konnektör yazılımında** olur. HummyBox köprüsü ve konnektör güncellemelerini takip et.
- **Sürekli çalışma:** Bağlı bilgisayar/köprü **7/24 açık** kalmalı; enerji kesintilerinde köprüyü UPS arkasına almak çağrı kaybını önler (köprünün SQLite offline kuyruğu ağ kesintisini tolere eder, ama cihaz kapanırsa çağrı yakalanamaz). 7/24 bağlı kalmak çağrı kaybını önler; ancak bearer token (varsayılan 24 saat TTL) **yalnızca pair anında** verilir ve **heartbeat token süresini uzatmaz** — token pair'den 24 saat sonra dolar ve cihazın yeniden pair edilmesi gerekir (bkz. Bölüm 4.2).

---

## 7. Sorun giderme ve arıza

| Belirti | Olası neden | Çözüm |
|---|---|---|
| Numara hiç görünmüyor | Hatta Caller ID hizmeti operatörce açık değil | Telekom operatöründen hattaki Caller ID/CLIP hizmetini aktive ettir |
| Numara hiç görünmüyor | Hat **VoIP/SIP** veya santral CID'yi geçirmiyor | Analog PSTN'e al ya da ATA/santralde CID passthrough'u yapılandır (bkz. Bölüm 2/4) |
| Bazı çağrılarda numara "gizli/bilinmiyor" | Arayan numarasını gizlemiş / şebeke iletmemiş | Cihaz kaynaklı değil; normal davranış |
| Bilgisayar cihazı görmüyor | USB-seri sürücü yok / yanlış COM portu | Üretici sürücüsünü kur, doğru COM portunu seç, USB/seri kablo/portu değiştir |
| Format karışık/bozuk numara | FSK/DTMF format uyuşmazlığı | Konnektör/yazılımda hat formatını (FSK vs DTMF) doğru ayarla |
| Çağrı yakalanıyor ama HummyTummy'ye düşmüyor | Konnektör webhook'a POST edemiyor | İnternet/köprü bağlantısını, `webhookSecret`i, `x-timestamp` tazeliğini (maks 300 sn), imzayı kontrol et |
| Cihaz uzun süre kapalı kaldıktan sonra kimlik doğrulayamıyor | Bearer token TTL'i (varsayılan 24 saat) doldu; token yalnızca pair anında verilir, heartbeat TTL'i uzatmaz (prod'da refresh yok) | Cihazı **yeniden pair et** (yeni `pairCode` üret → `POST /v1/devices/pair`); prod'da token 24 saat sonra tekrar dolacağından süresi dolduğunda yeniden pair gerekir (bkz. Bölüm 4.2) |
| Webhook 403 dönüyor | `mock` sağlayıcı prod'da kapalı / imza geçersiz / provider sırrı tanımsız | Prod'da whitelist'teki gerçek (HMAC-imzalı) sağlayıcıyı kullan; imzayı ve o provider için env-secret'i doğrula |
| Çağrılar UI'da hiç görünmüyor | `caller` eklentisi alınmamış veya rol yetkisiz | Tenant'ın `caller` entegrasyonunu doğrula; ekrana ADMIN/MANAGER ile gir |
| Çift bildirim | (Beklenmez) sistem zaten dedup yapar | Sorun sürerse konnektörün aynı callId'yi farklı kind ile göndermediğini kontrol et |
| İki hattan biri okumuyor | Hat kablosu/port arızası | Hatları CID602 üzerinde çapraz test et; kablo/port değiştir |

**Ne zaman RMA?** Fiziksel test katmanında (üretici yazılımı/seri terminal) cihaz **hiçbir hattan** numara üretmiyorsa, USB/seri düzgün sürücüyle bile enumerate olmuyorsa, ya da bağlantıda görünür fiziksel hasar (yanık/koku, kırık konnektör) varsa → cihaz arızalıdır, **RMA** (bkz. Bölüm 8). Yazılım/hat/konfigürasyon kaynaklı sorunlar RMA kapsamı değildir.

---

## 8. Garanti ve RMA süreci

- **Süre:** Bu üründe beyan edilen üretici/satıcı garantisi **12 aydır** *(bu model için bağımsız kaynaktan doğrulanamadı; datasheet/garanti belgesinden teyit edilmeli)*. Bu B2B satışta geçerli bir garanti süresidir (bkz. aşağıdaki "Yasal garanti" notu).
- **Kapsam:** Üretim/malzeme/işçilik hatası kaynaklı arızalar. Kapsam dışı: hatalı kurulum, yanlış hat/format konfigürasyonu, sıvı teması, aşırı gerilim/yıldırım, fiziksel darbe, yetkisiz müdahale.
- **RMA akışı (bayi):**
  1. Operatörden arıza tanımı + satın alma bilgisi al; Bölüm 7 ile **saha/yazılım kaynaklı olmadığını** doğrula.
  2. Cihazı distribütöre/üreticiye garanti kapsamında ilet; yerine yedek/geçici cihaz sağla (mümkünse).
  3. Onarım/değişim sonrası **konnektör + HummyTummy webhook testini** tekrar yaparak devreye al.

### Yasal garanti — satışın niteliği belirleyicidir (kritik)

> **B2B vs. tüketici (kanonik çerçeve):** Bu belgenin öznesi **bayi → RESTORAN** satışıdır. 6502 sayılı Tüketicinin Korunması Hakkında Kanun (Resmî Gazete 28.11.2013, sayı 28835) m.3, tüketiciyi "ticari veya mesleki olmayan amaçlarla hareket eden gerçek veya tüzel kişi" olarak tanımlar. Restoran, cihazı **ticari/mesleki amaçla** aldığından **tacir/ticari alıcıdır**, 6502 anlamında **kural olarak tüketici değildir**. Bu ayrım garanti rejimini kökten değiştirir:
>
> - **Ticari (B2B) satışta (bayi → restoran):** 6502 sayılı TKHK'nın tüketici lehine ayıplı mal hükümleri ile Garanti Belgesi Yönetmeliği'nin (Resmî Gazete 13.6.2014, sayı 29029) tüketici ürünleri için öngördüğü asgari süreler **uygulanmaz**; bunun yerine **6098 sayılı TBK'nın satış/ayıp hükümleri** geçerlidir: TBK m.219 satıcıyı ayıptan sorumlu tutar, ancak bu hükümler **emredici değildir** (m.221'deki ağır kusur hâli hariç → sorumsuzluk/kısıtlama kaydı geçerlidir). Dolayısıyla ayıp/garanti sözleşmeyle serbestçe kararlaştırılabilir ve üreticinin verdiği **12 (veya 24) ay garanti B2B satışta GEÇERLİ ve BAĞLAYICIDIR**; bu, tüketiciler için gündeme gelen 2 yıllık asgariye "aykırı/uygunsuz" değildir ve **"satıcı garantisi 2 yıldan kısa olamaz" iddiası B2B satışta kural olarak GEÇERSİZDİR.**
> - **Tacir alıcının muayene/ihbar külfeti:** Tacir/ticari alıcı, **TBK m.223 uyarınca** teslim aldığı malı işlerin olağan akışına göre **gözden geçirmek (muayene)** ve varsa ayıbı **satıcıya bildirmek (ihbar)** külfeti altındadır; bu külfet yerine getirilmezse mal kabul edilmiş sayılır. Tacirler arası satışta **TTK m.23/1-c** kesin süreler öngörür: **açık ayıp** için teslimden itibaren **2 gün** içinde, muayenesi olağan incelemeyle mümkün olmayan **gizli ayıp** ortaya çıkınca **8 gün** içinde satıcıya ihbar (ihbar/inceleme süresi). RMA/ayıp talebi bu süreler ve kayıt disipliniyle yürütülmelidir.
> - **İstisna — alıcı tüketici sayılırsa:** Alıcı istisnaen **tüketici** ise (örn. şahıs, ticari/mesleki amaç dışı edinim), 6502 sayılı TKHK ve **Garanti Belgesi Yönetmeliği (Resmî Gazete 13.6.2014, sayı 29029)** — tüketiciye yönelik, yönetmelik ekindeki listeye tabi mallarda **asgari 2 yıl garanti** öngören — hükümleri devreye girer; satıcı garantisi bu yasal asgari süreden **kısa olamaz** *(cihazın garanti-belgesi-zorunlu ekli listede olup olmadığı resmi kaynaktan teyit edilmeli)*.
> - **Sonuç:** Bayi, satışın ticari mi (kural) yoksa istisnaen tüketici mi olduğunu doğru tespit etmeli ve garanti/ayıp koşullarını buna göre sözleşmelemelidir *(kesin süre, kapsam ve garanti-belgesi zorunluluğu resmi kaynaktan teyit edilmeli)*.

---

## 9. Regülasyon ve uyumluluk

- **Telekom hat uyumu:** Cihaz yalnızca **PSTN/santral analog Caller ID (FSK/DTMF)** hizmetiyle çalışır. Caller ID/CLIP hizmetinin hatta operatör tarafından açık olması gerekir. **VoIP hatlarında** analog CID sinyali doğal olarak bulunmaz (ancak ATA/santral üretiyorsa okunur). Bu teknik bir kısıt olduğu kadar bir **satış öncesi doğrulama** yükümlülüğüdür.
- **Telekomünikasyon terminal ekipmanı onayı (net konumlandırma):** Güncel rejimde (Telsiz Ekipmanları Yönetmeliği (2014/53/AB), Resmî Gazete 5.11.2020, sayı 31295; yetkili BTK) BTK **tip onayı esas olarak TELSİZ/radyo içeren ekipmana** yöneliktir. CID602 gibi **radyo içermeyen, yalnızca kablolu PSTN'e bağlanan** bir caller-id modülü tipik olarak ayrı bir BTK/radyo tip onayına **değil**, aşağıdaki CE (EMC/LVD) uygunluğuna tabidir. Bu spesifik kablolu cihaz için BTK yükümlülüğünün uygulanıp uygulanmadığı **resmi kaynaktan teyit edilmeli** — ancak kablolu-yalnız cihazda tip onayı büyük olasılıkla gerekmez.
- **CE işareti:** Elektronik ekipman olarak CE uygunluğu beklenir; kapsam **Elektromanyetik Uyumluluk Yönetmeliği (2014/30/AB)** (Resmî Gazete 2.10.2016, sayı 29845) ve **Belirli Gerilim Sınırları İçin Tasarlanan Elektrikli Ekipman ile İlgili Yönetmelik (2014/35/AB — LVD)** (Resmî Gazete 2.10.2016) kapsamındadır; her ikisinin yetkilisi Sanayi ve Teknoloji Bakanlığı'dır. Ürün/kutu üzerinde **CE işareti** ve AB/AT uygunluk beyanı bulunmalıdır; bu spesifik ürünün işareti/beyanı taşıyıp taşımadığı *(üründen/tedarikçiden teyit edilmeli)*.
- **TSE / uygunluk:** İlgili TSE/standart uygunluğu satın alma öncesi **teyit edilmeli** *(resmi kaynaktan teyit edilmeli)*.
- **AEEE (WEEE) — elektronik atık:** Cihaz, **Atık Elektrikli ve Elektronik Eşyaların Yönetimi Hakkında Yönetmelik** (Resmî Gazete 26.12.2022, sayı 32055 — 2012 tarih 28300 sayılı eski "Kontrolü" yönetmeliğinin yerine geçmiştir) kapsamındadır. Ürün/ambalajda **"AEEE Yönetmeliğine Uygundur"** ibaresi ve üstü çizili çöp kutusu işareti bulunmalıdır. Yönetmeliğin genişletilmiş üretici sorumluluğu kapsamında **üretici** tanımı, ürünü **kendi markasıyla piyasaya süreni** ve **ithal edeni** de kapsar — dolayısıyla cihazı kendi markanızla (ör. HummyBox) satmak sizi *üretici* konumuna getirir. Üretici/ithalatçı, Çevre, Şehircilik ve İklim Değişikliği Bakanlığı'nın **EEE Üretici Kayıt Sistemi'ne kayıt** (üretici kayıt no + yıllık bildirim) ve **toplama/geri dönüşüm** yükümlülüklerine tabidir; işlemler **EÇBS (Entegre Çevre Bilgi Sistemi, ecbs.cevre.gov.tr)** üzerinden yürütülür. Ayrıca **GEKAP (Geri Kazanım Katılım Payı)** ayrı bir mali yükümlülük olup beyanı EÇBS'ye değil **GİB'e (vergi dairesi)** verilir. Ömrü biten cihaz evsel atığa atılmamalı, yetkili toplama noktasına verilmelidir *(kayıt eşikleri ve tenant'ın somut yükümlülük kapsamı resmi kaynaktan teyit edilmeli)*.
- **Enerji/güvenlik:** Düşük gerilimli cihaz; ayrı bir güç/enerji etiketi zorunluluğu genelde yoktur *(resmi kaynaktan teyit edilmeli)*.

---

## 10. KVKK ve veri gizliliği

**Bu cihaz doğrudan kişisel veri işler; en yüksek uyum önceliği burasıdır.**

- **Kişisel veri niteliği:** Telefon numarası, 6698 sayılı KVKK (kabul 24.3.2016) kapsamında **kişisel veridir** — Kanun m.3 kişisel veriyi "kimliği belirli veya belirlenebilir gerçek kişiye ilişkin her türlü bilgi" olarak tanımlar; telefon numarası kişiyi belirlenebilir kıldığından bu kapsamdadır (özel nitelikli değildir, ancak işlenmesi hukuki sebep gerektirir). Eşleşen müşteri profili (isim, adres, geçmiş sipariş) de kişisel veridir.
- **Aydınlatma yükümlülüğü (KVKK m.10):** Numara toplanmadan/işlenmeden önce, **veri sorumlusunun kimliği**, işleme **amacı**, **hukuki sebep**, aktarım yapılacaksa kime aktarılacağı, toplama yöntemi ve **ilgili kişinin hakları** (öğrenme, düzeltme, silme, itiraz) bildirilmelidir. Aydınlatma yükümlülüğü **açık rıza alınıp alınmamasından bağımsızdır** — hangi hukuki sebebe dayanılırsa dayanılsın **her veri işleme faaliyetinde** yerine getirilmelidir (KVKK m.10; Aydınlatma Yükümlülüğünün Yerine Getirilmesinde Uyulacak Usul ve Esaslar Hakkında Tebliğ). Restoranlar için pratikte:
  - Telefon menüsü/karşılama anonsunda ve/veya web/QR aydınlatma metninde bilgilendirme,
  - Fiziksel/dijital **aydınlatma metni** erişilebilir kılınmalıdır.
- **Yurt dışına aktarım (KVKK m.9):** Çağrı/numara verisi yurt dışındaki bir sunucuya/hizmete aktarılıyorsa, m.9 (yurt dışına aktarım) rejimi uygulanır. Bu madde **7499 sayılı Kanun (Resmî Gazete 12.3.2024, sayı 32487)** ile yeniden düzenlenmiş olup **1.6.2024'ten itibaren** yürürlüktedir; aktarım yapılacaksa güncel m.9 koşulları (yeterlilik kararı / uygun güvenceler / arızi haller) değerlendirilmelidir *(somut aktarım yapısı KVKK uzmanı/hukuk danışmanı teyidi ister)*.
- **Hukuki sebep (KVKK m.5) — iki senaryo, iki ayrı gerekçe (kritik):**
  KVKK m.5/2, açık rıza aranmaksızın işleme yapılabilecek hukuki sebepleri sayar (kanunlarda açıkça öngörülme, sözleşmenin ifası, veri sorumlusunun hukuki yükümlülüğü, meşru menfaat vb.); bu hallerde açık rıza (m.3) **aranmaz**. Sistem varsayılanı **her aramayı** kaydettiği için tek bir hukuki sebep **yetmez**; iki farklı grup vardır ve her biri **ayrı** gerekçelendirilmelidir:
  - **Fiilen sipariş veren (sözleşme kuran) arayan:** İşleme **sözleşmenin ifası** (m.5/2-c) hukuki sebebine dayandırılabilir. Ancak bu **yalnızca** sözleşme kuran arayan için geçerlidir.
  - **Sipariş vermeyen / sözleşme kurmayan 3. kişiler (yanlış arayan, bilgi soran, vb.):** Bu numaralar **"sözleşmenin ifası"na dayandırılamaz.** Sistem tüm aramaları kaydettiği için bunlar ancak **meşru menfaat** (m.5/2-f) hukuki sebebi + belgelenmiş bir **denge testi** ile işlenebilir.
  - **Tutarlılık uyarısı:** "Her aramayı kaydet" varsayılanı ile "sipariş/teslimat için sözleşmenin ifası yeterli" ifadesi **çelişir**; her iki senaryo için ayrı hukuki sebep açıkça gerekçelendirilmelidir *(somut hukuki sebep seçimi ve denge testi KVKK uzmanı/hukuk danışmanı teyidi ister)*.
  - **Pazarlama/SMS/arama kampanyası** gibi ikincil amaçlar için **ayrı ve açık rıza** gerekir; rıza özgür, bilgilendirilmiş, belirli ve **sözleşmeden ayrıştırılmış** olmalıdır. Ticari elektronik ileti için ayrıca **İYS/ETK** yükümlülükleri gündeme gelir *(resmi kaynaktan teyit edilmeli)*.
- **Veri minimizasyonu (kritik karar):** Sistem varsayılan olarak **her gelen aramayı** kaydeder (numara ham olarak yazılır), yalnızca kayıtlı müşteri eşleşmelerini değil. İşletme, "**yalnızca kayıtlı-numara eşleşmesini mi, tüm aramaları mı**" işleyeceğine bir **politika olarak** karar vermeli ve bunu aydınlatma metnine yansıtmalıdır. Amaçla sınırlı, ölçülü veri işlenmelidir.
- **Saklama süresi:** Çağrı/numara kayıtları **amaçla sınırlı** bir süre saklanmalı; süre dolduğunda silinmeli/anonimleştirilmelidir. Uygun saklama süresi işletmenin işleme amacına ve mevzuata göre belirlenmeli *(resmi kaynaktan/danışmandan teyit edilmeli)*.
- **Erişim ve güvenlik (KVKK m.12):** HummyTummy tarafında çağrı akışı **yalnızca ADMIN/MANAGER**'a açıktır (PII sızıntısını sınırlar) ve `caller` eklentisiyle kapılıdır. Numaralar sistemde denormalize tutulsa da erişim rol bazlıdır; webhook ucu **HMAC-imzalı + tazelik doğrulamalıdır** ve konnektörün ilettiği verinin **şifreli kanal (HTTPS/WSS)** üzerinden gittiğinden emin olun. Bu teknik tedbirler (imza + tazelik + şifreli aktarım), kişisel veri için KVKK m.12 veri güvenliği yaklaşımıyla tutarlıdır.
- **VERBİS (muafiyet karinesiyle):** Veri sorumlusu, koşulları sağlıyorsa **VERBİS'e kayıt** ve envanter yükümlülüğüne tabi olabilir. **Ancak pratikte tipik bir restoran çoğunlukla MUAFtır:** Kurul kararları uyarınca, ana faaliyeti özel nitelikli veri işleme **olmayan**, yıllık **çalışan sayısı 50'den az VE** yıllık mali bilanço toplamı eşik altında olan veri sorumluları VERBİS kaydından muaf tutulur. Yani caller-id kullanan küçük bir işletme genelde kayıt zorunlusu **değildir**. İşletme somut durumunu bu muafiyet karinesine göre değerlendirmelidir *(muafiyet eşikleri — çalışan sayısı/mali bilanço — güncellenebilir; kesin eşikler kvkk.gov.tr'den teyit edilmeli)*.
- **Ses kaydı yapılmaz:** Cihaz **ses kaydı almaz**, yalnızca numara/çağrı meta verisi işler — bunu aydınlatma metninde ve personel eğitiminde açıkça belirtin (yanlış beklenti/algı oluşmasın).

> KVKK yükümlülükleri işletmenin somut durumuna bağlıdır; kritik kararlar (hukuki sebep seçimi, denge testi, saklama süresi, VERBİS muafiyeti) için **KVKK uzmanı/hukuk danışmanı görüşü** alınmalı; yukarıdaki eşik ve sürelerin hiçbiri kesin rakam olarak taahhüt edilmemelidir.

---

## 11. Satış ve devreye alma kontrol listesi

**Satış öncesi (bayi):**
- [ ] Restoranın **hat tipi** doğrulandı (analog PSTN / santral / VoIP) ve Caller ID/CLIP hizmetinin açık olduğu teyit edildi.
- [ ] Santral/VoIP ise **CID passthrough** test edildi (numara gerçekten okunuyor mu?).
- [ ] Satın alınan **CID602 varyantı** (USB mü RS-232 mi, güç/adaptör, sürücü uyumu) datasheet'ten teyit edildi.
- [ ] Kaç hat izlenecek belirlendi (CID602 = **2 hat**); daha fazla hat gerekiyorsa çoklu cihaz/muadil planlandı.
- [ ] **Konnektör/entegrasyon** işi (seri okuma → HMAC-imzalı webhook POST) kapsam ve fiyata **ayrı kalem** olarak yazıldı; müşteriye "hazır sürücü yok, entegrasyon gerekir" netliği verildi.
- [ ] Tenant'ta **`caller` entegrasyon eklentisi** var mı doğrulandı (yoksa satın alma planlandı).
- [ ] **Satış fiyatı katalogdan/QuoteService'ten** (KDV %20 dahil) alındı; güncel **alış maliyeti/stok/tedarik süresi** teyit edildi; marj **KDV hariç maliyet** üzerinden değerlendirildi (belgedeki gösterge rakamlar bağlayıcı değil).
- [ ] **KVKK** uyum paketi konuşuldu: aydınlatma metni, **iki senaryolu hukuki sebep** (sözleşme ifası + meşru menfaat/denge testi), saklama süresi, VERBİS muafiyet değerlendirmesi, "tüm aramalar mı / yalnız kayıtlı mı" politikası.
- [ ] **Garanti rejimi** satışın niteliğine göre (kural: B2B/TBK — üreticinin 12/24 ay garantisi geçerli; istisna: tüketici/TKHK) doğru kuruldu; **CE / AEEE** işaretleri ve **Türkçe kılavuz + garanti belgesi** ürün/kutu üzerinde mevcut.

**Kurulum ve devreye alma:**
- [ ] Hatlar (RJ11 × 2) ve USB/seri bağlandı; telefon/santral çalışmaya devam ediyor.
- [ ] Sürücü kuruldu; USB varyantında doğru **COM portu** seçildi; RS-232 varyantında güç adaptörü bağlandı.
- [ ] Fiziksel test araması yapıldı; numara üretici yazılımı/seri terminalde görüldü.
- [ ] HummyTummy'de cihaz **caller_id** olarak provizyon edildi:
  - [ ] Mağazadan alındıysa ödeme sonrası slot otomatik açıldı, **veya**
  - [ ] Manuel slot + **pairCode** (6 karakterli alfanumerik, 10 dk) üretildi → cihaz/konnektör **`POST /v1/devices/pair`** ile claim etti → bearer token alındı (varsayılan 24 saat TTL, yalnızca pair anında verilir; heartbeat TTL'i uzatmaz — prod'da token 24 saatte bir yeniden pair gerektirir).
- [ ] Cihaz **HummyBox köprüsü arkasında** (`bridgeId` set) konumlandı; köprü heartbeat'i sağlıklı (heartbeat cihazın online/`lastSeenAt` durumunu bildirir; token süresini uzatmaz — TTL dolunca yeniden pair gerekir).
- [ ] Konnektör **`POST /v1/caller/webhooks/:providerId/:tenantId`** ucuna **HMAC-imzalı + taze x-timestamp** ile ingest yapıyor; whitelist'teki `providerId` ve o provider için `webhookSecret` yapılandırıldı.
- [ ] Uçtan uca test: gerçek arama → **UI'da gerçek-zamanlı çağrı bildirimi** göründü.
- [ ] Kayıtlı bir müşteri numarasıyla test edildi → **müşteri eşleştirmesi** çalıştı.
- [ ] Rol testi: çağrı akışı **ADMIN/MANAGER**'da görünür, WAITER/KITCHEN'da görünmez.
- [ ] KVKK: aydınlatma metni yayında, saklama/silme süreci ve veri minimizasyonu politikası devrede.
- [ ] Operatöre **kullanım + sorun giderme + KVKK** eğitimi verildi; RMA/garanti süreci anlatıldı.

---

> Son guncelleme: 2026-07-02 - surum taslagi. Regulasyon/mali bilgiler bilgilendirme amaclidir; guncel resmi mevzuat (GIB, BKM, KVKK Kurumu, Ticaret Bakanligi, ilgili yonetmelikler) esastir.

---

## Kaynaklar (doğrulanmış mevzuat)

- 6698 sayılı Kişisel Verilerin Korunması Kanunu (m.3 tanım, m.5 hukuki sebepler, m.9 yurt dışına aktarım, m.10 aydınlatma, m.12 veri güvenliği; 7499 sayılı Kanun ile m.9 değişikliği): https://mevzuat.gov.tr/mevzuatmetin/1.5.6698.pdf
- KVKK — Aydınlatma Yükümlülüğü: https://www.kvkk.gov.tr/Icerik/2033/Aydinlatma-Yukumlulugu-
- Elektromanyetik Uyumluluk Yönetmeliği (2014/30/AB), RG 2.10.2016 sayı 29845: https://www.resmigazete.gov.tr/eskiler/2016/10/20161002-2.htm
- Belirli Gerilim Sınırları İçin Tasarlanan Elektrikli Ekipman ile İlgili Yönetmelik (2014/35/AB — LVD), RG 2.10.2016: https://www.resmigazete.gov.tr/eskiler/2016/10/20161002-1.htm
- Telsiz Ekipmanları Yönetmeliği (2014/53/AB — RED), RG 5.11.2020 sayı 31295: https://www.resmigazete.gov.tr/eskiler/2020/11/20201105-6.htm
- Atık Elektrikli ve Elektronik Eşyaların Yönetimi Hakkında Yönetmelik, RG 26.12.2022 sayı 32055: https://www.mevzuat.gov.tr/MevzuatMetin/yonetmelik/7.5.40055.pdf
- 6502 sayılı Tüketicinin Korunması Hakkında Kanun, RG 28.11.2013 sayı 28835: https://www.resmigazete.gov.tr/eskiler/2013/11/20131128-1.htm
- Garanti Belgesi Yönetmeliği, RG 13.6.2014 sayı 29029: https://www.resmigazete.gov.tr/eskiler/2014/06/20140613-2.htm
