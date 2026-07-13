# Paygo Teams Toplantısı — Brief (Perşembe 16 Temmuz, öğleden sonra)

> Karşı taraf: **Uğur ÖZDEŞ** (📞 0 532 254 13 21) + Paygo ekibi (Hamdi Erol,
> Selçuk AY, Hüseyin BİR, Mahir TÜRK, Recep TURPÇU, Umut UYANMIŞ — hepsi
> @paygoteknoloji.com.tr). Davet Teams üzerinden gelecek (saat Paygo'dan).
> Konu: HummyTummy ↔ Paygo SP630PRO ECR, GMP-3 yazılım entegrasyonu iş ortaklığı.

## Toplantının TEK amacı
Aşağıdaki **5 teslimatı** isim + tarih + sorumluyla bağlamak. Sohbet değil,
teslimat listesi çıkarma toplantısı.

## Bizim durumumuz (kendinden emin anlatılacak)
- Yazılım tarafı **hazır ve test edilmiş** (Phase 0): bulut backend'de Paygo
  kart+fiş sağlayıcıları, on-prem köprüde (Rust) GMP-3 sürücüsü — **gerçek
  çift-yönlü TCP transport + simülatör**; operatör UI'da cihaz kayıt/aktivasyon.
- Güvenli-kapalı: sertifikalı eşleşme gelene kadar hiçbir şey para
  taşımıyor/fiş basmıyor.
- **Mimari karar (C1):** GMP-3 handshake/kripto katmanını kendi yığınımızda
  (Rust) native yazacağız → **C#/C++ SDK runtime'ınıza ihtiyacımız yok**;
  bize **mesaj-eşleme dokümanı + sertifika/handshake parametreleri** yeterli.
  (Bu duruş teknik ciddiyet gösterir; sidecar/SDK ancak C1 tıkanırsa B planı.)
- İstenirse **simülatörle uçtan uca demo** gösterebiliriz: adisyon → kart
  çekimi → mali fiş → Z-raporu (SIM- önekli, para hareketi yok).

## İstenecek 5 teslimat (sırayla masaya koy)
1. **GMP-3 SDK / SP630'a özgü mesaj-eşleme dokümanı.** Netleştir: Linux
   SP-nesli SP630 için hangi kütüphane/doküman geçerli (public IntegrationHub
   Android'e bakıyor)? Hangi dil/format?
2. **Test/geliştirme SP630 ünitesi** (veya resmî simülatör). Müşterinin canlı
   cihazında test ETMEYİZ — bunu açıkça söyle.
3. **GMP-3 katma değerli servis aktivasyonu + TSM firma kodu** (merchant/firma
   provizyonu — süreci kim başlatıyor, ne gerekiyor?).
4. **Yazılı eşleştirme (pairing) yetkisi** ("uyumlu hale getirme" onayı).
5. **PÖKC sertifika zinciri + handshake parametreleri:** DH grubu, AES-CBC+HMAC
   şeması, İşlem Sıra No kuralları, cihazın GMP-3 TCP portu.

## Süreç/ticari sorular
- Onboarding adımları: başvuru formu → değerlendirme → sözleşme → teknik erişim?
  Tipik süre? Maliyet kalemleri (sertifikasyon, test cihazı, yıllık ücret)?
- Belirli bir müşterinin **canlı cihazına** bağlanmak için işletme/banka/Paygo
  tarafında ayrıca onay gerekiyor mu? (Mevcut müşterimiz SP630PRO kullanıyor.)
- Sertifikasyon/kabul testi kim tarafından, hangi ortamda yapılıyor?
- NDA gerekiyorsa: **metni görmeden imza sözü verme** — "inceleyip döneriz".

## Verilecek firma bilgileri (el altında)
- Ünvan: **Beyza Uçar** (şahıs işletmesi) · VKN **8841014310** · Ereğli VD
- Ürün: HummyTummy — bulut restoran POS/adisyon SaaS (hummytummy.com)
- Teknik irtibat: Muhammed Tarık Uçar · admin@hummytummy.com · 0850 840 73 03

## Kırmızı çizgiler
- ❌ "Müşterinin canlı cihazında test edin" → kabul etme (test ünitesi şart).
- ❌ Körlemesine NDA/sözleşme imzası → metni al, incele.
- ❌ SDK-runtime dayatması → C1 duruşunu koru; mesaj dokümanı + parametre iste.

## Başarı ölçütü
Toplantıdan çıkarken elimizde: **isimli teknik muhatap + 5 teslimatın
hangi tarihte geleceği + onboarding'in bir sonraki somut adımı** olacak.

> Teknik derinlik gerekirse referans: `docs/integrations/paygo-token-gmp3-onboarding.md`
> (Phase-0/Phase-1 planı + go-live runbook) ve `apps/local-bridge-agent/src/drivers/gmp3/`.
