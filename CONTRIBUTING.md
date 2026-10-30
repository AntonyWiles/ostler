# Contributing to Ostler

Thank you for helping. This page covers setting up on Windows, finding your way around the code, the
tests, and how a change gets reviewed. Security problems go through [SECURITY.md](SECURITY.md),
never a public issue.

## Development setup on Windows

Ostler is a Windows desktop app, and its full test suite needs Windows 10 22H2 or Windows 11 (x64).

1. Install [Node.js 22](https://nodejs.org/) (npm comes with it) and [Git](https://git-scm.com/).
   `better-sqlite3` normally installs a prebuilt binary. If your machine has to compile it, install
   the Visual Studio Build Tools with "Desktop development with C++".
2. Clone and install:

   ```powershell
   git clone https://github.com/AntonyWiles/ostler.git
   cd ostler
   npm ci
   npx install-electron     # Electron 43 downloads its binary only when asked
   npm run rebuild:native   # builds better-sqlite3 for Electron
   npm ci --prefix mobile   # the Android app; npm test also checks the code it shares with the PC
   ```

3. Run the app on a data folder of its own. **Always set `OSTLER_USER_DATA`** when you develop:
   without it, Ostler opens the same data folder as an installed Ostler, and your experiments land in
   your real projects.

   ```powershell
   $env:OSTLER_USER_DATA = "$env:TEMP\ostler-dev-data"
   npm run dev
   ```

   `npm run dev:scratch -- <name>` does this for you with a throwaway folder under
   `C:\temp\ostler-roadmap\<name>`. The [developer guide](docs/developer-guide.md) has the rest: the
   scale dataset, Windows integration in development and building the installer.

### The native-module rebuild

`better-sqlite3` is compiled for one ABI at a time. Electron (the app) and plain Node (Vitest) use
different ones, so:

- `npm run rebuild:native` builds it for Electron, for `npm run dev`, `test:startup` and the e2e
  suites.
- `npm run rebuild:test` builds it for Node, for Vitest. `npm test` and `npm run test:integration`
  run it for you.
- Windows cannot replace the binary while a running Electron holds it. **Stop `npm run dev` before
  running tests**; the rebuild script says so rather than failing obscurely.
- A `NODE_MODULE_VERSION` error means the binary is built for the other one. Run the matching rebuild.

`npm run verify` handles all of this and always leaves the module built for Electron.

## Architecture tour

[docs/architecture.md](docs/architecture.md) is the map: the processes, the typed IPC contract, the
services, where data lives, the agent harness, the design system, navigation and the tests. Read the
rules below before your first change.

## Rules for every change

### Boundaries

1. **Project folders**: Ostler may create and remove its own `ostler/*` versions and their copies in
   a project's repository, save the person's edits and its restore points, and apply or undo a
   task's work in the project folder when the person asks. It never pushes, never deletes history,
   and never overwrites an edit it has not saved first. Apply, Undo and Restore are explicit actions
   by the person (never automatic, never triggered by an agent) and never leave conflict markers.
   The one other write is the "New project" wizard's "A new folder" choice
   (`ProjectScaffoldService`): Ostler creates a new or empty folder, may write a README and
   `.gitignore` into it and `git init` it with one initial commit, refuses any folder that already
   has content, and rolls back if registration fails. Everything else is read-only, and harness
   state and session records live only in Ostler's data folder.
2. **Sandboxed windows**: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` for
   every window. Preload builds as CJS.
3. **Typed IPC**: all IPC goes through the contract in `src/shared/ostler-api.ts`, and results are
   `{ ok, value } | { ok, error }`, never raw exceptions
   ([how to add a call](docs/architecture.md#the-ipc-contract)).
4. **Path validation**: the main process checks every path against the registered projects before
   touching the file system. A project's folder is optional (`WatchedProject.path` is
   `string | null`), so every reader goes through `projectFolder` or `requireProjectFolder`
   (`src/shared/project-folder.ts`), never the raw field.
5. **Secrets stay in main**: API keys are encrypted with Electron's `safeStorage`, never stored in
   plain text. The renderer gets `RendererConfig` and `RendererProject`
   (`src/shared/renderer-config.ts`), which say whether a key or token exists without carrying it. A
   token reaches a screen only through an explicit Reveal.
6. **Data outside the repository**: settings, databases, task copies and logs live in the data
   folder (`OSTLER_USER_DATA`), never in the source tree.

### Product

- No account to start, fully offline, no telemetry. A project stays on the computer unless the
  person shares it, and an outside service is connected only when the person chooses it.
- Ostler AI is optional and appears only once it is set up. Agent and AI controls show only while
  their feature is on (`useFeatures()`).
- AI coding agents are off for new installs. The harness HTTP server listens only while they are on.
- The automation HTTP server and its MCP server ([docs/automation-api/mcp.md](docs/automation-api/mcp.md))
  have their own switch in Settings › Connections. MCP tools are generated from the automation route
  table (`HELP_ROUTES`), never listed twice, and never reach agent work.

### Agents, the harness and Ostler AI

How they work: [the agent harness](docs/architecture.md#the-agent-harness) and
[Ostler AI](docs/architecture.md#ostler-ai).

- Each `HarnessSession` mints its own token, valid only while that session is active. There is no
  project-wide token and no self-registration.
- An agent works only in its task's copy, never in the person's folder.
- The review verdicts and Stop are the person's actions, refused while the agent is still working.
  The interface monitors agents and offers only those actions; it never invents agent state.
- The harness API describes itself (`GET /harness/:projectId/help`). A route added or changed updates
  `HELP_ROUTES` in `harness-http-server.ts` in the same change.
- A coding agent gets its task text, read-only access to the Library files attached to its own work
  item, and its project's conventions. Embedded and external coding agents have the same rights, and
  a capability built for one is built for both through one shared resolver. The automation agent
  acts for the person, with the person's token and the full Library.
- Ostler AI never acts as an agent. Every model request gets its provider from `requireAi`
  (`electron/services/ai-access.ts`). It reads the project folder only through
  `electron/services/project-files.ts` and can never write, run anything, queue work or reach the
  harness. Chat proposals create a record only when the person clicks Add
  (`src/shared/chat-proposals.ts`).

### Data and the main process

- The `ostler.db` schema lives only in numbered migrations
  (`electron/services/database/migrations/`); services contain no DDL. A new table of the person's
  data is added to `TRACKED_TABLES` (`change-history/tables.ts`); logs, indexes, counters and agent
  tables are not.
- Old Nexus Dashboard names ([list](docs/architecture.md#old-names)) are read and moved, and never
  written again.
- An Ostler started by tests goes through `offScreen` (`electron/app/off-screen.ts`): it never shows
  a window, takes focus, notifies or writes the clipboard. E2e specs start the app only through
  `launchOstler` (`tests/e2e/helpers/launch.ts`).
- Deep links are untrusted: `src/shared/deep-link.ts` accepts its fixed shapes only.
- The Android app (`mobile/`) defines no tables of its own: it runs the desktop's migrations. The sync
  core in `electron/services/sync/` reaches Node and Electron only through `platform.ts`.
- The product's name, app id and data folder come from `src/shared/brand.ts`.

### No GitHub workflows

Nothing runs on GitHub except `.github/workflows/release.yml`, and its triggers stay as they are.
Tests run on your own machine (on Windows, or `sh scripts/linux-test.sh` on Linux).
`npm run lint` enforces this (`scripts/check-workflows.cjs`).

### Demo projects

Ostler ships two demo projects: the simple one (`src/shared/templates/sample.json`) and the advanced
one (`src/shared/templates/demo-advanced.json`). A feature a new person would want to see (a view, a
field, a task type, a kind of data carried in project files) gets a task or item in the demo it
suits, with a **This task shows:** line. `npm run check:changed` prints a `demos:` reminder when a
change might need one.

## Tests

| Command                    | What it runs                                                                       |
| -------------------------- | ---------------------------------------------------------------------------------- |
| `npm run verify`           | The whole gate CI runs: everything in the rows below up to `test:integration`      |
| `npm run typecheck`        | TypeScript for main, renderer and tests                                            |
| `npm run lint`             | The brand, design-token, translation, shortcut-doc and licence checks, then ESLint |
| `npm run format:check`     | Prettier                                                                           |
| `npm test`                 | Unit tests (`tests/unit`): services and pure logic                                 |
| `npm run test:components`  | Component and hook tests (`tests/renderer`)                                        |
| `npm run test:integration` | The HTTP APIs and harness workflows (`tests/integration`)                          |
| `npm run test:startup`     | Builds and starts the real Electron app once                                       |
| `npm run test:e2e:clean`   | Builds, then the Playwright suites (`tests/e2e`), accessibility included           |
| `npm run perf`             | The performance budgets ([docs/performance.md](docs/performance.md))               |

Run `npm run verify` before you open a pull request, and `npm run test:e2e:clean` too when you change
something a person does in the app. New behaviour gets a focused test in the matching folder.

## Code style

- TypeScript throughout; Prettier formats it (`npm run format`) and ESLint checks it.
- Match the code around your change: its naming, comment density and idioms. Prefer small files.
- Colours, sizes, spacing and motion come only from the tokens in `src/renderer/styles/tokens.css`;
  `npm run lint` refuses new raw colours and pixel font sizes in feature CSS.
- Build screens from the components in `src/renderer/ui/`. Never `window.confirm`, `alert` or
  `prompt`.
- Views, navigation, the command palette and shortcuts come only from `src/renderer/navigation/`.
- User-facing words live in the English resources, `src/shared/locales/en/`, never in the code: `t('ns:key')`,
  with named values and plural keys. `npm run lint` refuses raw text in the renderer.
- A new or changed English string is translated into every bundled language in the same change, then
  recorded with `npm run i18n:stamp`. `npm run lint` fails on strings that are untranslated or were
  translated from older English.
- A database or `config.json` change is a new numbered migration
  ([developer guide](docs/developer-guide.md#writing-a-migration)).
- A new production dependency must be MIT, Apache-2.0, BSD or ISC licensed. `npm run lint` refuses
  GPL, AGPL and unknown licences.
- A user-visible change updates the [user guide](docs/user-guide/) and the Unreleased section of
  [CHANGELOG.md](CHANGELOG.md) in the same pull request.

## Translating Ostler

Ostler's interface is translatable, and translations come from contributors. To add or improve a
language, follow [docs/translating.md](docs/translating.md): it covers the language folder, the key
conventions, plurals, testing with the `en-XA` pseudo-locale, and how a translation pull request is
reviewed.

## Commit style

One plain-English sentence saying what changed for the person using Ostler, then a short body when
the reason is not obvious. For example:

```
Show the open source licences in Settings › About
```

Commit in small, logical steps, and keep unrelated changes in separate pull requests.

## Pull requests and review

1. Open an issue first for anything larger than a small fix, so the approach can be agreed.
2. Branch from `master`, make the change, and run `npm run verify`.
3. Open a pull request using the template. Say what changed, why, and how you checked it; include a
   screenshot for anything visible, with sample data only.
4. There is no CI on pull requests. Before asking for review, run `npm run verify`,
   `npm run test:startup` and `npm run test:e2e:clean` yourself and say in the pull request that they pass.
5. A maintainer reviews for correctness, the [rules](#rules-for-every-change), tests and wording. Expect questions;
   they are how review works, not a verdict.
6. A maintainer merges. Releases are cut from version tags ([docs/releasing.md](docs/releasing.md)).
