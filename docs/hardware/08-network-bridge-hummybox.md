# Network Bridge (HummyBox Lite / Pro)

> Cihaz tipi (sistemdeki karşılığı): `local_bridge` · Doküman tipi: **device** · Marka: **HummyBox** (kendi markanız — üretici/ithalatçı yükümlülüğü sizdedir)
>
> Bu belge hem restoran operatörü hem de kurulumu yapan **bayi/satıcı** içindir. Teknik akışlar HummyTummy sisteminin gerçek davranışına (NestJS backend, Rust `local-bridge-agent` daemon, device-mesh eşleştirme) göre yazılmıştır. Emin olunmayan her mevzuat eşiği/ücret/tarih **"(resmi kaynaktan teyit edilmeli)"** notuyla işaretlenmiştir; asla kesin sayı olarak alınmamalıdır. Henüz kodda tamamlanmamış (iskele/planlanan) akışlar açıkça **"(planlanan / bugün iskele)"** olarak belirtilmiştir.

---

## 1. Genel bakış

**HummyBox**, restoranın yerel ağında (LAN) çalışan bir **köprü kutusudur** (`Device.kind = local_bridge`). İçinde HummyTummy'nin **Rust daemon**'ı (`apps/local-bridge-agent`) koşar. Görevi tek cümleyle: **buluttan erişilemeyen LAN çevre birimlerini** (yazarkasa, ESC/POS fiş/mutfak yazıcısı, kart POS terminali, arayan-numara/caller ID birimi ve opsiyonel olarak barkod okuyucu) bulut sistemine **güvenli biçimde bağlamaktır**.

### Neden gerekli
Üç sınıf çevre birimi tasarımı gereği internetten sürülemez:
- **Yazarkasa / mali yazıcılar (ÖKC):** internet yönlendirmesini reddeder; yalnız LAN + seri konuşur.
- **ESC/POS fiş/mutfak yazıcıları:** genelde NAT arkasında yerel alt ağdadır (Ethernet ile switch'e ya da köprüye USB/seri ile bağlı).
- **Kart POS terminalleri:** bankaya/acquirer'a bağlıdır, yalnız LAN tarafındadır.

HummyBox, bu LAN üzerinde HummyTummy'nin **tek yetkili konuşmacısıdır**. Yaptıkları:
- Buluttan verilen **bearer kimlik bilgisini** taşır (sunucuda sha256-hash'li saklanır).
- Buluta kalıcı **WSS** (yalnız giden bağlantı, `/ws/bridge`) açar; **20 sn'de bir heartbeat** gönderir.
- `device_commands` kuyruğundan cihaz komutlarını çeker, yerel sürücülere dağıtır.
- İnternet kesildiğinde komutları **yerel SQLite offline kuyruğa** yazar; bağlantı gelince tekrar oynatır.
- Cihaz olaylarını, loglarını ve ack'leri buluta geri gönderir.

> **Sürücü olgunluğu (gerçek durum):** Bugün köprüde **yalnız ESC/POS sürücüsü işlevseldir** (ağ üzerinden raw-TCP 9100 ya da seri/USB device-file). **Yazarkasa (Hugin) ve kart terminali (Ingenico iWL) sürücüleri şu an iskeledir (scaffold):** cihaza bağlanmaz ve komut çalıştırıldığında "not implemented in this scaffold" hatasıyla döner. Dolayısıyla köprü **bugün** yazarkasadan mali fiş kestiremez veya kartla çekim yapamaz; bu son-mil entegrasyonlar (NDA'lı üretici protokolleri gerektirdiğinden) **planlanan** durumdadır. Backend tarafındaki fiscal-core (Hugin/Beko) ve GMP-3 `fiscal_coupled` mantığı hazırdır; köprü katmanındaki fiziksel sürücü tamamlanınca uçtan uca akış devreye girer.

### Sistemdeki rolü ve topoloji
- **Bulut-direkt (cloud-direct) cihazlar** — tablet (`tablet_waiter`, `tablet_customer`), KDS/bar ekranı (`kds_screen`, `bar_screen`) — doğrudan buluta bağlanır. `Device.bridgeId = null`, WSS/HTTP. **Köprü GEREKMEZ.**
- **LAN çevre birimleri** — `yazarkasa`, `receipt_printer`, `kitchen_printer`, `pos_terminal`, `caller_id` (arayan numara) — **HummyBox arkasında** çalışır. `Device.bridgeId` set edilir. **Köprü GEREKİR.** (`scanner` / barkod okuyucu **opsiyonel** olarak köprü arkasında olabilir ya da doğrudan bir cihaza bağlanabilir.)

Yani bir şubede internete çıkan tabletler/KDS ekranı için köprü şart değildir; ama **mali yazıcı / fiş yazıcısı / kart terminali** kullanılacaksa **en az bir HummyBox** gerekir. Mali entegrasyon (Hugin/Beko yazarkasa, GMP-3 `fiscal_coupled` kart-fiş eşlemesi) tam da bu köprü üzerinden akacak biçimde tasarlanmıştır (sürücü olgunluğu için yukarıdaki nota bakın).

### Lite mi Pro mu?
- **HummyBox Lite (BOX-LITE-01):** küçük/orta tek şube, birkaç çevre birimi (1 yazarkasa + 1–2 yazıcı + 1 kart terminali).
- **HummyBox Pro (BOX-PRO-01):** yoğun/çok istasyonlu şube, çok sayıda eşzamanlı yazıcı/yazarkasa/POS, çok mutfak istasyonu.

---

## 2. Modeller ve teknik özellikler

> Aşağıdaki donanım hücreleri **hedef/tipik** değerlerdir. HummyBox kendi markanız olduğu için işlemci/RAM/güç/boyut gibi kalemler **ODM/üretim spesifikasyonundan kesinleştirilmelidir** — bu belgeye kesin veri olarak alınmamalıdır. Özellikle **radyo modülünün (WiFi/BT) varlığı** ve **besleme gerilimi**, uygulanacak regülasyon kapsamını (RED/BTK, LVD) belirlediğinden **önceliklidir** (bkz. Bölüm 9). Sabit olan **SKU ve ticari koşullardır**; **güncel perakende fiyatın tek yetkili kaynağı ürün katalogudur** (`HardwareProduct.priceCents` + checkout `QuoteService`, **KDV %20 dahil**). Aşağıdaki tutarlar bu katalog kalemlerinin bir görünümüdür; **alış maliyeti ve marj ODM/distribütör teklifine göre değişir ve bu belgede bağlayıcı değildir**.

### 2.1 HummyBox Lite — BOX-LITE-01

| Özellik | Değer |
|---|---|
| Ekran | Yok (başsız/headless kutu; yalnız durum LED'i) |
| İşlemci / RAM | Pi-class ARM ya da düşük güçlü x86 SoC; ~1–2 GB RAM *(ODM spesifikasyonundan teyit edilmeli)* |
| İşletim / yazılım | Linux (x86_64/ARM) + Rust daemon (`local-bridge-agent`, ~6–8 MB ikili) |
| Ağ | 1× Gigabit Ethernet (RJ45). WiFi **opsiyonel** *(donanım revizyonuna göre; teyit edilmeli — radyo modülü varlığı regülasyon kapsamını etkiler)* |
| Çevre birimi bağlantısı | **Ağ (Ethernet raw-TCP 9100)** — çoğu ESC/POS fiş/mutfak yazıcısı switch'e Ethernet ile bağlanır ve köprüye USB gerekmez; ayrıca **USB-A** (ESC/POS + yazarkasa) ve **RS-232 seri** (yazarkasa) *(port sayısı ODM'den teyit)* |
| Güç | Harici DC adaptör (5V USB-C veya 12V) *(teyit)*; PoE opsiyonel |
| Depolama | Dahili eMMC/SSD; **SQLite offline kuyruk** |
| Kapasite | Küçük şube: 1 yazarkasa + 1–2 yazıcı + 1 kart terminali (az sayıda eşzamanlı cihaz) |
| Ağ davranışı | Yalnız **giden** bağlantı: buluta WSS (443) + LAN yazıcıya raw-TCP 9100. **WAN portu açmaz, yerel sunucu/broker dinlemez.** |
| Boyut / montaj | Kompakt fansız kutu; raf/duvar/tezgah altı *(ölçü teyit)* |

### 2.2 HummyBox Pro — BOX-PRO-01

| Özellik | Değer |
|---|---|
| Ekran | Yok (başsız/headless kutu; durum LED'i) |
| İşlemci / RAM | x86 mini-PC / çok çekirdekli; ~4–8 GB RAM *(ODM spesifikasyonundan teyit edilmeli)* |
| İşletim / yazılım | Linux + Rust daemon (aynı `local-bridge-agent`, yüksek eşzamanlılık ayarlı) |
| Ağ | 1–2× Gigabit Ethernet (RJ45) + WiFi *(teyit edilmeli — radyo modülü varlığı regülasyon kapsamını etkiler)* |
| Çevre birimi bağlantısı | **Çoklu ağ (Ethernet raw-TCP 9100) yazıcı** + çoklu USB-A + çoklu RS-232/USB seri (çok yazıcı/yazarkasa/POS) *(port sayısı ODM'den teyit)* |
| Güç | 12V DC / dahili PSU *(teyit)* |
| Depolama | SSD; daha büyük **SQLite offline kuyruk** kapasitesi |
| Kapasite | Yoğun/çok cihazlı şube: çok sayıda eşzamanlı yazıcı/yazarkasa/POS + çok mutfak istasyonu |
| Ağ davranışı | Yalnız **giden** bağlantı (buluta WSS 443 + LAN yazıcıya raw-TCP 9100). **WAN portu açmaz, yerel sunucu/broker dinlemez.** |
| Boyut / montaj | Masaüstü/raf tipi kutu *(ölçü teyit)* |

> **Ağ portları hakkında (düzeltme):** Bu belgenin önceki taslağında köprünün `:8443` (tabletlere mTLS) ve `:1883` (MQTT, LAN-only) dinlediği yazıyordu. **Bu doğru değildir:** `local-bridge-agent` ikilisinde MQTT bağımlılığı, yerel mTLS sunucusu veya bu portlara bind eden herhangi bir dinleyici **yoktur**. Agent yalnızca **dışarı bağlanır** — buluta WSS (`/ws/bridge`) ve LAN yazıcıya raw-TCP 9100. Tabletler zaten "bulut-direkt" (`bridgeId = null`) olduğundan köprünün onlara yerel bir servis sunması da gerekmez. Böyle bir yerel broker/mTLS sunucusu **ileride** planlanırsa bu belgeye "(planlanan)" olarak eklenmelidir.

### 2.3 Ticari koşullar (sabit)

| SKU | Ürün | Satış | Kira | Taahhüt | `Device.ownership` |
|---|---|---|---|---|---|
| BOX-LITE-01 | HummyBox Lite | 4.800 TL | 99 TL/ay | 24 ay | `sold` veya `rented` |
| BOX-PRO-01 | HummyBox Pro | 9.500 TL | 199 TL/ay | 24 ay | `sold` veya `rented` |

> **Peşin/kira karşılaştırması (düzeltilmiş):** Verilen rakamlarla **kira toplamı, peşin satış fiyatının ALTINDADIR** (yaklaşık yarısı): Lite 99 TL × 24 = **2.376 TL** < 4.800 TL; Pro 199 TL × 24 = **4.776 TL** < 9.500 TL. Yani bu haliyle kira, peşin fiyatın üstünde bir "finansman/hizmet primi" içermez; tersine, 24 ay boyunca donanım + RMA/servis riskini taşıdığınız için **kira ekonomisinin marjı, güncel katalog fiyatı ve gerçek COGS üzerinden yeniden değerlendirilmelidir** (marj bu belgede bağlayıcı değildir; ODM/distribütör teklifi ve katalogdan hesaplanır). İki seçenek: (a) müşteriye sunumda peşin/kira farkını olduğu gibi (kira ucuzdur) anlatın; (b) kira ekonomisini CapEx + RMA + finansman maliyetini karşılayacak seviyeye çekin (ör. aylık ücretin yükseltilmesi). Aylık kira rakamları ticari kararla netleştirilmeli **(finansal modelden teyit edilmeli)**. Müşteriye sunumda fiyatların **KDV dahil/hariç** gösterimi ve taahhüt/ön bilgilendirme yükümlülükleri de netleştirilmelidir **(resmi kaynaktan teyit edilmeli)**.

---

## 3. Kullanım / operasyon (günlük senaryo)

HummyBox **kur-unut** bir cihazdır; personel gün içinde ona dokunmaz. Tipik gün:

1. **Açılış:** Köprü açık ve LAN'a bağlıdır. Boot'ta bearer token'ı çözer (bugün `HUMMY_BRIDGE_TOKEN` ortam değişkeninden; kalıcı OS keyring saklama **planlanan** durumdadır — bkz. Bölüm 4.2/10), buluta **WSS** açar, **heartbeat** başlar. Admin panelde köprü **`online`** görünür.
2. **Sipariş → çıktı:** Garson/QR/self-pay bir sipariş kapatınca bulut, ilgili LAN cihazına komut üretir:
   - Mutfak siparişi → `kitchen_printer` (ESC/POS) otomatik basar. **(İşlevsel)**
   - Ödeme fişi → `receipt_printer` (ESC/POS, 80 mm). **(İşlevsel)**
   - Mali fiş → `yazarkasa` (Hugin/Beko) ve kartla ödeme → `pos_terminal`; GMP-3 `fiscal_coupled` ise kart onayı ile mali fiş eşlenir. **(Köprü sürücüsü bugün iskele — planlanan; bkz. Bölüm 1 sürücü olgunluğu notu.)**
   - Köprü komutu kuyruktan çeker, doğru sürücüye verir, sonucu (ack/hata) buluta döner.
3. **İnternet kesildiğinde:** Köprü, gelen komutları **SQLite offline kuyruğa** yazar; yerel yazıcı çalışmaya devam eder (LAN ayakta olduğu sürece). Bağlantı gelince kuyruk **sırayla tekrar oynatılır** ve buluta senkron olur.
4. **İzleme:** Yönetici, admin panelde **Şube → Cihazlar / Yerel ağ** ekranından köprünün `online/offline` durumunu, son görülme zamanını (`lastSeenAt`), sürüm ve host bilgisini görür. **60 sn** heartbeat gelmezse köprü otomatik **`offline`** işaretlenir.
5. **Gün sonu:** Özel bir işlem gerekmez. Köprü sürekli açık kalabilir; kapatma önerilmez (offline kuyruk ve mali süreklilik için).

> **Önemli:** "Bilgi fişi" **mali belge değildir**. Mali fiş yalnızca onaylı **ÖKC/yazarkasadan** kesilir. Köprü mali cihaz değildir; yalnız mali cihaza komut taşıyan aktarıcıdır.

---

## 4. Kurulum ve sisteme bağlama

### 4.1 Fiziksel kurulum
1. Köprüyü **switch/router'a yakın** ve **çevre birimlerine erişebilecek** bir noktaya yerleştirin (kasa/tezgah altı dolabı ideal).
2. **RJ45 kablo** ile switch'e/router'a bağlayın (WiFi yerine kablolu Ethernet önerilir — mali cihaz sürekliliği için).
3. Çevre birimlerini bağlayın: ESC/POS yazıcılar **Ethernet ile switch'e** (raw-TCP 9100) ya da köprüye **USB/seri** ile; **yazarkasa** USB/seri (RS-232) ile; kart POS terminali LAN/USB ile.
4. Güç: adaptörü prize takın. **UPS (kesintisiz güç kaynağı) şiddetle önerilir** — köprü + yazarkasa + yazıcı aynı UPS'te olmalı.
5. Havalandırma: fansız kutuysa üstünü kapatmayın; sıcak dolapta bırakmayın.

### 4.2 Sisteme bağlama — provizyon ve eşleştirme (GERÇEK akış)

HummyTummy'de **iki ayrı ray** vardır. HummyBox **köprü rayını** (provisioning-token → claim) kullanır; arkasındaki bulut-direkt olmayan cihazlar kendi eşleştirmelerini yapar.

**A) Otomatik slot açılışı (satış akışı):**
Mağaza (`/admin/store`) → sepet → **PayTR ödemesi** → sipariş **ÖDENİNCE** device-mesh cihaz slotu **otomatik** açılır. Provizyon deterministik `provisionKey` (`${hardwareOrderId}:${productId}:${unitIndex}`) + PostgreSQL advisory-lock ile **idempotent**'tir (tekrar denemede çift slot açılmaz). Kategori `bridge` → `Device.kind = local_bridge` eşlenir.

**B) Köprünün devreye alınması (provisioning token → claim):**
1. Yönetici (yalnız **ADMIN**, plan özelliği **MULTI_LOCATION** gerekli) köprü slotunu açar; sunucu bir **provisioning token** üretir.
2. Bu **provisioning token operatöre yalnız BİR KEZ gösterilir** (paketleme fişine basılır ya da üretimde gömülür). Sunucuda **sha256-hash'li** saklanır; sonradan geri alınamaz.
3. Köprü ilk açılışta `POST /v1/bridges/claim { provisioningToken, hostname, os, agentVersion }` çağırır.
4. Sunucu **atomik tek-kullanımlık claim** yapar (`updateMany`, yalnız ilk çağrı `count=1` alır; ikinci çağrı temiz "geçersiz/kullanılmış" reddi alır) ve **uzun ömürlü bearer token** döner (varsayılan **30 gün** TTL; `LOCAL_BRIDGE_TOKEN_TTL_MS` ile ayarlanır). **Ham token yalnız bir kez döner**, at-rest sha256-hash'lenir. Provisioning token bu anda tüketilir (`provisioningTokenHash = null`).
5. Köprü bearer'ı saklar, `/ws/bridge`'e **WSS** açar ve **20 sn'de bir** `POST /v1/bridges/heartbeat` gönderir. 60 sn sessizlikte bulut köprüyü `offline` yapar.

> **Bearer saklama (gerçek durum — düzeltilmiş):** Kalıcı **OS keyring** saklama bugün **uygulanmamıştır (planlanan)**. Agent bearer'ı şu an `HUMMY_BRIDGE_TOKEN` ortam değişkeninden çözer; `keyring` crate'i ile OS keyring okuma/yazma kodda açık bir **TODO**'dur. Planlanan hedef platformlar: **Linux `secret-tool` (Secret Service), macOS Keychain, Windows DPAPI**. (Not: `local-bridge-agent` başsız bir Rust servisidir, bir **Tauri uygulaması değildir**; dolayısıyla "Tauri Stronghold" bu daemon için geçerli değildir.) Keyring gelene dek headless yeniden başlatmalarda token'ın `HUMMY_BRIDGE_TOKEN` ile sağlanması gerekir.

**C) Köprü arkasındaki çevre birimleri:**
- LAN cihazları (`yazarkasa`, `receipt_printer`, `kitchen_printer`, `pos_terminal`) için slot açılırken **`bridgeId` bu köprüye set edilir** — böylece komutlar köprü üzerinden yönlenir.
- Bulut-direkt cihazlar (tablet, KDS/bar ekranı) **6 karakterlik pairCode** ile ayrı raydan eşleşir: admin slot açar → pairCode üretilir (**10 dk** geçerli, şube başına en çok **10 bekleyen** slot) → cihaz `POST /v1/devices/pair` ile atomik claim → 24 saat TTL'li rotating bearer döner. Bu cihazların `bridgeId`'si **null** kalır.

> Özet: **Köprü = provisioning-token + `/v1/bridges/claim` (30g bearer).** **Bulut-direkt cihaz = pairCode + `/v1/devices/pair` (24s bearer).** İkisini karıştırmayın.

### 4.3 Ağ gereksinimleri
- Köprünün **dışarı (443/WSS) çıkışı** açık olmalı. Köprü **WAN tarafına port açmaz**; yalnız giden bağlantı kurar (buluta WSS + LAN yazıcıya raw-TCP 9100).
- Kurumsal/otel ağında güvenlik duvarı 443 giden trafiği ve WSS'i engellememeli.
- LAN'daki Ethernet yazıcılar için köprü ile yazıcı aynı alt ağda olmalı; köprü yazıcıya **raw-TCP 9100** ile erişebilmeli.

---

## 5. Tedarik ve sağlayıcı

**HummyBox kendi markanızdır** — piyasada hazır "HummyBox" distribütörü yoktur; **siz üretici/ithalatçı ve tek dağıtıcısınız**. Tedarik iki modelden biriyle kurgulanır **(iş-planı beyanı; somut tedarik zinciri/süre ODM sözleşmesinden teyit edilmeli)**.

### 5.1 Tedarik modelleri
- **(A) Yurt dışı ODM üretim + ithalat:** Çin/Tayvan menşeli fansız mini-PC / gömülü SBC / endüstriyel router-sınıfı kart bir **ODM'e** özel kasa + marka (HummyBox) ile ürettirilir, Türkiye'ye ithal edilir. Bu modelde **ithalatçı yükümlülükleri** (CE teknik dosyası, DoC, TAREKS, AEEE) tamamen sizde olur (bkz. Bölüm 9).
- **(B) Yerli montaj/markalama:** Çıplak kart/mini-PC ithal edilir; Türkiye'de kasalama + Rust daemon flash + marka + garanti/kutu eklenir. Bu, "yerli katkı" ve servis hızında avantaj sağlar.

> **Önemli (regülasyon):** Hangi model seçilirse seçilsin, **kendi markanızla piyasaya arz ettiğiniz an** üretici/ithalatçı yükümlülükleri (CE teknik dosya + DoC, AEEE kaydı, TAREKS, Türkçe kılavuz, garanti) **sizde doğar**; "yerli montaj/markalama" bu yükümlülükleri hafifletmez.

### 5.2 Donanım alternatif kaynakları (temel donanım için)
- **x86 fansız mini-PC** (endüstriyel, geniş çalışma sıcaklığı) — Pro için uygun.
- **ARM SBC / Pi-class** kart + endüstriyel kasa — Lite için uygun.
- **Endüstriyel gateway/edge** kutular (DIN-ray, çoklu seri portlu) — çok yazarkasa/POS senaryoları için.
> Marka/model seçimi ODM tekliflerine göre yapılır; bu belgeye belirli bir tedarikçi/model **kesin** yazılmamıştır (uydurma önlemek için).

### 5.3 Süre, maliyet ve marj
- **Tedarik süresi:** ODM ilk parti + numune + sertifikasyon dahil tipik olarak birkaç ay; seri üretim tekrar siparişleri daha kısa. **(ODM sözleşmesinden teyit edilmeli; süre/MOQ taahhütleri sözleşmeye dayanmadan müşteriye verilmemeli.)**
- **Satış fiyatları (katalogdan):** güncel perakende fiyat ürün katalogundan / `QuoteService`'ten gelir (**KDV %20 dahil**); bu belgedeki Lite 4.800 TL, Pro 9.500 TL peşin ve 99 / 199 TL/ay kira (24 ay) değerleri bu katalog kalemlerinin görünümüdür ve tek başına bağlayıcı değildir.
- **Alış maliyeti (COGS) ve marj:** Birim COGS, ODM teklifine + ithalat/gümrük + sertifikasyon amortismanı + Rust flash/QA + kasa/kutu/kablo + lojistiğe bağlıdır ve **ODM teklifinden kesinleştirilmelidir (resmi kaynaktan teyit edilmeli)**. Peşin satış marjı = satış fiyatı − (COGS + lojistik + garanti karşılığı). **Kira modelinde** ekonomiyi 24 aya yayılan tahsilat + arıza/değişim (RMA) karşılığı + finansman maliyeti belirler; **mevcut kira rakamları peşin fiyatın altında kaldığından (bkz. Bölüm 2.3), marj modeli kira rakamları düzeltilmeden kapatılmamalıdır.** Bu belgeye tahmini rakam **yazılmamıştır**; her parti için ODM teklifi üzerinden hesaplanmalıdır.

---

## 6. Bakım ve sarf malzeme

### 6.1 Köprünün kendisi
- **Sarf malzemesi yoktur** (kağıt/mürekkep/pil tüketmez). *(RTC koruma için pil hücresi varsa periyodik kontrol — donanım revizyonundan teyit.)*
- **Periyodik (3–6 ayda bir):** toz/fan temizliği (varsa), kablo ve konnektör kontrolü, güç adaptörü/UPS kontrolü, saat/zaman senkronu doğrulaması (mali fiş zaman damgası için kritik).
- **Firmware / agent güncellemesi:** Rust daemon, **derleme zamanında sabitlenmiş imzalı güncelleme manifesti** ile otomatik güncellenir. İmzasız/eşleşmeyen manifest reddedilir. *(Not: güncelleme dağıtım hattının bir kısmı kodda halen stub/iskeledir — planlanan.)* Güncelleme sonrası köprünün `online`'a döndüğü ve sürüm numarasının arttığı admin panelden doğrulanır.
- **Offline kuyruk sağlığı:** uzun internet kesintilerinden sonra SQLite kuyruğun boşaldığı (komutların oynatıldığı) kontrol edilmeli.

### 6.2 Köprüye bağlı cihazların sarfı (operatör hatırlatması)
Köprü sarf tüketmese de sürdüğü cihazlar tüketir:
- **Fiş/mutfak yazıcısı:** 80 mm (bazı modellerde 58 mm) **termal rulo**. Termal kağıt olduğundan mürekkep/ruban yoktur; yedek rulo stoğu tutun.
- **Yazarkasa:** modeline göre **termal rulo**; mali hafıza/EJ (elektronik günlük) bakımı yetkili ÖKC servisine aittir.
- **Kart POS terminali:** slip rulosu (termal) *(modele göre)*.

---

## 7. Sorun giderme ve arıza

| Belirti | Olası neden | Çözüm |
|---|---|---|
| Köprü admin'de **`offline`** | Elektrik/UPS kesik, RJ45 çıkmış, switch kapalı | Güç ve kabloyu kontrol et; UPS'i doğrula; köprüyü yeniden başlat; 60 sn içinde `online` bekle |
| **Claim başarısız** ("geçersiz/kullanılmış token") | Provisioning token zaten tüketilmiş veya yanlış girilmiş | Token tek kullanımlık; admin'den **yeni slot** açıp yeni provisioning token ile claim yap |
| Boot sonrası köprü **online olmuyor** | Bearer ortamda yok (headless yeniden başlatma; keyring henüz planlanan), 443/WSS engelli | Kalıcı keyring saklama gelene dek headless restart `HUMMY_BRIDGE_TOKEN` gerektirir; güvenlik duvarında **443 giden**/WSS'i aç |
| Heartbeat kesik, sık `offline/online` | Zayıf WiFi, ağ dalgalanması, çift IP | Kablolu Ethernet'e geç; DHCP çakışmasını gider; switch portunu değiştir |
| **Yazıcı basmıyor** | Ağ/USB/seri gevşek, kağıt bitti, kapak açık, yazıcının IP'si değişti (DHCP), raw-9100 erişilemez | Kabloyu/ağı ve ruloyu kontrol et; yazıcının sabit IP'sini doğrula; köprü→yazıcı 9100 erişimini test et; yazıcıyı kapat-aç; admin'de cihaz `online` mı; test çıktısı gönder |
| **Yazarkasa yanıt vermiyor** | Köprü sürücüsü henüz iskele (planlanan); seri kablo/COM, ÖKC modu, EJ dolu | Sürücü tamamlanana dek mali fiş köprü üzerinden **kesilemez**; seri bağlantı ve ÖKC durumunu kontrol et; yetkili ÖKC servisine yönlendir |
| **Kart terminali çekim yapmıyor** | Köprü sürücüsü henüz iskele (planlanan); terminal LAN/acquirer bağlantısı | Sürücü tamamlanana dek kartla çekim köprü üzerinden **yapılamaz**; terminalin kendi ağ/banka bağlantısını kontrol et |
| Offline kuyruk **büyüyor / boşalmıyor** | Uzun internet kesintisi ya da bulut erişimi yok | İnternet/443 çıkışını geri getir; reconnect sonrası kuyruğun oynatıldığını izle |
| Bearer **süresi doldu** (30 gün) | Köprü uzun süre çevrimdışıydı; 30 günlük bearer TTL'i doldu (bir token yenileme/refresh akışı **yoktur**) | Köprüyü ağa alıp admin'den **yeni slot → yeni provisioning token → yeniden claim (yeniden provizyon)** yapın; süresi dolan bearer için yenileme akışı olmadığından çözüm yeniden provizyondur |

**Ne zaman RMA?** Güç verilmiyorsa, boot etmiyorsa, port/konnektör fiziksel arızalıysa, tekrarlanan donanım resetleri varsa ya da yazılımsal tüm adımlara rağmen köprü kalıcı `offline` ise → **RMA** (Bölüm 8).

---

## 8. Garanti ve RMA süreci

### 8.1 Garanti

> **Önemli hukuki çerçeve (B2B kural):** Mağaza (`/admin/store`) üzerinden bir restoran **işletmesine** yapılan donanım satışı **B2B'dir** (satıcı: HummyTummy/bayi; alıcı: restoran işletmesi = **kural olarak tacir**). 6502 sayılı Tüketicinin Korunması Hakkında Kanun (Resmî Gazete 28.11.2013, sayı 28835) m.3 tüketiciyi "**ticari veya mesleki olmayan amaçlarla** hareket eden gerçek veya tüzel kişi" olarak tanımlar; restorana yapılan satış **ticari amaçlı** olduğundan alıcı tacir sayılır ve işlem **B2B'dir**. Bu nedenle 6502'nin tüketici korumaları (ayıplı maldan uzun süreli sorumluluk, Garanti Belgesi Yönetmeliği'nin tüketici ürünleri için öngördüğü asgari süreler) **tacirler arası bu satışta uygulanmaz**. Bunun yerine **6098 sayılı Türk Borçlar Kanunu (TBK) m.219** (satıcı ayıptan sorumludur) ve **m.223** (alıcının **muayene ve ayıbı ihbar külfeti**) ile **6102 sayılı TTK m.23/1-c** birlikte uygulanır; TTK m.23/1-c tacirler arası satışta **kesin süreler** koyar: **açık ayıp 2 gün** içinde, **gizli ayıp** ise sonradan ortaya çıkınca **8 gün** içinde inceleyip ihbar edilmelidir (aksi hâlde mal kabul edilmiş sayılır). TBK'nın ayıp hükümleri **emredici değildir** (satıcının **ağır kusuru** hâli — TBK m.221 — hariç); dolayısıyla taraflar sözleşmeyle geçerli bir **sorumsuzluk/sınırlama kaydı** koyabilir. Bu çerçevede üreticinin verdiği **12 veya 24 ay garanti B2B satışta geçerli ve bağlayıcıdır**; tüketici için öngörülen "asgari 2 yıl" eşiği bu satışa **uygulanmaz**. İstisna: alıcı istisnaen **tüketici** sayılırsa (şahıs, ticari amaç dışı) 6502 rejimi devreye girer. Somut olaya uygulama için **hukuki danışmanla teyit önerilir.**

- **B2B garanti süresi:** taraflarca kararlaştırılan süre esastır; **üreticinin verdiği 12 veya 24 ay garanti B2B satışta geçerli ve bağlayıcıdır** ve müşteriye net yazılmalıdır (süre ticari sözleşmeye dayanır).
- **Tüketici satışı istisnası:** satış istisnaen tüketiciye yapılırsa **Garanti Belgesi Yönetmeliği** (Resmî Gazete 13.6.2014, sayı 29029; **tüketiciye yönelik**) uyarınca **asgari 2 yıl** garanti rejimi (teslim tarihinden itibaren; yalnızca yönetmelik **EKİNDEKİ listeye tabi** ürün gruplarında) devreye girer.
- Sistemde her cihazın garanti bitişi **`Device.warrantyUntil`** alanında tutulur.
- **Kapsam:** üretim/donanım kusurları. **Kapsam dışı:** yanlış kullanım, sıvı teması, yıldırım/aşırı gerilim (UPS'siz kullanım), yetkisiz açma/değiştirme.
- Ürünle **Türkçe tanıtma ve kullanma kılavuzu** ve (tüketici satışında) **garanti belgesi** verilmelidir (elektronik ortamda sunulabilir; tüketici isterse **kağıt** verilir) **(resmi kaynaktan teyit edilmeli)**.

### 8.2 RMA (arıza değişim) akışı
1. Operatör arızayı bayiye bildirir (köprü ID, şube, belirti).
2. Bayi uzaktan triyaj yapar (admin'de `offline` mı, son `lastSeenAt`, sürüm).
3. Donanım arızası doğrulanırsa **yedek köprü** gönderilir/değişilir.
4. Admin panelde eski köprü **retire** edilir — sistem retire sırasında **`tokenHash` ve `provisioningTokenHash`'i temizler** (anti-resurrection: emekliye ayrılan kutu bir daha kimlik doğrulayamaz, çalınsa/geri gelse bile tekrar bağlanamaz).
5. Yeni köprü için yeni slot açılır → yeni provisioning token → claim → LAN cihazlarının `bridgeId`'si yeni köprüye taşınır.
6. Eski cihaz bayiye döner; garanti içindeyse ODM/üretim hattına iletilir.

### 8.3 Satıcı/bayi ve üretici/ithalatçı yükümlülükleri
- **Satış Sonrası Hizmetler Yönetmeliği** yalnızca **EKTEKİ LİSTEDE** yer alan ürün grupları için servis istasyonu, **TSE Hizmet Yeterlilik Belgesi (TSE-HYB)** ve asgari yedek parça/kullanım ömrü yükümlülüğü doğurur — bir ağ köprüsü/BT cihazının bu listede olup olmadığı **doğrulanmadan yükümlülük kesin sayılamaz (resmi kaynaktan teyit edilmeli)**.
- Bu yükümlülük esas olarak **üretici/ithalatçıdadır** (bu senaryoda kendi markanız olduğu için **sizsiniz**), salt "satıcı/bayi" değil. Ayrıca bu da **tüketici mevzuatı** eksenlidir; B2B satışta kapsamı sınırlı olabilir **(resmi kaynaktan teyit edilmeli)**.
- Garanti belgesi + Türkçe kılavuz sağlamak; makul sürede yedek/onarım.
- E-garanti (Ticaret Bakanlığı) süreçlerine uyum **(resmi kaynaktan teyit edilmeli)**.

---

## 9. Regülasyon ve uyumluluk

> HummyBox **kendi markanız** olduğundan, ithal/ürettiğinizde **üretici ve/veya ithalatçı yükümlülükleri sizdedir**. Aşağıdaki tüm sayısal eşik/tarih/ücretler **resmi kaynaktan teyit edilmelidir**.

### 9.1 Ürün güvenliği ve CE
- Türkiye'de teknik düzenleme/uygunluk çerçevesi **7223 sayılı Ürün Güvenliği ve Teknik Düzenlemeler Kanunu** ile yürütülür (12.03.2020'de yayımlandı, 12.03.2021'de yürürlüğe girerek eski **4703** sayılı kanunun yerini almıştır) **(yürürlük tarihi resmi metinden teyit edilebilir)**.
- Elektronik bir cihaz olarak HummyBox'ın uygunluk kapsamı **besleme mimarisine göre** değişir:
  - **Elektromanyetik Uyumluluk Yönetmeliği (2014/30/AB) — EMC** (Resmî Gazete 2.10.2016, sayı 29845; yetkili Sanayi ve Teknoloji Bakanlığı): **kutunun kendisi** tipik olarak bu kapsamdadır; CE + DoC + teknik dosya gerekir.
  - **Alçak Gerilim Yönetmeliği — LVD (2014/35/AB)** (resmî adı: *Belirli Gerilim Sınırları İçin Tasarlanan Elektrikli Ekipman ile İlgili Yönetmelik (2014/35/AB)*; Resmî Gazete 2.10.2016; yetkili Sanayi ve Teknoloji Bakanlığı): yalnızca AA 50–1000 V / DA 75–1500 V aralığındaki ekipmanı kapsar. HummyBox **5V/12V DC** ile beslenen bir kutu ise, kutunun kendisi bu alt-gerilim aralığının **ALTINDA** kalır ve **doğrudan LVD kapsamına girmez**; LVD yükümlülüğü tipik olarak **harici şebeke adaptörü/PSU'da** doğar. Yani kutu ≈ **EMC (+ varsa RED)**, adaptör ≈ **LVD** olarak değerlendirilir **(besleme gerilimi ve adaptör konfigürasyonuna göre onaylanmış uygunluk kuruluşuyla teyit edilmeli)**.
- Kapsama giren yönetmelikler için **CE işareti + AB/AT Uygunluk Beyanı (DoC)** ve **teknik dosya** zorunludur; test sonuçları teknik dosyaya eklenir, DoC imzalanır. Üreticinin teknik dosya ve DoC'yi, ürün piyasaya arz edildikten sonra belirli bir süre (tipik olarak ~10 yıl) saklaması gerekir **(kesin saklama süresi ilgili yönetmelikten teyit edilmeli)**.
- **İthalat denetimi (TAREKS):** EMC/LVD kapsamındaki ürünlerin ithalatında **TAREKS** üzerinden CE + DoC eşleşmesi TSE/Ticaret denetmenlerince kontrol edilir **(resmi kaynaktan teyit edilmeli)**.

### 9.2 Telsiz (WiFi/Bluetooth) varyantı
- Köprüde **fiilen WiFi/Bluetooth radyo modülü** varsa **Telsiz Ekipmanları Yönetmeliği (2014/53/AB) — RED** (Resmî Gazete 5.11.2020, sayı 31295; yetkili **BTK** — Bilgi Teknolojileri ve İletişim Kurumu) kapsamına girer; CE + DoC teknik dosyada radyo/spektrum ve sağlık başlıkları da yer alır ve BTK'nın piyasaya arz/uygunluk kurallarına uyulmalıdır.
- **Yalnız Ethernet (kablolu), radyo modülü fiilen bulunmayan** varyant RED kapsamı dışında kalır (yalnız EMC + varsa LVD). Ayrım **donanım revizyonundaki modülün fiili varlığına** bağlıdır **(teyit edilmeli)**.

### 9.3 Zararlı madde kısıtlaması (RoHS)
- **Elektrikli ve Elektronik Eşyalarda Bazı Zararlı Maddelerin Kullanımının Kısıtlanmasına İlişkin Yönetmelik (RoHS)** kapsamındadır (Resmî Gazete 26.12.2022, sayı 32055; AEEE Yönetmeliği ile birlikte yayımlanan çerçeve; yetkili Çevre, Şehircilik ve İklim Değişikliği Bakanlığı).

### 9.4 AEEE (WEEE) — elektronik atık
- **Atık Elektrikli ve Elektronik Eşyaların Yönetimi Hakkında Yönetmelik** (Resmî Gazete 26.12.2022, sayı 32055; yürürlük 1 Şubat 2023; 2012 tarih ve 28300 sayılı eski "Atık Elektrikli ve Elektronik Eşyaların Kontrolü Yönetmeliği"nin yerine) — uygulayıcı **Çevre, Şehircilik ve İklim Değişikliği Bakanlığı**.
- **Üretici yükümlülükleri (doğrulandı — Resmî Gazete 26.12.2022, sayı 32055):** Yönetmelikteki "üretici" tanımı, ürünü **kendi markası altında piyasaya süreni** ve **ithal edeni** kapsar — yani HummyBox'ı **kendi markanızla** satmanız sizi doğrudan **üretici** yapar (genişletilmiş üretici sorumluluğu). Bu nedenle: **(1)** Çevre, Şehircilik ve İklim Değişikliği Bakanlığı'nın **EEE Üretici Kayıt Sistemi'ne kayıt** olup **üretici kayıt numarası** almak, **(2)** düzenli **yıllık bildirim** vermek, **(3)** AEEE'lerin **toplanması/geri dönüşümü** için sistem kurmak/katılmak ve toplama hedeflerine katkı, **(4)** bilgilendirme yükümlülükleri **sizdedir**. Bu kayıt ve bildirim işlemleri **EÇBS (Entegre Çevre Bilgi Sistemi, ecbs.cevre.gov.tr)** üzerinden yürütülür. Bu bir çevre-atık mevzuatı olduğundan **B2B/B2C ayrımından etkilenmez**. Ürün/ambalaj üzerinde **üstü çarpı işaretli tekerlekli çöp kutusu (WEEE)** simgesi bulunmalıdır.
- **GEKAP (Geri Kazanım Katılım Payı) — AYRI bir mali yükümlülük:** AEEE üretici kaydı/bildiriminden **ayrıdır** ve onun yerine geçmez. GEKAP beyanı **EÇBS'ye değil, GİB'e (vergi dairesi)** verilir. Yani AEEE kayıt/yıllık bildirim (EÇBS) ile GEKAP beyanı (GİB) **iki farklı kanaldır**; ikisini karıştırmayın — biri çevre-atık, diğeri mali yükümlülüktür.
- **Toplama hedefleri** yıllar içinde artmaktadır; "2025'ten itibaren yıllık ~%5 artış" ifadesi **kesin değildir — oran/tarih resmi kaynaktan teyit edilmeli.**

### 9.5 Mali mevzuat (bağlam)
- **Köprü mali cihaz DEĞİLDİR** ve GİB/ÖKC onayına tabi değildir. Mali fiş yalnız onaylı **ÖKC/yazarkasadan** kesilir; köprü yalnız o cihaza komut taşıyacak biçimde tasarlanmıştır (köprü tarafındaki yazarkasa sürücüsü bugün iskele — bkz. Bölüm 1).
- Yazarkasa entegrasyonu (Hugin/Beko), e-Fatura/e-Arşiv ve **GMP-3 `fiscal_coupled`** kart-fiş eşlemesi köprü üzerinden akacak biçimde tasarlanmıştır ama **mali onay yükümlülüğü yazarkasa/ÖKC tarafındadır**. "Bilgi fişi" mali belge değildir.

### 9.6 Kılavuz ve işaretleme
- Türkçe **tanıtma ve kullanma kılavuzu**, güvenlik uyarıları, üretici/ithalatçı bilgisi, CE işareti, WEEE simgesi, model/SKU ve seri no ürün ve/veya kutu üzerinde bulunmalı **(resmi kaynaktan teyit edilmeli)**.

---

## 10. KVKK ve veri gizliliği

HummyBox, LAN'da **sipariş, ödeme ve fiş** trafiğini taşır; bu nedenle kişisel veri değerlendirmesi gerekir.

- **İşlenen veri:** sipariş içerikleri (masaya/müşteriye ait olabilir), fiş/mali belge içerikleri, çevre birimi komut/olayları. Bunların bir kısmı **kişisel veri** içerebilir (ör. müşteri adı, self-pay/QR akışındaki bilgiler).
- **Kart verisi:** Kart PAN'ı **terminalde/acquirer (PSP) tarafında** işlenir; köprü PAN saklamamalıdır. GMP-3 `fiscal_coupled` yalnız onay/fiş eşlemesi yapar. **Köprüyü PCI kapsamı dışında tutmak için PAN/manyetik iz saklanmamalıdır.**
- **At-rest güvenlik:** offline SQLite kuyruğu sipariş/fiş içeriği barındırabilir → erişim kontrolü + disk şifreleme önerilir. **Bearer token bugün `HUMMY_BRIDGE_TOKEN` ortam değişkeninde düz metin olarak tutulur / buradan çözülür; kalıcı OS keyring saklama planlanan durumdadır (bkz. Bölüm 4.2).** **Uyarı:** bu tek bearer token **köprü arkasındaki tüm cihazların güvenini taşır** — token'ı ele geçiren, köprüye bağlı yazarkasa / fiş-mutfak yazıcısı / kart terminaline giden komut hattının tamamını taklit edebilir. Bu nedenle keyring gelene dek token'ın gizli/erişimi kısıtlı biçimde sağlanması (dosya izinleri, kısıtlı process ortamı, gerektiğinde retire + yeniden claim ile rotasyon) idari-teknik tedbirlerle desteklenmelidir.
- **Ağ güvenliği:** köprü **WAN portu açmaz, yerel sunucu/broker dinlemez**; tüm bulut trafiği HTTPS/WSS (rustls + webpki-roots). LAN yazıcı trafiği raw-TCP 9100'dür → köprü ve yazıcıları ayrı VLAN/segment'te tutmak önerilir.
- **Kimlik güvenliği:** tek kullanımlık `provisioningTokenHash` (sha256) → rotating bearer; tokenlar at-rest hash'li; retire'da tokenlar temizlenir (anti-resurrection).
- **Yükümlülükler:** veri sorumlusu (restoran işletmesi) KVKK aydınlatma, veri minimizasyonu ve gerekli hallerde **VERBİS** kaydı yükümlülüğü taşıyabilir; HummyTummy/bayi tipik olarak **veri işleyen** rolündedir. Ancak **VERBİS kayıt zorunluluğu eşiğe bağlıdır** (yıllık çalışan sayısı, mali bilanço büyüklüğü, ana faaliyet olarak özel nitelikli veri işleme vb.) — çok sayıda küçük restoran eşik altında kalıp kayıt yükümlüsü olmayabilir; taraf rolleri (sorumlu/işleyen) de sözleşme ve fiili veri akışına göre değişebilir **(VERBİS eşikleri ve rol dağılımı güncel KVKK mevzuatı ve hukuki danışmanla teyit edilmeli — resmi kaynaktan teyit edilmeli)**.

---

## 11. Satış ve devreye alma kontrol listesi

**Satış / uygunluk (bayi):**
- [ ] Şubede LAN yazarkasa/ESC-POS/kart terminali var mı → köprü **gerekli** mi doğrulandı (yalnız tablet/KDS ise gerekmeyebilir).
- [ ] Lite mi Pro mu (çevre birimi sayısı/yoğunluk) seçildi.
- [ ] Peşin/kira modeli ve 24 ay taahhüt müşteriye net anlatıldı (fiyatların KDV dahil/hariç gösterimi netleştirildi).
- [ ] CE/DoC + AEEE üretici kaydı + WEEE simgesi + Türkçe kılavuz + garanti belgesi hazır (Bölüm 9); B2B/B2C garanti rejimi teyit edildi.

**Kurulum:**
- [ ] Köprü switch/router'a **kablolu (RJ45)** bağlandı; UPS'e alındı.
- [ ] Çevre birimleri bağlandı: Ethernet yazıcılar switch'e (raw-TCP 9100) veya köprüye USB/seri; yazarkasa USB/seri; POS LAN/USB.
- [ ] Güvenlik duvarında **443 giden / WSS** açık doğrulandı; köprü→yazıcı 9100 erişimi doğrulandı.

**Provizyon / eşleştirme:**
- [ ] (Satış akışı) PayTR ödemesi sonrası slot otomatik açıldı **veya** admin'de köprü slotu açıldı (ADMIN + MULTI_LOCATION).
- [ ] **Provisioning token bir kez alındı** ve güvenli saklandı (tekrar gösterilmez).
- [ ] Köprü ilk boot'ta `POST /v1/bridges/claim` yaptı; bearer sağlandı (bugün `HUMMY_BRIDGE_TOKEN`; keyring planlanan).
- [ ] Admin'de köprü **`online`**, heartbeat geliyor, sürüm/host doğru.
- [ ] LAN çevre birimlerinin `bridgeId`'si bu köprüye set edildi; bulut-direkt cihazların `bridgeId`'si **null**.

**Fonksiyon testi:**
- [ ] Test mutfak siparişi → `kitchen_printer` bastı. **(İşlevsel — ESC/POS)**
- [ ] Test ödeme fişi → `receipt_printer` bastı. **(İşlevsel — ESC/POS)**
- [ ] Yazarkasadan mali fiş kesildi (Hugin/Beko). **(Köprü sürücüsü bugün iskele/planlanan — yalnız sürücü tamamlandıysa test edilir.)**
- [ ] Kartlı ödeme → terminal çekti; GMP-3 eşleme aktifse fiş eşleşti. **(Köprü sürücüsü bugün iskele/planlanan — yalnız sürücü tamamlandıysa test edilir.)**
- [ ] İnternet kısa süreli kapatıldı → offline kuyruk çalıştı, reconnect'te oynatıldı.

**Devir/dokümantasyon:**
- [ ] Garanti belgesi + Türkçe kılavuz teslim; `Device.warrantyUntil` girildi.
- [ ] Operatöre `online/offline` izleme ve temel sorun giderme gösterildi.
- [ ] RMA/servis iletişim kanalı bırakıldı.

---

## Kaynaklar / mevzuat referansları (teyit için)

- Atık Elektrikli ve Elektronik Eşyaların Yönetimi Hakkında Yönetmelik (Resmî Gazete 26.12.2022, sayı 32055) — [mevzuat.gov.tr PDF](https://www.mevzuat.gov.tr/MevzuatMetin/yonetmelik/7.5.40055.pdf) · [ÇŞB duyuru](https://cygm.csb.gov.tr/atik-elektrikli-ve-elektronik-esyalarin-yonetimi-hakkinda-yonetmelik-ile-elektrikli-ve-elektronik-esyalarda-bazi-zararli-maddelerin-kullaniminin-kisitlanmasina-iliskin-yonetmelik-yayimlandi.-duyuru-436428)
- Entegre Çevre Bilgi Sistemi (EÇBS — üretici kaydı ve yıllık bildirim portalı) — [ecbs.cevre.gov.tr](https://ecbs.cevre.gov.tr/)
- Elektrikli ve Elektronik Eşyalarda Bazı Zararlı Maddelerin Kullanımının Kısıtlanmasına İlişkin Yönetmelik (RoHS, Resmî Gazete 26.12.2022, sayı 32055) — [Resmî Gazete](https://www.resmigazete.gov.tr/eskiler/2022/12/20221226-2.htm)
- Alçak Gerilim Yönetmeliği (LVD 2014/35/AB, Resmî Gazete 2.10.2016) — [Resmî Gazete](https://www.resmigazete.gov.tr/eskiler/2016/10/20161002-1.htm)
- Elektromanyetik Uyumluluk Yönetmeliği (EMC 2014/30/AB, Resmî Gazete 2.10.2016, sayı 29845) — [Resmî Gazete](https://www.resmigazete.gov.tr/eskiler/2016/10/20161002-2.htm)
- Telsiz Ekipmanları Yönetmeliği (2014/53/AB, Resmî Gazete 5.11.2020, sayı 31295) — [Resmî Gazete](https://www.resmigazete.gov.tr/eskiler/2020/11/20201105-6.htm) · [BTK Düzenleme ve Standartlar](https://www.btk.gov.tr/duzenleme-ve-standartlar)
- 6502 sayılı Tüketicinin Korunması Hakkında Kanun (Resmî Gazete 28.11.2013, sayı 28835) — [Resmî Gazete](https://www.resmigazete.gov.tr/eskiler/2013/11/20131128-1.htm)
- Garanti Belgesi Yönetmeliği (Resmî Gazete 13.6.2014, sayı 29029) — [Resmî Gazete](https://www.resmigazete.gov.tr/eskiler/2014/06/20140613-2.htm) · [mevzuat.gov.tr](https://mevzuat.gov.tr/mevzuat?MevzuatNo=19782&MevzuatTur=7&MevzuatTertip=5) · [Ticaret Bakanlığı garanti bilgilendirme](https://tuketici.ticaret.gov.tr/yayinlar/tuketici-bilgi-rehberi/garanti-belgeleri-hakkinda-bilgilendirme)
- TAREKS / CE ithalat denetimi — [Türkiye Ürün Kuralları Veri Tabanı](https://urunkurallari.ticaret.gov.tr/tr/sektorel-rehber/iletisim-teknolojisi-telekomunikasyon-ve-veri-isleme)

*(Tüm eşik/oran/tarih/süre değerleri yürürlükteki resmî metinlerden teyit edilmelidir; bu belge yönlendirme amaçlıdır, hukuki mütalaa değildir.)*

> Son guncelleme: 2026-07-02 - surum taslagi. Regulasyon/mali bilgiler bilgilendirme amaclidir; guncel resmi mevzuat (GIB, BKM, KVKK Kurumu, Ticaret Bakanligi, ilgili yonetmelikler) esastir.
