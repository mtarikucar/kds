import { useEffect } from 'react';
import { Link, Navigate } from 'react-router-dom';
import {
  QrCode,
  CreditCard,
  ChefHat,
  LayoutGrid,
  Boxes,
  BarChart3,
  Building2,
  MonitorSmartphone,
  ArrowRight,
  Check,
} from 'lucide-react';
import { useAuthStore } from '../store/authStore';

/**
 * Public marketing homepage at `/` (non-subdomain app).
 *
 * Replaces the old `/` → /login redirect so the OAuth-consent-screen homepage
 * is (a) reachable without logging in and (b) explains what HummyTummy is —
 * the two items Google's verification flagged. Logged-in visitors are sent
 * straight to the app, so existing users keep their app-first flow.
 */
const FEATURES = [
  {
    icon: QrCode,
    title: 'QR Menü',
    desc: 'Masaya yapıştır, müşteri telefonundan menüyü açsın ve sipariş versin. Fiyat/ürün değişikliği anında yansır — baskı yok.',
  },
  {
    icon: CreditCard,
    title: 'POS & Ödeme',
    desc: 'Hızlı satış ekranı; nakit, kart ve PayTR ile self-pay. Hesap böl, indirim uygula, masayı saniyeler içinde kapat.',
  },
  {
    icon: ChefHat,
    title: 'Mutfak Ekranı (KDS)',
    desc: 'Siparişler mutfağa anında düşer; istasyon bazlı yönlendirme, durum takibi ve sesli/görsel uyarılar.',
  },
  {
    icon: LayoutGrid,
    title: 'Sipariş & Masa Yönetimi',
    desc: 'Kat planı üzerinde canlı masa durumu, rezervasyon, masa birleştirme/bölme ve garson çağrısı.',
  },
  {
    icon: Boxes,
    title: 'Stok & Envanter',
    desc: 'Reçete bazlı stok düşümü, tedarikçi, satınalma, sayım ve fire takibi — maliyetini kontrol et.',
  },
  {
    icon: BarChart3,
    title: 'Raporlar & Analitik',
    desc: 'Ciro, ürün, personel ve saat bazlı raporlar; gerçek zamanlı panel ve dışa aktarım.',
  },
  {
    icon: Building2,
    title: 'Çoklu Şube',
    desc: 'Tüm şubeleri tek hesaptan yönet; şube bazlı yetki, menü ve raporlama.',
  },
  {
    icon: MonitorSmartphone,
    title: 'Uzak Ekran & Entegrasyon',
    desc: 'Partner API ile masa tabletleri, teslimat platformları (Yemeksepeti/Getir/Trendyol) ve e-Fatura entegrasyonları.',
  },
];

const STATS = [
  { value: '7', label: 'gün ücretsiz deneme' },
  { value: 'Tek', label: 'panelden tüm operasyon' },
  { value: '5', label: 'dil destekli QR menü' },
  { value: '7/24', label: 'bulut erişimi' },
];

export default function LandingPage() {
  const isAuthenticated = useAuthStore((s) => !!s.accessToken);

  useEffect(() => {
    document.title = 'HummyTummy — Bulut Tabanlı Restoran Yönetim Sistemi';
  }, []);

  // Logged-in users keep the app-first flow (root → app), not marketing.
  if (isAuthenticated) return <Navigate to="/dashboard" replace />;

  const display = { fontFamily: '"Fraunces", Georgia, serif' } as const;

  return (
    <div className="ht-landing min-h-screen bg-[#faf6f0] text-[#1c1917] antialiased">
      <style>{`
        @keyframes ht-rise { from { opacity: 0; transform: translateY(18px); } to { opacity: 1; transform: translateY(0); } }
        .ht-landing [data-rise] { opacity: 0; animation: ht-rise .7s cubic-bezier(.2,.7,.2,1) forwards; }
        .ht-landing { background-image: radial-gradient(1200px 520px at 78% -8%, rgba(249,115,22,.16), transparent 60%), radial-gradient(900px 460px at -5% 8%, rgba(180,83,9,.08), transparent 55%); }
        .ht-grain::before { content:""; position:absolute; inset:0; pointer-events:none; opacity:.5; mix-blend-mode:multiply;
          background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='.045'/%3E%3C/svg%3E"); }
      `}</style>

      {/* Nav */}
      <header className="sticky top-0 z-30 border-b border-[#efe6da]/70 bg-[#faf6f0]/85 backdrop-blur">
        <nav className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
          <div className="flex items-center gap-2">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#f97316] text-white shadow-sm">
              <ChefHat className="h-5 w-5" />
            </span>
            <span className="text-lg font-semibold tracking-tight" style={display}>
              HummyTummy
            </span>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <a href="#ozellikler" className="hidden rounded-lg px-3 py-2 text-sm font-medium text-[#57534e] hover:text-[#1c1917] sm:block">
              Özellikler
            </a>
            <Link to="/login" className="rounded-lg px-3 py-2 text-sm font-semibold text-[#1c1917] hover:bg-[#f1e8db]">
              Giriş Yap
            </Link>
            <Link
              to="/register"
              className="rounded-lg bg-[#1c1917] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#3a3531]"
            >
              Ücretsiz Dene
            </Link>
          </div>
        </nav>
      </header>

      {/* Hero */}
      <section className="ht-grain relative mx-auto max-w-6xl px-5 pb-10 pt-16 sm:pt-24">
        <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_.95fr]">
          <div>
            <span
              data-rise
              style={{ animationDelay: '40ms' }}
              className="inline-flex items-center gap-2 rounded-full border border-[#f5c9a3] bg-[#fff3e8] px-3 py-1 text-xs font-semibold text-[#b45309]"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-[#f97316]" /> Restoranlar için bulut yazılımı
            </span>
            <h1
              data-rise
              style={{ ...display, animationDelay: '120ms' }}
              className="mt-5 text-[2.6rem] font-semibold leading-[1.05] tracking-tight sm:text-6xl"
            >
              Restoranınızı{' '}
              <span className="relative whitespace-nowrap text-[#f97316]">
                tek panelden
                <svg className="absolute -bottom-2 left-0 w-full" height="10" viewBox="0 0 200 10" fill="none" preserveAspectRatio="none">
                  <path d="M2 7c40-5 158-5 196 0" stroke="#f97316" strokeWidth="3" strokeLinecap="round" opacity=".5" />
                </svg>
              </span>{' '}
              yönetin.
            </h1>
            <p data-rise style={{ animationDelay: '200ms' }} className="mt-6 max-w-xl text-lg leading-relaxed text-[#57534e]">
              HummyTummy; <strong className="font-semibold text-[#1c1917]">QR menü, POS, mutfak ekranı (KDS), sipariş, masa ve stok yönetimini</strong> bulutta
              birleştiren bir restoran yönetim sistemidir. Kurulum dakikalar, erişim her yerden.
            </p>
            <div data-rise style={{ animationDelay: '280ms' }} className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                to="/register"
                className="group inline-flex items-center gap-2 rounded-xl bg-[#f97316] px-6 py-3.5 text-base font-semibold text-white shadow-lg shadow-orange-500/20 transition hover:bg-[#ea580c]"
              >
                Ücretsiz Dene
                <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
              </Link>
              <Link
                to="/login"
                className="inline-flex items-center gap-2 rounded-xl border border-[#e3d7c7] bg-white px-6 py-3.5 text-base font-semibold text-[#1c1917] transition hover:border-[#cdbfac]"
              >
                Giriş Yap
              </Link>
            </div>
            <p data-rise style={{ animationDelay: '340ms' }} className="mt-4 text-sm text-[#78716c]">
              7 gün ücretsiz · kredi kartı gerekmez · istediğin an iptal
            </p>
          </div>

          {/* CSS product mock */}
          <div data-rise style={{ animationDelay: '260ms' }} className="relative">
            <div className="absolute -inset-4 -z-10 rounded-[2rem] bg-gradient-to-br from-[#fff3e8] to-transparent blur-2xl" />
            <div className="rotate-1 rounded-2xl border border-[#ece2d4] bg-white p-4 shadow-2xl shadow-stone-900/10">
              <div className="flex items-center gap-1.5 pb-3">
                <span className="h-2.5 w-2.5 rounded-full bg-[#f97316]" />
                <span className="h-2.5 w-2.5 rounded-full bg-[#fcd9b6]" />
                <span className="h-2.5 w-2.5 rounded-full bg-[#efe6da]" />
                <span className="ml-2 text-xs font-medium text-[#a8a29e]">HummyTummy · Panel</span>
              </div>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { k: 'Bugünkü ciro', v: '₺18.420' },
                  { k: 'Aktif masa', v: '12 / 20' },
                  { k: 'Açık sipariş', v: '7' },
                ].map((c) => (
                  <div key={c.k} className="rounded-xl bg-[#faf6f0] p-3">
                    <div className="text-[10px] font-medium uppercase tracking-wide text-[#a8a29e]">{c.k}</div>
                    <div className="mt-1 text-lg font-bold text-[#1c1917]" style={display}>{c.v}</div>
                  </div>
                ))}
              </div>
              <div className="mt-3 space-y-2">
                {[
                  { t: 'Masa 4 · 2× Adana, 1× Ayran', s: 'Hazırlanıyor', c: 'bg-[#fff3e8] text-[#b45309]' },
                  { t: 'Masa 9 · 1× Pizza, 2× Kola', s: 'Hazır', c: 'bg-[#e9f6ec] text-[#15803d]' },
                  { t: 'Paket · 3× Lahmacun', s: 'Yeni', c: 'bg-[#eef2ff] text-[#4f46e5]' },
                ].map((r) => (
                  <div key={r.t} className="flex items-center justify-between rounded-xl border border-[#f1e8db] px-3 py-2.5">
                    <span className="text-sm text-[#44403c]">{r.t}</span>
                    <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${r.c}`}>{r.s}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Stats strip */}
      <section className="mx-auto max-w-6xl px-5 py-8">
        <div className="grid grid-cols-2 divide-[#ece2d4] rounded-2xl border border-[#ece2d4] bg-white/70 sm:grid-cols-4 sm:divide-x">
          {STATS.map((s) => (
            <div key={s.label} className="px-6 py-5 text-center">
              <div className="text-2xl font-bold text-[#f97316]" style={display}>{s.value}</div>
              <div className="mt-1 text-sm text-[#78716c]">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section id="ozellikler" className="mx-auto max-w-6xl scroll-mt-20 px-5 py-16">
        <div className="max-w-2xl">
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl" style={display}>
            Operasyonun tamamı, bir arada
          </h2>
          <p className="mt-3 text-lg text-[#57534e]">
            Ön salondan mutfağa, stoktan rapora kadar restoranınızın her parçası tek sistemde konuşur.
          </p>
        </div>
        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="group rounded-2xl border border-[#ece2d4] bg-white p-6 transition hover:-translate-y-1 hover:border-[#f5c9a3] hover:shadow-xl hover:shadow-stone-900/5"
            >
              <span className="grid h-11 w-11 place-items-center rounded-xl bg-[#fff3e8] text-[#f97316] transition group-hover:bg-[#f97316] group-hover:text-white">
                <f.icon className="h-5 w-5" />
              </span>
              <h3 className="mt-4 text-lg font-semibold text-[#1c1917]">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-[#78716c]">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA band */}
      <section className="mx-auto max-w-6xl px-5 pb-20">
        <div className="ht-grain relative overflow-hidden rounded-3xl bg-[#1c1917] px-8 py-14 text-center sm:px-16">
          <div className="absolute -right-16 -top-16 h-64 w-64 rounded-full bg-[#f97316]/25 blur-3xl" />
          <h2 className="relative text-3xl font-semibold tracking-tight text-white sm:text-4xl" style={display}>
            Bugün kurun, bugün sipariş alın
          </h2>
          <p className="relative mx-auto mt-4 max-w-xl text-[#d6d3d1]">
            7 gün boyunca tüm özellikleri ücretsiz deneyin. Kredi kartı istemiyoruz.
          </p>
          <div className="relative mt-8 flex flex-wrap justify-center gap-3">
            <Link to="/register" className="inline-flex items-center gap-2 rounded-xl bg-[#f97316] px-7 py-3.5 text-base font-semibold text-white transition hover:bg-[#ea580c]">
              Ücretsiz Dene <ArrowRight className="h-4 w-4" />
            </Link>
            <Link to="/login" className="inline-flex items-center gap-2 rounded-xl border border-white/20 px-7 py-3.5 text-base font-semibold text-white transition hover:bg-white/10">
              Giriş Yap
            </Link>
          </div>
          <div className="relative mt-6 flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm text-[#a8a29e]">
            {['Kurulum ücreti yok', 'Sınırsız kullanıcı (Business)', 'Türkçe destek'].map((t) => (
              <span key={t} className="inline-flex items-center gap-1.5"><Check className="h-4 w-4 text-[#f97316]" />{t}</span>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-[#ece2d4] bg-[#f7f1e8]">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-5 py-10 sm:flex-row sm:items-center sm:justify-between">
          <div className="max-w-sm">
            <div className="flex items-center gap-2">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-[#f97316] text-white">
                <ChefHat className="h-4 w-4" />
              </span>
              <span className="font-semibold" style={display}>HummyTummy</span>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-[#78716c]">
              Bulut tabanlı restoran yönetim sistemi — QR menü, POS, mutfak ekranı, sipariş ve stok yönetimi.
            </p>
          </div>
          <nav className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <Link to="/login" className="text-[#57534e] hover:text-[#1c1917]">Giriş</Link>
            <Link to="/register" className="text-[#57534e] hover:text-[#1c1917]">Kayıt Ol</Link>
            <Link to="/privacy" className="text-[#57534e] hover:text-[#1c1917]">Gizlilik Politikası</Link>
            <Link to="/terms" className="text-[#57534e] hover:text-[#1c1917]">Kullanım Şartları</Link>
            <Link to="/legal/kvkk" className="text-[#57534e] hover:text-[#1c1917]">KVKK</Link>
          </nav>
        </div>
        <div className="border-t border-[#ece2d4] py-5 text-center text-xs text-[#a8a29e]">
          © {new Date().getFullYear()} HummyTummy · Tüm hakları saklıdır.
        </div>
      </footer>
    </div>
  );
}
