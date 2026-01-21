import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Wifi, Copy, Check } from 'lucide-react';
import { toast } from 'sonner';
import { WifiInfo, SocialMedia } from '../../pages/qr-menu/QRMenuLayout';

// Social media icons - simple SVG components
const InstagramIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
  </svg>
);

const FacebookIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
  </svg>
);

const TwitterIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
  </svg>
);

const TikTokIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z"/>
  </svg>
);

const YouTubeIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
  </svg>
);

const WhatsAppIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
  </svg>
);

interface RestaurantInfoProps {
  wifi?: WifiInfo | null;
  socialMedia?: SocialMedia;
  primaryColor: string;
}

// Helper to build social media URL
const buildSocialUrl = (platform: string, value: string): string => {
  // If already a full URL, return as is
  if (value.startsWith('http://') || value.startsWith('https://')) {
    return value;
  }

  // Remove @ prefix if present
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
    case 'youtube':
      return `https://youtube.com/@${username}`;
    case 'whatsapp':
      // Clean phone number and create WhatsApp link
      const phone = value.replace(/[^0-9+]/g, '').replace('+', '');
      return `https://wa.me/${phone}`;
    default:
      return value;
  }
};

export default function RestaurantInfo({ wifi, socialMedia, primaryColor }: RestaurantInfoProps) {
  const { t } = useTranslation('common');
  const [copied, setCopied] = useState(false);

  // Check if we have any data to show
  const hasWifi = wifi && wifi.ssid;
  const hasSocial = socialMedia && (
    socialMedia.instagram ||
    socialMedia.facebook ||
    socialMedia.twitter ||
    socialMedia.tiktok ||
    socialMedia.youtube ||
    socialMedia.whatsapp
  );

  if (!hasWifi && !hasSocial) {
    return null;
  }

  const handleCopyPassword = async () => {
    if (wifi?.password) {
      try {
        await navigator.clipboard.writeText(wifi.password);
        setCopied(true);
        toast.success(t('qrMenu.passwordCopied'));
        setTimeout(() => setCopied(false), 2000);
      } catch {
        toast.error('Failed to copy');
      }
    }
  };

  const socialLinks = [
    { key: 'instagram', value: socialMedia?.instagram, Icon: InstagramIcon, color: '#E4405F' },
    { key: 'facebook', value: socialMedia?.facebook, Icon: FacebookIcon, color: '#1877F2' },
    { key: 'twitter', value: socialMedia?.twitter, Icon: TwitterIcon, color: '#000000' },
    { key: 'tiktok', value: socialMedia?.tiktok, Icon: TikTokIcon, color: '#000000' },
    { key: 'youtube', value: socialMedia?.youtube, Icon: YouTubeIcon, color: '#FF0000' },
    { key: 'whatsapp', value: socialMedia?.whatsapp, Icon: WhatsAppIcon, color: '#25D366' },
  ].filter(link => link.value);

  return (
    <div className="px-4 py-4 space-y-4">
      {/* WiFi Card */}
      {hasWifi && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200/60 p-4">
          <div className="flex items-center gap-3 mb-3">
            <div
              className="p-2 rounded-lg"
              style={{ backgroundColor: `${primaryColor}20` }}
            >
              <Wifi className="w-5 h-5" style={{ color: primaryColor }} />
            </div>
            <h3 className="font-semibold text-slate-900">{t('qrMenu.wifi')}</h3>
          </div>

          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-sm text-slate-500">{t('qrMenu.wifiNetwork')}</span>
              <span className="font-medium text-slate-900">{wifi.ssid}</span>
            </div>
            {wifi.password && (
              <div className="flex justify-between items-center">
                <span className="text-sm text-slate-500">{t('qrMenu.wifiPassword')}</span>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-slate-900 bg-slate-100 px-2 py-1 rounded text-sm">
                    {wifi.password}
                  </span>
                  <button
                    onClick={handleCopyPassword}
                    className="p-1.5 rounded-lg hover:bg-slate-100 transition-colors"
                    title={t('qrMenu.copyPassword')}
                  >
                    {copied ? (
                      <Check className="w-4 h-4 text-green-600" />
                    ) : (
                      <Copy className="w-4 h-4 text-slate-500" />
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Social Media Links */}
      {hasSocial && socialLinks.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200/60 p-4">
          <h3 className="font-semibold text-slate-900 mb-3">{t('qrMenu.socialMedia')}</h3>
          <div className="flex flex-wrap gap-3 justify-center">
            {socialLinks.map(({ key, value, Icon, color }) => (
              <a
                key={key}
                href={buildSocialUrl(key, value!)}
                target="_blank"
                rel="noopener noreferrer"
                className="p-3 rounded-full bg-slate-100 hover:bg-slate-200 transition-colors"
                style={{ color }}
                title={key.charAt(0).toUpperCase() + key.slice(1)}
              >
                <Icon className="w-6 h-6" />
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
