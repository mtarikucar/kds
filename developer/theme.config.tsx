import React from 'react'
import { useConfig } from 'nextra-theme-docs'
import { useRouter } from 'next/router'

const Logo = () => (
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
      HummyTummy <span style={{ color: '#f97316' }}>Docs</span>
    </span>
  </span>
)

const config = {
  logo: <Logo />,
  project: { link: 'https://hummytummy.com' },
  docsRepositoryBase: 'https://github.com/mtarikucar/kds',
  // Warm brand accent (matches the landing + pricing pages). Orange ≈ hue 24.
  color: { hue: 24, saturation: 95 },
  i18n: [
    { locale: 'tr', name: 'Türkçe' },
    { locale: 'en', name: 'English' },
  ],
  search: {
    placeholder: () =>
      useRouter().locale === 'en' ? 'Search docs…' : 'Dokümanlarda ara…',
  },
  feedback: { content: null },
  editLink: { content: null },
  head: () => {
    const { frontMatter, title } = useConfig()
    const { locale } = useRouter()
    const desc =
      frontMatter.description ||
      (locale === 'en'
        ? 'HummyTummy — cloud restaurant management documentation.'
        : 'HummyTummy — bulut tabanlı restoran yönetim sistemi dokümantasyonu.')
    return (
      <>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta name="description" content={desc} />
        <meta property="og:title" content={title ? `${title} — HummyTummy Docs` : 'HummyTummy Docs'} />
        <meta property="og:description" content={desc} />
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
  // Title template per locale.
  useNextSeoProps() {
    return { titleTemplate: '%s — HummyTummy Docs' }
  },
}

export default config
