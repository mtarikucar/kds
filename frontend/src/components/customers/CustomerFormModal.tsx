import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import Input from '../ui/Input';
import { Customer, CreateCustomerDto } from '../../types';
import { useCreateCustomer, useUpdateCustomer } from '../../features/customers/customersApi';
import { isValidPhone } from '../../utils/validation';

interface CustomerFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  customer?: Customer | null;
}

const CustomerFormModal: React.FC<CustomerFormModalProps> = ({
  isOpen,
  onClose,
  customer,
}) => {
  const { t } = useTranslation(['customers', 'validation']);
  const { mutate: createCustomer, isPending: isCreating } = useCreateCustomer();
  const { mutate: updateCustomer, isPending: isUpdating } = useUpdateCustomer();

  const [tagInput, setTagInput] = useState('');
  const [tags, setTags] = useState<string[]>([]);

  // Zod validation schema
  const customerSchema = z.object({
    name: z.string().min(2, t('validation:nameMin')),
    email: z.string().email(t('validation:email')).optional().or(z.literal('')),
    phone: z.string()
      .optional()
      .refine(
        (val) => !val || isValidPhone(val),
        { message: t('validation:invalidPhone') }
      )
      .or(z.literal('')),
    birthday: z.string().optional().or(z.literal('')),
    notes: z.string().optional().or(z.literal('')),
  });

  type CustomerFormData = z.infer<typeof customerSchema>;

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CustomerFormData>({
    resolver: zodResolver(customerSchema),
    defaultValues: {
      name: '',
      email: '',
      phone: '',
      birthday: '',
      notes: '',
    },
  });

  useEffect(() => {
    if (customer) {
      reset({
        name: customer.name || '',
        email: customer.email || '',
        phone: customer.phone || '',
        birthday: customer.birthday ? customer.birthday.split('T')[0] : '',
        notes: customer.notes || '',
      });
      setTags(customer.tags || []);
    } else {
      reset({
        name: '',
        email: '',
        phone: '',
        birthday: '',
        notes: '',
      });
      setTags([]);
    }
    setTagInput('');
  }, [customer, isOpen, reset]);

  const handleAddTag = () => {
    const tag = tagInput.trim().toUpperCase();
    if (tag && !tags.includes(tag)) {
      setTags((prev) => [...prev, tag]);
      setTagInput('');
    }
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setTags((prev) => prev.filter((tag) => tag !== tagToRemove));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddTag();
    }
  };

  const onSubmit = (data: CustomerFormData) => {
    // Build payload, ensuring we don't send empty strings for unique fields
    const email = data.email?.trim();
    const phone = data.phone?.trim();
    const notes = data.notes?.trim();

    const payload: any = {
      name: data.name.trim(),
    };

    // Only include optional fields if they have actual values
    if (email) payload.email = email;
    if (phone) payload.phone = phone;
    if (notes) payload.notes = notes;
    if (tags.length > 0) payload.tags = tags;

    // Convert birthday string to ISO DateTime if provided
    if (data.birthday) {
      payload.birthday = new Date(data.birthday).toISOString();
    }

    if (customer) {
      // For updates, explicitly set null for cleared fields
      if (!email && customer.email) payload.email = null;
      if (!phone && customer.phone) payload.phone = null;
      if (!notes && customer.notes) payload.notes = null;
      if (!data.birthday && customer.birthday) payload.birthday = null;

      updateCustomer(
        { id: customer.id, data: payload },
        { onSuccess: () => onClose() }
      );
    } else {
      createCustomer(payload, { onSuccess: () => onClose() });
    }
  };

  const isLoading = isCreating || isUpdating;
  const isEditMode = !!customer;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isEditMode ? t('customers.editCustomer') : t('customers.addCustomer')}
      size="md"
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <Input
          label={`${t('customers.firstName')} *`}
          {...register('name')}
          error={errors.name?.message}
          placeholder={t('customers.firstName')}
        />

        <Input
          label={t('customers.email')}
          type="email"
          {...register('email')}
          error={errors.email?.message}
          placeholder={t('customers.email')}
        />

        <Input
          label={t('customers.phone')}
          type="tel"
          {...register('phone')}
          error={errors.phone?.message}
          placeholder="+905551234567"
        />

        <Input
          label={t('customers.birthday', 'Birthday')}
          type="date"
          {...register('birthday')}
          error={errors.birthday?.message}
        />

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            {t('customers.tags')}
          </label>
          <div className="flex gap-2 mb-2">
            <input
              type="text"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={handleKeyDown}
              className="flex-1 px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder={t('customers.tagsPlaceholder')}
            />
            <Button type="button" size="sm" onClick={handleAddTag}>
              +
            </Button>
          </div>
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-blue-100 text-blue-800 rounded"
                >
                  {tag}
                  <button
                    type="button"
                    onClick={() => handleRemoveTag(tag)}
                    className="text-blue-600 hover:text-blue-800"
                  >
                    &times;
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            {t('customers.notes')}
          </label>
          <textarea
            {...register('notes')}
            rows={3}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            placeholder={t('customers.notes')}
          />
        </div>

        <div className="flex justify-end gap-3 pt-4 border-t">
          <Button type="button" variant="outline" onClick={onClose} disabled={isLoading}>
            {t('app:app.cancel')}
          </Button>
          <Button type="submit" disabled={isLoading}>
            {isLoading
              ? t('app:app.loading')
              : isEditMode
              ? t('app:app.save')
              : t('customers.addCustomer')}
          </Button>
        </div>
      </form>
    </Modal>
  );
};

export default CustomerFormModal;
