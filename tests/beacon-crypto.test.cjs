'use strict';

// The tests execute the checked-in browser bundle; no npm install is required.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const bundle = fs.readFileSync(path.join(__dirname, '..', 'vendor', 'beacon-verifier.js'), 'utf8');
const proof = require('./fixtures/drand-quicknet-round42.json');
const info = require('./fixtures/drand-quicknet-info.json');
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');

function fresh() {
  const context = vm.createContext({});
  // No crypto, fetch, XMLHttpRequest, navigator, DOM, require, or WebCrypto is
  // supplied. Verification must remain fully synchronous and offline.
  vm.runInContext(bundle, context, { timeout: 3000 });
  return context.FairSpinBeacon;
}

test('bundled verifier pins the official quicknet chain and verifies its historical round', () => {
  const beacon = fresh();
  assert.equal(beacon.QUICKNET.chainHash, info.hash);
  assert.equal(beacon.QUICKNET.publicKey, info.public_key);
  assert.equal(beacon.QUICKNET.genesisTime, info.genesis_time);
  assert.equal(beacon.QUICKNET.period, info.period);
  assert.equal(beacon.QUICKNET.scheme, info.schemeID);
  assert.equal(beacon.verify(proof, 42), true);
  assert.equal(beacon.randomness(proof.signature), proof.randomness);
  assert.equal(sha256(Buffer.from(proof.signature, 'hex')), proof.randomness);
  assert.ok(Object.isFrozen(beacon));
  assert.ok(Object.isFrozen(beacon.QUICKNET));
});

test('signature must be valid for exactly the committed round', () => {
  const beacon = fresh();
  assert.equal(beacon.verify(proof, 43), false);
  assert.equal(beacon.verify({ ...proof, round: 43 }, 43), false, 'round mismatch is checked cryptographically as well as by field equality');
  assert.equal(beacon.verify({ ...proof, round: 41 }, 41), false);
  assert.equal(beacon.verify(proof, 42), true);
});

test('changed signatures fail even after an attacker recomputes their randomness hash', () => {
  const beacon = fresh();
  for (const signature of [
    proof.signature.slice(0, -2) + (proof.signature.endsWith('00') ? '01' : '00'),
    '00'.repeat(48),
    'c0' + '00'.repeat(47), // compressed point at infinity
    'ff'.repeat(48),
  ]) {
    const randomness = sha256(Buffer.from(signature, 'hex'));
    assert.equal(beacon.verify({ ...proof, signature, randomness }, 42), false);
  }
});

test('audit-provided network identity cannot override the trusted quicknet pins', () => {
  const beacon = fresh();
  assert.equal(beacon.verify({ ...proof, ...beacon.QUICKNET }, 42), true);
  for (const [field, bad] of [
    ['chainHash', '00'.repeat(32)], ['publicKey', '00'.repeat(96)],
    ['genesisTime', info.genesis_time + 1], ['period', 30],
    ['scheme', 'bls-unchained-on-g1'], ['previous_signature', '00'.repeat(96)],
  ]) assert.equal(beacon.verify({ ...proof, [field]: bad }, 42), false, field);
});

test('malformed and noncanonical proofs fail closed without exceptions', () => {
  const beacon = fresh();
  for (const candidate of [
    null, [], {}, 42, 'not a proof',
    { ...proof, round: '42' }, { ...proof, round: 42.5 },
    { ...proof, signature: proof.signature.toUpperCase() },
    { ...proof, signature: proof.signature + '00' },
    { ...proof, signature: 'z'.repeat(96) },
    { ...proof, signature: { hex: proof.signature } },
    { ...proof, randomness: proof.randomness.toUpperCase() },
    { ...proof, randomness: '00'.repeat(32) },
    { ...proof, randomness: null },
  ]) assert.equal(beacon.verify(candidate, 42), false);
  for (const round of [undefined, null, '42', 0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(beacon.verify({ ...proof, round }, round), false);
  }
  assert.throws(() => beacon.randomness('not hex'));
});

test('successful-result cache does not bypass identity or randomness validation', () => {
  const beacon = fresh();
  assert.equal(beacon.verify(proof, 42), true);
  assert.equal(beacon.verify(proof, 42), true);
  assert.equal(beacon.verify({ ...proof, chainHash: '00'.repeat(32) }, 42), false);
  assert.equal(beacon.verify({ ...proof, randomness: '00'.repeat(32) }, 42), false);
});

test('round arithmetic has explicit boundaries and uses epoch seconds', () => {
  const beacon = fresh(), genesis = beacon.QUICKNET.genesisTime;
  assert.equal(beacon.timeOfRound(1), genesis);
  assert.equal(beacon.timeOfRound(42), genesis + 41 * 3);
  assert.equal(beacon.roundAt(genesis), 1);
  assert.equal(beacon.roundAt(genesis + 2.999), 1);
  assert.equal(beacon.roundAt(genesis + 3), 2);
  assert.equal(beacon.roundAt(beacon.timeOfRound(42)), 42);
  for (const round of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER]) assert.throws(() => beacon.timeOfRound(round));
  for (const time of [genesis - 1, NaN, Infinity, '1692803367']) assert.throws(() => beacon.roundAt(time));
});

test('standalone bundle carries third-party attribution and is safe to embed as inline script', () => {
  assert.match(bundle, /The MIT License \(MIT\)/);
  assert.match(bundle, /Copyright \(c\) 2022 Paul Miller/);
  assert.match(bundle, /Required Notice: Copyright \(c\) 2026 Adrian Speyer/);
  assert.doesNotMatch(bundle, /<\/script/i);
  assert.doesNotMatch(bundle, /\beval\s*\(|new Function\s*\(/);
});
