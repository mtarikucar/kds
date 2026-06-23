import React from 'react'
import { useConfig } from 'nextra-theme-docs'
import { useRouter } from 'next/router'

const Logo = () => {
  const { locale } = useRouter()
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span
        style={{
          display: 'grid',
          placeItems: 'center',
          width: 30,
          height: 30,
          borderRadius: 9,
          background: '#f97316',
          color: '#fff',
          fontWeight: 800,
          fontFamily: '"Fraunces", Georgia, serif',
        }}
      >
        H
      </span>
      <span style={{ fontFamily: '"Fraunces", Georgia, serif', fontWeight: 600, fontSize: 18 }}>
        HummyTummy <span style={{ color: '#f97316' }}>{locale === 'en' ? 'Help' : 'Yardım'}</span>
      </span>
    </span>
  )
}

// "Go to app" navbar CTA — replaces nextra-theme-docs' default GitHub project
// icon (we don't expose the private repo on a public portal). Label follows the
// active locale.
const AppLink = () => {
  const { locale } = useRouter()
  return (
    <a
      href="https://hummytummy.com"
      target="_blank"
      rel="noreferrer"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 12px',
        borderRadius: 8,
        background: '#f97316',
        color: '#fff',
        fontWeight: 600,
        fontSize: 14,
        whiteSpace: 'nowrap',
      }}
    >
      {locale === 'en' ? 'Go to app' : 'Uygulamaya git'}
      <span aria-hidden style={{ fontSize: 12 }}>↗</span>
    </a>
  )
}

const config = {
  logo: <Logo />,
  // No `project`/`docsRepositoryBase`: the default project icon is the GitHub
  // logo and the repo is private — we surface a branded "Go to app" CTA instead.
  // Warm brand accent (matches the landing + pricing pages). Orange ≈ hue 24.
  color: { hue: 24, saturation: 95 },
  navbar: { extraContent: <AppLink /> },
  i18n: [
    { locale: 'tr', name: 'Türkçe' },
    { locale: 'en', name: 'English' },
  ],
  search: {
    placeholder: () =>
      useRouter().locale === 'en' ? 'Search help…' : 'Yardımda ara…',
  },
  feedback: { content: null },
  editLink: { content: null },
  // Nextra 3 removed `useNextSeoProps`; the document <title> + meta are set here
  // in `head` instead. `title` from useConfig() is the current page's title.
  head: () => {
    const { frontMatter, title } = useConfig()
    const { locale } = useRouter()
    const brand = locale === 'en' ? 'HummyTummy Help' : 'HummyTummy Yardım'
    const pageTitle = title ? `${title} — ${brand}` : brand
    const desc =
      frontMatter.description ||
      (locale === 'en'
        ? 'HummyTummy — restaurant management help center.'
        : 'HummyTummy — restoran yönetim sistemi yardım merkezi.')
    return (
      <>
        <title>{pageTitle}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta name="description" content={desc} />
        <meta property="og:title" content={pageTitle} />
        <meta property="og:description" content={desc} />
        <meta name="og:type" content="website" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&display=swap"
          rel="stylesheet"
        />
      </>
    )
  },
  footer: {
    content: (
      <span>
        © {new Date().getFullYear()} HummyTummy ·{' '}
        <a href="https://hummytummy.com" style={{ textDecoration: 'underline' }}>
          hummytummy.com
        </a>
      </span>
    ),
  },
}

export default config
