'use strict';

// Keep the standalone page's inline scripts explicitly allowlisted.
// Run after editing JavaScript: node scripts/update-csp.cjs
// Check without writing: node scripts/update-csp.cjs --check
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const file = path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(file, 'utf8');
const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)];
if (scripts.length !== 2) throw new Error('Expected exactly two inline application scripts');
const hashes = scripts.map(([, script]) => `'sha256-${createHash('sha256').update(script).digest('base64')}'`);
const policy = `default-src 'none'; script-src ${hashes.join(' ')}; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'; base-uri 'none'; form-action 'none'; object-src 'none'`;
const tag = `<meta http-equiv="Content-Security-Policy" content="${policy}">`;
const existing = /<meta http-equiv="Content-Security-Policy" content="[^"]*">/;
const updated = existing.test(html) ? html.replace(existing, tag) : html.replace('<meta charset="utf-8">', `<meta charset="utf-8">\n${tag}`);
if (process.argv.includes('--check')) {
  if (updated !== html) { console.error('CSP hashes are stale. Run node scripts/update-csp.cjs'); process.exitCode = 1; }
  else console.log('CSP hashes match both inline scripts.');
} else {
  fs.writeFileSync(file, updated);
  console.log('Updated CSP script hashes.');
}
