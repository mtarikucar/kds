import { z } from 'zod';

// Zod schema factories extracted from MenuManagementPage. They are factories
// (rather than plain schemas) so error messages can be resolved through i18n
// at call time. Extracting them here keeps the validation rules
// (name required, price >= 0, stock >= 0, valid url, ...) testable in isolation.

export const createCategorySchema = (t: (key: string) => string) =>
  z.object({
    name: z.string().min(1, t('menu.validation.nameRequired')),
    description: z.string().optional(),
    displayOrder: z.number().optional(),
  });

export const createProductSchema = (t: (key: string) => string) =>
  z.object({
    name: z.string().min(1, t('menu.validation.nameRequired')),
    description: z.string().optional(),
    price: z.number().min(0, t('menu.validation.pricePositive')),
    categoryId: z.string().min(1, t('menu.validation.categoryRequired')),
    currentStock: z.number().min(0, t('menu.validation.stockPositive')).optional(),
    image: z.string().url(t('menu.validation.invalidUrl')).optional().or(z.literal('')),
    imageIds: z.array(z.string()).optional(),
    isAvailable: z.boolean().optional(),
    // When true, this product's currentStock decrements on each sale and the
    // POS shows a live low-stock / out-of-stock badge.
    stockTracked: z.boolean().optional(),
    // KDV (VAT) rate — TR allows 0/1/10/20. Optional; backend defaults to 10.
    taxRate: z.number().optional(),
  });

export type CategoryFormData = z.infer<ReturnType<typeof createCategorySchema>>;
export type ProductFormData = z.infer<ReturnType<typeof createProductSchema>>;
