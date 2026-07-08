import { useEffect } from "react";
import { Link, Navigate } from "react-router-dom";
import {
  ArrowRight,
  LayoutGrid,
  Zap,
  Cloud,
  X,
  Check,
  ShieldCheck,
  Lock,
  Database,
  FileCheck,
} from "lucide-react";
import { useAuthStore } from "../store/authStore";
import { display } from "../marketing/theme";
import MarketingLayout from "../marketing/MarketingLayout";
import Section from "../marketing/components/Section";
import SplitFeature from "../marketing/components/SplitFeature";
import FramedShot from "../marketing/components/FramedShot";
import Picture from "../marketing/components/Picture";
import TrustStrip from "../marketing/components/TrustStrip";
import ModuleGrid from "../marketing/components/ModuleGrid";
import IntegrationChips from "../marketing/components/IntegrationChips";
import SectorGrid from "../marketing/components/SectorGrid";
import PlanTeaser from "../marketing/components/PlanTeaser";
import Faq from "../marketing/components/Faq";
import CtaBand from "../marketing/components/CtaBand";
import { FAQ } from "../marketing/data/faq";

/**
 * Public marketing homepage at `/`. Comprehensive, adisyo-style hub built from
 * the HummyTummy voxel brand imagery. Logged-in visitors are redirected to the
 * app, so existing users keep their app-first flow. All copy obeys the honesty
 * guardrails in docs/superpowers/specs/2026-07-07-hummytummy-landing-hub-design.md (§7).
 */

const BENEFITS = [
  {
    icon: LayoutGrid,
    title: "Tüm siparişler tek ekranda",
    desc: "Masa, paket ve online teslimat siparişleri tek panelde birleşir; hiçbir sipariş gözden kaçmaz.",
  },
  {
    icon: Zap,
    title: "Kesintisiz operasyon akışı",
    desc: "Sipariş POS’tan mutfak ekranına (KDS), oradan ödemeye tek hatta akar. Kağıt ve karışıklık yok.",
  },
  {
    icon: Cloud,
    title: "Her yerden erişim",
    desc: "Bulut tabanlı; tablet, telefon ve bilgisayardan çalışır. Kurulum yok, her yerden yönetin.",
  },
];

const SECURITY_POINTS = [
  {
    icon: Lock,
    t: "AES-256-GCM şifreleme",
    d: "Hassas veriler kiracı bazında türetilen anahtarlarla şifrelenir.",
  },
  {
    icon: ShieldCheck,
    t: "Güvenli oturum",
    d: "bcrypt parola, httpOnly çerez, Cloudflare arkasında TLS.",
  },
  {
    icon: FileCheck,
    t: "KVKK uyumu",
    d: "Gizlilik, mesafeli satış ve KVKK metinleri hazır; kayıt/ödemede onay.",
  },
  {
    icon: Database,
    t: "Güvenli yedekleme",
    d: "Her dağıtımdan önce bütünlüğü doğrulanmış otomatik yedek (14 gün).",
  },
];

const OBJECTIONS = [
  "Yüksek lisans + kurulum maliyeti",
  "Karmaşık, eğitim isteyen arayüz",
  "Tek cihaza / markaya kilitlenme",
  "Teslimat platformlarıyla kopuk entegrasyon",
];
const ANSWERS = [
  "7 gün ücretsiz, kredi kartı gerekmez",
  "Dakikalar içinde kurulum, sezgisel arayüz",
  "Her cihazın tarayıcısında, bulutta çalışır",
  "Yemeksepeti/Getir/Trendyol/Migros tek panelde",
];

export default function LandingPage() {
  const isAuthenticated = useAuthStore((s) => !!s.accessToken);

  useEffect(() => {
    document.title = "HummyTummy — Bulut Tabanlı Restoran Yönetim Sistemi";
  }, []);

  if (isAuthenticated) return <Navigate to="/dashboard" replace />;

  return (
    <MarketingLayout>
      {/* Hero */}
      <section className="ht-grain relative mx-auto max-w-6xl px-5 pb-6 pt-14 sm:pt-20">
        <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_.95fr]">
          <div>
            <span
              data-rise
              style={{ animationDelay: "40ms" }}
              className="inline-flex items-center gap-2 rounded-full border border-[#f5c9a3] bg-[#fff3e8] px-3 py-1 text-xs font-semibold text-[#b45309]"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-[#f97316]" />{" "}
              Restoran & cafeler için bulut yazılımı
            </span>
            <h1
              data-rise
              style={{ ...display, animationDelay: "120ms" }}
              className="mt-5 text-[2.6rem] font-semibold leading-[1.05] tracking-tight sm:text-6xl"
            >
              Restoranınızı{" "}
              <span className="relative whitespace-nowrap text-[#f97316]">
                tek panelden
                <svg
                  className="absolute -bottom-2 left-0 w-full"
                  height="10"
                  viewBox="0 0 200 10"
                  fill="none"
                  preserveAspectRatio="none"
                >
                  <path
                    d="M2 7c40-5 158-5 196 0"
                    stroke="#f97316"
                    strokeWidth="3"
                    strokeLinecap="round"
                    opacity=".5"
                  />
                </svg>
              </span>{" "}
              yönetin.
            </h1>
            <p
              data-rise
              style={{ animationDelay: "200ms" }}
              className="mt-6 max-w-xl text-lg leading-relaxed text-[#57534e]"
            >
              HummyTummy;{" "}
              <strong className="font-semibold text-[#1c1917]">
                QR menü, POS, mutfak ekranı (KDS), sipariş, masa ve stok
                yönetimini
              </strong>{" "}
              bulutta birleştiren restoran yönetim sistemidir. Kurulum yok, her
              cihazda çalışır, dakikalar içinde sipariş almaya başlarsınız.
            </p>
            <div
              data-rise
              style={{ animationDelay: "280ms" }}
              className="mt-8 flex flex-wrap items-center gap-3"
            >
              <Link
                to="/register"
                className="group inline-flex items-center gap-2 rounded-xl bg-[#f97316] px-6 py-3.5 text-base font-semibold text-white shadow-lg shadow-orange-500/20 transition hover:bg-[#ea580c]"
              >
                7 Gün Ücretsiz Başla
                <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
              </Link>
              <Link
                to="/fiyatlandirma"
                className="inline-flex items-center gap-2 rounded-xl border border-[#e3d7c7] bg-white px-6 py-3.5 text-base font-semibold text-[#1c1917] transition hover:border-[#cdbfac]"
              >
                Fiyatları Gör
              </Link>
            </div>
            <p
              data-rise
              style={{ animationDelay: "340ms" }}
              className="mt-4 text-sm text-[#78716c]"
            >
              7 gün ücretsiz · kredi kartı gerekmez · istediğin an iptal
            </p>
          </div>

          {/* Framed product shot + mascot cutout */}
          <div
            data-rise
            style={{ animationDelay: "260ms" }}
            className="relative"
          >
            <FramedShot
              img="heroTablet"
              tilt
              label="HummyTummy · Sipariş"
              priority
              sizes="(max-width: 1024px) 90vw, 520px"
            />
            <Picture
              img="mascot"
              priority
              sizes="180px"
              className="pointer-events-none absolute -bottom-6 -left-8 hidden w-36 drop-shadow-[0_20px_30px_rgba(28,25,23,0.22)] sm:block"
            />
          </div>
        </div>
      </section>

      <TrustStrip />

      {/* 3 core benefits */}
      <Section
        eyebrow="Neden HummyTummy?"
        title="Ön salondan mutfağa, tek sistem"
        subtitle="Restoranınızın her parçası aynı sistemde konuşur — dağınık uygulamalarla uğraşmazsınız."
      >
        <div className="mt-10 grid gap-5 sm:grid-cols-3">
          {BENEFITS.map((b) => (
            <div
              key={b.title}
              className="rounded-2xl border border-[#ece2d4] bg-white p-6"
            >
              <span className="grid h-11 w-11 place-items-center rounded-xl bg-[#fff3e8] text-[#f97316]">
                <b.icon className="h-5 w-5" />
              </span>
              <h3 className="mt-4 text-lg font-semibold text-[#1c1917]">
                {b.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-[#78716c]">
                {b.desc}
              </p>
            </div>
          ))}
        </div>
      </Section>

      {/* Module grid */}
      <Section
        id="moduller"
        eyebrow="Tüm özellikler tek platformda"
        title="Operasyonun tamamı, bir arada"
        subtitle="QR menüden çoklu şubeye kadar ihtiyacınız olan her modül tek hesapta."
      >
        <ModuleGrid />
      </Section>

      {/* Flagship spotlights */}
      <SplitFeature
        id="qr-menu"
        eyebrow="QR Menü"
        title="Kağıt menü masrafına elveda"
        desc="Müşteri masadaki QR kodu telefonuyla okutur, menüyü açar ve sipariş verir. Fiyat veya ürün değiştirdiğinizde anında yansır — yeniden baskı yok."
        bullets={[
          "Telefondan menü görüntüleme ve sipariş",
          "Anlık fiyat/ürün güncelleme",
          "5 dilli arayüz (menü içeriği girdiğiniz dilde görünür)",
          "Menüden garson ve hesap çağrısı",
        ]}
        image="qrStand"
      />

      <SplitFeature
        id="mutfak-ekrani-kds"
        eyebrow="Mutfak Ekranı (KDS)"
        title="Mutfakta sipariş kaosuna son"
        desc="Sipariş verildiği anda mutfak ekranına düşer. Personel neyin hazırlandığını, neyin hazır olduğunu tek bakışta görür."
        bullets={[
          "Siparişler mutfak ekranına anında (canlı) düşer",
          "Hazırlanıyor / Hazır durum takibi",
          "Sesli ve görsel uyarılar",
          "Eşleşen donanım ekranlarına yönlendirme",
        ]}
        image="kdsChef"
        reverse
      />

      <SplitFeature
        id="pos-odeme"
        eyebrow="POS & Ödeme"
        title="Saniyeler içinde satış ve ödeme"
        desc="Hızlı satış ekranıyla masayı saniyeler içinde açın, hesabı bölün, indirim uygulayın ve kapatın."
        bullets={[
          "Nakit ve kart ile ödeme",
          "Hesap böl (eşit / ürün bazlı / özel)",
          "KDV dahil satır bazlı vergi ve indirim",
          "PayTR ile müşteri kendi hesabını QR’dan öder",
        ]}
        image="posChef"
      />

      <SplitFeature
        id="masa-siparis"
        eyebrow="Masa & Sipariş"
        title="Kat planında canlı masa yönetimi"
        desc="Salonunuzu kat planı üzerinde görün; masaları birleştirin, bölün, rezervasyon alın ve durumları anlık izleyin."
        bullets={[
          "Canlı masa durumu (2B / 3B görünüm)",
          "Masa birleştirme ve bölme",
          "Rezervasyon yönetimi",
          "Garson çağrısı",
        ]}
        image="dioramaInterior"
        reverse
      />

      <SplitFeature
        id="stok-envanter"
        eyebrow="Stok & Envanter"
        title="Reçeteyle otomatik stok düşümü"
        desc="Satış oldukça reçetedeki malzemeler otomatik düşer. Maliyetinizi ve firenizi kontrol altında tutun."
        bullets={[
          "Reçete bazlı otomatik malzeme düşümü",
          "Tedarikçi, satınalma ve sayım",
          "Fire (zayi) takibi",
          "Kritik stok uyarıları",
        ]}
        image="chartIcon"
      />

      {/* Delivery integrations */}
      <Section
        id="entegrasyonlar"
        eyebrow="Entegrasyonlar"
        title="Tüm sipariş kanalları tek panelde"
        subtitle="Teslimat platformlarındaki siparişleriniz HummyTummy’de toplanır; ayrı ekranlarda takip etmezsiniz."
      >
        <div className="grid items-center gap-10 lg:grid-cols-2">
          <div>
            <IntegrationChips />
          </div>
          <div className="lg:order-first">
            <Picture
              img="deliveryScooter"
              className="mx-auto w-full max-w-md drop-shadow-[0_25px_35px_rgba(28,25,23,0.14)]"
              sizes="(max-width:1024px) 80vw, 460px"
            />
          </div>
        </div>
      </Section>

      <SplitFeature
        id="raporlar"
        eyebrow="Raporlar & Analiz"
        title="Rakamları gör, kararı hızlı ver"
        desc="Ciro, ürün, personel ve saat bazlı raporlar; gün sonu Z-raporu ve masa doluluk ısı haritası tek panelde."
        bullets={[
          "Ciro, ürün, personel ve saat raporları",
          "Z-raporu ve gün sonu özeti",
          "Masa doluluk ısı haritası",
          "Gerçek zamanlı panel ve dışa aktarım",
        ]}
        image="reportPhone"
        reverse
      />

      <SplitFeature
        id="coklu-sube"
        eyebrow="Çoklu Şube"
        title="Tüm şubeler, tek hesap"
        desc="Bütün şubelerinizi tek hesaptan yönetin; şube bazlı yetki, menü ve raporlama tanımlayın. Bulut altyapı her şubeyi birbirine bağlar."
        bullets={[
          "Tüm şubeler tek hesaptan",
          "Şube bazlı yetki, menü ve rapor",
          "ESC/POS fiş yazıcı ve yerel köprü",
          "Masaüstü kurulum uygulaması",
        ]}
        image="dioramaBuilding"
      />

      {/* Security & compliance */}
      <Section
        id="guvenlik"
        eyebrow="Güvenlik & Uyum"
        title="Verileriniz güvende"
        subtitle="Restoranınızın ve müşterilerinizin verisi ciddiye alınır — şifreleme, güvenli oturum ve düzenli yedekleme ile."
      >
        <div className="mt-10 grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
          <div className="order-last lg:order-first grid gap-4 sm:grid-cols-2">
            {SECURITY_POINTS.map((s) => (
              <div
                key={s.t}
                className="rounded-2xl border border-[#ece2d4] bg-white p-5"
              >
                <span className="grid h-10 w-10 place-items-center rounded-lg bg-[#fff3e8] text-[#f97316]">
                  <s.icon className="h-5 w-5" />
                </span>
                <h3 className="mt-3 text-base font-semibold text-[#1c1917]">
                  {s.t}
                </h3>
                <p className="mt-1.5 text-sm leading-relaxed text-[#78716c]">
                  {s.d}
                </p>
              </div>
            ))}
          </div>
          <Picture
            img="mascotShield"
            className="mx-auto w-full max-w-sm drop-shadow-[0_25px_35px_rgba(28,25,23,0.16)]"
            sizes="(max-width:1024px) 70vw, 420px"
          />
        </div>
      </Section>

      {/* Sector selector */}
      <Section
        eyebrow="Her işletmeye uygun"
        title="Sizin işinize göre"
        subtitle="Restoran, kafe, bar, pastane, fast food… HummyTummy operasyonunuza uyum sağlar."
      >
        <SectorGrid />
      </Section>

      {/* Objection / contrast */}
      <Section
        title="Geleneksel POS’u zorlaştıran ne?"
        subtitle="Eski sistemlerin bıraktığı sorunları HummyTummy en baştan çözer."
      >
        <div className="mt-10 grid gap-6 md:grid-cols-2">
          <div className="rounded-2xl border border-[#ece2d4] bg-white p-7">
            <h3 className="text-lg font-semibold text-[#78716c]">
              Eski yöntemler
            </h3>
            <ul className="mt-4 space-y-3">
              {OBJECTIONS.map((o) => (
                <li key={o} className="flex items-start gap-3 text-[#57534e]">
                  <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#fef2f2] text-[#ef4444]">
                    <X className="h-3.5 w-3.5" />
                  </span>
                  {o}
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-2xl border border-[#f5c9a3] bg-[#fff8f1] p-7">
            <h3 className="text-lg font-semibold text-[#b45309]">
              HummyTummy ile
            </h3>
            <ul className="mt-4 space-y-3">
              {ANSWERS.map((a) => (
                <li key={a} className="flex items-start gap-3 text-[#44403c]">
                  <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#fff3e8] text-[#f97316]">
                    <Check className="h-3.5 w-3.5" />
                  </span>
                  {a}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Section>

      {/* Pricing teaser */}
      <Section
        id="fiyatlar"
        eyebrow="Fiyatlandırma"
        title="Şeffaf ve esnek planlar"
        subtitle="7 gün ücretsiz deneyin; sonra işletmenize uygun planı seçin. Fiyatlar TRY ve KDV dahildir."
      >
        <PlanTeaser />
        <div className="mt-8 text-center">
          <Link
            to="/fiyatlandirma"
            className="inline-flex items-center gap-2 text-sm font-semibold text-[#f97316] hover:text-[#ea580c]"
          >
            Tüm plan karşılaştırmasını gör <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </Section>

      {/* Support */}
      <Section>
        <div className="grid items-center gap-10 rounded-3xl border border-[#ece2d4] bg-white p-8 sm:p-10 lg:grid-cols-[1fr_0.7fr]">
          <div>
            <span className="text-sm font-semibold uppercase tracking-wider text-[#f97316]">
              Destek
            </span>
            <h2
              className="mt-2 text-3xl font-semibold tracking-tight text-[#1c1917]"
              style={display}
            >
              Gerçek Türkçe destek
            </h2>
            <p className="mt-4 text-lg leading-relaxed text-[#57534e]">
              Türkçe arayüz, Türkçe rehberler ve Türkçe destek. Yardım
              merkezimizden adım adım kılavuzlara, geliştirici portalımızdan API
              dokümanlarına ulaşırsınız.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <a
                href="https://help.hummytummy.com"
                className="rounded-xl border border-[#e3d7c7] bg-white px-5 py-3 text-sm font-semibold text-[#1c1917] transition hover:border-[#f5c9a3]"
              >
                Yardım Merkezi
              </a>
              <a
                href="https://developer.hummytummy.com"
                className="rounded-xl border border-[#e3d7c7] bg-white px-5 py-3 text-sm font-semibold text-[#1c1917] transition hover:border-[#f5c9a3]"
              >
                Geliştirici Portalı
              </a>
            </div>
          </div>
          <Picture
            img="supportAgent"
            className="mx-auto w-full max-w-[280px] drop-shadow-[0_25px_35px_rgba(28,25,23,0.16)]"
            sizes="280px"
          />
        </div>
      </Section>

      {/* FAQ */}
      <Section eyebrow="SSS" title="Sıkça sorulan sorular">
        <Faq items={FAQ} />
      </Section>

      {/* Final CTA */}
      <CtaBand />
    </MarketingLayout>
  );
}
