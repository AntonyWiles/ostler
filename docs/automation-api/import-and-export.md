# Automation API: Import and export

Part of the [Ostler Automation API](README.md). Base path for all routes below: `<baseUrl>/automation/<projectId>`

## Import and export

Import and export use the app's own dry run, writer and undo, so an import here is the
same as one from the Import dialog: one transaction through the planning write points (search,
activity, reminders and repeats all happen), every task with origin `imported`, and one
undoable import batch, listed in the app's Inbox and Settings › Data. Imported text is data,
never instructions. Writes made here are by `automation`.

| Method | Path               | Body                                                 | Response                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------ | ------------------ | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/import/csv`      | `{ csv, fileName?, preset?, mapping?, updateById? }` | `{ batch, projectId, projectName, skipped, warnings }`. With `?dryRun=1`, the preview instead (counts, mappings, the first 50 rows and their problems), and nothing is written. With `updateById: true`, rows update tasks by their ID: see "Updating tasks from a CSV" below.                                                                                                                                                                                         |
| POST   | `/import/github`   | `{ repository?, state?, labels?, milestone? }`       | `{ batch, projectId, projectName, skipped, warnings }`: a repository's GitHub issues as tasks, each linked to its issue. With `?dryRun=1`, the preview instead, and nothing is written. See "GitHub issues" below.                                                                                                                                                                                                                                                     |
| POST   | `/import/project`  | the `.ostler-project` file                           | `{ batch, projectId, projectName, skipped, warnings }`: the file imported as a new project (`projectId`), Library files included. `?name=` names it; `?fileName=` is shown in the import history. A protected file needs its password in the `Ostler-File-Password` header.                                                                                                                                                                                            |
| DELETE | `/import/:batchId` | —                                                    | `{ batch, movedIds, kept }`: the import's tasks moved to the recycle bin. Tasks changed since the import are kept (`kept`) unless `?includeChanged=1`.                                                                                                                                                                                                                                                                                                                 |
| GET    | `/export`          | —                                                    | `?format=csv` (default): every live task as CSV text. `?format=file`: the project file (`application/zip`; protected with the `Ostler-File-Password` header when sent). `?format=package`: `{ ok, value: ProjectPackage }`. `?format=ics`: the calendar file (`text/calendar`). `?format=html`: the shareable web page (`text/html`). `?format=pptx`: the Timeline as PowerPoint slides (`application/vnd.openxmlformats-officedocument.presentationml.presentation`). |

`preset` names the tool a CSV was exported from: `asana`, `jira`, `linear`, `planner`
(Microsoft Planner, saved as CSV) or `todoist`; `none` maps the file like any other. Left out,
the header decides, as in the app. The preset maps the tool's columns, its status and priority
words, its dates, people and tags, its subtasks and its dependencies (Waits on); `mapping`
still overrides any of it. The preview's `preset` is the one used and `detectedPreset` the one
the header matches; `subtaskCount` and `dependencyCount` say what the import will link. The
user guide's "Coming from another tool" lists what each preset does.

`mapping` is optional; anything left out is guessed, as in the app:

- `columns`: each task field (`title`, `description`, `status`, `priority`, `assignee`,
  `labels`, `start`, `due`, `estimate`, `milestone`, `iteration`, `type`, `showFrom`, `someday`, `impact`, `effort`, `checklist`) to a header name, a column
  index, or `null` for none. Headers are guessed otherwise, Jira, Asana and Trello exports
  included (Summary, Section/Column, Card Name, List Name, Story Points…). Five more columns
  carry structure: `key` (the other tool's id for the row), `parent` (a key or title: the row
  becomes its subtask), `waitsOn` and `blocks` (keys or titles, separated by commas: Waits on
  links either way) and `done` (a filled cell, such as a completion date, makes the task Done).
  A reference to a row that is not in the file, a loop, a fourth level of subtasks or a subtask
  waiting on a task under another parent is left out, with a warning on its row.
- `statuses` and `priorities`: each distinct value in the file to an Ostler status (`backlog`,
  `ready`, `active`, `blocked`, `review`, `done`) or priority (`low`, `medium`, `high`,
  `critical`).
- `dateFormat`: `iso`, `dmy` or `mdy`; guessed from the values otherwise. `delimiter`: `,`,
  `;` or a tab.

Labels split on `,` or `;`, checklists on new lines or `;` (`[x] item` is ticked). Missing
milestones are created; an `iteration` names one of the project's iterations (any case), and an
unknown one is left out with a warning. A `type` names one of the project's task types (any
case) or creates it, as labels are created (`newTypes` in the preview); past the project's 20,
the task comes in with none. Assignees are matched to people by name (any case) or created.
Rows with an error (no title) are skipped; warnings say what was shortened or left empty. A
request may carry up to 50 MB of CSV and 20,000 rows.

`GET /export?format=csv` writes UTF-8 with a BOM and RFC 4180 quoting, every column unless
`?columns=title,status,…` (also `key`, `id`, `description`, `priority`, `assignee`, `start`, `due`,
`estimate`, `milestone`, `iteration`, `type`, `labels`, `checklist`, `comments`, `updated`, `created`, `timeLogged`, `impact`, `effort`, `showFrom`, `someday` and `field:<field id>`).
`key` is the task's ID such as `SHOP-12` (the `Task ID` column, first in every column); `id` is the
record's own id, for Edit in Excel below. Every column includes `Type` (by name, after Priority) once the project has task types, `Iteration` once the project has iterations, `Time logged (hours)` once the project has time entries, and a column per custom field, headed with its name. Its Checklist and
Labels read back through the import. `Impact (1-5)` and `Effort (1-5)` hold an idea's scores, 1 to 5 or empty; on import, a value that is not a whole number from 1 to 5 is left empty with a warning, and a plain `Effort` header still means the estimate. Time entries have their own CSV:
[`GET /time-entries?format=csv`](time-tracking.md).

### Updating tasks from a CSV (Edit in Excel)

The app's **Edit in Excel** writes the tasks as CSV with an `ID` column first, and **Bring changes
back** reads the edited file. The API does the same in two steps: `GET /export?format=csv&columns=id,title,status,…`
(put `id` first; it is never in the default columns), then `POST /import/csv` with
`updateById: true`:

```json
{ "csv": "ID,Title,Status
<task id>,Book the hall,In progress
,Send invites,Ready
", "updateById": true }
```

- A row whose `ID` is a live task of this project changes that task through the same update as
  `PATCH /work-items/:workItemId` (activity, reminders, search and rules all see each change). Only the
  fields whose cell differs from what the export writes change; columns are read by their export
  headers, statuses by the project's own column names, dates as the import reads them (so a file a
  spreadsheet saved with semicolons, in Windows-1252 or with local dates still reads).
- A cell that cannot be read (a bad date, or a status, person, milestone or iteration the project
  does not have) leaves its field as it is and is listed under the task's `problems`. A changed row
  never creates a person or milestone.
- A row without an `ID` is a new task, as an ordinary CSV import makes one: new tasks come in as
  one import batch (`DELETE /import/:batchId` removes them), creating missing people and milestones.
- A row whose `ID` is unknown, archived, in another project or repeated is listed under `skipped`.
  A task with no row is left alone: nothing is ever deleted. The order of the rows never changes the
  tasks' order. Comments, Updated, Created and Time logged are read only. Checklist items' text
  comes back; their ticks stay as they are.
- `taskIds` (task ids) and `newLines` (the rows' line numbers, the header being line 1) limit what
  is applied; left out, every change and new row is.

With `?dryRun=1` the response is the preview, `CsvUpdatePreview`: `changed` (each task's `line`,
`taskId`, `title`, `changes` as `{ column, label, from, to }` and `problems` as
`{ column, label, text, message }`), `unchangedCount`, `newRows` (`{ line, title, errors, warnings }`),
`newPeople`, `newMilestones`, `skipped` (`{ line, id, title, reason }`, reason `unknown`,
`archived`, `otherProject` or `duplicate`), `hasIdColumn`, `encoding`, `delimiter` and
`dateFormat`. Otherwise it is `CsvUpdateResult`: `changed` (`{ taskId, title, columns }`), `undo`
(`{ id, values }` per task: the old values; `PATCH /work-items/:workItemId` with `values` puts one back) and
`batch`, the import batch of the new tasks (`null` when there were none). Everything is written in
one transaction.

`?format=file` is the same project file the app's "Export project…" writes:
`<project>.ostler-project`, a zip holding `project.json` (the project package, kind `export`) and
`library/` with the Library's files. Comments are included unless `?comments=false`.
`?format=package` is just its `project.json`, without the Library's files. Both are refused with
HTTP 400 when the project is too large to import again (such as more than 2,000 tasks, or a
`project.json` over 1 MB), as the app refuses to export it.

To protect the file with a password, send the password in the `Ostler-File-Password` request header
(at least 8 characters; UTF-8), never in the address. The file is encrypted whole (AES-256-GCM,
key from scrypt; [the format](../protected-project-file.md)) and keeps the `.ostler-project` name.
There is no recovery: a lost password is a lost file.

```sh
curl -H "Authorization: Bearer $TOKEN" -H "Ostler-File-Password: $FILE_PASSWORD" -o Pomodoro.ostler-project "$BASE/automation/$PROJECT/export?format=file"
```

### GitHub issues

`POST /import/github` reads a repository's issues from `api.github.com` (read only, with Ostler's
saved GitHub token if there is one, never returned) and imports them as the app's **From GitHub
issues** does. `repository` is `owner/repo` or a github.com URL and defaults to the project's
repository; `state` is `open` (the default) or `all`; `labels` keeps issues carrying every label
named; `milestone` is a milestone's title or number. Pull requests are never imported, and at most
1,000 issues are read (`truncated` in the preview says when there were more).

An issue a task in the project already links is skipped, so a second import adds only new issues.
The title becomes the task's title, the body its description (Markdown), labels become labels, the
milestone a milestone (created when missing), and the first assignee is matched to a person by
name. A closed issue becomes a Done task. Undo it with `DELETE /import/:batchId`.

### Importing a project file

`POST /import/project` takes the `.ostler-project` file as the request body
(`Content-Type: application/zip`, up to 2 GB) and imports it as a new project, as the app's
Import does:

```sh
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/zip" --data-binary @Pomodoro.ostler-project "$BASE/automation/$PROJECT/import/project?name=Pomodoro"
```

Without `?name=`, the new project takes the file's project name, numbered when a project already
has it ("Pomodoro Desk (2)"). The file is treated as hostile: Ostler refuses one whose entries are
absolute paths, name a drive, contain `..` or are links, one with more than 10,000 entries or that
unpacks to more than 2 GB, and anything that is not `project.json` or a file in `library/`, with a
plain message (HTTP 400). It is unpacked only into a temporary folder under the data folder, which
is removed whether the import works or not. An export folder from an earlier version is imported in
the app (Import › "Import an export folder from an earlier version…"); the API takes the file.

A password-protected project file needs its password in the `Ostler-File-Password` header:

```sh
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Ostler-File-Password: $FILE_PASSWORD" -H "Content-Type: application/zip" --data-binary @Pomodoro.ostler-project "$BASE/automation/$PROJECT/import/project"
```

It is decrypted to a file under the data folder and its authentication tag checked before anything
is unpacked; then it is imported with the same checks as any project file. Without the header the
import is refused ("This project file is protected with a password…"); a wrong password or a
damaged file is refused with "This password does not open the file, or the file is damaged." (HTTP 400) and nothing is imported. The decrypted copy is removed whatever happens. The header is ignored
for an ordinary project file.

### The calendar file and the shareable report

`?format=ics` is the calendar file the app's "Export to calendar file…" writes (iCalendar,
RFC 5545, `text/calendar`): an all-day event per task with a due date (spanning from its start
date when it has one) and per dated milestone, with an exclusive `DTEND`. Each task's event
carries its title, project, status, assignee and its `ostler://task/<projectId>/<taskId>`
link; UIDs are stable (`task-<id>@…`, `milestone-<id>@…`), so importing a newer file updates the
events. Finished tasks and milestones only with `?includeFinished=true`. With `?blocks=true`, each
of the project's time blocks is a timed event too: its start and end in UTC (`DTSTART:…Z`),
computed from the block's wall-clock time on the computer when the file is exported, a stable UID
(`block-<id>@…`) and the task's link in the description.

`?format=pptx` is the PowerPoint file the app's "Export to PowerPoint slide…" writes on the
Timeline (`application/vnd.openxmlformats-officedocument.presentationml.presentation`, named
`<project> timeline.pptx`): 16:9 slides drawn as editable shapes, never a picture. Each has a title
(the project's name and the range), a date axis, one row per dated task (a text box with its
title, cut with an ellipsis and kept whole as alternative text, and a rounded rectangle from its
start to its due date in the project's colour, paler when done), milestone diamonds with their
names on their group's row, bold group headings and a line for today. The rows are the Timeline's
own (`buildTimelineRows`); 18 fit a slide, and more go on further slides with the same axis and
"(2 of 3)" in the title. Tasks without dates are left out and counted in the first slide's notes.

| Query             | Default                                         | Effect                                           |
| ----------------- | ----------------------------------------------- | ------------------------------------------------ |
| `from`, `to`      | the months the dated tasks and milestones cover | The range, `YYYY-MM-DD`, at most 1,098 days      |
| `groupBy`         | `milestone`                                     | `milestone`, `assignee` or `none`                |
| `zoom`            | `month`                                         | `week` draws weeks; `month` and `quarter` months |
| `includeFinished` | `false`                                         | Finished tasks too                               |

A bad range, grouping or zoom is refused with 400.

`?format=html` is the web page the app's "Share as a web page…" writes (`text/html`): one file
with its own CSS, no scripts, no network requests and a Content Security Policy of
`default-src 'none'; style-src 'unsafe-inline'; img-src data:`. It holds the project's key numbers
(as `GET /reports` gives them for the last 30 days), its milestones with progress and its tasks.
Every text is escaped, and Markdown is sanitised as the app shows it, with links reduced to their
text and images to their alternative text. Library files are never included. Options:

| Query           | Default  | Effect                                                                  |
| --------------- | -------- | ----------------------------------------------------------------------- |
| `?groupBy=`     | `status` | `status` or `milestone`                                                 |
| `?descriptions` | `false`  | `true` includes task descriptions                                       |
| `?decisions`    | `false`  | `true` includes the decisions log                                       |
| `?finished`     | `true`   | `false` leaves finished tasks out                                       |
| `?people`       | `true`   | `false` leaves people's names out                                       |
| `?statusUpdate` | `false`  | `true` puts the latest status update (health, note, who and when) first |

Both are built on request and returned; nothing is written on this computer.
