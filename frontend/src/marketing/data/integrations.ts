// Comprehensive integration catalog. `entegre` = real, code-verified adapters
// live today; `yakinda` = roadmap / certification-pending (user confirms brands);
// `noIntegration` = how the product works when a category isn't integrated.
// Brand logos are user-supplied later — the page shows a monogram placeholder
// until then.

import {
  Truck,
  FileText,
  CreditCard,
  Cpu,
  Bike,
  Plug,
  type LucideIcon,
} from "lucide-react";

export type IntegrationStatus = "entegre" | "yakinda";

export interface Brand {
  name: string;
  status: IntegrationStatus;
  note?: string;
  /** Public path to the brand logo (128px PNG under /brand/logos/). */
  logo?: string;
}

export interface IntegrationGroup {
  key: string;
  title: string;
  desc: string;
  icon: LucideIcon;
  brands: Brand[];
  noIntegration: string; // "entegrasyon yoksa nasıl çalışır"
}

export const INTEGRATION_GROUPS: IntegrationGroup[] = [
  {
    key: "teslimat",
    title: "Teslimat Platformları",
    desc: "Online sipariş platformlarındaki siparişler tek panelde birleşir; ayrı tabletlerle uğraşmazsınız.",
    icon: Truck,
    brands: [
      { name: "Yemeksepeti", status: "entegre", logo: "/brand/logos/yemeksepeti.png" },
      { name: "Getir", status: "entegre", logo: "/brand/logos/getir.png" },
      { name: "Trendyol Yemek", status: "entegre", logo: "/brand/logos/trendyol.png" },
      { name: "Migros Yemek", status: "entegre", logo: "/brand/logos/migros.png" },
    ],
    noIntegration:
      "Platform entegrasyonu açık değilse siparişleri POS’a hızlıca kendiniz girersiniz; tüm kanallar yine tek adisyon akışında toplanır.",
  },
  {
    key: "muhasebe",
    title: "Muhasebe & e-Fatura",
    desc: "Ödenen siparişler e-Fatura/e-Arşiv sağlayıcınıza otomatik akar; muhasebe senkron kalır.",
    icon: FileText,
    brands: [
      { name: "Paraşüt", status: "entegre", logo: "/brand/logos/parasut.png" },
      { name: "Foriba", status: "entegre", logo: "/brand/logos/foriba.png" },
      { name: "Logo", status: "entegre" },
    ],
    noIntegration:
      "Sağlayıcı tanımlı değilse satış faturaları sistem içinde oluşturulur ve dışa aktarılır; bir sağlayıcı bağladığınız anda e-Fatura/e-Arşiv kesimi otomatikleşir.",
  },
  {
    key: "odeme",
    title: "Ödeme",
    desc: "Online tahsilat ve abonelik ödemeleri güvenli altyapıyla; kasada nakit/kart ödemeleri adisyona işlenir.",
    icon: CreditCard,
    brands: [
      { name: "PayTR", status: "entegre", logo: "/brand/logos/paytr.png" },
      { name: "Havale / EFT", status: "entegre", note: "Manuel onaylı" },
    ],
    noIntegration:
      "Online tahsilat PayTR ile yapılır; kasada veya kapıda alınan nakit ve kart ödemelerini adisyona kayıt olarak işlersiniz.",
  },
  {
    key: "okc",
    title: "ÖKC / Yazarkasa",
    desc: "GMP-3 uyumlu yeni nesil yazarkasa ile mali fiş; sertifikasyon tamamlandıkça devreye alınır.",
    icon: Cpu,
    brands: [
      { name: "Hugin", status: "yakinda", note: "Sertifikasyon aşamasında", logo: "/brand/logos/hugin.png" },
      { name: "Beko", status: "yakinda", note: "Sertifikasyon aşamasında", logo: "/brand/logos/beko.png" },
      {
        name: "Paygo SP630",
        status: "yakinda",
        note: "Sertifikasyon aşamasında",
      },
    ],
    noIntegration:
      "Yazarkasa bağlı değilken adisyon ve fişler ESC/POS termal yazıcıdan basılır; ödeme kayıtları adisyonda tutulur.",
  },
  {
    key: "kurye",
    title: "Kurye & Teslimat Takibi",
    desc: "Teslimat, platform kuryeleri üzerinden yönetilir; kendi kuryenizle çalışırken siparişi adisyondan takip edersiniz.",
    icon: Bike,
    brands: [
      {
        name: "Platform kuryesi (Yemeksepeti/Getir)",
        status: "entegre",
        note: "Teslimat platformun kuryesiyle",
      },
      { name: "Kendi kurye ataması & canlı takip", status: "yakinda" },
    ],
    noIntegration:
      "Kendi kuryenizle teslimatta siparişi hazır/teslim edildi olarak işaretler, adisyondan durumunu izlersiniz.",
  },
  {
    key: "diger",
    title: "Geliştirici & Ekran",
    desc: "Üçüncü taraf ekranlar ve kendi sistemlerinizle bağlantı için API ve partner ekran desteği.",
    icon: Plug,
    brands: [
      { name: "Partner Ekran API", status: "entegre" },
      { name: "Webhooks (olay bildirimleri)", status: "entegre" },
    ],
    noIntegration:
      "API/webhook kullanmasanız da sistem tam çalışır; entegrasyon ihtiyacı doğduğunda API anahtarınızı oluşturup bağlarsınız.",
  },
];

// Sister companies — user supplies real descriptions + logos later.
export interface SisterCompany {
  name: string;
  tagline: string;
  desc: string;
}

export const SISTER_COMPANIES: SisterCompany[] = [
  {
    name: "Efruze",
    tagline: "Grup şirketi",
    desc: "Aynı çatı altında üreten kardeş markalarımızdan. Detaylı tanıtım içeriği hazırlanıyor.",
  },
  {
    name: "Figurinica",
    tagline: "Grup şirketi",
    desc: "Aynı çatı altında üreten kardeş markalarımızdan. Detaylı tanıtım içeriği hazırlanıyor.",
  },
];
