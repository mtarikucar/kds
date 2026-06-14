import { describe, expect, it } from 'vitest';
import { LegalDocument } from '../../features/legal/legalApi';
import { canSubmitPublish, groupDocsByKind } from './legalDocuments.helpers';

const doc = (over: Partial<LegalDocument>): LegalDocument =>
  ({
    id: 'id',
    kind: 'KVKK',
    version: '1.0',
    locale: 'tr',
    title: 'T',
    bodyMarkdown: 'B',
    effectiveAt: '2026-01-01',
    isCurrent: true,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    ...over,
  }) as LegalDocument;

describe('groupDocsByKind', () => {
  it('returns an empty object for undefined or empty input', () => {
    expect(groupDocsByKind(undefined)).toEqual({});
    expect(groupDocsByKind([])).toEqual({});
  });

  it('groups documents by kind, preserving insertion order within a group', () => {
    const a = doc({ id: 'a', kind: 'KVKK', version: '1.0' });
    const b = doc({ id: 'b', kind: 'KVKK', version: '1.1' });
    const c = doc({ id: 'c', kind: 'PRIVACY_POLICY', version: '2.0' });

    const grouped = groupDocsByKind([a, b, c]);

    expect(Object.keys(grouped).sort()).toEqual(['KVKK', 'PRIVACY_POLICY']);
    expect(grouped.KVKK.map((d) => d.id)).toEqual(['a', 'b']);
    expect(grouped.PRIVACY_POLICY.map((d) => d.id)).toEqual(['c']);
  });
});

describe('canSubmitPublish', () => {
  const valid = { version: '1.0', title: 'Title', bodyMarkdown: 'Body' };

  it('is truthy when version matches N.N, with non-empty title and body', () => {
    expect(canSubmitPublish(valid)).toBeTruthy();
    expect(canSubmitPublish({ ...valid, version: '1.2.3' })).toBeTruthy();
  });

  it('is falsy (null) when the version regex fails', () => {
    expect(canSubmitPublish({ ...valid, version: '1' })).toBeFalsy();
    expect(canSubmitPublish({ ...valid, version: 'v1.0' })).toBeFalsy();
    expect(canSubmitPublish({ ...valid, version: '1.0.0.0' })).toBeFalsy();
    expect(canSubmitPublish({ ...valid, version: '' })).toBeFalsy();
  });

  it('is falsy when title is empty after trimming', () => {
    expect(canSubmitPublish({ ...valid, title: '   ' })).toBe(false);
  });

  it('is falsy when body is empty after trimming', () => {
    expect(canSubmitPublish({ ...valid, bodyMarkdown: '   ' })).toBe(false);
  });
});
