# Automation API: guidance and examples

Part of the [Ostler Automation API](README.md).

# Practical guidance

- **Priority values**: use `"low" \| "medium" \| "high" \| "critical"` — Ostler rejects
  anything else.
- **IDs are opaque strings.** Don't try to construct or guess them; always take them
  from a prior response (e.g. a goal's `id` from `POST /goals` before referencing it
  in `POST /milestones`).
- **This API only talks to one project at a time** (except `GET /automation/projects`).
  If the human's request spans multiple projects, you need a separate token/base call
  per project.
- **Errors are informative** — on `ok: false`, read `error` and relay it back to the
  human rather than retrying blindly; most failures are validation errors (e.g. a
  missing required field, or a `milestoneId`/`goalId` that doesn't exist in this
  project).
- **There is no general rate limit** (only guidance to one run and waits on `/events`
  are limited), but this is a small local dashboard, not a production API — avoid
  hammering it with rapid-fire requests; batch logical
  operations (e.g. use `/goals/:goalId/split` to create several milestones/work items
  from one goal in a single call, rather than many individual POSTs).

# Example: creating a goal with milestones

```
POST /automation/<projectId>/goals
Authorization: Bearer <token>
Content-Type: application/json

{ "title": "Ship v2 of the billing flow", "outcome": "Customers can self-serve upgrade/downgrade" }
```

Response:

```json
{
  "ok": true,
  "value": {
    "id": "goal_abc123",
    "title": "Ship v2 of the billing flow",
    "outcome": "...",
    "status": "active"
  }
}
```

Then, using that goal's `id`:

```
POST /automation/<projectId>/goals/goal_abc123/split
Authorization: Bearer <token>
Content-Type: application/json

{
  "items": [
    { "type": "milestone", "name": "Design pricing UI", "targetDate": "2026-09-15" },
    { "type": "milestone", "name": "Wire up billing backend", "targetDate": "2026-09-30" }
  ]
}
```

Response is an array with one `{ index, ok, value }` (or `error`) entry per item you
sent, in the same order.

# Batch references in split

`split` can build a whole plan in one call. Any item may carry `ref`, a short name of
letters, digits, `-` or `_`, unique in the batch. A work item may then point at other
items of the same batch:

- `milestoneRef`: a milestone's `ref` (instead of `milestoneId`)
- `parentRef`: another work item's `ref`, making this one its subtask (instead of
  `parentWorkItemId`)
- `dependencyRefs`: work items' `refs` this one depends on (added to any `dependencyIds`)

Refs are checked by the same resolver as project packages, so the same mistakes are refused
in the same words: a ref that matches nothing (`items[3].milestoneRef 'm9' does not match
any milestone`), a ref used twice, a task that is its own parent or dependency, a subtask
depending on anything but its siblings, nesting deeper than three levels, and dependency or
subtask loops (`items[4] 'b' is part of a dependency loop`). A batch that uses refs is
created in one transaction: if any item fails, the call answers 400 with an error naming the
item and nothing is created. Items may come in any order; Ostler creates milestones first,
then parents and dependencies before the work items that name them. Results still come back
one per item, in the order you sent them.

```
POST /automation/<projectId>/goals/goal_abc123/split
Authorization: Bearer <token>
Content-Type: application/json

{
  "items": [
    { "type": "milestone", "ref": "design", "name": "Design pricing UI" },
    { "type": "milestone", "ref": "backend", "name": "Wire up billing backend" },
    { "type": "work-item", "ref": "mock", "title": "Mock the pricing page", "milestoneRef": "design" },
    { "type": "work-item", "ref": "api", "title": "Add the plans endpoint", "milestoneRef": "backend" },
    { "type": "work-item", "ref": "page", "title": "Build the pricing page", "milestoneRef": "design", "dependencyRefs": ["mock", "api"] },
    { "type": "work-item", "title": "Write the copy", "parentRef": "page" }
  ]
}
```
