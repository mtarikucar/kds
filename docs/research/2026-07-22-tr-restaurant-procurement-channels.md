# Türkiye Restoran/Kafe Tedarik Kanalları Rehberi (2025-2026)

**Tarih:** 2026-07-22
**Amaç:** `GET /stock-management/guidance` uç noktasının "Kanal Rehberi" içeriğini ve `procurement-guide.data.ts` kural setini beslemek. Her öneri kaynaklıdır; doğrulanamayan iddialar dışarıda bırakılmıştır.
**Yöntem:** Odaklı web araştırması (firecrawl/sonnet ajanları, 7 kaynak-kümesi, 107 aday fatih) → sayısal/yasal iddialarda 3-oy adversarial doğrulama. Yalnızca ≥2/3 CONFIRMED alan yük-taşıyan iddialar ve high/medium güvenli kategori fatihleri kullanıldı. **Çürütülen iddialar** (aşağıda "Dışarıda bırakılanlar") bilinçli olarak hariç tutuldu.

---

## 1. Hacim katmanları (tier) — eşik mantığı

| Katman | Tanım | Sinyal |
|---|---|---|
| **Küçük kafe** (`SMALL_CAFE`) | Tek şube, düşük hacim | 90-günlük satın alma harcaması yıllıklandırılmış aylık < ~150.000 ₺ |
| **Orta restoran** (`MID_RESTAURANT`) | Tek şube, yüksek hacim | Yıllıklandırılmış aylık ≥ ~150.000 ₺ |
| **Çok şubeli** (`MULTI_BRANCH`) | >1 şube | Şube sayısı > 1 |

Eşik (`midTierMonthlySpendTRY = 150000`) gıda enflasyonu ortamına göre kaba bir ayraçtır; kesin bir yasal/sektörel sabit değildir, muhafazakâr tutulmuştur. TÜİK Haziran 2026: gıda ve alkolsüz içecek yıllık **%35,45** artış [S12] — eşiğin zamanla güncellenmesi gerekir.

---

## 2. Kanal profilleri (doğrulanmış)

### 2.1 Cash & Carry (nakit-taşı toptan)
- **Bizim Toptan** — 71 ilde ~180 mağaza, ~13.000 ürün çeşidi, Cash&Carry modeli [S5]. Müşteri portföyü açıkça otel/lokanta/kafe dahil [S6]. **Bireysel üyelik** (işletme belgesi zorunlu değil) ve **ticari üyelik** ayrı [S16] → küçük kafeye erişilebilir. Teslimat: "Bizon" aynı gün min **1.500 ₺** + 74,90 ₺ + ~%3 lojistik (59 il/135 ilçe) [S13]; "Tıkla Kapına Gelsin" min **2.500 ₺** + %4 lojistik [S12b]. Sadakat: Bizim Kart 1 ₺ = 1 puan, min 100 ₺ yükleme [S11].
- **Tespo** — Cash&Carry'nin Türkiye'deki öncüsü (1989, Marmaris), 21 mağaza, %100 yerli [S14]. Müşteri: bakkal/market/otel/restoran/kafe; kategoriler gıda/içecek/temizlik/kişisel bakım [S15].
- **Metro Türkiye — Gastro Servis** — HORECA'ya özel online sipariş+teslimat kanalı, **minimum sipariş 10.000 ₺**, önce hesap yöneticisiyle anlaşma + işletme belgesi/vergi levhası şartı, 25 servis noktası [S1]. Vergi mükellefi Metro Kart bazı üründe %1 KDV [S17]. → **Yüksek giriş bariyeri; orta/büyük restorana uygun, küçük kafeye zor.**
- **İndirim derinliği (kritik gerçek):** Hem Bizim Toptan hem Tespo'da yayınlanan kademeli toptan indirimler **TEK HANELİ** — tekil örnekler %0,8-11, ağırlıklı **%3-7 bandı**; çift-haneli (%15-30) "derin indirim" örneğine rastlanmadı [S2, S7, S10]. Yani cash&carry'nin avantajı derin birim-indirim değil, **erişilebilirlik + tek noktadan geniş sortiman + fatura düzeni**.

### 2.2 Sebze-Meyve Hali (toptancı hali) + üretici/kooperatif
- **Hal rüsumu:** toptancı hali **İÇİNDE %1**, **DIŞINDA %2** — hal dışı oran iki katı; malı **satın alan öder** (Kanun 5957 md.8, Yönetmelik md.44) [S3, S18, S19]. İkincil doğrulama: Ticaret Bakanlığı hal.gov.tr SSS aynı oranları teyit [S20].
- **Komisyoncu:** azami komisyon satış bedelinin **%8**'i; Bakanlık tavanı %4'e indirmeye yetkili; hizmet vermeden komisyon alınamaz [S21].
- **Restoran doğrudan üreticiden alırsa:** münhasıran kendi tüketimi için üreticiden fatura/müstahsil makbuzuyla alan lokanta/otel/yemekhane HKS'de **"bildirimci"dir ve Hal Kayıt Sistemi'ne kaydolmak ZORUNDADIR** [S22, S23]; bu alım hal dışında yapılabilir ama **toptancı haline bildirim şartıyla** [S24] ve üretici-örgütü/organik/ihracat istisnası yoksa yine %1/%2 rüsuma tabidir (otomatik muaf değil) [S25]. Bildirimsiz alım/satımda **cezalı rüsum: bedelin %25'i** [S26].
- **Üretici örgütü (kooperatif/birlik, Bakanlık belgeli):** hal içi ve dışı satışlarından **hal rüsumu alınmaz (tam muafiyet)** [S27]. TCMB analizi: standart domates zincirinde aracı payı ~%45; üretici-örgütü kanallı ideal zincirde ~%28,7'ye, vergi yükü %11,5→%9,4'e iner [S28]. → **Yüksek taze-ürün hacminde kooperatif/üretici-örgütü kanalı yapısal olarak en uygun; hal spot alım orta hacme; küçük kafeye cash&carry + yerel manav pratik.**

### 2.3 Yerel kasap/toptancı + distribütör (et/tavuk/balık/süt)
- Et/süt tedarikçileri (kesimhane, parçalama, süt işleme) restoranın kendi "kayıt" rejiminden daha sıkı **"onay" rejimine** tabidir — tedarikçinin ayrıca resmi yerinde kontrolden geçmiş olması gerekir [S29]. Kasap ve restoran/kafe de kayıtlı olmak zorundadır [S30].
- **Soğuk zincir:** çiğ kırmızı et/tavuk 0…+4°C, balık 0…+2°C, süt <+4°C, donuk -18°C [S31]. Tedarikçide ISO 22000 + soğuk hava deposu + soğutmalı araç filosu "temel gereklilik" [S32].
- **Referans taban fiyat:** ESK karkas I. kalite sığır 331 ₺/kg, kuzu 381 ₺/kg (kamu referansı) [S33]. Toptan tavukta fiyat parça tipine göre (fileto en pahalı, kanat/but orta, sakatat en ucuz) ve hacme göre değişir [S34].
- **Kesimhane izlenebilirliği:** 21 Tem 2026 Resmi Gazete — kesimhanelerde 7/24 kamera + dijital takip zorunluluğu (1 Oca 2027 yürürlük) [S35] → izlenebilirlik artıyor, onaylı tedarikçi tercihi güçleniyor.
- **Pratik:** telefon-sipariş yaygın ama profesyonelde sözleşme/fiyat-teklifi usulü + tedarikçi performans kartı (scorecard) önerilir [S36]. Balık/taze ürün için günlük spot yerine haftalık talep-planlı tedarik [S37].

### 2.4 Online B2B pazaryerleri
- **Bonservis** (Esas Holding) — çoklu-sıcaklık (taze+donuk+kuru) sortiman, ücretsiz teslimat 1-3 iş günü, açık minimum belirtilmemiş, aktif [S38, S39].
- **Toptanmarketi.com** — yalnız kuru/ambiyan; fiyatlar giriş-siz herkese açık; 2.500 ₺+ ücretsiz kargo, siparişlerin %83'ü aynı gün, 81 il [S40].
- **Bidfood Türkiye** (Bidcorp) — 8.000+ HORECA müşteri, 24.000 m² depo (7 bölge), fiyatlar üyeliğe kapalı, MyBidfood uygulaması (canlı stok/fiyat, AI hızlı-sipariş) [S41, S42]. Hem küçük bağımsız hem büyük zincir segmenti [S43].
- **SmartPrep** (Mavate) — şoklu-dondurulmuş RTU B2B ekosistemi [S44]. **CashCarry.tr** — "AI destekli cash&carry pazaryeri", küçük ekspres kargo + paletli toplu sevkiyat aynı platformda [S45].
- → **Online B2B, fiziksel cash&carry'yi dijitalde tamamlar; kuru/standart kalemde fiyat-şeffaflığı (Toptanmarketi) küçük işletmeye, hesap-bazlı katalog (Bidfood) orta/çok-şubeliye uygun.**

### 2.5 Sektör dernekleri (tedarikçi ağı + üye avantajı)
- **TÜRES** üyelerine ambalaj/hijyen-sarf ürünlerinde tedarikçi kampanyası/özel indirim sağlar (STAH/Tork örneği) [S46]. **TURYİD** ayrı "Tedarikçi Üyeler" ağı yürütür [S47]. **ETÜDER** "Güvenilir Tedarikçi Projesi" + "Tedarik Zincirinde Güven Rehberi" [S48]. GGD rehberi (TÜRES/TURYİD/ETÜDER ortak) gıdayla temas eden malzeme + temizlik/dezenfeksiyon tedarikçilerini kapsar [S49].

---

## 3. Ambalaj/Sarf + Temizlik/Hijyen (kategori 6-7)
- Bizim Toptan kataloğunda "Temizlik" (bulaşık/çamaşır/ev/kağıt/sabun) ve "Gıda Dışı → Tek Kullanımlık" ayrı ana kategoriler [S50]. Uzman bölgesel toptancılar (Detay Global, Ünallar) ambalaj+temizliği tek çatıda sunar [S51, S52].
- **Ölçek ekonomisi:** Detay Global — toptan alımda birim fiyat %20-40 düşer; kağıt hijyende %30'a varan tasarruf; 200 odalı otel yıllık 50-80 bin ₺ tasarruf [S53, S54]. Karton bardakta 350.000 adetlik üretimde adet maliyeti ≈0,107 ₺'ye iner [S55].
- **Sipariş sıklığı (kafe ölçeği):** ambalaj/sarf ayda 1-2, temizlik ayda 1 (taze ürün haftada 2-3'ün aksine — uzun raf ömürlü, yüksek-orta stok tamponu) [S56]. Temizlik gıdadan ayrı depolanmalı; gıdayla temas yüzeyi ürünlerinde gıda-güvenliği belgesi istenmeli [S57].
- → **Uzun raf ömürlü olduğundan bu kalemlerde toplu alım en net kazanç; küçük kafe cash&carry, orta/çok-şubeli uzman toptancı/distribütör + çerçeve anlaşma.**

---

## 4. Vergi / e-belge (tüm kategorileri kesen)
- **KDV:** temel gıda (et, süt, yumurta, tahıl/bakliyat, sebze-meyve, ekmek, çay, kahve, şeker) **%1** (I sayılı liste); genel oran **%20**; ÖTV'li işlenmiş (gazlı içecek, meyve suyu, bira) **%10** [S58]. → İçecek kategorisinde girdi KDV'si diğer gıdadan yüksek.
- **e-Fatura:** restoranlar için zorunlu [S30b]. 1 Oca 2026'dan itibaren e-Fatura/e-Arşiv'e kayıtlı olmayanlar tutar gözetmeksizin TÜM faturayı GİB e-Arşiv Portal'dan kesmek zorunda (3.000 ₺ kağıt eşiği kalktı); işletme-hesabı mükellefe 31 Ara 2026'ya kadar geçici kağıt izni [S59]. Genel zorunluluk eşiği 3.000.000 ₺ ciro (e-ticaret 500.000 ₺); aşanlar 1 Tem 2026'ya kadar geçmeli [S60].
- **Tedarikçi doğrulama:** GİB ebelge.gib.gov.tr'de VKN/TCKN ile tedarikçinin e-Fatura mükellefi olup olmadığı sorgulanabilir — **girdi-KDV'nin düzgün belgelenip indirilebilmesi faturanın doğru kanaldan (e-Fatura vs kağıt) kesilmesine bağlı** [S61]. → Rehber, tedarikçi seçiminde e-Fatura mükellefiyetini bir kalite sinyali olarak konumlar.
- **Enflasyon ortamı:** yüksek gıda enflasyonunda (yıllık %35,45 [S12]) **sözleşmeli/çerçeve alım** fiyat öngörülebilirliği sağlar; spot alım esnektir ama volatiliteye açıktır → yüksek hacimli/çok-şubeli için sözleşme, düşük hacimli için spot+planlı.

---

## 5. Öneri matrisi (kanal × kategori × hacim)

Öncelik sırası her hücrede en uygun kanaldan başlar. `1=en uygun`.

| Kategori | Küçük kafe | Orta restoran | Çok şubeli |
|---|---|---|---|
| **Et/Tavuk/Balık** | Yerel kasap/toptancı (güven+esneklik) → cash&carry (donuk) | Onaylı distribütör sözleşmesi + yerel kasap (taze) | Merkezi distribütör çerçeve anlaşması + şube-yerel taze |
| **Sebze-Meyve** | Yerel manav/hal komisyoncusu → cash&carry | Hal (toptancı) spot + planlı | Üretici örgütü/kooperatif (rüsum muaf) + hal |
| **Kuru Gıda/Bakliyat** | Cash&carry (Bizim Toptan/Tespo) | Cash&carry + online B2B (Toptanmarketi) | Distribütör/merkezi + online B2B toplu |
| **Süt/Kahvaltılık** | Cash&carry + yerel distribütör | Onaylı süt distribütörü sözleşmesi | Merkezi distribütör çerçeve |
| **İçecek** | Cash&carry/Tespo (nakit indirim) | Distribütör (marka anlaşması) + cash&carry | Marka distribütör merkezi anlaşma |
| **Ambalaj/Sarf** | Cash&carry | Uzman toptancı (Detay/Ünallar) + online B2B | Uzman toptancı çerçeve + merkezi |
| **Temizlik/Hijyen** | Cash&carry | Uzman toptancı + dernek üye kampanyası (TÜRES) | Uzman toptancı çerçeve + merkezi |

**Kesişen kurallar:** (a) uzun raf ömürlü kalemlerde (kuru gıda, ambalaj, temizlik) toplu/çerçeve alım en net kazanç; taze kalemlerde planlı-sık spot. (b) Çok-şubelide merkezi satın alma (kuru/standart merkezi, taze şube-yerel = hibrit) [S43b]. (c) Tedarikçiyi e-Fatura mükellefiyeti + ISO 22000/onay + scorecard ile seç. (d) Cash&carry avantajı derin indirim değil, erişilebilirlik + fatura düzeni.

---

## 6. Dışarıda bırakılanlar (çürütülen / doğrulanamayan)
- ❌ **Metro Club Kart 60 güne kadar vade + 6 aya kadar taksit + terminaller-arası bakiye aktarımı** — 3/3 REFUTED. Bu vadeye dayanan iki "orta restoran için Metro daha esnek" kıyaslaması da düştü. **Metro için vade/taksit avantajı iddia edilmemektedir.**
- ⚠️ Bizim Toptan HORECA "207 ürün" sayısı araç tarafından sayıldı, sitede açık sayaç doğrulanmadı → yaklaşık kabul.
- ⚠️ Tespo e-Arşiv sayfası HTTP 500 verdi → düşük güven.

---

## 7. Kaynaklar

- **[S1]** Metro Gastro Servis — https://www.metro-tr.com/gastroservis
- **[S2]** Bizim Toptan HORECA (indirim örnekleri) — https://www.bizimtoptan.com.tr/horeca-urunleri
- **[S3]** Sebze-Meyve Ticareti SSS, T.C. Ticaret Bakanlığı — https://ticaret.gov.tr/ic-ticaret/sikca-sorulan-sorular/sebze-ve-meyve-ticareti
- **[S5]** Bizim Toptan Şirket Tarihçesi — https://www.bizimtoptan.com.tr/s/sirket-tarihi-ve-is-tanimi
- **[S6]** Bizim Toptan müşteri portföyü — https://www.bizimtoptan.com.tr/s/sirket-tarihi-ve-is-tanimi
- **[S7]** Tespo içecek kategorisi (kademeli/nakit indirim) — https://eticaret.tespo.com.tr/c/icecek
- **[S11]** Bizim Kart — https://www.bizimtoptan.com.tr/s/bizim-kart-hakkinda
- **[S12]** TÜİK TÜFE Haziran 2026 (gıda %35,45) — https://www.alomaliye.com/2026/07/03/enflasyon-rakamlari-tufe-haziran-2026/ ; TÜİK veri portalı — https://veriportali.tuik.gov.tr/tr/press/58289
- **[S12b]** Bizim Toptan "Tıkla Kapına Gelsin" — https://www.bizimtoptan.com.tr/s/tikla-kapina-gelsin-hakkinda
- **[S13]** Bizim Toptan "Bizon" teslimat — https://www.bizimtoptan.com.tr/s/bizon-teslimati
- **[S14]** Tespo Hakkımızda — https://tespo.com.tr/hakkimizda
- **[S15]** Tespo müşteri segmentleri — https://tespo.com.tr/hakkimizda
- **[S16]** Bizim Toptan Üyelik Sözleşmesi (bireysel/ticari) — https://www.bizimtoptan.com.tr/s/uyelik-sozlesmesi
- **[S17]** Metro SSS (vergi mükellefi %1 KDV) — https://www.metro-tr.com/hakkimizda/sss
- **[S18]** Hal rüsumu %1/%2 (Yönetmelik) — https://mevzuat.gov.tr/MevzuatMetin/yonetmelik/7.5.16340.pdf
- **[S19]** Hal Kanunu 5957 md.8 — https://www.mevzuat.gov.tr/MevzuatMetin/1.5.5957.pdf
- **[S20]** hal.gov.tr Toptancı Halleri SSS — https://www.hal.gov.tr/Sayfalar/ToptanciHalleriSorular.aspx
- **[S21]** Komisyoncu azami %8 (Yönetmelik) — https://mevzuat.gov.tr/MevzuatMetin/yonetmelik/7.5.16340.pdf
- **[S28]** TCMB — Yaş Meyve Sebze Tedarik Zincirinde Fiyat Oluşumu — https://tcmbblog.org/wps/wcm/connect/blog/tr/main+menu/analizler/yas-meyve-sebze-tedarik-zincirinde-fiyat-olusumu
- **[S29]** Onay ve Kayıt kapsamı, Tarım ve Orman Bakanlığı — https://www.tarimorman.gov.tr/Konu/1053/Onay-ve-Kayit-Kapsamina-giren-gida-isletmeleri
- **[S30]** Gıda işletme kayıt (kasap/restoran) — https://www.sngkalite.com.tr/blog/gida-isletme-kayit-belgesi-nasil-alinir-2026-guncel-basvuru-rehberi
- **[S30b]** Restoranda e-Fatura zorunluluğu — https://www.akinsoft.com.tr/blog-detay/restoranlarda-e-fatura-zorunlu-mu--294
- **[S31]** Soğuk zincir saklama sıcaklıkları — https://hijyenakademi.net/blog/soguk-zincir-nedir-gida-isletmeleri-saklama-kurallari
- **[S33]** ESK alım fiyatları — https://www.esk.gov.tr/tr/11931/Alim-Fiyatlari
- **[S34]** Toptan tavuk fiyat dinamikleri — https://www.serpagida.com/toptan-tavuk-fiyatlari/
- **[S35]** Kesimhane kamera/dijital takip zorunluluğu — https://www.daremedya.com/kesimhanelerde-kamera-sistemi-ve-dijital-takip-zorunlu-olacak
- **[S36]** Restoranda satın alma yönetimi (scorecard) — https://narpos.com.tr/blog/restoranlarda-satin-alma-yonetimi-nasil-yapilmalidir/221
- **[S37]** Balık tedariki (planlı) — https://alkarbalik.com/balik-tedarigi/
- **[S38]** Bonservis profil — https://ackfoodsolutions.com/bonservis/
- **[S40]** Toptanmarketi.com — https://toptanmarketi.com/
- **[S41]** Bidfood Türkiye — https://www.bidfood.com.tr/bidfood-turkey?lang=tr
- **[S42]** MyBidfood — https://www.horecamailing.com/index.php/2022/04/22/mybidfood-ile-ev-disi-tuketimde-maliyetler-kontrol-altinda/
- **[S43]** Bidfood müşteri segmentleri — https://www.bidfood.com.tr/custommers?lang=tr
- **[S43b]** Çok-şubeli merkezi satın alma — https://www.robotpos.com/blog_new/cok-subeli-restoran-stok-maliyet-kontrolu
- **[S44]** SmartPrep — https://smartprep.com.tr/
- **[S45]** CashCarry.tr — https://cashcarry.tr/
- **[S46]** TÜRES üye hijyen kampanyası — https://tures.org.tr/guncel/uyelik-avantajlari/stahtan-tures-uyelerine-ozel-hijyen-kampanyasi
- **[S47]** TURYİD tedarikçi üyeler — https://turyid.org/en/
- **[S48]** ETÜDER — https://www.etuder.org.tr/
- **[S49]** GGD Tedarik Zincirinde Güven Rehberi — https://ggd.org.tr/en/wp-content/uploads/2021/05/tedarik_zincirinde_guven_rehberi-1.pdf
- **[S51/S53/S54]** Detay Global toptan temizlik/ambalaj — https://www.detayglobal.com.tr/blog/icerik/otel-restoran-toptan-temizlik-urunleri
- **[S52]** Ünallar Tedarik Market — https://www.unallartedarik.com/
- **[S55]** Karton bardak maliyeti — https://mottocup.com/blog/karton-bardak-maliyeti/
- **[S56/S57]** HORECA kafe tedarik listesi (sıklık/depolama) — https://www.uyargida.com/horeca-ve-kurumsal-mutfak-tedariki/kafe-isletmeleri-icin-temel-tedarik-listesi/
- **[S58]** KDV oranları — https://www.ozdogrular.com.tr/v1/önemli-bilgiler/item/16043-katma-değer-vergisi-oranları_08-09-25
- **[S59]** e-Arşiv 3.000 ₺ eşiği kalkması — https://www.muhasebetr.com/guncelmevzuat/mevzuat_oku.php?mevzuat_id=7116
- **[S60]** e-Fatura zorunluluk eşiği — https://birfatura.com/e-fatura-zorunlulugu/
- **[S61]** GİB e-Fatura mükellef sorgu — https://ebelge.gib.gov.tr/efaturakayitlikullanicilar.html

*Not: Bazı fiyat/oran figürleri kaynak-tarihli anlık değerlerdir (özellikle ESK fiyatları, TÜİK enflasyon, KDV/e-belge eşikleri) ve mevzuat değiştikçe güncellenmelidir. Yasal oranlar (hal rüsumu %1/%2, komisyon %8, KDV %1/%20) birincil mevzuat.gov.tr kaynaklarından doğrulanmıştır.*
