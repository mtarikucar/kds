import React, { useState, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft, ChevronRight, UtensilsCrossed } from 'lucide-react';
import { cn } from '../../lib/utils';
import ProgressiveImage from './ui/ProgressiveImage';
import { useIsRTL } from './RTLIcon';

interface ProductImageGalleryProps {
  images: { url: string; alt?: string }[];
  className?: string;
  showThumbnails?: boolean;
  autoPlay?: boolean;
}

const ProductImageGallery: React.FC<ProductImageGalleryProps> = ({
  images,
  className,
  showThumbnails = true,
  autoPlay = false,
}) => {
  const { t } = useTranslation('common');
  const isRTL = useIsRTL();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [direction, setDirection] = useState(0);
  const touchStartX = useRef(0);
  const touchEndX = useRef(0);

  const normalizeImageUrl = (url: string): string => {
    const normalizedPath = url.replace(/\\/g, '/');
    if (normalizedPath.startsWith('http://') || normalizedPath.startsWith('https://')) {
      return normalizedPath;
    }
    const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';
    const BASE_URL = API_URL.replace(/\/api$/, '');
    const path = normalizedPath.startsWith('/') ? normalizedPath.substring(1) : normalizedPath;
    return `${BASE_URL}/${path}`;
  };

  const goToNext = useCallback(() => {
    setDirection(1);
    setCurrentIndex((prev) => (prev + 1) % images.length);
  }, [images.length]);

  const goToPrev = useCallback(() => {
    setDirection(-1);
    setCurrentIndex((prev) => (prev - 1 + images.length) % images.length);
  }, [images.length]);

  const goToIndex = useCallback((index: number) => {
    setDirection(index > currentIndex ? 1 : -1);
    setCurrentIndex(index);
  }, [currentIndex]);

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    touchEndX.current = e.touches[0].clientX;
  };

  const handleTouchEnd = () => {
    const diff = touchStartX.current - touchEndX.current;
    const threshold = 50;

    if (diff > threshold) {
      goToNext();
    } else if (diff < -threshold) {
      goToPrev();
    }
  };

  if (images.length === 0) {
    return (
      <div className={cn('relative bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center', className)}>
        <UtensilsCrossed className="h-20 w-20 text-slate-300" />
      </div>
    );
  }

  if (images.length === 1) {
    return (
      <div className={cn('relative overflow-hidden', className)}>
        <ProgressiveImage
          src={normalizeImageUrl(images[0].url)}
          alt={images[0].alt || t('qrMenu.productImage', 'Product image')}
          className="w-full h-full object-cover"
        />
      </div>
    );
  }

  const variants = {
    enter: (direction: number) => ({
      x: direction > 0 ? '100%' : '-100%',
      opacity: 0,
    }),
    center: {
      x: 0,
      opacity: 1,
    },
    exit: (direction: number) => ({
      x: direction < 0 ? '100%' : '-100%',
      opacity: 0,
    }),
  };

  return (
    <div className={cn('relative overflow-hidden', className)}>
      {/* Main Image */}
      <div
        className="relative w-full h-full"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <AnimatePresence initial={false} custom={direction} mode="popLayout">
          <motion.div
            key={currentIndex}
            custom={direction}
            variants={variants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ type: 'tween', duration: 0.3, ease: 'easeInOut' }}
            className="absolute inset-0"
          >
            <ProgressiveImage
              src={normalizeImageUrl(images[currentIndex].url)}
              alt={images[currentIndex].alt || t('qrMenu.productImage', 'Product image')}
              className="w-full h-full object-cover"
            />
          </motion.div>
        </AnimatePresence>

        {/* Navigation Arrows (desktop) */}
        <button
          onClick={isRTL ? goToNext : goToPrev}
          className="absolute left-2 rtl:left-auto rtl:right-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/90 shadow-lg flex items-center justify-center opacity-0 hover:opacity-100 focus:opacity-100 transition-opacity md:opacity-70"
        >
          <ChevronLeft className="h-6 w-6 text-slate-700 rtl-flip" />
        </button>
        <button
          onClick={isRTL ? goToPrev : goToNext}
          className="absolute right-2 rtl:right-auto rtl:left-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/90 shadow-lg flex items-center justify-center opacity-0 hover:opacity-100 focus:opacity-100 transition-opacity md:opacity-70"
        >
          <ChevronRight className="h-6 w-6 text-slate-700 rtl-flip" />
        </button>

        {/* Dots Indicator */}
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5">
          {images.map((_, index) => (
            <button
              key={index}
              onClick={() => goToIndex(index)}
              className={cn(
                'w-2 h-2 rounded-full transition-all duration-200',
                index === currentIndex
                  ? 'bg-white w-4 shadow-md'
                  : 'bg-white/60 hover:bg-white/80'
              )}
            />
          ))}
        </div>
      </div>

      {/* Thumbnails */}
      {showThumbnails && images.length > 1 && (
        <div className="flex gap-2 mt-2 px-4 overflow-x-auto pb-2">
          {images.map((image, index) => (
            <button
              key={index}
              onClick={() => goToIndex(index)}
              className={cn(
                'flex-shrink-0 w-14 h-14 rounded-lg overflow-hidden transition-all duration-200',
                index === currentIndex
                  ? 'ring-2 ring-offset-2 ring-slate-900'
                  : 'opacity-60 hover:opacity-100'
              )}
            >
              <img
                src={normalizeImageUrl(image.url)}
                alt={image.alt || t('qrMenu.productImage', 'Product image')}
                className="w-full h-full object-cover"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default ProductImageGallery;
