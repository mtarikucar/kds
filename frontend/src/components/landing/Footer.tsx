import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

export const Footer = () => {
  const { t } = useTranslation('common');
  const scrollToSection = (id: string) => {
    const element = document.getElementById(id);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth' });
    }
  };

  return (
    <footer className="bg-gradient-to-br from-warm-tan via-warm-beige to-warm-cream pt-20 pb-12 px-4 sm:px-6 lg:px-8 border-t-2 border-warm-orange/30">
      <div className="max-w-7xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-12 mb-16">
          {/* Company Info */}
          <div className="col-span-1 md:col-span-1">
            <Link to="/" className="flex items-center space-x-2 mb-6 group">
              <div className="relative w-10 h-10 overflow-hidden rounded-xl transition-transform duration-300 group-hover:scale-105 shadow-md">
                <img
                  src="/logo.png"
                  alt="HummyTummy Logo"
                  className="w-full h-full object-cover"
                />
              </div>
              <span className="text-xl font-heading font-bold text-warm-dark">
                HummyTummy
              </span>
            </Link>
            <p className="text-sm text-warm-brown/70 leading-relaxed mb-6">
              {t('landing.footerDescription')}
            </p>
            <div className="flex space-x-4">
              {/* Social Media Icons could go here */}
            </div>
          </div>

          {/* Product */}
          <div>
            <h4 className="text-warm-dark font-bold mb-6">{t('landing.product')}</h4>
            <ul className="space-y-4 text-sm">
              <li>
                <button onClick={() => scrollToSection('features')} className="text-warm-brown/70 hover:text-warm-orange font-medium transition-colors">
                  {t('landing.features')}
                </button>
              </li>
              <li>
                <button onClick={() => scrollToSection('pricing')} className="text-warm-brown/70 hover:text-warm-orange font-medium transition-colors">
                  {t('landing.pricing')}
                </button>
              </li>
              <li>
                <Link to="/register" className="text-warm-brown/70 hover:text-warm-orange font-medium transition-colors">
                  {t('landing.freeTrial')}
                </Link>
              </li>
            </ul>
          </div>

          {/* Company */}
          <div>
            <h4 className="text-warm-dark font-bold mb-6">{t('landing.company')}</h4>
            <ul className="space-y-4 text-sm">
              <li>
                <button onClick={() => scrollToSection('contact')} className="text-warm-brown/70 hover:text-warm-orange font-medium transition-colors">
                  {t('landing.contactUs')}
                </button>
              </li>
              <li>
                <button onClick={() => scrollToSection('features')} className="text-warm-brown/70 hover:text-warm-orange font-medium transition-colors text-left">
                  {t('landing.features')}
                </button>
              </li>
              <li>
                <button onClick={() => scrollToSection('pricing')} className="text-warm-brown/70 hover:text-warm-orange font-medium transition-colors text-left">
                  {t('landing.pricing')}
                </button>
              </li>
            </ul>
          </div>

          {/* Legal */}
          <div>
            <h4 className="text-warm-dark font-bold mb-6">{t('landing.legal')}</h4>
            <ul className="space-y-4 text-sm">
              <li>
                <a href="mailto:contact@hummytummy.com" className="text-warm-brown/70 hover:text-warm-orange font-medium transition-colors">
                  {t('landing.support')}
                </a>
              </li>
              <li>
                <a href="https://hummytummy.com" className="text-warm-brown/70 hover:text-warm-orange font-medium transition-colors" target="_blank" rel="noopener noreferrer">
                  {t('landing.documentation')}
                </a>
              </li>
              <li>
                <button onClick={() => scrollToSection('testimonials')} className="text-warm-brown/70 hover:text-warm-orange font-medium transition-colors text-left">
                  {t('landing.testimonials')}
                </button>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom Bar */}
        <div className="border-t-2 border-warm-orange/20 pt-8 flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="flex flex-col md:flex-row items-center gap-4">
            <p className="text-sm text-warm-brown/70 font-medium">
              © {new Date().getFullYear()} HummyTummy. {t('landing.allRightsReserved')}
            </p>
            {import.meta.env.VITE_APP_VERSION && (
              <span className="text-xs text-warm-dark px-3 py-1 bg-white/60 rounded-full border-2 border-warm-orange/20 font-semibold shadow-sm">
                v{import.meta.env.VITE_APP_VERSION.replace('v', '')}
              </span>
            )}
          </div>

          {/* Contact Email */}
          <div className="flex items-center gap-2 text-sm text-warm-brown/70 hover:text-warm-orange transition-colors font-medium">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            <a href="mailto:contact@hummytummy.com">
              contact@hummytummy.com
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
};
