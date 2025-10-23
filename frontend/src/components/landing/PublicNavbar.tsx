import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Button from '../ui/Button';
import LanguageSwitcher from '../LanguageSwitcher';

export const PublicNavbar = () => {
  const { t } = useTranslation('common');
  const scrollToSection = (id: string) => {
    const element = document.getElementById(id);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth' });
    }
  };

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-white/80 backdrop-blur-md border-b border-gray-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          {/* Logo */}
          <div className="flex items-center">
            <Link to="/" className="text-2xl font-bold text-primary-600">
              KDS
            </Link>
          </div>

          {/* Nav Links */}
          <div className="hidden md:flex items-center space-x-8">
            <button
              onClick={() => scrollToSection('features')}
              className="text-gray-700 hover:text-primary-600 transition-colors"
            >
              {t('landing.features')}
            </button>
            <button
              onClick={() => scrollToSection('pricing')}
              className="text-gray-700 hover:text-primary-600 transition-colors"
            >
              {t('landing.pricing')}
            </button>
            <button
              onClick={() => scrollToSection('contact')}
              className="text-gray-700 hover:text-primary-600 transition-colors"
            >
              {t('landing.contact')}
            </button>
          </div>

          {/* Auth Buttons & Language Switcher */}
          <div className="flex items-center space-x-4">
            <LanguageSwitcher />
            <Link to="/login">
              <Button variant="outline" size="sm">
                {t('app.login')}
              </Button>
            </Link>
            <Link to="/register">
              <Button variant="primary" size="sm">
                {t('landing.getStarted')}
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </nav>
  );
};
