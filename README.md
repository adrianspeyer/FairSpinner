# FairSpin — verifiable random draw

A privacy-first giveaway and contest spinner with cryptographic, independently verifiable results. FairSpin is a single HTML file: no server, install, internet connection, build step, or outside libraries required. All names, hashes, seeds, and exports stay on the device running the draw.

**[Open the live demo](https://adrianspeyer.github.io/FairSpinner/) · [Fork the project](https://github.com/adrianspeyer/FairSpinner/fork) · [Download ZIP](https://github.com/adrianspeyer/FairSpinner/archive/refs/heads/main.zip)**

## Quick start

1. Open [`index.html`](./index.html) in a modern browser (Chrome, Edge, Firefox, or Safari). Double-clicking the file works, too.
2. Paste entries, one per line, or import a CSV/TXT file.
3. Set the rules, click **Lock list & generate seed**, and post the commitment statement publicly.
4. (Recommended) Paste a public entropy value, such as a future Bitcoin block hash you announced in advance.
5. Spin. Then download the audit log, GIFs and certificates before you clear the session. Audit files contain all entries and the secret seed; review them before sharing.

Try **Load sample** to explore the full flow without preparing a list.

## GitHub Pages demo

`index.html` is the Pages entry point; the app is static and needs no build or dependencies. The source repository is public; giveaway entries and draw data are still processed only in your browser.

1. In the repository, open **Settings → Pages**.
2. Under **Build and deployment**, choose **Deploy from a branch**, select `main` and `/(root)`, then save.
3. Open `https://adrianspeyer.github.io/FairSpinner/` after GitHub finishes deploying.

You can fork the repository or use **Download ZIP** on the app page to get your own copy.

## Interface

- **Light and dark themes** follow the device preference initially and can be changed with the header toggle. The selection is remembered in this browser.
- **Draw** guides you from list import through commitment to the animated draw and downloadable results.
- **Verify** independently checks an exported audit JSON and can replay its draws.
- **How it works** explains the commit–reveal process, limitations, and includes a copyable Python verifier.
- The UI includes draw-progress guidance, keyboard-operated tabs, labelled inputs, screen-reader result announcements, narrow-screen layouts, and reduced-motion support for the wheel and confetti.

## Features

- **Input:** paste a list, import CSV/TXT, or drag and drop a file. For CSVs, pick the column (it guesses wallet/address, then email, then name). Comma, tab and semicolon separators are detected automatically.
- **Duplicates:** optional removal, with an "ignore case" option for addresses like `0xABC…` and `0xabc…`.
- **Rules:** the winner count and removal rule freeze at commitment time. Spin length (3–15 s) and tick sound remain presentation settings. Each retained duplicate is a separate eligible slot.
- **Commit–reveal fairness:** the list and the seed are fingerprinted (SHA-256) before any spin.
- **Public entropy:** mix in an outside value nobody controls. It locks on the first spin.
- **Spinning wheel:** labels for up to 64 entries. Larger lists show color bands with a live "under pointer" readout. Tested with 5,000 entries.
- **Result recorded first:** each winner is computed and saved *before* the wheel animates, so a saved draw survives a refresh mid-spin. A persistent warning explains when browser storage is unavailable; export before closing in that case.
- **Exports:**
  - **Audit log (JSON):** every input, every draw, the revealed seed, a timestamped event log, and an integrity hash.
  - **GIF per draw:** the full spin with a UTC timestamp, the list and seed fingerprints, a running timer and a winner frame.
  - **Certificate PNG:** a shareable result card with all the fingerprints.
  - **Commitment statement:** a `.txt` file, or copy it to the clipboard.
  - **Download everything:** audit, commitment, GIFs and certificates, with progress and a stop control. Your browser may ask to allow multiple downloads.
- **Verify tab:** load any audit JSON. It validates the format, rules and consecutive draw sequence, recomputes every recorded draw, and enables replay only after verification succeeds. The file checksum is not an authenticity guarantee.
- **Storage:** the session is kept in this browser's local storage so it survives a refresh. **Clear session** wipes it and clears the verifier view. Corrupt sessions are preserved for recovery; stale tabs stop saving when they detect changes from another tab. You get a warning before closing with draws you haven't exported.

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

## Recommended contest procedure

1. Lock the list and post the **commitment statement** (list hash, seed commitment, rules) somewhere public and timestamped: Discord, X, a stream, etc.
2. In the same post, name a **future public value** to use as entropy, e.g. "the hash of Bitcoin block #871234".
3. Once that value exists, paste it into step 4 and spin.
4. Publish the **audit JSON** (it includes the revealed seed) alongside the winners.
5. Anyone can check it in the Verify tab or with the Python script below.

## Independent verification (Python 3, standard library only)

Download [`verify.py`](./verify.py) alongside the audit, then run:

```sh
python3 verify.py fairspin-XXXX-audit.json
```

The independent verifier checks the committed list and seed, consecutive draw numbers, every winner and pool, random values, animation parameters, and recorded chronology. It uses explicit validation, including when Python runs with `-O`. A complete copy is also available in the app’s **How it works** tab.

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

Each GIF also carries an embedded comment with the draw number, timestamp, winner, list hash, seed commitment and HMAC.

## Limits to be upfront about

- **The organiser holds the seed.** Without public entropy, an organiser could in theory generate seeds privately until one favoured someone, and only then publish the commitment. A precisely specified, unpredictable value from a *future* event, announced with the list, seed commitment and rules, reduces that risk. The organiser must not be able to choose between entropy values or silently abandon unfavourable sessions.
- **The integrity hash spots accidental or naive edits, not a determined forger.** Anyone can recompute it. Real tamper resistance comes from the commitment being published *before* the draw.
- **Timestamps come from the local computer's clock.** The public commitment post is the trustworthy timestamp.
- **Local storage belongs to one browser profile.** It is not synced, and private/incognito windows may discard it. Export before closing.
- **The seed is stored in local storage until you clear the session.** Don't run draws on a shared computer without clearing afterwards.

## Input and compatibility limits

- Up to 10,000 entries, 512 UTF-16 code units per entry, 1,000 winners, and 2 MiB per imported entry file.
- CSV supports comma, tab and semicolon delimiters, escaped quotes, and quoted multiline cells. Selected cell line breaks become spaces so each record remains one entry. TXT imports preserve literal lines, including commas in names. Review the header setting, including for single-column CSVs.
- Audits are limited to 10 MiB. Removal-mode draws also limit estimated pool hashing to 128 MiB across the committed winner count; the app explains the maximum winner count for unusually large lists.
- Strict verification can reject historical audits that changed the winner target after locking, contain malformed fields, or exceed these limits. It never silently rewrites those records.
- Use one active tab per session. Stale-tab detection protects against ordinary conflicting edits; local storage is not a transaction service or a backup.

## Development and QA

No npm install or build step is needed. With Node.js and Python 3 installed:

```sh
node --test tests/*.test.cjs
node scripts/update-csp.cjs --check
```

After changing either inline JavaScript block, run `node scripts/update-csp.cjs` to refresh the Content Security Policy hashes. A stale policy deliberately prevents modified scripts from running. Keep the Python code embedded in the How it works tab synchronized with `verify.py`.

Regression tests cover independent SHA-256/HMAC vectors, rejection sampling, tampered audits, Python verification, session recovery, stale-tab protection, CSV parsing, reduced-motion/cancellation, and byte-for-byte GIF decoding. See [SECURITY.md](./SECURITY.md) for review scope and remaining trust boundaries. Browser visual QA is a separate release check; mocked DOM tests do not establish browser compatibility or visual correctness.

## Privacy

Entry data is never uploaded by the app. All hashing, drawing, GIF encoding and storage happen in the browser. A restrictive Content Security Policy allows only the two application scripts and blocks network connections, embedded objects and form submissions. Clicking GitHub links navigates to GitHub; sharing downloaded files is your decision. The SHA-256 and HMAC code is pure JavaScript, so it works on `file://` with no network or secure context.

## Files

| File | Purpose |
|---|---|
| `index.html` | GitHub Pages entry point and the whole app |
| `verify.py` | Independent Python verifier (standard library only) |
| `tests/*.test.cjs` | Dependency-free automated security and QA tests |
| `scripts/update-csp.cjs` | Refresh or check the inline script allowlist |
| `fairspin-<session>-audit.json` | Exported audit log |
| `fairspin-<session>-drawN.gif` | Timestamped spin recording |
| `fairspin-<session>-drawN-certificate.png` | Shareable result card |
| `fairspin-<session>-commitment.txt` | Pre-draw commitment statement |
