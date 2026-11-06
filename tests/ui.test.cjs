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

test('reduced-motion remains honored unless the animation override is explicitly true', async () => {
  for (const override of [false, undefined, null, 1, 'true']) {
    const h = wheelHarness(); h.reduced(true);
    assert.equal(await h.run('testWheel.spin(testInput.anim, 2, false, testInput.override)', { anim: { ...animation, durationMs: 30000 }, override }), true);
    assert.equal(h.run('testReadout.textContent'), 'Carol');
    assert.equal(h.frames.size, 0);
  }
});

test('explicitly choosing full animation runs the entire 30-second wheel despite reduced-motion preference', async () => {
  const h = wheelHarness(); h.reduced(true);
  const pending = h.run('testWheel.spin(testInput, 1, false, true)', { ...animation, durationMs: 30000 });
  assert.equal(h.frames.size, 1);
  h.advance(29999);
  assert.equal(h.frames.size, 1);
  assert.equal(h.run('testWheel.frozen'), false);
  h.advance(1);
  assert.equal(await pending, true);
  assert.equal(h.run('testReadout.textContent'), 'Bob');
  assert.equal(h.frames.size, 0);
});

test('a 30-second wheel keeps animating until the full requested duration', async () => {
  const h = wheelHarness();
  const pending = h.run('testWheel.spin(testInput, 1, false)', { ...animation, durationMs: 30000 });
  h.advance(15000);
  assert.equal(h.frames.size, 1);
  assert.equal(h.run('testWheel.frozen'), false);
  h.advance(14999);
  assert.equal(h.frames.size, 1);
  h.advance(1);
  assert.equal(await pending, true);
  assert.equal(h.run('testReadout.textContent'), 'Bob');
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
    const tabName = attributes.match(/\bdata-tab="([^"]*)"/)?.[1];
    if (tabName) node.dataset.tab = tabName;
    elements.set(id, node);
  }
  // Model static select children as nodes so descendant option selectors behave
  // like the browser DOM, including their value, text and disabled properties.
  for (const match of html.matchAll(/<select\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/select>/g)) {
    const select = elements.get(match[1]);
    select.options = [...match[2].matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/g)].map((optionMatch) => {
      const option = element('option');
      option.value = optionMatch[1].match(/\bvalue="([^"]*)"/)?.[1] ?? optionMatch[2];
      option.textContent = optionMatch[2]; option.parentElement = select;
      option.disabled = /\bdisabled\b/.test(optionMatch[1]);
      option.selected = /\bselected\b/.test(optionMatch[1]);
      return option;
    });
    select.value = select.options.find((option) => option.selected)?.value ?? select.options[0]?.value ?? '';
    select.querySelector = (selector) => {
      const value = selector.match(/^option\[value="([^"]*)"\]$/)?.[1];
      if (value !== undefined) return select.options.find((option) => option.value === value) ?? null;
      throw new Error(`Unsupported select query: ${selector}`);
    };
  }
  elements.get('revealSeed').textContent = 'reveal';
  const tabs = [...elements.values()].filter((node) => node.tagName === 'BUTTON' && node.dataset.tab);
  const nav = element('nav'), importLabel = element('label'), meta = element('meta');
  document = eventTarget({
    documentElement: { dataset: { theme: 'dark' } }, activeElement: null, body: element('body'),
    querySelector: (selector) => {
      const descendant = selector.match(/^#([\w-]+)\s+(.+)$/);
      if (descendant) {
        const parent = elements.get(descendant[1]); assert.ok(parent, `DOM contains #${descendant[1]}`);
        return parent.querySelector(descendant[2]);
      }
      if (selector.startsWith('#')) { const node = elements.get(selector.slice(1)); assert.ok(node, `DOM contains ${selector}`); return node; }
      if (selector === 'nav.tabs') return nav;
      if (selector === 'label[for=csvFile]') return importLabel;
      if (selector === 'meta[name="theme-color"]') return meta;
      throw new Error(`Unsupported DOM selector: ${selector}`);
    },
    querySelectorAll: (selector) => {
      if (selector === 'nav.tabs button') return tabs;
      if (selector === '.tabpane') return tabs.map((tab) => elements.get(`tab-${tab.dataset.tab}`));
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

test('new sessions default to a 15-second spin and preserve it in saved audits', async () => {
  const app = appHarness();
  assert.equal(app.run('S.opts.duration'), 15);
  assert.equal(Number(app.elements.get('duration').value), 15);
  await app.click('sampleBtn'); await app.click('lockBtn'); await app.click('spinBtn');
  assert.equal(app.run('S.draws[0].anim.durationMs'), 15000);
  assert.equal(app.run('verifyAudit(buildAudit()).ok'), true);
  const restored = appHarness(app.storage);
  assert.equal(restored.run('restored'), true);
  assert.equal(restored.run('S.draws[0].anim.durationMs'), 15000);
});

test('the motion override is off by default and requires a saved explicit checkbox choice', async () => {
  const app = appHarness();
  assert.equal(app.run('S.opts.animateAnyway'), false);
  assert.equal(app.elements.get('animateAnyway').checked, false);
  assert.equal(app.elements.get('motionOptions').hidden, false, 'device reduced-motion preference exposes the explanatory option');
  app.elements.get('animateAnyway').checked = true;
  await app.elements.get('animateAnyway').dispatch('change');
  assert.equal(app.run('S.opts.animateAnyway'), true);
  assert.equal(JSON.parse(app.storage.get('fairspin.session.v1')).opts.animateAnyway, true);
  const restored = appHarness(app.storage);
  assert.equal(restored.run('restored'), true);
  assert.equal(restored.elements.get('animateAnyway').checked, true);
  await restored.click('clearBtn');
  assert.equal(restored.run('S.opts.animateAnyway'), false);
  assert.equal(restored.elements.get('animateAnyway').checked, false);
});

test('legacy sessions without an animation override restore safely and malformed opt-ins are rejected', () => {
  const app = appHarness(), saved = JSON.parse(app.storage.get('fairspin.session.v1'));
  delete saved.opts.animateAnyway;
  app.storage.set('fairspin.session.v1', JSON.stringify(saved));
  const restored = appHarness(app.storage);
  assert.equal(restored.run('restored'), true);
  assert.equal(restored.elements.get('animateAnyway').checked, false);
  for (const value of [undefined, false, true]) assert.equal(restored.run('validSession({ ...S, opts: { ...S.opts, animateAnyway: testInput } })', value), true);
  for (const value of [null, 'true', 'false', 1, 0, {}, []]) assert.equal(restored.run('validSession({ ...S, opts: { ...S.opts, animateAnyway: testInput } })', value), false);
});

test('the explicit motion checkbox controls full-duration draw and replay without changing the saved result', async () => {
  const app = appHarness();
  await app.click('sampleBtn');
  app.elements.get('duration').value = '30'; await app.elements.get('duration').dispatch('input');
  await app.click('lockBtn');
  app.elements.get('animateAnyway').checked = true;
  await app.elements.get('animateAnyway').dispatch('change');
  const pending = app.click('spinBtn');
  assert.equal(app.run('spinning'), true);
  assert.equal(app.elements.get('animateAnyway').disabled, true);
  assert.equal(app.run('S.draws.length'), 1, 'winner is still saved before animation');
  const winner = app.run('S.draws[0].winner');
  app.advance(29999);
  assert.equal(app.run('spinning'), true);
  assert.equal(app.frames.size, 1);
  app.advance(1); await pending;
  assert.equal(app.run('spinning'), false);
  assert.equal(app.elements.get('readVal').textContent, winner);
  assert.equal(app.frames.size, 0, 'confetti still respects the device preference');
  const replay = app.run('replay(S.draws[0])');
  app.advance(29999); assert.equal(app.run('spinning'), true);
  app.advance(1); await replay;
  assert.equal(app.run('S.draws.length'), 1);
  assert.equal(app.elements.get('readVal').textContent, winner);
  assert.equal(app.run('verifyAudit(buildAudit()).ok'), true);
});

test('a new winner stays concealed in Results until the spin finishes while its audit is already saved', async () => {
  const app = appHarness();
  app.run('S.raw = "Hidden Entrant Alpha\\nHidden Entrant Beta\\nHidden Entrant Gamma"; el.entries.value = S.raw; renderStats(); renderAll();');
  app.elements.get('duration').value = '30'; await app.elements.get('duration').dispatch('input');
  await app.click('lockBtn');
  app.elements.get('animateAnyway').checked = true;
  await app.elements.get('animateAnyway').dispatch('change');
  const pending = app.click('spinBtn');
  const winner = app.run('S.draws[0].winner');
  assert.equal(JSON.parse(app.storage.get('fairspin.session.v1')).draws[0].winner, winner);
  assert.equal(app.run('buildAudit().draws[0].winner'), winner);
  assert.equal(app.elements.get('winList').innerHTML.includes(winner), false);
  assert.equal(app.elements.get('nextDrawPanel').hidden, true);
  app.advance(29999);
  assert.equal(app.elements.get('winList').innerHTML.includes(winner), false);
  assert.equal(app.elements.get('nextDrawPanel').hidden, true);
  app.advance(1); await pending;
  assert.equal(app.elements.get('winList').innerHTML.includes(winner), true);
  assert.equal(app.elements.get('nextDrawPanel').hidden, false);
  const replay = app.run('replay(S.draws[0])');
  assert.equal(app.elements.get('winList').innerHTML.includes(winner), true, 'replaying a known result does not conceal it again');
  app.advance(30000); await replay;
  assert.equal(app.run('S.draws.length'), 1);
});

test('30-second GIF exports encode exactly 30 seconds of spin plus intro and result cards', async () => {
  const h = harness();
  // Keep the real frame timeline and encoder, with a single synthetic pixel
  // instead of rasterizing hundreds of full-size wheel frames.
  const gifSource = source.match(/async function makeGif\(info, onProgress\) \{[\s\S]*?\n\}\n/)[0];
  const runtime = vm.createContext({
    Blob, GIF_W: 1, GIF_H: 1, GIF_R: 1, GifWriter: h.run('GifWriter'), PALETTE: h.run('PALETTE'),
    document: { createElement: () => ({ getContext: () => ({ getImageData: () => ({}) }) }) },
    makeWheelBitmap: () => ({}), finalTheta: () => 1, renderGifFrame() {},
    quantize: () => new Uint8Array([1]), ease: (t) => t, sleep: async () => {},
  });
  vm.runInContext(gifSource, runtime);
  runtime.info = { n: 1, at: '2026-11-06T20:00:00.000Z', winner: 'A', vals: ['A', 'B'], poolIndex: 0, listHash: 'test', seedHash: 'test', hmac: 'test', anim: { durationMs: 30000 } };
  const blob = await vm.runInContext('makeGif(info)', runtime);
  const decoded = decodeGif(Buffer.from(await blob.arrayBuffer()));
  assert.equal(decoded.frames[0].delay, 90);
  assert.equal(decoded.frames.at(-1).delay, 450);
  assert.equal(decoded.frames.slice(1, -1).reduce((sum, frame) => sum + frame.delay, 0), 3000);
});

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
  assert.equal(app.elements.get('spinBtn').disabled, false);
  assert.equal(app.elements.get('spinBtn').hidden, false);
  assert.equal(app.elements.get('spinBtn').textContent, 'START NEXT DRAW');
  assert.equal(app.elements.get('nextDrawPanel').hidden, false);
  assert.equal(app.elements.get('nextSessionBtn').disabled, false);
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

test('planned winners keep NEXT SPIN visible and offer a new session at the same control after completion', async () => {
  const app = appHarness();
  await app.click('sampleBtn');
  app.elements.get('target').value = '2'; await app.elements.get('target').dispatch('change');
  await app.click('lockBtn');
  assert.equal(app.elements.get('nextDrawPanel').hidden, true);
  await app.click('spinBtn');
  assert.match(app.elements.get('spinBtn').textContent, /^NEXT SPIN/);
  assert.equal(app.elements.get('spinBtn').disabled, false);
  assert.equal(app.elements.get('spinBtn').hidden, false);
  assert.equal(app.elements.get('nextDrawPanel').hidden, true);
  await app.click('spinBtn');
  assert.equal(app.elements.get('spinBtn').disabled, false);
  assert.equal(app.elements.get('spinBtn').hidden, false);
  assert.equal(app.elements.get('spinBtn').textContent, 'START NEXT DRAW');
  assert.equal(app.elements.get('nextDrawPanel').hidden, false);
  assert.equal(app.elements.get('nextEntries').value, 'remaining');
  assert.equal(app.elements.get('nextEntries').options.find((option) => option.value === 'remaining').disabled, false);
});

test('the next-draw control stays available when the committed plan exhausts the pool', async () => {
  const app = appHarness();
  app.run('S.raw = "Alice\\nBob"; el.entries.value = S.raw; el.target.value = "2"; renderStats(); renderAll();');
  await app.click('lockBtn'); await app.click('spinBtn'); await app.click('spinBtn');
  assert.equal(app.run('currentPoolIdx().length'), 0);
  assert.equal(app.elements.get('spinBtn').hidden, false);
  assert.equal(app.elements.get('spinBtn').disabled, false);
  assert.equal(app.elements.get('spinBtn').textContent, 'START NEXT DRAW');
  assert.equal(app.elements.get('nextEntries').value, 'all');
});

test('primary buttons keep readable foreground/background contrast through hover and keyboard focus', () => {
  const css = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
  const declarations = (body) => Object.fromEntries(body.split(';').map((s) => s.trim()).filter(Boolean).map((s) => {
    const colon = s.indexOf(':'); return [s.slice(0, colon).trim(), s.slice(colon + 1).trim()];
  }));
  const root = declarations(css.match(/:root\s*\{([^}]+)\}/)[1]);
  const light = { ...root, ...declarations(css.match(/\[data-theme="light"\]\s*\{([^}]+)\}/)[1]) };
  const luminance = (hex) => {
    const value = hex.replace('#', ''), full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value;
    const channels = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255).map((c) => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  for (const [theme, vars] of [['dark', root], ['light', light]]) {
    for (const state of ['normal', 'hover', 'focus-visible']) {
      const rules = [];
      for (const [order, match] of [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].entries()) {
        for (const selector of match[1].trim().split(',').map((s) => s.trim())) {
          if (!/^\.btn(?:\.primary)?(?::(?:hover|focus-visible))?(?::not\(:disabled\))?$/.test(selector)) continue;
          if (selector.includes(':hover') && state !== 'hover') continue;
          if (selector.includes(':focus-visible') && state !== 'focus-visible') continue;
          const specificity = (selector.match(/\.[\w-]+|:(?:hover|focus-visible|disabled)/g) || []).length;
          rules.push({ specificity, order, declarations: declarations(match[2]) });
        }
      }
      rules.sort((a, b) => a.specificity - b.specificity || a.order - b.order);
      const resolved = Object.assign({}, ...rules.map((r) => r.declarations));
      const color = (value) => value.replace(/var\((--[\w-]+)\)/g, (_, token) => vars[token]);
      const a = luminance(color(resolved.background)), b = luminance(color(resolved.color));
      const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      assert.ok(ratio >= 4.5, `${theme} ${state} primary button contrast is ${ratio.toFixed(2)}:1`);
    }
  }
});

test('History participates in tab navigation and keeps the current draw accessible', async () => {
  const app = appHarness();
  await app.click('nav-history');
  assert.equal(app.elements.get('tab-history').hidden, false);
  assert.equal(app.elements.get('tab-draw').hidden, true);
  assert.equal(app.elements.get('nav-history').getAttribute('aria-selected'), 'true');
  assert.match(app.elements.get('historyCurrent').textContent, /current draft/);
  await app.click('backToDraw');
  assert.equal(app.elements.get('tab-history').hidden, true);
  assert.equal(app.elements.get('tab-draw').hidden, false);
  assert.equal(app.elements.get('nav-draw').getAttribute('aria-selected'), 'true');
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
  assert.equal(Number(app.elements.get('duration').value), 15);
  assert.equal(app.elements.get('durVal').textContent, '15s');
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
  app.advance(15000); await pending;
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
