# Rules

A project's rules: "when a task moves to Done, if it has the label urgent, then notify me".
The same rules as Project settings › Board › Rules in the app, run by the same engine for every surface.
Base path: `<baseUrl>/automation/<projectId>`.

A rule:

```json
{
  "id": "…",
  "projectId": "…",
  "name": "Escalate urgent bugs",
  "enabled": true,
  "trigger": { "kind": "statusChanged", "to": "blocked" },
  "conditions": [{ "kind": "label", "op": "is", "label": "urgent" }],
  "actions": [
    { "kind": "setPriority", "priority": "critical" },
    { "kind": "notifyMe", "message": "An urgent task is blocked" }
  ],
  "lastRunAt": null,
  "runCount": 0,
  "createdAt": 1792400000000,
  "updatedAt": 1792400000000
}
```

- A project has at most 50 rules. They run oldest first.
- `enabled` is the rule's on and off switch.
- `lastRunAt` and `runCount` say when it last did something and how often.

## Triggers

One per rule.

| Trigger                                      | When it runs                                                                                                                              |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `{ "kind": "taskCreated" }`                  | A task is created.                                                                                                                        |
| `{ "kind": "statusChanged", "to", "from"? }` | A task's status changes to `to`; with `from`, only from that status. Statuses: `backlog`, `ready`, `active`, `blocked`, `review`, `done`. |
| `{ "kind": "assigneeChanged" }`              | A task's assignee changes.                                                                                                                |
| `{ "kind": "subtasksDone" }`                 | A task's last open subtask is done. The rule acts on the parent.                                                                          |
| `{ "kind": "checklistComplete" }`            | Every item on a task's checklist is ticked.                                                                                               |
| `{ "kind": "dueDateReached" }`               | A task's due date is reached. Checked hourly while Ostler runs, once per task per due date, for due dates on or after the rule was made.  |

## Conditions

Up to ten; every one must hold. Each has `op`: `is` or `isNot`.

| Condition                                       | Holds when the task                                                                        |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `{ "kind": "label", "op", "label" }`            | has the label (any case)                                                                   |
| `{ "kind": "priority", "op", "priority" }`      | has the priority: `low`, `medium`, `high`, `critical`                                      |
| `{ "kind": "assignee", "op", "personId" }`      | is assigned to the person (`GET /people`), or to nobody with `null`                        |
| `{ "kind": "milestone", "op", "milestoneId" }`  | is in the milestone, or in none with `null`                                                |
| `{ "kind": "status", "op", "status" }`          | has the status                                                                             |
| `{ "kind": "field", "op", "fieldId", "value" }` | has the custom field value (`GET /fields`): an option id, text, a number or `true`/`false` |

## Actions

One to ten, in order, each seeing what the ones before it did. There are no others: a rule never
queues work for agents, starts or stops runs, touches the harness, deletes anything, reads or
writes the Library, calls Ostler AI or sends anything off the PC.

| Action                                      | What it does                                                                   |
| ------------------------------------------- | ------------------------------------------------------------------------------ |
| `{ "kind": "setStatus", "status" }`         | Sets the status. A task with agent work keeps the status its run gives it.     |
| `{ "kind": "setPriority", "priority" }`     | Sets the priority.                                                             |
| `{ "kind": "setAssignee", "personId" }`     | Assigns the person, or nobody with `null`.                                     |
| `{ "kind": "setMilestone", "milestoneId" }` | Moves the task into the milestone, or out of any with `null`.                  |
| `{ "kind": "addLabel", "label" }`           | Adds the label.                                                                |
| `{ "kind": "removeLabel", "label" }`        | Removes the label.                                                             |
| `{ "kind": "addChecklistItems", "items" }`  | Adds up to 10 checklist items the task does not have yet.                      |
| `{ "kind": "addComment", "text" }`          | Adds a comment, marked as by the rule.                                         |
| `{ "kind": "notifyMe", "message" }`         | An Inbox item and a desktop notification on this PC. `message` may be empty.   |
| `{ "kind": "archive" }`                     | Archives the task if it is Done and has no agent work; otherwise does nothing. |

## How rules run

- Every change sets rules off the same way, from the app (the task drawer, the Board, the List,
  quick add, the plan grid) and from this API (`POST` and `PATCH /work-items`,
  `POST /work-items/:workItemId/move`, `POST /work-items/:workItemId/checklist`, `POST /work-items/batch`).
- Imports, project files, templates and the sample project set off no rules.
- A rule runs in the same transaction as the change that set it off. A change a rule makes sets off
  no rules, so rules never chain.
- A rule that fails refuses the whole change (HTTP 400) with a message naming the rule; nothing is
  written.
- What a rule did shows in the task's activity as "… by rule “<name>”"; its comments have
  `authorKind: "rule"` and `ruleName`.
- When rules did something, the work item a write returns has `ruleRun: { id, ruleNames }`. To undo
  the change, `PATCH` the old values back with `undoRuleRun: <id>`: what the rules did is undone
  first, in the same transaction, and the undo sets off no rules.

## Routes

| Route                   | What it does                                                                                                                                                                  |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /rules`            | The project's rules, oldest first.                                                                                                                                            |
| `POST /rules`           | Creates a rule. Body: `{ name, enabled?, trigger, conditions?, actions }`.                                                                                                    |
| `PATCH /rules/:ruleId`  | Changes any of `name`, `enabled`, `trigger`, `conditions`, `actions`.                                                                                                         |
| `DELETE /rules/:ruleId` | Deletes a rule and returns `{ rule }`. What it already did stays.                                                                                                             |
| `POST /rules/restore`   | Undoes a delete. Body: what the delete returned.                                                                                                                              |
| `POST /rules/preview`   | Tries a rule on a task without changing anything. Body: `{ workItemId, conditions?, actions }`. Returns `{ conditions: boolean[], matches, effects: [{ action, outcome }] }`. |

A preview's `outcome` is `change`, `none` (the task is already that way), `agentWork` (its agent run
keeps the status) or `notDone` (archive takes only a Done task). The trigger is not checked.
