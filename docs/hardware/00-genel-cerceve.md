# Genel Çerçeve, Regülasyon ve Ortak Süreçler

> **Doküman tipi:** Framework (çerçeve) — cihaza özel değildir.
> **Kapsanan cihaz seti:** yazarkasa/ÖKC, fiş yazıcısı, mutfak yazıcısı, KDS ekranı, bar ekranı, garson/müşteri tableti, barkod okuyucu (scanner), arayan numara (caller ID), para çekmecesi, network bridge (HummyBox), kart POS terminali.
> **Sistem:** HummyTummy restoran KDS/POS SaaS (Backend NestJS+Prisma/Postgres, Web SPA React, kiosk uygulaması Tauri `apps/kds-kiosk`, yerel köprü Rust daemon `apps/local-bridge-agent`).
> **Hedef okuyucu:** (1) restoran operatörü/işletme sahibi, (2) HummyTummy bayisi/satıcısı ve saha kurulum ekibi.

Bu doküman, tekil cihaz kılavuzlarının hepsinin üstünde duran **ortak çerçevedir**. Cihaza özgü teknik detaylar (ör. ÖKC fiş formatı, ESC/POS komut seti, tablet MDM ayarı) ilgili cihaz dokümanına bırakılmıştır; burada tüm cihazlarda geçerli olan **regülasyon, sözleşme, KVKK, mali mevzuat, garanti/RMA, tedarik ve kurulum standartları** tanımlanır.

> **Kanonik kaynak:** Bu doküman, **yatay konularda — satış/garanti hukuku rejimi, fiyat otoritesi, AEEE/atık, KVKK, ödeme mevzuatı lisans mercii ve cihaz token TTL'i — tek doğru kaynaktır.** Yaprak cihaz dokümanları bu başlıklar için buraya atıf verir; bir çelişki halinde bu çerçeve esas alınır.

> ⚠️ **Regülasyon uyarısı:** Aşağıdaki mevzuat başlıkları bilgilendirme amaçlıdır. Her sayısal eşik, tarih, ücret ve zorunluluk **"(resmi kaynaktan teyit edilmeli)"** notuyla işaretlenmiştir; nihai uygunluk için ilgili resmî kurumun (Ticaret Bakanlığı, Çevre-Şehircilik ve İklim Değişikliği Bakanlığı, GİB, KVKK Kurumu, ödeme/kart sistemleri için TCMB) güncel metni ve/veya bir hukuk/mali müşavir görüşü esas alınmalıdır. Sorumluluk, ürünü piyasaya arz eden/ithal eden ve satan taraftadır.

---

## 1. Kapsam

### 1.1 Bu doküman setinin amacı

HummyTummy, bir restoranın masasından mutfağına ve mali fişine kadar tüm operasyonu tek bulut platformunda toplar. Platform yazılım (SaaS) satışının yanında, restoranda fiziksel donanım da devreye alır: ekranlar, yazıcılar, tabletler, mali cihaz ve ağ köprüsü. Bu donanımların bir kısmı işletmeye **satılır**, bir kısmı **kiralanır**, bir kısmı da işletmenin **kendi cihazıdır (BYO — bring your own)**. Her üç durumda da cihazlar aynı "device-mesh" (cihaz ağı) mantığıyla eşleştirilir ve yönetilir.

Bu çerçeve dokümanının amacı:

- Bayinin ve operatörün **hangi cihazın hangi mevzuata tabi** olduğunu, kimin (üretici/ithalatçı/satıcı/işletmeci) neyden sorumlu olduğunu tek yerden görmesi.
- Mağaza (`/admin/store`) üzerinden yapılan **uzaktan/mesafeli satışın** doğru hukuki zeminde kurgulanması (kural olarak tacirler arası **B2B**; istisnaen tüketici — Bölüm 3).
- Tüm cihazlarda ortak olan **eşleştirme (pairing), provizyon, ağ topolojisi ve kurulum** akışının standartlaştırılması.
- **KVKK, mali mevzuat, garanti/RMA ve tedarik zinciri** ilkelerinin cihaz bazında değil, tek çerçevede tanımlanması.

### 1.2 Kapsanan cihazlar ve sistemsel tip eşleşmesi

Sistemde her cihaz `Device.kind` alanıyla temsil edilir. Aşağıdaki tablo, ticari cihaz adını sistemsel tipine, bağlantı topolojisine ve provizyon davranışına bağlar.

| Ticari cihaz | `Device.kind` | Mağaza kategorisi | Bağlantı | Provizyon (ödeme sonrası otomatik slot) |
|---|---|---|---|---|
| KDS mutfak ekranı | `kds_screen` | `kds_screen` | Cloud-direct | Evet |
| Bar ekranı | `bar_screen` | (KDS ekranı varyantı) | Cloud-direct | Evet (kds_screen eşlemesiyle) |
| Kart POS terminali | `pos_terminal` | `pos_terminal` | Köprü arkası (LAN) | Evet |
| Fiş yazıcısı (80 mm) | `receipt_printer` | `printer` | Köprü arkası (LAN) | Evet |
| Mutfak yazıcısı | `kitchen_printer` | (printer varyantı) | Köprü arkası (LAN) | Evet (printer eşlemesiyle) |
| Garson tableti | `tablet_waiter` | `tablet` | Cloud-direct | Evet |
| Müşteri tableti | `tablet_customer` | (tablet varyantı) | Cloud-direct | Evet |
| Yazarkasa / ÖKC | `yazarkasa` | `yazarkasa` | Köprü arkası (LAN) | Evet |
| Barkod okuyucu | `scanner` | `scanner` | Köprü arkası / cihaza bağlı | Evet |
| Arayan numara (caller ID) | `caller_id` | `caller_id` | Köprü arkası (LAN) | Evet |
| Network bridge (HummyBox) | `local_bridge` | `bridge` | Köprü kendisi | Evet |
| Para çekmecesi | (ayrı cihaz değil) | `cash_drawer` | Yazıcıya bağlı (RJ11/RJ12) | **Hayır** — provizyon edilmez |

> **Önemli:** `cash_drawer`, `other` ve `service` kategorileri ile eşlemesi olmayan kategoriler için ödeme sonrası **cihaz slotu açılmaz**. Para çekmecesi fiziksel olarak fiş yazıcısına RJ11/RJ12 kablosuyla bağlanır ve yazıcının `open_drawer` komutuyla (kick-out, ESC p) sürülür; bağımsız bir ağ cihazı değildir, bu yüzden mesh'te ayrı slotu yoktur.

> **Tartı/terazi (`scale`) neden ayrı bir cihaz dokümanı değildir?** `scale` kategorisi kodda **`RECOMMENDED_ONLY`** seviyesindedir: Mağaza'da satılmaz ve kendi cihaz kılavuzu yoktur. Ticari tartılar **yasal ölçü aleti** olup metroloji mevzuatına / **OIML damgasına** tabidir; HummyTummy bu cihazları **stoklamaz ve sertifikalamaz** — yalnızca **önerilen ekipman** olarak konumlar (işletme, yetkili tartı tedarikçisinden temin edip damgalatır *(metroloji zorunlulukları resmi kaynaktan teyit edilmeli)*). Tartı → POS entegrasyonu (tartıdan gramaj okuyup satır fiyatı/tutar hesaplama) **ileri aşama** bir yol haritası kalemidir; mevcut device-mesh akışının parçası değildir.

### 1.3 Sahiplik (ownership) ayrımı

Her cihazın `Device.ownership` alanı üç değerden birini alır ve bu değer **garanti/RMA sorumluluğunu ve tedarik zinciri yükümlülüğünü** doğrudan belirler:

| Ownership | Anlamı | Garanti/RMA sorumlusu | Satış/garanti hukuku rejimi |
|---|---|---|---|
| `sold` | İşletmeye satıldı (Mağaza siparişi) | HummyTummy/bayi (satıcı) + üretici/ithalatçı | **Kural olarak B2B** — 6098 TBK ayıp/zapt hükümleri + taraflarca kararlaştırılan garanti (Bölüm 3); alıcı istisnaen tüketici ise 6502 devreye girer |
| `rented` | İşletmeye kiralandı | HummyTummy/bayi (mülkiyet bizde) | Kira sözleşmesi hükümleri |
| `byo` | İşletmenin kendi cihazı | İşletme / cihazın kendi satıcısı | Bize ait değil (yalnızca uyumluluk desteği) |

Mağaza üzerinden satın alınıp otomatik provizyon edilen cihazlar `ownership: "sold"` olarak açılır. Elle eklenen slotlar varsayılan `byo`'dur.

---

## 2. Ortak Regülasyon Çerçevesi (Türkiye)

Bu bölüm, tüm elektrikli/elektronik cihazlar için geçerli **yatay** mevzuatı özetler. Cihaza özgü zorunluluklar (ör. ÖKC onayı, kart POS'unun ödeme kuruluşu izinleri) kendi dokümanlarında.

### 2.1 Genel yasal zemin

Türkiye'de ürün güvenliği ve teknik düzenlemelerin çerçeve kanunu **7223 sayılı Ürün Güvenliği ve Teknik Düzenlemeler Kanunu**'dur. Kanun **12 Mart 2020'de Resmî Gazete'de yayımlanmış** (Resmî Gazete 12.3.2020, sayı 31066), yayımından bir yıl sonra **12 Mart 2021'de yürürlüğe girmiş** ve aynı tarihte önceki **4703 sayılı Kanun'u ilga etmiştir**. (4703 sayılı Kanun'a hâlâ atıf yapan kaynaklar 2021 öncesine aittir.) Bu kanun; üretici, ithalatçı, yetkili temsilci ve dağıtıcı (bayi) için ayrı ayrı yükümlülükler tanımlar. Bayinin bilmesi gereken temel ilke: **piyasaya arz eden zincirin her halkasının, ürünün güvenli ve uygun olduğundan makul ölçüde emin olma yükümlülüğü vardır.**

### 2.2 CE işareti ve uygunluk

Restoran cihaz setindeki elektronik ürünler tipik olarak iki AB direktifi çerçevesinde CE kapsamındadır ve Türkiye bunları teknik düzenlemelerle iç hukuka almıştır:

| Direktif / düzenleme | Türkiye karşılığı | Kapsanan cihazlar |
|---|---|---|
| Alçak Gerilim (LVD, 2014/35/EU) | Belirli Gerilim Sınırları İçin Tasarlanan Elektrikli Ekipman ile İlgili Yönetmelik (2014/35/AB) (Resmî Gazete 2.10.2016; yetkili: Sanayi ve Teknoloji Bakanlığı) | Adaptörlü/şebekeden beslenen tüm cihazlar (ekran, yazıcı, ÖKC, HummyBox) |
| Elektromanyetik Uyumluluk (EMC, 2014/30/EU) | Elektromanyetik Uyumluluk Yönetmeliği (2014/30/AB) (Resmî Gazete 2.10.2016, sayı 29845; yetkili: Sanayi ve Teknoloji Bakanlığı) | Tüm elektronik cihazlar |
| Telsiz Ekipmanları (RED, 2014/53/EU) | Telsiz Ekipmanları Yönetmeliği (2014/53/AB) (Resmî Gazete 5.11.2020, sayı 31295; yetkili: BTK) | Wi-Fi/BT/GSM içeren cihazlar (tablet, GPRS'li ÖKC, kablosuz kart POS, HummyBox) |
| RoHS (zararlı madde kısıtı) | Elektrikli ve Elektronik Eşyalarda Bazı Zararlı Maddelerin Kullanımının Kısıtlanmasına İlişkin Yönetmelik (Resmî Gazete 26.12.2022, sayı 32055; yetkili: Çevre, Şehircilik ve İklim Değişikliği Bakanlığı) | Tüm EEE |

Pratik kurallar:

- Piyasaya arz edilen her elektronik cihaz üzerinde **CE işareti** görünür/okunur olmalı; işaret ürüne, ambalaja ve kullanım kılavuzuna iliştirilmelidir.
- Üretici/ithalatçı, her ürün ailesi için **AB/AT Uygunluk Beyanı** düzenler ve **teknik dosyayı en az 10 yıl** saklar *(süre cihazın tabi olduğu spesifik yönetmelikten teyit edilmeli)*.
- Bayi, CE işareti taşımayan veya uygunluk beyanı temin edilemeyen cihazı satmamalı/kurmamalıdır. **BYO cihazlarda** dahi, işletmeye bağlarken CE/uygunluk yoksa bu durum kuruluma "uyumluluk notu" olarak yazılmalıdır.
- Kablosuz modül taşıyan cihazlarda (tablet, kablosuz kart POS, GPRS ÖKC) frekans/güç uyumu RED kapsamındadır; Türkiye'de ayrıca cihazın telsiz modülüne göre **BTK** onayı/tip onayı gerekebilir *(teyit edilmeli)*.

### 2.3 TSE, gümrük ve ithalat

- İthal edilen cihazlarda **ithalat denetimi (TAREKS/ürün güvenliği denetimi)** ve gerektiğinde **TSE uygunluk/hizmet yeterlilik** süreçleri devreye girebilir *(kapsam ve zorunluluk ürün bazında resmi kaynaktan teyit edilmeli)*.
- ÖKC/yazarkasa gibi **mali cihazlar** ayrıca GİB onay sürecine tabidir (Bölüm 5).
- Bayinin dosyasında her SKU için: menşe, GTİP, CE beyanı, ithalatçı bilgisi ve (varsa) TSE belgesi bulunmalıdır.

### 2.4 AEEE / WEEE — elektronik atık ve genişletilmiş üretici sorumluluğu

Türkiye'de elektronik atık, **Atık Elektrikli ve Elektronik Eşyaların Yönetimi Hakkında Yönetmelik** ile düzenlenir (Resmî Gazete 26.12.2022, sayı 32055; önceki 2012 tarih ve 28300 sayılı "AEEE'lerin Kontrolü" Yönetmeliği'nin yerini almıştır). Yönetmeliğin bazı hükümlerinin yürürlüğü madde bazında kademelidir *(madde bazlı yürürlük tarihleri resmi kaynaktan teyit edilmeli)*. Bu yönetmelik **genişletilmiş üretici sorumluluğu (EPR)** ilkesine dayanır.

**Üretici/ithalatçı yükümlülükleri (bayinin izlemesi gerekenler):**

> **"Üretici" kimdir?** Yönetmelikteki üretici tanımı yalnızca fiziksel imalatçıyı değil, **ürünü kendi markasıyla piyasaya süreni ve ithal edeni** de kapsar. Bu nedenle HummyTummy/bayi, cihazları **kendi markasıyla (ör. HummyBox) piyasaya arz ettiğinde bu yönetmelik anlamında "üretici" konumuna gelir** ve aşağıdaki yükümlülükler doğrudan kendisine düşer (Resmî Gazete 26.12.2022, sayı 32055).

- Ürünleri **üretici kaydı** için Çevre, Şehircilik ve İklim Değişikliği Bakanlığı'nın **Entegre Çevre Bilgi Sistemi (EÇBS — ecbs.cevre.gov.tr) üzerindeki EEE Üretici Kayıt Sistemi'ne** kaydettirmek, **üretici kayıt numarası** almak ve **yıllık bildirim** vermek (Resmî Gazete 26.12.2022, sayı 32055).
- Ürünlerin kullanım ömrü sonunda **toplanması ve çevreye uygun bertarafı** için sorumluluk almak; toplama hedeflerini karşılamak — bunun bir **yetkilendirilmiş kuruluşa** (ör. AGİD gibi sektörel yapı) üyelik yoluyla mı yoksa doğrudan Bakanlık kaydı üzerinden mi yürüdüğü *(resmi kaynaktan teyit edilmeli)*.
- Ürün ve/veya ambalaj üzerinde **üstü çizili tekerlekli çöp kutusu** (WEEE) sembolünü bulundurmak; bu sembol "evsel atıkla atma, ayrı topla" anlamına gelir.
- Yıllık **AEEE beyanları** ve toplama/geri kazanım oranları raporlaması *(eşikler resmi kaynaktan teyit edilmeli)*.

> **AEEE kaydı ≠ GEKAP:** AEEE üretici kaydı ve bildirimleri **EÇBS** üzerinden yürür; **Geri Kazanım Katılım Payı (GEKAP)** ise ayrı bir **mali yükümlülüktür** ve beyanı EÇBS'ye değil **GİB'e (vergi dairesi)** verilir. İki yükümlülük birbirine karıştırılmamalıdır.

**Operatör (restoran) için pratik sonuç:**

- Ömrünü tamamlayan cihaz (arızalı ÖKC hariç — o ayrıca mali prosedüre tabidir, Bölüm 5) **evsel/karışık atığa atılamaz**; yetkili toplama noktasına ya da satın alınan yere iade edilmelidir.
- HummyTummy/bayi, `sold` ve `rented` cihazlar için **geri alma/toplama** kanalı sağlar; RMA/hurda süreçlerinde cihazlar AEEE akışına yönlendirilir (Bölüm 6).

**Pil/akü içeren cihazlar** (kablosuz kart POS, bazı tabletler, caller ID) ayrıca **Atık Pil ve Akümülatörlerin Yönetimi** kapsamındadır; piller ayrı toplanır *(teyit edilmeli)*.

### 2.5 Enerji ve güvenlik

- Cihazlar Türkiye şebekesi olan **230 V / 50 Hz**'e uygun olmalıdır. İthal cihazlarda **fiş tipi Türkiye'de kullanılan CEE 7/4 "Schuko" (Type F, topraklı)** olmalı; değilse orijinal/CE'li adaptör kullanılmalı, gelişigüzel çevirici kullanılmamalıdır. (Not: "Schuko" = Schutzkontakt; "Schengen" bir seyahat/sınır rejimidir, priz/konektör standardı değildir.)
- **Topraklama zorunludur** (Bölüm 8.2). Özellikle metal gövdeli yazıcı, ÖKC ve para çekmecesinde topraksız priz ciddi güvenlik ve veri (yazdırma bozulması, ÖKC reset) riskidir.
- Cihaz güç değerleri (W/A) prizin ve UPS'in kapasitesiyle uyumlu planlanmalıdır (Bölüm 8'deki yük tablosu).
- Isı: KDS/bar ekranı ve HummyBox sürekli çalışır; havalandırması olan, doğrudan ocak/ızgara ısısına ve yağ buharına maruz kalmayan yere konumlanmalıdır.

---

## 3. Mesafeli Satış — Satış Hukuku Rejimi (B2B kural, tüketici istisna)

Mağaza (`/admin/store`) üzerinden yapılan donanım satışı, alıcının cihazı fiziksel görmeden internet üzerinden sipariş ettiği bir uzaktan/**mesafeli satıştır**. Bu satışta **satıcı HummyTummy/bayidir; alıcı ise restoran işletmesidir ve kural olarak TACIR sıfatını taşır.** **6502 sayılı Tüketicinin Korunması Hakkında Kanun** m.3 tüketiciyi "ticari veya mesleki olmayan amaçlarla hareket eden gerçek veya tüzel kişi" olarak tanımlar (Resmî Gazete 28.11.2013, sayı 28835); restorana yönelik donanım satışı **ticari/mesleki amaçlı** olduğundan alıcı bu tanıma girmez. Bu nedenle ilişki, kural olarak tacirler arası bir **B2B satıştır** ve 6502'nin tüketiciye özgü korumaları (ayıplı maldan sorumlulukta öngörülen uzun süreler, Garanti Belgesi Yönetmeliği'nin **tüketici ürünleri** için öngördüğü asgari süreler, mecburi cayma hakkı vb.) **tacirler arası satışta uygulanmaz**. Bunun yerine **6098 sayılı Türk Borçlar Kanunu**'nun ayıp hükümleri (satıcının ayıptan sorumluluğu m.219; alıcının muayene/ihbar külfeti m.223) ile **tarafların kararlaştırdığı garanti/koşullar** geçerlidir. TBK'nın ayıp hükümleri **emredici değildir** (satıcının ağır kusuru — m.221 — hariç), dolayısıyla taraflar arası sorumsuzluk/kısıtlama kaydı geçerli olabilir *(hukuki nitelendirme somut olayda müşavir ile teyit edilmeli)*.

> **İstisna 1 — alıcı tüketiciyse:** Alıcı istisnaen **tüketici** sayılırsa (ör. gerçek kişi, ticari/mesleki amaç dışı alım), o satış için **6502 sayılı Kanun** ve **Mesafeli Sözleşmeler Yönetmeliği** (Resmî Gazete 27.11.2014, sayı 29188; yürürlük 27.2.2015) devreye girer; bu bölümdeki tüketici korumaları (cayma hakkı, garanti belgesi asgari süreleri vb.) uygulanır. Bu yönetmelik yalnızca **tüketici** sözleşmelerine uygulanır; tacirler arası (B2B) satışta cayma hakkı **uygulanmaz**.
>
> **İstisna 2 — tacir alıcının muayene/ihbar külfeti:** Tacir alıcı, **TBK m.223** uyarınca teslim aldığı malı işlerin olağan akışına göre **gözden geçirmek (muayene)** ve varsa ayıbı **süresinde satıcıya ihbar etmek** külfetine tabidir; süresinde ihbar edilmeyen (açık) ayıp için satıcıya başvuru hakkı kural olarak düşer. İki taraflı ticari işlerde **TTK m.23/1-c** kesin süreler öngörür: **açıkça belli olan ayıp teslimden itibaren 2 gün** içinde, **muayeneyle ortaya çıkabilecek (gizli) ayıp ise 8 gün** içinde incelenip satıcıya ihbar edilmelidir *(somut olaydaki süre/kapsam müşavir ile teyit edilmeli)*.
>
> Hangi rejim geçerli olursa olsun sistem, her iki tarafı da koruyacak şekilde en yüksek şeffaflık standardını (ön bilgilendirme, kalıcı veri saklayıcısı, açık fatura/garanti kaydı) hedefler.

### 3.1 Satış akışı ve sözleşmenin kurulması

Sistemdeki gerçek akış:

1. Operatör **Mağaza → sepet** üzerinden cihaz(lar)ı seçer.
2. **PayTR** ödeme sayfasına yönlenir ve ödemeyi tamamlar.
3. **Sipariş ödendiğinde**, sipariş kalemlerine karşılık gelen device-mesh **cihaz slotları otomatik açılır** (deterministik `provisionKey = "${orderId}:${productId}:${unitIndex}"` + Postgres advisory-lock, idempotent — aynı sipariş iki kez işlense bile mükerrer slot açılmaz).

Bu akış, mesafeli sözleşmenin şu unsurlarını gerektirir:

- **Ön bilgilendirme:** Sipariş onayından ÖNCE alıcıya; ürünün temel nitelikleri, satıcı/sağlayıcı kimliği (unvan, MERSİS/adres/iletişim), **KDV dahil toplam fiyat**, ödeme ve teslim/kurulum koşulları, cayma hakkı (varsa) ve şikâyet/başvuru yolları yazılı/kalıcı veri saklayıcısıyla sunulmalıdır.
- **Kalıcı veri saklayıcısı:** Sipariş özeti ve mesafeli satış sözleşmesi e-posta/PDF olarak alıcıya iletilmeli; sistemde saklanmalıdır.
- **Kayıt saklama:** Satıcı, yönetmelik kapsamındaki bilgi ve belgeleri **3 yıl** saklamalıdır *(süre teyit edilmeli)*.

### 3.2 Cayma hakkı

> **Kapsam:** Aşağıdaki cayma hakkı **tüketici** alıcı için geçerlidir (Bölüm 3 girişi — İstisna 1). Tacir alıcının B2B satışında **mecburi cayma hakkı kural olarak yoktur**; iade/koşullar taraflar arası sözleşmeye tabidir.

- Tüketici, mesafeli sözleşmede **14 gün** içinde, gerekçe göstermeden ve cezai şart ödemeden **cayma hakkına** sahiptir (Mesafeli Sözleşmeler Yönetmeliği m.9/1; dayanak 6502 sayılı Kanun m.48 ve 84); süre malın teslim alındığı gün başlar.
- Cayma bildirimi yazılı veya kalıcı veri saklayıcısıyla yapılabilir; sistem **iade/RMA akışına** bağlı bir "cayma talebi" kanalı sunmalıdır.
- **Cayma hakkının istisnaları** (yönetmelik) donanımda dikkat gerektirir: tüketicinin istekleri doğrultusunda **kişiselleştirilmiş/özel üretilmiş** ürünler cayma kapsamı dışında olabilir *(teyit edilmeli)*. Standart raf ürünü ÖKC/yazıcı/tablet için kişiselleştirme argümanı kullanılmamalı; cayma hakkı tanınmalıdır.
- **Yazılım/SaaS aboneliği** ve **dijital içerik/hizmet** için cayma kuralları farklıdır; donanımla birlikte satılan HummyTummy aboneliği ayrı ele alınmalıdır.

> **Bayiye not:** ÖKC gibi mali cihazlar **kişiselleştirme (mükellef bilgisi yükleme, GİB kaydı)** yapıldıktan sonra iadesi operasyonel olarak zorlaşır. Bu nedenle ÖKC satışında cayma penceresi ile **fiscal aktivasyon** adımı süreçte ayrılmalı; aktivasyon öncesi iade kolaylaştırılmalı, aktivasyon sonrası iade mali prosedüre (hurdaya ayırma/nakil) bağlanmalıdır (Bölüm 5 ve 6).

### 3.3 Garanti belgesi ve fatura

- **Garanti süresi (rejim ayrımı — kanonik):** **Garanti Belgesi Yönetmeliği** (Resmî Gazete 13.6.2014, sayı 29029) **tüketiciye yöneliktir**; yönetmelik ekindeki listeye tabi ürünlerde **asgari 2 yıllık** garanti öngörür. Bu asgari süreler tacirler arası B2B satışta **uygulanmaz**. B2B'de geçerli olan, **üreticinin/ithalatçının verdiği ve tarafların kararlaştırdığı garanti süresidir**; dolayısıyla üreticinin sağladığı **12 veya 24 aylık garanti geçerli ve bağlayıcıdır** — bu sürelerin "tüketici 2 yıl asgarisine aykırı/uygunsuz" olduğu yorumu B2B'de **hatalıdır**. Alıcı istisnaen tüketici ise (Bölüm 3, İstisna 1) yönetmeliğin asgari süreleri ve garanti belgesi zorunluluğu devreye girer *(ürün grubuna göre kapsam Ticaret Bakanlığı listesinden teyit edilmeli)*.
- **Azami tamir süresi:** **Tüketici satışında** garanti kapsamındaki arızalarda azami tamir süresi listedeki mallar için **20 iş günü** (taşıtlar 45 iş günü) olarak uygulanır *(teyit edilmeli)*; süre aşılırsa veya cihaz sık arızalanırsa tüketici **ücretsiz değişim/iade/bedel indirimi** talep edebilir. **B2B satışta** onarım/değişim süreleri ve yaptırımları taraflar arası sözleşmeye ve TBK ayıp hükümlerine tabidir.
- **Yedek parça/servis:** Üretici/ithalatçı, cihazın Bakanlıkça belirlenen **kullanım ömrü** boyunca yedek parça ve servis bulundurmakla yükümlüdür *(teyit edilmeli)*. ÖKC ve kart POS gibi mali/ödeme cihazlarının yönetmelik ekindeki kullanım ömrü/servis süreleri ürün grubuna göre değişir *(ürün bazında Ticaret Bakanlığı listesinden teyit edilmeli)*.
- **Fatura:** Her satışta **e-Arşiv/e-Fatura** düzenlenir; cihaz seri numarası ve garanti başlangıcı fatura/irsaliye ile ilişkilendirilir. Sistemde `Device.warrantyUntil` alanı bu tarihe göre doldurulmalıdır.

### 3.4 Fiyat ve reklam dürüstlüğü

- **Fiyat otoritesi (kanonik):** Tek yetkili güncel perakende fiyat kaynağı **üründür/katalogdur** — `HardwareProduct.priceCents` ve checkout `QuoteService` (KDV **%20** dahil). Bu doküman setinde **bağlayıcı marj tablosu veya alış/satış fiyat örneği verilmez**; alış maliyeti ve marj **distribütör teklifine göre değişir** ve burada bağlayıcı değildir. Yaprak cihaz dokümanları fiyat için bu kaynağa atıf verir.
- Mağaza'da gösterilen fiyat **KDV dahil ve nihai** olmalı; kargo/kurulum ücreti ayrıca ve açıkça belirtilmeli.
- "Uydurma model/fiyat" yasaktır — bu doküman ve mağaza içeriği yalnızca gerçek SKU ve gerçek (katalog) fiyatı yansıtır. Kampanya/indirimde **eski fiyatın gerçekliği** ispatlanabilir olmalıdır (haksız ticari uygulama yasağı) *(teyit edilmeli)*.

---

## 4. KVKK — Restoran Cihaz Ekosisteminde Kişisel Veri

**6698 sayılı Kişisel Verilerin Korunması Kanunu (KVKK)** (kabul tarihi 24.3.2016) ve ikincil düzenlemeleri, restoranın cihazlarla işlediği kişisel veriyi kapsar. HummyTummy platformu ve cihazları çeşitli noktalarda kişisel veri toplayabilir.

### 4.1 Cihaz bazında veri envanteri ve rol

| Cihaz/nokta | İşlenen kişisel veri | Tipik amaç | Hassasiyet |
|---|---|---|---|
| Müşteri tableti (`tablet_customer`) / QR menü | Ad, sipariş içeriği, (varsa) iletişim, ödeme başlatma | Self-servis sipariş/ödeme | Orta |
| Arayan numara (caller ID) | **Telefon numarası**, çağrı zamanı, (eşleşen) müşteri kaydı | Rezervasyon/paket sipariş tanıma | Yüksek (iletişim verisi) |
| Kart POS terminali (`pos_terminal`) | Kart verisi (maskeli PAN, onay kodu), tutar | Ödeme alma / GMP-3 mali eşleme | **Çok yüksek (PCI-DSS)** |
| Fiş/mutfak yazıcısı | Fişte görünen ad/masa/sipariş | Servis | Düşük-orta |
| Kamera (varsa, mesh dışı entegrasyon) | Görüntü/biyometrik olabilecek veri | Güvenlik/analitik | **Çok yüksek** |
| Garson tableti (`tablet_waiter`) | Personel kimliği, işlem logu | Operasyon | Orta |

### 4.2 Aydınlatma ve açık rıza

- **Aydınlatma yükümlülüğü (KVKK m.10):** Kişisel veri toplanan her noktada (masa QR'ı, müşteri tableti, caller ID'li telefon hattı, kameralı alan) veri sahibine **aydınlatma metni** sunulmalıdır (kim, hangi veri, hangi amaç, hukuki sebep, aktarım, saklama süresi, haklar). Aydınlatma, açık rıza aranmayan hallerde dahi **her veri işleme faaliyetinde** zorunludur.
- **Açık rıza:** Bir işleme **KVKK m.5/2**'de sayılan hukuki sebeplerden birine (kanunlarda açıkça öngörülme, sözleşmenin ifası, hukuki yükümlülük, meşru menfaat vb.) dayanıyorsa **açık rıza aranmaz**; bunların hiçbirine dayanmıyorsa **açık rıza** gerekir. Örn. pazarlama amaçlı SMS/çağrı için açık rıza; sipariş/ödeme için "sözleşmenin ifası" sebebi kullanılabilir *(nitelendirme müşavir ile teyit edilmeli)*.
- **Caller ID özel dikkat:** Telefon numarası, KVKK m.3 anlamında **kişisel veridir** ("kimliği belirli veya belirlenebilir gerçek kişiye ilişkin her türlü bilgi"). Gelen numaranın müşteri kaydıyla eşlenip geçmiş siparişlerin gösterilmesi bir profilleme/işlemedir; aydınlatma ve saklama politikası net olmalı, gereksiz veri tutulmamalıdır (veri minimizasyonu).
- **Kamera:** Görüntü kaydı yapılan alanlarda görünür **bilgilendirme levhası** ve aydınlatma zorunludur; yüz tanıma/biyometrik işleme yapılıyorsa bu **özel nitelikli veri** olup daha ağır koşullara tabidir *(teyit edilmeli)*.

### 4.3 Veri sorumlusu – veri işleyen ilişkisi

- **Restoran işletmesi = veri sorumlusu:** Müşteri/personel verisinin amacını ve vasıtasını belirleyen taraf işletmedir. VERBİS'e kayıt yükümlülüğü işletmenin durumuna göre değişir *(eşikler/istisnalar teyit edilmeli)*.
- **HummyTummy (platform/bayi) = veri işleyen:** İşletme adına, işletmenin talimatıyla veriyi barındırır/işler. Bu ilişki için **veri işleme sözleşmesi (DPA)** yapılmalı; işleyen, veriyi yalnızca sözleşme ve talimat çerçevesinde işleyeceğini, uygun teknik/idari tedbirleri (şifreleme, erişim kontrolü, loglama) aldığını taahhüt etmelidir.
- **Kart verisi:** PAN/CVV gibi hassas kart verisi **HummyTummy'de saklanmaz**; ödeme, PayTR ve kart POS/PSP tarafında **PCI-DSS** kapsamında işlenir. Sistem yalnızca maskeli veri/onay kodu tutar.
- **Yurt dışı aktarım:** Bulut altyapısı yurt dışındaysa **yurt dışına veri aktarımı** kuralları (KVKK m.9) uygulanır. Bu rejim **7499 sayılı Kanun** ile (Resmî Gazete 12.3.2024, sayı 32487; yürürlük 1.6.2024) yeniden düzenlenip "standart sözleşme" mekanizması getirilmiştir.
- **İhlal bildirimi:** Veri ihlalinde KVKK'nın **ihlal bildirimi** yükümlülüğü işler; "en kısa sürede" ifadesi Kurul kararıyla **72 saat** olarak somutlaştırılmıştır *(güncel metinden teyit edilmeli)*.

### 4.4 Güvenlik tedbirleri (cihaz tarafı)

- Cihaz eşleştirmesinde ham token **yalnızca bir kez** döner ve at-rest **sha256 hash** olarak saklanır (Bölüm 8.5); bu, çalınan cihaz veritabanından token'ın geri elde edilememesini sağlar.
- Köprü arkası cihazlar (kart POS, ÖKC) genel internete doğrudan açılmaz; yalnızca HummyBox üzerinden bulutla konuşur.

---

## 5. Mali Mevzuat Özeti

> Bu bölüm **özettir**; ÖKC/yazarkasa ve GMP-3 fiscal_coupled akışının tam detayı **yazarkasa dokümanındadır**.

### 5.1 ÖKC/yazarkasa zorunluluğu

- Fatura vermek zorunda olmayan satışlarda, mükellefler perakende mal/hizmet satışını **Ödeme Kaydedici Cihaz (ÖKC/yazarkasa)** ile belgelemek zorundadır. Restoran/kafe gibi hizmet işletmeleri **Yeni Nesil ÖKC** kullanır *(kapsam ve muafiyetler GİB'den teyit edilmeli)*.
- ÖKC yalnızca **GİB onaylı** üretici/model olabilir. HummyTummy, onaylı cihazlarla **Hugin/Beko adaptörleri** üzerinden entegre olur (yerel köprüde `yazarkasa_hugin` sürücü adı gerçektir ancak **şu an yalnızca iskelet/scaffold** durumundadır; fiscal-core tarafında `BekoFiscalProvider` mevcuttur — teknik durum için aşağıdaki nota bakınız). Belirli marka/modelin GİB onay listesinde güncel olması ve tedariki zamanla değişebilir *(GİB onaylı ÖKC listesinden teyit edilmeli)*.
- Sistemsel sipariş/POS yazılımı ile ÖKC arasındaki bağlantı **GMP-3** (GİB ÖKC – Harici Donanım/Yazılım Haberleşme Protokolü) esas alınarak kurulur; harici yazılım/EFT-POS üzerinden yapılan her işlem ÖKC'de **mali fişe** dönüştürülmelidir. Kılavuz periyodik güncellenir; belgede referans alınan **Teknik Kılavuz sürümü, tarihi ve ilgili bölümü** *(GİB'in güncel yayınından teyit edilmeli)*.

> **Yazarkasa/ÖKC entegrasyon notu (teknik durum):** Yerel köprüdeki `yazarkasa_hugin` sürücüsü şu an **yalnızca iskelet (scaffold/stub)** durumundadır — çalıştırıldığında `Hugin driver not implemented in this scaffold` hatası döndürür ve **uçtan uca mali fiş BASMAZ**; tıpkı kart terminali sürücüsü (`ingenico_iwl`, Bölüm 7.1) gibi henüz sevk edilmemiştir. Köprüde bugün **yalnızca `escpos` sürücüsü işlevseldir** (ESC/POS fiş/mutfak yazdırma). "ÖKC uçtan uca mali fiş kesiyor" izlenimi verilmemelidir; GMP-3 fiscal_coupled mali fiş akışı ancak onaylı ÖKC donanımı ile ÖKC sürücüsü tamamlandığında devreye alınır.

### 5.2 e-Fatura / e-Arşiv

- Belirli ciro/kapsam eşiklerini aşan ya da gönüllü geçen mükellefler **e-Fatura / e-Arşiv Fatura** düzenler *(eşikler yıla göre değişir — GİB'den teyit edilmeli)*.
- HummyTummy, satış ve donanım faturalarını e-Fatura/e-Arşiv rayına bağlar; ÖKC mali fişi ile e-belge mutabakatı yapılır. **Satıcı kimliği (unvan/VKN) her belgeye** işlenmelidir.

### 5.3 Bilgi fişi vs. mali fiş — kritik ayrım

Bu ayrım tüm operatör ve bayi ekibinin ezbere bilmesi gereken kuraldır:

| | **Mali fiş** | **Bilgi fişi** |
|---|---|---|
| Kim keser? | Yalnızca **onaylı ÖKC/yazarkasa** | Herhangi bir ESC/POS fiş yazıcısı / POS yazılımı |
| Mali belge mi? | **Evet** (fatura yerine geçer) | **Hayır** — mali/vergisel geçerliliği yoktur |
| Mali onay | Mali hafıza/GİB kaydı içerir | İçermez |
| Amaç | Vergilendirme, KDV, Z raporu | Adisyon, mutfak, ön hesap, kurye kopyası |

- **"Bilgi fişi" mali belge DEĞİLDİR.** Restoran fiş yazıcısından (receipt_printer) çıkan ön hesap/adisyon bilgi fişidir; müşteriye **mali fiş** ancak ÖKC'den kesilir.
- **GMP-3 fiscal_coupled** akışında, kart POS terminali ile alınan tahsilat ÖKC'de mali fişe eşlenir (kartla ödeme "kasa fişi" olarak da basılır); sistemde `charge_card` sonrası `fiscal_receipt` komutu ile eşleme yapılır (device-mesh komut kümesinde `charge_card`, `void_card`, `fiscal_receipt`, `open_drawer`, `firmware_update` gerçek komut tipleridir; `charge_card`/`void_card` para işlemi olarak non-retryable işaretlidir). Ödemeli modifikasyonlar dâhil tüm tutarlar mali fişe yansımalıdır (KDV eksik hesaplanmamalı, kart ödemesi nakit gibi basılmamalıdır).
- Uyumsuzlukta ceza atfı ihlalin tipine göre değişir: **belgeyi (mali fişi) hiç düzenlememe** tipik olarak **VUK 353**; **ÖKC/EFT-POS entegrasyonu gibi VUK mükerrer 257'ye dayanan teknik zorunluluklara uymama** ise **VUK mükerrer 355** kapsamına girebilir *(uygulanacak madde ve tutarlar mali müşavirle teyit edilmeli)*.

### 5.4 ÖKC ömür sonu ve nakil

Arızalı/ömrünü tamamlamış ÖKC, sıradan AEEE hurdası gibi atılamaz; **mali hafıza raporu alınması, ÖKC levhası/sicil işlemleri ve yetkili servis üzerinden hurdaya ayırma** gerektirir *(prosedür GİB/yetkili servis ile teyit edilmeli)*. RMA akışında ÖKC bu nedenle özel bir alt-akıştır (Bölüm 6.5).

---

## 6. Ortak Garanti & RMA Politikası

RMA (Return Merchandise Authorization) = arızalı/uyumsuz cihazın iade/onarım/değişim süreci. Aşağıdaki politika `sold` ve `rented` cihazlar için geçerlidir; `byo` cihazlarda yalnızca uyumluluk desteği verilir, donanım garantisi cihazın kendi satıcısındadır.

### 6.1 Sorumluluk matrisi

| Rol | Sorumluluk |
|---|---|
| **Üretici/ithalatçı** | Ürün garantisi (B2B'de üreticinin verdiği 12/24 ay veya taraflarca kararlaştırılan süre — Bölüm 3.3; tüketici satışında yönetmelik asgarisi), yedek parça, teknik onarım, uygunluk belgeleri |
| **HummyTummy / bayi (satıcı)** | Birinci basamak destek, RMA açma/yönlendirme, yedek cihaz, kurulum/pairing sorunları, garanti takibi |
| **Operatör (restoran)** | Doğru kullanım, fiziksel hasar/aşırı kullanımdan kaçınma, arıza bildirimini zamanında yapma, cihazı iade için hazırlama (veri temizliği, aksesuar) |

### 6.2 RMA akışı (standart)

1. **Arıza bildirimi:** Operatör panelden veya destek kanalından arızayı bildirir; cihazın `serialNo`, `kind`, `ownership`, `warrantyUntil` bilgisi otomatik toplanır.
2. **Uzaktan teşhis:** Çoğu sorun donanım değil **eşleştirme/ağ** kaynaklıdır (Bölüm 6.4). Önce heartbeat/token/köprü durumu kontrol edilir.
3. **RMA numarası:** Donanım arızası doğrulanırsa RMA numarası açılır; garanti kapsamı (`warrantyUntil` ve arıza tipi) belirlenir.
4. **Kargo/lojistik:** Garanti içi ve üretim/malzeme kaynaklı arızada **kargo satıcı/üreticiye aittir**; kullanıcı hatası/fiziksel hasarda ücretlendirme olabilir. Cihaz **orijinal ambalaj veya uygun koruma** ile gönderilir.
5. **Yedek cihaz:** Kritik cihazlarda (ÖKC, tek fiş yazıcısı, tek KDS) hizmet kesintisini önlemek için **yedek/ödünç cihaz** politikası uygulanır (SLA'ya bağlı). Yedek cihaz da mesh'e pairCode ile eşleştirilir; arızalı cihaz `retired` durumuna alınır ve pairCode/anahtarları geçersizleştirilir.
6. **Onarım/değişim:** Tüketici satışında yönetmelik azami tamir süresi (20 iş günü *(teyit edilmeli)*), B2B satışta ise sözleşmede kararlaştırılan süre içinde çözülür; aşılırsa tüketici satışında değişim/iade hakları, B2B'de TBK/sözleşme kaynaklı haklar devreye girer.
7. **Kapanış:** Onarılan/değişen cihaz yeniden pairing ile devreye alınır; `warrantyUntil` gerekiyorsa güncellenir.

### 6.3 Garanti kapsamı dışı haller (tipik)

- Sıvı teması, düşme/darbe, yetkisiz açma/tamir, orijinal olmayan sarf/adaptör, aşırı gerilim/yıldırım (topraksız priz), yazılım kilidi kırma.
- Bu nedenle **kurulum standardına** (Bölüm 8) uyum, garantinin ön koşuludur.

### 6.4 "Donanım değil, eşleştirme" hızlı ayırt tablosu

RMA açmadan önce bakılacaklar (gerçek arızalar):

| Belirti | Muhtemel sebep | Aksiyon |
|---|---|---|
| Cihaz "offline" | 60 sn heartbeat kesildi (ağ/güç) | Ağ/güç, köprü WSS durumu |
| Pairing başarısız | pairCode süresi doldu (10 dk) veya zaten claim edilmiş | Yeni slot/pairCode üret |
| Token reddi | Bearer token TTL (24s) doldu (pair'den 24s sonra; heartbeat TTL'i uzatmaz) | Yeniden pair et (heartbeat token'ı yenilemez) |
| Yazıcı basmıyor | Köprü offline / kağıt / kapak / drawer hattı | Köprü + sarf + kablo |
| ÖKC mali fiş kesmiyor | GMP-3 bağlantısı / ÖKC modu | Köprü `yazarkasa` sürücüsü + ÖKC servis |
| Kart POS onaylamıyor | PSP/banka hattı, terminal aktivasyonu | Terminal aktivasyon + hat |

### 6.5 ÖKC RMA özel akışı

ÖKC arızasında donanımın yanında **mali prosedür** işler: mali hafıza raporu, yetkili servis müdahalesi, gerekiyorsa GİB'e bildirim ve hurdaya ayırma/nakil belgeleri. ÖKC asla sıradan kargo-değişim gibi ele alınmaz *(prosedür yetkili servis/GİB ile teyit edilmeli)*.

---

## 7. Tedarik Zinciri İlkeleri

### 7.1 Orijinallik ve mali işaret

- Yalnızca **orijinal, CE'li, uygunluk beyanı olan** cihazlar tedarik edilir. Muadil/parallel-import cihazlarda uygunluk ve garanti kanıtı aranır.
- **ÖKC/yazarkasada** GİB onayı ve fiziksel/mali işaretleme zorunludur. Doğru terminoloji: YN ÖKC'nin mali işareti "bandrol" değil; **ÖKC levhası/sicil numarası ve mali hafızadır**. ("Mali mühür" ise ÖKC'nin değil e-Fatura/e-Belge sisteminin elektronik mühür/nitelikli sertifika kavramıdır.) Onaysız cihaz asla satılmaz/kurulmaz *(işaretleme/levha prosedürü GİB'den teyit edilmeli)*.
- Kart POS terminali, ilgili **ödeme kuruluşu/banka** ile yetkilendirilmiş olmalı. **6493 sayılı Kanun** kapsamında ödeme ve elektronik para kuruluşlarının düzenleme/denetim ve yetkilendirme (lisans) yetkisi, **7192 sayılı Kanun** ile (Resmî Gazete 22.11.2019, sayı 30956) **1.1.2020'den itibaren BDDK'dan TCMB'ye (Merkez Bankası) devredilmiştir** — izin/lisans artık **TCMB**'dedir; **BKM kart sistemleri operatörüdür, lisans mercii değildir**. SoftPOS/ECR adaptörleri yalnızca sertifikalı donanımda aktive edilir (sistemde `activatable`/`ACTIVE` kapısı bu yüzden vardır).

> **Kart POS entegrasyon notu (teknik durum):** Yerel köprüde sürücü isimleri (`ingenico_iwl`, `escpos`) gerçektir; ancak kart terminali sürücüsü (`ingenico_iwl`) şu an **yalnızca iskelet (scaffold)** durumundadır — `try_init()` `Ok(None)` döndürür ve gerçek terminal entegrasyonu acquirer/banka SDK'sına bağımlı olduğundan **henüz sevk edilmemekte, `activatable`/`ACTIVE` kapısı arkasında inert kalmaktadır**. "Kart terminali entegrasyonu hazır" izlenimi verilmemelidir; go-live yalnızca sertifikalı donanımda kayıt+aktivasyon sonrasıdır.

### 7.2 Distribütör sözleşmesi

- Her cihaz ailesi için **yetkili distribütör/üretici sözleşmesi** bulunmalı; garanti, yedek parça, fiyat ve ürün geri çağırma (recall) şartlarını içermeli.
- İthalatçı değişikliği veya ticari faaliyetin sona ermesi halinde **servis/yedek parça sürekliliği** sözleşmede güvence altına alınmalıdır (Bölüm 3.3 yasal zorunluluğu ile uyumlu).

### 7.3 Stok ve seri takibi

- Her fiziksel cihaz **seri numarasıyla (`serialNo`)** kayıt altında olmalı; satış/kiralama/RMA boyunca izlenmeli.
- Sistemde cihaz `serialNo`, `warrantyUntil`, `ownership`, `capabilities[]`, atandığı şube ve (varsa) köprü ile ilişkilendirilir. Bu, garanti ve recall'da hangi müşteride hangi seri var sorusunu yanıtlar.
- Mağaza siparişi ödendiğinde açılan slotun `provisionKey`'i sipariş/ürün/birim ile birebir eşleşir — böylece **fiziksel seri ↔ sipariş ↔ garanti** zinciri kopmaz.

### 7.4 Sahtecilik ve tağşiş riski

- Sahte adaptör/sarf (özellikle termal rulo ve güç adaptörü) yangın/veri kaybı riskidir; yalnızca onaylı sarf tedarik edilir.
- Sahte/klon ÖKC veya kurcalanmış kart POS **mali suç ve dolandırıcılık** riskidir; tedarik zinciri yalnızca yetkili kanaldan yürütülür, ikinci el ÖKC/kart POS kaynağı doğrulanmadan devreye alınmaz.
- **Recall/geri çağırma:** Üretici bir modeli geri çağırırsa, seri takibi sayesinde etkilenen işletmeler tespit edilip bilgilendirilir.

---

## 8. Kurulum Standardı

Bu bölüm tüm cihazlarda ortak kurulum kurallarını verir. Cihaza özel adımlar (ör. yazıcı DIP switch, ÖKC ilk kişiselleştirme) kendi dokümanında.

### 8.1 Ağ / Wi-Fi gereksinimleri

| Konu | Standart |
|---|---|
| İnternet | Kararlı, tercihen kablolu WAN; kesintiye karşı 4G/LTE yedeği önerilir |
| Yerel ağ | Yönetilebilir switch + tercihen **VLAN ayrımı** (kasa/ödeme cihazları ayrı segment) |
| Wi-Fi | 2.4/5 GHz; müşteri misafir ağından **ayrı SSID/segment**; ödeme cihazları misafir Wi-Fi'ye bağlanmaz |
| Cloud-direct cihazlar | Tablet, KDS/bar ekranı **doğrudan buluta** bağlanır (WSS/HTTP), `bridgeId = null` |
| Köprü arkası cihazlar | Yazarkasa, ESC/POS yazıcı, kart POS **HummyBox arkasında** (`bridgeId` set) — genel internete doğrudan açılmaz |
| Portlar | Bulut için giden **443 (HTTPS/WSS)**; köprü ile LAN cihazları arası yerel portlar (ör. yazıcı 9100/USB, ÖKC seri/USB) |

**Bağlantı topolojisi ilkesi:**

- **Cloud-direct** (tablet, KDS/bar ekranı): kullanıcıyla etkileşen, internet erişimi olan cihazlar doğrudan bulutla konuşur. Köprüye ihtiyaç duymaz.
- **Köprü arkası (LAN)** (yazarkasa/ÖKC, fiş/mutfak yazıcısı, kart POS terminali, caller ID, çoğu scanner): fiziksel/yerel donanım ile konuşan çevre birimleri **HummyBox** üzerinden erişilir. Köprü; **WSS heartbeat + SQLite offline kuyruk + yazarkasa/ESC-POS/kart-POS sürücüleri** sağlar (Rust daemon `apps/local-bridge-agent`; sürücüler: `yazarkasa_hugin`, `escpos`, `ingenico_iwl`). İnternet koptuğunda komutlar SQLite kuyruğunda birikir, bağlantı gelince sırayla işlenir.

### 8.2 Elektrik / topraklama

- **230 V / 50 Hz**, **topraklı priz zorunlu** (özellikle yazıcı, ÖKC, para çekmecesi, HummyBox). Fiş tipi **CEE 7/4 "Schuko" (Type F)**.
- Kasa/ödeme cihazları için **UPS (kesintisiz güç)** önerilir; en azından ÖKC + fiş yazıcısı + köprü UPS'e alınmalı ki elektrik kesildiğinde açık adisyon/mali işlem kaybolmasın.
- Priz yükü planlanırken cihaz güç değerleri toplanmalı; aynı hat üzerinde ısıtıcı/motor gibi yüksek çekişli ekipmanla ÖKC/yazıcı paylaştırılmamalı (gerilim düşümü ÖKC reset'i yapar).
- Kablolama servis alanından geçirilirken **ıslak/ısıya maruz** güzergâhlardan kaçınılmalı; kablo kanalı kullanılmalı.

### 8.3 Köprü (HummyBox) yerleşimi

- HummyBox, arkasındaki LAN cihazlarına **kısa ve güvenilir** kablo/USB mesafesinde, havalandırmalı, kapalı-kilitli olmayan ama fiziksel erişimi kısıtlı bir yere konumlanır.
- Kalıcı güç (UPS önerilir) ve kararlı LAN uplink'i olmalı.
- Bir köprü, bağlı çevre birimleri için tek arıza noktasıdır; kritik şubelerde yedek köprü/cihaz planı yapılmalı.
- Köprü, buluta **giden WSS** ile bağlanır; içeri açık port gerektirmez (saldırı yüzeyi düşük).

### 8.4 Provizyon ve eşleştirme (pairing) — sistemsel akış

Tüm cihazlar aynı mesh eşleştirme protokolüyle devreye alınır:

1. **Slot oluşturma:** Admin panelden cihaz slotu açılır (veya Mağaza ödemesi sonrası otomatik). Slot açılınca **6 karakterli alfanümerik pairCode** (alfabe A-Z0-9; 36⁶ ≈ 2,2 milyar olasılık) üretilir. Kısıt: pairCode **10 dakika** geçerlidir; **şube başına en çok 10 bekleyen (unprovisioned/claimed) slot** olabilir (spam/hayalet slot koruması).
2. **Cihazda eşleştirme:** Cihaz uygulaması (Tauri kiosk ya da köprü) pairCode ile `POST /v1/devices/pair` çağırır.
3. **Atomik claim:** Sunucu **tek-kullanımlık atomik claim** yapar; aynı pairCode ikinci kez kullanılamaz. Başarılıysa **sha256-hash'li, rotating bearer token** döner (**24 saat TTL**; token yalnızca pair anında verilir, heartbeat token süresini **uzatmaz** — süre dolunca **yeniden pairing** gerekir).
4. **Token güvenliği:** **Ham token yalnızca bir kez** döner ve cihazda saklanır; sunucuda **at-rest sadece hash** tutulur. Token kaybı/çalınmasında yeniden pairing gerekir.
5. **Heartbeat/durum:** İlk heartbeat'te cihaz `online` olur, `lastSeenAt` güncellenir; ~60 sn heartbeat gelmezse `offline` işaretlenir (grace ~45 sn). Sağlıklı cihaz ~10 sn'de bir heartbeat atar.
6. **Provizyon (otomatik):** Mağaza siparişi ödendiğinde, kalem başına deterministik `provisionKey` + advisory-lock ile slot(lar) **idempotent** açılır (`ownership: "sold"`). `cash_drawer/other/service` ve eşlemesi olmayan kategoriler için slot açılmaz.

> **Token TTL — pairCode ile eşleşen cihazlar (kanonik):** Bearer token varsayılan TTL'i **24 saattir** (`DEVICE_TOKEN_TTL_MS`), **yalnızca pair anında** verilir ve bu 24 saatlik TTL **pairCode ile eşleşen `Device.kind`'lar** için geçerlidir (`caller_id`, `scanner`, `yazarkasa` dâhil). **`local_bridge` (köprü) bu 24 saatlik TTL'in HARİCİDİR:** köprü 24 saatlik DEVICE token'ını taşımaz, kendi **30 günlük** bearer token'ını taşır (`LOCAL_BRIDGE_TOKEN_TTL_MS`, varsayılan 30 gün). `heartbeat()` metodu **yalnızca `status` ve `lastSeenAt` alanlarını günceller**; `tokenExpiresAt`'e **dokunmaz** — yani token süresini **UZATMAZ** (kayan/rotating TTL **değildir**). Token, pair'den **24 saat sonra dolar**; süresi dolan token `authenticateToken` tarafından reddedilir. Main/prod dalında token yenileme (refresh) **yoktur**; bu yüzden cihaz devam edebilmek için **yeniden pairing** olmalıdır (yeni 6 karakterli pairCode). **Nadiren etkileşen veya uzun süre çevrimdışı kalan cihazlarda** (yazarkasa, scanner, caller ID) token bu nedenle dolabilir ve **yeniden pairing** gerekir — bu, arıza değil beklenen davranıştır (Bölüm 6.4). *(Not: "heartbeat token süresini uzatır / kayan TTL" davranışı yalnızca henüz **merge edilmemiş** `fix/device-mesh-token-renewal` dalında vardır; prod'da geçerli değildir.)*

> **Bayiye pratik:** Cihazı fiziksel kurduktan sonra panelde slot açın (veya sipariş otomatik açtıysa doğrulayın), pairCode'u cihaz ekranına girin/uygulamada okutun, 10 dk içinde tamamlayın. `online` yeşile dönmüyorsa Bölüm 6.4 tablosuyla ilerleyin — büyük olasılıkla ağ/köprü/TTL, donanım değil.

### 8.5 Güvenlik sertleştirme (hardening)

- **Ağ segmentasyonu:** Ödeme/kasa cihazları müşteri Wi-Fi'sinden ve genel LAN'dan ayrı VLAN'da; köprü arkası cihazlar internete doğrudan açılmaz.
- **Varsayılan parola/erişim:** Switch/router/köprü ve cihaz yönetim arayüzlerinin **varsayılan parolaları değiştirilir**; yönetim arayüzleri LAN dışına kapatılır.
- **Fiziksel güvenlik:** ÖKC, kart POS ve para çekmecesi kurcalamaya karşı korunur; kart POS'ta **kurcalama (tamper)** izi düzenli kontrol edilir.
- **Token/kimlik:** Cihaz token'ları rotating + hash'li; kayıp/çalıntı cihaz panelden `retired` yapılır, pairCode/token geçersizleşir (anti-resurrection).
- **Güncelleme:** Kiosk/köprü yazılımı güncel tutulur (köprüde `firmware_update` komutu); yalnızca imzalı/onaylı sürümler yüklenir.
- **Yedekleme/süreklilik:** Köprünün SQLite offline kuyruğu sayesinde kısa internet kesintilerinde yerel işlem (yazdırma/mali fiş) devam eder; kalıcı kesintiye karşı 4G yedeği önerilir.

---

### Ek: Ortak SLA/kurulum kontrol listesi (bayi için)

- [ ] Her SKU için CE beyanı + (gerekliyse) TSE/ithalat belgesi dosyada.
- [ ] ÖKC GİB onaylı model + ÖKC levhası/sicil + mali hafıza tam.
- [ ] Kart POS ödeme kuruluşu/banka yetkisi ve sertifikalı donanım.
- [ ] Topraklı priz (CEE 7/4 Schuko / Type F) + (kasa hattı) UPS.
- [ ] Ağ segmentasyonu: ödeme/kasa ayrı VLAN, misafir Wi-Fi ayrı.
- [ ] Köprü arkası cihazlar `bridgeId` set; cloud-direct cihazlar `bridgeId = null`.
- [ ] Tüm cihazlar pairing sonrası `online`; heartbeat düzenli.
- [ ] `serialNo`, `warrantyUntil`, `ownership` sisteme doğru girildi.
- [ ] Mesafeli satış sözleşmesi + fatura + garanti belgesi alıcıya iletildi.
- [ ] KVKK aydınlatma metinleri temas noktalarında (QR/tablet/caller ID/kamera) mevcut.
- [ ] Bilgi fişi ↔ mali fiş ayrımı operatöre anlatıldı; GMP-3 fiscal_coupled test edildi.

---

**Kaynaklar (mevzuat referansları — güncel metin için doğrulayınız):**

- [7223 sayılı Ürün Güvenliği ve Teknik Düzenlemeler Kanunu (mevzuat.gov.tr)](https://www.mevzuat.gov.tr/mevzuat?MevzuatNo=7223&MevzuatTur=1&MevzuatTertip=5)
- [Belirli Gerilim Sınırları İçin Tasarlanan Elektrikli Ekipman ile İlgili Yönetmelik (LVD 2014/35/AB — Resmî Gazete, 02.10.2016)](https://www.resmigazete.gov.tr/eskiler/2016/10/20161002-1.htm)
- [Elektromanyetik Uyumluluk Yönetmeliği (EMC 2014/30/AB — Resmî Gazete, 02.10.2016)](https://www.resmigazete.gov.tr/eskiler/2016/10/20161002-2.htm)
- [Telsiz Ekipmanları Yönetmeliği (RED 2014/53/AB — Resmî Gazete, 05.11.2020)](https://www.resmigazete.gov.tr/eskiler/2020/11/20201105-6.htm)
- [Elektrikli ve Elektronik Eşyalarda Bazı Zararlı Maddelerin Kullanımının Kısıtlanmasına İlişkin Yönetmelik (RoHS — Resmî Gazete, 26.12.2022)](https://www.resmigazete.gov.tr/eskiler/2022/12/20221226-2.htm)
- [Atık Elektrikli ve Elektronik Eşyaların Yönetimi Hakkında Yönetmelik (mevzuat.gov.tr)](https://www.mevzuat.gov.tr/MevzuatMetin/yonetmelik/7.5.40055.pdf)
- [6502 sayılı Tüketicinin Korunması Hakkında Kanun (Resmî Gazete, 28.11.2013)](https://www.resmigazete.gov.tr/eskiler/2013/11/20131128-1.htm)
- [Garanti Belgesi Yönetmeliği (Resmî Gazete, 13.06.2014)](https://www.resmigazete.gov.tr/eskiler/2014/06/20140613-2.htm)
- [Mesafeli Sözleşmeler Yönetmeliği (Resmî Gazete, 27.11.2014)](https://www.resmigazete.gov.tr/eskiler/2014/11/20141127-6.htm)
- [6698 sayılı Kişisel Verilerin Korunması Kanunu (mevzuat.gov.tr)](https://mevzuat.gov.tr/mevzuatmetin/1.5.6698.pdf)
- [KVKK — Aydınlatma Yükümlülüğü (kvkk.gov.tr)](https://www.kvkk.gov.tr/Icerik/2033/Aydinlatma-Yukumlulugu-)
- [6493 sayılı Ödeme ve Menkul Kıymet Mutabakat Sistemleri, Ödeme Hizmetleri ve Elektronik Para Kuruluşları Hakkında Kanun (mevzuat.gov.tr)](https://www.mevzuat.gov.tr/mevzuat?MevzuatNo=6493&MevzuatTur=1&MevzuatTertip=5)
- [Yeni Nesil ÖKC — GİB (mevzuat ve GMP-3 teknik kılavuzu)](https://ynokc.gib.gov.tr/Home/Mevzuat)
- [YN ÖKC Teknik Kılavuzu (GİB — güncel sürüm için doğrulayınız)](https://ynokc.gib.gov.tr/Home/Mevzuat)
- [Mesafeli Sözleşmeler Hakkında Bilgilendirme — Ticaret Bakanlığı](https://tuketici.ticaret.gov.tr/yayinlar/tuketici-bilgi-rehberi/mesafeli-sozlesmeler-hakkinda-bilgilendirme)

---

> Son güncelleme: 2026-07-02 - sürüm taslağı. Regülasyon/mali bilgiler bilgilendirme amaçlıdır; güncel resmî mevzuat (GİB, TCMB, KVKK Kurumu, Ticaret Bakanlığı, Çevre-Şehircilik ve İklim Değişikliği Bakanlığı, ilgili yönetmelikler) esastır. (BKM kart sistemleri operatörüdür, lisans mercii değildir.)
