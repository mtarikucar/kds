import type { z } from 'zod';
import type { reservationFormSchema } from './schema';

export type ReservationFormValues = z.infer<typeof reservationFormSchema>;

/** Wizard step indices used by the container and the stepper UI. */
export type WizardStep = 1 | 2 | 3 | 4 | 5;
