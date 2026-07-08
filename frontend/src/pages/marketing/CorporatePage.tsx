import { useEffect } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  HeartHandshake,
  Hammer,
  ShieldCheck,
  Building2,
} from "lucide-react";
import MarketingLayout from "../../marketing/MarketingLayout";
import Section from "../../marketing/components/Section";
import MediaSlot from "../../marketing/components/MediaSlot";
import CtaBand from "../../marketing/components/CtaBand";
import { display } from "../../marketing/theme";
import { SISTER_COMPANIES } from "../../marketing/data/integrations";

/**
 * /kurumsal — Hakkımızda + grup şirketleri (Efruze, Figurinica) + sosyal
 * sorumluluk. Sister-company copy and social projects are user-supplied;
 * until then the sections show clearly-labelled placeholders (MediaSlot),
 * never fabricated claims.
 */

const VALUES = [
  {
    icon: ShieldCheck,
    title: "Dürüstlük",
    desc: "Üründe olmayan hiçbir özelliği satmayız. Sitedeki her madde, yazılımda bugün çalışan bir karşılığa işaret eder; yolda olanı da açıkça “yakında” diye işaretleriz.",
  },
  {
    icon: Hammer,
    title: "Ustalık",
    desc: "Mutfağın kaosunu bilen bir ekip olarak yazılımı sahada sınıyoruz: adisyon akışından fiş yazıcısına kadar her parça gerçek servis temposunda çalışacak şekilde işleniyor.",
  },
  {
    icon: HeartHandshake,
    title: "Yerli ve yanında",
    desc: "Türkçe arayüz, Türkçe dokümantasyon ve Türkçe destek. KVKK’ya uygun süreçler, Türkiye’deki işletmelerin gerçek ihtiyaçlarına göre kurgulanmış modüller.",
  },
];

export default function CorporatePage() {
  useEffect(() => {
    document.title = "Kurumsal — HummyTummy";
  }, []);

  return (
    <MarketingLayout>
      {/* Hero */}
      <section className="ht-grain relative mx-auto max-w-6xl px-5 pb-6 pt-14 sm:pt-20">
        <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_.95fr]">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-[#f5c9a3] bg-[#fff3e8] px-3 py-1 text-xs font-semibold text-[#b45309]">
              Kurumsal
            </span>
            <h1
              className="mt-6 text-[clamp(2.5rem,5.5vw,4.5rem)] font-semibold leading-[1.02] tracking-tight"
              style={display}
            >
              Sofranın arkasındaki <span className="text-[#f97316]">ekip</span>.
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-[#57534e]">
              HummyTummy, restoran ve cafe operasyonunun tamamını — QR menüden
              mutfak ekranına, stoktan raporlara — tek bulut platformda
              birleştirmek için kuruldu. Karmaşık, pahalı ve cihaza kilitli
              sistemlerin yerine; dakikalar içinde kurulan, her cihazda çalışan
              ve dürüstçe anlatılan bir ürün yapıyoruz.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                to="/ozellikler"
                className="group inline-flex items-center gap-2 rounded-xl bg-[#1c1917] px-6 py-3.5 text-base font-semibold text-white transition hover:bg-[#3a3531]"
              >
                Ürünü keşfet
                <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
              </Link>
              <a
                href="https://help.hummytummy.com"
                className="inline-flex items-center gap-2 rounded-xl border border-[#e3d7c7] bg-white px-6 py-3.5 text-base font-semibold text-[#1c1917] transition hover:border-[#cdbfac]"
              >
                Yardım Merkezi
              </a>
            </div>
          </div>
          <MediaSlot
            img="mascot"
            kind="cutout"
            label="Ekip / marka görseli"
            priority
            sizes="(max-width:1024px) 70vw, 440px"
          />
        </div>
      </section>

      {/* Values */}
      <Section
        index="01"
        eyebrow="Değerlerimiz"
        title="Nasıl çalışıyoruz"
        subtitle="Üç ilke, ürünün her satırına işler."
      >
        <div className="mt-12 grid gap-x-10 gap-y-12 border-t border-[#e3d7c7] pt-10 sm:grid-cols-3">
          {VALUES.map((v, idx) => (
            <div key={v.title}>
              <div className="flex items-baseline gap-3">
                <span
                  className="text-5xl font-semibold leading-none text-[#f5c9a3]"
                  style={display}
                >
                  {String(idx + 1).padStart(2, "0")}
                </span>
                <v.icon className="h-5 w-5 translate-y-[-2px] text-[#f97316]" />
              </div>
              <h3 className="mt-4 text-xl font-semibold text-[#1c1917]">
                {v.title}
              </h3>
              <p className="mt-2 leading-relaxed text-[#57534e]">{v.desc}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* Group companies */}
      <Section
        index="02"
        eyebrow="Grup şirketlerimiz"
        title="HummyTummy yalnız değil"
        subtitle="Aynı çatı altında, farklı alanlarda üreten kardeş markalar."
      >
        <div className="mt-10 grid gap-6 md:grid-cols-2">
          {SISTER_COMPANIES.map((c) => (
            <div
              key={c.name}
              className="flex flex-col rounded-3xl border border-[#ece2d4] bg-white p-8"
            >
              <div className="flex items-center gap-4">
                {/* Logo slot — user-supplied logo replaces this */}
                <span
                  className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl border-2 border-dashed border-[#e3c9a8] bg-[#fff8f1] text-xl font-bold text-[#c9a06a]"
                  style={display}
                  aria-hidden
                >
                  {c.name[0]}
                </span>
                <div>
                  <h3
                    className="text-2xl font-semibold text-[#1c1917]"
                    style={display}
                  >
                    {c.name}
                  </h3>
                  <p className="text-sm font-medium text-[#b45309]">
                    {c.tagline}
                  </p>
                </div>
              </div>
              <p className="mt-5 flex-1 leading-relaxed text-[#57534e]">
                {c.desc}
              </p>
              <span className="mt-5 inline-flex w-fit items-center gap-1.5 rounded-full bg-[#fff3e8] px-3 py-1 text-xs font-semibold text-[#b45309]">
                <Building2 className="h-3.5 w-3.5" /> Tanıtım içeriği yakında
              </span>
            </div>
          ))}
        </div>
      </Section>

      {/* Social responsibility */}
      <Section
        index="03"
        eyebrow="Sosyal sorumluluk"
        title="İşin sofra tarafı kadar, toplum tarafı da var"
        subtitle="Yürüttüğümüz sosyal sorumluluk projelerini burada tek tek anlatacağız."
      >
        <div className="mt-10 grid items-center gap-8 lg:grid-cols-[1fr_0.9fr]">
          <MediaSlot kind="wide" label="Sosyal sorumluluk projesi görseli" />
          <div className="space-y-4">
            {[1, 2].map((i) => (
              <div
                key={i}
                className="rounded-2xl border-2 border-dashed border-[#e3c9a8] bg-[#fff8f1] p-6"
              >
                <h3
                  className="text-lg font-semibold text-[#b45309]"
                  style={display}
                >
                  Proje {i} — içerik yakında
                </h3>
                <p className="mt-1.5 text-sm leading-relaxed text-[#8a7250]">
                  Proje adı, hikayesi ve görselleri eklendiğinde bu kart gerçek
                  içerikle dolacak.
                </p>
              </div>
            ))}
          </div>
        </div>
      </Section>

      <CtaBand
        title="Bizimle çalışmak ister misiniz?"
        subtitle="İşletmeniz için HummyTummy’yi 7 gün ücretsiz deneyin; sorunuz olursa Türkçe destek ekibimiz yanınızda."
      />
    </MarketingLayout>
  );
}
