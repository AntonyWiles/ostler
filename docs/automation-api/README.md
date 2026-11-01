# Ostler Automation API — Agent Integration Guide

You are being connected to **Ostler**, a project-management and monitoring dashboard that
tracks work for one or more software projects. Ostler exposes a small local HTTP API
("the automation API") that lets an external agent (you) read the current plan for a
project and create or update goals, milestones, work items ("tasks"), and blockers on
a human's behalf.

This folder is self-contained. Read this page first, then only the topic page you need.

## Connection details

You will be given two things by the human operator:

- A **base URL**, always of the form `http://127.0.0.1:<port>` (the API only listens on
  localhost — it is never reachable from outside the machine running Ostler).
- A **project ID** and a **bearer token** scoped to one specific project. The token is a
  secret; treat it like a password. It authorizes every write you make, so it must only
  be sent to the base URL you were given.

All endpoints are namespaced under a project:

```
<baseUrl>/automation/<projectId>/<route>
```

Send the token on every request except `GET /automation/<projectId>/help`:

```
Authorization: Bearer <token>
```

`GET /automation/<projectId>/help` requires no token. It returns the instructions, the rules every
route follows (`conventions`) and one line per route. `?route=<path>` gives the full text of the
routes at a path, such as `?route=/work-items/:workItemId&method=PATCH` (a path as sent, like
`/work-items/SHOP-12`, works too); `?q=<words>` keeps the routes that mention every word; `?full=1`
is every route in full, which is large.

The API listens only while the human has turned it on, in Settings › Connections, whether AI
agents are on or off. While agents are off, the routes about agent work (`/tasks`, `/sessions`,
`/questions`, `/events`, `/auto-dispatch`, `/report`, `/workspace-setup`, `/agent-runs`,
`/agent-usage`) answer `409` saying so. An assistant that speaks MCP can use the same routes as tools instead, over
`<baseUrl>/automation/<projectId>/mcp` or a stdio command: see [MCP](mcp.md).

## Response envelope

Every response is JSON with one of these two shapes:

```json
{ "ok": true, "value": ... }
```

```json
{ "ok": false, "error": "human-readable message" }
```

HTTP status codes: `200` success (`201` for the few creates that say so), `400` invalid
request/business-rule error, including most records that are not there (read `error` for why),
`401` missing or wrong bearer token, `403` a change to a project the human has turned off (reads
still work), `404` unknown route or unknown project ID (and a few lookups that say so, such as
`GET /work-items/by-key/:key`), `405` a method a read-only route does not take, `409` a route that
needs a folder on a project without one, agent work while agents are off, or guidance to a run that is
not running, `413` guidance that is too long, `429` too many waits on `/events` at once or too much
guidance to one run, `503` a part of Ostler the route needs is not available. Always check `ok`
before trusting `value`.

### Projects without a folder

A project can live only in Ostler, with no folder linked (`hasFolder: false` in
`GET /automation/projects`). Planning, status and Library routes work as usual. The routes
that need the project's folder answer `409` with an `error` saying the project needs a
linked folder: queuing a task for an agent (`POST /tasks`), `POST /tasks/:taskId/start-embedded`,
and applying, sending back or discarding a task's work. Only
the human can link a folder, in Ostler (the project's Project settings › Folder and GitHub › Link a folder…); the API has
no route for it. The harness API answers its folder routes the same way.

## Core concepts and hierarchy

Ostler organizes work like this, top to bottom:

- **Goal** — a broad outcome the human wants ("Ship v2 of the billing flow"). Optional;
  milestones and work items can exist without one.
- **Milestone** — a concrete checkpoint toward a goal, usually with a target date.
- **Work item** — the actual unit of work (what you'd call a task, ticket, or issue).
  Can belong to a milestone, and can depend on other work items.
- **Task** (as distinct from "work item") — an entry in the execution queue that a
  coding agent/harness will actually pick up and run. Created separately from work
  items; think of it as "queue this for an agent to execute now," whereas a work item
  is planning-level record-keeping.
- **Blocker** — something preventing a work item from progressing, with optional
  resolution options a human can choose between.

When a human asks you to "create a goal," "create a milestone," or "add a task/work
item," use the matching endpoint below — don't improvise a different shape.

### Words in the app vs. words in the API

The desktop app uses plain words; this API keeps its internal names. When you
write to the human, use the app's words. When you call the API, use the API's.

| In the app                                                    | In the API                                                          | Notes                                                                    |
| ------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Project                                                       | `WatchedProject`, `projectId`                                       | "Watched" never appears in the app                                       |
| Folder                                                        | `path`, `hasFolder`                                                 | Optional. "Link a folder", "Unlink folder"                               |
| Task, subtask                                                 | work item (`/work-items`), child work item                          | Never "work item" in the app                                             |
| Status: Backlog, Ready, In progress, Blocked, In review, Done | `backlog`, `ready`, `active`, `blocked`, `review`, `done`           | A project may rename its columns: names are for display (`GET /columns`) |
| Due date, start date                                          | `targetDate`, `startDate`                                           | Filters, CSV columns and the critical path call the due date `due`       |
| Checklist                                                     | `acceptanceCriteria`                                                | Agents still read "acceptance criteria"                                  |
| Goal, milestone, decision, blocker                            | the same                                                            | —                                                                        |
| Manual order                                                  | the order of `GET /work-items`; `POST /work-items/:workItemId/move` | Not the agent queue's order                                              |
| Move to another project                                       | `POST /work-items/:workItemId/move` with `projectId`                | The same route as the manual order; the body says which                  |
| Waits on                                                      | `dependencyIds`, `dependencyLinks`; `/dependency-conflicts`         | A task that starts too early for its link is a dependency conflict       |
| Archive, Bring back (a task)                                  | `/work-items/:workItemId/archive`, `/unarchive`                     | Won't do is archived too; Bring back is `unarchive` for both             |
| Recycle bin, Restore                                          | `DELETE /work-items/:workItemId`, `/work-items/:workItemId/restore` | Restore puts back from the bin; Bring back takes out of the Archive      |
| Archive (a Library item)                                      | `POST /library/:itemId/archive`                                     | Set aside: Ostler AI never reads it; Bring back is in the app only       |
| Archive (a goal or milestone)                                 | `PATCH` with `status: "archived"`                                   | A status, not a route                                                    |
| Agent                                                         | coding agent                                                        | Shown only while the human has agents on                                 |
| Built-in agent                                                | embedded session (opencode)                                         | `/tasks/:taskId/start-embedded`                                          |
| Connected agent                                               | external session over the harness HTTP API                          | —                                                                        |
| Agent run                                                     | task (`/tasks`, the execution queue) plus its session               | "Queue for agent", "Agent queue", "Run", "Stop run"                      |
| The agent's copy                                              | the task's worktree and version (`ostler/<task>`)                   | —                                                                        |
| Apply, Send back, Discard, Stop                               | `/sessions/:sessionId/apply`, `/send-back`, `/discard`, `/stop`     | —                                                                        |
| Run queued tasks automatically                                | auto-dispatch                                                       | —                                                                        |
| Plan first, Agents plan first                                 | `planFirst` on work items, `agentsPlanFirst` on `/auto-dispatch`    | —                                                                        |
| Approve, Ask for changes (a plan)                             | `/sessions/:sessionId/plan/approve`, `/plan/changes`                | —                                                                        |
| Ask a reviewer, Review agent work before me                   | `/sessions/:sessionId/review`, `reviewBeforeMe` on `/auto-dispatch` | —                                                                        |
| Agent API                                                     | the harness HTTP API                                                | Settings › Agents                                                        |
| Automation API                                                | this API                                                            | Settings › Connections. It listens only while its own switch is on       |
| Connect an AI assistant                                       | the MCP endpoint and the stdio launcher ([MCP](mcp.md))             | Settings › Connections                                                   |
| File activity                                                 | watcher, watch events                                               | Settings › Advanced                                                      |
| Stop all AI                                                   | `EMERGENCY_STOP_AI`                                                 | Status bar                                                               |
| Time entry, timer, Timesheet                                  | `/time-entries`, `/timer`                                           | One timer across every project                                           |
| Rule                                                          | `/rules`                                                            | Project settings › Board › Rules                                         |
| Task template                                                 | `/task-templates`                                                   | Settings › Projects › Task templates                                     |
| Task type                                                     | `/task-types`, a work item's `typeId`                               | Project settings › Tasks › Task types. Not a label                       |
| Workstream                                                    | `/subprojects`, a work item's or milestone's `subprojectId`         | A named part of one project; the code and routes say sub-project         |
| Budget, cost, planned, paid                                   | `/budget`, `/costs`, a cost's `state`                               | Amounts in minor units of the project's currency                         |

## Endpoints by topic

Base path for all routes below: `<baseUrl>/automation/<projectId>`. The `/help` route (see Agents) lists every route.

- [Agents, harness tasks and merging](agents.md)
- [Goals and milestones](goals-and-milestones.md) (and goals of your own, outside any project)
- [Work items](work-items.md) (and their custom fields)
- [Time tracking](time-tracking.md): time entries, the timer, focus, billable time, the Time report and
  billings
- [Budgets and costs](budgets-and-costs.md): a project's budget, its costs and their CSV, and
  its shopping list
- [Rules](rules.md): when this happens, do that
- [Filtering, search, saved views and pins](filtering-search-saved-views.md)
- [Library](library.md)
- [People and templates](people-and-templates.md) (and task templates, days off and calendars)
- [Contacts](contacts.md): the shared contact list and the contacts a task names
- [Import and export](import-and-export.md)
- [Reports, status updates, Ostler AI settings and project conventions](reports-settings-conventions.md)
- [Dependency conflicts, critical path, baselines and blockers](conflicts-and-blockers.md)
- [Practical guidance, a worked example and batch references](guidance-and-examples.md)
- [MCP: the same routes as tools for an AI assistant](mcp.md)
