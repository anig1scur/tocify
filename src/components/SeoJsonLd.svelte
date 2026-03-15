<script lang="ts">
  import { t } from 'svelte-i18n';

  export let title: string;
  export let description: string | undefined = undefined;
  export let url: string = 'https://tocify.aeriszhu.com';
  export let image: string = 'https://tocify.aeriszhu.com/og-image.png';

  const siteName = 'Tocify';

  $: jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "SoftwareApplication",
        "name": siteName,
        "applicationCategory": "ProductivityApplication",
        "operatingSystem": "Web",
        "url": url,
        "image": image,
        "description": description || $t('meta.description'),
        "offers": {
          "@type": "Offer",
          "price": "0",
          "priceCurrency": "USD"
        },
        "aggregateRating": {
          "@type": "AggregateRating",
          "ratingValue": "4.8",
          "ratingCount": "124"
        }
      },
      {
        "@type": "WebSite",
        "url": url,
        "name": title || $t('meta.title'),
        "description": description || $t('meta.description'),
        "publisher": {
          "@type": "Organization",
          "name": "Aeris Zhu"
        }
      }
    ]
  };
</script>

<svelte:head>
  <title>{title}</title>
  <meta name="description" content={description || $t('meta.description')} />
  <meta name="keywords" content="add bookmarks to PDF, PDF table of contents, clickable PDF outline, PDF bookmark editor, create PDF TOC, generate PDF outline, PDF 目录生成, PDF 添加书签, 扫描版 PDF 目录, PDF 在线免费工具" />
  
  <link rel="canonical" href={url} />
  <link rel="alternate" hreflang="en" href="{url}" />
  <link rel="alternate" hreflang="zh" href="{url}?lang=zh" />
  <link rel="alternate" hreflang="x-default" href="{url}" />

  <!-- Open Graph / Facebook -->
  <meta property="og:type" content="website" />
  <meta property="og:url" content={url} />
  <meta property="og:title" content={title} />
  <meta property="og:description" content={description || $t('meta.description')} />
  <meta property="og:image" content={image} />
  <meta property="og:site_name" content={siteName} />

  <!-- Twitter -->
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:url" content={url} />
  <meta name="twitter:title" content={title} />
  <meta name="twitter:description" content={description || $t('meta.description')} />
  <meta name="twitter:image" content={image} />

  {@html `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>`}
</svelte:head>
