/**
 * The ONE E.164 rule. This was written out 18 separate times across the DTOs
 * in TWO different variants — `/^\+[1-9]\d{6,14}$/` in ten places and
 * `/^\+?[1-9]\d{7,14}$/` in eight — so the same field accepted a bare
 * "905551234567" through some endpoints and rejected it through others.
 *
 * The strict variant wins. @NormalizePhone transforms before @Matches
 * validates, so everything reaching this regex is already E.164 out of
 * libphonenumber and always carries the '+'. The optional-'+' variant was
 * dead permissiveness. Import this; do not retype it.
 */
export const E164_PATTERN = /^\+[1-9]\d{6,14}$/;
export const E164_MESSAGE = "phone must be in E.164 format, e.g. +905551234567";
