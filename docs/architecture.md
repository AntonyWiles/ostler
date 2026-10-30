# Ostler architecture

A tour of the code for contributors: how the pieces fit. Setup, tests and the
[rules every change follows](../CONTRIBUTING.md#rules-for-every-change) are in
[CONTRIBUTING.md](../CONTRIBUTING.md).

## What Ostler is

A project manager for Windows that anyone can pick up, on their own or with other people. People plan
projects with tasks, boards, milestones and decisions, keep briefs and documents next to the work in
the Library, and see what needs them today across every project. An Android companion app
(`mobile/`, [below](#ostler-for-android)) checks project status and edits tasks on a phone, synced
through the person's own Google Drive.

Data is local by default and shared by choice: Ostler needs no account to start and works fully
offline, each project stays on this computer unless the person shares it, each outside service is
connected only when the person chooses it, and there is no telemetry. Ostler AI is optional and
appears only once it is set up. AI coding agents are an optional layer for software projects, off for
new installs and turned on in Settings › Agents; while they are on, Ostler owns the agent
harness (sessions, task claims, file presence, explicit locks, agent questions, watcher state,
snapshots and recovery), and the harness HTTP server listens only then. The automation HTTP server,
and the MCP server on it, has its own switch in Settings › Connections.

## Processes

Ostler is an Electron app built with electron-vite. Three kinds of code run in different places:

| Process  | Code                  | Can do                                                                                                                          |
| -------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Main     | `electron/`           | Node and Electron APIs: files, Git, SQLite, the network, child processes. Owns all data and every secret.                       |
| Preload  | `electron/preload.ts` | Builds as CommonJS and exposes one object, `window.ostlerAPI`, through `contextBridge`. Nothing else crosses.                   |
| Renderer | `src/renderer/`       | React 19. Sees only `ostlerAPI`. Every window runs with `contextIsolation: true`, `nodeIntegration: false` and `sandbox: true`. |

`src/shared/` is imported by both sides: types, pure logic and constants (the brand, shortcuts, AI
presets, prompt builders) that must not drift between them.

`electron/main.ts` only orders start-up: resolve and pin the data folder, take the single-instance
lock, start logging, prepare the data (restore a pending backup, run migrations), build the services
(`electron/app/services.ts`), and open the window. Work that can wait, such as backups and the Git
history sync, waits until the window reports its first screen (`electron/app/deferred-startup.ts`).

## What `main.ts` composes (`electron/app/`)

- `data-dir.ts` resolves the data folder; the single-instance lock is keyed to it, so a second launch
  against the same folder focuses the first window and exits.
- `window.ts`: `createWindow`, focus and crash recovery.
- `off-screen.ts`: `offScreen`, the one switch for an Ostler driven by tests or agents. Its windows
  stay left of every display, unfocused, muted and off the taskbar, and it shows no desktop
  notification, tray icon, taskbar flash, title bar menu, print or system dialog, registers no
  system-wide key and opens no other app. It never writes the Windows clipboard: it copies into a
  clipboard of its own in main's memory instead (`clipboard.ts`; `copyText` is the only way main
  copies, the copy, cut and paste keys in its pages use the same clipboard through
  `electron/preload-clipboard.ts`, and e2e specs read it with `tests/e2e/copied-text.ts`). Snip to
  task never reads the screen there, taking a generated picture of each display instead.
  `showDesktopNotification` is the only way to show a Windows notification.
- `library-protocol.ts`: the `ostler-library:` scheme.
- `services.ts` constructs and wires every service and returns `AppServices`.
- `deferred-startup.ts`: backups, housekeeping and the Git history sync wait until the window
  reports its first screen; agent-session recovery and a pending restore never wait.
- `dev-seed/`: the development-only scale dataset (`npm run seed:scale`).
- `logging.ts`: `<dataDir>/logs/main.log`, rotated at 5 MB, three files. `diagnostics.ts` builds the
  redacted text for Settings › About › Copy diagnostics, which the person shares themselves.
- `security.ts`: web permissions are denied; `openExternalUrl` opens http/https only.
- `print-window.ts`: the offscreen print window for Print and Save as PDF, with the main
  window's security settings, preload and page, on the print route.
- `desktop/`: Windows integration. The application menu built from the shared shortcut table,
  the custom title bar's overlay, `ostler://` deep links, the jump list, the taskbar badge, flash and
  progress, and background mode's tray, sign-in start and Quick add key. Deep links are untrusted:
  `src/shared/deep-link.ts` accepts its fixed shapes only (inbox, quick add, weekly review, a task, a
  project view, and a milestone, decision or Library item), and notifications and the jump list use
  the same route. With background mode on, closing the window hides it; the services stop only on a
  real quit (`desktop/lifecycle.ts`). Registrations that outlive the process are made only by a
  packaged build or with `OSTLER_SHELL_INTEGRATION=1` ([developer guide](developer-guide.md)).

## The IPC contract

Every call from the renderer to main is typed in one place: `src/shared/ostler-api.ts` and the files
in `src/shared/ostler-api/` (`ipc-types.ts` lists the channels and the `OstlerAPI` interface; the other
files hold the types for each area). Adding a call means:

1. a channel in `IPC_CHANNELS` (`'ostler:'` and the constant in kebab case) and a method on `OstlerAPI`;
2. the method's entry in `API_CHANNELS` (`src/shared/ostler-api/api-channels.ts`), which pairs it
   with its channel. The preload builds its pass-through from that table, so it needs no line of
   its own; only the `onX` subscriptions and the `initial*` values are written there by hand;
3. a handler in the matching `electron/ipc/*-handlers.ts`, registered by method name with
   `handleApi` (or `projectApi` / `mutatingApi` for a call that takes a project id first). Its
   arguments and value are typed from `OstlerAPI`, so a handler that drifts from the declaration
   fails typecheck.

`handleApi` goes through `handleIpc`, which wraps every handler so the renderer always gets `{ ok: true, value }` or
`{ ok: false, error }`, never a thrown exception; the stack goes to the log. The main process
validates every id and path it receives: a path is accepted only inside a registered project's
folder, and a project's folder is optional (`projectFolder`, `requireProjectFolder` in
`src/shared/project-folder.ts`).

## Services

`electron/services/` holds one service per concern, constructed and wired in
`electron/app/services.ts`. The main groups:

- **Planning**: `planning-service.ts` (tasks, goals, milestones, decisions), `people-service.ts`,
  `home-service.ts` and `inbox-service.ts`, `reminder-service.ts`, `saved-views-service.ts`,
  `search-service.ts`, `report-service.ts`.
- **Projects and files**: `project-folder-service.ts`, `project-scaffold-service.ts` (the one place a
  new folder is created), `file-watcher.ts` (chokidar), `git-reader.ts` (read-only simple-git),
  `library-service.ts`, `import-service.ts`, `export-service.ts`, `project-package-service.ts` (with
  `project-package-export.ts`, which builds a package, and `project-package-import.ts`, which writes one's records).
- **Safety**: `backup-service.ts` (with `backup-listing.ts`, and `backup-second-place.ts` for copies in a second folder), `update-service.ts` (electron-updater), `runtime-credentials.ts`
  (secrets decrypted only in memory).
- **AI**: `ai-access.ts` is the single gate every Ostler AI request passes; `ai-provider.ts` talks to
  providers ([Ostler AI](#ostler-ai)).
- **Agents**: the harness (below), `opencode-runner-service.ts`, `dispatcher-service.ts`,
  `sandbox-service.ts`.

## Data and storage

Everything Ostler keeps lives in one data folder: `%APPDATA%\ostler` for an installed Ostler,
or wherever `OSTLER_USER_DATA` points. Nothing is written into the repository or, except in the
cases the person confirms ([the project-folder rule](../CONTRIBUTING.md#rules-for-every-change)), into a project's folder.

- `config.json`: settings and the project list, owned by `electron/config-store.ts`, with numbered
  config migrations in the same file.
- `ostler.db`: SQLite through better-sqlite3. The schema exists only in the numbered migrations in
  `electron/services/database/migrations/`, applied at start-up before any service opens the file; services contain no DDL.
- Per-project folders for the Library, agent workspaces and harness state; `backups/` for automatic
  backups taken before every migration; `logs/main.log` for errors.
- Secrets (AI keys, tokens) are encrypted with Electron's `safeStorage` and decrypted only in the main
  process. The renderer sees `hasApiKey` and masked hints (`src/shared/renderer-config.ts`).
- Backups and restore are `electron/services/backup-service.ts`; every schema or config change is a
  new migration ([developer guide](developer-guide.md), "Writing a migration").

### The undo history

The one exception to "no DDL in services" is the undo history's recorder
(`electron/services/change-history/recorder.ts`). Each service connection that holds the person's
data (planning, library, people, days off, and the history service's own) calls
`attachChangeRecorder`, which makes TEMP triggers on that connection only, from the tables as they
are, so they are never part of the schema. They record a row's before and after image into
`change_history_rows` only while an IPC call runs (`handleIpc` wraps every call in `recordChanges`,
`change-history/context.ts`); housekeeping, agents, the automation API and start-up write nothing
there. `ChangeHistoryService` groups each call's rows into one entry and undoes one entry value by
value, putting back only what still holds that entry's result, so later changes survive; an undo is
an entry too, and redo undoes it. The recorded tables are `TRACKED_TABLES` in
`change-history/tables.ts`. Entries are kept `history.keepChangesDays` (30 by default) and pruned by
housekeeping.

### Old names

The product was called Nexus Dashboard until October 2026. `src/shared/legacy-names.ts` lists what
that name left on disk: the `%APPDATA%\nexus-dashboard` data folder, `nexus.db`, `nexus/*` versions,
`refs/nexus/`, `nexus-secure:` secrets, `nexus-dashboard://` links, `.nexus-project` files, `nexus.*`
localStorage keys and `Nexus-*` commit trailers. They are read and moved to the new names
(`electron/app/rename-migration.ts`, database migration 57, config migration 42, `moveLegacyRefs`,
`src/renderer/lib/legacy-storage.ts`) and never written again. `isOwnTaskBranch` is the one rule for
both task-version prefixes.

## The agent harness

AI coding agents are an optional layer, off for new installs. The rules that bind this area are in
[CONTRIBUTING.md › Agents, the harness and Ostler AI](../CONTRIBUTING.md#agents-the-harness-and-ostler-ai). When agents are on:

- The **harness** (`electron/services/harness-service.ts` and `harness/`) manages the task queue,
  sessions, agent questions and review. Each queued task gets its own copy as soon as it is queued:
  a Git worktree of the person's repository under the data folder, on its own `ostler/<task>`
  version, so an agent never works in the person's folder. Apply adds a finished task's work to the
  folder as one History entry; History (`electron/services/project-history.ts`) undoes it, restores
  to a point, and brings discarded work back.
- **External agents** reach it over a loopback HTTP API (`harness-http-server.ts`) with its
  session's own bearer token. `GET /harness/:projectId/help` describes every route, so a new agent
  needs only a URL, its session ID and its token. **Embedded agents** run the vendored OpenCode in headless mode
  with a plugin bridge, and have exactly the same rights.
- The **automation API** (`automation-http-server.ts`, documented in
  [the automation API docs](automation-api/README.md)) lets a script or agent act for the person, with the
  person's token. It has its own switch in Settings › Connections. An AI assistant reaches the same
  routes as MCP tools ([MCP](automation-api/mcp.md), `electron/services/mcp/`): over HTTP at
  `/automation/<projectId>/mcp`, or by starting Ostler with `--mcp-stdio --project <id>`, which
  only forwards messages to the running Ostler.
- **Plan first** (`harness/plans.ts`, `src/shared/plan-first.ts`): a plan-first task's agent sends a
  plan (`ostler_submit_plan`, or `POST /session/:sessionId/plan`) and waits, with no timeout, until
  the person approves it, asks for changes or cancels. Embedded agents' file edits are refused until
  approval; for both kinds, approval records what the copy had already changed. Queuing sets a
  task's `planFirst` from its work item's choice or the project's `agentsPlanFirst`
  (`applyTaskPlanFirst` in `task-intake.ts`); every version and decision is kept with the task in
  `task_plans` (`task-plans-service.ts`, fed by the harness's plan listener), and waiting plans
  reach Needs you and the Inbox through `plansWaiting` in `home-service.ts`.
- **Review runs** (`harness/reviews.ts`, `REVIEWER_RUNS_AVAILABLE` in
  `src/shared/reviewer-runs.ts`): an ordinary task marked `reviewOf` a session in
  review, queued first, whose copy is detached at the change's last commit and removed when the
  review ends. The reviewer changes nothing (embedded edits are refused), is never applied or in
  review itself, and reports findings (line comments with a severity) that are kept with the
  reviewed session as the reviewer's. Applying, sending back, discarding or stopping the reviewed
  task stops its review. A project's `reviewBeforeMe` starts one from the `run.review` agent event
  (`HarnessService.setReviewBeforeMe`), whichever path ended the run; `reviewWait` says where it
  stands, and `reviewsNeedingYou` (`inbox-sources.ts`) keeps a session out of Needs you and the
  Inbox while it runs, for up to 30 minutes.
- Agent terminals run at Windows Low integrity, so they can write only inside their own workspace.
- Agent work reaches the person's branch only when they press Merge, and merge refuses a dirty tree.

### Sessions and tokens

Real AI agent sessions (fresh CLI runs, any provider, any tooling, running entirely outside Ostler,
or an Ostler-managed embedded session under the same sandboxing and review model) drive the harness
directly: over the loopback HTTP API (`electron/services/harness-http-server.ts`) or through embedded
OpenCode runners using loopback plugin bridges. Each `HarnessSession` mints its own token when it
starts (`HarnessSession.token`), valid only while that session is active. There is no project-wide
token and no self-registration: every session starts with its task already assigned. The API is
self-describing: `GET /harness/:projectId/help` returns the full route list (`HELP_ROUTES`) and the
typical flow.

### Task copies, review and History

Every queued task gets its own copy as soon as it is queued (`electron/services/harness/task-copies.ts`):
a Git worktree of the person's own repository at `<dataDir>/worktrees/<projectId>/<slug>` on its own
version `ostler/<slug>`, made from the folder's current version, with Ostler's excluded folders left
out, the Low-integrity label applied, and workspace setup run while it is prepared (`task.copy`,
"Getting ready" until it is `ready`). Only a task whose copy is ready can start; the copy then moves
to `session.workspace`, and the agent sees only that folder.

The person reviews a finished task with four verdicts (`electron/services/harness/task-review.ts`),
each refused while the agent is still working:

- **Apply** adds the task's work to the folder's current version as one History entry per task (a
  merge-tree squash, never conflict markers; work that clashes with what changed meanwhile goes back
  to its agent to bring up to date).
- **Send back** returns it to its agent with a reason, in the same copy.
- **Discard** removes the copy and keeps its work under `refs/ostler/discarded/` for Bring back until
  the retention period (`history.retentionDays`, 30 days by default) runs out.
- **Nothing changed: Close** when there is nothing to apply.

**Stop** ends a running agent and keeps its work the way Discard does. Before Apply, Undo or Restore
writes the folder, the person's own unsaved edits are saved as a "Your edits" entry
(`history.saveMyEdits`, on by default; Settings › Advanced › "I manage version history myself" turns
it off) and a restore point is kept under `refs/ostler/restore/` (`electron/services/project-history.ts`).
The History view undoes a task, undoes the undo, restores to a point and brings discarded work back.
When the folder switches versions mid-task, a copy with no work in it follows the folder when its
agent starts, a running task shows a notice while its agent carries on, and Apply asks before
applying to the current version.

### Starting work, and what the person can do

Embedded sessions (the vendored opencode in headless server mode) are started by hand, or dispatched
automatically from the queued work when auto-dispatch is enabled for a project (off by default,
concurrency-capped). The dispatcher does nothing while agents are off or AI is halted, and never
applies work.

The Ostler UI is a read-only monitor plus a small set of human actions:

- queuing, reordering, prioritising, holding and cancelling tasks;
- starting a queued task with the built-in agent or an external one (which opens a sandboxed,
  Low-integrity, Windows-only terminal in the task's copy and copies a prompt carrying that session's
  own token);
- answering an agent's blocking question, and watching live transcripts;
- the four review verdicts and Stop;
- History's undo, restore and Bring back;
- the status bar's emergency stop (`EMERGENCY_STOP_AI`), which cancels every in-flight AI request
  (`abortAllAiRequests` in `ai-provider.ts`), ends every running embedded session and holds
  auto-dispatch off (`ai-halt.ts`, in memory, cleared by Resume or a restart).

Projects set up before task copies existed are moved once, at start-up, by
`electron/services/harness/legacy-migration.ts`: running work goes back to the queue with its copy,
waiting work and earlier merged work come up for review, the old folders move to `<dataDir>/legacy/`
after a backup, and a failed step leaves everything as it was and asks for attention in the Agents
view.

### Two rights levels

A **coding agent** is any agent doing a task, embedded (opencode) or external through the harness
HTTP API. It gets its task text, read-only access to the Library files attached to its own work item,
and its project's conventions (`WatchedProject.agentConventions`, owner-written markdown edited in
Project settings › Agents), and cannot browse the Library. One resolver, `resolveProjectConventions`,
writes the conventions into an embedded copy as `OSTLER_PROJECT_CONVENTIONS.md` (listed in
`opencode.json` `instructions`) and returns the same text to an external agent as
`projectConventions` on its claim, `GET /session/:id`, `nextAssignment` and `GET /conventions`. Task
attachments likewise go through one resolver, `resolveTaskAttachments`, for the embedded runner and
the harness routes alike.

The **automation agent** acts for the person through the automation API with the person's token: it
sees the full Library (Human only items marked as such), and it can create, upload, attach and
archive.

### Embedded sessions

`buildTaskPrompt` in `opencode-runner-service.ts` carries only this task's scope and its workspace
baseline. The embedded agent's durable contract (workspace boundary, commit discipline, the
definition of done, what to do when blocked) is written by `generateOstlerAgentInstructionsMd` into
the copy as `OSTLER_AGENT_INSTRUCTIONS.md`, referenced by `instructions` in the copy's `opencode.json`,
so opencode loads it into the session's system prompt. opencode rejects an `opencode.json` with
unknown top-level keys outright (`ConfigInvalidError`), which would take `plugin`, and so the whole
bridge, down with it.

An embedded session going idle is not a completion. `finish()` judges it on evidence (a submitted
`ostler_complete_task` report, or failing that whether any commits exist), and a session that
stopped unfinished is nudged back to work (bounded by `maxContinuationNudges`) before being recorded
as `unreported` or `abandoned`. A weak model's characteristic failure is stopping early, and
accepting idle as done is what once recorded those sessions as successes. Uncommitted leftovers are
swept onto the session's own branch at finish, so the work is reviewable rather than stranded in the
task's copy; that rescue commit goes through the project's commit hooks. Every exit path does this
(`endSession` covers stops, unrecovered stalls and runs that fail partway), not only a clean finish.

Ostler never trusts the agent runtime to return. opencode's shell tool can hang forever on Windows
after its own timeout (anomalyco/opencode#49169), and the stall watchdog in
`opencode-runner-service.ts` is the defence. When a tool call outlives its declared timeout by
`toolStallGraceMs`, or the session shows no sign of life for `noProgressStallMs`, the watchdog aborts
the stuck turn through opencode's API and the completion gate nudges the agent on, with its work and
context intact. Killing the session instead is what stranded finished work before.
`sendMessageTimeoutMs` is only a ceiling for a session that never converges, not the stall detector.

### Ostler AI beside the harness

Ostler's own AI chat (`electron/services/ai-service.ts`) reports and documents; it never calls the
harness or acts as an agent. In the project notes chat it knows it is inside Ostler
(`buildProjectChatAddendum` in `src/shared/ostler-ai-prompts.ts`) and may propose goals, milestones
and work items as fenced `ostler-proposal` blocks. It creates nothing itself: `src/shared/chat-proposals.ts`
is the enforcement point (a three-type allowlist, field caps, at most five per reply, work items
pinned to `backlog` with no dependencies), and a record exists only after the person clicks Add.

## Ostler AI

Every model request Ostler AI makes gets its provider from `requireAi` in
`electron/services/ai-access.ts`, the one gate: it needs AI set up (a key, or a keyless local
provider such as Ollama), and setting AI up is the switch; there is no per-project switch. It maps
failures to plain advice once (`ai-errors.ts`, raw text behind Details).

Ostler AI reads the project folder through one module, `electron/services/project-files.ts`:
`listProjectFiles` respects `.gitignore`, `readProjectFile` reads text files inside the folder only,
and `readProjectFolder` stops at the context budget and names what it left out. Each feature gets
the file list plus the files it needs, and the notes chat may ask for more in a fenced `ostler-read`
block, at most two rounds. Provider presets live in `src/shared/ai-presets.ts`; `projectAiProfile`
(`src/shared/ai-profile.ts`) decides whether planning prompts write tasks for coding agents
(software) or for people (general). Built-in coding agents are not Ostler AI and do not pass this
gate: they see only their copy.

## The design system

The look comes from tokens, and only tokens: `src/renderer/styles/tokens.css` defines colours, type,
spacing, radii, shadows and motion for the light, dark and high-contrast themes. Screens are built from the
components in `src/renderer/ui/` (buttons, fields, dialogs, menus, tables, toasts, the calendar and
timeline grids). A reversible destructive action happens at once and offers Undo; an irreversible one
asks through `useConfirm`. `npm run lint` refuses raw colours and pixel font sizes in feature CSS.

## Navigation

`src/renderer/navigation/registry.ts` is the one list of views, project tabs, settings sections and
their shortcuts. The sidebar, the project tabs, the command palette, the menu and the shortcut help
all read it; `paths.ts` builds and parses every route. The settings sections and groups are kept in
`settings-registry.ts`, which `registry.ts` re-exports, so it is still one registry. `shell/AppShell.tsx` is the sidebar, content
and status bar. Each project opens a workspace (`views/workspace/ProjectWorkspace.tsx`) at
`/projects/:projectId/:view`; Home is `views/home/HomeView.tsx`, and `/` and unknown paths open it.
While `ui.firstRunCompleted` is false, `welcome/FirstRunGate.tsx` shows the full-window welcome
instead of the shell. Agent and AI controls appear only while their feature is on
(`useFeatures()`). The shortcut table is `src/shared/shortcuts.ts`, and the user guide's shortcut
page is generated from it (`npm run docs:shortcuts`).

## Words and languages

Every word people read is a key in `src/shared/locales/en/`, one JSON file per area, and
code shows it with `t('namespace:key')` from `src/shared/i18n/`, the one i18next set-up for main and
the renderer. Settings › General › Language picks the language ("Match Windows" by default); main
resolves it against Windows' languages, rebuilds its menus and tray, and tells the window, which
re-renders below the router so the current page stays open. Dates and numbers go through `Intl` in
the Windows region (`src/shared/format.ts`, `dates.ts`). `npm run lint` runs `scripts/check-i18n.cjs`,
which refuses text typed into the renderer, and the e2e suite walks the app in the `en-XA`
pseudo-locale. Text for AI models and coding agents, the agent APIs and the log stay in English.
[docs/translating.md](translating.md) is the guide for translators.

## Help and documents

The user guide in `docs/user-guide/` is bundled into the renderer and shown under Help at
`/help/:page` (`src/renderer/help/`), so the repository and the app show one text. What's new is the
running version's section of `CHANGELOG.md`.

## Whiteboards

The pure model and rules (objects, geometry, outline, mind maps, connectors, paste, the file format,
Make tasks) are `src/shared/whiteboard/`. Objects live in the `whiteboard_objects` table behind
`libraryService.whiteboards` (`electron/services/whiteboard-service.ts`). A whiteboard is a Library
item whose `body` is only ever the outline written from its objects (search, links, Ostler AI and
agents read that). One scene, `src/renderer/components/whiteboard/WhiteboardScene.tsx`, draws a board
for the editor, the Library preview, print and export; the editor and its tools are the rest of
`src/renderer/components/whiteboard/`, opened from the Plan view.

## Ostler for Android

`mobile/` is Ostler for Android: Expo, React Native and TypeScript, its own npm package, built
locally with `npx expo run:android`. It opens the same `ostler.db` through op-sqlite
(`mobile/src/db/`), runs the desktop's own migrations (`electron/services/database/migrations/list.ts`)
and reuses the sync engine in `electron/services/sync/`, which reaches Node and Electron only through
`platform.ts`: Metro swaps it for `mobile/src/platform.ts` (`mobile/metro.config.js`). It signs in
with Google (`drive` scope) and syncs only through Drive (`mobile/src/sync/`). Screens are
`mobile/src/screens/`, reads `mobile/src/data/queries.ts`, edits `mobile/src/data/edits.ts`. Limits:
it cannot complete a repeating task, its personal space is read-only, and Google's testing mode ends
sign-in every 7 days. Release and store steps are in [docs/mobile/](mobile/).

## Testing

- `tests/unit`: services and pure logic, against real SQLite in temporary folders.
- `tests/renderer`: components and hooks with Testing Library; the preload API is faked by a typed
  fixture, `tests/renderer/fixtures/ostler-api.ts`.
- `tests/integration`: the HTTP APIs and whole harness workflows, plus a start-up smoke test of the
  real app. The automation API's tests are in `tests/integration/automation/`, one file per route
  group, sharing the server and request helpers in `tests/helpers/automation-fixture.ts`.
- `tests/e2e`: Playwright driving the built Electron app on throwaway data, including the
  accessibility suites (axe, ARIA snapshots, keyboard). Every spec starts the app through
  `launchOstler` (`tests/e2e/helpers/launch.ts`).
- `tests/perf`: the performance budgets on a generated dataset.
- `tests/helpers`: shared test helpers (temporary folders, `makeWatchedProject`, the migrated
  database, the automation server fixture).
- `scripts/`: the check and build scripts. They share `scripts/lib/` for the repo root (`root.cjs`),
  walking files (`walk.cjs`), reading flags (`args.cjs`) and running npm on every platform
  (`run.cjs`); a new script uses these rather than its own copies. The `dev`, `monkey` and `perf`
  scripts keep their own.

`npm run verify` runs the gate the release workflow runs. [CONTRIBUTING.md](../CONTRIBUTING.md#tests) lists every
command.

## Assets and their sources

- The app icon and taskbar badges are original: `build/icons/mark.svg` is drawn for Ostler, and
  `npm run icons` renders every PNG and `icon.ico` from it.
- Interface icons are [Lucide](https://lucide.dev/) (ISC), shipped as `lucide-react`.
- Ostler bundles no fonts. It uses the Windows system fonts Segoe UI Variable and Cascadia Mono.
- Screenshots in `docs/images/` are taken from the advanced demo project, in the light and dark
  themes.
- Third-party licences: `out/THIRD_PARTY_NOTICES.md`, generated by `npm run build` and shipped
  beside the app.
