// Real subscription plans — verified against
// backend/src/common/constants/subscription-plans.const.ts + backend/prisma/seed.ts.
// Prices are TRY, KDV-inclusive (advertised gross). `-1` in code = unlimited (∞).
// FREE is a retired tombstone (never seeded) and is intentionally omitted.

export type FeatureKey =
  | "posAccess"
  | "kdsIntegration"
  | "inventoryTracking"
  | "advancedReports"
  | "reservationSystem"
  | "personnelManagement"
  | "deliveryIntegration"
  | "multiLocation"
  | "customBranding"
  | "prioritySupport"
  | "apiAccess"
  | "externalDisplay";

export type LimitKey =
  "maxUsers" | "maxTables" | "maxBranches" | "maxProducts" | "maxMonthlyOrders";

export type PlanKey = "TRIAL" | "BASIC" | "PRO" | "BUSINESS";

export interface Plan {
  key: PlanKey;
  name: string;
  tagline: string;
  monthly: number | null; // TRY/ay, null = fiyat yok (deneme)
  yearly: number | null; // TRY/yıl (indirimli)
  purchasable: boolean;
  highlight?: boolean;
  limits: Record<LimitKey, number | "unlimited">;
  features: Record<FeatureKey, boolean>;
}

const U = "unlimited" as const;

// Feature ladder: base modules everywhere; the "advanced" band is off on BASIC;
// apiAccess + externalDisplay only on TRIAL & BUSINESS.
const base = { posAccess: true, kdsIntegration: true, inventoryTracking: true };
const advanced = {
  advancedReports: true,
  reservationSystem: true,
  personnelManagement: true,
  deliveryIntegration: true,
  multiLocation: true,
  customBranding: true,
  prioritySupport: true,
};
const advancedOff = {
  advancedReports: false,
  reservationSystem: false,
  personnelManagement: false,
  deliveryIntegration: false,
  multiLocation: false,
  customBranding: false,
  prioritySupport: false,
};

export const PLANS: Plan[] = [
  {
    key: "TRIAL",
    name: "Deneme",
    tagline: "7 gün boyunca tüm özellikler açık — kredi kartı gerekmez.",
    monthly: null,
    yearly: null,
    purchasable: false,
    limits: {
      maxUsers: U,
      maxTables: U,
      maxBranches: U,
      maxProducts: U,
      maxMonthlyOrders: U,
    },
    features: { ...base, ...advanced, apiAccess: true, externalDisplay: true },
  },
  {
    key: "BASIC",
    name: "Başlangıç",
    tagline: "Kafe ve küçük restoranlar için temel POS + stok takibi.",
    monthly: 499,
    yearly: 4490,
    purchasable: true,
    limits: {
      maxUsers: 5,
      maxTables: 20,
      maxBranches: 1,
      maxProducts: 100,
      maxMonthlyOrders: 500,
    },
    features: {
      ...base,
      ...advancedOff,
      apiAccess: false,
      externalDisplay: false,
    },
  },
  {
    key: "PRO",
    name: "Profesyonel",
    tagline:
      "Şehir merkezi restoranları için rezervasyon + delivery + personel.",
    monthly: 1299,
    yearly: 12990,
    purchasable: true,
    highlight: true,
    limits: {
      maxUsers: 15,
      maxTables: 50,
      maxBranches: 3,
      maxProducts: 500,
      maxMonthlyOrders: 2000,
    },
    features: {
      ...base,
      ...advanced,
      apiAccess: false,
      externalDisplay: false,
    },
  },
  {
    key: "BUSINESS",
    name: "Kurumsal",
    tagline:
      "Çok şubeli zincirler için sınırsız + API erişimi + öncelikli destek.",
    monthly: 2999,
    yearly: 29990,
    purchasable: true,
    limits: {
      maxUsers: U,
      maxTables: U,
      maxBranches: U,
      maxProducts: U,
      maxMonthlyOrders: U,
    },
    features: { ...base, ...advanced, apiAccess: true, externalDisplay: true },
  },
];

export const LIMIT_ROWS: { key: LimitKey; label: string }[] = [
  { key: "maxBranches", label: "Şube" },
  { key: "maxUsers", label: "Kullanıcı" },
  { key: "maxTables", label: "Masa" },
  { key: "maxProducts", label: "Ürün" },
  { key: "maxMonthlyOrders", label: "Aylık sipariş" },
];

export const FEATURE_ROWS: { key: FeatureKey; label: string }[] = [
  { key: "posAccess", label: "POS satış ekranı" },
  { key: "kdsIntegration", label: "Mutfak ekranı (KDS)" },
  { key: "inventoryTracking", label: "Stok & envanter" },
  { key: "advancedReports", label: "Gelişmiş raporlar" },
  { key: "reservationSystem", label: "Rezervasyon" },
  { key: "personnelManagement", label: "Personel yönetimi" },
  { key: "deliveryIntegration", label: "Teslimat entegrasyonu" },
  { key: "multiLocation", label: "Çoklu şube" },
  { key: "customBranding", label: "Özel marka" },
  { key: "prioritySupport", label: "Öncelikli destek" },
  { key: "apiAccess", label: "API erişimi" },
  { key: "externalDisplay", label: "Partner ekran (dış)" },
];

export const fmtTRY = (n: number): string =>
  new Intl.NumberFormat("tr-TR").format(n) + " ₺";
