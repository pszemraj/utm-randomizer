import assert from 'node:assert/strict';
import { hasTrackingParameters, randomizeTrackingParameters, isAlreadyRandomized } from '../src/utm-randomizer';

type TestCase = {
  name: string;
  run: () => void | Promise<void>;
};

const tests: TestCase[] = [
  {
    name: 'randomizes standard UTM parameters',
    run: () => {
      const original =
        'https://example.com?utm_source=aaaa&utm_medium=bbbb&utm_campaign=cccc&utm_term=dddd&utm_content=eeee';
      const randomized = randomizeTrackingParameters(original);

      assert.notStrictEqual(randomized, original, 'URL should change when tracking params are present');
      const params = new URL(randomized).searchParams;
      assert.ok(params.get('utm_source'), 'utm_source should remain present');
      assert.notStrictEqual(params.get('utm_source'), 'aaaa');
      assert.notStrictEqual(params.get('utm_medium'), 'bbbb');
      assert.notStrictEqual(params.get('utm_campaign'), 'cccc');
      assert.notStrictEqual(params.get('utm_term'), 'dddd');
      assert.notStrictEqual(params.get('utm_content'), 'eeee');
    },
  },
  {
    name: 'scrambles hash-like identifiers aggressively',
    run: () => {
      const original =
        'https://example.com?fbclid=abc123&campaign_id=999999999&ad_id=ABCDEFGHIJ&utm_source=facebook';
      const randomized = randomizeTrackingParameters(original);
      assert.notStrictEqual(randomized, original);

      const params = new URL(randomized).searchParams;
      const fbclid = params.get('fbclid');
      const campaignId = params.get('campaign_id');
      const adId = params.get('ad_id');

      assert.ok(fbclid, 'fbclid should remain present');
      assert.notStrictEqual(fbclid, 'abc123');
      assert.ok(fbclid?.includes('-'), 'fbclid should contain hyphenated phrases');

      assert.ok(campaignId);
      assert.notStrictEqual(campaignId, '999999999');
      assert.ok(/\D/.test(campaignId ?? ''), 'campaign_id should contain non-digit characters');

      assert.ok(adId);
      assert.notStrictEqual(adId, 'ABCDEFGHIJ');
      assert.ok(adId?.includes('-'), 'ad_id should contain hyphenated phrases');
    },
  },
  {
    name: 'detects tracking parameters reliably',
    run: () => {
      const tracked =
        'https://news.example/article?utm_source=twitter&emc=edit_nn_20250915&smid=nytcore-ios-share&foo=bar';
      const clean = 'https://example.com/page?id=123&category=tech';

      assert.strictEqual(hasTrackingParameters(tracked), true);
      assert.strictEqual(hasTrackingParameters(clean), false);

      const randomized = randomizeTrackingParameters(tracked);
      assert.strictEqual(hasTrackingParameters(randomized), true, 'keys remain detectable after scrambling');
    },
  },
  {
    name: 'leaves non-tracking URLs untouched',
    run: () => {
      const original = 'https://example.com/path?foo=bar&baz=qux#section';
      const randomized = randomizeTrackingParameters(original);
      assert.strictEqual(randomized, original);
    },
  },
  {
    name: 'does not re-randomize already randomized URLs (idempotency)',
    run: () => {
      const original = 'https://example.com?utm_source=facebook&utm_medium=social&fbclid=abc123';
      const firstPass = randomizeTrackingParameters(original);

      // Verify first pass changed the URL
      assert.notStrictEqual(firstPass, original, 'First randomization should change URL');

      // Second pass should return identical result (no re-randomization)
      const secondPass = randomizeTrackingParameters(firstPass);
      assert.strictEqual(secondPass, firstPass, 'Already randomized URL should not change');
    },
  },
  {
    name: 'isAlreadyRandomized detects funny category values',
    run: () => {
      // Known funny values from FUNNY_* arrays
      assert.strictEqual(isAlreadyRandomized('definitely-not-facebook'), true);
      assert.strictEqual(isAlreadyRandomized('smoke-signals'), true);
      assert.strictEqual(isAlreadyRandomized('operation-click-bait'), true);
      assert.strictEqual(isAlreadyRandomized('unicorn-tears'), true);
      assert.strictEqual(isAlreadyRandomized('banner-of-shame'), true);
      assert.strictEqual(isAlreadyRandomized('nope-not-today'), true);

      // Real tracking values should not be detected as randomized
      assert.strictEqual(isAlreadyRandomized('facebook'), false);
      assert.strictEqual(isAlreadyRandomized('cpc'), false);
      assert.strictEqual(isAlreadyRandomized('spring_sale'), false);
      assert.strictEqual(isAlreadyRandomized('IwAR3abc123xyz'), false);
    },
  },
  {
    name: 'isAlreadyRandomized detects hash token patterns',
    run: () => {
      // Valid hash token patterns containing known FUNNY_WORD_BANK phrases
      // These use hyphenated phrases from the word bank
      assert.strictEqual(isAlreadyRandomized('cookie-crumbler-mystery-tour-abc123'), true);
      assert.strictEqual(isAlreadyRandomized('tracking-troll-nope-not-today-xyz789'), true);
      assert.strictEqual(isAlreadyRandomized('ad-tech-exorcism-botnet-ballet-abcd1234'), true);

      // Invalid patterns (no known phrases or wrong structure)
      assert.strictEqual(isAlreadyRandomized('abc123'), false);
      assert.strictEqual(isAlreadyRandomized('single'), false);
      assert.strictEqual(isAlreadyRandomized('unknown-words-test-abc123'), false);
      assert.strictEqual(isAlreadyRandomized('IwAR3abc123xyz789def'), false);
    },
  },
];

async function runTests() {
  let failed = false;
  for (const test of tests) {
    try {
      await test.run();
      console.log(`✓ ${test.name}`);
    } catch (error) {
      failed = true;
      console.error(`✗ ${test.name}`);
      console.error(error);
      break;
    }
  }

  if (failed) {
    process.exitCode = 1;
    throw new Error('Tests failed');
  } else {
    console.log(`\n${tests.length} tests passed`);
  }
}

runTests();
