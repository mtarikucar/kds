import { useState } from "react";
import { Link } from "react-router-dom";
import { ChefHat, ChevronDown, Menu, X, ArrowRight } from "lucide-react";
import { display } from "../theme";
import { MODULES } from "../data/modules";
import { SECTORS } from "../data/sectors";

function DesktopDropdown({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="group relative">
      <button className="flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-medium text-[#57534e] transition hover:text-[#1c1917] group-focus-within:text-[#1c1917]">
        {label}
        <ChevronDown className="h-4 w-4 transition group-hover:rotate-180 group-focus-within:rotate-180" />
      </button>
      <div className="invisible absolute left-0 top-full z-40 pt-2 opacity-0 transition group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100">
        {children}
      </div>
    </div>
  );
}

export default function MarketingNav() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 border-b border-[#efe6da]/70 bg-[#faf6f0]/85 backdrop-blur">
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3.5">
        <Link to="/" className="flex items-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#f97316] text-white shadow-sm">
            <ChefHat className="h-5 w-5" />
          </span>
          <span
            className="text-lg font-semibold tracking-tight text-[#1c1917]"
            style={display}
          >
            HummyTummy
          </span>
        </Link>

        {/* Desktop nav */}
        <div className="hidden items-center gap-1 lg:flex">
          <DesktopDropdown label="Özellikler">
            <div className="w-[34rem] rounded-2xl border border-[#ece2d4] bg-white p-3 shadow-xl shadow-stone-900/10">
              <div className="grid grid-cols-2 gap-1">
                {MODULES.map((m) => (
                  <Link
                    key={m.slug}
                    to={`/ozellikler/${m.slug}`}
                    className="flex items-start gap-3 rounded-xl p-2.5 transition hover:bg-[#faf6f0]"
                  >
                    <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#fff3e8] text-[#f97316]">
                      <m.icon className="h-5 w-5" />
                    </span>
                    <span>
                      <span className="block text-sm font-semibold text-[#1c1917]">
                        {m.title}
                      </span>
                      <span className="block text-xs leading-snug text-[#78716c]">
                        {m.tagline}
                      </span>
                    </span>
                  </Link>
                ))}
              </div>
              <Link
                to="/ozellikler"
                className="mt-2 flex items-center justify-center gap-1.5 rounded-xl bg-[#faf6f0] px-3 py-2.5 text-sm font-semibold text-[#1c1917] transition hover:bg-[#f1e8db]"
              >
                Tüm özellikleri gör <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </DesktopDropdown>

          <DesktopDropdown label="Çözümler">
            <div className="grid w-72 grid-cols-2 gap-1 rounded-2xl border border-[#ece2d4] bg-white p-3 shadow-xl shadow-stone-900/10">
              {SECTORS.map((s) => (
                <a
                  key={s.title}
                  href={`/${s.anchor}`}
                  className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-[#44403c] transition hover:bg-[#faf6f0]"
                >
                  <span aria-hidden>{s.emoji}</span>
                  {s.title}
                </a>
              ))}
            </div>
          </DesktopDropdown>

          <Link
            to="/ozellikler/entegrasyonlar"
            className="rounded-lg px-3 py-2 text-sm font-medium text-[#57534e] transition hover:text-[#1c1917]"
          >
            Entegrasyonlar
          </Link>
          <Link
            to="/fiyatlandirma"
            className="rounded-lg px-3 py-2 text-sm font-medium text-[#57534e] transition hover:text-[#1c1917]"
          >
            Fiyatlar
          </Link>
        </div>

        <div className="hidden items-center gap-2 lg:flex">
          <Link
            to="/login"
            className="rounded-lg px-3 py-2 text-sm font-semibold text-[#1c1917] transition hover:bg-[#f1e8db]"
          >
            Giriş Yap
          </Link>
          <Link
            to="/register"
            className="rounded-lg bg-[#1c1917] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#3a3531]"
          >
            7 Gün Ücretsiz Dene
          </Link>
        </div>

        {/* Mobile toggle */}
        <button
          className="grid h-10 w-10 place-items-center rounded-lg text-[#1c1917] lg:hidden"
          onClick={() => setOpen((v) => !v)}
          aria-label="Menü"
          aria-expanded={open}
        >
          {open ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </nav>

      {/* Mobile panel */}
      {open && (
        <div className="max-h-[70vh] overflow-y-auto border-t border-[#efe6da] bg-[#faf6f0] px-5 py-4 lg:hidden">
          <p className="px-1 pb-1 text-xs font-semibold uppercase tracking-wider text-[#a8a29e]">
            Özellikler
          </p>
          <div className="grid grid-cols-1 gap-0.5">
            {MODULES.map((m) => (
              <Link
                key={m.slug}
                to={`/ozellikler/${m.slug}`}
                onClick={() => setOpen(false)}
                className="flex items-center gap-3 rounded-lg px-2 py-2.5 text-sm font-medium text-[#44403c] hover:bg-[#f1e8db]"
              >
                <m.icon className="h-4 w-4 text-[#f97316]" />
                {m.title}
              </Link>
            ))}
          </div>
          <div className="mt-3 flex flex-col gap-2 border-t border-[#efe6da] pt-3">
            <Link
              to="/fiyatlandirma"
              onClick={() => setOpen(false)}
              className="rounded-lg px-2 py-2.5 text-sm font-semibold text-[#1c1917] hover:bg-[#f1e8db]"
            >
              Fiyatlar
            </Link>
            <Link
              to="/login"
              onClick={() => setOpen(false)}
              className="rounded-lg px-2 py-2.5 text-sm font-semibold text-[#1c1917] hover:bg-[#f1e8db]"
            >
              Giriş Yap
            </Link>
            <Link
              to="/register"
              onClick={() => setOpen(false)}
              className="rounded-xl bg-[#f97316] px-4 py-3 text-center text-sm font-semibold text-white transition hover:bg-[#ea580c]"
            >
              7 Gün Ücretsiz Dene
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}
