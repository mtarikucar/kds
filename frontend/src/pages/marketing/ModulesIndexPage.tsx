import { useEffect } from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import MarketingLayout from "../../marketing/MarketingLayout";
import CtaBand from "../../marketing/components/CtaBand";
import { display } from "../../marketing/theme";
import { CATEGORIES, modulesByCategory } from "../../marketing/data/modules";

/** /ozellikler — index of all module deep-dive pages, grouped by category. */
export default function ModulesIndexPage() {
  useEffect(() => {
    document.title = "Özellikler — HummyTummy";
  }, []);

  return (
    <MarketingLayout>
      <section className="ht-grain relative mx-auto max-w-6xl px-5 pb-4 pt-16 text-center sm:pt-20">
        <span className="inline-flex items-center gap-2 rounded-full border border-[#f5c9a3] bg-[#fff3e8] px-3 py-1 text-xs font-semibold text-[#b45309]">
          Özellikler
        </span>
        <h1
          className="mx-auto mt-5 max-w-3xl text-4xl font-semibold leading-tight tracking-tight sm:text-5xl"
          style={display}
        >
          Restoranınızın tüm operasyonu, tek platformda
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-lg leading-relaxed text-[#57534e]">
          QR menüden çoklu şubeye, mutfak ekranından güvenliğe kadar her modül
          birbiriyle konuşur. Detay için modüle tıklayın.
        </p>
      </section>

      <div className="mx-auto max-w-6xl space-y-12 px-5 py-12">
        {CATEGORIES.map((cat) => (
          <div key={cat}>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-[#f97316]">
              {cat}
            </h2>
            <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {modulesByCategory(cat).map((m) => (
                <Link
                  key={m.slug}
                  to={`/ozellikler/${m.slug}`}
                  className="group flex flex-col rounded-2xl border border-[#ece2d4] bg-white p-7 transition hover:-translate-y-1 hover:border-[#f5c9a3] hover:shadow-xl hover:shadow-stone-900/5"
                >
                  <span className="grid h-12 w-12 place-items-center rounded-xl bg-[#fff3e8] text-[#f97316] transition group-hover:bg-[#f97316] group-hover:text-white">
                    <m.icon className="h-6 w-6" />
                  </span>
                  <h3
                    className="mt-4 text-xl font-semibold text-[#1c1917]"
                    style={display}
                  >
                    {m.title}
                  </h3>
                  <p className="mt-1 text-sm font-medium text-[#f97316]">
                    {m.tagline}
                  </p>
                  <ul className="mt-4 flex-1 space-y-1.5 text-sm text-[#78716c]">
                    {m.bullets.slice(0, 3).map((b) => (
                      <li key={b}>• {b}</li>
                    ))}
                  </ul>
                  <span className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-[#1c1917]">
                    Detayları gör
                    <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
                  </span>
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>

      <CtaBand />
    </MarketingLayout>
  );
}
