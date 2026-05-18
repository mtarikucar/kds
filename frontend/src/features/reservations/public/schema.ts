import { z } from 'zod';

/**
 * Public reservation wizard zod schemas. Each step's schema is also
 * the partial slice we pass to `form.trigger(['field'…])` to gate
 * step navigation. The combined `reservationFormSchema` is what RHF
 * validates at submit time.
 *
 * Cross-field "email or phone required" lives on step 4: it's the
 * only step where both fields are visible, so the .refine() can read
 * the just-typed values without reaching back into the parent form.
 */

const HHMM = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;
// E.164-ish: optional +, 8-15 digits. Mirrors the backend regex so a
// frontend-passable string is always backend-passable too.
const PHONE_REGEX = /^\+?[1-9]\d{7,14}$/;

export const step1Schema = z.object({
  date: z.string().min(1),
  guestCount: z.number().int().min(1).max(100),
});

export const step2Schema = z.object({
  startTime: z.string().regex(HHMM),
  endTime: z.string().regex(HHMM),
});

export const step3Schema = z.object({
  /** Empty string == "Any table" (server will assign on confirm). */
  tableId: z.string().optional().default(''),
});

export const step4Schema = z
  .object({
    customerName: z.string().trim().min(1).max(100),
    customerPhone: z
      .string()
      .trim()
      .optional()
      .refine((v) => !v || PHONE_REGEX.test(v), {
        message: 'invalidPhone',
      }),
    customerEmail: z
      .string()
      .trim()
      .optional()
      .refine((v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), {
        message: 'invalidEmail',
      }),
    notes: z.string().trim().max(500).optional(),
  })
  .refine((data) => Boolean(data.customerPhone) || Boolean(data.customerEmail), {
    // Surfaces on the `customerPhone` field — error label rendered
    // once next to the contact group ("email or phone required").
    path: ['customerPhone'],
    message: 'contactRequired',
  });

// step4 has a refinement, so merging needs to be done manually with
// .and() — preserves both the field shape and the refine() check.
export const reservationFormSchema = step1Schema
  .merge(step2Schema)
  .merge(step3Schema)
  .and(step4Schema);
