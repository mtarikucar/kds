import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { LegalDocument } from '../../features/legal/legalApi';

// Mock the data hook so we can drive the three render branches (loading /
// error / loaded) and assert the version + locale-formatted effective date.
const getDoc = vi.fn();
vi.mock('../../features/legal/legalApi', () => ({
  useGetCurrentLegalDocument: (...args: unknown[]) => getDoc(...args),
}));

// react-markdown is ESM-heavy; stub it to a passthrough so we can assert the
// body text rendered without pulling the real parser into jsdom.
vi.mock('react-markdown', () => ({
  default: ({ children }: { children: string }) => <div>{children}</div>,
}));

import LegalDocumentPage from './LegalDocumentPage';

function renderPage() {
  return render(
    <MemoryRouter>
      <LegalDocumentPage kind="KVKK" />
    </MemoryRouter>,
  );
}

const doc: LegalDocument = {
  id: 'd1',
  kind: 'KVKK',
  version: '2.1.0',
  locale: 'tr',
  title: 'KVKK Aydınlatma Metni',
  bodyMarkdown: '## Body heading\nSome consent text.',
  effectiveAt: '2026-03-15T00:00:00.000Z',
  isCurrent: true,
  createdAt: '2026-03-01T00:00:00.000Z',
  updatedAt: '2026-03-01T00:00:00.000Z',
};

beforeEach(() => {
  getDoc.mockReset();
});

describe('LegalDocumentPage', () => {
  it('passes the kind and resolved locale through to the data hook', () => {
    getDoc.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    renderPage();
    // i18n test bootstrap runs in 'en'; the page coalesces to it.
    expect(getDoc).toHaveBeenCalledWith('KVKK', 'en');
  });

  it('renders the loading state and neither error nor body', () => {
    getDoc.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    renderPage();
    expect(screen.getByText('Yükleniyor...')).toBeInTheDocument();
    expect(screen.queryByText(/Belge yüklenemedi/)).not.toBeInTheDocument();
    expect(screen.queryByText('KVKK Aydınlatma Metni')).not.toBeInTheDocument();
  });

  it('renders the error message branch, not the document', () => {
    getDoc.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    renderPage();
    expect(screen.getByText(/Belge yüklenemedi/)).toBeInTheDocument();
    expect(screen.queryByText('KVKK Aydınlatma Metni')).not.toBeInTheDocument();
  });

  it('renders the loaded document: title, version, and markdown body', () => {
    getDoc.mockReturnValue({ data: doc, isLoading: false, isError: false });
    renderPage();
    expect(screen.getByRole('heading', { name: 'KVKK Aydınlatma Metni' })).toBeInTheDocument();
    // Version + effective-date metadata row.
    expect(screen.getByText(/2\.1\.0/)).toBeInTheDocument();
    // Markdown body passed through the stubbed renderer.
    expect(screen.getByText(/Some consent text/)).toBeInTheDocument();
  });

  it('formats the effective date with the active locale (long month, en)', () => {
    getDoc.mockReturnValue({ data: doc, isLoading: false, isError: false });
    renderPage();
    // 2026-03-15 in en -> "March 15, 2026".
    expect(screen.getByText(/March 15, 2026/)).toBeInTheDocument();
  });
});
