/** Messages exchanged between the worker and offscreen clipboard coordinator. */
import type { Mode } from './rewrite';

/** Clipboard text and detectable accompanying formats from one native paste. */
export interface ClipboardSnapshot {
  text: string;
  html: string | null;
  types: string[];
}

/** Mode and queried browser focus pushed to the clipboard watcher. */
export interface WatchConfig {
  mode: Mode;
  focused: boolean;
}

/** Extension runtime operations and their direction-specific payloads. */
export type ExtensionMessage =
  | {
      type: 'watch-config';
      config: WatchConfig | null;
      /** Establishes an untouched entry even when a delayed blur never reached the coordinator. */
      baseline?: boolean;
      /** The focus event already requested its final clipboard tick. */
      skipFinalTick?: boolean;
    }
  | { type: 'watch-flush' }
  | { type: 'watch-focus' }
  | { type: 'rewrite-complete' };

/** Whether a value has named payload fields. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Validates the mode supplied to the coordinator. */
function isWatchConfig(value: unknown): value is WatchConfig {
  return (
    isRecord(value) &&
    typeof value.focused === 'boolean' &&
    typeof value.mode === 'string' &&
    ['decoy', 'silly', 'hybrid', 'strip'].includes(value.mode)
  );
}

/** Validates every known runtime payload before its receiver acts. */
export function isExtensionMessage(value: unknown): value is ExtensionMessage {
  if (!isRecord(value)) return false;
  switch (value.type) {
    case 'watch-config':
      return (
        (value.config === null || isWatchConfig(value.config)) &&
        (value.baseline === undefined || typeof value.baseline === 'boolean') &&
        (value.skipFinalTick === undefined || typeof value.skipFinalTick === 'boolean')
      );
    case 'watch-flush':
    case 'watch-focus':
    case 'rewrite-complete':
      return true;
    default:
      return false;
  }
}

/** Only this extension's clipboard document may request a browser-focus check. */
export function isOffscreenSender(sender: chrome.runtime.MessageSender): boolean {
  return (
    sender.id === chrome.runtime.id &&
    sender.tab === undefined &&
    sender.url === chrome.runtime.getURL('offscreen.html')
  );
}

/** Only this extension's worker may control the offscreen clipboard. */
export function isWorkerSender(sender: chrome.runtime.MessageSender): boolean {
  return (
    sender.id === chrome.runtime.id &&
    sender.tab === undefined &&
    (sender.url === undefined || sender.url === chrome.runtime.getURL('background.js'))
  );
}
