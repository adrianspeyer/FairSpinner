'use strict';

// Run with Node's standard library only: node --test tests/*.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const source = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
  .find((match) => match[1].includes('function computeDraw'))[1].replace(/\binit\(\);\s*$/, '');

function harness() {
  let reduced = false, frameId = 0, time = 0;
  const frames = new Map();
  const context = vm.createContext({
    TextEncoder, Uint8Array, Uint32Array, Int16Array, DataView,
    document: { querySelector: () => null },
    window: { devicePixelRatio: 1, matchMedia: () => ({ matches: reduced }) },
    ResizeObserver: class { observe() {} },
    performance: { now: () => time },
    requestAnimationFrame: (callback) => { frames.set(++frameId, callback); return frameId; },
    cancelAnimationFrame: (id) => frames.delete(id),
    setTimeout, clearTimeout,
  });
  vm.runInContext(source, context, { timeout: 2000 });
  const run = (expression, input) => {
    context.testInput = input;
    return vm.runInContext(expression, context, { timeout: 3000 });
  };
  return {
    context, run, frames,
    reduced: (value) => { reduced = value; },
    advance: (ms) => {
      time += ms;
      const pending = [...frames.values()]; frames.clear();
      for (const callback of pending) callback(time);
    },
  };
}
const plain = (value) => JSON.parse(JSON.stringify(value));

test('CSV delimiter detection ignores separators inside quotes and multiline headers', () => {
  const { run } = harness();
  for (const [input, expected] of [
    ['"Full;legal;name"\temail\n"Smith; John; Jr"\tj@example.com', [['Full;legal;name', 'email'], ['Smith; John; Jr', 'j@example.com']]],
    ['"Full\nName";email\n"Alice\nSmith";a@example.com', [['Full\nName', 'email'], ['Alice\nSmith', 'a@example.com']]],
    ['name,email\r\n"Alice, A.",a@example.com\r\n"Bob ""B""",b@example.com', [['name', 'email'], ['Alice, A.', 'a@example.com'], ['Bob "B"', 'b@example.com']]],
    ['\uFEFF\r\nname;email\rAlice;a@example.com', [['name', 'email'], ['Alice', 'a@example.com']]],
    ['name,email\nAlice,\n,\nBob,b@example.com', [['name', 'email'], ['Alice', ''], ['Bob', 'b@example.com']]],
  ]) assert.deepEqual(plain(run('parseCSV(testInput)', input)), expected);
});

test('CSV parsing rejects broken quotes instead of silently changing entrants', () => {
  const { run } = harness();
  for (const input of ['name,email\n"Alice,a@example.com', '"Alice"x,email']) {
    assert.throws(() => run('parseCSV(testInput)', input), /quoted|quote/i);
  }
});

test('entry parsing handles CR, LF, CRLF, blanks and case-insensitive duplicates', () => {
  const { run } = harness();
  assert.deepEqual(plain(run('entriesFromRaw(testInput, true, true)', ' Alice \rBob\r\nALICE\n\n')),
    { entries: ['Alice', 'Bob'], dupes: 1 });
  assert.deepEqual(plain(run('entriesFromRaw(testInput, false, false)', 'Alice\nAlice')),
    { entries: ['Alice', 'Alice'], dupes: 0 });
});

function wheelHarness() {
  const h = harness();
  // Isolate timing and readout behavior from rasterization; the actual WheelView
  // implementation still owns cancellation, completion, sizing and frozen state.
  h.run(`WheelView.prototype.draw = function() {
    this.cur = this.vals.length ? idxAt(this.theta, this.vals.length) : -1;
    if (!this.frozen) this.valEl.textContent = this.cur < 0 ? '—' : this.vals[this.cur];
  };
  globalThis.testCanvas = { getContext: () => ({}), parentElement: { clientWidth: 100 }, style: {} };
  globalThis.testReadout = { textContent: '' };
  globalThis.testWheel = new WheelView(testCanvas, testReadout);
  testWheel.setPool(['Alice', 'Bob', 'Carol']);`);
  return h;
}
const animation = { durationMs: 7000, turns: 7, frac: 0.5 };

test('wheel cancellation settles the previous spin and prevents stale frames', async () => {
  const h = wheelHarness();
  const first = h.run('testWheel.spin(testInput, 0, false)', animation);
  assert.equal(h.frames.size, 1);
  const second = h.run('testWheel.spin(testInput, 1, false)', animation);
  assert.equal(await first, false);
  assert.equal(h.frames.size, 1);
  h.advance(7000);
  assert.equal(await second, true);
  assert.equal(h.run('testReadout.textContent'), 'Bob');
  assert.equal(h.frames.size, 0);
});

test('replacing the pool cancels pending animation and restores a live readout', async () => {
  const h = wheelHarness();
  const pending = h.run('testWheel.spin(testInput, 1, false)', animation);
  h.run("testWheel.setPool(['New entrant'])");
  assert.equal(await pending, false);
  assert.equal(h.frames.size, 0);
  assert.equal(h.run('testReadout.textContent'), 'New entrant');
  assert.equal(h.run('testWheel.frozen'), false);
});

test('reduced-motion wheel reveals the actual winner with no animation frames', async () => {
  const h = wheelHarness(); h.reduced(true);
  assert.equal(await h.run('testWheel.spin(testInput, 2, false)', animation), true);
  assert.equal(h.run('testReadout.textContent'), 'Carol');
  assert.equal(h.run('testWheel.hl'), 2);
  assert.equal(h.run('testWheel.frozen'), true);
  assert.equal(h.frames.size, 0);
});

test('completed winner text survives redraws and fractional CSS resize updates', async () => {
  const h = wheelHarness();
  const pending = h.run('testWheel.spin(testInput, 1, false)', animation);
  h.advance(7000); assert.equal(await pending, true);
  h.run("testReadout.textContent = 'Winner: Bob'; testWheel.draw(); testCanvas.parentElement.clientWidth = 100.2; testWheel.resize();");
  assert.equal(h.run('testReadout.textContent'), 'Winner: Bob');
  assert.equal(h.run('testCanvas.style.width'), '100.2px');
  assert.equal(h.run('testCanvas.width'), 100);
});

test('confetti honors reduced motion and replaces an existing animation', () => {
  const h = harness();
  h.run(`globalThis.testEffects = {
    style: {}, getContext: () => ({ clearRect() {}, save() {}, translate() {}, rotate() {}, fillRect() {}, restore() {} }),
  };
  document.querySelector = (selector) => selector === '#fx' ? testEffects : { width: 500, height: 500, style: { width: '500px', height: '500px' }, offsetLeft: 0 };`);
  h.reduced(true); h.run('confetti()');
  assert.equal(h.frames.size, 0);
  h.reduced(false); h.run('confetti()');
  assert.equal(h.frames.size, 1);
  h.run('confetti()');
  assert.equal(h.frames.size, 1);
  h.advance(2000);
  assert.equal(h.frames.size, 0);
});

// Independent GIF decoder: read the file framing, then decode standard GIF LZW.
// This does not reuse any production encoder logic or dependencies.
function decodeLzw(bytes, minCodeSize, expectedSize) {
  const clear = 1 << minCodeSize, end = clear + 1;
  let size, next, table, previous = null, bit = 0;
  const out = [];
  const reset = () => {
    table = Array.from({ length: clear }, (_, i) => [i]);
    size = minCodeSize + 1; next = end + 1; previous = null;
  };
  reset();
  for (;;) {
    assert.ok(bit + size <= bytes.length * 8, 'GIF stream must contain an end code');
    let code = 0;
    for (let i = 0; i < size; i++, bit++) code |= ((bytes[bit >> 3] >> (bit & 7)) & 1) << i;
    if (code === clear) { reset(); continue; }
    if (code === end) break;
    const entry = table[code] || (code === next && previous ? [...previous, previous[0]] : null);
    assert.ok(entry, `valid LZW code ${code}`);
    out.push(...entry);
    assert.ok(out.length <= expectedSize, 'decoded frame must not exceed its dimensions');
    if (previous && next < 4096) {
      table[next++] = [...previous, entry[0]];
      if (next === (1 << size) && size < 12) size++;
    }
    previous = entry;
  }
  assert.equal(out.length, expectedSize);
  return Buffer.from(out);
}

function decodeGif(bytes) {
  const data = Buffer.from(bytes);
  assert.equal(data.subarray(0, 6).toString(), 'GIF89a');
  const width = data.readUInt16LE(6), height = data.readUInt16LE(8), flags = data[10];
  let pos = 13 + ((flags & 128) ? 3 * (1 << ((flags & 7) + 1)) : 0), delay = 0;
  const frames = [], comments = [];
  const blocks = () => {
    const parts = [];
    while (data[pos]) { const n = data[pos++]; parts.push(data.subarray(pos, pos + n)); pos += n; }
    pos++; return Buffer.concat(parts);
  };
  while (pos < data.length) {
    const marker = data[pos++];
    if (marker === 0x3b) return { width, height, frames, comments };
    if (marker === 0x21) {
      const type = data[pos++];
      const body = blocks();
      if (type === 0xf9) delay = body.readUInt16LE(1);
      if (type === 0xfe) comments.push(body.toString('utf8'));
    } else {
      assert.equal(marker, 0x2c, 'valid image descriptor');
      const w = data.readUInt16LE(pos + 4), h = data.readUInt16LE(pos + 6), packed = data[pos + 8]; pos += 9;
      assert.equal(packed & 64, 0, 'test decoder expects non-interlaced frames');
      if (packed & 128) pos += 3 * (1 << ((packed & 7) + 1));
      const codeSize = data[pos++], compressed = blocks();
      frames.push({ width: w, height: h, delay, pixels: decodeLzw(compressed, codeSize, w * h) });
    }
  }
  assert.fail('GIF trailer missing');
}

test('GIF encoder roundtrips palette indices, Unicode comments and frame delays', () => {
  const { run } = harness();
  let state = 12345;
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state >>> 24; };
  for (const [width, height, pattern] of [[1, 1, 'constant'], [32, 32, 'random'], [400, 488, 'constant'], [400, 488, 'ramp'], [400, 488, 'random']]) {
    const pixels = Uint8Array.from({ length: width * height }, (_, i) => pattern === 'constant' ? 7 : pattern === 'ramp' ? i % 256 : random());
    const bytes = run(`(() => {
      const w = new GifWriter(testInput.width, testInput.height, PALETTE);
      w.comment('FairSpin · Zoé 🌀');
      w.frame(testInput.pixels, 7); w.frame(testInput.pixels, 450);
      return w.end();
    })()`, { width, height, pixels });
    const decoded = decodeGif(bytes);
    assert.deepEqual([decoded.width, decoded.height], [width, height]);
    assert.deepEqual(decoded.comments, ['FairSpin · Zoé 🌀']);
    assert.deepEqual(decoded.frames.map((f) => f.delay), [7, 450]);
    for (const frame of decoded.frames) assert.deepEqual(frame.pixels, Buffer.from(pixels));
  }
});

// These are application/event integration smoke tests, not browser rendering or
// accessibility checks. A minimal DOM and inert canvas let the real init and
// event handlers run without installing a browser or third-party dependencies.
function appHarness(storage = new Map()) {
  let reduced = true, frameId = 0, timerId = 0, time = 0;
  const frames = new Map(), timers = new Map(), elements = new Map(), downloads = [];
  const eventTarget = (target) => {
    target.listeners = new Map();
    target.addEventListener = (name, callback) => {
      const list = target.listeners.get(name) || []; list.push(callback); target.listeners.set(name, list);
    };
    target.dispatch = (name, event = {}) => {
      event.target ||= target; event.preventDefault ||= () => {};
      return Promise.all([target[`on${name}`], ...(target.listeners.get(name) || [])].filter(Boolean).map((callback) => callback(event)));
    };
    return target;
  };
  const paintContext = () => new Proxy({
    measureText: (text) => ({ width: String(text).length * 7 }),
    createRadialGradient: () => ({ addColorStop() {} }),
  }, { get: (target, property) => property in target ? target[property] : () => {} });
  let document;
  function element(tagName = 'div', id = '') {
    const classes = new Set(), attrs = new Map();
    const node = eventTarget({
      id, tagName: tagName.toUpperCase(), dataset: {}, style: {}, value: '', checked: false,
      disabled: false, hidden: false, textContent: '', innerHTML: '', width: 300, height: 150,
      clientWidth: 500, offsetLeft: 0, parentElement: { clientWidth: 500 },
      firstElementChild: { style: {} }, lastElementChild: { textContent: '' },
      classList: {
        add: (...names) => names.forEach((name) => classes.add(name)),
        remove: (...names) => names.forEach((name) => classes.delete(name)),
        contains: (name) => classes.has(name),
        toggle: (name, force) => { const on = force ?? !classes.has(name); if (on) classes.add(name); else classes.delete(name); return on; },
      },
      setAttribute: (name, value) => attrs.set(name, String(value)),
      getAttribute: (name) => attrs.get(name) ?? null,
      removeAttribute: (name) => attrs.delete(name),
      focus() { document.activeElement = node; }, select() {}, appendChild() {}, remove() {},
      click() { if (node.tagName === 'A') downloads.push(node.download); return node.disabled ? Promise.resolve() : node.dispatch('click'); },
      getContext: () => paintContext(),
      toBlob: (callback) => callback(new Blob(['image'], { type: 'image/png' })),
      querySelector: () => null,
    });
    return node;
  }
  for (const match of html.matchAll(/<(\w+)\b([^>]*\bid="([^"]+)"[^>]*)>/g)) {
    const [, tag, attributes, id] = match, node = element(tag, id);
    node.value = attributes.match(/\bvalue="([^"]*)"/)?.[1] || '';
    node.checked = /\bchecked\b/.test(attributes); node.hidden = /\bhidden\b/.test(attributes);
    node.disabled = /\bdisabled\b/.test(attributes);
    elements.set(id, node);
  }
  elements.get('revealSeed').textContent = 'reveal';
  const tabs = ['draw', 'verify', 'how'].map((name) => { const tab = element('button'); tab.dataset.tab = name; return tab; });
  const nav = element('nav'), importLabel = element('label'), meta = element('meta');
  document = eventTarget({
    documentElement: { dataset: { theme: 'dark' } }, activeElement: null, body: element('body'),
    querySelector: (selector) => {
      if (selector.startsWith('#')) { const node = elements.get(selector.slice(1)); assert.ok(node, `DOM contains ${selector}`); return node; }
      if (selector === 'nav.tabs') return nav;
      if (selector === 'label[for=csvFile]') return importLabel;
      if (selector === 'meta[name="theme-color"]') return meta;
      throw new Error(`Unsupported DOM selector: ${selector}`);
    },
    querySelectorAll: (selector) => {
      if (selector === 'nav.tabs button') return tabs;
      if (selector === '.tabpane') return ['draw', 'verify', 'how'].map((name) => elements.get(`tab-${name}`));
      throw new Error(`Unsupported DOM query: ${selector}`);
    },
    createElement: element,
    execCommand: () => true,
  });
  const window = eventTarget({ devicePixelRatio: 1, matchMedia: () => ({ matches: reduced }) });
  const context = vm.createContext({
    TextEncoder, Uint8Array, Uint32Array, Int16Array, DataView, Blob,
    crypto: crypto.webcrypto, document, window,
    navigator: { clipboard: { writeText: async () => {} } },
    localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)), removeItem: (key) => storage.delete(key) },
    getComputedStyle: () => ({ getPropertyValue: () => '#141821' }),
    ResizeObserver: class { observe() {} },
    performance: { now: () => time },
    requestAnimationFrame: (callback) => { frames.set(++frameId, callback); return frameId; },
    cancelAnimationFrame: (id) => frames.delete(id),
    setTimeout: (callback, ms) => { timers.set(++timerId, { callback, ms }); return timerId; },
    clearTimeout: (id) => timers.delete(id), confirm: () => true,
    URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
  });
  vm.runInContext(source, context, { timeout: 3000 });
  const run = (expression, input) => { context.testInput = input; return vm.runInContext(expression, context, { timeout: 3000 }); };
  run('init()');
  return {
    run, elements, storage, frames, downloads, window,
    click: (id) => elements.get(id).click(),
    reduced: (value) => { reduced = value; },
    advance: (ms) => { time += ms; const pending = [...frames.values()]; frames.clear(); for (const callback of pending) callback(time); },
    flushTimers: () => { const pending = [...timers.values()]; timers.clear(); for (const timer of pending) timer.callback(); },
  };
}

test('application initializes, loads sample, locks rules, draws, verifies and restores persisted results', async () => {
  const app = appHarness();
  assert.equal(app.run('S.draws.length'), 0);
  assert.equal(app.elements.get('spinBtn').disabled, true);
  assert.ok(app.storage.get('fairspin.session.v1'), 'new session is saved on init');
  await app.click('sampleBtn');
  assert.equal(app.run('liveList().entries.length'), 17);
  assert.equal(app.elements.get('lockBtn').disabled, false);
  await app.click('lockBtn');
  assert.equal(app.elements.get('target').disabled, true);
  assert.equal(app.elements.get('csvHeader').disabled, true);
  assert.equal(app.elements.get('spinBtn').disabled, false);
  const commitment = app.run('S.locked.seedHash');
  await app.click('spinBtn');
  assert.equal(app.run('S.draws.length'), 1);
  assert.equal(app.run('verifyAudit(buildAudit()).ok'), true);
  assert.equal(app.elements.get('readVal').textContent, app.run('S.draws[0].winner'));
  assert.equal(app.elements.get('spinBtn').disabled, true);
  assert.match(app.elements.get('announcement').textContent, /^Winner 1 of 1:/);
  await app.click('vUseCurrent');
  assert.match(app.elements.get('vOut').innerHTML, /Draw calculations verified/);
  const restored = appHarness(app.storage);
  assert.equal(restored.run('restored'), true);
  assert.equal(restored.run('S.draws.length'), 1);
  assert.equal(restored.run('S.locked.seedHash'), commitment);
  assert.equal(restored.run('verifyAudit(buildAudit()).ok'), true);
  assert.equal(restored.elements.get('readVal').textContent, app.run('S.draws[0].winner'));
});

test('clear resets controls, concealed seed and verification state', async () => {
  const app = appHarness();
  await app.click('sampleBtn');
  app.elements.get('duration').value = '15'; await app.elements.get('duration').dispatch('input');
  app.elements.get('sound').checked = false; await app.elements.get('sound').dispatch('change');
  await app.click('lockBtn'); await app.click('spinBtn'); await app.click('revealSeed'); await app.click('vUseCurrent');
  assert.equal(app.elements.get('revealSeed').textContent, 'hide');
  const oldId = app.run('S.id');
  await app.click('clearBtn');
  assert.notEqual(app.run('S.id'), oldId);
  assert.equal(app.run('S.locked'), null);
  assert.equal(app.run('S.draws.length'), 0);
  assert.equal(Number(app.elements.get('duration').value), 7);
  assert.equal(app.elements.get('durVal').textContent, '7s');
  assert.equal(app.elements.get('sound').checked, true);
  assert.equal(app.elements.get('revealSeed').textContent, 'reveal');
  assert.match(app.elements.get('hSeedRaw').textContent, /hidden/);
  assert.equal(app.elements.get('vOut').hidden, true);
  assert.equal(app.elements.get('vText').value, '');
  assert.equal(app.elements.get('entries').value, '');
});

test('clear is blocked while a spin or export is active', async () => {
  const app = appHarness(); await app.click('sampleBtn'); await app.click('lockBtn');
  app.reduced(false);
  const pending = app.click('spinBtn'), id = app.run('S.id');
  assert.equal(app.run('spinning'), true);
  assert.equal(app.elements.get('clearBtn').disabled, true);
  app.run("$('#clearBtn').onclick()");
  assert.equal(app.run('S.id'), id);
  app.advance(7000); await pending;
  app.run('exporting = true; renderAll()');
  app.run("$('#clearBtn').onclick()");
  assert.equal(app.run('S.id'), id);
  assert.equal(app.elements.get('clearBtn').disabled, true);
});

test('a delayed file import cannot replace a list locked during the read', async () => {
  const app = appHarness(); await app.click('sampleBtn');
  const raw = app.run('S.raw'); let finish;
  const file = { name: 'names.txt', size: 20, text: () => new Promise((resolve) => { finish = resolve; }) };
  await app.elements.get('csvFile').dispatch('change', { target: { files: [file], value: '' } });
  await app.click('lockBtn');
  finish('Different Alice\nDifferent Bob'); await Promise.resolve(); await Promise.resolve();
  assert.equal(app.run('S.raw'), raw);
  assert.equal(app.run('S.locked.entries.length'), 17);
  assert.match(app.elements.get('toast').textContent, /Import cancelled/);
  assert.equal(app.run('verifyAudit(buildAudit()).ok'), true);
});

test('TXT preserves commas and CSV multiline cells stay one entrant', async () => {
  const app = appHarness();
  const importFile = async (name, text) => {
    await app.elements.get('csvFile').dispatch('change', { target: { files: [{ name, size: text.length, text: async () => text }], value: '' } });
    await Promise.resolve(); await Promise.resolve();
  };
  await importFile('names.txt', 'Smith, Alice\nJones, Bob');
  assert.deepEqual(plain(app.run('liveList().entries')), ['Smith, Alice', 'Jones, Bob']);
  await importFile('names.csv', 'name,email\n"Alice\nSmith",a@example.com\nBob,b@example.com');
  assert.deepEqual(plain(app.run('liveList().entries')), ['a@example.com', 'b@example.com']);
  app.elements.get('csvCol').value = '0'; await app.elements.get('csvCol').dispatch('change');
  assert.deepEqual(plain(app.run('liveList().entries')), ['Alice Smith', 'Bob']);
});
