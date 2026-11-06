'use strict';

// package.json owns the app version; the matching changelog entry owns its date.
// Validate every target before writing any file. --check never changes files.
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const check = process.argv.includes('--check');
if (process.argv.slice(2).some(arg => arg !== '--check')) throw new Error('Usage: node scripts/sync-release.cjs [--check]');

const pkg = JSON.parse(read('package.json'));
if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(pkg.version)) throw new Error('package.json must contain a stable major.minor.patch version.');
const latest = [...read('CHANGELOG.md').matchAll(/^## \[(\d+\.\d+\.\d+)\] - (\d{4}-\d{2}-\d{2})$/gm)][0];
if (!latest || latest[1] !== pkg.version) throw new Error('The newest versioned CHANGELOG.md heading must match package.json: ## [version] - YYYY-MM-DD');
const version = pkg.version, date = latest[2], instant = new Date(`${date}T00:00:00.000Z`);
if (!Number.isFinite(instant.getTime()) || instant.toISOString().slice(0, 10) !== date) throw new Error('The release date must be a valid calendar date.');
const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const readableDate = `${months[instant.getUTCMonth()]} ${instant.getUTCDate()}, ${instant.getUTCFullYear()}`;

function replaceOne(text, pattern, replacement, label) {
  const matches = [...text.matchAll(new RegExp(pattern.source, 'g'))];
  if (matches.length !== 1) throw new Error(`Expected exactly one ${label}; found ${matches.length}. No files were changed.`);
  return text.replace(pattern, () => replacement);
}

let html = read('index.html');
html = replaceOne(html, /<meta name="generator" content="[^"]*">/, `<meta name="generator" content="FairSpin v${version}">`, 'generator metadata');
html = replaceOne(html, /<span id="appVersion">[^<]*<\/span>/, `<span id="appVersion">v${version}</span>`, 'footer app version');
html = replaceOne(html, /<time id="releaseDate" datetime="[^"]*">[^<]*<\/time>/, `<time id="releaseDate" datetime="${date}">${date}</time>`, 'footer release date');
html = replaceOne(html, /const APP_RELEASE = Object\.freeze\(\{ version: '[^']*', date: '[^']*' \}\);/, `const APP_RELEASE = Object.freeze({ version: '${version}', date: '${date}' });`, 'application release constant');

const readme = replaceOne(read('README.md'), /<!-- release-summary:start -->[\s\S]*?<!-- release-summary:end -->/,
  `<!-- release-summary:start -->\n**Current version: ${version} · Released ${readableDate}.** [Changelog](./CHANGELOG.md) · [Contributing](./CONTRIBUTING.md)\n<!-- release-summary:end -->`, 'README release summary');
const lock = JSON.parse(read('package-lock.json'));
if (!lock.packages || !lock.packages['']) throw new Error('package-lock.json must include the root package metadata.');
lock.version = version; lock.packages[''].version = version;
const targets = [['index.html', html], ['README.md', readme], ['package-lock.json', `${JSON.stringify(lock, null, 2)}\n`]];
const changes = targets.filter(([name, content]) => read(name) !== content);

if (check && changes.length) {
  console.error(`Release metadata is stale in ${changes.map(([name]) => name).join(', ')}. Run npm run sync:release.`);
  process.exitCode = 1;
} else if (check) {
  console.log(`Release v${version} (${date}) matches the footer, app, README and package lock.`);
} else {
  for (const [name, content] of changes) fs.writeFileSync(path.join(root, name), content);
  console.log(`Synchronized release v${version} (${date}). Run node scripts/update-csp.cjs after script changes.`);
}
