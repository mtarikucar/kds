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
      { name: "Yemeksepeti", status: "entegre" },
      { name: "Getir", status: "entegre" },
      { name: "Trendyol Yemek", status: "entegre" },
      { name: "Migros Yemek", status: "entegre" },
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
      { name: "Paraşüt", status: "entegre" },
      { name: "Foriba", status: "entegre" },
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
      { name: "PayTR", status: "entegre" },
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
      { name: "Hugin", status: "yakinda", note: "Sertifikasyon aşamasında" },
      { name: "Beko", status: "yakinda", note: "Sertifikasyon aşamasında" },
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
    tagline: "[Kısa tanım — sen vereceksin]",
    desc: "Efruze hakkında kısa açıklama buraya gelecek. Ne yaptığı, HummyTummy ile ilişkisi.",
  },
  {
    name: "Figurinica",
    tagline: "[Kısa tanım — sen vereceksin]",
    desc: "Figurinica hakkında kısa açıklama buraya gelecek. Ne yaptığı, HummyTummy ile ilişkisi.",
  },
];
