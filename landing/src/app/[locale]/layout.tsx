import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Script from 'next/script';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, setRequestLocale } from 'next-intl/server';
import { Inter } from 'next/font/google';
import { locales, localeConfig, type Locale } from '@/i18n/config';
import { FloatingMascot } from '@/components/FloatingMascot';
import '../globals.css';

const inter = Inter({ subsets: ['latin', 'cyrillic'] });

type Props = {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
};

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const messages = (await import(`@/i18n/messages/${locale}.json`)).default;
  const meta = messages.metadata;

  // Honour NEXT_PUBLIC_BASE_URL so staging/preview deploys don't emit
  // canonical/og:url tags pointing at production. Fallback covers local
  // `next dev` without env wiring.
  const baseUrl =
    process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/+$/, '') ||
    'https://hummytummy.com';

  return {
    title: {
      default: meta.title,
      template: `%s | HummyTummy`,
    },
    description: meta.description,
    keywords: meta.keywords,
    metadataBase: new URL(baseUrl),
    alternates: {
      canonical: `/${locale}`,
      languages: Object.fromEntries(
        locales.map((l) => [localeConfig[l].hreflang, `/${l}`])
      ),
    },
    openGraph: {
      type: 'website',
      locale: localeConfig[locale as Locale]?.hreflang || 'en',
      url: baseUrl,
      siteName: 'HummyTummy',
      title: meta.title,
      description: meta.description,
      images: [
        {
          url: '/og-image.jpg',
          width: 1200,
          height: 630,
          alt: 'HummyTummy - Restaurant Management System',
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: meta.title,
      description: meta.description,
      images: ['/og-image.jpg'],
    },
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        'max-video-preview': -1,
        'max-image-preview': 'large',
        'max-snippet': -1,
      },
    },
    verification: {
      google: process.env.GOOGLE_SITE_VERIFICATION,
    },
  };
}

export default async function LocaleLayout({ children, params }: Props) {
  const { locale } = await params;

  if (!locales.includes(locale as Locale)) {
    notFound();
  }

  setRequestLocale(locale);

  const messages = await getMessages();
  const dir = localeConfig[locale as Locale]?.dir || 'ltr';

  return (
    <html lang={locale} dir={dir} className={inter.className}>
      <head>
        <link rel="icon" href="/favicon.ico" sizes="any" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
      </head>
      <body className="antialiased">
        <NextIntlClientProvider messages={messages}>
          {children}
          <FloatingMascot />
        </NextIntlClientProvider>

        {/*
          Jeeta web chat. The channel ("Site sohbeti — hummytummy.com") has been
          ACTIVE with the "customer service" AI agent attached for some time —
          this tag was the only missing piece, so no visitor could ever reach it.

          The widget key is public by design: it identifies the channel in the
          page source and grants nothing on its own. Every write behind it is
          rate-limited and resolves server-side from the key.

          afterInteractive: chat must never compete with first paint on a
          marketing page.
        */}
        <Script
          src="https://jeetagrowth.com/widget.js"
          data-widget-key="wc_b6fe4a2d8c1d42cc9643b5136892ae18"
          strategy="afterInteractive"
        />
      </body>
    </html>
  );
}
