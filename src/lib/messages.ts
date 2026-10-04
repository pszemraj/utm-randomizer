/** Messages exchanged between the worker and offscreen clipboard coordinator. */
import type { Mode } from './rewrite';

/** Clipboard text and detectable accompanying formats from one native paste. */
export interface ClipboardSnapshot {
  text: string;
  html: string | null;
  types: string[];
}

/** Mode pushed to the focused clipboard watcher. */
export interface WatchConfig {
  mode: Mode;
}

/** Extension runtime operations and their direction-specific payloads. */
export type ExtensionMessage = { type: 'watch-config'; config: WatchConfig | null } | { type: 'offscreen-blur' };

/** Whether a value has named payload fields. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Validates the mode supplied to the coordinator. */
function isWatchConfig(value: unknown): value is WatchConfig {
  return (
    isRecord(value) && typeof value.mode === 'string' && ['decoy', 'silly', 'hybrid', 'strip'].includes(value.mode)
  );
}

/** Validates every known runtime payload before its receiver acts. */
export function isExtensionMessage(value: unknown): value is ExtensionMessage {
  if (!isRecord(value)) return false;
  switch (value.type) {
    case 'watch-config':
      return value.config === null || isWatchConfig(value.config);
    case 'offscreen-blur':
      return true;
    default:
      return false;
  }
}

/** Only this extension's worker may control the offscreen clipboard. */
export function isWorkerSender(sender: chrome.runtime.MessageSender): boolean {
  return (
    sender.id === chrome.runtime.id &&
    sender.tab === undefined &&
    (sender.url === undefined || sender.url === chrome.runtime.getURL('background.js'))
  );
}
