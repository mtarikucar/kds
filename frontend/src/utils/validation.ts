import { z } from 'zod';

// E.164 international phone format regex
// Allows: +905551234567, 905551234567, 5551234567
// Min 7 digits, max 15 digits (E.164 standard)
export const phoneRegex = /^\+?[1-9]\d{6,14}$/;

/**
 * Validates a phone number string
 * Removes spaces, dashes, and parentheses before validation
 */
export const isValidPhone = (phone: string): boolean => {
  if (!phone) return true; // Empty is valid for optional fields
  const cleaned = phone.replace(/[\s\-()]/g, '');
  return phoneRegex.test(cleaned);
};

/**
 * Creates a Zod phone validation schema (optional)
 * @param errorMessage - Custom error message for invalid phone
 */
export const phoneValidation = (errorMessage: string = 'Please enter a valid phone number') =>
  z.string()
    .optional()
    .refine(
      (val) => !val || isValidPhone(val),
      { message: errorMessage }
    );

/**
 * Creates a Zod phone validation schema (required)
 * @param errorMessage - Custom error message for invalid phone
 */
export const phoneValidationRequired = (errorMessage: string = 'Please enter a valid phone number') =>
  z.string()
    .min(1, errorMessage)
    .refine(
      (val) => isValidPhone(val),
      { message: errorMessage }
    );
