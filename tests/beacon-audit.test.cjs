'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const appSource = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].find(m => m[1].includes('function computeDraw'))[1].replace(/\binit\(\);\s*$/, '');
const bundle = fs.readFileSync(path.join(root, 'vendor/beacon-verifier.js'), 'utf8');
const realProof = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/drand-quicknet-round42.json'), 'utf8'));
const chainInfo = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/drand-quicknet-info.json'), 'utf8'));
const H = value => crypto.createHash('sha256').update(value).digest('hex');
const clone = value => JSON.parse(JSON.stringify(value));
const iso = ms => new Date(ms).toISOString();

function context(withCrypto = true) {
  const ctx = vm.createContext({ TextEncoder, TextDecoder, Uint8Array, Uint32Array, Int16Array, DataView, crypto: crypto.webcrypto, document: { querySelector: () => null }, setTimeout, clearTimeout });
  if (withCrypto) vm.runInContext(bundle, ctx, { timeout: 2000 });
  vm.runInContext(appSource, ctx, { timeout: 2000 });
  return ctx;
}
const ctx = context();
function check(a, runtime = ctx) {
  runtime.input = a;
  return vm.runInContext('verifyAudit(input)', runtime, { timeout: 3000 });
}
function checksum(a) {
  delete a.integrity;
  a.integrity = { method: 'SHA-256 of JSON.stringify(this object without "integrity"), no whitespace', sha256: H(JSON.stringify(a)) };
  return a;
}
function fixture({ pending = false, draws = 2 } = {}) {
  const scheduled = (chainInfo.genesis_time + (realProof.round - 1) * chainInfo.period) * 1000;
  const seed = '1a'.repeat(32), entries = ['Ava', 'Noah', 'Mia', 'Zoé'], listHash = H(entries.join('\n'));
  const entropy = pending ? '' : `drand:quicknet:${chainInfo.hash}:${realProof.round}:${realProof.randomness}`;
  const a = {
    format: 'fairspin-audit', version: 2, generatedAt: iso(scheduled + 10000),
    tool: { name: 'FairSpin' }, session: { id: 'abcd1234', createdAt: iso(scheduled - 120000) }, algorithm: {},
    list: { source: 'synthetic beacon test', count: entries.length, options: { dedupe: false, caseInsensitive: false }, duplicatesRemoved: 0, sha256: listHash, entries },
    commitment: { committedAt: iso(scheduled - 60000), listSha256: listHash, seedSha256: H(Buffer.from(seed, 'hex')), winnersTarget: 2, removeWinners: true, beacon: { provider: 'drand-quicknet', chainHash: chainInfo.hash, publicKey: chainInfo.public_key, scheme: chainInfo.schemeID, round: realProof.round, scheduledAt: iso(scheduled) } },
    entropy: { value: entropy, note: 'drand quicknet round 42', enteredAt: pending ? null : iso(scheduled + 2000), lockedAt: pending || !draws ? null : iso(scheduled + 3000), beacon: pending ? null : clone(realProof) },
    draws: [], reveal: { seed, revealedAt: iso(scheduled + 10000) }, events: [],
  };
  const taken = new Set();
  for (let n = 1; !pending && n <= draws; n++) {
    const pool = entries.map((_, i) => i).filter(i => !taken.has(i)), limit = Math.floor(2 ** 32 / pool.length) * pool.length;
    let ctr = 0, digest, r;
    do {
      digest = crypto.createHmac('sha256', Buffer.from(seed, 'hex')).update(`fairspin/v1|list:${listHash}|entropy:${entropy}|draw:${n}|ctr:${ctr}`).digest();
      r = digest.readUInt32BE(); if (r < limit) break; ctr++;
    } while (ctr < 10000);
    const poolIndex = r % pool.length, entryIndex = pool[poolIndex];
    a.draws.push({ n, at: iso(scheduled + 3000 + n * 1000), poolSize: pool.length, poolSha256: H(pool.map(i => entries[i]).join('\n')), ctr, uint32: r, hmac: digest.toString('hex'), poolIndex, entryIndex, winner: entries[entryIndex], anim: { durationMs: 7000, turns: 6 + digest[6] % 4, frac: +(0.18 + 0.64 * digest.readUInt16BE(4) / 65535).toFixed(6) } });
    taken.add(entryIndex);
  }
  return checksum(a);
}

test('automatic audit verifies a real pinned beacon and independently computed draws', () => {
  const result = check(fixture());
  assert.equal(result.ok, true);
  assert.equal(result.results.length, 2);
  assert.ok(result.C.some(c => c.ok && /signature matches/.test(c.title)));
});

test('pending automatic commitments verify as pending with no draws or entropy', () => {
  const a = fixture({ pending: true });
  const result = check(a);
  assert.equal(result.ok, true);
  assert.equal(result.results.length, 0);
  assert.ok(result.C.some(c => c.ok === null && /Waiting for committed drand/.test(c.title)));
  a.entropy.value = 'unverified value'; checksum(a);
  assert.equal(check(a).ok, false);
});

test('an arrived beacon before the first spin verifies without locking entropy prematurely', () => {
  assert.equal(check(fixture({ draws: 0 })).ok, true);
});

const tampering = {
  'missing beacon commitment': a => { delete a.commitment.beacon; },
  'missing beacon proof': a => { delete a.entropy.beacon; },
  'pending beacon with recorded draws': a => { a.entropy.beacon = null; },
  'different chain': a => { a.commitment.beacon.chainHash = '00'.repeat(32); },
  'different public key': a => { a.commitment.beacon.publicKey = '00'.repeat(96); },
  'different scheme': a => { a.commitment.beacon.scheme = 'bls-unchained-on-g1'; },
  'different provider': a => { a.commitment.beacon.provider = 'unknown'; },
  'different committed round': a => { a.commitment.beacon.round++; },
  'different proof round': a => { a.entropy.beacon.round++; },
  'string round': a => { a.commitment.beacon.round = String(a.commitment.beacon.round); },
  'round outside the supported schedule': a => { a.commitment.beacon.round = Number.MAX_SAFE_INTEGER; },
  'nonfuture beacon': a => { a.commitment.committedAt = a.commitment.beacon.scheduledAt; },
  'changed schedule': a => { a.commitment.beacon.scheduledAt = iso(Date.parse(a.commitment.beacon.scheduledAt) + 1000); },
  'received before publication': a => { a.entropy.enteredAt = iso(Date.parse(a.commitment.beacon.scheduledAt) - 1000); },
  'different canonical entropy': a => { a.entropy.value += 'x'; },
  'truncated signature': a => { a.entropy.beacon.signature = a.entropy.beacon.signature.slice(2); },
  'invalid signature with matching randomness': a => {
    a.entropy.beacon.signature = '00'.repeat(48);
    a.entropy.beacon.randomness = H(Buffer.from(a.entropy.beacon.signature, 'hex'));
    a.entropy.value = `drand:quicknet:${chainInfo.hash}:${realProof.round}:${a.entropy.beacon.randomness}`;
  },
  'version downgrade with proof': a => { a.version = 1; },
  'version downgrade with proof stripped': a => { a.version = 1; delete a.commitment.beacon; delete a.entropy.beacon; },
};
for (const [name, mutate] of Object.entries(tampering)) {
  test(`automatic verification rejects ${name} even with a recomputed checksum`, () => {
    const a = fixture(); mutate(a); checksum(a);
    assert.equal(check(a).ok, false);
    assert.equal(check(a).results.length, 0);
  });
}

test('automatic verification fails closed when the bundled verifier is unavailable', () => {
  assert.equal(check(fixture(), context(false)).ok, false);
});

test('Python independently checks v2 draw math and delegates only BLS proof verification offline', () => {
  const cases = [{ a: fixture(), expected: true }, { a: fixture({ pending: true }), expected: true }, { a: fixture({ draws: 0 }), expected: true }];
  for (const mutate of Object.values(tampering)) { const a = fixture(); mutate(a); checksum(a); cases.push({ a, expected: false }); }
  const code = ['import json,sys,verify', 'out=[]', 'for case in json.load(sys.stdin):', '    try:', '        verify.verify(case["a"])', '        out.append(True)', '    except (ValueError,TypeError,KeyError,OverflowError,RecursionError):', '        out.append(False)', 'print(json.dumps(out))'].join('\n');
  const run = spawnSync('python3', ['-B', '-O', '-c', code], { cwd: root, input: JSON.stringify(cases), encoding: 'utf8', timeout: 30000 });
  assert.equal(run.status, 0, run.stderr || String(run.error));
  assert.deepEqual(JSON.parse(run.stdout), cases.map(c => c.expected));
});

test('Python signature bridge rejects a forged proof and never accepts an unchecked result', () => {
  const run = spawnSync(process.execPath, ['scripts/verify-beacon.cjs'], { cwd: root, input: JSON.stringify({ proof: { ...realProof, round: 43 }, expectedRound: 43 }), encoding: 'utf8', timeout: 5000 });
  assert.notEqual(run.status, 0);
  assert.equal(run.stdout, '');
});
