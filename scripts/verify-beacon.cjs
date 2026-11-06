'use strict';

// Offline signature verification bridge for verify.py. No network requests.
// The browser and this helper use the same pinned, vendored cryptographic code.
const fs = require('node:fs');
const path = require('node:path');

try {
  const bytes = Buffer.alloc(32769);
  let length = 0, read;
  while (length < bytes.length && (read = fs.readSync(0, bytes, length, bytes.length - length, null)) > 0) length += read;
  if (length > 32768) throw new Error('Beacon proof input is too large');
  const request = JSON.parse(bytes.subarray(0, length).toString('utf8'));
  if (!request || !Number.isSafeInteger(request.expectedRound) || request.expectedRound < 1) throw new Error('Invalid expected round');
  require(path.join(__dirname, '..', 'vendor', 'beacon-verifier.js'));
  if (!globalThis.FairSpinBeacon || globalThis.FairSpinBeacon.verify(request.proof, request.expectedRound) !== true) throw new Error('Invalid drand signature, randomness, or round');
  process.stdout.write('{"ok":true}\n');
} catch (error) {
  process.stderr.write(`Beacon verification failed: ${error.message}\n`);
  process.exitCode = 1;
}
