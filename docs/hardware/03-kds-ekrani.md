# KDS / Mutfak & Bar Ekrani

> **Cihaz tipi (sistemde):** `kds_screen` / `bar_screen`
> **Baglanti modeli:** Cloud-direct (dogrudan buluta, `bridgeId = null`)
> **Belge tipi:** Cihaz kilavuzu (operator + bayi/satici)
> **Kapsanan SKU'lar:** Sunmi D2s KDS (15.6" Android KDS) · PENETEK 15.6" IP65 Restaurant Panel PC (model kodu teyide bagli — bkz. Bolum 2.2)

Bu belge; restoran operatoru ve HummyTummy bayisi/saticisi icin mutfak/bar ekrani (KDS) donanimlarinin secimi, kurulumu, HummyTummy platformuna baglanmasi, bakimi, garantisi ve Turkiye mevzuatina uyumlulugu hakkinda uctan uca yonergedir. Rakamsal/hukuki her esik icin "(resmi kaynaktan teyit edilmeli)" notu kullanilmistir; teklif/tarih/oran icermeyen kesin bir ifade yoktur.

---

## 1. Genel bakis

### Cihaz nedir, ne ise yarar
KDS (Kitchen Display System / Mutfak Ekran Sistemi), kasadan/QR menuden/self-pay'den/paket platformlarindan gelen siparislerin **kagit fiş yerine ekranda** mutfaga ve bara dustugu dokunmatik ekrandir. Amac:

- Siparisleri istasyon bazinda (sicak mutfak, soguk mutfak, bar, pizza, izgara vb.) **anlik** gostermek.
- Hazirlik durumunu yonetmek: `NEW → PREPARING → READY → SERVED` (bump/geri al).
- Hazirlik surelerini ve gecikmeleri renk/sayaç ile gostermek.
- "Hazir" bilgisini gercek zamanli olarak POS'a/garson tabletine geri bildirmek.

**Bar ekrani (`bar_screen`)** islevsel olarak KDS ile aynidir; farki, yalnizca bar/icecek kategorilerine yonlendirilen siparisleri gostermesidir (kategori → istasyon eslemesi ile).

### Sistemdeki rolu (HummyTummy)
- HummyTummy = NestJS + Prisma (Postgres) backend, React SPA web paneli, Tauri tabanli kiosk uygulamasi (`apps/kds-kiosk`) ve Rust yerel kopru daemon'u (`apps/local-bridge-agent`).
- KDS/Bar ekrani sistemde `Device` kaydidir: `Device.kind = kds_screen` veya `bar_screen`.
- **Baglanti topolojisi:** KDS/Bar ekrani bir **cloud-direct** cihazdir → dogrudan buluta WSS/HTTP ile baglanir, `Device.bridgeId = null`. HummyBox koprusune (yerel bridge) **ihtiyac duymaz**; kopru yalnizca LAN cevre birimleri (yazarkasa, ESC/POS yazici, kart POS terminali) icindir.
- Siparis akisi ekrana **DomainEventBus → KDS yonlendirici (mesh router)** uzerinden dusen gercek zamanli olaylarla gelir; ekran bir tuketicidir (order → hedef KDS cihaz(lar)ina fan-out).
- **Mali rolu YOKTUR.** KDS/Bar ekrani fiş kesmez, mali belge uretmez. "Bilgi fişi" mali belge degildir; mali fiş yalnizca onayli OKC/yazarkasadan kesilir (bkz. Bolum 9). KDS ÖKC kapsaminda **degildir**.

### Hangi cihaz tipini secmeli
| Ihtiyac | Onerilen SKU |
|---|---|
| Standart mutfak, tek kablo (PoE) ile guc+veri, Android ekosistemi, dusuk maliyet | **Sunmi D2s KDS** |
| Yogun buhar/su siçramasi/yag, endustriyel dayaniklilik, x86 (Windows/Linux) uygulama, IP65 on panel | **PENETEK P32xx-M82 (kesin kod teyide bagli)** |

---

## 2. Modeller ve teknik ozellikler

> **Onemli dogruluk notu:** Asagidaki degerler ureticilerin resmi katalog verilerine dayanir ancak SATISTA her biri yururlukteki resmi datasheet/distributor teklifiyle **yaziyla** teyit edilmelidir. Ozellikle: (1) Sunmi D2s KDS'nin kesin **IP koruma sinifi** modele/varyanta gore degisir (bazi Sunmi mutfak-ekrani datasheet'leri IP54/IP55 verir, bazi masaustu terminalleri resmi bir IP sinifi tasimaz) — belge IP65 vaadinden kaciniyor, gercek deger **(resmi kaynaktan teyit edilmeli)**; (2) **PoE, Sunmi D2s KDS'de opsiyonel bir konfigurasyondur** ve cihaz-spesifik PoE destegi/sinifi **(resmi kaynaktan teyit edilmeli)**; (3) PENETEK icin **P3224-M82** kodu ile 15.6" ekran boyutu arasinda katalog celiskisi vardir (bkz. 2.2). Perakende fiyat **katalogdan/QuoteService'ten** gelir (HardwareProduct.priceCents, KDV %20 dahil) ve tek baglayici fiyat kaynagidir; alis maliyeti/marj distributor teklifine gore degisir ve burada baglayici degildir. Garanti, ureticinin/distributorun taahhut ettigi **akdi/ticari** garantidir (bkz. Bolum 8). Kesin teknik detaylar distributor teklifiyle teyit edilmelidir.

### 2.1 Sunmi D2s KDS — 15.6" Android KDS
- **Satis fiyati:** Guncel perakende fiyat **katalogdan/QuoteService'ten** gelir (KDV %20 dahil); alis maliyeti/marj distributor teklifine gore degisir, burada baglayici degildir. · **Garanti:** 24 ay (akdi/ticari garanti; bkz. Bolum 8 — tacir/tuketici ayrimi) · **Ortam:** mutfak (Android)

| Ozellik | Deger |
|---|---|
| Ekran | 15.6" FHD 1920×1080, kapasitif çoklu dokunmatik |
| Islemci | Cortex-A55 dort cekirdek, ~1.8 GHz |
| Isletim sistemi | SUNMI OS (Android 11 tabanli) |
| Bellek / depolama | 2 GB RAM + 8 GB ROM (ops. 4 GB + 8 GB); MicroSD/TF 1 TB'a kadar |
| Ag | 100 Mbps LAN (RJ45); **PoE opsiyonel (teyit edilmeli)**; Wi-Fi 2.4/5 GHz (802.11 a/b/g/n/ac); Bluetooth (BLE) |
| Portlar | 4× USB Type-A, 1× RJ45 LAN, 1× RJ11 seri, 1× ses jaki, 1× guc, 1× Micro-USB (debug) |
| Ses / kamera | 3 W hoparlor; opsiyonel 2 MP on kamera |
| Koruma sinifi | **IP degeri modele/varyanta gore degisir — resmi Sunmi datasheet'inden teyit edilmeli** (mutfak-ekrani varyantlari icin tipik olarak IP54/IP55 belirtilir; su jetine dayanikli govde vaadi teyit gerektirir) |
| Montaj | VESA uyumlu, masaustu ayak |
| Boyut | ~381.5 × 251.2 × 40.6 mm |
| Guc | Adaptor giris AC 100–240 V → cikis DC 24 V/1.5 A; **veya PoE** (varyanta gore, bkz. Bolum 4) |
| HummyTummy istemcisi | Android kiosk uygulamasi (Tauri Android derlemesi) veya tam ekran tarayici (KDS web SPA) |

**Guclu yanlari:** Tek RJ45 kablosuyla (PoE varyanti) hem guc hem veri → mutfakta kablo/priz karmasasi yok. Kolay temizlik. Dusuk maliyet, Android ekosistemi.
**Sinirlari:** Kesin IP sinifi teyit gerektirir (IP65 degil, muhtemelen IP54/IP55 — su jeti/hortum onerilmez); Android → x86-only entegrasyonlar calismaz; PoE standart degil, ayrica siparis edilmeli.

### 2.2 PENETEK 15.6" IP65 Restaurant Panel PC — P32xx-M82
- **Satis fiyati:** Guncel perakende fiyat **katalogdan/QuoteService'ten** gelir (KDV %20 dahil); alis maliyeti/marj distributor teklifine gore degisir, burada baglayici degildir. · **Garanti:** 24 ay (akdi/ticari garanti; bkz. Bolum 8) · **Ortam:** endustriyel, islak/sicak mutfak (x86)

> **Model teyidi (KRITIK):** PENETEK'in isimlendirme mantiginda `P32-24` govdesi **~23.8" (24")** Restoran Mutfak Ekranina isaret eder; 15.6"/15" govde PENETEK'te tipik olarak `P3215-M82` / `P3216-M82` kodludur. Yani "**P3224-M82 = 15.6"**" ifadesi kendi icinde celiskilidir ve bu SKU buyuk olasilikla **23.8"**tir. 15.6" isteniyorsa dogru model kodu muhtemelen **P3215-M82 / P3216-M82**'dir. Siparis oncesi **ekran boyutu + kesin model kodu + IP sinifi distributorden YAZILI teyit alinmadan satista/faturada/garanti belgesinde beyan edilmemelidir** (fatura ve garanti belgesindeki "marka/model" bilgisi teslim edilen cihazla birebir eslesmelidir). **(resmi kaynaktan teyit edilmeli)**

| Ozellik | Deger |
|---|---|
| Ekran | 15.6" hedeflenir — kesin boyut/model kodu teyide bagli (bkz. model notu); Full HD, kapasitif dokunmatik (varyanta gore rezistif/floating) |
| Islemci | Intel Elkhart Lake **J6412** dort cekirdek (x86-64) |
| Isletim sistemi | Windows 10/11 IoT veya Linux (x86 Panel PC) |
| Bellek / depolama | DDR4 + M.2/SSD (konfigurasyona gore; teklifle teyit) |
| Sogutma | **Fansiz** (sessiz, toz cekmez, dusuk ariza) |
| Koruma sinifi | **On panel IP65** (toz sizdirmaz + su jeti); arka govde tipik IP54 — kesin deger teyide bagli |
| Govde | Döküm aluminyum / paslanmaz celik cerceve secenekleri (gida/endustri) |
| Portlar | ~6× USB, ~4× COM (seri), VGA + HDMI, LAN (RJ45), MIC/ses, cash-drawer portu |
| Guvenlik | TPM 2.0 |
| Montaj | VESA uyumlu |
| Omur / kullanim | Endustriyel, 24/7; uzun urun omru (~7 yil siniftan) |
| Guc | Harici DC adaptor (giris AC 100–240 V); PoE **standart degil** (teyit edilmeli) |
| HummyTummy istemcisi | Windows/Linux kiosk (Tauri masaustu derlemesi) veya tam ekran tarayici (KDS web SPA) |

**Guclu yanlari:** IP65 on panel, fansiz, endustriyel dayaniklilik → buharli/islak/yagli agir mutfak. x86 → yerel yazici/POS/entegrasyon suruculeriyle esnek. Cash-drawer/COM portlari.
**Sinirlari:** Kesin model kodu/ekran boyutu teyit gerektirir (kod-boyut celiskisi); PoE standart degil (ayri DC hat + priz gerekir); Android'e gore daha yuksek maliyet; Windows lisans/guncelleme yonetimi gerekir.

---

## 3. Kullanim / operasyon (gunluk senaryo)

**Vardiya baslangici**
1. Ekrani ac; kiosk uygulamasi/tarayici otomatik acilir ve son eslesme token'i ile buluta baglanir (yesil "cevrimici" gostergesi). Not: token sabit 24 saat gecerlidir (bkz. Bolum 4.2-C); sure dolmussa cihaz yeniden eslestirilmelidir.
2. Istasyonu dogrula (orn. "Sicak Mutfak" / "Bar"). Kategori → istasyon eslemesi admin panelde tanimlidir; bar icecekleri `bar_screen`'e, mutfak yemekleri `kds_screen`'e duser.
3. Ag/baglanti gostergesini kontrol et: kopan baglanti KDS'yi kor eder.

**Servis sirasinda**
4. Yeni siparis kartlari ekranin ust/sol tarafina duser; sesli/renkli uyari verir. Kart; masa/siparis no, kalemler, modifiye/notlar, adet ve gecen sureyi gosterir.
5. Hazirlamaya baslarken karti **"Hazirlaniyor" (PREPARING)** yap. Sayaç ilerledikce kart rengi degisir (yesil → sari → kirmizi = SLA asimi).
6. Kalem/urun bittikce isaretle; tum kalemler bitince karti **"Hazir" (READY)** yap (bump). Bu, POS'a/garson tabletine gercek zamanli geri bildirim gonderir (WebSocket ile yalnizca `kitchen-*`/`pos-*` odalarina; siparise bagli bir `sessionId` varsa musteri-oturumu "hazir" bildirimi ayrica `emitOrderStatusChangeWithCustomer` yoluyla gider).
7. Gerekirse geri al (yanlis bump), sesi kis, siparisi buyut, notu goster.
8. Cok istasyonlu urun (yemek + icecek) ilgili KDS ve bar ekranina ayni anda fan-out edilir; her ekran kendi kalemini yonetir.

**Vardiya sonu / kapanis**
9. Bekleyen (READY olmayan) kart kalmadigini dogrula.
10. Ekrani silerek temizle (Bolum 6). Cihazi kapatma; 7/24 acik kalabilir, ancak haftalik yeniden baslatma onerilir.

> **Baglanti kesintisinde:** KDS cloud-direct oldugundan internet/WSS kesilirse yeni siparis DUSMEZ. Cevrimdisi kuyruk KDS'de degil, koprudedir (KDS'de yok). Bu yuzden mutfaga yedek olarak bir kitchen_printer (ESC/POS) planlanmasi onerilir — internet coktugunde fişli mutfak akisi devam eder.

---

## 4. Kurulum ve sisteme baglama

### 4.1 Fiziksel kurulum
- **Konum:** Buhar/yagdan uzak, personelin net gorebildigi goz hizasi. PENETEK IP65 on panel dogrudan pişirme hattina yakin konabilir; Sunmi icin (kesin IP sinifi teyit edilene kadar) buhar jetinden bir miktar mesafe birak.
- **Montaj:** Her iki SKU VESA uyumlu → duvar/kol/ayak. Titresim ve isi kaynaklarindan uzak tut.
- **Ag kablolamasi:** Cat5e/Cat6 yapisal kablolama; RJ45. Mutfak ortami icin korumali (STP) kablo ve gida-uyumlu kablo kanali onerilir.
- **Guc secenekleri:**
  - **Sunmi (PoE varyanti):** Tek RJ45 kablo → guc+veri. **PoE switch/injektor 802.3af (Type 1, ~15.4 W PSE / ~12.95 W PD) veya 802.3at/PoE+ (Type 2, ~30 W PSE / ~25.5 W PD)** gerekir. 15.6" FHD + Android SoC muhtemelen 12.95 W'i asar → 802.3af yetmeyip **802.3at/PoE+** gerekebilir; cihazin gercek PoE guc butcesini ve PoE varyant destegini teklifte **(resmi kaynaktan teyit edilmeli)**. Uygun **topraklama** sarttir; PoE switch/UPS hatti topraklanmali (elektrik guvenligi + EMC).
  - **Sunmi (adaptor):** DC 24 V adaptor + priz.
  - **PENETEK:** Harici DC adaptor + priz (PoE standart degil). Mutfakta **RCD/kacak akim korumali** priz hatti ve topraklama sart.
- **UPS:** Servis surekliligi icin KDS + ag switch'i UPS'e baglanmasi onerilir.

### 4.2 Cihazin sisteme provizyonu ve eslestirilmesi (gercek akis)

**A) Slot'un olusmasi**
- **Otomatik (satin alim):** Magaza `/admin/store` → sepet → **PayTR** odemesi. Siparis **ODENINCE** device-mesh cihaz **slotu OTOMATIK** acilir (deterministik `provisionKey` + Postgres advisory-lock ile idempotent — cift provizyon olmaz). Kategori → cihaz tipi eslemesi geregi KDS urunu `kds_screen` (bar icin `bar_screen`) slotu acar.
- **Manuel:** Admin panelde cihaz slotu elle olusturulur (`Device.kind = kds_screen`/`bar_screen`, sube secilir).

**B) pairCode uretimi**
- Slot icin **6 karakterlik alfanumerik pairCode** uretilir (harf + rakam; alfabe `A–Z` ve `0–9`, orn. `A7K2Q9`). Kod salt rakamli DEGILDIR; eslestirme ekrani ve operator yonergesi harf+rakam kabul edecegini belirtmelidir. Kod **10 dakika** gecerlidir; her sube icin en cok **10 bekleyen slot** olabilir. (Kod suresi dolarsa yeniden uret.)

**C) Cihazdan eslestirme**
- Cihazda kiosk uygulamasini/tarayiciyi ac → eslestirme ekranina 6 karakterlik alfanumerik pairCode gir.
- Uygulama `POST /v1/devices/pair` cagirir → **tek kullanimlik atomik claim** yapilir (ayni kod ikinci kez calismaz).
- Basarili claim'de **sha256-hash'li bearer token** doner: **sabit 24 saat TTL** (`DEVICE_TOKEN_TTL_MS` varsayilani; bu 24 saatlik varsayilan `kds_screen`/`bar_screen` dahil HER `Device.kind` icin gecerlidir). **Onemli — gercek prod davranisi:** token suresi heartbeat ile UZAMAZ/kaymaz. Heartbeat yalnizca cihaz durumunu (`online`) ve `lastSeenAt` alanini gunceller; `tokenExpiresAt` yalnizca pair/claim aninda yazilir. Suresi gecmis token sunucu tarafinda sert reddedilir. Dolayisiyla cihaz **24 saat sonra otomatik self-recovery olmadan kimlik dogrulamayi durdurur** ve **yeniden eslestirme/token yenileme gerektirir**. (Heartbeat ile sureli uzatma yalnizca merge edilmemis bir gelistirme dalinda mevcuttur, prod'da degildir.) **Ham token yalnizca bir kez doner**, sunucuda **at-rest hash'li** saklanir → tokeni cihaz disina kopyalama/yeniden kullanma engellenir.
- Bundan sonra cihaz WSS/HTTP ile buluta **cloud-direct** baglanir (`bridgeId = null`); siparis olaylarini almaya baslar.

**D) Kopru gerekli mi?**
- **Hayir.** KDS/Bar ekrani icin HummyBox koprusu gerekmez (cloud-direct). Kopru yalnizca LAN cevre birimleri (yazarkasa, ESC/POS yazici, kart POS terminali) icindir. Ayni mutfakta bir kitchen_printer varsa, o yazici koprunun (`bridgeId set`) arkasinda calisir; KDS ise dogrudan bulutta.

**E) Sahiplik ve etiketler**
- `Device.ownership`: `sold` (satildi) / `rented` (kiralik) / `byo` (musteri kendi cihazi). `Device.warrantyUntil` garanti bitis tarihini tutar. `capabilities[]` ekranin yeteneklerini etiketler (KDS icin tipik olarak yazdirma/kasa yetenegi **yoktur**).

### 4.3 Kurulum sonrasi dogrulama
- Test siparisi ac → dogru istasyon ekraninda dustugunu gor.
- Bump → POS/garson tarafinda "hazir" bildiriminin dondugunu gor.
- Baglantiyi kes/ac → cihazin yeniden baglandigini gor. **Not:** token 24 saat sabit TTL'lidir; uzun (>24 saat) kesinti sonrasi token suresi dolmus olabilir → bu durumda cihazin yeniden eslestirilmesi gerekir (heartbeat token'i uzatmaz).

---

## 5. Tedarik ve saglayici

> **Fiyat otoritesi:** Tek yetkili perakende fiyat kaynagi **katalogdur** (HardwareProduct.priceCents + checkout QuoteService, KDV %20 dahil); musteriye baglanan fiyat her zaman buradan gelir. **Alis maliyeti ve marj distributor teklifine, kura ve adede baglidir ve bu belgede baglayici degildir** — kesin alis fiyati/oran uydurulmamistir; her biri **(distributor teklifiyle teyit edilmeli)**. Ithalat + konfigurasyon + kur, ozellikle yurt-ici distributoru netlesmemis kalemlerde (orn. PENETEK) alis maliyetini etkiler; kesin marj yine katalog fiyati ile alinan distributor teklifi karsilastirilarak degerlendirilmeli, burada bir marj rakami taahhut edilmemelidir.

### 5.1 Sunmi D2s KDS
- **Uretici:** Shanghai Sunmi Technology (Xiaomi ekosistemi).
- **Turkiye kanali:** Sunmi urunleri Turkiye'de yetkili is ortaklari uzerinden saglanir — orn. **Noya Bilgisayar/Noyatech** ve **Desnet** gibi kanallar Sunmi urunlerini listeler *(guncel yetkili distributor, stok ve lead-time resmi kaynaktan teyit edilmeli)*.
- **Tedarik suresi:** Stoktan tipik olarak birkac is gunu; toplu/PoE varyanti icin ithalat lead-time'i **(teklifle teyit edilmeli)**.
- **Fiyat / marj:** Perakende satis fiyati **katalogdan/QuoteService'ten** gelir (KDV %20 dahil); alis maliyeti distributor iskonto kademesine gore degisir → hedef brut marji projede belirle, burada baglayici degildir **(teyit edilmeli)**.
- **Alternatif kaynak:** Sunmi cozum ortagi entegratorleri (POS/EPoS bayileri), yetkili ithalatci ve uluslararasi Sunmi bayileri.

### 5.2 PENETEK P32xx-M82
- **Uretici:** PENETEK Technology, Inc. (Tayvan; endustriyel POS/panel PC, ~20+ yil).
- **Turkiye kanali:** PENETEK Turkiye'ye ticaret heyetleriyle temas etmis olsa da **arama sonuclarinda dogrudan bir Turkiye distributoru netlesmedi** → **yetkili ithalatci/entegrator dogrulanmali (resmi kaynaktan teyit edilmeli)**. Ithalatci kimliginin netlesmesi regulasyon acisindan kritiktir: CE uygunluk beyani (DoC) saklama, AEEE uretici/ithalatci kaydi ve garanti/servis yukumlulugu **"piyasaya arz eden ithalatci"** uzerindedir; dogrulanmis TR ithalatcisi yoksa bu yasal sorumlulari ustlenecek taraf belirsiz kalir.
- **Tedarik suresi:** Endustriyel/x86 konfigure urun → tipik olarak ithalat + konfigurasyon lead-time'i (haftalar) **(teklifle teyit edilmeli)**.
- **Fiyat / marj:** Perakende satis fiyati **katalogdan/QuoteService'ten** gelir (KDV %20 dahil); x86 + IP65 + fansiz → birim alis maliyeti Android'den yuksek olabilir. Marj distributor/proje adedine gore degisir ve burada baglayici degildir **(teyit edilmeli)** — alis maliyeti degerlendirmesi icin yukaridaki fiyat-otoritesi notuna bak.
- **RMA gercekciligi (KRITIK):** PENETEK icin yurt-ici yetkili servis/distributor yoksa, 24 ay garanti pratikte Tayvan'a geri-gonderimle karsilanir → RMA'da **haftalarca downtime** olabilir; Bolum 8'deki "RMA numarasi al / saha degisim SLA" vaadi in-country partner olmadan tutturulamaz. Kiralik (`rented`) cihazlarda bu SLA riski sozlesmede net tanimlanmali.
- **Alternatif kaynak:** Benzer sinifta IP65 fansiz endustriyel panel PC ureticileri (ör. PENETEK'in `P3215-M82` / `P3216-M82` 15" varyantlari, paslanmaz/aluminyum cerceve secenekleri) — model kodu/ekran boyutu farkina dikkat.

---

## 6. Bakim ve sarf malzeme

### Periyodik bakim ve temizlik
- **Gunluk:** Ekrani cihaz kapaliyken/kilitliyken nemli mikrofiber bezle sil. **PENETEK IP65 on panel** su siçramasina dayanir; **Sunmi** icin kesin IP sinifi teyit edilene kadar temkinli ol. Her iki durumda da **dogrudan yuksek basincli su/hortum tutma.** Asindirici/cozucu deterjan kullanma; gida-guvenli yuzey temizleyici tercih et.
- **Haftalik:** Havalandirma yuzeyi (PENETEK fansiz → ic fan yok; yine yuzey tozu al), kablo/konektor kontrolu, RJ45 kilit dili.
- **Aylik:** PoE switch/injektor ve topraklama kontrolu; kablo gerginlik/asinma; VESA/ayak vidalari; token/baglanti gunlugu (uzun suredir heartbeat atmayan cihaz — 24 saat TTL asimi durumunda yeniden eslestirme gerekebilir).

### Sarf malzeme
- **KDS/Bar ekraninin dogrudan sarf malzemesi YOKTUR** (kagit/rulo/toner yok). Ekran fişsiz calismak icindir.
- **Dolayli sarf:** Yalnizca yedek/opsiyonel **kitchen_printer** kullaniliyorsa **80 mm termal rulo** (mutfak yazicisi standardi) tuketilir — bu KDS'nin degil, mutfak yazicisinin sarfidir.
- **Pil:** Ne Sunmi D2s KDS ne PENETEK panel PC kullanici-degistirilebilir bataryayla calisir (sabit, sebeke/PoE beslemeli). PENETEK'te anakart **CMOS/RTC pili** (CR2032 sinifi) uzun vadede degisebilir — servis kapsaminda **(teyit edilmeli)**.

### Firmware / yazilim guncelleme
- **Sunmi (Android):** SUNMI OS/Android guncellemeleri ureticiden; HummyTummy kiosk uygulamasi ise `apps/kds-kiosk` derlemesi uzerinden guncellenir. Guvenlik yamalarini uygula; mutfakta OTA'yi vardiya disinda planla.
- **PENETEK (Windows/Linux):** OS guncellemelerini **kontrollu** yap (kiosk kararliligi icin otomatik zorunlu yeniden baslatmayi kapat/planla). Kiosk uygulamasi Tauri masaustu derlemesiyle guncellenir.
- Guncelleme sonrasi mutlaka **test siparisi + bump** ile uctan uca dogrula.

---

## 7. Sorun giderme ve ariza

| Belirti | Olasi neden | Cozum |
|---|---|---|
| Ekran acilmiyor / guc yok | PoE switch/port arizasi, adaptor, priz/RCD atmis | Baska PoE porta/injektore al; adaptoru degistir; RCD/sigortayi kontrol et |
| "Cevrimdisi" / siparis dusmuyor | Internet/WSS kesik, ag kablosu/switch, **veya token suresi dolmus (24s TTL)** | Ag baglantisini test et; switch/uplink; token 24 saatten eskiyse **yeniden eslestir** (heartbeat token'i uzatmaz) |
| Eslestirme (pairing) basarisiz | pairCode suresi doldu (10 dk), kod baska cihazda kullanildi (tek-kullanimlik), sube bekleyen-slot limiti (10) doldu, **veya kod harf iceriyor ama salt-rakam girildi** | Admin panelden yeni pairCode uret; alfanumerik (harf+rakam) girildiginden emin ol; eski slotlari temizle |
| Siparis yanlis ekrana dusuyor | Kategori → istasyon eslemesi hatali | Admin: kategori/istasyon eslemesini duzelt |
| Dokunmatik calismiyor / hatali | Ekranda su/yag filmi, kalibrasyon | Kuru/temizle; PENETEK'te touch surucusu/kalibrasyon; yeniden baslat |
| Sik donma/reboot (PENETEK) | Isinma, OS guncelleme cakismasi, depolama dolu | Yuzey tozu/havalandirma; OS/kiosk guncelle; disk temizle |
| PoE var ama guc yetmiyor (Sunmi) | 802.3af butce siniraltinda | 802.3at/PoE+ switch/injektore gec |
| Token surekli dusuyor / 24 saatte bir kesiliyor | Sabit 24s TTL doldu, heartbeat token'i uzatmaz (gercek prod davranisi) | Cihazi **yeniden eslestir**; ag/saat senkronunu kontrol et |
| Ekranda goruntu var ama bump POS'a gitmiyor | Geri bildirim olay yolu / baglanti | Baglantiyi yenile; test siparisiyle bump dogrula |

**RMA'ya ne zaman gidilir:** Fiziksel hasar (kirik panel, sivi girisi sonrasi kalici ariza), guç verildiginde hiç açilmama, tekrarlayan donanim reboot'u (yazilim disi), dokunmatik/panel donanim arizasi, PoE/anakart arizasi. Once Bolum 8'deki adimlari uygula, sonuc alinmazsa RMA ac.

---

## 8. Garanti ve RMA sureci

- **Garanti suresi:** Her iki SKU icin **24 ay** (ureticinin/distributorun taahhut ettigi akdi/ticari garanti — kesin sure ve kapsam datasheet/teklif ile teyit edilmeli). Sistemde `Device.warrantyUntil` alani garanti bitisini tutar; satista bu alanin dogru yazildigini kontrol et.
- **Tuketici mi tacir mi (KRITIK ayrim):** Magaza (`/admin/store`) uzerinden restoran isletmesine yapilan bu satis kural olarak **B2B'dir** (satici: HummyTummy/bayi; alici: restoran isletmesi = tacir). **6502 sayili Tuketicinin Korunmasi Hakkinda Kanun** (Resmi Gazete 28.11.2013, sayi 28835) m.3'e gore tuketici, "ticari veya mesleki olmayan amaclarla hareket eden gercek veya tuzel kisi"dir; restorana satis ticari amacli oldugundan alici tuketici degil **tacirdir**. Bu nedenle **6502'nin ayipli mal hukumleri ile Garanti Belgesi Yonetmeligi** (Resmi Gazete 13.6.2014, sayi 29029; tuketiciye yonelik, ekindeki listeye tabi urunlerde asgari 2 yil) — garanti belgesi zorunlulugu, tuketici urunleri icin ongorulen asgari garanti/azami tamir sureleri, ayipli maldan sorumlulukta uzun sureler — **tacirler arasi satista UYGULANMAZ**. Bunun yerine **6098 sayili Turk Borclar Kanunu**'nun ayip hukumleri (m.219: satici ayiptan sorumludur; m.223: alici muayene/ihbar kulfeti), **6102 sayili TTK m.23/1-c**'nin tacirler arasi KESIN sureleri (acik ayip **2 gun**, muayeneyle fark edilemeyen gizli ayip ise ortaya ciktiktan sonra **8 gun** icinde inceleme-ihbar) ve **taraflarin kararlastirdigi (akdi) garanti suresi** gecerlidir. TBK'nin ayip hukumleri **emredici degildir** (m.221'deki agir kusur/hile hali disinda sorumsuzluk veya kisitlama kaydi gecerlidir); dolayisiyla **ureticinin/distributorun verdigi 12/24 ay garanti B2B'de gecerli ve baglayicidir** ve bir "tuketici 2 yil asgarisine aykirilik" sorunu dogurmaz; ancak bu 24 ay bir tuketici hakki gibi degil, **akdi/ticari garanti** olarak sunulmalidir (kesin sure/kapsam ureticinin/distributorun datasheet/teklifi ile teyit edilmeli). Iki onemli not: **(a)** alici istisnaen **tuketici** sayilirsa (sahis, ticari amac disi kullanim) 6502 rejimi devreye girer ve tuketici koruma sureleri uygulanir; **(b)** tacir alici **TBK m.223 / TTK m.23/1-c** uyarinca teslim aldigi cihazi olagan islerin akisina gore (acik ayipta 2 gun icinde) **muayene** ve varsa ayibi satici­ya **ihbar** etme kulfetine tabidir — sure gecirilir/ihbar yapilmazsa cihaz kabul edilmis sayilir ve ayip talebi zayiflar. Alicinin tuketici mi tacir mi oldugu satista netlestirilmeli ve garanti soylemi buna gore ayarlanmali; ikisine ayni garanti soylemi verilmemelidir.
- **Kapsam (tipik):** Uretim/malzeme kaynakli donanim arizalari. **Kapsam disi (tipik):** Fiziksel hasar, sivi/su girisi (koruma sinifi disi kullanim), yetkisiz mudahale, yanlis guc/PoE, yildirim/asiri gerilim, sarf.
- **RMA akisi:**
  1. Ariza kaydi: `Device` kimligi (seri/etiket), belirti, satis/fatura tarihi, `warrantyUntil`.
  2. Uzaktan on-teshis (Bolum 7); yazilim/eslestirme kaynakli mi donanim mi ayirt et (orn. 24s token TTL asimi bir donanim arizasi degildir → yeniden eslestir).
  3. Distributor/ureticinin RMA numarasi al; kargolama/degisim/onarim yontemini belirle. **PENETEK icin yurt-ici servis yoksa geri-gonderim downtime'ini (haftalar) hesaba kat** (bkz. 5.2).
  4. Cihaz degistiginde sistemde **yeni cihazi yeniden eslestir** (yeni slot/pairCode); eski cihazi emeklilige al (token gecersiz kilinir).
- **Satici/bayi yukumlulukleri:** Dogru garanti kaydini isle (`warrantyUntil`); TR fatura ver — fatura/garanti/akdi garanti belgesindeki **marka/model teslim edilen cihazla birebir eslesmeli** (PENETEK model kodu/boyut teyidi kritik); alici istisnaen tuketiciyse 6502 kapsamindaki garanti belgesi/kullanim kilavuzu de saglanmali; RMA'da mudahale/ikame surelerini takip et; kiralik (`rented`) cihazlarda saha degisim SLA'sini sozlesmede tanimla; AEEE geri alim yukumlulugunu bildir (Bolum 9).

---

## 9. Regulasyon ve uyumluluk

> Turkiye AB Gumruk Birligi kapsaminda AB teknik mevzuatini ulusal mevzuata aktarmistir. Asagida cihaza ozel yukumlulukler ozetlenmistir; **her yonetmelik numarasi/tarihi ve esigi resmi kaynaktan (Resmi Gazete / ilgili Bakanlik) teyit edilmelidir.**

### 9.1 CE isareti (zorunlu)
- KDS/Bar ekrani elektronik cihazdir → Turkiye pazarina arz icin **CE** isareti tasimasi zorunludur. Cihaz uzerinde marka/model acikca gorunmelidir.
- **LVD (Alcak Gerilim):** AB Alçak Gerilim Yonetmeligi (2014/35/AB; AC 50–1000 V, DC 75–1500 V) TR'ye "Belirli Gerilim Sinirlari Icin Tasarlanan Elektrikli Ekipman ile Ilgili Yonetmelik (2014/35/AB)" olarak aktarilmistir (Resmi Gazete 2.10.2016; yetkili: Sanayi ve Teknoloji Bakanligi). AC 100–240 V adaptor bu kapsamdadir. (Not: 24 V DC/PoE besleme LVD alt sinirinin altinda kalabilir, ancak sebeke adaptoru kapsam icindedir.)
- **EMC (Elektromanyetik Uyumluluk):** AB EMC Yonetmeligi (2014/30/AB) TR'ye "Elektromanyetik Uyumluluk Yonetmeligi (2014/30/AB)" olarak aktarilmistir (Resmi Gazete 2.10.2016, sayi 29845; yetkili: Sanayi ve Teknoloji Bakanligi). Mutfakta motor/kompresor kaynakli parazit ortaminda EMC onemlidir.
- **AB Uygunluk Beyani (DoC):** Ithalatci, ureticinin yukumluluklerini yerine getirdigini ve CE'yi dogrulamali; **uygunluk beyani/teknik dosya kopyasini urun piyasaya arzindan itibaren 10 yil (AB rejiminde standart — resmi kaynaktan teyit edilmeli) saklamali** ve talep halinde yetkili kuruma sunmalidir.

### 9.2 IP koruma sinifi (mutfak hijyeni / islak ortam / buhar)
- IP kodu **IEC/TS 60529** kapsaminda tanimlanir. **IP65** = 6 (toza tam sizdirmaz) + 5 (her yonden su jetine dayanikli). **IP55** = 5 (toza karsi korumali) + 5 (su jeti).
- **PENETEK on panel IP65** → yıkanabilir/buharlı hatta yakin (kesin deger teyide bagli). **Sunmi:** kesin IP sinifi modele/varyanta gore degisir ve **resmi Sunmi datasheet'inden teyit edilmelidir**; teyit edilmeden urun aciklamasinda/sozlesmede "sizdirmaz govde / su jetine dayanikli / IP65" gibi vaatler verilmemelidir. **Onemli hukuki risk:** mesafeli satis/tuketici hukukunda gercege aykiri veya asiri dayaniklilik vaadi (orn. gercekte IP54 olan cihaza IP65 demek) **yaniltici ticari uygulama** sayilabilir → gercek IP degerini datasheet'ten teyit et ve urun sayfasi/sozlesmede birebir yaz. **(resmi kaynaktan teyit edilmeli)**
- IP sinifi yalnizca ilgili yuzey (on panel) icin gecerli olabilir; arka govde farkli olabilir (PENETEK arka ~IP54) → temizlikte buna dikkat.

### 9.3 PoE elektrik guvenligi ve topraklama
- PoE **IEEE 802.3af (Type 1, ~15.4 W PSE / ~12.95 W PD)** ve **802.3at/PoE+ (Type 2, ~30 W PSE / ~25.5 W PD)** standartlarina uygun PSE (switch/injektor) ile beslenmelidir. Guc butcesi PD ihtiyacini karsilamalidir (Bolum 4); cihaz-spesifik PoE destegi/sinifi **(resmi kaynaktan teyit edilmeli)**.
- Elektrik guvenligi icin **topraklama sarttir**; PoE switch/injektor ve pano hatti topraklanmali, kacak akim korumasi (RCD) bulunmalidir. Bu hem can guvenligi hem EMC/parazit acisindan gereklidir **(tesisat Elektrik Ic Tesisleri Yonetmeligi / TSE'ye uygun — resmi kaynaktan teyit edilmeli)**.

### 9.4 Isil / nem calisma araligi
- Cihaz, ureticinin belirttigi **calisma sicakligi ve nem araligi** icinde kullanilmalidir; mutfagin sicak/nemli bolgesinde bu sinirlar asilabilir. Kesin degerler **urun datasheet'inden teyit edilmeli**; fansiz (PENETEK) ve dayanikli tasarim bu ortam icin secilmistir, ancak pisirme yuzeyine bitisik asiri isi bolgelerinden kacinilmalidir.

### 9.5 AEEE / WEEE (elektronik atik) ve RoHS
- **AEEE mevzuati:** Ilk metin ("Atik Elektrikli ve Elektronik Esyalarin Kontrolu Yonetmeligi") Resmi Gazete **22 Mayis 2012, No. 28300** ile yayimlanmistir; ANCAK bu **yururlukteki metin degildir** — yururlukteki metin **"Atik Elektrikli ve Elektronik Esyalarin Yonetimi Hakkinda Yonetmelik"**tir (Resmi Gazete 26.12.2022, sayi 32055; yetkili: Cevre, Sehircilik ve Iklim Degisikligi Bakanligi) ve 2012 tarih 28300 sayili "Kontrolu" yonetmeliginin yerine gecmistir. Genisletilmis uretici sorumlulugu geregi **"uretici" tanimi kendi markasiyla piyasaya sureni ve ithal edeni kapsar** → HummyBox gibi kendi markanla satmak seni bu yonetmelik anlaminda **uretici** yapar. Uretici/ithalatci; kayit yaptirmali, uretici kayit numarasi almali, yillik bildirim ile toplama/geri donusum yukumluluklerini yerine getirmelidir.
- **Kayit portali (duzeltme):** Elektronik esya uretici/ithalatci kaydi **ÜTS uzerinden DEGIL** (ÜTS tibbi cihaz/kozmetik icindir), Cevre Bakanligi'nin **EEE Uretici Kayit Sistemi**ne yapilir ve tum bildirim islemleri **Entegre Cevre Bilgi Sistemi (EÇBS, ecbs.cevre.gov.tr)** uzerinden yurutulur (Resmi Gazete 26.12.2022, sayi 32055). Not: **GEKAP (Geri Kazanim Katilim Payi) AYRI bir mali yukumluluktur** ve beyani EÇBS'ye degil **GIB'e (vergi dairesi)** verilir.
- Cihaz uzerinde **ustu cizili tekerlekli cop kutusu (AEEE)** simgesi bulunmali; urun ayri toplama kapsamindadir. Bayi/satici, kullanicilara geri alim/toplama yukumlulugunu bildirmelidir.
- **RoHS benzeri:** Elektrikli/elektronik esyada bazi zararli maddelerin sinirlandirilmasina iliskin TR yonetmeligi **(RoHS karsiligi — numara/tarih resmi kaynaktan teyit edilmeli)** gecerlidir; CE kapsaminda beyan edilir.
- **Ithalat/piyasaya arz:** Elektronik esya ithalat/piyasaya arz surecinde ilgili kayit ve ithalat denetim tebligleri **(guncel teblig resmi kaynaktan teyit edilmeli)** uygulanir.

### 9.6 TSE ve mali (fiscal) kapsam
- **TSE:** CE mevcutsa TSE zorunlu olmayabilir; ancak bazi kamu/ozel ihalelerde TSE/TSEK istenebilir **(teyit edilmeli)**.
- **Mali kapsam:** KDS/Bar ekrani **ÖKC/yazarkasa (Odeme Kaydedici Cihaz) DEGILDIR**, mali bellek/GIB onayli cihaz kapsamina girmez, fiş kesmez ve GMP-3 "fiscal_coupled" akisinin bir parcasi degildir (bu akis ÖKC/yazarkasa cihazina ozgudur; KDS `Device.kind=kds_screen/bar_screen`, cloud-direct `bridgeId=null` olarak onun disindadir). Ekrandaki "bilgi/mutfak fişi" mali belge degildir. Mali fiş yalnizca onayli ÖKC'den, e-Fatura/e-Arsiv ise ayri mali entegrasyondan uretilir. Bu ayirim satista musteriye **net anlatilmalidir** ("mutfak ekrani mali cihaz degildir; fiş yazarkasadan kesilir") — yaniltici "yazarkasa/fiş cihazi" pazarlamasindan kacinilmalidir, cunku bu ÖKC mevzuati (mali onay, TSM vb.) yukumlulugu dogurur.

---

## 10. KVKK ve veri gizliligi

- **Uygulanan mevzuat:** 6698 sayili Kisisel Verilerin Korunmasi Kanunu (KVKK) ve ikincil duzenlemeler **(guncel metin/tebligler resmi kaynaktan teyit edilmeli)**.
- **Bu cihaz baglaminda kisisel veri riski:**
  - KDS/Bar ekrani esas olarak **siparis/urun** verisi gosterir; ancak paket/gel-al siparislerinde **musteri adi, masa/siparis referansi, adres/telefon parcasi** gibi kisisel veriler ekranda gorunebilir → **mutfak/bar personeli disinda gorunur konumlandirma yapilmamalidir** (musteriye donuk ekran yerlestirmeyin).
  - **Kamera riski:** Hem Sunmi D2s KDS (opsiyonel 2 MP) hem PENETEK (on kamera) kamera icerebilir. **Kamera kullanilmiyorsa yazilimsal olarak devre disi birak** ve fiziksel kapatma dusun; kullanilacaksa goruntu = kisisel veri → aydinlatma, hukuki sebep, saklama/silme politikasi gerekir.
  - **Ag/token:** Cihaz sha256-hash'li bearer token ile kimlik dogrular (sabit 24 saat TTL; suresi dolunca yeniden eslestirme gerekir); ham token yalnizca bir kez doner ve at-rest hash'lenir → tokeni ekrandan/paylasimli notlardan sizdirma. Emekliye ayrilan/RMA cihazin tokenini gecersiz kil.
- **Yukumlulukler:** Veri sorumlusu (restoran isletmecisi) VERBIS/aydinlatma yukumluluklerini **(kapsam/esik teyit edilmeli)** degerlendirmeli; cihazlara erisim yetkilendirilmeli; cihaz elden cikarmada (satis/RMA/imha) **veri temizligi** (Android sifirlama / Windows disk temizligi) yapilmali. Bayi, kurulumda varsayilan/paylasimli sifreleri degistirmeli ve musteriyi bu maddeler konusunda bilgilendirmelidir.

---

## 11. Satis ve devreye alma kontrol listesi

**Satis oncesi / secim**
- [ ] Ortam degerlendirildi: buhar/su/yag yogunlugu → IP65 (PENETEK) mi, Sunmi'nin teyit edilmis IP sinifi mi yeterli?
- [ ] Sunmi icin kesin IP sinifi resmi datasheet'ten yazili alindi (IP65 vaadi yok; urun sayfasinda gercek deger).
- [ ] Uygulama ekosistemi: Android (Sunmi) vs x86 Windows/Linux (PENETEK) ihtiyaci netlesti.
- [ ] Guc altyapisi: PoE switch/injektor (802.3af/at — muhtemelen 802.3at gerekir) var mi, yoksa DC priz + topraklama/RCD mi?
- [ ] PENETEK kesin model kodu + ekran boyutu (P3224-M82'nin muhtemelen 23.8" oldugu; 15.6" icin P3215/P3216-M82) distributorden **yazili** teyit alindi.
- [ ] Perakende fiyat katalog/QuoteService'ten dogrulandi (KDV %20 dahil); alis maliyeti/marj/lead-time distributor teklifiyle karsilastirildi (marj burada baglayici degil).
- [ ] Alicinin tuketici mi tacir mi oldugu netlesti; garanti soylemi buna gore ayarlandi (B2B'de akdi garanti + 6098 TBK; istisnaen tuketici ise 6502).
- [ ] PENETEK icin yurt-ici servis/RMA partneri ve downtime riski netlesti (ozellikle kiralik cihazda SLA).

**Kurulum**
- [ ] VESA/ayak montaji, goz hizasi, buhardan uzaklik.
- [ ] Cat5e/Cat6 kablolama; RJ45 kilit; STP/kablo kanali.
- [ ] PoE (Sunmi) veya DC adaptor (PENETEK) baglandi; topraklama + RCD dogrulandi; UPS onerisi uygulandi.

**Sisteme baglama**
- [ ] Slot mevcut: PayTR odemesiyle otomatik acildi VEYA admin panelden `kds_screen`/`bar_screen` slotu manuel olusturuldu.
- [ ] 6 karakterlik alfanumerik pairCode uretildi (10 dk gecerli; sube bekleyen-slot limiti asilmadi; harf+rakam kabul edildigi operatore anlatildi).
- [ ] Cihaz uygulamasi pairCode ile `POST /v1/devices/pair` → atomik claim basarili; bearer token alindi (cloud-direct, `bridgeId = null`; sabit 24s TTL — heartbeat uzatmaz).
- [ ] `Device.ownership` (sold/rented/byo) ve `warrantyUntil` dogru yazildi; kategori → istasyon eslemesi yapildi.

**Dogrulama**
- [ ] Test siparisi dogru istasyona dustu; renk/sayaç calisiyor.
- [ ] Bump → POS/garson geri bildirimi dondu.
- [ ] Baglanti kes/ac → cihaz yeniden baglandi; 24 saatten uzun kesintide token yenileme/yeniden eslestirme gerektigi not edildi.
- [ ] (Onerilir) Internet kesintisi senaryosu icin yedek kitchen_printer planlandi.

**Uyumluluk / teslim**
- [ ] CE + AEEE isaretleri cihazda mevcut; AB uygunluk beyani/garanti (akdi/ticari; tuketici ise garanti belgesi) dosyalandi; fatura/garanti belgesindeki marka-model teslim edilen cihazla birebir eslesti.
- [ ] AEEE geri alim (guncel yonetmelik + EÇBS kaydi) ve KVKK (kamera devre disi, veri temizligi, ekran konumu) maddeleri musteriye anlatildi.
- [ ] Kullanim kilavuzu + TR fatura + garanti kaydi teslim edildi; RMA iletisim kanali paylasildi.

---

### Kaynaklar
- Sunmi D2s KDS urun sayfasi ve datasheet — sunmi.com (D2s KDS; kesin IP sinifi + PoE varyanti resmi datasheet'ten teyit gerektirir)
- PENETEK Panel PC katalogu — penetek.com (P3224-M82 muhtemelen 23.8"; 15.6" icin P3215-M82 / P3216-M82; Intel J6412, IP65 on panel, fansiz — model kodu/boyut teyit gerektirir)
- Perakende fiyat: HummyTummy urun katalogu (HardwareProduct.priceCents) + checkout QuoteService (KDV %20 dahil) — tek baglayici fiyat kaynagi; alis maliyeti/marj distributor teklifine gore degisir, burada baglayici degildir
- IEEE 802.3af/at PoE guç degerleri — genel standart ozetleri (af: ~15.4 W PSE / ~12.95 W PD; at: ~30 W PSE / ~25.5 W PD)
- CE / LVD — "Belirli Gerilim Sinirlari Icin Tasarlanan Elektrikli Ekipman ile Ilgili Yonetmelik (2014/35/AB)", Resmi Gazete 2.10.2016 (Sanayi ve Teknoloji Bakanligi): https://www.resmigazete.gov.tr/eskiler/2016/10/20161002-1.htm
- CE / EMC — "Elektromanyetik Uyumluluk Yonetmeligi (2014/30/AB)", Resmi Gazete 2.10.2016, sayi 29845 (Sanayi ve Teknoloji Bakanligi): https://www.resmigazete.gov.tr/eskiler/2016/10/20161002-2.htm
- AEEE — "Atik Elektrikli ve Elektronik Esyalarin Yonetimi Hakkinda Yonetmelik", Resmi Gazete 26.12.2022, sayi 32055 (Cevre, Sehircilik ve Iklim Degisikligi Bakanligi; 2012 tarih 28300 sayili "Kontrolu" yonetmeliginin yerine). Uretici tanimi kendi markasiyla piyasaya sureni + ithal edeni kapsar; kayit EÇBS (ecbs.cevre.gov.tr) uzerinden, GEKAP beyani ise ayrica GIB'e: https://www.mevzuat.gov.tr/MevzuatMetin/yonetmelik/7.5.40055.pdf
- 6502 sayili Tuketicinin Korunmasi Hakkinda Kanun — Resmi Gazete 28.11.2013, sayi 28835 (m.3 tuketici tanimi; tuketici korumalari yalnizca B2C, tacirler arasi satista uygulanmaz): https://www.resmigazete.gov.tr/eskiler/2013/11/20131128-1.htm
- Garanti Belgesi Yonetmeligi — Resmi Gazete 13.6.2014, sayi 29029 (tuketiciye yonelik; ekindeki listeye tabi urunlerde asgari 2 yil): https://www.resmigazete.gov.tr/eskiler/2014/06/20140613-2.htm
- Ticari (B2B/tacirler-arasi) satis — 6098 sayili Turk Borclar Kanunu ayip hukumleri (m.219 satici sorumlulugu / m.221 emredici olmayan sorumsuzluk kaydi / m.223 muayene-ihbar kulfeti) + 6102 sayili TTK m.23/1-c kesin sureler (acik ayip 2 gun, gizli ayip 8 gun) + kararlastirilan akdi garanti esas
- KVKK 6698 — kvkk.gov.tr (kapsam/esik teyit gerektirir)

> Son guncelleme: 2026-07-02 - surum taslagi. Regulasyon/mali bilgiler bilgilendirme amaclidir; guncel resmi mevzuat (GIB, BKM, KVKK Kurumu, Ticaret Bakanligi, ilgili yonetmelikler) esastir.
