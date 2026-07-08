import { Link } from "react-router-dom";
import { Check, ArrowRight } from "lucide-react";
import { PLANS, fmtTRY, type Plan } from "../data/plans";
import { display } from "../theme";

// A handful of headline features per tier for the compact homepage teaser.
const HIGHLIGHTS: Record<string, string[]> = {
  TRIAL: ["Tüm özellikler açık", "Sınırsız kullanım", "Kredi kartı gerekmez"],
  BASIC: ["1 şube · 5 kullanıcı", "POS + KDS + Stok", "100 ürün"],
  PRO: [
    "3 şube · 15 kullanıcı",
    "Rezervasyon + Delivery",
    "Gelişmiş raporlar + Personel",
  ],
  BUSINESS: ["Sınırsız şube & kullanıcı", "API erişimi", "Öncelikli destek"],
};

const price = (p: Plan) =>
  p.monthly === null ? "Ücretsiz" : `${fmtTRY(p.monthly)}/ay`;

export default function PlanTeaser() {
  return (
    <div className="mt-10 grid gap-4 lg:grid-cols-4">
      {PLANS.map((p) => (
        <div
          key={p.key}
          className={`flex flex-col rounded-2xl border bg-white p-6 transition ${
            p.highlight
              ? "border-[#f97316] shadow-xl shadow-orange-500/10 ring-1 ring-[#f97316]"
              : "border-[#ece2d4] hover:border-[#f5c9a3]"
          }`}
        >
          {p.highlight && (
            <span className="mb-3 inline-flex w-fit rounded-full bg-[#fff3e8] px-3 py-1 text-xs font-semibold text-[#b45309]">
              En popüler
            </span>
          )}
          <h3 className="text-lg font-semibold text-[#1c1917]" style={display}>
            {p.name}
          </h3>
          <div
            className="mt-1.5 text-xl font-bold text-[#1c1917]"
            style={display}
          >
            {price(p)}
          </div>
          <ul className="mt-4 flex-1 space-y-2.5">
            {HIGHLIGHTS[p.key].map((h) => (
              <li
                key={h}
                className="flex items-start gap-2 text-sm text-[#57534e]"
              >
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#f97316]" />
                {h}
              </li>
            ))}
          </ul>
          <Link
            to="/fiyatlandirma"
            className={`mt-6 inline-flex items-center justify-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
              p.highlight
                ? "bg-[#f97316] text-white hover:bg-[#ea580c]"
                : "border border-[#e3d7c7] text-[#1c1917] hover:border-[#f5c9a3]"
            }`}
          >
            Detaylar <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      ))}
    </div>
  );
}
