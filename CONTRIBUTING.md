# Contributing to FairSpin

FairSpin is a standalone HTML application for verifiable draws. Keep the offline/manual workflow usable without a server, installation or build step. Read the [README](./README.md) for behavior and limits, and [SECURITY.md](./SECURITY.md) for the trust model before changing draw or verification code.

## Run and check a change

Open `index.html` in a modern browser. Use synthetic entries or **Load sample** for development. Node.js 20.19+ and Python 3 are needed for the automated checks; running the app and tests does not require `npm install`.

Run relevant QA locally before pushing changes, and include the results in pull requests. The repository does not run a GitHub CI test workflow.

```sh
node scripts/sync-release.cjs --check
node scripts/update-csp.cjs --check
node --test tests/*.test.cjs
```

After editing application JavaScript, run `node scripts/update-csp.cjs` to synchronize the bundled verifier and refresh the inline-script hashes. Keep the Python verifier embedded in the app identical to `verify.py`. Check the changed flow in a real browser, including keyboard access and both themes when relevant; automated DOM stubs do not establish visual or browser compatibility.

If you change the bundled cryptographic integration, review the dependency and trust-anchor changes explicitly. Rebuild with the pinned development dependencies:

```sh
npm ci --ignore-scripts
npm run build:beacon
node scripts/update-csp.cjs
npm run check:beacon
```

Retain upstream MIT notices in the standalone HTML and update [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) when dependencies or provenance change. Never silently substitute another beacon round, network or entropy source after a commitment.

## Issues and pull requests

For a reproducible bug, include the version shown in the footer, browser/OS, steps, expected result and actual result. Use a small synthetic example. For a pull request, explain the user-visible problem, resulting behavior and relevant checks. Add meaningful regression coverage for security, persistence or draw-math changes, and put user-facing changes under **Unreleased** in [CHANGELOG.md](./CHANGELOG.md).

Do not attach real entrant lists, private browser sessions, secret seeds or unredacted audit exports to public issues or pull requests. Keep local records in ignored `private-data/` or `exports/` directories and review staged files before sharing. For a suspected vulnerability, read [SECURITY.md](./SECURITY.md) and use GitHub's private vulnerability reporting option if it is enabled. Avoid publishing exploitable details or private draw data in a public issue.

## Prepare a release

`package.json` is the canonical application version. Use a new version for each release: a patch for compatible fixes, a minor version for compatible features, and a major version for incompatible changes. App versions are separate from the audit schema version and the draw algorithm identifier; changing a release number must not silently change those contracts.

1. Update `package.json` and move the finished Unreleased notes into a matching `## [x.y.z] - YYYY-MM-DD` changelog section. Keep the date fixed to the release date.
2. Run the synchronization commands, in order:

   ```sh
   node scripts/sync-release.cjs
   node scripts/update-csp.cjs
   ```

3. Run both `--check` commands and the test suite above, then check the visible footer, release links and affected workflows in a browser. Review the generated metadata and lockfile changes together with the code.
4. Commit the release changes before publishing a matching version tag or GitHub release. Release notes should come from the changelog and describe the code actually included.

Do not hand-edit synchronized version strings independently. The release helper keeps the app metadata, footer and root package-lock version aligned with `package.json`; the changelog supplies the matching release date.

## License

Contributions to FairSpin are made under the project's [PolyForm Noncommercial 1.0.0 license](./LICENSE), with the required notices preserved. FairSpin is source available and restricts commercial use; do not describe it as OSI open source. Third-party components retain their own licenses, including the bundled Noble MIT licenses. Submit only work you have permission to contribute, and retain its applicable attribution.
