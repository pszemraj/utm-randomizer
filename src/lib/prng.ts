/**
 * Deterministic pseudo-random numbers seeded from a string.
 *
 * Replacement values are derived from a secret per-install key and the current link values, so
 * identical inputs get identical replacements across clipboard formats and extension contexts.
 * Writers record completed changes to avoid processing their own output. This is not cryptography.
 */

/** A source of floats in [0, 1). */
export type Random = () => number;

/** cyrb128: hashes a string into four 32-bit words. */
function hash128(input: string): [number, number, number, number] {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < input.length; i += 1) {
    const k = input.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

/** Compacts a link invariant once, before deriving the seeds for its individual parameters. */
export function compactSeed(input: string): string {
  return hash128(input)
    .map((word) => word.toString(16).padStart(8, '0'))
    .join('');
}

/** A generator (sfc32) whose sequence depends only on `seed`. */
export function seededRandom(seed: string): Random {
  let [a, b, c, d] = hash128(seed);
  return () => {
    a >>>= 0;
    b >>>= 0;
    c >>>= 0;
    d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

/** An integer in [0, max). */
export function randomInt(random: Random, max: number): number {
  return Math.floor(random() * max);
}

/** An element of a non-empty list. */
export function pick<T>(random: Random, items: readonly T[]): T {
  const item = items[randomInt(random, items.length)];
  if (item === undefined) {
    throw new RangeError('Cannot pick from an empty list');
  }
  return item;
}

/** A fresh random per-install key (base64url), used to seed replacement values. */
export function createSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
