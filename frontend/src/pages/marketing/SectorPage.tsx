import { useEffect } from "react";
import { useParams, Navigate, Link } from "react-router-dom";
import { ArrowRight, Check } from "lucide-react";
import MarketingLayout from "../../marketing/MarketingLayout";
import Section from "../../marketing/components/Section";
import SplitFeature from "../../marketing/components/SplitFeature";
import FramedShot from "../../marketing/components/FramedShot";
import MascotFrame from "../../marketing/components/MascotFrame";
import Faq from "../../marketing/components/Faq";
import CtaBand from "../../marketing/components/CtaBand";
import { display } from "../../marketing/theme";
import { IMG, type ImgKey } from "../../marketing/data/images";
import { moduleBySlug } from "../../marketing/data/modules";
import { CONTENT_META } from "../../marketing/data/moduleContent";
import {
  getSectorCopy,
  sectorBySlug,
} from "../../marketing/data/sectorContent";

/**
 * Data-driven sector solution page at /cozumler/:slug. Reframes the product for a
 * business type and links to the module deep-dives that matter for it.
 */
export default function SectorPage() {
  const { slug = "" } = useParams();
  const copy = getSectorCopy(slug);
  const sector = sectorBySlug(slug);

  useEffect(() => {
    if (sector) document.title = `${sector.title} POS & Yönetim — HummyTummy`;
  }, [sector]);

  if (!copy || !sector) return <Navigate to="/cozumler" replace />;

  const modules = sector.moduleSlugs
    .map(moduleBySlug)
    .filter(Boolean) as NonNullable<ReturnType<typeof moduleBySlug>>[];
  // Block images: distinct module hero images, so each sector shows real product shots.
  const blockImgs: ImgKey[] = [
    ...new Set(
      sector.moduleSlugs
        .map((s) => CONTENT_META[s]?.heroImage)
        .filter(Boolean) as ImgKey[],
    ),
  ]
    .filter((k) => k !== sector.heroImage)
    .slice(0, 2);

  return (
    <MarketingLayout>
      {/* Hero */}
      <section className="ht-grain relative mx-auto max-w-6xl px-5 pb-6 pt-14 sm:pt-20">
        <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_.95fr]">
          <div>
            <nav className="mb-4 flex items-center gap-1.5 text-sm text-[#a8a29e]">
              <Link to="/cozumler" className="hover:text-[#57534e]">
                Çözümler
              </Link>
              <span>/</span>
              <span className="text-[#57534e]">{sector.title}</span>
            </nav>
            <span className="inline-flex items-center gap-2 rounded-full border border-[#f5c9a3] bg-[#fff3e8] px-3 py-1 text-xs font-semibold text-[#b45309]">
              <span aria-hidden>{sector.emoji}</span> {copy.hero.eyebrow}
            </span>
            <h1
              className="mt-5 text-[2.4rem] font-semibold leading-[1.08] tracking-tight sm:text-5xl"
              style={display}
            >
              {copy.hero.title}
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-[#57534e]">
              {copy.hero.subtitle}
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                to="/register"
                className="group inline-flex items-center gap-2 rounded-xl bg-[#f97316] px-6 py-3.5 text-base font-semibold text-white shadow-lg shadow-orange-500/20 transition hover:bg-[#ea580c]"
              >
                7 Gün Ücretsiz Başla
                <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
              </Link>
              <Link
                to="/fiyatlandirma"
                className="inline-flex items-center gap-2 rounded-xl border border-[#e3d7c7] bg-white px-6 py-3.5 text-base font-semibold text-[#1c1917] transition hover:border-[#cdbfac]"
              >
                Fiyatları Gör
              </Link>
            </div>
          </div>
          <div className="relative">
            {IMG[sector.heroImage].kind === "scene" ? (
              <FramedShot
                img={sector.heroImage}
                tilt
                label={`HummyTummy · ${sector.title}`}
                priority
                sizes="(max-width:1024px) 90vw, 520px"
              />
            ) : (
              <MascotFrame
                img={sector.heroImage}
                priority
                sizes="(max-width:1024px) 80vw, 460px"
              />
            )}
          </div>
        </div>
      </section>

      {/* Intro */}
      <div className="mx-auto max-w-3xl px-5 py-10 text-center">
        <p className="text-xl leading-relaxed text-[#44403c]">{copy.intro}</p>
      </div>

      {/* Sector-specific blocks */}
      {copy.blocks.map((b, i) =>
        blockImgs[i] ? (
          <SplitFeature
            key={b.title}
            title={b.title}
            desc={b.body}
            bullets={b.bullets}
            image={blockImgs[i]}
            reverse={i % 2 === 1}
          />
        ) : (
          <Section key={b.title}>
            <div className="rounded-3xl border border-[#f5c9a3] bg-[#fff8f1] p-8 sm:p-10">
              <h2
                className="text-2xl font-semibold tracking-tight text-[#1c1917] sm:text-3xl"
                style={display}
              >
                {b.title}
              </h2>
              <p className="mt-4 max-w-3xl text-lg leading-relaxed text-[#57534e]">
                {b.body}
              </p>
              <ul className="mt-6 grid gap-3 sm:grid-cols-2">
                {b.bullets.map((bl) => (
                  <li
                    key={bl}
                    className="flex items-start gap-3 text-[#44403c]"
                  >
                    <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#fff3e8] text-[#f97316]">
                      <Check className="h-3.5 w-3.5" />
                    </span>
                    {bl}
                  </li>
                ))}
              </ul>
            </div>
          </Section>
        ),
      )}

      {/* Why this sector */}
      {copy.why.length > 0 && (
        <Section
          eyebrow="Neden HummyTummy?"
          title={`${sector.title} için doğru seçim`}
        >
          <div className="mt-10 grid gap-4 sm:grid-cols-2">
            {copy.why.map((w) => (
              <div
                key={w}
                className="flex items-start gap-3 rounded-2xl border border-[#ece2d4] bg-white p-5"
              >
                <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-[#fff3e8] text-[#f97316]">
                  <Check className="h-4 w-4" />
                </span>
                <span className="text-[#44403c]">{w}</span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Modules that matter for this sector */}
      <Section
        eyebrow="İşinize göre modüller"
        title={`${sector.title} için öne çıkan özellikler`}
      >
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {modules.map((m) => (
            <Link
              key={m.slug}
              to={`/ozellikler/${m.slug}`}
              className="group rounded-2xl border border-[#ece2d4] bg-white p-6 transition hover:-translate-y-1 hover:border-[#f5c9a3] hover:shadow-xl hover:shadow-stone-900/5"
            >
              <span className="grid h-11 w-11 place-items-center rounded-xl bg-[#fff3e8] text-[#f97316] transition group-hover:bg-[#f97316] group-hover:text-white">
                <m.icon className="h-5 w-5" />
              </span>
              <h3 className="mt-4 flex items-center gap-1.5 text-lg font-semibold text-[#1c1917]">
                {m.title}
                <ArrowRight className="h-4 w-4 text-[#d6cdbf] transition group-hover:translate-x-0.5 group-hover:text-[#f97316]" />
              </h3>
              <p className="mt-1.5 text-sm leading-relaxed text-[#78716c]">
                {m.tagline}
              </p>
            </Link>
          ))}
        </div>
      </Section>

      {/* FAQ */}
      {copy.faq.length > 0 && (
        <Section eyebrow="SSS" title={`${sector.title} hakkında sorular`}>
          <Faq items={copy.faq} />
        </Section>
      )}

      <CtaBand title={copy.ctaTitle} />
    </MarketingLayout>
  );
}
