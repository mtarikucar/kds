import React, { useState, useRef, useEffect } from 'react';
import { useInView } from 'react-intersection-observer';
import { cn } from '../../../lib/utils';

interface ProgressiveImageProps {
  src: string | null | undefined;
  alt: string;
  className?: string;
  placeholderClassName?: string;
  onError?: () => void;
}

const ProgressiveImage: React.FC<ProgressiveImageProps> = ({
  src,
  alt,
  className,
  placeholderClassName,
  onError,
}) => {
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  const { ref: inViewRef, inView } = useInView({
    triggerOnce: true,
    threshold: 0.1,
    rootMargin: '100px',
  });

  // Combine refs
  const setRefs = (element: HTMLDivElement | null) => {
    inViewRef(element);
  };

  useEffect(() => {
    if (!inView || !src || hasError) return;

    const img = new Image();
    img.src = src;

    img.onload = () => {
      setIsLoaded(true);
    };

    img.onerror = () => {
      setHasError(true);
      onError?.();
    };

    return () => {
      img.onload = null;
      img.onerror = null;
    };
  }, [inView, src, hasError, onError]);

  if (!src || hasError) {
    return null;
  }

  return (
    <div ref={setRefs} className="relative w-full h-full overflow-hidden">
      {/* Blur placeholder */}
      <div
        className={cn(
          'absolute inset-0 bg-gradient-to-br from-slate-200 to-slate-300 transition-opacity duration-500',
          isLoaded ? 'opacity-0' : 'opacity-100',
          placeholderClassName
        )}
      >
        {/* Shimmer effect while loading */}
        <div
          className={cn(
            'absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent',
            !isLoaded && 'animate-shimmer'
          )}
          style={{
            backgroundSize: '200% 100%',
          }}
        />
      </div>

      {/* Actual image */}
      {inView && (
        <img
          ref={imgRef}
          src={src}
          alt={alt}
          className={cn(
            'w-full h-full object-cover transition-all duration-500',
            isLoaded ? 'opacity-100 scale-100 blur-0' : 'opacity-0 scale-105 blur-sm',
            className
          )}
          onLoad={() => setIsLoaded(true)}
          onError={() => {
            setHasError(true);
            onError?.();
          }}
        />
      )}
    </div>
  );
};

export default ProgressiveImage;
