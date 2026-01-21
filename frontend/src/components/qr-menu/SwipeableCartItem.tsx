import React, { useState, useRef, useCallback } from 'react';
import { Trash2 } from 'lucide-react';
import { cn } from '../../lib/utils';

interface SwipeableCartItemProps {
  children: React.ReactNode;
  onDelete: () => void;
  deleteThreshold?: number;
}

const SwipeableCartItem: React.FC<SwipeableCartItemProps> = ({
  children,
  onDelete,
  deleteThreshold = 100,
}) => {
  const [translateX, setTranslateX] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const startXRef = useRef(0);
  const currentXRef = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    startXRef.current = e.touches[0].clientX;
    currentXRef.current = translateX;
    setIsDragging(true);
  }, [translateX]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isDragging) return;

    const currentX = e.touches[0].clientX;
    const diff = currentX - startXRef.current;

    // Only allow swiping left (negative values)
    const newTranslate = Math.min(0, Math.max(-deleteThreshold - 20, currentXRef.current + diff));
    setTranslateX(newTranslate);
  }, [isDragging, deleteThreshold]);

  const handleTouchEnd = useCallback(() => {
    setIsDragging(false);

    if (translateX < -deleteThreshold) {
      // Delete threshold reached
      setIsDeleting(true);
      setTranslateX(-300);
      setTimeout(() => {
        onDelete();
      }, 200);
    } else if (translateX < -40) {
      // Snap to show delete button
      setTranslateX(-80);
    } else {
      // Snap back
      setTranslateX(0);
    }
  }, [translateX, deleteThreshold, onDelete]);

  const handleDeleteClick = useCallback(() => {
    setIsDeleting(true);
    setTranslateX(-300);
    setTimeout(() => {
      onDelete();
    }, 200);
  }, [onDelete]);

  // Reset on tap outside
  const handleContainerClick = useCallback(() => {
    if (translateX < 0 && !isDragging) {
      setTranslateX(0);
    }
  }, [translateX, isDragging]);

  return (
    <div
      ref={containerRef}
      className={cn(
        'relative overflow-hidden rounded-2xl',
        isDeleting && 'opacity-0 h-0 transition-all duration-200'
      )}
      onClick={handleContainerClick}
    >
      {/* Delete background */}
      <div
        className="absolute inset-y-0 right-0 flex items-center justify-end bg-red-500 transition-all"
        style={{
          width: Math.max(80, Math.abs(translateX)),
          opacity: Math.min(1, Math.abs(translateX) / 60),
        }}
      >
        <button
          onClick={handleDeleteClick}
          className="flex flex-col items-center justify-center h-full px-6 text-white"
        >
          <Trash2 className="h-6 w-6" />
          <span className="text-xs font-medium mt-1">Delete</span>
        </button>
      </div>

      {/* Swipeable content */}
      <div
        className={cn(
          'relative bg-white',
          !isDragging && 'transition-transform duration-200 ease-out'
        )}
        style={{
          transform: `translateX(${translateX}px)`,
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {children}
      </div>
    </div>
  );
};

export default SwipeableCartItem;
