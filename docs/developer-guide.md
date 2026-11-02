# Ostler Developer Guide

This guide covers local development commands and the agent-session extraction script.

## Local development

Copy-paste reference for working on Ostler locally (PowerShell).

### Run the app

```powershell
$env:OSTLER_USER_DATA = "C:\temp\ostler-dev-data"
npm run dev
```

`npm run dev` rebuilds `better-sqlite3` for Electron before launching (`rebuild:native`), then starts `electron-vite dev` (HMR renderer, main process restarts on change). Its complete stdout and stderr are also appended automatically to `OSTLER_USER_DATA/logs/dev.log` (or Electron's default user-data directory when `OSTLER_USER_DATA` is unset). The log includes a timestamped header for each run and is useful for diagnosing a launch or HMR restart after the terminal has been closed.

With `OSTLER_USER_DATA` unset, the app uses `%APPDATA%\ostler` (`BRAND.dataFolderName` in `src/shared/brand.ts`, pinned so a rename never moves anyone's data). That is the real data folder: do not point experiments at it.

### Run on scratch data

```powershell
npm run dev:scratch -- p0-2           # data in C:\temp\ostler-roadmap\p0-2
npm run dev:scratch -- p0-2 --fresh   # delete that folder first
npm run scratch:project -- demo       # C:\temp\ostler-roadmap\projects\demo: a Git repo with one commit
```

`dev:scratch` sets `OSTLER_USER_DATA` to `C:\temp\ostler-roadmap\<name>` and runs exactly what `npm run dev` runs. Names must match `[a-z0-9-]+`. When it creates a new folder it writes a minimal `config.json` that moves the harness API to port 18934 and the automation API to 18935, so a scratch instance never collides with a running Ostler on the defaults. `--fresh` refuses to delete anything outside `C:\temp\ostler-roadmap\`. `scratch:project` refuses an existing non-empty folder. Both scripts share their guards in `scripts/scratch-paths.cjs`.

### See what a new install sees

```powershell
npm run dev:fresh          # the same as: npm run dev -- --fresh
```

Every launch empties `C:\temp\ostler-roadmap\fresh-install` and starts Ostler on it with no `config.json`, so it runs exactly as a person's first start does: the welcome, the new-install config migrations (agents and both local servers off, the theme following Windows) and empty browser storage. Close the window and run it again to start over. Your own data folder is never read or changed, and it runs beside your usual Ostler.

To watch the file live in PowerShell:

```powershell
Get-Content "$env:OSTLER_USER_DATA\logs\dev.log" -Wait
```

Harness API activity is recorded separately in `OSTLER_USER_DATA/logs/harness-audit.log`. Each JSON line records the time, request method, redacted endpoint category, authentication outcome, and HTTP status. It deliberately excludes bearer tokens and request bodies, so agent task text, questions, and file paths are not copied into the audit file.

### Windows integration in development

A development or scratch run never registers anything with Windows that outlives it: the `ostler://` link scheme, the jump list and the start-at-sign-in entry are made only by a packaged build. To test them, set `OSTLER_SHELL_INTEGRATION=1` for a scratch run. Its registrations then start `electron.exe` with the app folder and `--ostler-user-data=<that scratch folder>`, which only a development build reads, so a link can never open the default data folder. Remove them afterwards: `reg delete HKCU\Software\Classes\ostler /f`, turn "Start Ostler when I sign in" off before quitting, and clear the jump list (`app.setJumpList(null)` under the app id).

Without registering anything, a second launch against the same data folder delivers a link the way Windows would:

```powershell
$env:OSTLER_USER_DATA = 'C:\temp\ostler-roadmap\p8-2'
node_modules\electron\dist\electron.exe . ostler://inbox
```

The icons are rendered from `build/icons/mark.svg` by `npm run icons` (dev-only tools); commit the outputs with the mark.

### Build

```powershell
npm run build
```

```powershell
npm run package:dir
```

```powershell
npm run package:win
```

`package:win` builds the installer, `latest.yml` and the blockmap into `dist/ostler/`.
`package:portable` builds a portable exe there instead. Releases don't include one. Releasing, signing and updates are in [releasing.md](releasing.md).

### Performance: the scale dataset and the perf suite

Budgets, how each is measured and the latest numbers are in [performance.md](performance.md).

```powershell
npm run seed:scale -- p9-1-scale            # data in C:\temp\ostler-roadmap\p9-1-scale
npm run seed:scale -- p9-1-scale --fresh    # delete it (and its Git folders) first
npm run perf                                # build, seed if missing, run tests/perf, write test-results/perf.json
npm run build:analyze                       # the renderer bundle as a treemap: out/bundle-report.html
```

`seed:scale` builds Ostler and runs it once in its seeding mode (`OSTLER_SEED_SCALE`, which a packaged build refuses) against the scratch folder, then quits. It writes through the services, so the search index, activity and field history are real: 50 projects (5 with new Git folders in `C:\temp\ostler-roadmap\projects\<name>`), a List project of 5,000 tasks, a Board project of 500, 20 tasks in each of the other 48, with dates, assignees, labels, checklists, dependencies and subtasks, 20,000 status changes back-dated over 180 days, 3,000 comments, 300 Library notes and 40 saved views. Each project also has three task types (with type icons, and custom fields shown by type) that about seven in ten tasks use, and around them the dataset holds about 1,500 dated checklist items, 1,500 task links of every kind, 2,000 time blocks, 1,000 costs and 10 budgets, an outside calendar of 400 events (one a weekday stand-up), and 12 sidebar pins, three of them counting down. The plan is deterministic (`electron/app/dev-seed/scale-plan.ts`), so runs compare. `--no-build` reuses the last build.

`npm run perf` is not part of `verify`: it takes about 15 minutes, 10 of them the idle measurement (`OSTLER_PERF_IDLE_MINUTES` shortens it while you iterate; the budget is judged at 10). It runs against a copy of the dataset, never the folder itself; `OSTLER_PERF_DATA` points it at another seeded folder.

Two development-only switches help find what is slow. Neither does anything in a normal launch:

- `OSTLER_COUNT_IPC=1` prints the busiest IPC channels once a minute, and keeps the totals for the perf suite.
- `OSTLER_PROFILE_SQL=1` times every SQL statement and writes them, slowest total first, to `<dataDir>\logs\sql-profile.json` on quit.

### The GUI monkey

```powershell
npm run monkey -- --help
npm run monkey                                   # the scripted journey: stand-in AI, simulated agents
npm run monkey -- explore --seed 7 --steps 300   # a replayable random walk
npm run monkey -- drive --port 47100             # Ostler under remote control, for an AI overseer
node scripts/monkey-drive.cjs snapshot           # what a drive-mode Ostler shows, as text
```

The monkey (`tests/monkey/`) uses Ostler through its window like a person, on a scratch data folder
under `C:\temp\ostler-roadmap\monkey\`, and writes a report with every action, key, screenshot
and finding. It needs a build (`npm run build`, or `--build`) and the Electron build of
`better-sqlite3` (`npm run rebuild:native`). It is a tool, not a test: no suite runs it. Its README
explains the modes.

### Verify everything (start here)

```powershell
npm run verify
```

This is the whole quality gate: typecheck (including the unit and integration tests through `config/tsconfig.test.json`), lint, format check, unit, component and integration tests, in that order, stopping at the first failure. It rebuilds `better-sqlite3` for Node before the Vitest suites and always rebuilds it for Electron at the end, even after a failure, so `npm run dev` works straight afterwards. Stop `npm run dev` first: the rebuild refuses while Electron holds the native module.

There is no CI on pushes or pull requests, so run `npm run test:startup` and `npm run test:e2e:clean` yourself as well, and `npm run package:dir` when you change packaging. The release workflow (`.github/workflows/release.yml`) still runs the gate before it builds a release.

Push CI was tried in October 2026 and removed: a private repository gets 2,000 Actions minutes a month and Windows runners bill at double rate, so a 35-minute `verify` run cost about 70 of them. Public repositories get Actions minutes free, so it can come back: run typecheck and lint on Linux, the tests on Windows, and raise `timeout-minutes` above 30.

### Native module rebuilds

`better-sqlite3` is a native module compiled against a specific Node ABI. Electron and the plain Node.js used by Vitest/Playwright have different ABIs, so switching between running the app and running tests requires rebuilding.

```powershell
npm run rebuild:native
```

```powershell
npm run rebuild:test
```

Symptom if you forget: `NODE_MODULE_VERSION` mismatch errors from `better-sqlite3`. Run the matching rebuild command above and retry.

Packaging can't ship the wrong one. `package:win` and `package:dir` run `rebuild:native` first, and
electron-builder's `afterPack` hook, `scripts/check-packed-sqlite.cjs`, starts the packed executable
as Node, opens an in-memory database with the packed `better-sqlite3`, and stops the build if it
can't. electron-builder's own `npmRebuild` doesn't replace a Node build left by `rebuild:test`. Run
the check by hand on an unpacked app with `node scripts/check-packed-sqlite.cjs dist/ostler/win-unpacked`.

### Typecheck, lint, format

```powershell
npm run typecheck
```

```powershell
npm run lint
```

`lint` runs these checks before ESLint, each a script in `scripts/`: `check-brand.cjs` fails when `package.json`'s `build.productName` or `build.appId` differ from `src/shared/brand.ts`. `check-workflows.cjs` fails on any GitHub workflow but `release.yml`. `check-sync-core.cjs` fails when a sync-engine core file imports something the Android app can't supply. `check-design-tokens.cjs` fails on raw colours, sizes and weights in the renderer outside `tokens.css`. `check-i18n.cjs` fails on user-facing text typed into `src/renderer` instead of the English resources (`src/shared/locales/en/`), on keys English does not have, and on a translation's stray keys or lost placeholders; [docs/translating.md](translating.md) has the conventions. `generate-shortcuts-doc.cjs --check` fails when the user guide's keyboard shortcuts page is out of date (`npm run docs:shortcuts` rewrites it). Last comes `scripts/generate-third-party-notices.cjs --check`, which fails when a production dependency is GPL, AGPL or has an unknown licence. `npm run build` writes the notices to `out/THIRD_PARTY_NOTICES.md`; they are not committed.

```powershell
npm run format
```

```powershell
npm run format:check
```

### Tests

```powershell
npm test
```

```powershell
npm run test:components
```

```powershell
npm run test:integration
```

```powershell
npm run test:startup
```

```powershell
npm run test:e2e
```

```powershell
npm run test:e2e:clean
```

Run a single test file directly with Vitest (rebuild for the Node ABI first):

```powershell
npm run rebuild:test
npx vitest run --config config/vitest.config.ts tests/unit/harness-service.test.ts
```

Component tests fake the preload API with `installOstlerApi()` from `tests/renderer/fixtures/ostler-api.ts`, typed against `OstlerAPI`, and build planning views on the real workspace hook with `renderPlanningWorkspace()` from `tests/renderer/fixtures/planning-workspace.ts`. Do not hand-write a `window.ostlerAPI` object or cast a fake to `PlanningWorkspace`: a fixture that drifts from the code should fail typecheck, not hide.

Run a single Playwright e2e test by title:

```powershell
npx playwright test -c config/playwright.config.ts -g "drives a harness session over the agent HTTP API"
```

After running any Vitest-based test command, rebuild back to the Electron ABI before `npm run dev`:

```powershell
npm run rebuild:native
```

### Harness API — manual smoke test

Queue a task in the app and start it with an external agent: the prompt Ostler copies has the harness port, the session ID and that session's own token. There is no project-wide token. Then:

```powershell
$port = 8934
$projectId = "<project-id>"
$sessionId = "<session-id>"
$token = "<session-token>"
$headers = @{ Authorization = "Bearer $token"; "Content-Type" = "application/json" }

Invoke-RestMethod -Uri "http://127.0.0.1:$port/harness/$projectId/help" -Headers $headers
```

`GET /help` is the self-describing entry point — it returns every route, the expected body shape, and the typical session flow. This is what to point a fresh agent at: pasting the base URL, session ID and token alone doesn't tell it what to do, but "fetch `/help` first" does.

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:$port/harness/$projectId/status" -Headers $headers
```

```powershell
$body = @{ note = "Smoke testing the harness API" } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$port/harness/$projectId/session/$sessionId/update" -Headers $headers -Body $body
```

### Writing a migration

The schema of `ostler.db` lives only in `electron/services/database/migrations/`. Services contain
no `CREATE`, `ALTER` or `DROP`; they assume a migrated file. The rules:

1. **Add a file, never edit one.** Take the next free number (`0092-add-people.ts`) and export a
   `Migration` (`{ version, name, up(db) }`). Append it to `MIGRATIONS` in `index.ts`. A
   migration that has shipped on master is never changed; fix a mistake with a new one.
2. **Forward only, one transaction.** The runner wraps each `up` in a transaction that also sets
   `PRAGMA user_version`, so a throw rolls back both. Do not open your own transaction, and do not
   run statements SQLite refuses inside one (`VACUUM`, `PRAGMA journal_mode`).
3. **Think like the baseline.** `0001-baseline` must work on a database from any earlier build,
   so it uses `IF NOT EXISTS` and checks `PRAGMA table_info` before adding columns. Later
   migrations run exactly once per file, but write them so a half-old database cannot trip them.
4. **Move only schema.** Behaviour (what a service writes into a row) stays in the service.
5. **Write a test** in `tests/unit/database-migrations.test.ts`: build the old shape with rows,
   migrate, and check that the rows survive and the new shape is there. Service tests get a
   migrated file from `createMigratedDatabase(dir)` in `tests/helpers/database.ts`.
6. **Config too.** A change to `config.json` that existing users must not notice is an entry in
   `CONFIG_MIGRATIONS` (`electron/config-store.ts`) that writes their current value, not an
   edit to `DEFAULT_CONFIG` alone.

Before applying anything to an existing file, the runner writes
`<dataDir>/backups/pre-migration-v<from>-v<to>-<timestamp>/ostler.db`, and a database from a newer
build is refused without being touched.

### Full pre-commit check

```powershell
npm run verify
```

## Agent-session extraction and import

`scripts/extract-agent-session.cjs` converts a generic agent-session `.jsonl` file or recursively supplied folder into reviewable JSON files for Ostler. The older `scripts/extract-codex-session.cjs` entry point remains compatible. Both read source files as data and never evaluate, edit, or overwrite them.

### Run it

```text
node scripts/extract-agent-session.cjs <input.jsonl> --output-dir inbox/agent-conversation-extracts
```

Multiple input files can be supplied in one run:

```text
node scripts/extract-agent-session.cjs first.jsonl second.jsonl --output-dir inbox/agent-conversation-extracts
```

A folder input is scanned recursively for `.jsonl` files. `.json` metadata files and text files are ignored.

Use `--output <file>` for one exact output path, `--no-reasoning` to omit readable reasoning summaries, or `--compact` for compact JSON. The default output name changes `rollout.jsonl` to `rollout.ostler.json`.

To match a session to a registered Ostler project, pass an Ostler config/project manifest. The file may be the full Ostler `config.json` or a bare `{ "projects": [...] }` object:

```text
node scripts/extract-agent-session.cjs session.jsonl --projects ostler-config.json --output-dir inbox/agent-conversation-extracts
```

Matching first uses the raw session working directory, then the project folder name. With `--projects`, the command fails if it cannot find exactly one match. Without it, the export records `match.status` as `unresolved`. The parser is format-oriented rather than provider-oriented: it recognizes common direct `user`/`assistant` records and response envelopes, readable `text`/`thinking` blocks, and ignores tool results, tool calls, attachments, and lifecycle metadata.

### Output shape

The output uses `ostler.agent-session` schema version 1 and contains:

- `session`: the session identifier and project details derived from the rollout, with the project root represented only by its name.
- `messages`: ordered `user`, `assistant`, and readable `reasoning` content only.
- `references`: deduplicated project names, folders, and file paths found in conversation/tool text.
- `extraction`: small import diagnostics, such as malformed-line and message counts.

The command is intentionally strict. It fails with a non-zero exit code and an explicit format-change error when JSONL parsing fails, no user text is recognized, no assistant/agent text is recognized, or the project folder cannot be determined. This makes an agent-session format change visible instead of silently importing an incomplete transcript. A supplied project manifest uses `PROJECT_MATCH_FAILED` for an unmatched or ambiguous project.

Developer/system instructions, raw tool calls, raw tool output, lifecycle events, internal IDs, timestamps, repository URLs, and encrypted content are not exported. Absolute paths inside the project are rewritten from `C:\\path\\project\\...` to `project\\...`; unrelated absolute paths are reduced to their final name. Injected launch-context messages (`recommended_plugins`, `AGENTS.md`, and `environment_context`) are also omitted from the human conversation. Reasoning may be stored only in encrypted form; an encrypted reasoning blob cannot be recovered by this script, so only readable thinking or summary text is included when one exists.

The generated JSON is a review artifact: Ostler does not import it.
