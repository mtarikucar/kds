import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  MapPin,
  Wifi,
  Copy,
  Check,
  Trophy,
  ChevronRight,
  Globe,
  ClipboardList,
  UtensilsCrossed,
  ShoppingCart,
} from 'lucide-react';
import { toast } from 'sonner';
import { WifiInfo, SocialMedia } from '../../pages/qr-menu/QRMenuLayout';
import { buildQRMenuUrl } from '../../utils/subdomain';
import { localeMap } from '../../i18n/localeMap';

// Social media icons type
interface IconProps {
  className?: string;
  style?: React.CSSProperties;
}

const InstagramIcon: React.FC<IconProps> = ({ className, style }) => (
  <svg className={className} style={style} viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
  </svg>
);

const FacebookIcon: React.FC<IconProps> = ({ className, style }) => (
  <svg className={className} style={style} viewBox="0 0 24 24" fill="currentColor">
    <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
  </svg>
);

const TwitterIcon: React.FC<IconProps> = ({ className, style }) => (
  <svg className={className} style={style} viewBox="0 0 24 24" fill="currentColor">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
  </svg>
);

const TikTokIcon: React.FC<IconProps> = ({ className, style }) => (
  <svg className={className} style={style} viewBox="0 0 24 24" fill="currentColor">
    <path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z"/>
  </svg>
);

// Helper to normalize image URLs
const normalizeImageUrl = (url: string | null | undefined): string | null => {
  if (!url) return null;
  const normalizedPath = url.replace(/\\/g, '/');
  if (normalizedPath.startsWith('http://') || normalizedPath.startsWith('https://')) {
    return normalizedPath;
  }
  const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';
  const BASE_URL = API_URL.replace(/\/api$/, '');
  const path = normalizedPath.startsWith('/') ? normalizedPath.substring(1) : normalizedPath;
  return `${BASE_URL}/${path}`;
};

// Helper to build social media URL
const buildSocialUrl = (platform: string, value: string): string => {
  if (value.startsWith('http://') || value.startsWith('https://')) {
    return value;
  }
  const username = value.startsWith('@') ? value.slice(1) : value;

  switch (platform) {
    case 'instagram':
      return `https://instagram.com/${username}`;
    case 'facebook':
      return `https://facebook.com/${username}`;
    case 'twitter':
      return `https://x.com/${username}`;
    case 'tiktok':
      return `https://tiktok.com/@${username}`;
    default:
      return value;
  }
};

interface MenuDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  tenant: {
    id: string;
    name: string;
    wifi?: WifiInfo | null;
    socialMedia?: SocialMedia;
  };
  table?: {
    id: string;
    number: string;
  };
  settings: {
    primaryColor: string;
    secondaryColor: string;
    logoUrl?: string;
  };
  sessionId: string | null;
  subdomain?: string;
}

const MenuDrawer: React.FC<MenuDrawerProps> = ({
  isOpen,
  onClose,
  tenant,
  table,
  settings,
  sessionId,
  subdomain,
}) => {
  const { t, i18n } = useTranslation('common');
  const navigate = useNavigate();
  const [passwordCopied, setPasswordCopied] = useState(false);

  // Available languages with flags
  const languages = [
    { code: 'en', name: 'English', nativeName: 'English', flag: '🇺🇸' },
    { code: 'tr', name: 'Turkish', nativeName: 'Türkçe', flag: '🇹🇷' },
    { code: 'ru', name: 'Russian', nativeName: 'Русский', flag: '🇷🇺' },
    { code: 'uz', name: 'Uzbek', nativeName: "O'zbek", flag: '🇺🇿' },
    { code: 'ar', name: 'Arabic', nativeName: 'العربية', flag: '🇸🇦' },
  ];

  const handleCopyPassword = async () => {
    if (tenant.wifi?.password) {
      try {
        await navigator.clipboard.writeText(tenant.wifi.password);
        setPasswordCopied(true);
        toast.success(t('qrMenu.passwordCopied', 'Password copied!'));
        setTimeout(() => setPasswordCopied(false), 2000);
      } catch {
        toast.error(t('common.copyFailed', 'Failed to copy'));
      }
    }
  };

  const handleLanguageChange = (langCode: string) => {
    i18n.changeLanguage(langCode);
  };

  const handleNavigateToCart = () => {
    const url = buildQRMenuUrl('cart', {
      subdomain,
      tenantId: tenant.id,
      tableId: table?.id || null,
      sessionId,
    });
    navigate(url);
    onClose();
  };

  const handleNavigateToOrders = () => {
    if (sessionId) {
      const url = buildQRMenuUrl('orders', {
        subdomain,
        tenantId: tenant.id,
        tableId: table?.id || null,
        sessionId,
      });
      navigate(url);
      onClose();
    }
  };

  const handleNavigateToLoyalty = () => {
    if (sessionId) {
      const url = buildQRMenuUrl('loyalty', {
        subdomain,
        tenantId: tenant.id,
        tableId: table?.id || null,
        sessionId,
      });
      navigate(url);
      onClose();
    }
  };

  const socialLinks = [
    { key: 'instagram', value: tenant.socialMedia?.instagram, Icon: InstagramIcon, color: '#E4405F' },
    { key: 'facebook', value: tenant.socialMedia?.facebook, Icon: FacebookIcon, color: '#1877F2' },
    { key: 'twitter', value: tenant.socialMedia?.twitter, Icon: TwitterIcon, color: '#000000' },
    { key: 'tiktok', value: tenant.socialMedia?.tiktok, Icon: TikTokIcon, color: '#000000' },
  ].filter(link => link.value);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 bg-black/50 z-40"
            onClick={onClose}
          />

          {/* Drawer */}
          <motion.div
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 400 }}
            className="fixed left-0 top-0 bottom-0 w-[85%] max-w-sm bg-white z-50 shadow-2xl overflow-y-auto"
          >
            {/* Header */}
            <div
              className="sticky top-0 z-10 px-5 py-4 flex items-center gap-3"
              style={{
                background: `linear-gradient(135deg, ${settings.primaryColor} 0%, ${settings.secondaryColor} 100%)`,
              }}
            >
              <motion.button
                onClick={onClose}
                className="p-2 rounded-full bg-white/20 hover:bg-white/30 transition-colors"
                whileTap={{ scale: 0.9 }}
              >
                <X className="h-5 w-5 text-white" />
              </motion.button>

              {normalizeImageUrl(settings.logoUrl) ? (
                <img
                  src={normalizeImageUrl(settings.logoUrl)!}
                  alt={tenant.name}
                  className="w-10 h-10 rounded-xl object-cover ring-2 ring-white/30"
                />
              ) : (
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center ring-2 ring-white/30"
                  style={{ backgroundColor: settings.secondaryColor }}
                >
                  <UtensilsCrossed className="h-5 w-5 text-white" />
                </div>
              )}

              <h1 className="text-white font-bold text-lg truncate flex-1">{tenant.name}</h1>
            </div>

            {/* Content */}
            <div className="p-5 space-y-4">
              {/* Table Info */}
              {table && (
                <div className="flex items-center gap-3 p-4 bg-slate-50 rounded-2xl">
                  <div
                    className="p-2 rounded-xl"
                    style={{ backgroundColor: `${settings.primaryColor}15` }}
                  >
                    <MapPin className="h-5 w-5" style={{ color: settings.primaryColor }} />
                  </div>
                  <div>
                    <p className="text-sm text-slate-500">{t('qrMenu.tableLabel', 'Table')}</p>
                    <p className="font-bold text-slate-900">#{table.number}</p>
                  </div>
                </div>
              )}

              {/* WiFi */}
              {tenant.wifi?.ssid && (
                <div className="p-4 bg-slate-50 rounded-2xl">
                  <div className="flex items-center gap-3 mb-3">
                    <div
                      className="p-2 rounded-xl"
                      style={{ backgroundColor: `${settings.primaryColor}15` }}
                    >
                      <Wifi className="h-5 w-5" style={{ color: settings.primaryColor }} />
                    </div>
                    <h3 className="font-semibold text-slate-900">{t('qrMenu.wifi', 'WiFi')}</h3>
                  </div>

                  <div className="space-y-2">
                    <div className="flex justify-between items-center py-2 px-3 bg-white rounded-xl">
                      <span className="text-sm text-slate-500">{t('qrMenu.wifiNetwork', 'Network')}</span>
                      <span className="font-semibold text-slate-900">{tenant.wifi.ssid}</span>
                    </div>

                    {tenant.wifi.password && (
                      <motion.button
                        onClick={handleCopyPassword}
                        className="w-full flex justify-between items-center py-2 px-3 bg-white rounded-xl hover:bg-slate-100 transition-colors"
                        whileTap={{ scale: 0.98 }}
                      >
                        <span className="text-sm text-slate-500">{t('qrMenu.wifiPassword', 'Password')}</span>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-slate-900 text-sm">{tenant.wifi.password}</span>
                          {passwordCopied ? (
                            <Check className="w-4 h-4 text-green-600" />
                          ) : (
                            <Copy className="w-4 h-4 text-slate-400" />
                          )}
                        </div>
                      </motion.button>
                    )}
                  </div>
                </div>
              )}

              {/* Rewards */}
              {sessionId && (
                <motion.button
                  onClick={handleNavigateToLoyalty}
                  className="w-full p-4 bg-gradient-to-r from-amber-50 to-orange-50 rounded-2xl flex items-center justify-between group hover:from-amber-100 hover:to-orange-100 transition-colors"
                  whileTap={{ scale: 0.98 }}
                >
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-xl bg-amber-100">
                      <Trophy className="h-5 w-5 text-amber-600" />
                    </div>
                    <div className="text-left">
                      <h3 className="font-semibold text-slate-900">{t('loyalty.rewards', 'Rewards')}</h3>
                      <p className="text-sm text-slate-500">{t('loyalty.viewRewards', 'View your rewards')}</p>
                    </div>
                  </div>
                  <ChevronRight className="h-5 w-5 text-slate-400 group-hover:text-slate-600 transition-colors" />
                </motion.button>
              )}

              {/* Social Media */}
              {socialLinks.length > 0 && (
                <div className="p-4 bg-slate-50 rounded-2xl">
                  <h3 className="font-semibold text-slate-900 mb-3">{t('qrMenu.socialMedia', 'Social Media')}</h3>
                  <div className="grid grid-cols-4 gap-3">
                    {socialLinks.map(({ key, value, Icon, color }) => (
                      <motion.a
                        key={key}
                        href={buildSocialUrl(key, value!)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-center p-3 rounded-xl bg-white hover:scale-105 transition-transform"
                        whileTap={{ scale: 0.95 }}
                      >
                        <Icon className="w-6 h-6" style={{ color }} />
                      </motion.a>
                    ))}
                  </div>
                </div>
              )}

              {/* Language Selector */}
              <div className="p-4 bg-slate-50 rounded-2xl">
                <div className="flex items-center gap-3 mb-3">
                  <div
                    className="p-2 rounded-xl"
                    style={{ backgroundColor: `${settings.primaryColor}15` }}
                  >
                    <Globe className="h-5 w-5" style={{ color: settings.primaryColor }} />
                  </div>
                  <span className="font-semibold text-slate-900">{t('common.language', 'Language')}</span>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  {languages.map((lang) => {
                    const isSelected = i18n.language === lang.code;
                    return (
                      <motion.button
                        key={lang.code}
                        onClick={() => handleLanguageChange(lang.code)}
                        className={`flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                          isSelected
                            ? 'text-white shadow-md'
                            : 'bg-white text-slate-700 hover:bg-slate-100'
                        }`}
                        style={{
                          backgroundColor: isSelected ? settings.primaryColor : undefined,
                        }}
                        whileTap={{ scale: 0.95 }}
                      >
                        <span className="text-lg">{lang.flag}</span>
                        <span className="truncate">{lang.nativeName}</span>
                      </motion.button>
                    );
                  })}
                </div>
              </div>

              {/* Cart Link */}
              <motion.button
                onClick={handleNavigateToCart}
                className="w-full p-4 bg-slate-50 rounded-2xl flex items-center justify-between group hover:bg-slate-100 transition-colors"
                whileTap={{ scale: 0.98 }}
              >
                <div className="flex items-center gap-3">
                  <div
                    className="p-2 rounded-xl"
                    style={{ backgroundColor: `${settings.primaryColor}15` }}
                  >
                    <ShoppingCart className="h-5 w-5" style={{ color: settings.primaryColor }} />
                  </div>
                  <span className="font-semibold text-slate-900">{t('cart.cart', 'Cart')}</span>
                </div>
                <ChevronRight className="h-5 w-5 text-slate-400 group-hover:text-slate-600 transition-colors" />
              </motion.button>

              {/* Orders Link */}
              {sessionId && (
                <motion.button
                  onClick={handleNavigateToOrders}
                  className="w-full p-4 bg-slate-50 rounded-2xl flex items-center justify-between group hover:bg-slate-100 transition-colors"
                  whileTap={{ scale: 0.98 }}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="p-2 rounded-xl"
                      style={{ backgroundColor: `${settings.primaryColor}15` }}
                    >
                      <ClipboardList className="h-5 w-5" style={{ color: settings.primaryColor }} />
                    </div>
                    <span className="font-semibold text-slate-900">{t('orders.myOrders', 'My Orders')}</span>
                  </div>
                  <ChevronRight className="h-5 w-5 text-slate-400 group-hover:text-slate-600 transition-colors" />
                </motion.button>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

export default MenuDrawer;
