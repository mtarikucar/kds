import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { Modifier, CreateModifierDto } from '../../types';
import Modal from '../ui/Modal';
import Input from '../ui/Input';
import Button from '../ui/Button';

const createModifierSchema = (t: (key: string) => string) =>
  z.object({
    name: z.string().min(1, t('menu.validation.internalNameRequired')),
    displayName: z.string().min(1, t('menu.validation.displayNameRequired')),
    description: z.string().optional(),
    priceAdjustment: z.number().min(0).default(0),
    isAvailable: z.boolean().default(true),
    displayOrder: z.number().min(0).default(0),
  });

type ModifierFormData = z.infer<ReturnType<typeof createModifierSchema>>;

interface ModifierItemModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: CreateModifierDto) => void;
  editingModifier?: Modifier | null;
  groupId: string;
  isLoading?: boolean;
}

const ModifierItemModal = ({
  isOpen,
  onClose,
  onSubmit,
  editingModifier,
  groupId,
  isLoading,
}: ModifierItemModalProps) => {
  const { t } = useTranslation(['menu', 'common']);
  const schema = createModifierSchema(t);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ModifierFormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: '',
      displayName: '',
      description: '',
      priceAdjustment: 0,
      isAvailable: true,
      displayOrder: 0,
    },
  });

  useEffect(() => {
    if (editingModifier) {
      reset({
        name: editingModifier.name,
        displayName: editingModifier.displayName,
        description: editingModifier.description || '',
        priceAdjustment: editingModifier.priceAdjustment,
        isAvailable: editingModifier.isAvailable,
        displayOrder: editingModifier.displayOrder,
      });
    } else {
      reset({
        name: '',
        displayName: '',
        description: '',
        priceAdjustment: 0,
        isAvailable: true,
        displayOrder: 0,
      });
    }
  }, [editingModifier, reset]);

  const handleFormSubmit = (data: ModifierFormData) => {
    const submitData: CreateModifierDto = {
      ...data,
      groupId,
    };
    onSubmit(submitData);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={editingModifier ? t('menu.editModifier') : t('menu.addModifier')}
      size="sm"
    >
      <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-3">
        <Input
          label={t('menu.internalName')}
          placeholder="small, medium, large..."
          error={errors.name?.message}
          {...register('name')}
        />

        <Input
          label={t('menu.displayName')}
          placeholder={t('menu.modifierDisplayNamePlaceholder')}
          error={errors.displayName?.message}
          {...register('displayName')}
        />

        <Input
          label={t('menu.description')}
          placeholder={t('menu.modifierDescriptionPlaceholder')}
          error={errors.description?.message}
          {...register('description')}
        />

        <div>
          <Input
            label={t('menu.priceAdjustment')}
            type="number"
            step="0.01"
            min={0}
            error={errors.priceAdjustment?.message}
            {...register('priceAdjustment', { valueAsNumber: true })}
          />
          <p className="mt-1 text-xs text-slate-500">{t('menu.priceAdjustmentHint')}</p>
        </div>

        <Input
          label={t('menu.displayOrder')}
          type="number"
          min={0}
          error={errors.displayOrder?.message}
          {...register('displayOrder', { valueAsNumber: true })}
        />

        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="isAvailable"
            {...register('isAvailable')}
            className="rounded"
          />
          <label htmlFor="isAvailable" className="text-sm font-medium">
            {t('menu.available')}
          </label>
        </div>

        <div className="flex gap-3 pt-4">
          <Button
            type="button"
            variant="outline"
            className="flex-1"
            onClick={onClose}
            disabled={isLoading}
          >
            {t('common:app.cancel')}
          </Button>
          <Button
            type="submit"
            className="flex-1"
            isLoading={isLoading}
            disabled={isLoading}
          >
            {editingModifier ? t('common:app.update') : t('common:app.create')}
          </Button>
        </div>
      </form>
    </Modal>
  );
};

export default ModifierItemModal;
