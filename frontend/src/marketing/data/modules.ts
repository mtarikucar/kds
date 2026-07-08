// The product modules that anchor the homepage grid, the nav mega-menu (grouped
// by `category`), the /ozellikler index, and the /ozellikler/:slug deep-dive
// pages. Copy is grounded in real capabilities and obeys the honesty guardrails
// (docs/marketing/adisyo-parity-inventory.md §2/§3): no card-terminal charging,
// no per-station KDS routing, no "AI" analytics, e-invoice is integration-gated,
// and we DO NOT market courier-GPS, on-account/veresiye, hotel-PMS, native
// mobile apps, or meal-card networks (we don't have them).

import {
  QrCode,
  CreditCard,
  ChefHat,
  LayoutGrid,
  Boxes,
  BarChart3,
  Building2,
  Plug,
  CalendarCheck,
  Bell,
  Users,
  Gift,
  Activity,
  FileText,
  Printer,
  Store,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import type { ImgKey } from "./images";

export type ModuleCategory =
  | "Sipariş & Satış"
  | "Mutfak & Stok"
  | "Yönetim & Analiz"
  | "Entegrasyon & Donanım";

export const CATEGORIES: ModuleCategory[] = [
  "Sipariş & Satış",
  "Mutfak & Stok",
  "Yönetim & Analiz",
  "Entegrasyon & Donanım",
];

export interface Module {
  slug: string;
  anchor: string;
  title: string;
  tagline: string;
  icon: LucideIcon;
  imageKey: ImgKey;
  category: ModuleCategory;
  bullets: string[];
}

export const MODULES: Module[] = [
  // ── Sipariş & Satış ──────────────────────────────────────────────
  {
    slug: "qr-menu",
    anchor: "qr-menu",
    title: "QR Menü",
    tagline: "Kağıt menü masrafına elveda.",
    icon: QrCode,
    imageKey: "qrStand",
    category: "Sipariş & Satış",
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
    category: "Sipariş & Satış",
    bullets: [
      "Hızlı satış ekranı; nakit ve kart ile ödeme",
      "Hesap böl (eşit / ürün bazlı / özel), indirim, KDV-dahil satır vergisi",
      "PayTR ile müşteri kendi hesabını QR’dan öder (self-pay)",
      "Onaylı kasa (çekmece) hareketleri",
    ],
  },
  {
    slug: "masa-siparis",
    anchor: "masa-siparis",
    title: "Masa & Sipariş",
    tagline: "Kat planında canlı masa yönetimi.",
    icon: LayoutGrid,
    imageKey: "dioramaInterior",
    category: "Sipariş & Satış",
    bullets: [
      "Kat planı üzerinde canlı masa durumu (2B / 3B görünüm)",
      "Masa birleştirme ve bölme",
      "Rezervasyon yönetimi",
      "Garson çağrısı ve sipariş takibi",
    ],
  },
  {
    slug: "rezervasyon",
    anchor: "rezervasyon",
    title: "Rezervasyon",
    tagline: "Boş masa kalmasın, çifte rezervasyon olmasın.",
    icon: CalendarCheck,
    imageKey: "dioramaInterior",
    category: "Sipariş & Satış",
    bullets: [
      "Dahili (personel) ve online (müşteri) rezervasyon",
      "Uygunluk hesaplama ve hatırlatma bildirimi",
      "Kat planıyla entegre masa ataması",
      "Online rezervasyon talebi ve arama ekranı",
    ],
  },
  {
    slug: "garson-cagri",
    anchor: "garson-cagri",
    title: "Garson Çağrı & Self-Pay",
    tagline: "Masadan çağır, masadan öde.",
    icon: Bell,
    imageKey: "qrStand",
    category: "Sipariş & Satış",
    bullets: [
      "QR menüden garson çağrısı ve hesap isteme",
      "Personele anlık bildirim",
      "Müşteri kendi hesabını PayTR ile masadan öder",
      "Kalem-kalem veya bölerek ödeme",
    ],
  },
  // ── Mutfak & Stok ────────────────────────────────────────────────
  {
    slug: "mutfak-ekrani-kds",
    anchor: "mutfak-ekrani-kds",
    title: "Mutfak Ekranı (KDS)",
    tagline: "Mutfakta sipariş kaosuna son.",
    icon: ChefHat,
    imageKey: "kdsChef",
    category: "Mutfak & Stok",
    bullets: [
      "Sipariş verildiği anda mutfak ekranına düşer (canlı)",
      "Hazırlanıyor / Hazır durum takibi",
      "Sesli ve görsel uyarılar",
      "Şubenin mutfak ekranına ve eşleşen donanım ekranlarına yansır",
    ],
  },
  {
    slug: "stok-envanter",
    anchor: "stok-envanter",
    title: "Stok & Envanter",
    tagline: "Reçeteyle otomatik stok düşümü.",
    icon: Boxes,
    imageKey: "chartIcon",
    category: "Mutfak & Stok",
    bullets: [
      "Reçete bazlı otomatik malzeme düşümü",
      "Tedarikçi, satınalma ve sayım",
      "Fire (zayi) takibi",
      "Kritik stok uyarıları",
    ],
  },
  // ── Yönetim & Analiz ─────────────────────────────────────────────
  {
    slug: "raporlar",
    anchor: "raporlar",
    title: "Raporlar & Analiz",
    tagline: "Rakamları gör, kararı hızlı ver.",
    icon: BarChart3,
    imageKey: "analytics",
    category: "Yönetim & Analiz",
    bullets: [
      "Ciro, ürün, personel ve saat bazlı raporlar",
      "Z-raporu ve gün sonu özeti",
      "Dışa aktarım",
      "Gerçek zamanlı panel",
    ],
  },
  {
    slug: "analitik",
    anchor: "analitik",
    title: "Analitik & Isı Haritası",
    tagline: "Salonun nabzını ısı haritasında gör.",
    icon: Activity,
    imageKey: "analytics",
    category: "Yönetim & Analiz",
    bullets: [
      "Masa doluluk ısı haritası (saat / gün)",
      "Masa bazlı analiz",
      "Kural-tabanlı otomatik içgörüler",
      "Gerçek zamanlı panel",
    ],
  },
  {
    slug: "personel",
    anchor: "personel",
    title: "Personel Yönetimi",
    tagline: "Vardiya, mesai ve performans tek yerde.",
    icon: Users,
    imageKey: "supportAgent",
    category: "Yönetim & Analiz",
    bullets: [
      "Mesai (giriş/çıkış) takibi",
      "Vardiya şablonları ve planı",
      "Vardiya değişimi (swap)",
      "Personel performans raporu",
    ],
  },
  {
    slug: "musteri-sadakat",
    anchor: "musteri-sadakat",
    title: "Müşteri & Sadakat",
    tagline: "Gelen müşteri geri gelsin.",
    icon: Gift,
    imageKey: "mascotServe",
    category: "Yönetim & Analiz",
    bullets: [
      "Müşteri kaydı ve telefon eşleştirme",
      "Puan kazan/harca, Bronze→Platinum kademe",
      "Hoşgeldin ve doğum günü bonusu",
      "Davet / referans ödülleri",
    ],
  },
  {
    slug: "coklu-sube",
    anchor: "coklu-sube",
    title: "Çoklu Şube",
    tagline: "Tüm şubeler, tek hesap.",
    icon: Building2,
    imageKey: "dioramaBuilding",
    category: "Yönetim & Analiz",
    bullets: [
      "Tüm şubeleri tek hesaptan yönetin",
      "Şube bazlı yetki, menü ve raporlama",
      "ESC/POS fiş yazıcı ve yerel köprü desteği",
      "Masaüstü kurulum uygulaması",
    ],
  },
  // ── Entegrasyon & Donanım ────────────────────────────────────────
  {
    slug: "entegrasyonlar",
    anchor: "entegrasyonlar",
    title: "Entegrasyonlar",
    tagline: "Tüm sipariş kanalları tek panelde.",
    icon: Plug,
    imageKey: "deliveryScooter",
    category: "Entegrasyon & Donanım",
    bullets: [
      "Yemeksepeti, Getir, Trendyol Yemek ve Migros Yemek tek panelde",
      "e-Fatura / e-Arşiv (Paraşüt, Foriba, Logo)",
      "Partner ekran API’si",
      "PayTR ile online ödeme",
    ],
  },
  {
    slug: "e-fatura",
    anchor: "e-fatura",
    title: "e-Fatura & e-Dönüşüm",
    tagline: "Ödemeden faturaya kesintisiz.",
    icon: FileText,
    imageKey: "chartIcon",
    category: "Entegrasyon & Donanım",
    bullets: [
      "Paraşüt, Foriba ve Logo entegrasyonu",
      "Ödenen siparişte e-Fatura / e-Arşiv",
      "KDV (%0/1/10/20) satır bazlı hesap",
      "Muhasebe senkronizasyonu",
    ],
  },
  {
    slug: "donanim",
    anchor: "donanim",
    title: "Donanım & Cihaz Ağı",
    tagline: "Yazıcı, tablet ve cihazlar tek ağda.",
    icon: Printer,
    imageKey: "cloudServers",
    category: "Entegrasyon & Donanım",
    bullets: [
      "ESC/POS fiş ve mutfak-fişi yazıcı",
      "Cihaz ağı: kayıt, eşleştirme, sağlık takibi",
      "On-prem yerel köprü (NAT arkası cihazlar)",
      "Masaüstü uygulaması (Bluetooth / ağ yazıcı)",
    ],
  },
  {
    slug: "marketplace",
    anchor: "marketplace",
    title: "Marketplace & Eklentiler",
    tagline: "İhtiyacın kadar özellik, tek tıkla.",
    icon: Store,
    imageKey: "dioramaBuilding",
    category: "Entegrasyon & Donanım",
    bullets: [
      "Eklenti (add-on) mağazası",
      "Planına dahil olanı tekrar satmaz",
      "PayTR ile ödeme sonrası otomatik aktivasyon",
      "Donanım + sipariş tek mağaza hub’ında",
    ],
  },
  {
    slug: "guvenlik",
    anchor: "guvenlik",
    title: "Güvenlik & Uyum",
    tagline: "Verileriniz şifreli, süreçleriniz KVKK uyumlu.",
    icon: ShieldCheck,
    imageKey: "mascotShield",
    category: "Entegrasyon & Donanım",
    bullets: [
      "AES-256-GCM şifreleme, kiracı-bazlı anahtar",
      "bcrypt parola, httpOnly oturum",
      "KVKK rıza ve yasal belgeler",
      "Doğrulanmış otomatik yedekleme (14 gün), 5 dil",
    ],
  },
];

export const moduleBySlug = (slug: string): Module | undefined =>
  MODULES.find((m) => m.slug === slug);

export const modulesByCategory = (c: ModuleCategory): Module[] =>
  MODULES.filter((m) => m.category === c);
