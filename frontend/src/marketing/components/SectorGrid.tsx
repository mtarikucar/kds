import { Link } from "react-router-dom";
import { SECTORS } from "../data/sectorContent";

/** "İşletmenize uygun" sector tiles — each opens its /cozumler/:slug page. */
export default function SectorGrid() {
  return (
    <div className="mt-10 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-3">
      {SECTORS.map((s) => (
        <Link
          key={s.slug}
          to={`/cozumler/${s.slug}`}
          className="group flex items-center gap-3 rounded-2xl border border-[#ece2d4] bg-white px-5 py-4 transition hover:-translate-y-1 hover:border-[#f5c9a3] hover:shadow-lg hover:shadow-stone-900/5"
        >
          <span
            className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#faf6f0] text-2xl transition group-hover:scale-110"
            aria-hidden
          >
            {s.emoji}
          </span>
          <span className="text-sm font-semibold text-[#44403c]">
            {s.title}
          </span>
        </Link>
      ))}
    </div>
  );
}
