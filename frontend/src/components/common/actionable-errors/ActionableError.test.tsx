import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { ActionableErrorProvider, useActionableError } from './ActionableErrorProvider';

const { patch } = vi.hoisted(() => ({ patch: vi.fn() }));
vi.mock('../../../lib/api', () => ({ default: { patch }, api: { patch } }));

function phoneError() {
  return { isAxiosError: true, response: { data: { errorCode: 'PROFILE_PHONE_REQUIRED' } } };
}

// A tiny consumer that fires handleApiError on click and records resume() calls.
function Consumer({ err, onResume }: { err: unknown; onResume: () => void }) {
  const { handleApiError } = useActionableError();
  return (
    <button onClick={() => handleApiError(err, onResume)}>trigger</button>
  );
}

function renderWithProvider(err: unknown, onResume: () => void) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ActionableErrorProvider>
        <Consumer err={err} onResume={onResume} />
      </ActionableErrorProvider>
    </QueryClientProvider>,
  );
}

describe('ActionableError inline-fix flow', () => {
  beforeEach(() => patch.mockReset());

  it('opens the inline phone prompt for PROFILE_PHONE_REQUIRED, saves, and resumes the original action', async () => {
    patch.mockResolvedValue({ data: {} });
    const onResume = vi.fn();
    renderWithProvider(phoneError(), onResume);

    // No prompt until the error is handled.
    expect(screen.queryByPlaceholderText('+90 555 123 45 67')).toBeNull();

    fireEvent.click(screen.getByText('trigger'));

    const input = await screen.findByPlaceholderText('+90 555 123 45 67');
    fireEvent.change(input, { target: { value: '+90 555 123 45 67' } });
    fireEvent.click(screen.getByRole('button', { name: /Save & continue/i }));

    await waitFor(() => expect(patch).toHaveBeenCalledWith('/users/me/profile', { phone: '+90 555 123 45 67' }));
    await waitFor(() => expect(onResume).toHaveBeenCalledTimes(1));
    // Prompt closes after resume.
    await waitFor(() => expect(screen.queryByPlaceholderText('+90 555 123 45 67')).toBeNull());
  });

  it('blocks save + does not call the API on an obviously invalid phone', async () => {
    const onResume = vi.fn();
    renderWithProvider(phoneError(), onResume);
    fireEvent.click(screen.getByText('trigger'));

    const input = await screen.findByPlaceholderText('+90 555 123 45 67');
    fireEvent.change(input, { target: { value: '123' } });
    fireEvent.click(screen.getByRole('button', { name: /Save & continue/i }));

    expect(patch).not.toHaveBeenCalled();
    expect(onResume).not.toHaveBeenCalled();
    // still open
    expect(screen.getByPlaceholderText('+90 555 123 45 67')).toBeInTheDocument();
  });

  it('returns false (no prompt) for an error without a known actionable code', () => {
    const onResume = vi.fn();
    const handled: boolean[] = [];
    function Probe() {
      const { handleApiError } = useActionableError();
      return (
        <button
          onClick={() =>
            handled.push(
              handleApiError({ isAxiosError: true, response: { data: { errorCode: 'NOPE' } } }, onResume),
            )
          }
        >
          go
        </button>
      );
    }
    const client = new QueryClient();
    render(
      <QueryClientProvider client={client}>
        <ActionableErrorProvider>
          <Probe />
        </ActionableErrorProvider>
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByText('go'));
    expect(handled).toEqual([false]);
    expect(screen.queryByPlaceholderText('+90 555 123 45 67')).toBeNull();
  });
});
