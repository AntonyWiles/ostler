# Milestones and goals

- A **goal** is the outcome you're after: "Launch the new website".
- A **milestone** is a point you deliver by, with a date: "Content ready", "Go live". It usually
  serves a goal.
- **Tasks** link to a milestone, and the milestone's progress comes from its tasks.

## Plan a project

The **Plan** view walks you through planning a project, with the tools for each part in one place.
While the project's stage is **Planning** it is a tab right after Overview, and Home opens the
project there. Otherwise it is in **More views**. You can also open it from the command palette
(`Ctrl+K`, then type "Plan").

Its steps are on the left, each marked **Done** or **To do**, and the step you pick is on the right.
It opens on the first step still to do. The marks are only advice: nothing is locked, and you can
open any step at any time.

- **Goal**: the project's goals, with **Add a goal**, and the project's brief from the Library. Done
  once the project has a goal.
- **Milestones**: each milestone with its goal, its date and how many tasks it has, and **Add a
  task** on each. It says how many milestones have no tasks yet. Use **Add a milestone**, or **Open
  Milestones** for the full view. Done once there is a milestone and every milestone has a date.
- **Tasks**: **Plan several tasks** lets you type or paste a whole list at once, with subtasks,
  dates, estimates, milestones and what each task waits on. **Add a task** adds one. Milestones with
  no tasks yet are listed, each with its own **Add a task**, and so are tasks not in a milestone
  yet (click one to open it). With Ostler AI set up you also get **Suggest tasks**, **Break down with
  AI…** for each active goal, and **Talk it through with Ostler AI**, the project's notes chat, which
  proposes goals, milestones and tasks you add with a click. In a software project with agents on,
  **Plan and split…** is there too. Done once there is a task and every milestone has at least one.
- **Schedule**: when the plan finishes if it holds, and how many tasks set that date. It lists the
  tasks to fix, each opening with a click: tasks with no date and no dated milestone, tasks dated
  before something they wait on, and tasks due after their milestone. It also says how many
  milestones have no date. **Open Timeline** is where you fix them. A task in a milestone with no
  date isn't scheduled. Done once there is a task and nothing is left to fix; then **Save a
  baseline** keeps today's dates.
- **People**: shown only when the project has people to plan for, that is, someone other than you
  has tasks in it, or it has people of its own. It lists each week where someone has more than they
  can do (across all their projects), people with no weekly hours set, tasks with no one assigned
  and tasks with no estimate. **Open Workload** opens [Workload](05-home-and-inbox.md#workload)
  showing just this project. Done when no one has more than they can do.
- **Start**: the other steps as a checklist. For a project in Planning, **Start the project** moves
  it to Active and opens its Overview, whether or not every step is done; **Undo** in the message
  moves it back. When the plan has dates, **Save these dates as a baseline** is ticked, so starting
  keeps a [baseline](04-views.md#baselines) called "Plan at start".

Below the steps, **Whiteboards** lists the project's whiteboards, for sketching ideas and mapping
out the work beside the plan. It isn't a step and has no Done mark. Press **New whiteboard** to
start one, from a blank board or a template; see [Whiteboards](30-whiteboards.md).

While Plan is a tab, the `Ctrl` + number shortcuts for the tabs after it move up by one.

## Success criteria

A milestone can list its success criteria: what must be true for it to count as done, one per line.
Set them when you create the milestone, or change them from the milestone's edit dialog. Saving
replaces the whole list.

## The Milestones view

A milestone can belong to one [workstream](31-workstreams.md), and the view can be opened for just
one workstream.

Open the **Milestones** tab in a project. Use the **Goal** and **Milestone** buttons to add them. Each
milestone shows:

- its due date, and whether it is on track, at risk or late
- how many of its tasks are done
- whether it is ready: open blockers and unfinished tasks are listed so you can see what stands in
  the way

Link a task to a milestone from the task's drawer, or move cards on the Board's milestone
swimlanes.

### Against a baseline

Once a project has a [baseline](04-views.md#baselines), each milestone card says how far its date
has moved against it, for example "4 days late against 'Plan agreed 3 October'", "2 days early
against …" or "On its baseline date". The cards use the baseline chosen in the Timeline's
**Compare with**, or the newest one when none is chosen. A milestone added since says so.

## Goals with numbers

Many goals are numbers: sign up 200 members, raise £3,000, cut the backlog to 20. Give a goal a
**measure** with **Add a measure** under its name in the Milestones view:

- a **unit**, such as members, £ or km (up to 20 characters, or none)
- a **start** and a **target**, each with a date
- whether **higher** or **lower** is better (a backlog you are cutting goes down)

Type numbers the way your region writes them, such as `1,5` where a comma is the decimal separator.

Then **Check in** whenever you have a new number: the value, the day (today unless you change it)
and an optional note. A goal has one check-in a day; checking in again that day replaces the first,
with **Undo**. The goal then shows:

- the latest value against the target, "142 of 200 members" (the start value until the first
  check-in)
- whether it is ahead, on pace or behind the straight line from the start to the target, in words:
  within 5% of the line counts as on pace
- a small chart of your check-ins (points) against that line (dashed); **Show as table** lists the
  numbers
- the check-ins themselves, newest first, each with **Edit** and **Remove** (with **Undo**)

Reaching the target says **Target reached**, but the goal stays as it is: set it to **Achieved**
when you are ready. **Edit measure** and **Remove measure** are in the measure's **…** menu;
removing it keeps the check-ins, and **Undo** puts it back. Home's project cards show each active
goal's number, "Members: 142 of 200", and check-ins appear in the project's activity.

Measures and check-ins travel in the project file. A template keeps a goal's measure, with its dates
counted from the day the template is used, but no check-ins.

## Goals of your own

Some goals are bigger than one project, or belong to none: "Save £5,000 this year" draws on the side
business and the house budget, and "Read 24 books" has no project at all. Keep these in **Goals**,
which you open from the command palette (type "Goals"), **Goals of your own** beside the Projects
heading on Home, or a goal you pinned to the sidebar.

**New goal** asks for a title and, if you like, what reaching it means to you. Each goal of your own
has the same **measure** and **Check in** as a goal in a project, with its chart and whether it is
ahead, on pace or behind. Change its status to **Active**, **Achieved** or **Dropped**: active goals
come first, and achieved and dropped ones fold away below them. **Edit**, **Remove the measure** and
**Delete** are in its **…** menu; deleting it removes its check-ins too, and **Undo** puts it all
back.

### Project goals that count towards it

A project goal with a measure in the same unit can count towards a goal of your own: the side
business's "Save £2,000" and the house budget's "Save £3,000" towards "Save £5,000". Either:

- in the project's Milestones view, choose **Counts towards…** in the goal's **…** menu and pick the
  goal of your own (or **Nothing** to stop); the goal then says "Counts towards Save £5,000", which
  opens it in Goals
- in Goals, choose **Add a project goal** in the goal's **…** menu and pick one from any project,
  grouped by area

Both goals need a measure with the same unit (capitals aside) that goes the same way, higher or
lower is better; anything else is refused with a message saying why. A project goal counts towards
one goal of your own at most.

While project goals count towards it, the goal of your own's number is the **sum of their latest
values**, and its chart shows that sum on each day one of them was checked in. Its own check-ins are
kept but don't count, so there is no **Check in** for it until the last link goes. Goals lists each
linked goal with its project's colour and icon and its latest value; a project that is off still
counts, and says so. Stopping a link never changes either goal's check-ins, and **Undo** puts it
back. If a linked goal's unit or direction changes later, it shows that it no longer counts.
Removing a project removes its links; deleting a project goal removes its link.

### Pins and countdowns

**Pin to sidebar** in a goal of your own's **…** menu puts it in the sidebar's Pinned section; it
has no Overview to pin to. A pinned goal whose measure has a target date can **Show as countdown**,
like a pinned milestone: "40 days to Save £5,000" on Home, in the notification-area menu and in the
taskbar's jump list, each opening it in Goals.

Goals of your own are yours: they never go in a project file, and a project goal's link to one is
left out of it. Backups keep them, as they keep everything. Ostler AI may read them, as it reads
everything Ostler holds, when you ask it something.

## Repeating rounds

Some work comes round again: the monthly accounts, the quarterly newsletter, the yearly tax return.
Make its milestone a **round**, and Ostler makes the next round for you with a fresh copy of its
tasks.

On a milestone, choose **Repeat this round…** in its card's **…** menu. It works on a milestone
with no tasks yet too: the next round copies the tasks this one has by then. Say when the
next round starts with the same choices as a task's repeat (every month on the 1st, every 3 months,
every year, every week on Monday), how many days a round lasts (worked out from the milestone's
dates; change it if you like), and the day the next round starts. The preview says what you will
get: "Next round: Accounts · May 2027, 1 May to 10 May, 14 tasks". Choose **Repeat**, and the card
shows "Monthly on the 1st. Next round: 1 May 2027".

When the next round comes round, Ostler makes a new milestone named after the first round and the
new one: the month ("Accounts · May 2027"), the quarter for a round every 3 months ("Q2 2027"), the
year, or the date for weekly and daily rounds. It keeps the outcome, success criteria and goal, and
its due date is the round's last day. Every task of the round that is not in the recycle bin is
copied into it:

- in the first column, with its checklist clear
- with its dates moved on to the new round. A monthly or yearly round moves them by whole months, so
  a task due on the 31st lands on the 30th in a 30-day month; a weekly or daily round moves them by
  days
- subtasks under their copied parents, and **Waits on** links between the copies
- comments, time entries and the earlier tasks themselves stay with the earlier round. Unfinished
  tasks stay where they are too

Repeating tasks are not copied, since they repeat by themselves; the preview says how many. Each
copy's activity says which round it was copied into.

Ostler checks when it starts and every hour while it runs, and makes a round on its start day. If
Ostler was closed through more than one start day, it makes only the latest round, and the Inbox
says "Accounts · May 2027 was started"; open it to go to the new round. **Start next round now**
makes the next round at once, even before its start day. **Stop repeating** turns the schedule off
(with **Undo**); every earlier round stays.

The schedule moves to each new round, so only the latest round of a series repeats. The Milestones
view shows a series as its latest round with the earlier rounds folded under it ("3 earlier
rounds"), and the Overview's range picker lists a series' rounds under their own heading, so the
charts for any round are one choice away.

The project file keeps each round's schedule and which round it was made from. A template keeps
the latest round of each series with its tasks and its rule, the next start counted from the day the
template is used.

### Compare rounds

Doing the same round every month is a chance to get better at it. **Compare rounds** puts a
series' rounds side by side: choose it under a series in the Milestones view, or beside the range
picker on the Overview when the range is one of a series' rounds.

- **How long each round took**: a small bar chart, the latest round on the right, each round's
  days (a solid bar) against its planned length (a dashed outline), and the same numbers in words
  beside it: "Accounts · May 2027 took 9 days of 10 days planned: 12 done, 1 won't do, 0 still
  open". A round runs from its first task starting to its last task finishing; while tasks are
  open it counts to today.
- **Each task, round by round**: a row per task and a column per round, each cell the task's cycle
  time in that round. A task is followed through the task it was copied from, so a task renamed
  between rounds stays on one row; a task added or dropped in a round says "not in this round".
  The slowest round of each row says "slowest". Once any task has time tracked, **Show** switches
  the cells to time tracked. The latest six rounds show; **Show earlier rounds** adds the rest. The
  task column stays in view while you scroll across rounds.
- **Export CSV**, **Save as PDF** and **Print** take the table with every round, in the measure
  shown.

The numbers are counted as the Overview counts them, so a round's cycle times and finished tasks
are the same as its charts'. Nothing here changes a round.

## Release notes

When a milestone is reached, **Write release notes** in its card's **…** menu drafts the notes for
you. An iteration has the same item in its **…** menu (see [Iterations](23-iterations.md)). The
draft lists the finished tasks, archived ones included (tasks closed as won't do, still open or in
the recycle bin are left out), under a title ("Release notes: Version 2"), the day it was reached
(or today) and a count such as "12 tasks finished". Choose how to group them:

- **Type**: a section per task type, in the order Project settings › Tasks › Task types shows, then
  **Other** for tasks with no type
- **Label**: a section per label, by each task's first label, then **Other**
- **Nothing**: one list

Tick **Include each task's first sentence** to add the first sentence of each description, and
**Include subtasks** to list finished subtasks under their parent. The preview follows as you
change them. **Create note** saves the draft as a Library note tagged `release-notes` and opens it,
so you can edit it there; **Undo** in the message takes it away again. If a note with the same
title is already in the Library, Ostler asks whether to **Replace its text** or **Make a new note**.

When Ostler AI is set up, **Polish with AI** sends the draft (the names, task titles and any first
sentences you included, nothing else) and shows a friendlier version beside it. **Accept** puts it
in the draft, **Try again** asks for another and **Discard** keeps your draft. If the friendlier
version leaves a task out, Ostler says which.

## Sign-offs

A milestone can be sent for sign-off: open it and use **Ask for sign-off**, **Ask who**, **Ask**.
The person asked can **Approve** or **Send back** with a note; a sent-back milestone goes back to
Active, and a milestone that is waiting can't be marked Done until it is signed off or the request
is cancelled. Its card shows **Waiting for sign-off** or **Signed off**. See
[Sign-offs](03-tasks.md#sign-offs) for the whole flow.

## On the Overview

A project's **Overview** shows its open milestones at a glance (once it has milestones), what
needs you, what is in progress and what is up next, and, under **Insights**, charts of how the
work is going. See [Reports](12-reports.md).

## With Ostler AI

When AI is set up, **Break down with AI** on a goal drafts the milestones and tasks to reach it.
You review the draft and choose what to add. Nothing is created until you say so. See
[Ostler AI](13-ostler-ai.md).
