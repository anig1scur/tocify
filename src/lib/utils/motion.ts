import {cubicIn, cubicOut} from 'svelte/easing';
import type {TransitionConfig} from 'svelte/transition';

// One small overshoot for things that "land" (dialogs, checks); everything else eases out.
const LAND_OVERSHOOT = 1.15;
export const landOut = (t: number) => {
  const p = t - 1;
  return p * p * ((LAND_OVERSHOOT + 1) * p + LAND_OVERSHOOT) + 1;
};

export const MOTION = {
  fast: 120,
  base: 180,
  slow: 240,
} as const;

export function prefersReducedMotion() {
  return typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
}

type LiftParams = {
  duration?: number;
  delay?: number;
  /** Vertical travel in px. */
  y?: number;
  /** Starting scale. */
  scale?: number;
  direction?: 'in' | 'out';
};

/**
 * Dialogs rise into place with a small overshoot and leave a little faster.
 * Every dialog uses it, so they all arrive the same way.
 */
export function lift(node: Element, {duration = MOTION.slow, delay = 0, y = 14, scale = 0.97, direction = 'in'}: LiftParams = {}): TransitionConfig {
  if (prefersReducedMotion()) {
    return {duration: Math.min(duration, MOTION.fast), css: (t) => `opacity: ${t}`};
  }

  return {
    delay,
    duration,
    easing: direction === 'in' ? landOut : cubicIn,
    css: (t, u) => `
      transform: translateY(${u * y}px) scale(${scale + (1 - scale) * t});
      opacity: ${Math.min(1, t * 1.8)};
    `,
  };
}

/** Short vertical settle for content that swaps in place (toolbars, empty states). */
export function settle(node: Element, {duration = MOTION.base, delay = 0, y = 6} = {}): TransitionConfig {
  if (prefersReducedMotion()) return {duration: 0};
  return {
    delay,
    duration,
    easing: cubicOut,
    css: (t, u) => `transform: translateY(${u * y}px); opacity: ${t}`,
  };
}
