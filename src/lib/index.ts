// place files you want to import through the `$lib` alias in this folder.

export function debounce<Args extends unknown[]>(func: (...args: Args) => unknown, delay: number) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const debounced = (...args: Args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => {
      func(...args);
    }, delay);
  };
  debounced.cancel = () => clearTimeout(timeout);
  return debounced;
}
