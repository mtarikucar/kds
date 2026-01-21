import React from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { ChefHat } from 'lucide-react';
import LanguageSwitcher from '../LanguageSwitcher';

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

  return (
    <div className="min-h-screen flex">
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

        {/* Mascot - Centered, large */}
        <div className="absolute inset-0 flex items-center justify-center pt-32">
          {/* Mascot */}
          <motion.img
            src={config.image}
            alt="HummyTummy Chef Mascot"
            className="w-[80%] max-w-[400px] object-contain drop-shadow-2xl"
            initial={{ opacity: 0, y: 20 }}
            animate={{
              opacity: 1,
              y: [0, -8, 0]
            }}
            transition={{
              opacity: { duration: 0.5 },
              y: { duration: 3, repeat: Infinity, ease: 'easeInOut' }
            }}
          />
        </div>

        {/* Footer - Very Bottom */}
        <div className="absolute bottom-4 left-8 xl:left-12 text-white/60 text-sm z-20">
          &copy; {new Date().getFullYear()} HummyTummy
        </div>
      </div>

      {/* Right Panel - Form */}
      <div className="flex-1 flex flex-col bg-gradient-to-br from-slate-50 to-orange-50/30">
        {/* Mobile Header */}
        <div className="lg:hidden relative bg-gradient-to-br from-orange-400 via-primary-500 to-amber-600 overflow-hidden">
          <div className="relative z-10 flex items-center justify-between p-4">
            <Link to="/" className="flex items-center gap-2 text-white">
              <div className="p-1.5 bg-white/20 rounded-lg backdrop-blur-sm">
                <ChefHat className="w-5 h-5" />
              </div>
              <span className="text-lg font-heading font-bold">HummyTummy</span>
            </Link>
            <LanguageSwitcher />
          </div>
          {/* Mascot peek */}
          <div className="absolute bottom-0 right-4 rtl:right-auto rtl:left-4 pointer-events-none">
            <img
              src={config.image}
              alt="Chef Mascot"
              className="w-20 h-20 object-contain translate-y-2"
            />
          </div>
          <div className="h-6" />
        </div>

        {/* Desktop Language Switcher */}
        <div className="hidden lg:flex justify-end p-4">
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
