import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PasswordStrength } from './PasswordStrength';

describe('PasswordStrength', () => {
  it('renders nothing for an empty password', () => {
    const { container } = render(<PasswordStrength password="" />);
    expect(container.firstChild).toBeNull();
  });

  it('shows a Weak label for a single passing requirement', () => {
    render(<PasswordStrength password="abc" />);
    // lowercase only passes -> 1 requirement -> Weak
    expect(screen.getByText('Weak')).toBeInTheDocument();
  });

  it('shows a Strong label when all requirements pass', () => {
    render(<PasswordStrength password="Abcdef1!" />);
    expect(screen.getByText('Strong')).toBeInTheDocument();
  });

  it('renders the requirements checklist by default', () => {
    render(<PasswordStrength password="abc" />);
    expect(screen.getByText('At least 8 characters')).toBeInTheDocument();
    expect(screen.getByText('One uppercase letter')).toBeInTheDocument();
  });

  it('hides the requirements checklist when showRequirements is false', () => {
    render(<PasswordStrength password="abc" showRequirements={false} />);
    expect(
      screen.queryByText('At least 8 characters'),
    ).not.toBeInTheDocument();
  });
});
