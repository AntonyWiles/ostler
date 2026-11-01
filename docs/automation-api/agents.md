# Automation API: Agents, harness tasks and merging

Part of the [Ostler Automation API](README.md). Base path for all routes below: `<baseUrl>/automation/<projectId>`

## Discovery

| Method | Path                   | Auth            | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------ | ---------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/help`                | none            | Instructions and one line per route; `?route=<path>` for a route in full, `?full=1` for all.                                                                                                                                                                                                                                                                                                                                                         |
| GET    | `/automation/projects` | any valid token | Lists projects visible to that token, in the sidebar's order: `{id, name, enabled, hasFolder, automationTokenConfigured, areaId, icon, stage}[]`. `hasFolder` is false for a project that lives only in Ostler. `areaId` is the project's area (`GET /automation/areas`) or `null` for No area; `icon` is its icon id or `null`; `stage` is `planning`, `active`, `on-hold` or `done` (`GET`/`PUT /stage`). Note: no project ID segment in the path. |
| GET    | `/automation/areas`    | any valid token | Lists the areas that group projects, in their order: `{id, name}[]`. Areas are made, renamed, reordered and removed in the app only. Note: no project ID segment in the path.                                                                                                                                                                                                                                                                        |

## Status & reporting (read-only)

| Method | Path      | Response                                                                 |
| ------ | --------- | ------------------------------------------------------------------------ |
| GET    | `/status` | Harness queue counts, planning status counts/metrics, readiness reports. |
| GET    | `/report` | Full harness report.                                                     |
| GET    | `/tasks`  | Array of queued harness tasks.                                           |

## Run history and token limits (read-only)

| Method | Path           | Response                                                                                |
| ------ | -------------- | --------------------------------------------------------------------------------------- |
| GET    | `/agent-runs`  | Every run, newest first, with totals and a breakdown by model (`AgentRunHistory`).      |
| GET    | `/agent-usage` | The built-in agent's token limits and how much of each is used this day and this month. |

`/agent-runs` takes `?outcome=`, `?model=`, `?from=YYYY-MM-DD` and `?to=YYYY-MM-DD` (the local day a
run started), and `?format=csv` for the CSV the app's Export CSV writes. A run with
`usageReported: true` carries tokens a connected agent reported, not tokens Ostler measured. `cost` is
`null` unless the person entered prices for the model in Settings › Agents › Usage.

`/agent-usage` is read only: any other method gets `405`. Limits are a safety control the person
sets in Project settings › Agents. A run counts in the day and month it started; the day resets at
local midnight and the month on the first.

A connected agent may report its own usage when it completes a task, in the report:
`"usage": { "inputTokens": 1200, "outputTokens": 300, "model": "gpt-5" }`. It is optional and shown
as reported by the agent.

## Harness tasks (the execution queue)

| Method | Path                            | Body                                                                         | Response                                                                           |
| ------ | ------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| POST   | `/tasks`                        | `{ title, description?, details?, priority?, workItemId?, model?, effort? }` | Created task.                                                                      |
| POST   | `/tasks/reorder`                | `{ taskIds: string[] }` (or `orderedTaskIds`)                                | Reordered task list.                                                               |
| PATCH  | `/tasks/:taskId/priority`       | `{ priority }`                                                               | Updated task.                                                                      |
| POST   | `/tasks/:taskId/start-embedded` | none                                                                         | Starts the task now as an Ostler-managed embedded session.                         |
| POST   | `/tasks/:taskId/hold`           | `{ hold: boolean }`                                                          | Holds or resumes a queued task. A held task is never dispatched.                   |
| POST   | `/tasks/:taskId/cancel`         | none                                                                         | Cancels a queued task no agent is working on. `DELETE /tasks/:taskId` is an alias. |
| PATCH  | `/tasks/:taskId/model`          | `{ model?, effort? }`                                                        | Changes a queued task's run model (below). Refused once a run has it.              |

### Auto-dispatch and the project's agent settings

| Method | Path             | Body                | Response                                                                                                                                                                                                |
| ------ | ---------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/auto-dispatch` | —                   | `{ projectId, enabled, maxConcurrentEmbeddedSessions, aiOverrideEnabled, defaultProvider, defaultModel, defaultEffort, autoArchiveDoneAfterDays, agentsPlanFirst, reviewBeforeMe }`                     |
| PATCH  | `/auto-dispatch` | any of those fields | The settings after the change, saved as Project settings saves them. Queued work is looked at again at once, so turning `enabled` on starts it without waiting. Other fields (`projectId`) are ignored. |

- `enabled` runs queued tasks automatically with the built-in agent, at most
  `maxConcurrentEmbeddedSessions` at a time (`0` starts none, so set it to 1 or more with
  `enabled`). Off for a new project.
- `aiOverrideEnabled`, `defaultProvider`, `defaultModel` and `defaultEffort` are the project's own
  model for the built-in agent ([below](#choosing-the-model-for-a-run)).
- `autoArchiveDoneAfterDays` moves Done tasks to the archive after that many days untouched; `0` is
  off.
- `agentsPlanFirst` ([Plan first](#plan-first)) and `reviewBeforeMe` ([Reviews](#reviews)) are off
  unless turned on.
- A body with none of these fields is HTTP 400.

### Choosing the model for a run

The built-in agent runs a task with the run's own model, else the project's default
(`defaultProvider`, `defaultModel` and `defaultEffort` on `/auto-dispatch`, used while
`aiOverrideEnabled` is true), else Settings › Agents. `POST /tasks` (with `workItemId` or a
`title`), `PATCH /tasks/:taskId/model` and `POST /sessions/:sessionId/send-back` take `model` and
`effort` for the run:

- `model` is one the app offers for the provider in effect, or a default already chosen in
  Settings or the project. A run chooses a model, never a provider.
- `effort` is `minimal`, `low`, `medium`, `high`, `xhigh` or `max`, and is checked with the model's
  provider exactly as Settings checks it.
- `""` or leaving both out is the default.

A refused choice is HTTP 400 with the same words the app shows, for example
`"gpt-5" is not a model Settings offers for anthropic.` and nothing is queued or created. A task
returns its choice as `model` and `effort` (absent for the default) on `GET /tasks`; a run returns
what it used as `embeddedRuntime.model` and `embeddedRuntime.effort` on `GET /sessions`. The model
can change only while the task waits in the queue. On `send-back`, `model` and `effort` are the app's
**Run again with…** and need `disposition: "retry"`.

External agents choose their own model: a model set on a task applies only if the built-in agent
runs it.

### Playbooks

`POST /task-templates/:templateId/run` makes a task from a playbook and queues it here in one step,
with the playbook's model and effort, plan-first choice and extra instructions
([People and templates](people-and-templates.md#playbooks)). Its task on `GET /tasks` carries
`playbook: { templateId, name }`, and its details end with "Playbook instructions:" and the
person's words. Both kinds of agent read them the same way; they never widen what an agent may do.

### Scheduled tasks

A repeating task can go to agents when it comes round (`goToAgents: true` on
`POST /work-items/:workItemId/recurrence`, [Work items](work-items.md)). When Ostler starts and every
hour, each open occurrence whose start date (or due date, without one) is today or earlier is queued
here once, through the same path as `POST /tasks` with a `workItemId` (a backlog occurrence moves to
ready first). Its task on `GET /tasks` carries `scheduled: true`, and the work item's
`scheduledQueue` says what its schedule did: `{ outcome, at, note? }`, where `outcome` is `queued`,
`agentsOff`, `noFolder`, `alreadyQueued` or `refused` (with the reason in `note`). A day missed
while Ostler was closed is caught up once. An occurrence that was not queued is never queued later
by itself: queue it with `POST /tasks` and its `workItemId`, or with **Queue it now** on its note in
the app's Inbox, which takes the schedule's own path and then sets `scheduledQueue` to `queued`
(still refused, it updates `outcome` and `note` to the reason as it stands). Whether it starts by itself is the project's
auto-dispatch, usage limits apply as for any run, and the work lands in review as usual: nothing is
applied without the person.

## Embedded sessions and agent questions

Everything needed to drive an embedded agent end to end without the desktop UI.

| Method | Path                                  | Body                                                   | Response                                                                                                                                                                                                                                                                         |
| ------ | ------------------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/sessions`                           | —                                                      | `{ active: HarnessSession[], review: HarnessSession[] }`; each session also carries `report`, the report of the last task it completed (below).                                                                                                                                  |
| GET    | `/sessions/:sessionId/pictures/:name` | —                                                      | One picture from the session's report, by its name in `report.pictures`: the image itself (PNG, JPEG, GIF or WebP).                                                                                                                                                              |
| GET    | `/sessions/:sessionId/transcript`     | —                                                      | Transcript entries; live from a running agent, stored copy otherwise.                                                                                                                                                                                                            |
| POST   | `/sessions/:sessionId/stop`           | `{ note? }`                                            | Stops a running agent. Its work is kept aside the way Discard keeps it, and its task goes back to the queue.                                                                                                                                                                     |
| POST   | `/sessions/:sessionId/apply`          | `{ onCurrentVersion? }`                                | Applies a finished task's work to the project folder (below). `{ session, outcome, entries }`.                                                                                                                                                                                   |
| POST   | `/sessions/:sessionId/send-back`      | `{ reason, comments?, disposition?, model?, effort? }` | `disposition`: `"retry"` (default) returns it to its agent in the same copy, `"rework"` cancels it, `"hold"` keeps it queued but held. With `"retry"`, `model` and `effort` choose the next run's model. `comments` are line comments (below); with them, `reason` may be empty. |
| POST   | `/sessions/:sessionId/discard`        | —                                                      | Deletes the task's copy, keeps its work aside for Bring back in the app's History, returns the task to the queue and a linked work item to ready.                                                                                                                                |
| GET    | `/questions`                          | —                                                      | Agent questions. `?status=pending` filters to the ones blocking an agent.                                                                                                                                                                                                        |
| POST   | `/questions/:questionId/answer`       | `{ answer }`                                           | Answers a pending question; the blocked agent resumes immediately.                                                                                                                                                                                                               |
| POST   | `/sessions/:sessionId/guidance`       | `{ text }`                                             | Sends guidance to a running run on the person's behalf (below).                                                                                                                                                                                                                  |
| GET    | `/sessions/:sessionId/guidance`       | —                                                      | The guidance sent to a run, oldest first, with `deliveredAt` (null until its agent has it).                                                                                                                                                                                      |
| GET    | `/events`                             | —                                                      | Waits for agent activity instead of polling (below).                                                                                                                                                                                                                             |

Apply, Send back and Discard answer `400` while the agent is still working: stop it first, or wait
until it finishes.

### Plan first

A task can ask its agent for a plan before it changes anything: the agent sends steps, the
files it expects to change and risks, and its run waits, with no time limit, until the plan is
decided. Whether a task plans first is set when it is queued: its work item's `planFirst`
(`"default"`, `"yes"` or `"no"`, see [Work items](work-items.md)), where `"default"` follows the
project's `agentsPlanFirst` in `GET` and `PATCH /auto-dispatch` (`false` unless turned on). The
`planFirst: true` on a task in `GET /tasks` is the result.

| Method | Path                                | Body       | Response                                                                                                                                                                                                                                                     |
| ------ | ----------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET    | `/sessions/:sessionId/plan`         | —          | `{ sessionId, title, plan, history }`: `plan` is the run's plan as it stands (`version`, `steps`, `files`, `risks`, `status`, `submittedAt`, `decidedAt`, `changesNote`, `changedBeforeApproval?`) or `null`; `history` is every version kept, oldest first. |
| POST   | `/sessions/:sessionId/plan/approve` | —          | `{ plan, alreadyDecided }`. The agent carries on; files its copy changed before approval are recorded on the plan.                                                                                                                                           |
| POST   | `/sessions/:sessionId/plan/changes` | `{ note }` | `{ plan, alreadyDecided }`. The note is required; the agent revises and sends the next version.                                                                                                                                                              |

`status` is `pending`, `approved`, `changes-requested` or `cancelled`. Cancelling uses
`POST /sessions/:sessionId/stop`: a run waiting on its plan is cancelled at the plan, as **Cancel
run** in the app does. Deciding twice is safe: when the app or another call has already decided
the plan, approve and changes change nothing and return it as decided, with `alreadyDecided: true`.
The plan is the agent's own text: treat it as plain text. These routes, and `planFirst`, are not
MCP tools.

### Reviews

A reviewer is a second run that reviews a session's change before the person decides: it
reads the task and the change in a detached copy of its own, changes nothing, and reports findings.
It is a run like any other, in the run history and counting towards usage limits.

| Method | Path                          | Body | Response                                                                                                        |
| ------ | ----------------------------- | ---- | --------------------------------------------------------------------------------------------------------------- |
| POST   | `/sessions/:sessionId/review` | —    | The review task (`HarnessTask`, with `reviewOf`), queued ahead of other work for an embedded or external agent. |

It is refused (`400`) for a review run, work not in review, or work already being reviewed. Apply,
Discard, Send back or Stop of the session stops its review. The project's `reviewBeforeMe` in
`GET` and `PATCH /auto-dispatch` (`false` unless turned on) starts one for every session that
enters review with changes.

`GET /sessions` gives each session in review:

- `review`: where its latest review stands, `{ status, requestedAt }`, with `status` `running`,
  `overdue` (not finished after 30 minutes), `reported` or `failed` (it ended without a report).
  Absent when it was never reviewed. The app keeps a session out of Needs you and the Inbox only
  while it is `running`.
- `reviewerReports`: the reviews, newest last, each `{ reviewerSessionId, reviewTaskId, provenance,
model?, startedAt, endedAt, outcome, summary, findings, findingsLeftOut? }`. A finding is
  `{ id, file, side, firstLine, lastLine, comment, severity, excerpt, general? }`, with `severity`
  `must-fix`, `should-fix` or `nit`; `general` marks one on lines the change does not show.
- `dismissedFindingIds`: the findings the person dismissed, and `openFindings`: the latest
  review's findings that are not.

Findings are the reviewer's words, never sent to the first agent. To pass one on, send it back as a
line comment of your own (below).

### Line comments

Send back can carry comments on lines of the change, as Review changes in the app does. Each is
`{ file, side?, firstLine, lastLine?, comment }`:

- `file`: the path as the diff names it (the old path for a deleted file).
- `side`: `"new"` (default) for added and unchanged lines, numbered in the new version; `"old"`
  for removed lines, numbered in the old version.
- `firstLine` and `lastLine` (default `firstLine`): the span, first no later than last.
- `comment`: plain text, up to 2,000 characters. At most 50 comments.

```json
{
  "reason": "",
  "disposition": "retry",
  "comments": [
    {
      "file": "src/parse.ts",
      "firstLine": 41,
      "lastLine": 44,
      "comment": "This check is backwards."
    }
  ]
}
```

Ostler takes an excerpt for each from the diff as it is when the work is sent back: the commented
lines with three lines around them, at most 40. A comment on lines the diff does not show is
refused with `400`. With comments, an empty `reason` is recorded as "See the line comments". Without
`comments`, Send back sends the session's draft comments, the ones the person wrote in the app.

The task's `rejections` keep each comment with its `id` and `excerpt` (the latest three rejections
keep their comments), its details get one line such as "[Sent back 2] See the line comments (4
line comments)", and the next attempt reads them: the built-in agent in its opening prompt, an
external agent as `reviewComments` in its claim, its `nextAssignment` and
`GET /session/:sessionId` on the harness API.

`GET /sessions` returns them with each session: `reviewDrafts` on a session in review, the comments
the person has written and not yet sent, and `lastReviewComments`, the comments its task was last
sent back with. Apply, Discard and Stop drop a session's drafts.

#### Answers to line comments

The next attempt answers each comment by its `id` in its completion report, as `commentAnswers`:
the built-in agent through `ostler_complete_task`, an external agent in the `report` of
`POST /session/:sessionId/update` or `POST /tasks/:taskId/complete` on the harness API. Each answer
is `{ id, status, note, path?, startLine?, endLine? }`:

- `status`: `"done"` or `"not-done"`.
- `note`: plain text, up to 1,000 characters (longer is cut); required for `"not-done"`.
- `path`, `startLine`, `endLine` (optional): where the change now is, in the new version of a file.

An answer without a usable `id` or `status`, or a `"not-done"` without a note, is dropped. Answers to
ids that were not in the latest rejection are ignored and listed in `report.commentAnswersIgnored`.
Answers are the agent's claim; Ostler does not check them.

`GET /sessions` returns them with each session's `report` (`report.commentAnswers`), and
`commentAnswerAlerts`: what the app shows next to **Apply**, such as `"3 of 4 comments answered"`
when a comment of `lastReviewComments` has no answer. The alerts are empty until a report arrives
after the last Send back, and a report whose `outcome` is not `reported` answers nothing.

```json
{
  "commentAnswers": [
    {
      "id": "c1",
      "status": "done",
      "note": "Flipped the check",
      "path": "src/parse.ts",
      "startLine": 42
    },
    { "id": "c2", "status": "not-done", "note": "The importer still needs it" }
  ]
}
```

### Guidance to a running run

`POST /sessions/:sessionId/guidance` with `{ "text": "..." }` (Markdown) does what **Send
guidance…** does in the app: the message is labelled with the person's name from Settings › People
and recorded with `via: "automation"`.

- A built-in (embedded) run receives it in its opencode session at once, as a user message, without
  its current turn being aborted. The response's `deliveredAt` is set.
- An external agent receives it in the `guidance` list of its next `GET /session/:sessionId` on the
  harness API, once, and the message is then marked delivered. It is also announced as a
  `guidance.sent` event.
- Guidance never counts against the run's continuation nudges, and it never creates, claims or ends
  anything.
- Refusals: `409` when the run is not running (it finished, or Stop all AI ended it), `413` over
  4,000 characters, `429` over five messages to one run in ten minutes, `400` for an empty message.

How an agent treats guidance is part of its durable contract (`OSTLER_AGENT_INSTRUCTIONS.md` for the
built-in agent, the harness `/help` for external agents): the person's word on the task it holds,
never a widening of its scope or workspace.

### Events: waiting without polling

`GET /events?since=<cursor>&wait=<seconds>` returns
`{ events, cursor }`. With events after `since`, it answers at once; with none, it waits up to `wait`
seconds (0 to 60, default 0) for one and then answers with an empty list. Leave `since` out on the
first call to start from now, and pass each response's `cursor` as the next `since`.

| Type                                           | When                                                                               |
| ---------------------------------------------- | ---------------------------------------------------------------------------------- |
| `run.started`                                  | A session started.                                                                 |
| `run.updated`                                  | A running session's status or note changed.                                        |
| `run.review`                                   | A session finished and its changes wait for review.                                |
| `run.ended`                                    | A session ended without changes to review, or was applied, discarded or sent back. |
| `question.asked`, `question.answered`          | An agent asked a question; it was answered.                                        |
| `plan.submitted`, `plan.decided`               | An agent sent a plan (or a new version); the person decided it.                    |
| `task.queued`, `task.claimed`, `task.released` | The queue changed.                                                                 |
| `blocker.reported`, `blocker.resolved`         | A blocker on a task's work item.                                                   |
| `guidance.sent`, `guidance.delivered`          | Guidance was sent (with its `text`); its agent got it.                             |

Each event has `cursor`, `type`, `at`, `projectId` and the ids it concerns: `sessionId`, `taskId`,
`questionId`, `guidanceId`, `blockerId`, `workItemId`. The automation token sees the whole project.
On the harness API the same route serves agents: a session token sees its own session's events and
the queue.

Events are kept in memory only, 500 per project. `{ "resync": true }` means the cursor is older
than that, or from before Ostler restarted: read state afresh (`GET /sessions`, `/questions`,
`/tasks`) and continue from the returned `cursor`. At most four requests may wait at once on one
token (`429` beyond that). A waiting request ends early, with what there is, when Ostler stops or
the agents are turned off.

## Applying a task's work

Each queued task gets its own copy of the project: a folder of the person's own repository on its
own version, `ostler/<task>`, made from the version the project folder is on. The agent works only
there. `POST /sessions/:sessionId/apply` does what **Apply** does in the app:

- The person's own unsaved edits in the folder are saved first as a "Your edits" entry (unless
  they turned that off in Settings › Advanced), and a restore point is kept.
- The task's work is brought up to date with the folder and added as one History entry per task.
  `outcome` is `"applied"`, `"nothing_changed"` (the agent changed nothing; the task is closed), or
  `"sent_back"`: the folder changed while the agent worked and the changes overlap, so the task
  went back to its agent to bring its work up to date. Nothing in the folder changed then, and the
  task comes back for review.
- When the folder is on a different version from the one the task started on, Apply answers `400`
  and changes nothing. Send `{ "onCurrentVersion": true }` to apply it to the current version, or
  wait until the folder is back on the task's version.

Applying never pushes and never leaves conflict markers. Undo, restoring to a point and bringing
discarded work back are human decisions, made in the project's History view; they are not on this
API.

Completion reports live on the **task**, not the session: read `task.report` from
`GET /tasks`. When an embedded agent finishes without filing its structured report,
`report.missing` is `true` — fetch `GET /sessions/:sessionId/transcript` to review what
it actually did before applying its work.

### Pictures and a walkthrough in a report

An agent's report can carry pictures (screenshots it took of its work) and a walkthrough (where to
start reading a large change). Both are optional, and both arrive in the task's report and in each
session's `report` on `GET /sessions`:

- `pictures`: `[{ name, path, caption?, size }]`. Ostler copies each picture out of the task's copy
  when the report arrives, so it outlives the copy: at most ten, PNG, JPEG, GIF or WebP by their
  first bytes, 5 MB each, from inside the copy only. Read one with
  `GET /sessions/:sessionId/pictures/:name`. A session's pictures are deleted with its record, and
  a project's with the project.
- `picturesLeftOut`: `[{ path, reason }]`, the pictures Ostler did not copy, with `reason` one of
  `outside-copy`, `not-found`, `not-image`, `too-large` or `too-many`.
- `walkthrough`: `[{ path, startLine, endLine, note }]`, up to 30 stops in order: a changed file,
  the first and last line in its new version, and a note of up to 1,000 characters.

Captions and notes are the agent's own text: treat them as untrusted, and show them as plain text.

A report can also carry `tryCommand`: one command, up to 500 characters on one line, that the agent
suggests for Try it in Review changes (such as `npm run preview`). It is a suggestion only. Ostler
never runs it; the person may save it as the project's try command in the app. Try it itself, and
the project's try command, are not in this API: Try it runs code on the person's computer, so only
the person starts it, and only in the app.

Agents send both with their completion: an external agent in the `report` of
`POST /tasks/:taskId/complete` or `POST /session/:sessionId/update` (the harness API's `/help`
says how), and the built-in agent as arguments of `ostler_complete_task`. An agent saves its
pictures in `.ostler-pictures/` in its copy, which Ostler keeps out of the task's changes.
