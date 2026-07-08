import { Link } from "react-router-dom";
import { ArrowRight, Check } from "lucide-react";
import { display } from "../theme";

interface CtaBandProps {
  title?: string;
  subtitle?: string;
  chips?: string[];
}

export default function CtaBand({
  title = "Bugün kurun, bugün sipariş alın",
  subtitle = "7 gün boyunca tüm özellikleri ücretsiz deneyin. Kredi kartı istemiyoruz.",
  chips = ["Kurulum ücreti yok", "Kredi kartı gerekmez", "Türkçe destek"],
}: CtaBandProps) {
  return (
    <div className="mx-auto max-w-6xl px-5 pb-20 pt-4">
      <div className="ht-grain relative overflow-hidden rounded-3xl bg-[#1c1917] px-8 py-14 text-center sm:px-16">
        <div className="absolute -right-16 -top-16 h-64 w-64 rounded-full bg-[#f97316]/25 blur-3xl" />
        <div className="absolute -bottom-20 -left-16 h-64 w-64 rounded-full bg-[#f97316]/15 blur-3xl" />
        <h2
          className="relative text-3xl font-semibold tracking-tight text-white sm:text-4xl"
          style={display}
        >
          {title}
        </h2>
        <p className="relative mx-auto mt-4 max-w-xl text-[#d6d3d1]">
          {subtitle}
        </p>
        <div className="relative mt-8 flex flex-wrap justify-center gap-3">
          <Link
            to="/register"
            className="inline-flex items-center gap-2 rounded-xl bg-[#f97316] px-7 py-3.5 text-base font-semibold text-white transition hover:bg-[#ea580c]"
          >
            7 Gün Ücretsiz Başla <ArrowRight className="h-4 w-4" />
          </Link>
          <Link
            to="/login"
            className="inline-flex items-center gap-2 rounded-xl border border-white/20 px-7 py-3.5 text-base font-semibold text-white transition hover:bg-white/10"
          >
            Giriş Yap
          </Link>
        </div>
        <div className="relative mt-6 flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm text-[#a8a29e]">
          {chips.map((t) => (
            <span key={t} className="inline-flex items-center gap-1.5">
              <Check className="h-4 w-4 text-[#f97316]" />
              {t}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
