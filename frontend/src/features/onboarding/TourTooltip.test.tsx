import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TourTooltip } from './TourTooltip';

/**
 * Specs for TourTooltip — the custom react-joyride render-prop tooltip.
 * It's a pure function of the joyride props: the skip button only shows
 * on non-last steps, back only after the first step, and the primary CTA
 * flips between Next and Finish on the last step. The joyride props carry
 * the click handlers we wire to the footer buttons. The onboarding i18n
 * namespace is unloaded, so labels resolve to their keys.
 */

function makeProps(overrides: Partial<any> = {}) {
  return {
    continuous: true,
    index: 1,
    size: 4,
    isLastStep: false,
    step: { title: 'Step title', content: 'Step content', target: 'body' },
    backProps: { onClick: vi.fn() },
    closeProps: { onClick: vi.fn() },
    primaryProps: { onClick: vi.fn() },
    skipProps: { onClick: vi.fn() },
    tooltipProps: {},
    ...overrides,
  } as any;
}

describe('TourTooltip — rendered content', () => {
  it('renders the step title, content and a progress bar fill', () => {
    const { container } = render(<TourTooltip {...makeProps()} />);
    expect(screen.getByText('Step title')).toBeInTheDocument();
    expect(screen.getByText('Step content')).toBeInTheDocument();
    // index 1 of 4 -> 50% progress.
    const bar = container.querySelector('.bg-blue-500') as HTMLElement;
    expect(bar.style.width).toBe('50%');
  });
});

describe('TourTooltip — conditional controls', () => {
  it('shows Skip + Back + Next on a middle step', () => {
    render(<TourTooltip {...makeProps({ index: 1, isLastStep: false })} />);
    expect(screen.getByText('tour.skip')).toBeInTheDocument();
    expect(screen.getByText('tour.back')).toBeInTheDocument();
    expect(screen.getByText('tour.next')).toBeInTheDocument();
    expect(screen.queryByText('tour.finish')).toBeNull();
  });

  it('hides Back on the first step', () => {
    render(<TourTooltip {...makeProps({ index: 0 })} />);
    expect(screen.queryByText('tour.back')).toBeNull();
  });

  it('shows Finish (not Next, not Skip) on the last step', () => {
    render(<TourTooltip {...makeProps({ index: 3, isLastStep: true })} />);
    expect(screen.getByText('tour.finish')).toBeInTheDocument();
    expect(screen.queryByText('tour.next')).toBeNull();
    expect(screen.queryByText('tour.skip')).toBeNull();
  });
});

describe('TourTooltip — handler wiring', () => {
  it('forwards clicks to the joyride-supplied handlers', () => {
    const props = makeProps();
    render(<TourTooltip {...props} />);

    fireEvent.click(screen.getByText('tour.next'));
    expect(props.primaryProps.onClick).toHaveBeenCalled();

    fireEvent.click(screen.getByText('tour.back'));
    expect(props.backProps.onClick).toHaveBeenCalled();

    fireEvent.click(screen.getByText('tour.skip'));
    expect(props.skipProps.onClick).toHaveBeenCalled();
  });
});
