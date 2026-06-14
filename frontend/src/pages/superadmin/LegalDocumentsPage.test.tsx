import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import LegalDocumentsPage from './LegalDocumentsPage';

const publishAsync = vi.fn().mockResolvedValue({});
let docsData: any;

vi.mock('../../features/legal/legalApi', () => ({
  useListLegalDocuments: () => ({ data: docsData, isLoading: false }),
  usePublishLegalDocument: () => ({ mutateAsync: publishAsync, isPending: false }),
}));

// ReactMarkdown is ESM-heavy; stub it to a passthrough so the modal renders.
vi.mock('react-markdown', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, arg?: any) => {
      if (typeof arg === 'string') return arg;
      if (arg && typeof arg === 'object' && Object.keys(arg).length) {
        return `${key}::${Object.values(arg).join(',')}`;
      }
      return key;
    },
  }),
}));

function doc(over: Partial<any> = {}) {
  return {
    id: 'd1',
    kind: 'KVKK',
    version: '1.0',
    locale: 'tr',
    title: 'KVKK v1',
    bodyMarkdown: '# Hello',
    effectiveAt: '2026-01-01T00:00:00.000Z',
    isCurrent: true,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    ...over,
  };
}

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <LegalDocumentsPage />
    </QueryClientProvider>,
  );
}

// Locate a labelled field inside the publish modal via its label span wrapper.
function field(labelKey: string) {
  const span = screen.getByText(labelKey);
  const wrap = span.closest('label') as HTMLElement;
  return within(wrap);
}

function openModalAndFillBody() {
  renderPage();
  fireEvent.click(screen.getByRole('button', { name: 'legal.publishNewVersion' }));
  // title
  fireEvent.change(field('legal.modal.title').getByRole('textbox'), { target: { value: 'KVKK v2' } });
  // body markdown is a standalone textarea, not in a <label> wrapper
  const body = screen.getByPlaceholderText('legal.modal.contentPlaceholder');
  fireEvent.change(body, { target: { value: 'Some content' } });
}

describe('LegalDocumentsPage — listing', () => {
  beforeEach(() => {
    publishAsync.mockClear();
    docsData = [doc()];
  });
  afterEach(() => vi.restoreAllMocks());

  it('groups docs by kind and renders the version + active badge', () => {
    renderPage();
    expect(screen.getByText('1.0')).toBeInTheDocument();
    expect(screen.getByText('legal.active')).toBeInTheDocument();
  });

  it('renders the empty-state when there are no documents', () => {
    docsData = [];
    renderPage();
    expect(screen.getByText('legal.empty')).toBeInTheDocument();
  });
});

describe('LegalDocumentsPage — PublishModal version-regex gate', () => {
  beforeEach(() => {
    publishAsync.mockClear();
    docsData = [];
  });
  afterEach(() => vi.restoreAllMocks());

  it('keeps Publish disabled while the version is missing', () => {
    openModalAndFillBody();
    const publishBtn = screen.getByRole('button', { name: 'legal.modal.publish' });
    expect(publishBtn).toBeDisabled();
  });

  it('keeps Publish disabled for a non-semver version like "v1"', () => {
    openModalAndFillBody();
    fireEvent.change(field('legal.modal.version').getByRole('textbox'), { target: { value: 'v1' } });
    expect(screen.getByRole('button', { name: 'legal.modal.publish' })).toBeDisabled();
  });

  it('enables Publish for a valid N.N version and submits the full form', async () => {
    openModalAndFillBody();
    fireEvent.change(field('legal.modal.version').getByRole('textbox'), { target: { value: '1.1' } });
    const publishBtn = screen.getByRole('button', { name: 'legal.modal.publish' });
    expect(publishBtn).not.toBeDisabled();

    fireEvent.click(publishBtn);
    await vi.waitFor(() => expect(publishAsync).toHaveBeenCalledTimes(1));
    expect(publishAsync.mock.calls[0][0]).toMatchObject({
      kind: 'KVKK',
      version: '1.1',
      locale: 'tr',
      title: 'KVKK v2',
      bodyMarkdown: 'Some content',
    });
  });

  it('also accepts a three-part N.N.N version', () => {
    openModalAndFillBody();
    fireEvent.change(field('legal.modal.version').getByRole('textbox'), { target: { value: '2.0.3' } });
    expect(screen.getByRole('button', { name: 'legal.modal.publish' })).not.toBeDisabled();
  });

  it('stays disabled when the body is blank even with a valid version', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'legal.publishNewVersion' }));
    fireEvent.change(field('legal.modal.title').getByRole('textbox'), { target: { value: 'KVKK v2' } });
    fireEvent.change(field('legal.modal.version').getByRole('textbox'), { target: { value: '1.1' } });
    // body left empty
    expect(screen.getByRole('button', { name: 'legal.modal.publish' })).toBeDisabled();
  });
});
