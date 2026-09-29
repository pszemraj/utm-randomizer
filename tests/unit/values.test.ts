import { describe, expect, it } from 'vitest';
import type { Category } from '../../src/lib/params';
import { createSecret, pick, seededRandom } from '../../src/lib/prng';
import { isWordy, replacementValue, scrambleLike } from '../../src/lib/values';

const CATEGORIES: Category[] = ['source', 'medium', 'campaign', 'term', 'content', 'generic', 'id'];
const PIECES = ['a', 'Z', '7', '0', 'f', 'B', '-', '_', '.', '%3D', '%2C', '~', 'q', 'X9'];

/** A random raw value built from letters, digits, separators, and percent-escapes. */
function randomRaw(random: () => number): string {
  let raw = '';
  const length = 1 + Math.floor(random() * 30);
  for (let i = 0; i < length; i += 1) {
    raw += pick(random, PIECES);
  }
  return raw;
}

describe('seededRandom', () => {
  it('is deterministic per seed and differs across seeds', () => {
    const first = seededRandom('seed');
    const second = seededRandom('seed');
    const other = seededRandom('other');
    const a = Array.from({ length: 5 }, first);
    expect(Array.from({ length: 5 }, second)).toEqual(a);
    expect(Array.from({ length: 5 }, other)).not.toEqual(a);
    expect(a.every((value) => value >= 0 && value < 1)).toBe(true);
  });

  it('creates distinct URL-safe secrets', () => {
    const secrets = new Set(Array.from({ length: 50 }, createSecret));
    expect(secrets.size).toBe(50);
    for (const secret of secrets) {
      expect(secret).toMatch(/^[A-Za-z0-9_-]{32}$/);
    }
  });
});

describe('scrambleLike', () => {
  const random = seededRandom('scramble');

  it('keeps length, prefix, separators, and percent-escapes', () => {
    const raw = 'IwAR3xYz_123-AbC%3D%3D';
    const scrambled = scrambleLike(raw, random);
    expect(scrambled).toHaveLength(raw.length);
    expect(scrambled.startsWith('IwAR')).toBe(true);
    expect(scrambled.endsWith('%3D%3D')).toBe(true);
    expect(scrambled.replace(/[A-Za-z0-9]/g, '#')).toBe(raw.replace(/[A-Za-z0-9]/g, '#'));
  });

  it('keeps hexadecimal values hexadecimal and numbers free of leading zeros', () => {
    for (let i = 0; i < 200; i += 1) {
      expect(scrambleLike('3f2a9c0b1d4e5f60718293a4b5c6d7e8', random)).toMatch(/^3f2a[0-9a-f]{28}$/);
      expect(scrambleLike('9F8E7D6C', random)).toMatch(/^[0-9A-F]{8}$/);
      expect(scrambleLike('123456789', random)).toMatch(/^1[0-9]{8}$/);
    }
  });

  it('never turns a non-hexadecimal value into a hexadecimal-looking one', () => {
    for (let i = 0; i < 2000; i += 1) {
      expect(scrambleLike('2X9Z', random)).not.toMatch(/^[0-9A-F]+$/);
    }
  });
});

describe('replacementValue', () => {
  it('gives believable words for word values and scrambles identifiers', () => {
    expect(isWordy(replacementValue('decoy', 'source', 'newsletter', 'seed'))).toBe(true);
    expect(isWordy(replacementValue('decoy', 'campaign', 'spring_sale', 'seed'))).toBe(true);
    expect(replacementValue('decoy', 'source', '1', 'seed')).toMatch(/^[0-9]$/);
    expect(replacementValue('decoy', 'id', 'abcdef', 'seed')).toMatch(/^[a-z]{6}$/);
  });

  it('only produces URL-safe values', () => {
    for (let i = 0; i < 2000; i += 1) {
      for (const category of CATEGORIES) {
        for (const style of ['decoy', 'silly', 'hybrid'] as const) {
          expect(replacementValue(style, category, 'newsletter', `seed-${String(i)}`)).toMatch(/^[A-Za-z0-9_.+~-]+$/);
        }
      }
    }
  });

  it('returns the same value when fed its own output (fuzzed)', () => {
    const random = seededRandom('fuzz');
    for (let i = 0; i < 20_000; i += 1) {
      const raw = randomRaw(random);
      const category = pick(random, CATEGORIES);
      const style = pick(random, ['decoy', 'silly', 'hybrid'] as const);
      const seed = `seed-${String(i % 97)}`;
      const once = replacementValue(style, category, raw, seed);
      expect(replacementValue(style, category, once, seed), `${style} ${category} ${raw} -> ${once}`).toBe(once);
    }
  });
});
