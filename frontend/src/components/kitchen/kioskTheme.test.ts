import { describe, it, expect } from 'vitest';
import {
  kioskPage,
  kioskColumnShell,
  kioskCardShell,
  kioskTitleText,
  kioskItemNameText,
  kioskQtyText,
  kioskHeadingText,
} from './kioskTheme';

describe('kioskTheme class helpers', () => {
  it('light (kiosk=false) preserves the existing look', () => {
    // The default board must be byte-for-byte the same as before kiosk mode.
    expect(kioskPage(false)).toBe('');
    expect(kioskColumnShell(false, 'bg-amber-50/80')).toContain('bg-amber-50/80');
    expect(kioskColumnShell(false, 'bg-amber-50/80')).toContain('border-slate-200/60');
    expect(kioskCardShell(false)).toContain('bg-white');
    expect(kioskCardShell(false)).toContain('hover:shadow-md');
    expect(kioskTitleText(false)).toContain('text-slate-900');
    expect(kioskItemNameText(false)).toContain('text-slate-900');
    expect(kioskQtyText(false)).toContain('text-slate-900');
    expect(kioskHeadingText(false)).toContain('text-slate-900');
  });

  it('kiosk=true switches to the dark high-contrast palette', () => {
    expect(kioskPage(true)).toContain('bg-neutral-950');
    expect(kioskPage(true)).toContain('text-neutral-50');
    expect(kioskColumnShell(true, 'bg-amber-50/80')).toContain('bg-neutral-900');
    // Light pastel column body is dropped in kiosk mode.
    expect(kioskColumnShell(true, 'bg-amber-50/80')).not.toContain('bg-amber-50/80');
    expect(kioskCardShell(true)).toContain('bg-neutral-900');
    expect(kioskTitleText(true)).toContain('text-white');
    expect(kioskItemNameText(true)).toContain('text-white');
    expect(kioskQtyText(true)).toContain('text-white');
    expect(kioskHeadingText(true)).toContain('text-white');
  });

  it('keeps the saturated header accent in both themes', () => {
    // Status accents (emerald/amber/red) survive into kiosk mode for at-a-
    // glance column identity.
    expect(kioskColumnShell(true, 'bg-emerald-50/80')).toContain('flex flex-col');
  });
});
