import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

/**
 * Spec for PublicReservationPage — a thin route wrapper that renders the
 * PublicReservationContainer (the wizard, tested in isolation under
 * features/reservations/public). We just assert the wrapper mounts the
 * container so the route boilerplate is covered.
 */

vi.mock('../../features/reservations/public/PublicReservationContainer', () => ({
  default: () => <div data-testid="reservation-container" />,
}));

import PublicReservationPage from './PublicReservationPage';

describe('PublicReservationPage', () => {
  it('renders the public reservation container', () => {
    render(<PublicReservationPage />);
    expect(screen.getByTestId('reservation-container')).toBeInTheDocument();
  });
});
