# FairSpin — verifiable random draw

A privacy-first giveaway and contest spinner with cryptographic, independently verifiable results. FairSpin is a single HTML file: no server, install, internet connection, build step, or outside libraries required. All names, hashes, seeds, and exports stay on the device running the draw.

**[Open the live demo](https://adrianspeyer.github.io/FairSpinner/) · [Fork the project](https://github.com/adrianspeyer/FairSpinner/fork) · [Download ZIP](https://github.com/adrianspeyer/FairSpinner/archive/refs/heads/main.zip)**

## Quick start

1. Open [`index.html`](./index.html) in a modern browser (Chrome, Edge, Firefox, or Safari). Double-clicking the file works, too.
2. Paste entries, one per line, or import a CSV/TXT file.
3. Set the rules, click **Lock list & generate seed**, and post the commitment statement publicly.
4. (Recommended) Paste a public entropy value, such as a future Bitcoin block hash you announced in advance.
5. Spin. Then download the audit log, GIFs and certificates before you clear the session.

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
- The UI is responsive and supports keyboard focus, reduced-motion preferences, and local-file/offline use.

## Features

- **Input:** paste a list, import CSV/TXT, or drag and drop a file. For CSVs, pick the column (it guesses wallet/address, then email, then name). Comma, tab and semicolon separators are detected automatically.
- **Duplicates:** optional removal, with an "ignore case" option for addresses like `0xABC…` and `0xabc…`.
- **Rules:** number of winners, whether winners leave the pool, spin length (3–15 s), tick sound.
- **Commit–reveal fairness:** the list and the seed are fingerprinted (SHA-256) before any spin.
- **Public entropy:** mix in an outside value nobody controls. It locks on the first spin.
- **Spinning wheel:** labels for up to 64 entries. Larger lists show color bands with a live "under pointer" readout. Tested with 5,000 entries.
- **Result recorded first:** each winner is computed and saved *before* the wheel animates, so refreshing mid-spin can't re-roll it.
- **Exports:**
  - **Audit log (JSON):** every input, every draw, the revealed seed, a timestamped event log, and an integrity hash.
  - **GIF per draw:** the full spin with a UTC timestamp, the list and seed fingerprints, a running timer and a winner frame.
  - **Certificate PNG:** a shareable result card with all the fingerprints.
  - **Commitment statement:** a `.txt` file, or copy it to the clipboard.
  - **Download everything:** all of the above in one click.
- **Verify tab:** load any audit JSON. It recomputes every hash and winner, catches tampering, and replays each spin.
- **Storage:** the session is kept in this browser's local storage so it survives a refresh. **Clear session** wipes it. You get a warning before closing with draws you haven't exported.

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

Save as `verify.py` and run `python3 verify.py fairspin-XXXX-audit.json`:

```python
import hmac, hashlib, json, sys
a = json.load(open(sys.argv[1], encoding="utf-8"))
H = lambda b: hashlib.sha256(b).hexdigest()
E = a["list"]["entries"]
lh = H("\n".join(E).encode()); assert lh == a["list"]["sha256"], "list hash mismatch"
seed = bytes.fromhex(a["reveal"]["seed"])
assert H(seed) == a["commitment"]["seedSha256"], "seed does not match commitment"
ent, taken = a["entropy"]["value"], []
for d in a["draws"]:
    pool = [i for i in range(len(E)) if not (a["commitment"]["removeWinners"] and i in taken)]
    N = len(pool); lim = (2**32 // N) * N; c = 0
    while True:
        m = f"fairspin/v1|list:{lh}|entropy:{ent}|draw:{d['n']}|ctr:{c}".encode()
        r = int.from_bytes(hmac.new(seed, m, hashlib.sha256).digest()[:4], "big")
        if r < lim: break
        c += 1
    w = pool[r % N]
    assert E[w] == d["winner"], f"draw {d['n']} mismatch"
    taken.append(w); print(f"draw {d['n']}: OK -> {E[w]}")
```

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

- **The organiser holds the seed.** Without public entropy, an organiser could in theory generate seeds privately until one favoured someone, and only then publish the commitment. Public entropy from a *future* event, announced in the commitment post, closes that gap.
- **The integrity hash spots accidental or naive edits, not a determined forger.** Anyone can recompute it. Real tamper resistance comes from the commitment being published *before* the draw.
- **Timestamps come from the local computer's clock.** The public commitment post is the trustworthy timestamp.
- **Local storage belongs to one browser profile.** It is not synced, and private/incognito windows may discard it. Export before closing.
- **The seed is stored in local storage until you clear the session.** Don't run draws on a shared computer without clearing afterwards.

## Privacy

Nothing is uploaded. All hashing, drawing, GIF encoding and storage happen in the browser. The SHA-256 and HMAC code is pure JavaScript, so it works on `file://` with no network or secure context.

## Files

| File | Purpose |
|---|---|
| `index.html` | GitHub Pages entry point and the whole app |
| `fairspin-<session>-audit.json` | Exported audit log |
| `fairspin-<session>-drawN.gif` | Timestamped spin recording |
| `fairspin-<session>-drawN-certificate.png` | Shareable result card |
| `fairspin-<session>-commitment.txt` | Pre-draw commitment statement |
