/** Timing shared by the clipboard watcher, the worker, and their tests. */

/** Focus-check interval while cleaning is enabled, and the clipboard-poll interval while Chrome is focused. */
export const POLL_MS = 200;
/** Clipboard characters an ordinary poll may re-read per millisecond. */
export const REREAD_CHARS_PER_MS = 1;
/** How long the success badge stays visible. */
export const CONFIRMATION_MS = 1800;
/** Silence from an enabled watcher after which its clipboard read is suspected to be blocked. */
export const STALL_MS = 5000;
/** Further silence that confirms a stall, so a resumed system's first late check is not reported. */
export const STALL_CONFIRM_MS = 2000;

/** Wait before an ordinary poll re-reads clipboard text of this length; zero keeps the poll cadence. */
export function rereadPause(length: number): number {
  const pause = length / REREAD_CHARS_PER_MS;
  return pause > POLL_MS ? pause : 0;
}
