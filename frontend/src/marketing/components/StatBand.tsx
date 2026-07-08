import { display } from "../theme";
import { MODULES } from "../data/modules";
import { INTEGRATION_GROUPS } from "../data/integrations";

// Every figure is computed from (or pinned to) real product data — no invented
// customer counts or uptime percentages (honesty guardrails, spec §7).
const liveIntegrations = INTEGRATION_GROUPS.flatMap((g) => g.brands).filter(
  (b) => b.status === "entegre",
).length;

const STATS = [
  { v: String(MODULES.length), l: "modül, tek platformda" },
  { v: "4", l: "teslimat platformu entegre" },
  { v: String(liveIntegrations), l: "canlı entegrasyon" },
  { v: "5", l: "dilde QR menü (RTL dahil)" },
  { v: "7 gün", l: "ücretsiz, kartsız deneme" },
];

/** Full-bleed dark stat band with oversized Fraunces numerals. */
export default function StatBand() {
  return (
    <div className="ht-grain relative overflow-hidden bg-[#1c1917] py-14 sm:py-16">
      <div className="absolute -left-24 top-0 h-72 w-72 rounded-full bg-[#f97316]/15 blur-3xl" />
      <div className="absolute -right-24 bottom-0 h-72 w-72 rounded-full bg-[#f97316]/10 blur-3xl" />
      <div className="relative mx-auto grid max-w-6xl grid-cols-2 gap-x-6 gap-y-10 px-5 sm:grid-cols-3 lg:grid-cols-5">
        {STATS.map((s) => (
          <div key={s.l} className="text-center">
            <div
              className="text-4xl font-semibold tracking-tight text-[#f97316] sm:text-5xl"
              style={display}
            >
              {s.v}
            </div>
            <div className="mx-auto mt-2 max-w-[11rem] text-sm leading-snug text-[#a8a29e]">
              {s.l}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
