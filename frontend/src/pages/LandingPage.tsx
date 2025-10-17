import { PublicNavbar } from '../components/landing/PublicNavbar';
import { Hero } from '../components/landing/Hero';
import { Features } from '../components/landing/Features';
import { Pricing } from '../components/landing/Pricing';
import { ContactForm } from '../components/landing/ContactForm';
import { Footer } from '../components/landing/Footer';

export const LandingPage = () => {
  return (
    <div className="min-h-screen bg-white">
      <PublicNavbar />
      <Hero />
      <Features />
      <Pricing />
      <ContactForm />
      <Footer />
    </div>
  );
};
