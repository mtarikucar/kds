# Fiş ve Mutfak Yazıcısı (Termal ESC/POS)

> **Cihaz tipi (sistemde):** `receipt_printer` / `kitchen_printer`
> **Doküman tipi:** device (donanım ürün ve uyumluluk yönergesi)
> **Kapsanan ürünler:** Epson TM-T20III (LAN) · Epson TM-T88VI (Ethernet) · Star TSP143IIIBI (Bluetooth)
>
> **KRİTİK UYARI — MALİ DEĞİLDİR:** Bu cihaz **mali olmayan** bir termal yazıcıdır. Yalnızca **bilgi fişi / adisyon / mutfak sipariş fişi** basar. **Yazarkasa (ÖKC) DEĞİLDİR ve mali fiş yerine GEÇMEZ.** Mali fiş / ödeme kaydedici cihaz fişi yalnızca onaylı **Yeni Nesil ÖKC (YN ÖKC) / yazarkasa** cihazından kesilir. Bu ürünü asla "yazarkasa" olarak konumlandırmayın veya sattırmayın.
>
> **KRİTİK UYARI — KOMUT SETİ UYUMLULUĞU:** Epson TM-T20III ve TM-T88VI gerçek **ESC/POS** yazıcılardır. Star **TSP143IIIBI ise yerelde ESC/POS değil, Star Line Mode (raster/Star komut seti) çalışır** ve köprünün ESC/POS sürücüsüyle doğrudan sürülemez — ayrıntı için bkz. Bölüm 2.3. Star'ı katalogda tutmadan önce köprü tarafında Star Line Mode/StarPRNT desteği doğrulanmalıdır *(üründe fiilen teyit edilmeli)*.

---

## 1. Genel Bakış

Fiş ve mutfak yazıcısı, HummyTummy KDS/POS platformunda **çıktı ucu** (output peripheral) rolündeki 80 mm termal yazıcıdır. İki mantıksal role hizmet eder ve bu rol sistemde `Device.kind` ile ayrılır:

- **`receipt_printer` (fiş/adisyon yazıcısı):** Müşteriye/kasaya verilen **bilgi fişi**, adisyon özeti, hesap dökümü, self-servis/QR sipariş özeti gibi **mali olmayan** belgeleri basar. Para çekmecesi (cash drawer) tetiği bu yazıcının çekmece "kick" portundan sürülür.
- **`kitchen_printer` (mutfak/bar yazıcısı):** Sipariş kalemlerini mutfağa/bara **sipariş fişi (KOT/kitchen ticket)** olarak basar. KDS ekranına ek olarak veya onun yerine fiziksel mutfak çıktısı isteyen işletmelerde kullanılır.

**`receipt_printer` ile `kitchen_printer` arasındaki fark fiziksel değil, sistemdeki yönlendirme rolüdür** (fişin içeriği ve nereye basılacağı). Aynı fiziksel yazıcı, konumuna ve `Device.kind` değerine göre kasa fişi veya mutfak KOT'u basabilir.

> **Önemli — donanım/protokol denkliği sınırlıdır:** `receipt_printer`↔`kitchen_printer` ayrımı yalnızca bir roldür; fakat "üç model de aynı ESC/POS donanımıdır" ifadesi **yanlıştır**. Epson TM-T20III ve TM-T88VI gerçek ESC/POS'tur; Star TSP143IIIBI farklı bir komut mimarisi (Star Line Mode) kullanır ve köprü sürücüsü açısından denk değildir. En az komut-seti/sürücü uyumluluğu **model bazında ayrışır** ve satın alım öncesi doğrulanmalıdır (bkz. Bölüm 2.3 ve Bölüm 5).

**Sistemdeki rolü ve akışları:**

- **Cihaz kaydı:** `Device.kind = receipt_printer` veya `kitchen_printer`. Sahiplik `Device.ownership ∈ {sold, rented, byo}`. Garanti `Device.warrantyUntil`. Yetenek etiketleri `capabilities[]` — örn. `['print_80mm','cash_drawer']` (çekmece portu bağlıysa) veya yalnızca `['print_80mm']`.
- **Bağlantı topolojisi:** Bir yerel termal yazıcı bir LAN/yerel çevre birimidir ve **HummyBox köprüsü (local_bridge) ARKASINDA** çalışır (`bridgeId` set edilir). Bulut-direkt bağlanmaz. Köprü, yazıcı sürücüsünü (ESC/POS veya Star Line Mode) barındırır, çevrimdışıyken işleri SQLite kuyruğunda tutar ve bağlantı dönünce basar.
- **Mağaza → provizyon akışı:** Mağazadan (`/admin/store`) donanım siparişi PayTR ile ödendiğinde, `printer` kategorisi **otomatik olarak bir `receipt_printer` cihaz slotu** açar (deterministik `provisionKey` + PostgreSQL advisory-lock ile idempotent). Bir mutfak yazıcısı rolü için slotun `Device.kind` değeri `kitchen_printer` olarak ayarlanır (admin panel akışıyla — bkz. Bölüm 4). Not: tek `printer` kategorisi fiş/mutfak ayrımını sipariş anında taşımaz; mutfak yazıcısında da slot `receipt_printer` doğar ve `kind` elle çevrilir — operasyonel bir boşluk *(kategori→kind eşlemesi ve dönüştürme adımı koddan/panelden teyit edilmeli)*.
- **Mali entegrasyondaki yeri:** Bilgi fişini bu yazıcı basar; **mali fişi** ayrı `yazarkasa` cihazı (Hugin/Beko adaptörleri) kesip GİB'e iletir. GMP-3 `fiscal_coupled` kart-POS eşlemesi ve e-Fatura/e-Arşiv de ayrı rotalardır. Bu yazıcı **mali zincirin dışındadır**.

---

## 2. Modeller ve Teknik Özellikler

> Aşağıda sistem kataloğundaki fiyat, garanti ve çekirdek özellikler **birebir** verilmiştir. Üreticiye ait ve katalogda geçmeyen yardımcı değerler (çözünürlük, boyut, ağırlık vb.) tipik değerlerdir ve **üretici veri sayfasından teyit edilmeli**. Baskı hızları maksimum/ideal yoğunluk ayarındadır; grafik ve yoğun Türkçe font baskısında düşer.

### 2.1 Epson TM-T20III (LAN) — fiş/kasa yazıcısı

| Özellik | Değer |
|---|---|
| Sistem SKU / rol | `receipt_printer` (opsiyonel `kitchen_printer`) |
| Katalog satış fiyatı | **4.500 TL** *(katalog/QuoteService fiyatı, **KDV %20 dahil**; alış maliyeti ve marj distribütör teklifine göre değişir, burada bağlayıcı değildir)* |
| Garanti | **24 ay** |
| Kağıt / yazma | 80 mm termal (58 mm kılavuzla), doğrudan termal |
| Baskı hızı | **~250 mm/s** (maks., tipik) |
| Arayüz / bağlantı | **Ethernet (LAN, RJ45)**; ESC/POS komut seti — **arayüz varyantı önemli:** TM-T20III farklı SKU varyantlarında gelir (ör. USB+Serial vs USB+Ethernet); LAN akışı için **USB+Ethernet varyantı** sipariş edilmeli *(doğru arayüz varyant/SKU kodu sipariş kaleminde sabitlenmeli — resmi kaynaktan teyit edilmeli)* |
| Kesici | Otomatik kesici (giyotin, tam/partial kesim) |
| Çekmece portu | **DK "kick" portu (drawer kick-out)** — para çekmecesi tetiği; konnektör fiilen 6P **RJ12**'dir (sektörde gevşekçe "RJ11" denir), 24V DK kablosu kullanılmalı |
| Çözünürlük | 203 dpi (8 nokta/mm) *(teyit edilmeli)* |
| Güç | Harici adaptör (PSU dahil), tipik ~24 V DC *(teyit edilmeli)* |
| Boyut / ağırlık | Kompakt masaüstü, ~1,5–1,7 kg *(teyit edilmeli)* |
| Köprü gereksinimi | Evet — HummyBox köprüsü arkasında (LAN), `bridgeId` set |

Konum: Fiyat/performans dengeli **standart kasa/fiş yazıcısı**. LAN üzerinden köprüyle aynı yerel ağda çalışır. DK kick portu sayesinde `capabilities: ['print_80mm','cash_drawer']` olarak devreye alınabilir.

### 2.2 Epson TM-T88VI (Ethernet) — yüksek hacimli premium

| Özellik | Değer |
|---|---|
| Sistem SKU / rol | `receipt_printer` (opsiyonel `kitchen_printer`) |
| Katalog satış fiyatı | **9.000 TL** *(katalog/QuoteService fiyatı, **KDV %20 dahil**; alış maliyeti ve marj distribütör teklifine göre değişir, burada bağlayıcı değildir)* |
| Garanti | **24 ay** |
| Kağıt / yazma | 80 mm premium termal, doğrudan termal |
| Baskı hızı | **~350 mm/s** (maks., tipik) |
| Arayüz / bağlantı | **Ethernet + USB** (Eth/USB); ESC/POS komut seti |
| Dayanıklılık | Yüksek dayanıklılık / yüksek görev döngüsü (yoğun servis) |
| Kesici | Otomatik kesici (giyotin) |
| Çekmece portu | DK kick portu (RJ12, drawer kick-out) *(model varyantında teyit)* |
| Çözünürlük | 203 dpi (8 nokta/mm) *(teyit edilmeli)* |
| Güç | Harici adaptör (PSU dahil) *(teyit edilmeli)* |
| Köprü gereksinimi | Evet — HummyBox köprüsü arkasında (LAN), `bridgeId` set |

Konum: **Yoğun kafe/restoran** için premium seçenek — daha hızlı baskı, daha yüksek dayanıklılık, Eth+USB esnekliği. Pik saatlerde fiş/KOT kuyruğu biriken işletmelere önerilir. Fiyatlandırma notu: geçerli perakende fiyat **katalog/QuoteService**'ten gelir (KDV %20 dahil); alış maliyeti ve marj distribütör teklifine göre değişir ve bu belgede bağlayıcı değildir.

### 2.3 Star TSP143IIIBI (Bluetooth) — kablosuz/mobil kasa

> **UYARI — komut seti ve topoloji:** Star TSP100III serisi (TSP143III) yerelde **ESC/POS değil**, **Star Line Mode** (raster/Star komut seti) çalışır ve normalde Star sürücüsü / futurePRNT / CloudPRNT ile sürülür. Köprünün **ESC/POS sürücüsü bir TSP143III'e doğrudan ESC/POS gönderirse büyük olasılıkla basmaz veya bozuk basar**. Ham ESC/POS/StarPRNT desteği asıl TSP100IV kuşağıyla (veya belirli firmware/emülasyon) gelir. Katalogda Star tercih edilecekse ya **TSP100IV/StarPRNT** modeli seçilmeli ya da köprüye **Star Line Mode adaptörü** eklenmelidir *(model kod/firmware'i ve köprü sürücüsünün Star Line Mode desteği üründe fiilen teyit edilmeli)*. Ayrıca TSP143IIIBI'nin Bluetooth'u ağırlıkla iOS/Android tablet ile **doğrudan (noktadan-noktaya)** eşleşme için tasarlıdır; paylaşımlı bir köprü çevre-birimi gibi davranmayabilir ve "BT köprü arkasında LAN çevre birimi" topolojisi çelişkilidir (BT ≠ LAN). Kablosuz ihtiyaç için **LAN model + WiFi köprü** ya da **doğrudan-BT (köprüsüz)** mimari daha gerçekçi olabilir *(köprü donanımının BT desteği ve BT yazıcı bağlama akışı resmi/ürün kaynağından teyit edilmeli; teyit edilmeden bu model satılmamalı)*.

| Özellik | Değer |
|---|---|
| Sistem SKU / rol | `receipt_printer` (opsiyonel `kitchen_printer`) |
| Katalog satış fiyatı | **6.500 TL** *(katalog/QuoteService fiyatı, **KDV %20 dahil**; alış maliyeti ve marj distribütör teklifine göre değişir, burada bağlayıcı değildir)* |
| Garanti | **24 ay** |
| Kağıt / yazma | 80 mm termal, "drop-in & print" kolay kağıt yükleme |
| Baskı hızı | ~250 mm/s (maks., tipik) *(üretici verisine göre teyit edilmeli)* |
| Arayüz / bağlantı | **Bluetooth** (kablosuz); **Star Line Mode** (yerelde ESC/POS değil — yukarıdaki uyarıya bakın) |
| Kesici | Otomatik kesici (giyotin) |
| Çekmece portu | Çekmece (cash drawer) portu — DK kick desteği (RJ12) |
| Çözünürlük | 203 dpi (8 nokta/mm) *(teyit edilmeli)* |
| Güç | Harici adaptör (PSU dahil) *(teyit edilmeli)* |
| Köprü gereksinimi | Evet — HummyBox köprüsüne **Bluetooth** ile eşlenir varsayımı *(köprü BT desteği ve Star Line Mode sürücüsü teyit edilmeli; doğrudan-BT/LAN+WiFi alternatifi değerlendirilmeli)* |

Konum: **Kablo çekilemeyen / mobil** noktalar için (adaya taşınan kasa, geçici stant). Ancak yukarıdaki komut-seti ve topoloji uyarıları nedeniyle bu model, köprü uyumluluğu doğrulanmadan katalogda tutulmamalıdır.

> **Model seçim özeti:** Standart kasa → **TM-T20III (LAN, USB+Ethernet varyantı)**. Yoğun/premium → **TM-T88VI (Eth+USB)**. Kablosuz/mobil → **TSP143IIIBI (BT)** — ancak yalnızca köprüde Star Line Mode/StarPRNT desteği ve BT bağlama akışı teyit edildikten sonra; aksi halde LAN model + WiFi köprü tercih edin. Epson modelleri gerçek ESC/POS'tur; Star modeli Star Line Mode'dur — **komut seti model bazında ayrışır**.

---

## 3. Kullanım / Operasyon

### 3.1 Günlük açılış (her vardiya başı)
1. Yazıcıyı ve (varsa) HummyBox köprüsünü elektriğe verin; güç LED'inin sabit yandığını doğrulayın.
2. Kağıt rulosunu kontrol edin; termal yüzün **doğru tarafa** (kesiciye/kafaya bakan yüz) geldiğinden emin olun. Termal kağıt tek yüzü ısıya duyarlıdır; ters takılırsa boş çıktı verir.
3. HummyTummy panelinde/POS ekranında yazıcının **"çevrimiçi"** göründüğünü doğrulayın (köprü heartbeat'i aktif). Kısa bir **test fişi** bastırın.
4. `cash_drawer` bağlıysa test çekmece açılışını (kick) deneyin.

### 3.2 Fiş/kasa yazıcısı (`receipt_printer`) akışı
1. Kasada ödeme alınır (`/admin` POS veya self-servis/QR).
2. HummyTummy **bilgi fişini** (adisyon/hesap özeti) köprüye gönderir; köprü yazıcı sürücüsüne (ESC/POS veya Star Line Mode) çevirip yazıcıya basar.
3. Nakit ödemede sistem **çekmece kick** komutu gönderir → DK portu üzerinden para çekmecesi açılır.
4. Fiş kesilir (otomatik kesici). Müşteriye verilir.
5. **Ayrı ve zorunlu adım:** Mali belge gerekiyorsa **yazarkasadan (YN ÖKC) mali fiş** kesilir ya da **e-Arşiv/e-Fatura** düzenlenir. Bu yazıcının çıktısı mali belge yerine geçmez.

### 3.3 Mutfak yazıcısı (`kitchen_printer`) akışı
1. Sipariş onaylanınca, kaleme atanan üretim istasyonuna (mutfak/bar) göre KOT üretilir.
2. `kitchen_printer` rolündeki yazıcı, o istasyonun **sipariş fişini** basar (masa no, kalem, adet, modifier/not, saat).
3. KDS ekranı da varsa çıktı ile KDS eş zamanlı çalışır (fiziksel yedek + ekran).
4. Bağlantı koptuğunda köprü SQLite kuyruğu KOT'u tutar; bağlantı dönünce basar — **sipariş kaybolmaz**, gecikir.

### 3.4 Gün sonu
1. Açık adisyonların kapandığını, tüm KOT'ların bastığını doğrulayın.
2. Kağıt seviyesini bir sonraki güne göre yenileyin.
3. Yazıcıyı kapatmak zorunlu değildir; ama uzun kapanışta (tatil) fişini çekin.

---

## 4. Kurulum ve Sisteme Bağlama

### 4.1 Fiziksel kurulum
- **Yer:** Isıya, buhara ve doğrudan sıvı sıçramasına maruz kalmayacak, havalandırması olan bir zemin. Mutfak yazıcısını fritöz/ocak buharından ve yağdan uzak, kapalı bir rafa alın (termal kafa ömrü için kritik).
- **Kağıt:** 80 mm genişlik, uygun rulo çapı; **termal yüz yukarı/kesiciye bakacak** şekilde takın. **BPA'sız (fenolsüz) termal kağıt** tercih edin (bkz. Bölüm 9).
- **Güç:** Ürünle gelen orijinal adaptörü kullanın; UPS/regülatörlü hat önerilir (ani kesintide baskı yarıda kalabilir).
- **Bağlantı:**
  - **TM-T20III / TM-T88VI (LAN):** RJ45 Ethernet ile köprünün bulunduğu **yerel ağa/switch'e** bağlayın. Sabit IP (veya DHCP rezervasyonu) verin ki köprü yazıcıyı hep aynı adreste bulsun.
  - **TSP143IIIBI (Bluetooth):** Köprü ana makinesiyle Bluetooth eşleştirmesi yapın (köprünün BT desteği ve Star Line Mode sürücüsü ön koşuldur — *resmi kaynaktan teyit edilmeli*; teyit edilmezse doğrudan-BT veya LAN+WiFi alternatifi seçin).
- **Çekmece (opsiyonel):** Para çekmecesini **DK "kick" kablosuyla** (RJ12, 24V — RJ11/4P değil) yazıcının DK/çekmece portuna takın. Bu, `capabilities: ['cash_drawer']` etiketini gerektirir.

### 4.2 Sisteme bağlama — provizyon ve eşleştirme (gerçek akış)

**A) Cihaz slotunun oluşması**
- **Satın alım yoluyla (otomatik):** `/admin/store` → sepet → **PayTR ödemesi**. Sipariş **ödenince** device-mesh **otomatik** bir cihaz slotu açar (deterministik `provisionKey` + pg advisory-lock, **idempotent** — çifte slot açılmaz). `printer` kategorisi `receipt_printer` slotu üretir.
- **Manuel (BYO/kirada):** Admin panelde ilgili şube için elle bir cihaz slotu oluşturulur. Şube başına **en çok 10 bekleyen slot** olabilir.
- **Mutfak yazıcısı rolü:** Slot `receipt_printer` doğar; mutfak rolü isteniyorsa `Device.kind` panelden `kitchen_printer` yapılır *(kesin admin panel akışı panelde/koddan teyit edilmeli — tek `printer` kategorisi rol ayrımını sipariş anında taşımadığından bu elle dönüştürme adımı operasyonel bir boşluktur)*.

**B) Köprünün eşleştirilmesi (asıl pairing burada)**
Bir yerel termal yazıcı **HummyTummy uygulamasını çalıştırmaz**; kendisi `POST /v1/devices/pair` çağırmaz. Eşleştirme, yazıcının bağlı olduğu **HummyBox köprüsü (`local_bridge`)** için yapılır:
1. Panelde köprü slotu için **6 karakterli alfanumerik ([A-Z0-9]) pairCode** üretilir (**10 dk geçerli**).
2. HummyBox köprü uygulaması bu pairCode ile `POST /v1/devices/pair` çağırır.
3. **Tek kullanımlık atomik claim** → köprüye **sha256-hash'li bearer token** döner (**24 saat TTL** — `DEVICE_TOKEN_TTL_MS`; bu süre **yalnızca pair anında** verilir). `heartbeat()` yalnızca `status` ve `lastSeenAt` günceller; `tokenExpiresAt`'e **dokunmaz**, yani token süresini **uzatmaz** (kayan/rotating TTL **değildir**). Token pair'den 24 saat sonra dolar ve süresi dolan token `authenticateToken` tarafından reddedilir; main/prod dalında token yenileme (refresh) yoktur, cihaz devam edebilmek için **yeniden pair** olmalıdır (yeni pairCode). Ham token **yalnızca bir kez** görünür; sunucuda **hash'lenmiş** saklanır.
4. Köprü artık WSS heartbeat + SQLite offline kuyruk + yazıcı sürücüsüyle çalışır.

**C) Yazıcının köprüye bağlanması**
1. Yazıcı cihaz kaydına `bridgeId` = ilgili HummyBox köprüsü atanır (LAN çevre birimi köprü arkasında çalışır).
2. Köprünün yazıcıya erişebilmesi için yazıcının **adresi** girilir: LAN modellerinde **IP:port**, BT modelinde **Bluetooth adresi/MAC** *(alan adları panelde teyit edilmeli)*.
3. `capabilities[]` ayarlanır (`print_80mm`, gerekiyorsa `cash_drawer`).
4. Panelden **test fişi** gönderilerek uçtan uca doğrulanır.

> **Cloud-direct mi, köprü mü?** Bu yazıcı **her zaman köprü arkasındadır** (`bridgeId` set). Bulut-direkt bağlanan cihazlar yalnızca tablet ve KDS ekranı gibi kendi uygulamasını çalıştıranlardır; termal yazıcı, yazarkasa ve kart-POS terminali gibi **LAN/yerel çevre birimleri köprü üzerinden** yönetilir.

---

## 5. Tedarik ve Sağlayıcı

> Fiyatlar sistem kataloğundaki **satış (liste) fiyatlarıdır** ve **tek yetkili fiyat kaynağı katalogdur** (`HardwareProduct.priceCents` + checkout `QuoteService`, **KDV %20 dahil**). **Bayi alış maliyeti ve marj, distribütör teklifine göre değişir ve burada bağlayıcı değildir** — aşağıda kesin alış rakamı verilmemiştir.

| Model | Üretici | Türkiye kanalı | Katalog satış fiyatı |
|---|---|---|---|
| TM-T20III (LAN) | Epson (Seiko Epson) | Epson Türkiye + yetkili distribütör/sub-distribütör kanalı *(ör. ART Sistem, İnter-POS vb. — güncel yetki statüsü resmi kaynaktan/Epson TR'den teyit edilmeli)* | 4.500 TL |
| TM-T88VI (Eth) | Epson (Seiko Epson) | Aynı Epson TR kanalı *(yetkili distribütör/satıcı — teyit edilmeli)* | 9.000 TL |
| TSP143IIIBI (BT) | Star Micronics | TR distribütörü **Ingram Micro** (duyuru mevcut) *(güncel yetki statüsü Star Micronics'ten teyit edilmeli)* | 6.500 TL |

- **Tedarik süresi:** Stoktan genelde **1–3 iş günü**; distribütör stoğu yoksa ithalat/temin **birkaç hafta** olabilir *(kanal stoğuna göre teyit edilmeli)*.
- **Bayi alış / marj:** Geçerli perakende fiyat **katalogdan/QuoteService'ten** gelir (KDV %20 dahil) ve bağlayıcı tek fiyat kaynağıdır. **Alış maliyeti ve marj distribütör teklifine göre değişir ve bu belgede bağlayıcı değildir** — kesin alış rakamı için distribütörden teyit alın *(sourcing teyidi)*. Bu belgede spekülatif marj tablosu veya negatif-marj örneği verilmez.
- **Arayüz varyant kodu (kritik):** TM-T20III farklı arayüz SKU'larıyla gelir; LAN akışı için **USB+Ethernet varyantı** sipariş kaleminde sabitlenmeli — yanlış varyant gelirse köprü-LAN akışı çalışmaz *(interface SKU resmi/distribütör kaynağından teyit edilmeli)*.
- **Alternatif kaynak:** Aynı 80 mm termal sınıfında Epson/Star muadilleri (ve Bixolon, Rongta gibi markalar) bulunur; ancak **ESC/POS (veya köprünün desteklediği komut seti) uyumluluğu, otomatik kesici ve DK çekmece kick** desteği doğrulanmadan alternatif eklenmemelidir. Bu aynı uyarı **kendi Star TSP143IIIBI seçimimize de uygulanır** (Star Line Mode ≠ ESC/POS — Bölüm 2.3). BYO cihaz kabulü için `ownership = byo` ile aynı uyumluluk kriterleri aranır.

---

## 6. Bakım ve Sarf Malzeme

### 6.1 Sarf malzeme
- **Termal kağıt (asıl sarf):** 80 mm genişlik, uygun rulo çapı. **BPA'sız/fenolsüz** kalite tercih edin. Kalitesiz kağıt kafa aşınmasını hızlandırır ve soluk baskı yapar. Yedek rulo stoğu bulundurun (yoğun serviste günde birden çok rulo tükenebilir).
- **Mürekkep/şerit YOK:** Doğrudan termal baskıdır; toner/ribbon gerekmez.
- **Pil:** LAN/Eth modelleri şebeke beslemelidir; kalıcı pil sarfı yoktur. BT modelinde yerleşik pil **yoktur** (adaptör beslemesi) — modele göre teyit edin.

### 6.2 Periyodik temizlik ve bakım
- **Termal kafa temizliği:** İzopropil alkollü (IPA) bezle, cihaz kapalı ve soğukken, hafifçe silin. Yoğun kullanımda **haftalık/aylık** önerilir (kağıt tozu ve yağ birikimi soluk baskı yapar).
- **Kesici ve kağıt yolu:** Kağıt tozunu düzenli temizleyin; kesici sıkışmalarında yabancı cisim (etiket, zımba) arayın.
- **Sensörler:** Kağıt-sonu ve kapak sensörlerini tozdan arındırın.
- **Mutfak ortamı:** Yağ/buhar filmi kafayı köreltir; mutfak yazıcısını kapalı rafta tutun ve temizlik sıklığını artırın.

### 6.3 Firmware / güncelleme
- **Yazıcı firmware'i:** Epson/Star'ın kendi araçlarıyla güncellenir *(üretici prosedürüne göre teyit edilmeli)*. Kritik bir sorun olmadıkça yoğun serviste güncelleme yapmayın.
- **Köprü (HummyBox) yazılımı:** Yazıcı sürücüsü (ESC/POS veya Star Line Mode) ve offline kuyruk köprüde yaşar; köprü güncellemeleri HummyTummy tarafından yönetilir. Yazıcıyla ilgili davranış değişiklikleri çoğunlukla köprü tarafında ele alınır.
- **Ağ ayarları:** LAN modelinde IP değişirse köprüdeki adres kaydını güncelleyin (DHCP rezervasyonu bunu önler).

---

## 7. Sorun Giderme ve Arıza

| Belirti | Olası neden | Çözüm |
|---|---|---|
| Boş/beyaz çıktı | Termal kağıt ters takılı veya termal olmayan kağıt | Rulo yönünü çevirin; onaylı termal kağıt kullanın |
| Soluk/silik baskı | Kafada kir/yağ, düşük kaliteli kağıt, yoğunluk düşük | Kafayı IPA ile temizleyin; kaliteli kağıt; yoğunluk ayarı |
| Star yazıcı bozuk/çöp basıyor | Köprü **ESC/POS** gönderiyor ama cihaz **Star Line Mode** | Köprüde Star Line Mode/StarPRNT sürücüsü/adaptörü etkinleştirin; gerekirse TSP100IV/StarPRNT model kullanın (Bölüm 2.3) |
| Yazıcı "çevrimdışı" görünüyor | Köprü heartbeat yok / ağ kopuk / yanlış IP | Köprü ve ağ bağlantısını, yazıcı IP:port kaydını doğrulayın |
| Baskı gecikiyor, sonra toplu basıyor | Köprü offline kuyruğu birikti (bağlantı kopmuştu) | Bağlantı dönünce kuyruk boşalır; ağ kararlılığını kontrol edin |
| Çekmece açılmıyor | DK kablosu takılı değil / yanlış kablo (RJ11/4P vs RJ12/DK) / `cash_drawer` etiketi yok / çekmece 24V değil | Doğru DK kick kablosunu (RJ12, 24V) ve `capabilities:['cash_drawer']`'ı; çekmece voltajını doğrulayın |
| Kesici sıkıştı | Kağıt tozu, yabancı cisim, kesici arızası | Cihazı kapatın, kağıt yolunu temizleyin; kurtarma prosedürü |
| BT yazıcı bağlanmıyor | Eşleştirme düştü / menzil / köprü BT yok / noktadan-noktaya BT paylaşılamıyor | Yeniden eşleştirin; köprüye yakınlaştırın; köprü BT + Star Line Mode desteğini teyit edin; gerekirse LAN+WiFi'ye geçin |
| Kağıt-sonu sürekli uyarısı | Sensör kirli veya arızalı | Sensörü temizleyin; kalıcıysa servis |
| Türkçe karakter bozuk (ş,ğ,İ) | Yanlış kod sayfası / karakter tablosu | Köprüde yazıcı kod sayfasını Türkçe'ye ayarlayın |

**Ne zaman RMA:** Kafa kalıcı olarak bir bant/sütun basmıyorsa, kesici mekanik olarak arızalıysa, kart/arayüz açılışta ölüyse (LED yanmıyor / ağda hiç görünmüyor) ve temizlik/yeniden eşleştirme/kablo değişimi çözmüyorsa → **garanti/RMA** (Bölüm 8). Termal kafa **sarf-benzeri aşınma** kalemi olduğundan, aşınma kaynaklı soluk baskıda garanti kapsamı üreticiye göre değişir *(teyit edilmeli)*.

---

## 8. Garanti ve RMA Süreci

- **Süre:** Üç model için de katalogda **24 ay** garanti tanımlıdır. Sistemde `Device.warrantyUntil` alanına işlenir; bu tarih RMA hak sahipliğinin dayanağıdır.
- **Kapsam (tipik):** Üretim ve malzeme kaynaklı arızalar. **Kapsam dışı (tipik):** fiziksel hasar, sıvı/yağ hasarı, yetkisiz müdahale, uyumsuz kağıt kaynaklı kafa hasarı, aşınma sarfı. Kesin kapsam üretici (Epson/Star) koşullarına bağlıdır *(teyit edilmeli)*.
- **Satış rejimi — kural olarak B2B (tacirler arası satış):** Mağazadan (`/admin/store`) restoran **işletmesine** yapılan donanım satışı bir **B2B** işlemdir (satıcı: HummyTummy/bayi; alıcı: restoran işletmesi = **kural olarak tacir**). Garanti rejimi buna göre belirlenir:
  - **Kural (tacir alıcı):** **6502 sayılı Tüketicinin Korunması Hakkında Kanun** (Resmî Gazete 28.11.2013, sayı 28835) m.3'e göre tüketici, "ticari veya mesleki olmayan amaçlarla hareket eden gerçek veya tüzel kişi"dir; restorana yapılan satış **ticari amaçlı** olduğundan alıcı işletme 6502 anlamında **"tüketici" değildir**. Bu nedenle 6502'nin ayıplı maldan sorumluluk hükümleri ve **Garanti Belgesi Yönetmeliği** (Resmî Gazete 13.06.2014, sayı 29029) uyarınca tüketici ürünleri için öngörülen **asgari (kural olarak 2 yıl) garanti süresi / azami 20 iş günü tamir süresi** gibi haklar, tacirler arası satışta **kural olarak uygulanmaz**. Bunun yerine **6098 sayılı Türk Borçlar Kanunu (TBK)**'nun ayıp/zapt hükümleri ve **tarafların kararlaştırdığı garanti süresi** geçerlidir. Dolayısıyla üreticinin/katalogun verdiği **24 ay** (bazı ürünlerde 12 ay) garanti **geçerli ve bağlayıcıdır**; bu süre bir "tüketici asgarisine aykırılık" oluşturmaz — B2B'de garanti süresini **taraflar** belirler.
  - **Tacir alıcının külfeti (TBK m.219 ve m.223; TTK m.23/1-c):** Satıcı, TBK m.219 uyarınca malın ayıplarından sorumludur; buna karşılık ticari alıcı, TBK m.223 gereği teslim aldığı malı **gözden geçirmek (muayene)** ve varsa ayıbı **süresinde satıcıya bildirmek (ihbar)** külfeti altındadır. İki tacir arasındaki satışta **6102 sayılı TTK m.23/1-c** kesin süreler koyar: **açık ayıplar 2 gün** içinde, muayeneyle hemen görülemeyen **gizli ayıplar ise ortaya çıktıktan sonra 8 gün** içinde satıcıya ihbar edilmelidir; bu külfet yerine getirilmezse mal ayıpsız kabul edilmiş sayılır. Ayrıca TBK'nın ayıp hükümleri **emredici değildir** (m.221 uyarınca satıcının ağır kusuru hâli hariç), dolayısıyla taraflar sorumsuzluk/sınırlama kaydı kararlaştırabilir. Bayi, teslimde muayene/ihbar sürecini müşteriye hatırlatmalıdır.
  - **İstisna (alıcı tüketici sayılırsa):** Alıcı istisnaen **tüketici** ise (ör. malı ticari/mesleki amaç dışında edinen şahıs), 6502 ve Garanti Belgesi Yönetmeliği devreye girer; o durumda garanti belgeli tüketici ürünleri için yasal **asgari garanti süresi** ve **azami tamir süresi (20 iş günü)** ile ücretsiz onarım/değişim/bedel iade hakları uygulanır.
  - *B2B'de uygulanacak hükümlerin ve yukarıdaki sürelerin güncel metni (6098 TBK m.219/221/223 ayıp/zapt; iki tacir arası ihbar süreleri için TTK m.23; istisnai tüketici hâli için 6502 + Garanti Belgesi Yönetmeliği) yürürlükteki resmi metinden doğrulanmalıdır.*
- **RMA akışı (bayi/satıcı için):**
  1. Arızayı Bölüm 7'ye göre eleyin; test fişi + köprü/ağ doğrulaması yapın.
  2. Seri no, `Device.warrantyUntil`, satış/fatura kaydı ve arıza açıklamasını toplayın.
  3. Yetkili distribütör/servise RMA açın *(Epson ve Star için güncel yetkili servis/RMA kanalı ilgili firmalardan resmi kaynaktan teyit edilmeli — yanlış kanal kaydı satış-sonrası servisi kırar)*.
  4. Değişim/onarım süresince operasyonu aksatmamak için **yedek yazıcı** (kirada/BYO) devreye alın; sistemde yeni cihaz slotu/`bridgeId` bağlama Bölüm 4'e göre yapılır.
  5. Onarılan/değişen cihaz döndüğünde eski `Device` kaydını emekliye ayırın (retire), yenisini eşleyin.
- **Satıcı yükümlülükleri:** Garanti belgesi ve fatura teslimi, Türkçe kullanım kılavuzu, AEEE bilgilendirmesi ve satış sonrası servis erişimi sağlanmalı *(mevzuat teyidi)*.

---

## 9. Regülasyon ve Uyumluluk

> Aşağıdaki mevzuat başlıkları yön göstericidir. **Her sayısal eşik, tarih, ücret ve zorunluluk resmi kaynaktan (Resmî Gazete, GİB, Çevre-Şehircilik ve İklim Değişikliği Bakanlığı, KVKK Kurumu, Ticaret Bakanlığı) teyit edilmelidir.**

### 9.1 En kritik başlık — Mali statü (bu cihaz yazarkasa DEĞİLDİR)
- Bu yazıcı **bilgi fişi / adisyon / mutfak sipariş fişi** basar; **ödeme kaydedici cihaz (ÖKC/yazarkasa) değildir** ve **mali fiş yerine geçmez**. Mali belge yalnızca onaylı **Yeni Nesil ÖKC (YN ÖKC)** cihazından kesilir ve satış verisi GİB'e iletilir.
- **Mevzuat dayanağı (düzeltildi):** YN ÖKC kullanma mecburiyetinin **temel dayanağı 3100 sayılı Kanun ile 426 Sıra No.lu VUK Genel Tebliği'dir** (YN ÖKC'ye geçişi düzenleyen asıl tebliğ, 2014). Kamuoyunda sıkça anılan **483 Sıra No.lu VUK Genel Tebliği ise 30.09.2017 tarihli ve 30196 sayılı Resmî Gazete'de** yayımlanmıştır ve esas olarak ÖKC kullanan mükelleflere belirli koşullarda **e-Fatura/e-Arşiv seçeneği** getirir — ÖKC zorunluluğunu tek başına düzenleyen tebliğ değildir. *(Not: önceki taslakta 483 tebliği "01.10.2018" tarihiyle ÖKC zorunluluğunun dayanağı gibi verilmişti; bu hatalıdır ve düzeltilmiştir. Kesin kapsam, tarih, muafiyet ve mükellefin güncel durumu **GİB — ynokc.gib.gov.tr — ve mali müşavirden resmi kaynaktan teyit edilmelidir**.)*
- e-Fatura/e-Arşiv mükellefiyeti ve "bilgi fişi"nin biçim/teknik kuralları için GİB'in ilgili tebliğleri ve **Bilgi Fişi Teknik Kılavuzu** esas alınır *(resmi kaynaktan teyit edilmeli)*. Bayi, müşteriye bu cihazı **asla mali belge kaynağı** olarak sunmamalıdır.

### 9.2 CE / EMC / LVD (elektriksel güvenlik ve EMU)
- Cihaz **CE** işareti taşımalıdır. Türkiye'de karşılık gelen uyumlaştırılmış mevzuat, her ikisi de Sanayi ve Teknoloji Bakanlığı'nca çıkarılan **Elektromanyetik Uyumluluk Yönetmeliği (2014/30/AB)** (Resmî Gazete 02.10.2016, sayı 29845) ve alçak gerilim/LVD için **Belirli Gerilim Sınırları İçin Tasarlanan Elektrikli Ekipman ile İlgili Yönetmelik (2014/35/AB)** (Resmî Gazete 02.10.2016)'tir. **AB Uygunluk Beyanı (DoC)** ve CE işareti, ithalat/piyasaya arz için gereklidir ve genelde yeterli kabul edilir (ayrı TSE zorunlu değildir) *(teyit edilmeli)*.
- **RoHS:** Çevre, Şehircilik ve İklim Değişikliği Bakanlığı'nca çıkarılan **"Elektrikli ve Elektronik Eşyalarda Bazı Zararlı Maddelerin Kullanımının Kısıtlanmasına İlişkin Yönetmelik"** (Resmî Gazete 26.12.2022, sayı 32055) kapsamında zararlı madde sınırlamaları geçerlidir.
- **İthalat rejimi:** Bu spesifik ürünün GTİP'ine göre ek işaretleme / TSE veya **TAREKS kayıt** gerekip gerekmediği değişebilir *(ithalatçı beyanı ve ilgili tebliğden resmi kaynaktan teyit edilmeli)*.

### 9.3 AEEE / WEEE (elektronik atık)
- **Atık Elektrikli ve Elektronik Eşyaların Yönetimi Hakkında Yönetmelik** kapsamındadır. Bu yönetmelik **Resmî Gazete 26.12.2022, sayı 32055**'te yayımlanmış ve 2012 tarihli (22.05.2012, sayı 28300) önceki **"Atık Elektrikli ve Elektronik Eşyaların Kontrolü Yönetmeliği"**ni yürürlükten kaldırmıştır. Geçiş hükümlerine göre yürürlük tarihi kamuoyunda **1 Şubat 2023** olarak anılır *(yürürlük tarihi resmi kaynaktan teyit edilmeli)*.
- Cihaz üzerinde **AEEE simgesi** (üzeri çizili tekerlekli çöp kutusu) bulunmalı; evsel atıkla atılmamalı, **ayrı toplama** ve geri dönüşüm kanalına verilmelidir.
- Üretici/ithalatçı ve dağıtıcı **geri alma (take-back)** ve toplama yükümlülüklerine tabidir; üretici/ithalatçının Bakanlığın **üretici kayıt / ECBS (Elektronik Cihaz/EEE Bilgi Sistemi) portalına kayıt** yükümlülüğü bulunur *(portal adı ve kapsam resmi kaynaktan teyit edilmeli)* ve sektörde **TÜBİSAD** gibi yetkilendirilmiş kuruluşlar (WEEE compliance scheme) üzerinden uyum sağlanır *(teyit edilmeli)*. Bayi, ömrünü tamamlayan yazıcının uygun kanalla bertarafını müşteriye bildirmelidir.

### 9.4 Termal kağıt — BPA/BPS ve gıda-temas/hijyen
- **BPA (Bisfenol A):** AB'de termal kağıtta BPA, **REACH Ek XVII, kayıt 66** (Komisyon Tüzüğü **(AB) 2016/2235**) ile **2 Ocak 2020'den itibaren ağırlıkça ≥ %0,02** konsantrasyonda piyasaya arz yasaklanmıştır. **BPS (Bisfenol S)**, termal kağıtta BPA'nın yerine geçen yaygın alternatiftir; ancak **"güvenli" değildir** — ECHA'ya göre üreme sistemi için toksik (reprotoksik) olduğundan şüphelenilen bir maddedir *(AB/ECHA verisi doğrulanmıştır)*. Türkiye'de karşılık, REACH Ek-XVII'nin ulusal karşılığı olan **KKDİK — "Kimyasalların Kaydı, Değerlendirilmesi, İzni ve Kısıtlanması Hakkında Yönetmelik" (Resmî Gazete 23.06.2017, sayı 30105 mükerrer) — Ek-17** kısıtlamaları kapsamındadır ve aynı BPA/termal kağıt kısıtını içerir; **Türkiye'ye özgü BPA yürürlük tarihi (yaklaşık 2022 sonu) KKDİK Ek-17 güncel metninden resmi kaynaktan teyit edilmelidir.**
- **Öneri:** İşletmeye ve personele (kasiyerin sık teması nedeniyle) **BPA'sız/fenolsüz** termal kağıt önerin. Bu, mevzuattan bağımsız iyi bir uygulamadır.
- **Gıda temas / hijyen:** Mutfak KOT'u yiyeceğe yakın ortamda kullanılır; fişleri **hazırlık/servis yüzeyine ve gıdaya doğrudan temas ettirmeyin**. Termal kağıt gıda ambalajı/gıda-temas malzemesi değildir. Kalıntı/toz gıdaya karışmayacak şekilde konumlandırın *(gıda hijyeni mevzuatı ilgili kısımları teyit edilmeli)*.

---

## 10. KVKK ve Veri Gizliliği

Bu yazıcı bir **çıktı ucudur** ve kalıcı bir hafızada belge saklamaz (termal, geçici bellek). Yine de bastığı belgeler ve akışındaki bileşenler **kişisel veri** içerebilir; 6698 sayılı **KVKK** kapsamında yükümlülük doğurur.

- **Kişisel veri riski (basılan içerik):** Bilgi fişi/adisyon ve mutfak KOT'u; **müşteri adı, masa/oturum, sipariş detayı**, teslimat fişinde **adres ve telefon**, `caller_id` ile eşleşmede **arayan numarası**, ayrıca **personel adı** içerebilir. Bunlar kişisel veridir.
- **Veri minimizasyonu:** Fişlere yalnızca amaç için gerekli alanları bastırın; teslimat dışı fişlerde adres/telefon basmayın. **Kart PAN'ını tam basmayın** (PCI-DSS gereği maskeli), CVV/hassas ödeme verisi asla basılmaz.
- **Fiziksel imha:** Hatalı/iptal fişler ve müşteri bilgisi taşıyan çıktılar **güvenli imha** ile atılmalı (çöpe okunur atılmamalı). Termal kağıt zamanla solar ama gizlilik açısından güvenli değildir.
- **Köprüdeki geçici veri:** HummyBox **SQLite offline kuyruğu**, basılamamış fiş/KOT yükünü (kişisel veri içerebilir) **geçici** tutar. Köprü cihazı fiziksel olarak güvende olmalı; kuyruk basıldıktan sonra temizlenmeli; köprü depolamasının şifreleme/erişim kontrolü gözden geçirilmelidir *(uygulama detayı teyit edilmeli)*.
- **Aktarım güvenliği:** Bulutla haberleşme **WSS/HTTPS** üzerindedir; yazıcı-köprü arası yerel bağlantı (Ethernet veya Bluetooth) fiziksel/ağ güvenliğiyle korunmalıdır. BT üzerinden aktarılan (kişisel veri içerebilen) fiş yükü de **KVKK aktarım güvenliği** ilkesi kapsamında değerlendirilmelidir.
- **Aydınlatma / envanter:** İşletme, müşteri kişisel verisi işleme faaliyetini **aydınlatma metniyle** bildirmelidir; KVKK m.10 aydınlatma yükümlülüğü kişisel veri işleyen **her işletme için istisnasız** geçerlidir. **VERBİS kayıt zorunluluğu ise mutlak değildir**: yıllık çalışan sayısı, mali bilanço büyüklüğü ve ana faaliyet kriterlerine göre eşik ve istisnalar vardır (küçük işletmeler muaf olabilir). **VERBİS kayıt eşikleri/istisnaları ve güncel Kurul kararları KVKK Kurumu (kvkk.gov.tr) kaynağından resmi olarak teyit edilmelidir.**
- **Saklama:** Fiş/sipariş kayıtlarının saklama süreleri, vergi mevzuatı ile KVKK'nın "amaçla sınırlı saklama" ilkesi arasında dengelenmeli *(teyit edilmeli)*.

---

## 11. Satış ve Devreye Alma Kontrol Listesi

**Satış öncesi / eşleştirme**
- [ ] İşletmeye **mali statü** açıkça anlatıldı: bu cihaz **bilgi fişi** basar, **yazarkasa/YN ÖKC değildir**, **mali fiş kesmez**.
- [ ] Doğru model seçildi (standart LAN = TM-T20III **USB+Ethernet varyantı** / premium = TM-T88VI / kablosuz = TSP143IIIBI — Star seçildiyse köprüde **Star Line Mode/StarPRNT** desteği doğrulandı).
- [ ] Komut seti uyumluluğu doğrulandı: Epson = ESC/POS; Star = Star Line Mode (köprü sürücüsü uyumlu).
- [ ] Rol belirlendi: `receipt_printer` mı, `kitchen_printer` mı; `Device.kind` doğru ayarlandı (mutfak yazıcısında elle dönüştürme yapıldı).
- [ ] Sahiplik doğru: `Device.ownership ∈ {sold, rented, byo}`; `Device.warrantyUntil` (24 ay) işlendi.
- [ ] Slot kaynağı doğru: mağaza siparişi PayTR ile ödendiyse **otomatik** `receipt_printer` slotu oluştu (idempotent); değilse manuel slot (şube başına ≤10 bekleyen) açıldı.

**Fiziksel + köprü**
- [ ] HummyBox köprüsü kuruldu ve **eşleştirildi** (6 karakterli alfanumerik ([A-Z0-9]) pairCode → `POST /v1/devices/pair` → tek-kullanımlık claim → 24 saat TTL bearer token, yalnızca pair anında verilir; heartbeat süreyi uzatmaz; ham token bir kez alındı).
- [ ] Yazıcı köprü arkasına bağlandı: `bridgeId` set; LAN modelde sabit **IP:port**, BT modelde **eşleştirme** yapıldı (köprü BT + Star Line Mode desteği teyitli).
- [ ] `capabilities[]` doğru: `print_80mm` (+ çekmece varsa `cash_drawer`).
- [ ] Kağıt **BPA'sız/fenolsüz**, 80 mm, doğru yönde takıldı; yedek rulo bırakıldı.
- [ ] **DK çekmece kick** (varsa) doğru kabloyla (RJ12, 24V — RJ11/4P değil) test edildi; çekmece açıldı.

**Uçtan uca doğrulama**
- [ ] Panelden **test fişi** başarıyla bastı; yazıcı **çevrimiçi** görünüyor (heartbeat aktif).
- [ ] `receipt_printer`: örnek bilgi fişi + nakit senaryosunda çekmece kick çalıştı.
- [ ] `kitchen_printer`: örnek KOT doğru istasyona bastı; Türkçe karakterler doğru.
- [ ] Çevrimdışı testi: köprü bağlantısı kesilip geri gelince kuyruktaki fiş bastı (**kayıp yok**).

**Uyumluluk + teslim**
- [ ] **Mali fiş** ayrı yazarkasadan/e-Arşiv-e-Fatura'dan kesiliyor — akış müşteriye gösterildi.
- [ ] CE/AEEE işaretleri cihaz üzerinde; **AEEE bertaraf** bilgisi verildi; garanti belgesi + fatura + Türkçe kılavuz teslim edildi.
- [ ] **KVKK:** fişte veri minimizasyonu (PAN maskeli, gereksiz kişisel veri basılmıyor), hatalı fiş güvenli imha, köprü fiziksel güvenliği anlatıldı.
- [ ] RMA/servis kanalı (Epson / Star yetkili servisi — güncel kanal teyitli) ve yedek cihaz planı iletildi.
- [ ] Satışın **kural olarak B2B** (6098 TBK m.219/223 ayıp/zapt; tacir alıcı **muayene/ihbar** külfeti, iki tacir arası ihbar süreleri **TTK m.23/1-c**: açık ayıp 2 gün / gizli ayıp 8 gün) olduğu, alıcının istisnaen tüketici (6502) olup olmadığı değerlendirildi; `warrantyUntil` (24 ay), seri no ve satış kaydı sisteme işlendi.

---

### Kaynaklar (grounding)
- Epson TR ürün ve yetkili kanalı — [Epson TR ürün sayfası](https://www.epson.com.tr/), yetkili distribütör/satıcı kanalı *(güncel yetki statüsü teyit edilmeli)*
- Star Micronics TR distribütörü (Ingram Micro duyurusu) — [realwire.com duyurusu](https://www.realwire.com/releases/Star-Micronics-kuresel-distributor-Ingram-Microyu-Turkiye-iin-atad), [TSP143III spec (Star Line Mode)](https://media.starmicronics.com/hubfs/Spec%20Sheets/TSP143III%20Spec%20Sheet_10-7-2022.pdf)
- Bilgi fişi mali belge değildir / YN ÖKC (426 = YN ÖKC dayanağı; 483 = 30.09.2017 RG 30196, e-belge seçeneği) — [GİB ynokc.gib.gov.tr Mevzuat](https://ynokc.gib.gov.tr/Home/Mevzuat), [Bilgi Fişi Teknik Kılavuzu](https://ynokc.gib.gov.tr/UploadedFiles/Files/Bilgi_Fisi_Teknik_Kilavuzu_24072020.pdf)
- REACH termal kağıt BPA kısıtı ((AB) 2016/2235, Ek XVII kayıt 66, 2 Ocak 2020, %0,02) — [CIRS](https://www.cirs-group.com/en/chemicals/eu-includes-bpa-restriction-in-thermal-paper-under-reach-annex-xvii), [INERIS](https://substitution.ineris.fr/en/news/implementation-restriction-bisphenol-thermal-papers)
- AEEE Yönetmeliği (26 Aralık 2022 RG; yürürlük 2023 başı) — [CSB duyuru](https://cygm.csb.gov.tr/atik-elektrikli-ve-elektronik-esyalarin-yonetimi-hakkinda-yonetmelik-ile-elektrikli-ve-elektronik-esyalarda-bazi-zararli-maddelerin-kullaniminin-kisitlanmasina-iliskin-yonetmelik-yayimlandi.-duyuru-436428), [Resmî Gazete 20221226](https://resmigazete.gov.tr/eskiler/2022/12/20221226-1.htm)

### Kaynaklar (doğrulanmış mevzuat)
- Alçak Gerilim/LVD — Belirli Gerilim Sınırları İçin Tasarlanan Elektrikli Ekipman ile İlgili Yönetmelik (2014/35/AB), RG 02.10.2016 — [resmigazete.gov.tr 20161002-1](https://www.resmigazete.gov.tr/eskiler/2016/10/20161002-1.htm)
- Elektromanyetik Uyumluluk Yönetmeliği (2014/30/AB), RG 02.10.2016 sayı 29845 — [resmigazete.gov.tr 20161002-2](https://www.resmigazete.gov.tr/eskiler/2016/10/20161002-2.htm)
- RoHS — Elektrikli ve Elektronik Eşyalarda Bazı Zararlı Maddelerin Kullanımının Kısıtlanmasına İlişkin Yönetmelik, RG 26.12.2022 sayı 32055 — [resmigazete.gov.tr 20221226-2](https://www.resmigazete.gov.tr/eskiler/2022/12/20221226-2.htm)
- AEEE — Atık Elektrikli ve Elektronik Eşyaların Yönetimi Hakkında Yönetmelik, RG 26.12.2022 sayı 32055 — [mevzuat.gov.tr 7.5.40055](https://www.mevzuat.gov.tr/MevzuatMetin/yonetmelik/7.5.40055.pdf)
- KKDİK Yönetmeliği (REACH Ek-XVII ulusal karşılığı; Ek-17 BPA/termal kağıt kısıtı), RG 23.06.2017 sayı 30105 mükerrer — [resmigazete.gov.tr 20170623M1-18](https://www.resmigazete.gov.tr/eskiler/2017/06/20170623M1-18.htm)
- BPS termal kağıtta BPA'nın yerine geçmiştir; ECHA reprotoksisite değerlendirmesi — [echa.europa.eu](https://www.echa.europa.eu/-/bisphenol-s-has-replaced-bisphenol-a-in-thermal-paper)
- 6502 sayılı Tüketicinin Korunması Hakkında Kanun (tüketici tanımı m.3), RG 28.11.2013 sayı 28835 — [resmigazete.gov.tr 20131128-1](https://www.resmigazete.gov.tr/eskiler/2013/11/20131128-1.htm)
- Garanti Belgesi Yönetmeliği (tüketiciye yönelik asgari 2 yıl), RG 13.06.2014 sayı 29029 — [resmigazete.gov.tr 20140613-2](https://www.resmigazete.gov.tr/eskiler/2014/06/20140613-2.htm)

> Son guncelleme: 2026-07-02 - surum taslagi. Regulasyon/mali bilgiler bilgilendirme amaclidir; guncel resmi mevzuat (GIB, BKM, KVKK Kurumu, Ticaret Bakanligi, ilgili yonetmelikler) esastir.
