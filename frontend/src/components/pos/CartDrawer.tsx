import { X } from 'lucide-react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

interface CartDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
}

const CartDrawer = ({ isOpen, onClose, children }: CartDrawerProps) => {
  const { t } = useTranslation('pos');

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isOpen]);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      window.addEventListener('keydown', handleEscape);
      return () => window.removeEventListener('keydown', handleEscape);
    }
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-40 transition-opacity lg:hidden"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer */}
      <div
        className={`fixed inset-x-0 bottom-0 z-50 lg:hidden transform transition-transform duration-300 ease-out ${
          isOpen ? 'translate-y-0' : 'translate-y-full'
        }`}
        style={{ height: '85vh', maxHeight: '85vh' }}
      >
        <div className="bg-white rounded-t-2xl shadow-2xl h-full flex flex-col overflow-hidden">
          {/* Header */}
          <div className="flex-shrink-0 flex items-center justify-between px-5 py-4 border-b border-slate-100">
            <h2 className="text-lg font-heading font-bold text-slate-900">{t('cart.yourOrder')}</h2>
            <button
              onClick={onClose}
              className="p-2 hover:bg-slate-100 rounded-xl transition-colors text-slate-500 hover:text-slate-700"
              aria-label={t('cart.closeCart')}
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Content - Takes remaining space */}
          <div className="flex-1 min-h-0 overflow-hidden">
            {children}
          </div>
        </div>
      </div>
    </>
  );
};

export default CartDrawer;
