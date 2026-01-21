import React, { useState, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { ChefHat, X } from 'lucide-react';
import LanguageSwitcher from '../LanguageSwitcher';

// Mascot message keys for i18n
const mascotMessageKeys = [
  // Food jokes
  { type: 'joke', emoji: '😄', messageKey: 'mascot.messages.joke1' },
  { type: 'joke', emoji: '🤣', messageKey: 'mascot.messages.joke2' },
  { type: 'joke', emoji: '😂', messageKey: 'mascot.messages.joke3' },
  { type: 'joke', emoji: '🍕', messageKey: 'mascot.messages.joke4' },
  { type: 'joke', emoji: '🥖', messageKey: 'mascot.messages.joke5' },
  { type: 'joke', emoji: '🧀', messageKey: 'mascot.messages.joke6' },

  // Industry facts
  { type: 'fact', emoji: '📊', messageKey: 'mascot.messages.fact1' },
  { type: 'fact', emoji: '⏰', messageKey: 'mascot.messages.fact2' },
  { type: 'fact', emoji: '📱', messageKey: 'mascot.messages.fact3' },
  { type: 'fact', emoji: '🌍', messageKey: 'mascot.messages.fact4' },
  { type: 'fact', emoji: '👨‍🍳', messageKey: 'mascot.messages.fact5' },

  // Tips
  { type: 'tip', emoji: '💡', messageKey: 'mascot.messages.tip1' },
  { type: 'tip', emoji: '🎯', messageKey: 'mascot.messages.tip2' },
  { type: 'tip', emoji: '📈', messageKey: 'mascot.messages.tip3' },

  // Fun messages
  { type: 'fun', emoji: '🎉', messageKey: 'mascot.messages.fun1' },
  { type: 'fun', emoji: '🌟', messageKey: 'mascot.messages.fun2' },
];

type AuthVariant = 'login' | 'register' | 'forgot-password';

interface AuthLayoutProps {
  children: React.ReactNode;
  variant?: AuthVariant;
}

const baseUrl = import.meta.env.BASE_URL || '/';

const mascotConfig: Record<AuthVariant, { image: string; headlineKey: string; subtitleKey: string }> = {
  login: {
    image: `${baseUrl}voxel_chef_1_top_left.png`,
    headlineKey: 'auth:branding.mascotHeadlineLogin',
    subtitleKey: 'auth:branding.mascotSubtitleLogin',
  },
  register: {
    image: `${baseUrl}voxel_chef_3_bottom_left.png`,
    headlineKey: 'auth:branding.mascotHeadlineRegister',
    subtitleKey: 'auth:branding.mascotSubtitleRegister',
  },
  'forgot-password': {
    image: `${baseUrl}voxel_chef_2_top_right.png`,
    headlineKey: 'auth:branding.mascotHeadlineForgot',
    subtitleKey: 'auth:branding.mascotSubtitleForgot',
  },
};

const AuthLayout: React.FC<AuthLayoutProps> = ({ children, variant = 'login' }) => {
  const { t } = useTranslation(['auth']);
  const config = mascotConfig[variant];
  const [showMessage, setShowMessage] = useState(false);
  const [currentMessageIndex, setCurrentMessageIndex] = useState(0);

  const currentMessage = useMemo(() => mascotMessageKeys[currentMessageIndex], [currentMessageIndex]);

  const handleMascotClick = useCallback(() => {
    const randomIndex = Math.floor(Math.random() * mascotMessageKeys.length);
    setCurrentMessageIndex(randomIndex);
    setShowMessage(true);
  }, []);

  return (
    <div className="min-h-screen flex relative">
      {/* Mascot Container - wraps mascot and speech bubble for relative positioning */}
      <div className="hidden lg:block absolute bottom-0 left-[10%] lg:left-[15%] xl:left-[20%] z-30">
        {/* Speech Bubble - positioned relative to mascot */}
        <AnimatePresence>
          {showMessage && (
            <motion.div
              initial={{ opacity: 0, scale: 0.8, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.8, y: 10 }}
              transition={{ duration: 0.3, ease: 'easeOut' }}
              className="absolute -top-4 right-0 translate-x-[70%] lg:translate-x-[75%] xl:translate-x-[80%] z-40 max-w-[280px] lg:max-w-[320px]"
            >
              <div className="relative bg-white rounded-2xl shadow-2xl p-4 border border-orange-100">
                {/* Close button */}
                <button
                  onClick={() => setShowMessage(false)}
                  className="absolute -top-2 -right-2 w-6 h-6 bg-orange-500 hover:bg-orange-600 text-white rounded-full flex items-center justify-center text-sm font-bold transition-colors shadow-md"
                >
                  <X size={14} />
                </button>

                {/* Message content */}
                <div className="flex items-start gap-3">
                  <span className="text-2xl flex-shrink-0">{currentMessage.emoji}</span>
                  <div>
                    <span
                      className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium mb-1 ${
                        currentMessage.type === 'joke'
                          ? 'bg-yellow-100 text-yellow-700'
                          : currentMessage.type === 'fact'
                            ? 'bg-blue-100 text-blue-700'
                            : currentMessage.type === 'tip'
                              ? 'bg-green-100 text-green-700'
                              : 'bg-purple-100 text-purple-700'
                      }`}
                    >
                      {t(`auth:mascot.messageTypes.${currentMessage.type}`)}
                    </span>
                    <p className="text-sm text-gray-700 leading-relaxed">{t(`auth:${currentMessage.messageKey}`)}</p>
                  </div>
                </div>

                {/* Speech bubble tail - pointing down-left towards mascot */}
                <div className="absolute bottom-0 left-8 w-6 h-6 bg-white border-r border-b border-orange-100 transform rotate-45 translate-y-1/2" />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Mascot Image */}
        <motion.img
          src={config.image}
          alt="HummyTummy Chef Mascot"
          onClick={handleMascotClick}
          className="w-[400px] lg:w-[500px] xl:w-[600px] object-contain drop-shadow-2xl cursor-pointer hover:scale-105 transition-transform duration-300"
          initial={{ opacity: 0, x: '-100%' }}
          animate={{ opacity: 1, x: 0 }}
          transition={{
            opacity: { duration: 0.6, ease: 'easeOut' },
            x: { duration: 0.8, ease: [0.25, 0.46, 0.45, 0.94] }
          }}
        />
      </div>

      {/* Left Panel - Branding with Mascot (Desktop only) */}
      <div className="hidden lg:flex lg:w-[42%] xl:w-[40%] bg-gradient-to-br from-orange-400 via-primary-500 to-amber-600 relative overflow-hidden">
        {/* Top Section: Logo + Headline */}
        <div className="absolute top-0 left-0 right-0 z-20 p-8 xl:p-12">
          <Link to="/" className="flex items-center gap-3 text-white mb-6">
            <div className="p-2 bg-white/20 rounded-xl backdrop-blur-sm">
              <ChefHat className="w-8 h-8" />
            </div>
            <span className="text-2xl font-heading font-bold">HummyTummy</span>
          </Link>

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
          >
            <h2 className="text-3xl xl:text-4xl font-heading font-bold text-white leading-tight">
              {t(config.headlineKey, 'Welcome back, Chef!')}
            </h2>
            <p className="text-white/80 text-lg mt-2">
              {t(config.subtitleKey, 'Your kitchen is ready and waiting')}
            </p>
          </motion.div>
        </div>

        {/* Floating Decorative Elements - Left Side Grid */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden z-[5]">
          {/* Row 1 - Top */}
          <motion.div
            className="absolute top-[8%] left-[5%] text-2xl"
            initial={{ opacity: 0, scale: 0 }}
            animate={{ opacity: 0.7, scale: 1, y: [0, -6, 0] }}
            transition={{ opacity: { duration: 0.4, delay: 0.5 }, scale: { duration: 0.4, delay: 0.5 }, y: { duration: 3.4, repeat: Infinity, ease: 'easeInOut' } }}
          >🍬</motion.div>
          <motion.div
            className="absolute top-[15%] left-[20%] text-3xl"
            initial={{ opacity: 0, scale: 0 }}
            animate={{ opacity: 0.8, scale: 1, y: [0, -9, 0], rotate: [0, -5, 0] }}
            transition={{ opacity: { duration: 0.4, delay: 0.6 }, scale: { duration: 0.4, delay: 0.6 }, y: { duration: 2.8, repeat: Infinity, ease: 'easeInOut' }, rotate: { duration: 3.5, repeat: Infinity, ease: 'easeInOut' } }}
          >🍿</motion.div>
          <motion.div
            className="absolute top-[12%] left-[40%] text-3xl"
            initial={{ opacity: 0, scale: 0 }}
            animate={{ opacity: 0.85, scale: 1, y: [0, -8, 0] }}
            transition={{ opacity: { duration: 0.4, delay: 0.7 }, scale: { duration: 0.4, delay: 0.7 }, y: { duration: 3.2, repeat: Infinity, ease: 'easeInOut' } }}
          >🧁</motion.div>
          <motion.div
            className="absolute top-[18%] left-[58%] text-4xl"
            initial={{ opacity: 0, scale: 0 }}
            animate={{ opacity: 0.9, scale: 1, y: [0, -10, 0], rotate: [0, 8, 0] }}
            transition={{ opacity: { duration: 0.4, delay: 0.8 }, scale: { duration: 0.4, delay: 0.8 }, y: { duration: 3, repeat: Infinity, ease: 'easeInOut' }, rotate: { duration: 4, repeat: Infinity, ease: 'easeInOut' } }}
          >🍕</motion.div>

          {/* Row 2 - Upper Middle */}
          <motion.div
            className="absolute top-[22%] left-[2%] text-2xl"
            initial={{ opacity: 0, scale: 0 }}
            animate={{ opacity: 0.75, scale: 1, y: [0, -5, 0], rotate: [0, 10, 0] }}
            transition={{ opacity: { duration: 0.4, delay: 0.9 }, scale: { duration: 0.4, delay: 0.9 }, y: { duration: 2.6, repeat: Infinity, ease: 'easeInOut' }, rotate: { duration: 3, repeat: Infinity, ease: 'easeInOut' } }}
          >🍭</motion.div>
          <motion.div
            className="absolute top-[30%] left-[15%] text-3xl"
            initial={{ opacity: 0, scale: 0 }}
            animate={{ opacity: 0.85, scale: 1, y: [0, -8, 0] }}
            transition={{ opacity: { duration: 0.4, delay: 1.0 }, scale: { duration: 0.4, delay: 1.0 }, y: { duration: 3.3, repeat: Infinity, ease: 'easeInOut' } }}
          >🍣</motion.div>
          <motion.div
            className="absolute top-[25%] left-[35%] text-3xl"
            initial={{ opacity: 0, scale: 0 }}
            animate={{ opacity: 0.8, scale: 1, y: [0, -7, 0], x: [0, 3, 0] }}
            transition={{ opacity: { duration: 0.4, delay: 1.1 }, scale: { duration: 0.4, delay: 1.1 }, y: { duration: 3, repeat: Infinity, ease: 'easeInOut' }, x: { duration: 4, repeat: Infinity, ease: 'easeInOut' } }}
          >🌮</motion.div>
          <motion.div
            className="absolute top-[28%] left-[52%] text-4xl"
            initial={{ opacity: 0, scale: 0 }}
            animate={{ opacity: 0.85, scale: 1, y: [0, -10, 0], rotate: [0, -6, 0] }}
            transition={{ opacity: { duration: 0.4, delay: 1.2 }, scale: { duration: 0.4, delay: 1.2 }, y: { duration: 3.5, repeat: Infinity, ease: 'easeInOut' }, rotate: { duration: 4.2, repeat: Infinity, ease: 'easeInOut' } }}
          >🍔</motion.div>

          {/* Row 3 - Center */}
          <motion.div
            className="absolute top-[38%] left-[5%] text-2xl"
            initial={{ opacity: 0, scale: 0 }}
            animate={{ opacity: 0.75, scale: 1, y: [0, -6, 0], rotate: [0, 360] }}
            transition={{ opacity: { duration: 0.4, delay: 1.3 }, scale: { duration: 0.4, delay: 1.3 }, y: { duration: 2.5, repeat: Infinity, ease: 'easeInOut' }, rotate: { duration: 8, repeat: Infinity, ease: 'linear' } }}
          >🍪</motion.div>
          <motion.div
            className="absolute top-[40%] left-[22%] text-3xl"
            initial={{ opacity: 0, scale: 0 }}
            animate={{ opacity: 0.8, scale: 1, y: [0, -7, 0] }}
            transition={{ opacity: { duration: 0.4, delay: 1.4 }, scale: { duration: 0.4, delay: 1.4 }, y: { duration: 2.9, repeat: Infinity, ease: 'easeInOut' } }}
          >🌭</motion.div>
          <motion.div
            className="absolute top-[45%] left-[40%] text-4xl"
            initial={{ opacity: 0, scale: 0 }}
            animate={{ opacity: 0.85, scale: 1, y: [0, -10, 0], rotate: [0, 12, 0] }}
            transition={{ opacity: { duration: 0.4, delay: 1.5 }, scale: { duration: 0.4, delay: 1.5 }, y: { duration: 3.8, repeat: Infinity, ease: 'easeInOut' }, rotate: { duration: 5, repeat: Infinity, ease: 'easeInOut' } }}
          >🍩</motion.div>
          <motion.div
            className="absolute top-[42%] left-[58%] text-4xl"
            initial={{ opacity: 0, scale: 0 }}
            animate={{ opacity: 0.9, scale: 1, y: [0, -9, 0], rotate: [0, 5, 0] }}
            transition={{ opacity: { duration: 0.4, delay: 1.6 }, scale: { duration: 0.4, delay: 1.6 }, y: { duration: 3.2, repeat: Infinity, ease: 'easeInOut' }, rotate: { duration: 4.5, repeat: Infinity, ease: 'easeInOut' } }}
          >🍟</motion.div>

          {/* Row 4 - Lower Middle */}
          <motion.div
            className="absolute top-[52%] left-[3%] text-2xl"
            initial={{ opacity: 0, scale: 0 }}
            animate={{ opacity: 0.7, scale: 1, y: [0, -5, 0], rotate: [0, 15, 0] }}
            transition={{ opacity: { duration: 0.4, delay: 1.7 }, scale: { duration: 0.4, delay: 1.7 }, y: { duration: 2.7, repeat: Infinity, ease: 'easeInOut' }, rotate: { duration: 3.8, repeat: Infinity, ease: 'easeInOut' } }}
          >🍫</motion.div>
          <motion.div
            className="absolute top-[60%] left-[18%] text-3xl"
            initial={{ opacity: 0, scale: 0 }}
            animate={{ opacity: 0.85, scale: 1, y: [0, -7, 0] }}
            transition={{ opacity: { duration: 0.4, delay: 1.8 }, scale: { duration: 0.4, delay: 1.8 }, y: { duration: 3.4, repeat: Infinity, ease: 'easeInOut' } }}
          >🧇</motion.div>
          <motion.div
            className="absolute top-[55%] left-[38%] text-3xl"
            initial={{ opacity: 0, scale: 0 }}
            animate={{ opacity: 0.8, scale: 1, y: [0, -9, 0], x: [0, -4, 0] }}
            transition={{ opacity: { duration: 0.4, delay: 1.9 }, scale: { duration: 0.4, delay: 1.9 }, y: { duration: 3.1, repeat: Infinity, ease: 'easeInOut' }, x: { duration: 4.2, repeat: Infinity, ease: 'easeInOut' } }}
          >🥤</motion.div>
          <motion.div
            className="absolute top-[58%] left-[55%] text-4xl"
            initial={{ opacity: 0, scale: 0 }}
            animate={{ opacity: 0.85, scale: 1, y: [0, -8, 0], rotate: [0, -8, 0] }}
            transition={{ opacity: { duration: 0.4, delay: 2.0 }, scale: { duration: 0.4, delay: 2.0 }, y: { duration: 3.6, repeat: Infinity, ease: 'easeInOut' }, rotate: { duration: 4.8, repeat: Infinity, ease: 'easeInOut' } }}
          >🍦</motion.div>

          {/* Row 5 - Bottom */}
          <motion.div
            className="absolute top-[68%] left-[2%] text-2xl"
            initial={{ opacity: 0, scale: 0 }}
            animate={{ opacity: 0.75, scale: 1, y: [0, -6, 0] }}
            transition={{ opacity: { duration: 0.4, delay: 2.1 }, scale: { duration: 0.4, delay: 2.1 }, y: { duration: 3, repeat: Infinity, ease: 'easeInOut' } }}
          >🥠</motion.div>
          <motion.div
            className="absolute top-[70%] left-[15%] text-3xl"
            initial={{ opacity: 0, scale: 0 }}
            animate={{ opacity: 0.8, scale: 1, y: [0, -7, 0], rotate: [0, 10, 0] }}
            transition={{ opacity: { duration: 0.4, delay: 2.2 }, scale: { duration: 0.4, delay: 2.2 }, y: { duration: 3.5, repeat: Infinity, ease: 'easeInOut' }, rotate: { duration: 4, repeat: Infinity, ease: 'easeInOut' } }}
          >🍡</motion.div>
          <motion.div
            className="absolute top-[75%] left-[32%] text-3xl"
            initial={{ opacity: 0, scale: 0 }}
            animate={{ opacity: 0.85, scale: 1, y: [0, -8, 0] }}
            transition={{ opacity: { duration: 0.4, delay: 2.3 }, scale: { duration: 0.4, delay: 2.3 }, y: { duration: 2.8, repeat: Infinity, ease: 'easeInOut' } }}
          >🥨</motion.div>
          <motion.div
            className="absolute top-[72%] left-[50%] text-4xl"
            initial={{ opacity: 0, scale: 0 }}
            animate={{ opacity: 0.9, scale: 1, y: [0, -10, 0], rotate: [0, -5, 0] }}
            transition={{ opacity: { duration: 0.4, delay: 2.4 }, scale: { duration: 0.4, delay: 2.4 }, y: { duration: 3.3, repeat: Infinity, ease: 'easeInOut' }, rotate: { duration: 4.5, repeat: Infinity, ease: 'easeInOut' } }}
          >🍰</motion.div>

          {/* Row 6 - Very Bottom */}
          <motion.div
            className="absolute top-[82%] left-[10%] text-2xl"
            initial={{ opacity: 0, scale: 0 }}
            animate={{ opacity: 0.75, scale: 1, y: [0, -5, 0], rotate: [0, -8, 0] }}
            transition={{ opacity: { duration: 0.4, delay: 2.5 }, scale: { duration: 0.4, delay: 2.5 }, y: { duration: 3.1, repeat: Infinity, ease: 'easeInOut' }, rotate: { duration: 3.6, repeat: Infinity, ease: 'easeInOut' } }}
          >🍩</motion.div>
          <motion.div
            className="absolute top-[88%] left-[28%] text-3xl"
            initial={{ opacity: 0, scale: 0 }}
            animate={{ opacity: 0.8, scale: 1, y: [0, -7, 0] }}
            transition={{ opacity: { duration: 0.4, delay: 2.6 }, scale: { duration: 0.4, delay: 2.6 }, y: { duration: 2.9, repeat: Infinity, ease: 'easeInOut' } }}
          >🍮</motion.div>
          <motion.div
            className="absolute top-[85%] left-[45%] text-3xl"
            initial={{ opacity: 0, scale: 0 }}
            animate={{ opacity: 0.85, scale: 1, y: [0, -8, 0], rotate: [0, 6, 0] }}
            transition={{ opacity: { duration: 0.4, delay: 2.7 }, scale: { duration: 0.4, delay: 2.7 }, y: { duration: 3.2, repeat: Infinity, ease: 'easeInOut' }, rotate: { duration: 4.3, repeat: Infinity, ease: 'easeInOut' } }}
          >🥐</motion.div>
        </div>

        {/* Footer - Very Bottom */}
        <div className="absolute bottom-4 left-8 xl:left-12 text-white/60 text-sm z-20">
          &copy; {new Date().getFullYear()} HummyTummy
        </div>
      </div>

      {/* Right Panel - Form */}
      <div className="flex-1 flex flex-col bg-gradient-to-br from-slate-50 to-orange-50/30">
        {/* Mobile Header */}
        <div className="lg:hidden relative bg-gradient-to-br from-orange-400 via-primary-500 to-amber-600 z-50">
          <div className="relative flex items-center justify-between p-4">
            <Link to="/" className="flex items-center gap-2 text-white">
              <div className="p-1.5 bg-white/20 rounded-lg backdrop-blur-sm">
                <ChefHat className="w-5 h-5" />
              </div>
              <span className="text-lg font-heading font-bold">HummyTummy</span>
            </Link>
            <LanguageSwitcher />
          </div>
          {/* Mascot peek */}
          <div className="absolute bottom-0 right-4 rtl:right-auto rtl:left-4 pointer-events-none overflow-hidden">
            <img
              src={config.image}
              alt="Chef Mascot"
              className="w-20 h-20 object-contain translate-y-2"
            />
          </div>
          <div className="h-6" />
        </div>

        {/* Desktop Language Switcher */}
        <div className="hidden lg:flex justify-end p-4 relative z-40">
          <LanguageSwitcher />
        </div>

        {/* Form Content */}
        <div className="flex-1 flex items-center justify-center p-4 sm:p-6 lg:p-8">
          <div className="w-full max-w-md">
            {/* Form Card with warm shadow */}
            <div className="bg-white rounded-2xl shadow-xl shadow-orange-500/5 p-6 sm:p-8">
              {children}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AuthLayout;
