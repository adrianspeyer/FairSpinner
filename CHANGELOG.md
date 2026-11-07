# Changelog

User-visible changes to FairSpin are recorded here. Application release numbers are separate from audit format versions (`1` for manual entropy, `2` for automatic beacons) and the `fairspin/v1` draw algorithm.

## [Unreleased]

### Changed

- Removed the GitHub CI test workflow. Maintainer QA and release checks run locally before pushing changes.

## [1.1.0] - 2026-11-06

This is the first release tracked in this changelog. It includes the features and fixes developed in the commits listed below.

### Added

- Visible application version and release information in the footer, with links to the changelog and project resources.
- Release metadata synchronization and checks, plus contributor and release-maintenance instructions.
- Application version and release date in exported audit metadata, separate from the audit format version.
- Continuous integration for release consistency, CSP hashes and regression tests; bug and feature forms; security-reporting guidance; consistent line endings across platforms.
- Optional drand quicknet randomness: a specific future round is committed before its value is available, then its signature is verified locally using bundled cryptographic libraries.
- Publication waits of 1, 2, 5, 15, 30 or 60 minutes, defaulting to five minutes, and a local date/time scheduler with an exact local and UTC deadline.
- Completed-draw History with event logs, audit downloads, verification and replay; the next draw can reuse remaining entries, all entries, or a new list.
- A Reduce Motion notice and an explicit **Animate the wheel anyway** option. Confetti continues to respect the device preference.

### Changed

- The main button stays below the wheel and changes from **Spin** to **Next spin** or **Start next draw** as appropriate.
- New sessions default to a 15-second spin, adjustable from 3 to 30 seconds. The recorded winner appears in Results when the animation finishes.
- Automatic beacon audits carry the committed network, round, schedule, signature and randomness. Browser verification works offline once the proof is saved; Python uses the bundled offline Node helper for BLS verification.
- FairSpin is source available under PolyForm Noncommercial 1.0.0. Bundled Noble components retain their MIT licenses; see [LICENSE](./LICENSE), [NOTICE](./NOTICE) and [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).

### Fixed

- Light-theme primary buttons remain readable on hover and keyboard focus.
- Custom schedules retain their exact instant across reloads and device-timezone changes. Invalid, skipped and repeated local times are rejected, and a new draw clears the old custom date.
- Failed beacon requests retry the same committed round. Stale responses cannot change a replacement session, and clock rollback cannot save a proof before its scheduled time.
- GIF frame timing matches the selected spin duration exactly, with separate introduction and result cards.

### Security and reliability

- Hardened audit validation, safe rendering of untrusted audit fields, consecutive draw checks, committed rules, resource limits and hash-based Content Security Policy.
- Added validated session recovery, stale-tab protection and guards for overlapping imports, spins, exports and resets. A completed audit must save to History before the next session replaces it.
- Added regression coverage for draw math, audit tampering, beacon signatures, scheduling, storage, UI states, motion and GIF encoding. See [SECURITY.md](./SECURITY.md) for the review scope and trust boundaries.
- Added public-repository safeguards for OS metadata, development files, local secrets and private draw exports.

## Earlier development (unversioned)

These commits were published before visible application versioning and this changelog. The development package metadata used `1.0.0`; the entries below are commit history, not retroactively numbered releases.

| Date | Commit | Changes |
| --- | --- | --- |
| 2026-11-06 | [3ab6ad8](https://github.com/adrianspeyer/FairSpinner/commit/3ab6ad898eabde6fa1e37529435f5f6e3c256bbf) | Local scheduling, 15-second default, motion override and delayed on-screen winner reveal. |
| 2026-11-06 | [da08250](https://github.com/adrianspeyer/FairSpinner/commit/da0825087301967e58041c8afc690b138b5ec762) | Verified public randomness, clearer next-spin controls and light-theme hover fix. |
| 2026-11-06 | [2c5c509](https://github.com/adrianspeyer/FairSpinner/commit/2c5c509a33431dab95f23425096256cf79b279fe) | Switched the project license to PolyForm Noncommercial 1.0.0. |
| 2026-11-06 | [81dcd45](https://github.com/adrianspeyer/FairSpinner/commit/81dcd45c3a2300828302c78a85d1ec1543392a8d) | Next-draw History, repository ignore rules and the then-current PolyForm Perimeter license. |
| 2026-11-06 | [5eb3081](https://github.com/adrianspeyer/FairSpinner/commit/5eb3081a4aa2c5d1d7049c2fa3beb6d568504979) | Verification, security, reliability and accessibility improvements. |
| 2026-11-06 | [864f336](https://github.com/adrianspeyer/FairSpinner/commit/864f3364805262543e8764f3a970a0475ca681c1) | GitHub project actions and Pages links. |
| 2026-11-06 | [b78caaa](https://github.com/adrianspeyer/FairSpinner/commit/b78caaa23fbebdf0b6454c892510abe6a1e26daa) | Initial standalone FairSpin Pages demo. |

The current license does not withdraw permissions already granted for copies of earlier revisions under their original terms. See the [license history in the README](./README.md#license).

