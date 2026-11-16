/** Messages exchanged between the worker and offscreen clipboard coordinator. */
import type { Mode } from './rewrite';
import { isMode } from './settings';

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

/** Message types addressed to the clipboard coordinator; every other type is addressed to the worker. */
const COORDINATOR_TYPES: readonly unknown[] = ['watch-config', 'watch-flush'] satisfies ExtensionMessage['type'][];

/** Messages the worker sends to the clipboard coordinator. */
export type CoordinatorMessage = Extract<ExtensionMessage, { type: 'watch-config' | 'watch-flush' }>;

/** Messages the clipboard coordinator sends to the worker. */
export type WorkerMessage = Exclude<ExtensionMessage, CoordinatorMessage>;

/** Whether a value has named payload fields. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Validates the mode supplied to the coordinator. */
function isWatchConfig(value: unknown): value is WatchConfig {
  return isRecord(value) && typeof value.focused === 'boolean' && isMode(value.mode);
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

/** Whether a payload names a coordinator operation, valid or not, so the coordinator answers it and ignores the rest. */
export function addressesCoordinator(value: unknown): boolean {
  return isRecord(value) && COORDINATOR_TYPES.includes(value.type);
}

/** Validates a payload the coordinator may act on. */
export function isCoordinatorMessage(value: unknown): value is CoordinatorMessage {
  return isExtensionMessage(value) && addressesCoordinator(value);
}

/** Validates a payload the worker may act on. */
export function isWorkerMessage(value: unknown): value is WorkerMessage {
  return isExtensionMessage(value) && !addressesCoordinator(value);
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
