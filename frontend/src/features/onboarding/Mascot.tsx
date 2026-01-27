import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { User } from 'lucide-react';
import { cn } from '../../lib/utils';

type MascotSize = 'sm' | 'md' | 'lg';
type MascotVariant = 'navbar' | 'tooltip' | 'modal';

interface MascotProps {
  size?: MascotSize;
  variant?: MascotVariant;
  speaking?: boolean;
  className?: string;
}

const sizeConfig: Record<MascotSize, { width: number; height: number }> = {
  sm: { width: 48, height: 48 },
  md: { width: 80, height: 80 },
  lg: { width: 120, height: 120 },
};

const variantImages: Record<MascotVariant, string> = {
  navbar: 'voxel_chef_bottom.png',
  tooltip: 'voxel_chef_3_bottom_left.png',
  modal: 'voxel_chef_1_top_left.png',
};

export function Mascot({ size = 'md', variant = 'navbar', speaking = false, className }: MascotProps) {
  const { t } = useTranslation('onboarding');
  const { width, height } = sizeConfig[size];
  const [imageError, setImageError] = useState(false);
  const imageSrc = `${import.meta.env.BASE_URL}${variantImages[variant]}`;

  return (
    <div
      className={cn(
        'relative flex-shrink-0',
        className
      )}
      style={{ width, height }}
    >
      {!imageError ? (
        <img
          src={imageSrc}
          alt={t('mascot.altText')}
          width={width}
          height={height}
          onError={() => setImageError(true)}
          className={cn(
            'w-full h-full object-contain',
            speaking && 'drop-shadow-lg'
          )}
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center bg-slate-100 rounded-full">
          <User className="w-1/2 h-1/2 text-slate-400" />
        </div>
      )}
      {speaking && (
        <div className="absolute -top-1 -right-1 w-3 h-3 bg-blue-500 rounded-full animate-pulse" />
      )}
    </div>
  );
}

export default Mascot;
