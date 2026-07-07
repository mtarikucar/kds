import { useEffect } from "react";
import { display } from "../../marketing/theme";
import MarketingLayout from "../../marketing/MarketingLayout";
import Section from "../../marketing/components/Section";
import PlanTable from "../../marketing/components/PlanTable";
import Faq from "../../marketing/components/Faq";
import CtaBand from "../../marketing/components/CtaBand";
import type { QA } from "../../marketing/data/faq";

/**
 * /fiyatlandirma — full plan comparison with real, code-verified TRY prices +
 * the trial/grace mechanics. Pricing-specific FAQ. Copy obeys spec §7.
 */

const PRICING_FAQ: QA[] = [
  {
    q: "Ücretsiz deneme sonrası ne oluyor?",
    a: "Kayıt olduğunuzda 7 gün boyunca tüm özellikler açık, ücretsiz kullanırsınız. Deneme bitince hesabınız ücretli bir plan seçilene kadar duraklatılır; verileriniz kaybolmaz.",
  },
  {
    q: "Yıllık ödemede indirim var mı?",
    a: "Evet. Yıllık planlar, aylık ödemeye göre indirimlidir. Tabloda “Yıllık (indirimli)” seçeneğine geçerek yıllık tutarları görebilirsiniz.",
  },
  {
    q: "Ödeme nasıl yapılıyor?",
    a: "Türkiye’deki işletmeler PayTR ile kart üzerinden güvenle öder. Kurumsal ihtiyaçlar ve banka havalesi için bizimle iletişime geçebilirsiniz.",
  },
  {
    q: "Plan yükseltip düşürebilir miyim?",
    a: "Evet. İşletmeniz büyüdükçe üst plana geçebilir, ihtiyacınız değişirse planınızı değiştirebilirsiniz.",
  },
  {
    q: "Ödemem gecikirse ne olur?",
    a: "Bir ödeme başarısız olursa hesabınız kapatılmadan önce 7 günlük bir ödemesiz kullanım (grace) süresi tanınır; bu sürede ödemeyi tamamlayarak kesintisiz devam edersiniz.",
  },
];

export default function PricingPage() {
  useEffect(() => {
    document.title = "Fiyatlandırma — HummyTummy";
  }, []);

  return (
    <MarketingLayout>
      <section className="ht-grain relative mx-auto max-w-6xl px-5 pb-4 pt-16 text-center sm:pt-20">
        <span className="inline-flex items-center gap-2 rounded-full border border-[#f5c9a3] bg-[#fff3e8] px-3 py-1 text-xs font-semibold text-[#b45309]">
          Fiyatlandırma
        </span>
        <h1
          className="mx-auto mt-5 max-w-3xl text-4xl font-semibold leading-tight tracking-tight sm:text-5xl"
          style={display}
        >
          İşletmenize uygun planı seçin
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-lg leading-relaxed text-[#57534e]">
          7 gün ücretsiz deneyin — kredi kartı gerekmez. Sonra ihtiyacınıza göre
          büyüyün. Tüm fiyatlar TRY ve KDV dahildir.
        </p>
      </section>

      <div className="mx-auto max-w-6xl px-5 py-10">
        <PlanTable />
      </div>

      <Section eyebrow="SSS" title="Fiyatlandırma hakkında sorular">
        <Faq items={PRICING_FAQ} />
      </Section>

      <CtaBand
        title="Önce deneyin, sonra karar verin"
        subtitle="7 gün boyunca tüm özellikler açık. Beğenmezseniz hiçbir ücret ödemezsiniz."
      />
    </MarketingLayout>
  );
}
