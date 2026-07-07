import { useState } from "react";
import { Link } from "react-router-dom";
import { Check, Minus } from "lucide-react";
import {
  PLANS,
  LIMIT_ROWS,
  FEATURE_ROWS,
  fmtTRY,
  type Plan,
} from "../data/plans";
import { display } from "../theme";

const limitVal = (v: number | "unlimited") =>
  v === "unlimited" ? "Sınırsız" : new Intl.NumberFormat("tr-TR").format(v);

function PriceCell({
  plan,
  cycle,
}: {
  plan: Plan;
  cycle: "monthly" | "yearly";
}) {
  if (plan.monthly === null) {
    return (
      <div className="text-2xl font-bold text-[#1c1917]" style={display}>
        Ücretsiz
      </div>
    );
  }
  const amount = cycle === "monthly" ? plan.monthly : plan.yearly!;
  return (
    <div>
      <span className="text-2xl font-bold text-[#1c1917]" style={display}>
        {fmtTRY(amount)}
      </span>
      <span className="text-sm font-medium text-[#78716c]">
        /{cycle === "monthly" ? "ay" : "yıl"}
      </span>
    </div>
  );
}

const cta = (plan: Plan) =>
  plan.key === "BUSINESS"
    ? { to: "/register", label: "Bize Ulaşın" }
    : { to: "/register", label: "7 Gün Ücretsiz" };

export default function PlanTable() {
  const [cycle, setCycle] = useState<"monthly" | "yearly">("monthly");

  return (
    <div>
      {/* Billing cycle toggle */}
      <div className="flex justify-center">
        <div className="inline-flex rounded-xl border border-[#ece2d4] bg-white p-1">
          {(["monthly", "yearly"] as const).map((c) => (
            <button
              key={c}
              onClick={() => setCycle(c)}
              className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
                cycle === c
                  ? "bg-[#f97316] text-white"
                  : "text-[#57534e] hover:text-[#1c1917]"
              }`}
            >
              {c === "monthly" ? "Aylık" : "Yıllık (indirimli)"}
            </button>
          ))}
        </div>
      </div>

      {/* Plan header cards */}
      <div className="mt-8 grid gap-4 lg:grid-cols-4">
        {PLANS.map((p) => (
          <div
            key={p.key}
            className={`flex flex-col rounded-2xl border bg-white p-6 ${
              p.highlight
                ? "border-[#f97316] shadow-xl shadow-orange-500/10 ring-1 ring-[#f97316]"
                : "border-[#ece2d4]"
            }`}
          >
            {p.highlight && (
              <span className="mb-3 inline-flex w-fit rounded-full bg-[#fff3e8] px-3 py-1 text-xs font-semibold text-[#b45309]">
                En popüler
              </span>
            )}
            <h3
              className="text-lg font-semibold text-[#1c1917]"
              style={display}
            >
              {p.name}
            </h3>
            <div className="mt-2">
              <PriceCell plan={p} cycle={cycle} />
            </div>
            <p className="mt-3 min-h-[3rem] text-sm leading-relaxed text-[#78716c]">
              {p.tagline}
            </p>
            <Link
              to={cta(p).to}
              className={`mt-5 inline-flex items-center justify-center rounded-xl px-4 py-3 text-sm font-semibold transition ${
                p.highlight
                  ? "bg-[#f97316] text-white hover:bg-[#ea580c]"
                  : "border border-[#e3d7c7] bg-white text-[#1c1917] hover:border-[#f5c9a3]"
              }`}
            >
              {cta(p).label}
            </Link>
          </div>
        ))}
      </div>

      {/* Comparison table */}
      <div className="mt-10 overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead>
            <tr>
              <th className="w-56 py-3 text-left font-semibold text-[#78716c]">
                Kapasite & Özellikler
              </th>
              {PLANS.map((p) => (
                <th
                  key={p.key}
                  className="px-3 py-3 text-center font-semibold text-[#1c1917]"
                >
                  {p.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {LIMIT_ROWS.map((row) => (
              <tr key={row.key} className="border-t border-[#ece2d4]">
                <td className="py-3 text-left text-[#44403c]">{row.label}</td>
                {PLANS.map((p) => (
                  <td
                    key={p.key}
                    className="px-3 py-3 text-center font-medium text-[#1c1917]"
                  >
                    {limitVal(p.limits[row.key])}
                  </td>
                ))}
              </tr>
            ))}
            {FEATURE_ROWS.map((row) => (
              <tr key={row.key} className="border-t border-[#ece2d4]">
                <td className="py-3 text-left text-[#44403c]">{row.label}</td>
                {PLANS.map((p) => (
                  <td key={p.key} className="px-3 py-3 text-center">
                    {p.features[row.key] ? (
                      <Check className="mx-auto h-5 w-5 text-[#16a34a]" />
                    ) : (
                      <Minus className="mx-auto h-4 w-4 text-[#d6cdbf]" />
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-5 text-center text-sm text-[#a8a29e]">
        Fiyatlar TRY ve KDV dahildir. Deneme dışındaki planlar PayTR ile güvenle
        ödenir.
      </p>
    </div>
  );
}
