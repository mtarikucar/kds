import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AxiosError, AxiosHeaders } from 'axios';
import { describe, expect, it, vi } from 'vitest';
import { ErrorState } from './ErrorState';

function axiosErrorWithMessage(message: string): AxiosError {
  const headers = new AxiosHeaders();
  const config = { headers } as never;
  return new AxiosError('Request failed', 'ERR_BAD_REQUEST', config, {}, {
    data: { message },
    status: 400,
    statusText: 'Bad Request',
    headers,
    config,
  } as never);
}

describe('ErrorState', () => {
  it('is announced as an alert', () => {
    render(<ErrorState />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('shows the server-provided error message when available', () => {
    render(<ErrorState error={axiosErrorWithMessage('Branch is closed')} />);
    expect(screen.getByText('Branch is closed')).toBeInTheDocument();
  });

  it('falls back to the generic message for unknown errors', () => {
    render(<ErrorState error={new Error('boom')} />);
    // From common.json app.error, loaded by the test i18n setup.
    expect(screen.getByText('An error occurred')).toBeInTheDocument();
  });

  it('prefers an explicit message override', () => {
    render(
      <ErrorState error={axiosErrorWithMessage('server text')} message="Custom" />,
    );
    expect(screen.getByText('Custom')).toBeInTheDocument();
    expect(screen.queryByText('server text')).not.toBeInTheDocument();
  });

  it('wires the retry button', async () => {
    const onRetry = vi.fn();
    render(<ErrorState onRetry={onRetry} retryLabel="Reload" />);
    await userEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('renders no button without onRetry', () => {
    render(<ErrorState />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
