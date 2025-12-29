import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { Sparkles, Gift, PartyPopper } from 'lucide-react';
import Button from '../ui/Button';

export const Hero = () => {
  const { t } = useTranslation('common');
  const scrollToSection = (id: string) => {
    const element = document.getElementById(id);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth' });
    }
  };

  return (
    <section className="relative pt-32 pb-24 px-4 sm:px-6 lg:px-8 overflow-hidden min-h-[90vh] flex items-center">
      {/* Warm winter glow effects */}
      <div className="absolute top-20 right-10 w-96 h-96 bg-amber-200/30 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-20 left-10 w-80 h-80 bg-orange-300/25 rounded-full blur-[100px] pointer-events-none" />
      <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-yellow-100/20 rounded-full blur-[150px] pointer-events-none" />

      <div className="relative max-w-7xl mx-auto w-full">
        <div className="text-center max-w-4xl mx-auto">
          {/* New Year Promotional Banner */}
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.6, type: 'spring' }}
            className="mb-6"
          >
            <div className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-red-500 via-orange-500 to-amber-500 text-white rounded-full text-sm font-bold shadow-xl shadow-orange-500/30 hover:shadow-2xl hover:shadow-orange-500/40 transition-all cursor-pointer"
                 onClick={() => scrollToSection('pricing')}>
              <PartyPopper className="w-5 h-5 animate-bounce" />
              <span>{t('landing.newYearOffer')}</span>
              <span className="px-2 py-0.5 bg-white/20 rounded-full text-xs">
                {t('landing.upTo30Off')}
              </span>
              <Gift className="w-5 h-5" />
            </div>
          </motion.div>

          {/* Badge */}
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="inline-block mb-8"
          >
            <div className="inline-flex items-center px-5 py-2.5 bg-white/80 border-2 border-warm-orange/30 text-warm-dark rounded-full text-sm font-semibold shadow-lg hover:shadow-xl hover:border-warm-orange/50 transition-all cursor-default">
              <span className="relative flex h-2.5 w-2.5 mr-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-warm-orange opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-warm-orange"></span>
              </span>
              {t('landing.badge')}
            </div>
          </motion.div>

          {/* Headline */}
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="text-5xl md:text-7xl font-heading font-bold text-warm-dark mb-8 leading-tight tracking-tight"
          >
            {t('landing.headline')}
            <br />
            <span className="bg-gradient-to-r from-warm-orange via-amber-500 to-orange-500 bg-clip-text text-transparent bg-[length:200%_auto] animate-gradient">
              {t('landing.headlineHighlight')}
            </span>
          </motion.h1>

          {/* Subtitle */}
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.3 }}
            className="text-xl md:text-2xl text-warm-brown/80 mb-12 max-w-2xl mx-auto leading-relaxed"
          >
            {t('landing.subtitle')}
          </motion.p>

          {/* CTA Buttons */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.4 }}
            className="flex flex-col sm:flex-row gap-4 justify-center items-center mb-16"
          >
            <Link to="/register">
              <motion.div
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
                <Button
                  variant="primary"
                  size="lg"
                  className="text-lg px-10 py-6 shadow-xl shadow-warm-orange/30 hover:shadow-2xl hover:shadow-warm-orange/40 transition-all duration-300 bg-gradient-to-r from-warm-orange to-orange-500 hover:from-orange-500 hover:to-warm-orange text-white font-bold rounded-2xl border-2 border-white/20"
                >
                  <Sparkles className="w-5 h-5 mr-2 inline" />
                  {t('landing.startFreeTrial')}
                  <svg className="w-5 h-5 ml-2 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                </Button>
              </motion.div>
            </Link>
            <motion.div
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              <Button
                variant="outline"
                size="lg"
                className="text-lg px-10 py-6 border-2 border-warm-brown/40 hover:border-warm-brown hover:bg-white/60 text-warm-dark font-semibold transition-all duration-300 rounded-2xl bg-white/40 backdrop-blur-sm"
                onClick={() => scrollToSection('features')}
              >
                {t('landing.learnMore')}
              </Button>
            </motion.div>
          </motion.div>

          {/* Trust Indicators */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.6 }}
            className="flex flex-wrap justify-center items-center gap-6 text-sm"
          >
            {[
              { text: 'landing.freeTrialNoCreditCard', icon: 'M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z' },
              { text: 'landing.setupIn5Minutes', icon: 'M13 10V3L4 14h7v7l9-11h-7z' },
              { text: 'landing.cancelAnytime', icon: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z' }
            ].map((item, index) => (
              <div key={index} className="flex items-center gap-2 px-5 py-3 bg-white/70 rounded-full backdrop-blur-sm border-2 border-amber-200/50 shadow-md hover:shadow-lg hover:border-amber-300 transition-all">
                <svg className="w-5 h-5 text-amber-600" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d={item.icon} clipRule="evenodd" />
                </svg>
                <span className="font-semibold text-warm-dark">{t(item.text)}</span>
              </div>
            ))}
          </motion.div>
        </div>
      </div>
    </section>
  );
};
