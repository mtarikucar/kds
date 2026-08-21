import { describe, it, expect, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import i18next from 'i18next';
import enHardware from '../../i18n/locales/en/hardware.json';
import PartnerBadge from './PartnerBadge';

beforeAll(() => {
  i18next.addResourceBundle('en', 'hardware', enHardware, true, true);
});

describe('PartnerBadge', () => {
  it('renders an outbound link with rel=noopener when a url is configured', () => {
    render(<PartnerBadge url="https://figurunica.com" />);
    const a = screen.getByRole('link');
    expect(a).toHaveAttribute('href', 'https://figurunica.com');
    expect(a).toHaveAttribute('target', '_blank');
    expect(a.getAttribute('rel')).toContain('noopener');
    expect(a.getAttribute('rel')).toContain('noreferrer');
  });

  it('renders the partner text as plain span when no url is configured', () => {
    render(<PartnerBadge url={null} />);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText(enHardware.print3d.partnerLabel)).toBeTruthy();
  });

  it('never renders empty text', () => {
    // "Üretim ortağı: Figurunica" bir BEYANDIR, bağlantıya bağlı değildir.
    for (const url of ['https://figurunica.com', null, 'javascript:alert(1)']) {
      const { container, unmount } = render(<PartnerBadge url={url as any} />);
      expect((container.textContent ?? '').trim().length).toBeGreaterThan(0);
      unmount();
    }
  });

  it('refuses a javascript: url and falls back to plain text', () => {
    render(<PartnerBadge url={'javascript:alert(1)' as any} />);
    expect(screen.queryByRole('link')).toBeNull();
  });
});
