<script lang="ts">
  import { t } from 'svelte-i18n';
  import { onMount } from 'svelte';
  import { fly, fade } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import Footer from '../../components/Footer.svelte';
  import SeoJsonLd from '../../components/SeoJsonLd.svelte';
  import { ArrowLeft } from 'lucide-svelte';

  let ready = false;
  onMount(() => {
    ready = true;
  });

  const cardClass = "relative bg-white border-2 border-black rounded-xl p-6 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] hover:shadow-none hover:translate-x-[3px] hover:translate-y-[3px] transition-all duration-200";
</script>

<SeoJsonLd title={$t('seo.why_title')} description={$t('seo.why_desc')} />

<div class="min-h-screen flex font-['HuiwenMincho'] flex-col bg-yellow-50 bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] [background-size:20px_20px]">
  
  <div class="container mx-auto px-4 py-12 flex-1 max-w-4xl">
    
    {#if ready}
      <div 
        in:fly={{ y: 20, duration: 600, delay: 0, easing: cubicOut }} 
        class="mb-16"
      >
         <a href="/" class="group inline-flex items-center gap-2 px-5 py-2 border-2 border-black bg-white rounded-full shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:shadow-none hover:translate-x-[1px] hover:translate-y-[1px] active:scale-95 transition-all font-bold mb-10 text-sm uppercase tracking-wider">
           <ArrowLeft size={16} class="group-hover:-translate-x-1 transition-transform"/>
           Back to Tool
         </a>

         <h1 class="text-3xl md:text-5xl font-black mb-8 leading-tight tracking-tight text-gray-900">
           {$t('seo.why_title')}
         </h1>
         
         <div class="relative">
           <div class="absolute inset-0 bg-yellow-200 border-2 border-black rounded-2xl transform translate-x-2 translate-y-2 -z-10"></div>
           <p class="text-lg md:text-xl font-medium leading-relaxed border-2 border-black bg-white p-6 md:p-8 rounded-2xl">
             {$t('seo.why_desc')}
           </p>
         </div>
      </div>

      <section class="mb-20">
        <h2 
          in:fly={{ y: 20, duration: 600, delay: 100 }}
          class="text-2xl md:text-3xl font-bold mb-10 flex items-center gap-3"
        >
          <span class="bg-black text-white w-8 h-8 flex items-center justify-center rounded-lg text-lg shadow-[2px_2px_0px_0px_rgba(0,0,0,0.3)]">#</span>
          {$t('seo.features_title')}
        </h2>
        
        <div class="grid md:grid-cols-3 gap-6">
          {#each [
            { bg: 'bg-blue-100', title: $t('seo.feature_1_title'), desc: $t('seo.feature_1_desc'), delay: 200 },
            { bg: 'bg-green-100', title: $t('seo.feature_2_title'), desc: $t('seo.feature_2_desc'), delay: 300 },
            { bg: 'bg-pink-100', title: $t('seo.feature_3_title'), desc: $t('seo.feature_3_desc'), delay: 400 }
          ] as item}
            <div 
              in:fly={{ y: 30, duration: 500, delay: item.delay }}
              class={`${cardClass} ${item.bg}`}
            >
              <h3 class="text-lg font-bold mb-3 border-b-2 border-black/10 pb-2">{item.title}</h3>
              <p class="text-sm md:text-base font-medium text-gray-800 leading-relaxed">{item.desc}</p>
            </div>
          {/each}
        </div>
      </section>

      <section class="mb-20">
        <h2 
          in:fly={{ y: 20, duration: 600, delay: 500 }}
          class="text-2xl md:text-3xl font-bold mb-10 flex items-center gap-3"
        >
          <span class="bg-black text-white w-8 h-8 flex items-center justify-center rounded-lg text-lg shadow-[2px_2px_0px_0px_rgba(0,0,0,0.3)]">?</span>
          {$t('seo.how_title')}
        </h2>
        
        <div 
          in:fly={{ y: 20, duration: 600, delay: 600 }}
          class="bg-white border-2 border-black rounded-2xl p-6 md:p-10 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]"
        >
          <div class="space-y-3 relative">
            <div class="absolute left-[15px] top-4 bottom-4 w-0.5 border-l-2 border-dashed border-gray-300 -z-10 hidden md:block"></div>

            {#each [
              $t('seo.how_step_1'),
              $t('seo.how_step_2'),
              $t('seo.how_step_3'),
              $t('seo.how_step_4')
            ] as step, i}
              <div class="flex gap-6 items-start group">
                <div class="bg-black text-white w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0 ring-4 ring-white shadow-sm transition-transform group-hover:scale-110">
                  {i + 1}
                </div>
                <div class="pt-0.5">
                  <p class="text-lg font-bold group-hover:text-blue-600 transition-colors duration-200">{step}</p>
                </div>
              </div>
            {/each}
          </div>
        </div>
      </section>

      <section class="mb-12">
        <h2 
          in:fly={{ y: 20, duration: 600, delay: 700 }}
          class="text-2xl md:text-3xl font-bold mb-10 text-center"
        >
          {$t('seo.faq_title')}
        </h2>
        
        <div class="space-y-4 mx-auto">
          {#each [
            { q: $t('seo.faq_1_q'), a: $t('seo.faq_1_a'), delay: 800 },
            { q: $t('seo.faq_2_q'), a: $t('seo.faq_2_a'), delay: 900 },
            { q: $t('seo.faq_3_q'), a: $t('seo.faq_3_a'), delay: 1000 },
            { q: $t('seo.faq_4_q'), a: $t('seo.faq_4_a'), delay: 1100 },
            { q: $t('seo.faq_5_q'), a: $t('seo.faq_5_a'), delay: 1200 }
          ] as faq}
            <div 
              in:fly={{ y: 20, duration: 500, delay: faq.delay }}
              class="bg-white border-2 border-black rounded-xl p-6 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] hover:shadow-[5px_5px_0px_0px_rgba(0,0,0,1)] hover:-translate-y-0.5 transition-all duration-200"
            >
              <h3 class="text-lg font-bold mb-3 flex items-start gap-2">
                <span class="text-blue-500">Q.</span> {faq.q}
              </h3>
              <p class="text-gray-600 pl-6 leading-relaxed border-l-2 border-gray-100 ml-1.5">{@html faq.a}</p>
            </div>
          {/each}
        </div>
      </section>
    {/if}
  </div>

  <Footer />
</div>