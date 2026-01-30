<script lang="ts">
  import { t } from 'svelte-i18n';

  export let title: string;
  export let description: string | undefined = undefined;
  export let url: string = 'https://tocify.aeriszhu.com';
  export let image: string = 'https://tocify.aeriszhu.com/og-image.png';

  $: jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "SoftwareApplication",
        "name": "Tocify",
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

  <link rel="alternate" hreflang="en" href="{url}" />
  <link rel="alternate" hreflang="zh" href="{url}?lang=zh" />
  <link rel="alternate" hreflang="x-default" href="{url}" />
  {#if description}
    <meta name="description" content={description} />
  {/if}
  {@html `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>`}
</svelte:head>
