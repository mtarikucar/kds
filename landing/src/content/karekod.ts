/**
 * Content for /tr/karekod-rehberi.
 *
 * Scope discipline: /tr/e-adisyon-zorunlu-mu answers "is e-Adisyon mandatory".
 * This page answers "which karekod is which". They cross-link and must not be
 * merged or allowed to drift into answering the same question — two pages
 * competing for one query is worse than either alone.
 *
 * Verified against primary sources on 2026-08-25 (mevzuat.gov.tr,
 * resmigazete.gov.tr, ebelge.gib.gov.tr, tcmb.gov.tr). Do not edit a claim
 * without re-reading the cited source.
 */

export const LAST_REVIEWED = '2026-08-25';

export interface Source {
  label: string;
  url: string;
  publisher: string;
}

export const SOURCES: Source[] = [
  {
    label: 'VUK Genel Tebliği (Sıra No: 509) — güncel konsolide metin',
    url: 'https://www.mevzuat.gov.tr/File/GeneratePdf?mevzuatNo=33905&mevzuatTur=Teblig&mevzuatTertip=5',
    publisher: 'mevzuat.gov.tr',
  },
  {
    label: 'Karekod Standardı Kılavuzu, Sürüm 1.2 (Kasım 2023)',
    url: 'https://ebelge.gib.gov.tr/dosyalar/kilavuzlar/Karekod_Standardi_Kilavuzu_V.1.2.pdf',
    publisher: 'ebelge.gib.gov.tr',
  },
  {
    label: 'GİB e-Belge duyuruları (karekod zorunluluk tarihinin kaynağı)',
    url: 'https://ebelge.gib.gov.tr/duyurular.html',
    publisher: 'ebelge.gib.gov.tr',
  },
  {
    label: 'Ödeme Hizmetlerinde TR Karekodun Üretilmesi ve Kullanılması Hakkında Yönetmelik',
    url: 'https://www.resmigazete.gov.tr/eskiler/2020/08/20200821-4.htm',
    publisher: 'resmigazete.gov.tr (RG 21/8/2020, 31220)',
  },
  {
    label: 'e-Belge doğrulama aracı',
    url: 'https://dijital.gib.gov.tr/dogrulamalar/eBelgeDogrulama',
    publisher: 'dijital.gib.gov.tr',
  },
];

export const LEAD = {
  question: 'Restoranda “karekod” tam olarak neyi anlatıyor?',
  answer:
    'Türkiye’de restoran bağlamında karekod üç ayrı şeyi anlatır ve üçünün birbiriyle hiçbir ilgisi yoktur: (1) masadaki karekod menü — hiçbir vergi düzenlemesine tabi değildir; (2) e-Belgelerin üzerindeki GİB karekodu — 509 No.lu Tebliğ kapsamındadır ve 1 Eylül 2023’ten beri 8 belge türünde zorunludur; (3) TR Karekod — TCMB’nin ödeme karekodu standardıdır ve yalnızca ödeme işlemlerini bağlar. Bir satıcı “karekod zorunlu oldu” dediğinde hangisini kastettiğini sorun; çoğu zaman ikincisini kastedip birincisini satmaya çalışır.',
};

export interface KarekodKind {
  id: string;
  name: string;
  oneLine: string;
  mandatory: string;
  regulation: string;
  detail: string[];
}

export const KINDS: KarekodKind[] = [
  {
    id: 'menu',
    name: 'Karekod menü (QR menü)',
    oneLine: 'Masadaki koda telefonla okutulan dijital menü.',
    mandatory: 'Zorunlu değil',
    regulation: 'Hiçbir vergi mevzuatına tabi değildir',
    detail: [
      'Misafirin masadaki karekodu telefon kamerasıyla okutup menüyü tarayıcıda açmasıdır. Hiçbir uygulama indirilmez.',
      'Bunu düzenleyen bir tebliğ, yönetmelik ya da GİB duyurusu yoktur. Tamamen ticari bir tercihtir: baskı maliyetini sıfırlar, fiyat değişikliğini anında yayına alır.',
      'Karekod menü ile fatura ya da fiş üzerindeki karekodun teknik olarak hiçbir ortak yanı yoktur. İkisi de kare biçimli bir koddur; benzerlik burada biter.',
    ],
  },
  {
    id: 'ebelge',
    name: 'e-Belge karekodu (GİB karekodu)',
    oneLine: 'e-Fatura, e-Arşiv ve diğer elektronik belgelerin üzerindeki karekod.',
    mandatory: '1 Eylül 2023’ten beri zorunlu (8 belge türünde)',
    regulation: 'VUK Genel Tebliği 509 + 17/02/2023 tarihli GİB duyurusu',
    detail: [
      '509 No.lu Tebliğ, 13 ayrı “…da Bulunması Gereken Bilgiler” bölümünde belgede karekod bulunmasını şart koşar. Ancak madde kendini askıya alır: “Başkanlık tarafından ebelge.gib.gov.tr adresinden yapılan duyuruda belirtilecek tarihten itibaren” der. Yani tebliğin tek başına yürürlüğe koyduğu bir zorunluluk yoktur.',
      'Tarihi veren 17 Şubat 2023 tarihli GİB duyurusudur: karekod, 1/9/2023 tarihinden itibaren düzenlenecek elektronik belgelerde zorunludur. Duyuru sekiz belge türü sayar: e-Fatura, e-Arşiv Fatura, e-İrsaliye, e-Serbest Meslek Makbuzu, e-Müstahsil Makbuzu, e-Sigorta Komisyon Gider Belgesi, e-Döviz ve Kıymetli Maden Alım Satım Belgesi ve e-Adisyon.',
      '509’da karekod maddesi bulunduğu hâlde bu duyuruda sayılmayan belge türleri için karekod hâlâ yürürlüğe girmemiştir: e-Gider Pusulası, kara/deniz yolu yolcu taşımacılığı e-Bileti, hava yolu e-Bileti, etkinlik e-Bileti, e-Sigorta Poliçesi ve e-Dekont.',
      'Karekodun içeriği bir JSON verisidir, bağlantı değildir. Karekod Standardı Kılavuzu (Sürüm 1.2, Kasım 2023) okutulduğunda ne görüneceğini örnekle gösterir: VKN/TCKN, senaryo, belge tarihi ve numarası, ETTN, para birimi, mal-hizmet toplamı, KDV matrahı ve ödenecek tutar gibi alanlar. Kılavuzun 19 sayfasının hiçbir yerinde “http” geçmez.',
      'Yani “karekodu okutunca GİB doğrulama sayfası açılır” ifadesi standart açısından doğru değildir. Doğrulama ayrı bir araçla, dijital.gib.gov.tr üzerindeki e-Belge Doğrulama ekranından yapılır.',
      'Karekod belgenin sağ üst köşesinde yer alır (Kılavuz, bölüm 3).',
    ],
  },
  {
    id: 'tr-karekod',
    name: 'TR Karekod (ödeme karekodu)',
    oneLine: 'Karekodla ödeme alınırken kullanılması gereken ulusal standart.',
    mandatory: 'Karekodla ödeme alıyorsanız zorunlu',
    regulation: 'TCMB Yönetmeliği, RG 21/8/2020 sayı 31220',
    detail: [
      'Düzenlemenin tam adı “Ödeme Hizmetlerinde TR Karekodun Üretilmesi ve Kullanılması Hakkında Yönetmelik”tir; Türkiye Cumhuriyet Merkez Bankası tarafından çıkarılmıştır.',
      'Madde 4/1: 6493 sayılı Kanun çerçevesinde ödeme hizmeti kapsamına giren ve karekod kullanılarak yapılan her ödeme işleminde TR Karekod kullanılır. Buradaki koşul çifttir — bir karekod, ancak altındaki işlem bir ödeme hizmetiyse bu kurala girer.',
      'Bu yüzden karekod menü bu yönetmeliğin kapsamına girmez: menüyü açmak bir ödeme işlemi değildir.',
      'TR Karekod’u üretme yetkisi Madde 5/1 ile ödeme hizmeti sağlayıcılarına ve TCMB’nin uygun gördüğü ödeme sistemi işleticilerine aittir. Karekod Üretici Kodu olmayan bir taraf TR Karekod üretemez.',
    ],
  },
];

export const CONTRADICTION = {
  heading: 'Not: iki resmî belge arasında çözülmemiş bir çelişki var',
  body: [
    'Bunu, karşılaştığınızda şaşırmayın diye yazıyoruz.',
    'Karekod Standardı Kılavuzu, e-Adisyon karekodunun dayanağı olarak 509 No.lu Tebliğ’in “IV.12.3” bölümünü gösterir. Ancak IV.12.3’te karekoda dair bir hüküm yoktur ve hiç olmamıştır: IV.12 bölümü 509’a 526 No.lu Tebliğ ile (RG 9/2/2021) eklenmiştir ve IV.12.3’ün a–d bentlerinin hiçbiri karekod değildir. 573 No.lu Tebliğ’in (RG 12/11/2024) yürürlükten kaldırdığı (d) bendi de karekod değil, e-Adisyon’un ilişkili olduğu faturanın ETTN’si ya da ÖKC sicil numarasıydı.',
    'Bunun tersi de geçerli: tebliğde karekod hükmü taşıyan altı bölüm kılavuzda hiç sayılmamıştır.',
    'Pratikte e-Adisyon karekodu duyuru ve kılavuza dayanır; dayanak olarak gösterilen tebliğ maddesi ise o hükmü içermez. Bunu çözmek bize düşmez — GİB’in açıklığa kavuşturması gereken bir noktadır ve burada olduğu gibi aktarıyoruz.',
  ],
};

export const FAQ: { q: string; a: string }[] = [
  {
    q: 'Karekod menü zorunlu mu?',
    a: 'Hayır. Karekod menüyü (QR menü) düzenleyen hiçbir tebliğ, yönetmelik ya da GİB duyurusu yoktur. Tamamen işletmenin tercihidir. Zorunlu olan karekod, e-Belgelerin üzerindeki GİB karekodudur ve tamamen farklı bir şeydir.',
  },
  {
    q: 'e-Faturada karekod zorunlu mu, ne zamandan beri?',
    a: 'Evet. 17 Şubat 2023 tarihli GİB duyurusuna göre karekod, 1 Eylül 2023 tarihinden itibaren düzenlenen elektronik belgelerde zorunludur. Duyuru sekiz belge türünü sayar; e-Fatura ve e-Arşiv Fatura bunların ilk ikisidir.',
  },
  {
    q: 'Karekodu okutunca ne çıkar? GİB sayfası mı açılır?',
    a: 'GİB sayfası açılmaz. Karekod Standardı Kılavuzu Sürüm 1.2’ye göre karekodun içeriği bir JSON verisidir: VKN/TCKN, senaryo, belge tarihi ve numarası, ETTN, para birimi ve tutar alanları. Okuttuğunuzda bu metni görürsünüz. Belge doğrulaması dijital.gib.gov.tr üzerindeki e-Belge Doğrulama aracıyla ayrıca yapılır.',
  },
  {
    q: 'Yazarkasa (ÖKC) fişine karekod basmak zorunda mıyım?',
    a: 'Karekod zorunluluğu e-Belgeler için getirilmiştir. Yeni Nesil ÖKC teknik kılavuzunda karekod, barkod/karekod okuyucu çevre birimi ve TR Karekod ödeme tipi bağlamında geçer; perakende satış fişine GİB karekodu basılmasını şart koşan bir düzenlemeye rastlanmamıştır. Kendi cihazınız ve mükellefiyet durumunuz için mali müşavirinize danışın.',
  },
  {
    q: 'Karekod belgenin neresinde olmalı?',
    a: 'Karekod Standardı Kılavuzu’nun 3. bölümü, karekodun ilgili elektronik belgenin sağ üst köşesinde yer alması gerektiğini söyler.',
  },
  {
    q: 'TR Karekod ile e-Belge karekodu aynı şey mi?',
    a: 'Hayır. TR Karekod, TCMB’nin ödeme karekodu standardıdır (RG 21/8/2020, 31220) ve yalnızca ödeme işlemlerini bağlar. e-Belge karekodu, GİB’in belge üzerinde istediği ve içeriğini kendisinin belirlediği karekoddur. Farklı kurumlar, farklı düzenlemeler, farklı içerikler.',
  },
  {
    q: '“fiş karekod” diye arattığımda karışık sonuçlar çıkıyor, neden?',
    a: 'Çünkü “fiş karekod” yerleşik bir terim değil. Aradığınız şey büyük ihtimalle şu üçünden biri: masadaki karekod menü, e-Belgelerin üzerindeki GİB karekodu ya da karekodla ödeme (TR Karekod). Bu sayfa üçünü ayırmak için var. Arama sonuçlarının bir kısmı ise bunlarla ilgisiz bir finansal ürüne — karekodlu çeke — kayar.',
  },
];
