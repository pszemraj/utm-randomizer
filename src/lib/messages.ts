/** Messages exchanged between the content script, service worker, popup, and offscreen document. */

/** Content script → service worker: a copied link was rewritten in some frame. */
export interface RewrittenMessage {
  type: 'rewritten';
  /** Number of links that changed. */
  urls: number;
  /** Ask the worker to show the toast in the tab's top frame (the rewrite happened in a subframe). */
  relayToast?: ToastPayload;
}

/** Service worker → content script (top frame): show a toast. */
export interface ToastMessage {
  type: 'toast';
  toast: ToastPayload;
}

/** Service worker → offscreen document: put text on the clipboard. */
export interface OffscreenCopyMessage {
  type: 'offscreen-copy';
  /** Exact text to write. */
  text: string;
}

/** Popup → service worker: count a rewrite done from the popup. */
export interface CountMessage {
  type: 'count';
  /** Number of links that changed. */
  urls: number;
}

/** What an on-page notification says and whether it can undo. */
export interface ToastPayload {
  /** Text shown in the notification. */
  message: string;
  /** Text to restore when the user clicks Undo; omitted when undo is not possible. */
  undoText?: string;
}

/** Any message this extension sends through `chrome.runtime` or `chrome.tabs`. */
export type ExtensionMessage = RewrittenMessage | ToastMessage | OffscreenCopyMessage | CountMessage;

/**
 * Narrows an incoming `chrome.runtime` message to this extension's message shape. Listeners still
 * switch on `type`, so unknown types fall through harmlessly.
 */
export function isExtensionMessage(value: unknown): value is ExtensionMessage {
  return typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string';
}
