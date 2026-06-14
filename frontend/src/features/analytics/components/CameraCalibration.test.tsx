import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { CameraCalibration } from './CameraCalibration';

// The analytics namespace is not loaded in the test harness, so i18n returns
// keys. We assert on those keys + the interactive contract (cancel, gated
// Next button) which is independent of the canvas drawing the component does.
function renderCal(props: Partial<React.ComponentProps<typeof CameraCalibration>> = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <CameraCalibration
        cameraId="cam-1"
        streamUrl="http://x/stream"
        floorPlanWidth={800}
        floorPlanHeight={600}
        {...props}
      />
    </QueryClientProvider>,
  );
}

describe('CameraCalibration', () => {
  it('renders the calibration wizard title', () => {
    renderCal();
    expect(screen.getByText('calibration.title')).toBeInTheDocument();
  });

  it('starts on the image-points step with the Next button disabled', () => {
    renderCal();
    const next = screen.getByRole('button', { name: 'calibration.next' });
    // 0 of 4 required points selected -> Next gated.
    expect(next).toBeDisabled();
  });

  it('shows the reset action on the first step', () => {
    renderCal();
    expect(
      screen.getByRole('button', { name: 'calibration.reset' }),
    ).toBeInTheDocument();
  });

  it('calls onCancel when the close button is clicked', async () => {
    const onCancel = vi.fn();
    renderCal({ onCancel });
    // The close (X) button is the first button with an svg and no text label.
    const buttons = screen.getAllByRole('button');
    await userEvent.click(buttons[0]);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('reports the selected/required point count', () => {
    renderCal();
    // pointsSelected interpolation key is rendered (count starts at 0/4).
    expect(
      screen.getByText('calibration.pointsSelected'),
    ).toBeInTheDocument();
  });
});
