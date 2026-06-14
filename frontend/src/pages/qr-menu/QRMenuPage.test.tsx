import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

/**
 * Specs for QRMenuPage — a thin composition over QRMenuLayout that only
 * renders QRMenuContent once the layout reports menu data. We mock the
 * layout to (a) expose its currentPage prop and (b) hand back a "load"
 * button that fires onMenuDataLoaded, and mock QRMenuContent to echo the
 * props it receives. We assert: nothing renders before data arrives, the
 * content mounts with the loaded categories/settings/ordering flag after,
 * and the searchQuery prop is forwarded.
 */

const layoutProps: any = {};
vi.mock('./QRMenuLayout', () => ({
  default: ({ children, currentPage, onMenuDataLoaded }: any) => {
    layoutProps.currentPage = currentPage;
    layoutProps.onMenuDataLoaded = onMenuDataLoaded;
    return (
      <div data-testid="layout">
        <button onClick={() => onMenuDataLoaded({
          categories: [{ id: 'c1' }],
          settings: { themeColor: '#fff' },
          tenant: { id: 't1' },
          enableCustomerOrdering: true,
        })}>load</button>
        {children}
      </div>
    );
  },
}));

vi.mock('../../components/qr-menu/QRMenuContent', () => ({
  default: (props: any) => (
    <div data-testid="content">
      {`cats:${props.categories.length} ordering:${props.enableCustomerOrdering} q:${props.searchQuery}`}
    </div>
  ),
}));

import QRMenuPage from './QRMenuPage';

beforeEach(() => {
  for (const k of Object.keys(layoutProps)) delete layoutProps[k];
});

describe('QRMenuPage', () => {
  it('passes currentPage="menu" to the layout and renders no content before data', () => {
    render(<QRMenuPage />);
    expect(layoutProps.currentPage).toBe('menu');
    expect(screen.queryByTestId('content')).toBeNull();
  });

  it('renders QRMenuContent with the loaded data + forwarded searchQuery', () => {
    render(<QRMenuPage searchQuery="pizza" />);
    fireEvent.click(screen.getByText('load'));
    expect(screen.getByTestId('content').textContent).toBe('cats:1 ordering:true q:pizza');
  });
});
