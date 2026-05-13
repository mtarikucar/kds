import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';

// Refcount how many Modal instances currently want body scroll locked.
// Without this, a nested modal closing earlier than the outer one would
// restore body scroll while the outer modal is still on screen — the
// backdrop suddenly scrolls under the visible modal.
let scrollLockRefcount = 0;
function acquireScrollLock() {
  scrollLockRefcount += 1;
  if (scrollLockRefcount === 1) {
    document.body.style.overflow = 'hidden';
  }
}
function releaseScrollLock() {
  scrollLockRefcount = Math.max(0, scrollLockRefcount - 1);
  if (scrollLockRefcount === 0) {
    document.body.style.overflow = 'unset';
  }
}

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
}

const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  children,
  size = 'md',
}) => {
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      acquireScrollLock();
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
      if (isOpen) releaseScrollLock();
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const sizes = {
    sm: 'max-w-sm sm:max-w-md',
    md: 'max-w-sm sm:max-w-md md:max-w-lg',
    lg: 'max-w-sm sm:max-w-lg md:max-w-xl lg:max-w-2xl',
    xl: 'max-w-sm sm:max-w-xl md:max-w-2xl lg:max-w-3xl',
    full: 'max-w-[95vw] md:max-w-[85vw] lg:max-w-[80vw]',
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex min-h-screen items-center justify-center p-3 sm:p-4">
        {/* Backdrop */}
        <div
          className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm transition-opacity"
          onClick={onClose}
        />

        {/* Modal */}
        <div
          className={cn(
            'relative w-full bg-white rounded-xl shadow-2xl',
            'max-h-[90vh] flex flex-col',
            'animate-in fade-in-0 zoom-in-95 duration-200',
            sizes[size]
          )}
        >
          {/* Header */}
          {title && (
            <div className="flex items-center justify-between px-4 py-3 sm:px-6 sm:py-4 border-b border-slate-100 flex-shrink-0">
              <h2 className="text-base sm:text-lg md:text-xl font-heading font-semibold text-slate-900">{title}</h2>
              <button
                onClick={onClose}
                className="text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg p-1.5 sm:p-2 transition-all duration-150"
              >
                <X className="h-4 w-4 sm:h-5 sm:w-5" />
              </button>
            </div>
          )}

          {/* Content */}
          <div className="px-4 py-4 sm:px-6 sm:py-5 overflow-y-auto flex-1">{children}</div>
        </div>
      </div>
    </div>
  );
};

export default Modal;
