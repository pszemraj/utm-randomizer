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
  /** Originating tab for a reconciliation performed by the offscreen document. */
  tabId?: number;
}

/** Content script or popup → service worker: create (if needed) and return the per-install key. */
export interface GetSecretMessage {
  type: 'get-secret';
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

/** Content script → service worker: reconcile the snapshot just observed on the clipboard. */
export interface ReconcileClipboardMessage {
  type: 'reconcile-clipboard';
  text: string;
  embedded: boolean;
  /** Complete MIME inventory observed through the async Clipboard API. */
  types: string[];
  /** Coordinator generation captured before the clipboard read. */
  epoch: number;
  baseline?: string;
}

/** Content script → service worker: restore text and suppress automatic rewriting. */
export interface RestoreClipboardMessage {
  type: 'restore-clipboard';
  text: string;
}

/** Popup → service worker: put an explicitly copied link on the clipboard. */
export interface CopyClipboardMessage {
  type: 'copy-clipboard';
  text: string;
}

/** Service worker → offscreen document: reconcile text with the current settings. */
export interface OffscreenReconcileMessage {
  type: 'offscreen-reconcile';
  text: string;
  embedded: boolean;
  types: string[];
  epoch: number;
  baseline?: string;
  config: WatchConfig;
  tabId?: number;
}

/** Service worker → offscreen document: restore the original and suppress its rewrite. */
export interface OffscreenRestoreMessage {
  type: 'offscreen-restore';
  text: string;
}

/** Offscreen → worker → focused content script: inspect all native clipboard representations. */
export interface InspectClipboardMessage {
  type: 'inspect-clipboard';
}

/** Content script → worker: obtain the coordinator generation before reading the clipboard. */
export interface ClipboardEpochMessage {
  type: 'clipboard-epoch';
}

/** Worker → offscreen coordinator: return its current generation. */
export interface OffscreenEpochMessage {
  type: 'offscreen-epoch';
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
  | GetSecretMessage
  | WatchConfigMessage
  | ReconcileClipboardMessage
  | RestoreClipboardMessage
  | CopyClipboardMessage
  | OffscreenReconcileMessage
  | OffscreenRestoreMessage
  | InspectClipboardMessage
  | ClipboardEpochMessage
  | OffscreenEpochMessage;

/** Sends a notification to the service worker without waiting for a response. */
export function sendNotification(message: ExtensionMessage): void {
  try {
    chrome.runtime.sendMessage(message).catch(() => undefined);
  } catch {
    // A reloaded or removed extension can no longer send notifications.
  }
}

/** Whether a value is an object with named payload fields. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Clipboard payloads share the rewriter's 100,000-character input limit. */
function isText(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 100_000;
}

/** Validates a bounded clipboard-format inventory, including unsupported formats. */
function isTypes(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= 100 &&
    value.every((type: unknown) => typeof type === 'string' && type.length > 0 && type.length <= 256)
  );
}

/** Whether a tab id or clipboard generation is a nonnegative safe integer. */
function isNonnegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** Whether a rewrite count is a positive safe integer. */
function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

/** Validates the mode and per-install key supplied to the coordinator. */
function isWatchConfig(value: unknown): value is WatchConfig {
  return (
    isRecord(value) &&
    typeof value.mode === 'string' &&
    ['decoy', 'silly', 'hybrid', 'strip'].includes(value.mode) &&
    isText(value.key) &&
    value.key.length > 0
  );
}

/** Validates a notification and its optional Undo text. */
function isToast(value: unknown): value is ToastPayload {
  return isRecord(value) && isText(value.message) && (value.undoText === undefined || isText(value.undoText));
}

/** Validates every known runtime message payload before a listener acts on it. */
export function isExtensionMessage(value: unknown): value is ExtensionMessage {
  if (!isRecord(value)) {
    return false;
  }
  switch (value.type) {
    case 'get-secret':
    case 'inspect-clipboard':
    case 'clipboard-epoch':
    case 'offscreen-epoch':
      return true;
    case 'count':
      return isCount(value.urls);
    case 'rewritten':
      return (
        isCount(value.urls) &&
        (value.relayToast === undefined || isToast(value.relayToast)) &&
        (value.tabId === undefined || isNonnegativeInteger(value.tabId))
      );
    case 'toast':
      return isToast(value.toast);
    case 'watch-config':
      return value.config === null || isWatchConfig(value.config);
    case 'offscreen-reconcile':
      return (
        isText(value.text) &&
        typeof value.embedded === 'boolean' &&
        isTypes(value.types) &&
        isNonnegativeInteger(value.epoch) &&
        (value.baseline === undefined || isText(value.baseline)) &&
        isWatchConfig(value.config) &&
        (value.tabId === undefined || isNonnegativeInteger(value.tabId))
      );
    case 'reconcile-clipboard':
      return (
        isText(value.text) &&
        typeof value.embedded === 'boolean' &&
        isTypes(value.types) &&
        isNonnegativeInteger(value.epoch) &&
        (value.baseline === undefined || isText(value.baseline))
      );
    case 'offscreen-copy':
    case 'offscreen-restore':
    case 'restore-clipboard':
    case 'copy-clipboard':
      return isText(value.text);
    default:
      return false;
  }
}

/** Only the extension's service worker may control offscreen clipboard operations. */
export function isWorkerSender(sender: chrome.runtime.MessageSender): boolean {
  return (
    sender.id === chrome.runtime.id &&
    sender.tab === undefined &&
    (sender.url === undefined || sender.url === chrome.runtime.getURL('background.js'))
  );
}
