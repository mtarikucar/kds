import { describe, it, expect } from 'vitest';
import { print3dManifestCsv } from './print3dManifestCsv';

const job = {
  id: 'job-1',
  tenantId: 't-1',
  tenantName: 'Test Restoran',
  status: 'queued',
  partner: 'figurunica',
  partnerRef: null,
  itemCount: 2,
  totalCents: 160000,
  currency: 'TRY',
  note: null,
  createdAt: '2026-08-20T10:00:00.000Z',
  hwOrderId: 'hw-1',
  items: [
    {
      id: 'i1',
      productName: 'Adana Kebap',
      productImageUrl: '/img/a.jpg',
      model3dUrl: 'https://cdn/a.glb',
      position: 0,
      status: 'pending',
      opsNote: null,
    },
    {
      id: 'i2',
      productName: 'Künefe, "özel"',
      productImageUrl: null,
      model3dUrl: null,
      position: 1,
      status: 'pending',
      opsNote: null,
    },
  ],
} as any;

describe('print3dManifestCsv', () => {
  it('emits a header row plus one row per item', () => {
    const lines = print3dManifestCsv(job).trim().split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe('productName,productImageUrl,model3dUrl,qty');
    expect(lines[1]).toBe('"Adana Kebap","/img/a.jpg","https://cdn/a.glb",1');
  });

  it('escapes embedded quotes and commas so the manifest cannot shift columns', () => {
    const lines = print3dManifestCsv(job).trim().split('\n');
    expect(lines[2]).toBe('"Künefe, ""özel""","","",1');
  });

  it('emits only the header row when the job has no items', () => {
    const emptyJob = { ...job, items: [] };
    const output = print3dManifestCsv(emptyJob).trim();
    expect(output).toBe('productName,productImageUrl,model3dUrl,qty');
  });
});
