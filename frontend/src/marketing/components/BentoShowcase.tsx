import { Link } from "react-router-dom";
import { ArrowUpRight, ArrowRight } from "lucide-react";
import { display } from "../theme";
import { IMG, type ImgKey } from "../data/images";
import { moduleBySlug } from "../data/modules";

/**
 * Asymmetric, image-driven module showcase (replaces the uniform card grid).
 * Flagship modules get full-bleed photo cells of varying sizes; the long tail
 * collapses into a pill row. Kills the "every section is the same grid" feel.
 */

interface Cell {
  slug: string;
  img: ImgKey;
  span: string; // lg col-span + height
}

const CELLS: Cell[] = [
  {
    slug: "mutfak-ekrani-kds",
    img: "kdsChef",
    span: "lg:col-span-7 min-h-[300px] lg:min-h-[400px]",
  },
  {
    slug: "qr-menu",
    img: "qrStand",
    span: "lg:col-span-5 min-h-[300px] lg:min-h-[400px]",
  },
  {
    slug: "pos-odeme",
    img: "posTerminal",
    span: "lg:col-span-4 min-h-[260px]",
  },
  {
    slug: "stok-envanter",
    img: "chartIcon",
    span: "lg:col-span-4 min-h-[260px]",
  },
  { slug: "raporlar", img: "reportPhone", span: "lg:col-span-4 min-h-[260px]" },
  {
    slug: "coklu-sube",
    img: "dioramaBuilding",
    span: "lg:col-span-6 min-h-[260px]",
  },
  {
    slug: "masa-siparis",
    img: "dioramaInterior",
    span: "lg:col-span-6 min-h-[260px]",
  },
];

const PILL_SLUGS = [
  "rezervasyon",
  "garson-cagri",
  "personel",
  "musteri-sadakat",
  "analitik",
  "e-fatura",
  "donanim",
  "marketplace",
  "guvenlik",
];

function BentoCell({ cell }: { cell: Cell }) {
  const m = moduleBySlug(cell.slug);
  if (!m) return null;
  const i = IMG[cell.img];
  return (
    <Link
      to={`/ozellikler/${m.slug}`}
      className={`group relative flex flex-col justify-end overflow-hidden rounded-3xl ${cell.span}`}
    >
      <img
        src={i.src}
        srcSet={`${i.srcSm} 520w, ${i.src} 1000w`}
        sizes="(max-width: 1024px) 90vw, 640px"
        alt={i.alt}
        loading="lazy"
        decoding="async"
        className="absolute inset-0 h-full w-full object-cover transition duration-700 group-hover:scale-[1.04]"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-[#1c1917]/85 via-[#1c1917]/25 to-transparent" />
      <ArrowUpRight className="absolute right-5 top-5 h-5 w-5 text-white/60 transition group-hover:text-white" />
      <div className="relative p-6">
        <h3
          className="text-xl font-semibold text-white sm:text-2xl"
          style={display}
        >
          {m.title}
        </h3>
        <p className="mt-1 max-w-md text-sm leading-relaxed text-white/75">
          {m.tagline}
        </p>
      </div>
    </Link>
  );
}

export default function BentoShowcase() {
  return (
    <div className="mt-10">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-12">
        {CELLS.map((c) => (
          <BentoCell key={c.slug} cell={c} />
        ))}
      </div>

      {/* Long tail as pills */}
      <div className="mt-6 flex flex-wrap items-center gap-2.5">
        {PILL_SLUGS.map((slug) => {
          const m = moduleBySlug(slug);
          if (!m) return null;
          return (
            <Link
              key={slug}
              to={`/ozellikler/${slug}`}
              className="group inline-flex items-center gap-2 rounded-full border border-[#e3d7c7] bg-white px-4 py-2.5 text-sm font-semibold text-[#44403c] transition hover:border-[#f5c9a3] hover:bg-[#fff8f1] hover:text-[#1c1917]"
            >
              <m.icon className="h-4 w-4 text-[#f97316]" />
              {m.title}
            </Link>
          );
        })}
        <Link
          to="/ozellikler"
          className="inline-flex items-center gap-1.5 rounded-full bg-[#1c1917] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#3a3531]"
        >
          Tümünü gör <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </div>
  );
}
