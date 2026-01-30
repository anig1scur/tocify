<script>
  import {fly} from 'svelte/transition';
  import {backOut} from 'svelte/easing';

  export let className = '';
  export let text = 'Tooltip text';
  export let position = 'top';
  export let width = 'w-48';
  export let isTextCopiable = false;

  export let color = 'bg-gradient-to-tr from-blue-300/70 to-pink-300/60 ';

  let isVisible = false;
  let timer = null;
  let isCopied = false;

  const delay = (func) => {
    return () => {
      timer = setTimeout(func, 300);
    };
  };

  const setVisible = () => {
    if (timer) clearTimeout(timer);
    isVisible = true;
  };

  const setInVisible = () => {
    isVisible = false;
    setTimeout(() => (isCopied = false), 300);
  };

  const copyText = () => {
    navigator.clipboard.writeText(text);
    isCopied = true;
    setTimeout(() => (isCopied = false), 1500);
  };

  const toUnit = (val) => {
    if (typeof val === 'number') return `${val * 100}%`;
    
    if (!isNaN(val) && !val.includes('%') && !val.includes('px')) {
       const num = parseFloat(val);
       if (Math.abs(num) <= 1) {
         return `${num * 100}%`;
       }
       return `${val}%`;
    }
    return val;
  };

  $: isCustomPosition = position.includes(' ');
  $: customCoords = isCustomPosition ? position.split(' ').map(toUnit) : [];
  
  $: customStyle = isCustomPosition  ? `left: ${customCoords[0]}; top: ${customCoords[1]}; margin: 0;` : '';

  const getFlyParams = (pos) => {
    if (isCustomPosition) return { y: 10 };
    switch (pos) {
      case 'top':
        return {y: 10};
      case 'bottom':
        return {y: -10};
      case 'left':
        return {x: 10};
      case 'right':
        return {x: -10};
      default:
        return {y: 10};
    }
  };
</script>

<div class={'relative inline-block font-mono' + className}>
  <div
    role="button"
    tabindex="0"
    class="cursor-pointer inline-block"
    on:mouseenter={setVisible}
    on:mouseleave={delay(setInVisible)}
  >
    <slot />
  </div>

  {#if isVisible}
    <button
      transition:fly={{...getFlyParams(position), duration: 300, easing: backOut}}
      on:mouseenter={setVisible}
      on:mouseleave={delay(setInVisible)}
      on:click={isTextCopiable ? copyText : null}
      style={customStyle}
      class={`
        absolute z-50 p-2 md:px-4 md:py-3 font-mono text-sm text-gray-900 border-2 border-black
        shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]  rounded-md
        backdrop-blur-sm break-words
        whitespace-pre-line text-left ${width} ${color}
        ${isTextCopiable ? 'cursor-copy active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all' : ''}
        
        ${!isCustomPosition && position === 'top' ? 'bottom-full left-1/2 transform -translate-x-1/2 mb-3' : ''}
        ${!isCustomPosition && position === 'bottom' ? 'top-full left-1/2 transform -translate-x-1/2 mt-3' : ''}
        ${!isCustomPosition && position === 'left' ? 'right-full top-1/2 transform -translate-y-1/2 mr-3' : ''}
        ${!isCustomPosition && position === 'right' ? 'left-full top-1/2 transform -translate-y-1/2 ml-3' : ''}
      `}
    >
      <div class="relative z-10 drop-shadow-sm">
        {#if isCopied}
          <span class="inline-block uppercase tracking-widest font-black">COPIED!</span>
        {:else}
          {text}
        {/if}
      </div>
    </button>
  {/if}
</div>
