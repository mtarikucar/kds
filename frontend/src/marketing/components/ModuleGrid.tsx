import { Link } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";
import { MODULES } from "../data/modules";

/** The "all-in-one platform" grid — every module card opens its deep-dive page. */
export default function ModuleGrid() {
  return (
    <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {MODULES.map((m) => (
        <Link
          key={m.slug}
          to={`/ozellikler/${m.slug}`}
          className="group relative rounded-2xl border border-[#ece2d4] bg-white p-6 transition hover:-translate-y-1 hover:border-[#f5c9a3] hover:shadow-xl hover:shadow-stone-900/5"
        >
          <ArrowUpRight className="absolute right-5 top-5 h-4 w-4 text-[#d6cdbf] transition group-hover:text-[#f97316]" />
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-[#fff3e8] text-[#f97316] transition group-hover:bg-[#f97316] group-hover:text-white">
            <m.icon className="h-5 w-5" />
          </span>
          <h3 className="mt-4 text-lg font-semibold text-[#1c1917]">
            {m.title}
          </h3>
          <p className="mt-1.5 text-sm leading-relaxed text-[#78716c]">
            {m.tagline}
          </p>
        </Link>
      ))}
    </div>
  );
}
