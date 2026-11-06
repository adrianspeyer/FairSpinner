'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const releaseFiles = ['package.json', 'package-lock.json', 'CHANGELOG.md', 'README.md', 'index.html'];
const snapshot = dir => Object.fromEntries(releaseFiles.map(file => [file, fs.readFileSync(path.join(dir, file), 'utf8')]));
const run = (dir, args = ['--check']) => spawnSync(process.execPath, [path.join(dir, 'scripts', 'sync-release.cjs'), ...args], {
  cwd: dir, encoding: 'utf8', timeout: 10000,
});
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fairspin-release-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'scripts'));
  for (const file of [...releaseFiles, 'scripts/sync-release.cjs']) fs.copyFileSync(path.join(root, file), path.join(dir, file));
  return dir;
}
function edit(dir, file, change) {
  const target = path.join(dir, file);
  fs.writeFileSync(target, change(fs.readFileSync(target, 'utf8')));
}
function nextRelease(dir, version = '2.3.4', date = '2027-03-14') {
  edit(dir, 'package.json', text => JSON.stringify({ ...JSON.parse(text), version }, null, 2) + '\n');
  edit(dir, 'CHANGELOG.md', text => text.replace(/^## \[\d+\.\d+\.\d+\] - \d{4}-\d{2}-\d{2}$/m, `## [${version}] - ${date}`));
}
function succeeds(result) {
  assert.equal(result.status, 0, result.stderr || result.stdout || String(result.error));
}
function rejectsWithoutWrites(dir) {
  const before = snapshot(dir);
  const result = run(dir, []);
  assert.notEqual(result.status, 0, 'invalid release inputs must fail');
  assert.deepEqual(snapshot(dir), before, 'validation failure must not leave partially synchronized files');
}

test('checked-in release metadata passes the read-only synchronization check', () => {
  const before = snapshot(root);
  succeeds(run(root));
  assert.deepEqual(snapshot(root), before);
});

test('release drift is detected without writes, then synchronized without altering dependency pins', t => {
  const dir = fixture(t);
  nextRelease(dir);
  const before = snapshot(dir), oldLock = JSON.parse(before['package-lock.json']);
  assert.notEqual(run(dir).status, 0, '--check must reject stale footer, README, metadata and lockfile');
  assert.deepEqual(snapshot(dir), before, '--check must never repair files');
  succeeds(run(dir, []));
  succeeds(run(dir));
  const updated = snapshot(dir), lock = JSON.parse(updated['package-lock.json']);
  assert.equal(lock.version, '2.3.4');
  assert.equal(lock.packages[''].version, '2.3.4');
  const expectedLock = structuredClone(oldLock);
  expectedLock.version = expectedLock.packages[''].version = '2.3.4';
  assert.deepEqual(lock, expectedLock, 'a release bump must preserve all cryptographic dependency pins and integrity hashes');
  assert.match(updated['index.html'], /<meta name="generator" content="FairSpin v2\.3\.4">/);
  assert.match(updated['index.html'], /id="appVersion">v2\.3\.4<\/span>/);
  assert.match(updated['index.html'], /id="releaseDate" datetime="2027-03-14">2027-03-14<\/time>/);
  assert.match(updated['index.html'], /const APP_RELEASE = Object\.freeze\(\{ version: '2\.3\.4', date: '2027-03-14' \}\);/);
  assert.match(updated['README.md'], /Current version: 2\.3\.4/);
  assert.match(updated['README.md'], /March 14, 2027/);
  succeeds(run(dir, []));
  assert.deepEqual(snapshot(dir), updated, 'repeated synchronization must be byte-for-byte idempotent');
});

test('missing release markers fail before writing any release files', t => {
  for (const [file, marker] of [
    ['README.md', '<!-- release-summary:start -->'],
    ['index.html', 'id="appVersion"'],
    ['index.html', 'const APP_RELEASE ='],
  ]) {
    const dir = fixture(t);
    nextRelease(dir);
    edit(dir, file, text => text.replace(marker, 'missing-release-marker'));
    rejectsWithoutWrites(dir);
  }
});

test('invalid or mismatched release identities fail without changing generated files', t => {
  for (const change of [
    dir => edit(dir, 'package.json', text => JSON.stringify({ ...JSON.parse(text), version: '2.3.5' }, null, 2) + '\n'),
    dir => nextRelease(dir, '2.03.4'),
    dir => nextRelease(dir, '2.3.4', '2027-02-30'),
  ]) {
    const dir = fixture(t);
    nextRelease(dir);
    change(dir);
    rejectsWithoutWrites(dir);
  }
});

test('duplicate metadata markers are rejected instead of updating an ambiguous release', t => {
  const dir = fixture(t);
  nextRelease(dir);
  edit(dir, 'index.html', text => text + '\n<span id="appVersion">v0.0.0</span>\n');
  rejectsWithoutWrites(dir);
});
