# KDS Pazarlamacı Rehberi

> **Not (Phase-5 ayrışması):** Marketing/pazarlama paneli ve backend'i bu
> repodan ayrılarak bağımsız **kds-marketing** projesine taşındı. Bu rehber
> içerik olarak geçerlidir; kurulum/çalıştırma için kds-marketing reposuna,
> teknik ayrıntılar için `backend/docs/marketing-phase5-split-runbook.md`
> dosyasına bakın.

Bu döküman, KDS Restoran Yönetim Sistemi'ni sahaya çıkaran pazarlama ekibi içindir. Sistemi tanımak, sattığın ürünlerden komisyon kazanmak ve müşteri portföyünü panelden takip etmek için referans olarak kullan.

> **Önce şunu ezberle:** Paket yok, kademe yok, plan yok, deneme süresi yok.
> Çekirdek süresiz ücretsizdir; müşteri sadece ihtiyaç duyduğu ücretli modülü,
> yıllık olarak satın alır. "Hangi paketi alalım?" sorusu artık yok; soru
> "hangi modüle ihtiyacınız var?".

---

## 1. KDS Nedir, Niye Satılır?

KDS, Türkiye'deki kafe ve restoranlar için tek bir hesapta çalışan bir SaaS üründür. Ürünün **çekirdeği ücretsiz ve süresizdir**; işletmenin günlük operasyonunu döndüren her şey buradadır:

- **POS ve adisyon** (kasa, sipariş alma, satış ekranı)
- **Mutfak ekranı (KDS)** — siparişin garson tabletinden mutfak ekranına anlık geçmesi
- **Menü yönetimi**
- **Masa ve kat planı**
- **QR menü**
- **Sipariş yönetimi**
- **Kasa ve nakit**
- **Temel raporlar**
- **Ekip ve rol yönetimi**
- **Müşteriler**
- **Cihaz ve şube paneli**
- **Özel marka ve alan adı (subdomain)**

Bunların hepsi **kredi kartı istenmeden**, **lisans gerekmeden** ve **süre sınırı olmadan** açıktır. Üstelik **kullanıcı, masa, ürün, kategori ve aylık sipariş sayısı sınırsızdır** ve **ilk şube ücretsizdir**.

Ücretli tarafta ise tek tek satın alınan yıllık kalemler var: stok ve maliyet, gelişmiş raporlar, rezervasyon, personel, AI menü stüdyosu, API, teslimat platformu entegrasyonları (Yemeksepeti / Getir / Trendyol Yemek), ÖKC, çağrı-ID, SMS, ek şube. Öncelikli destek ve e-Fatura ayrı kalem değil — Bakım, Destek ve Güncelleme paketinin içinde.

**Neden satması kolay?**

- **Fiyat itirazı en başta ölüyor.** Müşteri hiçbir şey ödemeden gerçek veriyle kullanmaya başlıyor. Sen ürünü değil, ihtiyacı satıyorsun.
- **Sadece kullandığına ödüyor.** Rezervasyon almıyorsa rezervasyon modülüne para vermiyor. Rakiplerin paketinde bu mümkün değil.
- **Kapanacak bir sayaç yok.** "Deneme bitince ne olacak?" endişesi yok; çekirdek kapanmaz.
- **Tek fatura, tek yenileme tarihi.** Hesabın yıl dönümü sabit; müşteri yılda bir kez, tek kalemde öder.
- **Otomatik kart çekimi yok.** Kart saklamıyoruz. Bu, KOBİ'de en sık duyduğun "sonra kartımdan çekmeye başlarsınız" korkusunun cevabı.
- Türkçe arayüz, TR vergi kuralları, PayTR ile TRY tahsilat, 5 dilde arayüz (TR/EN/RU/UZ/AR).

---

## 2. Fiyat Listesi

Tüm fiyatlar **Türk Lirası**, **KDV dahil** ve **yıllıktır** (aksi belirtilmedikçe). Ekranda gördüğün tutar tahsil edilen tutardır; üstüne KDV eklenmez. Katalog superadmin tarafından güncellenebilir — sahada fiyat verirken panelden teyit et.

### Ücretsiz çekirdek — ₺0, süresiz

Yukarıdaki 1. bölümdeki listenin tamamı. Ücreti yok, süresi yok, lisans gerekmiyor, kart istenmiyor.

### Bakım, Destek ve Güncelleme (ücretli tarafın ön koşulu)

| Ürün | Yıllık | İçindekiler |
|---|---:|---|
| **Bakım, Destek ve Güncelleme** | **₺4.900** | Öncelikli destek • e-Fatura (Nilvera) gönderimi • tüm sürüm güncellemeleri • günlük yedekleme |

Ücretli modülleri **hem satın almanın hem de kullanmanın** ön koşuludur. Müşteri sepete bir modül attığında mağaza bu kalemi otomatik ekler. Yenilenmezse ücretli modüllerin erişimi de kapanır — **ücretsiz çekirdek etkilenmez**.

> **Satarken bunu söyle:** bu kalem eskiden "Lisans" adıyla ₺2.990'dı ve tek başına hiçbir şey açmıyordu. Artık içinde öncelikli destek (ayrı satılırken ₺1.990) ve e-Fatura (ayrı satılırken ₺1.990) var. Ayrı ayrı ₺6.970 tutan üç kalem, tek kalemde **₺4.900**. Müşteri ₺2.070 kazanıyor.

### Modüller (yıllık, lisans ön koşuluyla)

| Modül | Yıllık | Ne açar |
|---|---:|---|
| Gelişmiş Rapor & Analitik | **₺1.290** | Detaylı satış/ürün/personel/müşteri analitiği, muhasebe back-office, e-belge ayarları |
| Stok & Maliyet Yönetimi | **₺3.900** | Reçete, sayım, satın alma siparişi, fire takibi, tedarikçi, şubeler arası transfer |
| Rezervasyon Sistemi | **₺990** | Rezervasyon takvimi, müsaitlik hesabı, halka açık online rezervasyon sayfası |
| Personel Yönetimi | **₺990** | Puantaj, vardiya planlama, vardiya değişimi, performans takibi |
| AI Menü Stüdyosu | **₺1.990** | AI ile ürün görseli/video/3D model üretimi, menü OCR içe aktarma (üretimler kontörle harcanır) |
| API & Webhook Erişimi | **₺2.490** | REST API anahtarları, giden webhook'lar |
| Partner Ekran API | **₺1.990** | Üçüncü taraf ekranların menüyü göstermesi için ekran bazlı API |

### Entegrasyonlar (yıllık, lisans ön koşuluyla)

| Entegrasyon | Yıllık | Ne açar |
|---|---:|---|
| Paket Servis Entegrasyonları | **₺2.499** | Yemeksepeti, Getir, Trendyol Yemek ve Migros Yemek siparişleri otomatik POS ve mutfağa düşer |
| ÖKC / Yazarkasa (Hugin) | **₺2.990** | Hugin yazarkasa ile fiş kesimi ve mali rapor senkronizasyonu |
| Çağrı-ID | **₺1.490** | Gelen çağrıda müşteriyi otomatik tanıma, tek tıkla sipariş |
| SMS Bildirimleri | **₺990** | Sipariş/rezervasyon/kampanya SMS'i (gönderimler kontörle harcanır) |

Teslimat artık tek kalem: dört platform (Yemeksepeti, Getir, Trendyol Yemek, Migros Yemek) tek ₺2.499'luk pakette gelir, platform başına ayrı ücret yoktur. Semt entegrasyonu yakında ve pakete **ücretsiz** dahil edilecek.

### Kapasite

| Kalem | Yıllık | Not |
|---|---:|---|
| Ek Şube | **₺3.990 / adet** | İlk şube ücretsiz. Adet adet alınır, en fazla 100 adet |

### Kontör (tek seferlik, süresiz — tükenene kadar geçerli)

| Kontör | Tutar | Ön koşul |
|---|---:|---|
| 100 AI görsel | **₺690** | AI Menü Stüdyosu |
| 20 AI video | **₺890** | AI Menü Stüdyosu |
| 10 AI 3D model | **₺790** | AI Menü Stüdyosu |
| 500 SMS | **₺490** | SMS Bildirimleri |

Kontörler yıllık yenilemeye girmez. Bittiğinde müşteri yenisini alır.

### Hizmet (tek seferlik)

| Hizmet | Tutar | İçerik |
|---|---:|---|
| Yerinde Kurulum & Eğitim | **₺7.500** | Tam gün yerinde kurulum, cihaz devreye alma, personel eğitimi |

### Tipik sepetler (fiyat konuşmasında kullan)

| Profil | Sepet | Yıllık toplam |
|---|---|---:|
| Küçük kafe, sadece kasa istiyor | Hiçbir şey — ücretsiz çekirdek | **₺0** |
| Stok maliyetini kontrol etmek isteyen restoran | Bakım&Destek + Stok & Maliyet | **₺8.800** |
| Rezervasyon alan şehir merkezi restoranı | Bakım&Destek + Rezervasyon + Gelişmiş Rapor | **₺7.180** |
| Paket servis yapan işletme | Bakım&Destek + Yemeksepeti + Getir + Trendyol Yemek | **₺12.370** |
| 3 şubeli zincir | Bakım&Destek + 2 × Ek Şube + Gelişmiş Rapor | **₺14.170** |

Her sepette öncelikli destek ve e-Fatura zaten dahil — ayrıca satmıyorsun, ayrıca ücretlendirmiyorsun.

---

## 3. Faturalama Kuralları (Müşteriye Birebir Anlat)

Bu bölüm satışın en kritik parçası. Yanlış anlatılan tek cümle iptal sebebidir.

- **Yıl dönümü sabittir.** Müşteri Bakım, Destek ve Güncelleme kalemini hangi gün aldıysa o gün hesabın **değişmez yıl dönümüdür**.
- **Yıl içinde alınan kalem orantılı fiyatlanır.** Yıl dönümüne 90 gün kalmışken alınan ₺3.900'lık modül, o 90 gün için fiyatlanır — sonraki yıl dönümünde tam fiyattan yenilenir. Amaç: hesabın tek tarihte toplanması.
- **Yıl dönümüne 14 günden az kalmışsa** kalem sonraki tam döngüye taşınır (kalan gün + bir tam yıl). Kimse 5 günlük bir kalem satın almaz.
- **Hiçbir fatura satırı ₺1'in altına inmez.**
- **Tek fatura, tek yenileme tarihi.** Müşteri yılda bir kez, kalemlerinin tamamını gösteren tek bir faturayla öder.
- **Yenileme MANUELDİR.** Kayıtlı kart yok, otomatik çekim yok. Yıl dönümünden **30, 7 ve 1 gün önce** hatırlatma gider; yıl dönümünden sonra **7 gün ek süre** vardır.
- **Ödenmezse veri SİLİNMEZ.** Ek süre de geçerse yalnızca ücretli kalemlerin **erişimi** kapanır. Menü, sipariş geçmişi, müşteriler, raporlar yerinde durur; ödeme yapıldığında her şey aynen geri açılır. **Ücretsiz çekirdek hiç etkilenmez** — işletme kasa çalıştırmaya devam eder.
- **Tahsilat PayTR üzerinden, yalnızca TRY.** Başka bir ödeme sağlayıcısı yok.
- **Tüm fiyatlar KDV dahildir.** Faturada KDV ayrı kalem olarak ayrıştırılır ama toplam değişmez.

---

## 4. Pazarlamacı Kazanç Modeli

### Komisyon nasıl hesaplanır?

Komisyon, **gerçekleşen bir ödeme** üzerinden yazılır ve sepetin **toplam tutarı** ile sepetteki **en yüksek tutarlı kalemin komisyon oranı** çarpılarak hesaplanır. Varsayılan oran **%10**; superadmin katalogda ürün bazında değiştirebilir.

```
Komisyon = Ödenen sepet toplamı × En yüksek tutarlı kalemin oranı
```

| Sepet | Toplam | Oran | Komisyonun |
|---|---:|:---:|---:|
| Bakım&Destek + Stok & Maliyet | ₺8.800 | %10 | **₺880** |
| Bakım&Destek + Rezervasyon + Gelişmiş Rapor | ₺7.180 | %10 | **₺718** |
| Bakım&Destek + 3 teslimat entegrasyonu | ₺12.370 | %10 | **₺1.237** |
| Bakım&Destek + 2 Ek Şube + Gelişmiş Rapor | ₺14.170 | %10 | **₺1.417** |

**Orantılı fiyat komisyonu da düşürür.** Yıl ortasında eklenen bir modülün faturası orantılı kesilir; komisyon o orantılı tutar üzerinden yazılır. Büyük sepeti yıl dönümüne yakın değil, **yıl dönümünde** kurdur.

### Komisyon tipleri

| Tip | Ne zaman? |
|---|---|
| **SIGNUP** | Ödenen sepette **lisans** varsa — müşterinin ücretli tarafa ilk geçişi (ve yıl dönümü yenilemesi, çünkü lisans da yenilenir) |
| **UPSELL** | Lisansı zaten aktif olan müşteri yıl içinde yeni bir modül/entegrasyon/şube eklediğinde |
| **RENEWAL** | Komisyon defterinin yenileme tipi; yenileme kayıtları bu tiple raporlanır |

Pratikte senin için önemli olan şu: **her ödeme bir komisyon fırsatıdır.** İlk satış tek seferlik bir olay değil; müşteri yıl içinde modül ekledikçe (UPSELL) ve her yıl dönümünde yenileme yaptıkça yeni ödemeler oluşur.

> **Dikkat — komisyonun ödemeye bağlanması:** Komisyon, ödeme kaydına iliştirilmiş
> pazarlamacı referansı üzerinden yazılır. Referans, **ödeme anında** çözülür ve
> kayda **donar**. Bir satışın sana yazıldığını panelinden teyit et; görünmüyorsa
> manager'a `tenant` adı + ödeme tarihi ile yaz, manuel bağlansın. Yıl dönümü
> yenilemelerinde de aynı kontrolü yap — takvimine müşterinin yıl dönümünü işle.

### Komisyon onay akışı

```
Ödeme gerçekleşir → commission yazılır (PENDING)
   ↓
Manager paneline düşer, gözden geçirir
   ↓
APPROVED (manager onayı) — kazancın muhasebe için kesinleşir
   ↓
PAID (manager ödedi işaretler) — hesabına yatırıldı
```

Her durum değişikliği audit log'a düşer ("kim, ne zaman, hangi tutarla onayladı"). Detay panelinde tüm geçmişi görürsün.

---

## 5. Referans Kodu Sistemi (Self-Serve Satış)

Her pazarlamacının panelinde **kişisel referans kodu** vardır (örn. `MRT9X3K`).

### A. Link paylaşımı (en hızlı yol)

Pazarlamacı paneli → Dashboard → ReferralCodeCard üzerinden:

- **Kodu kopyala**: `MRT9X3K`
- **Linki kopyala**: `https://kds.app/?ref=MRT9X3K`

Linki WhatsApp grubuna, Instagram bio'na, e-postaya, kartvizite koy. Müşteri ücretsiz hesabını bu link üzerinden açtığında sana bağlanır.

### B. Manager üzerinden bağlama

Link/kod yolu bir sebeple işlemediyse (tarayıcı cookie'yi bloklamış, müşteri farklı cihazdan kayıt olmuş) satış otomatik sana yazılmaz. Bu durumda manager manuel olarak bağlar. **Bu yüzden 4. bölümdeki teyit adımı zorunludur.**

### Akış (arka planda ne oluyor?)

1. Müşteri `?ref=MRT9X3K` ile gelir.
2. Müşteri ücretsiz hesabını açar → arka planda sana **otomatik bir Lead** yaratılır (kaynak: REFERRAL).
3. Müşteri mağazadan ücretli bir kalem satın alır ve ödeme gerçekleşir → **commission** (PENDING) yazılır + sana bildirim gelir.
4. Müşteri yıl içinde modül eklediğinde → yeni ödeme, yeni komisyon.
5. Yıl dönümünde yenileme ödemesi yaptığında → yenileme komisyonu.

**Yanlış / geçersiz kod ne olur?** Sessizce yok sayılır. Müşterinin ödemesi bloklanmaz, sen de boş bir kayıt almamış olursun. Riziko sıfır.

**Kodumu yenilersem eski satışlarım ne olur?** Referans, ödeme anında **çözülmüş haliyle** kayda donar. Kodunu sonradan yenilesen bile geçmiş satışların sende kalır.

**Müşteri yöneticinin elle dönüştürdüğü bir lead'e zaten sahipse?** Yönetici ataması her zaman kazanır — kodun yarış koşulunda overwrite edilmez.

---

## 6. Pazarlamacı Paneli Turu (`/marketing`)

| Sayfa | Ne yapar? |
|---|---|
| **Dashboard** | Lead sayıları, dönüşüm oranı, aylık özet, referans kodun, lifetime komisyon toplamı |
| **Leads** | CRM — soğuk arama listesi, durum pipeline'ı (NEW → CONTACTED → ... → WON/LOST) |
| **Lead Detail** | Tek müşterinin geçmişi: aramalar, ziyaretler, gönderilen teklifler, açık görevler |
| **Tasks** | "Şu müşteriyi cuma ara" gibi görevler — vadesi gelince hatırlatılır |
| **Calendar** | Görevlerin aylık görünümü |
| **Offers** | Lead'e özel teklif gönder; geçerlilik tarihi (`validUntil`) ver |
| **Commissions** | Tüm komisyon hareketleri — tip, durum, periyot, detay modal |
| **Reports** | Lead kaynak dağılımı, bölgesel performans, conversion funnel (yöneticiye özel) |

### Commission detay modal'da ne var?

Komisyon listesinde bir satıra tıkladığında:

- **Tutar** (büyük, vurgulu)
- **Tip + Durum** badge'leri
- **Müşteri** (tenant adı + subdomain)
- **Ürün ve oran** (örn. Stok & Maliyet, %10)
- **Periyot**
- **Hesaplama**: `Ödenen sepet toplamı × Oran`
- **Bağlı Lead** (kaynağı ve dönüşüm tarihi)
- **Audit Log Timeline**: "Oluşturuldu → Manager X tarafından onaylandı → Manager Y tarafından ödendi"

---

## 7. Sahaya Çıkış Stratejisi

### Satışın yeni şekli: önce kur, sonra sat

Eski modelde "hangi paket?" diye başlıyordun. Artık akış şu:

1. **Ücretsiz hesabı aç ve kurdur.** Menüyü gir, masaları çiz, QR'ı bas. Bu adımda müşteriden tek kuruş istemiyorsun — itiraz yüzeyi sıfır.
2. **İşletmeyi çalışırken izle.** Hangi eksik canını yakıyor? Fire mi veriyor, telefonla rezervasyon mu alıyor, Yemeksepeti tabletiyle mi boğuşuyor?
3. **O eksiğin modülünü sat.** Tek kalem, net fayda, net fiyat. "Fireyi görmek için Stok & Maliyet: yılda ₺3.900 + Bakım&Destek."
4. **Yıl dönümünde genişlet.** Yıl dönümü, orantı kaybı olmadan yeni kalem eklemenin en doğru anıdır.

### Hedef müşteri profili önceliği

1. **Yeni açılan kafe/restoran** — POS henüz yok, ihtiyaç akut, ücretsiz çekirdek "hemen evet" dedirtiyor. En kısa satış döngüsü.
2. **Eski POS'tan şikayetçi olan işletme** — yıllardır güncellenmeyen sistemlerden geçenler. Geçiş riskini ücretsiz çekirdek sıfırlıyor.
3. **Paket servis yapan işletme** — ayrı ayrı platform tabletleriyle uğraşıyorsa teslimat entegrasyonu direkt satılır.
4. **Fire/maliyet derdi olan mutfak** — Stok & Maliyet modülünün en net ROI'si burada.
5. **2+ şube açmak isteyen** — ilk şube ücretsiz, ikinciden itibaren Ek Şube kalemi.

### Soğuk aramada ilk 30 saniye

- "Kasa, mutfak ekranı, QR menü ve masa planı bizde **ücretsiz** — süresiz. Kart bilgisi bile istemiyoruz."
- "Kullanıcı, masa, ürün ve aylık sipariş sayısında sınır yok. İlk şube ücretsiz."
- "Sadece stok, rezervasyon, Yemeksepeti gibi ek ihtiyaçlar ücretli, onları da tek tek, yıllık alıyorsunuz."
- "Türkçe arayüz, KDV dahil fiyat, PayTR ile tahsilat, e-Fatura ve ÖKC entegrasyonu var."

### İtiraz karşılama

- **"Ücretsizse siz nerede kazanıyorsunuz? İşin içinde bir şey olmalı."**
  → Çekirdek gerçekten ücretsiz; biz stok, rezervasyon, gelişmiş rapor, teslimat entegrasyonu gibi **ek modüllerden** kazanıyoruz. İşletmelerin bir kısmı hiç ücretli kalem almıyor ve bizim için sorun değil — büyüdüklerinde ilk akla gelen biz oluyoruz. Fiyat listesi açık, panelde yazıyor; sürpriz kalem yok.

- **"Şimdi ücretsiz diyorsunuz, sonra para istersiniz."**
  → Ücretsiz çekirdeğin kapsamı ürünün içinde tanımlı: POS, mutfak ekranı, menü, masa planı, QR menü, sipariş, kasa, temel raporlar, ekip, müşteriler, cihaz/şube paneli, özel marka. Bunlar kapatılmıyor. Ücretli olan kalemler zaten baştan listede ve ancak siz sepete atarsanız ücretlenir.

- **"Ödeme yapmazsam verilerim silinir mi?"**
  → Hayır. Ödenmeyen bir yenilemede yalnızca **ücretli kalemlerin erişimi** kapanır. Menünüz, sipariş geçmişiniz, müşterileriniz, raporlarınız durur; ödeme yaptığınızda aynen geri açılır. Ücretsiz çekirdek hiç etkilenmez, kasanız çalışmaya devam eder.

- **"Kartımı kaydedip her ay çekmeye başlarsınız."**
  → Kart saklamıyoruz, otomatik tahsilat yapmıyoruz. Yenileme manuel: 30, 7 ve 1 gün kala hatırlatırız, siz ödemeye karar verirsiniz. Ödemezseniz de 7 gün ek süre var.

- **"Aylık ödeyebilir miyim?"**
  → Ücretli kalemler yıllıktır. Bunun karşılığında yıl içinde eklediğiniz her kalem, hesabınızın yıl dönümüne kalan gün kadar orantılı fiyatlanır — yani yılın ortasında alırsanız tam yıl ödemezsiniz, tek faturada tek tarihte toplanırsınız.

- **"Bu 'Bakım, Destek ve Güncelleme' de ne? Modülün fiyatı yetmiyor mu?"**
  → İçinde üç şey var: destek taleplerinizde öncelikli sıra ve garantili yanıt süresi, e-Fatura/e-Arşiv gönderimi ve tüm sürüm güncellemeleri + günlük yedekleme. Bunları ayrı ayrı satsak ₺6.970 tutuyor; tek kalemde ₺4.900. Bir kez alınır, kaç modül eklerseniz ekleyin bir tanedir ve hesabınızın yıl dönümünü belirler.

- **"KDV üstüne binecek mi?"**
  → Hayır. İlan edilen tutarlar KDV dahildir; faturada KDV ayrı gösterilir ama toplam değişmez.

- **"Deneme süresi kaç gün?"**
  → Deneme süresi yok — çekirdek süresiz ücretsiz. İsterseniz kendi verinizi girmeden önce panelden **paylaşımlı demo restoranına** geçip örnek menü, masalar ve canlı siparişlerle sistemi gerçek akışında gezebilirsiniz.

- **"Adisyon yazılımım var, değiştirmek istemem."**
  → Mevcudunuzu kapatmanızı istemiyoruz. Ücretsiz çekirdeği paralel kurun, bir hafta iki sistemi yan yana çalıştırın. Beğenmezseniz hiçbir ücret çıkmaz, çünkü baştan ödeme yok.

- **"İnternet keserse?"**
  → POS offline-first çalışır; internet gelince senkronize olur.

- **"Personelim Türkçe konuşmuyor."**
  → Arayüz TR/EN/RU/UZ/AR.

---

## 8. CRM Disiplinleri

### Lead pipeline'ı (durum geçişleri)

```
NEW → CONTACTED → MEETING_DONE → DEMO_SCHEDULED → OFFER_SENT → WAITING → WON
                                                                       ↘ LOST
```

- Her temas (telefon, ziyaret, WhatsApp) **mutlaka** Activity olarak kaydedilir. "Hatırımda" sayılmaz.
- Teklif gönderdiysen Offer kaydı açılır + `validUntil` belirle. Sistem 30 dakikada bir vadesi geçenleri otomatik EXPIRED'a düşürür.
- Görev (Task) atadığın zaman bir dueDate vermek zorunludur — vadesi yaklaştığında bildirim gider.
- **Yeni disiplin:** Ücretsiz hesabı açan her müşteriye, hesabın **yıl dönümü** ve **hangi modülü konuştuğunuz** notunu düş. Yıl dönümü senin en verimli satış gününü belirler.

### "Lead'i kaybettim" demeden önce

- En az 3 farklı kanaldan (telefon + WhatsApp + e-posta) iletişim denenmemişse LOST'a atma.
- LOST'a atarken `lostReason` zorunlu (örn: `no_budget`, `competitor_chosen`, `closed_business`, `not_reachable`). Bu veri sonraki ayın funnel raporunda görünür.
- **Ücretsiz çekirdeği kurup ücretli kalem almayan müşteri LOST değildir.** O hesap canlıdır ve gelecek yılın en kolay satışıdır. Takipte tut.

### Yöneticinin beklediği

- Haftalık takip: kaç yeni lead, kaç ücretsiz hesap açıldı, kaç ücretli satış, kaç komisyon onayda
- Aylık plan: hedef satış sayısı (hangi modül, hangi şehirde)
- Geri besleme: yenilemeyi yapmayan müşterinin nedeni

---

## 9. Sıkça Sorulan Sorular

**S: Komisyonum ne zaman hesabıma yatıyor?**
A: Komisyon oluştuğunda **PENDING** olarak panelinde görünür. Manager APPROVED'a aldıktan sonra muhasebe sürecine girer. PAID olduğunda hesabına yatmıştır. Tipik olarak ay sonunda toplu ödeme yapılır.

**S: Müşteri sadece ücretsiz çekirdeği kullanıyor, komisyon alır mıyım?**
A: Hayır — komisyon gerçekleşen bir **ödeme** üzerinden yazılır. Ama o hesap kaybedilmiş değildir: işletme büyüdükçe stok, rezervasyon veya teslimat entegrasyonu ihtiyacı doğar. Bu yüzden ücretsiz kurulum yaptığın her hesabı CRM'de canlı tut.

**S: Referans kodum sızdırılırsa ne olur?**
A: Manager panelinden "Kodumu yenile" diyebilirsin. Eski kod ölür, yeni kod aktif olur. Eski linkle gelen **yeni** kayıtlar çözülmez ama geçmiş satışlarının komisyonu sende kalır (referans, ödeme anında çözülüp kayda donar).

**S: Müşteri yenilemeyi yapmazsa geçmiş komisyonum geri alınır mı?**
A: Hayır. Ödenmiş bir kalemin komisyonu ödenmiştir. Sadece o yıl dönümünde yeni bir yenileme ödemesi olmadığı için yeni komisyon yazılmaz.

**S: Müşteri yıl ortasında modül ekledi, komisyonum tam fiyattan mı hesaplanıyor?**
A: Hayır, **fiilen ödenen** tutardan. Yıl ortasında eklenen kalem yıl dönümüne kalan güne göre orantılı fiyatlanır; komisyon o orantılı tutarın üzerinden yazılır. Sonraki yıl dönümünde tam fiyattan yenilenir.

**S: Sepette birden fazla ürün var, hangi oran uygulanıyor?**
A: Sepetteki **en yüksek tutarlı kalemin** oranı, sepetin **toplamına** uygulanır. Varsayılan oran %10.

**S: Müşteriye indirim yapabilir miyim?**
A: Katalog fiyatları superadmin tarafından yönetilir; sen sahada fiyat değiştiremezsin. Lead'e özel bir teklif gerekiyorsa Offers üzerinden kaydını aç ve manager'a danış.

**S: Yöneticim olmadan kendim onay yapabilir miyim?**
A: Hayır. Komisyonlar otomatik olarak PENDING düşer; APPROVE ve MARK_PAID aksiyonları sadece manager rolündedir. Şeffaflık ve denetim için.

**S: Aynı müşterinin tekrar kayıtlanmasını engelliyor musunuz?**
A: Evet — `Lead.convertedTenantId` unique. Aynı tenant'a ikinci bir Lead bağlanmaz. Müşteri eski hesabını silip yenisini açarsa farklı bir tenant olur — kim ilk getirirse o alır.

**S: Komisyon kaybetmemek için ne yapayım?**
A: Üç şey:
1. Müşteriye **link** ver — kod yazmayı unutabilir.
2. Müşterinin hesabının sana bağlandığını **panelden doğrula** (yeni lead göründü mü?). Görünmediyse manuel bağlama için manager'a yaz — ödeme yapılmadan önce.
3. Müşterinin **yıl dönümünü** takvimine işle. Yenileme ve ek modül satışının tamamı o tarihte olur.

---

## 10. İlk Hafta Yapılacaklar

- [ ] **Gün 1**: Pazarlamacı paneline gir, kişisel referans kodunu öğren ve link'ini hazır tut. WhatsApp durumuna, Instagram bio'ya koy.
- [ ] **Gün 1**: 2. bölümdeki fiyat listesini ezberle. Özellikle: neyin ücretsiz olduğu, lisansın ne işe yaradığı, yenilemenin manuel olduğu.
- [ ] **Gün 1**: Bir hesap açıp demo restorana geç, POS akışını bir müşteri gibi tıkla.
- [ ] **Gün 2**: Çevrenden 5 kişiye/işletmeye demo yap. Ücretsiz çekirdeği canlı kur — bu senin en güçlü satış aracın.
- [ ] **Gün 3–5**: Mahallendeki yeni açılan/küçük 10 işletmeyi listele. CRM'e Lead olarak gir.
- [ ] **Gün 5**: İlk 3 ziyaret/aramayı yap, Activity olarak panele kaydet.
- [ ] **Hafta sonu**: Yöneticinle 15 dakikalık görüşme — pipeline'ı birlikte gözden geçirin.

**İlk ay hedefi:** En az **5 ücretsiz kurulum** + **1 ücretli satış** (lisans + en az bir modül). Ücretsiz kurulumlar bir sonraki ayın ücretli satış havuzudur.

---

## 11. Acil Durum / Destek

- **Pazarlamacı paneline erişemiyorum** → manager'a yaz, parola sıfırlatsın
- **Müşterim ödeme yapamıyor (PayTR hatası)** → ekran görüntüsü + hata kodu ile manager'a ulaş, billing ekibi inceler
- **Komisyon yanlış hesaplanmış görünüyor** → komisyon detay modal'ından hesaplamayı kontrol et (`Ödenen sepet toplamı × Oran`). Hâlâ uyuşmuyorsa manager'a `commissionId` ile yaz
- **Satış bana yazılmamış** → ödeme tarihi + tenant adı ile manager'a yaz; manuel bağlama yapılabilir. Bunu ay kapanmadan hallet
- **Referans kodum çalışmıyor** → müşteri linki açtığında DevTools → Application → Cookies değerinde kodun görünmesi gerekir. Görünmüyorsa cookie tarayıcı tarafından bloklanmış olabilir; müşteriyi kaydettikten sonra manager'dan manuel bağlama iste
- **Müşteri "ücretli özelliklerim kapandı" diyor** → yenileme ödenmemiş olabilir. Lisans & Erişim ekranından yenileme durumunu kontrol ettir; ödeme yapıldığında erişim aynen geri açılır, veri kaybı olmaz

---

*Bu döküman canlı bir referanstır. Komisyon oranları, katalog fiyatları veya akışlar değiştiğinde manager güncelleyecektir. Son güncelleme: 2026-08-14.*
