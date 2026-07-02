# Yazarkasa POS (Ödeme Kaydedici Cihaz / ÖKC)

> **Bu belge kimin için?** Restoran operatörü (günlük kullanım, mali sorumluluk) ve HummyTummy bayisi/satıcısı (tedarik, kurulum, devreye alma, satış sonrası) için hazırlanmıştır.
>
> **Önemli uyarı:** Yazarkasa/ÖKC, HummyTummy'de sattığımız **tek "mali sorumluluğu bulunan" cihaz sınıfıdır.** Bu cihazlar 3100 sayılı Kanun ve Gelir İdaresi Başkanlığı (GİB) mevzuatına tabidir; kurulum, aktivasyon, mühürleme ve bakımı **yalnızca GİB'e bildirilmiş yetkili servis** tarafından yapılabilir. HummyTummy bu cihazı **doğrudan satmaz/aktive etmez**, üretici/yetkili bayi kanalına yönlendirir ve yazılım entegrasyonunu sağlar. Metindeki mevzuat eşiği, tarih ve ücretlerin bir kısmı defalarca ertelenmiştir; **her sayısal/tarihsel iddiayı devreye almadan önce resmi kaynaktan (ynokc.gib.gov.tr) teyit edin.**
>
> **Entegrasyon olgunluğu uyarısı (kritik):** HummyTummy'nin **backend** tarafı (ödeme kalıcılaştıktan sonra fiş komutunu üretip `FiscalDeviceRecord`'a kuyruklama, çift-fiş guard'ı) gerçek ve çalışır durumdadır. Ancak **köprü (local-bridge) tarafındaki yazarkasa sürücüleri henüz üretime hazır değildir:** Hugin sürücüsü şu an bir **iskelettir** (komutlar köprüde başarısız olur, fiziksel mali fiş **basılmaz**), Beko/Token için **hiç sürücü yoktur**, ve mevcut Ingenico sürücüsü farklı bir terminal ailesi (iWL) içindir ve o da iskelettir. Bu nedenle **hiçbir yazarkasa markası şu an uçtan uca fiş basımı için doğrulanmamıştır** — bkz. §2 ve §4.3. Satıştan önce ilgili sürücünün gerçek protokol implementasyonu ve entegrasyon onayı gerekir.

---

## 1. Genel bakış

**Yazarkasa POS / Yeni Nesil Ödeme Kaydedici Cihaz (YN ÖKC)**, perakende mal ve hizmet satışında yapılan satışın bedelini ve KDV'sini işlem anında hesaplayıp **mali hafızaya** kaydeden ve müşteriye **mali fiş** (yasal belge) üreten, GİB onaylı elektronik cihazdır. 3100 sayılı Kanun kapsamında perakende mal/hizmet satan mükelleflerin ÖKC kullanması esas olup restoran/lokanta bu kapsamdadır; ancak tüm satışlarını e-Fatura/e-Arşiv ile belgeleyen mükellefler için **muafiyet yolu vardır** (bkz. §9, *resmi kaynaktan teyit edilmeli*).

**Sistemdeki rolü (`Device.kind = yazarkasa`):**

- HummyTummy KDS/POS'ta sipariş kapanınca (ödeme alınınca) mali belgenin (fişin) kesilmesinden bu cihaz sorumludur. Yazılım tarafında bu, `payment-finalizer` ve `payments` servislerindeki **post-commit fiş kesme (fiscal receipt)** adımıdır: ödeme kalıcılaştıktan sonra, şubede aktif bir fiziksel yazarkasa `FiscalDeviceRecord` varsa **GMP-3 komutu** cihaza **kuyruklanır**. (Not: komutun köprü üzerinden cihaza iletilip fişin fiziksel olarak basılması, o markanın köprü sürücüsünün gerçek implementasyonuna bağlıdır — bkz. üstteki entegrasyon uyarısı.)
- Cihaz, HummyTummy'nin **device-mesh** envanterinde bir cihaz kaydı (slot) olarak tutulur: `Device.kind = yazarkasa`, `ownership = sold | rented | byo`, `warrantyUntil`, `capabilities[]` (ör. `['print_80mm','cash_drawer','fiscal']`).
- **Bağlantı topolojisi:** Yazarkasa bir **LAN çevre birimidir** — doğrudan buluta bağlanmaz. **HummyBox köprüsü** (`local_bridge`) arkasında çalışır (`bridgeId` set). Köprü; WSS heartbeat + SQLite offline kuyruk + **yazarkasa/ESC-POS/POS sürücülerini** taşır ve GMP-3 komutlarını cihaza iletmeyi hedefler.

**İki mali entegrasyon modeli (HummyTummy'de — hedeflenen tasarım):**

| Model | Cihaz örneği | Nasıl çalışması hedeflenir |
|---|---|---|
| **Standalone yazarkasa fişi** | Hugin Tiger T300, Beko 300TR (basit/bilgisayar-bağlantılı kullanım) | HummyTummy ödeme kapanınca köprü üzerinden GMP-3 ile cihaza `fiscal_receipt` komutu gönderir; cihaz tüm sipariş için **tek mali fiş** basar. **Durum:** köprü sürücüsü henüz iskelet olduğundan bu akış uçtan uca çalışmamaktadır (*sürücü implementasyonu gerekir*). |
| **`fiscal_coupled` (GMP-3 kart+fiş eşlemesi)** | Bankalı EFT-POS özellikli YN ÖKC | Kart POS terminali bankadan onay alır **ve aynı işlemde mali fişi kendisi basar**. Bu durumda HummyTummy `payment-finalizer` içindeki **çift-fiş guard'ı**, işleme bir `fiscalNo` yazıldığını görürse ayrıca standalone yazarkasa fişi kesmez (mükerrer fiş engellenir). Bu guard mantığı backend'de gerçektir. |

> **Kritik kural:** "**Bilgi fişi**" mali belge **DEĞİLDİR** (bilgilendirme amaçlıdır). **Mali fiş** yalnızca onaylı ÖKC/yazarkasadan kesilir. HummyTummy'nin bastığı adisyon/ön hesap/mutfak fişi mali belge değildir; yasal satış belgesi ancak ÖKC'den çıkar.

---

## 2. Modeller ve teknik özellikler

> Fiyatlar KDV dahil **referans perakende** değerlerdir; piyasa ve kur ile değişir — güncel fiyatı bayi/distribütörden teyit edin (*resmi kaynaktan teyit edilmeli*).
>
> **Adaptör/sürücü durumu (satış öncesi mutlaka okuyun):** Aşağıdaki modeller için verilen "HummyTummy ile GMP-3 üzerinden çalışır" anlatısı **hedeflenen tasarımdır, doğrulanmış bir yetenek değildir.** Kod tabanında yalnızca ESC/POS termal yazıcı sürücüsü gerçek çalışır; Hugin ve Ingenico(iWL) sürücüleri iskelet, Beko sürücüsü ise henüz mevcut değildir (*entegrasyon geliştirmesi + onayı gerekir*).

### 2.1 Hugin Tiger T300 4G — **6.400 TL** (KDV dahil, *resmi kaynaktan teyit edilmeli*) · 24 ay garanti (*üretici belgesinden teyit edilmeli*)

Yeni Nesil ÖKC; 4G, dahili termal yazıcı, GİB onaylı. Entegre kart okuyucusu (çip/manyetik/temassız) vardır; restoran otomasyonuyla **GMP-3 üzerinden basit/bilgisayar-bağlantılı** modda ya da bank uygulaması yüklüyken **EFT-POS özellikli** modda çalışabilir (çalışma modu/banka anlaşması *bayiden teyit edilmeli*). Model adı ve künye değerleri *üretici resmi künyesinden teyit edilmeli*.

| Özellik | Değer |
|---|---|
| Tür | YN ÖKC (mobil), entegre kart okuyucu |
| İşlemci / Bellek | ARM Cortex-A5 ~500 MHz güvenli işlemci · 64 MB RAM · 128 MB Flash *(resmi kaynaktan teyit edilmeli)* |
| Ekran | 2.8" renkli rezistif dokunmatik (320×240) + OLED müşteri ekranı |
| Yazıcı | Dahili termal, ~30 satır/sn; **kağıt genişliği** mobil ÖKC'lerde yaygın **57/58 mm** — kesin genişlik cihaz kılavuzundan *teyit edilmeli* (metindeki "~40 mm" değeri kağıt genişliği değil rulo çapı olabilir; genişlik/çap ayrımı için üretici künyesi esastır) |
| Bağlantı | 4G (SIM×1) · Ethernet (RJ45) · Micro-USB OTG · seri port (çekmece/pinpad/barkod) · SAM×2 |
| Ödeme | Çip (EMV L1&L2), manyetik, temassız (NFC) |
| Batarya / Güç | 3000 mAh · şarj+iletişim ünitesi DC 9V 1A |
| Boyut / Ağırlık | 164 × 80 × 63 mm · ~360 g |
| Mali kapasite | EKÜ ~80 milyon satır · PLU ~100.000 · mali bellek ömrü ~20 yıl *(resmi kaynaktan teyit edilmeli — mali hafıza tipik olarak belirli Z sayısı/yıl ile sınırlıdır)* |
| Sertifika | PCI-PTS 5.x · EMV L1&2 · temassız şemalar (PayPass/payWave vb.) · CE/FCC/CCC · TSE · GİB onaylı |
| Çalışma sıcaklığı | 0 … +45 °C |
| **HummyTummy sürücü durumu** | Köprü sürücüsü **iskelet** — fiş basımı uçtan uca **doğrulanmamıştır** (*gerçek RS-232/USB-Serial protokol implementasyonu gerekir*) |

### 2.2 Beko 300TR Temassız — **6.500 TL** (KDV dahil, *resmi kaynaktan teyit edilmeli*) · 24 ay garanti (*üretici belgesinden teyit edilmeli*)

Temassız (NFC) YN ÖKC; GİB onaylı. "Android tabanlı" tanımı ürün künyesinden alınmıştır; **platform/işletim sistemi ve RAM detayı bayiden/üreticiden teyit edilmelidir** (bazı kaynaklar 300TR'yi gömülü/düşük-RAM ÖKC platformu olarak, Android'i üst modellerde listeler). GMP-3 entegrasyonunu desteklediği belirtilir (*resmi kaynaktan teyit edilmeli*).

| Özellik | Değer |
|---|---|
| Tür | Temassız (NFC) YN ÖKC |
| Platform | "Android tabanlı" (künye) — **sürüm/OS/RAM bayiden teyit** *(resmi kaynaktan teyit edilmeli)* |
| Ekran | 3.5" TFT renkli dokunmatik |
| Ödeme | Temassız (NFC) · çip (EMV L1&L2) · manyetik; 20 banka + 4 yemek kartı uygulaması; PCI 4.x |
| Bağlantı | Ethernet (kablolu) + kablosuz 2G/3G; GMP-3 entegrasyonu (X30/300TR) |
| Tuş takımı | 15 tuş (ışıklı) |
| Yazıcı | Dahili termal (satır hızı/rulo genişliği *bayiden teyit edilmeli*) |
| Ağırlık | ~432 g |
| Sertifika | EMV L1&L2 · PCI 4.x · TSE · GİB onaylı |
| **HummyTummy sürücü durumu** | **Sürücü henüz YOK** — Beko/Token/300TR için köprüde bir LocalDriver implementasyonu bulunmuyor; **satıştan önce sürücü yazılması + entegrasyon onayı zorunludur** |

### 2.3 Ingenico Move/5000F — **19.000 TL** (KDV dahil, *resmi kaynaktan teyit edilmeli*) · 24 ay garanti (*üretici belgesinden teyit edilmeli*)

Taşınabilir **bankalı ÖKC/POS** (EFT-POS özellikli YN ÖKC — fiscal + kart bir arada). **Yetkili banka/servis modeli:** cihaz çoğunlukla banka/PSP kanalı üzerinden tahsis/kira ile devreye alınır; HummyTummy'de bu, mağaza tarafında **banka/PSP'ye yönlendirme (PARTNER_REDIRECT)** olarak modellenir. Model varyantının (fiscal "F") Türkiye'de GİB onaylı YN ÖKC künyesi olarak birebir mevcudiyeti *resmi kaynaktan teyit edilmeli*.

> **Önemli düzeltme:** Kod tabanındaki tek Ingenico sürücüsü **iWL ailesi (iWL2xx)** içindir — bu belgede satılan **Move/5000F değildir** ve farklı bir terminal ailesidir. Ayrıca bu sürücü de **iskelettir** ve **kart-ödeme (acquirer) protokolü** için tasarlanmıştır, **fiscal/GMP-3 fiş basımı için değildir.** Dolayısıyla "Move/5000F HummyTummy adaptörüyle mali fiş basar" ifadesi hem model hem işlevsellik açısından geçerli değildir. Move/5000F bu belgede zaten doğru şekilde **PARTNER_REDIRECT** (banka/PSP kanalı) olarak konumlandırılmıştır; mali fiş cihazın kendi banka/PSP entegrasyonuyla basılır, HummyTummy adaptörüyle değil.

| Özellik | Değer |
|---|---|
| Tür | Taşınabilir EFT-POS özellikli YN ÖKC (bankalı; fiscal + kart) |
| İşlemci / Depolama | ARM Cortex · hafıza kartı ile 32 GB'a kadar |
| Ekran | Kapasitif dokunmatik (eldivenle çalışabilir) |
| Tuş takımı | 4 × 4 fiziksel tuş |
| Yazıcı | Dahili termal, ~30 satır/sn |
| Bağlantı | 4G (gerekince 2G'ye düşer) · Ethernet |
| Ödeme | Temassız · çip · manyetik (MasterCard PayPass, Visa payWave) |
| Batarya | 2900 mAh |
| Boyut / Ağırlık | 194.4 × 91.1 × 65.85 mm · ~420 g |
| Dayanıklılık | 1.2 m düşmeye dayanıklı · -10 … +45 °C |
| Onay | TÜBİTAK + GİB onaylı *(resmi kaynaktan teyit edilmeli)* |
| **HummyTummy sürücü durumu** | Mağazada **PARTNER_REDIRECT** — fiş, banka/PSP entegrasyonuyla basılır. Koddaki iWL sürücüsü bu modelle eşleşmez ve fiscal değildir |

---

## 3. Kullanım / operasyon (günlük senaryo)

**Gün başı (açılış):**
1. Cihazı şarj ünitesinden alın/açık olduğundan emin olun; batarya ve kağıt rulosunu kontrol edin.
2. HummyBox köprüsünün açık ve yeşil (bulutla bağlı) olduğunu doğrulayın — köprü kapalıysa fiş komutu cihaza gitmez, offline kuyruğa yazılır.
3. Cihazın GİB/TSM bağlantısının kurulu olduğunu ekrandan teyit edin.

**Satış sırasında (tipik hedeflenen akış):**
1. Garson/kasa HummyTummy POS'ta siparişi alır, adisyonu işler (bu adisyon **mali belge değildir**).
2. Ödeme adımında "Ödemeye Geç" → **Nakit** veya **Kart** seçilir.
   - **Nakit / harici tahsilat:** Sipariş kapanınca HummyTummy köprü üzerinden yazarkasaya **GMP-3 `fiscal_receipt`** komutu gönderir; cihaz tüm sipariş için **tek mali fiş** basar (*ilgili köprü sürücüsü gerçek olduğunda*).
   - **Kart (fiscal_coupled — bankalı EFT-POS ÖKC):** Terminal bankadan onay alır ve **aynı işlemde mali fişi kendisi basar**; HummyTummy çift-fiş guard'ı sayesinde ikinci fiş kesmez.
3. Fişi müşteriye verin. Kartlı satışta banka slibini de içeren **bütünleşik YN ÖKC satış fişi** düzenlenir.

**Özel durumlar:**
- **Fatura/e-Arşiv:** Fatura ile belgelenen satış, yemek kartı satışı vb. için ÖKC'den **"YN ÖKC Bilgi Fişi"** basılır (mali fiş yerine geçmez, GİB düzenlemesi gereği). e-Fatura/e-Arşiv düzenlenen işlemlerde mali fiş yerine bilgi fişi verilir.
- **İade/iptal:** Fiş kesildikten sonraki iade/iptal, ÖKC ve muhasebe kurallarına göre işlenir; HummyTummy tarafında iptal/void, kayıtlı ödemeyi güvenli şekilde günceller.

**Gün sonu (kapanış) — zorunlu:**
1. **Z Raporu** alın. Z, o günün tüm satışlarının **mali özetidir**, mali hafızaya kaydedilir ve **her iş günü sonunda alınması + saklanması zorunludur.**
2. Gün içinde ara kontrol için **X Raporu** alınabilir — X **mali değildir**, yalnızca bilgi amaçlıdır (Z'yi sıfırlamaz).
3. Nakit çekmecesini (varsa) Z ile karşılaştırın.

---

## 4. Kurulum ve sisteme bağlama

### 4.1 Fiziksel / mali kurulum (yetkili servis)
- YN ÖKC'nin ilk **aktivasyonu, mali kurulumu ve mühürlemesi yalnızca GİB'e bildirilmiş yetkili servis** tarafından yapılır. Operatör/bayi cihazı kendisi mühürleyemez veya kasayı açamaz — **elektronik mühür fiziki müdahaleyi algılar, olay kaydı düşer ve cihazı devre dışı bırakır.**
- Kurulumda: SIM/hat (4G) veya Ethernet, kağıt rulosu, şarj ünitesi, TSM/GİB bağlantısı ve **mali levha** kaydı tamamlanır.

### 4.2 HummyTummy mağaza akışı ve satış tier'ı
- Yazarkasa/YN ÖKC, mağazada (`/admin/store`) **`QUOTE_ONLY` (Tier 1 — mali)** olarak listelenir: doğrudan PayTR ile satın alınmaz; **"Teklif Al"** ile ilerlenir, tedarik + GİB aktivasyonu bayi/yetkili servis üzerinden yürür.
- Bankalı Ingenico gibi cihazlar mağazada **`PARTNER_REDIRECT` (Tier 2)** olarak lisanslı banka/PSP'ye yönlendirilir.
- Karşılaştırma: Normal donanım (KDS ekranı, yazıcı, tablet) `DIRECT_SALE`'dir — sepet → **PayTR** ödemesi → **sipariş ödenince device-mesh slotu otomatik açılır** (deterministik `provisionKey` + pg advisory-lock, idempotent). **Yazarkasa bu otomatik akışa girmez;** cihaz slotu, teklif/kurulum tamamlandıktan sonra manuel olarak açılır.

### 4.3 Provizyon ve eşleştirme (pairing) — gerçek akış
1. **Slot oluşturma:** Admin panelde ilgili şubenin cihaz hub'ında (`/admin/branches/:id`) `kind = yazarkasa` bir cihaz slotu oluşturulur. Slot **HummyBox köprüsünün arkasına** bağlanır (`bridgeId` set — yazarkasa LAN çevre birimidir).
2. **pairCode:** Sistem **alfanümerik 6 karakterli** bir pairCode üretir (**[A-Z0-9]** alfabesi, ~36⁶ ≈ 2.2 milyar uzay, rejection-sampling ile) — **10 dk geçerli**, **şube başına en çok 10 bekleyen slot**. (Not: kod yalnız rakam değildir; harf de içerebilir.)
3. **Claim:** Cihaz uygulaması pairCode ile `POST /v1/devices/pair` çağırır → **tek-kullanımlık atomik claim** → **sha256-hash'li rotating bearer token** döner (**24 saat TTL**, `DEVICE_TOKEN_TTL_MS`; **yalnızca pair anında verilir**, heartbeat'te uzamaz). **Ham token yalnızca bir kez döner; sunucuda at-rest hash'lenir.** **Uyarı — nadiren etkileşimli cihaz:** device-mesh bearer token varsayılan TTL'i (`DEVICE_TOKEN_TTL_MS`) **24 saattir** ve `caller_id`/`scanner` dahil **her** `Device.kind` gibi **yazarkasa** için de geçerlidir. **`heartbeat()` yalnızca `status` ve `lastSeenAt`'i günceller; `tokenExpiresAt`'e dokunmaz — yani token süresini UZATMAZ (kayan/rotating TTL değildir).** Token pair'den **24 saat sonra dolar**; süresi dolan token `authenticateToken` tarafından reddedilir ve main/prod dalında token yenileme (refresh) yoktur. Bu nedenle yazarkasa günlük olarak açık/çevrimiçi tutulmazsa — ör. kapalı işletmede uzun süre çevrimdışı kalırsa — token dolar ve cihaz artık kimlik doğrulayamaz → **yeniden pair** gerekir (slottan **yeni pairCode** üretip `POST /v1/devices/pair`). Bu yüzden köprü/cihazın açık tutulması önerilir.
4. **Köprü tarafı:** HummyBox, yazarkasa sürücüsü üzerinden GMP-3 komutlarını cihaza iletmeyi hedefler; internet kesintisinde komutlar **SQLite offline kuyruğa** alınır. **Önemli:** ilgili markanın köprü sürücüsü gerçek implementasyona sahip değilse (Hugin iskelet, Beko yok) komut köprüde başarısız olur ve **fiş fiziksel olarak basılmaz.**
5. **Doğrulama:** `FiscalDeviceRecord` aktif ve şubeye bağlı görünmelidir. **Uyarı:** "Test siparişiyle deneme fişi kesilir" adımı, ancak ilgili markanın gerçek köprü sürücüsü mevcut olduğunda uçtan uca geçerlidir; mevcut iskelet sürücülerle deneme fişi **basılmaz** (*sürücü implementasyonu gerekir*).

> **Cloud-direct değil, köprü arkası:** Tablet/KDS ekranı doğrudan buluta bağlanır (`bridgeId = null`). Yazarkasa, ESC/POS yazıcı ve kart POS terminali **her zaman HummyBox köprüsü arkasındadır.**

---

## 5. Tedarik ve sağlayıcı (bayi notları)

| Ürün | Üretici | TR kanal | Not |
|---|---|---|---|
| Hugin Tiger T300 4G | Hugin (Türkiye markası) | Yetkili Hugin bayileri / barkod-ÖKC distribütörleri | Yaygın stok, kısa tedarik süresi. **HummyTummy köprü sürücüsü iskelet** |
| Beko 300TR | Beko / Arçelik; ödeme tarafı **Token Finansal Teknolojiler** | Token bayileri, Beko/Arçelik kanalı | GMP-3 dokümantasyonu Token üzerinden. **HummyTummy sürücüsü henüz yok** |
| Ingenico Move/5000F | Ingenico (Worldline) | **Banka/PSP kanalı** (yetkili banka + servis) | Genelde banka üzerinden tahsis/kira; peşin satış ikincil kanal. Fiş banka/PSP entegrasyonuyla basılır |

- **Tedarik süresi:** Hugin/Beko için stoktan tipik olarak kısa (günler); Ingenico'da banka onay/tahsis süreci uzayabilir (*resmi kaynaktan teyit edilmeli*).
- **Tahmini alış maliyeti ve marj:** YN ÖKC donanımında bayi marjı genelde **incedir**; asıl gelir kağıt/rulo, yıllık **mali abonelik/TSM servis bedeli**, kurulum ve bakım sözleşmelerindedir (sektörel genelleme — *distribütör anlaşmasından teyit edilmeli*). Verilen perakende referanslar (6.400 / 6.500 / 19.000 TL) üzerinden bayi alış fiyatı ve marj **distribütör anlaşmasına göre değişir** ve burada rakam verilmemiştir (*resmi kaynaktan teyit edilmeli*). Bankalı Ingenico'da "alış" yerine çoğu zaman **kira/komisyon** modeli geçerlidir.
- **Alternatif kaynak:** Aynı sınıfta başka GİB onaylı YN ÖKC'ler (ör. Hugin/Beko üst modelleri, Profilo, diğer TSM'li üreticiler) — ancak HummyTummy köprü tarafında **hiçbir yazarkasa markası şu an uçtan uca doğrulanmış değildir** (yalnızca ESC/POS termal yazıcı sürücüsü gerçek çalışır); her yeni üretici/model için sürücü implementasyonu + entegrasyon onayı gerekir.

---

## 6. Bakım ve sarf malzeme

- **Sarf — termal kağıt rulo:** Cihazın kağıt genişliğine uygun **termal rulo** kullanın (mobil ÖKC'lerde yaygın 57/58 mm; **kesin genişlik cihaz kılavuzundan/bayiden teyit edilmeli** — rulo genişliği ile çapı karıştırılmamalı). Termal kağıt ısı/ışıkla solar — mali fiş saklama süresi boyunca okunabilirlik için kaliteli rulo ve uygun arşivleme gerekir.
- **Batarya/pil:** Mobil modellerde Li-ion batarya (Hugin ~3000 mAh, Ingenico ~2900 mAh); zamanla kapasite düşer, **yetkili serviste** değişir (kasa mühürlü olduğu için kullanıcı açamaz).
- **Temizlik:** Kart okuyucu yuvası ve temassız (NFC) alanı kuru/temiz tutulmalı; yazıcı kafası basınçlı hava/temizlik kalemiyle temizlenmeli. Cihaza sıvı/çözücü uygulanmamalı.
- **Firmware/güncelleme:** ÖKC firmware ve mali yazılım güncellemeleri **TSM merkezi üzerinden / yetkili servis eliyle** yapılır — operatör kendi başına flash yapamaz. HummyTummy tarafı (köprü ajanı, kiosk) ayrı güncellenir.
- **Periyodik kontrol:** Hat/SIM aboneliği, TSM bağlantısı, Z raporu düzeni, mali bellek doluluk durumu ve mühür bütünlüğü periyodik kontrol edilmeli.

---

## 7. Sorun giderme ve arıza

| Belirti | Olası neden | Çözüm |
|---|---|---|
| Fiş basılmıyor / HummyTummy'de fiş komutu takılı | HummyBox köprüsü offline (komut SQLite kuyruğunda) **veya** ilgili markanın köprü sürücüsü henüz iskelet/eksik | Köprü heartbeat'ini kontrol et; internet/LAN'ı düzelt. Sürücü iskeletse fiş uçtan uca basılmaz → entegrasyon ekibine ilet (*sürücü implementasyonu gerekir*) |
| Cihaz bulutta görünmüyor / eşleşme kopmuş | Bearer token TTL doldu, heartbeat yok | Cihaz uygulamasını yeniden başlat; gerekirse yeni pairCode ile `POST /v1/devices/pair` |
| pairCode geçersiz | 10 dk süre doldu veya tek-kullanım claim edildi | Slottan **yeni pairCode** üret (alfanümerik 6 karakter; şube başına ≤10 bekleyen slot) |
| "Mühür/olay kaydı" hatası, cihaz işlem yapmıyor | Elektronik mühür fiziki müdahale algıladı | **Kullanıcı müdahale edemez** → yetkili servis (RMA/servis kaydı) |
| Kağıt sıkışması / soluk baskı | Yanlış rulo, kirli yazıcı kafası, düşük batarya | Doğru termal rulo tak, kafayı temizle, şarj et |
| Kart okumuyor (çip/temassız) | Okuyucu kirli/arızalı, NFC anten sorunu | Yuvayı temizle; sürerse yetkili servis |
| Z raporu alınamıyor / mali bellek uyarısı | Mali bellek dolmuş/arıza | Yetkili servis; mali bellek işlemleri mevzuata tabidir |
| 4G/hat yok | SIM/abonelik, kapsama | Ethernet'e al veya operatör/SIM kontrolü |

**Ne zaman RMA/servis:** Mühür ihlali, mali bellek/EKÜ arızası, açılmayan cihaz, yazıcı/okuyucu donanım arızası, batarya değişimi → **daima yetkili servis** (kullanıcı kasayı açamaz).

---

## 8. Garanti ve RMA süreci

- **Süre ve garanti rejimi (B2B):** Mağaza (`/admin/store`) üzerinden restoran **işletmesine** yapılan yazarkasa satışı bir **B2B işlemdir** (satıcı: HummyTummy/bayi; alıcı: kural olarak **tacir** olan restoran işletmesi). 6502 sayılı Tüketicinin Korunması Hakkında Kanun (TKHK) (Resmî Gazete 28.11.2013, sayı 28835; m.3 tüketiciyi "ticari veya mesleki olmayan amaçlarla hareket eden gerçek/tüzel kişi" olarak tanımlar) ve Garanti Belgesi Yönetmeliği'nin (Resmî Gazete 13.6.2014, sayı 29029) **tüketici** ürünleri için öngördüğü asgari garanti süreleri (yönetmelik ekindeki listeye tabi, asgari 2 yıl) ve tüketici koruma hükümleri **tüketiciye** yöneliktir ve **tacirler arası satışta kural olarak uygulanmaz.** Bunun yerine 6098 sayılı **Türk Borçlar Kanunu**'nun ayıp hükümleri (satıcının ayıptan sorumluluğu — TBK m.219) ve **tarafların kararlaştırdığı garanti süresi** geçerlidir; TBK'nın ayıp hükümleri **emredici değildir** (m.221'deki ağır kusur hâli hariç, sorumsuzluk/sınırlama kaydı geçerlidir). Bu nedenle üreticinin verdiği **12 veya 24 ay** garanti **geçerlidir**; bu bir "tüketici mevzuatı asgari garantisi" değil, üreticinin/satıcının **ticari garanti taahhüdüdür.** Verilen künyelerde **24 ay** belirtilmiştir (*üretici garanti belgesinden teyit edilmeli*). **Notlar:** (a) Alıcı istisnaen **tüketici** sayılırsa (ticari/mesleki amaç dışı alan gerçek kişi) 6502 devreye girer ve tüketici asgari süreleri uygulanır; (b) **tacir** alıcı, TBK m.223 uyarınca teslim aldığı cihazı gözden geçirme (muayene) ve ayıbı süresinde **ihbar** külfetine tabidir; tacirler arası satışta **TTK m.23/1-c'nin kesin süreleri** uygulanır: **açık ayıpta 2 gün** içinde, gizli ayıpta ise **ayıbın ortaya çıkmasından itibaren 8 gün** içinde inceleme/ihbar zorunludur — süresinde ihbar edilmeyen ayıp bakımından cihaz kabul edilmiş sayılır. Garantinin **süresi (12/24 ay)** üreticinin garanti belgesinden (*teyit edilmeli*) alınır. `Device.warrantyUntil` alanına satış/aktivasyon tarihine göre girilmelidir. → Satış hukuku rejiminin ayrıntısı için bkz. `00-genel-cerceve.md`, Bölüm 3 (Mesafeli Satış — Satış Hukuku Rejimi).
- **Kapsam:** Üretim/donanım hataları kapsamdadır. **Mühür ihlali, yetkisiz açma, sıvı/fiziksel hasar, yetkisiz firmware müdahalesi garantiyi bozar.** ÖKC'de servis **yalnızca yetkili servis** üzerinden olduğundan, garanti işlemi de bu kanaldan yürür.
- **RMA akışı:** Arıza tespiti → yetkili servis kaydı → **servis tutanağı** → onarım/değişim. Hurdaya ayırma/iade durumunda **servis tutanağı + mali hafıza raporu + ÖKC levhası** ilgili vergi dairesine mükellef veya servis tarafından teslim edilir/gönderilir.
- **Satıcı (bayi) yükümlülükleri:** Doğru cihazın tedariki, yetkili servis kanalına yönlendirme, garanti belgesi teslimi, HummyTummy tarafında slot/pairing kurulumu ve devreye alma desteği. **Mali aktivasyon/mühürleme bayinin değil, GİB yetkili servisinin işidir.**

---

## 9. Regülasyon ve uyumluluk

> Bu bölümdeki her sayısal eşik/tarih/ücret **GİB'in resmi YN ÖKC portalından (ynokc.gib.gov.tr) ve ilgili VUK Genel Tebliğlerinden teyit edilmelidir**; birçok tarih defalarca ertelenmiştir (*resmi kaynaktan teyit edilmeli*).

- **Zorunluluk ve muafiyet:** 3100 sayılı Kanun kapsamında perakende mal/hizmet satan mükelleflerin ÖKC kullanması esastır; restoran/lokanta bu kapsamdadır. **Ancak muafiyet yolu gerçektir:** tüm satışlarını e-Arşiv Fatura/e-Fatura ile belgeleyen mükellefler, 483 Sıra No.lu VUK Genel Tebliği (Resmî Gazete 30.9.2017, sayı 30196) koşullarında ÖKC zorunluluğu dışında kalabilir. Muafiyet mükellefiyet türü/koşula bağlıdır; mali müşavir + 483 VUK GT teyidi gerekir (*resmi kaynaktan teyit edilmeli*).
- **Mecburiyet kronolojisi (doğrulanmış):** YN ÖKC mecburiyeti ilk kez **426 Sıra No.lu VUK Genel Tebliği** (2012) ile getirilmiştir; **483 Sıra No.lu VUK Genel Tebliği** (Resmî Gazete 30.9.2017, sayı 30196) kullanım koşullarını ve mali bilginin GİB'e elektronik iletimini düzenlemiş; **509 Sıra No.lu VUK Genel Tebliği** (Resmî Gazete 19.10.2019, sayı 30923) e-belge/e-Arşiv ve adisyon düzenini getirmiştir. Bu tebliğ metinleri GİB YN ÖKC mevzuat portalında yayımlıdır (ynokc.gib.gov.tr).
- **YN ÖKC türleri:**
  - **EFT-POS özellikli YN ÖKC:** Bünyesinde banka POS'u barındırır (ör. bankalı Ingenico Move/5000F sınıfı).
  - **Basit / Bilgisayar bağlantılı YN ÖKC:** Banka POS'u barındırmaz; haricen POS/kasa bağlanır (ör. Hugin/Beko'nun restoran otomasyonuna GMP-3 ile bağlandığı kullanım).
- **GMP-3 protokolü:** GİB'in, YN ÖKC ile harici kasa/POS/otomasyon arasındaki **kablolu haberleşme protokolüdür** (basit/bilgisayar bağlantılı YN ÖKC'ye kablolu EFT-POS/otomasyon bağlantısı bu protokole göre yapılır); teknik dokümanı 483 Sıra No.lu VUK Genel Tebliği (Resmî Gazete 30.9.2017, sayı 30196) kapsamında GİB YN ÖKC mevzuat portalında (ynokc.gib.gov.tr) yayımlanır. **Protokolün açılımı** ("Güvenli Mali Program" açılımı dahil) ve sürüm/kapsam detayı GİB güncel teknik kılavuzundan *teyit edilmeli*.
- **Mali hafıza & TSM:** YN ÖKC'ler; kurulum, yönetim, izleme ve GİB ile güvenli iletişim için **TSM (Trusted Service Manager) merkezleri** üzerinden çalışır. **TSM bağlantısı zorunludur: cihaz TSM olmadan GİB ile haberleşemez.** TSM, üreticinin kurduğu/dış hizmet aldığı, güvenlik standartlı bilgi işlem merkezidir. Cihazın **mali hafızası değiştirilemez;** günlük **Z raporu** ve mali veriler TSM üzerinden GİB'e iletilir.
- **Mali levha/kayıt:** Cihaz için **ÖKC levhası** düzenlenir; hurdaya ayırma vb. işlemlerde servis tutanağı + mali hafıza raporu + levha vergi dairesine iletilir.
- **e-Fatura/e-Arşiv bağlantısı:** Fatura/e-Arşiv düzenlenen işlemlerde ÖKC'den **bilgi fişi** basılır; HummyTummy'de bulut e-Fatura/e-Arşiv rayı ayrıca çalışır.
- **Yetkili servis & mühürleme:** Bakım/onarım/aktivasyon **yalnızca GİB'e bildirilmiş yetkili servisçe** yapılır. **Elektronik mühür**, kapağın açılması/zorlanması gibi fiziki müdahaleleri algılar, olay kaydı düşer ve cihazı devre dışı bırakır. (GİB YN ÖKC düzenlemeleriyle uyumludur.)
- **Bilgi fişi vs mali fiş:** **Mali fiş** yasal satış belgesidir (KDV mali hafızaya yazılır). **Bilgi fişi** mali belge değildir. Bu ayrım metnin tamamı için bağlayıcıdır. (GİB düzenlemeleriyle uyumludur.)
- **Z / X raporu:** **Z Raporu** mali özettir, günlük zorunludur ve saklanır; **X Raporu** mali değildir, bilgi amaçlıdır.
- **Geçiş tarihleri (teyit gerektiren — *resmi kaynaktan teyit edilmeli*):**
  - **Eski nesil ÖKC → YN ÖKC değişimi:** Metinde geçen tek/mutlak **1/7/2024** tarihi kırılgandır. GİB uygulamasında genel kural, eski nesil ÖKC'lerin **mali hafızaları dolana / cihaz mali ömrü bitene** kadar kullanılıp ardından YN ÖKC ile değiştirilmesidir; toplu geçiş tarihleri VUK Genel Tebliğleriyle (427/483/507 vb.) defalarca ertelenmiştir. Bugün (2026) itibarıyla bu tarih **geçmiştir** ve büyük olasılıkla güncel düzenleme ile aşılmıştır → nihai tarih ynokc.gib.gov.tr + ilgili VUK GT'den teyit edilmeli.
  - **Kartlı ödemenin YN ÖKC ile yapılması:** Banka POS'unun ÖKC ile birleştirilmesi / kartlı satış verilerinin YN ÖKC üzerinden iletilmesi zorunluluğu (507 ve sonraki Sıra No.lu VUK GT) defalarca ertelenmiştir. Metindeki **10 Ocak 2025** tarihi bugün (2026-07) **geçmiş** bir tarihtir ve muhtemelen yeniden ertelenmiş/revize edilmiştir → operatif tarih olarak alınmamalı, güncel VUK GT'den teyit edilmeli.
  - **Seyyar EFT-POS:** 427 Sıra No.lu VUK GT ile seyyar EFT-POS kullananlar için EFT-POS özellikli YN ÖKC'ye geçiş öngörülmüştür; başlangıç olarak **1/10/2013** anılır, ancak bu tarih de dönemsel olarak ertelenmiştir → tek başına bağlayıcı alınmamalı, orijinal 427 VUK GT ve sonraki ertelemelerden teyit edilmeli.
- **CE/TSE:** Cihazlar CE ve TSE onaylıdır; GİB/TÜBİTAK onayı ürün künyesinde belirtilir (*resmi kaynaktan teyit edilmeli*).
- **AEEE (WEEE) — elektronik atık:** Cihaz kullanım ömrü sonunda güncel **Atık Elektrikli ve Elektronik Eşyaların Yönetimi Hakkında Yönetmelik** (Resmî Gazete 26.12.2022, sayı 32055; 2012 tarih 28300 sayılı eski "…Kontrolü Hakkında Yönetmelik"in yerine geçmiştir) kapsamında elektronik atık olarak yetkili toplama/geri dönüşüme verilir; ev/genel çöpe atılamaz. Yönetmeliğin **genişletilmiş üretici sorumluluğu** gereği, cihazı **kendi markasıyla piyasaya süren veya ithal eden** taraf "üretici" sayılır; bu sıfatla **Çevre Bakanlığı ürün kaydı (EÇBS — Entegre Çevre Bilgi Sistemi, ecbs.cevre.gov.tr üzerinden)** ve toplama/geri dönüşüm yükümlülüklerine tabidir. **Ancak mali cihazda önce hurdaya ayırma/mali hafıza teslim prosedürü (servis tutanağı + mali hafıza raporu + levha ile yetkili servis + vergi dairesi) tamamlanmalı,** ardından AEEE bertarafı yapılmalıdır.

---

## 10. KVKK ve veri gizliliği

- **İşlenen kişisel veri:** ÖKC/EFT-POS işlemlerinde **kart verisi** (maskeli PAN, işlem bilgisi) ve fiş üzerinde sınırlı bilgi bulunabilir. Kartın tam/hassas verisi **PCI-DSS** kapsamındaki bir ortamda korunur ve **PCI-PTS** onaylı cihaz; SRED/şifreleme ile ham kart verisini uygulamaya/HummyTummy'ye vermez.
  - *Kapsam ayrımı:* **PCI-PTS** cihaz (terminal) güvenlik standardıdır; **PCI-DSS** kart verisinin işlendiği ortamın güvenlik standardıdır — ikisi farklı kapsamlardır.
- **HummyTummy tarafı:** HummyTummy mali fiş komutunu ve sipariş tutarını işler; **ham kart verisi HummyTummy'de tutulmaz** — kart onayı banka/PSP ve terminal arasında gerçekleşir. Fiş/mali kayıtlar mali mevzuat gereği saklanır. (Tasarım ilkesi PCI/KVKK ile uyumludur.)
- **Yükümlülükler:** İşletme (veri sorumlusu) fiş/işlem kayıtlarını KVKK aydınlatma yükümlülüğü ve saklama sürelerine uygun tutmalıdır. Termal fişlerin fiziksel arşivi yetkisiz erişime karşı korunmalı. Banka/PSP ve ÖKC üreticisi/TSM ile veri paylaşımı ilgili sözleşme ve mevzuata dayanır.
- **Erişim:** Cihaz-bulut bağlantısı **rotating, sha256-hash'li bearer token** (24s TTL) ile korunur; ham token tek kullanımlıktır. Köprü arkası LAN trafiği WSS ile taşınır.

---

## 11. Satış ve devreye alma kontrol listesi

**Satış öncesi (bayi):**
- [ ] Müşterinin mükellefiyet/işletme türü ÖKC zorunluluğuna uygun mu, hangi YN ÖKC türü gerekiyor (EFT-POS özellikli mi, basit/bilgisayar bağlantılı mı)? Muafiyet ihtimali (tüm satış e-Fatura/e-Arşiv) mali müşavirle değerlendirildi mi?
- [ ] Mağazada doğru tier: yazarkasa = **`QUOTE_ONLY` (Teklif Al)**, bankalı POS = **`PARTNER_REDIRECT`** (banka/PSP).
- [ ] **Entegrasyon durumu doğrulandı mı?** Satılacak markanın HummyTummy köprü sürücüsü **gerçek mi yoksa iskelet/eksik mi?** (Hugin iskelet, Beko yok, Ingenico(iWL) iskelet ve fiscal değil) → uçtan uca fiş basımı gerektiren müşteride entegrasyon geliştirmesi tamamlanmadan taahhüt verilmemeli.
- [ ] Güncel fiyat, garanti (üretici belgesinden) ve **mali abonelik/TSM servis bedeli** müşteriye net bildirildi mi?

**Tedarik & mali kurulum:**
- [ ] Cihaz yetkili kanaldan temin edildi; SIM/hat, kağıt rulo, şarj ünitesi tam.
- [ ] **GİB yetkili servisi** ile aktivasyon + **mühürleme** + **mali levha** kaydı yapıldı.
- [ ] TSM/GİB bağlantısı ve deneme mali fişi doğrulandı (*ilgili köprü sürücüsü gerçekse*).

**HummyTummy entegrasyonu:**
- [ ] Şube **HummyBox köprüsü** kurulu ve online (heartbeat yeşil).
- [ ] `kind = yazarkasa` cihaz slotu **köprü arkasında** (`bridgeId` set) oluşturuldu.
- [ ] pairCode üretildi (alfanümerik 6 karakter, 10 dk); cihaz `POST /v1/devices/pair` ile eşleşti; token alındı.
- [ ] `FiscalDeviceRecord` aktif/şubeye bağlı. **Test siparişinde mali fiş fiziksel olarak kesildi mi?** (İskelet sürücüde basılmaz — gerçek sürücü şart.)
- [ ] `fiscal_coupled` (bankalı EFT-POS) senaryosunda **çift fiş kesilmediği** doğrulandı (guard backend'de gerçek).
- [ ] `Device.ownership` (sold/rented/byo) ve `warrantyUntil` doğru girildi; `capabilities[]` etiketlendi.

**Devir teslim:**
- [ ] Operatöre günlük **Z raporu** zorunluluğu, X raporu, kağıt/pil değişimi ve **kasayı açmama/mühür** kuralı anlatıldı.
- [ ] Bilgi fişi ≠ mali fiş ayrımı; iade/iptal ve e-Fatura/e-Arşiv akışı gösterildi.
- [ ] Arıza/RMA'da **yalnızca yetkili servis** irtibatı verildi; AEEE/hurda prosedürü (önce mali hafıza teslimi) hatırlatıldı.

---

### Kaynak ve doğrulama notları
- GİB Yeni Nesil ÖKC portalı (mevzuat, SSS, teknik kılavuzlar, bilgi fişi kılavuzu): https://ynokc.gib.gov.tr/
- İlgili VUK Genel Tebliğleri (427/483/507 vb.) ve güncel/nihai geçiş tarihleri resmi kaynaktan; mali müşavir onayı önerilir (*resmi kaynaktan teyit edilmeli*).
- Ürün teknik özellikleri üretici/distribütör kaynaklarından derlenmiştir (Hugin, Beko/Token, Ingenico) ve **satış öncesi güncel künyeyle teyit edilmelidir** (*resmi kaynaktan teyit edilmeli*).
- Fiyat, garanti, geçiş tarihleri ve mali abonelik bedelleri değişkendir; **bağlayıcı işlemden önce resmi/güncel kaynaktan doğrulayın.**
- **Entegrasyon gerçeği:** Kod tabanında yalnızca ESC/POS termal yazıcı sürücüsü gerçek çalışır. Yazarkasa köprü sürücüleri (Hugin iskelet, Beko yok, Ingenico(iWL) iskelet/fiscal değil) üretime hazır değildir; backend fiş-kuyruklama ve çift-fiş guard'ı ise gerçektir. Uçtan uca fiş basımı taahhüdü, ilgili sürücünün gerçek implementasyonu + entegrasyon onayı olmadan verilmemelidir.

## Kaynaklar (doğrulanmış mevzuat)

- [Yeni Nesil ÖKC — GİB mevzuat portalı (426/483/509 Sıra No.lu VUK Genel Tebliğleri, GMP-3 teknik kılavuzu)](https://ynokc.gib.gov.tr/Home/Mevzuat)
- [6502 sayılı Tüketicinin Korunması Hakkında Kanun (Resmî Gazete 28.11.2013, sayı 28835)](https://www.resmigazete.gov.tr/eskiler/2013/11/20131128-1.htm)
- [Garanti Belgesi Yönetmeliği (Resmî Gazete 13.6.2014, sayı 29029)](https://www.resmigazete.gov.tr/eskiler/2014/06/20140613-2.htm)
- [Atık Elektrikli ve Elektronik Eşyaların Yönetimi Hakkında Yönetmelik (Resmî Gazete 26.12.2022, sayı 32055)](https://www.mevzuat.gov.tr/MevzuatMetin/yonetmelik/7.5.40055.pdf)

---

> Son güncelleme: 2026-07-02 - sürüm taslağı. Regülasyon/mali bilgiler bilgilendirme amaçlıdır; güncel resmi mevzuat (GİB, BKM, KVKK Kurumu, Ticaret Bakanlığı, ilgili yönetmelikler) esastır.
