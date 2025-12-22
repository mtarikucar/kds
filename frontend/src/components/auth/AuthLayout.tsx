import React from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { UtensilsCrossed, ChefHat, ClipboardList, BarChart3 } from 'lucide-react';
import LanguageSwitcher from '../LanguageSwitcher';

interface AuthLayoutProps {
  children: React.ReactNode;
  variant?: 'login' | 'register';
}

const AuthLayout: React.FC<AuthLayoutProps> = ({ children, variant = 'login' }) => {
  const { t } = useTranslation(['auth']);

  const features = [
    { icon: UtensilsCrossed, text: t('auth:branding.feature1', 'Easy table management') },
    { icon: ClipboardList, text: t('auth:branding.feature2', 'Real-time order tracking') },
    { icon: BarChart3, text: t('auth:branding.feature3', 'Powerful analytics') },
  ];

  return (
    <div className="min-h-screen flex">
      {/* Left Panel - Branding */}
      <div className="hidden lg:flex lg:w-[45%] xl:w-[40%] bg-gradient-to-br from-warm-orange via-primary-600 to-warm-brown relative overflow-hidden">
        {/* Background Pattern */}
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-20 left-10 w-32 h-32 border-2 border-white rounded-full" />
          <div className="absolute top-40 right-20 w-24 h-24 border-2 border-white rounded-full" />
          <div className="absolute bottom-32 left-20 w-40 h-40 border-2 border-white rounded-full" />
          <div className="absolute bottom-20 right-10 w-20 h-20 border-2 border-white rounded-full" />
        </div>

        {/* Content */}
        <div className="relative z-10 flex flex-col justify-between w-full p-8 xl:p-12">
          {/* Logo & Tagline */}
          <div>
            <Link to="/" className="flex items-center gap-3 text-white">
              <div className="p-2 bg-white/20 rounded-xl backdrop-blur-sm">
                <ChefHat className="w-8 h-8" />
              </div>
              <span className="text-2xl font-heading font-bold">RestaurantPOS</span>
            </Link>
          </div>

          {/* Main Content */}
          <div className="flex-1 flex flex-col justify-center">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
            >
              <h1 className="text-4xl xl:text-5xl font-heading font-bold text-white leading-tight mb-4">
                {variant === 'login'
                  ? t('auth:branding.tagline', 'Manage your restaurant smarter')
                  : t('auth:branding.registerTagline', 'Join thousands of restaurants')}
              </h1>
              <p className="text-white/80 text-lg mb-8">
                {variant === 'login'
                  ? t('auth:branding.loginSubtitle', 'Streamline operations, boost efficiency, delight customers.')
                  : t('auth:branding.registerSubtitle', 'Start your journey to smarter restaurant management today.')}
              </p>
            </motion.div>

            {/* Animated Illustration */}
            <motion.div
              className="relative h-48 xl:h-64 mb-8"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.6, delay: 0.2 }}
            >
              <motion.div
                className="absolute inset-0 flex items-center justify-center"
                animate={{ y: [0, -10, 0] }}
                transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
              >
                <div className="relative">
                  {/* Plate */}
                  <div className="w-40 h-40 xl:w-52 xl:h-52 bg-white/20 rounded-full backdrop-blur-sm flex items-center justify-center">
                    <div className="w-32 h-32 xl:w-44 xl:h-44 bg-white/30 rounded-full flex items-center justify-center">
                      <UtensilsCrossed className="w-16 h-16 xl:w-20 xl:h-20 text-white" />
                    </div>
                  </div>
                  {/* Floating elements */}
                  <motion.div
                    className="absolute -top-4 -right-4 p-3 bg-white/20 rounded-lg backdrop-blur-sm"
                    animate={{ y: [0, -5, 0], rotate: [0, 5, 0] }}
                    transition={{ duration: 2, repeat: Infinity, ease: "easeInOut", delay: 0.5 }}
                  >
                    <ClipboardList className="w-6 h-6 text-white" />
                  </motion.div>
                  <motion.div
                    className="absolute -bottom-2 -left-6 p-3 bg-white/20 rounded-lg backdrop-blur-sm"
                    animate={{ y: [0, 5, 0], rotate: [0, -5, 0] }}
                    transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut", delay: 0.3 }}
                  >
                    <BarChart3 className="w-6 h-6 text-white" />
                  </motion.div>
                </div>
              </motion.div>
            </motion.div>

            {/* Features List */}
            <motion.div
              className="space-y-3"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.6, delay: 0.4 }}
            >
              {features.map((feature, index) => (
                <motion.div
                  key={index}
                  className="flex items-center gap-3 text-white/90"
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.4, delay: 0.5 + index * 0.1 }}
                >
                  <div className="p-1.5 bg-white/20 rounded-lg">
                    <feature.icon className="w-4 h-4" />
                  </div>
                  <span className="text-sm font-medium">{feature.text}</span>
                </motion.div>
              ))}
            </motion.div>
          </div>

          {/* Footer */}
          <div className="text-white/60 text-sm">
            © {new Date().getFullYear()} RestaurantPOS. All rights reserved.
          </div>
        </div>
      </div>

      {/* Right Panel - Form */}
      <div className="flex-1 flex flex-col bg-gray-50">
        {/* Mobile Header */}
        <div className="lg:hidden flex items-center justify-between p-4 bg-gradient-to-r from-warm-orange to-warm-brown">
          <Link to="/" className="flex items-center gap-2 text-white">
            <ChefHat className="w-6 h-6" />
            <span className="text-lg font-heading font-bold">RestaurantPOS</span>
          </Link>
          <LanguageSwitcher />
        </div>

        {/* Desktop Language Switcher */}
        <div className="hidden lg:flex justify-end p-4">
          <LanguageSwitcher />
        </div>

        {/* Form Content */}
        <div className="flex-1 flex items-center justify-center p-4 sm:p-6 lg:p-8">
          <div className="w-full max-w-md">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AuthLayout;
