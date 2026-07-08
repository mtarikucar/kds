import { useEffect } from "react";
import { Link } from "react-router-dom";
import { Check, Clock, ArrowRight, Info } from "lucide-react";
import MarketingLayout from "../../marketing/MarketingLayout";
import MediaSlot from "../../marketing/components/MediaSlot";
import CtaBand from "../../marketing/components/CtaBand";
import { display } from "../../marketing/theme";
import {
  INTEGRATION_GROUPS,
  type Brand,
} from "../../marketing/data/integrations";

const monogram = (name: string) =>
  name
    .replace(/[()]/g, "")
    .split(/[\s/]+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toLocaleUpperCase("tr");

function BrandCard({ brand }: { brand: Brand }) {
  const live = brand.status === "entegre";
  return (
    <div
      className={`flex items-center gap-3 rounded-2xl border p-4 transition ${
        live
          ? "border-[#ece2d4] bg-white"
          : "border-dashed border-[#e3d7c7] bg-[#faf6f0]"
      }`}
    >
      {brand.logo ? (
        <span className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-xl bg-white ring-1 ring-[#ece2d4]">
          <img
            src={brand.logo}
            alt={`${brand.name} logosu`}
            width={128}
            height={128}
            loading="lazy"
            decoding="async"
            className="h-8 w-8 object-contain"
          />
        </span>
      ) : (
        <span
          className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl text-sm font-bold ${
            live
              ? "bg-[#1c1917] text-white"
              : "bg-white text-[#a8a29e] ring-1 ring-[#e3d7c7]"
          }`}
          style={display}
          aria-hidden
        >
          {monogram(brand.name)}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-[#1c1917]">
          {brand.name}
        </div>
        {brand.note && (
          <div className="truncate text-xs text-[#a8a29e]">{brand.note}</div>
        )}
      </div>
      {live ? (
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[#e9f6ec] px-2.5 py-1 text-xs font-semibold text-[#15803d]">
          <Check className="h-3.5 w-3.5" /> Entegre
        </span>
      ) : (
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[#fff3e8] px-2.5 py-1 text-xs font-semibold text-[#b45309]">
          <Clock className="h-3.5 w-3.5" /> Yakında
        </span>
      )}
    </div>
  );
}

export default function IntegrationsPage() {
  useEffect(() => {
    document.title = "Entegrasyonlar — HummyTummy";
  }, []);

  const liveCount = INTEGRATION_GROUPS.flatMap((g) => g.brands).filter(
    (b) => b.status === "entegre",
  ).length;

  return (
    <MarketingLayout>
      {/* Hero */}
      <section className="ht-grain relative mx-auto max-w-6xl px-5 pb-6 pt-14 sm:pt-20">
        <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_.95fr]">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-[#f5c9a3] bg-[#fff3e8] px-3 py-1 text-xs font-semibold text-[#b45309]">
              Entegrasyonlar
            </span>
            <h1
              className="mt-5 text-[2.6rem] font-semibold leading-[1.05] tracking-tight sm:text-6xl"
              style={display}
            >
              Kullandığınız her kanal,{" "}
              <span className="text-[#f97316]">tek panelde</span>.
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-[#57534e]">
              Teslimat platformları, e-Fatura, ödeme, yazarkasa ve daha fazlası
              HummyTummy ile konuşur. Bir kanal entegre değilse bile sistem
              eksiksiz çalışır — nasıl olduğunu aşağıda tek tek anlattık.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                to="/register"
                className="group inline-flex items-center gap-2 rounded-xl bg-[#f97316] px-6 py-3.5 text-base font-semibold text-white shadow-lg shadow-orange-500/20 transition hover:bg-[#ea580c]"
              >
                7 Gün Ücretsiz Başla{" "}
                <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
              </Link>
              <a
                href="#kategoriler"
                className="inline-flex items-center gap-2 rounded-xl border border-[#e3d7c7] bg-white px-6 py-3.5 text-base font-semibold text-[#1c1917] transition hover:border-[#cdbfac]"
              >
                Tüm entegrasyonlar
              </a>
            </div>
          </div>
          <MediaSlot
            kind="wide"
            label="Entegrasyon panosu görseli"
            frameLabel="HummyTummy · Entegrasyonlar"
            priority
          />
        </div>
      </section>

      {/* Category sections */}
      <div
        id="kategoriler"
        className="mx-auto max-w-6xl scroll-mt-24 px-5 py-12"
      >
        <div className="space-y-14">
          {INTEGRATION_GROUPS.map((g) => (
            <section key={g.key} id={g.key} className="scroll-mt-24">
              <div className="flex items-start gap-4">
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-[#fff3e8] text-[#f97316]">
                  <g.icon className="h-6 w-6" />
                </span>
                <div>
                  <h2
                    className="text-2xl font-semibold tracking-tight text-[#1c1917] sm:text-3xl"
                    style={display}
                  >
                    {g.title}
                  </h2>
                  <p className="mt-1.5 max-w-2xl text-[#57534e]">{g.desc}</p>
                </div>
              </div>

              <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {g.brands.map((b) => (
                  <BrandCard key={b.name} brand={b} />
                ))}
              </div>

              <div className="mt-4 flex items-start gap-3 rounded-2xl border border-[#f5c9a3] bg-[#fff8f1] p-4">
                <Info className="mt-0.5 h-5 w-5 shrink-0 text-[#f97316]" />
                <p className="text-sm leading-relaxed text-[#57534e]">
                  <span className="font-semibold text-[#b45309]">
                    Entegrasyon yoksa:
                  </span>{" "}
                  {g.noIntegration}
                </p>
              </div>
            </section>
          ))}
        </div>

        <p className="mt-12 text-center text-sm text-[#a8a29e]">
          Şu an{" "}
          <span className="font-semibold text-[#57534e]">
            {liveCount} canlı entegrasyon
          </span>{" "}
          · yeni entegrasyonlar sürekli ekleniyor.
        </p>
      </div>

      <CtaBand title="İşletmenizin tüm kanalları tek panelde buluşsun" />
    </MarketingLayout>
  );
}
