import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Input } from './Input';

describe('Input', () => {
  it('associates a label with the input via htmlFor/id', () => {
    render(<Input label="Email" />);
    const input = screen.getByLabelText('Email');
    expect(input).toBeInTheDocument();
  });

  it('forwards typed input to onChange', async () => {
    const onChange = vi.fn();
    render(<Input label="Name" onChange={onChange} />);
    await userEvent.type(screen.getByLabelText('Name'), 'ab');
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('renders a hint when there is no error', () => {
    render(<Input label="Name" hint="Enter your full name" />);
    expect(screen.getByText('Enter your full name')).toBeInTheDocument();
  });

  it('renders an error and sets aria-invalid, hiding the hint', () => {
    render(<Input label="Name" hint="Hint text" error="Required" />);
    expect(screen.getByText('Required')).toBeInTheDocument();
    expect(screen.queryByText('Hint text')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
  });

  it('wires aria-describedby to the message element', () => {
    render(<Input label="Name" error="Bad" />);
    const input = screen.getByLabelText('Name');
    const describedBy = input.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(screen.getByText('Bad')).toHaveAttribute('id', describedBy!);
  });

  it('uses a caller-supplied id', () => {
    render(<Input id="custom" label="Name" />);
    expect(screen.getByLabelText('Name')).toHaveAttribute('id', 'custom');
  });
});
