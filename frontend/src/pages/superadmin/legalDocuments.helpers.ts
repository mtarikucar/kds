// Pure helpers extracted (verbatim) from LegalDocumentsPage so they can be
// unit-tested in isolation. The component re-imports them at the original
// call sites, so runtime behavior is byte-identical.
import { LegalDocument } from '../../features/legal/legalApi';

// Group every (kind, version, locale) document row by its `kind`, preserving
// insertion order within each group. Mirrors the LegalDocumentsPage useMemo.
export function groupDocsByKind(
  docs: LegalDocument[] | undefined,
): Record<string, LegalDocument[]> {
  const acc: Record<string, LegalDocument[]> = {};
  for (const d of docs ?? []) {
    (acc[d.kind] ??= []).push(d);
  }
  return acc;
}

// PublishModal submit-gate: version must match semver-ish `N.N` or `N.N.N`,
// and title + body must be non-empty after trimming. Returns a truthy value
// (the RegExpMatchArray) when valid, falsy (null / false) when not — matching
// the original `&&`-chained expression byte-for-byte.
export function canSubmitPublish(form: {
  version: string;
  title: string;
  bodyMarkdown: string;
}): RegExpMatchArray | null | boolean {
  return (
    form.version.match(/^\d+\.\d+(\.\d+)?$/) &&
    form.title.trim().length > 0 &&
    form.bodyMarkdown.trim().length > 0
  );
}
