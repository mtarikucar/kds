import React, { useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { Category } from '../../types';
import { cn } from '../../lib/utils';

interface CategoryBarProps {
  categories: Category[];
  selectedCategory: string;
  activeSection: string;
  primaryColor: string;
  onCategoryClick: (categoryId: string) => void;
}

const CategoryBar: React.FC<CategoryBarProps> = ({
  categories,
  selectedCategory,
  activeSection,
  primaryColor,
  onCategoryClick,
}) => {
  const { t } = useTranslation('common');
  const categoryBarRef = useRef<HTMLDivElement>(null);
  const categoryButtonRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  const setCategoryButtonRef = useCallback((categoryId: string) => (el: HTMLButtonElement | null) => {
    if (el) {
      categoryButtonRefs.current.set(categoryId, el);
    } else {
      categoryButtonRefs.current.delete(categoryId);
    }
  }, []);

  // Scroll category button into view when active section changes
  useEffect(() => {
    if (!categoryBarRef.current || !activeSection) return;

    const activeButton = categoryButtonRefs.current.get(activeSection);
    if (activeButton) {
      activeButton.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
  }, [activeSection]);

  return (
    <div className="sticky top-0 z-20 bg-white/95 backdrop-blur-lg border-b border-slate-100 shadow-sm">
      <div
        ref={categoryBarRef}
        className="flex gap-2 overflow-x-auto py-3 px-4 sm:px-6 scrollbar-hide"
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        {/* All Categories Button */}
        <motion.button
          ref={setCategoryButtonRef('')}
          onClick={() => onCategoryClick('')}
          className={cn(
            'flex-shrink-0 px-4 py-2.5 rounded-full font-semibold text-sm transition-all duration-200 whitespace-nowrap'
          )}
          style={{
            backgroundColor: !selectedCategory && !activeSection ? primaryColor : 'white',
            color: !selectedCategory && !activeSection ? 'white' : '#475569',
            border: !selectedCategory && !activeSection ? 'none' : '1px solid #e2e8f0',
            boxShadow: !selectedCategory && !activeSection ? `0 4px 15px ${primaryColor}40` : 'none',
          }}
          animate={{
            scale: !selectedCategory && !activeSection ? 1.05 : 1,
          }}
          whileTap={{ scale: 0.95 }}
        >
          {t('qrMenu.allCategories', 'All')}
        </motion.button>

        {/* Category Buttons */}
        {categories.map((category) => {
          const isActive = selectedCategory === category.id || activeSection === category.id;
          return (
            <motion.button
              key={category.id}
              ref={setCategoryButtonRef(category.id)}
              onClick={() => onCategoryClick(category.id)}
              className={cn(
                'flex-shrink-0 px-4 py-2.5 rounded-full font-semibold text-sm transition-all duration-200 whitespace-nowrap'
              )}
              style={{
                backgroundColor: isActive ? primaryColor : 'white',
                color: isActive ? 'white' : '#475569',
                border: isActive ? 'none' : '1px solid #e2e8f0',
                boxShadow: isActive ? `0 4px 15px ${primaryColor}40` : 'none',
              }}
              animate={{
                scale: isActive ? 1.05 : 1,
              }}
              whileTap={{ scale: 0.95 }}
            >
              {category.name}
            </motion.button>
          );
        })}
      </div>
    </div>
  );
};

export default CategoryBar;
