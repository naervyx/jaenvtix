#!/usr/bin/env node

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const mochaBin = require.resolve('mocha/bin/mocha');
const mochaArgs = [
  '--color',
  '--reporter',
  'spec',
  '--ui',
  'tdd',
  '--require',
  path.resolve('out', 'test', 'setup.js'),
  'out/test/**/*.test.js'
];

const result = spawnSync(process.execPath, [mochaBin, ...mochaArgs], {
  stdio: 'inherit',
  env: {
    ...process.env,
    JAENVTIX_SKIP_INTEGRATION_TESTS: '1'
  }
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

if (typeof result.status === 'number') {
  process.exit(result.status);
}

if (result.signal) {
  try {
    process.kill(process.pid, result.signal);
  } catch (signalError) {
    console.error(signalError);
  }
}

process.exit(1);
