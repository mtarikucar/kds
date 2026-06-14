import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * Specs for MascotButton — the navbar help launcher. It reads
 * startTour/hasCompletedTour from the onboarding context; clicking the
 * avatar toggles a menu, the "restart tour" item closes the menu AND
 * fires startTour(), and Escape closes the menu. We mock the context so
 * we can assert the startTour mutation fires.
 */

const startTour = vi.fn();
let hasCompletedTour = false;
vi.mock('./OnboardingProvider', () => ({
  useOnboardingContext: () => ({ startTour, hasCompletedTour }),
}));

import { MascotButton } from './MascotButton';

function renderButton() {
  return render(
    <MemoryRouter>
      <MascotButton />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  hasCompletedTour = false;
});

describe('MascotButton — menu toggle', () => {
  it('opens the menu on click and closes it on a second click', () => {
    renderButton();
    const trigger = screen.getByRole('button', { name: 'mascot.restartTour' });

    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.click(trigger);
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(trigger).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(trigger);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes the menu when Escape is pressed', () => {
    renderButton();
    fireEvent.click(screen.getByRole('button', { name: 'mascot.restartTour' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

describe('MascotButton — restart tour', () => {
  it('fires startTour() and closes the menu when the restart item is clicked', () => {
    renderButton();
    fireEvent.click(screen.getByRole('button', { name: 'mascot.restartTour' }));

    const restartItem = screen.getByRole('menuitem', { name: /mascot\.restartTour/ });
    fireEvent.click(restartItem);

    expect(startTour).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
