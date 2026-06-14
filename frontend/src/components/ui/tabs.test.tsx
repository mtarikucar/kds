import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './tabs';

function Harness({
  value,
  onValueChange,
}: {
  value?: string;
  onValueChange?: (v: string) => void;
}) {
  return (
    <Tabs defaultValue="one" value={value} onValueChange={onValueChange}>
      <TabsList>
        <TabsTrigger value="one">One</TabsTrigger>
        <TabsTrigger value="two">Two</TabsTrigger>
      </TabsList>
      <TabsContent value="one">First panel</TabsContent>
      <TabsContent value="two">Second panel</TabsContent>
    </Tabs>
  );
}

describe('Tabs', () => {
  it('shows only the active panel (uncontrolled)', () => {
    render(<Harness />);
    expect(screen.getByText('First panel')).toBeInTheDocument();
    expect(screen.queryByText('Second panel')).not.toBeInTheDocument();
  });

  it('switches the active panel on trigger click (uncontrolled)', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('tab', { name: 'Two' }));
    expect(screen.getByText('Second panel')).toBeInTheDocument();
    expect(screen.queryByText('First panel')).not.toBeInTheDocument();
  });

  it('marks the active trigger as selected', async () => {
    render(<Harness />);
    expect(screen.getByRole('tab', { name: 'One' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await userEvent.click(screen.getByRole('tab', { name: 'Two' }));
    expect(screen.getByRole('tab', { name: 'Two' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('respects controlled value and reports changes', async () => {
    const onValueChange = vi.fn();
    render(<Harness value="one" onValueChange={onValueChange} />);
    await userEvent.click(screen.getByRole('tab', { name: 'Two' }));
    // Controlled: parent owns the value, so panel does not switch by itself.
    expect(screen.getByText('First panel')).toBeInTheDocument();
    expect(onValueChange).toHaveBeenCalledWith('two');
  });

  it('throws when a trigger is used outside Tabs', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<TabsTrigger value="x">orphan</TabsTrigger>)).toThrow();
    spy.mockRestore();
  });
});
