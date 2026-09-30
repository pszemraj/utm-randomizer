import { withoutTracking } from './rewrite';

/** How long after a rewrite another tracked version of the same link is left alone. */
export const LOOP_GUARD_MS = 5_000;

/**
 * Keeps clipboard watchers that disagree (a stale key or mode, another extension) from rewriting
 * each other's output forever. For a few seconds after a watcher rewrites a link, a different
 * tracked version of that link is taken to be another watcher's rewrite and left alone. A fresh
 * copy of the original text is not: the user copied the tracked link again, so it is rewritten again.
 */
export interface LoopGuard {
  /** Whether `text` looks like another watcher's rewrite of the link rewritten last, and must be left alone. */
  blocks(text: string): boolean;
  /** Records that `original` was just rewritten to `rewritten`. */
  record(original: string, rewritten: string): void;
}

/**
 * Creates a {@link LoopGuard} for one watcher.
 *
 * @param now Current time in milliseconds.
 * @param baseUrl Resolves relative links, as `RewriteOptions.baseUrl` does.
 */
export function createLoopGuard(now: () => number, baseUrl?: () => string): LoopGuard {
  let last: { original: string; link: string; at: number } | null = null;
  return {
    blocks(text) {
      return (
        last !== null &&
        now() - last.at < LOOP_GUARD_MS &&
        text !== last.original &&
        withoutTracking(text, baseUrl?.()) === last.link
      );
    },
    record(original, rewritten) {
      last = { original, link: withoutTracking(rewritten, baseUrl?.()), at: now() };
    },
  };
}
