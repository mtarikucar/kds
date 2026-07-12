import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryStateGate } from './QueryStateGate';

const ok = { isLoading: false, isError: false, refetch: vi.fn() };

describe('QueryStateGate', () => {
  it('renders children when the query settled successfully', () => {
    render(
      <QueryStateGate query={ok}>
        <div>CONTENT</div>
      </QueryStateGate>,
    );
    expect(screen.getByText('CONTENT')).toBeInTheDocument();
  });

  it('renders the default spinner while loading', () => {
    const { container } = render(
      <QueryStateGate query={{ ...ok, isLoading: true }}>
        <div>CONTENT</div>
      </QueryStateGate>,
    );
    expect(screen.queryByText('CONTENT')).not.toBeInTheDocument();
    expect(container.querySelector('svg.animate-spin')).toBeInTheDocument();
  });

  it('renders a custom loading node when provided', () => {
    render(
      <QueryStateGate query={{ ...ok, isLoading: true }} loading={<p>Bekleyin</p>}>
        <div>CONTENT</div>
      </QueryStateGate>,
    );
    expect(screen.getByText('Bekleyin')).toBeInTheDocument();
  });

  it('renders the error state with a retry button wired to refetch', () => {
    const refetch = vi.fn();
    render(
      <QueryStateGate query={{ isLoading: false, isError: true, refetch }}>
        <div>CONTENT</div>
      </QueryStateGate>,
    );
    expect(screen.queryByText('CONTENT')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button'));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('retries only the failed queries when several are gated together', () => {
    const failedRefetch = vi.fn();
    const okRefetch = vi.fn();
    render(
      <QueryStateGate
        query={[
          { isLoading: false, isError: false, refetch: okRefetch },
          { isLoading: false, isError: true, refetch: failedRefetch },
        ]}
      >
        <div>CONTENT</div>
      </QueryStateGate>,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(failedRefetch).toHaveBeenCalledTimes(1);
    expect(okRefetch).not.toHaveBeenCalled();
  });

  it('omits the retry button when no failed query exposes refetch', () => {
    render(
      <QueryStateGate query={{ isLoading: false, isError: true }}>
        <div>CONTENT</div>
      </QueryStateGate>,
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('shows the loading state while any of several queries is still loading', () => {
    render(
      <QueryStateGate query={[ok, { ...ok, isLoading: true }]} loading={<p>WAIT</p>}>
        <div>CONTENT</div>
      </QueryStateGate>,
    );
    expect(screen.getByText('WAIT')).toBeInTheDocument();
  });

  it('renders the empty node when isEmpty is set after a clean load', () => {
    render(
      <QueryStateGate query={ok} isEmpty empty={<p>EMPTY</p>}>
        <div>CONTENT</div>
      </QueryStateGate>,
    );
    expect(screen.getByText('EMPTY')).toBeInTheDocument();
    expect(screen.queryByText('CONTENT')).not.toBeInTheDocument();
  });

  it('renders children when isEmpty is set but no empty node is given', () => {
    render(
      <QueryStateGate query={ok} isEmpty>
        <div>CONTENT</div>
      </QueryStateGate>,
    );
    expect(screen.getByText('CONTENT')).toBeInTheDocument();
  });
});
