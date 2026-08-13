// Homepage FAQ — substantive, honest answers (objection-handling + depth, the
// adisyo technique). Grounded in real behavior; obeys spec §7 guardrails.

export interface QA {
  q: string;
  a: string;
}

export const FAQ: QA[] = [
  {
    q: "Kurulum gerekiyor mu?",
    a: "Hayır. HummyTummy bulut tabanlıdır; hesabınızı açtıktan sonra tarayıcıdan tablet, telefon veya bilgisayarda dakikalar içinde sipariş almaya başlayabilirsiniz. İsterseniz masaüstü kurulum uygulamasıyla yerel yazıcılara da bağlanırsınız.",
  },
  {
    q: "Gerçekten ücretsiz mi, deneme süresi var mı?",
    a: "Deneme süresi yok; çekirdek süresiz ücretsizdir. POS ve adisyon, mutfak ekranı (KDS), menü yönetimi, masa ve kat planı, QR menü, sipariş yönetimi, kasa ve nakit, temel raporlar, ekip ve rol yönetimi, müşteriler, cihaz/şube paneli ve özel markanız kredi kartı istemeden açıktır. Kullanıcı, masa, ürün, kategori ve aylık sipariş sayısı sınırsızdır; ilk şube ücretsizdir. Sadece stok, gelişmiş rapor, rezervasyon, teslimat entegrasyonları gibi ek modülleri ihtiyaç duydukça yıllık olarak eklersiniz.",
  },
  {
    q: "Ücretli modüller nasıl fiyatlanıyor ve nasıl yenileniyor?",
    a: "Ek modüller yıllıktır ve bir yıllık HummyTummy lisansı ön koşuludur — lisans hem satın almak hem kullanmak için gerekir. Lisansı aldığınız gün hesabınızın yıl dönümü olur; yıl içinde eklediğiniz her kalem yıl dönümüne kalan gün kadar orantılı fiyatlanır, böylece tek faturanız ve tek yenileme tarihiniz olur. Tahsilat PayTR üzerinden TRY olarak yapılır. Yenileme manueldir: kart saklamayız, otomatik çekim yapmayız. 30, 7 ve 1 gün kala hatırlatır, ardından 7 gün ek süre tanırız. Ödenmezse yalnızca o ücretli kalemlerin erişimi kapanır — veriniz silinmez, ödeme yapıldığında aynen geri açılır ve ücretsiz çekirdek hiç etkilenmez.",
  },
  {
    q: "Sistemi dolu haliyle, örnek verilerle görebilir miyim?",
    a: "Evet. Ücretsiz hesabınızı açtıktan sonra tek tıkla, örnek menü, masalar ve canlı siparişlerle dolu bir demo restorana geçip POS’u, mutfak ekranını ve raporları gerçek akışıyla deneyebilirsiniz. Ayrıca kurulumda rol bazlı rehberli turlar (yönetici, mutfak, garson) ve adım adım kurulum listesi size eşlik eder.",
  },
  {
    q: "Hangi cihazlarda çalışır?",
    a: "Tarayıcısı olan her cihazda: tablet, telefon ve bilgisayar. QR menü müşterinin kendi telefonunda açılır; personel POS ve mutfak ekranını (KDS) tablet ya da bilgisayardan kullanır.",
  },
  {
    q: "Teslimat platformlarıyla entegre mi?",
    a: "Evet. Yemeksepeti, Getir, Trendyol Yemek ve Migros Yemek siparişleri tek panelde toplanır; siparişleri ayrı ayrı ekranlarda takip etmek zorunda kalmazsınız. Platform entegrasyonu yıllık ücretli bir kalemdir (lisans ön koşuluyla); katalogda Yemeksepeti, Getir ve Trendyol Yemek ayrı ayrı satılır, Migros Yemek ise ayrı bir ürün olarak satılmaz, delivery entegrasyonuna dahildir. Entegrasyon açmadan da siparişleri POS’a kendiniz girip aynı adisyon akışında toplayabilirsiniz — sipariş yönetimi ücretsiz çekirdeğin parçasıdır.",
  },
  {
    q: "e-Fatura kesebiliyor muyum?",
    a: "HummyTummy, Nilvera, Paraşüt, Foriba ve Logo gibi e-dönüşüm sağlayıcılarıyla entegredir. İlgili sağlayıcı hesabınızı tanımladığınızda ödenen siparişler için e-Fatura / e-Arşiv otomatik oluşturulabilir. e-Belge gönderimi yıllık e-Fatura entegrasyonuyla açılır (lisans ön koşuluyla); entegrasyon olmadan satış faturalarınızı sistem içinde oluşturup dışa aktarırsınız.",
  },
  {
    q: "Verilerim güvende mi?",
    a: "Hassas veriler (entegrasyon anahtarları, ödeme tokenları vb.) AES-256-GCM ile, kiracı bazında türetilen anahtarlarla şifrelenir. Parolalar bcrypt ile saklanır, oturumlar httpOnly çerezle korunur ve altyapı Cloudflare arkasında TLS ile çalışır. KVKK süreçleri için gerekli yasal metinler hazırdır.",
  },
  {
    q: "Birden fazla şubem var, hepsini yönetebilir miyim?",
    a: "Evet. Tüm şubelerinizi tek hesaptan yönetir; şube bazlı yetki, menü ve raporlama tanımlarsınız. Şube paneli ücretsiz çekirdeğin parçasıdır ve ilk şube ücretsizdir; ek her şubeyi yıllık Ek Şube kalemiyle (lisans ön koşuluyla) adet adet eklersiniz — 100 şubeye kadar.",
  },
];
