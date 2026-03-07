import { writable } from 'svelte/store';
import type { ConvertedPrice, DetectedPrice } from './types';

export interface TooltipState {
  visible: boolean;
  sources: DetectedPrice[];
  allConversions: ConvertedPrice[][];
  x: number;
  y: number;
  yBottom: number;
}

const INITIAL_STATE: TooltipState = {
  visible: false,
  sources: [],
  allConversions: [],
  x: 0,
  y: 0,
  yBottom: 0,
};

export const tooltipState = writable<TooltipState>(INITIAL_STATE);

export function showTooltipState(next: Omit<TooltipState, 'visible'>): void {
  tooltipState.set({ visible: true, ...next });
}

export function hideTooltipState(): void {
  tooltipState.update((state) => (state.visible ? { ...state, visible: false } : state));
}
