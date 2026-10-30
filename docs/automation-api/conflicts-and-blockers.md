# Automation API: Dependency conflicts, baselines and blockers

Part of the [Ostler Automation API](README.md). Base path for all routes below: `<baseUrl>/automation/<projectId>`

## Dependency conflicts

| Method | Path                    | Body | Response                                                                                                                   |
| ------ | ----------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/dependency-conflicts` | —    | Array of `{ taskId, dependencyId, start, dependencyDue, type, lagDays, earliest }`: waits-on links whose dates are broken. |

The same rule the Timeline view flags (`dependencyLinkConflict` in `src/shared/planning/timeline.ts`),
with each link's type and lag ([Waits-on links](work-items.md#waits-on-links-types-and-lag)). A task
starts on its `startDate`, or its `targetDate` when it has none. `start` is the task's date the link
measures (its first day, or its `targetDate` for `finish-to-finish`), `dependencyDue` the other's
date it measures from (its `targetDate`, or its first day for `start-to-start`). A link that is not
`finish-to-start` with no lag also has `type`, `lagDays` and `earliest`, `dependencyDue` plus
`lagDays`; a plain link's conflict has exactly the four fields it always had. A link missing a date it needs is no conflict, and landing on
`earliest` is fine; a `finish-to-start` link with no lag is exactly the rule from before types. To
fix one, `PATCH` the task's or the dependency's dates, or the link.

## Critical path

| Method | Path             | Query           | Response                                                                                                  |
| ------ | ---------------- | --------------- | --------------------------------------------------------------------------------------------------------- |
| GET    | `/critical-path` | `?milestoneId=` | `{ milestoneId, end, endFrom, chains, moreChains, tasks, undatedTaskIds }`: what the Timeline highlights. |

The same code as the Timeline's **Show critical path** (`criticalPath` in
`src/shared/planning/critical-path.ts`). It works from the dates as they are set and the waits-on
links, with each link's `type` and `lagDays`; it does not schedule anything.

- **The end** (`end`): the latest due date among open tasks (`endFrom: "tasks"`). With
  `?milestoneId=`, the milestone's `targetDate` (`endFrom: "milestone"`), or its latest task's due
  date when it has none, and only that milestone's tasks and everything they wait on count. `end` is
  null when no open task in scope has a date. An unknown `milestoneId` answers 404.
- **Spans and links**: a task runs from its `startDate` to its `targetDate`; a `targetDate` or a
  `startDate` alone is one day. Each link counts by its type and lag, as for dependency conflicts:
  finish to start, a task may start on the day what it waits on is due plus the lag; start to start,
  on its first day plus the lag; finish to finish, be due on its due date plus the lag.
- **`tasks`**: every open dated task in scope, as `{ taskId, start, end, latestEnd, slackDays,
critical }`. `slackDays` is how many calendar days it can slip before it pushes the end; negative
  when it is already late against the end. `critical` is `slackDays <= 0`.
- **`chains`**: the critical tasks as chains of ids, first to last. Tasks that tie give a few
  chains, at most 10; `moreChains` is true when more were left out.
- **`undatedTaskIds`**: open tasks in scope with no dates, which are not counted. Done tasks are
  left out.

## Baselines

A baseline is a named, dated copy of every live task's and milestone's dates: what the
Timeline's **Save a baseline** makes and **Compare with** draws. At most 10 per project. A baseline
never changes: moving a task does not touch it, and deleting a task or milestone keeps its entry.

| Method | Path                             | Body                   | Response                                                       |
| ------ | -------------------------------- | ---------------------- | -------------------------------------------------------------- |
| GET    | `/baselines`                     |                        | `Baseline[]`, newest first                                     |
| POST   | `/baselines`                     | `{ name, replaceId? }` | `Baseline`                                                     |
| GET    | `/baselines/:baselineId`         |                        | `Baseline` with `entries`                                      |
| PATCH  | `/baselines/:baselineId`         | `{ name }`             | `Baseline` (renamed; its dates never change)                   |
| DELETE | `/baselines/:baselineId`         |                        | what was deleted, with `entries`                               |
| GET    | `/baselines/:baselineId/compare` |                        | `{ baselineId, name, savedAt, changes, added, gone, summary }` |

- **`Baseline`**: `{ id, projectId, name, savedAt, taskCount, milestoneCount }`. `name` is 1 to 80
  characters; `savedAt` is epoch milliseconds.
- **Saving** copies, in one transaction, every task's `startDate` and `targetDate` and every
  milestone's `targetDate`, leaving out archived tasks, tasks in the bin and archived milestones.
  With 10 saved already it is HTTP 400 unless `replaceId` names the baseline to delete to make
  room.
- **`entries`**: `[{ kind: "task" | "milestone", itemId, start, due }]`, the dates as they were
  (`YYYY-MM-DD` or null; a milestone's `start` is always null and `due` is its target date).
- **Comparing** uses the same code as the Timeline and the milestone cards (`compareBaseline` in
  `src/shared/planning/baselines.ts`), against the live plan. `changes` has
  `{ kind, itemId, baseline: { start, due }, current: { start, due }, startDays, dueDays }` for each
  item in both, in calendar days, positive later, null when either side has no such date. `added`
  lists items new since; `gone` lists items in the baseline no longer in the plan (deleted,
  archived or binned). `summary` is `{ later, earlier, unchanged, added }` for tasks: a task moved
  by its due date, or its start when either side has no due date.
- Baselines travel in the project file (`baselines`, entries by task or milestone ref), never in a
  template.

## Blockers

| Method | Path                           | Body                                              | Response                                         |
| ------ | ------------------------------ | ------------------------------------------------- | ------------------------------------------------ |
| GET    | `/blockers`                    | —                                                 | Array of blockers (each includes its work item). |
| POST   | `/blockers`                    | `{ workItemId, description, resolutionOptions? }` | Created blocker.                                 |
| POST   | `/blockers/:blockerId/resolve` | `{ choice, note? }`                               | Resolved blocker.                                |
