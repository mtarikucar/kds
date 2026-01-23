import React from 'react';
import { useTranslation } from 'react-i18next';
import { RTL_LANGUAGES } from '../../i18n/config';
import { cn } from '../../lib/utils';
import { LucideIcon } from 'lucide-react';

interface RTLIconProps {
  icon: LucideIcon;
  className?: string;
  flip?: boolean; // true for directional icons like arrows
}

/**
 * RTLIcon - A wrapper component for icons that need to flip in RTL mode
 *
 * Use this for directional icons like:
 * - ArrowLeft, ArrowRight
 * - ChevronLeft, ChevronRight
 * - CaretLeft, CaretRight
 *
 * @param icon - The Lucide icon component to render
 * @param className - Additional CSS classes
 * @param flip - Whether to flip the icon in RTL mode (default: true)
 */
export const RTLIcon: React.FC<RTLIconProps> = ({
  icon: Icon,
  className,
  flip = true
}) => {
  const { i18n } = useTranslation();
  const isRTL = RTL_LANGUAGES.includes(i18n.language);

  return <Icon className={cn(className, flip && isRTL && 'rtl-flip')} />;
};

/**
 * Hook to check if current language is RTL
 */
export const useIsRTL = (): boolean => {
  const { i18n } = useTranslation();
  return RTL_LANGUAGES.includes(i18n.language);
};

export default RTLIcon;
