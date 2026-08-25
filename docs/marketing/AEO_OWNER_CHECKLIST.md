# AI görünürlüğü — sizin yapmanız gerekenler

Son güncelleme: 2026-08-25

Aşağıdakiler koddan yapılamaz. Kimlik doğrulama, hesap sahipliği ya da henüz
olmayan müşteriler gerektirir. Repo tarafındaki iş bittiğinde bunlar kalır — ve
asıl kaldıraç bunlardır: ölçülen veriye göre AI alıntılarının yaklaşık %84'ü
başkasının sayfasından gelir; kendi siteniz yüzeyin %10–18'i kadardır.

## 1. Hemen yapılabilir (dakikalar)

- [ ] **Google Search Console** — `landing.hummytummy.com` mülkünü ekleyin,
      doğrulama kodunu prod `.env` dosyasına `GOOGLE_SITE_VERIFICATION=` olarak
      yazın. Kod zaten okunuyor (`landing/src/app/[locale]/layout.tsx`) ve
      compose'a bağlandı; sadece değer eksik. Bu olmadan sitemap hiç
      gönderilmemiş sayılır ve hangi sorgudan geldiğinizi göremezsiniz.
- [ ] Aynı işlemi `hummytummy.com`, `help.hummytummy.com` ve
      `developer.hummytummy.com` için de yapın, her birinin sitemap'ini
      gönderin.
- [ ] **Bing Webmaster Tools** — aynı dört host. Bing, Copilot'u besler ve
      "AI Performance" raporu, AI alıntılarınızı *görebildiğiniz* tek yerdir.
- [ ] **Google İşletme Profili** — kategorisinde görünen tek puan şu an
      rakibinizin.

## 2. Bu ay

- [ ] **Şikayetvar profilini sahiplenin** — ilk şikâyet gelmeden. Bu sayfalar
      `Review` + `AggregateRating` yapılandırılmış verisi yayınlar ve LLM'ler
      tarafından okunur. Ölçülen durum: Adisyo profili sahiplenilmiş ve yanıt
      veriyor; Simpra düşük puanlı ve sahipsiz görünüyor.
- [ ] **YouTube** — ölçülen en güçlü tekil sinyal marka bahsiydi, ve Türkçe
      restoran-teknolojisi video alanı fiilen boş: oradaki sonuçlar 2016 dönemi
      tanıtım videoları.
- [ ] **Teslimat platformu partner listeleri** (Yemeksepeti / Getir / Trendyol /
      Migros) ve GİB özel entegratör ekosistem sayfaları — bu dikeydeki en
      yüksek otoriteli alıntı kaynakları.

## 3. Müşteri geldikçe

- [ ] **Capterra TR / GetApp** — TR restoran-POS dizininde şu an Türk
      satıcılardan yalnızca Simpra listeleniyor. 20–30 gerçek yorum, her motorun
      güvendiği bir yüzeyde ilk üçe taşır.
- [ ] Üçüncü taraf "en iyi / karşılaştırma" listelerine girmek için iletişim.
      Ticari sorgularda AI'ın alıntıladığı sayfalar bunlar, ve neredeyse hepsi
      satıcı kaynaklı — yani editoryal bir kapı değil, bir görüşme meselesi.

## Asla yapılmayacaklar

- Satın alınmış ya da teşvikli yorum yok.
- Gerçek yorum olmadan `aggregateRating` / `Review` yapılandırılmış verisi yok.
  Sıfır müşteriyle bunu yayınlamak uydurma yorum verisi olur: hem politika
  ihlali, hem de ilk denetimde çöker.

## Regresyon riski

- **Cloudflare**: yönetilen AI-crawler bloğu 2026-08-25'te kaldırıldı ve
  doğrulandı. Ancak 15 Eylül 2026'dan itibaren Cloudflare, mevcut ücretsiz
  müşteriler için karma amaçlı AI crawler'larını varsayılan olarak engelliyor.
  Bu ayar bir commit olmadan geri gelebilir; o tarihten sonra tekrar kontrol
  edin:

      curl -A "Mozilla/5.0 (compatible; OAI-SearchBot/1.0)" -o /dev/null \
        -w "%{http_code}\n" https://landing.hummytummy.com/tr

  200 beklenir. 403 görürseniz blok geri gelmiştir.

- **Canonical**: her dağıtımdan sonra çalıştırın —

      node --use-system-ca landing/scripts/canonical-check.mjs https://landing.hummytummy.com

  Sitemap'teki her URL'in kendisini gösterdiğini doğrular. Bu hata bir kez
  sessizce yaşandı: sayfalar doğru render oluyordu ve yalnızca indekslenmemeyi
  istiyorlardı.
