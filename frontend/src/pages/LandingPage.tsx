import { PublicNavbar } from '../components/landing/PublicNavbar';
import { Hero } from '../components/landing/Hero';
import { Features } from '../components/landing/Features';
import { Testimonials } from '../components/landing/Testimonials';
import { Pricing } from '../components/landing/Pricing';
import { ContactForm } from '../components/landing/ContactForm';
import { Footer } from '../components/landing/Footer';
import { Scene3D } from '../components/landing/Scene3D';

export const LandingPage = () => {
  return (
    <div className="min-h-screen bg-transparent relative">
      {/* Fixed 3D Background */}
      <div className="fixed inset-0 -z-10">
        <Scene3D />
      </div>

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
