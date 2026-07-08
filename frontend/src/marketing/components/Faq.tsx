import { Plus } from "lucide-react";
import type { QA } from "../data/faq";

/** Accessible accordion using native <details>/<summary> (no JS state needed). */
export default function Faq({ items }: { items: QA[] }) {
  return (
    <div className="mt-10 divide-y divide-[#ece2d4] rounded-2xl border border-[#ece2d4] bg-white">
      {items.map((f) => (
        <details key={f.q} className="group px-6 py-1">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 text-left text-base font-semibold text-[#1c1917] [&::-webkit-details-marker]:hidden">
            {f.q}
            <Plus className="h-5 w-5 shrink-0 text-[#f97316] transition group-open:rotate-45" />
          </summary>
          <p className="pb-5 text-[15px] leading-relaxed text-[#57534e]">
            {f.a}
          </p>
        </details>
      ))}
    </div>
  );
}
