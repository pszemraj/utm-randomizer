import { describe, expect, it } from 'vitest';
import { funnyValue, generateToken, isAlreadyRandomized } from '../../src/lib/randomizer';

describe('generateToken', () => {
  it('builds 2-4 phrases plus a short alphanumeric suffix', () => {
    for (const original of ['abc', 'IwAR3xyz123', 'x'.repeat(200)]) {
      const token = generateToken(original);
      expect(token).toMatch(/^[a-z0-9-]+-[a-z0-9]{4,10}$/);
      expect(token).not.toBe(original);
    }
  });
});

describe('isAlreadyRandomized', () => {
  it('recognizes every generated value, including phrases with digits (magic-8-ball)', () => {
    for (let i = 0; i < 5000; i += 1) {
      const token = generateToken('abc123');
      expect(isAlreadyRandomized(token), token).toBe(true);
    }
    expect(isAlreadyRandomized('magic-8-ball-cookie-crumbler-abc123')).toBe(true);
    expect(isAlreadyRandomized('cookie-crumbler-magic-8-ball-zz99')).toBe(true);
  });

  it('recognizes category values', () => {
    for (const category of ['source', 'medium', 'campaign', 'term', 'content', 'generic'] as const) {
      for (let i = 0; i < 50; i += 1) {
        expect(isAlreadyRandomized(funnyValue(category, 'original'))).toBe(true);
      }
    }
  });

  it.each([
    'facebook',
    'cpc',
    'spring_sale',
    'IwAR3abc123xyz',
    'abc123',
    'single',
    'unknown-words-test-abc123',
    'cookie-crumbler-',
    'cookie-crumbler-ab',
    'cookie-crumbler-mystery-tour-ABC123',
    '',
  ])('does not claim real value %j', (value) => {
    expect(isAlreadyRandomized(value)).toBe(false);
  });
});
