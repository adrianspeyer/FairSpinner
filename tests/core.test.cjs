'use strict';

// No dependencies or build step: node --test tests/core.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)];
const source = scripts.find((match) => match[1].includes('function computeDraw'))[1];
assert.match(source, /\binit\(\);\s*$/);
const context = vm.createContext({
  TextEncoder, TextDecoder, Uint8Array, Uint32Array, Int16Array, DataView,
  crypto: crypto.webcrypto,
  document: { querySelector: () => null },
  setTimeout, clearTimeout,
});
vm.runInContext(source.replace(/\binit\(\);\s*$/, ''), context, { timeout: 2000 });
const call = (expression, value) => {
  context.testInput = value;
  return vm.runInContext(expression, context, { timeout: 3000 });
};
const plain = (value) => JSON.parse(JSON.stringify(value));
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const seed = '00'.repeat(32);

function sign(audit) {
  delete audit.integrity;
  audit.integrity = {
    method: 'SHA-256 of JSON.stringify(this object without "integrity"), no whitespace',
    sha256: hash(JSON.stringify(audit)),
  };
  return audit;
}

function fixture({ entries = ['Ava', 'Noah', 'Mia', 'Zoé'], sequence = [1, 2], remove = true, target = 2 } = {}) {
  const listHash = hash(entries.join('\n'));
  const a = {
    format: 'fairspin-audit', version: 1, generatedAt: '2026-11-06T18:10:00.000Z',
    tool: { name: 'FairSpin', runtime: 'single local HTML file, offline', userTimezone: 'UTC' },
    session: { id: '1234abcd', createdAt: '2026-11-06T18:00:00.000Z' },
    algorithm: {
      listHash: 'SHA-256 of entries joined with "\\n" (UTF-8), hex',
      seedCommitment: 'SHA-256 of the 32 raw seed bytes, hex',
      draw: 'HMAC-SHA256', pool: 'original list order', animation: 'cosmetic only',
    },
    list: { source: 'test', count: entries.length, options: { dedupe: false, caseInsensitive: false }, duplicatesRemoved: 0, sha256: listHash, entries },
    commitment: { committedAt: '2026-11-06T18:01:00.000Z', listSha256: listHash, seedSha256: hash(Buffer.from(seed, 'hex')), winnersTarget: target, removeWinners: remove },
    entropy: { value: 'public value 🌀', note: 'announced future value', enteredAt: '2026-11-06T18:02:00.000Z', lockedAt: '2026-11-06T18:03:00.000Z' },
    draws: [], reveal: { seed, revealedAt: '2026-11-06T18:10:00.000Z' },
    events: [],
  };
  const taken = new Set();
  for (const [i, n] of sequence.entries()) {
    const pool = entries.map((_, j) => j).filter((j) => !remove || !taken.has(j));
    const lim = Math.floor(2 ** 32 / pool.length) * pool.length;
    let ctr = 0, digest, uint32;
    do {
      digest = crypto.createHmac('sha256', Buffer.from(seed, 'hex')).update(`fairspin/v1|list:${listHash}|entropy:${a.entropy.value}|draw:${n}|ctr:${ctr}`).digest();
      uint32 = digest.readUInt32BE();
      if (uint32 < lim) break;
      ctr++;
    } while (ctr < 10000);
    const poolIndex = uint32 % pool.length, entryIndex = pool[poolIndex];
    a.draws.push({
      n, at: `2026-11-06T18:0${4 + i}:00.000Z`, poolSize: pool.length,
      poolSha256: hash(pool.map((j) => entries[j]).join('\n')), ctr, uint32,
      hmac: digest.toString('hex'), poolIndex, entryIndex, winner: entries[entryIndex],
      anim: { durationMs: 7000, turns: 6 + (digest[6] % 4), frac: +(0.18 + 0.64 * (digest.readUInt16BE(4) / 65535)).toFixed(6) },
    });
    taken.add(entryIndex);
  }
  return sign(a);
}

function accepted(audit) {
  try { return call('verifyAudit(testInput).ok', audit) === true; }
  catch (error) {
    // A schema-validation exception also fails closed. Timeouts do not.
    if (error.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') throw error;
    return false;
  }
}

function sessionFixture() {
  const a = fixture();
  return {
    v: 1, id: a.session.id, createdAt: a.session.createdAt,
    raw: a.list.entries.join('\n'), source: a.list.source,
    opts: { dedupe: false, ci: false, target: 2, remove: true, duration: 7, sound: false },
    locked: { at: a.commitment.committedAt, entries: a.list.entries, duplicatesRemoved: 0, listHash: a.list.sha256, seed, seedHash: a.commitment.seedSha256, removeWinners: true, winnersTarget: 2, source: 'test', dedupe: false, caseInsensitive: false },
    entropy: a.entropy, draws: a.draws, events: [], exportedAt: -1,
  };
}

function stateRuntime(saved) {
  const nodes = new Map(), storage = new Map();
  if (saved !== undefined) storage.set('fairspin.session.v1', saved);
  const node = (selector) => {
    if (!nodes.has(selector)) nodes.set(selector, {
      innerHTML: '', textContent: '', value: '', hidden: true, style: {}, lastElementChild: {},
      classList: { add() {}, remove() {}, toggle() {} }, setAttribute() {}, removeAttribute() {},
      addEventListener() {}, focus() {}, getContext: () => ({ clearRect() {} }),
    });
    return nodes.get(selector);
  };
  const localStorage = { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) };
  const document = { querySelector: node, querySelectorAll: () => [], addEventListener() {}, documentElement: { dataset: { theme: 'dark' } } };
  const runtime = vm.createContext({ TextEncoder, TextDecoder, Uint8Array, Uint32Array, Int16Array, DataView, crypto: crypto.webcrypto, document, localStorage, setTimeout: () => 0, clearTimeout() {}, window: { addEventListener() {}, matchMedia: () => ({ matches: true }) }, confirm: () => true, matchMedia: () => ({ matches: true }), getComputedStyle: () => ({ getPropertyValue: () => '#000' }) });
  vm.runInContext(source.replace(/\binit\(\);\s*$/, ''), runtime, { timeout: 2000 });
  vm.runInContext('WheelView = class { setPool() {} draw() {} showResult() {} spin() { return Promise.resolve(true); } };', runtime);
  return { run: (code) => vm.runInContext(code, runtime, { timeout: 3000 }), node, storage, localStorage, runtime };
}

test('SHA-256 matches Node for Unicode and padding/block boundaries', () => {
  const values = ['', 'abc', 'Zoé 🌀\n東京', ...[55, 56, 63, 64, 65, 127, 128, 1024, 100000].map((n) => 'x'.repeat(n))];
  for (const value of values) assert.equal(call('sha256hex(testInput)', value), hash(value));
});

test('HMAC matches Node for empty, short, block-size and long keys', () => {
  for (const length of [0, 1, 32, 64, 65, 131]) {
    const key = Buffer.alloc(length, 0xaa), msg = Buffer.from('message with Unicode 🌀');
    const expected = crypto.createHmac('sha256', key).update(msg).digest('hex');
    assert.equal(call('hex(hmacSha256(new Uint8Array(testInput.key), new Uint8Array(testInput.msg)))', { key: [...key], msg: [...msg] }), expected);
  }
});

test('draws reproduce independently computed HMAC and winner', () => {
  const a = fixture();
  for (const d of a.draws) {
    const r = call('computeDraw(testInput.seed, testInput.hash, testInput.entropy, testInput.n, testInput.N)', { seed, hash: a.list.sha256, entropy: a.entropy.value, n: d.n, N: d.poolSize });
    assert.deepEqual(plain(r), { ctr: d.ctr, r: d.uint32, hmac: d.hmac, poolIndex: d.poolIndex, frac: d.anim.frac, turns: d.anim.turns });
  }
});

test('draw computation rejects empty pools and invalid draw numbers', () => {
  for (const [n, N] of [[1, 0], [0, 2], [1.5, 2], [1, -1], [1, NaN]]) {
    assert.throws(() => call('computeDraw(testInput.seed, testInput.hash, "", testInput.n, testInput.N)', { seed, hash: 'ab'.repeat(32), n, N }));
  }
});

test('rejection sampling retries values outside the unbiased range', () => {
  const N = 2 ** 31 + 1, listHash = 'ab'.repeat(32);
  let selected;
  for (let n = 1; n < 100; n++) {
    const r = call('computeDraw(testInput.seed, testInput.hash, "", testInput.n, testInput.N)', { seed, hash: listHash, n, N });
    if (r.ctr > 0) { selected = { n, r }; break; }
  }
  assert.ok(selected, 'fixture must exercise rejection, not only modulo');
  for (let ctr = 0; ctr <= selected.r.ctr; ctr++) {
    const d = crypto.createHmac('sha256', Buffer.from(seed, 'hex')).update(`fairspin/v1|list:${listHash}|entropy:|draw:${selected.n}|ctr:${ctr}`).digest();
    assert.equal(d.readUInt32BE() < N, ctr === selected.r.ctr);
  }
  assert.ok(selected.r.poolIndex >= 0 && selected.r.poolIndex < N);
});

test('pool removal retains original entry order and duplicate names remain separate slots', () => {
  assert.deepEqual(plain(call('poolFor(5, [3, 1], true)')), [0, 2, 4]);
  assert.deepEqual(plain(call('poolFor(5, [3, 1], false)')), [0, 1, 2, 3, 4]);
  assert.equal(accepted(fixture({ entries: ['Alex', 'Alex', 'Sam'], sequence: [1, 2], target: 2 })), true);
});

test('wheel landing agrees with the mathematical selected slice', () => {
  for (const N of [1, 2, 7, 64, 5000]) {
    for (const index of new Set([0, Math.floor(N / 2), N - 1])) {
      assert.equal(call('idxAt(finalTheta({turns:9, frac:0.82}, testInput.index, testInput.N), testInput.N)', { N, index }), index);
    }
  }
});

test('CSV handles escaped quotes, CRLF, BOM and empty cells', () => {
  const csv = '\uFEFFname,email\r\n"Ava ""Ace""",a@example.com\r\nNoah,\r\n';
  assert.deepEqual(plain(call('parseCSV(testInput)', csv)), [['name', 'email'], ['Ava "Ace"', 'a@example.com'], ['Noah', '']]);
});

test('CSV delimiter detection ignores delimiters inside quoted fields', () => {
  assert.deepEqual(plain(call('parseCSV(testInput)', '"name, display, label";email\n"Doe, Jane";jane@example.com')), [['name, display, label', 'email'], ['Doe, Jane', 'jane@example.com']]);
});

test('CSV preserves multiline cells and handles tab-separated data', () => {
  assert.deepEqual(plain(call('parseCSV(testInput)', 'name\temail\r\n"Ava\nThompson"\tava@example.com')), [['name', 'email'], ['Ava\nThompson', 'ava@example.com']]);
});

test('CSV rejects broken quoted fields instead of silently altering entries', () => {
  for (const csv of ['name,email\n"Ava,ava@example.com', 'name,email\n"Ava"unexpected,ava@example.com']) {
    assert.throws(() => call('parseCSV(testInput)', csv));
  }
});

test('entry normalization trims, drops blanks, and optionally deduplicates without case', () => {
  assert.deepEqual(plain(call('entriesFromRaw(testInput, true, true)', ' Ava \r\n\nAVA\r\nNoah\n')), { entries: ['Ava', 'Noah'], dupes: 1 });
  assert.deepEqual(plain(call('entriesFromRaw(testInput, false, false)', 'Ava\nAva')), { entries: ['Ava', 'Ava'], dupes: 0 });
  assert.deepEqual(plain(call('entriesFromRaw(testInput, false, false)', 'Ava\rNoah\rMia')), { entries: ['Ava', 'Noah', 'Mia'], dupes: 0 });
});

test('valid audit passes full verification', () => assert.equal(accepted(fixture()), true));
test('valid repeated-win audit passes full verification', () => assert.equal(accepted(fixture({ remove: false })), true));

const tampering = {
  'unsupported version': (a) => { a.version = 999; },
  'recorded random integer': (a) => { a.draws[0].uint32 = (a.draws[0].uint32 ^ 1) >>> 0; },
  'replay pool index': (a) => { a.draws[0].poolIndex = (a.draws[0].poolIndex + 1) % a.draws[0].poolSize; },
  'animation fraction': (a) => { a.draws[0].anim.frac = 0.99; },
  'animation turns': (a) => { a.draws[0].anim.turns = 99999; },
  'animation duration': (a) => { a.draws[0].anim.durationMs = -1; },
  'string animation duration': (a) => { a.draws[0].anim.durationMs = '7000'; },
  'more draws than committed winners': (a) => { a.commitment.winnersTarget = 1; },
  'non-boolean removal rule': (a) => { a.commitment.removeWinners = 'true'; },
  'non-integer winner target': (a) => { a.commitment.winnersTarget = 2.5; },
  'unreachable no-repeat target': (a) => { a.commitment.winnersTarget = a.list.entries.length + 1; },
  'malformed hexadecimal seed': (a) => { a.reveal.seed = 'zz'.repeat(32); },
  'wrong list commitment': (a) => { a.commitment.listSha256 = 'f'.repeat(64); },
  'wrong seed commitment': (a) => { a.commitment.seedSha256 = 'f'.repeat(64); },
  'wrong pool hash': (a) => { a.draws[0].poolSha256 = 'f'.repeat(64); },
  'wrong HMAC': (a) => { a.draws[0].hmac = 'f'.repeat(64); },
  'wrong winner': (a) => { a.draws[0].winner = 'Injected winner'; },
  'wrong entry index': (a) => { a.draws[0].entryIndex = -1; },
  'invalid timestamp': (a) => { a.draws[0].at = 'not a date'; },
  'impossible calendar date': (a) => { a.draws[0].at = '2026-02-30T18:04:00.000Z'; },
  'backwards draw timestamps': (a) => { a.draws[1].at = '2026-11-06T18:03:30.000Z'; },
  'missing entropy lock timestamp': (a) => { a.entropy.lockedAt = null; },
  'entropy entered after first draw': (a) => { a.entropy.enteredAt = '2026-11-06T18:09:00.000Z'; },
};
for (const [name, mutate] of Object.entries(tampering)) {
  test(`verification rejects ${name}, even with recomputed integrity`, () => {
    const a = fixture(); mutate(a); sign(a);
    assert.equal(accepted(a), false);
  });
}

test('verification rejects a skipped draw even when all HMACs are recomputed', () => assert.equal(accepted(fixture({ sequence: [1, 3] })), false));
test('verification rejects duplicate draw numbers even when all HMACs are recomputed', () => assert.equal(accepted(fixture({ sequence: [1, 1] })), false));
test('verification rejects embedded newlines that make list serialization ambiguous', () => assert.equal(accepted(fixture({ entries: ['Ava\nNoah', 'Mia', 'Zoé'] })), false));
test('verification rejects non-string entries even if their serialized hash matches', () => assert.equal(accepted(fixture({ entries: [123, 'Mia', 'Zoé'] })), false));
test('verification rejects a changed integrity hash', () => {
  const a = fixture(); a.integrity.sha256 = 'f'.repeat(64);
  assert.equal(accepted(a), false);
});
test('verification safely rejects malformed documents', () => {
  for (const value of [null, [], 1, {}, { format: 'fairspin-audit' }, { format: 'fairspin-audit', list: { entries: null } }]) assert.equal(accepted(value), false);
});

test('verification UI escapes untrusted names and session IDs, and clears stale replays', () => {
  const nodes = new Map();
  const element = (selector) => {
    if (!nodes.has(selector)) nodes.set(selector, { innerHTML: '', textContent: '', hidden: true, classList: { add() {}, remove() {} } });
    return nodes.get(selector);
  };
  const ui = vm.createContext({ TextEncoder, TextDecoder, Uint8Array, Uint32Array, Int16Array, DataView, crypto: crypto.webcrypto, document: { querySelector: element }, setTimeout, clearTimeout });
  vm.runInContext(source.replace(/\binit\(\);\s*$/, ''), ui, { timeout: 2000 });
  vm.runInContext('verifyView = { setPool() {}, showResult() {} };', ui);
  const a = fixture({ entries: ['<img src=x onerror=alert(1)>', '<svg onload=alert(2)>', 'Safe'] });
  a.session.id = '<img src=x onerror=alert(3)>';
  ui.auditText = JSON.stringify(sign(a));
  vm.runInContext('showVerify(auditText)', ui, { timeout: 2000 });
  assert.equal(element('#vOut')._results.length, 2);
  assert.doesNotMatch(element('#vOut').innerHTML, /<img|<svg|onerror=[^&]*>/);
  assert.match(element('#vOut').innerHTML, /&lt;img/);
  vm.runInContext('showVerify("not json")', ui, { timeout: 2000 });
  assert.equal(element('#vOut')._results.length, 0);
  assert.equal(element('#vReadVal').textContent, '—');
});

test('restoring a valid session preserves its recorded winners and committed rules', () => {
  const session = sessionFixture(), ui = stateRuntime(JSON.stringify(session));
  ui.run('load(); renderAll();');
  assert.equal(ui.run('restored'), true);
  assert.deepEqual(plain(ui.run('S.draws')), session.draws);
  assert.equal(ui.run('S.locked.seed'), seed);
  assert.equal(ui.node('#target').disabled, true);
  assert.equal(ui.node('#removeWinners').disabled, true);
  assert.equal(ui.node('#spinBtn').disabled, true);
  assert.match(ui.node('#spinBtn').textContent, /COMPLETE/);
});

test('corrupt saved sessions remain recoverable and cannot be overwritten by autosave', () => {
  for (const raw of ['{broken json', JSON.stringify({ v: 1, id: '1234abcd' })]) {
    const ui = stateRuntime(raw);
    ui.run('load();');
    assert.equal(ui.run('storageBlocked'), true);
    assert.equal(ui.run('recoveryData'), raw);
    assert.equal(ui.node('#recoverStorage').hidden, false);
    assert.equal(ui.run('save()'), false);
    assert.equal(ui.storage.get('fairspin.session.v1'), raw);
  }
});

test('a changed session in another tab blocks stale writes and further draws', () => {
  const ui = stateRuntime(JSON.stringify(sessionFixture()));
  ui.run('load();');
  ui.storage.set('fairspin.session.v1', 'a newer session');
  assert.equal(ui.run('save()'), false);
  assert.equal(ui.run('storageBlocked'), true);
  assert.equal(ui.storage.get('fairspin.session.v1'), 'a newer session');
  assert.equal(ui.node('#spinBtn').disabled, true);
  assert.match(ui.node('#storageMessage').textContent, /another tab/);
});

test('storage quota failure leaves the session in memory and displays recovery guidance', () => {
  const ui = stateRuntime();
  ui.run('load();');
  ui.localStorage.setItem = () => { throw new Error('QuotaExceededError'); };
  assert.equal(ui.run('save()'), false);
  assert.ok(ui.run('S.id'));
  assert.equal(ui.node('#storageWarning').hidden, false);
  assert.match(ui.node('#storageMessage').textContent, /export.*before closing/i);
});

test('lock, spin, refresh and completion preserve winners before animation finishes', async () => {
  const ui = stateRuntime();
  ui.run('init(); S.raw = "Ava\\nNoah\\nMia"; S.opts.sound = false; el.target.value = "2"; lockList();');
  assert.equal(ui.node('#target').disabled, true);
  assert.equal(ui.node('#removeWinners').disabled, true);
  let finish;
  ui.runtime.animation = new Promise((resolve) => { finish = resolve; });
  ui.run('stageView.spin = () => animation; globalThis.pendingSpin = spin();');
  assert.equal(ui.run('spinning'), true);
  assert.equal(ui.run('S.draws.length'), 1);
  const recorded = JSON.parse(ui.storage.get('fairspin.session.v1'));
  assert.equal(recorded.draws.length, 1);
  assert.equal(ui.node('#clearBtn').disabled, true);
  ui.node('#clearBtn').onclick();
  assert.equal(ui.run('S.id'), recorded.id, 'clear is guarded during animation');
  await ui.run('spin()');
  assert.equal(ui.run('S.draws.length'), 1, 'busy spin cannot draw twice');
  const refreshed = stateRuntime(JSON.stringify(recorded));
  refreshed.run('init();');
  assert.equal(refreshed.run('S.draws[0].winner'), recorded.draws[0].winner);
  assert.equal(refreshed.node('#readVal').textContent, recorded.draws[0].winner);
  finish(true);
  await ui.runtime.pendingSpin;
  await ui.run('spin()');
  assert.equal(ui.run('S.draws.length'), 2);
  assert.equal(ui.run('verifyAudit(buildAudit()).ok'), true);
  assert.equal(ui.node('#spinBtn').disabled, true);
  ui.node('#clearBtn').onclick();
  assert.equal(ui.run('S.locked'), null);
  assert.equal(ui.run('S.draws.length'), 0);
  assert.equal(ui.node('#duration').value, 7);
  assert.equal(ui.node('#sound').checked, true);
});

test('an asynchronous import cannot overwrite a list locked while the file was reading', async () => {
  const ui = stateRuntime();
  ui.run('init(); S.raw = "Ava\\nNoah"; el.target.value = "1";');
  let finish;
  const text = new Promise((resolve) => { finish = resolve; });
  ui.node('#csvFile').onchange({ target: { files: [{ name: 'late.txt', size: 10, text: () => text }], value: 'late.txt' } });
  ui.run('lockList();');
  finish('Changed\nEntries');
  await text;
  await Promise.resolve();
  assert.deepEqual(plain(ui.run('S.locked.entries')), ['Ava', 'Noah']);
  assert.equal(ui.run('S.raw'), 'Ava\nNoah');
});

test('an asynchronous import cannot repopulate a cleared session', async () => {
  const ui = stateRuntime(); ui.run('init();');
  let finish;
  const text = new Promise((resolve) => { finish = resolve; });
  ui.node('#csvFile').onchange({ target: { files: [{ name: 'late.txt', size: 10, text: () => text }], value: 'late.txt' } });
  ui.node('#clearBtn').onclick();
  finish('Changed\nEntries');
  await text; await Promise.resolve();
  assert.equal(ui.run('S.raw'), '');
});

test('content security policy authorizes exactly the embedded scripts and blocks connections', () => {
  const tag = html.match(/<meta\b[^>]*http-equiv=["']Content-Security-Policy["'][^>]*>/i)?.[0];
  assert.ok(tag, 'A Content-Security-Policy meta tag is required');
  const policy = tag.match(/content="([^"]*)"/i)?.[1];
  assert.ok(policy);
  const scriptPolicy = policy.match(/(?:^|;)\s*script-src\s+([^;]+)/)?.[1];
  assert.ok(scriptPolicy, 'script-src must be explicit');
  const expected = scripts.map((s) => `'sha256-${crypto.createHash('sha256').update(s[1]).digest('base64')}'`).sort();
  assert.deepEqual(scriptPolicy.trim().split(/\s+/).sort(), expected, 'Run node scripts/update-csp.cjs after editing embedded scripts');
  for (const directive of ['connect-src', 'object-src', 'base-uri', 'form-action']) assert.match(policy, new RegExp(`(?:^|;)\\s*${directive}\\s+'none'(?:;|$)`));
});

test('embedded independent verifier matches the tested standalone script', () => {
  const embedded = html.match(/<pre class="code" id="pyCode">([\s\S]*?)<\/pre>/)?.[1];
  assert.ok(embedded);
  const decoded = embedded.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  assert.equal(decoded, fs.readFileSync(path.join(__dirname, '..', 'verify.py'), 'utf8'));
});

test('invalid entropy prevents locking or spinning instead of silently using an older value', async () => {
  const ui = stateRuntime();
  ui.run('init(); S.raw = "Ava\\nNoah"; el.target.value = "1"; el.entropy.value = "x".repeat(2049); lockList();');
  assert.equal(ui.run('S.locked'), null);
  ui.run('el.entropy.value = "valid"; lockList(); el.entropy.value = String.fromCharCode(0xD800);');
  await ui.run('spin()');
  assert.equal(ui.run('S.draws.length'), 0);
  assert.equal(ui.run('S.entropy.value'), 'valid');
});

test('verification rejects resource-heavy draw plans before computing their draws', () => {
  const entries = Array.from({ length: 5000 }, (_, i) => String(i).padStart(4, '0') + 'x'.repeat(296));
  const audit = fixture({ entries, target: 100 });
  assert.equal(accepted(audit), false);
});

test('Python independent verifier agrees on valid and semantically tampered audits', () => {
  const cases = [{ name: 'valid', audit: fixture(), expected: true }, { name: 'repeat wins', audit: fixture({ remove: false }), expected: true }];
  for (const [name, mutate] of Object.entries(tampering)) {
    const audit = fixture(); mutate(audit); sign(audit);
    cases.push({ name, audit, expected: false });
  }
  cases.push({ name: 'skipped number', audit: fixture({ sequence: [1, 3] }), expected: false });
  cases.push({ name: 'duplicate number', audit: fixture({ sequence: [1, 1] }), expected: false });
  cases.push({ name: 'newline entry', audit: fixture({ entries: ['Ava\nNoah', 'Mia', 'Zoé'] }), expected: false });
  const program = [
    'import json, sys, verify',
    'results = []',
    'for case in json.load(sys.stdin):',
    '    try:',
    '        verify.verify(case["audit"])',
    '        results.append(True)',
    '    except (ValueError, TypeError, KeyError, OverflowError, RecursionError):',
    '        results.append(False)',
    'print(json.dumps(results))',
  ].join('\n');
  // -O makes sure the verifier never relies on removable Python assertions.
  const run = spawnSync('python3', ['-B', '-O', '-c', program], { cwd: path.join(__dirname, '..'), input: JSON.stringify(cases), encoding: 'utf8', timeout: 10000 });
  assert.equal(run.status, 0, run.stderr || String(run.error));
  const results = JSON.parse(run.stdout);
  for (let i = 0; i < cases.length; i++) assert.equal(results[i], cases[i].expected, cases[i].name);
});
