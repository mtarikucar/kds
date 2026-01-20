import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { ModifierGroup, SelectionType, CreateModifierGroupDto } from '../../types';
import Modal from '../ui/Modal';
import Input from '../ui/Input';
import Button from '../ui/Button';

const createModifierGroupSchema = (t: (key: string) => string) =>
  z.object({
    name: z.string().min(1, t('menu.validation.internalNameRequired')),
    displayName: z.string().min(1, t('menu.validation.displayNameRequired')),
    description: z.string().optional(),
    selectionType: z.enum(['SINGLE', 'MULTIPLE']),
    minSelections: z.number().min(0).default(0),
    maxSelections: z.number().min(1).optional().nullable(),
    isRequired: z.boolean().default(false),
    displayOrder: z.number().min(0).default(0),
    isActive: z.boolean().default(true),
  });

type ModifierGroupFormData = z.infer<ReturnType<typeof createModifierGroupSchema>>;

interface ModifierGroupModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: CreateModifierGroupDto) => void;
  editingGroup?: ModifierGroup | null;
  isLoading?: boolean;
}

const ModifierGroupModal = ({
  isOpen,
  onClose,
  onSubmit,
  editingGroup,
  isLoading,
}: ModifierGroupModalProps) => {
  const { t } = useTranslation(['menu', 'common']);
  const schema = createModifierGroupSchema(t);

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors },
  } = useForm<ModifierGroupFormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: '',
      displayName: '',
      description: '',
      selectionType: 'SINGLE',
      minSelections: 0,
      maxSelections: null,
      isRequired: false,
      displayOrder: 0,
      isActive: true,
    },
  });

  const selectionType = watch('selectionType');

  useEffect(() => {
    if (editingGroup) {
      reset({
        name: editingGroup.name,
        displayName: editingGroup.displayName,
        description: editingGroup.description || '',
        selectionType: editingGroup.selectionType,
        minSelections: editingGroup.minSelections,
        maxSelections: editingGroup.maxSelections || null,
        isRequired: editingGroup.isRequired,
        displayOrder: editingGroup.displayOrder,
        isActive: editingGroup.isActive,
      });
    } else {
      reset({
        name: '',
        displayName: '',
        description: '',
        selectionType: 'SINGLE',
        minSelections: 0,
        maxSelections: null,
        isRequired: false,
        displayOrder: 0,
        isActive: true,
      });
    }
  }, [editingGroup, reset]);

  const handleFormSubmit = (data: ModifierGroupFormData) => {
    const submitData: CreateModifierGroupDto = {
      ...data,
      selectionType: data.selectionType as SelectionType,
      maxSelections: data.maxSelections || undefined,
    };
    onSubmit(submitData);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={editingGroup ? t('menu.editModifierGroup') : t('menu.addModifierGroup')}
    >
      <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-4">
        <Input
          label={t('menu.internalName')}
          placeholder="size, sauces, extras..."
          error={errors.name?.message}
          {...register('name')}
        />

        <Input
          label={t('menu.displayName')}
          placeholder={t('menu.displayNamePlaceholder')}
          error={errors.displayName?.message}
          {...register('displayName')}
        />

        <Input
          label={t('menu.description')}
          placeholder={t('menu.descriptionPlaceholder')}
          error={errors.description?.message}
          {...register('description')}
        />

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            {t('menu.selectionType')}
          </label>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                value="SINGLE"
                {...register('selectionType')}
                className="text-primary-600"
              />
              <span className="text-sm">{t('menu.singleSelection')}</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                value="MULTIPLE"
                {...register('selectionType')}
                className="text-primary-600"
              />
              <span className="text-sm">{t('menu.multipleSelection')}</span>
            </label>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="isRequired"
            {...register('isRequired')}
            className="rounded"
          />
          <label htmlFor="isRequired" className="text-sm font-medium">
            {t('menu.isRequired')}
          </label>
        </div>

        {selectionType === 'MULTIPLE' && (
          <div className="grid grid-cols-2 gap-4">
            <Input
              label={t('menu.minSelections')}
              type="number"
              min={0}
              error={errors.minSelections?.message}
              {...register('minSelections', { valueAsNumber: true })}
            />
            <Input
              label={t('menu.maxSelections')}
              type="number"
              min={1}
              placeholder={t('menu.unlimited')}
              error={errors.maxSelections?.message}
              {...register('maxSelections', {
                setValueAs: (v) => (v === '' || v === null ? null : Number(v)),
              })}
            />
          </div>
        )}

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
            id="isActive"
            {...register('isActive')}
            className="rounded"
          />
          <label htmlFor="isActive" className="text-sm font-medium">
            {t('common:app.active')}
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
            {editingGroup ? t('common:app.update') : t('common:app.create')}
          </Button>
        </div>
      </form>
    </Modal>
  );
};

export default ModifierGroupModal;
