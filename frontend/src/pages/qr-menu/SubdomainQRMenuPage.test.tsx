import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

/**
 * Specs for SubdomainQRMenuPage — same composition as QRMenuPage but it
 * threads the `subdomain` prop down to the layout (so the layout resolves
 * the tenant from the subdomain instead of the URL token). We assert the
 * subdomain forwarding plus the content wiring.
 */

const layoutProps: any = {};
vi.mock('./QRMenuLayout', () => ({
  default: ({ children, currentPage, subdomain, onMenuDataLoaded }: any) => {
    layoutProps.currentPage = currentPage;
    layoutProps.subdomain = subdomain;
    return (
      <div>
        <button onClick={() => onMenuDataLoaded({
          categories: [{ id: 'c1' }, { id: 'c2' }],
          settings: {},
          tenant: { id: 't1' },
          enableCustomerOrdering: false,
        })}>load</button>
        {children}
      </div>
    );
  },
}));

vi.mock('../../components/qr-menu/QRMenuContent', () => ({
  default: (props: any) => (
    <div data-testid="content">{`cats:${props.categories.length} ordering:${props.enableCustomerOrdering}`}</div>
  ),
}));

import SubdomainQRMenuPage from './SubdomainQRMenuPage';

beforeEach(() => {
  for (const k of Object.keys(layoutProps)) delete layoutProps[k];
});

describe('SubdomainQRMenuPage', () => {
  it('forwards the subdomain to the layout', () => {
    render(<SubdomainQRMenuPage subdomain="acme" />);
    expect(layoutProps.subdomain).toBe('acme');
    expect(layoutProps.currentPage).toBe('menu');
  });

  it('renders QRMenuContent with the loaded categories once data arrives', () => {
    render(<SubdomainQRMenuPage subdomain="acme" />);
    fireEvent.click(screen.getByText('load'));
    expect(screen.getByTestId('content').textContent).toBe('cats:2 ordering:false');
  });
});
