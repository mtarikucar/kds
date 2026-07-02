# Para Çekmecesi (Cash Drawer)

> **Belge tipi:** Cihaz (çevre birim) yönergesi — HummyTummy restoran KDS/POS platformu
> **Kapsam:** AFANDA LB-405K mekanik çelik para çekmecesi
> **Hedef kitle:** Restoran operatörü + BAYİ / satıcı
> **Önemli:** Para çekmecesinin kendine ait bir `Device.kind` değeri **yoktur**. Sistemde bağımsız bir cihaz olarak eşleştirilmez; **fiş yazıcısına (receipt_printer) bağlı** çalışan bir çevre birimidir. Sistemde çekmeceyi süren şey şubenin **varsayılan fiş yazıcısıdır** (`defaultReceiptPrinterId`); yazıcının `capabilities[]` etiketine `'cash_drawer'` eklemek yalnızca açıklayıcı metadatadır ve işlevsel bir etkisi yoktur.

---

## 1. Genel Bakış

Para çekmecesi (cash drawer), nakit tahsilatın fiziksel olarak güvenli biçimde saklandığı, satış tamamlandığında **yazıcının "çekmece tetik" (drawer-kick) sinyaliyle otomatik açılan** elektromekanik bir kasa gözüdür. İçinde elektronik bir zeka yoktur: bir **solenoid** (tetikleme gerilimi bağlı yazıcının DK portu tarafından belirlenir — yaygın değerler 12V veya 24V; bkz. Bölüm 2), RJ11/RJ12 kablosu üzerinden gelen kısa akım darbesiyle mekanik kilidi çeker ve yaylı çekmece dışarı fırlar. Kilit + çelik gövde nakdi korur; açılma yetkisini ise çekmecenin bağlı olduğu **yazıcıyı süren yazılım** belirler.

### Sistemdeki rolü

HummyTummy tarafında para çekmecesinin iki ayrı yüzü vardır — bunları karıştırmamak kritiktir:

| Kavram | Ne | Nerede yaşar |
|---|---|---|
| **Fiziksel çekmece açma (drawer-kick)** | Yazıcıya bağlı solenoidin darbeyle açılması | Varsayılan fiş yazıcısı (`defaultReceiptPrinterId`) üzerinden; Tauri POS `open_cash_drawer_via_printer` komutu veya HummyBox köprüsünün `open_drawer` komutu |
| **Nakit hareket / muhasebe kaydı** | Kasa açılış/kapanış, para giriş/çıkışı, sayım | `CashDrawerService` (backend) — `OPENING / CLOSING / CASH_IN / CASH_OUT / ADJUSTMENT` |

**Fiziksel taraf:** Çekmece, bir `receipt_printer` cihazının çevre birimi olarak modellenir. POS/masaüstü uygulamasının "Çekmeceyi Aç" aksiyonunu ve nakit ödemede otomatik açılmayı etkinleştiren şey, POS ayarlarında **varsayılan fiş yazıcısının tanımlı olması** (`defaultReceiptPrinterId`) ve ödeme yönteminin **NAKİT** olmasıdır (`frontend/src/pages/pos/posReceipt.ts` — `printerId && method === 'CASH'`). Yazıcının `capabilities[]` dizisine `'cash_drawer'` eklemek yalnızca belge/envanter amaçlı açıklayıcı bir etikettir; çalışma zamanında hiçbir kod bunu okuyup çekmeceyi etkinleştirmez veya kısıtlamaz (dizi yalnız listelenir), üstelik masaüstü yazıcının kendi bildirdiği yetenek dizesi `cash_drawer` değil `cash_drawer_control`'dür ve her ESC/POS yazıcıda zaten mevcuttur. Nakit ödeme kaydedildiğinde POS'a otomatik "yazdır + çekmeceyi aç" sinyali gider (`payments.service.ts` — "Tell the POS to auto-print + open cash drawer").

**Bağlantı yolu (drawer-kick):**
- **Cloud-direct:** POS tableti USB fiş yazıcısını doğrudan sürüyorsa → Tauri komutu `open_cash_drawer_via_printer` → `HardwareManager::open_cash_drawer` → `EscPosPrinter` → gerçek ESC/POS darbesi `ESC p m t1 t2` = baytlar `1B 70 00 19 FA`.
- **LAN + köprü:** Yazıcı HummyBox köprüsü arkasındaysa (`bridgeId` set) → bulut `open_drawer` komutunu base64 ESC/POS baytlarıyla köprüye indirir; köprü baytları yazıcıya birebir yazar. `pin` alanı (0|1) çekmece konnektör pinini seçer (2'li yazıcıda 1. ya da 2. çekmece).

**Muhasebe tarafı:** `CashDrawerService` fiziksel donanımdan bağımsızdır. Personel kasa açar (`OPENING`, otomatik onaylı), gün içi para giriş/çıkışı işler, kapanışta (`CLOSING`) Z-Raporu ile mutabakat yapar. `CASH_OUT` ve `ADJUSTMENT` hareketleri **taslak (DRAFT)** oluşur ve **ADMIN/MANAGER onayı** gerektirir; onay/ret `user_activities` denetim günlüğüne yazılır. Sayım girildiğinde sistem, girilen banknot/bozuk kırılımının (Σ nominal × adet) beyan edilen tutara eşit olmasını zorlar.

### Neden `Device.kind` yok

Para çekmecesi Mağaza'da (`/admin/store`) **satılabilir bir katalog SKU'sudur, ancak ayrı bir `Device.kind` değildir.** Kategori→cihaz eşlemesinde `cash_drawer` **provizyon edilmez** (`other`, `service` gibi). Mağazadan çekmece satın alındığında PayTR ödemesi sonrası **cihaz slotu AÇILMAZ.** Çünkü çekmecenin ağ kimliği, IP'si, token'ı yoktur — kendi başına buluta bağlanmaz; yazıcıya RJ11/RJ12 ile bağlanan bir **yazıcı çevre birimidir**. **Kurulumcu, çekmece için ayrı bir cihaz slotu AÇMAMALIDIR** — çekmeceyi devreye almak için gereken tek şey, POS ayarlarında şubenin **varsayılan fiş yazıcısını** tanımlamaktır; bağlı yazıcının `capabilities[]` dizisine `'cash_drawer'` eklemek isteğe bağlı, yalnızca açıklayıcı bir envanter etiketidir ve işlevsel bir etkisi yoktur.

---

## 2. Modeller ve Teknik Özellikler

### AFANDA LB-405K — Genel özellikler

| Özellik | Değer |
|---|---|
| Ürün tipi | Mekanik çelik para çekmecesi (elektromekanik solenoid tetikli) |
| Gövde / malzeme | Çelik sac gövde, darbeye dayanıklı |
| Tetikleme | Yazıcının çekmece-kick (DK) portundan solenoid darbesi |
| Konnektör | RJ11 / RJ12 (6P modüler; yazıcı DK portuna takılır) |
| **Solenoid gerilimi** | **Listelenen değer 12V** (kaynak: Trendyol ürün adı "…RJ11 12V"). Kesin gerilim, satın alınan partinin etiketi/datasheet'inden ve eşleşeceği yazıcının DK çıkış geriliminden **birim bazında teyit edilmeli** (resmi kaynaktan teyit edilmeli) |
| Banknot gözü | Kaynakta yalnızca "5 bölmeli" ibaresi var; banknot/bozuk göz ayrımı doğrulanmadı — ürün/parti datasheet'inden teyit edilmeli (resmi kaynaktan teyit edilmeli) |
| Bozuk para gözü | Kaynakta ayrı bozuk-para gözü sayısı doğrulanmadı (madeni-para göz figürü desteksiz) — teyit edilmeli (resmi kaynaktan teyit edilmeli) |
| Kilit | Mekanik anahtarlı kilit (manuel açış + kapalı-mod) |
| Açılış | Yaylı (darbede otomatik dışarı çıkar) |
| Kendi güç kaynağı | Yok — gücünü yazıcının DK portundan alır (harici adaptör gerekmez) |
| Ağ / IP / firmware | Yok (pasif çevre birim) |
| Garanti | Bkz. Bölüm 8 (alıcı tipine göre değişir; kural olarak ticari/B2B — teyit edilmeli) |
| Perakende fiyat | Güncel perakende fiyat **katalogdan** gelir (`HardwareProduct.priceCents` + checkout `QuoteService`, KDV %20 dahil); alış maliyeti ve marj distribütör teklifine göre değişir, burada bağlayıcı değildir (Bölüm 5) |

### ⚠ Kritik uyumluluk notu: solenoid gerilimi

ESC/POS "drawer-kick" darbesi RJ11/RJ12 kablo üzerinden gönderilir. Para çekmecesi **pasif bir solenoiddir**; darbe gerilimini çekmecenin kendisi değil, **bağlı olduğu yazıcının DK (drawer-kick) portu çıkışı** belirler. Piyasadaki yaygın değerler **12V ve 24V**'tir ve çekmece solenoid gerilimi ile yazıcının DK portu çıkış gerilimi **birbiriyle eşleşmelidir**:
- Yazıcı 24V veriyor + çekmece 12V ise → solenoid zorlanır/ısınır, ömrü kısalır.
- Yazıcı 12V veriyor + çekmece 24V ise → darbe kilidi çekmeye yetmez, **çekmece açılmaz**.

**Bu belgenin dayandığı birebir kaynak (Trendyol ürün listesi), AFANDA LB-405K modelini "RJ11 12V" olarak listelemektedir; yani listelenen birim 12V'tir.** Bu nedenle çekmece için tek bir gerilim "sistem varsayımı" olarak sabitlenmemeli; **kesin değer, satın alınan partinin etiketinden/datasheet'inden ve eşleşeceği yazıcı modelinin DK çıkış geriliminden birim bazında teyit edilmelidir (resmi kaynaktan teyit edilmeli).** Bayi, satıştan önce yazıcı–çekmece gerilim eşleşmesini doğrulamalıdır.

### Pin/darbe teknik detayı (yazılım tarafı, kod ile doğrulanmış)

| Parametre | Değer | Açıklama |
|---|---|---|
| ESC/POS komutu | `ESC p m t1 t2` | Standart çekmece açma darbesi |
| Ham baytlar (kod) | `1B 70 00 19 FA` | m=0 (pin 2 seçimi), t1=25, t2=250 |
| On süresi | ~50 ms (25 × 2 ms) | Solenoide akım verilen süre |
| Off süresi | ~500 ms (250 × 2 ms) | Darbeler arası bekleme |
| Köprü `pin` alanı | 0 veya 1 | Çift çekmeceli yazıcıda 1./2. çekmece portu (0→pin2, 1→pin5) |

---

## 3. Kullanım / Operasyon (Günlük Senaryo)

**Vardiya açılışı**
1. Kasiyer POS'ta oturum açar.
2. Kasa açılışı yapılır: HummyTummy'de `OPENING` hareketi girilir (açılış nakdi/kırılım). Otomatik **APPROVED** olur; personel kimliği izin bırakır.
3. Fiziksel çekmece anahtarla "çalışır" (kilitli-açık) moda alınır ki darbe onu açabilsin.

**Satış sırasında (nakit ödeme)**
4. Sipariş "Ödemeye Geç" → **NAKİT** seçilir.
5. Ödeme kaydedilince POS otomatik olarak fiş yazdırma + **çekmece açma** komutunu tetikler; solenoid darbelenir, çekmece açılır.
6. Kasiyer parayı yerleştirir / para üstünü verir, çekmeceyi **elle kapatır** (yaylı kilit oturur).
7. Kart ödemelerde çekmece normalde açılmaz (nakit yönetimi gerekmez); yalnız para üstü/bozuk için manuel "Çekmeceyi Aç" aksiyonu kullanılabilir.

**Gün içi para hareketleri**
8. Kasadan para çıkışı (tedarikçi ödemesi, personel avansı vb.) → `CASH_OUT` girilir → **DRAFT** oluşur → ADMIN/MANAGER **onaylamadan** Z-Raporu mutabakatına girmez.
9. Kasaya para eklenmesi → `CASH_IN` (otomatik onaylı).
10. Manuel düzeltme → `ADJUSTMENT` → DRAFT → yönetici onayı (en yüksek suistimal vektörü olduğu için).

**Vardiya kapanışı**
11. Fiziksel sayım yapılır; banknot/bozuk kırılımı girilir. Sistem **Σ(nominal × adet) = tutar** eşitliğini zorlar; tutmuyorsa 400 hata verir ("yeniden say").
12. `CLOSING` hareketi + Z-Raporu ile beklenen–sayılan nakit mutabakatı yapılır (yalnız APPROVED hareketler mutabakata katılır).
13. Çekmece anahtarla **kilitli** moda alınır ve mesai sonu boşaltılır.

> **Not:** "Bilgi fişi" mali belge değildir. Çekmece açma darbesi mali bir olay değildir; **mali fiş yalnız onaylı ÖKC/yazarkasadan** kesilir. Çekmece sadece nakdin fiziksel muhafazasıdır.

---

## 4. Kurulum ve Sisteme Bağlama

### 4.1 Fiziksel kurulum

1. Çekmeceyi kasiyer tezgâhının altına, çekmece rahatça açılacak boşlukta konumlandırın (üstüne yazıcı/monitör baskısı gelmeyecek şekilde).
2. **RJ11/RJ12 kablosunu** çekmecenin arkasındaki soketten, **fiş yazıcısının "DK" (drawer kick / cash drawer) portuna** takın.
   - ⚠ DK portunu **ağ (RJ45/LAN) portuyla karıştırmayın**; fiziksel olarak benzer görünür ama farklıdır. RJ11/RJ12 6P konnektör DK portuna, RJ45 8P LAN portuna gider. Yanlış porta takmak yazıcıya zarar verebilir.
3. Anahtarı "açık/çalışır" moduna alın (darbenin açabilmesi için).
4. Çekmecenin kendi güç kaynağı yoktur; gücü DK portundan alır.

### 4.2 Sisteme tanıtım — çekmecenin kendisi eşleştirilmez

Para çekmecesi buluta bağlanmaz, **pairCode almaz, `POST /v1/devices/pair` çağırmaz, provizyon edilmez, kendi cihaz slotu açılmaz.** Çekmeceyi HummyTummy'ye "tanıtmak", **bağlı olduğu yazıcıyı** doğru capability ile yapılandırmaktan ibarettir:

1. **Yazıcı zaten sistemdeyse:** POS ayarlarında şubenin **varsayılan fiş yazıcısını** (bu yazıcıyı) seçin — "Çekmeceyi Aç" aksiyonunu ve nakit ödemede otomatik açılmayı sağlayan gerçek koşul budur. İsteğe bağlı olarak o `receipt_printer` cihazının `capabilities[]` dizisine `'cash_drawer'` etiketini ekleyebilirsiniz (örn. `['print_80mm','cash_drawer']`); bu yalnızca açıklayıcı/envanter amaçlı bir etikettir, çalışma zamanında çekmeceyi açan/kısıtlayan bir kod bunu okumaz.
2. **Yazıcı henüz sistemde değilse — yazıcının eşleştirilmesi (gerçek akış):**
   - Admin panelde (`/admin/branches/:id` → Cihazlar) **fiş yazıcısı için** bir cihaz slotu oluşturulur → 6 karakterli alfanumerik ([A-Z0-9]) **pairCode** üretilir (**10 dk geçerli**, şube başına en çok **10 bekleyen** slot).
   - Yazıcı/köprü uygulaması bu pairCode ile `POST /v1/devices/pair` çağırır → **tek-kullanımlık atomik claim** → sha256-hash'li **bearer token** döner (varsayılan **24 saat TTL** — `DEVICE_TOKEN_TTL_MS`; token YALNIZCA pair anında verilir). `heartbeat()` yalnız `status` ve `lastSeenAt` günceller, `tokenExpiresAt`'e **dokunmaz** — yani TTL kaymaz/uzamaz (kayan TTL değildir); token pair'den 24 saat sonra dolar ve süresi dolan token `authenticateToken` tarafından reddedilir. Main/prod dalında token yenileme (refresh) **yoktur**; bu yüzden cihaz devam edebilmek için **yeniden pair** olmalıdır (yeni 6 karakterli pairCode). Ham token yalnız bir kez döner; at-rest hash'lenir.
   - POS ayarlarında bu yazıcıyı şubenin **varsayılan fiş yazıcısı** olarak seçin (çekmeceyi etkinleştiren gerçek koşul budur). İsteğe bağlı: yazıcı yapılandırmasında `cash_drawer` capability etiketini işaretleyin — yalnızca açıklayıcı metadata, işlevsel etkisi yoktur.

### 4.3 Köprü mü, cloud-direct mi?

Bu, **çekmecenin bağlı olduğu yazıcının** topolojisine göre belirlenir — çekmece hep yazıcının bağlantısını miras alır:

| Yazıcı topolojisi | Çekmece nasıl açılır | bridgeId |
|---|---|---|
| **Cloud-direct** — POS tableti USB fiş yazıcısını Tauri ile sürüyor | Tauri `open_cash_drawer_via_printer` → ESC/POS darbesi | null |
| **LAN + HummyBox köprüsü** — yazıcı köprü arkasında (TCP 9100 / seri) | Bulut `open_drawer` komutunu base64 ESC/POS baytlarıyla köprüye indirir; köprü baytları yazıcıya yazar | set |

> LAN fiş yazıcıları tipik olarak **HummyBox köprüsü arkasında** çalışır (WSS heartbeat + SQLite offline kuyruk + ESC/POS sürücüsü). Çekmece bu durumda köprü→yazıcı→çekmece zinciriyle açılır.

### 4.4 Doğrulama

- POS'ta bir test nakit ödemesi (veya "Çekmeceyi Aç" aksiyonu) ile çekmecenin **fiziksel açıldığını** görün.
- Açılmıyorsa: kablo/DK portu, gerilim eşleşmesi (Bölüm 2 uyarısı), yazıcının çevrimiçiliği ve capability etiketi sırayla kontrol edilir (Bölüm 7).

---

## 5. Tedarik ve Sağlayıcı

| Kalem | Bilgi |
|---|---|
| Üretici / marka | AFANDA (Türkiye pazarında yaygın POS çevre birimi markası) |
| Model | LB-405K (5 bölmeli, RJ11) |
| Türkiye kanalı | AFANDA Türkiye ve yetkili POS/yazarkasa bayileri; pazaryeri listeleri (Trendyol, n11, Hepsiburada vb.) |
| Perakende fiyat | Tek yetkili kaynak **katalog** (`HardwareProduct.priceCents` + checkout `QuoteService`, KDV %20 dahil); alış maliyeti ve marj distribütör teklifine göre değişir, burada bağlayıcı değildir |
| Garanti | Bkz. Bölüm 8 (alıcı tipine göre; kural olarak ticari/B2B — teyit edilmeli) |
| Tedarik süresi | Stok ürünü; bayi stokundan hızlı temin — **kesin süre distribütörden teyit edilmeli** (resmi kaynaktan teyit edilmeli) |

### Fiyat ve marj — tek yetkili kaynak katalog

Para çekmecesi Mağaza'da (`/admin/store`) satılabilir bir katalog SKU'sudur. **Güncel perakende fiyatın tek yetkili kaynağı katalogdur** (`HardwareProduct.priceCents` + checkout `QuoteService`; fiyat KDV %20 dahil hesaplanır). Bu belge bağlayıcı bir satış fiyatı veya marj tablosu dayatmaz: **alış maliyeti ve marj distribütör teklifine göre değişir ve burada bağlayıcı değildir** (resmi kaynaktan/yetkili distribütörden teyit edilmeli). Çekmece genelde tek satılmaz; **yazıcı + çekmece + kablo paketi** olarak konumlandırmak müşteri memnuniyetini artırır ve satıştan önce yazıcı–çekmece DK gerilim eşleşmesini doğrulamayı kolaylaştırır.

### Alternatif kaynak
- Aynı sınıf muadiller: farklı markalarda 4/5 bölmeli RJ11/RJ12 çelik çekmeceler mevcuttur. Seçerken **kritik kriter, yazıcının DK portu ile gerilim/pin uyumudur** (Bölüm 2), marka değil. Muadil tedarik ederken solenoid gerilimini birim üzerinden doğrulayın.

---

## 6. Bakım ve Sarf Malzeme

**Sarf malzemesi yoktur.** Para çekmecesinde kağıt/rulo, pil veya toner **bulunmaz** (bunlar yazıcının sarfıdır; çekmecenin değil). Pasif elektromekanik bir üründür.

**Periyodik bakım / temizlik:**
- **Aylık:** Ray ve yay mekanizmasını toz/nakit tozundan temizleyin; takılma/gıcırtı varsa raylara ince makine yağı (az miktar) uygulayın. Bölmelerdeki bozuk para tozunu silin.
- **Her kapanış:** Çekmeceyi tamamen boşaltın ve kilitli bırakın; para altında kalan bozuk para açılmayı engelleyebilir.
- **Kablo:** RJ11/RJ12 kablosunda ezilme/gevşeme kontrolü. Zamanla en sık arıza kaynağı konnektör oynamasıdır.
- **Solenoid/kilit:** Anahtarlı kilitte zorlanma varsa grafit tozu ile yağlama; asla nem/su ile temas ettirmeyin.

**Firmware/güncelleme:** Yoktur — çekmecede yazılım yoktur. Davranışı belirleyen yazılım, bağlı olduğu **yazıcı sürücüsü** ve HummyTummy POS/köprü tarafındadır; güncellemeler o kanaldan gelir.

---

## 7. Sorun Giderme ve Arıza

| Belirti | Olası neden | Çözüm |
|---|---|---|
| Çekmece **hiç açılmıyor** | Kablo DK portuna takılı değil / LAN portuna takılı | Kabloyu doğru **DK (drawer-kick)** portuna tak; RJ45'ten ayırt et |
| Çekmece açılmıyor, yazıcı çalışıyor | **Gerilim uyuşmazlığı** (yazıcı DK çıkışı ile çekmece solenoidi farklı — örn. 12V/24V) | Yazıcı DK çıkış gerilimi ile çekmece solenoid gerilimini eşleştir (Bölüm 2) |
| Açılmıyor + POS "başarılı" diyor | POS ayarlarında **varsayılan fiş yazıcısı tanımlı değil** ya da ödeme yöntemi NAKİT değil (çekmece açma yalnız `printerId && method === 'CASH'` ile tetiklenir) | POS ayarlarında şubenin varsayılan fiş yazıcısını tanımla; ödemenin NAKİT olduğunu doğrula |
| Çift çekmeceli yazıcıda yanlış çekmece açılıyor | `pin` (0/1) yanlış | Köprü komutunda doğru `pin` değerini ayarla |
| Anahtarla açılıyor, darbeyle açılmıyor | Anahtar "kilitli" modda | Anahtarı "çalışır/açık" moda al |
| Kilit takılıyor / çekmece sürtüyor | Ray tozu, aşırı dolu, yay zayıflaması | Temizle-yağla; aşırı doldurma; yay/ray hasarında servis |
| Solenoid tık sesi var ama açılmıyor | Zayıf darbe / solenoid yorgunluğu / mekanik takılma | Darbe süresini/gerilimi kontrol et; mekanik takılmayı gider; kalıcıysa RMA |
| Köprü arkasında açılmıyor | Yazıcı offline / köprü heartbeat yok / yazıcı token'ı dolmuş | Köprü ve yazıcı çevrimiçiliğini kontrol et (WSS + TCP 9100); token süresi dolduysa yazıcıyı yeniden pair et (Bölüm 4.2) |
| Kablo oynatınca çalışıyor | Konnektör gevşemesi / kablo arızası | RJ11/RJ12 kablosunu değiştir |

**Ne zaman RMA:** Kablo/gerilim/yapılandırma elendikten sonra da **solenoid darbeye tepki vermiyorsa**, kilit mekanizması kırıksa, gövde/ray fiziksel hasarlıysa → garanti kapsamında değişim/onarım için RMA (Bölüm 8). Kablo ucuz bir sarf gibi ele alınır; önce kabloyu değiştirin.

---

## 8. Garanti ve RMA Süreci

> **Garanti süresi — kural olarak ticari (B2B) satış:**
> - **Kural — ticari alıcı (restoran işletmesi / tacir):** Mağaza (`/admin/store`) üzerinden restoran işletmesine yapılan POS çevre birimi satışı **kural olarak ticari (B2B) satıştır** (satıcı: HummyTummy/bayi, alıcı: tacir). 6502 sayılı Tüketicinin Korunması Kanunu (Resmi Gazete 28.11.2013, sayı 28835) m.3'e göre tüketici "ticari veya mesleki olmayan amaçlarla hareket eden gerçek veya tüzel kişi"dir; restorana yapılan satış ticari amaçlı olduğundan bu satış **B2B'dir**. Bu durumda 6502 sayılı Kanun'un ayıplı mal / tüketici koruma hükümleri ve **Garanti Belgesi Yönetmeliği'nin (Resmi Gazete 13.6.2014, sayı 29029)** tüketici ürünleri için öngördüğü asgari süreler **uygulanmaz**; ayıp/garanti ilişkisine **6098 sayılı Türk Borçlar Kanunu (TBK)** ayıp hükümleri (m.219 — satıcı ayıptan sorumlu) ve **tarafların kararlaştırdığı garanti süresi** uygulanır. TBK'nın ayıp hükümleri emredici değildir (m.221'deki ağır kusur hâli hariç, sorumsuzluk/kısıtlama kaydı geçerlidir). Bu nedenle üreticinin/bayinin verdiği **12 veya 24 aylık garanti B2B'de geçerli ve bağlayıcıdır**; hangi sürenin geçerli olduğu satıcının **garanti belgesinden/faturasından** okunur. Tacir alıcı, **TBK m.223 uyarınca malı teslim aldığında gözden geçirme (muayene) ve ayıbı süresinde satıcıya ihbar külfetine** tabidir; ayrıca tacirler arası satışta **TTK m.23/1-c'nin kesin süreleri** işler (açık ayıpta 2 gün, gizli ayıpta 8 gün içinde inceleyip ihbar); süresinde ihbar edilmeyen ayıp bakımından hak kaybı doğar.
> - **İstisna — tüketici alıcı (ticari/mesleki amaç dışı gerçek kişi):** Alıcı istisnaen tüketici sayılırsa (ürünü ticari/mesleki amaç dışında edinen kişi), 6502 sayılı Kanun ve Garanti Belgesi Yönetmeliği (Resmi Gazete 13.6.2014, sayı 29029) devreye girer; yönetmelik ekindeki listeye tabi ürünlerde tüketici lehine **asgari 2 yıl** yasal garanti uygulanır (bu ürünün yönetmelik eki listeye tabi olup olmadığı resmi kaynaktan teyit edilmeli).
>
> Bu belge tek bir garanti süresini normatif olarak dayatmaz; **kural B2B (tacir) satıştır, tüketici hali istisnadır** ve hangi sürenin geçerli olduğu her hâlde garanti belgesinden okunmalıdır.

| Kalem | Değer |
|---|---|
| Garanti süresi | Alıcı tipine göre (yukarı) — kural olarak ticari/B2B (6502 m.3, Resmi Gazete 28.11.2013 sayı 28835), üreticinin 12 veya 24 aylık ticari garantisi geçerli ve bağlayıcı; hangi sürenin geçerli olduğu garanti belgesinden okunur |
| Kapsam | Üretim/malzeme kaynaklı solenoid, kilit, ray, gövde arızaları |
| Kapsam dışı | Yanlış gerilimli yazıcıya bağlamaktan doğan solenoid yanması, fiziksel darbe/sıvı hasarı, aşırı dolduruma bağlı mekanik kırılma, kullanıcı kaynaklı kablo hasarı |

**RMA akışı (bayi için):**
1. Sorun giderme (Bölüm 7) tamamlanır; arıza kablo/gerilim/yapılandırma dışı doğrulanır.
2. Satış belgesi + arıza tarifi ile bayi/distribütöre başvurulur; ürün fiziksel iade edilir.
3. Distribütör inceleme sonrası onarım veya **değişim** sağlar.
4. **Satıcı yükümlülükleri:** doğru gerilim eşleşmesini satıştan önce doğrulamak, uyumlu kablo/porta dair kurulum bilgisi vermek, garanti belgesi/fatura ile teslim etmek, garanti içi arızalarda makul sürede değişim sağlamak. Kural olarak ticari alıcıda TBK ayıp hükümleri (m.219/m.223) ve tarafların kararlaştırdığı garanti süresi geçerlidir (alıcı muayene/ihbar külfetine tabidir; tacirler arası satışta TTK m.23/1-c'nin 2 gün / 8 gün kesin süreleri işler); alıcı istisnaen tüketici ise 6502 sayılı Kanun (Resmi Gazete 28.11.2013, sayı 28835) ve Garanti Belgesi Yönetmeliği'nin (Resmi Gazete 13.6.2014, sayı 29029) ayıplı mal/yasal garanti hakları saklıdır (**bu ürünün yönetmelik eki listeye tabi olup olmadığı ve güncel koşullar resmi kaynaktan teyit edilmeli**).

---

## 9. Regülasyon ve Uyumluluk

- **Mali statü:** Para çekmecesi **mali cihaz değildir.** Fiş kesme, KDV hesaplama, mali hafıza işlevi yoktur; 3100 sayılı Kanun ve VUK kapsamındaki ÖKC/YN-ÖKC onay-ruhsat rejimi yazarkasaya ilişkindir, çekmece bu zincirin dışındadır. Mali fiş yalnız onaylı **ÖKC/yazarkasadan** kesilir; çekmece bu zincirin dışında, yalnız nakdin fiziksel muhafazasıdır. Bu nedenle **ÖKC ruhsat/onay mevzuatına tabi değildir** (GMP-3 vb. yalnızca fiskal cihaz/entegrasyonu ilgilendirir, çekmeceyi değil; genel doğruluğu değiştirmese de resmi kaynaktan teyit edilebilir).
- **CE işareti:** Ürün elektromekanik bir solenoid içerir, ancak **12/24V solenoid Alçak Gerilim Yönetmeliği (LVD, 2014/35/AB) kapsamına GİRMEZ** — LVD yalnızca 50–1000V AC / 75–1500V DC aralığını kapsar; çekmecenin çalışma gerilimi bu eşiğin altındadır. Dolayısıyla CE gerekçesi "düşük gerilim" değildir. LVD'nin Türkiye karşılığı, Sanayi ve Teknoloji Bakanlığı'nın "Belirli Gerilim Sınırları İçin Tasarlanan Elektrikli Ekipman ile İlgili Yönetmelik (2014/35/AB)"dir (Resmi Gazete 2.10.2016). Buna karşılık **EMC Yönetmeliği (elektromanyetik uyumluluk)** gerilim eşiğinden bağımsız uygulanabilir — "Elektromanyetik Uyumluluk Yönetmeliği (2014/30/AB)" (Resmi Gazete 2.10.2016, sayı 29845) — ve **RoHS/EEE (zararlı madde)** yönünden uygunluk gerekebilir — "Elektrikli ve Elektronik Eşyalarda Bazı Zararlı Maddelerin Kullanımının Kısıtlanmasına İlişkin Yönetmelik" (Resmi Gazete 26.12.2022, sayı 32055). Bayi, varsa CE beyanını/etiketini **EMC/RoHS** yönünden teyit etmelidir (bu ürün için beyanın/işaretin fiili varlığı ve kapsamı resmi kaynaktan teyit edilmeli).
- **TSE / uygunluk:** İthal/yerli elektronik çevre birimlerinde ilgili uygunluk işaretlerinin bulunması beklenir; kesin zorunluluk ürün sınıfına göre değişir (resmi kaynaktan teyit edilmeli).
- **AEEE / WEEE (elektronik atık):** Ürün solenoid + kablo içerdiğinden **elektrikli-elektronik ekipman** sayılması makuldür; ancak asli işlevi mekanik olduğundan sınıflandırmada sınırdadır (borderline). Güncel referans, Çevre, Şehircilik ve İklim Değişikliği Bakanlığı'nın **"Atık Elektrikli ve Elektronik Eşyaların Yönetimi Hakkında Yönetmelik"idir** (Resmi Gazete 26.12.2022, sayı 32055; 2012 tarih 28300 sayılı eski "Kontrolü" yönetmeliğinin yerine geçmiştir). Bu kapsamda ürün/ambalaj üzerinde "üzeri çizili çöp kutusu" işareti ve ömür sonu **yetkili elektronik atık toplama** yükümlülüğü söz konusu olabilir. Genişletilmiş üretici sorumluluğu bakımından yönetmeliğin **"üretici" tanımı, ürünü kendi markasıyla piyasaya süreni ve ithal edeni de kapsar** — yani çekmeceyi kendi markanızla (örn. HummyBox) satmak sizi bu yönetmelik anlamında üretici konumuna getirebilir. Üretici/ithalatçı; Çevre Bakanlığı **EEE Üretici Kayıt Sistemi'ne kayıt**, üretici kayıt numarası alma, yıllık bildirim ve toplama/geri dönüşüm yükümlüsüdür ve bu işlemler **EÇBS (Entegre Çevre Bilgi Sistemi, ecbs.cevre.gov.tr)** üzerinden yürütülür. Kesin kapsam, işaret ve üretici kaydı yükümlülüğünün bu ürüne uygulanışı ilgili yönetmelik ve üretici kaydı üzerinden **teyit edilmelidir** (bu ürünün kapsama girip girmediği resmi kaynaktan teyit edilmeli); bayi, kullanıcıyı ürünü evsel atıkla atmaması ve yetkili toplama noktasına vermesi konusunda bilgilendirmelidir.
- **RJ11/RJ12 gerilim uyumu:** Regülasyondan çok **elektriksel güvenlik/uyum** konusudur: çekmece solenoid gerilimi ile yazıcının DK portu çıkış gerilimi eşleşmelidir (Bölüm 2). Uyumsuzluk hem işlev kaybına hem donanım hasarına yol açar.

---

## 10. KVKK ve Veri Gizliliği

- **Çekmecenin kendisi kişisel veri işlemez.** İçinde yazılım, hafıza, ağ, kamera yoktur; yalnız nakit saklar. Doğrudan KVKK yükümlülüğü doğurmaz.
- **Dolaylı kişisel veri, muhasebe tarafındadır:** Nakit hareketleri (`OPENING/CLOSING/CASH_IN/CASH_OUT/ADJUSTMENT`) ve onay/ret kararları **personel kimliğine bağlanır** ve `user_activities` denetim günlüğüne "kim, ne zaman, ne kadar onayladı" olarak yazılır. Bu kayıtlar çalışan kişisel verisi (kimlik + iş faaliyeti) içerir.
- **Yükümlülükler:**
  - Kasa hareket/onay kayıtlarına erişim rol bazlı sınırlanmalı (onay yalnız ADMIN/MANAGER); bu zaten sistemde zorunlu.
  - Bu kayıtlar **saklama süresi** ve **erişim yetkisi** açısından işletmenin KVKK aydınlatma/işleme envanterine dâhil edilmeli (resmi kaynaktan/işletmenin KVKK danışmanından teyit edilmeli).
  - **Fiziksel güvenlik:** Nakit + kilit yönetimi; anahtarların yetkisiz kişilere verilmemesi, kasa üstü kameranın müşteri/personeli çekmesi halinde KVKK aydınlatma/görüntü saklama yükümlülüğü (bu, çekmecenin değil kameranın yükümlülüğüdür ama aynı tezgâhta yaşanır).

---

## 11. Satış ve Devreye Alma Kontrol Listesi

**Satış öncesi (bayi):**
- [ ] Çekmece solenoid gerilimi **birim etiketinden** doğrulandı (listelenen değer 12V; parti bazında teyit).
- [ ] Bağlanacak fiş yazıcısının **DK portu çıkış gerilimi** ile eşleştiği doğrulandı (Bölüm 2 — en kritik madde).
- [ ] Uygun **RJ11/RJ12 kablosu** kutuda/pakette mevcut.
- [ ] Yazıcı + çekmece paketi olarak konumlandırıldı; kabloların dahil olduğu teyit edildi.
- [ ] Fatura + garanti belgesi (kural olarak ticari/B2B; süre — Bölüm 8) hazırlandı.
- [ ] CE (EMC/RoHS) / AEEE etiketleri ürün/ambalaj üzerinde teyit edildi (resmi kaynaktan teyit edilmeli).

**Fiziksel kurulum:**
- [ ] Çekmece tezgâh altına, açılma boşluğu olacak şekilde yerleştirildi.
- [ ] RJ11/RJ12 kablosu yazıcının **DK portuna** takıldı (LAN/RJ45 portuna değil).
- [ ] Anahtar "çalışır/açık" moda alındı.

**Sistem yapılandırması:**
- [ ] Bağlı fiş yazıcısı sistemde mevcut; değilse **yazıcı için** slot açıldı → pairCode (10 dk) → `POST /v1/devices/pair` → token alındı.
- [ ] POS ayarlarında şubenin **varsayılan fiş yazıcısı** tanımlandı (çekmeceyi etkinleştiren gerçek koşul; `defaultReceiptPrinterId`). İsteğe bağlı: yazıcının `capabilities[]` etiketine `'cash_drawer'` eklendi (yalnızca açıklayıcı metadata).
- [ ] Topoloji netleştirildi: **cloud-direct** (Tauri) mi, **HummyBox köprüsü** arkası mı (`bridgeId`).
- [ ] Çekmece için **ayrı cihaz slotu/provizyon açılmadığı** teyit edildi (çekmece satılabilir bir katalog SKU'sudur ama ayrı bir `Device.kind` değildir; provizyon edilmez).

**Devreye alma / test:**
- [ ] POS'ta test nakit ödemesi → çekmece fiziksel açıldı.
- [ ] "Çekmeceyi Aç" manuel aksiyonu çalışıyor.
- [ ] Çift çekmeceli kurulumda doğru `pin` açılıyor.
- [ ] Vardiya açılış (`OPENING`) → satış → kapanış (`CLOSING`) + sayım kırılımı = tutar eşitliği akışı test edildi.
- [ ] `CASH_OUT`/`ADJUSTMENT` onay akışı (ADMIN/MANAGER) doğrulandı.

**Operatör eğitimi:**
- [ ] Kasiyer: çekmeceyi elle kapatma, kart ödemede açılmama, kapanışta boşaltıp kilitleme.
- [ ] Parmak sıkışması riski: çekmece hızlı-yaylı fırladığı için el/parmak konumu; küçük çocuklu ortamlarda dikkat.
- [ ] Yönetici: onay iş akışı ve Z-Raporu mutabakatı.

---

### Kaynaklar
- [AFANDA Para Çekmecesi 5 Bölmeli LB-405K RJ11 12V — Trendyol](https://www.trendyol.com/pd/afanda/para-cekmecesi-5-bolmeli-lb-405k-cash-drawer-rj11-12v-siyah-p-300322413)
- [AFANDA Türkiye — Para Çekmecesi](https://www.afandaturkiye.com/afanda-para-cekmecesi)
- Sistem gerçekleri: HummyTummy kod tabanı (`cash-drawer.service.ts`, `category-vocabulary.ts`, `escpos.rs` drawer-kick, `tauri.ts` `open_cash_drawer_via_printer`, `local-bridge-agent` `open_drawer`).

**Doğrulanmış mevzuat kaynakları:**
- Alçak Gerilim (LVD 2014/35/AB) — "Belirli Gerilim Sınırları İçin Tasarlanan Elektrikli Ekipman ile İlgili Yönetmelik", Resmi Gazete 2.10.2016: https://www.resmigazete.gov.tr/eskiler/2016/10/20161002-1.htm
- Elektromanyetik Uyumluluk (EMC 2014/30/AB) — "Elektromanyetik Uyumluluk Yönetmeliği", Resmi Gazete 2.10.2016 sayı 29845: https://www.resmigazete.gov.tr/eskiler/2016/10/20161002-2.htm
- RoHS — "Elektrikli ve Elektronik Eşyalarda Bazı Zararlı Maddelerin Kullanımının Kısıtlanmasına İlişkin Yönetmelik", Resmi Gazete 26.12.2022 sayı 32055: https://www.resmigazete.gov.tr/eskiler/2022/12/20221226-2.htm
- AEEE — "Atık Elektrikli ve Elektronik Eşyaların Yönetimi Hakkında Yönetmelik", Resmi Gazete 26.12.2022 sayı 32055: https://www.mevzuat.gov.tr/MevzuatMetin/yonetmelik/7.5.40055.pdf
- 6502 sayılı Tüketicinin Korunması Hakkında Kanun, Resmi Gazete 28.11.2013 sayı 28835: https://www.resmigazete.gov.tr/eskiler/2013/11/20131128-1.htm
- Garanti Belgesi Yönetmeliği, Resmi Gazete 13.6.2014 sayı 29029: https://www.resmigazete.gov.tr/eskiler/2014/06/20140613-2.htm

> Son güncelleme: 2026-07-02 - sürüm taslağı. Regülasyon/mali bilgiler bilgilendirme amaçlıdır; güncel resmi mevzuat (GİB, BKM, KVKK Kurumu, Ticaret Bakanlığı, ilgili yönetmelikler) esastır.
