/**
 * The content script cannot open the options page or force a rate refresh on
 * its own, since both live in the background. Two message types, both fire-and-
 * forget, both safe to fail silently when the worker is asleep.
 */
export const MESSAGE = {
  OPEN_OPTIONS: 'openOptions',
  REFRESH_RATES: 'refreshRates',
} as const;

export type MessageType = (typeof MESSAGE)[keyof typeof MESSAGE];

export interface RefreshResult {
  ok: boolean;
  timestamp?: number;
}

export function send<T = unknown>(type: MessageType): Promise<T | null> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ type }, (response) => {
        // Reading lastError is what suppresses the "unchecked runtime.lastError"
        // console noise when nothing is listening.
        void chrome.runtime.lastError;
        resolve((response as T) ?? null);
      });
    } catch {
      resolve(null);
    }
  });
}
