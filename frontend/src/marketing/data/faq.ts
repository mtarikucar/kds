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
    q: "7 günlük ücretsiz deneme nasıl işliyor?",
    a: "Kayıt olduğunuzda hesabınız 7 gün boyunca tüm özellikler açık şekilde başlar ve kredi kartı istemeyiz. Deneme bitince dilediğiniz ücretli plana geçerek devam edersiniz.",
  },
  {
    q: "Hangi cihazlarda çalışır?",
    a: "Tarayıcısı olan her cihazda: tablet, telefon ve bilgisayar. QR menü müşterinin kendi telefonunda açılır; personel POS ve mutfak ekranını (KDS) tablet ya da bilgisayardan kullanır.",
  },
  {
    q: "Teslimat platformlarıyla entegre mi?",
    a: "Evet. Yemeksepeti, Getir, Trendyol Yemek ve Migros Yemek siparişleri tek panelde toplanır; siparişleri ayrı ayrı ekranlarda takip etmek zorunda kalmazsınız.",
  },
  {
    q: "e-Fatura kesebiliyor muyum?",
    a: "HummyTummy, Paraşüt, Foriba ve Logo gibi e-dönüşüm sağlayıcılarıyla entegredir. İlgili sağlayıcı hesabınızı tanımladığınızda ödenen siparişler için e-Fatura / e-Arşiv otomatik oluşturulabilir.",
  },
  {
    q: "Verilerim güvende mi?",
    a: "Hassas veriler (entegrasyon anahtarları, ödeme tokenları vb.) AES-256-GCM ile, kiracı bazında türetilen anahtarlarla şifrelenir. Parolalar bcrypt ile saklanır, oturumlar httpOnly çerezle korunur ve altyapı Cloudflare arkasında TLS ile çalışır. KVKK süreçleri için gerekli yasal metinler hazırdır.",
  },
  {
    q: "Birden fazla şubem var, hepsini yönetebilir miyim?",
    a: "Evet. Tüm şubelerinizi tek hesaptan yönetir; şube bazlı yetki, menü ve raporlama tanımlarsınız. Profesyonel plan 3 şubeye kadar, Kurumsal plan sınırsız şube destekler.",
  },
];
