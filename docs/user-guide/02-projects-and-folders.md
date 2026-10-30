# Projects and folders

A project holds everything for one piece of work: its tasks, milestones and goals, decisions, and
the documents in its Library.

## Create a project

Use **+** next to Projects in the sidebar, or "New project" in the command palette. You choose:

- **How to start:** blank, from a template, the demo projects (both are added), or an import.
- **How to begin**, for a blank project or a template: **Start working now** (Active), or **Plan it
  first**, which starts the project in Planning and opens it at its
  [Plan](06-milestones-and-goals.md#plan-a-project).
- **Where it lives:**
  - **Just in Ostler**, for most projects. There is nothing on disk to manage.
  - **A folder on this PC**, for a project that already has files. Ostler reads the folder and never
    writes into it.
  - **A new folder**, which Ostler creates for you, with a README, a `.gitignore` (general, Node.js,
    Python or .NET) and a Git repository if you want them. Ostler shows you exactly what it will
    write before it writes it.
- **A name and a colour.**

## Folders are optional

A project doesn't need a folder. If it turns out to be software, link one later in the project's
settings (**More** › **Project settings**). Linking a folder adds:

- the **Files** view, to browse and edit the folder's files and see Git activity
- the **History** view, to undo work Ostler applied to the folder (see [Agents](14-agents.md#history))
- the **Agents** view, when AI agents are on (see [Agents](14-agents.md))

Unlinking a folder removes those views again. Your tasks stay where they are.

## Organise your projects

- Drag projects in the sidebar to reorder them, or select one and press `Alt` + `↑` or `↓`.
- Right-click a project for Rename, Colour, New workstream, Project settings, Archive project and
  Remove. A big project can be split into [workstreams](31-workstreams.md), shown under it in the
  sidebar.
- **Archive** hides a project you've finished without deleting anything. Archived projects are
  listed in Settings › Projects, where you can bring them back.
- **Remove** opens Project settings › **Remove**, with every way to be done with a project on
  one screen ([Remove a project](#remove-a-project)).

### Areas

Areas group your projects, such as Home, Work and Side projects. A project is in one area or none.

- Make one with **New area** in the `…` menu beside **Projects** in the sidebar, in any project's
  right-click menu, or in Settings › Projects › Areas.
- Put a project in an area by dragging it onto a project or a heading there, with **Move to area**
  in its right-click menu, or with **Area** in its Project settings. **No area** is last, and holds
  every project not in an area.
- Click an area's heading to fold it; Ostler remembers which areas you folded on this computer.
- Reorder areas by dragging their headings, by selecting one and pressing `Alt` + `↑` or `↓`, or
  with **Move up** and **Move down** in its right-click menu. Within an area, projects keep the
  sidebar's order.
- **Rename** and **Remove** are in an area's right-click menu and in Settings › Projects. Removing an
  area moves its projects to No area and changes nothing else about them; **Undo** in the message
  puts it back as it was.

Home's project cards, every project picker (Quick add, search, My work, Workload, the Timesheet,
import and the rest) and the command palette group projects the same way. Typing in a picker still
finds any project. With no areas, projects show in one list as before.

### Project icons

Besides its colour, a project can have an icon, so you can tell it apart without relying on colour.
Choose one in Project settings or the New project wizard: there are about seventy everyday icons
(a house, a briefcase, a plane, a book and so on), **Search icons** finds one by name, and **None**
goes back to the colour dot. The icon shows in the project's colour in the sidebar, on Home's cards,
in the project's header, the title bar, search results, the Inbox and the command palette. Screen
readers announce the project's name, not its icon.

### Stages

Every project has a stage: **Planning**, **Active**, **On hold** or **Done**. A new project starts
Active unless you choose **Plan it first**. Change it on Home's [board of projects](05-home-and-inbox.md#board-of-projects) or with
**Stage** in Project settings.

A project in Planning has a **Plan** tab, and Home opens it there. When you're ready, **Start the
project** on the Plan moves it to Active. See [Plan a project](06-milestones-and-goals.md#plan-a-project).

On hold and Done projects step out of your daily lists: they leave Home's Today, Upcoming and
Needs you, and My work, and their blockers stop showing in the Inbox. Everything else stays:
reminders you set still fire and reach the Inbox, agent questions and reviews still arrive in the
Inbox, and agents and
auto-dispatch work as before. Move a project back to Planning or Active and its tasks are back in
Today at once. In the sidebar, an On hold or Done project shows its stage quietly beside its name,
in the same place as before.

A stage is not archiving and not turning a project off: archiving stays where it is, and a project
that is turned off leaves everything, whatever its stage.

### Pins and shortcuts

Pin the things you open all day, so each is one click away: a task, a milestone, a decision, a
Library item (a note, a file or a link), a saved view, or one of a project's views such as its
Board.

- **Pin to sidebar** puts it in the sidebar's **Pinned** section, above your projects, wherever you
  are in Ostler. The sidebar holds up to 20 pins.
- **Pin to Overview** makes it one of the project's **Shortcuts**, the strip at the top of its
  Overview. **Add a shortcut** there pins an item or view of the project, or makes a new link (a
  name and an `https` address, kept in the Library like every link) and pins it.
- Both are in the `…` or right-click menu of a task card and the task drawer, a milestone card, a
  decision, a Library item, the Views menu (for the saved view on show) and the project's `…` menu
  (for the view on show). In the command palette, **Pin…** finds something to pin to the sidebar.
- **Unpin** is in the same places and on the pin itself, with **Undo** in the message. Unpinning
  never changes the item.
- A pin always shows its item's current title. One whose item was deleted says **Gone**, with
  **Unpin** beside it; an archived item says **Archived**.
- Reorder pins by dragging them, by selecting one and pressing `Alt` + `↑` or `↓` (`Alt` + `←` or
  `→` for shortcuts), or with **Move up** and **Move down** in its right-click menu. The Pinned
  heading folds like an area.
- A pin opens in one click: a task in its drawer, a milestone, decision or note in its place, a view
  as that view. A pinned link first shows its address and asks before it opens in your browser, and
  a pinned file asks "Open … in its app?" first.
- Pins come first in the command palette when they match what you type.
- A project's shortcuts travel with it in its project file; your sidebar pins stay yours. Removing a
  project removes its pins.
- A pinned milestone with a target date, or a pinned task with a due date, can show as a
  **countdown** on Home, in the notification-area menu and in the taskbar's jump list: choose
  **Show as countdown** in its pin's right-click menu, or in the item's own menu while it is
  pinned. Pinning a dated item offers it in the message. See
  [Countdowns](05-home-and-inbox.md#countdowns).

## Project settings

Open **More** (the `…` button in the project header) › **Project settings**. It shows one section
at a time, with every section listed down its side:

- **General**: the name, colour and icon, the project's area and stage, the status update reminder,
  triage, and what kind of project it is for Ostler AI
- **Tasks**: whether estimates count in points or hours, task IDs, labels, task types and fields
- **Board**: the columns' names and which show, rules, and when done tasks are archived
- **Budget**: the budget and billing
- **Folder and GitHub**: link or unlink a folder, and set the project's GitHub repository, which
  Ostler suggests from the folder's Git remote ([GitHub](22-github.md))
- **Agents**, while agents are on: agent options and conventions, for software projects

Below a line, four sections look after the project's data:

- **Backup**: back up this project, and the backups made so far
- **Check and repair**: check the project's records, and write or check checksum files
- **Export and import**: every export (project file, tasks as CSV, calendar file, web page,
  template, records as JSON files) and import
- **Remove**: archive or remove the project

### Back up a project

**Backup** › **Back up this project** saves a project file (`.ostler-project`) with every task,
milestone, note and Library file in Ostler's data folder, in `project-backups`, with a checksum
file beside it. Each backup in the list has:

- **Check**: compares the backup with its checksum file, and says if it has been damaged
- **Open as a copy**: opens the backup as a new project in the sidebar, named "Backup copy of" and
  the project's name. The project it came from
  does not change.
- **Show in folder** and **Delete**

A project's backups stay when the project is removed. **Back up everything now** makes a full
backup of every project and your settings, as Settings › Data does, which lists and restores those.

### Check and repair

**Check records** reads Ostler's database file with SQLite's own check, and looks for this
project's records that point at something that is no longer there, such as a comment whose task is
gone. Nothing changes. If it finds something, **Repair…** makes a full backup first, then rebuilds
the database's indexes and fixes the broken records: a link to something gone is cleared (a task
whose milestone is gone keeps the task), and a record that cannot stand alone is removed. If
anything goes wrong, restore that backup from Settings › Data. SQLite checks the database file as a
whole, so a problem it finds may be outside this project.

A **checksum file** (`.sha256`) beside a file proves later that the file has not changed, such as
an export copied to a USB drive. **Write a checksum file** makes one for any file you choose, and
**Check a file** compares a file with the one beside it. They are the same files `sha256sum` and
PowerShell's `Get-FileHash` work with.

### Remove a project

**Remove** shows everything you need to decide before you click anything:

- **Backups Ostler found**: this project's backups, full backups in Settings › Data, whether those
  are copied to a second place, and any records already written into the project's folder. Each
  says when it was made; **Back up now** makes one here.
- **Deleted from this computer**: the project's records in Ostler's database, and each folder in
  Ostler's data folder that goes (agent records, the agents' task copies, AI drafts and Library
  files), with its path, how many files and how much space.
- **Never deleted**: your project folder and its files, its Git history and agent versions, and
  every backup.

Then the choices, from gentlest to final:

- **Walk me through it**: the guided removal shows what Ostler holds, offers to save the records
  into your project folder, and asks before each step. Stop at any point and nothing changes.
- **Archive**: hides the project everywhere but Settings › Projects. Nothing is deleted, and
  **Undo** or **Bring it back** returns it.
- **Back up, then remove**: makes a fresh backup, then deletes what is listed. It stops if the
  backup fails, and afterwards says where the backup is.
- **Remove permanently**: type the project's name, then confirm. It deletes what is listed with no
  new backup, and says whether an older backup exists.

Both ways of removing ask again, with what will be deleted, before anything is. An agent still
running in the project holds removal back until you stop it here.

A demo project's Remove shows one choice instead: **Remove the demos…** removes both demo projects
after one confirmation (see [Getting started](01-getting-started.md)). **Back it up, archive it or
remove only this one** opens everything above, for a demo you have made your own.

In Settings › Projects, **Settings…** opens a project's settings, where Remove is.

### Columns

Every project's Board has the same six columns: Backlog, Ready, In progress, Blocked, In review
and Done. Under **Board** › **Columns** you can give any of them a name of your own, such as "To do" or
"Doing"; leave a name blank to go back to the standard word. Untick **Show** to hide Ready,
Blocked or In review in a project that never uses them. Backlog, In progress and Done always show.

- A column can be hidden only while no task is in it. If tasks are there, Ostler says how many:
  move them to another column first. Archived tasks and the recycle bin do not count.
- Agents use Ready and In review. While agents are on, a project with a folder keeps them, and
  turning agents on shows them again in any such project that hid them, with a note saying so.
- The names are for you. Statuses stay the same underneath, so agents, the automation API and
  reports keep the standard words. CSV export writes your names, and CSV import understands both
  your names and the standard words.
- Project files and templates carry the columns. The built-in templates for events, moving
  house, study plans, content calendars, campaigns and product launches hide the columns their
  tasks never use.

#### Columns of your own

Below the six, **Add column** makes a column of the project's own: give it a name and choose what
it **counts as**, one of the six statuses. "Testing" might count as In progress, "Waiting for
client" as Blocked. It shows on the Board right after the column it counts as.

- A task in it shows the column's name everywhere its status shows: the card, the drawer, the
  List, My work, filters, status pickers, rules, exports and project files. Filter by the column to
  see just its tasks; filter by the status it counts as to see those tasks and its own together.
- Agents, Done counts, Blocked lists and the automation API's `status` treat its tasks as the
  status it counts as, so nothing that knows only the six changes. The API names the column in the
  task's `columnId`.
- Each one can be renamed, moved up or down among the columns counting as the same status, hidden
  and deleted. Deleting it puts its tasks back in the column of the status it counted as. Like the
  six, it can be hidden only while no task is in it.
- A task whose status changes some other way (an agent, a rule, the API) leaves the column for that
  status's own.
- Rules can name it: "status is Testing", "when the status changes to Testing", "move to Testing".
- A project can have up to 20.
