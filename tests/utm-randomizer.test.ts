import assert from 'node:assert/strict';
import { hasTrackingParameters, randomizeTrackingParameters } from '../src/utm-randomizer';

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
