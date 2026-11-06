'use strict';

// State/event integration coverage. These DOM stubs do not replace browser QA.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const source = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
  .find((match) => match[1].includes('function computeDraw'))[1].replace(/\binit\(\);\s*$/, '');
const SESSION_KEY = 'fairspin.session.v1', HISTORY_KEY = 'fairspin.history.v1';
const plain = (value) => JSON.parse(JSON.stringify(value));

function appHarness(initial = new Map()) {
  const nodes = new Map(), storage = new Map(initial), downloads = [];
  let document;
  const node = (selector) => {
    if (!nodes.has(selector)) {
      const handlers = new Map(), attrs = new Map(), classes = new Set();
      const element = {
        innerHTML: '', textContent: '', value: '', hidden: true, disabled: false, checked: false,
        style: {}, dataset: {}, lastElementChild: {}, parentElement: { clientWidth: 400 },
        classList: {
          add: (...names) => names.forEach((name) => classes.add(name)),
          remove: (...names) => names.forEach((name) => classes.delete(name)),
          toggle: (name, force) => { const on = force ?? !classes.has(name); if (on) classes.add(name); else classes.delete(name); return on; },
        },
        setAttribute: (name, value) => attrs.set(name, String(value)),
        getAttribute: (name) => attrs.get(name) ?? null,
        removeAttribute: (name) => attrs.delete(name),
        addEventListener: (name, fn) => handlers.set(name, fn),
        async dispatch(name, event = {}) { const e = { target: element, preventDefault() {}, ...event }; await element['on' + name]?.(e); await handlers.get(name)?.(e); },
        focus() { document.activeElement = element; }, scrollIntoView() {}, select() {}, appendChild() {}, remove() {},
        click() { return element.dispatch('click'); },
        getContext: () => ({ clearRect() {} }),
        querySelector: () => null,
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
  document = {
    querySelector: node, querySelectorAll: () => [], addEventListener() {},
    documentElement: { dataset: { theme: 'dark' } }, activeElement: null,
  };
  const runtime = vm.createContext({
    TextEncoder, TextDecoder, Uint8Array, Uint32Array, Int16Array, DataView, Blob,
    crypto: crypto.webcrypto, document, localStorage,
    setTimeout: () => 0, clearTimeout() {}, cancelAnimationFrame() {},
    window: { addEventListener() {}, matchMedia: () => ({ matches: true }) },
    confirm: () => true, matchMedia: () => ({ matches: true }),
    getComputedStyle: () => ({ getPropertyValue: () => '#000' }),
  });
  vm.runInContext(source, runtime, { timeout: 3000 });
  vm.runInContext(`WheelView = class {
    setPool() {} draw() {} showResult() {} resize() {} cancelSpin() {}
    spin() { return Promise.resolve(true); }
  }; downloadBlob = (blob, name) => testDownloads.push({ blob, name });`, Object.assign(runtime, { testDownloads: downloads }));
  const run = (code, input) => { runtime.testInput = input; return vm.runInContext(code, runtime, { timeout: 3000 }); };
  run('init()');
  return { run, node, nodes, storage, localStorage, runtime, downloads };
}

async function completed(app, entries = ['Ava', 'Noah', 'Mia', 'Zoé'], target = 1) {
  app.run('S.raw = testInput.join("\\n"); el.entries.value = S.raw; S.opts.dedupe = false; S.opts.sound = false;', entries);
  app.node('#target').value = String(target);
  app.run('lockList()');
  for (let i = 0; i < target; i++) await app.run('spin()');
  assert.equal(app.run('S.draws.length'), target);
  assert.equal(app.run('verifyAudit(buildAudit()).ok'), true);
}

test('next draw archives the complete proof and prepares an unlocked draft with the same entries', async () => {
  const app = appHarness(); await completed(app);
  const old = plain(app.run('S'));
  await app.run('startNextDraw("all")');
  assert.notEqual(app.run('S.id'), old.id);
  assert.equal(app.run('S.locked'), null);
  assert.equal(app.run('S.draws.length'), 0);
  assert.equal(app.run('S.raw'), old.locked.entries.join('\n'));
  assert.equal(app.run('S.entropy.value'), '');
  assert.equal(app.run('S.entropy.note'), '');
  assert.equal(app.run('H.sessions.length'), 1);
  const audit = plain(app.run('H.sessions[0].audit'));
  assert.equal(audit.session.id, old.id);
  assert.deepEqual(audit.draws, old.draws);
  assert.deepEqual(audit.list.entries, old.locked.entries);
  assert.equal(audit.reveal.seed, old.locked.seed);
  assert.equal(app.run('verifyAudit(H.sessions[0].audit).ok'), true);
  app.run('lockList()');
  assert.notEqual(app.run('S.locked.seed'), old.locked.seed, 'next draw uses a new commitment');
});

test('archived history and the new current draft survive a refresh', async () => {
  const app = appHarness(); await completed(app); await app.run('startNextDraw("blank")');
  const nextId = app.run('S.id'), oldId = app.run('H.sessions[0].audit.session.id');
  const refreshed = appHarness(app.storage);
  assert.equal(refreshed.run('S.id'), nextId);
  assert.equal(refreshed.run('S.raw'), '');
  assert.equal(refreshed.run('H.sessions[0].audit.session.id'), oldId);
  assert.equal(refreshed.run('verifyAudit(H.sessions[0].audit).ok'), true);
});

test('remaining entries remove winning slots and preserve duplicate names still eligible', async () => {
  const app = appHarness(); await completed(app, ['Same', 'Same', 'Other', 'Fourth']);
  const expected = plain(app.run('currentPoolIdx().map(i => S.locked.entries[i])'));
  await app.run('startNextDraw("remaining")');
  assert.deepEqual(plain(app.run('liveList().entries')), expected);
  assert.equal(app.run('S.opts.dedupe'), false);
});

test('a next draw cannot extend an incomplete committed plan or run while busy', async () => {
  const app = appHarness();
  app.run('S.raw = "Ava\\nNoah\\nMia"; S.opts.sound = false; el.target.value = "2"; lockList()');
  await app.run('spin()');
  const before = plain(app.run('S'));
  await app.run('startNextDraw("all")');
  assert.equal(app.run('S.id'), before.id);
  assert.equal(app.run('S.locked.winnersTarget'), 2);
  assert.equal(app.run('H.sessions.length'), 0);
  await app.run('spin()');
  for (const flag of ['spinning', 'exporting']) {
    app.run(`${flag} = true`); await app.run('startNextDraw("all")');
    assert.equal(app.run('S.id'), before.id);
    app.run(`${flag} = false`);
  }
  assert.equal(app.run('H.sessions.length'), 0);
});

test('history quota failure leaves the completed session and saved proof intact', async () => {
  const app = appHarness(); await completed(app);
  const before = app.storage.get(SESSION_KEY), id = app.run('S.id');
  const write = app.localStorage.setItem;
  app.localStorage.setItem = (key, value) => { if (key === HISTORY_KEY) throw new Error('QuotaExceededError'); return write(key, value); };
  await app.run('startNextDraw("all")');
  assert.equal(app.run('S.id'), id);
  assert.equal(app.storage.get(SESSION_KEY), before);
  assert.equal(app.run('S.draws.length'), 1);
  assert.equal(app.storage.has(HISTORY_KEY), false);
});

test('malformed saved history is preserved and never overwritten by the next draw', async () => {
  const corrupt = '{"version":1,"sessions":"not an array"}';
  const app = appHarness(new Map([[HISTORY_KEY, corrupt]])); await completed(app);
  const id = app.run('S.id');
  await app.run('startNextDraw("all")');
  assert.equal(app.storage.get(HISTORY_KEY), corrupt);
  assert.equal(app.run('S.id'), id);
  assert.equal(app.run('verifyAudit(buildAudit()).ok'), true);
});

test('clearing the current session does not delete archived history', async () => {
  const app = appHarness(); await completed(app); await app.run('startNextDraw("all")');
  const archived = app.storage.get(HISTORY_KEY);
  await app.node('#clearBtn').dispatch('click');
  assert.equal(app.storage.get(HISTORY_KEY), archived);
  assert.equal(app.run('H.sessions.length'), 1);
  assert.equal(app.run('S.raw'), '');
});

test('archiving the same completed session twice does not duplicate it', async () => {
  const app = appHarness(); await completed(app);
  assert.equal(app.run('archiveCurrent()'), true);
  assert.equal(app.run('archiveCurrent()'), true);
  assert.equal(app.run('H.sessions.length'), 1);
});

test('the same seed with changed archived rules is not treated as an identical completed proof', async () => {
  const app = appHarness(); await completed(app);
  assert.equal(app.run('archiveCurrent()'), true);
  const id = app.run('S.id'), before = app.storage.get(SESSION_KEY);
  const history = JSON.parse(app.storage.get(HISTORY_KEY)), audit = history.sessions[0].audit;
  // With one draw, changing removal rules leaves the mathematical winner
  // unchanged. The public commitment still differs and must be preserved.
  audit.commitment.removeWinners = false;
  delete audit.integrity;
  audit.integrity = { method: 'SHA-256 of JSON.stringify(this object without "integrity"), no whitespace', sha256: crypto.createHash('sha256').update(JSON.stringify(audit)).digest('hex') };
  assert.equal(app.run('verifyAudit(testInput).ok', audit), true);
  const modifiedHistory = JSON.stringify(history);
  app.storage.set(HISTORY_KEY, modifiedHistory);
  assert.equal(app.run('archiveCurrent()'), false);
  assert.equal(app.run('startNextDraw("all")'), false);
  assert.equal(app.run('S.id'), id);
  assert.equal(app.run('S.locked.removeWinners'), true);
  assert.equal(app.storage.get(SESSION_KEY), before);
  assert.equal(app.storage.get(HISTORY_KEY), modifiedHistory);
});

test('failure saving the next current session does not discard the completed proof', async () => {
  const app = appHarness(); await completed(app);
  const before = app.storage.get(SESSION_KEY), oldId = app.run('S.id');
  const write = app.localStorage.setItem;
  app.localStorage.setItem = (key, value) => { if (key === SESSION_KEY) throw new Error('QuotaExceededError'); return write(key, value); };
  await app.run('startNextDraw("all")');
  assert.equal(app.storage.get(SESSION_KEY), before);
  assert.equal(app.run('S.id'), oldId);
  assert.equal(app.run('S.draws.length'), 1);
  assert.equal(app.run('verifyAudit(buildAudit()).ok'), true);
});

test('a changed history in another tab is merged or blocked without losing its archive', async () => {
  const app = appHarness(); await completed(app);
  const other = appHarness(); await completed(other, ['External one', 'External two']);
  assert.equal(other.run('archiveCurrent()'), true);
  const externalId = other.run('S.id');
  app.storage.set(HISTORY_KEY, other.storage.get(HISTORY_KEY));
  await app.run('startNextDraw("all")');
  const stored = JSON.parse(app.storage.get(HISTORY_KEY));
  assert.ok(stored.sessions.some((entry) => entry.audit.session.id === externalId));
});

test('untrusted archived winner names render as text, not executable HTML', async () => {
  const app = appHarness();
  await completed(app, ['<img src=x onerror=alert(1)>', '<img src=y onerror=alert(2)>']);
  assert.equal(app.run('archiveCurrent()'), true);
  app.run('renderHistory()');
  // A valid audit may contain literal markup in an entry, but every HTML sink
  // used by the history UI must encode that markup before rendering.
  assert.match(app.run('JSON.stringify(H)'), /<img/, 'history retains the original entry for verification');
  const historyHTML = [...app.nodes].filter(([selector]) => /history/i.test(selector)).map(([, element]) => element.innerHTML).join('');
  assert.match(historyHTML, /&lt;img/, 'the original winner is shown as escaped text');
  assert.doesNotMatch(historyHTML, /<img\b/i);
});

test('full history blocks a new draw without evicting its oldest proof', async () => {
  const app = appHarness();
  for (let i = 0; i < 20; i++) {
    await completed(app);
    assert.equal(app.run('startNextDraw("all")'), true);
  }
  assert.equal(app.run('H.sessions.length'), 20);
  const historyBefore = app.storage.get(HISTORY_KEY);
  await completed(app);
  const id = app.run('S.id');
  assert.equal(app.run('startNextDraw("all")'), false);
  assert.equal(app.run('S.id'), id);
  assert.equal(app.storage.get(HISTORY_KEY), historyBefore);
  assert.equal(app.run('H.sessions.length'), 20);
});

test('history storage size limit rejects another large audit without data loss', async () => {
  const app = appHarness();
  const entries = Array.from({ length: 4000 }, (_, i) => `${i}:` + 'x'.repeat(245));
  await completed(app, entries);
  assert.equal(app.run('startNextDraw("all")'), true);
  const historyBefore = app.storage.get(HISTORY_KEY);
  assert.ok(historyBefore.length * 2 > 1.5 * 1024 * 1024);
  await completed(app, entries);
  const id = app.run('S.id');
  assert.equal(app.run('startNextDraw("all")'), false);
  assert.equal(app.run('S.id'), id);
  assert.equal(app.storage.get(HISTORY_KEY), historyBefore);
});

test('remaining-list transition is blocked when fewer than two eligible entries remain', async () => {
  const app = appHarness(); await completed(app, ['Ava', 'Noah']);
  const id = app.run('S.id');
  assert.equal(app.run('startNextDraw("remaining")'), false);
  assert.equal(app.run('S.id'), id);
  assert.equal(app.run('H.sessions.length'), 0);
  assert.equal(app.run('startNextDraw("all")'), true);
});

test('saved draws can be downloaded, verified and deleted without changing the current draft', async () => {
  const app = appHarness(); await completed(app);
  const oldId = app.run('S.id');
  assert.equal(app.run('startNextDraw("all")'), true);
  const currentId = app.run('S.id'), key = app.run('H.sessions[0].audit.commitment.seedSha256');
  const action = (name) => app.node('#historyList').dispatch('click', {
    target: { closest: () => ({ dataset: { history: name, key } }) },
  });
  await action('download');
  assert.equal(app.downloads.length, 1);
  const downloaded = JSON.parse(await app.downloads[0].blob.text());
  assert.equal(downloaded.session.id, oldId);
  assert.equal(app.run('verifyAudit(testInput).ok', downloaded), true);
  await action('verify');
  await app.node('#vRun').dispatch('click');
  assert.equal(app.run('verifyingHistoryKey'), key, 'rechecking an archived audit retains deletion cleanup');
  assert.equal(JSON.parse(app.node('#vText').value).session.id, oldId);
  assert.match(app.node('#vOut').innerHTML, /Draw calculations verified/);
  assert.equal(app.run('S.id'), currentId);
  await action('delete');
  assert.equal(app.run('H.sessions.length'), 0);
  assert.equal(app.run('S.id'), currentId);
  assert.equal(app.node('#vText').value, '');
  assert.equal(app.node('#vOut').hidden, true);
  assert.equal(app.node('#vOut')._audit, null);
  assert.deepEqual(plain(app.node('#vOut')._results), []);
  assert.equal(app.run('verifyingHistoryKey'), null);
});

test('history backup contains complete audits and clearing history leaves the current session intact', async () => {
  const app = appHarness(); await completed(app); await app.run('startNextDraw("all")');
  const currentId = app.run('S.id');
  await app.node('#exportHistory').dispatch('click');
  assert.equal(app.downloads[0].name, 'fairspin-history.json');
  const backup = JSON.parse(await app.downloads[0].blob.text());
  assert.equal(backup.sessions.length, 1);
  assert.equal(app.run('verifyAudit(testInput.sessions[0].audit).ok', backup), true);
  const key = app.run('H.sessions[0].audit.commitment.seedSha256');
  await app.node('#historyList').dispatch('click', {
    target: { closest: () => ({ dataset: { history: 'verify', key } }) },
  });
  assert.equal(app.run('verifyingHistoryKey'), key);
  app.run('globalThis.cancelledHistoryReplay = false; verifyView.setPool = () => { cancelledHistoryReplay = true; };');
  await app.node('#clearHistory').dispatch('click');
  assert.equal(app.storage.has(HISTORY_KEY), false);
  assert.equal(app.run('H.sessions.length'), 0);
  assert.equal(app.run('S.id'), currentId);
  assert.equal(app.node('#vText').value, '');
  assert.equal(app.node('#vOut').hidden, true);
  assert.equal(app.node('#vOut')._audit, null);
  assert.equal(app.run('verifyingHistoryKey'), null);
  assert.equal(app.run('cancelledHistoryReplay'), true);
});
