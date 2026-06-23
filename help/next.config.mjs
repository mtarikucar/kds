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
  // Bilingual: Turkish default, English secondary. Locale-suffixed page
  // files (*.tr.mdx / *.en.mdx) + _meta.{tr,en}.json + nextra/locales
  // middleware drive the routing.
  i18n: {
    locales: ['tr', 'en'],
    defaultLocale: 'tr',
  },
})
