# Tasks

Tasks are the steps of your project. Each task has a status, and the Board shows one column per
status: Backlog, Ready, In progress, Blocked, In review and Done.

## Add a task

- **New task** in the project header opens the full form.
- `Ctrl` + `N` opens **quick add** in the current project.
- `Ctrl` + `Shift` + `N` opens quick add from anywhere.

The full form keeps the less common fields under **More details**: the assignee, the start and due
dates, the estimate, and what the task waits on. Ostler remembers whether you left that section open.

- **Milestone** lists the project's milestones and **New milestone…**: name one there and **Add
  milestone** makes it and chooses it for the task. Give it an outcome and a date later, on
  Milestones.
- **Labels** shows the project's most used labels, a click each to add and a click to take off
  again, and **Add a label** finds any other or makes a new one. The task drawer has the same row.
- **Minimise**, at the foot of the form, puts the task aside in a small bar at the bottom of the
  window, so you can look around the project, open other tasks and switch views. **Carry on**
  brings it back as you left it, and so does **New task**; **Discard** throws it away. It stays
  while you are in this project.
- **Pop out**, beside it, moves the half-written task into a window of its own, so it can sit
  beside whatever you are reading. The window has Ostler's own title bar and icon. **Back to main
  window** there hands it back as you left it; creating or cancelling the task closes the window. Closing the window any other way discards the
  draft.

Quick add understands a few shortcuts as you type: `#label`, `@person`, `!high` (or `!low`,
`!med`, `!crit`), `+Project`, and dates such as "tomorrow", "friday", "next week" or "in 3 days".
"Pay invoice tomorrow #admin !high" makes a high-priority task labelled admin, due tomorrow. A
quick-added task is assigned to you unless you name someone.

### From text or a photo

When Ostler AI is set up, New task and quick add have **From text or a photo…** beside the title.
Paste an email or a meeting's notes into the box, type a list, or press `Windows` + `H` to dictate
it with Windows' voice typing. You can also add a photo of a whiteboard or a sticky note: choose
**Add a photo**, paste one, or drop one on the box (PNG, JPEG or HEIC, up to 10 MB).

Press **Find tasks** and Ostler AI suggests the tasks it finds, with a due date, a person and a
checklist when the words give them. "Next Friday" counts from today. A person is matched to the
people on this PC by full name, first name or initials; a name that matches no one is left empty
and the list says so. Tick, edit and add the suggestions as with any
[Ostler AI suggestion](13-ostler-ai.md#review-suggested-tasks). One **Undo** removes them all.

Tick **Keep the photo** to add it to the project's Library and attach it to each task you add.
Nothing is sent before you press **Find tasks**, and nothing is added before you press **Add**.
Typing a single task in quick add still works as before.

### Snip to task

Saw something on screen that needs doing, like an error message or a chart that looks wrong?
**Snip to task** turns it into a task with the picture attached:

1. Start a snip: press your **Snip to task key**, choose **Snip to task** in the notification-area
   menu (with background mode on), or choose it in the command palette (`Ctrl` + `K`). Ostler's own
   window steps aside first.
2. The screen freezes and dims. Drag a rectangle around what you want; its size shows as you drag.
   `Enter` takes the whole screen under the pointer. `Esc` or a right click cancels.
3. Quick add opens with the picture. Type the task and press **Add task**. To point at something
   or hide something private first, press **Mark up** (see below).

The picture is saved as a PNG in the chosen project's [Library](07-library.md), named after the
moment you took it ("Screenshot 14 March 2026 09.41.png"), set to **When selected**, and attached
to the new task, so the task's agent and Ostler AI can see it like any attachment. Set it to **Human
only** in the Library to keep it to yourself. **Cancel** throws the picture away: nothing is written
before you add the task.

The key is off until you turn on **Snip to task from anywhere** in Settings › General › Windows.
`Ctrl` + `Alt` + `S` is suggested; you can choose another, but not the Quick add key. If another
app already uses it, Ostler says so and you can pick a different one. Protected video (a film in a
streaming app, say) shows as black in the picture: Windows keeps it out of every screenshot.

### Mark up a picture

**Mark up** opens the picture in an editor where you can draw on it before it is saved:

- **Arrow** (A), **Box** (R) and **Highlight** (H, a see-through marker): drag on the picture.
- **Text** (T): click where it goes, then type in **Text of the selected mark**.
- **Blur** (B): drag over anything private, such as a name, a password field or an account
  number. The area is turned into large flat blocks in the saved picture itself, so it can't be
  undone or read from the file.
- **Select** (V): click a mark to move it, drag its round handle to resize it, or press Delete.
  With any other tool, point at a mark's border: the pointer shows a move cross, and dragging there
  moves the mark without changing tools.

Pick a colour and a line width before you draw, or with a mark selected to change it. Ctrl + Z
undoes and Ctrl + Y redoes. **Fit** shows the whole picture; **100%** shows it at its real
size. The picture keeps its full resolution.

Without a mouse: press Tab to move between marks (each says what it is and where, such as
"Arrow, from top left to centre"), the arrow keys to move the one you are on (Shift for larger
steps, Alt to resize it), and Delete to remove it. **Add by position** adds any mark from its
left, top, width and height in the picture's pixels.

**Use this picture** puts the marked-up picture in place of the snip; **Add task** then saves it.
**Cancel** keeps the snip as it was.

On a picture already attached to a task, **Mark up a copy** (the marker button beside it in the
task's drawer) opens the same editor. **Save copy** adds a new picture to the Library, named like
"Login page (marked up).png", with the same Ostler AI access as the original, and attaches it to the
task. The original is never changed.

## Open a task

Click a task, or focus it and press `Enter`, to open its drawer. There you can change every field
and see its history.

The drawer shows what every task has (its title, description, status, assignee, priority and due
date) and the parts this task holds, such as its subtasks, reminders or labels. Everything else is
one click away under **Add**, below the fields: the four parts the project uses most as buttons,
and **More** for the rest, grouped into Plan, Keep track and Connect, each with a line on what it
does. Choosing one opens it, ready to fill in.

- A part that a third of the project's open tasks hold (start dates, say, or estimates) shows on
  every task in that project, so a project's habits are always in sight.
- A part you add, or empty, stays in the drawer while the task is open.

Changes save as you make them, so the drawer has no Save or Cancel. A picker, toggle, date or list
change saves at once. Title, description and checklist text save when you stop typing for about a
second, when you leave the field, when you close the drawer, and when you close Ostler's window or
quit Ostler. The header says **Saving…**, then **Saved**.

- `Ctrl` + `Z` in the drawer, outside a text field, undoes the last saved change. A run of typing
  counts as one change. Attachments are added and removed at once, and are not part of undo.
- If a save fails, the text stays where you typed it, the field says what went wrong, and **Retry**
  saves it again. Closing the drawer then asks whether to retry that change, discard it, or keep
  editing.
- A change made somewhere else, such as by an agent, appears in every field you are not editing. A
  field you are typing in keeps your text.

### Description history

Ostler keeps what a task's description said before each change, so a paragraph you typed over or an
agent replaced is easy to get back. Once there is an earlier version, **History** appears beside
the description. It opens a list of versions, each with when it was changed, who changed it and
how long it was.

- Select a version to compare it with today's text. Lines added since are marked **Added**, and
  lines taken out are marked **Removed**, in words as well as colour.
- **Restore** makes that version the description again. It is a change like any other, so the text
  it replaces is kept as a version too, and **Undo** in the toast puts it back.
- Changes by the same person, agent or tool within five minutes of each other are one sitting and
  keep one version: the text from before the sitting began.
- The newest 50 versions are kept for each task. They stay on this PC: they are not in CSV exports,
  the project file or templates. A task in the recycle bin keeps them; deleting it for good removes
  them.

### Files and pictures on a task

Under **Attachments** in a task's drawer (the same list whether agents are on or off; with agents on, a coding agent is also given what is attached, read-only):

- **Attach files…** picks files to attach, and dropping files there attaches them too.
- **Paste picture** attaches the picture on the clipboard, such as a screenshot.
- Pasting a picture anywhere in the drawer attaches it. Pasted into the description, it is also
  shown there, where the cursor was, as `![name](ostler://library/…)`: move or delete that line
  like any text, and the picture stays attached.
- In **New task**, a picture pasted into the description is shown as a thumbnail along the foot
  of the description, not as text. Click a thumbnail to see it large, or its cross to take it off.
  Every picture there is attached to the task when you create it.

- The paperclip beside the description does the same as **Attach files…**.
- Click an attachment to preview it: a picture is drawn full size and a text file shows its text.
- Pictures in the description show as thumbnails under the editor; click one to preview it, and
  **Hide pictures** keeps them out of the editor.

Each file is kept in the project's Library, and the task lists it with a thumbnail for a picture.

## Task IDs

Every task has a short ID that never changes, such as **SHOP-12**: the project's prefix and a
number. It is easier to say aloud, type into search or write in a commit message than a title.

- The ID shows on Board cards, in the List's **ID** column (sort by it to see tasks by number) and
  in the drawer's header.
- Each new task, subtasks too, gets the project's next number. A number is never used twice in a
  project, even after a task is deleted for good. A task brought back from the recycle bin or a
  backup keeps its number.
- **Copy ID** and **Copy branch name**, in a card's menu and the drawer's menu, copy `SHOP-12` or
  `shop-12-fix-the-login`: the prefix in small letters, the number, and the title with accents and
  symbols taken out, at most 50 characters. Use it for a branch you make by hand; agents name their
  own versions.
- Type an ID in the command palette or Search, as `SHOP-12`, `shop-12` or `shop 12`, and that task
  comes first: press `Enter` to open it.
- The prefix comes from the project's name, two to five letters. Change it in Project settings ›
  **Tasks** › **Task IDs** › **Change prefix**. Every task's ID changes at once, so IDs written in commits and
  notes before the change no longer match. Two projects can't share a prefix.
- The project file keeps the prefix and the numbers, so a project imported from it has the same
  IDs, unless another project already uses its prefix. A project or task template starts its
  tasks' numbers afresh. **Export all tasks** has a **Task ID** column.

### Commits

When a project has a Git folder, write a task's ID in a commit message, such as "Start on SHOP-12"
or a branch made with **Copy branch name**, and the commit shows on the task.

- The drawer's **Commits** section lists the commits that name the task, newest first: the short
  hash, the commit's first line, who made it and when, with **Copy hash**. It shows only once a
  commit names the task.
- An ID counts in any case, with a dash or a space (`SHOP-12`, `shop 12`), as a whole word, so
  `SHOP-123` never counts as `SHOP-12`. Only the project's own prefix counts.
- A commit that says it fixes a task, with fix, fixes, fixed, close, closes, closed, resolve,
  resolves or resolved (an optional colon) right before the ID, is marked **Fixes**. A new one that
  fixes an open task offers **Mark as done** in the [Inbox](05-home-and-inbox.md#inbox). Ostler never
  changes a status itself.
- Commits Ostler read before (the project's history when it was first watched, and commits stored
  before this feature) are linked too, but never fill the Inbox.
- Changing the prefix keeps the commits already linked; later commits are read with the new prefix.
  IDs of tasks that don't exist are ignored.

## Fields

- **Title and description.** The description is Markdown, so you can use lists and links.
- **Status and priority.** Priority is Low, Medium, High or Critical.
- **Assignee.** Anyone in Settings › People, including you ("Me"), or one of the project's own
  [people](05-home-and-inbox.md#people).
- **Start date and due date.** A start date can't be after the due date.
- **Show from.** The first day you can act on the task. Until then it is hidden: see
  [Show from and Someday](#show-from-and-someday).
- **Estimate.** A number, in points or hours, as the project chooses.
- **Labels.** Coloured words that group tasks. The project's most used ones are a click each, in
  the drawer and in New task. Manage them in Project settings.
- **Type.** What kind of task it is, such as Bug or Errand: see [Task types](#task-types).
- **Milestone.** The milestone the task helps deliver.

## Task types

A task type says what kind of work a task is: a software project might have **Bug**, **Feature**
and **Chore**, a house move **Errand**, **Repair** and **Call**. A task has at most one type, and
types are not labels: a task can have many labels as well.

Set up a project's types in **Project settings › Tasks › Task types**: add one by name, then the pencil
chooses its icon (about 40 to pick from, with a search box), its colour and its name. The arrows
move a type up or down the list, which is the order everywhere else. Deleting a type clears it
from its tasks at once; **Undo** in the message puts the type and its tasks back. A project can have
up to 20 types, each with its own name.

Once a project has types:

- **Type** sits beside Priority in the task's drawer and in **New task**, as a column in **Plan
  several tasks**, and in the bar that edits selected tasks (with **Undo**).
- **Quick add** shows a Type picker under the line, so there's nothing new to type.
- Cards and List rows show the type's icon before the title; point at it, or let a screen reader
  read it, for its name.
- **Group** in the List's View options can group by type, and the Board's swimlanes can split by
  type. Filters have **Type**: is or is not one of the types, or no type.
- Agents see the type in their task ("Type: Bug").

CSV export writes a **Type** column by name, and an import maps a Type column to the project's
types by name, making any that are missing (the preview lists them). The project file and
templates carry types too.

### Fields and a template for each type

Each type can choose its own shape. Open a type with the pencil in **Project settings › Tasks ›
Task types**:

- **Fields** says which custom fields its tasks show. **Every field** is ticked to begin with; untick
  it, then untick the fields this type doesn't need. A Bug might show "Steps to reproduce" and
  "Version", an Errand none at all. The task's drawer, **More details** in New task and the columns
  **Plan several tasks** offers then show only those fields; a task with no type shows every field.
  The List keeps whichever columns you chose.
- Hiding a field never deletes anything. A task keeps the values of fields its type hides. The
  drawer counts only the hidden fields that hold a value, since those are what you might miss
  ("2 more fields with values are hidden for Bug"), with **Show them**. When none of them holds a
  value, it offers a quiet **Show all fields** instead. Change the task back to a type that shows
  the field, or to no type, and the value is there.
- **Starts from** names a [task template](#task-templates), of this project or every project. Choose
  the type in **New task**, or in quick add's Type picker, and the task is filled from that
  template first; whatever you have typed already wins. Changing the type of a task that already
  exists never applies a template.

Deleting a field or a template takes it off every type that named it (**Undo** puts it back). The
project file and templates carry each type's fields and template; a file saved before this
feature reads as every field.

## Custom fields

When a project needs something the fields above don't cover, such as a client, a size, a cost or a
sign-off, give it fields of its own. Open **Project settings** › **Tasks** › **Fields** and choose
**Add field**.
A field is one of these types:

- **Text**: a short note, up to 1,000 characters.
- **Number**: any number, such as a cost or a score.
- **Date**: a day.
- **Choice**: one of a list of options, each with a colour.
- **Choices**: any number of options from a list.
- **Checkbox**: ticked or not.

A project can have up to 20 fields, and a Choice or Choices field up to 50 options. In Project
settings you can rename fields and change their order (the order they appear in everywhere), and
add, rename, recolour, reorder and remove a choice field's options. Renaming an option changes it
on every task; removing one takes it off the tasks that had it. A field's type can't change once it
is made: to change it, make a new field.

Deleting a field takes it off every task at once. **Undo** in the message that appears brings the
field back with all its values.

Fill a task's fields in its **Fields** section in the task drawer, in **More details** when you add
a task, or in the plan grid of **Plan several tasks** (**Add a field column**). Then:

- **In the List**, show a field as a column from **Columns** (fields have their own heading, and a
  search box when there are many), sort by it, and edit it in place: focus the cell and press
  `Enter`. **Group by** offers your Choice and Checkbox fields.
- **On the Board**, choose the fields cards show under **View options** › **Fields on cards** (none
  at first), and group the swimlanes by a Choice or Checkbox field.
- **Filter** any view by a field (see [Search, filters and saved views](09-search-filters-and-saved-views.md)).
- **Search** finds the words in Text fields.

Fields are for tasks only. Agents are not given their values.

### AI fields

Filling "Room" or "One-line summary" on two hundred tasks is tedious, so a Text or Choice field
can be filled by [Ostler AI](13-ostler-ai.md#fill-fields-with-ai) when you ask. While Ostler AI is
set up, tick **Fill with AI** when you add or edit the field in **Project settings** › **Tasks** ›
**Fields**,
and write its instruction, up to 500 characters, as you would to a person: "Which room is this
for?", "Summarise the task in one line". A Choice field's answer must be one of its options. The
field shows a small sparkle beside its name wherever it appears.

Then choose **Fill with AI** under the field in a task's drawer, or select tasks in the List (up to 100) and pick the field from **Fill with AI** in the bar that appears. Ostler AI fills one task at a
time, with progress and **Stop**; what was filled before you stopped is kept. Each fill, and each
batch, is one **Undo**, and the task's activity says "Ostler AI filled Room". Values you entered
yourself are kept unless you choose **Replace** when Ostler asks ("Replace 12 values you
entered?").

A value Ostler AI filled has the sparkle, and "Filled by Ostler AI" in its tooltip. When the task's
title, description or checklist has changed since, it says **May be out of date** and offers
**Fill again**. Editing the value makes it yours. Ostler AI never fills a field on its own.

## Plan several tasks

To add a whole plan at once, open **Plan several tasks** from the project's More menu, or choose it in
the command palette. The plan grid has one row per task. Each row takes a title, assignee, start
and due dates, estimate, what it waits on, milestone and labels.

- `Tab` and `Shift` + `Tab` move between cells. `Enter` in the last cell adds a row.
- `Alt` + `Shift` + `Right` makes a row a subtask of the row above; `Alt` + `Shift` + `Left` moves it up a level.
- Paste several lines and each becomes a row. Two leading spaces (or a tab) make a subtask. The
  quick add words work too: `#label`, `@person`, `!high` and dates.

The summary above the grid counts the tasks, subtasks and Waits on links. **Create** makes them all in
one step, or none at all: when a row cannot be saved, the grid says why on that row, and nothing is
created. Undo, in the message that follows, moves everything the plan made to the Recycle bin.

A row with no title is left out, with anything that waits on it. A row with no title that has
subtasks needs a title before you can create the plan.

## Checklist

A task's checklist is a list of items to tick off. The card on the Board shows progress such as
"3/5". When an AI agent works on a task, it reads the checklist as the task's acceptance criteria.

### Dates and people on checklist items

A checklist often holds small jobs for different people on different days: "Sam: confirm the
caterer by Friday". Give any saved item its own **due date** and **person** with the calendar
button beside it, which shows when you point at the item or move to it with **Tab**. A set date
and person show beside the item as chips ("Fri", "Sam"); select them to change or clear them.
The people offered are the same as the task's assignee picker offers.

A dated item shows on its person's Home (Today and Upcoming) and in My work as "item, in task",
with its own tick, whoever the task is assigned to. The task's card shows the next dated item
when it comes before the task's own due date ("Next: Confirm caterer, Fri").

Editing an item's text keeps its tick, date and person. Removing an item removes all three. Two
items with the same text are one item, and the checklist says so if you type one twice. Agents
still receive every item as plain acceptance criteria, without dates or people. The project file
and task templates carry items' dates and people; CSV export keeps the checklist as plain items.

## Pin a task to the desktop

When one task is the day's real work, keep it in sight. **Pin to desktop**, in a task's menu (right
select its card, or its **…** button) and in the task drawer's **Task actions** menu, puts the task
in a small window of its own that stays on top of your other windows, like a sticky note on the
monitor. Drag it by its header and resize it from its edges. It opens in your theme.

The sticky window shows:

- the task's title, with its project's colour and icon (select the title to open the task in the
  main window);
- its due date in words ("Due Friday 23 October 2026");
- its checklist, with tick boxes that work as they do in the drawer;
- **Start timer** and **Stop timer**, with the running time, on the same timer as everywhere else
  (see [Time tracking](20-time-tracking.md)), and the time left while a **Focus** counts down on it;
- **Done**, which marks the task done the normal way. The toast in the sticky window has **Undo**.

The window follows every change, from any window or from an agent. When the task is done,
archived, moved to the recycle bin or gone, or its project is removed, the window says so and
offers **Unpin**. Removing a project unpins its tasks and closes their windows. **Unpin** (the ×
in its header) closes the window; closing it from the keyboard with `Alt` + `F4` unpins it too.

Pinned tasks reopen at the next start, where you left them. One left on a screen that is no longer
connected opens in the middle of the main screen. At most five tasks are pinned at once; pinning a
sixth asks whether to unpin the oldest. A sticky window never takes the focus by itself: in it,
`Tab` moves through its controls and `Esc` hands the focus back to the app you were using, leaving
the window where it is. A sticky window is your screen layout, so the automation API does not
offer it.

## Subtasks

Break a big task into subtasks from its drawer. Subtasks are tasks too, with their own status and
dates. The parent shows how many it has. The subtask form has the same **More details** section.

## Find and replace

When a supplier, a product or a person changes name, **Find and replace** changes the old words in
every task at once. Open it from the project's **More** menu, the List's toolbar, the command palette,
or with **Ctrl+H**.

Type what to find and what to put instead. **Match case** finds only the same capitals, and **Whole
words** skips the text inside a longer word ("cat" but not "catalog"). The text is found as you
typed it: characters such as `.` or `*` have no special meaning. **Include archived tasks** also
looks in the Archive; the Recycle bin is never searched.

Ostler looks in task titles, descriptions and checklist items. Comments, the Library, decisions,
milestones and goals are never changed: they are a record of what was said.

Every match is listed under its task, with the old text struck through and the new text beside it.
Each match and each task has a tick box, and the count says how many are chosen. A match that would
break a rule can't be ticked, and says why: a title that would be empty or longer than 200
characters, or a checklist item that would read the same as another item of that task (the two
would merge into one). Select **Replace** to change the ticked matches. A checklist item keeps its
tick when its text changes.

The message that follows has **Undo**, which puts back every task's old text in one step. A task
that changed in the meantime is left as it is, and the message says so: Ostler never overwrites a
newer edit.

## Task templates

When you make the same task again and again (the weekly invoice run, a bug report with its usual
headings), save it as a task template: open the task, open its menu and choose **Save as task
template…**. Give it a name (the title, unless you change it), choose **This project** or **Every
project**, and whether to keep the dates. Its description, checklist, labels, priority, estimate,
assignee, custom field values and subtasks are kept; dates are kept as days after the day you use
it. Comments, activity, attachments and what it waits on are left out. Saving over a name you
already use asks first.

To make a task from one:

- **New task:** choose a template in **From template**. The form fills in, and you can still change
  anything before **Create**. Its subtasks are made too.
- **Quick add:** choose a template beside the line. Words in the line still count: a date or
  `#label` you type wins over the template's.
- **Command palette:** `Ctrl` + `K`, **New task from template…**, then the template.

A template for every project can't know each project's people or fields. When a person is gone or
a project doesn't have a field, that part is left out and Ostler tells you.

Rename, move between this project and every project, or delete task templates in Settings ›
Projects › Task templates ([Templates](10-templates.md)).

## Waits on

A task can wait on other tasks (its dependencies): they are under **Waits on** in its drawer. Add
one with **Add a task it waits on**, and take one off with the cross beside it. Its card says
"Waiting on 2" until they are done, and the Timeline draws an arrow from each task to the tasks that
wait on it.

### How it waits, and by how many days

Each task under **Waits on** in the drawer says how this task waits on it, in words: "Starts when
Plastering is due", "Starts 2 days after Plastering starts", "Due when Data is due". Select the
pencil beside it to change two things:

- **How it waits**: **Starts after it is due** (the usual kind, and every link you made before),
  **Starts after it starts** (the painting can start two days after the plastering starts), or
  **Due after it is due** (the report finishes when the data finishes).
- **Days after**: how many calendar days later, from -365 to 365. Use a negative number for before:
  -2 is "Starts 2 days before Plastering is due". A new link starts at 0.

The Timeline marks a task that is too early for one of its links, the at-risk list in Insights
lists it, and moving a task later offers to move what waits on it by the same rule. Only **Starts
after it is due** holds a task back from Ready and from the agent queue; the other kinds are about
dates only. Types and days travel in the project file and its templates. A change to how it waits,
or by how many days, is in the task's activity, from the drawer, the Timeline or the automation
API alike.

### Move what waits on it

When a task's due date moves later (on the Timeline or the Calendar, in the drawer, with bulk edit
or with **Reschedule…**) and tasks that wait on it are now too early for their link, Ostler tells you: "3
tasks that wait on this now start too early". Your change is already saved, with its own **Undo**.

- **Preview** lists each task with its dates now and where it would move. **Move 3 tasks** moves
  them all, and one **Undo** puts every one back.
- **Leave them** keeps the plan as it is.

Each waiting task moves later by the same number of days as the task it waits on (for **Starts
after it starts**, as many days as its first day moved), keeping the days
between its start and due dates. If that lands its first day on a day you don't work (your working
days in Settings › People, or Monday to Friday, less your days off and everyone's), it moves on to
your next working day. Then the
tasks waiting on those are checked the same way, and so on; each task moves once. A task that still
starts after the new due date stays where it is. Done tasks and tasks without a due date never
move; the preview lists them. Moving a task earlier never moves anything else. A task changed
between the preview and **Move** is left as it is, and the message says so.

### Blocked tasks

When a task is **Blocked**, its drawer asks **Why is it blocked?**: a few words, such as "Waiting on
you", "Waiting on SHOP-4" or "Waiting on 1 March". The reason clears when the task leaves Blocked.
If everything the task waits on is done, the drawer says so, because nothing is holding it back any
more.

## Links between tasks

Not every connection holds work back. Two people report the same problem, a task is copied from
another, or two jobs touch the same thing. **Links** in the drawer, just below **Waits on**, keeps
that in both tasks:

- **Relates to** reads the same from both tasks.
- **Duplicate of** and **Duplicated by**: one task is a duplicate of the other.
- **Copied from** and **Copied to**: one task was copied from the other.

Choose **Link to…**, pick the kind, then search the project's tasks. Each link shows the other
task's status and title; click the title to open it. A task that is archived or closed says
**Closed**. Remove a link with the cross beside it; **Undo** in the message puts it back. Both
tasks' activity records the change.

Links never move dates, raise conflicts, change the Timeline's critical path, or hold agents back:
only **Waits on** does that. A task can only be linked to a task in the same project.

- **Mark as duplicate…** in the task's menu: pick the original, and Ostler links the two and closes
  this task as [Won't do](#archive-and-the-recycle-bin), with the reason "Duplicate of" and the
  original's title. A Done task can't be marked, for the same reasons as Won't do. **Undo** in
  the message reopens it and removes the link.
- **Copy task** in the task's menu makes a new task in Backlog, at the end, with the same title
  followed by "(copy)", the description, the checklist (unticked), labels, priority, estimate,
  person, dates, milestone, iteration and custom fields, and a **Copied from** link back.
  Comments, activity, attachments, waits-on and agent work stay with the original. The copy opens in
  the drawer; **Undo** in the message removes it. Rules see the copy as a new task.

The project file carries the links between the tasks it contains.

## Links in text

A description, a comment, a decision or a Library note can point at another task, a milestone, a
decision or a Library item of the same project. Type `[[` and start typing its name: a list of
the project's matching items opens under the text, best match first, each with its kind. Use the
arrow keys and **Enter** (or click) to put in a link; **Esc** closes the list and leaves what you
typed.

A link is ordinary Markdown, `[Fix the header](ostler://task/…)`, so the text still reads
anywhere. In Ostler it shows as a chip with the item's **current** title (and a task's status),
whatever words the link holds, so renaming the item never breaks it. Click the chip to open the
item. A link to an item that has been deleted, or is in the recycle bin, reads **Deleted item**.

Every task shows **Linked from** in its drawer when something links to it: each text that does,
such as "Comment on “Fix the header”" or "Decision: Use the new supplier", and clicking one opens
it. Milestones, decisions and Library items show the same list.

Links to another project's items still open, but they are not listed under **Linked from**. When
you import a project file as a new project, links between its own items point at the new items.

A task's ID, such as `SHOP-12`, links itself: written in a description or comment, it shows as a
chip for that task, as long as the task is in the same project.

A link can also open a file or folder in the project's linked folder: write its path relative to the
folder, such as `[the plan](docs/plan.md)`, or an `ostler://file/<project id>/docs/plan.md` link.
Documents and pictures open in their program and folders in Explorer; any other file, such as a
program or a script, is only shown in Explorer, never run. A link can't reach outside the folder.

Links to `localhost` or `127.0.0.1` point at a server running on one computer, usually an agent's own,
so nobody else can open them. When an agent or another tool writes one through the automation API,
Ostler keeps the address as text instead of a link.

## Repeating tasks

Use **Repeat** in the drawer to make a task repeat, for example every week on Monday. When you
mark it Done, Ostler adds the next one with its new due date.

### Taking turns

Shared jobs, like putting the bins out or writing the weekly report, can go round a list of
people. In the Repeat dialog, turn on **Take turns** and add the people in the order their turns
come. Drag a row to change the order, or use its **Move up** and **Move down** buttons (or
Alt+Up and Alt+Down on the row); **Remove** takes someone out. The Repeat section then says, for
example, "Take turns: Sam, Alex and Jo. Next: Alex".

Each new occurrence goes to the person whose turn is next, and the turn moves on, whether you
marked the last one Done or closed it as won't do. Someone who is archived is passed over until
they are unarchived, and the Repeat section says so. If everyone is archived, the next
occurrence keeps the same person, and its activity says why.

Changing who a task is assigned to by hand doesn't change whose turn is next: the Repeat section
still says who the next one goes to. Turning **Take turns** off keeps the current assignee.
Taking turns travels with the project file and with templates.

### Go to agents when it comes round

Routine work for agents, like updating the dependencies every Monday, can queue itself. With
agents on and a linked folder, the Repeat dialog has **Go to agents when it comes round**. Each
occurrence is then queued for agents on its start date (or its due date when it has none), once,
and lands in review as usual: nothing is applied without you. A new occurrence moves from Backlog
to Ready when it is queued. The setting moves with the repeat to each new occurrence, as does the
task's **Plan first** choice, and the Repeat section says "Goes to agents when it comes round".

Ostler checks when it starts and every hour, so a day missed while Ostler was closed is caught up
once, never once for each day. If it can't queue an occurrence (agents are off, the project has no
linked folder, or the task is already queued or running), the task stays an ordinary task you can
queue yourself, and the Inbox says why. It is never queued later by itself: the Inbox note offers
**Queue it now**. See [Agents](14-agents.md#scheduled-tasks).

## Show from and Someday

Some work can't start yet, and some may never happen. Two things keep it out of your way:

- **Show from**, beside the start and due dates in the drawer, hides a task until that day. The
  drawer says "Hidden until 1 March" while the day is still ahead. On the day, the task appears
  in Home's Today marked **New today**, even if it isn't due.
- **Move to Someday**, in a task's menu, its drawer's **More** menu, or the bar that appears when
  you select several tasks, parks a task for one day, maybe. It keeps its status. A Someday task
  says so at the top of its drawer, with **Bring back**. Undo either from the message.

A hidden task (in Someday, or shown from a later day) leaves Home's Today and Upcoming, My work,
the Board and the List. The Calendar and the Timeline still show it, since they are about dates.
The Board and the List say how many are hidden, such as "12 hidden until later · 3 in Someday":
**Show them** shows them in place, greyed and marked, and **Hide them** hides them again. Each
view remembers this on this computer.

Every project has a **Someday** view under **More**, beside the Archive. It lists the project's
Someday tasks, each with **Bring back** and **Not now**. Select several to bring them back
together.

AI agents never pick up a hidden task on their own. Hiding a queued task that no agent has started
takes it out of the queue, and **Undo** queues it again; a task an agent is running stays where it
is. If you queue a hidden task yourself, Ostler offers to bring it back (out of Someday, or its
show-from date cleared) and queue it in one step.
Reminders you set still arrive.

## Triage

Quick add is meant to be fast, so what it captures is often rough: a title, maybe a picture, in
the wrong project or with no priority. Turn on **Triage new captures** in a project's settings
(Project settings, beside the stage) and its quick captures wait in **To triage** instead of the
Backlog. That covers [quick add](#add-a-task), [Snip to task](#snip-to-task),
[tasks from text or a photo](#from-text-or-a-photo) and the automation API when it asks. New task,
imports, templates, copies and AI drafts you accept elsewhere still go straight to the plan.

A task in To triage counts nowhere until you decide on it: not on the Board, the List, the
Calendar or the Timeline, not in Home's Today and Upcoming, My work, Workload, reports, charts or
milestone progress, and agents never take it (queueing one says "Accept it from To triage
first"). Its due date sends no reminder until you accept it; reminders you set yourself still
arrive. Search still finds it, marked **To triage**, and opening it takes you there. The
**In triage** filter finds them too.

Open **To triage** from the project's **More** menu or the command palette. They offer it only
when it can hold something: while the project triages new captures, or while a task still waits
in it after you turned triage off. A link to it still opens and shows that nothing waits. It lists the waiting
tasks, oldest first, each with its picture's thumbnail and when and how it was captured. Decide on
each one:

- **Accept** (A) puts it in the plan, in the Backlog unless you choose another status. Set the
  status, priority, assignee, labels, due date and milestone in the row first.
- **Someday** (S) parks it in [Someday](#show-from-and-someday).
- **Won't do…** (W) closes it with a reason.
- **Duplicate of…** (D) marks it as a duplicate of another task, as
  [Mark as duplicate](#links-between-tasks) does.
- **Move to project…** (M) makes it again in another project, with its title, description,
  checklist, priority, due date and assignee, the labels that project has, and its pictures and
  files copied to that project's Library. It follows that project's setting: if it triages new
  captures, the task waits in its To triage; if not, it goes into its Backlog as an ordinary task.
  The dialog says which once you choose the project. The original goes to the recycle bin. If a
  file can't be copied, nothing moves. Undo puts it back in this project's To triage, as long as
  the moved task hasn't been decided on or changed in the other project.

Every decision offers **Undo** in its message. Use the up and down arrow keys to move between
tasks and the key on each button to decide; after each decision the next task is the one in focus,
so twenty take a minute. The
[Inbox](05-home-and-inbox.md#inbox) says how many wait in each project.

Turning triage off while tasks wait asks first: **Accept and turn off** accepts them all into the
Backlog, and **Keep triage on** leaves everything as it was.

With [Ostler AI](13-ostler-ai.md#suggest-in-to-triage) set up, **Suggest** on a row asks it for a
priority, up to three of the project's labels and which tasks look like the same work, for
example "Suggested: High · design, website · Looks like 'Fix the header on mobile' (In
progress)". **Use** fills the row's priority and labels, and nothing is saved until you
**Accept**. A likely duplicate offers **Duplicate of this** and **Open**. Ignore a suggestion and
nothing changes. **Suggest for all** in the toolbar asks about every waiting task, one at a time,
after saying how many requests it will make; rows fill in as answers arrive, and **Stop
suggesting** ends it. A task in To triage also has **Suggest** in its drawer.

### Ideas and scores

The Someday view is your ideas list. Give each idea two quick scores from 1 to 5: **Impact**, how
much it would matter, and **Effort**, how much work it would take. Scores are optional, and a
task without them shows nothing extra anywhere.

- In the view's **List**, the **Impact** and **Effort** columns are edited in place: click a cell,
  or press Enter on it, and pick None or 1 to 5. Ideas sort "best first": the highest impact
  first, and among those the least effort. Click a column's header to sort another way.
- **Grid**, beside List at the top of the view, places each idea by its scores: impact up, effort
  across. The top-left corner, impact 4 or 5 with effort 1 or 2, is shaded and labelled **Quick
  wins**; the opposite corner reads **Probably not**. Drag an idea onto a cell to set both scores,
  or back to **Not scored yet** beside the grid to clear them. Undo is in the message. With the
  keyboard, Tab to an idea, move it one step with the arrow keys (an unscored one starts in the
  middle), and press Enter to open it. A cell with more than three ideas shows how many: click
  it for the list.
- The drawer has **Impact** and **Effort** beside the estimate, and the plan grid can add them as
  columns with **Add a score column**.

To decide, in either mode:

- **Bring back** makes the idea a task: it leaves Someday for the Board and the List, scores and
  all.
- **Not now** closes it as [won't do](#archive-and-the-recycle-bin), and asks why. It stays on
  record: the view's **Turned down** section, collapsed under the list or grid, shows each
  turned-down idea with its reason and **Bring back**, which puts it back in Someday (not on the
  Board).

Filters have **Impact** and **Effort**, CSV export and import have **Impact (1-5)** and **Effort
(1-5)** columns, and the project file and templates keep both scores.

## Reminders

Ostler reminds you about due tasks at the time you choose in Settings › Notifications. Use
**Remind me…** in a task's drawer to add a reminder of your own. Reminders arrive as Windows
notifications and in your Inbox, and only while Ostler is running. A reminder of your own can
[keep reminding](05-home-and-inbox.md#reminders-that-keep-reminding) until you deal with it.

## Comments and activity

Write comments on a task in its drawer. Markdown works, and `Ctrl` + `Enter` sends. The activity
list shows who changed what, and when.

Each comment has buttons to **Quote** it into the comment box (headed "**Name** wrote:"), **Pin** it to the top of the task's
activity, **Edit** it and **Delete** it (with Undo). In a shared project they follow your role: an
Editor edits and deletes their own comments and pins any; an Owner also deletes anyone's; a Viewer
has none of them. Nobody edits another person's comment.

### Mentions

Type `@` in a comment to pick someone from the project's people (**Mention someone**). Ostler puts
their name in the comment as a chip. In a shared project, the person is told **You were mentioned
in a comment**, in a notice that opens the task and in their [Inbox](05-home-and-inbox.md#inbox),
unless they wrote the comment. Turn the notice off in Settings › Notifications under **When someone
mentions me in a comment**. If the person is later removed from your list, the chip reads "Someone
no longer here".

### Following

**Follow** in the task drawer's header turns to **Following**; press it again to stop. You follow a
task on your own when you create it, are assigned it, or comment on it. When someone else changes a
task you follow, or comments on it, Ostler tells you with a notice that opens the task. A burst of
changes makes one notice, not many. Turn it off under **When someone else changes a task I follow**.
Following is yours alone: nobody else sees what you follow.

### Sign-offs

A sign-off is a person's yes on a task, [decision](08-decisions.md#sign-offs) or
[milestone](06-milestones-and-goals.md#sign-offs). The **Sign-off** section of the drawer shows it.

- **Ask for sign-off** opens **Ask who**: choose a person and press **Ask**. The section then says
  "Asked of Ana · date" and **Waiting**. Owners, Editors and Contributors can ask; a Viewer can't.
- Only the person asked can answer. They press **Approve**, which shows **Signed off**, or **Send
  back** with a note under **What needs to change**, which the person who asked reads. A sent-back
  task or milestone goes back to Active.
- **Cancel request** takes a request back. The person who asked, or an Owner, can do it.
- A task or milestone with a sign-off **Waiting** can't be marked Done. Ostler says "Ana hasn't
  signed this off yet." Once it is signed off, or the request is cancelled, it can be completed.
- The Board shows **Waiting for sign-off** with the person's initials, or **Signed off**, on the
  card.

The person asked hears about it as **… asked for your sign-off**, and the person who asked hears
how it was answered. Both also appear in the [Inbox](05-home-and-inbox.md#inbox). The notice can be
turned off in Settings › Notifications under **When someone asks me to sign something off, or
answers my request**. In a shared project, anyone can answer a sign-off asked of them, whatever
their role.

## Archive and the recycle bin

- **Archive** a finished task to keep the Board short. Find it again under **More** › **Archive**,
  where **Bring back** puts it on the Board again.
- **Won't do…** closes a task nobody will do, without pretending it is done or losing why. Find it
  in a task's menu, in its drawer's **More** menu, or in the bar that appears when you select
  several tasks. Give an optional one-line reason, and choose whether to close its open subtasks
  too. The task moves to the Archive marked **Won't do** with its reason, keeps its status, and
  never counts as done in the Overview's numbers and charts. Undo from the message, or **Bring
  back** it later from the Archive or its drawer: it comes back with the status it had.
  - A repeating task skips this time: its next one is made, as if it were done.
  - A task queued for an agent: the dialog says its queued work will be cancelled first. Work an
    agent is doing now, or that waits for your review, has to be finished first.
- The Archive's **Show** list shows all archived tasks, finished ones only, or won't do only.
- **Delete** moves a task to the recycle bin (**More** › **Recycle bin**), where **Restore** puts
  it back. You can also undo straight away from the message that appears, or with `Ctrl` + `Z`.
