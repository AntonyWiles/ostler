# Automation API: Reports, Ostler AI settings and project conventions

Part of the [Ostler Automation API](README.md). Base path for all routes below: `<baseUrl>/automation/<projectId>`

## Reports

| Method | Path       | Query                                                                   | Response                                                             |
| ------ | ---------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------- |
| GET    | `/reports` | `range=30d` (default), `90d`, `milestone:<milestoneId>`; `splitBy=type` | The project dashboard: the same report the Overview's Insights show. |

The report is built in one place (`electron/services/report-builder.ts`, through
`ReportService`), so the API and the app never disagree. It holds:

- `keyNumbers`: `open`, `doneInRange`, `overdueNow`, `dueNext7Days`, `cycleTimeMedianMs`,
  `cycleTimeP85Ms`, `leadTimeMedianMs` (null when nothing finished in range had one), and the sample
  sizes they come from.
- `burnUp`: one entry per milestone with tasks, `points` per day of `scopeCount` and `doneCount`, and
  `scopeEstimate`/`doneEstimate` only when every task in the milestone has an estimate
  (`defaultMeasure` says which the app draws; `missingEstimates` counts the gaps).
- `cumulativeFlow.points`: tasks per status at the end of each day.
- `throughput.weeks`: tasks finished per week (weeks start on Sunday, as the project metrics count).
- `cycleTime.buckets`: finished tasks by whole days from start to done.
- With `splitBy=type`, `throughput.byType` and `cycleTime.byType`: the Overview's **Split by
  type**. Each entry has a `series` (`key`: the type's id, `none` for tasks with no type, or
  `other`; `name`; `icon` and `color`, null for No type and Other; `typeIds`, the types it counts),
  then `weeks` and `total` (throughput) or `buckets` and `sampleSize` (cycle time), and a `summary`
  ("Bug: …"). The series are the types that finished something in range, in the project's order,
  then No type; with more than six, the six that finished most keep their own and the rest share
  Other, last. They sum exactly to the unsplit `weeks` and `buckets`. A project with no types gets
  empty lists, and without `splitBy` the report has no `byType`. Any other `splitBy` is refused.
- `workload.rows`: open tasks, estimate sum, tasks without an estimate and overdue tasks per person,
  with unassigned work last.
- `atRisk`: `overdue` tasks, tasks `blocked` for more than 3 days, dependency `conflicts` (the same
  rule as below, open tasks only), `lateMilestones` (past their date, or behind the recent pace, with
  the forecast as a range of days, never a date) and `unforecastMilestones` (too little history).
- `iterationBurndown`: the current iteration's burn-down, or null when there is none: its `iterationId`, `name` and dates, `points` with
  `remainingCount` and `remainingEstimate` at the end of each day (null after today) and the ideal
  line (`idealCount`, `idealEstimate`), and `defaultMeasure`, from the status history and each
  task's iteration changes.

Every chart section has a `summary` sentence stating its point, or what is missing. Truth over
tidiness: days before a task existed are left out rather than drawn as zeros; a reopened task is open
work, and a task finished twice counts once; a forecast with nothing finished in the last four weeks
is `{ kind: "not-enough-history" }`, never an infinite date. A milestone range runs from the
milestone's (or its first task's) creation to today and narrows every section to its tasks.
Reports are cached per project and range and refreshed as soon as anything they read changes.

## Ostler AI settings

| Method | Path           | Body                                                                            | Response                                             |
| ------ | -------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------- |
| GET    | `/ai-settings` | —                                                                               | `{ projectId, access, profileSetting, profile }`     |
| PATCH  | `/ai-settings` | Any of `{ access: boolean, profileSetting: "auto" \| "software" \| "general" }` | The settings after the change, as `GET` returns them |

The same two settings as the project's settings dialog. `access` is "Ostler AI can read this
project": while it is false, every Ostler AI request about the project (chat, planning drafts,
summaries, reviews) is refused before anything is read or sent, and the app shows no AI controls
for it. `profileSetting` chooses how Ostler AI's planning prompts write tasks: `software` writes them
as briefings for coding agents, `general` for the person doing them (an outcome, steps and a
checklist), and `auto` follows the project (`profile` says what it comes to: software when the
linked folder is a Git repository). The automation API itself has no route that calls a model.

## Area and icon

| Method | Path          | Body                                                      | Response                            |
| ------ | ------------- | --------------------------------------------------------- | ----------------------------------- |
| GET    | `/appearance` | —                                                         | `{ areaId, icon }`                  |
| PATCH  | `/appearance` | Any of `{ areaId: string \| null, icon: string \| null }` | `{ areaId, icon }` after the change |

The project's area and icon, as Project settings sets them. `areaId` is an id from
`GET /automation/areas`, or `null` for No area; an unknown area is HTTP 400. `icon` is one of the
curated icon ids (`/help` lists them: `house`, `briefcase`, `plane`, `book`, `heart` and so on), or
`null` for none; anything else is HTTP 400. A field left out keeps its value. Areas themselves are
made, renamed, reordered and removed in the app.

## Stage

| Method | Path     | Body                                                       | Response                     |
| ------ | -------- | ---------------------------------------------------------- | ---------------------------- |
| GET    | `/stage` | —                                                          | `{ stage }`                  |
| PUT    | `/stage` | `{ stage: "planning" \| "active" \| "on-hold" \| "done" }` | `{ stage }` after the change |

The project's stage on Home's board of projects, as dragging its card or Project settings › General › Stage
sets it. On hold and Done projects leave Home's Today and Upcoming, My work and the Inbox's blocker
nudges; reminders the person set, agent questions and reviews, agents and auto-dispatch are not
affected. Moving a project back to `planning` or `active` brings its tasks back at once. Any other
value is HTTP 400. The board's column names are display only and never change these ids. Archiving
a project is not a stage.

## Triage

| Method | Path      | Body                                            | Response                                          |
| ------ | --------- | ----------------------------------------------- | ------------------------------------------------- |
| GET    | `/triage` | —                                               | `{ enabled, waiting }`                            |
| PUT    | `/triage` | `{ enabled: boolean, acceptWaiting?: boolean }` | `{ enabled, waiting, accepted }` after the change |

The project's **Triage new captures** setting, as Project settings sets it, and how many
tasks wait in To triage. With it on, quick captures (the app's quick add, Snip to task and tasks
from text, and `POST /work-items` with `triage: true`) wait in To triage. Turning it off while
tasks wait is HTTP 400 unless `acceptWaiting: true`, which first accepts every waiting task into
the Backlog, as the app offers. Off by default. See [work items](work-items.md#triage) for the
decisions.

## Status updates

| Method | Path                 | Body                                                              | Response                          |
| ------ | -------------------- | ----------------------------------------------------------------- | --------------------------------- |
| GET    | `/updates`           | —                                                                 | `StatusUpdate[]`, newest first    |
| POST   | `/updates`           | `{ health: "on-track" \| "at-risk" \| "off-track", note }`        | The new `StatusUpdate`            |
| PATCH  | `/updates/:updateId` | `{ health, note }`                                                | The `StatusUpdate` after the edit |
| DELETE | `/updates/:updateId` | —                                                                 | The `StatusUpdate` deleted        |
| GET    | `/update-reminder`   | —                                                                 | `{ cadence, weekday, since }`     |
| PUT    | `/update-reminder`   | `{ cadence?: "off" \| "weekly" \| "fortnightly", weekday?: 0-6 }` | `{ cadence, weekday, since }`     |

A status update is the person's own word on how the project is going: `health` is `on-track`,
`at-risk` or `off-track`, and `note` is Markdown, trimmed, at most 2,000 characters (it may be
empty). Ostler never computes the health. A `StatusUpdate` is `{ id, projectId, health, note,
authorKind, authorPersonId, authorName, postedAt, editedAt }`; `authorKind` is `human` (posted in
the app, by the person `authorPersonId`) or `automation` (posted here). The first update of
`GET /updates` is the latest, which the Overview and Home's cards show. Posting adds an entry to the
project's activity ("Automation API posted a status update: At risk"); an edit keeps the author and
`postedAt` and sets `editedAt`. A bad health, or a note over the limit, is HTTP 400.

The reminder is the project's, as Project settings › General › Status update reminder sets it: `weekday` is 0
(Sunday) to 6 (Saturday), and `since` is the day it was turned on or last changed (`YYYY-MM-DD`, or
null while off). A field left out keeps its value. On the reminder day, unless an update was posted
since that day began, the Inbox shows "Time for a status update" for the project and a desktop
notification follows the reminders' notification setting. Fortnights count from the first reminder
day on or after `since`. On hold and Done projects get no reminder. Updates travel in the project
file (`statusUpdates` in the package) and `GET /export?format=html&statusUpdate=true` includes the
latest.

## Project conventions

| Method | Path                 | Body                                   | Response                                |
| ------ | -------------------- | -------------------------------------- | --------------------------------------- |
| GET    | `/conventions`       | —                                      | `{ agentConventions, lessons }`         |
| PATCH  | `/conventions`       | `{ agentConventions: string }`         | `{ agentConventions }` after the change |
| POST   | `/lessons`           | `{ text: string }`                     | The new lesson (201)                    |
| PATCH  | `/lessons/:lessonId` | `{ text?: string, enabled?: boolean }` | The lesson after the change             |
| DELETE | `/lessons/:lessonId` | —                                      | `{ id, deleted: true }`                 |

The project's conventions for coding agents, the same text as Project settings › Agents ›
Conventions: owner-written markdown (code style, commands to run, things to avoid), at most 20,000
characters; `""` clears it. Every coding agent on the project gets it with each task, identically:
a built-in agent finds it as `OSTLER_PROJECT_CONVENTIONS.md` in its system instructions, and a
connected agent gets it as `projectConventions` on its claim, `GET /session/:id`, `nextAssignment`
and the agent API's `GET /conventions`. Conventions are project context and grant no access.

### Lessons from earlier reviews

A lesson is a rule the person saved with **Remember this for next time** after sending agent work
back, such as "Use `formatDate` from `src/shared/format.ts` for dates, never a new helper". Each is
`{ id, text, enabled, addedAt, source }`: `text` is at most 500 characters, `addedAt` is in
milliseconds, and `source` is `{ sessionId, taskTitle }` for one saved after a send-back, or `null`
for one added here. A project keeps at most 100. `GET /conventions` lists them oldest first.

Agents read the lessons that are on after the conventions, from the same resolver, under a
**Lessons from earlier reviews** heading, one line each with the date it was added
(`- 2026-10-03: …`). The whole text is capped at 30,000 characters: past that the oldest lessons
are left out first, and a line says how many. A lesson that is off is kept, and no agent reads it.
`POST /lessons` adds one, on; `PATCH /lessons/:lessonId` changes its text or switch; `DELETE`
removes it (404 for an unknown id). Lessons are project context, as conventions are, and grant no
access. MCP reads them through `GET /conventions` and cannot change them.

## Workspace setup

| Method | Path               | Body                                                                       | Response                          |
| ------ | ------------------ | -------------------------------------------------------------------------- | --------------------------------- |
| GET    | `/workspace-setup` | —                                                                          | `{ agentSetup }`                  |
| PATCH  | `/workspace-setup` | `{ agentSetup: { mode: "auto" \| "off" } \| { mode: "custom", command } }` | `{ agentSetup }` after the change |

How a new agent workspace is prepared before the agent starts, as Project settings › Agents ›
Workspace setup does. `auto` (the default) installs dependencies with the package manager the
project's lockfile names (`pnpm`, `bun`, `yarn`, `npm ci`, `uv sync`); `off` installs nothing; `custom`
runs the `command` you give, in each new workspace, with `CI=1`. A blank custom command is refused.
The setting applies to the next session started; a session already running keeps the setup it was
given. The result of each run is on the session's `workspace.setup` record. Coding agents cannot read
or change this setting: it is not on the agent API.
