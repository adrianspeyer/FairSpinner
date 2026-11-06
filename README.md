# FairSpin — verifiable random draw

A privacy-first giveaway and contest spinner with cryptographic, independently verifiable results. FairSpin runs from a single HTML file, with no server, install, or build step needed to use it. Offline/manual draws need no internet connection. An optional online mode fetches and verifies public randomness from drand. Entries, secret seeds, drawing, verification and exports stay on your device; the online mode never uploads your entry list or seed. The signature-verification libraries are bundled in the HTML, not loaded from a CDN.

**[Open the live demo](https://adrianspeyer.github.io/FairSpinner/) · [Fork the project](https://github.com/adrianspeyer/FairSpinner/fork) · [Download ZIP](https://github.com/adrianspeyer/FairSpinner/archive/refs/heads/main.zip)**

<!-- release-summary:start -->
**Current version: 1.1.0 · Released November 6, 2026.** [Changelog](./CHANGELOG.md) · [Contributing](./CONTRIBUTING.md)
<!-- release-summary:end -->

**Source available under [PolyForm Noncommercial 1.0.0](./LICENSE).** Noncommercial use is permitted. Commercial use outside the license’s expressly permitted purposes requires separate permission from Adrian Speyer; see the full terms below.

## Quick start

1. Open [`index.html`](./index.html) in a modern browser (Chrome, Edge, Firefox, or Safari). Double-clicking the file works, too.
2. Paste entries, one per line, or import a CSV/TXT file.
3. Set the rules. In **Public entropy**, keep **Offline / paste a public value**, or select **Automatic public randomness · online** before locking. Automatic mode offers a preset wait (five minutes by default) or a date and time in your local timezone.
4. Click **Lock list & generate seed** and publish the commitment. In automatic mode, publish before the displayed deadline; you can spin any time after the beacon arrives and verifies. In manual mode, paste the future public value you announced in advance.
5. Spin. Then download the audit log, GIFs and certificates before you clear the session. Audit files contain all entries and the secret seed; review them before sharing.
6. Use the main button directly below the wheel: **Next spin** selects the next committed winner; **Start next draw** saves a completed session to History and opens a fresh draft. Choose remaining entries, all entries, or a new list in the panel beneath it. The next session requires a new commitment.

Try **Load sample** to explore the full flow without preparing a list.

## GitHub Pages demo

`index.html` is the Pages entry point; the app is static and its required libraries are already bundled; deployment needs no build or package installation. The source repository is public; giveaway entries and draw data are still processed only in your browser.

1. In the repository, open **Settings → Pages**.
2. Under **Build and deployment**, choose **Deploy from a branch**, select `main` and `/(root)`, then save.
3. Open `https://adrianspeyer.github.io/FairSpinner/` after GitHub finishes deploying.

You can fork the repository or use **Download ZIP** on the app page to get your own copy.

## Interface

- **Light and dark themes** follow the device preference initially and can be changed with the header toggle. The selection is remembered in this browser.
- **Draw** guides you from list import through commitment to the animated draw and downloadable results.
- **Verify** independently checks an exported audit JSON and can replay its draws.
- **History** keeps completed sessions in this browser when you start the next draw. Expand a session to see its winners and event log, download its audit, or verify and replay it.
- **How it works** explains the commit–reveal process, limitations, and includes a copyable Python verifier.
- The footer identifies the application version and links to release information. Include that version when reporting a problem; application releases are separate from audit format versions.
- The UI includes draw-progress guidance, keyboard-operated tabs, labelled inputs, screen-reader result announcements, narrow-screen layouts, and reduced-motion support for the wheel and confetti.

## Features

- **Input:** paste a list, import CSV/TXT, or drag and drop a file. For CSVs, pick the column (it guesses wallet/address, then email, then name). Comma, tab and semicolon separators are detected automatically.
- **Duplicates:** optional removal, with an "ignore case" option for addresses like `0xABC…` and `0xabc…`.
- **Rules:** the winner count and removal rule freeze at commitment time. Spin length defaults to **15 seconds** for new sessions and is adjustable from **3–30 seconds**, including an optional full 30-second spin; it and tick sound remain presentation settings. Each retained duplicate is a separate eligible slot.
- **Motion preferences:** FairSpin respects your device's Reduce Motion setting by revealing the winner without spinning. To see the wheel animation, opt in with **Animate the wheel anyway**. This option affects the wheel only; confetti still respects Reduce Motion.
- **Commit–reveal fairness:** the list and the seed are fingerprinted (SHA-256) before any spin.
- **Public entropy:** offline/manual input remains the default. Automatic mode pins a future drand quicknet round at lock, fetches only that round, verifies its BLS signature against the pinned network key, and mixes its randomness into every draw in that session.
- **Spinning wheel:** labels for up to 64 entries. Larger lists show color bands with a live "under pointer" readout. Tested with 5,000 entries.
- **Result recorded first:** each winner is computed and saved *before* the wheel animates, so a saved draw survives a refresh mid-spin. The Results panel reveals the winner when the wheel stops. A persistent warning explains when browser storage is unavailable; export before closing in that case.
- **Exports:**
  - **Audit log (JSON):** every input, every draw, the revealed seed, a timestamped event log, and an integrity hash.
  - **GIF per draw:** the full spin with a UTC timestamp, the list and seed fingerprints, a running timer and a winner frame.
  - **Certificate PNG:** a shareable result card with all the fingerprints.
  - **Commitment statement:** a `.txt` file, or copy it to the clipboard.
  - **Download everything:** audit, commitment, GIFs and certificates, with progress and a stop control. Your browser may ask to allow multiple downloads.
- **Verify tab:** load any audit JSON. It validates the format, rules and consecutive draw sequence, recomputes every recorded draw, and enables replay only after verification succeeds. The file checksum is not an authenticity guarantee.
- **Next spin / Start next draw:** the primary button stays visible below the wheel. Continue through the originally committed winner count with Next spin. Once complete, archive the session and prepare a fresh draw using remaining entries, the entire list, or a new list. Remaining entries are calculated by entry position, so kept duplicate names remain separate chances. The seed and entropy are reset, and the new commitment must be published before drawing.
- **History:** up to 20 completed sessions and 3 MiB of browser-local storage, including full audits and event logs. History must save successfully before a new session replaces the current one. Capacity or storage errors leave the current results available; old records are never silently removed. Download all history as JSON, or download and verify individual audits. The history download is a record bundle; the Verify tab accepts its individual audit objects, not the entire bundle.
- **Storage:** the current session is kept in this browser's local storage so it survives a refresh. **Clear session** removes only the current session and clears the verifier view; **Clear history** separately removes archived sessions. Corrupt data is preserved for recovery; stale tabs stop saving when they detect changes from another tab. You get a warning before closing with draws you haven't exported.

## How the draw works

| Step | Computation |
|---|---|
| List hash | `SHA-256(entries joined with "\n", UTF-8)` |
| Seed | 32 random bytes from `crypto.getRandomValues` |
| Seed commitment | `SHA-256(seed bytes)`, published before spinning |
| Draw *n* | `HMAC-SHA256(key = seed, msg = "fairspin/v1\|list:<listHash>\|entropy:<entropy>\|draw:<n>\|ctr:<c>")` |
| Random number | First 4 bytes as a big-endian uint32 `r` |
| Unbiased pick | If `r ≥ floor(2³² / N) · N`, add 1 to `c` and retry. Otherwise the winner is `pool[r mod N]` |
| Pool | Original list order, minus previous winners (if "winners leave the pool" was on at lock time) |

The wheel animation is cosmetic: it is driven by the result and always lands in the slice the math picked. The proof is the hashes, not the GIF.

## Automatic public randomness

1. Before locking, choose **Automatic public randomness · online** in step 4. Select **Wait from locking** for a preset wait, or **Choose date & time** for a specific deadline. Preset waits are **1, 2, 5, 15, 30, or 60 minutes**, with **5 minutes** selected for new sessions. A chosen date and time uses your device's local timezone and must be at least one minute in the future when you lock.
2. Lock the list. FairSpin fixes the exact future **drand quicknet** round, network identity, scheduled time, list, seed commitment and rules. A custom date and time selects the first round at or after that instant. Review the exact deadline shown in local time and UTC; the source and round cannot be changed in that session.
3. Copy and publicly post the complete commitment **before the scheduled round time**. Keep the device clock accurate. The countdown is guidance; FairSpin cannot independently prove when you posted the commitment.
4. When the round is due, FairSpin fetches it from `api.drand.sh`, with `api2.drand.sh` as a relay fallback for **the same round**. It checks the round number, BLS signature and derived randomness locally, then enables Spin.
5. If the request fails, choose **Retry the committed round** in step 4. There is no silent switch to the latest round, another source, or manual randomness. Refreshing resumes the original saved round; clearing or starting a fresh draw cancels old requests.

**The deadline is for publishing the commitment, not for completing the spin.** You can spin any time after the committed beacon has arrived and verified. A longer window gives you more time to prepare and publish; it does not strengthen the cryptography.

A saved custom date and time retains its absolute instant across refreshes, including when your device timezone changes. Times skipped or repeated during a daylight-saving change are rejected; choose an unambiguous local time or use a preset wait. A locked draw always retains its original round. **Start next draw** clears the custom date and returns to the previous preset wait so an expired schedule is not reused; choose a new date if needed.

The seed and entries never leave the browser. Relay providers see normal connection metadata such as IP address and request timing. Requests omit credentials and referrers, reject redirects, use timeouts and bound response size. Offline/manual mode makes no beacon requests. If a browser blocks online requests from a local file, use the hosted GitHub Pages copy or use manual mode in a fresh session.

Automatic draws use one beacon value for the whole committed session. **Start next draw** creates a new draft and, once locked, a new future round. Audits carry the pinned network, round, scheduled time, signature and randomness; both audit verification and History replay work offline after the proof has been obtained. The browser uses a bundled Noble verifier; see [third-party notices and provenance](./THIRD_PARTY_NOTICES.md) and [drand's documentation](https://docs.drand.love/developer/).

## Where is the next spin?

The large button **directly below the wheel** remains in place throughout the draw:

| Button | What it does |
| --- | --- |
| SPIN · WINNER 1 OF N | Records and animates the first winner. |
| NEXT SPIN · WINNER X OF N | Records the next winner under the same published rules. |
| START NEXT DRAW | Saves the completed session in History and opens an editable new draft. Lock and publish its new commitment before spinning. |
| WAITING FOR PUBLIC RANDOMNESS | Automatic mode is waiting for the committed round or a successful retry; no winner is recorded yet. |

The winner count defaults to **1**, so a one-winner session goes directly from Spin to Start next draw. To select several winners under one commitment, set **Winners** before locking. Primary buttons have explicit hover/focus colors in both light and dark themes.

## Recommended contest procedure

1. Lock the list and post the **commitment statement** (list hash, seed commitment, rules) somewhere public and timestamped: Discord, X, a stream, etc.
2. Publish before the announced entropy exists: include the automatic mode’s exact drand round, or name a future public value in manual mode.
3. Wait for automatic signature verification, or paste the announced manual value into step 4, then spin.
4. Publish the **audit JSON** (it includes the revealed seed) alongside the winners.
5. Anyone can check it in the Verify tab or with the Python script below.

## Independent verification (Python 3)

Download [`verify.py`](./verify.py) alongside the audit, then run:

```sh
python3 verify.py fairspin-XXXX-audit.json
```

Manual version-1 audits require only Python 3’s standard library. Automatic version-2 audits additionally require Node.js 20.19+ and the complete repository/download: `scripts/verify-beacon.cjs` checks the signature using `vendor/beacon-verifier.js`, entirely offline. No npm install is needed. If the helper or Node.js is unavailable, verification fails with guidance instead of claiming success; the browser Verify tab is an alternative.

Python independently checks the committed list and seed, consecutive draw numbers, every winner and pool, random values, animation parameters, beacon metadata and recorded chronology; its BLS signature check uses the same vetted bundled library as the browser. It uses explicit validation, including when Python runs with `-O`. A complete copy is also available in the app’s **How it works** tab.

The Python verifier does not recompute the optional whole-file checksum because Python and JavaScript serialize JSON numbers differently. Use the browser’s Verify tab for that check. Both verifiers require comparison with the publicly posted commitment; neither proves publication or the organiser’s identity.

## Audit JSON structure

```
format, version, generatedAt, tool, session
algorithm    plain-text description of every formula
list         source, count, options, duplicatesRemoved, sha256, entries[]
commitment   committedAt, listSha256, seedSha256, winnersTarget, removeWinners
entropy      value, note, enteredAt, lockedAt
draws[]      n, at, poolSize, poolSha256, ctr, uint32, hmac, poolIndex, entryIndex, winner, anim
reveal       seed, revealedAt
events[]     timestamped log: session_created, list_locked, entropy_set, draw, replay, exports…
integrity    SHA-256 of the compact JSON with this field removed
```

Manual audits remain version 1. Automatic audits are version 2 and add `commitment.beacon` (provider, pinned chain hash/public key/scheme, round, scheduled time) and `entropy.beacon` (round, signature, randomness; null while pending). Their HMAC entropy is the exact string `drand:quicknet:<chainHash>:<round>:<randomness>`. The draw algorithm itself remains `fairspin/v1`. Stripping the automatic proof or downgrading that entropy to a version-1 audit is rejected.

`tool.version` and `tool.releaseDate` identify the application release that exported the audit. These diagnostic fields are separate from the audit format version; older audits without them remain supported.

Each GIF also carries an embedded comment with the draw number, timestamp, winner, list hash, seed commitment and HMAC.

## Limits to be upfront about

- **The organiser holds the seed.** Without public entropy, an organiser could in theory generate seeds privately until one favoured someone, and only then publish the commitment. A precisely specified, unpredictable value from a *future* event, announced with the list, seed commitment and rules, reduces that risk. The organiser must not be able to choose between entropy values or silently abandon unfavourable sessions.
- **The integrity hash spots accidental or naive edits, not a determined forger.** Anyone can recompute it. Real tamper resistance comes from the commitment being published *before* the draw.
- **Timestamps come from the local computer's clock.** The public commitment post is the trustworthy timestamp.
- **Local storage belongs to one browser profile.** It is not synced, and private/incognito windows may discard it. Export before closing.
- **Seeds are stored in local storage.** Clear both the current session and History after using a shared computer. Downloaded files must be managed separately.

## Input and compatibility limits

- Up to 10,000 entries, 512 UTF-16 code units per entry, 1,000 winners, and 2 MiB per imported entry file.
- CSV supports comma, tab and semicolon delimiters, escaped quotes, and quoted multiline cells. Selected cell line breaks become spaces so each record remains one entry. TXT imports preserve literal lines, including commas in names. Review the header setting, including for single-column CSVs.
- Audits are limited to 10 MiB. Removal-mode draws also limit estimated pool hashing to 128 MiB across the committed winner count; the app explains the maximum winner count for unusually large lists.
- Strict verification can reject historical audits that changed the winner target after locking, contain malformed fields, or exceed these limits. It never silently rewrites those records.
- Use one active tab per session. Stale-tab detection protects against ordinary conflicting edits; local storage is not a transaction service or a backup.

## Development and QA

GitHub Actions runs the release-metadata checks, CSP checks and regression tests on pushes and pull requests. It uses read-only repository permissions and pinned action revisions. Bug reports request the footer version and synthetic reproduction data; see [Contributing](./CONTRIBUTING.md) and [security reporting](./SECURITY.md#reporting-a-problem).

No npm install or build step is needed to run the app or the tests. With Node.js 20.19+ and Python 3 installed:

```sh
node scripts/sync-release.cjs --check
node scripts/update-csp.cjs --check
node --test tests/*.test.cjs
```

After changing application JavaScript, run `node scripts/update-csp.cjs` to synchronize the vendored verifier into `index.html` and refresh all three Content Security Policy hashes. A stale policy deliberately prevents modified scripts from running. Keep the Python code embedded in the How it works tab synchronized with `verify.py`.

To rebuild the bundled BLS verifier, install the exact development dependency versions and run:

```sh
npm ci --ignore-scripts
npm run build:beacon
node scripts/update-csp.cjs
npm run check:beacon
```

`package-lock.json` pins Noble Curves, Noble Hashes and esbuild. The generated bundle retains the full MIT notice; commit both the reviewed bundle and synchronized HTML. `npm audit` checks dependency advisories; it does not replace cryptographic review.

Regression tests cover independent SHA-256/HMAC vectors, rejection sampling, tampered audits, Python verification, session recovery, stale-tab protection, CSV parsing, reduced-motion/cancellation, byte-for-byte GIF decoding, genuine drand beacon signatures, automatic-audit tampering, future-round binding, local-time scheduling, fetch cancellation/retry behavior, and light/dark primary-button contrast. See [SECURITY.md](./SECURITY.md) for review scope and remaining trust boundaries. Browser visual QA is a separate release check; mocked DOM tests do not establish browser compatibility or visual correctness.

### Versions and release notes

The current application version is shown in the footer. [CHANGELOG.md](./CHANGELOG.md) records dated releases and the earlier unversioned development history. `package.json` is the canonical version; the matching changelog heading supplies the release date. These release numbers do not replace the audit schema versions or the `fairspin/v1` draw algorithm.

When preparing a release, update `package.json` and the matching changelog entry, run `node scripts/sync-release.cjs`, then `node scripts/update-csp.cjs`. Run both scripts with `--check` and the test suite before publishing. See [CONTRIBUTING.md](./CONTRIBUTING.md) for the complete workflow and safe bug-reporting guidance.

### Keeping the public repository clean

The [`.gitignore`](./.gitignore) excludes macOS/Windows metadata, editor temporary files, Python caches and virtual environments, `.env` secrets, and generated FairSpin downloads. Put real entry lists in `private-data/` and downloaded records in `exports/`; both directories are ignored. Ordinary JSON/CSV test fixtures and `.env.example` remain trackable. Ignore rules do not remove files that have already been committed, and Git can override them with `--force`; review staged files before pushing. The application never writes browser History into this repository.

## License

Copyright (c) 2026 Adrian Speyer. FairSpin is **source available**, under the unmodified [PolyForm Noncommercial License 1.0.0](./LICENSE), with the attribution in [NOTICE](./NOTICE). It is not an OSI open-source license because it restricts commercial use.

The license permits noncommercial use, modification, and redistribution. It also expressly permits uses by the charitable, educational, research, public-safety, environmental, and government organizations described in its terms. Commercial use outside those permitted purposes—including commercial giveaway campaigns, paid services, or commercial redistribution—requires separate written permission from Adrian Speyer. Contact the [repository owner](https://github.com/adrianspeyer) to discuss permission before proceeding. Preserve the license text or URL and required copyright notice when sharing copies. The full license controls.

Bundled Noble components retain their upstream MIT licenses; FairSpin’s noncommercial terms do not replace those licenses. See [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).

The license includes an as-is warranty disclaimer and liability exclusion to the extent allowed by law. It does not guarantee immunity or technically prevent copying. It governs this software, not ownership of your entrant lists or draw results.

**License history:** This revision uses PolyForm Noncommercial 1.0.0. [Commit 81dcd45](https://github.com/adrianspeyer/FairSpinner/commit/81dcd45c3a2300828302c78a85d1ec1543392a8d) was previously published under PolyForm Perimeter 1.0.1; this change does not withdraw permissions already granted for copies of that revision under its original terms.

## Privacy

Entries and secret seeds are never uploaded. Hashing, drawing, signature verification, GIF encoding and storage happen in the browser. The Content Security Policy permits only the three bundled scripts and limits script connections to the two pinned drand relays; objects, forms and base-URL changes are blocked. Beacon requests occur only after opting into automatic mode and locking a list. Providers see IP/timing metadata, not entrant lists or seeds. Clicking external links navigates away; sharing downloaded files is your decision. Offline/manual drawing and verification of already-downloaded audits need no network.

## Files

| File | Purpose |
|---|---|
| `index.html` | GitHub Pages entry point and the whole app |
| `CHANGELOG.md` | Dated application release notes and earlier commit history |
| `CONTRIBUTING.md` | Development, bug reporting and release-maintenance guidance |
| `package.json`, `package-lock.json` | Canonical application version and pinned build dependencies |
| `verify.py` | Python verifier; automatic proofs also use the offline Node helper |
| `crypto/beacon-verifier.js`, `vendor/beacon-verifier.js` | Beacon-verifier source and checked-in browser bundle |
| `scripts/verify-beacon.cjs` | Offline signature-verification bridge for Python |
| `scripts/build-beacon.cjs` | Rebuild/check the bundle using pinned development packages |
| `THIRD_PARTY_NOTICES.md` | Bundled MIT licenses and public beacon fixture provenance |
| `LICENSE`, `NOTICE` | PolyForm Noncommercial terms and required attribution |
| `.gitignore` | Exclude local metadata, secrets and private draw exports |
| `tests/*.test.cjs` | Dependency-free automated security and QA tests |
| `scripts/update-csp.cjs` | Synchronize the beacon bundle and refresh/check script hashes |
| `scripts/sync-release.cjs` | Synchronize/check release metadata and package-lock version |
| `fairspin-<session>-audit.json` | Exported audit log |
| `fairspin-<session>-drawN.gif` | Timestamped spin recording |
| `fairspin-<session>-drawN-certificate.png` | Shareable result card |
| `fairspin-<session>-commitment.txt` | Pre-draw commitment statement |
| `fairspin-history.json` | Local history download containing archived audits |
