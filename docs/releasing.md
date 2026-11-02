# Releasing Ostler

How a new version reaches people: from CHANGELOG to an installed update. The pipeline is
`.github/workflows/release.yml`.

## Versions

Ostler uses [Semantic Versioning](https://semver.org/): `MAJOR.MINOR.PATCH`.

- **Patch** (`1.0.1`): fixes only.
- **Minor** (`1.1.0`): new features; existing data and settings keep working.
- **Major** (`2.0.0`): something people must know before they update.
- **Beta** (`1.1.0-beta.1`): a pre-release. Only people with Settings › About › **Receive beta
  updates** on get it (electron-updater's `allowPrerelease`). Mark the GitHub release as a
  pre-release when you publish it.

The version lives in `package.json` only. The app reads it (`app.getVersion()`), What's new shows
that version's CHANGELOG section, and the tag must be `v` plus the same version or the workflow
stops.

## Releasing

0. **Run the checks locally.** `npm run verify` must pass on your PC. The Release workflow does not
   run it (the free Windows runner is too flaky for the suite).
1. **Update the CHANGELOG.** Move everything under `## [Unreleased]` into a new section,
   `## [1.0.0] - 2026-11-02`, and leave `## [Unreleased]` empty above it. Check the notes with
   `node scripts/release-notes.cjs 1.0.0`: that is exactly the text the release and the app's
   What's new will show. Commit it.
2. **Set the version.** `npm version 1.0.0` (or `npm version patch`, `minor`, `major`). It updates
   `package.json` and `package-lock.json`, commits, and tags `v1.0.0`.
3. **Push the commit and the tag.** `git push` then `git push origin v1.0.0`. The tag starts the
   **Release** workflow.
4. **Check the draft.** The workflow makes one **draft** GitHub release (a pre-release when the
   version has a `-beta` part), builds the app and uploads to it:
   - `Ostler-Setup-1.0.0.exe` (the installer)
   - `Ostler-Setup-1.0.0.exe.blockmap` (lets the next update download only what changed)
   - `latest.yml` (what installed copies read to find the update)

   The release body is the CHANGELOG section. The job summary says whether the build is signed.
   Download the installer, install it on a test machine or in Windows Sandbox, and open it.

5. **Publish.** Publish the draft on GitHub. Until then nobody gets the update: installed copies
   only see published releases.

If the workflow fails, fix the cause, delete the tag (`git tag -d v1.0.0` and
`git push origin :refs/tags/v1.0.0`) and any half-made draft, then tag again.

### Dry run

Actions › **Release** › **Run workflow** runs the same checks and build without publishing. Pick
which CHANGELOG section to show (the default is Unreleased). The notes appear in the job summary and
the files as a workflow artifact.

### Building locally

`npm run package:win` builds the installer into `dist/ostler/` without publishing, and
`npm run package:portable` a portable exe. Releases carry only the installer. `npm run package:dir` builds only the unpacked app
(`dist/ostler/win-unpacked/`). Neither needs a certificate. Both rebuild `better-sqlite3` for Electron first, and the
build stops if the packed app can't open a database (`scripts/check-packed-sqlite.cjs`).

## Updates

- The installed app checks GitHub Releases at start-up (unless Settings › About › **Check for
  updates automatically** is off) and when the person clicks **Check for updates**.
- It downloads in the background unless **Download updates automatically** is off.
- When the download is ready, an Inbox item and a toast say **Update ready. Restart to update**.
  Ostler never restarts by itself, and does not install on quit either. With agents working, the
  person can choose **Restart when agents finish**.
- Development runs, unpacked `--dir` builds (no `app-update.yml`) and the portable exe never check (`updatesOffReason` in
  `electron/services/update-service.ts`).
- The download waits in `%LOCALAPPDATA%\ostler-updater`, outside the data folder.

Update checks without a token need a **public** repository. While the repository is private,
installed copies get a 404 and Settings › About says "No update information was found."

## Signing

Builds are unsigned until a certificate exists. The workflow signs when the repository has
the secrets `WIN_CSC_LINK` (the certificate, base64 or a URL) and `WIN_CSC_KEY_PASSWORD`;
electron-builder reads them itself. SignPath Foundation signs open-source projects for free: once
the project is accepted, add its GitHub Action after the build step and before the upload, and
drop the WIN_CSC secrets.

What protects an unsigned update:

- The update and `latest.yml` come from GitHub over HTTPS.
- `latest.yml` holds the installer's sha512, and electron-updater refuses an installer whose hash
  differs.
- No publisher name is pinned (`build.win.publisherName` is unset), so an unsigned build accepts an
  unsigned update. Once releases are signed, electron-builder writes the certificate's publisher
  into `app-update.yml`, and from then on a signed install refuses an update that is not signed by
  the same publisher. Do not go back to unsigned releases after that.

Unsigned installers make Windows SmartScreen warn ("Windows protected your PC") until the
download has a reputation. People choose **More info** › **Run anyway**.

## The installer

electron-builder's assisted NSIS installer, configured in `package.json` `build.nsis`, with
`build/installer.nsh` for what electron-builder does not offer:

- Per-user by default (no administrator), with the choice of folder.
- A Start menu entry, and a page that offers a desktop shortcut.
- **Run Ostler** at the end.
- The uninstaller keeps the data folder. Its **Also remove my Ostler data** box removes
  `%APPDATA%\ostler` only (`BRAND.dataFolderName`; `npm run lint` checks the two match),
  never a `OSTLER_USER_DATA` folder elsewhere. Updates never show it and never remove data.
- The installer shows the licence page from `LICENSE` (`build.nsis.license`).

Updating runs the new installer silently from the running app (`--updated --force-run`), and the
installer starts the new version through its Start menu shortcut. electron-updater passes the
app's environment to the installer, but whether `OSTLER_USER_DATA` survives the shortcut launch has
not been checked: a test copy started against a scratch folder should not restart to update on a
machine that has real Ostler data.
