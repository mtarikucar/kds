import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// The page is a thin header + the ReportSettings panel (which has its own
// suite). Stub the panel so this test pins the page shell + its header copy.
vi.mock('../../components/settings/ReportSettings', () => ({
  default: () => <div data-testid="report-settings" />,
}));

import ReportsSettingsPage from './ReportsSettingsPage';

describe('ReportsSettingsPage', () => {
  it('renders the page heading and the report settings panel', () => {
    render(<ReportsSettingsPage />);
    expect(
      screen.getByRole('heading', { name: 'reportSettings.title' }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('report-settings')).toBeInTheDocument();
  });
});
