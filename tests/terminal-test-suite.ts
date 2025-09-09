// terminal-test-suite.ts - Standalone CLI testing tool
import { randomizeUTMParameters, sanitizeUrl } from '../src/utm-randomizer';

// Test data
const TEST_URLS = [
  {
    name: 'Standard UTM parameters',
    url: 'https://example.com?utm_source=facebook&utm_medium=social&utm_campaign=spring_sale',
    shouldChange: true
  },
  {
    name: 'Address bar URL with UTM',
    url: 'https://github.com/user/repo?utm_source=google&utm_medium=cpc',
    shouldChange: true
  },
  {
    name: 'Facebook tracking',
    url: 'https://example.com?fbclid=IwAsdFfake123&fb_source=feed',
    shouldChange: true
  },
  {
    name: 'Google click ID',
    url: 'https://shop.com/product?gclid=Cj0KCQiA&price=99',
    shouldChange: true
  },
  {
    name: 'No tracking parameters',
    url: 'https://example.com/page?id=123&category=tech',
    shouldChange: false
  },
  {
    name: 'Mixed parameters',
    url: 'https://site.com?id=42&utm_source=twitter&color=blue&utm_medium=social',
    shouldChange: true
  },
  {
    name: 'Malformed URL',
    url: 'not-a-valid-url-at-all',
    shouldChange: false
  },
  {
    name: 'URL with fragment',
    url: 'https://docs.com/guide?utm_source=email#section-2',
    shouldChange: true
  },
  {
    name: 'Mailchimp tracking',
    url: 'https://newsletter.com?mc_cid=abc123&mc_eid=def456',
    shouldChange: true
  },
  {
    name: 'Multiple tracking vendors',
    url: 'https://site.com?utm_source=fb&fbclid=xyz&gclid=abc&_ga=123',
    shouldChange: true
  }
];

// Color-coded console output helpers
const log = {
  success: (msg: string) => console.log('\x1b[32m✓\x1b[0m', msg),
  error: (msg: string) => console.log('\x1b[31m✗\x1b[0m', msg),
  info: (msg: string) => console.log('\x1b[34mℹ\x1b[0m', msg),
  warning: (msg: string) => console.log('\x1b[33m⚠\x1b[0m', msg),
  result: (original: string, randomized: string) => {
    console.log('\x1b[90mOriginal:  \x1b[0m', original);
    console.log('\x1b[32mRandomized:\x1b[0m', randomized);
  }
};

// Simple test runner
export function runTests() {
  console.log('\n\x1b[36m🧪 UTM Randomizer - Test Suite\x1b[0m\n');
  
  let passed = 0;
  let failed = 0;
  
  TEST_URLS.forEach(test => {
    const randomized = randomizeUTMParameters(test.url);
    const changed = randomized !== test.url;
    const success = changed === test.shouldChange;
    
    if (success) {
      log.success(test.name);
      if (changed) {
        console.log(`   \x1b[90m${test.url.substring(0, 60)}...\x1b[0m`);
        console.log(`   \x1b[32m${randomized.substring(0, 60)}...\x1b[0m`);
      }
      passed++;
    } else {
      log.error(test.name);
      console.log(`   \x1b[31mExpected ${test.shouldChange ? 'change' : 'no change'}, but got ${changed ? 'change' : 'no change'}\x1b[0m`);
      failed++;
    }
  });
  
  console.log(`\n\x1b[1m📊 Results: \x1b[32m${passed} passed\x1b[0m, \x1b[31m${failed} failed\x1b[0m\n`);
  
  // Test sanitizeUrl function
  console.log('\x1b[36m🧹 Testing sanitizeUrl function:\x1b[0m');
  
  const sanitizeTests = [
    { input: 'example.com', expected: 'https://example.com' },
    { input: 'http://example.com', expected: 'http://example.com' },
    { input: '  https://example.com  ', expected: 'https://example.com' },
    { input: 'invalid:::url', expected: 'invalid:::url' }
  ];
  
  sanitizeTests.forEach(test => {
    const result = sanitizeUrl(test.input);
    if (result === test.expected) {
      log.success(`sanitizeUrl("${test.input}") = "${result}"`);
    } else {
      log.error(`sanitizeUrl("${test.input}") = "${result}" (expected: "${test.expected}")`);
    }
  });
  
  // Performance benchmark
  console.log('\n\x1b[36m⚡ Performance Benchmark:\x1b[0m');
  const iterations = 10000;
  const testUrl = 'https://example.com?utm_source=facebook&utm_medium=social&utm_campaign=test';
  
  const start = Date.now();
  for (let i = 0; i < iterations; i++) {
    randomizeUTMParameters(testUrl);
  }
  const duration = Date.now() - start;
  
  console.log(`Processed ${iterations.toLocaleString()} URLs in ${duration}ms`);
  console.log(`Average: ${(duration / iterations).toFixed(3)}ms per URL`);
  console.log(`Throughput: ${Math.round((iterations / duration) * 1000).toLocaleString()} URLs/second`);
  
  return failed === 0;
}

// Run tests if executed directly
if (require.main === module) {
  const success = runTests();
  process.exit(success ? 0 : 1);
}