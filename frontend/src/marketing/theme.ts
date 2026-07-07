// Shared brand tokens for the marketing landing pages. Extends the palette the
// original LandingPage.tsx established so home, pricing and module pages stay
// visually consistent. Kept as plain constants (not a Tailwind plugin) so we can
// use them in inline styles and arbitrary Tailwind values interchangeably.

export const C = {
  cream: "#faf6f0",
  card: "#ffffff",
  ink: "#1c1917",
  inkSoft: "#57534e",
  muted: "#78716c",
  faint: "#a8a29e",
  orange: "#f97316",
  orangeDark: "#ea580c",
  orangeTint: "#fff3e8",
  amber: "#b45309",
  border: "#ece2d4",
  borderSoft: "#efe6da",
  panelDark: "#1c1917",
} as const;

// Display serif (loaded globally in index.html). Body font is Inter (default).
export const display = { fontFamily: '"Fraunces", Georgia, serif' } as const;
