# Security review and trust model

Reviewed on November 6, 2026. FairSpin remains a standalone, offline-capable page with its signature-verification dependencies bundled locally. Automatic randomness is an opt-in online feature. This is a code review with automated regression coverage, not a certification or a guarantee that no defects remain.

## Reporting a problem

Report ordinary bugs through [repository issues](https://github.com/adrianspeyer/FairSpinner/issues), with the version shown in the footer, your browser and operating system, and steps that reproduce the problem using invented participant names.

For a suspected security vulnerability, use **Report a vulnerability** in the [repository's Security tab](https://github.com/adrianspeyer/FairSpinner/security) if that option is available. Otherwise, open an issue asking how to share a private security report, without including vulnerability details. Do not publish exploit details while arranging a private reporting channel.

Never post real participant lists, seeds, or complete audit exports in public reports. Use synthetic examples and redact private information from screenshots and logs.

## Findings addressed

| Finding | Impact | Change |
| --- | --- | --- |
| Audit draw numbers were interpolated into HTML | A malicious JSON file could inject active content and access the current browser session | Strict schema validation, escaped output, successful-verification-only replay, and hash-based script CSP |
| Draw numbers were not required to be consecutive | Skipped HMAC counters could select preferred outcomes while passing verification | Require draw numbers 1 through N, in order, within the committed winner count |
| Invalid seed hex and incomplete result validation | Invalid seed text or changed random/animation fields could pass checks | Validate exact seed encoding, every recorded result field, pool, chronology, and derived landing parameters |
| Winner targets could change after commitment | UI behavior could diverge from publicly committed rules | Freeze target and pool rules at lock; reject audits exceeding them |
| Async draw/export/import/reset operations overlapped | Old operations could alter a new session or generate mismatched exports | Busy-state guards, import request/session checks, cancellable replays, reset cleanup, and export error recovery |
| Stored sessions were trusted without validation | Corrupt data could break startup or re-enter unsafe rendering paths | Validate restored state; preserve invalid data for download instead of overwriting it |
| Unbounded parsing and repeated pool hashing | Oversized inputs could consume excessive memory or synchronous CPU | File, entry, draw and verification-work limits; reuse unchanged pool hashes |

The HTML policy uses hashes for its three inline scripts, allows script connections only to `https://api.drand.sh` and `https://api2.drand.sh`, and denies objects, forms and base-URL changes. Inline styles remain allowed for the standalone UI. Refresh hashes with `node scripts/update-csp.cjs` after script edits. This follows the safe output guidance in the [OWASP DOM XSS Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/DOM_based_XSS_Prevention_Cheat_Sheet.html) and [MDN's hash-based CSP guidance](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CSP).

## What verification establishes

Verification establishes that the recorded draws follow the specified algorithm for the inputs in the audit. Compare the list fingerprint, seed commitment, winner count, removal rule and entropy source with a public commitment posted before the draw. A recomputable checksum does not authenticate the organiser. Local timestamps are not independent timestamps.

Spin duration is a presentation setting, adjustable from 3 to 30 seconds with a 15-second default for new sessions and an optional full 30-second spin. It does not affect winner selection: the result is computed and saved before the animation begins. The wheel respects the device's Reduce Motion setting by default; the explicit **Animate the wheel anyway** opt-in affects only wheel animation, while confetti continues to respect the device preference.

An organiser knows the seed and can calculate outcomes privately. Public entropy helps only when its exact source is committed in advance and cannot be chosen after observing possible results. The tool cannot prove that an organiser never tried another session or abandoned a result. Duplicate names are separate entries when deduplication is off.

## Automatic randomness boundary

Automatic mode commits to a specific future drand quicknet round before fetching its value. Its chain hash, scheme and public key are pinned in the bundled verifier, never learned from an untrusted audit. The exact round and scheduled time appear in the public commitment. The app verifies the BLS signature of SHA-256(uint64be(round)) and checks that the randomness is SHA-256(signature), using Noble Curves/Hashes with retained MIT attribution.

Scheduling offers preset waits of 1, 2, 5, 15, 30 or 60 minutes (five minutes by default), or a date and time in the device's local timezone. A custom time must be at least one minute in the future at lock and selects the first round at or after that instant. Invalid dates and local times skipped or repeated by daylight-saving changes are rejected. The saved custom time is an absolute UTC instant; refreshing or changing the device timezone does not move it. Once locked, the round and its UTC deadline are immutable. Starting a new draw clears the custom date and returns to the previous preset wait.

Only the committed round may be requested; relay fallback and retries cannot change it. Requests omit credentials and referrers, reject redirects, have a timeout and response-size bound, and stale requests cannot overwrite a cleared/new session. Version-2 audits bind the proof to canonical HMAC entropy. Missing or invalid proofs cannot enable a spin. Pending commitments can be inspected but are labelled as having no recorded beacon or draws. Refresh resumes the saved plan.

Signature verification authenticates the beacon, not the organiser’s commitment-publication time. Future-round selection uses the device clock; users must publish the full commitment before the externally scheduled beacon time. Spinning can happen any time after that round's proof verifies; a longer publication window does not strengthen the cryptography. The tool cannot prevent an organiser from hiding other sessions or selectively abandoning outcomes. The beacon’s security also depends on its threshold network and the cryptographic assumptions documented by drand.

The complete HTML verifies beacon audits offline. Python independently verifies draw semantics but delegates BLS to the same bundled verifier through a local Node.js process with bounded input and timeout; it fails closed if that helper is unavailable. Exact build dependencies and integrity hashes are pinned in `package-lock.json`; `scripts/build-beacon.cjs --check` checks reproducibility. See [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) for provenance.

## Data and storage

The session, including the secret seed, lives in browser local storage. It is accessible to other scripts on the same origin, browser extensions with access, and people using the same browser profile. This is not encrypted storage. Use a trusted copy on a trusted device, export your records, and clear the session when done.

Audit exports include the complete entry list and seed; certificates also reveal the seed. Early disclosure makes remaining outcomes predictable once entropy is known. Sharing artifacts is a separate privacy decision. Stale-tab detection reduces conflicting edits, but local storage does not provide transactional multi-tab coordination. Storage failures are reported; refreshing an unsaved session can lose it.

Completed sessions can be archived in browser-local History before starting a fresh draw. History stores complete audits, including entries and seeds, under a separate storage key. It is capped at 20 sessions / 3 MiB and never silently evicts records. Archive writes precede the current-session transition; failures keep the old session available. History is schema- and checksum-checked when read, with full cryptographic recomputation when you choose Verify & replay. A local checksum does not authenticate the record. Clear session preserves History; on a shared device, clear both separately and manage downloaded files as well.

The public repository contains application source, synthetic draw fixtures, and public historical drand test vectors, not browser session data. Automatic-mode relays can observe the client IP and request timing; participant entries and seeds are not transmitted. `.gitignore` excludes OS metadata, environment secrets, Python caches, FairSpin export filenames, and the `private-data/` and `exports/` directories. Git ignore rules are an accidental-commit safeguard, not an access control or a way to remove previously committed information.

## QA scope

Run `node --test tests/*.test.cjs` and `node scripts/update-csp.cjs --check`. Tests compare cryptography to Node crypto, independently decode GIF frames, validate malicious and valid audit fixtures in JavaScript and Python, and exercise session and animation behavior with DOM/canvas stubs. Beacon tests use an authentic historical round, reject modified signatures/rounds/chain parameters, cover schema downgrade attempts and Python parity, and test scheduling, response failures, retries and cancelled-session races. Contrast tests check the primary-button CSS cascade and contrast in both themes.

Chrome browser QA covered sample draws, Next spin, Start next draw, History verification, the five-minute publication default, local date/time selection, fixed controls and deadlines after locking, and restoration after refresh. A live drand request successfully fetched and verified the committed beacon. With device Reduce Motion enabled, the explicit wheel-animation opt-in was tested through a full 30-second spin. Visual checks covered the light-theme primary-button hover and the scheduler at a narrow viewport in dark mode. Automated timing tests confirm that a 30-second wheel runs for its full duration and GIF exports encode exactly 30 seconds of spinning, plus their introduction and result cards.

Firefox/Safari compatibility, screen-reader output, audio playback, download permissions, local-file network behavior, and exhaustive keyboard/accessibility checks remain manual release checks. Mocked DOM tests and focused Chrome checks do not establish compatibility across all browsers and devices.
