/** Messages exchanged between the content script, service worker, popup, and offscreen document. */

import type { Mode } from './rewrite';

/**
 * Content script or offscreen document → service worker: a copied link was rewritten. From a
 * subframe, the toast is shown in the tab's top frame; from the background clipboard watcher, in the
 * active tab.
 */
export interface RewrittenMessage {
  type: 'rewritten';
  /** Number of links that changed. */
  urls: number;
  /** Toast to show elsewhere (the rewrite happened in a subframe or in the background). */
  relayToast?: ToastPayload;
}

/** Content script or popup → service worker: create (if needed) and return the per-install key. */
export interface GetSecretMessage {
  type: 'get-secret';
}

/** Content script → service worker: Undo is about to restore `text`; the background watcher must leave it. */
export interface IgnoreClipboardMessage {
  type: 'ignore-clipboard';
  text: string;
}

/** What the background clipboard watcher needs to rewrite links on its own. */
export interface WatchConfig {
  mode: Mode;
  /** Per-install key that seeds replacement values. */
  key: string;
}

/** Service worker → offscreen document: start, reconfigure (config), or stop (null) watching the clipboard. */
export interface WatchConfigMessage {
  type: 'watch-config';
  config: WatchConfig | null;
}

/** Service worker → offscreen document: leave `text` alone while it is on the clipboard (Undo). */
export interface WatchIgnoreMessage {
  type: 'watch-ignore';
  text: string;
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
export type ExtensionMessage =
  | RewrittenMessage
  | ToastMessage
  | OffscreenCopyMessage
  | CountMessage
  | IgnoreClipboardMessage
  | GetSecretMessage
  | WatchConfigMessage
  | WatchIgnoreMessage;

/**
 * Narrows an incoming `chrome.runtime` message to this extension's message shape. Listeners still
 * switch on `type`, so unknown types fall through harmlessly.
 */
export function isExtensionMessage(value: unknown): value is ExtensionMessage {
  return typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string';
}
