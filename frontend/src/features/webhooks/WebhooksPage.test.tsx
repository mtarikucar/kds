import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import i18next from 'i18next';
import enWebhooks from '../../i18n/locales/en/webhooks.json';
import type { WebhookSubscription } from './webhooksApi';

// WebhooksPage owns: event toggle state, the create flow (mutateAsync ->
// one-time secret banner), the list with status pill + fail counter, and the
// revoke button. We mock the api hooks and register the `webhooks` namespace
// so assertions read the real English copy.

const listState: { data: WebhookSubscription[]; isLoading: boolean } = { data: [], isLoading: false };
const create = { mutateAsync: vi.fn(), isPending: false };
const revoke = { mutate: vi.fn() };

vi.mock('./webhooksApi', () => ({
  useListWebhooks: () => listState,
  useCreateWebhook: () => create,
  useRevokeWebhook: () => revoke,
}));

// sonner toasts touch the DOM portal; stub to keep the SecretReveal effect quiet.
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import WebhooksPage from './WebhooksPage';

beforeAll(() => {
  i18next.addResourceBundle('en', 'webhooks', enWebhooks, true, true);
});

function makeSub(over: Partial<WebhookSubscription> = {}): WebhookSubscription {
  return {
    id: 's-1',
    tenantId: 't-1',
    url: 'https://hook.example.com/in',
    events: ['order.created.v1'],
    status: 'active',
    lastDeliveryAt: null,
    lastDeliveryCode: null,
    consecutiveFailures: 0,
    createdAt: '2026-01-01T00:00:00Z',
    ...over,
  };
}

describe('WebhooksPage', () => {
  beforeEach(() => {
    listState.data = [];
    listState.isLoading = false;
    create.isPending = false;
    create.mutateAsync.mockReset();
    revoke.mutate.mockReset();
  });

  it('disables the submit button until a URL is entered', () => {
    render(<WebhooksPage />);
    const submit = screen.getByRole('button', { name: 'Create subscription' });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText(/your-server\.example\.com/), {
      target: { value: 'https://my.app/webhook' },
    });
    expect(submit).toBeEnabled();
  });

  it('toggles event chips on/off and posts the selected events on create', async () => {
    create.mutateAsync.mockResolvedValue(makeSub({ secret: undefined }));
    render(<WebhooksPage />);

    fireEvent.change(screen.getByPlaceholderText(/your-server\.example\.com/), {
      target: { value: 'https://my.app/webhook' },
    });

    // Two events are pre-selected by default (order.created.v1 + completed).
    // Turn OFF order.completed.v1 and turn ON payment.refund_completed.v1.
    fireEvent.click(screen.getByRole('button', { name: 'order.completed.v1' }));
    fireEvent.click(screen.getByRole('button', { name: 'payment.refund_completed.v1' }));

    fireEvent.click(screen.getByRole('button', { name: 'Create subscription' }));

    await waitFor(() => expect(create.mutateAsync).toHaveBeenCalledTimes(1));
    expect(create.mutateAsync).toHaveBeenCalledWith({
      url: 'https://my.app/webhook',
      events: ['order.created.v1', 'payment.refund_completed.v1'],
    });
  });

  it('reveals the one-time secret banner after a successful create', async () => {
    create.mutateAsync.mockResolvedValue(makeSub({ secret: 'whsec_TOPSECRET' }));
    render(<WebhooksPage />);

    fireEvent.change(screen.getByPlaceholderText(/your-server\.example\.com/), {
      target: { value: 'https://my.app/webhook' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create subscription' }));

    await waitFor(() => expect(screen.getByText('Subscription created.')).toBeInTheDocument());
    expect(screen.getByText('whsec_TOPSECRET')).toBeInTheDocument();

    // Dismiss ("I've saved it") removes the banner.
    fireEvent.click(screen.getByRole('button', { name: enWebhooks.secret.saved }));
    await waitFor(() => expect(screen.queryByText('whsec_TOPSECRET')).not.toBeInTheDocument());
  });

  it('does NOT reveal a banner when the create response carries no secret', async () => {
    create.mutateAsync.mockResolvedValue(makeSub({ secret: undefined }));
    render(<WebhooksPage />);
    fireEvent.change(screen.getByPlaceholderText(/your-server\.example\.com/), {
      target: { value: 'https://my.app/webhook' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create subscription' }));
    await waitFor(() => expect(create.mutateAsync).toHaveBeenCalled());
    expect(screen.queryByText('Subscription created.')).not.toBeInTheDocument();
  });

  it('renders the empty-list copy when there are no subscriptions', () => {
    listState.data = [];
    render(<WebhooksPage />);
    expect(screen.getByText('No subscriptions.')).toBeInTheDocument();
  });

  it('renders a subscription row with active pill and the failure counter', () => {
    listState.data = [
      makeSub({ url: 'https://a.example/in', status: 'active', consecutiveFailures: 3 }),
    ];
    render(<WebhooksPage />);

    expect(screen.getByText('https://a.example/in')).toBeInTheDocument();
    const pill = screen.getByText('active');
    expect(pill.className).toContain('bg-green-100');
    // failCount: "{{count}} fail"
    expect(screen.getByText('3 fail')).toBeInTheDocument();
  });

  it('paused subscriptions get the amber pill', () => {
    listState.data = [makeSub({ status: 'paused' })];
    render(<WebhooksPage />);
    const pill = screen.getByText('paused');
    expect(pill.className).toContain('bg-amber-100');
  });

  it('revokes the subscription whose row Revoke button is clicked', () => {
    listState.data = [makeSub({ id: 'sub-xyz' })];
    render(<WebhooksPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    expect(revoke.mutate).toHaveBeenCalledWith('sub-xyz');
  });
});
