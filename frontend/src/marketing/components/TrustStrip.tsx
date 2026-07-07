import { TRUST } from "../data/trust";

/** Honest capability strip under the hero — no fabricated counts or logos. */
export default function TrustStrip() {
  return (
    <div className="border-y border-[#ece2d4] bg-white/60">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-8 gap-y-4 px-5 py-6">
        {TRUST.map((t) => (
          <span
            key={t.label}
            className="inline-flex items-center gap-2 text-sm font-medium text-[#57534e]"
          >
            <t.icon className="h-4 w-4 text-[#f97316]" />
            {t.label}
          </span>
        ))}
      </div>
    </div>
  );
}
