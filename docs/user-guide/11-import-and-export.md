# Import and export

## Import

Ostler imports:

- **A spreadsheet (CSV)**, for example exported from Excel, Google Sheets or another tool. You match
  its columns to task fields, such as title, status, due date and assignee. Under **Custom fields**,
  a column no task field uses can fill one of the project's custom fields, or make a new field
  named after the column (Ostler suggests a type from its values; a new choice field takes its
  options from them). A column named like one of the project's fields goes to that field unless you
  choose otherwise. A value a field can't take, such as a word in a Number field, is left out and
  the preview says so.
- **A Trello board**, exported from Trello as JSON. Lists become statuses, cards become tasks, and
  checklists, labels and due dates come across.
- **An Ostler project file** (`.ostler-project`), exported from Ostler on this or another computer.
  It becomes a new project, with its milestones, tasks, comments, GitHub links and Library files.
  A file protected with a password asks for its password first
  ([Protect with a password](#protect-with-a-password)).
- **GitHub issues**, read from a repository with **From GitHub issues…** rather than a file. Each
  task links its issue, and a second import skips issues already linked ([GitHub](22-github.md)).

Start an import from the welcome, from **New project** › **Import into a new project**, from a
project's **More** › **Import tasks…**, or from Settings › Data, then **Choose a file…**. Before
anything is written, you see a preview with any problem rows marked.

The new project is named after the file. If a project already has that name, Ostler proposes the
next free one, such as "Pomodoro Desk (2)", and says why under the name. You can change it; two
projects can share a name if you want them to.

Ostler checks a project file before it unpacks it. It refuses one that tries to write outside the
project, holds links, has more than 10,000 files or unpacks to more than 2 GB, and says why. A
project file is unpacked only into a temporary folder inside Ostler's data folder, which is removed
when the import finishes or is cancelled.

### Coming from another tool

Ostler recognises the CSV exports of Asana, Jira, Linear, Microsoft Planner and Todoist. When you
choose one, the mapping step says "This looks like an export from Asana" (or the tool it is) and
fills in the columns and values for you: statuses, priorities, dates in the tool's own format,
assignees (matched to people by name, or created), tags as labels, subtasks, and dependencies as
**Waits on**. Every choice stays yours to change, and **Exported from** › **Map columns myself**
maps the file like any other spreadsheet. The preview says how many subtasks and Waits on links the
import makes.

A subtask or a dependency comes across only when both tasks are in the file. A link to a task that
isn't, one that would go round in a loop, a fourth level of subtasks, or a subtask waiting on a
task under another parent is left out, and the preview marks the row and says why. Ostler reads the
English words each tool writes; if you used a tool in another language, check the status and
priority values in the mapping step.

- **Asana**: in the project, open the menu beside the project's name, then **Export/Print** ›
  **CSV**. Sections become statuses, and a completed task is Done. Subtasks and **Blocked By** /
  **Blocking** dependencies come across, and so does a **Priority** field.
- **Jira**: search for the issues (for example, all of a project's), then **Export** › **Export CSV
  (all fields)**. Statuses and priorities come across, sprints become milestones, every Labels
  column becomes labels, Story Points the estimate, a resolved issue is Done, subtasks keep their
  parent, and **Blocks** links become Waits on.
- **Linear**: **Settings** › **Import / Export** › **Export CSV** for the workspace, or a view's
  **Export as CSV**. Statuses come across (Todo becomes Ready; Canceled and Duplicate become Done),
  priorities too (Urgent is Critical), project milestones become milestones, and sub-issues keep
  their parent. Linear's CSV has no dependency column.
- **Microsoft Planner**: open the plan's **…** menu and choose **Export plan to Excel**, then open
  the file in Excel and **Save As** › **CSV UTF-8**. Progress becomes the status, buckets become
  milestones, Urgent and Important become Critical and High, and checklist items come across
  (unticked). A task assigned to several people goes to the first of them.
- **Todoist**: open the project's **…** menu, choose **Export as a template**, and download it as
  a CSV file. Sections become statuses, indented tasks become subtasks (three levels at most),
  `@labels` in a task's name become labels, and p1 to p4 become Critical, High, Medium and Low. A
  due date is read when it is a date ("Oct 20 2026"); a repeating one ("every day") is left empty
  and the preview says so. Notes and completed tasks are not in Todoist's export.

### An export folder from an earlier version

Earlier versions of Ostler exported a project as a folder named `<project>.ostler-project`. To import
one, choose **Import an export folder from an earlier version…** under **Choose a file…**, and pick
the folder. It imports the same way as a project file.

### Undo an import

Every import is listed in Settings › Data and in your Inbox. **Undo import** removes what it added.
If you've changed some of the imported tasks since, Ostler asks before removing those.

## Export

From a project's **More** menu:

- **Export project…** saves the whole project as one Ostler project file, `<project>.ostler-project`,
  to move it to another computer, send it as an email attachment or keep a copy. It holds the tasks,
  milestones, goals (with their measures and check-ins), labels, custom fields and their values, time entries, people, decisions, saved views and the
  Library with its files, and comments unless you turn them off. Agent history and settings stay on this computer. (The file is a zip; you
  don't need to unpack it.) A project file holds at most 2,000 tasks and 1 MB of text (Library
  files are not counted); Ostler refuses to export a bigger project, because no Ostler could import it.
  Tick **Protect with a password** to encrypt the file
  ([Protect with a password](#protect-with-a-password)).
- **Export all tasks** saves every task as a CSV spreadsheet, with a column for each custom field,
  headed with its name, and a Time logged column (in hours) once the project has time entries.
- **Export CSV** in the Timesheet saves time entries for any range of days
  ([Time tracking](20-time-tracking.md)).
- **Export this view to CSV…** (in the List) saves just the tasks you see.
- **Edit in Excel** (in the List's toolbar and the **More** menu) saves the tasks as a CSV you can
  edit and bring back ([Edit in Excel](#edit-in-excel)).
- **Print…** and **Save as PDF…** (in the List, Overview and Timeline) print the view or save it as
  a PDF.
- **Print my week** and **Save my week as PDF** (in Home's menu, the Calendar's Agenda and the
  command palette) print your Today and the next seven days, across every project, on one sheet
  ([Print my week](05-home-and-inbox.md#print-my-week)).
- **Export to calendar file…** (in the Calendar, or from the command palette) saves the project's
  due dates as a calendar file, `<project>.ics`.
- **Export to PowerPoint slide…** (in the Timeline) saves the Timeline as slides you can edit,
  `<project> timeline.pptx` ([PowerPoint slides](#powerpoint-slides)).
- **Share as a web page…** saves the project as one web page, `<project>.html`, to send to a
  client or a team.

### Protect with a password

A project file holds the whole project, so anyone who finds it (on a USB stick, in a shared folder
or an email) can import it. To stop that, tick **Protect with a password** in **Export project…**,
and type the password twice. It needs at least 8 characters; the hint under the field says how
hard it is to guess, but any password of 8 characters or more is accepted. A few words together
make a long password that is easy to remember.

> There is no way to recover a lost password. Without it, this file cannot be opened by anyone,
> including you.

Ostler encrypts the whole file (with AES-256-GCM, under a key made from the password with scrypt).
It keeps the `.ostler-project` name. The password is used for that export only: Ostler never stores
it, writes it to its log or keeps it once the export is done. To change a file's password, export
the project again.

To import a protected file, choose it in **Import** as usual: Ostler asks for its password. It
checks the whole file before unpacking anything; a wrong password, or a file that was changed or
damaged, says "This password does not open the file, or the file is damaged" and nothing is
imported. The decrypted copy is kept only under the data folder while it is read, and removed
whatever happens.

The file's format is described in [Protected project files](../protected-project-file.md).

### Edit in Excel

Some edits are quicker in a spreadsheet: re-dating forty tasks, filling in estimates down a column,
renaming a batch with a formula. **Edit in Excel** saves the project's tasks (in the List: the tasks
you see, in its columns) as a CSV with each task's **ID** in the first column. Pick where to save it
(Documents by default) and choose **Save**; Ostler opens it in your spreadsheet app, usually Excel. A panel at the top
of the project shows the file's name, with **Bring changes back** and **Done**.

Edit the file, save it as CSV (Excel may ask whether to keep the format: keep it), then choose
**Bring changes back**. To bring back a different file, such as a copy you saved elsewhere, choose
**Another file…**. Ostler reads it the way it reads any CSV import, so a file Excel saved with
semicolons, in the Windows code page or with dates in your local format still reads. Nothing changes
until you choose **Apply** in the preview:

- **Changed tasks**: each row whose ID is a task in this project, with every field that differs,
  old and new. Untick a task to leave it as it is.
- **New tasks**: rows with an empty ID become new tasks, as an ordinary CSV import makes them,
  adding any people and milestones they name.
- **Left out**: a row whose ID is not a task in this project, is archived or in the recycle bin, or
  repeats an earlier row's ID.
- A cell Ostler can't read (a date that isn't one, a status, person, milestone or iteration the
  project doesn't have) is shown, and that field is left as it is. A changed row never adds a
  person or milestone, so a typo can't make one.

Nothing is ever deleted: a task whose row you removed stays as it is, and sorting the rows doesn't
change the order of your tasks. Comments, Updated, Created and Time logged are only there to read.
A checklist's items come back, but their ticks stay as they are in Ostler.

When you apply, each change shows in its task's activity, as if you'd made it in the app. The toast
offers **Undo**, which puts every changed task back as it was. New tasks come in as an import, so
**Undo import** in Settings › Data removes them later. Keep the file open in Excel while you work;
if Ostler can't read it, close it in Excel and try again.

### A calendar file

Every task with a due date becomes an all-day event: on its due date, or from its start date to
its due date when it has both. Dated milestones are all-day events too. Finished tasks and
milestones are left out unless you tick **Include finished tasks**. Each event holds the task's
title, the project, its status and assignee, and a link that opens the task in Ostler.

Tick **Include time blocks** to add your [time blocks](04-views.md#time-blocks) too: each one an
event at its time, with the task's link. Its time is worked out from your computer's clock when you
export, so it lands at the right hour in any calendar.

The file is a copy of the dates as they are now, not a live feed: export it again after plans
change. Importing a newer file updates the events it brought in before, in calendars that
recognise them, instead of adding them twice.

- **Outlook (classic):** **File** › **Open & Export** › **Open Calendar** or **Import/Export**, and
  choose the file. Or double-click the file and choose to import it.
- **New Outlook and Outlook on the web:** **Calendar** › **Add calendar** › **Upload from file**.
- **Google Calendar:** on the web, **Settings** › **Import & export** › **Import**, choose the file
  and the calendar to add it to.

### PowerPoint slides

**Export to PowerPoint slide…** in the Timeline's **More** menu turns the Timeline into slides for
a deck. The slides hold the tasks the Timeline shows now, in its grouping and with its filter and
search; **From** and **To** start as the Timeline's range, and you can change them. Each slide is
16:9, with the project's name and the range as its title, a date axis along the top (weeks at the
Week zoom, months otherwise), and one row per task: its title on the left and its bar from its
start to its due date, in the project's colour, paler when the task is done. Milestones are
diamonds with their names, group headings are bold, and a thin line marks today.

Every bar, diamond, label and line is its own shape, so in PowerPoint you can move it, recolour it
or retype it. A title too long for the label column ends with "…"; the full title is in the shape's
alternative text. About 18 rows fit a slide, and more rows go on further slides with the same axis
and "(2 of 3)" in the title. Tasks without dates are left out, and the first slide's notes say how
many. The slides are a copy of the plan as it is now: export them again after plans change.

### A web page to share

The page shows the project's name, its key numbers (as on the Overview), its milestones with their
progress, and its tasks grouped by status or by milestone, with their status, assignee and dates.
Choose what goes in:

- **Include task descriptions** (off at first)
- **Include the decisions log** (off)
- **Include finished tasks** (on)
- **Include people's names** (on)
- **Include the latest status update** (off): its health, note and date, at the top
  ([Status updates](12-reports.md#status-updates))

Ostler remembers your choices. The page is one file with no scripts and nothing to download: it
opens in any browser, even offline, and prints cleanly. Library files and images are never
included, and links in descriptions keep only their text.
