import { PublicNavbar } from '../components/landing/PublicNavbar';
import { Hero } from '../components/landing/Hero';
import { Features } from '../components/landing/Features';
import { Testimonials } from '../components/landing/Testimonials';
import { Pricing } from '../components/landing/Pricing';
import { ContactForm } from '../components/landing/ContactForm';
import { Footer } from '../components/landing/Footer';
import { Scene3D } from '../components/landing/Scene3D';
import { SnowEffect } from '../components/landing/SnowEffect';
import { usePageTracking } from '../hooks/usePageTracking';

export const LandingPage = () => {
  // Track page views for analytics
  usePageTracking();

  return (
    <div className="min-h-screen bg-transparent relative">
      {/* Fixed 3D Background */}
      <div className="fixed inset-0 -z-10">
        <Scene3D />
      </div>

      {/* Snow Effect Overlay */}
      <SnowEffect />

      <div className="relative z-10">
        <PublicNavbar />
        <Hero />
        <Features />
        <Testimonials />
        <Pricing />
        <ContactForm />
        <Footer />
      </div>
    </div>
  );
};
