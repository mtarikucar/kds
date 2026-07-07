// The 8 product modules that anchor the homepage grid, the nav mega-menu, and
// (in Phase 2) the /ozellikler/:slug deep-dive pages. Copy is grounded in real
// capabilities and obeys the honesty guardrails (spec §7): no card-terminal
// charging, no per-station KDS routing, no "AI" analytics, e-invoice is
// integration-gated, menu *content* isn't auto-translated.

import {
  QrCode,
  CreditCard,
  ChefHat,
  LayoutGrid,
  Boxes,
  BarChart3,
  Building2,
  Plug,
  type LucideIcon,
} from "lucide-react";
import type { ImgKey } from "./images";

export interface Module {
  slug: string; // /ozellikler/:slug (Phase 2)
  anchor: string; // homepage section id (Phase 1 links target this)
  title: string;
  tagline: string;
  icon: LucideIcon;
  imageKey: ImgKey;
  bullets: string[];
}

export const MODULES: Module[] = [
  {
    slug: "qr-menu",
    anchor: "qr-menu",
    title: "QR Menü",
    tagline: "Kağıt menü masrafına elveda.",
    icon: QrCode,
    imageKey: "qrStand",
    bullets: [
      "Müşteri masadaki QR’ı telefonuyla okutur, menüyü açar ve sipariş verir",
      "Fiyat ve ürün değişikliği anında yansır — yeniden baskı yok",
      "5 dilli arayüz (menü içeriği sizin girdiğiniz dilde görünür)",
      "Menüden garson ve hesap çağrısı",
    ],
  },
  {
    slug: "pos-odeme",
    anchor: "pos-odeme",
    title: "POS & Ödeme",
    tagline: "Saniyeler içinde satış, hesap ve ödeme.",
    icon: CreditCard,
    imageKey: "posChef",
    bullets: [
      "Hızlı satış ekranı; nakit ve kart ile ödeme",
      "Hesap böl (eşit / ürün bazlı / özel), indirim, KDV-dahil satır vergisi",
      "PayTR ile müşteri kendi hesabını QR’dan öder (self-pay)",
      "Onaylı kasa (çekmece) hareketleri",
    ],
  },
  {
    slug: "mutfak-ekrani-kds",
    anchor: "mutfak-ekrani-kds",
    title: "Mutfak Ekranı (KDS)",
    tagline: "Mutfakta sipariş kaosuna son.",
    icon: ChefHat,
    imageKey: "kdsChef",
    bullets: [
      "Sipariş verildiği anda mutfak ekranına düşer (canlı)",
      "Hazırlanıyor / Hazır durum takibi",
      "Sesli ve görsel uyarılar",
      "Şubenin mutfak ekranına ve eşleşen donanım ekranlarına anında yansır",
    ],
  },
  {
    slug: "masa-siparis",
    anchor: "masa-siparis",
    title: "Masa & Sipariş",
    tagline: "Kat planında canlı masa yönetimi.",
    icon: LayoutGrid,
    imageKey: "dioramaInterior",
    bullets: [
      "Kat planı üzerinde canlı masa durumu (2B / 3B görünüm)",
      "Masa birleştirme ve bölme",
      "Rezervasyon yönetimi",
      "Garson çağrısı ve sipariş takibi",
    ],
  },
  {
    slug: "stok-envanter",
    anchor: "stok-envanter",
    title: "Stok & Envanter",
    tagline: "Reçeteyle otomatik stok düşümü.",
    icon: Boxes,
    imageKey: "chartIcon",
    bullets: [
      "Reçete bazlı otomatik malzeme düşümü",
      "Tedarikçi, satınalma ve sipariş yönetimi",
      "Sayım ve fire (zayi) takibi",
      "Kritik stok uyarıları",
    ],
  },
  {
    slug: "raporlar",
    anchor: "raporlar",
    title: "Raporlar & Analiz",
    tagline: "Rakamları gör, kararı hızlı ver.",
    icon: BarChart3,
    imageKey: "analytics",
    bullets: [
      "Ciro, ürün, personel ve saat bazlı raporlar",
      "Z-raporu ve gün sonu özeti",
      "Masa doluluk ısı haritası",
      "Gerçek zamanlı panel ve dışa aktarım",
    ],
  },
  {
    slug: "coklu-sube",
    anchor: "coklu-sube",
    title: "Çoklu Şube",
    tagline: "Tüm şubeler, tek hesap.",
    icon: Building2,
    imageKey: "dioramaBuilding",
    bullets: [
      "Tüm şubeleri tek hesaptan yönetin",
      "Şube bazlı yetki, menü ve raporlama",
      "ESC/POS fiş yazıcı ve yerel köprü desteği",
      "Masaüstü (Windows/Mac/Linux) kurulum uygulaması",
    ],
  },
  {
    slug: "entegrasyonlar",
    anchor: "entegrasyonlar",
    title: "Entegrasyonlar",
    tagline: "Tüm sipariş kanalları tek panelde.",
    icon: Plug,
    imageKey: "deliveryScooter",
    bullets: [
      "Yemeksepeti, Getir, Trendyol Yemek ve Migros Yemek siparişleri tek panelde",
      "e-Fatura / e-Arşiv (Paraşüt, Foriba, Logo entegrasyonlarıyla)",
      "Partner ekran API’si (masa tabletleri, üçüncü taraf ekranlar)",
      "PayTR ile online ödeme",
    ],
  },
];

export const moduleBySlug = (slug: string): Module | undefined =>
  MODULES.find((m) => m.slug === slug);
