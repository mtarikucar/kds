'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

/**
 * v2.8.98 — public contact form. Mirrors backend ContactController DTO
 * shape (name, email, phone?, message, website honeypot). Validation
 * runs both client-side (instant feedback) and server-side (the
 * backend's class-validator pipeline is the security boundary, the
 * client form is convenience).
 *
 * Submission flow:
 *   1. The form posts to `/api/contact` on the landing's Next.js
 *      runtime so the backend's CORS allowlist doesn't have to
 *      include the landing origin (the route handler proxies).
 *   2. The Next.js handler forwards to `${NEXT_PUBLIC_API_URL}/api/contact`
 *      which is the public Throttle({3/hr}) endpoint already wired
 *      to backend's ContactService.
 *   3. The honeypot `website` field stays in the form (visually hidden);
 *      real users leave it blank, naive bots fill anything called
 *      "website".
 */
export default function ContactForm() {
  const t = useTranslations('contact.form');
  const [submitting, setSubmitting] = useState(false);
  const [outcome, setOutcome] = useState<'idle' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setOutcome('idle');
    setErrorMessage(null);
    const form = e.currentTarget;
    const data = new FormData(form);
    const payload = {
      name: (data.get('name') as string)?.trim() ?? '',
      email: (data.get('email') as string)?.trim() ?? '',
      phone: ((data.get('phone') as string) ?? '').trim() || undefined,
      message: ((data.get('message') as string) ?? '').trim(),
      // Honeypot: must stay empty.
      website: ((data.get('website') as string) ?? '').trim(),
    };

    if (payload.name.length < 2) {
      setErrorMessage(t('errors.nameTooShort'));
      setOutcome('error');
      setSubmitting(false);
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) {
      setErrorMessage(t('errors.emailInvalid'));
      setOutcome('error');
      setSubmitting(false);
      return;
    }
    if (payload.message.length < 10) {
      setErrorMessage(t('errors.messageTooShort'));
      setOutcome('error');
      setSubmitting(false);
      return;
    }

    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setErrorMessage((body?.message as string) ?? t('errors.generic'));
        setOutcome('error');
        setSubmitting(false);
        return;
      }
      setOutcome('success');
      form.reset();
    } catch {
      setErrorMessage(t('errors.network'));
      setOutcome('error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
      {/* Honeypot — hidden from real users via inline CSS; bots see it */}
      <div aria-hidden="true" className="hidden">
        <label>
          {t('honeypotLabel')}
          <input type="text" name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>

      <div>
        <label htmlFor="contact-name" className="mb-1 block text-sm font-medium text-slate-800">
          {t('fields.name')}
        </label>
        <input
          id="contact-name"
          name="name"
          type="text"
          required
          minLength={2}
          maxLength={100}
          autoComplete="name"
          className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
        />
      </div>

      <div>
        <label htmlFor="contact-email" className="mb-1 block text-sm font-medium text-slate-800">
          {t('fields.email')}
        </label>
        <input
          id="contact-email"
          name="email"
          type="email"
          required
          maxLength={254}
          autoComplete="email"
          className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
        />
      </div>

      <div>
        <label htmlFor="contact-phone" className="mb-1 block text-sm font-medium text-slate-800">
          {t('fields.phone')} <span className="text-slate-400">({t('fields.optional')})</span>
        </label>
        <input
          id="contact-phone"
          name="phone"
          type="tel"
          maxLength={20}
          autoComplete="tel"
          className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
        />
      </div>

      <div>
        <label htmlFor="contact-message" className="mb-1 block text-sm font-medium text-slate-800">
          {t('fields.message')}
        </label>
        <textarea
          id="contact-message"
          name="message"
          required
          minLength={10}
          maxLength={5000}
          rows={5}
          className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
        />
      </div>

      {outcome === 'error' && errorMessage && (
        <p role="alert" className="text-sm text-red-600">
          {errorMessage}
        </p>
      )}
      {outcome === 'success' && (
        <p role="status" className="text-sm text-emerald-600">
          {t('successMessage')}
        </p>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="inline-flex items-center justify-center rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:opacity-50"
      >
        {submitting ? t('submitting') : t('submit')}
      </button>
    </form>
  );
}
