// Delivery-platform integrations. We do NOT use partner trademark logos (we have
// no licensed assets); styled name chips keep it honest. Exactly the 4 platforms
// with real production adapters (spec §2 / §5).

const PLATFORMS = ["Yemeksepeti", "Getir", "Trendyol Yemek", "Migros Yemek"];

const E_INVOICE = ["Paraşüt", "Foriba", "Logo"];

export default function IntegrationChips() {
  return (
    <div className="mt-8 space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-semibold text-[#78716c]">Teslimat:</span>
        {PLATFORMS.map((p) => (
          <span
            key={p}
            className="rounded-xl border border-[#ece2d4] bg-white px-4 py-2.5 text-sm font-semibold text-[#44403c] shadow-sm"
          >
            {p}
          </span>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-semibold text-[#78716c]">
          e-Fatura / e-Arşiv:
        </span>
        {E_INVOICE.map((p) => (
          <span
            key={p}
            className="rounded-xl border border-[#ece2d4] bg-white px-4 py-2.5 text-sm font-semibold text-[#44403c] shadow-sm"
          >
            {p}
          </span>
        ))}
      </div>
    </div>
  );
}
