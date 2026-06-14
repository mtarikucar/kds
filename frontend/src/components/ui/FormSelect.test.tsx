import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FormSelect } from './FormSelect';

const options = [
  { value: 'a', label: 'Option A' },
  { value: 'b', label: 'Option B' },
];

describe('FormSelect', () => {
  it('renders all the option labels', () => {
    render(<FormSelect label="Choice" options={options} />);
    expect(
      screen.getByRole('option', { name: 'Option A' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('option', { name: 'Option B' }),
    ).toBeInTheDocument();
  });

  it('renders a disabled placeholder option', () => {
    render(
      <FormSelect options={options} placeholder="Pick one" label="Choice" />,
    );
    const placeholder = screen.getByRole('option', {
      name: 'Pick one',
    }) as HTMLOptionElement;
    expect(placeholder.disabled).toBe(true);
  });

  it('fires onChange with the selected value', async () => {
    const onChange = vi.fn();
    render(<FormSelect label="Choice" options={options} onChange={onChange} />);
    await userEvent.selectOptions(screen.getByRole('combobox'), 'b');
    expect(onChange).toHaveBeenCalled();
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('b');
  });

  it('renders an error and hides the hint', () => {
    render(
      <FormSelect
        label="Choice"
        options={options}
        hint="some hint"
        error="bad choice"
      />,
    );
    expect(screen.getByText('bad choice')).toBeInTheDocument();
    expect(screen.queryByText('some hint')).not.toBeInTheDocument();
  });
});
