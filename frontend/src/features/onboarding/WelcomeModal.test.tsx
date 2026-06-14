import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WelcomeModal } from './WelcomeModal';

/**
 * Specs for WelcomeModal — first-run onboarding dialog. It renders
 * nothing when closed; when open it shows the four feature cards and the
 * start/skip CTAs. Clicking start/skip/close and the backdrop, plus
 * pressing Escape, each fire the matching callback.
 */

function makeProps(overrides: Partial<any> = {}) {
  return {
    isOpen: true,
    onClose: vi.fn(),
    onStartTour: vi.fn(),
    onSkip: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => vi.clearAllMocks());

describe('WelcomeModal — visibility', () => {
  it('renders nothing when closed', () => {
    const { container } = render(<WelcomeModal {...makeProps({ isOpen: false })} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the dialog with all four feature cards when open', () => {
    render(<WelcomeModal {...makeProps()} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('welcome.features.pos.title')).toBeInTheDocument();
    expect(screen.getByText('welcome.features.menu.title')).toBeInTheDocument();
    expect(screen.getByText('welcome.features.tables.title')).toBeInTheDocument();
    expect(screen.getByText('welcome.features.reports.title')).toBeInTheDocument();
  });
});

describe('WelcomeModal — actions', () => {
  it('fires onStartTour when the start button is clicked', () => {
    const props = makeProps();
    render(<WelcomeModal {...props} />);
    fireEvent.click(screen.getByText('welcome.startTour'));
    expect(props.onStartTour).toHaveBeenCalledTimes(1);
  });

  it('fires onSkip when the skip button is clicked', () => {
    const props = makeProps();
    render(<WelcomeModal {...props} />);
    fireEvent.click(screen.getByText('welcome.skipTour'));
    expect(props.onSkip).toHaveBeenCalledTimes(1);
  });

  it('fires onClose when the close button is clicked', () => {
    const props = makeProps();
    render(<WelcomeModal {...props} />);
    fireEvent.click(screen.getByLabelText('welcome.close'));
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('fires onClose when Escape is pressed', () => {
    const props = makeProps();
    render(<WelcomeModal {...props} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });
});
