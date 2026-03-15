import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
    const DOMAIN = 'https://tocify.aeriszhu.com/';
    const now = new Date().toISOString();

    const pages = [
        { loc: DOMAIN, lastmod: now, changefreq: 'monthly', priority: '1.0' },
        { loc: `${DOMAIN}?lang=zh`, lastmod: now, changefreq: 'monthly', priority: '0.8' },
        { loc: `${DOMAIN}about`, lastmod: now, changefreq: 'monthly', priority: '0.8' },
        { loc: `${DOMAIN}about?lang=zh`, lastmod: now, changefreq: 'monthly', priority: '0.6' },
    ];

    const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pages
    .map(
        (page) => `  <url>
    <loc>${page.loc}</loc>
    <lastmod>${page.lastmod}</lastmod>
    <changefreq>${page.changefreq}</changefreq>
    <priority>${page.priority}</priority>
  </url>`
    )
    .join('\n')}
</urlset>`.trim();

    return new Response(sitemap, {
        headers: {
            'Content-Type': 'application/xml',
            'Cache-Control': 'max-age=0, s-maxage=3600'
        }
    });
};
