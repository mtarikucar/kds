// Honest trust signals (design decision: NO fabricated customer counts, reviews
// or partner logos). Every item is a real, code-backed capability (spec §7).

import {
  Languages,
  Cloud,
  Lock,
  ShieldCheck,
  Truck,
  Headphones,
  type LucideIcon,
} from "lucide-react";

export interface TrustItem {
  icon: LucideIcon;
  label: string;
}

export const TRUST: TrustItem[] = [
  { icon: Languages, label: "5 dilde QR menü" },
  { icon: Cloud, label: "7/24 bulut erişim" },
  { icon: Lock, label: "AES-256 şifreleme" },
  { icon: ShieldCheck, label: "KVKK uyumlu" },
  { icon: Truck, label: "4 teslimat platformu" },
  { icon: Headphones, label: "Türkçe destek" },
];
