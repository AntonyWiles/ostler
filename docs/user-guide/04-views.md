# Views: Board, List, Calendar, Timeline and Matrix

Every project shows the same tasks in several ways. Its everyday views are tabs at the top:
Overview, Board, List, Calendar and Library, with Files, History and Agents in a software project.
Switch with the tabs, or with `Ctrl` + `1` to `Ctrl` + `9` in tab order.

**More views**, after the tabs, lists every other view with a line on what it is for: the Plan, the Timeline,
Milestones, Decisions, the Matrix, To triage, Someday, Costs, Shopping, the time report, the Archive
and the Recycle bin. A view opened from there shows as a tab while you are on it. A view the project
uses earns a tab of its own, so a project that plans with start dates has a Timeline tab, one with
milestones a Milestones tab, and one with costs a Costs tab, while a project that doesn't is not
crowded with them. The **Plan** is a tab right after Overview while the project is in Planning (see
[Plan a project](06-milestones-and-goals.md#plan-a-project)). When the window is too narrow for every tab, the last ones move to the top of
More views rather than off the end of the row; the view you are on always keeps its tab.

The project's **More** menu (the `…` button in its header) holds the project's tools, its settings,
**Import and export**, and **Print** on a view that prints.

## Board

One column per status. A project can name its columns in its own words ("To do", "Doing"),
hide Ready, Blocked or In review when it never uses them, and add columns of its own that each
count as one of the six, in **Project settings** › **Board**
(see [Projects and folders](02-projects-and-folders.md#columns)). The project's names show
everywhere its tasks do: the Board, the List, the drawer, filters, Home, the Inbox, the Overview's
charts and exports. A hidden column leaves the status pickers and **Add filter** too. Group the
board into swimlanes by milestone, goal or assignee from the
toolbar, and sort each column by priority, due date, title or when it was created.

Drag a card from anywhere on it: the pointer becomes a hand. A click opens the task in the drawer,
where you change its fields (the List changes them in place too). A card at rest shows its title,
its facts and its labels; pointing at it adds nothing over the title. Its ID is in its menu
(**Copy ID**) and the drawer.

**View options**, in the toolbar, holds everything about how this board looks, in one place. At
its top, **Columns on this board** shows and hides columns in a click, a column with tasks in it
too, so you can look at just To do and In progress for a while. It changes only the view you're in,
which keeps it like its grouping; **Show all** brings every column back, and the button says how
many are hidden. To rename columns or hide one for the whole project, use **Customise board…** at
the foot of View options › **Columns**.

Select several cards to change them all at once: `Ctrl` and a click selects a card, and **Select
all in** a column's header selects the whole column. **Show selection boxes**, the button with the
ticked list in the toolbar, puts a box on every card; it is off until you turn it on. While cards
are selected, the bulk bar takes the toolbar's place without moving the board.

**Manual order** (the sort a new project starts with) is an order only you change. Drag a card
between two others, in its own column or another, and it stays exactly where the line showed, even
after a restart. A new task goes to the end of its column, and editing a task never moves it.
Swimlanes show each lane's cards in the same order. Under any other sort the column decides where a
card goes: dragging to another column changes its status, dragging within a column does nothing,
and a hint says to choose Manual order to arrange cards by hand.

This order is not the agent queue's. Queued agent work has an order of its own, which you change in
the Agents view.

From the keyboard: `J` and `K` (or the arrow keys) move between cards, `Enter` opens one, `X`
selects it, `E` edits its title, and `Delete` moves it to the recycle bin. `Shift` with `←` or `→`
moves a card to the next column. In Manual order, `Alt` + `↑` or `↓` moves the focused card up or
down its column, and `Alt` + `←` or `→` moves it to the previous or next column; focus stays on the
card, and Ostler says where it went ("Moved above Pay invoice, 3 of 8").

### Customise board

**Customise board…**, at the foot of View options, opens everything about the Board in one panel
beside it. Each change shows on the Board behind the panel as you make it.

- **Toolbar**: the search box and filters, the same ones as the toolbar's, with the task count.
- **Views**: this project's **Default view** and saved views, and the views and default kept for
  **All projects**. Click a view to show it. While a saved view has changed, **Save changes** keeps
  the change in it and **Revert changes** puts it back as it was saved. Rename or delete any saved
  view (a delete can be undone). **Save view…** asks whether to keep it for this project or for all
  projects; a view for all projects is offered in every project's Views menu.
- **View options**: grouping, sort, Hide done and the fields on cards, the same as View options.
- **Columns**: the project's column names, which columns show and its own columns, with **Add
  column** (the same as **Project settings** › **Board**), and each status's work-in-progress
  limit.

The Default view keeps what you change as you change it. Until a project changes it, it follows
the **default for all projects**, and that one is the standard board until you set it: **Set as
default for all projects** makes what is showing the board every project opens with, unless it has
a default of its own. **Reset to default** forgets this project's own default, so it follows the
default for all projects again; **Reset to standard** forgets the default for all projects.

**Settings for all projects**, at the foot of the panel, opens **Settings** › **Projects** ›
**Board for all projects**: the default for all projects (with **Reset to standard**), the views
for all projects (rename or delete them) and a way back to Customise board. **Customise board…** is
also in a project's **More project actions** menu, its menu in the sidebar, and **Project
settings** › **Board**.

## List

A table of tasks with the columns you choose. Sort by any column, group by status, assignee,
milestone, priority, label or due date, and change a value in place by clicking its cell. Select rows to change
several tasks at once. **More** › **Export this view to CSV…** saves what you see as a spreadsheet,
in the order you see it.

With no column sorted, the List is in **Manual order**, the Board's own order (**View options** ›
**Order** › **Manual order** clears a column sort). Ungrouped or grouped by status, drag a row
above or below another, or press `Alt` + `↑` or `↓` on a row, to move it; dropping a row in another
status group also changes its status.

A task's subtasks, in the task drawer, keep their order too: drag one above or below another in its
phase, or press `Alt` + `↑` or `↓` on it.

## Calendar

Tasks on their due dates, by **Month**, **Week**, **Year** or **Agenda**. Drag a task to another
day to move its due date, or drag one from the **Unscheduled** panel onto a day to give it a date.
Use **+** on a day to add a task due then. Press `T` to go to today. With a task focused, `Alt` and
the arrow keys move it a day (left and right) or a week (up and down).

- **Year** shows twelve small months, to see the busy months and the gaps at a glance. A day with
  work is shaded: lightly for one task or milestone, more for a few, fully for many. Click a day, or
  press `Enter` on it, to open its week. The arrow keys move between days, and `Page Up` and
  `Page Down` between months.
- **Agenda** lists the month day by day, the way a diary reads: each day with its milestones and
  tasks, and a task over several days once, on its first day, with its dates. Days with nothing are
  left out. Click a task to open it.

Previous and next move by a year in Year and by a month in Agenda. Year and Agenda use the view's
filter and search like Month and Week, and the mode is kept with the saved view.

To see the due dates in Outlook or Google Calendar, choose **Export to calendar file…** from the
project's **More** menu while the Calendar is open (or from the command palette). See
[Import and export](11-import-and-export.md#a-calendar-file).

[Days off](05-home-and-inbox.md#days-off) for everyone are striped and named on the day, in every
mode; a person's leave shows as a quiet note, such as "Sam off".

### Your meetings beside your tasks

Once you add a calendar file in Settings › General › **Calendars** (see
[Calendars](05-home-and-inbox.md#calendars)), its events show in Month, Week and Agenda beside your
tasks, so you can see how much of a day meetings take. They are quieter than tasks: outlined, with
the calendar's colour as a thin mark, and the time first, such as "09:30 Stand-up". An event that
runs past midnight shows on both days. Year leaves them out.

A calendar can also be a private calendar link that Ostler keeps up to date (see
[A calendar link that stays up to date](05-home-and-inbox.md#a-calendar-link-that-stays-up-to-date)):
in Outlook, **Publish a calendar** gives its ICS link; in Google Calendar, the calendar's settings
give a **Secret address in iCal format**; in Apple's iCloud Calendar, **Share Calendar › Public
Calendar** gives a `webcal://` address. Anyone with that address can read the calendar, so keep it
to yourself. When a shown link has not updated for a day, a quiet note beside **Show my calendars**
says so, such as "Work calendar last updated yesterday", with **Refresh**.

Turn **Show my calendars** off on the toolbar to see tasks alone; the choice is kept with the saved
view. Events can't be dragged or changed. Click one for a small card with its title, time, place,
description and calendar, and **Make a task**: pick a project, and New task opens with the event's
title, its date as the due date, and its time and place in the description, for you to check and
create. Nothing else turns an event into a task.

### Time blocks

A due date says when a task must be done; a **time block** says when you will do it. **Week** has
the day's hours under its all-day row, from midnight to midnight. It opens on your **Working
hours** (09:00 to 17:00 until you change them in Settings › General) and shades the rest; scroll
for the whole day. A red line marks the time now on today. Timed meetings from your calendars sit
in the hours at their times; tasks and all-day events stay in the all-day row. Items at the same
time share the width.

- **Block time:** drag a task from the all-day row or the **Unscheduled** panel onto an hour. While
  you drag over the hours, the spot says "Block time at 10:00"; over the all-day row the day is
  highlighted instead, and dropping there moves the task's dates as before. A block starts on the
  quarter hour you drop it on and lasts the task's estimate in hours (an hour in a points project or
  with no estimate), ending at midnight at the latest. Blocking time never changes the task's dates,
  and a task can have several blocks.
- **Move and resize:** drag a block to another time or day, or drag its bottom edge to make it
  longer or shorter. With a block focused, the up and down arrows move it a quarter hour, Shift and
  an arrow move it a day, and Alt with up or down makes it a quarter hour shorter or longer.
- **Block time…** in a task's menu or its More menu does the same from the keyboard: a date, a
  start and a length. On a day off, the date shows the same note date fields do; it never stops
  you.
- Click a block, or press `Enter` on it, for its card: the task's title, project, time and status,
  **Open task**, **Start**, which starts the task's timer, and **Remove**, with **Undo**.

A block is a plan, not time logged: blocks never add time entries, and stopping the timer never
changes a block. Month and Agenda show a task's blocks as times on their days, such as "09:00 Write
the proposal". The task's details list its coming blocks under its dates, and
[My day](05-home-and-inbox.md#plan-my-day) shows today's. Blocks are your own planning: they don't
travel in the project file or templates. A task in the bin hides its blocks, and deleting it for
good removes them. The automation API reads and changes them at `/time-blocks`.

### Blocks that move

Plans slip. A block whose time has passed while its task is still open shows as **passed**: it is
drawn more quietly, and a screen reader hears "passed" after its time. Its card offers **Move to
the next free time**, which moves it at once to the first free stretch as long as it is, from now
on, and says where in a message with **Undo**.

**Free time** is your Working hours on your working days (yours in People, Monday to Friday
otherwise), not on a day off, and not taken by another block (in any project) or a timed meeting
from a shown calendar. All-day events take no time. Ostler looks up to 14 days ahead; when nothing is
free, the block stays where it is and Ostler says so.

**Fill my day**, in My day on Home and in the Week's toolbar while the week shows today, places My
day's unfinished tasks into today's free time, in My day's order. Each task gets its estimate in
hours, less what is already blocked for it today (an hour when it has no estimate in hours), from
now (rounded up to the next quarter hour) or the start of your Working hours. A task that no free
stretch holds whole is split into pieces of at least 30 minutes. Before anything is made, a preview
lists each task with its time, "split in two" for a split task and "did not fit" for one that does
not fit, and the Week draws the blocks faintly on its hours. **Place them** makes all the blocks at
once, and one **Undo** removes them all. On a day off, or a day that is not one of your working
days, it says so and places nothing.

Nothing moves by itself: no timer, start-up step or background job moves a block. If time moves on
between the preview and your click so that a time it showed has passed, Ostler works the times out
again and shows them before you try once more. Meetings that changed since the preview are not
checked again: move anything that now clashes. The automation API offers the same at
`POST /time-blocks/:blockId/move-to-free` and `POST /time-blocks/fill`.

## Timeline

Each task as a bar from its start date to its due date, with milestones, and arrows for what waits
on what. Drag a bar to move it, or drag its ends to change its dates. Zoom in and out, or switch to
a table. Press `T` to go to today. With a bar focused, `Alt` and the left and right arrows move it
a day; add `Shift` to move only its due date, or `Ctrl` to move only its start date.

A bar that is too early for something it waits on is marked, with its arrow: it starts before
that task is due, or before the day its link allows when the link has another kind or some days
([How it waits](03-tasks.md#how-it-waits-and-by-how-many-days)); the tooltip says which. When you move a
task's due date later and tasks that wait on it now start too early, Ostler says so in a message
with **Preview** and **Leave them**. See [Move what waits on it](03-tasks.md#move-what-waits-on-it).

### Links on the Timeline

Each arrow joins the ends its link waits on: **Starts after it is due** runs from the end of one bar
to the start of the other, **Starts after it starts** from start to start, and **Due after it is
due** from end to end. A link with days shows them on its arrow, such as "+2d" or "−1d", and
pointing at an arrow says the link in words, for example "Painting starts 2 days after Plastering
starts".

To make a link, point at a bar: a small handle shows at each end. Drag from a handle on the task to
wait on to a handle on the task that waits. The ends you join choose how it waits (end to start,
start to start, or end to end); start to end is not offered. A small box then asks you to confirm
how it waits and set the days (0 to begin with), and **Add link** makes it. From the keyboard, open
a bar's menu with `Shift+F10` or the Menu key and choose **Link to…**, then pick the task that
waits.

Select an arrow, by clicking it or by tabbing to it and pressing `Enter`, to change how it waits or
its days, or to **Remove link**. Every change is the same as in the drawer's **Waits on**, with the
same checks (a task cannot end up waiting on itself through other tasks, and a subtask waits only on
tasks in its own phase) and **Undo** in its message.

### Critical path

Tick **Show critical path** to see which tasks set the project's end. Those tasks get a strong
outline and the word "Critical", and the arrows between them are drawn heavier, from the ends
their links join. Every other dated
task says how far it can slip, for example "Can slip 4 days", in its tooltip and its name for
screen readers. A task that is already too late to meet the end says "Late against the end by 2
days". The Timeline remembers the setting with the view.

**For** chooses what to measure against: the project's end (the latest due date among open tasks),
or a milestone. For a milestone, its date counts, or its latest task's due date when it has none,
and only its tasks and the tasks they wait on are counted. A panel beside the Timeline lists the
critical tasks in order with their dates and how each waits on the one before it (a few chains when
they tie), and the open tasks that have
no dates, which are not counted. Select a task there to open it. With **Show as table**, a Slack
column says the same.

Ostler works this out from the dates as they are set and the waits-on links; it does not move or
schedule anything. A task runs from its start date to its due date, and a task with only one of
them counts as one day. A task can start on the day what it waits on is due, and each link's kind
and days count the same way as for the marks. Slack is in calendar
days, and done tasks are left out. The automation API gives the same answer at `GET
/critical-path`.

### Baselines

Plans move. A baseline is a named copy of every task's and milestone's dates as they are now, so
you can see later how far things have moved. Choose **Save a baseline** in the Timeline's toolbar
or the project's More menu, give it a name ("Plan agreed 3 October" is suggested from today) and
save. Archived tasks and tasks in the bin are left out. A project keeps up to ten baselines; saving
an eleventh asks which one to delete to make room. **Baselines** in the More menu lists them, with
when each was saved, and lets you rename or delete one (with Undo).

A baseline never changes: moving a task, or deleting it, leaves the baseline as it was.

Choose a baseline in **Compare with** to draw it on the Timeline. Each task's baseline dates show as
a thin, hollow bar under its bar, and each milestone's as a hollow diamond. The tooltip and the
name screen readers hear add how far it has moved, for example "3 days later than 'Plan agreed 3
October'", or say the task is new since. A line above the Timeline counts how many tasks are later,
earlier and new. A task moves by its due date, or by its start when it has no due date, in calendar
days. The Timeline remembers the choice with the view; choose **No baseline** to hide it. The
milestone cards say how far each milestone has moved
([Milestones and goals](06-milestones-and-goals.md#against-a-baseline)).

At Week zoom, [days off](05-home-and-inbox.md#days-off) for everyone are shaded like weekends, with
an outline, and named when you point at the day in the scale.

### Timeline across projects

To see every project side by side, open **Timeline across projects** from the command palette
(`Ctrl+K`) or with the **Timeline** link beside Projects on Home. Each enabled project has a row,
under its area if you use [areas](02-projects-and-folders.md), with its colour and icon. Its
milestones are diamonds on their dates, and a thin bar runs from its first to its last dated task.
A project with no dates yet still has its row, marked "No dates yet". Today is a line, and at Week
zoom weekends and days off for everyone are shaded as on a project's Timeline. Zoom by weeks,
months or quarters.

Select a project's name (or press the right arrow on it) to open its row: its dated tasks and
milestones appear under it, grouped by milestone, drawn as on the project's own Timeline. Done tasks
are left out. The left arrow closes it again, and the up and down arrows move between rows.

A week where milestones from two or more projects meet is marked on the scale with how many there
are. Select the mark to list them ("3 milestones from 2 projects"), and select one to open its
project's Timeline. Two milestones of the same project in one week are not marked.

Moving dates works exactly as on a project's Timeline, with undo: drag a task's bar or its ends, or
use `Alt` with the arrow keys on a focused bar. Drag a milestone's diamond, or press `Alt` and an
arrow on it, to move its date a day at a time.

**Projects shown** chooses all projects, the projects of one area, or **Chosen projects**, which
lets you tick the ones you want. Ostler remembers the choice and the zoom on this computer. The print
button prints the timeline, or saves it as a PDF, with every project shown and each milestone on its
own line.

## Matrix

The **Matrix**, in a project's **More** menu, answers "what should I do first?". It sorts the
project's open tasks into four boxes: **Urgent and important**, **Important, not urgent**,
**Urgent, not important** and **Neither**, each with its count.

- A task is **important** when its priority is High or Critical.
- A task is **urgent** when it is overdue or due within three days: today and the next three days,
  by your computer's date. A task with no due date is never urgent.
- In each box, the soonest due come first, then the higher priority, then by title.

The Matrix shows the tasks the Board shows, with the Board's filters and search: open tasks only,
and Someday and shown-later tasks stay out unless the Board shows them.

Drag a card up into an important box to make it High priority, or down to make it Medium. A card
that is already High or Critical keeps its priority going up, and one that is Low or Medium keeps
it going down; a Critical card moved down becomes Medium, and the message says "Priority: Medium".
Every change has **Undo**. A card can't be dragged across, between urgent and not urgent: urgency
comes from the due date, so Ostler says so and offers **Change the due date**, which opens the task.

With the keyboard, the arrow keys move between cards and boxes, `Shift` + `Up` or `Down` moves the
focused card up or down a box, and `Enter` opens it. Each box is a labelled region with its count.
The automation API gives the same boxes at `GET /matrix`.

## Open a view in a new window

With a second screen you can keep the Board on one and Home on the other, or the Calendar beside
the email it is planning from. **Open in new window** is in every project view's **More** menu, in
Home's **…** menu, and in the command palette (`Ctrl` + `K`, "Open … in new window"). The window
shows that one view under a slim title bar with the project's name, colour and icon (or "Home"),
without the sidebar.

The view works there as it does in the main window: open a task, use its menus, drag cards, and
**Undo** a change from that window's own message. A change made in any window shows in every other
window at once. A link to somewhere else, such as another project or Settings, opens in the main
window and brings it forward. `Ctrl` + `K` and Quick add act in the window you are in.

Each window remembers its size and place for that view; if the screen it was on is gone, it opens
in the middle of the main screen instead. Tick **Reopen at start** in its title bar menu (**Window
menu**) to have it open again the next time Ostler starts, if it was open when you quit.
The same menu has **Show the main window**. Closing the main window follows its usual rule
(background mode keeps Ostler running, otherwise it quits), and quitting closes every window.

At most eight views can be open in their own windows. Opening a ninth asks whether to close the
oldest. Windows are your screen layout, so the automation API has nothing for them.

## Filters and saved views

To look at one part of a project, open one of its [workstreams](31-workstreams.md): Overview, Plan,
Board, List, Calendar, Timeline, Milestones, Matrix, Triage, Someday and Archive then show only its
work.

Every view has the same filter bar. See
[Search, filters and saved views](09-search-filters-and-saved-views.md).
