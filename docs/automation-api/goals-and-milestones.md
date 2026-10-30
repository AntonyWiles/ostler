# Automation API: Goals and milestones

Part of the [Ostler Automation API](README.md). Base path for all routes below: `<baseUrl>/automation/<projectId>`

## Goals

| Method | Path                   | Body                                                           | Response                                                                                                                                                                                                                                                                                                                  |
| ------ | ---------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/goals`               | —                                                              | Array of goals.                                                                                                                                                                                                                                                                                                           |
| POST   | `/goals`               | `{ title, outcome?, measure? }`                                | Created goal.                                                                                                                                                                                                                                                                                                             |
| PATCH  | `/goals/:goalId`       | `{ title?, outcome?, status?, measure? }`                      | Updated goal. `status` is `active`, `achieved` or `archived`.                                                                                                                                                                                                                                                             |
| DELETE | `/goals/:goalId`       | —                                                              | `{ id, deleted: true }`. Permanent. Refused while any milestone still belongs to the goal.                                                                                                                                                                                                                                |
| POST   | `/goals/:goalId/split` | `{ items: [{ type: "milestone" \| "work-item", ...fields }] }` | Array of `{ index, ok, value \| error }` — one entry per requested item. Without refs, check each `ok` individually: this call is not all-or-nothing. With refs (`ref`, `milestoneRef`, `parentRef`, `dependencyRefs`) it is one transaction: any error is a 400 and nothing is created. See "Batch references in split". |

### Measures and check-ins

A goal can have a **measure**: a number to reach by a date. Every goal has `measure`, null
without one. Send one on `POST /goals` or `PATCH /goals/:goalId`; `measure: null` takes it away and
keeps its check-ins.

```json
{
  "unit": "members",
  "startValue": 0,
  "targetValue": 200,
  "startDate": "2026-10-01",
  "targetDate": "2026-12-31",
  "direction": "up"
}
```

`unit` is free text, at most 20 characters, and may be empty. `targetDate` must be after
`startDate`. `direction` is `up` when higher is better and `down` when lower is (a backlog to cut);
left out, it follows the way the target lies from the start, and one that disagrees is refused.
Numbers are JSON numbers, never formatted text.

| Method | Path                             | Body                     | Response                                                       |
| ------ | -------------------------------- | ------------------------ | -------------------------------------------------------------- |
| GET    | `/goals/:goalId/check-ins`       | —                        | The goal's check-ins, oldest first.                            |
| POST   | `/goals/:goalId/check-ins`       | `{ date, value, note? }` | `{ checkIn, replaced }`: `replaced` is the one it replaced.    |
| DELETE | `/goals/:goalId/check-ins/:date` | —                        | The check-in as it was. A day with none is refused (HTTP 400). |

A check-in is `{ goalId, projectId, date, value, note, recordedAt }`. A goal has one a day: a second
for the same `date` replaces the first. Check-ins show in the project's activity as recorded by the
automation API. The app works out progress from the measure and check-ins: the latest value (the
start value without check-ins) and whether it is ahead of, behind or within 5% of the straight line
from start to target. Reaching the target never changes the goal's `status`; set `achieved`
yourself.

### Goals of your own

Goals of your own sit outside any project ("Save £5,000", "Read 24 books"). Like people,
they are shared by every project: any project's token manages them, and the path still starts with
that project's id. They never go in a project file.

| Method | Path                                              | Body                                      | Response                                                         |
| ------ | ------------------------------------------------- | ----------------------------------------- | ---------------------------------------------------------------- |
| GET    | `/personal-goals`                                 | —                                         | Every goal of your own: active, then achieved, then dropped.     |
| GET    | `/personal-goals/:personalGoalId`                 | —                                         | One goal of your own.                                            |
| POST   | `/personal-goals`                                 | `{ title, outcome?, measure? }`           | The new goal, active.                                            |
| PATCH  | `/personal-goals/:personalGoalId`                 | `{ title?, outcome?, status?, measure? }` | The changed goal. `status` is `active`, `achieved` or `dropped`. |
| DELETE | `/personal-goals/:personalGoalId`                 | —                                         | `{ id, deleted: true }`, with its check-ins and links.           |
| GET    | `/personal-goals/:personalGoalId/check-ins`       | —                                         | Its check-ins, oldest first.                                     |
| POST   | `/personal-goals/:personalGoalId/check-ins`       | `{ date, value, note? }`                  | `{ checkIn, replaced }`, as for a project goal.                  |
| DELETE | `/personal-goals/:personalGoalId/check-ins/:date` | —                                         | The check-in as it was.                                          |
| PUT    | `/goals/:goalId/counts-towards`                   | `{ personalGoalId }` (or `null`)          | `{ goalId, personalGoalId, previous }`.                          |

`measure` is the same object as a project goal's. `PUT /goals/:goalId/counts-towards` makes one of
the token's project's goals count towards a goal of your own, or towards none with `null`; a project
goal counts towards at most one. Both need a measure with the same unit (case aside) and the same
direction, or the request is refused in words. Linking and unlinking never change either goal's
check-ins.

Each goal of your own lists `links`, the project goals that count towards it, each with `goalId`,
`projectId`, `title`, `measure`, `latest` (its latest value, its start value before a check-in) and
`mismatch` (null while it counts; `unit`, `direction` or `no-measure` once its measure changed so it
no longer does). With links that count, `fromLinks` is true and its value is the **sum of their
latest values**: `readings` has, for each day any of them was checked in, the sum of each one's
latest value by then. Without, `readings` are its own check-ins (kept, but not counted, while links
count). `progress` is worked out from `readings` by the same rule as a project goal's, or null
without a measure. A removed project's links go with it; a project that is off still counts.

A goal of your own can be pinned to the sidebar (`POST /pins` with `kind: "personal-goal"`) and
count down to its measure's target date; see
[Filtering, search and saved views](filtering-search-saved-views.md).

## Milestones

| Method | Path                       | Body                                                                        | Response                                                                                                                                                                |
| ------ | -------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/milestones`              | — (query: `include=linkedFrom`)                                             | Array of milestones; with `include=linkedFrom`, each has `linkedFrom`.                                                                                                  |
| POST   | `/milestones`              | `{ name, outcome?, goalId?, subprojectId?, targetDate?, successCriteria? }` | Created milestone.                                                                                                                                                      |
| PATCH  | `/milestones/:milestoneId` | same fields as POST, and `status`, all optional                             | Updated milestone. `status` is `planned`, `active`, `complete` or `archived`. `subprojectId` puts it in a workstream (`GET /subprojects`) or, `null`, at the top level. |
| DELETE | `/milestones/:milestoneId` | —                                                                           | `{ id, deleted: true }`. Permanent. Refused while any work item still belongs to the milestone.                                                                         |

### Repeating rounds

A milestone can be a round of work that comes round again (the app's **Repeat this round**). A
repeating milestone has `repeat: { rule, lengthDays, nextStart, on }` and `roundStart`, the first
day of its round; a round made from an earlier one has `previousRoundId`. Each is left out when it
is not set. A task copied into a new round has `roundSourceId`, the task of the earlier round it
came from.

| Method | Path                                  | Body                              | Response                                       |
| ------ | ------------------------------------- | --------------------------------- | ---------------------------------------------- |
| PUT    | `/milestones/:milestoneId/repeat`     | `{ rule, lengthDays, nextStart }` | The milestone, repeating.                      |
| DELETE | `/milestones/:milestoneId/repeat`     | —                                 | The milestone, `repeat.on` false.              |
| POST   | `/milestones/:milestoneId/next-round` | —                                 | The new round. Refused when it doesn't repeat. |

`rule` is a repeat rule as a task's repeat takes it (`{ every, interval?, weekdays?, monthDay? }`),
anchored on the rounds' start days. `lengthDays` (1 to 366) is how long a round lasts, its first and
last day included, and `nextStart` (`YYYY-MM-DD`, after this round started) is when the next round
starts. Only the latest round of a series can repeat.

On its start day, checked when Ostler starts and every hour, or at once with `next-round`, Ostler
makes the next round in one step: a milestone named after the first round and the new one
(`Accounts · May 2027`), with the same outcome, success criteria and goal and `targetDate` the
round's last day, and a copy of every task of the round that is not in the recycle bin and does not
repeat, in Backlog with its checklist clear and its dates moved on (by whole months for monthly and
yearly rules, by days otherwise), subtasks and Waits on links kept between the copies. The schedule
moves to the new round. If Ostler was closed through several start days, only the latest round is
made.

```json
PUT /milestones/<id>/repeat
{ "rule": { "every": "month", "interval": 1, "monthDay": 1 }, "lengthDays": 10, "nextStart": "2027-05-01" }
```

#### Compare rounds

`GET /milestones/:milestoneId/rounds` returns what the app's **Compare rounds** shows for the
series the milestone belongs to (any of its rounds will do; a milestone that is no round is a
series of one), counted as `GET /reports?range=milestone:<id>` counts each round:

- `rounds`, oldest first: `{ milestoneId, name, start, targetDate, plannedDays, firstStartedAt,
lastFinishedAt, tookDays, finished, done, wontDo, open, timeTrackedSeconds, summary }`.
  `plannedDays` runs from `start` to `targetDate`, both included. `tookDays` runs from the first
  task's start (its first move into active, else ready) to the last task's finish, both included,
  in local days; to today while tasks are open, and null while nothing has started.
- `tasks`: a row per task followed across rounds through each copy's `roundSourceId`, so a task
  renamed between rounds is one row and a copy whose source is gone starts its own. Each row is
  `{ title, cells, slowestCycleRound, slowestTimeRound }`; `cells` lines up with `rounds`, null
  where the task is not in that round, else `{ workItemId, title, outcome: done | wont-do | open,
cycleTimeMs, timeTrackedSeconds }`. The slowest indexes are null unless two or more rounds have a
  value.
- `hasTimeTracked`, `seriesName`, `summary` and `generatedAt`.

`?format=csv` returns the CSV the app's **Export CSV** writes: Task, then a column per round with
`?measure=cycle` (the default, days to one decimal) or `?measure=time` (hours). A cell without a
number says why: not in this round, won't do, open, not started.

### Release notes

`GET /milestones/:milestoneId/release-notes` and `GET /iterations/:iterationId/release-notes`
return the draft the app's **Write release notes** builds, from the same code:
`{ title, markdown, taskTitles }`. The Markdown has the title ("Release notes: <name>"), the day
the milestone was completed or the iteration finished (or today), a count of finished tasks, then a
bullet per task. Done tasks count, archived ones included; open, won't-do and recycle-bin tasks do
not. Markdown characters in titles are escaped.

| Query          | Values                    | Default | What it does                                                                  |
| -------------- | ------------------------- | ------- | ----------------------------------------------------------------------------- |
| `groupBy`      | `type`, `label` or `none` | `type`  | Sections per task type (project order, then Other), per first label, or none. |
| `descriptions` | `true` or `false`         | `false` | Adds each task's first sentence after its title.                              |
| `subtasks`     | `true` or `false`         | `false` | Lists finished subtasks under their parent.                                   |

Nothing is saved. To keep the draft, `POST /library` with `kind: "note"`, the `title`, the
`markdown` as `body` and `tags: ["release-notes"]` (see [Library](library.md)). Polish with AI is in
the app only.

`successCriteria` is the checklist the milestone review reads. Give it when the milestone is created,
or PATCH it; a PATCH replaces the whole list, the same as the milestone's edit dialog in the app.

## Iterations

Iterations (sprints or cycles) are optional per project. Each has a `name`, `startDate` and
`endDate` (`YYYY-MM-DD`, local days, the end day included), an optional `goal` sentence and a
`status`: `planned`, `active` or `finished`. A project's iterations never overlap, at most one is
active, and a task is in at most one, through its `iterationId`.

| Method | Path                              | Body                                        | Response                                                                                      |
| ------ | --------------------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------- |
| GET    | `/iterations`                     | —                                           | Array of iterations, oldest first.                                                            |
| POST   | `/iterations`                     | `{ name, startDate, endDate, goal? }`       | Created iteration, `planned`. An overlap is refused (400).                                    |
| PATCH  | `/iterations/:iterationId`        | any of `{ name, startDate, endDate, goal }` | Updated iteration.                                                                            |
| POST   | `/iterations/:iterationId/start`  | —                                           | The iteration, now `active`. Refused while another is active.                                 |
| POST   | `/iterations/:iterationId/finish` | `{ carryOver: "next" \| "none" }`           | `{ iteration, movedTaskIds }`. Tasks not Done move to the next planned iteration, or to none. |
| DELETE | `/iterations/:iterationId`        | —                                           | `{ iteration, taskIds }`. Its tasks stay, in no iteration.                                    |

A finished iteration keeps `summary`: `doneCount`, `doneEstimate`, `carriedCount`,
`carriedEstimate`, `carryOver` and `carriedToIterationId`. Moving a task in or out of an iteration
records an `iteration` change in its activity. Filter tasks with the `iteration` field on
`GET /work-items?filter=` (see [Filtering](filtering-search-saved-views.md)); the value `"current"`
means the active iteration or, with none active, the planned one whose dates include today. The
current iteration's burn-down is `iterationBurndown` in `GET /reports`.

`successCriteria`, `labels`, `acceptanceCriteria` and `dependencyIds` are **arrays of
strings**, never a single string.
