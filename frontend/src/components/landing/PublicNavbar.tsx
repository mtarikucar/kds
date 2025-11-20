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
    <nav className="fixed top-0 left-0 right-0 z-50 bg-white/90 backdrop-blur-md border-b-2 border-warm-orange/20 shadow-sm transition-all duration-300">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-20">
          {/* Logo */}
          <div className="flex items-center">
            <Link to="/" className="flex items-center space-x-2 group">
              <div className="relative w-12 h-12 overflow-hidden rounded-xl transition-transform duration-300 group-hover:scale-105 shadow-md">
                <img
                  src="/logo.png"
                  alt="HummyTummy Logo"
                  className="w-full h-full object-cover"
                />
              </div>
              <span className="text-2xl font-heading font-bold text-warm-dark">
                HummyTummy
              </span>
            </Link>
          </div>

          {/* Nav Links */}
          <div className="hidden md:flex items-center space-x-8">
            {['features', 'pricing', 'contact'].map((item) => (
              <button
                key={item}
                onClick={() => scrollToSection(item)}
                className="text-warm-brown/70 hover:text-warm-orange font-semibold transition-colors relative group"
              >
                {t(`landing.${item}`)}
                <span className="absolute -bottom-1 left-0 w-0 h-0.5 bg-warm-orange transition-all duration-300 group-hover:w-full rounded-full" />
              </button>
            ))}
          </div>

          {/* Auth Buttons & Language Switcher */}
          <div className="flex items-center space-x-4">
            <LanguageSwitcher />
            <Link to="/login">
              <Button variant="ghost" size="sm" className="font-semibold hover:bg-warm-orange/10 hover:text-warm-orange text-warm-brown">
                {t('app.login')}
              </Button>
            </Link>
            <Link to="/register">
              <Button className="bg-warm-orange hover:bg-warm-orange/90 text-white shadow-lg shadow-warm-orange/30 transition-all duration-300 hover:scale-105 active:scale-95 font-bold rounded-xl" size="sm">
                {t('landing.getStarted')}
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </nav>
  );
};
