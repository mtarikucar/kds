import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Banknote } from 'lucide-react';
import StatCard from './StatCard';

describe('StatCard', () => {
  it('renders title, value and positive trend with label', () => {
    render(
      <StatCard
        title="Bugünkü Ciro"
        value="₺12.450"
        icon={Banknote}
        color="bg-green-500"
        trend={{ value: 8, isPositive: true }}
        trendLabel="düne göre"
      />,
    );
    expect(screen.getByText('Bugünkü Ciro')).toBeInTheDocument();
    expect(screen.getByText('₺12.450')).toBeInTheDocument();
    expect(screen.getByText(/↑ %8 düne göre/)).toBeInTheDocument();
  });

  it('renders a negative trend in red', () => {
    render(
      <StatCard
        title="t"
        value={5}
        icon={Banknote}
        color="bg-blue-500"
        trend={{ value: 3, isPositive: false }}
        trendLabel="vs"
      />,
    );
    expect(screen.getByText(/↓ %3 vs/).className).toContain('text-red-600');
  });

  it('shows a skeleton instead of the value while loading', () => {
    render(<StatCard title="t" value="" icon={Banknote} color="bg-blue-500" isLoading />);
    expect(screen.getByTestId('skeleton')).toBeInTheDocument();
  });
});
