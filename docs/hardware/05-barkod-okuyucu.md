# Barkod / QR Okuyucu (Scanner)

> Bu belge, HummyTummy KDS/POS SaaS platformunda `Device.kind = scanner` olarak tanımlanan **el tipi barkod / QR okuyucu** cihazları için hem restoran operatörüne hem de kurulumu yapan **bayi/satıcıya** yönelik ayrıntılı kullanım ve uyumluluk yönergesidir. Kapsanan gerçek ürünler: **Honeywell Voyager 1450g (1D/2D USB)** ve **Zebra DS2208 (1D/2D USB)**.
>
> Belgedeki fiyat, mevzuat eşiği, garanti süresi ve tedarik bilgilerinden **(resmi kaynaktan teyit edilmeli)** notu taşıyanlar satış öncesi mutlaka güncel resmi kaynaktan doğrulanmalıdır.

---

## 1. Genel bakış

Barkod / QR okuyucu, ürün ambalajındaki veya etiketindeki **1D barkod** (EAN-13, UPC, Code-128, Code-39 vb.) ile **2D kod** (QR, Data Matrix, PDF417) sembollerini optik olarak okuyup, kodun içeriğini metin olarak host cihaza aktaran bir çevre birimidir. Bu iki model de **alan görüntüleyici (area imager)** teknolojisi kullanır: LED aydınlatma + kamera sensörü ile kodu görüntüler, dahili kod çözücü içeriği çıkarır ve **USB-HID klavye emülasyonu** ile host'a "yazar".

**Sistemdeki rolü (HummyTummy):**

- **Cihaz tipi:** `Device.kind = scanner`. Kategori→cihaz eşlemesinde `scanner → scanner` olarak provizyon edilir.
- **Kullanıldığı akışlar:**
  - **Stok / envanter:** Ürün/koli barkodunu okuyarak mal kabul, sayım ve stok düşümünde envanter kaydıyla **birebir eşleştirme** (barkod → stok kalemi / menü ürünü).
  - **Menü / ürün eşleme:** POS'ta paketli/hazır ürünlerin (şişe su, gazlı içecek, ambalajlı tatlı vb.) barkodunu okuyup ilgili menü ürününü sepete ekleme.
  - **QR akışları:** Masa QR'ı, adisyon/self-pay QR'ı, kupon/hediye çeki veya teslimat kolisi QR'ı gibi operasyonel karekodların okunması.
- **Sahiplik (`Device.ownership`):** `sold` (satıldı), `rented` (kiralık) veya `byo` (müşterinin kendi cihazı) olabilir. `Device.warrantyUntil` ile garanti bitişi izlenir; `capabilities[]` ile yetenek etiketlenir (örn. `['scan_1d','scan_2d','qr','usb_hid']` — etiket adları örnektir, kurulum politikanıza göre standartlaştırın).

**Önemli mimari not (bağlantı topolojisi):** Bu iki model **USB-HID (klavye emülasyonu)** cihazlarıdır; kendi ağ istemcileri **yoktur**. Dolayısıyla scanner, cloud-direct bir cihaz gibi doğrudan buluta **bağlanmaz** ve HummyBox köprüsüne kendi başına IP ile **konuşmaz**. Scanner her zaman bir **host** cihazın (POS terminali veya garson/kasa tableti) USB çevre birimidir; okuduğu veriyi o host üzerindeki HummyTummy uygulamasına klavye girişi olarak aktarır. Provizyon/eşleştirme ayrıntıları için bkz. **Bölüm 4**.

---

## 2. Modeller ve teknik özellikler

Her iki model de **kablolu (corded) USB**, **el tipi**, **1D/2D + QR** okuyan, **LED alan görüntüleyici** cihazlardır. **Lazer değildir** (bu, göz güvenliği sınıflandırmasını etkiler — bkz. Bölüm 9).

> **Garanti rejimi (önemli — B2B satış):** Bu cihazlar Mağaza (`/admin/store`) üzerinden restoran **işletmesine** satılır; satış kural olarak **tacirler arası (B2B)** bir işlemdir (satıcı: HummyTummy/bayi, alıcı: tacir sıfatlı işletme; 6502 sayılı Kanun'un m.3 tanımına göre tüketici = "ticari veya mesleki olmayan amaçlarla hareket eden gerçek/tüzel kişi" olduğundan, restorana yapılan bu ticari amaçlı satış tüketici işlemi değildir). Bu nedenle 6502 sayılı Tüketicinin Korunması Hakkında Kanun'un (Resmi Gazete 28.11.2013, sayı 28835) **tüketiciye** özgü koruma süreleri (Garanti Belgesi Yönetmeliği'nin — Resmi Gazete 13.6.2014, sayı 29029; yönetmelik ekindeki listeye tabi ürünlerde asgari **2 yıl** — tüketici ürünleri için öngördüğü asgari garanti süreleri dâhil) **kural olarak uygulanmaz**; bunun yerine 6098 sayılı Türk Borçlar Kanunu'nun ayıp/zapt hükümleri (satıcının ayıptan sorumluluğu: TBK m.219; alıcının muayene ve ihbar külfeti: TBK m.223) ve **tarafların kararlaştırdığı garanti süresi** geçerlidir. Dolayısıyla üreticinin/bayinin verdiği **12 veya 24 ay** garanti geçerli ve yeterlidir; "12 ay yasal asgarinin altında kalır / mevzuata aykırıdır" değerlendirmesi bu satış için **geçerli değildir**. Aşağıdaki tablolarda garanti, üretici/bayi taahhüdüne göre verilmiştir *(kesin süre ve koşullar resmi kaynaktan/üretici garanti beyanından teyit edilmeli)*.
>
> **İki not:** (a) Alıcı istisnaen **tüketici** sayılırsa (ör. şahsın ticari amaç dışı alımı) 6502 ve tüketici garanti rejimi devreye girer. (b) Tacir alıcı, TBK m.223 uyarınca teslim aldığı malı **muayene ve ayıpları ihbar** külfetine tabidir; **tacirler arası satışta bu ihbar süreleri kesindir** (TTK m.23/1-c: açık ayıp teslimden itibaren **2 gün**, gizli ayıp ortaya çıkınca **8 gün** içinde ihbar); süresinde ihbar edilmeyen ayıplar için satıcıya başvuru hakkı zayıflar.

### 2.1 Honeywell Voyager 1450g (1D/2D USB)

| Özellik | Değer |
|---|---|
| HummyTummy katalog fiyatı | Güncel perakende fiyat **katalogdan/QuoteService'ten** gelir (KDV %20 dahil); burada sabit bir tutar bağlayıcı değildir *(resmi kaynaktan teyit edilmeli)* |
| HummyTummy/bayi garanti süresi | Üretici/bayi taahhüdüne göre (**tipik 12–24 ay**); B2B satışta taraflarca kararlaştırılır *(kesin süre resmi kaynaktan/üretici beyanından teyit edilmeli)* |
| Form | El tipi (handheld), omnidireksiyonel, standlı |
| Okuma teknolojisi | Alan görüntüleyici (area imager), LED aydınlatma + kırmızı nişan ışığı; sensör çözünürlüğü SKU'ya göre değişir *(resmi kaynaktan teyit edilmeli — standart 1450g2D VGA sınıfı, 1450g2DHR farklıdır)* |
| Kod tipleri | 1D (EAN/UPC, Code-128/39, ITF vb.), PDF417, 2D (QR, Data Matrix) |
| Model notu | "Upgradeable": 1D model (1450g1D) sonradan lisansla 2D'ye yükseltilebilir. **2D için 1450G2D SKU'sunu tedarik edin.** |
| Host arayüzü | **USB (HID klavye / sanal COM)**, Keyboard Wedge, RS-232, IBM 46xx (RS-485) |
| Host konektörü | Host tarafı **USB Tip-A**; scanner tarafı modüler (RJ-tipi) konektör; ~1,5 m düz kablo |
| Besleme | USB bus-powered; giriş ~4,0–5,5 VDC; çalışma ~2 W (≈400 mA @ 5 V), bekleme ~0,45 W (≈90 mA) *(resmi kaynaktan teyit edilmeli)* |
| Boyut / ağırlık | ≈ 62 × 169 × 82 mm; scanner ≈ 130 g (stand+kablo dahil kit daha ağır) *(resmi kaynaktan teyit edilmeli)* |
| Dayanıklılık | 1,5 m'den betona düşmeye dayanıklı; koruma sınıfı **muhtemelen IP42** *(resmi kaynaktan teyit edilmeli — datasheet tipik olarak IP42 belirtir, IP40 değil)* |
| Çalışma ortamı | 0–40 °C; depolama −40…60 °C; %95 bağıl nem (yoğuşmasız); yüksek ortam ışığı toleransı *(resmi kaynaktan teyit edilmeli)* |
| Sürücü | **Sürücüsüz** (USB-HID klavye emülasyonu; plug-and-play) |

### 2.2 Zebra DS2208 (1D/2D USB)

| Özellik | Değer |
|---|---|
| HummyTummy katalog fiyatı | Güncel perakende fiyat **katalogdan/QuoteService'ten** gelir (KDV %20 dahil); burada sabit bir tutar bağlayıcı değildir *(resmi kaynaktan teyit edilmeli)* |
| HummyTummy/bayi garanti süresi | Üretici/bayi taahhüdüne göre; Zebra üretici standart garantisi tipik olarak **36 ay (3 yıl)**'dır — bkz. Bölüm 8 *(resmi kaynaktan teyit edilmeli)* |
| Form | El tipi (handheld), omnidireksiyonel, standlı |
| Okuma teknolojisi | Alan görüntüleyici (area imager), LED aydınlatma + nişan ışığı, geniş açı |
| Kod tipleri | 1D (EAN/UPC, Code-128/39, ITF vb.), PDF417, 2D (QR, Data Matrix) |
| Host arayüzü | **USB (HID klavye / sanal COM / IBM)**, Keyboard Wedge, RS-232 |
| Host konektörü | Host tarafı **USB Tip-A**; scanner tarafı modüler kablo; ~2 m düz kablo. Doğru USB kablo SKU'su (ör. CBA-U21-S07ZBR) ayrıca sipariş edilmelidir; LS2208 aksesuar uyumluluğu birebir garanti değildir *(resmi kaynaktan teyit edilmeli)* |
| Besleme | USB bus-powered; ~250 mA (auto-aim açık, tipik), ~150 mA (bekleme) @ 5 V *(resmi kaynaktan teyit edilmeli — imager'lar daha yüksek tepe akım çekebilir)* |
| Boyut / ağırlık | El tipi; scanner ≈ **146 g** *(resmi kaynaktan teyit edilmeli — resmi spec ~146 g / 5.15 oz)* |
| Dayanıklılık | 1,5 m'den betona düşmeye dayanıklı *(resmi kaynaktan teyit edilmeli)* |
| Sürücü | **Sürücüsüz** (USB-HID klavye emülasyonu; plug-and-play) |

**Not:** Bazı satış listelemelerinde DS2208 "lazer tarayıcı" olarak geçse de cihaz bir **LED görüntüleyicidir** (imager), lazer değildir; bu, göz güvenliği kısmında önemlidir.

**İki model arası seçim:** Her ikisi de restoran POS/stok kullanımı için fazlasıyla yeterlidir. Zebra DS2208 geniş kurulum tabanı ve uzun üretici garantisi (~36 ay); Honeywell 1450g silik/düşük kaliteli barkodlarda güçlü okuma ve 1D→2D lisans yükseltme esnekliği sunar. **Not:** B2B satışta garanti süresi taraflarca (üretici/bayi taahhüdü + sözleşme) belirlenir; üretici garantisi bu kapsamda alıcıya sağlanan güvencedir (bkz. Bölüm 8).

---

## 3. Kullanım / operasyon

Günlük operasyonda scanner, host cihaz üzerindeki HummyTummy uygulamasında **imlecin bulunduğu (odaklı) alana** okuduğu içeriği yazar. Doğru alanın seçili olması kritiktir.

**Senaryo A — POS'ta paketli ürün satışı:**
1. POS ekranında **barkod/ürün arama** alanını dokunarak odakla (imleç yanıp söner).
2. Tetiğe bas, kırmızı nişanı barkodun üzerine getir; başarılı okumada cihaz **bip** sesi verir ve LED yanar.
3. Barkod içeriği alana yazılır ve sonuna **Enter (CR/LF)** eklenir → ürün otomatik olarak sepete/adisyona düşer.
4. Eşleşme yoksa uygulama "ürün bulunamadı" uyarısı verir → barkod–menü eşlemesini kontrol et (Bölüm 4).

**Senaryo B — Stok mal kabul / sayım:**
1. Stok modülünde **mal kabul** veya **sayım** oturumunu aç, sayım/barkod alanını odakla.
2. Gelen kolideki her ürünü sırayla okut; her okumada ilgili stok kalemi bulunur, adet girilir/artırılır.
3. Barkodu olmayan kalemler için elle arama; toplu ürünlerde koli/iç-koli barkodu tanımlıysa okut.

**Senaryo C — QR akışları (masa/adisyon/self-pay/teslimat):**
1. İlgili ekranda QR alanını odakla.
2. Masa QR'ı, self-pay adisyon QR'ı veya teslimat kolisi QR'ını okut → uygulama ilgili kaydı açar.

**Operasyon ipuçları:**
- **Suffix (sonek) ayarı:** Otomatik akış için okuma sonrası **Enter** eklenmesi çoğu ekranda gerekir; bir alanda satır sonu istenmiyorsa (örn. çok haneli manuel giriş) suffix'i o iş akışına göre yapılandırın.
- **Presentation/stand modu:** Cihazı standa koyup elini kullanmadan "sun-ve-oku" modunda çalıştırabilirsiniz (yoğun kasa için pratik).
- **Sadece odaklı alana yazar:** Yanlış pencere/alan odaklıysa barkod oraya yazılır; okutmadan önce doğru alanın seçili olduğundan emin olun.

---

## 4. Kurulum ve sisteme bağlama

### 4.1 Fiziksel kurulum
1. Scanner USB kablosunu **host cihaza** (POS terminali veya garson/kasa tableti) takın. Host tarafı **USB Tip-A**'dır; tablet USB-C ise kaliteli bir **USB-A→USB-C adaptörü/hub** kullanın (bus-powered olduğu için hub'ın yeterli akım verdiğinden emin olun; ~250–400 mA).
2. Cihaz güç aldığında açılış bip'i verir; sürücü kurulumu **gerekmez** (USB-HID).
3. Standı kasa tezgâhına yerleştirin; kablo güzergâhını sıvı temas riskinden uzak tutun.
4. **Doğrulama:** Host'ta bir metin alanına (örn. Not Defteri veya POS arama kutusu) tutup bir barkod okutun; rakam/harf dizisi + Enter yazılıyorsa donanım hazırdır.

### 4.2 Klavye dili / karakter sorunu (önemli)
USB-HID emülasyonunda scanner, host'un **klavye düzenini** taklit eder. Host'ta **Türkçe Q** düzeni seçiliyken bazı barkodlardaki karakterler yanlış yazılabilir (özellikle `Ğ Ü Ş İ Ö Ç` ile çakışan konumlar veya bazı 2D içerikleri). Çözüm seçenekleri:
- Host klavye düzenini **US/İngilizce (Q)** yapmak, **ya da**
- Scanner'ı **USB Sanal COM / SNAPI** moduna alıp uygulamanın klavye düzeninden bağımsız okuması (uygulama desteği gerekir), **ya da**
- Scanner'ı **ALT+sayısal (numeric keypad emulation)** moduna alarak karakter kaymalarını önlemek.

Kurulumda bu test **mutlaka** yapılmalı (Türkçe karakter/QR testi).

### 4.3 Sisteme bağlama: provizyon ve eşleştirme (HummyTummy device-mesh)

**Kritik gerçek:** USB-HID scanner'ın kendi ağ istemcisi olmadığından, cihaz uygulamasını **çalıştırmaz** ve `POST /v1/devices/pair` çağrısını **kendi başına yapamaz**. Scanner, bağlı olduğu **host cihazın** kimliği üzerinden çalışır. İki dağıtım deseni vardır:

**Desen 1 — Cloud-direct host'a bağlı (önerilen, köprü GEREKMEZ):**
- Scanner'ın takıldığı **tablet/POS terminali cloud-direct** bir cihazdır (`bridgeId = null`, WSS/HTTP ile doğrudan buluta bağlı). Bu host zaten kendi pairCode akışıyla eşleştirilmiştir.
- Scanner, bu host'un USB klavye çevre birimidir; okumalar host üzerindeki HummyTummy uygulamasına klavye girişi olarak akar. **Ayrı bir ağ eşleştirmesi gerekmez.**
- **Envanter/garanti izlemesi için** admin panelde bir `scanner` cihaz slotu açıp cihazı host'un çevre birimi olarak kaydedin (`ownership`, `warrantyUntil`, `capabilities[]` alanlarını doldurun). Bu kayıt operasyonel bağlantı için değil, varlık takibi içindir.

**Desen 2 — HummyBox köprüsü arkasındaki bir istasyona bağlı (`bridgeId` set):**
- POS'suz bir **mal kabul/stok istasyonu** gibi, scanner'ı köprü ağındaki bir host'a bağlarsınız; LAN çevre birimleri (yazarkasa, ESC/POS yazıcı, kart POS terminali) gibi bu istasyon **HummyBox köprüsü arkasında** çalışır. Köprü: WSS heartbeat + SQLite offline kuyruk + sürücüler.
- Bu durumda ilgili host cihaz kendi `pairCode`'u ile eşleşir; scanner yine o host'un USB peripheral'ıdır.

**Provizyon ve pairCode akışı (host cihaz için — gerçek akış):**
1. **Satış akışı:** Mağaza (`/admin/store`) → sepet → **PayTR** ödemesi → sipariş **ÖDENİNCE** device-mesh cihaz slotu **otomatik** açılır (deterministik `provisionKey` + PostgreSQL advisory-lock, idempotent). `scanner` kategorisi `scanner` cihaz tipine provizyon edilir. *(cash_drawer/other/service provizyon edilmez.)*
2. **Slot & pairCode:** Admin panelde cihaz slotu oluşturulur → **6 karakterli pairCode** üretilir (**alfanümerik: harf+rakam, yalnızca rakam değil**; **10 dk** geçerli, **şube başına en çok 10 bekleyen slot**).
3. **Claim:** Cihaz uygulaması (host'taki Tauri kiosk/uygulama) pairCode ile `POST /v1/devices/pair` çağırır → **tek-kullanımlık atomik claim** → **sha256-hash'li rotating bearer token** döner (**varsayılan 24 saat TTL — `DEVICE_TOKEN_TTL_MS`; yalnızca pair anında verilir, heartbeat TTL'i uzatmaz, kayan/rotating TTL değildir**). Token pair'den 24 saat sonra dolar; süresi dolan token `authenticateToken` tarafından reddedilir ve devam için host'un yeniden pair edilmesi gerekir. Ham token yalnızca bir kez döner, at-rest hash'lenir.
4. Scanner'ın **kendisi** bu adımları yürütmez; adımlar bağlı olduğu host için yapılır. Scanner USB kablosunu takıp klavye testini geçtiğinizde operasyonel olarak hazırdır.

**Token süresi / yeniden eşleştirme (önemli — nadiren-etkileşimli cihaz):** Scanner'ın kendi ağ istemcisi ve kendi tokenı **yoktur**; operasyonel bağlantı **bağlı olduğu host** cihazın device-mesh tokenına dayanır. Bu bearer token varsayılan **24 saat TTL** (`DEVICE_TOKEN_TTL_MS`) ile üretilir ve bu kural **pairCode ile eşleşen cihazlar için** (caller_id, scanner, yazarkasa dâhil) aynıdır; **`local_bridge` (köprü) hariçtir — köprü bu 24 saatlik DEVICE tokenını taşımaz, kendi 30 günlük bearer tokenını taşır (`LOCAL_BRIDGE_TOKEN_TTL_MS`).** **Heartbeat yalnızca `status` ve `lastSeenAt` günceller; `tokenExpiresAt`'e dokunmaz, yani token süresini uzatmaz (kayan/rotating TTL değildir; main/prod dalında token yenileme yoktur).** Token pair'den **24 saat sonra dolar** (host çevrimiçi olsa bile) ve host'un **yeniden pair edilmesi** gerekir (yeni 6 karakterli pairCode) — bu durumda scanner otomatik "geri gelmez", çünkü host kimliği yenilenene kadar okumalar backend'de işlenmez.
- **Cloud-direct host (Desen 1):** Host açık olsa da heartbeat tokenı **yenilemez**; token pair'den 24 saat sonra dolar, bu yüzden host'un düzenli olarak yeniden pair edilmesi gerekir (host uzun süre kapalı/çevrimdışı kalırsa da token dolar).
- **Köprü-arkası host (Desen 2):** HummyBox köprüsünün WSS heartbeat'i `status`/`lastSeenAt` günceller ama host tokenının TTL'ini **uzatmaz**; token pair'den 24 saat sonra dolar (köprü çevrimdışı kalırsa da dolar) ve host yeniden eşleştirilir.

**Özet:** Scanner için köprü **zorunlu değildir**; en yaygın ve en basit kurulum, scanner'ı **cloud-direct bir POS terminali/tabletine USB ile takmaktır**. Köprü yalnızca scanner'ı POS'suz bir köprü-arkası istasyona bağladığınızda devreye girer.

### 4.4 Barkod–menü/envanter eşlemesi
- Her paketli ürün için HummyTummy'de ilgili **menü ürünü / stok kalemine barkod alanı** tanımlayın (EAN-13/UPC). Barkod okununca uygulama bu alandan eşleştirir.
- Aynı fiziksel ürünün farklı ambalaj barkodları (tekli/koli) varsa, koli barkodunu ayrı bir kalem veya çarpan olarak tanımlayın.
- QR akışlarında (masa/adisyon) QR içeriği uygulama tarafından üretildiği için ek eşleme gerekmez; harici üretilmiş QR'larda beklenen format doğrulanmalıdır.

---

## 5. Tedarik ve sağlayıcı

> Perakende satış fiyatının tek yetkili kaynağı **katalogdur** (`HardwareProduct.priceCents` + checkout `QuoteService`, KDV %20 dahil); aşağıdaki tedarik bilgileri yalnızca kanal/sourcing içindir ve **bağlayıcı fiyat değildir**. Alış maliyeti ve marj **distribütör teklifine göre değişir** ve burada belirtilmez *(güncel yetkili distribütör listesinden teyit edilmeli)*.

| Model | Üretici | TR kanalı (örnek) | Tedarik süresi | Satış fiyatı | Not |
|---|---|---|---|---|---|
| Honeywell Voyager 1450g (2D) | Honeywell | Yetkili distribütör + barkod bayileri *(yetkililik teyit edilmeli)* ve online listeler | Stoklu ürün; genelde 1–5 iş günü *(teyit)* | Katalog/QuoteService (KDV %20 dahil) | 2D için **1450G2D** SKU'sunu netleştirin |
| Zebra DS2208 (2D) | Zebra Technologies | Zebra yetkili distribütörleri + barkod bayileri *(yetkililik teyit edilmeli)* ve online | Stoklu ürün; genelde 1–5 iş günü *(teyit)* | Katalog/QuoteService (KDV %20 dahil) | En çok satan giriş seviyesi 2D imager |

**Fiyat/marj notu:** Perakende satış fiyatı **katalogdan/QuoteService'ten** (KDV %20 dahil) gelir ve tek bağlayıcı kaynaktır; alış maliyeti ile marj **distribütör teklifine göre değişir**, burada bağlayıcı bir rakam verilmez. Tedarikte yalnızca **2D-imager SKU'lu (1450G2D / DS2208-SR)** güncel yetkili distribütör listelerinden fiyat alın; 1D/gri/ikinci-el düşük listeler bir 2D area-imager için gerçekçi değildir ve tedarik gerekçesi yapılmamalıdır *(güncel distribütör listesi resmi kaynaktan teyit edilmeli)*.

**Tedarik notları (bayi için):**
- **Doğru SKU / arayüz kiti:** Her iki üründe de **USB kiti** (scanner + USB kablo + stand) tedarik edin. Honeywell'de 1D vs 2D ayrımına (1450g1D / 1450G2D), Zebra'da kablo/renk varyantına (ör. DS2208-SR7U2100...) dikkat edin. Zebra'da doğru USB kablo SKU'su (ör. CBA-U21-S07ZBR) ayrıca doğrulanmalıdır.
- **Maliyet/marj:** Alış maliyeti ve marj distribütör teklifine göre değişir; satış fiyatı katalogdan gelir (yukarıdaki not). Hacimli alımda distribütör iskontosu marjı iyileştirir. Honeywell 1450g'de model/kaynak farkı alış maliyetini değiştirebilir — **gri/paralel stoktan kaçının** (garanti ve TR uyum riski).
- **Alternatif kaynak:** İki model de global bir ürün; farklı yetkili distribütörlerden çapraz fiyat alın. **Yalnızca Türkiye yetkili distribütör garantili** ürün tedarik edin (AEEE/CE uyumu ve RMA için — Bölüm 8–9). Honeywell/Zebra'nın TR **yetkili distribütör** listesi resmi "where to buy / authorized distributor" sayfalarından doğrulanmalı; barkod perakendecileri/bayileri çoğunlukla üst-kademe distribütörlerden alıp satan ikinci-kademe kanaldır *(yetkililik resmi kaynaktan teyit edilmeli)*.
- **Kablo/aksesuar yedeği:** USB kablosu ve stand ayrı sarf/yedek kalemi olarak stoklanmalı (en sık arıza kalemi kablodur).

---

## 6. Bakım ve sarf malzeme

Bu iki model **kablolu, pilsiz, ısıl-kağıtsız** cihazlardır; **düzenli sarf malzemesi yoktur** (kağıt/rulo/pil gerektirmez). Bakım büyük ölçüde temizlik ve firmware güncellemesidir.

- **Sarf malzeme:** Yok. Yalnızca yıpranan **USB kablo** ve **stand** yedek parça olarak stoklanır.
- **Pil:** Yok (kablolu, USB bus-powered). Şarj/pil bakımı gerekmez.
- **Kağıt/rulo:** Yok (yazıcı değil).
- **Temizlik (haftalık / gerektikçe):**
  - **Okuma penceresi/lens:** Yumuşak, tüy bırakmayan mikrofiber bezle silin. Gerekirse hafif nemli bez. **Aşındırıcı, çözücü (aseton/tiner) veya doğrudan sprey kullanmayın**; sıvıyı beze uygulayın, cihaza değil.
  - **Gövde:** Mutfak yağı/gıda kalıntısına karşı nemli bezle silin. Koruma sınıfı sınırlı olduğundan **su altına tutmayın / yıkamayın**.
  - **Konektörler:** Tozu kuru bezle temizleyin.
- **Firmware / güncelleme:**
  - Honeywell → **EZConfig for Scanning** aracı ile firmware/konfig yönetimi.
  - Zebra → **123Scan** aracı ile firmware/konfig, parametre barkodları ve profiller.
  - Firmware'i yalnızca üreticinin resmi aracı/paketi ile ve **kesintisiz güç** altında güncelleyin. Konfigürasyonu (suffix, arayüz modu, klavye düzeni) bir **konfig profili/parametre barkodu** olarak saklayın; yeni cihazı tek okutmayla aynı ayara getirin.
- **Konfig yedeği:** Her müşteri için uygulanan tarama profilini (Enter suffix, arayüz modu, dil) belgeleyin; RMA/değişimde hızlı devreye alma sağlar.

---

## 7. Sorun giderme ve arıza

| Belirti | Olası neden | Çözüm |
|---|---|---|
| Cihaz hiç yanmıyor, bip yok | USB güç yok / kablo/port arızası / yetersiz akım (zayıf hub) | Başka USB portu/kablo dene; bus-powered akım veren port/hub kullan; kablonun scanner tarafı modüler konektörünü yeniden otur |
| Okuyor (bip var) ama ekrana hiçbir şey yazılmıyor | Yanlış alan odaklı / arayüz modu HID değil | Doğru metin alanını odakla; arayüzü **USB-HID klavye** moduna alan parametre barkodunu okut |
| Okuyor ama karakterler yanlış/bozuk (Türkçe) | Host klavye düzeni uyuşmazlığı | Host düzenini US-Q yap veya scanner'da **ALT-numeric / Sanal COM** modu; kurulum Türkçe/QR testini tekrarla |
| Her okumadan sonra alt satıra geçmiyor (ürün sepete düşmüyor) | Enter/CR suffix tanımsız | Konfig aracıyla **suffix = CR (Enter)** ekle |
| Aynı barkodu iki kez yazıyor | Suffix'te fazladan karakter / "double-read" toleransı kısa | Konfigde tek suffix bırak; aynı-kod tekrar okuma gecikmesini artır |
| Barkodu zor/geç okuyor | Kirli lens / silik/hasarlı etiket / mesafe-açı | Lensi temizle; barkodu 10–20 cm mesafede, hafif açıyla sun; etiketi yenile |
| QR/2D okumuyor ama 1D okuyor | Honeywell'de **1D-only** model veya 2D sembolojisi kapalı | 1450g'de 2D lisansını doğrula (2D SKU); konfigde QR/Data Matrix sembolojisini etkinleştir |
| "Ürün bulunamadı" | Barkod menü/stok kalemine tanımlı değil | HummyTummy'de ilgili ürüne barkod alanını gir; koli/tekli barkod ayrımını kontrol et |
| Ara sıra okumada takılma/donma | Firmware/konfig bozulması | Konfig profilini yeniden yükle; firmware güncelle |

**Ne zaman RMA:** Kablo/port değişimi ve konfig sıfırlama sonrası **cihaz hâlâ güç almıyorsa**, **lens/optik fiziksel hasar** varsa, **gövde kırık/sıvı girmişse** veya **firmware yüklemesine rağmen okuma sürekli hatalıysa** cihaz RMA'ya alınır. Önce **kablo/stand gibi ucuz parçaları değiştirerek** cihaz-arızasını doğrulayın (kablo, en sık nedendir ve RMA gerektirmez).

---

## 8. Garanti ve RMA süreci

| Model | HummyTummy/bayi garanti (B2B — taraflarca) | Üretici standart garanti (bilgi) |
|---|---|---|
| Honeywell Voyager 1450g | Üretici/bayi taahhüdüne göre (**tipik 12–24 ay**); `warrantyUntil` = teslim + taahhüt edilen süre *(kesin süre resmi kaynaktan/üretici beyanından teyit edilmeli)* | Honeywell üretici garantisi *(resmi kaynaktan teyit edilmeli)* |
| Zebra DS2208 | Üretici/bayi taahhüdüne göre; genelde üretici garantisiyle aynı süre yansıtılır | Zebra DS2208 üretici standart garantisi tipik olarak **36 ay (3 yıl)**'dır *(resmi kaynaktan teyit edilmeli — 5 yıl / 60 ay muhtemelen ücretli uzatılmış Zebra OneCare planıdır, standart fabrika garantisi değildir)* |

- **Garanti rejimi (kritik — B2B):** Mağaza üzerinden işletmeye yapılan bu satış kural olarak **tacirler arası (B2B)** olduğundan, 6502 sayılı Kanun'un tüketiciye özgü asgari garanti süreleri **kural olarak uygulanmaz**; garanti süresi **taraflarca (üretici/bayi taahhüdü + sözleşme)** belirlenir ve üreticinin verdiği **12 veya 24 ay** garanti geçerlidir. Ayıba ilişkin uyuşmazlıkta 6098 sayılı Türk Borçlar Kanunu'nun ayıp hükümleri esas alınır (bu hükümler kural olarak **emredici değildir**; TBK m.221 uyarınca satıcının ağır kusuru hâli dışında **sorumsuzluk/sınırlama kaydı** geçerlidir) ve tacir alıcı TBK m.223 muayene/ihbar külfetine tabidir (tacirler arası satışta TTK m.23/1-c'ye göre açık ayıp **2 gün** / gizli ayıp **8 gün** kesin ihbar süresi). **İstisna:** alıcı ticari amaç dışı bir **tüketici** ise 6502 tüketici garanti rejimi (asgari süreler dâhil) devreye girer *(kesin süreler ve kapsam resmi kaynaktan teyit edilmeli)*.
- **Kullanım ömrü / servis:** Satış Sonrası Hizmetler Yönetmeliği'nin **asgari kullanım ömrü** ve süre boyunca **yedek parça/servis bulundurma** yükümlülükleri de esas olarak tüketici ürünlerine yöneliktir; B2B satışta bu güvenceler **sözleşmeyle** düzenlenir. Yine de bayi, operasyonel süreklilik için yedek parça/servis erişimini taahhüt etmelidir *(kapsam ve süre resmi kaynaktan teyit edilmeli)*.
- **Kapsam:** Malzeme ve işçilik kaynaklı üretim hataları. **Kapsam dışı:** fiziksel darbe/düşme hasarı (spesifikasyon üstü), sıvı girişi, yetkisiz açma/tamir, aşırı gerilim, sarf/aksesuar aşınması (kablo yıpranması genelde kapsam dışıdır).
- **`warrantyUntil` alanı:** Her satılan cihaz için HummyTummy'de `Device.warrantyUntil` doğru girilmeli; RMA hak sahipliği buradan izlenir.
- **RMA / değişim akışı (bayi yükümlülüğü):**
  1. Arıza kaydı: müşteri şikâyeti + Bölüm 7 ön kontrolleri (kablo/port/konfig) belgelenir.
  2. Seri no ve `warrantyUntil` doğrulanır; garanti içindeyse üretici/distribütör RMA kanalına iletilir.
  3. Operasyon kesintisini önlemek için **yedek/geçici (muadil) cihaz** verilir (özellikle tek kasalı restoranlarda kritik; tamir/değişim süresi B2B'de sözleşmeyle belirlenir — alıcı tüketici ise tüketici mevzuatındaki azami süre, genelde 20 iş günü, esas alınır *(teyit edilmeli)*).
  4. Değişim cihazı geldiğinde kaydedilen **konfig profili** (suffix/arayüz/dil) tek okutmayla uygulanır; `Device` kaydında seri no ve `warrantyUntil` güncellenir.
- **Satıcı yükümlülükleri (TR):** B2B (tacirler arası) satışta güvenceler esas olarak **sözleşme + üretici garantisi** ile sağlanır; iyi uygulama olarak en az şunlar önerilir: (1) Türkçe **garanti/kullanım belgesi** ve fatura; (2) taahhüt edilen garanti süresi (üretici/bayi — tipik 12–24 ay); (3) yedek parça/servis erişimi; (4) tamir/değişim süresince operasyonel süreklilik için **muadil cihaz** sağlama; (5) mesafeli/elektronik satışta bilgilendirme ve fatura. **Alıcı istisnaen tüketici ise** 6502 kapsamındaki tüketici hakları (asgari garanti süresi, zorunlu kullanım ömrü, azami tamir süresi, cayma hakkı) ayrıca uygulanır *(kesin süreler ve kapsam resmi kaynaktan teyit edilmeli)*. **Yalnızca TR yetkili distribütör garantili** ürün satın; gri stokta garanti/servis riski oluşur. Üretici garantisi müşteriye sağlanan güvence olarak belirtilebilir.

---

## 9. Regülasyon ve uyumluluk

> Aşağıdaki mevzuat başlıkları geneldir; **sayısal eşik, tarih, ücret ve zorunluluklar mutlaka güncel resmi kaynaktan (Ticaret Bakanlığı, Çevre-Şehircilik ve İklim Değişikliği Bakanlığı, TSE, ilgili yönetmelikler) teyit edilmelidir.**

- **CE / EMC ve RoHS (LVD DEĞİL):** Bu USB çevre birimleri AB'de **CE** işareti taşır; **doğru uygulanan çerçeve EMC (elektromanyetik uyumluluk) Yönetmeliği + RoHS (tehlikeli madde kısıtlaması) Yönetmeliği**'dir (radyosu olmadığından RED de değildir). Türkiye'de bu çerçevenin karşılıkları sırasıyla **Elektromanyetik Uyumluluk Yönetmeliği (2014/30/AB)** (Resmi Gazete 2.10.2016, sayı 29845; yetkili: Sanayi ve Teknoloji Bakanlığı) ve **Elektrikli ve Elektronik Eşyalarda Bazı Zararlı Maddelerin Kullanımının Kısıtlanmasına İlişkin Yönetmelik** (RoHS; Resmi Gazete 26.12.2022, sayı 32055; yetkili: Çevre, Şehircilik ve İklim Değişikliği Bakanlığı)'dır. **LVD (Alçak Gerilim Yönetmeliği / 2014/35/EU ve TR karşılığı) BU CİHAZLARA UYGULANMAZ:** LVD yalnızca 50–1000 V AC veya 75–1500 V DC gerilim aralığındaki ekipmanı kapsar; USB bus-powered **5 VDC** bir çevre birimi bu alt sınırın altında kaldığından LVD kapsamı **dışındadır**. Bu tip USB tarayıcıların üretici DoC'lerinde tipik olarak EMC + RoHS beyan edilir, LVD beyan edilmez. **REACH** ise bir madde-kısıtlama tüzüğüdür ve "CE uygunluk" başlığı altında değil ayrıca değerlendirilir. Cihazın **CE uygunluk beyanı (DoC)** ve TR uygunluk belgeleri ile üzerindeki gerçek uygulanan direktif listesi distribütörden temin edilip teyit edilebilmelidir *(resmi kaynaktan teyit edilmeli)*.
- **Göz güvenliği — LED / fotobiyolojik (IEC 62471):** Bu iki model **LED alan görüntüleyicidir (lazer değil)**. LED aydınlatmalı okuyucular **IEC 62471 fotobiyolojik güvenlik** kapsamında değerlendirilir ve bu tür nişan/aydınlatma LED'leri genelde düşük risk grubundadır. Ancak **kesin risk grubu (Exempt / Risk Grubu 1 vb.) cihaza özel bir değerdir ve genel bir varsayım olarak sunulamaz** *(cihaza özel değer üretici DoC/etiketinden teyit edilmeli)*. Normal kullanımda özel göz koruması gerekmez; yine de **aydınlatma LED'ine/nişan ışınına doğrudan ve uzun süre bakılmamalıdır**.
- **Lazer sınıfı (IEC 60825) — bu modeller için GEÇERLİ DEĞİL:** Lazer sınıfı (Sınıf 1 / Sınıf 2) yalnızca **lazerli** okuyucular için geçerlidir. Bu iki 2D imager LED içerir; IEC 60825 lazer sınıflandırması uygulanmaz. Eğer ileride bir müşteriye **lazer 1D** model tedarik edilirse, o cihaz için **IEC 60825 Sınıf 1/2** işaretlemesi ve "lazer ışınına bakmayın" uyarısı geçerli olur.
- **TSE / ithalat uygunluğu:** Türkiye'ye ithal edilen elektronik cihazlarda ilgili uygunluk/işaretleme ve gerekli hallerde TSE süreçleri uygulanabilir *(bu ürün sınıfı için zorunluluk kapsamı resmi kaynaktan teyit edilmeli)*. Distribütör faturası ve uygunluk beyanları dosyalanmalı; etiket/kılavuz Türkçe olmalıdır.
- **AEEE (WEEE) — elektronik atık:** Bu cihazlar güncel **"Atık Elektrikli ve Elektronik Eşyaların Yönetimi Hakkında Yönetmelik"** (Resmi Gazete 26.12.2022, sayı 32055; 2012 tarihli 28300 sayılı eski "Kontrolü" yönetmeliğinin yerine geçmiştir) kapsamındadır. Ürün/ambalajda **üzeri çizili tekerlekli çöp kutusu** simgesi bulunur; ürün **evsel atıkla atılamaz**, yetkili toplama/geri dönüşüm kanalına verilmelidir. Yönetmelik **genişletilmiş üretici sorumluluğu** getirir ve "üretici" tanımı ürünü **kendi markasıyla piyasaya süreni** ve **ithal edeni** kapsar; dolayısıyla cihazı kendi markanızla (ör. HummyBox) satmak sizi bu Yönetmelik anlamında **üretici** konumuna getirir. Üretici/ithalatçı, Çevre, Şehircilik ve İklim Değişikliği Bakanlığı **EEE Üretici Kayıt Sistemi'ne kayıt** (üretici kayıt no) + yıllık bildirim + toplama/geri dönüşüm yükümlülüğüne tabidir; işlemler **EÇBS (Entegre Çevre Bilgi Sistemi, ecbs.cevre.gov.tr)** üzerinden yürütülür *(kayıt eşikleri ve beyan periyodu resmi kaynaktan teyit edilmeli)*. **GEKAP (Geri Kazanım Katılım Payı)** ise ayrı bir mali yükümlülüktür ve beyanı EÇBS'ye değil **GİB'e (vergi dairesi)** verilir. Bayi, kullanım ömrü sonunda cihazın uygun bertaraf kanalını müşteriye bildirmelidir.
- **USB-HID / sürücüsüzlük:** Cihaz standart **USB-HID klavye** sınıfında çalıştığından ek sürücü/yazılım kurulmaz; bu, güvenlik/uyum açısından ek yazılım bağımlılığı ve sürücü zafiyeti riskini azaltır. Yapılandırma (arayüz modu, suffix) parametre barkodları veya üretici konfig aracıyla yapılır.

**Mali (fiscal) sınır — önemli:** Barkod okuyucu **mali bir cihaz DEĞİLDİR**; hiçbir mali belge üretmez. GİB nezdinde mali hafızası/onayı olan bir ÖKC (YN-ÖKC) değildir; fiş/e-Fatura/e-Arşiv üretmez, GMP-3/TSM sürecine dahil değildir. HummyTummy'de mali fiş yalnızca **onaylı ÖKC/yazarkasadan** kesilir (Hugin/Beko adaptörleri, GMP-3 "fiscal_coupled" kart-POS eşlemesi). Scanner çıktısı/POS ekranındaki "**bilgi fişi**" **mali belge değildir**. Scanner yalnızca ürün/stok tanımlama içindir; vergi/fiş üretim akışına dahil değildir.

---

## 10. KVKK ve veri gizliliği

- **Cihazın doğrudan kişisel veri işlemesi düşüktür:** Barkod okuyucu, ürün/stok barkodlarını ve operasyonel QR'ları okur; **kamera ile ortam/görüntü kaydı yapmaz**, biyometrik veri toplamaz. Klasik ürün barkodları kişisel veri içermez.
- **Dolaylı riskler:**
  - **QR içeriği:** Adisyon/self-pay veya sadakat/kupon QR'ları bir **müşteri oturumuna/siparişe** işaret edebilir. Okunan bu tanımlayıcılar host uygulamasında işlendiğinden, ilgili sipariş/müşteri kaydı **KVKK kapsamındaki kişisel veri** olabilir. QR yalnızca ilgili işlemi açmak için okunmalı, gereksiz kişisel veri barkoda gömülmemelidir.
  - **HID enjeksiyon riski:** Scanner klavye gibi davrandığından, **kötü amaçlı hazırlanmış bir barkod** teorik olarak host'a istenmeyen tuş dizisi "yazabilir". Bu, kişisel verinin bulunduğu POS host'unu etkileyebilir. Azaltım: bilinmeyen kaynaklı QR'ları güvenli/odaklı alanlarda okutmak, mümkünse **karakter/uzunluk filtreleme** veya prefiks doğrulaması yapmak, host oturumunu kilitli tutmak.
- **Yükümlülükler:**
  - Kişisel veri, cihazda değil **HummyTummy backend'inde (NestJS+Prisma/Postgres)** işlenir; erişim yetki (RBAC), şube kapsamı ve token güvenliği backend tarafında yönetilir (host cihaz sha256-hash'li rotating bearer token ile kimliklenir).
  - **Aydınlatma & amaçla sınırlılık:** QR/self-pay akışında toplanan sipariş/iletişim verileri KVKK aydınlatma metni ve veri işleme envanterinde yer almalı; yalnızca operasyon amacıyla, saklama süresine uygun tutulmalıdır.
  - Cihaz **paylaşılan/BYO** ise (ör. `byo`), host uygulamasında oturum kapatma disiplini uygulanmalı; scanner elden ele geçse de kişisel veri host oturumundadır.
  - **Bertaraf:** Scanner'ın kendisinde kalıcı müşteri verisi tutulmadığından imha basit olsa da, AEEE kanalına verirken cihazın bir hafıza saklamadığından emin olun (bu modeller kalıcı işlem verisi tutmaz).

---

## 11. Satış ve devreye alma kontrol listesi

**Satış / tedarik öncesi (bayi):**
- [ ] Doğru **SKU / USB kiti** seçildi (Honeywell: **1450G2D** — 2D; Zebra: DS2208 USB kiti + doğru kablo SKU'su).
- [ ] Yalnızca **TR yetkili distribütör garantili** ürün; gri/paralel stok değil *(yetkililik teyit edildi)*.
- [ ] Satış fiyatı **katalogdan/QuoteService'ten** (KDV %20 dahil) alınıyor; alış maliyeti **2D-imager SKU'lu güncel yetkili distribütör listesiyle** doğrulandı (marj distribütör teklifine göre değişir, bağlayıcı değil) *(teyit)*.
- [ ] Kutu içeriği tam: scanner + **USB-A kablo** + stand.
- [ ] Garanti süresi netleştirildi: **B2B satışta üretici/bayi taahhüdüne göre (tipik 12–24 ay)**, sözleşmeyle belirlenir; üretici garantisi bilgisi *(teyit)*.

**Fiziksel kurulum:**
- [ ] Scanner host cihaza (POS terminali/tablet) USB ile takıldı; gerekiyorsa yeterli akımlı adaptör/hub.
- [ ] Açılış bip'i alındı; metin alanı testinde barkod + Enter yazılıyor.
- [ ] Okuma penceresi temiz, stand tezgâha yerleşti, kablo güzergâhı sıvıdan uzak.

**Konfigürasyon:**
- [ ] Arayüz modu **USB-HID klavye** (veya gerekiyorsa Sanal COM/ALT-numeric).
- [ ] **Enter (CR) suffix** tanımlı → okuma sonrası ürün sepete/adisyona düşüyor.
- [ ] **Türkçe karakter + QR testi** yapıldı; karakter kayması yoksa onay.
- [ ] 1450g'de **2D/QR sembolojisi etkin** (2D lisansı doğrulandı).
- [ ] Konfig profili (suffix/arayüz/dil) belgelendi/yedeklendi.

**Sisteme bağlama (HummyTummy):**
- [ ] Host cihaz doğru desende: **cloud-direct** (köprü yok) ya da **köprü-arkası** (`bridgeId` set) belirlendi.
- [ ] Host cihaz `pairCode` ile eşleşti (`POST /v1/devices/pair`, token alındı) — scanner o host'un peripheral'ı. *(pairCode 6 karakterli alfanümerik, 10 dk geçerli; host bearer tokenı varsayılan 24 saat TTL — yalnızca pair anında verilir, heartbeat TTL'i uzatmaz; pair'den 24 saat sonra dolar, devam için yeniden pair gerekir.)*
- [ ] Envanter/garanti için `scanner` cihaz kaydı açıldı: `ownership`, **`warrantyUntil`**, `capabilities[]` dolduruldu.
- [ ] Paketli ürünlerin **barkod → menü/stok kalemi eşlemesi** tanımlandı; mal kabul/sayım akışı test edildi.

**Operasyon & devir:**
- [ ] Personele okutma/odak-alanı, temizlik ve "ürün bulunamadı" giderme anlatıldı.
- [ ] Yedek **kablo** stokta (en sık arıza kalemi).
- [ ] RMA süreci ve garanti kapsamı (taahhüt edilen süre + muadil cihaz) müşteriye bildirildi.
- [ ] KVKK: QR/self-pay akışında kişisel veri işleme ve host oturum kilidi hatırlatıldı.
- [ ] Kullanım ömrü sonu **AEEE bertaraf** kanalı müşteriye bildirildi.

---

### Kaynaklar (teknik/sourcing doğrulaması için)
- Honeywell Voyager 1450g resmi ürün/spec (datasheet) sayfaları — IP sınıfı, sensör çözünürlüğü, boyut/akım/düşme SKU varyantına göre teyit edilmeli
- Zebra DS2200 Series (DS2208) resmi spec sheet + ürün referans kılavuzu (zebra.com) — ağırlık (~146 g), akım, kablo/aksesuar SKU'ları teyit edilmeli
- Zebra resmi garanti koşulları (support.zebra.com / DS2200 warranty statement) — standart üretici garantisi (~36 ay) teyit edilmeli
- Honeywell/Zebra resmi "where to buy / authorized distributor" sayfaları — TR yetkili distribütör listesi teyit edilmeli
- TR mevzuat: 6098 sayılı Türk Borçlar Kanunu (tacirler arası/B2B ayıp-garanti) ve alıcı tüketici ise 6502 sayılı Kanun + Garanti Belgesi / Satış Sonrası Hizmetler Yönetmeliği; Çevre, Şehircilik ve İklim Değişikliği Bakanlığı **Atık Elektrikli ve Elektronik Eşyaların Yönetimi Hakkında Yönetmelik (2022)** + ECBS üretici kaydı *(resmi kaynaktan teyit edilmeli)*
- Türkiye fiyat/kanal referansları: satış fiyatı kataloğdan/QuoteService'ten gelir; *sourcing için fiyatlar oynak, yalnızca 2D-imager SKU'lu yetkili distribütör listelerinden teyit edilmeli*

## Kaynaklar (doğrulanmış mevzuat)

- Elektromanyetik Uyumluluk Yönetmeliği (2014/30/AB), Resmi Gazete 2.10.2016, sayı 29845 — https://www.resmigazete.gov.tr/eskiler/2016/10/20161002-2.htm
- Elektrikli ve Elektronik Eşyalarda Bazı Zararlı Maddelerin Kullanımının Kısıtlanmasına İlişkin Yönetmelik (RoHS), Resmi Gazete 26.12.2022, sayı 32055 — https://www.resmigazete.gov.tr/eskiler/2022/12/20221226-2.htm
- Atık Elektrikli ve Elektronik Eşyaların Yönetimi Hakkında Yönetmelik, Resmi Gazete 26.12.2022, sayı 32055 — https://www.mevzuat.gov.tr/MevzuatMetin/yonetmelik/7.5.40055.pdf
- 6502 sayılı Tüketicinin Korunması Hakkında Kanun, Resmi Gazete 28.11.2013, sayı 28835 — https://www.resmigazete.gov.tr/eskiler/2013/11/20131128-1.htm
- Garanti Belgesi Yönetmeliği, Resmi Gazete 13.6.2014, sayı 29029 — https://www.resmigazete.gov.tr/eskiler/2014/06/20140613-2.htm

> Son güncelleme: 2026-07-02 - sürüm taslağı. Regülasyon/mali bilgiler bilgilendirme amaçlıdır; güncel resmi mevzuat (GİB, BKM, KVKK Kurumu, Ticaret Bakanlığı, ilgili yönetmelikler) esastır.
