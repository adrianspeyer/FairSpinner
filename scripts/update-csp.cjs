'use strict';

// Keep the standalone page's inline scripts explicitly allowlisted.
// Run after editing JavaScript: node scripts/update-csp.cjs
// Check without writing: node scripts/update-csp.cjs --check
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const file = path.join(__dirname, '..', 'index.html');
const original = fs.readFileSync(file, 'utf8');
const bundle = fs.readFileSync(path.join(__dirname, '..', 'vendor', 'beacon-verifier.js'), 'utf8').trimEnd();
if (bundle.includes('</script')) throw new Error('Verifier bundle contains an unsafe HTML script delimiter');
let html = original;
const verifierTag = `<script id="beaconVerifier">\n${bundle}\n</script>`;
const verifierPattern = /<script id="beaconVerifier">[\s\S]*?<\/script>/;
html = verifierPattern.test(html) ? html.replace(verifierPattern, () => verifierTag) : html.replace("<script>\n'use strict';", () => `${verifierTag}\n\n<script>\n'use strict';`);
const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)];
if (scripts.length !== 3) throw new Error('Expected theme, beacon verifier, and application scripts');
const hashes = scripts.map(([, script]) => `'sha256-${createHash('sha256').update(script).digest('base64')}'`);
const policy = `default-src 'none'; script-src ${hashes.join(' ')}; style-src 'unsafe-inline'; img-src data: blob:; connect-src https://api.drand.sh https://api2.drand.sh; base-uri 'none'; form-action 'none'; object-src 'none'`;
const tag = `<meta http-equiv="Content-Security-Policy" content="${policy}">`;
const existing = /<meta http-equiv="Content-Security-Policy" content="[^"]*">/;
const updated = existing.test(html) ? html.replace(existing, tag) : html.replace('<meta charset="utf-8">', `<meta charset="utf-8">\n${tag}`);
if (process.argv.includes('--check')) {
  if (updated !== original) { console.error('Embedded beacon verifier or CSP hashes are stale. Run node scripts/update-csp.cjs'); process.exitCode = 1; }
  else console.log('Embedded beacon verifier and all three CSP script hashes match.');
} else {
  fs.writeFileSync(file, updated);
  console.log('Synchronized beacon verifier and CSP script hashes.');
}
