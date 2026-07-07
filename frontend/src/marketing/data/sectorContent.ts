// Sector solution pages (/cozumler/:slug). Each sector reframes the SAME product
// for a business type and curates the modules that matter most. Honesty: pizza /
// fast-food / bulut-mutfak emphasize delivery-PLATFORM integration (aggregator),
// NOT own-courier GPS (we don't have that). No "Otel" sector (no PMS).

import type { ImgKey } from "./images";

export interface SectorCopy {
  hero: { eyebrow: string; title: string; subtitle: string };
  intro: string;
  blocks: { title: string; body: string; bullets: string[] }[];
  why: string[];
  faq: { q: string; a: string }[];
  ctaTitle: string;
}

export interface Sector {
  slug: string;
  title: string;
  emoji: string;
  heroImage: ImgKey;
  moduleSlugs: string[]; // which module deep-dives to feature
}

export const SECTORS: Sector[] = [
  {
    slug: "restoran",
    title: "Restoran",
    emoji: "🍽️",
    heroImage: "dioramaInterior",
    moduleSlugs: [
      "masa-siparis",
      "pos-odeme",
      "mutfak-ekrani-kds",
      "qr-menu",
      "stok-envanter",
      "rezervasyon",
    ],
  },
  {
    slug: "kafe",
    title: "Kafe",
    emoji: "☕",
    heroImage: "qrStand",
    moduleSlugs: [
      "qr-menu",
      "pos-odeme",
      "musteri-sadakat",
      "stok-envanter",
      "mutfak-ekrani-kds",
      "entegrasyonlar",
    ],
  },
  {
    slug: "bar",
    title: "Bar",
    emoji: "🍸",
    heroImage: "posChef",
    moduleSlugs: [
      "pos-odeme",
      "masa-siparis",
      "stok-envanter",
      "personel",
      "garson-cagri",
    ],
  },
  {
    slug: "pastane",
    title: "Pastane & Fırın",
    emoji: "🥐",
    heroImage: "mascotServe",
    moduleSlugs: [
      "stok-envanter",
      "qr-menu",
      "pos-odeme",
      "e-fatura",
      "raporlar",
    ],
  },
  {
    slug: "fast-food",
    title: "Fast Food",
    emoji: "🍟",
    heroImage: "heroTablet",
    moduleSlugs: [
      "qr-menu",
      "mutfak-ekrani-kds",
      "pos-odeme",
      "garson-cagri",
      "entegrasyonlar",
    ],
  },
  {
    slug: "pizza",
    title: "Pizza",
    emoji: "🍕",
    heroImage: "deliveryScooter",
    moduleSlugs: [
      "entegrasyonlar",
      "mutfak-ekrani-kds",
      "qr-menu",
      "stok-envanter",
      "pos-odeme",
    ],
  },
  {
    slug: "burger",
    title: "Burger",
    emoji: "🍔",
    heroImage: "mascotServe",
    moduleSlugs: [
      "pos-odeme",
      "mutfak-ekrani-kds",
      "qr-menu",
      "entegrasyonlar",
      "coklu-sube",
    ],
  },
  {
    slug: "subeli",
    title: "Şubeli & Zincir",
    emoji: "🏙️",
    heroImage: "dioramaBuilding",
    moduleSlugs: [
      "coklu-sube",
      "raporlar",
      "donanim",
      "entegrasyonlar",
      "personel",
    ],
  },
  {
    slug: "bulut-mutfak",
    title: "Bulut Mutfak",
    emoji: "🛵",
    heroImage: "deliveryCity",
    moduleSlugs: [
      "entegrasyonlar",
      "mutfak-ekrani-kds",
      "stok-envanter",
      "raporlar",
    ],
  },
];

export const sectorBySlug = (slug: string): Sector | undefined =>
  SECTORS.find((s) => s.slug === slug);
export const SECTOR_SLUGS = SECTORS.map((s) => s.slug);

import { GENERATED_SECTORS } from "./sectorContent.generated";
export const SECTOR_CONTENT: Record<string, SectorCopy> = GENERATED_SECTORS;

/** Content for a sector slug, with a minimal fallback so a page never breaks. */
export function getSectorCopy(slug: string): SectorCopy | null {
  if (SECTOR_CONTENT[slug]) return SECTOR_CONTENT[slug];
  const s = sectorBySlug(slug);
  if (!s) return null;
  return {
    hero: {
      eyebrow: s.title,
      title: `${s.title} için bulut POS & yönetim`,
      subtitle: "Sipariş, mutfak, ödeme ve raporlama tek panelde.",
    },
    intro: `${s.title} işletmeniz için HummyTummy; QR menü, POS, mutfak ekranı, stok ve raporları tek sistemde birleştirir.`,
    blocks: [],
    why: [],
    faq: [],
    ctaTitle: "Bugün ücretsiz deneyin",
  };
}
