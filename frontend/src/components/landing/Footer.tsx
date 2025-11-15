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
    <footer className="bg-gray-900 text-gray-300 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-8">
          {/* Company Info */}
          <div>
            <div className="text-2xl font-bold text-white mb-4">HummyTummy</div>
            <p className="text-sm text-gray-400 mb-4">
              {t('landing.footerDescription')}
            </p>
          </div>

          {/* Product */}
          <div>
            <h4 className="text-white font-semibold mb-4">{t('landing.product')}</h4>
            <ul className="space-y-2 text-sm">
              <li>
                <button onClick={() => scrollToSection('features')} className="hover:text-white transition-colors">
                  {t('landing.features')}
                </button>
              </li>
              <li>
                <button onClick={() => scrollToSection('pricing')} className="hover:text-white transition-colors">
                  {t('landing.pricing')}
                </button>
              </li>
              <li>
                <Link to="/register" className="hover:text-white transition-colors">
                  {t('landing.freeTrial')}
                </Link>
              </li>
            </ul>
          </div>

          {/* Company */}
          <div>
            <h4 className="text-white font-semibold mb-4">{t('landing.company')}</h4>
            <ul className="space-y-2 text-sm">
              <li>
                <button onClick={() => scrollToSection('contact')} className="hover:text-white transition-colors">
                  {t('landing.contactUs')}
                </button>
              </li>
              <li>
                <button onClick={() => scrollToSection('features')} className="hover:text-white transition-colors text-left">
                  {t('landing.features')}
                </button>
              </li>
              <li>
                <button onClick={() => scrollToSection('pricing')} className="hover:text-white transition-colors text-left">
                  {t('landing.pricing')}
                </button>
              </li>
            </ul>
          </div>

          {/* Legal */}
          <div>
            <h4 className="text-white font-semibold mb-4">{t('landing.legal')}</h4>
            <ul className="space-y-2 text-sm">
              <li>
                <a href="mailto:support@hummytummy.com" className="hover:text-white transition-colors">
                  {t('landing.support')}
                </a>
              </li>
              <li>
                <a href="https://hummytummy.com" className="hover:text-white transition-colors" target="_blank" rel="noopener noreferrer">
                  {t('landing.documentation')}
                </a>
              </li>
              <li>
                <button onClick={() => scrollToSection('testimonials')} className="hover:text-white transition-colors text-left">
                  {t('landing.testimonials')}
                </button>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom Bar */}
        <div className="border-t border-gray-800 pt-8 flex flex-col md:flex-row justify-between items-center">
          <div className="flex flex-col md:flex-row items-center gap-3 mb-4 md:mb-0">
            <p className="text-sm text-gray-400">
              © {new Date().getFullYear()} HummyTummy. {t('landing.allRightsReserved')}
            </p>
            {import.meta.env.VITE_APP_VERSION && (
              <span className="text-xs text-gray-500 px-2 py-1 bg-gray-800 rounded border border-gray-700">
                v{import.meta.env.VITE_APP_VERSION.replace('v', '')}
              </span>
            )}
          </div>

          {/* Contact Email */}
          <div className="flex items-center gap-2 text-sm text-gray-400">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            <a href="mailto:support@hummytummy.com" className="hover:text-white transition-colors">
              support@hummytummy.com
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
};
