// Delivery-platform + e-invoice chips on the homepage, driven by the same
// integration catalog as /entegrasyonlar (single source of truth). Shows real
// brand logos where we have them.

import { INTEGRATION_GROUPS } from "../data/integrations";

function Chip({ name, logo }: { name: string; logo?: string }) {
  return (
    <span className="inline-flex items-center gap-2.5 rounded-xl border border-[#ece2d4] bg-white py-2.5 pl-3 pr-4 text-sm font-semibold text-[#44403c] shadow-sm">
      {logo && (
        <img
          src={logo}
          alt={`${name} logosu`}
          width={128}
          height={128}
          loading="lazy"
          decoding="async"
          className="h-6 w-6 rounded object-contain"
        />
      )}
      {name}
    </span>
  );
}

export default function IntegrationChips() {
  const delivery =
    INTEGRATION_GROUPS.find((g) => g.key === "teslimat")?.brands.filter(
      (b) => b.status === "entegre",
    ) ?? [];
  const invoice =
    INTEGRATION_GROUPS.find((g) => g.key === "muhasebe")?.brands.filter(
      (b) => b.status === "entegre",
    ) ?? [];

  return (
    <div className="mt-8 space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-semibold text-[#78716c]">Teslimat:</span>
        {delivery.map((b) => (
          <Chip key={b.name} name={b.name} logo={b.logo} />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-semibold text-[#78716c]">
          e-Fatura / e-Arşiv:
        </span>
        {invoice.map((b) => (
          <Chip key={b.name} name={b.name} logo={b.logo} />
        ))}
      </div>
    </div>
  );
}
