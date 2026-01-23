import React from 'react';
import { useTranslation } from 'react-i18next';
import { ShoppingBag, ArrowRight } from 'lucide-react';
import { motion } from 'framer-motion';

interface EmptyCartProps {
  primaryColor: string;
  secondaryColor: string;
  onBrowseMenu: () => void;
}

const EmptyCart: React.FC<EmptyCartProps> = ({
  primaryColor,
  secondaryColor,
  onBrowseMenu,
}) => {
  const { t } = useTranslation('common');

  return (
    <div className="flex flex-col items-center justify-center py-16 px-6">
      {/* Animated Icon */}
      <motion.div
        initial={{ scale: 0, rotate: -180 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 20 }}
        className="relative mb-6"
      >
        <div
          className="w-24 h-24 rounded-full flex items-center justify-center"
          style={{ backgroundColor: `${primaryColor}15` }}
        >
          <motion.div
            animate={{ y: [0, -5, 0] }}
            transition={{ repeat: Infinity, duration: 2, ease: 'easeInOut' }}
          >
            <ShoppingBag className="h-12 w-12" style={{ color: primaryColor }} />
          </motion.div>
        </div>

        {/* Decorative circles */}
        <motion.div
          className="absolute -top-2 -right-2 rtl:-right-auto rtl:-left-2 w-6 h-6 rounded-full"
          style={{ backgroundColor: `${secondaryColor}30` }}
          animate={{ scale: [1, 1.2, 1] }}
          transition={{ repeat: Infinity, duration: 2, delay: 0.3 }}
        />
        <motion.div
          className="absolute -bottom-1 -left-3 rtl:-left-auto rtl:-right-3 w-4 h-4 rounded-full"
          style={{ backgroundColor: `${primaryColor}40` }}
          animate={{ scale: [1, 1.3, 1] }}
          transition={{ repeat: Infinity, duration: 2, delay: 0.6 }}
        />
      </motion.div>

      {/* Text */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="text-center mb-8"
      >
        <h2 className="text-xl font-bold text-slate-800 mb-2">
          {t('cart.emptyTitle', 'Your cart is empty')}
        </h2>
        <p className="text-slate-500 text-sm max-w-xs">
          {t('cart.emptyDescription', 'Looks like you haven\'t added anything to your cart yet. Start browsing our delicious menu!')}
        </p>
      </motion.div>

      {/* CTA Button */}
      <motion.button
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={onBrowseMenu}
        className="flex items-center gap-2 px-6 py-3 rounded-full font-semibold text-white shadow-lg hover:shadow-xl transition-shadow"
        style={{ backgroundColor: primaryColor }}
      >
        {t('common.browseMenu', 'Browse Menu')}
        <ArrowRight className="h-4 w-4 rtl-flip" />
      </motion.button>
    </div>
  );
};

export default EmptyCart;
