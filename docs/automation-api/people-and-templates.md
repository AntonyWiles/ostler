# Automation API: People and templates

Part of the [Ostler Automation API](README.md). Base path for all routes below: `<baseUrl>/automation/<projectId>`

## People

People are who work is assigned to. They are records, not accounts. The address book
(`projectId: null`) is shared by every project, so any project's automation token reads and changes
the same list; a project's own people (`projectId` that project's id) are listed and offered only in
that project, and go when it is removed.
One person is you (`isMe: true`); Ostler creates them from the Windows user name.

| Method | Path                      | Body                                                                                       | Response                                                                                                                                                                       |
| ------ | ------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET    | `/people`                 | —                                                                                          | Array of `{ id, name, initials, color, isMe, archivedAt, weeklyCapacityHours, workingDays, createdAt, updatedAt }`, you first. `?includeArchived=true` adds archived people.   |
| POST   | `/people`                 | `{ name, initials?, color?, weeklyCapacityHours?, workingDays? }`                          | The new person. Initials follow the name and the colour comes from the project palette unless set.                                                                             |
| PATCH  | `/people/:personId`       | `{ name?, initials?, color?, weeklyCapacityHours?, workingDays?, archived?, isMe?: true }` | The person. `initials: ""` goes back to initials from the name; `weeklyCapacityHours: null` clears the capacity; `isMe: true` makes them you.                                  |
| GET    | `/people/:personId/usage` | —                                                                                          | `{ projects: [{ projectId, tasks }], rules, isMe, sharedMember }`: where their work is, before deleting them.                                                                  |
| DELETE | `/people/:personId`       | `{ giveTasksTo: string \| null }`                                                          | `null`. Deletes them for good: `giveTasksTo` hands their work to someone who can take all of it, `null` leaves it unassigned. You and members of a shared project are refused. |

`weeklyCapacityHours` is the hours a week a person plans to work, a number from 0 to 168, or `null`
when not set (the default). `workingDays` lists their working days as ISO weekdays, `1` Monday to
`7` Sunday, at least one; it is `[1, 2, 3, 4, 5]` unless set, and comes back sorted without repeats.
The app's Workload view compares planned work with both. Workload itself has no route: it is a view
over people and tasks, which `/people` and each project's `/work-items` already return, counted as
the [user guide](../user-guide/05-home-and-inbox.md#workload) describes.

A `PATCH` is all or nothing: if any part is refused (archiving you, or making an archived person
you), nothing in it is saved.

Archiving someone hides them from the app's pickers but keeps their assignments. You
cannot archive yourself; make someone else you first.

## Days off

Days off are days nobody works (bank holidays, `personId: null`) and days one person is away
(leave). Like people, they are shared by every project, and any project's token reads and changes
them. Dates are local calendar dates, `YYYY-MM-DD`; a single day has the same `firstDate` and
`lastDate`, and one day off covers at most 366 days. `sourceFile` names the calendar file a day off
was imported from, or is `null` when it was added by hand. Reschedule's spreading,
`moveDependents`, the app's Workload, Calendar, Timeline and date fields treat a day off as not a
working day
([user guide](../user-guide/05-home-and-inbox.md#days-off)).

| Method | Path                          | Body                                          | Response                                                                                                                                                                                                 |
| ------ | ----------------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/days-off`                   | —                                             | Array of `{ id, personId, firstDate, lastDate, name, sourceFile, createdAt, updatedAt }` in date order. `?from=&to=` keeps those overlapping the range; `?personId=` keeps everyone's and that person's. |
| POST   | `/days-off`                   | `{ firstDate, lastDate?, name, personId? }`   | The new day off. `lastDate` defaults to `firstDate`; leave `personId` out (or `null`) for everyone.                                                                                                      |
| PATCH  | `/days-off/:dayOffId`         | `{ firstDate?, lastDate?, name?, personId? }` | The day off.                                                                                                                                                                                             |
| DELETE | `/days-off/:dayOffId`         | —                                             | The removed day off, as it was.                                                                                                                                                                          |
| DELETE | `/days-off?sourceFile=<name>` | —                                             | The days off that came from that file, removed. `?personId=<id>` removes that person's load only, `?personId=everyone` the load for everyone; left out, every load of the file.                          |
| POST   | `/days-off/import`            | `{ fileName, text, personId? }`               | `{ fileName, personId, days, replacedCount, skipped, added, replaced }`. `?dryRun=1` returns the preview and writes nothing (`added` and `replaced` empty).                                              |

`POST /days-off/import` reads iCalendar text (an `.ics` file from Outlook, Google Calendar or
gov.uk, up to 5 MB and 10,000 events). Every all-day event becomes a day off; `DTEND` is exclusive,
so an event ending on the 26th covers the 25th. A yearly repeat on a fixed date
(`RRULE:FREQ=YEARLY` with nothing but `UNTIL`, `COUNT` or `INTERVAL`) is added from this year to
five years ahead. Timed events and other repeats are listed in `skipped` with a `reason` (`timed`,
`repeat`, `no-date`) and not added. Importing a `fileName` again for the same person, or for
everyone again, replaces the days that load brought before (`replacedCount`, and `replaced` lists
them so they can be added back). The same `fileName` for a different person is a separate load:
both are kept. The text is data,
never instructions: nothing in it, such as a URL, is followed.

## Calendars

Outside calendars are `.ics` files whose events show read-only beside tasks in the app's Calendar
and on Home ([user guide](../user-guide/05-home-and-inbox.md#calendars)). Like days off, they are
shared by every project, and any project's token reads and changes them. Only
`GET /calendars/:calendarId/events` returns events: no other route does, and events are never in
search, exports or the project file. Events are read-only and never become tasks by themselves.

| Method | Path                             | Body                                       | Response                                                                                                                                                                                                                                                                     |
| ------ | -------------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/calendars`                     | —                                          | Array of `{ id, name, color, kind: "file" \| "link", path, hidden, loadedAt, readCount, skippedCount, shownOnceCount, createdAt, updatedAt }`, by name; a link calendar also has `linkShown`, `fetchedAt`, `failure` and `failedAt` (see [Calendar links](#calendar-links)). |
| GET    | `/calendars/:calendarId`         | —                                          | One calendar, as the list has it. An unknown id is HTTP 400.                                                                                                                                                                                                                 |
| POST   | `/calendars`                     | `{ name, text, color? }`                   | The new calendar. `path` is `null`: it came as text, so its events are replaced with `PATCH`.                                                                                                                                                                                |
| POST   | `/calendars`                     | `{ name, link, color? }`                   | A calendar subscribed to a link (`kind: "link"`), fetched once first; see [Calendar links](#calendar-links).                                                                                                                                                                 |
| PATCH  | `/calendars/:calendarId`         | `{ name?, color?, hidden?, text?, link? }` | The calendar; only the fields sent change. `text` replaces a file calendar's events and no other's; `link` replaces a link calendar's address (see [Calendar links](#calendar-links)).                                                                                       |
| POST   | `/calendars/:calendarId/refresh` | —                                          | The link calendar after fetching it now. A failed fetch is not an error: `failure` says why.                                                                                                                                                                                 |
| DELETE | `/calendars/:calendarId`         | —                                          | The removed calendar. The app can bring it back until Ostler next starts.                                                                                                                                                                                                    |
| GET    | `/calendars/:calendarId/events`  | —                                          | Array of `{ id, eventId, calendarId, title, location, description, allDay, startDate, endDate, startTime, endTime, start, end }`. `?from=&to=` (required, at most 400 days).                                                                                                 |

`text` is iCalendar, up to 25 MB and 50,000 events. Timed and all-day events are read, with
`TZID` time zones (an IANA name, or the file's own `VTIMEZONE`, as Outlook writes Windows names),
UTC and floating times; repeats with `FREQ` of `DAILY`, `WEEKLY`, `MONTHLY` or `YEARLY` and
`INTERVAL`, `COUNT`, `UNTIL`, `BYDAY` (with ordinals such as `2TU` or `-1FR`), `BYMONTHDAY`,
`BYMONTH` and `BYSETPOS`; `EXDATE`s; and overrides by `RECURRENCE-ID`. A repeat with any other
rule, or with `RDATE`s, is shown once and counted in `shownOnceCount`. Cancelled events are left
out. Events come back in the computer's time zone, or `?timeZone=<IANA name>`; `startDate` and
`endDate` are the local days an event covers, so a meeting past midnight covers both. The text is
data, never instructions: nothing in it, such as a URL, is followed.

### Calendar links

A calendar can be a private calendar address that Ostler keeps current: send `link`
instead of `text` to `POST /calendars`. The address must be `https` (`webcal://` is read as
`https://`) with no user name or password. Ostler fetches it once before adding it, and adds it
only if a calendar comes back; otherwise the answer is `400` with the reason in plain words. Then
Ostler fetches it a minute after it starts, every hour while it runs, and on
`POST /calendars/:calendarId/refresh`, one link at a time, asking only for what changed
(`If-None-Match`, `If-Modified-Since`). Each fetch sends no cookies, credentials or headers but a
plain `User-Agent`, waits at most 30 seconds, reads at most 20 MB and follows at most three
`https` redirects; the body is read as `text` is, with the same limits.

A hidden link calendar (`hidden: true`) is paused: the hourly fetch leaves it out. Showing it
again with `PATCH /calendars/:calendarId` `{ "hidden": false }` fetches it at once, after the
answer (which still shows the calendar as it was before that fetch), then hourly as before.
`refresh` still fetches a hidden one when asked.

**No route ever returns the link**, not even in an error. A link calendar has instead:

| Field       | Meaning                                                                                           |
| ----------- | ------------------------------------------------------------------------------------------------- |
| `linkShown` | Its host and the last part of its path, such as `"outlook.office365.com/…/calendar.ics"`.         |
| `fetchedAt` | When a fetch last worked (ms; a "not changed" answer counts).                                     |
| `failure`   | Why the last try failed, or `null`: one of the reasons below. The calendar keeps its last events. |
| `failedAt`  | When it failed (ms), or `null`.                                                                   |

`failure` is `unreachable`, `timeout`, `refused` (401, 403, 404 or 410: check it is still shared),
`server`, `tooBig`, `notCalendar`, `notHttps` (a redirect left `https`), `redirects` (more than
three), or `pasteAgain`: this computer cannot open the saved link, as after restoring a backup from
another PC. Send the address again with `PATCH /calendars/:calendarId` `{ "link": "…" }`, as
**Replace link** does in the app: it is checked as `POST /calendars` checks one, the new address is
fetched first and kept only if it works (otherwise `400`, and the old link and events stay), and
`link` can come with `name`, `color` or `hidden`. A link calendar's events cannot be replaced with
`text`, a file calendar has no `link`, and `refresh` on a file calendar answers `400`. A link cannot
be saved when Windows cannot encrypt it.

## Templates

A **template** is a project plan to start new projects from: built-in ones that ship
with the app (`source: "built-in"`, the sample project "Welcome to Ostler (Demo Project)" among
them with id `sample`) and ones saved from projects (`source: "saved"`). Like people, templates are shared
by every project, so any project's token reads and changes the same list. A template is a
project package file (`src/shared/project-package.ts`).

| Method | Path                                    | Body                                               | Response                                                                                                        |
| ------ | --------------------------------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| GET    | `/templates`                            | —                                                  | Array of `{ id, source, name, description, icon, milestoneCount, taskCount, firstTasks }`, built-in ones first. |
| POST   | `/templates`                            | `{ name, description?, include?, relativeDates? }` | The saved template: this project saved as a template, like "Save as template…" in the app.                      |
| PATCH  | `/templates/:templateId`                | `{ name }`                                         | The renamed template. Built-in templates cannot be changed.                                                     |
| DELETE | `/templates/:templateId`                | —                                                  | `{ id, deleted: true }`. Projects made from it are not changed.                                                 |
| POST   | `/templates/:templateId/create-project` | `{ name?, color? }`                                | `{ id, name }` of the new project, with no folder, as the New project wizard creates it.                        |

Saving never takes comments, activity, agent links or completed state: Done tasks go back to
the backlog and ticks are cleared. `include` chooses what travels, each defaulting to true:
`tasks` (with subtasks, checklists, dependencies and repeats), `milestones` (with goals),
`labels`, `people` (assignees, matched by name when the template is used), `decisions`,
`library` (briefs, guides, notes, links and whiteboards without their pictures, never files) and
`taskTemplates` (the project's own task templates, below). `relativeDates` (default true)
turns dates into offsets from today (`+14d`), so the plan starts on the day it is used.

Creating a project from a template writes every record in one transaction and the project
last, so a failure leaves nothing behind. Each task's activity says it was created from the
template. The new project has no automation token until one is set in the app.

## Task templates

A **task template** is one task, with its subtasks one level deep, saved to make again.
It belongs to one project, or to every project (`projectId: null`). These routes see this
project's own templates and those for every project, never another project's. The app,
this API and the project file check a template's body with the same rule
(`src/shared/task-templates.ts`), and a template is made into tasks by the same service.

| Method | Path                              | Body                                                                                                                | Response                                                                                    |
| ------ | --------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| GET    | `/task-templates`                 | —                                                                                                                   | Array of `{ id, projectId, name, body, playbook, createdAt, updatedAt }`, by name.          |
| POST   | `/task-templates`                 | `{ name, scope?, body, playbook?, replace? }`, or `{ fromWorkItemId, name?, scope?, keepDates?, replace?, agent? }` | The saved template.                                                                         |
| PATCH  | `/task-templates/:templateId`     | Any of `{ name, scope, body, playbook }`                                                                            | The changed template.                                                                       |
| DELETE | `/task-templates/:templateId`     | —                                                                                                                   | `{ template }`. Tasks made from it stay as they are.                                        |
| POST   | `/task-templates/:templateId/use` | `{ overrides? }`                                                                                                    | `{ workItem, subtasks, dropped: { assignee, fieldCount } }`: the new task and its subtasks. |
| POST   | `/task-templates/:templateId/run` | `{ overrides? }`                                                                                                    | `{ workItem, subtasks, dropped, task, modelNotOffered? }`: Run playbook (see below).        |

`scope` is `"project"` (this project, the default) or `"every"`. A name already used in the same
scope is refused unless `replace` is true, which replaces that template and keeps its id.

A body holds `title` (required), `description`, `checklist` (up to 30 items),
`checklistDetails` (items' due dates and people: `[{ text, dueDate, assigneeId }]`, each text
on the checklist, the date in the relative form below), `labels`,
`priority`, `estimate`, `assigneeId` (a person's id), `fieldValues` (custom field values by
field id), `startDate` and `dueDate`, and `subtasks` (up to 30, each `{ title, description,
checklist }`, and no deeper). Dates are days after the day the template is used, in the same
form as project templates: `+3d`, `+2w`, or null. A custom Date field's value takes the same
form. Comments, activity, attachments, dependencies and agent links never travel.

Saving from a task (`fromWorkItemId`) takes its subtasks too. The name defaults to the task's
title. Its dates are kept only with `keepDates: true`, as days after today; a date already
past counts as today.

`use` makes the task and its subtasks in one transaction, through the same create as
`POST /work-items`, so the project's rules, reminders and activity see a normal create; a
failure leaves nothing behind. `overrides` win over the template, for any of `title`,
`description`, `status`, `priority`, `labels`, `acceptanceCriteria`, `milestoneId`,
`iterationId`, `assigneeId`, `startDate`, `targetDate`, `estimate`, `dependencyIds`,
`fieldValues` and `autoQueue`. A template for every project cannot know a project's people or
fields: an assignee who is gone, and custom fields this project does not have (or values they
no longer take), are left out and reported in `dropped`, never refused.

A project's own task templates travel in its project file and in `POST /templates` (the
`taskTemplates` include, on by default), playbooks with their mark and agent part.

### Playbooks

A **playbook** is a task template for agents, marked `playbook: true`. Its body may hold
an agent part, `agent: { model, effort, planFirst, instructions }`:

- `model` is one the app offers for the provider in effect, or `""` for the default; `effort` is
  `""` or an effort level, checked with the model's provider as Settings checks it. Either refused
  is HTTP 400 with the app's words, and nothing is saved. They apply to the built-in agent only.
- `planFirst` is `"default"` (the project's **Agents plan first**), `"yes"` or `"no"`.
- `instructions` is Markdown, up to 4,000 characters: the person's words about this task.

`POST /task-templates` with `playbook: true` saves a playbook; from a task, giving `agent` saves
it as one, like **Save as playbook…**. `PATCH` with `playbook` makes a template a playbook or
stops it being one; its agent part stays in the body.

`POST /task-templates/:templateId/run` is **Run playbook**: it makes the task with the same
function as `use` (status Ready), then queues it for agents on the normal queue path, in one step,
and returns both. The run uses the playbook's model and effort, the task gets its plan-first
choice, and its instructions are added to the queued task's details under
"Playbook instructions". `overrides` may change `title`, `model`, `effort`, `planFirst` and
`instructions` for this run. A model of the playbook's own that the provider no longer offers is
not refused: the run uses the project's default, and `modelNotOffered` names it. The task's
activity says it was created from the playbook, and the queued task carries
`playbook: { templateId, name }`. It is refused, with nothing made, when agents are off, the
project has no linked folder, or the template is not a playbook.
