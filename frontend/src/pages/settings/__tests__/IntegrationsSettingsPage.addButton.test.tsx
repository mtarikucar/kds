import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import IntegrationsSettingsPage from '../IntegrationsSettingsPage';

// The "Ekle" button in the "Other Integrations" card only ever fired a
// comingSoon toast — there was no real add-provider flow behind it. A button
// that always dead-ends is worse than no button (Faz 5b jargon/dead-end
// sweep): render nothing until there's a genuinely addable provider.
vi.mock('@/features/settings/settingsApi', () => ({
  useGetIntegrations: () => ({ data: [], isLoading: false, refetch: vi.fn() }),
  useDeleteIntegration: () => ({ mutateAsync: vi.fn() }),
  useToggleIntegration: () => ({ mutateAsync: vi.fn() }),
}));

describe('IntegrationsSettingsPage — dead-end "Ekle" button removed', () => {
  it('renders no add-integration button', () => {
    render(<IntegrationsSettingsPage />);
    expect(
      screen.queryByRole('button', { name: /integrations\.addIntegration/ }),
    ).toBeNull();
  });
});
