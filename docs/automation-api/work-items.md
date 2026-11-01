# Automation API: Work items

Part of the [Ostler Automation API](README.md). Base path for all routes below: `<baseUrl>/automation/<projectId>`

## Work items

| Method | Path                      | Body                                                                                                                                                                                                                                                                                                                                         | Response                                                                                                                               |
| ------ | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/work-items`             | —                                                                                                                                                                                                                                                                                                                                            | Array of work items. `?filter=` keeps the ones that match (see "Filtering work items").                                                |
| POST   | `/work-items`             | `{ title, description?, status?, priority?, milestoneId?, subprojectId?, iterationId?, typeId?, labels?, acceptanceCriteria?, dependencyIds?, dependencyLinks?, targetDate?, startDate?, showFrom?, someday?, impact?, effort?, assigneeId?, estimate?, autoQueue?, planFirst?, parentWorkItemId?, subtaskPhaseNumber?, subtaskPhaseName? }` | Created work item.                                                                                                                     |
| POST   | `/work-items/batch`       | `{ items: [{ ref?, parentRef?, dependencyRefs?, milestoneRef?, ...fields of POST /work-items }] }`, up to 500 items. `?dryRun=1` checks only.                                                                                                                                                                                                | The created work items, in the order sent. With `?dryRun=1`: `{ valid, errors: [{ index, field, message }] }`, and nothing is written. |
| PATCH  | `/work-items/:workItemId` | same fields as POST                                                                                                                                                                                                                                                                                                                          | Updated work item.                                                                                                                     |

### Task IDs

Every task has a number, unique within its project and never reused (deleting a task, even for
good, never frees its number), and an ID made of the project's prefix and that number: `SHOP-12`.
Every work item carries `number` and `key` (the ID). Every route that takes `:workItemId` takes
the ID too (`PATCH /work-items/SHOP-12`, `POST /work-items/shop-12/comments`), and so do
`dependencyIds`, `dependencyLinks[].id` and `parentWorkItemId` in bodies. An ID of this project
that no task has is HTTP 404 in a path and HTTP 400 in a body. Changing the prefix changes every
task's `key` at once.

| Method | Path                      | Body             | Response                                                       |
| ------ | ------------------------- | ---------------- | -------------------------------------------------------------- |
| GET    | `/work-items/:workItemId` | —                | The work item, by its id or its ID.                            |
| GET    | `/work-items/by-key/:key` | —                | The work item with that ID (`SHOP-12` or `shop-12`), else 404. |
| GET    | `/task-prefix`            | —                | `{ taskPrefix }`                                               |
| PUT    | `/task-prefix`            | `{ taskPrefix }` | `{ taskPrefix }` after the change                              |

- `by-key` finds the task in the archive and the recycle bin too. An ID of another project, or a
  number no task of this project has, is HTTP 404.
- A prefix is two to five letters A to Z, made capital. One another project uses, or one that is
  not two to five letters, is refused with HTTP 400. Old IDs in commits and notes no longer match
  after a change.

### Lists, fields and many changes at once

- `GET /work-items?status=blocked,ready` keeps only those statuses, as the app shows them.
- `GET /work-items?fields=key,title,status` sends only those fields of each task, plus `id`.
  Both work with `?filter=` and `?scope=`.
- `PATCH /work-items/batch` with `{ items: [{ id, ...fields }] }` makes each change as
  `PATCH /work-items/:workItemId` would (`id` may be the task's ID), up to 500 at once. The
  planning changes are one transaction: a refused item changes nothing, and the answer (400) names
  the item (`items[3] (SHOP-12): …`). `moveDependents` isn't taken here.

### Owner only

`ownerOnly: true` marks a task as the person's alone. Agents never queue, claim or work on it: the
dispatcher skips it, and queuing it for an agent (the app, `POST /tasks`, a playbook or a repeat) is
refused. Turning it on for a queued task that no agent has started takes it out of the queue; for a
task an agent is running it is refused. Automation may set `ownerOnly: true` on create or `PATCH`,
but only the person can set it back to `false`, in Ostler (the API answers 400). Write it once as the
flag, not as a note pasted into each description.

### Blocked tasks

`blockedReason` says why a blocked task is blocked, in up to 200 characters ("Waiting on you",
"Waiting on SHOP-4", "Waiting on 1 March"). It is kept only while the status is `blocked`: send it
with `status: "blocked"`, or on a task that is already blocked, and it clears when the task leaves
Blocked.

| Method | Path       | Response                                                                                                               |
| ------ | ---------- | ---------------------------------------------------------------------------------------------------------------------- |
| GET    | `/blocked` | `Array<{ id, key, title, blockedReason, waitingOn: Array<{ id, key, title, status }>, clear }>` for every blocked task |

`clear` is true when the task waits on at least one task and every one of them is done: nothing it
waits on holds it back any more, so it is probably ready to move on.

### Commits

Ostler reads task IDs in the project's commit messages as it reads the project's Git history, and
links each task to the commits that name it.

| Method | Path                              | Body | Response                                                                  |
| ------ | --------------------------------- | ---- | ------------------------------------------------------------------------- |
| GET    | `/work-items/:workItemId/commits` | —    | `TaskCommit[]`: `{ hash, abbreviatedHash, subject, author, date, fixes }` |

- Newest first. `subject` is the commit's first line as Git has it; treat it as plain text.
- An ID counts as the project's prefix, a dash or a space, and the number, in any case, as a whole
  word: `SHOP-12`, `shop 12`, or a branch name such as `shop-12-fix-the-login` in a merge message.
  `SHOP-123` never counts as `SHOP-12`, and another project's prefix never counts.
- `fixes` is `true` when the ID came right after fix, fixes, fixed, close, closes, closed, resolve,
  resolves or resolved (any case, an optional colon). It never changes the task: in the app, a new
  commit that fixes an open task offers **Mark as done** in the Inbox.
- Links stay when the prefix changes; commits after the change are read with the new prefix. A task
  of another project is refused.

### Manual order

Every project's tasks have one manual order: the order the Board shows under Manual order, the List
shows with no column sorted, and a task's subtasks are listed in. `GET /work-items` lists tasks in
this order. A new task goes to the end; editing a task, or changing its status with `PATCH`, never
moves it. This is not the agent queue's order, which is separate.

| Method | Path                           | Body                                                                                            | Response           |
| ------ | ------------------------------ | ----------------------------------------------------------------------------------------------- | ------------------ |
| POST   | `/work-items/:workItemId/move` | Exactly one of `{ beforeId }`, `{ afterId }` or `{ position: "start" \| "end" }`, and `status?` | Updated work item. |

`beforeId` and `afterId` name another task of the project. `position` places the task at the start
or end of `status`, or of its own status when `status` is left out. With `status`, the task also
moves to that status, as `PATCH` would. Only this task's place changes, and its `updatedAt` stays.
There is no way to set the order directly: say where the task goes instead.

```json
POST /work-items/<id>/move
{ "beforeId": "<another task's id>", "status": "ready" }
```

### Won't do

A task nobody will do is closed as **won't do** instead of being marked done or deleted. It
keeps its status, moves to the project archive with `resolution: "wont-do"` and its reason, and
never counts as done: reports, burn-up, cumulative flow, throughput, cycle time, workload,
forecasts and milestone progress leave it out, as if it had never been in the plan. Every work
item carries `resolution` (`"wont-do"` or `null`) and `resolutionReason` (`""` when none).

| Method | Path                                | Body                                               | Response                                                   |
| ------ | ----------------------------------- | -------------------------------------------------- | ---------------------------------------------------------- |
| POST   | `/work-items/:workItemId/wont-do`   | `{ reason?, includeSubtasks?, cancelQueuedWork? }` | `{ workItem, closedIds, cancelledTask, repeatedAs? }`      |
| POST   | `/work-items/:workItemId/unarchive` | —                                                  | The task, reopened: resolution cleared, the status it had. |
| POST   | `/work-items/:workItemId/archive`   | —                                                  | The task, archived (finished work).                        |
| POST   | `/work-items/:workItemId/restore`   | —                                                  | The task, out of the recycle bin.                          |

- `reason` is one line, at most 500 characters.
- `includeSubtasks: true` closes the task's open subtasks (not done, at every depth) the same
  way, with the same reason, in the same write. `closedIds` lists the task first, then them.
- Refused (HTTP 400): a Done task (archive it instead), a task already won't do or archived,
  running agent work and work waiting for review. Queued agent work is refused too, unless
  `cancelQueuedWork: true`: then the queued run is cancelled first, by the same rule as
  deleting, and `cancelledTask` is `true`.
- A repeating task skips this occurrence: its next one is made as if it were done, and its id is
  `repeatedAs`.
- No rule runs: the task's status does not change.
- `POST /work-items/:workItemId/unarchive` reopens it, as **Bring back** and undo do in the app.

`GET /work-items?scope=archived` lists the archive, won't-do tasks included. To list only them,
filter on the resolution:

```json
{ "conditions": [{ "field": "resolution", "op": "is", "value": "wont-do" }] }
```

### Waits-on links: types and lag

A waits-on link has a **type** and a **lag**. Every work item carries `dependencyIds`
(the tasks it waits on) and `dependencyLinks`, the same links in the same order as
`{ id, type, lagDays }`:

| `type`             | The task is too early when                                         |
| ------------------ | ------------------------------------------------------------------ |
| `finish-to-start`  | it starts before the other's `targetDate` plus `lagDays`           |
| `start-to-start`   | it starts before the other's first day plus `lagDays`              |
| `finish-to-finish` | its `targetDate` is before the other's `targetDate` plus `lagDays` |

A task starts on its `startDate`, or its `targetDate` when it has none. `lagDays` is a whole number
of calendar days from -365 to 365; a negative lag is a lead ("start 2 days before it is due").

- Send `dependencyLinks: [{ id, type?, lagDays? }]` on `POST` or `PATCH /work-items` to set every
  link at once; a type left out is `finish-to-start` and a lag left out is 0. An unknown type or a
  lag out of range is refused with HTTP 400.
- `dependencyIds` still works as before. On its own, a new id is `finish-to-start` with no lag, and
  an id the task already waited on keeps its type and lag.
- Only `finish-to-start` links hold a task back from Ready and the agent queue. The other types are
  about dates only: conflicts, `moveDependents` and the critical path.
- A batch row's `dependencyRefs` are `finish-to-start`, 0 days.

```json
{ "dependencyLinks": [{ "id": "<plastering-id>", "type": "start-to-start", "lagDays": 2 }] }
```

### Links between tasks

Besides waits-on (`dependencyIds`), a task can be linked to another task of the same project as
**relates to**, **duplicates** or **copied from**. These links never move dates, raise conflicts,
change the critical path or readiness, or hold agents back: they are stored apart from waits-on
and are not part of a work item. Read them with their own route.

| Method | Path                                    | Body                                | Response                            |
| ------ | --------------------------------------- | ----------------------------------- | ----------------------------------- |
| GET    | `/work-items/:workItemId/links`         | —                                   | The task's links, from its end.     |
| POST   | `/work-items/:workItemId/links`         | `{ toWorkItemId, kind }`            | The link, from this task's end.     |
| DELETE | `/work-items/:workItemId/links/:linkId` | —                                   | `{ id, deleted: true }`             |
| POST   | `/work-items/:workItemId/duplicate-of`  | `{ originalId, cancelQueuedWork? }` | `{ workItem, link, cancelledTask }` |
| POST   | `/work-items/:workItemId/copy`          | —                                   | `{ workItem, link }`                |

- `kind` is `relates`, `duplicates` (this task is a duplicate of `toWorkItemId`) or `copied-from`
  (this task was copied from it).
- Each link has `role`, how it reads from the task you asked about: `relates`, `duplicate-of` or
  `duplicated-by`, `copied-from` or `copied-to`, with the other task's `otherWorkItemId`,
  `otherTitle`, `otherStatus` and `otherClosed` (archived, won't do or in the recycle bin).
- Refused (HTTP 400): a link to itself, to another project's task or one in the recycle bin, an
  unknown kind, and a pair that already has that kind of link, whichever way round.
- Adding and removing a link writes an activity entry on both tasks. Deleting either task for good
  removes it.
- `duplicate-of` adds a `duplicates` link and closes the task as won't do with the reason
  "Duplicate of <title>", by the rule above, so every won't-do refusal applies, and nothing
  changes when one does. Undo: `POST /work-items/:workItemId/unarchive` and delete the link.
- `copy` makes a task in Backlog, at the end of the order, with the title followed by "(copy)",
  the description, checklist (unticked), labels, priority, estimate, assignee, start, due and
  show-from dates, milestone, iteration and custom field values, and a `copied-from` link back.
  Comments, activity, attachments, waits-on, subtasks and agent links stay behind. It is a create,
  so rules see it as one.
- The project file carries links between tasks it contains; a link to a task left out is dropped.

### Links in text

A link to an item is ordinary Markdown in a task's description, a comment, a decision's text
fields or a Library item's summary or body: `[words](ostler://<kind>/<projectId>/<id>)`,
the item's deep link, with `<kind>` one of `task`, `milestone`, `decision` or `library`. Writing a
link is writing text through the usual routes; the app shows it with the item's current title, and
keeps an index of what links to what as each text is saved.

| Method | Path                    | Body | Response                                                                                                        |
| ------ | ----------------------- | ---- | --------------------------------------------------------------------------------------------------------------- |
| GET    | `/links?to=<kind>:<id>` | —    | `Array<{ sourceKind: "task" \| "comment" \| "decision" \| "library", sourceId, projectId, title, workItemId }>` |

`?include=linkedFrom` on `GET /work-items`, `GET /milestones`, `GET /library` and
`GET /library/:itemId` adds the same list to each item as `linkedFrom`, read for the whole list at
once. There is no decision route; ask `GET /links?to=decision:<id>`.

- Only texts in this project are listed: a link to another project's item still opens in the app,
  but is not indexed. Asking about an item of another project is HTTP 400.
- A deleted comment and a task in the recycle bin (with its comments) are left out.
- For a comment, `title` is its task's title and `workItemId` its task.
- A project file carries links as written, with the ids its items had (`linkIds`); importing it as
  a new project points links between its own items at the new ones.

**Task IDs in text.** A task's ID written as words (`SHOP-12`), or as a link's target
(`[the review](SHOP-12)`), is drawn as a link to the task in the app, as long as it is one of this
project's tasks. The text stays as written.

**Files in the project's folder.** `[words](ostler://file/<projectId>/<path>)` links a file or folder
in the project's linked folder, with the path relative to it and each part percent-encoded
(`ostler://file/<projectId>/docs/story%20review.md`). A path written relative to the project
(`[plan](docs/plan.md)`) works the same way. Clicking it in the app opens documents and pictures
(Markdown, text, JSON, YAML, CSV, PDF, PNG and the like) in their program and folders in Explorer;
any other file is shown in Explorer, never run. A link can't reach outside the folder: no leading
`/`, drive, `..` or backslash, and shortcuts that lead out are refused. Other links such as `/risk`
or `#top` do nothing.

**Links to this computer.** `http://localhost:…`, `http://127.0.0.1:…`, `*.localhost`, `0.0.0.0` and
`[::1]` addresses lead to a server on the machine that wrote them, which the person reading the task
can't open. In descriptions and comments written through the API they are kept as inline code, not
links: `[Risk](http://localhost:8513/risk)` is stored as ``Risk (`http://localhost:8513/risk`)``.
Name the screen in words, or link a file in the folder instead.

### Description history

| Method | Path                                           | Body | Response                           |
| ------ | ---------------------------------------------- | ---- | ---------------------------------- |
| GET    | `/work-items/:workItemId/description-versions` | —    | The task's versions, newest first. |

- Each version is `{ id, projectId, workItemId, text, actor: { kind, personId, name, ruleName? },
startedAt, endedAt }`: `text` is what the description said before a sitting of changes began.
- Changes by the same actor within five minutes of the last one are one sitting, and one version.
  A change by another actor, or after a longer pause, starts a new one. Every surface's change
  counts, this API's `PATCH` included.
- The newest 50 versions are kept per task. A task in the recycle bin keeps them; deleting it for
  good removes them. They are not in CSV, the project file or templates.
- To restore a version, `PATCH /work-items/:workItemId` with `{ description: <its text> }`. It is a
  change of its own, so the text it replaces becomes a version too.

### Creating a plan in one call

`POST /work-items/batch` creates a whole plan the way the plan grid does: its tasks, their subtasks,
what each waits on, and the milestone they belong to. Every task obeys the same rules as
`POST /work-items`, with the same words in the refusal. The batch is one transaction: a refused task
creates nothing, and the 400 answer names the task (`items[2]: The start date is after the due
date`).

A task names the other tasks of the plan by `ref`, a short name of letters, digits, `-` or `_`:

- `parentRef` makes the task a subtask of that task. A subtask without a milestone of its own takes
  its parent's.
- `dependencyRefs` lists the tasks it waits on. A subtask may only wait on its siblings in the same
  phase, as the app enforces.
- `milestoneRef` names a milestone given to the batch. A task can also use `milestoneId`, and
  `dependencyIds` and `parentWorkItemId` name existing tasks of this project.

```json
{
  "items": [
    { "ref": "design", "title": "Design the checklist", "targetDate": "2026-09-20" },
    { "ref": "build", "title": "Build the checklist", "dependencyRefs": ["design"], "estimate": 5 },
    { "ref": "tests", "title": "Write the tests", "parentRef": "build" }
  ]
}
```

Check a plan before creating it with `?dryRun=1`: nothing is written, and each refused task is
listed with its `index` and `field` (`dueDate`, `dependencyIds` or `parentWorkItemId`, the cell it
belongs to) and its message.
| DELETE | `/work-items/:workItemId` | — | `{ id, deleted: true }`. Permanent. Refused while agent work linked to it is active or queued (cancel that task first); a cancelled task's link is cleared and the item is deleted. |

**Deleting is permanent and there is no undo.** Only delete when the human has asked
you to. To take a goal or milestone out of the way without losing it, `PATCH` its
`status` to `"archived"` instead. Delete children before parents: a goal needs its
milestones gone (or reassigned) first, and a milestone needs its work items gone (or
reassigned) first. These are the same rules the desktop app applies.

`planFirst` (`"default"`, `"yes"` or `"no"`; `"default"` when left out) says whether an agent on
the task sends a plan and waits for approval before it changes anything; `"default"` follows the
project's `agentsPlanFirst` (`/auto-dispatch`). It is read when the task is queued, so set it
before `POST /tasks`; `PATCH` takes it too. See [Plan first](agents.md#plan-first).

`autoQueue: true` does **not** enqueue anything by itself. It only marks the item as
eligible for the auto-dispatcher, which is disabled by default per project; with
auto-dispatch off, setting it has no observable effect at all.

Work items and harness tasks are independent. **To get work executed you must create
the harness task explicitly**, and the work item must be `ready` first — `POST /tasks`
rejects anything else with _"Only Ready work can be queued for an agent"_, and
`POST /work-items` defaults new items to `backlog`. The reliable sequence is:

```
POST  /work-items                      -> { id }          (status defaults to backlog)
PATCH /work-items/<id>  { "status": "ready" }
POST  /tasks            { "title": ..., "workItemId": "<id>" }
POST  /tasks/<taskId>/start-embedded                      (optional: run it now)
```

A work item whose dependencies are not done yet can still be queued. Its task waits in
the queue (`waitingOnDependencies` on `GET /tasks` says how many are outstanding) and
is not handed to an agent until every dependency's work has been **applied**. A dependency
that is only awaiting review does not count. So you can queue a whole plan at once.

A queued task always runs the work item's **current** title, description and acceptance
criteria. Editing the item before an agent claims the task is enough; there is no need
to cancel and re-queue.

Moving a queued work item follows the app's rule, on `PATCH /work-items/:workItemId` and on
`POST /work-items/:workItemId/move` alike. While no agent has claimed its task, `status: "blocked"`
holds the task and `status: "ready"` releases it (the stored status is left to the run); any other
status, `someday: true`, or a `showFrom` later than today cancels the task and clears the item's
link, and the returned item has `leftQueue: true`. To undo, set the old values back and queue it
again with `POST /tasks`. While an agent is running it, or its work waits for review, the change is
refused with a 400 and its reason.

Each run has a 30-minute ceiling. Ostler does not wait that long for a stuck agent: a
tool call still running a minute past its own timeout (or 5 minutes, if it set none), or
10 minutes with no sign of life, is aborted, and the agent is told to carry on.
`GET /sessions` shows this on `embeddedRuntime`: `lastProgressAt`, `stall` while it is
stuck, and `stallAborts`. A session that does not recover, or that runs out of time, is
ended with its unsaved work kept in its copy. It is left in review for you to apply,
send back or discard.

### Dates, assignee, estimate and checklist

- `targetDate` is the due date and `startDate` the start date. Both are calendar days,
  `YYYY-MM-DD`, with no time zone. A start date after the due date is refused with
  _"The start date is after the due date"_.
- `showFrom` is the first day the task can be acted on, `YYYY-MM-DD`, or `null`. Until then
  the task is hidden: it stays off Home's Today and Upcoming, My work, the Board and the
  List (the Calendar and the Timeline still show it). On that day it joins Today, marked
  "New today".
- `someday: true` moves the task to Someday, and `false` brings it back. Someday is a flag,
  not a status: the task keeps its status, and is hidden like a task shown from a later day.
  Anything but `true` or `false` is refused.
- `impact` and `effort` score an idea (a task in Someday): each a whole number from 1 to 5, or
  `null` for none. Anything else, such as `0`, `6`, `2.5` or `"high"`, is refused with
  _"Impact must be a whole number from 1 to 5, or empty"_ (or Effort). A PATCH that leaves them
  out keeps them; `null` clears one. The app's Someday view sorts ideas "best first" (impact high
  to low, then effort low to high) and calls impact 4 or 5 with effort 1 or 2 a quick win.
  Closing an idea with `POST /work-items/:workItemId/wont-do` keeps `someday: true` and its
  scores, so `POST /work-items/:workItemId/unarchive` puts it back in Someday.
- `triage: true` on create makes the task a quick capture: when the project has
  Triage new captures on (`GET /triage`), it waits in To triage with `inTriage: true` and
  `capturedBy: "api"`; with the setting off it is an ordinary task. See [Triage](#triage).
- Auto-queue never picks up a hidden task, and queueing one for an agent is refused with
  _"Bring it back from Someday first"_ or _"It is hidden until 1 March"_. Reminders still
  fire.
- `assigneeId` is a person's `id` from `GET /people`, or `null`. An unknown id is refused
  with _"That person does not exist"_. Archived people keep the work assigned to them.
- `estimate` is a number from 0 to 1000, or `null`, counted in the project's unit
  (points or hours, chosen in the project's settings).
- The checklist is the item's `acceptanceCriteria`. `checkedCriteria` lists the ones
  that are ticked; it is read-only here. Tick one with
  `POST /work-items/:workItemId/checklist` and `{ "text": "<the exact item>", "checked": true }`.
  Ticking never moves the item to another column. When a `PATCH` changes
  `acceptanceCriteria`, the tick, due date and person of every item whose text is gone are
  dropped with it. To change an item's text and keep them, rename it with `renameTo` (below).
- A checklist item can have a due date and a person. `checklistDetails` lists the items that
  have either, in checklist order: `[{ "text", "dueDate", "assigneeId" }]`; it is read-only
  here. Set them with `POST /work-items/:workItemId/checklist` and `dueDate` (`YYYY-MM-DD`, or
  `null` to clear) and `assigneeId` (a person's `id`, or `null`). A dated item shows on its
  person's Home and My work, whoever the task belongs to; a dated item for nobody counts on
  Today as an unassigned task does.
- Items are keyed by their text: two items with the same text are one item. Renaming an item
  to the text of another one is refused.
- Agents always receive every checklist item as an acceptance criterion, ticked or not, and
  without dates or people.

These are the same rules the desktop app applies, enforced in one place.

| Method | Path                                | Body                                                   | Response           |
| ------ | ----------------------------------- | ------------------------------------------------------ | ------------------ |
| POST   | `/work-items/:workItemId/checklist` | `{ text, checked?, dueDate?, assigneeId?, renameTo? }` | Updated work item. |

`text` names the item. Send at least one of the others; they apply in one transaction, the
rename first, so `{ "text": "Book caterer", "renameTo": "Confirm caterer", "dueDate":
"2026-10-23" }` renames the item and dates it.

### Triage

| Method | Path                             | Body                                                                      | Response                                   |
| ------ | -------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------ |
| POST   | `/work-items/:workItemId/accept` | `{ status?, priority?, assigneeId?, labels?, targetDate?, milestoneId? }` | The task, out of To triage.                |
| POST   | `/work-items/:workItemId/move`   | `{ projectId }`                                                           | `{ workItem, movedFromId, copiedItemIds }` |

A task waiting in To triage has `inTriage: true` and `capturedBy` (`quick-add`, `snip`,
`text` or `api`). It counts nowhere until a decision: no rule, view, report, reminder from its due
date or agent sees it. `GET /work-items` still lists it; `?scope=triage` lists only them, oldest
first, and the `inTriage` filter finds them.

- `accept` sets the given fields and takes it out of To triage, in the Backlog unless `status`
  says otherwise. Any other field, or a task not in To triage, is HTTP 400.
- `move` with `projectId` makes it again in that project, with the labels that project has, and
  its attachments copied to that project's Library, then puts the original in the recycle bin,
  all or nothing. It follows that project's setting: with Triage new captures on it waits in that
  project's To triage (`inTriage: true`); with it off it is an ordinary task in its Backlog
  (`inTriage: false`). Without `projectId`, `move` reorders as above.
- Someday (`PATCH` with `someday: true`), `wont-do` and marking a duplicate take it out too.
- [`GET`/`PUT /triage`](reports-settings-conventions.md#triage) reads and sets the setting.

### Rules

Every create, update, move and checklist tick through this API sets off the project's
[rules](rules.md) as the same change in the app does, in the same transaction. When rules did
something, the returned work item has `ruleRun: { id, ruleNames }`; a later `PATCH` that puts
the old values back can send `undoRuleRun: <id>` to undo what the rules did too.

### Move what waits on it

`PATCH /work-items/:workItemId` takes `moveDependents`, as the app's **Move what waits on it** does:

```json
{ "targetDate": "2026-10-20", "moveDependents": true }
```

- `true`: when the change moves the due date later by N days, every task that waits on this one and
  would now start before it is due (a task starts on its `startDate`, or its `targetDate` without
  one; starting on the day it is due is fine) moves later by N days, keeping its start-to-due gap.
  When that puts its first day on a day Me does not work (`workingDays` in
  [People](people-and-templates.md); Monday to Friday when unknown; Me's days off and everyone's
  count too), it moves on to the next working day. Then the tasks waiting on those are asked the same, each task once. Done tasks and tasks
  without a due date never move. Moving a task earlier moves nothing else. All of it happens in the
  same transaction as the change, each task through the same update. The answer is
  `{ workItem, dependents: { changed, skipped, left } }`: `changed` lists
  `{ id, fromDue, toDue, fromStart, toStart }`, `skipped` tasks that changed while the plan was made
  (never overwritten), and `left` the done (`reason: "done"`) and undated (`"undated"`) tasks. To
  undo, `PATCH` each changed task back to its `fromDue` and `fromStart`.
- `"preview"`: changes nothing, not even this task, and answers the plan for the change as sent:
  `{ entries, skipped }`, each entry `{ id, title, dependencyId, days, fromDue, toDue, fromStart,
toStart }` (`dependencyId` is the moved task that pushed it), and `skipped` the done and undated
  tasks.

Without `moveDependents` (or with `false`), `PATCH` answers the updated task as before.

### Reschedule overdue tasks

`POST /reschedule/preview` plans new due dates for overdue tasks and changes nothing;
`POST /reschedule/apply` takes the same body, plans the same way, and applies the plan. Both use the
app's own rule (**Reschedule…** on Home and My work), for this token's project only.

```json
{ "mode": "spread", "days": 5 }
```

- `mode`: `today`, `tomorrow`, `date` (with `date`, `YYYY-MM-DD`) or `spread`.
- `days`: for `spread`, the working days to fill from tomorrow, 1 to 30 (default 5). Tasks go
  highest priority first, then the oldest due date; each day fills up to Me's daily hours (their
  `weeklyCapacityHours` over their `workingDays`, see [People](people-and-templates.md)), counting
  Me's work already due that day. A task with no hour estimate, or in a points project, counts as
  one hour; without a capacity a day takes three tasks; what does not fit goes on the last day.
- `workItemIds`: the tasks to move (live, not done, with a due date). Left out: the project's
  overdue tasks assigned to Me or to nobody, as Home's Today counts them.
- `today`: the date that counts as today; the computer's local date by default.

The preview answers `{ mode, days, entries }`. Each entry has `id`, `title`, `fromDue`, `toDue`,
`fromStart`, `toStart` (a start date moves with its due date, keeping the gap), `recurring` (the
occurrence moves; the repeat rule does not change) and `warnings`: each a task that would now start
before something it waits on is due (`taskId`, `taskTitle`, `dependencyId`, `dependencyTitle`,
`start`, `dependencyDue`). The other task is not moved.

Apply changes every task in one transaction, each through the same update as
`PATCH /work-items/:workItemId`, so activity, reminders, search, repeats and rules see it. It
answers `{ changed, skipped }`: `changed` lists `{ id, fromDue, toDue, fromStart, toStart }`, and
`skipped` the tasks whose dates changed while the plan was made (`reason: "changed"`), which are
never overwritten. To undo, `PATCH` each changed task back to its `fromDue` and `fromStart`.

### Find and replace

`POST /find-replace/preview` finds a text in this project's task titles, descriptions and checklist
items and changes nothing; `POST /find-replace/apply` takes the same body plus `matchIds`, finds the
same way, and replaces the matches it names. Both use the app's own rule (**Find and replace**).
Comments, the Library, decisions, milestones and goals are never searched or changed.

```json
{ "find": "Acme", "replace": "Apex", "wholeWords": true, "matchIds": ["<match-id>"] }
```

- `find`: plain text, never a pattern (`a.b` finds only `a.b`), up to 500 characters.
- `replace`: the new text; it may be empty.
- `matchCase`, `wholeWords`: `false` by default. A whole word has no letter, digit or `_` either
  side.
- `includeArchived`: also search archived tasks. Tasks in the recycle bin are never searched.

The preview answers `{ matches, taskCount, truncated }` (at most 5,000 matches; `truncated` says
there were more). Each match has an `id`, `taskId`, `taskTitle`, `archived`, `field` (`title`,
`description` or `checklist`, with `itemIndex` for a checklist item), `start` and `text` (where it
is and what it matched), and `before` and `after`, the text around it (`cutBefore` and `cutAfter`
say it was cut). A match whose replacement would break a rule has a `problem` and is never applied:
`titleEmpty`, `titleTooLong`, `descriptionTooLong`, `checklistEmpty`, `checklistTooLong`, or
`checklistDuplicate` (two checklist items with one text would merge, because a tick is kept by its
item's text).

Apply changes every task in one transaction, each through the same update as
`PATCH /work-items/:workItemId`, so activity, search, reminders and rules see it. A checklist item
whose text changes keeps its tick. It answers `{ changed, skipped }`: each change is
`{ id, from, to, renamed }`, where `from` and `to` hold the task's `title`, `description` and
`acceptanceCriteria`. A match id no longer found (the task changed since the preview) is skipped
with `reason: "changed"`, and a task whose new text would break a rule with `reason: "invalid"`;
neither is overwritten. To undo, `PATCH` each changed task's `title`, `description` and
`acceptanceCriteria` back to its `from` values.

### My day

My day is the short, ordered list a person picks to work on each day with **Plan my day** on Home.
It is personal and spans projects; a project token sees and changes only its own project's tasks in
it. `date` is the person's local date, `YYYY-MM-DD`; every route defaults to the computer's local
date.

- `GET /my-day?date=2026-10-16` lists the project's tasks in that day's list, in the person's order,
  each with `id`, `title`, `status`, `priority`, `targetDate`, `assigneeId`, `estimate` and
  `estimateUnit`. Done tasks stay until the day ends; archived, binned, Won't do and hidden tasks
  (Someday, or shown from a later date) are left out.
- `POST /my-day` with `{ "workItemId": "…", "date": "2026-10-16" }` adds a task at the end, or
  before or after another of the project's tasks in that day's list with `beforeId` or `afterId`.
  A task is in a day's list once: adding it again changes nothing and answers `already: true`. A
  hidden task is brought back first, through the same update as `PATCH /work-items/:workItemId`,
  and `broughtBack` says which (`"someday"` or `"later"`). With `"move": true` and `beforeId` or
  `afterId`, a task already in the list moves instead. Moving in My day never changes the task's
  place in the manual order.
- `DELETE /my-day/:workItemId?date=2026-10-16` takes a task out of that day's list and answers
  `{ removed }`. The task itself does not change.

### Time blocks

A time block is time the person put aside for a task in the Calendar's Week ("Tuesday 9 to 11:
write the proposal"). It is a plan, never a time entry: blocks do not log time, and the timer never
changes a block. A block has a local `date` (`YYYY-MM-DD`), a `startMinute` (minutes after local
midnight, on a quarter hour, 0 to 1425) and a `lengthMinutes` (whole quarter hours, ending by
midnight), so a 09:00 block stays at 09:00 across a clock change. A task can have several blocks.
Blocks are personal planning: they do not travel in the project file or templates, and a project
token sees and changes only its own project's blocks. Blocks of a task in the bin or archived are
left out; deleting the task for good removes them.

- `GET /time-blocks?from=2026-10-19&to=2026-10-25` lists the project's blocks in that range (at
  most 400 days) in time order, each with `id`, `workItemId`, `date`, `startMinute`,
  `lengthMinutes`, `createdAt`, and the task's `title` and `status`. `workItemId=` keeps one task's.
- `POST /time-blocks` with `{ "workItemId": "…", "date": "2026-10-20", "startMinute": 540 }` blocks
  time and answers `201` with the block. Without `lengthMinutes`, it is as long as the task's
  estimate in hours (an hour in a points project or with no estimate), cut at midnight. Blocking
  time never changes the task's dates and never adds it to My day.
- `GET /time-blocks/:blockId` answers with one block of this project. An unknown id, or another
  project's, is HTTP 400.
- `PATCH /time-blocks/:blockId` with any of `date`, `startMinute` and `lengthMinutes` moves a block
  or changes its length; a move without a length keeps it, cut at midnight.
- `DELETE /time-blocks/:blockId` removes a block and answers with it. The task does not change.

`GET /export?format=ics&blocks=true` adds the blocks to the calendar file
([Import and export](import-and-export.md)).

#### Blocks that move

The app's **Move to the next free time** and **Fill my day** use the same rule for free time:
Working hours on Me's working days (`GET /people`; Monday to Friday when unknown), not on a day
off, minus every enabled project's blocks and the timed events of shown outside calendars (all-day
events take no time). "Now" is the computer's clock, rounded up to the next quarter hour. Nothing
moves a block by itself; each of these routes runs only when called. Answers give block times only,
never the events that were avoided, and never another project's blocks.

- `POST /time-blocks/:blockId/move-to-free` moves the block to the first free stretch from now, at
  most 14 days ahead, that is as long as it is, and answers
  `{ "moved": true, "from": { "date", "startMinute", "lengthMinutes" }, "to": { … }, "block": { … } }`.
  With `?dryRun=1` nothing moves (`moved` is false, `block` null) and `to` says where it would go.
  `to` is null, and nothing moves, when no time is free.
- `POST /time-blocks/fill` with `{ "date": "2026-10-20", "dryRun": true }` places this project's My
  day entries for that date (the computer's local date when left out) that are not done, in My day's
  order: each for its estimate in hours less what is already blocked for it that day (an hour with
  no hour estimate), from now or the start of Working hours. A task that no free stretch holds whole
  is split into pieces of at least 30 minutes. The answer is
  `{ "placed": false, "plan": { "date", "now", "closed", "pieces", "notPlaced", "alreadyBlocked" }, "blocks": [] }`:
  each piece has `workItemId`, `title`, `date`, `startMinute`, `lengthMinutes`, `part` and `parts`;
  `notPlaced` lists the tasks that did not fit with the minutes they needed; `closed` is
  `{ "kind": "dayOff", "name" }` or `{ "kind": "notWorking" }` when nothing can be placed that day.
  Without `dryRun` (or `?dryRun=1`) the plan's blocks are made in one transaction and listed in
  `blocks`; remove them with `DELETE /time-blocks/:blockId`.

### Priority matrix

The app's **Matrix** view sorts a project's open tasks into four boxes from their priority and due
date. `GET /matrix?date=2026-10-16` returns the same boxes, from the same code:

```json
{
  "ok": true,
  "value": {
    "date": "2026-10-16",
    "urgentWithinDays": 3,
    "boxes": { "urgentImportant": ["…"], "important": [], "urgent": [], "neither": ["…"] }
  }
}
```

- A task is **important** when its priority is `high` or `critical`, and **urgent** when it is
  overdue or due within three days of `date` (today plus three). A task with no due date is never
  urgent. `date` is the person's local date and defaults to the computer's.
- The tasks are the ones the Board shows: live, open (not `done` or Won't do), and not hidden
  (Someday, or shown from a later date).
- Each box lists task ids in the view's order: due date (undated last), then priority, then title.
- To move a task up or down, change its priority with `PATCH /work-items/:workItemId`: the app sets
  `high` when a card goes into an important box and `medium` when it leaves one. Urgency comes from
  the due date, so to move a task across, change its `targetDate`.

### Repeat and reminders

A task can **repeat**. Its rule lives on the latest occurrence. When a repeating task
moves to `done` (through this API or the app), Ostler creates its next occurrence once, in
the same write: due on the first rule date after the old due date that is today or later
(a task with no due date counts from today), with the start date moved by the same number
of days. The next occurrence copies the title, description, priority, labels, assignee,
estimate, checklist (unticked) and milestone (unless that milestone is complete). It does
not copy dependencies, agent links, subtasks, comments or attachments. The rule moves to
the new task and both tasks' activity says "Repeated as …". Moving the done task back and
to done again does not make a second one. The `PATCH` that made it done returns
`repeatedAs` (the new task's id), or `repeatError` if the next task could not be made; the
status change stands either way.

A rule is `{ every: "day" | "week" | "month" | "year", interval, weekdays?, monthDay? }`:
`interval` is 1 to 99; `weekdays` (weekly only) are 0 (Sunday) to 6 (Saturday) and default
to the due date's weekday; `monthDay` (monthly or yearly) is 1 to 31 and lands on the last
day of a shorter month. It ends on `endsOn` (`YYYY-MM-DD`) or after `remaining` further
occurrences, not both; leave both out to repeat forever.

A repeat can **take turns**: `rotation` is up to 50 person ids (from `GET /people`), each once,
in order, and `nextIndex` is whose turn is next. Each new occurrence, whether the last one was
done or closed as won't do, goes to the next person in `rotation` who is not archived, instead
of copying the assignee, and `nextIndex` moves on; the rotation moves with the repeat to the new
occurrence. If everyone in it is archived, the assignee is copied and the activity says why.
Changing a task's assignee by hand does not change whose turn is next. Send `rotation: null` (or
`[]`) to stop taking turns. Leave `nextIndex` out to keep the person who was next as next (if
you took them out, the person after them).

**Reminders** fire as Windows notifications and Inbox items, only while Ostler is running.
`due` reminders are planned from the due date by Settings › Notifications ("Remind me about
due tasks" and its time) and kept in step with the due date; `custom` ones are added here or
with "Remind me…" in the app. Done, archived and deleted tasks have no pending reminders.

A custom reminder can **keep reminding** (`keepReminding: true`): after it fires, its
notification comes back every `intervalMinutes` (5, 15, 30 or 60; Settings › Notifications'
default, 15 unless changed, when left out) until the task is done, archived or deleted, the
reminder is snoozed (it starts again from the snooze time), it is stopped with `.../stop`, or
local midnight on the day it fired, when the Inbox calls it missed. Quiet hours hold a repeat
until they end, and a person who turned reminder notifications off gets none. A repeat is not a
new Inbox item. Due-date reminders do not keep reminding. Stopping a reminder that does not keep
reminding is refused.

| Method | Path                                                 | Body                                                                 | Response                                                                                                                                    |
| ------ | ---------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/work-items/:workItemId/recurrence`                 | —                                                                    | `{ workItemId, projectId, rule, endsOn, remaining, rotation, nextIndex, goToAgents }` or null.                                              |
| POST   | `/work-items/:workItemId/recurrence`                 | `{ rule, endsOn?, remaining?, rotation?, nextIndex?, goToAgents? }`  | The task's repeat, set or replaced.                                                                                                         |
| DELETE | `/work-items/:workItemId/recurrence`                 | —                                                                    | null: the task no longer repeats.                                                                                                           |
| GET    | `/work-items/:workItemId/reminders`                  | —                                                                    | Pending reminders `{ id, remindAt, kind, keepReminding, intervalMinutes, stoppedAt, … }`, soonest first, then any that keeps reminding now. |
| POST   | `/work-items/:workItemId/reminders`                  | `{ remindAt, keepReminding?, intervalMinutes? }` (ISO or ms, future) | The new custom reminder.                                                                                                                    |
| POST   | `/work-items/:workItemId/reminders/:reminderId/stop` | —                                                                    | The reminder, with `stoppedAt`: it does not come back.                                                                                      |
| DELETE | `/work-items/:workItemId/reminders/:reminderId`      | —                                                                    | `{ id, deleted: true }`.                                                                                                                    |

**Go to agents when it comes round**: with `goToAgents: true`, each occurrence is queued
for agents once, on its start date (or its due date when it has none), checked when Ostler starts
and every hour; a backlog occurrence moves to ready first. A day missed while Ostler was closed is
caught up once. `goToAgents` and the task's `planFirst` move with the rule to each new occurrence;
left out of a POST, `goToAgents` stays as it was. A task carries `scheduledQueue: { outcome, at,
note? }` once its schedule has acted: `queued`, or why not (`agentsOff`, `noFolder`,
`alreadyQueued`, or `refused` with the reason in `note`). A task that was not queued stays an
ordinary task and is never queued later by itself; queue it with `POST /tasks`, or with **Queue it
now** on its Inbox note in the app ([Agents](agents.md#scheduled-tasks)).

The **Inbox** and **Home** are not on this API. Both are personal and cross-project, and
this API is scoped to one project and its token.

### Labels

Labels live on work items (`labels: string[]`). Each label in a project also has a
colour: one chosen in the app or here, or a stable default (`hasColor: false`).

| Method | Path              | Body                | Response                                                                     |
| ------ | ----------------- | ------------------- | ---------------------------------------------------------------------------- |
| GET    | `/labels`         | —                   | Array of `{ name, color, hasColor, taskCount }`, for live and archived work. |
| PATCH  | `/labels/:name`   | `{ name?, color? }` | The label. `name` renames it on every task in the project at once.           |
| DELETE | `/labels/:name`   | —                   | `{ name, color, workItemIds }`: what was removed from every task.            |
| POST   | `/labels/restore` | the DELETE response | Every label. Puts a deleted label back, with its colour (undo).              |

URL-encode a label name in the path (`/labels/ux%20design`). Colours are `#rrggbb`.

### Workstreams

A project can be split into workstreams (the code and the routes call them sub-projects): named
parts of one project, such as Hull and Sails. A task or milestone is in at most one, in
`subprojectId` (`null` for the top level of the project); set it on `POST /work-items`,
`PATCH /work-items/:workItemId`, `POST /milestones` and `PATCH /milestones/:milestoneId`. A
workstream of another project is refused. Each has a `name` (up to 80 characters), a
`description`, a `color` (`#rrggbb`; the project's colour when none is given), an `icon`, a
`leadId` (a person id or `null`), `memberIds` (person ids), a `status` (`planned`, `active`,
`paused` or `done`), `archivedAt` (`null` unless archived) and a `position` in the project's order.

| Method | Path                              | Body                                                                             | Response                                                                                    |
| ------ | --------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| GET    | `/subprojects`                    | —                                                                                | Array of workstreams, archived ones included, in the project's order.                       |
| POST   | `/subprojects`                    | `{ name, description?, color?, icon?, leadId?, memberIds?, status? }`            | The new workstream, at the end.                                                             |
| PATCH  | `/subprojects/:subprojectId`      | any of `{ name, description, color, icon, leadId, memberIds, status, archived }` | The workstream. `archived: true` archives it, `false` brings it back; its tasks stay in it. |
| POST   | `/subprojects/:subprojectId/move` | `{ direction }`                                                                  | Every workstream, in the new order. `direction` is `-1` (earlier) or `1` (later).           |
| DELETE | `/subprojects/:subprojectId`      | —                                                                                | The workstream that was deleted. Its tasks and milestones move to the top level.            |

Filter by workstream with the `subproject` field on `GET /work-items?filter=` (see
[Filtering](filtering-search-saved-views.md)).

### Task types

A project can name up to 20 kinds of task, such as Bug, Feature and Chore, or Errand and
Repair. A task has at most one, in `typeId` (`null` for none); set it on `POST /work-items`,
`PATCH /work-items/:workItemId` and in a batch row. Types are not labels: a task has one type and
many labels. Each type has a `name` (unique in the project, ignoring case, up to 40 characters),
an `icon` (a lucide icon name from the curated set `GET /help` lists), a `color` (`#rrggbb`) and
a `position` in the project's order.

Each type also has `fieldIds` and `templateId`. `fieldIds` lists the custom fields its
tasks show (ids from `GET /fields`, kept in the project's field order), or `null` for every field,
which is what a new type, and every type made before types had their own fields, has. Hiding a field never touches its
values. `templateId` names a task template (`GET /task-templates`) of this project or of every
project that new tasks of this type start from in the app's New task and quick add, or `null`.
Changing a task's type never applies a template. Deleting a field takes it off every type, and
deleting a template (or moving it to another project) clears it from the types that named it; the
project file and templates carry both, by field ref and template name.

| Method | Path                  | Body                                                 | Response                                                                                                         |
| ------ | --------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| GET    | `/task-types`         | —                                                    | Array of types, in the project's order.                                                                          |
| POST   | `/task-types`         | `{ name, icon?, color?, fieldIds?, templateId? }`    | The new type, at the end. A taken name, an unknown icon, a field or template it can't use, or a 21st is refused. |
| POST   | `/task-types/reorder` | `{ typeIds }`                                        | Every type, in the new order. `typeIds` names each type once.                                                    |
| PATCH  | `/task-types/:typeId` | any of `{ name, icon, color, fieldIds, templateId }` | The type.                                                                                                        |
| DELETE | `/task-types/:typeId` | —                                                    | `{ taskType, taskIds }`: the type and the tasks it was cleared from.                                             |
| POST   | `/task-types/restore` | the DELETE response                                  | The type, back, on the tasks that have no type now (undo).                                                       |

Filter by type with the `type` field on `GET /work-items?filter=` (see
[Filtering](filtering-search-saved-views.md)). A task's type travels in CSV (the `Type` column,
by name), the project file and templates. Agents, embedded and connected alike, read
"Type: Bug" in their task text.

### Custom fields

A project can have up to 20 custom fields of its own, for tasks only. A field has an
`id`, a `name` (the person's words, unique in the project), a `type` and, for `choice` and
`choices`, `options` of `{ id, name, color }` (at most 50). A field's type cannot change.

| Method | Path               | Body                                                           | Response                                               |
| ------ | ------------------ | -------------------------------------------------------------- | ------------------------------------------------------ |
| GET    | `/fields`          | —                                                              | Every field, in order.                                 |
| POST   | `/fields`          | `{ name, type, options?: [{ name, color? }], aiInstruction? }` | The new field.                                         |
| PATCH  | `/fields/:fieldId` | `{ name?, options?: [{ id?, name, color? }], aiInstruction? }` | The field. `options` is the whole new list, in order.  |
| POST   | `/fields/reorder`  | `{ fieldIds }`                                                 | Every field, in the new order.                         |
| DELETE | `/fields/:fieldId` | —                                                              | `{ field, values }`: the field and every value it had. |
| POST   | `/fields/restore`  | the DELETE response                                            | The field, with its values back on their tasks (undo). |

Keep an option by sending its `id` in `PATCH`: renaming it never touches values. An option
left out is removed and comes off every task.

A work item's values are in `fieldValues`, by field id; a field with no value has no key:

| Type       | Value                                 |
| ---------- | ------------------------------------- |
| `text`     | A string, up to 1000 characters       |
| `number`   | A number                              |
| `date`     | `YYYY-MM-DD`                          |
| `checkbox` | `true` (an unticked box has no value) |
| `choice`   | One option id                         |
| `choices`  | A list of option ids                  |

Set them with `fieldValues` on `POST /work-items` and `PATCH /work-items/:workItemId`. A
`PATCH` changes only the fields it names, and `null` clears one:

```json
{ "fieldValues": { "<size-field-id>": "<large-option-id>", "<cost-field-id>": null } }
```

A value the field does not take (text in a number field, an option the field does not
have, a field from another project) answers HTTP 400 and changes nothing. Filter by a field
with `field: "custom"` (see [Filtering](filtering-search-saved-views.md)). Coding agents are not
given field values.

#### AI fields

A `text` or `choice` field can be an AI field: its `aiInstruction` (up to 500 characters)
tells Ostler AI how to fill it, such as `"Which room is this for?"`. Every field has
`aiInstruction`, `null` for an ordinary field. Send it on `POST` or `PATCH /fields`; `null` or `""`
makes the field ordinary again, and its values stay. An instruction on any other type answers
HTTP 400.

Who filled each value is in the work item's `fieldFills`, by field id, one entry per value:

```json
{ "fieldFills": { "<room-field-id>": { "filledBy": "ostler-ai", "sourceHash": "3f9a0c21" } } }
```

`filledBy` is `"person"` or `"ostler-ai"`. For Ostler AI's, `sourceHash` is a short hash of the
task's title, description and checklist the value was filled from; when the task's text no longer
gives the same hash, the app says the value may be out of date. Any value written through this
API is the person's. Filling with Ostler AI happens in the app only, when the person asks: the API
has no route for it, as with every other Ostler AI feature.

### Columns

A project can name its Board's columns in its own words and hide Ready, Blocked or In review.
The names are for display only: every status value in this API, in task prompts and in
the harness stays the status id (`backlog`, `ready`, `active`, `blocked`, `review`, `done`).

| Method | Path       | Body                                                                                    | Response                     |
| ------ | ---------- | --------------------------------------------------------------------------------------- | ---------------------------- |
| GET    | `/columns` | —                                                                                       | `{ names, hidden }`          |
| PATCH  | `/columns` | `{ names?: { [status]: string \| null }, hidden?: ["ready" \| "blocked" \| "review"] }` | The new `{ names, hidden }`. |

`names` holds a display name by status id; a status not listed shows its standard word. A
`PATCH` changes only the names it sends, and `""` or `null` restores the standard word (up to
40 characters). `hidden` is the whole new list. Backlog, In progress and Done always show.
These answer HTTP 400 and change nothing:

- hiding a column that holds live tasks (neither archived nor in the recycle bin); the message
  says how many;
- hiding `ready` or `review` in a project with a folder: agents use them, and this API runs only
  while agents are on.

```json
{ "names": { "backlog": "To do", "active": "Doing" }, "hidden": ["blocked"] }
```

### Comments and activity

A task's **comments** are markdown notes (at most 10,000 characters). Comments written
through this API are by the automation API (`authorKind: "automation"`). Coding agents
have no comment routes: their rights stay their task text and its attachments.

| Method | Path                               | Body       | Response                                                                      |
| ------ | ---------------------------------- | ---------- | ----------------------------------------------------------------------------- |
| GET    | `/work-items/:workItemId/comments` | —          | Array of `{ id, workItemId, authorKind, authorPersonId, body, createdAt, … }` |
| POST   | `/work-items/:workItemId/comments` | `{ body }` | The new comment.                                                              |
| PATCH  | `/comments/:commentId`             | `{ body }` | The edited comment (`updatedAt` later than `createdAt`).                      |
| DELETE | `/comments/:commentId`             | —          | The comment, with `deletedAt`. It can be restored until its task is deleted.  |
| POST   | `/comments/:commentId/restore`     | —          | The comment again (undo).                                                     |
| GET    | `/work-items/:workItemId/activity` | —          | `{ entries, nextBefore }`: the task's history, newest first.                  |
| GET    | `/activity`                        | —          | `{ entries, nextBefore }`: the same across every task in the project.         |

An **activity** entry is `{ id, kind, workItemId, workItemTitle, at, actor, summary, comment?, field? }`.
`kind` is `comment`, `status`, `change` (one changed field) or `agent` (a step of an agent
run: queued, started, a question asked or answered, the report filed, the changes accepted,
discarded or sent back). `actor` is `{ kind, personId, name }`, with `kind` one of `human`,
`agent`, `ostler-ai`, `automation`, `system` or `unknown` (status changes recorded before
activity existed). `summary` is the sentence the app shows, such as "Alex changed the due
date from 3 Oct to 10 Oct".

Page with `?limit=` (1–100, default 25) and `?before=` set to the previous page's
`nextBefore`, which is null on the last page. On a task's activity, `?filter=comments` or
`?filter=changes` narrows it. Every change made through this API is recorded with the
actor `automation`.

### Since you were last here

`GET /briefing?since=<ms>` returns this project's part of Home's **Since you were last here**
card: what happened from `since` (a Unix time in milliseconds, required) until now, from Ostler's
own records. It is read only; any other method gets 405.

```json
{
  "since": 1760000000000,
  "until": 1760050400000,
  "project": {
    "projectId": "…",
    "projectName": "Website",
    "projectColor": "#3b82f6",
    "finished": [
      { "actor": "agent", "name": null, "count": 7, "tasks": [{ "id": "…", "title": "…" }] }
    ],
    "added": [{ "actor": "person", "name": "Alex", "count": 2, "tasks": [] }],
    "comments": { "count": 3, "tasks": [] },
    "overdue": { "count": 1, "tasks": [] },
    "reminders": { "count": 0, "tasks": [] },
    "runsFinished": { "count": 0, "tasks": [] },
    "runsInReview": { "count": 0, "tasks": [] },
    "questions": 0
  }
}
```

- `finished` and `added` are counted by who did it: `actor` is `person`, `agent`, `rule`,
  `import`, `automation`, `ostler-ai` or `system`, and `name` is the person's or rule's name. Each
  list holds at most five tasks; `count` is the total.
- `comments` counts comments; its `tasks` are the tasks they are on. `overdue` is tasks whose due
  date passed in the span and that are still open; `reminders` the reminders that went off.
- `runsFinished`, `runsInReview` and `questions` are filled in only while AI agents are on. A run's
  task `id` is null.
- `project` is null when nothing happened.

### Progress and your year

`GET /progress` and `GET /year-in-review` return this project's numbers behind Home's progress
card and the **Your year** page, counted by the same rule: a task counts once, at its latest move
to Done, if it is still Done, assigned to Me or to nobody, and not deleted or in the bin. Archived
tasks count; a task reopened since no longer does. A disabled project has nothing finished. Both
are read only; any other method gets 405.

`GET /progress?from=YYYY-MM-DD&to=YYYY-MM-DD` gives the tasks finished each week, from the week
holding `from` to the week holding `to` (both required, local days, at most ten years apart).
Only finishes from `from` to `to` count. `weekStart` is the first day of the week, `0` (Sunday) to
`6` (Saturday), Monday (`1`) by default.

```json
{
  "from": "2026-10-01",
  "to": "2026-10-17",
  "weekStart": 1,
  "weeks": [
    { "weekStart": "2026-09-28", "count": 0 },
    { "weekStart": "2026-10-05", "count": 2 },
    { "weekStart": "2026-10-12", "count": 1 }
  ]
}
```

`GET /year-in-review?year=2026` (with `weekStart` as above, for the busiest week) gives this
project's part of Your year:

- `months`: January to December, each `{ month, tasks, milestones, approximate }`. A milestone
  counts in the month it last became complete; `approximate` is true when one of them was complete
  before Ostler kept completion times, so its last change counts instead.
- `busiestWeek`: `{ weekStart, count }`, the week with the most tasks finished, or null.
- `projectsFinished`: the project, with `finishedOn`, when it has no open tasks left and its last
  task was finished that year.
- `topProjects`: the project and its count, when it finished anything that year.
- `time`: time tracked by Me or by no one, `{ byMonth (seconds, January first), byProject,
totalSeconds }`, or null when none was tracked.
- `years`: this year and every year with finished work, the newest first.

Fields `parentWorkItemId`, `taskCode`, `phaseCode`, `phaseName`, and verification
fields are **read-only** — Ostler manages them internally and ignores attempts to set
them through this API.

### Work item sources

A work item's **sources** are the library items it was written from, each at the
revision recorded when it was linked. When a source has since been edited,
`changedSince` is `true`. Sources are a record for the human. They don't change what
the agent is asked to do, which is always the work item's own text.

| Method | Path                                      | Body         | Response                                                            |
| ------ | ----------------------------------------- | ------------ | ------------------------------------------------------------------- |
| GET    | `/work-items/:workItemId/sources`         | —            | Array of `{ item, revisionAtLink, currentRevision, changedSince }`. |
| POST   | `/work-items/:workItemId/sources`         | `{ itemId }` | The work item's sources. Re-adding refreshes the revision.          |
| DELETE | `/work-items/:workItemId/sources/:itemId` | —            | The work item's sources.                                            |

### GitHub links

A work item can link up to 20 GitHub issues and pull requests. Each link is
`{ id, workItemId, owner, repo, number, kind: "issue" | "pull", url, title, state, fetchedAt }`,
where `title`, `state` (`open`, `closed`, `merged` or `draft`) and `fetchedAt` are the last
values read from `api.github.com`, or empty and `null` before the first fetch. Ostler only reads
from GitHub, with its saved GitHub token when there is one; the token is never returned. Nothing is
fetched except by `POST` here or the person's own action in the app.

| Method | Path                                           | Body            | Response                                                                                                                                                                       |
| ------ | ---------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET    | `/work-items/:workItemId/github-links`         | —               | Array of links, as last fetched. Asks GitHub nothing.                                                                                                                          |
| POST   | `/work-items/:workItemId/github-links`         | `{ reference }` | `{ link, problem }`: the link, then fetched once. `reference` is a github.com URL, `owner/repo#12`, or `#12` in the project's repository. `problem` says why the fetch failed. |
| POST   | `/work-items/:workItemId/github-links/refresh` | —               | `{ links, problems }`: every link fetched again; `problems` maps a link id to why it couldn't be. Stops at GitHub's rate limit.                                                |
| DELETE | `/work-items/:workItemId/github-links/:linkId` | —               | The removed link. Nothing changes on GitHub.                                                                                                                                   |

A duplicate link, a 21st link, a task in the recycle bin, another host or a reference that isn't an
issue or pull request is refused with `400` and a plain reason.

### Work item attachments

A work item can carry up to 6 library items **attached for its agent**. The task text
lists each one (kind, title, library id, summary), and every coding session can read
the files, read-only: an embedded session gets copies in its runtime folder, listed in
`OSTLER_TASK_ATTACHMENTS.md`; an external harness session lists and downloads them with
its own session token through `GET /tasks/:taskId/attachments` on the harness API. Attachments added here are recorded as `attachedBy: "automation"`;
the others are `human` and `ostler-ai`. **Human-only** and archived items can't be
attached, and an item that later becomes human-only or archived is skipped when a
session starts. The one human-only attachment is a screen snip a person attached with Snip to task
in the app: it is listed here, and skipped for agents like any human-only item.

| Method | Path                                          | Body                             | Response                                                                                                                     |
| ------ | --------------------------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/work-items/:workItemId/attachments`         | —                                | Array of `{ item, attachedBy, revisionAtAttach, currentRevision, changedSince, attachedAt }`.                                |
| POST   | `/work-items/:workItemId/attachments`         | `{ itemId }`                     | The work item's attachments. Re-attaching refreshes the revision.                                                            |
| POST   | `/work-items/:workItemId/attachments`         | `{ fileName, mimeType, base64 }` | Uploads the file to the Library (as `POST /library/upload`, up to 25 MB; a file it already holds is reused) and attaches it. |
| DELETE | `/work-items/:workItemId/attachments/:itemId` | —                                | The work item's attachments.                                                                                                 |
