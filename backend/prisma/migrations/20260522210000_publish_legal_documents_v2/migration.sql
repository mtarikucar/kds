-- Publish v2.0 of KVKK / Mesafeli Satış / İade Politikası in Turkish.
-- Idempotent: skipped if (kind, locale, version) already exists.
-- The previous current row (any version, isCurrent=true) is demoted
-- to isCurrent=false so audit history is preserved.
--
-- Document bodies live in backend/prisma/seeds/legal/*.tr.md and are
-- inlined here with PostgreSQL dollar-quoting (no $ in source verified).

BEGIN;

-- Demote any existing current rows in TR locale so the new 2.0 row
-- becomes the single source of truth. Done in one statement so the
-- "exactly one current per (kind, locale)" invariant never breaks
-- mid-migration.
UPDATE legal_documents
   SET "isCurrent" = false, "updatedAt" = NOW()
 WHERE locale = 'tr' AND "isCurrent" = true;

-- KVKK → version 2.0 (tr)
INSERT INTO legal_documents (id, kind, version, locale, title, "bodyMarkdown", "effectiveAt", "isCurrent", "createdAt", "updatedAt")
SELECT gen_random_uuid(), 'KVKK', '2.0', 'tr', 'KVKK Aydınlatma Metni', $kvkk_body$
# KVKK Aydınlatma Metni

**Yürürlük tarihi:** 22 Mayıs 2026
**Versiyon:** 2.0

## 1. Veri Sorumlusu

İşbu Aydınlatma Metni, 6698 sayılı Kişisel Verilerin Korunması Kanunu ("**KVKK**") uyarınca, **HummyTummy** ("Şirket", "biz") tarafından, kişisel verilerinizin işlenme süreçlerine ilişkin olarak hazırlanmıştır. Şirket, KVKK kapsamında **veri sorumlusu** sıfatına haizdir.

- **Ticari unvan:** HummyTummy
- **İletişim adresi:** contact@hummytummy.com
- **Web sitesi:** https://hummytummy.com

## 2. İşlenen Kişisel Veri Kategorileri

Hizmetlerimizi sunabilmek amacıyla aşağıdaki kişisel veri kategorileri işlenebilir:

| Kategori | Veri Türleri |
|---|---|
| **Kimlik bilgileri** | Ad, soyad, T.C. kimlik numarası (faturalandırma için), doğum tarihi |
| **İletişim bilgileri** | E-posta adresi, telefon numarası, açık adres, ülke, şehir |
| **Müşteri işlem bilgileri** | Abonelik geçmişi, fatura bilgileri, ödeme kayıtları, sipariş geçmişi |
| **Finansal bilgiler** | Fatura adresi, vergi numarası, ödeme yöntemi (kart bilgileri PCI-DSS uyumlu ödeme sağlayıcısında saklanır; Şirket'in sunucularında PAN/CVV saklanmaz) |
| **Konum bilgileri** | İşletmenizin adresi, kullanıcıların IP adresi |
| **İşlem güvenliği bilgileri** | Giriş kayıtları, IP adresi, oturum bilgileri, cihaz ve tarayıcı bilgileri |
| **Pazarlama bilgileri** | Çerez verileri, kampanya etkileşimleri, anket cevapları (varsa ve onayınızla) |
| **Çalışan bilgileri** | Sistemi kullanan personel hesaplarına ait ad, e-posta, rol, çalışma vardiyası |
| **Müşteri (sizin müşterinizin) verileri** | Hizmetimiz aracılığıyla sizin tarafınızdan girilen son tüketici (restoran müşterisi) telefon numarası, sipariş içeriği, sadakat puanı |

## 3. Kişisel Verilerin Toplanma Yöntemi ve Hukuki Sebepleri

Kişisel verileriniz aşağıdaki kanallar aracılığıyla toplanmaktadır:

- Web sitemiz veya mobil uygulamamız üzerinden doğrudan tarafınızca girilen veriler
- Hizmet kullanım sürecinde otomatik olarak üretilen sistem kayıtları (log dosyaları)
- Çağrı merkezi, e-posta, sosyal medya ve benzeri iletişim kanalları
- Üçüncü taraf entegrasyonları (ödeme sağlayıcısı PayTR, Google OAuth, vb.)

KVKK Madde 5 ve 6 uyarınca, kişisel verileriniz aşağıdaki **hukuki sebeplere** dayalı olarak işlenmektedir:

1. **Sözleşmenin kurulması ve ifası** — Abonelik sözleşmesinin oluşturulması, hizmetin ifası, faturalandırma
2. **Kanunlarda açıkça öngörülmesi** — Vergi Usul Kanunu, Türk Ticaret Kanunu, Elektronik Ticaretin Düzenlenmesi Hakkında Kanun uyarınca tutulması zorunlu kayıtlar
3. **Hukuki yükümlülüğün yerine getirilmesi** — Resmi mercilere bilgi verme yükümlülükleri
4. **Meşru menfaat** — Hizmet kalitesinin artırılması, dolandırıcılık önleme, ürün geliştirme; ilgili kişinin temel hak ve özgürlüklerine zarar vermemek kaydıyla
5. **Açık rıza** — Pazarlama iletişimi, tanıtım, çerez kullanımı (zorunlu olmayan), profil oluşturma

## 4. Kişisel Verilerin İşlenme Amaçları

- Abonelik sözleşmesinin kurulması, sözleşmeden doğan yükümlülüklerin yerine getirilmesi
- Hesap oluşturma, kimlik doğrulama ve oturum yönetimi
- Faturalandırma, ödeme alma, muhasebe kayıtlarının tutulması
- Müşteri destek talepleri, şikayet ve iade işlemlerinin yürütülmesi
- Hizmetin teknik altyapısının sürdürülmesi, performans izleme, hata ayıklama
- Bilgi güvenliği, sahtekarlık önleme, sistem kötüye kullanımının tespiti
- İletişim ve bildirim faaliyetleri (hizmet bildirimleri, faturalama, güvenlik uyarıları)
- Pazarlama iletişimi (açık rızanızla)
- İstatistiksel analiz, raporlama ve ürün iyileştirme (anonimleştirilmiş veriler üzerinden)
- Yasal yükümlülüklerin yerine getirilmesi, resmi makam taleplerine cevap

## 5. Kişisel Verilerin Aktarımı

Kişisel verileriniz aşağıdaki taraflarla, KVKK Madde 8 ve 9 hükümlerine uygun şekilde paylaşılabilir:

- **İş ortakları ve hizmet sağlayıcıları:** Ödeme sağlayıcısı (PayTR), e-posta gönderim sağlayıcısı, bulut altyapı sağlayıcısı, e-fatura entegratörü
- **Vergi daireleri ve resmi merciler:** Gerekli olduğu durumlarda Maliye Bakanlığı, GİB, Bilgi Teknolojileri ve İletişim Kurumu (BTK) gibi yetkili kamu kurumları
- **Adli ve idari makamlar:** Mahkeme kararı, soruşturma talebi gibi yasal zorunluluklar çerçevesinde
- **Yurt dışı aktarım:** Bulut altyapı hizmeti sağlayıcılarımızın AB ve ABD veri merkezlerinde sunucular bulunmaktadır. Bu aktarımlar KVKK Madde 9 kapsamında, yeterli korumayı sağlayan sözleşmesel taahhütler (SCC) veya açık rızanız doğrultusunda gerçekleştirilmektedir.

Şirket, kişisel verilerinizi pazarlama amaçlı olarak hiçbir üçüncü tarafa satmaz veya kiralamaz.

## 6. Kişisel Veri Sahibinin Hakları (KVKK Madde 11)

KVKK Madde 11 uyarınca aşağıdaki haklara sahipsiniz:

1. Kişisel verilerinizin **işlenip işlenmediğini öğrenme**
2. İşlenmişse buna ilişkin **bilgi talep etme**
3. İşlenme **amacını ve amaca uygun kullanılıp kullanılmadığını** öğrenme
4. Yurt içinde veya yurt dışında **aktarıldığı üçüncü kişileri** bilme
5. **Eksik veya yanlış işlenmiş** olması halinde **düzeltilmesini** isteme
6. KVKK'nın 7'nci maddesinde öngörülen şartlar çerçevesinde **silinmesini veya yok edilmesini** isteme
7. (5) ve (6) numaralı haklar kapsamında yapılan işlemlerin aktarıldığı üçüncü kişilere **bildirilmesini** isteme
8. İşlenen verilerin münhasıran **otomatik sistemler vasıtasıyla analiz edilmesi suretiyle aleyhine bir sonuç ortaya çıkmasına itiraz etme**
9. Kanuna aykırı işleme nedeniyle **zarara uğramanız halinde zararın giderilmesini talep etme**

Bu haklarınızı kullanmak için **contact@hummytummy.com** adresine yazılı başvurabilirsiniz. Başvurunuz, en geç **30 (otuz) gün** içinde ücretsiz olarak sonuçlandırılacaktır. Başvurunuzun yanıtlanması için ek maliyet gerektiren durumlarda, Kişisel Verileri Koruma Kurulu tarafından belirlenen tarifedeki ücret talep edilebilir.

## 7. Saklama Süresi

Kişisel verileriniz, işleme amacının gerektirdiği süre boyunca ve mevzuatın zorunlu kıldığı sürelerce saklanmaktadır. Genel saklama süreleri:

- **Sözleşme ilişkisi süresince:** Aktif abonelik dönemi boyunca
- **Vergi ve ticari kayıtlar:** Vergi Usul Kanunu uyarınca **10 yıl**
- **Elektronik ticari kayıtlar:** Elektronik Ticaretin Düzenlenmesi Hakkında Kanun uyarınca **3 yıl**
- **Pazarlama iletişimi (açık rıza ile):** Rızanın geri alınmasına kadar
- **Çerez verileri:** Çerez tipine göre oturum sonu / 13 ay
- **Log dosyaları:** **2 yıl** (5651 sayılı Kanun çerçevesinde)
- **Müşteri destek kayıtları:** İlgili işlemin kapanmasından itibaren **3 yıl**

Saklama süresinin sonunda veriler silinir, yok edilir veya anonim hale getirilir.

## 8. Veri Güvenliği

Şirket, kişisel verilerin hukuka aykırı işlenmesini, erişilmesini önlemek ve muhafazasını sağlamak için, teknolojik imkanlar ve uygulama maliyetleri göz önünde bulundurularak, makul düzeyde idari ve teknik tedbirler almaktadır. Bu tedbirler arasında **şifreleme, erişim kontrolü, güvenlik denetimleri, veri yedekleme, çalışan gizlilik taahhütleri** bulunmaktadır.

## 9. Aydınlatma Metni Değişiklikleri

Şirket, bu Aydınlatma Metni'ni KVKK'da ve sair mevzuatta yapılacak değişikliklere paralel olarak güncelleme hakkını saklı tutar. Güncel metin daima https://hummytummy.com/legal/kvkk adresinde yayınlanır. Önemli değişiklikler kullanıcılara önceden bildirilir.

## 10. İletişim

Kişisel verilerinize ilişkin her türlü soru, talep ve şikayetlerinizi aşağıdaki kanallar üzerinden iletebilirsiniz:

- **E-posta:** contact@hummytummy.com
- **Web:** https://hummytummy.com/contact

---

*Bu Aydınlatma Metni, 6698 sayılı KVKK ve ilgili mevzuat uyarınca hazırlanmıştır. Kişisel verileriniz ile ilgili haklarınızı her zaman kullanma özgürlüğüne sahipsiniz.*
$kvkk_body$, NOW(), true, NOW(), NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM legal_documents WHERE kind = 'KVKK' AND locale = 'tr' AND version = '2.0'
);

-- DISTANCE_SALES → version 2.0 (tr)
INSERT INTO legal_documents (id, kind, version, locale, title, "bodyMarkdown", "effectiveAt", "isCurrent", "createdAt", "updatedAt")
SELECT gen_random_uuid(), 'DISTANCE_SALES', '2.0', 'tr', 'Mesafeli Satış Sözleşmesi', $distance_body$
# Mesafeli Satış Sözleşmesi (Abonelik Hizmet Sözleşmesi)

**Yürürlük tarihi:** 22 Mayıs 2026
**Versiyon:** 2.0

## 1. Taraflar

### 1.1. Hizmet Sağlayıcı ("Şirket")

- **Ticari unvan:** HummyTummy
- **Web sitesi:** https://hummytummy.com
- **İletişim adresi:** contact@hummytummy.com

### 1.2. Üye / Müşteri ("Üye")

Şirket'in sunduğu hizmetleri kullanmak üzere abonelik talebinde bulunan, kayıt sırasında kimlik ve iletişim bilgilerini Şirket'e bildiren gerçek veya tüzel kişi.

## 2. Sözleşmenin Konusu ve Kapsamı

İşbu sözleşme, Şirket'in sunduğu **bulut tabanlı restoran ve kafe yönetim yazılımı** ("Hizmet") hizmetinin Üye tarafından, internet üzerinden mesafeli olarak satın alınması ve kullanılmasına ilişkin tarafların hak ve yükümlülüklerini düzenler.

Hizmet kapsamı, Üye'nin seçtiği **abonelik planına** göre değişmekle birlikte, asgari olarak aşağıdaki modülleri içerir:

- Satış noktası (POS) yönetimi
- Sipariş ve kasa yönetimi
- Menü ve ürün yönetimi
- Masa ve rezervasyon yönetimi
- QR menü
- Mutfak ekran sistemi (KDS)
- Stok takibi (planın kapsamına göre)
- Raporlama ve analitik
- Çalışan yönetimi (planın kapsamına göre)

Güncel plan içerikleri ve fiyatlandırma Şirket'in web sitesinde https://hummytummy.com/pricing adresinde yayınlanmaktadır.

## 3. Sözleşmenin Süresi ve Yenilenmesi

3.1. Sözleşme, Üye'nin abonelik bedelini ödeyip Hizmet'i kullanmaya başladığı tarihte yürürlüğe girer.

3.2. Abonelik süresi, Üye'nin seçtiği plana göre **aylık** veya **yıllık** olarak belirlenir.

3.3. Abonelik süresi sona ermeden önce taraflarca aksi bildirilmediği sürece, Şirket'in sunduğu plan ve fiyatlar üzerinden **otomatik olarak yenilenir**. Üye, yenileme tarihinden önce hesap ayarları üzerinden veya **contact@hummytummy.com** adresine e-posta göndererek otomatik yenilemeyi iptal edebilir.

3.4. Otomatik yenileme sırasında abonelik ücretinde değişiklik olması halinde, Üye **en az 30 (otuz) gün önce** e-posta ile bilgilendirilir.

## 4. Ücret ve Ödeme

4.1. Hizmet bedeli, seçilen abonelik planına göre belirlenir. Tüm fiyatlara KDV dahildir, aksi web sitesinde belirtilmedikçe Türk Lirası (TL) cinsindendir.

4.2. Ödemeler, Şirket'in entegre olduğu ödeme sağlayıcısı **PayTR** üzerinden, kredi kartı veya banka kartı ile gerçekleştirilir. Kart bilgileri **Şirket'in sunucularında saklanmaz**; PCI-DSS sertifikalı ödeme sağlayıcısında güvenli ortamda tutulur.

4.3. Üye, ödeme bilgilerinin doğruluğundan ve geçerliliğinden bizzat sorumludur. Ödemenin gerçekleşmemesi durumunda Şirket, Üye'ye **7 (yedi) gün** süre vererek borcun ödenmesini talep eder. Bu süre içinde ödeme yapılmaması halinde Şirket, Hizmet erişimini askıya alma veya sözleşmeyi feshetme hakkına sahiptir.

4.4. Fatura, ödeme sonrasında e-posta ile Üye'ye iletilir ve hesap üzerinden de erişilebilir.

## 5. Hizmetin Sunulması ve SLA

5.1. Şirket, Hizmet'i **%99,5 yıllık kullanılabilirlik (uptime)** hedefiyle sunmayı taahhüt eder. Planlı bakım çalışmaları en az 48 saat önceden duyurulur ve mümkün olduğunca düşük trafikli saatlerde yapılır.

5.2. Plansız kesintilerde Şirket, sorunun giderilmesi için makul çabayı gösterir. Süresi 4 saati aşan kesintilerde, etkilenen süre kadar abonelik **uzatılır** (önceki dönemden mahsuplama).

5.3. Şirket, Hizmet'i **olduğu gibi** (as-is) sunar. Üye'nin özel iş ihtiyaçlarına özel uyarlamalar, ek sözleşme konusudur.

## 6. Üye'nin Yükümlülükleri

6.1. Üye, kayıt sırasında verdiği bilgilerin doğru, güncel ve eksiksiz olduğunu beyan eder. Bilgilerde değişiklik olduğunda hesap ayarlarından güncellemekle yükümlüdür.

6.2. Üye, hesabını ve şifresini gizli tutmakla, üçüncü kişilerle paylaşmamakla yükümlüdür. Hesabından gerçekleştirilen tüm işlemlerden Üye sorumludur.

6.3. Üye, Hizmet'i:
- Yürürlükteki mevzuata uygun şekilde,
- Üçüncü kişilerin haklarına saygılı olarak,
- Şirket'in sistemlerine ve diğer kullanıcılara zarar vermeyecek biçimde
kullanmayı taahhüt eder.

6.4. Üye, Hizmet aracılığıyla işlediği son tüketici (müşteri) verilerinin **veri sorumlusu** sıfatını taşıdığını ve bu verilerin KVKK ve ilgili mevzuata uygun toplanmasından, işlenmesinden, gerekirse silinmesinden sorumlu olduğunu kabul eder. Şirket bu verilere yalnızca **veri işleyen** sıfatıyla, Hizmet'in sunulması amacıyla erişir.

## 7. Cayma Hakkı

7.1. **Tüketici Sıfatıyla:** 6502 sayılı Tüketicinin Korunması Hakkında Kanun ve Mesafeli Sözleşmeler Yönetmeliği uyarınca, Üye'nin tüketici sıfatıyla hareket ettiği hallerde, Hizmet'in ifasına başlanmadan önce **14 (on dört) gün** içinde herhangi bir gerekçe göstermeksizin ve cezai şart ödemeksizin cayma hakkına sahiptir.

7.2. **Hizmet İfasından Sonra:** Mesafeli Sözleşmeler Yönetmeliği Madde 15(1)(ğ) uyarınca, **tüketicinin onayı ile ifasına başlanmış olan dijital içeriklerin / hizmetlerin sunulması sözleşmelerinde cayma hakkı kullanılamaz**. Üye, abonelik başlangıcı ile birlikte Hizmet'in ifasının başladığını ve cayma hakkının sona erdiğini kabul eder.

7.3. **B2B Kullanım:** Üye'nin tüzel kişi veya ticari/mesleki amaçla hareket eden gerçek kişi olması halinde, Tüketici Kanunu hükümleri uygulanmaz; sözleşmenin feshi Madde 8 hükümlerine tabidir.

7.4. Cayma hakkının kullanılması durumunda, ödenmiş tutar Üye'ye **14 (on dört) gün** içinde, ödemenin yapıldığı yöntem üzerinden iade edilir.

## 8. Sözleşmenin Feshi

8.1. **Üye Tarafından Fesih:** Üye, herhangi bir gerekçe göstermeksizin sözleşmeyi feshedebilir. Fesih, mevcut fatura dönemi sonunda yürürlüğe girer. Mevcut dönem için ödenmiş tutar, **İade Politikası** çerçevesinde değerlendirilir.

8.2. **Şirket Tarafından Fesih:** Şirket aşağıdaki hallerde sözleşmeyi tek taraflı feshedebilir:
   - Üye'nin ödeme yükümlülüklerini yerine getirmemesi (Madde 4.3'teki süreye uyulmaması)
   - Üye'nin Madde 6.3'teki yükümlülüklere aykırı davranması
   - Üye'nin Hizmet'i kötüye kullanması, dolandırıcılık girişimi, üçüncü tarafların haklarını ihlal etmesi
   - Yasal zorunluluklar

Şirket, bu hallerde Üye'ye **e-posta ile bildirimde bulunarak** sözleşmeyi feshedebilir; ağır ihlal hallerinde ön bildirimsiz fesih hakkı saklıdır.

8.3. Fesih halinde Üye, hesabındaki verileri **30 (otuz) gün** içinde dışa aktarabilir. Bu süre sonunda veriler, mevzuatta öngörülen saklama süreleri dışında **silinir**.

## 9. Sorumluluk Sınırlamaları

9.1. Şirket'in işbu sözleşme kapsamındaki toplam sorumluluğu, **olayın gerçekleştiği takvim yılındaki Üye'nin Şirket'e ödediği toplam tutar** ile sınırlıdır.

9.2. Şirket, dolaylı zararlar (kar kaybı, iş kaybı, itibar zararı, veri kaybı vb.) için sorumlu tutulamaz.

9.3. Şirket'in sorumluluğu, **kasıt veya ağır kusur** halinde sınırlamaya tabi değildir.

9.4. **Mücbir sebep** halleri (deprem, sel, savaş, salgın, internet altyapısı arızası, üçüncü taraf hizmet sağlayıcılarının kesintileri, yasal düzenlemeler) Şirket'in sorumluluğunu doğurmaz.

## 10. Kişisel Verilerin Korunması

İşbu sözleşme kapsamında işlenen kişisel veriler, **KVKK Aydınlatma Metni**'nde (https://hummytummy.com/legal/kvkk) açıklandığı şekilde işlenir. Üye, abonelik başlatarak aydınlatma metnini okuduğunu ve KVKK kapsamındaki haklarına ilişkin bilgilendirildiğini beyan eder.

## 11. Bildirimler

11.1. Şirket'in Üye'ye yapacağı her türlü bildirim, Üye'nin sistemde kayıtlı **e-posta adresine** gönderilir ve Üye'ye iletilmiş sayılır.

11.2. Üye'nin Şirket'e yapacağı bildirimler, **contact@hummytummy.com** adresine gönderilen e-posta ile geçerlilik kazanır.

## 12. Anlaşmazlıkların Çözümü ve Uygulanacak Hukuk

12.1. İşbu sözleşmenin yorumu ve uygulanmasında **Türkiye Cumhuriyeti hukuku** geçerlidir.

12.2. **Tüketici uyuşmazlıkları** için Tüketici Hakem Heyetleri ve Tüketici Mahkemeleri yetkilidir. Bakanlıkça ilan edilen değer ve parasal sınırlar çerçevesinde başvuru hakkı saklıdır.

12.3. **Ticari uyuşmazlıklar** için **İstanbul Merkez (Çağlayan) Mahkemeleri ve İcra Daireleri** münhasıran yetkilidir.

12.4. Taraflar, anlaşmazlık halinde **arabuluculuğa başvuru** yükümlülüğüne ilişkin mevzuatı saklı tutar.

## 13. Sözleşmenin Bütünlüğü ve Değişiklikler

13.1. İşbu sözleşme, taraflar arasındaki tam ve nihai anlaşmayı oluşturur. Önceki yazılı veya sözlü görüşmeler hükümsüzdür.

13.2. Şirket, sözleşmeyi tek taraflı olarak değiştirme hakkını saklı tutar. Değişiklik halinde Üye'ye **en az 30 (otuz) gün** önce e-posta ile bildirimde bulunulur. Üye değişikliği kabul etmediğini bildirmediği takdirde, yeni sözleşme hükümleri geçerli olacak; kabul etmemesi halinde sözleşme, mevcut fatura dönemi sonunda kendiliğinden sona erer.

13.3. Sözleşmenin herhangi bir hükmünün geçersiz olması, diğer hükümlerin geçerliliğini etkilemez.

## 14. Yürürlük ve Onay

İşbu Mesafeli Satış Sözleşmesi, **14 (on dört) madde** ve eklerinden ibarettir. Üye'nin abonelik akışında "Okudum, Onaylıyorum" beyanında bulunması ile sözleşme yürürlüğe girer.

Onay aynı zamanda **KVKK Aydınlatma Metni** ve **İade Politikası**'nın da okunduğunu ve kabul edildiğini kapsar.

---

*HummyTummy — Restoran Yönetimi için Modern POS Sistemi*
*Sözleşmenin son güncel hali: https://hummytummy.com/legal/distance-sales*
$distance_body$, NOW(), true, NOW(), NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM legal_documents WHERE kind = 'DISTANCE_SALES' AND locale = 'tr' AND version = '2.0'
);

-- REFUND_POLICY → version 2.0 (tr)
INSERT INTO legal_documents (id, kind, version, locale, title, "bodyMarkdown", "effectiveAt", "isCurrent", "createdAt", "updatedAt")
SELECT gen_random_uuid(), 'REFUND_POLICY', '2.0', 'tr', 'İade Politikası', $refund_body$
# İade Politikası

**Yürürlük tarihi:** 22 Mayıs 2026
**Versiyon:** 2.0

## 1. Kapsam

İşbu İade Politikası, **HummyTummy** ("Şirket") tarafından sunulan abonelik bazlı bulut yazılım hizmetleri ("Hizmet") için iade ve ücret iadesi koşullarını düzenler. Politika, Mesafeli Satış Sözleşmesi'nin (https://hummytummy.com/legal/distance-sales) ayrılmaz bir parçasıdır.

## 2. Genel İlkeler

2.1. Şirket, müşteri memnuniyetini önemser ve adil bir iade süreci yürütmeyi taahhüt eder.

2.2. İade talepleri **contact@hummytummy.com** adresine yazılı olarak iletilir ve **en geç 14 (on dört) iş günü** içinde değerlendirilir.

2.3. Onaylanan iadeler, ödemenin yapıldığı yöntem üzerinden (kredi kartı / banka kartı), genellikle **5-14 iş günü** içinde gerçekleştirilir. Bankanızın işlem süresi nedeniyle hesabınıza yansıma süresi değişebilir.

## 3. Deneme Süresi (Trial)

3.1. Şirket, yeni kullanıcılara seçilen plan kapsamında ve plan başına en fazla bir kez olmak üzere **ücretsiz deneme süresi** (genellikle 14 gün) sunar. Bu süre içinde Hizmet, herhangi bir ücret tahsil edilmeksizin kullanılabilir.

3.2. Deneme süresi sonunda otomatik geçiş yapılmadıkça **ücretlendirme başlamaz**. Otomatik geçişi devre dışı bırakmak için hesap ayarlarındaki ilgili seçeneği kullanabilirsiniz.

3.3. Deneme süresi boyunca herhangi bir aşamada hesabı silebilir, abonelik bağlamı oluşturmayabilirsiniz; bu durumda hiçbir ücret tahakkuk etmez.

## 4. Cayma Hakkı (Tüketici Sıfatı)

4.1. **Tüketici sıfatıyla** hareket eden Üye'ler için, 6502 sayılı Tüketicinin Korunması Hakkında Kanun ve Mesafeli Sözleşmeler Yönetmeliği'nin sağladığı **14 günlük cayma hakkı** saklıdır; ancak:

4.2. **Önemli istisna:** Mesafeli Sözleşmeler Yönetmeliği Madde 15(1)(ğ) uyarınca, "**tüketicinin onayı ile ifasına başlanan dijital içerik / hizmet sözleşmelerinde cayma hakkı kullanılamaz**". Üye, abonelik başlatma sırasında bu istisnayı açıkça onaylar.

4.3. Buna karşın, Şirket **iyi niyet uygulaması** olarak, abonelik başlangıcından sonra **7 (yedi) gün** içinde yapılan talepleri **gerekçesiz** olarak tam iade ile değerlendirir. Bu süre, ödeme tarihinden başlar.

4.4. Birinci abonelik döneminden sonra başlatılan yeni abonelikler (yenileme, plan yükseltme) için 7 günlük gerekçesiz iade hakkı yeniden başlamaz; sonraki dönemlerin iadesi Madde 5 ve 6 hükümlerine tabidir.

## 5. Aylık Abonelik İadeleri

5.1. **Mevcut fatura dönemi:** Aylık abonelikte, aboneliğin iptal edilmesi durumunda mevcut fatura dönemi sonuna kadar Hizmet kullanılabilir; **mevcut dönem için ödenmiş tutar iade edilmez**.

5.2. **Bir sonraki dönem:** Otomatik yenileme, fatura döneminin sonundan önce iptal edilirse, bir sonraki dönem için **hiç ücret tahsil edilmez**.

5.3. **Yanlışlıkla ödeme:** Yanlışlıkla yapılan ödemeler (mükerrer ödeme, hatalı plan seçimi vb.) **kabul tarihinden itibaren 7 gün içinde bildirilirse** tam iade ile değerlendirilir.

## 6. Yıllık Abonelik İadeleri

6.1. **İlk 30 gün — tam iade:** Yıllık abonelik başlangıcından sonra ilk **30 (otuz) gün** içinde yapılan iade talepleri, **tam tutar üzerinden** karşılanır. Kullanılan süreye bakılmaksızın.

6.2. **30 gün — 6 ay arası — orantısal iade:** İlk 30 gün ile 6'ncı ay sonuna kadar yapılan iade taleplerinde, kullanılmamış süreye orantılı iade yapılır. Kullanılmış süre **aylık plan fiyatı** üzerinden hesaplanır (yıllık plandaki indirim mahsup edilir).

   **Örnek:** Yıllık plan 12.000 TL, aylık plan 1.200 TL. 4 ay kullandıktan sonra iade talebi: `12.000 - (4 × 1.200) = 7.200 TL` iade.

6.3. **6 ay sonrası:** 6'ncı ayın bitiminden sonra yapılan iade taleplerinde **iade yapılmaz**, ancak Üye'nin makul gerekçesi olması halinde Şirket, **kalan süre için hizmet kredisi** sunabilir.

## 7. Plan Değişiklikleri

7.1. **Plan yükseltme (upgrade):** Daha yüksek bir plana geçişte, kullanılmamış süreye orantılı tutar yeni planın bedelinden **mahsup edilir**; ek ücret tahakkuk eder.

7.2. **Plan düşürme (downgrade):** Daha düşük bir plana geçiş, mevcut fatura döneminin sonunda yürürlüğe girer; mevcut dönem için iade yapılmaz, ancak yeni plan ücreti bir sonraki dönemden itibaren uygulanır.

## 8. İade Yapılamayan Haller

Aşağıdaki durumlarda iade talebi reddedilir:

- Aboneliğin **kötüye kullanılması** (Mesafeli Satış Sözleşmesi Madde 6.3'e aykırı kullanım)
- Üye'nin **ödeme bilgilerini yanıltıcı şekilde** sağlaması, **chargeback** açması ve sonra iade talebinde bulunması
- Madde 6.3'te belirtilen sürelerin **aşılması**
- **Üçüncü taraf** araçları aracılığıyla yapılan satın almalar (App Store, Play Store gibi — bu durumda ilgili platformun iade politikası uygulanır)
- Şirket'in özel **kampanya/promosyon** kapsamında %50'nin üzerinde indirimli alınmış abonelikler (kampanya koşullarında aksi belirtilmedikçe)

## 9. Servis Kesintileri Nedeniyle Telafi

9.1. Mesafeli Satış Sözleşmesi Madde 5.2 uyarınca, planlı olmayan kesintilerin süresi **4 saati aştığında**, etkilenen süre kadar abonelik **uzatılır**.

9.2. Aylık planda **24 saati**, yıllık planda **toplam 72 saati** aşan kesintilerde, talebe bağlı olarak orantısal nakdi iade uygulanabilir.

9.3. Bu telafiler, **Şirket'in kontrolünde olan kesintiler** için geçerlidir. Üçüncü taraf hizmet sağlayıcılarının (internet servis sağlayıcı, ödeme sağlayıcı, vb.) veya mücbir sebeplerden kaynaklanan kesintiler kapsam dışındadır.

## 10. İade Talebi Süreci

İade talebinde bulunmak için aşağıdaki bilgileri **contact@hummytummy.com** adresine iletmenizi rica ederiz:

1. Hesap e-postanız ve abonelik kimliğiniz
2. İade talebinizin gerekçesi
3. İade tercih ettiğiniz tutar (kısmi iade ise)
4. Varsa destekleyici belgeler (ekran görüntüleri, fatura, kesinti raporu vb.)

Şirket, talebinizi:
- **24 saat** içinde aldığını teyit eder
- **3 iş günü** içinde ön değerlendirmesini yapar
- **14 iş günü** içinde nihai kararını bildirir

## 11. Vergi ve KDV

İade tutarları, ödeme sırasında kesilen **KDV dahil** brüt tutarlar üzerinden hesaplanır. KDV iadesi, Şirket tarafından e-fatura tadili ile yapılır.

## 12. Anlaşmazlık Çözümü

12.1. İade taleplerine ilişkin anlaşmazlıkların öncelikle **dostane** çözümü esastır.

12.2. Anlaşma sağlanamadığı durumda Mesafeli Satış Sözleşmesi Madde 12'deki yargı yetki kuralları geçerlidir.

12.3. Tüketici sıfatıyla hareket eden Üye'ler, ilgili **Tüketici Hakem Heyetlerine** başvuru hakkını saklı tutar.

## 13. Politika Değişiklikleri

İşbu İade Politikası, mevzuat değişikliklerine ve iş süreçlerinin gerektirdiği durumlara göre güncellenebilir. Önemli değişiklikler, Üye'lere **en az 30 (otuz) gün** önce e-posta ile bildirilir. Güncel metin daima https://hummytummy.com/legal/refund-policy adresinde yayınlanır.

---

*HummyTummy — Restoran Yönetimi için Modern POS Sistemi*
*Sorularınız için: contact@hummytummy.com*
$refund_body$, NOW(), true, NOW(), NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM legal_documents WHERE kind = 'REFUND_POLICY' AND locale = 'tr' AND version = '2.0'
);

COMMIT;
