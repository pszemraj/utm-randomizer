require('ts-node').register({
  transpileOnly: true,
  compilerOptions: { module: 'CommonJS' },
});

require('./utm-randomizer.test.ts');
