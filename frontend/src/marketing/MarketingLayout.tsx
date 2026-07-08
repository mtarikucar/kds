import type { ReactNode } from "react";
import MarketingNav from "./components/MarketingNav";
import MarketingFooter from "./components/MarketingFooter";

/**
 * Shared chrome for all public marketing pages (home, pricing, and — in Phase 2 —
 * module deep-dives). Owns the brand background wash + grain style and the
 * sticky nav / sitemap footer. Page content is passed as children.
 */
export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="ht-landing min-h-screen bg-[#faf6f0] text-[#1c1917] antialiased">
      <style>{`
        @keyframes ht-rise { from { opacity: 0; transform: translateY(18px); } to { opacity: 1; transform: translateY(0); } }
        .ht-landing [data-rise] { opacity: 0; animation: ht-rise .7s cubic-bezier(.2,.7,.2,1) forwards; }
        .ht-landing { background-image: radial-gradient(1200px 520px at 78% -8%, rgba(249,115,22,.16), transparent 60%), radial-gradient(900px 460px at -5% 8%, rgba(180,83,9,.08), transparent 55%); }
        .ht-grain::before { content:""; position:absolute; inset:0; pointer-events:none; opacity:.5; mix-blend-mode:multiply;
          background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='.045'/%3E%3C/svg%3E"); }
        @media (prefers-reduced-motion: reduce) { .ht-landing [data-rise] { animation: none; opacity: 1; } }
      `}</style>
      <MarketingNav />
      <main>{children}</main>
      <MarketingFooter />
    </div>
  );
}
