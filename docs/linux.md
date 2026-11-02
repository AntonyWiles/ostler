# Developing and testing on Linux

Ostler ships for Windows. Linux is supported for **development and testing only**, for example in a
cloud coding session or a container, so features can be built and checked without a Windows
machine. Nothing here changes the Windows app or its release; `release.yml` still runs the full
checks on `windows-latest`.

## Set up

On Ubuntu or Debian:

```
sh scripts/linux-setup.sh        # or: npm run setup:linux
```

It installs the system packages (Xvfb, D-Bus, GNOME Keyring and Electron's libraries), the npm
dependencies and the Electron binary, then builds Ostler with better-sqlite3 compiled for Electron.
It is safe to run again. `--ci` uses `npm ci` instead of `npm install`.

In a cloud development environment, make `sh scripts/linux-setup.sh` its setup script so every
new session starts ready.

## Test

```
sh scripts/linux-test.sh                 # every suite (npm run test:linux)
sh scripts/linux-test.sh static node     # only some stages
```

| Stage      | Runs                                                   |
| ---------- | ------------------------------------------------------ |
| `static`   | typecheck, lint, format check                          |
| `node`     | unit, component and integration tests                  |
| `electron` | build, the start-up smoke test, the Playwright e2e run |

The stages run in this order because better-sqlite3 is a native module built for one runtime at a
time: `npm test` rebuilds it for Node, and the `electron` stage rebuilds it for Electron. The script
ends on the Electron build. If you run `npm test` by hand, run `npm run rebuild:native` before
anything that launches Electron.

Nothing runs these on GitHub: there is deliberately no CI job for them
([CONTRIBUTING.md › No GitHub workflows](../.github/CONTRIBUTING.md#no-github-workflows)). Run them in your session before you push.

## Launch Electron headless

Anything that starts Electron (e2e, the monkey, the screenshot tools) goes through
`scripts/linux-headless.sh`, which gives the command a virtual display, a private D-Bus session and
a throwaway GNOME keyring that is unlocked and deleted afterwards:

```
sh scripts/linux-headless.sh npx playwright test -c config/playwright.config.ts
sh scripts/linux-headless.sh npm run monkey -- journey --speed instant
sh scripts/linux-headless.sh npm run monkey -- explore --steps 100
```

The keyring matters: Ostler encrypts API keys with Electron's `safeStorage` and refuses to store them
otherwise ([CONTRIBUTING.md, rule 5](../.github/CONTRIBUTING.md#rules-for-every-change)). Electron's `basic` password store is a fixed built-in key, which
`safeStorage` rightly reports as unavailable, so the tests use a real keyring instead.
`tests/e2e/electron-args.ts` adds the two Linux switches every Playwright launch needs:
`--no-sandbox`, because containers usually run as root, and `--password-store=gnome-libsecret`, because a headless
session has no desktop to choose a keyring.

Monkey runs are written to `$TMPDIR/ostler-roadmap/monkey/<run>/`.

## What Linux leaves out

These are Windows features. Their tests skip themselves off Windows (`process.platform` checks), and
nothing on Linux emulates them, so a change to any of them still needs a Windows check:

- the Low-integrity sandbox (`sandbox-service.ts`) and so real embedded agent sessions, which refuse
  to start without it; the opencode runner's unit tests fake the launcher and run everywhere
- Windows path rules: backslash separators and case-insensitive paths
- the custom title bar, jump list, taskbar badge and tray (`electron/app/desktop/`)
- packaging and the installer (`npm run package:win`)
- `tools/window-screenshot/`, which drives a real Windows window

Screenshots taken on Linux render in a different font (Segoe UI is not available, so Chromium falls
back to the system sans-serif). The layout matches, but text can wrap differently, so do not commit
`docs/images/` regenerated on Linux.
