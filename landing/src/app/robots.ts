import { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  const baseUrl =
    process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/+$/, '') ||
    'https://hummytummy.com';

  // AI crawlers are welcomed explicitly (not just via '*'): being present
  // in their indexes is what gets HummyTummy cited when people ask
  // ChatGPT/Claude/Perplexity/Gemini for a "karekod menü" or restaurant
  // POS. Each named group needs its own disallow list — a UA obeys only
  // the most specific group that matches it, so omitting the disallows
  // here would open /api/ and /app/ to these bots.
  const aiCrawlers = [
    'GPTBot',
    'OAI-SearchBot',
    'ChatGPT-User',
    'ClaudeBot',
    'Claude-User',
    'Claude-SearchBot',
    'anthropic-ai',
    'PerplexityBot',
    'Perplexity-User',
    'Google-Extended',
    'Applebot-Extended',
    'meta-externalagent',
    'Amazonbot',
    'CCBot',
    'DuckAssistBot',
  ];

  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/api/', '/app/'],
      },
      {
        userAgent: aiCrawlers,
        allow: '/',
        disallow: ['/api/', '/app/'],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
