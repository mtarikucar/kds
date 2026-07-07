import { SECTORS } from "../data/sectors";

/** "İşletmenize uygun" sector tiles. Phase 1 links to homepage anchors. */
export default function SectorGrid() {
  return (
    <div className="mt-10 grid grid-cols-2 gap-4 sm:grid-cols-4">
      {SECTORS.map((s) => (
        <a
          key={s.title}
          href={s.anchor}
          className="group flex flex-col items-center gap-2 rounded-2xl border border-[#ece2d4] bg-white px-4 py-6 text-center transition hover:-translate-y-1 hover:border-[#f5c9a3] hover:shadow-lg hover:shadow-stone-900/5"
        >
          <span
            className="text-3xl transition group-hover:scale-110"
            aria-hidden
          >
            {s.emoji}
          </span>
          <span className="text-sm font-semibold text-[#44403c]">
            {s.title}
          </span>
        </a>
      ))}
    </div>
  );
}
