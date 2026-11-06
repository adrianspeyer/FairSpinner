'use strict';

// Offline network/state integration checks. Real BLS verification, simulated
// browser DOM, relay responses and clock; these are not visual browser tests.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const source = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
  .find((match) => match[1].includes('function computeDraw'))[1].replace(/\binit\(\);\s*$/, '');
const bundle = fs.readFileSync(path.join(root, 'vendor', 'beacon-verifier.js'), 'utf8');
const proof = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'drand-quicknet-round42.json'), 'utf8'));
const info = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'drand-quicknet-info.json'), 'utf8'));
const roundTime = (info.genesis_time + (proof.round - 1) * info.period) * 1000;
const initialTime = roundTime - 63000; // The future-round rule reserves round 42.
const SESSION_KEY = 'fairspin.session.v1';
const plain = (value) => JSON.parse(JSON.stringify(value));
const response = (value = proof, options = {}) => new Response(JSON.stringify(value), { status: 200, ...options });

function harness({ initial = new Map(), now = initialTime, relay = async () => response() } = {}) {
  const nodes = new Map(), storage = new Map(initial), timers = new Map(), requests = [];
  let clock = now, timerId = 0, fetchRelay = relay, document;
  class ClockDate extends Date {
    constructor(...args) { super(...(args.length ? args : [clock])); }
    static now() { return clock; }
  }
  const node = (selector) => {
    if (!nodes.has(selector)) {
      const handlers = new Map(), attributes = new Map(), classes = new Set();
      const element = {
        value: '', textContent: '', innerHTML: '', hidden: true, disabled: false,
        checked: false, dataset: {}, style: {}, lastElementChild: {},
        classList: {
          add: (...values) => values.forEach((value) => classes.add(value)),
          remove: (...values) => values.forEach((value) => classes.delete(value)),
          toggle: (name, force) => { const value = force ?? !classes.has(name); if (value) classes.add(name); else classes.delete(name); return value; },
        },
        setAttribute: (name, value) => attributes.set(name, String(value)),
        getAttribute: (name) => attributes.get(name) ?? null,
        removeAttribute: (name) => attributes.delete(name),
        addEventListener: (name, handler) => handlers.set(name, handler),
        async dispatch(name, event = {}) { const e = { target: element, preventDefault() {}, ...event }; await element['on' + name]?.(e); await handlers.get(name)?.(e); },
        click() { if (!element.disabled) return element.dispatch('click'); },
        focus() { document.activeElement = element; },
        querySelector() { return null; },
        getContext() { return { clearRect() {} }; },
      };
      nodes.set(selector, element);
    }
    return nodes.get(selector);
  };
  const localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
  };
  document = { querySelector: node, querySelectorAll: () => [], addEventListener() {}, documentElement: { dataset: { theme: 'light' } }, activeElement: null };
  const runtime = vm.createContext({
    Date: ClockDate, TextEncoder, TextDecoder, Uint8Array, Uint32Array, Int16Array, DataView,
    Blob, AbortController, crypto: crypto.webcrypto, document, localStorage,
    setTimeout: (callback, ms) => { timers.set(++timerId, { callback, ms }); return timerId; },
    clearTimeout: (id) => timers.delete(id), cancelAnimationFrame() {},
    window: { addEventListener() {}, matchMedia: () => ({ matches: true }) },
    matchMedia: () => ({ matches: true }), confirm: () => true,
    getComputedStyle: () => ({ getPropertyValue: () => '#fff' }),
    fetch: async (url, options) => { requests.push({ url, options }); return fetchRelay(url, options, requests.length); },
  });
  vm.runInContext(bundle, runtime, { timeout: 3000 });
  vm.runInContext(source, runtime, { timeout: 3000 });
  vm.runInContext('WheelView = class { setPool() {} draw() {} showResult() {} resize() {} cancelSpin() {} spin() { return Promise.resolve(true); } };', runtime);
  const run = (code, input) => { runtime.testInput = input; return vm.runInContext(code, runtime, { timeout: 3000 }); };
  run('init()');
  return { run, node, storage, localStorage, requests, timers, runtime, time: (value) => { clock = value; }, relay: (value) => { fetchRelay = value; } };
}

function lock(app, automatic = true) {
  app.run('S.raw = "Ava\\nNoah\\nMia"; el.entries.value = S.raw; el.target.value = "1"; S.opts.sound = false;');
  if (automatic) app.run('S.opts.entropyMode = "auto"; S.opts.beaconDelay = 60;');
  app.run('lockList()');
  assert.ok(app.run('S.locked'));
  if (automatic) assert.equal(app.run('S.locked.beacon.round'), proof.round);
}

test('manual and offline draws never contact a randomness relay', async () => {
  const app = harness({ relay: () => { throw new Error('Offline must not request'); } });
  assert.equal(app.run('S.opts.entropyMode'), 'manual');
  lock(app, false); app.run('resumeBeacon()');
  await app.run('spin()');
  assert.equal(app.run('S.draws.length'), 1);
  assert.equal(app.run('buildAudit().version'), 1);
  assert.equal(app.run('verifyAudit(buildAudit()).ok'), true);
  const refreshed = harness({ initial: app.storage, relay: () => { throw new Error('Offline must not request'); } });
  assert.equal(app.requests.length + refreshed.requests.length, 0);
});

test('automatic locking pins a future round and removes pasted entropy before any request', async () => {
  const app = harness();
  app.run('setEntropy("old manual value", "old source"); el.entropy.value = "old manual value";');
  lock(app);
  assert.equal(app.run('S.entropy.value'), '');
  assert.equal(app.run('S.entropy.beacon'), null);
  assert.equal(app.run('Date.parse(S.locked.beacon.scheduledAt)'), roundTime);
  assert.equal(app.run('S.locked.beacon.publicKey'), info.public_key);
  assert.equal(app.node('#entropyMode').disabled, true);
  assert.equal(app.node('#entropy').disabled, true);
  assert.equal(app.node('#spinBtn').disabled, true);
  assert.match(app.node('#beaconStatus').textContent, /1m 3s/);
  assert.match(app.run('statement()'), /round 42/);
  assert.match(app.run('statement()'), /BEFORE/);
  assert.equal(app.requests.length, 0);
  assert.equal(app.run('verifyAudit(buildAudit()).ok'), true);
  assert.equal(app.run('setEntropy("replacement", "source")'), false);
  assert.equal(await app.run('fetchCommittedBeacon()'), false);
  assert.equal(app.requests.length, 0, 'an early fetch attempt cannot bypass the publication window');
  await app.run('spin()');
  assert.equal(app.run('S.draws.length'), 0);
  assert.ok([...app.timers.values()].some((timer) => timer.ms === 1000));
});

test('the scheduled countdown automatically fetches and verifies the pinned round when it becomes due', async () => {
  const app = harness(); lock(app);
  const [id, timer] = [...app.timers].find(([, value]) => value.ms === 1000);
  app.timers.delete(id); app.time(roundTime); timer.callback();
  await new Promise(setImmediate);
  assert.equal(app.requests.length, 1);
  assert.equal(app.run('beaconFetching'), false);
  assert.deepEqual(plain(app.run('S.entropy.beacon')), proof);
  assert.equal(app.node('#spinBtn').disabled, false);
  assert.equal(app.run('verifyAudit(buildAudit()).ok'), true);
});

test('pending automatic sessions restore the exact committed round after refresh', async () => {
  const app = harness(); lock(app);
  const plan = plain(app.run('S.locked.beacon'));
  const refreshed = harness({ initial: app.storage, now: initialTime + 30000 });
  assert.equal(refreshed.run('restored'), true);
  assert.deepEqual(plain(refreshed.run('S.locked.beacon')), plan);
  assert.equal(refreshed.requests.length, 0);
  assert.equal(refreshed.node('#spinBtn').disabled, true);
  assert.match(refreshed.node('#beaconStatus').textContent, /33s/);
});

test('a verified response enables spinning, persists proof and produces a valid version 2 audit', async () => {
  const app = harness(); lock(app); app.time(roundTime);
  assert.equal(await app.run('fetchCommittedBeacon()'), true);
  assert.equal(app.requests.length, 1);
  const { url, options } = app.requests[0];
  assert.equal(url, `https://api.drand.sh/${info.hash}/public/42`);
  assert.equal(options.credentials, 'omit');
  assert.equal(options.referrerPolicy, 'no-referrer');
  assert.equal(options.redirect, 'error');
  assert.equal(options.cache, 'no-store');
  assert.equal(options.body, undefined);
  assert.deepEqual(plain(app.run('S.entropy.beacon')), proof);
  assert.equal(JSON.parse(app.storage.get(SESSION_KEY)).entropy.beacon.signature, proof.signature);
  assert.equal(app.node('#spinBtn').disabled, false);
  assert.match(app.node('#beaconStatus').textContent, /Signature verified/);
  await app.run('spin()');
  assert.equal(app.run('S.draws.length'), 1);
  assert.equal(app.run('buildAudit().version'), 2);
  assert.equal(app.run('verifyAudit(buildAudit()).ok'), true);
  const refreshed = harness({ initial: app.storage, now: roundTime + 3000 });
  assert.equal(refreshed.run('restored'), true);
  assert.equal(refreshed.run('verifyAudit(buildAudit()).ok'), true);
  assert.equal(refreshed.requests.length, 0, 'restored proof is verified offline, without fetching another round');
});

test('fallback and explicit retries request only the pinned chain and round', async () => {
  const app = harness({ relay: async () => response({ ...proof, round: 43 }) });
  lock(app); app.time(roundTime);
  assert.equal(await app.run('fetchCommittedBeacon()'), false);
  assert.equal(app.requests.length, 2);
  assert.match(app.run('beaconError'), /same committed round/);
  assert.equal(app.run('S.entropy.beacon'), null);
  assert.equal(app.node('#spinBtn').disabled, true);
  assert.equal(app.node('#retryBeacon').hidden, false);
  app.run('resumeBeacon()');
  assert.equal(app.requests.length, 2, 'failure requires explicit retry rather than changing rounds');
  app.relay(async () => response());
  assert.equal(await app.run('fetchCommittedBeacon()'), true);
  assert.equal(app.requests.length, 3);
  assert.ok(app.requests.every(({ url }) => url.endsWith(`/${info.hash}/public/42`)));
  assert.equal(app.run('S.locked.beacon.round'), 42);
});

test('a relay failure falls back to the same round on the second allowed relay', async () => {
  const app = harness({ relay: async (url, options, count) => count === 1 ? new Response('unavailable', { status: 503 }) : response() });
  lock(app); app.time(roundTime);
  assert.equal(await app.run('fetchCommittedBeacon()'), true);
  assert.equal(app.requests[1].url, `https://api2.drand.sh/${info.hash}/public/42`);
  assert.equal(app.run('S.locked.beacon.round'), 42);
});

test('invalid signatures, malformed JSON and oversized relay responses fail closed', async () => {
  const signature = proof.signature.slice(0, -2) + (proof.signature.endsWith('00') ? '01' : '00');
  const cases = [
    () => response({ ...proof, signature, randomness: crypto.createHash('sha256').update(Buffer.from(signature, 'hex')).digest('hex') }),
    () => new Response('{"broken":'),
    () => response(proof, { headers: { 'content-length': '9000' } }),
    () => new Response('x'.repeat(9000)),
  ];
  for (const bad of cases) {
    const app = harness({ relay: async () => bad() }); lock(app); app.time(roundTime);
    assert.equal(await app.run('fetchCommittedBeacon()'), false);
    assert.equal(app.requests.length, 2);
    assert.equal(app.run('S.entropy.beacon'), null);
    assert.equal(app.node('#spinBtn').disabled, true);
    await app.run('spin()');
    assert.equal(app.run('S.draws.length'), 0);
  }
});

test('clearing during a fetch aborts it and prevents a stale response changing the new session', async () => {
  let finish;
  const app = harness({ relay: () => new Promise((resolve) => { finish = resolve; }) });
  lock(app); app.time(roundTime);
  const oldId = app.run('S.id'), pending = app.run('fetchCommittedBeacon()');
  assert.equal(app.run('beaconFetching'), true);
  await app.node('#clearBtn').click();
  assert.notEqual(app.run('S.id'), oldId);
  assert.equal(app.requests[0].options.signal.aborted, true);
  finish(response());
  assert.equal(await pending, false);
  assert.equal(app.run('S.locked'), null);
  assert.equal(app.run('S.entropy.value'), '');
  assert.equal(app.run('S.draws.length'), 0);
  assert.equal(app.requests.length, 1);
});

test('clock rollback while fetching cannot persist a proof before its committed publication time', async () => {
  let finish;
  const app = harness({ relay: (url, options, count) => count === 1 ? new Promise((resolve) => { finish = resolve; }) : response() });
  lock(app); app.time(roundTime);
  const plan = plain(app.run('S.locked.beacon')), saved = app.storage.get(SESSION_KEY);
  const pending = app.run('fetchCommittedBeacon()');
  assert.equal(app.run('beaconFetching'), true);
  app.time(roundTime - 1000);
  finish(response());
  assert.equal(await pending, false);
  assert.equal(app.run('beaconFetching'), false);
  assert.equal(app.run('S.entropy.beacon'), null);
  assert.equal(app.run('S.entropy.value'), '');
  assert.equal(app.run('S.entropy.enteredAt'), null);
  assert.equal(app.storage.get(SESSION_KEY), saved);
  assert.equal(app.node('#spinBtn').disabled, true);
  assert.doesNotMatch(app.node('#beaconStatus').textContent, /Signature verified/);
  assert.deepEqual(plain(app.run('S.locked.beacon')), plan);
  assert.equal(app.run('verifyAudit(buildAudit()).ok'), true);
  app.time(roundTime + 1000);
  assert.equal(await app.run('fetchCommittedBeacon()'), true);
  assert.ok(app.requests.every(({ url }) => url.endsWith(`/${info.hash}/public/42`)));
  assert.deepEqual(plain(app.run('S.locked.beacon')), plan);
  assert.equal(app.node('#spinBtn').disabled, false);
  await app.run('spin()');
  assert.equal(app.run('verifyAudit(buildAudit()).ok'), true);
});

test('another tab changing the current session prevents in-flight proof writes', async () => {
  let finish;
  const app = harness({ relay: () => new Promise((resolve) => { finish = resolve; }) });
  lock(app); app.time(roundTime);
  const pending = app.run('fetchCommittedBeacon()');
  const other = harness();
  app.storage.set(SESSION_KEY, other.storage.get(SESSION_KEY));
  finish(response());
  assert.equal(await pending, false);
  assert.equal(app.storage.get(SESSION_KEY), other.storage.get(SESSION_KEY));
  assert.equal(app.run('storageBlocked'), true);
  assert.equal(app.run('S.entropy.beacon'), null);
});

test('the completed main spin control archives results and opens the next editable draw', async () => {
  const app = harness(); lock(app, false); await app.node('#spinBtn').click();
  const previousId = app.run('S.id');
  assert.equal(app.node('#spinBtn').textContent, 'START NEXT DRAW');
  assert.equal(app.node('#spinBtn').disabled, false);
  await app.node('#spinBtn').click();
  assert.notEqual(app.run('S.id'), previousId);
  assert.equal(app.run('S.locked'), null);
  assert.equal(app.run('S.draws.length'), 0);
  assert.equal(app.run('H.sessions[0].audit.session.id'), previousId);
  assert.equal(app.run('verifyAudit(H.sessions[0].audit).ok'), true);
});

async function inTimezone(zone, check) {
  const previous = process.env.TZ;
  process.env.TZ = zone;
  try { return await check(); }
  finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
}

function prepareSchedule(app) {
  app.run('S.raw = "Ava\\nNoah\\nMia"; el.entries.value = S.raw; el.target.value = "1"; S.opts.sound = false; S.opts.entropyMode = "auto"; renderAll();');
}

async function chooseScheduledTime(app, localValue) {
  app.node('#beaconTimingScheduled').checked = true;
  await app.node('#beaconTimingScheduled').dispatch('change');
  app.node('#beaconAt').value = localValue;
  await app.node('#beaconAt').dispatch('input');
}

test('new sessions default to a five-minute wait and each displayed preset locks a valid future round', async () => {
  const app = harness();
  assert.equal(app.run('S.opts.beaconDelay'), 300);
  assert.equal(app.run('S.opts.beaconTiming'), 'delay');
  assert.equal(app.run('S.opts.beaconAt'), '');
  assert.equal(app.node('#beaconDelay').value, '300');
  const select = html.match(/<select id="beaconDelay">([\s\S]*?)<\/select>/)[1];
  assert.deepEqual([...select.matchAll(/<option value="(\d+)"/g)].map((m) => +m[1]), [60, 120, 300, 900, 1800, 3600]);
  for (const delay of [60, 120, 300, 900, 1800, 3600]) {
    const draw = harness(); prepareSchedule(draw);
    draw.node('#beaconDelay').value = String(delay);
    await draw.node('#beaconDelay').dispatch('change');
    draw.run('lockList()');
    const scheduledAt = Date.parse(draw.run('S.locked.beacon.scheduledAt'));
    assert.equal(draw.run('S.opts.beaconDelay'), delay);
    assert.ok(scheduledAt >= initialTime + delay * 1000);
    assert.ok(scheduledAt <= initialTime + delay * 1000 + 4000);
    assert.equal(draw.run('verifyAudit(buildAudit()).ok'), true);
    assert.equal(draw.requests.length, 0);
  }
});

test('legacy saved sessions restore their original wait and exact committed round', () => {
  const app = harness(); lock(app);
  const saved = JSON.parse(app.storage.get(SESSION_KEY)), plan = saved.locked.beacon;
  delete saved.opts.beaconTiming; delete saved.opts.beaconAt;
  app.storage.set(SESSION_KEY, JSON.stringify(saved));
  const restored = harness({ initial: app.storage });
  assert.equal(restored.run('restored'), true);
  assert.equal(restored.run('S.opts.beaconDelay'), 60);
  assert.equal(restored.node('#beaconDelay').value, '60');
  assert.deepEqual(plain(restored.run('S.locked.beacon')), plan);
  assert.equal(restored.run('verifyAudit(buildAudit()).ok'), true);
});

test('custom local scheduling pins the first round at or after the chosen time and freezes all timing controls', () => inTimezone('America/Toronto', async () => {
  const now = Date.parse('2026-11-06T18:00:00.000Z'), app = harness({ now });
  prepareSchedule(app);
  await chooseScheduledTime(app, '2026-11-06T14:30');
  assert.equal(app.run('S.opts.beaconTiming'), 'scheduled');
  assert.equal(app.run('S.opts.beaconAt'), '2026-11-06T19:30:00.000Z');
  assert.match(app.node('#beaconTimeZone').textContent, /America\/Toronto/);
  app.run('lockList()');
  const plan = plain(app.run('S.locked.beacon')), target = Date.parse('2026-11-06T19:30:00.000Z');
  assert.ok(Date.parse(plan.scheduledAt) >= target);
  assert.ok(Date.parse(plan.scheduledAt) - target < info.period * 1000);
  for (const id of ['beaconTimingDelay', 'beaconTimingScheduled', 'beaconDelay', 'beaconAt']) assert.equal(app.node('#' + id).disabled, true, id);
  assert.equal(app.run('verifyAudit(buildAudit()).ok'), true);
  assert.match(app.run('statement()'), new RegExp(plan.scheduledAt.replace(/[.]/g, '\\.')));
  assert.equal(app.requests.length, 0);
  app.node('#beaconAt').value = '2026-11-07T14:30';
  await app.node('#beaconAt').dispatch('input');
  assert.deepEqual(plain(app.run('S.locked.beacon')), plan);
  assert.equal(app.run('S.opts.beaconAt'), '2026-11-06T19:30:00.000Z');
}));

test('a saved custom deadline preserves its instant when reopened in a different local timezone', async () => {
  let storage, plan;
  const now = Date.parse('2026-11-06T18:00:00.000Z');
  await inTimezone('America/Toronto', async () => {
    const app = harness({ now }); prepareSchedule(app);
    await chooseScheduledTime(app, '2026-11-06T14:30'); app.run('lockList()');
    storage = app.storage; plan = plain(app.run('S.locked.beacon'));
  });
  await inTimezone('America/Vancouver', () => {
    const restored = harness({ initial: storage, now: now + 30000 });
    assert.equal(restored.run('restored'), true);
    assert.deepEqual(plain(restored.run('S.locked.beacon')), plan);
    assert.equal(restored.run('S.opts.beaconAt'), '2026-11-06T19:30:00.000Z');
    assert.equal(restored.node('#beaconAt').value, '2026-11-06T11:30');
    assert.match(restored.node('#beaconTimeZone').textContent, /America\/Vancouver/);
    assert.equal(restored.requests.length, 0);
  });
});

test('a custom draft reopened in another timezone still locks the originally chosen instant', async () => {
  const now = Date.parse('2026-11-06T18:00:00.000Z');
  let storage;
  await inTimezone('America/Toronto', async () => {
    const app = harness({ now }); prepareSchedule(app);
    await chooseScheduledTime(app, '2026-11-06T14:30'); storage = app.storage;
  });
  await inTimezone('Asia/Kolkata', () => {
    const app = harness({ initial: storage, now });
    assert.equal(app.run('restored'), true);
    assert.equal(app.node('#beaconAt').value, '2026-11-07T01:00');
    app.run('lockList()');
    assert.equal(app.run('S.opts.beaconAt'), '2026-11-06T19:30:00.000Z');
    assert.equal(app.run('S.locked.beacon.scheduledAt'), '2026-11-06T19:30:00.000Z');
    assert.equal(app.run('verifyAudit(buildAudit()).ok'), true);
  });
});

test('changing the operating-system timezone in the same tab cannot reinterpret an untouched custom deadline at lock', () => inTimezone('America/Toronto', async () => {
  const app = harness({ now: Date.parse('2026-11-07T18:00:00.000Z') }); prepareSchedule(app);
  await chooseScheduledTime(app, '2026-11-07T18:00');
  assert.equal(app.run('S.opts.beaconAt'), '2026-11-07T23:00:00.000Z');
  process.env.TZ = 'America/Vancouver';
  app.run('lockList()');
  assert.equal(app.run('S.opts.beaconAt'), '2026-11-07T23:00:00.000Z');
  assert.equal(app.run('S.locked.beacon.scheduledAt'), '2026-11-07T23:00:00.000Z');
  assert.equal(app.node('#beaconAt').value, '2026-11-07T15:00');
  assert.match(app.node('#beaconTimeZone').textContent, /America\/Vancouver/);
  assert.match(app.node('#beaconDeadline').textContent, /America\/Vancouver/);
  assert.equal(app.run('verifyAudit(buildAudit()).ok'), true);
}));

test('same-tab timezone changes refresh the displayed deadline, and later edits use the new local timezone', () => inTimezone('America/Toronto', async () => {
  const app = harness({ now: Date.parse('2026-11-07T18:00:00.000Z') }); prepareSchedule(app);
  await chooseScheduledTime(app, '2026-11-07T18:00');
  process.env.TZ = 'America/Vancouver';
  app.run('renderAll()');
  assert.equal(app.node('#beaconAt').value, '2026-11-07T15:00');
  assert.equal(app.run('S.opts.beaconAt'), '2026-11-07T23:00:00.000Z');
  assert.match(app.node('#beaconTimeZone').textContent, /America\/Vancouver/);
  app.node('#beaconAt').value = '2026-11-07T17:00';
  await app.node('#beaconAt').dispatch('input');
  assert.equal(app.run('S.opts.beaconAt'), '2026-11-08T01:00:00.000Z');
  app.run('lockList()');
  assert.equal(app.run('S.locked.beacon.scheduledAt'), '2026-11-08T01:00:00.000Z');
  assert.equal(app.run('verifyAudit(buildAudit()).ok'), true);
}));

test('an input event immediately after a same-tab timezone change keeps the new edit and interprets it locally', () => inTimezone('America/Toronto', async () => {
  const app = harness({ now: Date.parse('2026-11-07T18:00:00.000Z') }); prepareSchedule(app);
  await chooseScheduledTime(app, '2026-11-07T18:00');
  process.env.TZ = 'America/Vancouver';
  app.node('#beaconAt').value = '2026-11-07T17:00';
  await app.node('#beaconAt').dispatch('input');
  assert.equal(app.node('#beaconAt').value, '2026-11-07T17:00');
  assert.equal(app.run('S.opts.beaconAt'), '2026-11-08T01:00:00.000Z');
  assert.match(app.node('#beaconTimeZone').textContent, /America\/Vancouver/);
  app.run('lockList()');
  assert.equal(app.run('S.locked.beacon.scheduledAt'), '2026-11-08T01:00:00.000Z');
}));

test('a same-tab timezone refresh preserves an invalid edit and its error instead of restoring an older date', () => inTimezone('America/Toronto', async () => {
  const app = harness({ now: Date.parse('2026-11-07T18:00:00.000Z') }); prepareSchedule(app);
  await chooseScheduledTime(app, '2026-11-07T18:00');
  app.node('#beaconAt').value = '2027-03-14T02:30';
  await app.node('#beaconAt').dispatch('input');
  assert.equal(app.run('S.opts.beaconAt'), '');
  const error = app.node('#beaconDateError').textContent;
  assert.ok(error);
  process.env.TZ = 'America/Vancouver'; app.run('renderAll()');
  assert.equal(app.node('#beaconAt').value, '2027-03-14T02:30');
  assert.equal(app.run('S.opts.beaconAt'), '');
  assert.equal(app.node('#beaconDateError').textContent, error);
  assert.match(app.node('#beaconTimeZone').textContent, /America\/Vancouver/);
  app.run('lockList()'); assert.equal(app.run('S.locked'), null);
}));

test('custom round selection includes a round exactly at the requested instant and rounds later times upward', () => {
  const app = harness();
  for (const target of [roundTime - 1000, roundTime]) {
    const plan = app.run('makeBeaconPlan(new Date(testInput.at).toISOString(), 300, new Date(testInput.target).toISOString())', { at: initialTime, target });
    assert.equal(plan.round, 42);
    assert.equal(Date.parse(plan.scheduledAt), roundTime);
  }
  const plan = app.run('makeBeaconPlan(new Date(testInput.at).toISOString(), 300, new Date(testInput.target).toISOString())', { at: initialTime, target: roundTime + 1 });
  assert.equal(plan.round, 43);
  assert.equal(Date.parse(plan.scheduledAt), roundTime + 3000);
});

test('custom dates reject invalid calendar values, missing local times and repeated local times', () => inTimezone('America/Toronto', () => {
  const app = harness();
  assert.equal(app.run('parseLocalBeaconTime(testInput)', '2026-11-06T14:30'), '2026-11-06T19:30:00.000Z');
  for (const value of ['', 'not-a-date', '2026-02-30T14:30', '2026-13-01T14:30', '2026-03-08T02:30', '2026-11-01T01:30']) {
    assert.throws(() => app.run('parseLocalBeaconTime(testInput)', value), undefined, value);
  }
}));

test('local-time validation also handles half-hour daylight-saving transitions', () => inTimezone('Australia/Lord_Howe', () => {
  const app = harness();
  assert.equal(app.run('parseLocalBeaconTime(testInput)', '2026-10-04T03:00'), '2026-10-03T16:00:00.000Z');
  for (const value of ['2026-10-04T02:15', '2026-04-05T01:45']) assert.throws(() => app.run('parseLocalBeaconTime(testInput)', value), undefined, value);
}));

test('empty, invalid, past and too-soon custom schedules cannot lock or silently fall back to a preset', () => inTimezone('America/Toronto', async () => {
  const now = Date.parse('2026-11-06T18:00:30.000Z');
  for (const value of ['', '2026-02-30T14:30', '2026-11-06T12:59', '2026-11-06T13:01']) {
    const app = harness({ now }); prepareSchedule(app);
    await chooseScheduledTime(app, value);
    app.run('lockList()');
    assert.equal(app.run('S.locked'), null, value);
    assert.equal(app.run('S.opts.beaconTiming'), 'scheduled');
    assert.equal(app.run('S.draws.length'), 0);
    assert.equal(app.requests.length, 0);
    assert.equal(JSON.parse(app.storage.get(SESSION_KEY)).locked, null);
    assert.ok(app.node('#beaconDateError').textContent, 'the rejected date has an inline explanation');
  }
}));

test('a custom draft that becomes too close while preparing entries is rechecked at lock', () => inTimezone('America/Toronto', async () => {
  const now = Date.parse('2026-11-06T18:00:00.000Z'), app = harness({ now });
  prepareSchedule(app); await chooseScheduledTime(app, '2026-11-06T13:02');
  assert.equal(app.run('S.opts.beaconAt'), '2026-11-06T18:02:00.000Z');
  app.time(now + 61000); app.run('lockList()');
  assert.equal(app.run('S.locked'), null);
  assert.equal(app.run('S.opts.beaconAt'), '2026-11-06T18:02:00.000Z');
  assert.equal(app.requests.length, 0);
}));

test('starting the next draw clears an old custom date while retaining the chosen wait preset', async () => {
  const app = harness(); lock(app, false);
  app.run('S.opts.beaconTiming = "scheduled"; S.opts.beaconAt = new Date(testInput).toISOString(); S.opts.beaconDelay = 900;', roundTime);
  await app.run('spin()');
  assert.equal(app.run('startNextDraw("all")'), true);
  assert.equal(app.run('S.opts.beaconTiming'), 'delay');
  assert.equal(app.run('S.opts.beaconAt'), '');
  assert.equal(app.run('S.opts.beaconDelay'), 900);
  assert.equal(app.node('#beaconAt').value, '');
  assert.equal(app.node('#beaconDelay').value, '900');
  assert.equal(app.node('#beaconTimingDelay').checked, true);
});
