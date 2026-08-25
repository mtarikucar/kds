import type { GetServerSideProps } from 'next';

/**
 * Served at /robots.txt. This host answered 404 here, so no crawler was ever
 * told where the sitemap lives.
 *
 * A runtime route rather than public/robots.txt: that file exists in the repo
 * and has since June, yet production still answers 404 for it — the deployed
 * image is not serving public/ at all. A route inside the Next build does not
 * depend on that.
 */
const BASE = (process.env.NEXT_PUBLIC_SITE_URL || 'https://developer.hummytummy.com').replace(/\/+$/, '');

export const getServerSideProps: GetServerSideProps = async ({ res }) => {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=3600');
  res.write(
    [
      'User-agent: *',
      'Allow: /',
      '',
      `Sitemap: ${BASE}/sitemap.xml`,
      '',
    ].join('\n'),
  );
  res.end();
  return { props: {} };
};

export default function Robots() {
  return null;
}
