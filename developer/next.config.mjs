import nextra from 'nextra'

const withNextra = nextra({
  theme: 'nextra-theme-docs',
  themeConfig: './theme.config.tsx',
  defaultShowCopyCode: true,
})

export default withNextra({
  // Standalone build for a small Docker image (mirrors the other apps).
  output: 'standalone',
  reactStrictMode: true,
  // Bilingual: Turkish default, English secondary. Routing is DIRECTORY-based:
  // pages/tr/** and pages/en/** with a per-directory _meta.ts. Slugs are SHARED
  // across locales (e.g. both /tr/desktop/hardware and /en/desktop/hardware) —
  // the nextra-theme-docs language switcher only swaps the leading /tr ↔ /en
  // segment, so a localized slug would 404 on switch. The nextra/locales
  // middleware redirects locale-less paths (/foo → /<locale>/foo).
  // NOTE: Nextra detects this `i18n` block and UNSETS Next.js' native i18n
  // (it doesn't support locale-folder routing); the block survives only to feed
  // NEXTRA_LOCALES / NEXTRA_DEFAULT_LOCALE to the middleware. Read the active
  // locale via `useRouter` from 'nextra/hooks', not next/router.
  i18n: {
    locales: ['tr', 'en'],
    defaultLocale: 'tr',
  },
})
