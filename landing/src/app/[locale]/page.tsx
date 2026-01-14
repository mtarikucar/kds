import { setRequestLocale } from 'next-intl/server';
import Navbar from '@/components/layout/Navbar';
import Hero from '@/components/sections/Hero';
import ProductOverview from '@/components/sections/ProductOverview';
import FeatureScroller from '@/components/sections/FeatureScroller';
import BusinessValue from '@/components/sections/BusinessValue';
import TrustSecurity from '@/components/sections/TrustSecurity';
import Pricing from '@/components/sections/Pricing';
import FinalCTA from '@/components/sections/FinalCTA';
import Footer from '@/components/sections/Footer';

type Props = {
  params: Promise<{ locale: string }>;
};

export default async function HomePage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <>
      <Navbar />
      <main className="min-h-screen">
        <Hero />
        <ProductOverview />
        <FeatureScroller />
        <BusinessValue />
        <TrustSecurity />
        <Pricing />
        <FinalCTA />
      </main>
      <Footer />
    </>
  );
}
