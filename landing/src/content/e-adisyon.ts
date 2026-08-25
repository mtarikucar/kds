/**
 * Content for /tr/e-adisyon-zorunlu-mu.
 *
 * Turkish-only by design: this is Turkish tax regulation, and the page exists
 * to correct a specific Turkish-language claim. It lives here rather than in
 * the i18n catalogs so it is not forced through five-locale parity — machine
 * translating a regulatory correction into four languages would produce four
 * pages nobody can stand behind.
 *
 * EVERY factual assertion below was verified against a primary source
 * (mevzuat.gov.tr, resmigazete.gov.tr, ebelge.gib.gov.tr) on 2026-08-25 by two
 * independently-tasked researchers, one of whom was assigned to argue the
 * OPPOSITE conclusion and reported that the sources would not support it.
 *
 * Do not edit a claim here without re-reading the cited source. If a GİB duyuru
 * ever imposes e-Adisyon, this page becomes wrong the day it is published and
 * must be rewritten, not patched.
 */

export const LAST_REVIEWED = '2026-08-25';

export type Source = {
  label: string;
  url: string;
  publisher: string;
};

export const SOURCES: Source[] = [
  {
    label: 'VUK Genel Tebliği (Sıra No: 509) — güncel konsolide metin',
    url: 'https://www.mevzuat.gov.tr/File/GeneratePdf?mevzuatNo=33905&mevzuatTur=Teblig&mevzuatTertip=5',
    publisher: 'mevzuat.gov.tr',
  },
  {
    label: 'VUK Genel Tebliği (Sıra No: 526) — 509’a IV.12 e-Adisyon bölümünü ekleyen tebliğ',
    url: 'https://www.resmigazete.gov.tr/eskiler/2021/02/20210209-5.htm',
    publisher: 'resmigazete.gov.tr (RG 9/2/2021, 31390)',
  },
  {
    label: 'GİB e-Belge Duyuruları (tam arşiv)',
    url: 'https://ebelge.gib.gov.tr/duyurular.html',
    publisher: 'ebelge.gib.gov.tr',
  },
  {
    label: 'Karekod Standardı Kılavuzu, Sürüm 1.2 (Kasım 2023)',
    url: 'https://ebelge.gib.gov.tr/dosyalar/kilavuzlar/Karekod_Standardi_Kilavuzu_V.1.2.pdf',
    publisher: 'ebelge.gib.gov.tr',
  },
  {
    label: 'e-Belge doğrulama aracı',
    url: 'https://dijital.gib.gov.tr/dogrulamalar/eBelgeDogrulama',
    publisher: 'dijital.gib.gov.tr',
  },
];

/**
 * The answer, stated so it survives being lifted out of the page on its own.
 * Answer engines retrieve and rank passages independently, so a paragraph that
 * needs the one above it to make sense loses at rerank.
 */
export const VERDICT = {
  question: 'e-Adisyon zorunlu mu?',
  short:
    '25 Ağustos 2026 itibarıyla hayır. Türkiye’de hiçbir mükellef grubu için e-Adisyon uygulamasına geçme zorunluluğu getirilmemiştir. e-Adisyon isteğe bağlıdır.',
  why:
    '509 Sıra No.lu Vergi Usul Kanunu Genel Tebliği’nin IV.12.2 bölümü bunu açıkça yazar: e-Adisyon uygulaması, IV.12.4’te belirtilen mükellefler dışındaki mükellefler için “zorunlu bir uygulama olmayıp”, uygulamaya dahil olmak isteyenler içindir. IV.12.4 ise Gelir İdaresi Başkanlığı’na zorunluluk getirme yetkisi veren bir maddedir — zorunluluğun kendisi değil. Bu yetki bugüne kadar kullanılmamıştır: ebelge.gib.gov.tr duyuru arşivinin tamamında (2012’den 24 Ağustos 2026’ya kadar) e-Adisyon’a geçişi zorunlu kılan tek bir duyuru yoktur.',
};

export const SECTIONS: { heading: string; body: string[] }[] = [
  {
    heading: 'Kâğıt adisyon zorunlu, e-Adisyon değil — karıştırılan nokta bu',
    body: [
      'İki ayrı şey var ve piyasadaki yanlış bilginin kaynağı bunların birbirine karışması. **Adisyon belgesinin kendisi** zorunludur: 185, 200, 298 ve 299 Sıra No.lu VUK Genel Tebliğleri uyarınca, masada servis yapılan ve gerçek usulde vergilendirilen hizmet işletmeleri (lokanta, kafeterya, pastane, gazino, bar, pavyon gibi) adisyon kullanmak zorundadır. Bu kural yıllardır yürürlüktedir ve değişmemiştir.',
      '**e-Adisyon uygulaması** ise bu belgenin elektronik ortamda düzenlenmesidir ve ayrı bir şeydir. 509 No.lu Tebliğ’in IV.12 bölümü (bu bölüm 526 No.lu Tebliğ ile, RG 9/2/2021 tarihinde eklenmiştir) e-Adisyon’u tanımlar, ama zorunlu kılmaz.',
      'Yani: adisyon kesmek zorundasınız; onu **elektronik** kesmek zorunda değilsiniz.',
    ],
  },
  {
    heading: 'Uygulamaya girdiyseniz, o zaman elektronik düzenlemek zorunludur',
    body: [
      'Gönüllü olarak e-Adisyon uygulamasına dahil olduysanız kural değişir. IV.12.3’e göre, uygulamaya dahil olan mükellefler adisyon belgelerini müşteriden sipariş alınırken, Başkanlıkça belirlenen formatta **elektronik ortamda** düzenlemek zorundadır. IV.12.6 ise zorunluluk getirildiği hâlde geçmeyenler ile e-Adisyon düzenlemesi gerekirken kâğıt adisyon düzenleyenler hakkında Kanun’da öngörülen cezai hükümlerin uygulanacağını söyler.',
      'Kısacası uygulamaya girmek isteğe bağlıdır; girdikten sonra kâğıda dönmek değildir.',
    ],
  },
  {
    heading: 'Zorunluluk gelirse nasıl gelir?',
    body: [
      'IV.12.4 usulü de belirler: Başkanlık, adisyon belgesi düzenleyen hizmet işletmelerine yıllık veya aylık satış hasılatı tutarlarını dikkate alarak zorunluluk getirebilir. Bunu yaparken **en az 3 ay geçiş süresi** vermek ve ya yazılı bildirimde bulunmak ya da ebelge.gib.gov.tr adresinde duyurmak zorundadır.',
      'Pratikte bu şu demek: bir sabah uyanıp zorunlu hâle gelmiş bulamazsınız. Duyuru yayımlandığı andan itibaren en az üç aylık bir hazırlık süreniz olur. Bu sayfada izlediğimiz kaynak da tam olarak o duyuru sayfasıdır.',
      'Bir ihtimali dürüstçe belirtelim: IV.12.4 zorunluluğun **yazılı bildirim** yoluyla tek tek mükelleflere de getirilebilmesine izin verir. Böyle bir bildirim kamuya açık bir iz bırakmaz. Elimizdeki kamuya açık kaynaklarda böyle bir uygulamaya dair bir işaret yoktur, ama size özel bir yazı geldiyse bu sayfadaki genel cevap sizin durumunuzu bağlamaz.',
    ],
  },
  {
    heading: 'Piyasadaki “2025 itibarıyla mecburi oldu” bilgisi nereden geliyor?',
    body: [
      'Birden fazla yazılım firmasının blog sayfasında e-Adisyon’un zorunlu hâle geldiği yazıyor. Bu iddiaların dayandığı bir tebliğ ya da duyuru numarası yok; olanlar da kontrol edildiğinde başka bir belge türüne ait çıkıyor.',
      'En sık rastlanan hata “1 Temmuz 2022” tarihinin e-Adisyon’a atfedilmesi. 509 No.lu Tebliğ’de o tarih geçer — ama e-Fatura, e-Arşiv Fatura, e-İrsaliye ve e-Serbest Meslek Makbuzu hadlerine aittir; 22/1/2022 tarihli değişiklikle gelmiştir ve e-Adisyon ile ilgisi yoktur.',
      'İkinci sık hata, yukarıda anlattığımız kâğıt adisyon zorunluluğunu e-Adisyon zorunluluğu sanmak.',
      'Ayrıca dikkat: 573 Sıra No.lu Tebliğ (RG 12/11/2024) IV.12.3’te değişiklik yapmıştır. 2024’ten önce yazılmış e-Adisyon yazılarının bir kısmı bu değişikliği yansıtmaz; tarih görmediğiniz bir kaynağa güvenmeyin.',
    ],
  },
  {
    heading: 'e-Adisyon’a gönüllü geçmek isterseniz ön koşul var',
    body: [
      'IV.12.2, uygulamaya dahil olmak isteyen mükellefin önce **e-Fatura ve e-Arşiv Fatura** uygulamalarına dahil olmasını şart koşar. Yani e-Adisyon, e-Fatura’nın üstüne kurulur; tek başına başvurulan bir uygulama değildir.',
    ],
  },
];

/**
 * The karekod section. Kept on this page because the two questions arrive
 * together in practice, and separating them is most of the value.
 */
/**
 * A summary only. The full treatment — three kinds of karekod, what the payload
 * actually contains, placement, and the contradiction between the tebliğ and the
 * kılavuz — lives at /tr/karekod-rehberi. Splitting them keeps each page
 * answering one question: this one answers "is e-Adisyon mandatory", that one
 * answers "which karekod is which".
 */
export const KAREKOD = {
  heading: 'Peki “fiş karekod” / e-Belge karekodu?',
  body: [
    'Bu, e-Adisyon zorunluluğuyla sık karıştırılan ama ayrı bir konudur. Kısaca: restoran bağlamında “karekod” üç ayrı şeyi anlatır ve üçünün birbiriyle ilgisi yoktur.',
  ],
  items: [
    {
      title: 'Karekod menü (QR menü)',
      text: 'Masadaki koda telefonla okutulan dijital menü. Hiçbir vergi mevzuatına tabi değildir, zorunlu değildir.',
    },
    {
      title: 'e-Belgelerde GİB karekodu',
      text: '17/02/2023 tarihli GİB duyurusuyla, 1/9/2023 tarihinden itibaren 8 belge türünde zorunludur — bunlardan biri e-Adisyon’dur. Dikkat: bu, e-Adisyon uygulamasına geçmenin zorunlu olduğu anlamına gelmez; yalnızca e-Adisyon düzenleyenlerin belgesinde karekod bulunması gerektiği anlamına gelir.',
    },
    {
      title: 'TR Karekod (ödeme karekodu)',
      text: 'TCMB’nin ödeme karekodu standardıdır (RG 21/8/2020, 31220) ve yalnızca ödeme işlemlerini bağlar. Karekod menü kapsamına girmez.',
    },
  ],
  moreHref: '/karekod-rehberi',
  moreLabel: 'Üçünün ayrıntılı karşılaştırması, kaynaklarıyla →',
};

/**
 * Rendered as a visible list and mirrored 1:1 into FAQPage JSON-LD — Google
 * requires the structured data to match what the user actually sees.
 */
export const FAQ: { q: string; a: string }[] = [
  {
    q: 'e-Adisyon zorunlu mu?',
    a: '25 Ağustos 2026 itibarıyla hayır. 509 Sıra No.lu VUK Genel Tebliği IV.12.2, e-Adisyon’un IV.12.4’te belirtilenler dışındaki mükellefler için zorunlu bir uygulama olmadığını yazar; IV.12.4’ün öngördüğü zorunluluk duyurusu ise bugüne kadar yayımlanmamıştır.',
  },
  {
    q: 'Restoranımda adisyon kullanmak zorunda mıyım?',
    a: 'Evet. Masada servis yapan ve gerçek usulde vergilendirilen hizmet işletmeleri için adisyon belgesi kullanmak 185, 200, 298 ve 299 Sıra No.lu VUK Genel Tebliğleri uyarınca zorunludur. Zorunlu olmayan şey, bu belgeyi elektronik ortamda düzenlemektir.',
  },
  {
    q: 'e-Adisyon zorunlu hâle gelirse ne kadar sürem olur?',
    a: '509 No.lu Tebliğ IV.12.4, Başkanlığın zorunluluk getirirken en az 3 ay geçiş süresi vermesini ve bunu yazılı bildirim ya da ebelge.gib.gov.tr’de duyuru ile bildirmesini şart koşar.',
  },
  {
    q: 'e-Adisyon’a gönüllü geçebilir miyim, koşulu var mı?',
    a: 'Geçebilirsiniz. Koşul, önce e-Fatura ve e-Arşiv Fatura uygulamalarına dahil olmanızdır (509 No.lu Tebliğ IV.12.2).',
  },
  {
    q: 'e-Belgelerde karekod zorunluluğu ne zaman başladı?',
    a: '17/02/2023 tarihli GİB duyurusu ile 1/9/2023 tarihinden itibaren düzenlenen elektronik belgelerde zorunlu hâle geldi. Duyuru 8 belge türünü sayar; bunlardan biri e-Adisyon’dur.',
  },
];
