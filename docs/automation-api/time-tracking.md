# Time tracking

Time entries on tasks and the one timer that runs across Ostler, as the app's Time section, status
bar and Timesheet use them. Base path: `<baseUrl>/automation/<projectId>`.

An entry:

```json
{
  "id": "…",
  "projectId": "…",
  "workItemId": "…",
  "workItemTitle": "Write the brief",
  "personId": "…",
  "startedAt": 1792400000000,
  "durationSeconds": 5400,
  "note": "First draft",
  "source": "manual",
  "billable": true,
  "billingId": null,
  "createdAt": 1792400000000,
  "updatedAt": 1792400000000
}
```

- `startedAt` is epoch milliseconds. An entry belongs to the local day it started on.
- `durationSeconds` is whole seconds, at most a week. It is `null` while the entry is the running
  timer; its elapsed time is now minus `startedAt`.
- `source` is `timer` for an entry a timer wrote, `manual` for one added by hand.
- `personId` is a person from `GET /people`, or null. New entries default to Me.
- `billable` says whether the time is charged for. New entries, by hand or from the timer, start
  with the project's `newTimeBillable` (see [Billable time](#billable-time)).
- `billingId` is the billing the entry was marked billed in, or null. A billed entry is locked.

## Entries

| Route                           | What it does                                                                                                                                                                                                                      |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /time-entries`             | The project's entries in start order. `?from=YYYY-MM-DD&to=YYYY-MM-DD` keeps the local days between (inclusive), `?workItemId=` one task's, `?personId=` one person's (`nobody` for none). `?format=csv` returns the CSV instead. |
| `GET /time-entries/:entryId`    | One entry.                                                                                                                                                                                                                        |
| `POST /time-entries`            | Logs time by hand. Body: `{ workItemId, startedAt, durationSeconds? , duration?, note?, personId?, billable? }`.                                                                                                                  |
| `PATCH /time-entries/:entryId`  | Changes `startedAt`, `durationSeconds` (or `duration`), `note`, `personId` or `billable`. A running timer's duration cannot be set: stop it first.                                                                                |
| `DELETE /time-entries/:entryId` | Deletes an entry (a running timer stops with it) and returns it.                                                                                                                                                                  |
| `POST /time-entries/restore`    | Undoes a delete. Body: what the delete returned.                                                                                                                                                                                  |

`startedAt` may be epoch milliseconds or a local date and time, `"2026-10-14T09:30"`. Send the
length as `durationSeconds`, or as `duration` in the forms the app reads: `"1h 30m"`, `"1.5h"` or
`"90m"` (the API always reads `.` as the decimal point). The task must be in this project and not
archived or in the recycle bin.

```http
POST /automation/<projectId>/time-entries
{ "workItemId": "…", "startedAt": "2026-10-14T09:30", "duration": "1h 30m", "note": "Client call" }
```

The CSV is the Timesheet's export: `Date, Project, Task, Person, Duration (hours), Note`, one
record per entry, the duration in hours as a plain number (`1.5`) so a spreadsheet can add the
column up. UTF-8 with a byte order mark, as the task export.

A billed entry refuses `PATCH` and `DELETE` with HTTP 400 and the app's words, such as "This time
was billed on 3 March; unmark the billing to change it", until its billing is unmarked.

## Billable time

A project has an hourly rate, in whole minor units of its currency (the budget's, see
[Budgets and costs](budgets-and-costs.md)) per hour, and a default for new time. The Time report
counts any local days; marking a range as billed records a billing that keeps its totals and locks
its entries.

| Route                         | What it does                                                                                                                        |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `GET /billing-settings`       | `{ projectId, hourlyRate, newTimeBillable, currency }`. `hourlyRate` is minor units per hour, or null.                              |
| `PUT /billing-settings`       | Body `{ hourlyRate?, newTimeBillable? }`; a field left out keeps its value. Changes no existing entry, and no billing.              |
| `GET /time-report`            | `?from=YYYY-MM-DD&to=YYYY-MM-DD` (both required, inclusive): the Time report. `?format=csv` returns its CSV.                        |
| `GET /billings`               | The project's billings, newest first.                                                                                               |
| `POST /billings`              | Body `{ from, to }`: Mark as billed. The range's finished, billable, unbilled entries join a new billing. No such time is HTTP 400. |
| `GET /billings/:billingId`    | One billing of this project. An unknown id, or another project's, is HTTP 400.                                                      |
| `DELETE /billings/:billingId` | Unmark: the billing goes and its entries are unlocked. Returns `{ billing, entryIds }`.                                             |
| `POST /billings/restore`      | Undoes an unmark. Body: what the delete returned.                                                                                   |

The report:

```json
{
  "projectId": "…",
  "from": "2026-10-01",
  "to": "2026-10-31",
  "currency": "GBP",
  "hourlyRate": 6000,
  "totals": { "seconds": 7200, "billableSeconds": 5400, "amount": 9000 },
  "unbilled": { "seconds": 7200, "billableSeconds": 5400, "amount": 9000, "tasks": [ … ] },
  "billed": { "seconds": 0, "billableSeconds": 0, "amount": null, "tasks": [] },
  "running": [],
  "billings": []
}
```

- An entry counts on the local day it started, as on the Timesheet, even when it runs past midnight.
- `amount` is billable hours times the rate, in minor units, rounded once at the end of each total
  (never entry by entry), or null when none of the billable time has a rate. Billed time is charged
  at the rate its billing kept, so a new rate changes unbilled amounts only.
- Each task in `tasks` is `{ workItemId, title, seconds, billableSeconds, amount, entries }`.
- `running` lists a running timer's entry. It is not counted, and not billed until it stops.

A billing is `{ id, projectId, from, to, markedAt, entryCount, billableSeconds, hourlyRate, amount,
currency }`: the totals when it was marked.

The report's CSV is `Date, Task, Person, Note, Hours, Billable, Amount, Billed`: hours as a plain
number, billable `yes` or `no`, the amount as a plain decimal with a dot (empty without a rate), and
billed as the day its billing was marked (empty when unbilled). UTF-8 with a byte order mark.

```http
POST /automation/<projectId>/billings
{ "from": "2026-10-01", "to": "2026-10-31" }
```

Ostler AI may read rates, amounts and billings; no AI feature uses them yet.

## The timer

One timer runs at a time across Ostler. Starting one stops any other, in any project.

| Route               | What it does                                                                                                                                                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /timer`        | `{ running, interrupted }`. `running` is the running entry (perhaps another project's) or null. `interrupted` is `{ entryId, closedAt }` while Ostler is waiting for the person to keep or stop a timer found running at start. |
| `POST /timer/start` | Body `{ workItemId }`: starts a timer on a task of this project, for Me. Returns `{ started, stopped }`; `stopped` is the timer it stopped, or null.                                                                            |
| `POST /timer/stop`  | Stops the running timer now and returns its entry, or null when none runs. A timer stopped within its first second keeps no entry.                                                                                              |

Stopping a timer is an ordinary write: it involves no agent, harness or AI.

## Focus

A focus is a countdown on the one timer, held in memory: closing Ostler ends it. Like the timer it
is global, so `GET /focus` may name another project's task.

| Route           | What it does                                                                                                                                                                                                                           |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /focus`    | The focus, or null: `{ id, projectId, workItemId, workItemTitle, entryId, minutes, startedAt, endsAt, phase, breakEndsAt }`. Time left is `endsAt` minus now.                                                                          |
| `POST /focus`   | Body `{ workItemId, minutes }`: focuses on a task of this project for 5 to 180 whole minutes. Starts the task's timer for Me (a running timer stops) and returns `{ focus, timer: { started, stopped } }`. A running focus ends first. |
| `DELETE /focus` | Stops the focus. While it counts down or after it ended, its timer stops too (now, or at `endsAt` if that has passed); on a break, the break ends. Returns null.                                                                       |

`phase` is `focus` while it counts down (desktop notifications are held, Inbox items still arrive),
`ended` once it reached `endsAt` and the person has not chosen (the timer keeps running), and
`break` while a break counts down to `breakEndsAt` (the timer stopped at `endsAt`). Stopping the
timer (`POST /timer/stop`, or starting another) ends the focus. The break and the end's choice are
the person's, in the app. The time is logged as an ordinary time entry.

## In and out

A project file (`GET /export?format=file` or `format=package`) carries the project's finished time
entries (`timeEntries`, with `billable` and `billingRef`), the rate and default
(`billingSettings`) and the billings (`billings`); a running timer is left out. Templates carry the
rate and default only, never time entries or billings.
`GET /export?format=csv` adds a `Time logged (hours)` column once the project has any entries.
`GET /reports` gives `keyNumbers.timeLoggedSeconds`, the time logged on entries that started in the
range, once the project has any entries.
