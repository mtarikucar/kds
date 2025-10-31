import React from 'react';
import { useTranslation } from 'react-i18next';
import { X, UtensilsCrossed } from 'lucide-react';
import { Product } from '../../types';
import { formatCurrency, cn } from '../../lib/utils';

interface ProductDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  product: Product | null;
  primaryColor: string;
  secondaryColor: string;
  showImages: boolean;
  showDescription: boolean;
  showPrices: boolean;
}

const ProductDetailModal: React.FC<ProductDetailModalProps> = ({
  isOpen,
  onClose,
  product,
  primaryColor,
  secondaryColor,
  showImages,
  showDescription,
  showPrices,
}) => {
  const { t } = useTranslation('common');

  React.useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, onClose]);

  if (!isOpen || !product) return null;

  // Normalize image URL - convert Windows paths to forward slashes
  const normalizeImageUrl = (url: string | null | undefined): string | null => {
    if (!url) return null;
    return url.replace(/\\/g, '/');
  };

  const imageUrl = normalizeImageUrl(product.image || product.images?.[0]?.url);

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex min-h-screen items-center justify-center p-4">
        {/* Backdrop - Smooth animation */}
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-300 animate-in fade-in"
          onClick={onClose}
        ></div>

        {/* Modal - Modern design with gradient */}
        <div className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300">
          {/* Gradient accent line */}
          <div
            className="absolute top-0 left-0 right-0 h-1"
            style={{
              background: `linear-gradient(90deg, ${primaryColor}, ${secondaryColor})`,
            }}
          ></div>

          {/* Product Image - Modern with overlay */}
          {showImages && (
            <div className="relative w-full h-72 bg-gradient-to-br from-gray-100 to-gray-200 overflow-hidden">
              {imageUrl ? (
                <>
                  <img
                    src={imageUrl}
                    alt={product.name}
                    className="w-full h-full object-cover"
                  />
                  {/* Gradient overlay */}
                  <div
                    className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent"
                  ></div>
                </>
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-gray-100 via-gray-150 to-gray-200">
                  <UtensilsCrossed className="h-20 w-20 text-gray-300" />
                </div>
              )}

              {/* Status Badge - Modern design (left side) */}
              <div className="absolute top-4 left-4">
                <span
                  className={cn(
                    'px-4 py-2 rounded-full text-xs font-bold text-white shadow-lg backdrop-blur-sm',
                    !product.isAvailable
                      ? 'bg-green-500/90'
                      : 'bg-red-500/90'
                  )}
                >
                  {!product.isAvailable
                    ? t('qrMenu.available')
                    : t('qrMenu.unavailable')}
                </span>
              </div>

              {/* Close Button - Modern style (right side) */}
              <button
                onClick={onClose}
                className="absolute top-4 right-4 z-10 p-2.5 rounded-full bg-white/95 hover:bg-white shadow-lg hover:shadow-xl transition-all duration-200 transform hover:scale-110 active:scale-95"
                style={{ color: primaryColor }}
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          )}

          {/* Content - Modern spacing and typography */}
          <div className="p-7">
            {/* Product Name */}
            <h2
              className="text-3xl font-bold mb-1 leading-tight"
              style={{ color: secondaryColor }}
            >
              {product.name}
            </h2>

            {/* Divider */}
            <div
              className="h-1 w-12 rounded-full mb-6"
              style={{ backgroundColor: primaryColor }}
            ></div>

            {/* Price - Large and prominent */}
            {showPrices && (
              <div className="mb-6 p-4 rounded-2xl bg-gradient-to-r from-gray-50 to-gray-100">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                  {t('qrMenu.price')}
                </p>
                <p
                  className="text-4xl font-black"
                  style={{ color: primaryColor }}
                >
                  {formatCurrency(product.price, 'USD')}
                </p>
              </div>
            )}

            {/* Description - Modern card style */}
            {showDescription && (
              <div className="mb-6 p-4 rounded-2xl bg-gray-50 border border-gray-100">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                  {t('qrMenu.description')}
                </p>
                <p className="text-gray-700 leading-relaxed text-sm">
                  {product.description || t('qrMenu.noDescription')}
                </p>
              </div>
            )}

            {/* Stock Info - Modern badge */}
            {product.stockTracked && (
              <div className="mb-6 p-4 rounded-2xl bg-gradient-to-r from-blue-50 to-blue-100 border border-blue-200">
                <p className="text-xs font-semibold text-blue-600 uppercase tracking-wider">
                  {t('qrMenu.quantity')}
                </p>
                <p className="text-2xl font-bold text-blue-700 mt-1">
                  {product.currentStock}
                </p>
              </div>
            )}

            {/* Info text */}
            <p className="text-center text-xs text-gray-500 mt-4">
              {t('qrMenu.close')} - ESC
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProductDetailModal;

