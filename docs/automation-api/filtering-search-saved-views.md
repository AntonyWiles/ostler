# Automation API: Filtering, search and saved views

Part of the [Ostler Automation API](README.md). Base path for all routes below: `<baseUrl>/automation/<projectId>`

## Filtering work items

`GET /work-items?filter=<URL-encoded JSON>` keeps only the tasks that match a **TaskFilter**,
by the same rule every view in the app uses (`matchesFilter` in `src/shared/task-filter/match.ts`):

```json
{
  "match": "all",
  "conditions": [
    { "field": "due", "op": "is", "value": "thisWeek" },
    { "field": "priority", "op": "is", "value": ["high", "critical"] },
    { "field": "assignee", "op": "isNot", "value": ["me"] }
  ]
}
```

`match` is `all` (every condition) or `any` (at least one). The fields and operators:

| Field                      | Operators                                 | Value                                                                       |
| -------------------------- | ----------------------------------------- | --------------------------------------------------------------------------- |
| `text`                     | `contains`, `notContains`                 | Words, matched in the title, description, labels and checklist              |
| `status`, `priority`       | `is`, `isNot`                             | A list of statuses or priorities                                            |
| `assignee`                 | `is`, `isNot`                             | A list of person ids, `"me"` (whoever is Me now) and `"nobody"`             |
| `labels`                   | `hasAny`, `hasAll`, `hasNone`             | A list of labels                                                            |
| `contact`                  | `hasAny`, `hasNone`                       | A list of contact ids, each alone (any role) or as `"<id>:<role>"`          |
| `milestone`, `goal`        | `is`, `isNot`                             | A list of ids, and `"none"` for no milestone or goal                        |
| `iteration`                | `is`, `isNot`                             | A list of iteration ids, `"current"` and `"none"`                           |
| `type`                     | `is`, `isNot`                             | A list of task type ids, and `"none"` for no type                           |
| `subproject`               | `is`, `isNot`                             | A list of workstream (sub-project) ids, and `"none"` for the top level      |
| `due`, `start`             | `is`; `before`, `after`                   | `today`, `overdue`, `thisWeek`, `next7Days`, `none`, `any`; or `YYYY-MM-DD` |
| `created`, `updated`       | `is`; `before`, `after`                   | `today`, `thisWeek`, `last7Days`; or `YYYY-MM-DD`                           |
| `estimate`                 | `is`; `equals`, `lessThan`, `greaterThan` | `"set"` or `"empty"`; or a number                                           |
| `impact`, `effort`         | `is`; `equals`, `lessThan`, `greaterThan` | `"set"` or `"empty"`; or a number (scores are 1 to 5)                       |
| `checklist`                | `is`                                      | `"complete"` or `"incomplete"` (a task with no checklist is neither)        |
| `hasComments`, `recurring` | `is`                                      | `true` or `false`                                                           |
| `resolution`               | `is`, `isNot`                             | `"wont-do"`: a task closed as won't do (with `?scope=archived`)             |
| `showFrom`                 | `is`; `before`, `after`                   | `hidden`, `shown`, `today`, `none`, `any`; or `YYYY-MM-DD`                  |
| `someday`                  | `is`                                      | `true` or `false`                                                           |
| `inTriage`                 | `is`                                      | `true` or `false`: waiting in To triage                                     |

`showFrom is "hidden"` matches a task that is hidden today: in Someday, or with a show-from
date after today. `"shown"` matches every other task. It is the same rule that keeps hidden
tasks off Home's Today and Upcoming, My work, the Board and the List, so the API and the app
agree. `GET /work-items` itself lists hidden tasks too; add
`{ "field": "showFrom", "op": "is", "value": "shown" }` to leave them out.

Custom fields use `field: "custom"` and the field's id in `fieldId`, with operators
by the field's type (see `GET /fields`):

| Field type | Operators                                      | Value                   |
| ---------- | ---------------------------------------------- | ----------------------- |
| `text`     | `contains`, `notContains`                      | Words                   |
| `number`   | `equals`, `lessThan`, `greaterThan`; `between` | A number; `[low, high]` |
| `date`     | `before`, `after`                              | `YYYY-MM-DD`            |
| `choice`   | `is`, `isNot`                                  | A list of option ids    |
| `choices`  | `hasAny`, `hasAll`, `hasNone`                  | A list of option ids    |
| `checkbox` | `is`                                           | `true` or `false`       |
| any        | `isEmpty`                                      | `"empty"` or `"set"`    |

```json
{
  "conditions": [
    { "field": "custom", "fieldId": "<size-field-id>", "op": "is", "value": ["<large-option-id>"] }
  ]
}
```

A saved view keeps these conditions like any other. A deleted field counts as empty on every
task until it is restored.

Weeks run Monday to Sunday. `overdue` is a date before today on a task that is not done;
`next7Days` is the seven days after today. Statuses are the ones the app shows (an agent run
can move a task ahead of its stored status). An invalid filter answers HTTP 400 with a plain
message, for example `Filter condition 1: the value for "due is" must be one of: today, …`.

## Weekly review

The app's **Weekly review** goes through every project one step at a time. Its task lists are these
filters, from `weeklyReviewFilters` in `src/shared/planning/weekly-review.ts`, so a project's token
gets the same lists from `GET /work-items?filter=…` (one project per token; the app reads every
enabled project). `<today>` is the local date; done, archived and binned tasks are never listed.

| Step                             | Filter                                                                                                                                                                                                                          |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Overdue                          | `due is overdue`, `assignee is ["me", "nobody"]`, `someday is false`                                                                                                                                                            |
| Blocked for more than three days | `status is ["blocked"]`; how long each has waited is the time since its last move to Blocked, the `blocked` status change in `GET /work-items/:workItemId/activity`. The app lists those that have waited more than three days. |
| Nothing changed in 14 days       | `status isNot ["done"]`, `updated before <today − 13 days>`, `someday is false`, `showFrom is "shown"`                                                                                                                          |
| Someday                          | `someday is true`, oldest `createdAt` first                                                                                                                                                                                     |
| The next two weeks               | `status isNot ["done"]`, `due after <yesterday>`, `due before <today + 14 days>`, `someday is false`; milestones from `GET /milestones` with a `targetDate` in those days                                                       |

The Inbox step is the person's Inbox, which is not on this API. Milestones at risk are the report's
`atRisk.lateMilestones` and `atRisk.unforecastMilestones` (`GET /reports`). `GET /reviews/last`
returns when the person last finished a review, and each step's `shown` and `changed` counts, or
`null` before the first:

```json
{
  "ok": true,
  "value": {
    "id": "…",
    "finishedAt": 1792159200000,
    "steps": { "inbox": { "shown": 3, "changed": 3 }, "overdue": { "shown": 5, "changed": 4 } }
  }
}
```

A skipped step is not in `steps`. Reviews are personal and span projects, so every project's token
sees the same last review.

## Search

| Method | Path                | Response                                                                                                             |
| ------ | ------------------- | -------------------------------------------------------------------------------------------------------------------- |
| GET    | `/search?q=<words>` | Array of `{ type, id, projectId, title, snippet, workItemId, location?, score }`, best first, for this project only. |

Search covers tasks, comments, decisions, milestones, goals and Library items. Every word
must appear, each matching as a prefix ("colo" finds "colour"); quotes and FTS syntax are
treated as plain words. Results are ranked with a title match above a match in the text.
`snippet` is a list of `{ text, match }` pieces around the match, with the matching words
marked; `title` is a comment's task title, and `workItemId` is the task a task or comment
belongs to. Library items are found by the words inside their files too: PDFs, text files,
and Word (`.docx`), PowerPoint (`.pptx`) and Excel (`.xlsx`) files. For a PDF, slide deck or
workbook, `location` says where the passage is: `{ "kind": "page", "label": "7" }`,
`{ "kind": "slide", "label": "3" }` or `{ "kind": "sheet", "label": "Budget" }`; other results
have none. Archived and recycle-bin items are left out unless `?includeArchived=true`;
a task closed as won't do is found then too, with `resolution: "wont-do"`.
`?types=task,comment,decision,milestone,goal,library` narrows the kinds, and `?limit=`
(1–200, default 50) caps the list.

## Saved views

A **saved view** is a Board, List, Calendar or Timeline with its filter (a TaskFilter, as
above), search text and the view's own options, which the app stores as it keeps them
(sort, grouping, columns, zoom, mode, `hideDone`). One view per type has `isDefault: true`:
what that view opens with in the app, which the app keeps as the person changes it.

| Method | Path                         | Body                            | Response                                                 |
| ------ | ---------------------------- | ------------------------------- | -------------------------------------------------------- |
| GET    | `/views`                     | —                               | Array of `SavedView`; `?viewType=board` narrows it.      |
| GET    | `/views/:viewId`             | —                               | One `SavedView`.                                         |
| POST   | `/views`                     | `{ name, viewType, config }`    | The new view.                                            |
| PATCH  | `/views/:viewId`             | `{ name?, config?, position? }` | The view. The default view keeps its name.               |
| POST   | `/views/:viewId/set-default` | —                               | The default view, now holding this view's configuration. |
| DELETE | `/views/:viewId`             | —                               | What was deleted. The default view cannot be deleted.    |

`SavedView` is `{ id, projectId, name, viewType, config: { filter, query, options }, position,
isDefault, createdAt, updatedAt }`. `viewType` is `board`, `list`, `calendar` or `timeline`;
names are up to 80 characters.

A Calendar view's `options` are `{ mode, unscheduledOpen }`. `mode` is `month`, `week`, `year` or
`agenda`; any other value opens as `month`. `unscheduledOpen` is `true` while the Unscheduled panel
shows.

## Pins

A **pin** is a pointer to a task, milestone, decision, Library item, saved view or project view
shown in the sidebar's Pinned section (`place: "sidebar"`, the person's own, at most 20)
or on its project's Overview as a shortcut (`place: "overview"`). A pin stores no title: `title`
is the target's current title, read when the pins are listed. Unpinning never changes the item,
and deleting the item never fails because of a pin: the pin then lists with `exists: false`.

| Method | Path                | Body                           | Response                                                                                                                      |
| ------ | ------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/pins`             | —                              | `{ overview, sidebar, personal }`: this project's shortcuts, the sidebar pins of its items, and your own goals' pins (below). |
| POST   | `/pins`             | `{ place, kind, targetId }`    | The pin. Pinning what is already pinned there returns that pin.                                                               |
| DELETE | `/pins/:pinId`      | —                              | What was unpinned.                                                                                                            |
| PATCH  | `/pins/:pinId`      | `{ countdown, replacePinId? }` | The pin, its countdown turned on or off.                                                                                      |
| POST   | `/pins/:pinId/move` | `{ beforeId?, afterId? }`      | The pin, moved before or after another of its place; to the end with neither.                                                 |

`kind` is `task`, `milestone`, `decision`, `library`, `saved-view` or `project-view`; for a
project view, `targetId` is the view's id (`overview`, `board`, `list`, `calendar`, `timeline`,
`milestones`, `library`, `decisions` and so on). The target must be one of this project's items.
A 21st sidebar pin is refused with HTTP 400.

`kind` may also be `personal-goal`: a goal of your own from `GET /personal-goals`. It is in
no project, so it pins to the sidebar only, its pin's `projectId` is `""`, and any project's token
may change it. `GET /pins` lists these under `personal`, beside `overview` and `sidebar`.

`PinView` is `{ id, place, projectId, kind, targetId, orderKey, createdAt, countdown, exists,
title, archived, status?, libraryKind?, url?, viewType?, date?, done?, countdownText? }`: `status`
for a task, `libraryKind` and `url` for a Library item, `viewType` for a saved view, and `date`,
`done` and `countdownText` for a task or milestone. A project view's `title` is null; the app
names it. Overview pins travel in the project file; sidebar pins do not. A countdown does not
travel either: it is the person's own.

### Countdowns

A pinned milestone with a target date, a pinned task with a due date, or a pinned goal of your own
whose measure has a target date (`done` once it is achieved or dropped), can show as a
**countdown** on Home, in the notification-area menu and in the taskbar's jump list.
`countdown` is `true` while it does, and `countdownText` is the countdown in the app's own words
for today's local date: `12 days to Launch`, `Launch is tomorrow`, `Launch is today`,
`Launch was 2 days ago`, or `Launch: done` once the milestone is complete or the task done. A gap
of more than a week adds its working days when they differ, as in `12 days to Launch (9 working
days)`: your own working days, as Ostler knows you (`isMe` in `GET /people`): your working days,
less your days off and everyone's. With nobody marked as you, Monday to Friday less everyone's days
off; other people's leave never changes it. `countdownText` is null while the pin is not a
countdown.

Send `PATCH /pins/:pinId` with `{ "countdown": true }` or `{ "countdown": false }`. At most
three items count down at once, across every project; turning on a fourth is refused with HTTP
400 unless `replacePinId` names one of the three, which is turned off in the same change. A
countdown on an item without a date, or on any other kind of pin, is refused. Turning a countdown
off turns it off for the item in both places it may be pinned.
