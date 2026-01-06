import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { useCreateContactMessage } from '../../features/contact';
import Input from '../ui/Input';
import Button from '../ui/Button';
import { useState } from 'react';
import { isValidPhone } from '../../utils/validation';

export const ContactForm = () => {
  const { t } = useTranslation('common');
  const [submitted, setSubmitted] = useState(false);
  const createMessage = useCreateContactMessage();

  const contactSchema = z.object({
    name: z.string().min(2, t('validation.nameMin')).max(100),
    email: z.string().email(t('validation.invalidEmail')),
    phone: z.string()
      .optional()
      .refine(
        (val) => !val || isValidPhone(val),
        { message: t('validation.invalidPhone') }
      )
      .or(z.literal('')),
    message: z.string().min(10, t('validation.messageMin')).max(5000),
  });

  type ContactFormData = z.infer<typeof contactSchema>;

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
  } = useForm<ContactFormData>({
    resolver: zodResolver(contactSchema),
  });

  const onSubmit = async (data: ContactFormData) => {
    try {
      await createMessage.mutateAsync(data);
      setSubmitted(true);
      reset();
      setTimeout(() => setSubmitted(false), 5000);
    } catch (error) {
      console.error('Failed to send message:', error);
    }
  };

  return (
    <section id="contact" className="py-24 px-4 sm:px-6 lg:px-8 bg-gradient-to-br from-warm-beige via-warm-cream to-warm-tan relative overflow-hidden">
      {/* Decorative background elements */}
      <div className="absolute top-0 right-0 w-96 h-96 bg-warm-orange/15 rounded-full blur-[120px]" />
      <div className="absolute bottom-0 left-0 w-96 h-96 bg-primary-200/20 rounded-full blur-[120px]" />

      <div className="max-w-4xl mx-auto relative z-10">
        {/* Section Header */}
        <div className="text-center mb-12">
          <h2 className="text-4xl md:text-5xl font-heading font-bold text-warm-dark mb-4">
            {t('landing.getInTouch')}
          </h2>
          <p className="text-xl text-warm-brown/70">
            {t('landing.contactDescription')}
          </p>
        </div>

        {/* Contact Form */}
        <div className="bg-white/80 backdrop-blur-sm p-8 md:p-10 rounded-3xl border-2 border-warm-orange/20 shadow-2xl shadow-warm-orange/10">
          {submitted && (
            <div className="mb-6 p-4 bg-green-50 border-2 border-green-300 text-green-800 rounded-2xl font-semibold">
              {t('landing.thankYouMessage')}
            </div>
          )}

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label htmlFor="name" className="block text-sm font-semibold text-warm-dark mb-2">
                  {t('landing.name')} *
                </label>
                <Input
                  id="name"
                  {...register('name')}
                  placeholder={t('landing.namePlaceholder')}
                  className={errors.name ? 'border-red-500' : 'border-warm-orange/30 focus:border-warm-orange focus:ring-warm-orange'}
                />
                {errors.name && (
                  <p className="mt-1 text-sm text-red-600 font-medium">{errors.name.message}</p>
                )}
              </div>

              <div>
                <label htmlFor="email" className="block text-sm font-semibold text-warm-dark mb-2">
                  {t('landing.email')} *
                </label>
                <Input
                  id="email"
                  type="email"
                  {...register('email')}
                  placeholder={t('landing.emailPlaceholder')}
                  className={errors.email ? 'border-red-500' : 'border-warm-orange/30 focus:border-warm-orange focus:ring-warm-orange'}
                />
                {errors.email && (
                  <p className="mt-1 text-sm text-red-600 font-medium">{errors.email.message}</p>
                )}
              </div>
            </div>

            <div>
              <label htmlFor="phone" className="block text-sm font-semibold text-warm-dark mb-2">
                {t('landing.phone')} <span className="text-warm-brown/60 font-normal">({t('landing.optional')})</span>
              </label>
              <Input
                id="phone"
                type="tel"
                {...register('phone')}
                placeholder={t('landing.phonePlaceholder')}
                className={errors.phone ? 'border-red-500' : 'border-warm-orange/30 focus:border-warm-orange focus:ring-warm-orange'}
              />
              {errors.phone && (
                <p className="mt-1 text-sm text-red-600 font-medium">{errors.phone.message}</p>
              )}
            </div>

            <div>
              <label htmlFor="message" className="block text-sm font-semibold text-warm-dark mb-2">
                {t('landing.message')} *
              </label>
              <textarea
                id="message"
                {...register('message')}
                rows={6}
                placeholder={t('landing.messagePlaceholder')}
                className={`w-full px-4 py-3 border-2 rounded-2xl focus:outline-none focus:ring-2 focus:ring-warm-orange/50 transition-all ${
                  errors.message ? 'border-red-500' : 'border-warm-orange/30 focus:border-warm-orange'
                }`}
              />
              {errors.message && (
                <p className="mt-1 text-sm text-red-600 font-medium">{errors.message.message}</p>
              )}
            </div>

            <Button
              type="submit"
              variant="primary"
              size="lg"
              className="w-full bg-warm-orange hover:bg-warm-orange/90 text-white font-bold shadow-xl shadow-warm-orange/30 hover:shadow-2xl hover:shadow-warm-orange/40 transition-all rounded-2xl"
              disabled={createMessage.isPending}
            >
              {createMessage.isPending ? t('landing.sending') : t('landing.sendMessage')}
            </Button>
          </form>
        </div>

        {/* Contact Info */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mt-12">
          <div className="text-center bg-white/70 backdrop-blur-sm p-6 rounded-3xl border-2 border-warm-orange/20 hover:border-warm-orange/40 hover:shadow-lg transition-all">
            <div className="w-14 h-14 bg-gradient-to-br from-warm-orange to-warm-brown text-white rounded-full flex items-center justify-center mx-auto mb-4 shadow-lg">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
            <h4 className="font-bold text-warm-dark mb-2">{t('landing.emailLabel')}</h4>
            <p className="text-warm-brown/70">
              <a href="mailto:contact@hummytummy.com" className="hover:text-warm-orange transition-colors font-medium">
                contact@hummytummy.com
              </a>
            </p>
          </div>

          <div className="text-center bg-white/70 backdrop-blur-sm p-6 rounded-3xl border-2 border-warm-orange/20 hover:border-warm-orange/40 hover:shadow-lg transition-all">
            <div className="w-14 h-14 bg-gradient-to-br from-warm-orange to-warm-brown text-white rounded-full flex items-center justify-center mx-auto mb-4 shadow-lg">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a1.994 1.994 0 01-1.414-.586m0 0L11 14h4a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2v4l.586-.586z" />
              </svg>
            </div>
            <h4 className="font-bold text-warm-dark mb-2">{t('landing.liveChat')}</h4>
            <p className="text-warm-brown/70 font-medium">{t('landing.chatWithUs')}</p>
          </div>

          <div className="text-center bg-white/70 backdrop-blur-sm p-6 rounded-3xl border-2 border-warm-orange/20 hover:border-warm-orange/40 hover:shadow-lg transition-all">
            <div className="w-14 h-14 bg-gradient-to-br from-warm-orange to-warm-brown text-white rounded-full flex items-center justify-center mx-auto mb-4 shadow-lg">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h4 className="font-bold text-warm-dark mb-2">{t('landing.supportHours')}</h4>
            <p className="text-warm-brown/70 font-medium">{t('landing.available24_7')}</p>
          </div>
        </div>
      </div>
    </section>
  );
};
