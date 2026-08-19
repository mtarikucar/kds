import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';

/**
 * The app-shell page-height contract (see Layout.tsx).
 *
 * Layout makes <main> the app's one and only scroll container. Its height is
 * 100dvh minus the header minus whichever of the demo/renewal banners happen
 * to be rendering — a number no page can compute for itself. Pages that tried
 * anyway all guessed differently and all guessed wrong:
 *
 *   Dashboard   h-[calc(100vh-10rem)]
 *   POS  (x2)   h-[calc(100vh-12rem)]
 *   FloorPlan   h-[calc(100vh-15rem)] / h-[calc(100vh-7rem)]
 *   Menu        max-h-[calc(100vh-7rem)]
 *
 * Every one of those double-counts the header, ignores the banners entirely,
 * ignores that <main>'s own padding changes at md/lg, and on a phone measures
 * a viewport taller than the one the user can see. The measured damage on the
 * menu page was 263px of category list clipped away at 1280x720 with no
 * scrollbar anywhere to reveal it.
 *
 * The contract: inside the shell you write `h-full` / `min-h-full`, never a
 * viewport unit. This test is the guard — it reads the sources rather than
 * the DOM, because jsdom computes no layout and would happily pass either way.
 *
 * Surfaces that render OUTSIDE <Layout> (login, errors, legal, the QR menu,
 * onboarding, superadmin's own shell, marketing) genuinely own the viewport,
 * so they are allowed viewport units — but dynamic ones (dvh), since 100vh
 * overshoots the visible area on mobile browsers.
 */

const SRC = path.resolve(__dirname, '../..');

/** Renders outside <Layout>: owns the viewport, may size against it. */
const OUTSIDE_THE_SHELL = [
  'src/marketing/',
  'src/pages/LandingPage.tsx',
  'src/pages/auth/',
  'src/components/auth/AuthLayout.tsx',
  'src/pages/errors/',
  'src/pages/legal/',
  'src/pages/onboarding/',
  'src/pages/qr-menu/',
  'src/components/qr-menu/',
  'src/pages/superadmin/',
  'src/features/superadmin/',
  'src/features/branches/BranchSelectPage.tsx',
  'src/features/reservations/public/',
  'src/pages/reservations/ReservationLookupPage.tsx',
  'src/components/ErrorBoundary.tsx',
  'src/components/AccountRoleInvalid.tsx',
  'src/components/ProtectedRoute.tsx',
];

/**
 * Sized against the viewport on purpose because they are position:fixed and
 * therefore laid out against it, not against <main>.
 */
const FIXED_TO_THE_VIEWPORT = [
  'src/components/layout/Sidebar.tsx',
  'src/components/ui/Modal.tsx',
  'src/features/devices/DeviceCommandsDrawer.tsx',
  'src/components/qr/QrCodeDisplay.tsx',
];

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return entry === 'node_modules' ? [] : walk(full);
    return /\.(tsx?|css)$/.test(entry) && !/\.(test|spec)\./.test(entry) ? [full] : [];
  });

const rel = (file: string) => `src/${path.relative(SRC, file)}`.replace(/\\/g, '/');

const sources = walk(SRC).map((file) => ({
  file: rel(file),
  text: readFileSync(file, 'utf8'),
}));

const inTheShell = sources.filter(
  ({ file }) =>
    !OUTSIDE_THE_SHELL.some((p) => file.startsWith(p)) &&
    !FIXED_TO_THE_VIEWPORT.includes(file),
);

/**
 * Line hits for a pattern, reported as "src/x.tsx:12  <the line>". Comment
 * lines are skipped — this file and several of the fixed pages explain the
 * 100vh trap in prose, and prose is not markup.
 */
const codeLines = (text: string) => {
  let inBlock = false;
  return text.split('\n').map((line, i) => {
    const wasInBlock = inBlock;
    const opens = line.lastIndexOf('/*');
    const closes = line.lastIndexOf('*/');
    if (opens > closes) inBlock = true;
    else if (closes > opens) inBlock = false;
    const isComment = wasInBlock || /^\s*(?:\/\/|\/\*|\{\/\*)/.test(line);
    return { line, n: i + 1, isComment };
  });
};

const hits = (files: typeof sources, pattern: RegExp) =>
  files.flatMap(({ file, text }) =>
    codeLines(text)
      .filter(({ line, isComment }) => !isComment && pattern.test(line))
      .map(({ line, n }) => `${file}:${n}  ${line.trim()}`),
  );

describe('app-shell page-height contract', () => {
  it('no surface inside the shell sizes itself against the viewport', () => {
    // h-screen / min-h-screen / any 100vh arithmetic. <main> is the box to
    // measure against, and `h-full` / `min-h-full` is how you ask for it.
    expect(hits(inTheShell, /\b(?:min-|max-)?h-screen\b|100vh/)).toEqual([]);
  });

  it('no shell BOUNDS itself at 100vh, where mobile chrome hides the bottom', () => {
    // The distinction that matters is bounded vs. minimum. `min-h-screen`
    // lets a page grow past the viewport and the body scroll, so an
    // over-tall measurement costs a little stray scroll and nothing else.
    // `h-screen` — a shell that clips at exactly 100vh — is the harmful one:
    // on iOS/Android that box extends past the visible viewport, the body
    // cannot scroll to reveal the difference, and the bottom of the shell
    // (and of whatever scroll container it holds) is stranded under the
    // browser's own chrome. Those must be h-dvh.
    // (?<![-\w]) so `min-h-screen` / `max-h-screen` do not match — \b would,
    // since a hyphen is already a word boundary.
    expect(hits(sources, /(?<![-\w])h-screen\b/)).toEqual([]);
  });

  it('<main> stays the shell’s single, shrinkable scroll container', () => {
    const layout = readFileSync(path.join(SRC, 'components/layout/Layout.tsx'), 'utf8');
    const main = layout.match(/<main className="([^"]+)"/)?.[1] ?? '';
    // overflow-y-auto: it scrolls. min-h-0: it may shrink below its content,
    // so tall pages scroll *inside* it instead of pushing it past the shell
    // and getting clipped by the shell's overflow-hidden.
    expect(main).toContain('overflow-y-auto');
    expect(main).toContain('min-h-0');
    expect(main).toContain('flex-1');
    // The shell itself must bound the viewport dynamically.
    expect(layout).toMatch(/className="flex h-dvh overflow-hidden/);
  });
});
