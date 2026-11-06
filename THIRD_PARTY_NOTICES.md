# Third-party notices and beacon provenance

FairSpin's own source is licensed under PolyForm Noncommercial 1.0.0. The following independent third-party components retain their MIT licenses. FairSpin's noncommercial restriction does not replace or narrow the upstream license for those components.

## Cryptographic libraries bundled in the standalone HTML

- **@noble/curves 2.4.0**, by Paul Miller: <https://github.com/paulmillr/noble-curves>. Provides BLS12-381 short-signature verification and RFC 9380 hash-to-curve.
- **@noble/hashes 2.4.0**, by Paul Miller: <https://github.com/paulmillr/noble-hashes>. Provides synchronous SHA-256 and byte encoding helpers.

Versions and registry integrity hashes are pinned in `package-lock.json`. Source integration is `crypto/beacon-verifier.js`; the deterministic browser bundle is `vendor/beacon-verifier.js`. The full MIT notice below is retained inside the bundle so copying `index.html` alone carries the required attribution. No code is downloaded from a CDN at runtime.

Both libraries use this license:

```text
The MIT License (MIT)

Copyright (c) 2022 Paul Miller (https://paulmillr.com)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the “Software”), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

## Build tool

**esbuild 0.28.2**, by Evan Wallace and contributors, is a development-only dependency used to build the checked-in bundle. It is MIT licensed: <https://github.com/evanw/esbuild/blob/v0.28.2/LICENSE.md>. esbuild is not included in the application runtime.

To reproduce the bundle with Node.js 20.19 or newer:

```sh
npm ci --ignore-scripts
npm run build:beacon
npm run check:beacon
```

The browser application and `node --test tests/*.test.cjs` do not require an npm installation. The build uses exact dependency pins, a fixed ECMAScript 2020 target, and stable output with no source map, timestamp, absolute path or runtime import.

## Pinned drand quicknet identity and fixture

The trust anchor and genuine historical test vector were retrieved from drand's official HTTPS relay on November 6, 2026:

- Chain hash: `52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971`
- Scheme: `bls-unchained-g1-rfc9380`
- Public key: `83cf0f2896adee7eb8b5f01fcad3912212c437e0073e911fb90022d3e760183c8c4b450b6a0a6c3ac6a5776a2d1064510d1fec758c921cc22b0e17e63aaf4bcb5ed66304de9cf809bd274ca73bab4af5a6e9c76a4bc09e76eae8991ef5ece45a`
- Genesis epoch seconds: `1692803367`; period: `3` seconds.
- [Official chain information](https://api.drand.sh/52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971/info), stored unchanged in `tests/fixtures/drand-quicknet-info.json`.
- [Official historical round 42](https://api.drand.sh/52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971/public/42), stored unchanged in `tests/fixtures/drand-quicknet-round42.json`.
- [Official client verification source](https://github.com/drand/drand-client/blob/master/lib/beacon-verification.ts) and [protocol specification](https://docs.drand.love/docs/specification/) describe the signed message and signature scheme.

The integration hashes the round's unsigned 64-bit big-endian encoding with SHA-256, hashes that message to G1 using `BLS_SIG_BLS12381G1_XMD:SHA-256_SSWU_RO_NUL_`, and verifies the 48-byte BLS signature against the pinned 96-byte public key. The public randomness must equal SHA-256 of the raw signature. A response or audit can never supply a replacement trust anchor. Verification is synchronous and requires no network access.
