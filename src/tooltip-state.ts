import { writable } from 'svelte/store';
import type { ConvertedPrice, DetectedPrice } from './types';
import type { Rounding } from './settings';

export interface TooltipState {
  visible: boolean;
  sources: DetectedPrice[];
  allConversions: ConvertedPrice[][];
  rounding: Rounding;
  /**
   * How the page's own price is printed in the header. It follows `rounding`
   * everywhere except in `replace` style, where the page no longer shows that
   * price and a rounded copy of it would be the only one left.
   */
  sourceRounding: Rounding;
  /** Rates older than the staleness threshold, so the tooltip can say so. */
  stale: boolean;
  x: number;
  y: number;
  yBottom: number;
}

const INITIAL_STATE: TooltipState = {
  visible: false,
  sources: [],
  allConversions: [],
  rounding: 'exact',
  sourceRounding: 'exact',
  stale: false,
  x: 0,
  y: 0,
  yBottom: 0,
};

export const tooltipState = writable<TooltipState>(INITIAL_STATE);

export function showTooltipState(next: Omit<TooltipState, 'visible'>): void {
  tooltipState.set({ visible: true, ...next });
}

/** Moves an already-visible tooltip without replaying its entrance animation. */
export function moveTooltipState(x: number, y: number, yBottom: number): void {
  tooltipState.update((state) => (state.visible ? { ...state, x, y, yBottom } : state));
}

export function hideTooltipState(): void {
  tooltipState.update((state) => (state.visible ? { ...state, visible: false } : state));
}

/**
 * The card lives in a closed shadow root, so the content script cannot query
 * for it. It needs the rect anyway: a tooltip the pointer can click is one the
 * pointer must be able to travel to without the price counting as left.
 */
let cardElement: HTMLElement | null = null;

export function registerCard(element: HTMLElement | null): void {
  cardElement = element;
}

export function getCardRect(): DOMRect | null {
  return cardElement?.getBoundingClientRect() ?? null;
}
