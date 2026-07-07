import { useEffect } from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import MarketingLayout from "../../marketing/MarketingLayout";
import CtaBand from "../../marketing/components/CtaBand";
import { display } from "../../marketing/theme";
import { SECTORS } from "../../marketing/data/sectorContent";

/** /cozumler — index of all sector solution pages. */
export default function SectorsIndexPage() {
  useEffect(() => {
    document.title = "Çözümler — İşletmenize Göre POS | HummyTummy";
  }, []);

  return (
    <MarketingLayout>
      <section className="ht-grain relative mx-auto max-w-6xl px-5 pb-4 pt-16 text-center sm:pt-20">
        <span className="inline-flex items-center gap-2 rounded-full border border-[#f5c9a3] bg-[#fff3e8] px-3 py-1 text-xs font-semibold text-[#b45309]">
          Çözümler
        </span>
        <h1
          className="mx-auto mt-5 max-w-3xl text-4xl font-semibold leading-tight tracking-tight sm:text-5xl"
          style={display}
        >
          İşletmenize en uygun çözüm
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-lg leading-relaxed text-[#57534e]">
          Restorandan bara, pastaneden bulut mutfağa — HummyTummy her işletme
          türünün operasyonuna uyum sağlar. İşinizi seçin, size özel modülleri
          görün.
        </p>
      </section>

      <div className="mx-auto max-w-6xl px-5 py-12">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {SECTORS.map((s) => (
            <Link
              key={s.slug}
              to={`/cozumler/${s.slug}`}
              className="group flex flex-col rounded-2xl border border-[#ece2d4] bg-white p-7 transition hover:-translate-y-1 hover:border-[#f5c9a3] hover:shadow-xl hover:shadow-stone-900/5"
            >
              <span
                className="grid h-14 w-14 place-items-center rounded-2xl bg-[#faf6f0] text-3xl transition group-hover:scale-110"
                aria-hidden
              >
                {s.emoji}
              </span>
              <h2
                className="mt-4 text-xl font-semibold text-[#1c1917]"
                style={display}
              >
                {s.title}
              </h2>
              <p className="mt-1 flex-1 text-sm text-[#78716c]">
                {s.title} işletmeniz için POS, mutfak, sipariş ve raporlama —
                tek panelde.
              </p>
              <span className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-[#1c1917]">
                Çözümü gör
                <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
              </span>
            </Link>
          ))}
        </div>
      </div>

      <CtaBand />
    </MarketingLayout>
  );
}
