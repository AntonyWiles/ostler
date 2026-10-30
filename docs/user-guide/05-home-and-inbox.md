# Home and Inbox

## Home

Home is where Ostler opens. It shows what needs you today across every project:

- **Quick add**, to capture a task without opening a project.
- **Today:** tasks that are overdue, due today, or in progress, assigned to you or to nobody.
  A task whose show-from date is today joins them, marked **New today**. Change a task's status
  right there with the button beside it. **See all my work** opens My work.
- **Today's events:** once you add a [calendar file](#calendars), a quiet line at the top of Today
  says how many events you have and what is next ("3 events today; next: 14:00 Design review"),
  with today's events in time order. Click one to see it, or to make a task from it.
- **Upcoming:** tasks assigned to you that are due in the next seven days, by day.
- **Checklist items** with a due date join Today and Upcoming as "item, in task" (see
  [Dates and people on checklist items](03-tasks.md#dates-and-people-on-checklist-items)): yours,
  and on Today also those for nobody, as with tasks. Overdue items come first and show how late
  they are. Tick one there to tick it on its task. Items of finished or hidden tasks stay off.
- **Needs you:** blocked tasks, and while AI agents are on, their questions, the
  [plans waiting for your approval](14-agents.md#plan-first) (open one to approve it, ask for
  changes or cancel the run) and the work waiting for your review.
- **Waiting for your sign-off:** the tasks, decisions and milestones someone has
  [asked you to sign off](03-tasks.md#sign-offs). It appears only when there are some.
- **Projects:** a card for each project with its progress, or the
  [board of projects](#board-of-projects).

Today and Upcoming leave out tasks in Someday and tasks hidden until a later day (see
[Show from and Someday](03-tasks.md#show-from-and-someday)).

They, and **Needs you**, also leave out On hold and Done projects (see
[Stages](02-projects-and-folders.md#stages)).

Today, Upcoming and Needs you each show their first 20 rows. A longer list ends with **Show 12
more** (or however many are left), which shows the rest; **Show fewer** shortens it again.
[My work](#my-work) lists all of your work.

### Board of projects

**Cards** and **Board** beside **Projects** switch how Home shows your projects; Ostler remembers your
choice on this computer. The board has a column for each stage, Planning, Active, On hold and Done,
grouped by area within each column when you have areas. Each card shows the project's colour and
icon, its progress, its next milestone and date, and how many tasks are blocked. Click a card to
open the project: a project in Planning opens at its [Plan](06-milestones-and-goals.md#plan-a-project),
any other at its Overview. **Open project** in a board card's `…` menu does the same.

- Drag a card to another column to change the project's stage. **Undo** in the message, or
  `Ctrl` + `Z`, moves it back.
- With a card focused, press `Alt` + `←` or `→` to move it one column, or use **Move to On hold**
  (and the other stages) in its `…` menu.
- **Rename column** in a column's `…` menu changes the name the board, Project settings and the
  sidebar show. Leave it empty for the default name. The stage itself does not change.
- Done shows its first five projects, then **Show 12 more**.

To open on the project you used last instead of Home, change **When Ostler starts** in
Settings › General.

### Plan my day

Today can hold twenty things on a day with room for five. **Plan my day**, beside Today, turns it
into a list that fits. It opens a panel with the tasks you might do today, in sections:

- **Left from Tuesday:** what you picked on the last day you planned and didn't finish.
- **Overdue**, **Due today**, **In progress** and **Starting today:** the tasks Today lists.
- **High priority, no date:** a few open high and critical tasks assigned to you.

Tick what you'll really do. The ticked tasks gather under **Your order**: drag them, or press Alt
and the up or down arrow, to put them in the order you'll work. The panel adds up their hour
estimates against today's hours: your daily capacity from [Workload](#capacity-and-working-days)
(your weekly hours over your working days), or, if you haven't set one, a number you type in the
panel (Ostler remembers it). Tasks in points projects are counted apart, and tasks with no estimate
are counted too, so nothing is quietly left out of the total. **Start my day** saves the list.

**My day** then comes first on Home: your tasks in your order, each with its project, due date and
estimate. Tick a task to mark it done (exactly like changing its status anywhere else, so repeats,
reminders and rules follow); done tasks stay ticked until the day ends. Drag a task, or press Alt
and an arrow on it, to move it. The **×** takes it out of My day, with **Undo**. Today follows,
without the tasks already in My day. **Change my day** opens the panel again.

If you have [time blocks](04-views.md#time-blocks) today, My day lists them first, in time order,
with their time, length and task ("09:00 · 1 h 30 min · Write the proposal"); click one to open its
task. Each task in the list shows the times blocked for it today. Blocking time doesn't add a task
to My day by itself.

When blocks from the last week passed with their tasks unfinished, My day says so ("2 blocks passed
with their tasks unfinished") with **Move them**, which lists where each would go at the next free
time before anything moves; one **Undo** puts them all back. **Fill my day** places My day's
unfinished tasks into today's free time around your meetings, as a preview you accept with **Place
them**. See [Blocks that move](04-views.md#blocks-that-move).

My day belongs to its date. The next morning, if the last day you planned left tasks unfinished,
Home says so ("3 unfinished from Tuesday") with **Add to today** and **Let them go**. Nothing moves
until you choose.

To add one task to today's My day from anywhere, use **Add to My day** in its menu (on a Board
card, or the task's More menu), the button beside it in Today and Upcoming, or the **Add to My
day** tick box in quick add. Each has **Undo**. A task in Someday, or hidden until a later day,
comes back to your lists when you add it. Moving a task in My day never changes its place on the
Board. Archived, Won't do and deleted tasks drop out of My day by themselves.

The automation API reads and changes a project's tasks in My day at `/my-day`.

### Since you were last here

When you come back to Home after at least eight hours away, a card at the top says what happened
while you were gone, project by project:

- tasks finished and tasks added, counted by who did it: a person, agents, a rule, an import or the
  Automation API, with the first five titles and "and 214 more" for the rest;
- new comments, and the tasks they are on;
- due dates that passed while you were away, for tasks still open;
- reminders that went off;
- while AI agents are on, agent runs that finished, runs waiting for your review and questions
  waiting for an answer.

Each title opens its task; runs open the project's Agents view, and questions open the Inbox. A
project where nothing happened is left out. Ostler writes the card from its own records, so it works
without AI and never guesses.

- **Dismiss** closes the card. Looking at Home without a card, or dismissing one, counts as your
  last visit, so the next card starts from there. The first time you start Ostler there is no card.
- **Show what changed** in Home's menu (**…** beside the date) opens the card for the last 24
  hours, 3 days or 7 days whenever you like.
- **Listen** reads the card aloud, in the same words and order, with the Windows voice for your
  interface language. **Stop** stops it. Nothing is recorded or saved.
- **Write it up** appears when Ostler AI is set up. It asks Ostler AI for a short paragraph, shown at
  the top of the card and marked as Ostler AI's, with the facts still below it. See
  [Ostler AI](13-ostler-ai.md).

"When you were last here" is kept on this PC for this window, not as a setting.

### Print my week

**Print my week** in Home's menu (**…** beside the date) prints Today and Upcoming on one sheet, to
plan on paper; **Save my week as PDF** saves it instead, as "My week 15 October.pdf". It is also in
the command palette (`Ctrl` + `K`) and in the Calendar's Agenda (the printer button in its
toolbar). The sheet shows the same tasks Home shows: first Today, with why each task is there
(overdue, with its due date, due today or in progress), then each of the next seven days, with
ruled lines on a day with nothing due. Every task has an empty box to tick by hand, its project
and its priority in words, and milestones due that week in your projects are listed under their
day. Events from your [calendars](#calendars) are listed above each day's tasks. It prints in black
and white on A4 (Letter in the US).

### Your progress

A to-do list mostly shows what is left. Turn on **Show my progress** in Settings › General ›
**Progress** to see what you finished too. It is off until you turn it on; while it is off, Home is
unchanged.

With it on, Home has a **Your progress** card: the tasks you finished this week, the last eight
weeks as a small bar chart, and how many working days in a row you finished something, such as "12
this week. 6 working days in a row." Weeks start on the same day as the Calendar's. A day you
finished something always counts, a Saturday too. A day that is not one of your working days (in
[Settings › People](#capacity-and-working-days), Monday to Friday until you change them), or is one
of your [days off](#days-off) or everyone's, is skipped when you finished nothing, so it never
breaks the run. A working day with nothing finished ends it, but today does not before the day is
over. Nothing is scored: no points, levels or praise.

What counts is the same everywhere: a task counts once, on the day it last moved to Done, if it is
still Done and assigned to you or to nobody, in an enabled project. Archived tasks count; a task
reopened since does not, and nor does a deleted one.

**Your year…** on the card prints a page of a year's finished work, or saves it as a PDF. See
[Your year](12-reports.md#your-year).

### Countdowns

Some dates matter more than the rest: the launch, the move, the exam. A pinned milestone with a
target date, or a pinned task with a due date, can show as a **countdown**: choose **Show as
countdown** in its pin's right-click menu (in the sidebar's Pinned section or a project's
Shortcuts), or in the item's own `…` menu while it is pinned. When you pin a dated item, the
message offers it too. **Stop the countdown** in the same places turns it off.

Home then shows a card for each countdown near the top, in pin order: the countdown in words, the
date, the project's colour and icon, and a small bar of the time passed since you pinned it. Select
a card to open its item. A countdown reads the same everywhere:

- "12 days to Launch", "Launch is tomorrow", "Launch is today", "Launch was 2 days ago".
- After more than a week it adds the working days when they differ, as in "12 days to Launch (9
  working days)". These are your own: your working days in Settings › People, less your
  [days off](#days-off) and everyone's. Other people's leave never changes your countdown. When no
  one is you, it is Monday to Friday less everyone's days off.
- Once the milestone is complete or the task done it says "Launch: done", and its card offers
  **Turn off**.

At most three countdowns show at once. Turning on a fourth asks which of the three to turn off.

Countdowns also appear in the notification-area menu (when Ostler [runs in the
background](#keep-ostler-running-in-the-background)) and in the taskbar's jump list of an installed
Ostler; each opens its item, whether Ostler is open or not. Dates are your local dates, and both
menus move on to the new day by themselves, also after the PC wakes from sleep.

## Reschedule overdue tasks

After a holiday or a busy week, Today can open with a pile of overdue tasks. **Reschedule…**,
beside Today's heading while it has overdue tasks, moves them all in one go. In My work, grouped
by due date, the Overdue group ends with **Reschedule overdue tasks…** for that person's tasks.

Choose how to move them:

- **To today**, **To tomorrow** or **To a date:** every task becomes due that day.
- **Spread over the next working days** (five unless you change it, starting tomorrow): the
  highest priority first, then the longest overdue. Each day fills up to your daily hours, your
  weekly capacity from [Workload](#capacity-and-working-days) shared over your working days,
  counting what is already due that day. A task without an hour estimate, or in a project that
  counts points, counts as one hour. Without a capacity, a day takes three tasks. Days that are not
  your working days are skipped, and what does not fit goes on the last day.

The table below shows every task with its old and new due date before anything changes. A task with
a start date keeps the same number of days between its start and due dates. Untick a task to leave
it as it is. A repeating task moves this occurrence only; its repeat rule does not change. When a
task would now start before something it waits on is due, the table says so; Ostler does not move
the other task.

**Reschedule** moves them all, and the message that follows has **Undo**, which puts every old date
back in one step. A task that someone changed while the table was open is left as it is, and the
message says how many.

## Weekly review

Lists drift: overdue tasks pile up, blocked work waits without anyone asking why, and Someday fills
up. **Weekly review**, at the top of Home (or "Weekly review" in the command palette), walks
through every project in one place, one step at a time. Beside the button, Home says when you last
finished one ("Last review: 6 days ago", or "No review yet").

The steps, each with a count in its title, or "Nothing here" when it is empty:

1. **Inbox:** how many items wait, and **Open the Inbox**.
2. **Overdue:** every overdue task assigned to you or to nobody. **Reschedule…** moves them all,
   as [Reschedule overdue tasks](#reschedule-overdue-tasks) does; each task also has **Open**,
   **Someday** and **Won't do**.
3. **Blocked for more than three days:** how long each has waited since it was moved to Blocked,
   with **Open** and **Won't do**.
4. **Nothing changed in 14 days:** open tasks nobody has updated for two weeks, the oldest first,
   with **Open**, **Someday**, **Won't do** and **Still on**, which only leaves the task off this
   review.
5. **Someday:** every task in Someday, the oldest first, with **Bring back**, **Keep** (off this
   review only) and **Won't do**.
6. **The next two weeks:** tasks and milestones due from today, by day, to look over.
7. **Milestones at risk:** each project's late milestones, and those that cannot be forecast yet,
   as its [report](12-reports.md) lists them, with **Open**.

**Next** and **Back** move between steps, and **Skip** moves on and leaves that step out of the
review's counts. Every action happens at once and its message has **Undo**. **Won't do** closes the
task without a reason; to give one, use **Won't do…** in the task's own menu. The review is a page,
not a dialog: open a task, come back, and it is on the same step. Disabled projects are left out,
as they are on Home.

**Finish review**, on the last step, records the review: when it finished and, for each step you
went through, how many tasks it showed and how many of those you changed. Where you were is kept
on this computer until you finish.

### Weekly review reminder

Settings › Notifications › **Weekly review reminder** is off unless you choose a weekday, and a time
(16:00 unless you change it). At that time, while Ostler runs, a notification and an Inbox item say
it is time; click either to open the review. During quiet hours the reminder waits until they end.
If Ostler was closed at that time, the Inbox item is there when it next starts, once, without a
notification. Finishing a review that week, before or after the reminder, clears it.

## My work

My work, in the sidebar below Inbox (`G` then `M`), lists every open task assigned to you in every
project, beyond the week Home shows. It is one table, like a project's List:

- **Person:** you by default. Pick anyone else to see their work. Archived people are not offered,
  but a link to an archived person's work still opens it.
- **Project:** every project, or one. With one project chosen, the filters also offer its
  milestones and labels.
- **Group by** due date (Overdue, Today, This week, Next week, Later, No date), project, status or
  priority, or not at all. Weeks run Monday to Sunday. Click a column heading to sort by it.
- **Search** and **Add filter** narrow the list by status, priority, dates, estimate or words.
  **Hide done** is on unless you turn it off.
- Change a task's status, due date, priority or assignee in place: click its cell, or focus it
  and press `Enter`. A task you give to someone else leaves your list. A task queued for an agent
  changes status in its project, where its run is.
- Press `Enter` on a task, or double-click it, to open it in its project with its drawer.
- **Checklist items**, above the table, lists the person's dated checklist items in open tasks,
  whoever the task belongs to. Tick one there to tick it on its task.

My work leaves out On hold and Done projects. It remembers its person, project, grouping, sort and filters on this computer. Archived tasks,
tasks in the recycle bin, tasks in Someday and tasks hidden until a later day are not listed. The links under its title open the
[Timesheet](20-time-tracking.md) and Workload.

### My tasks in To Do or Google Tasks

With a Microsoft 365, Outlook.com or Google account connected with **Tasks** turned on, **Settings ›
Connections › Accounts** has **My tasks in To Do or Google Tasks**. **Choose a list…** copies the
open tasks assigned to you, in every enabled project, into a Microsoft To Do or Google Tasks list,
so they are on your phone beside your other to-dos.

- Each item has the task's title, its project's name and its due date. Ostler's version wins: a
  title or date changed here is changed there, a few seconds later.
- **Tick an item off there and its task is marked done here**, as you. Ostler reads the list a
  minute after it starts and every 15 minutes.
- A task done here is ticked off there; a task reassigned or archived is removed from the list.
- An item you delete there isn't made again until its task changes.
- **Stop** deletes the open items Ostler made; your tasks stay here.

## People

People are who work is assigned to. They live in two places:

- **The address book**, in Settings › People. Everyone in it can be given work in every project,
  and it goes to your other PCs with your settings. You ("Me") are always here.
- **A project's own people**, in that project's Project settings › People. They can be given work
  only in that project, and they go when the project is removed. The demo projects keep their made-up
  people here, so removing the demos removes them too.

Both lists work the same way: add a person, **Edit** their name, colour, capacity and working days,
or **Archive** them. An archived person keeps the tasks they have but is no longer offered for new
work; **Show archived people** lists them, and **Bring back** returns one.

### Delete a person

**Delete…** removes someone for good. You can't delete yourself, or a member of a
[shared project](28-sharing-a-project.md) (remove them in that project's sharing settings first).

If the person has work, the dialog says how many tasks they have and in which projects, and how many
[rules](24-rules.md) name them. Choose what happens to it:

- **Give it to someone else.** You are offered first. Their tasks, checklist items, turns in a
  [repeat](03-tasks.md), and the rules and task templates that name them all pass to that person.
  When the work is in more than one project, only someone in the address book can take it.
- **Leave it unassigned.** Their tasks have nobody on them, they drop out of repeats' turns, and
  rules that name them are turned off.

Their days off go with them. Comments, activity and time they logged stay, without their name.
Deleting can't be undone.

## Workload

Workload shows who has too much on. Open it from the command palette (`Ctrl+K`, then type
"Workload"), from Settings › People, or from My work. It has no row in the sidebar. **Open
Workload** on a project's [Plan](06-milestones-and-goals.md#plan-a-project) opens it showing just
that project.

Each active person has a row, and so do tasks nobody is assigned to (**Unassigned**). The columns are
this week and the next five; **Previous** and **Next** move a week at a time, and **This week** comes
back. Each cell says the hours planned against the person's capacity, such as "46 h of 40 h", with a
bar. When it is more than their capacity, the cell also says "over by 6 h". **Project** limits it to
one project, and **Team** limits it to one of your [teams](33-teams.md) (**All people** shows
everyone). **Team** beside the header opens the [Team view](33-teams.md#the-team-view) with the same
choices. People in a shared project who chose to
[show when they're away](28-sharing-a-project.md#showing-when-you-are-away) have those days counted
as **Away**.

Workload counts every open task the same way:

- A task's estimate in hours is spread evenly over its assignee's working days, from its start date
  to its due date. A task with no start date counts all on its due date; one with a start date but no
  due date counts on its start date.
- Work that is late and not done counts in this week.
- Tasks with no dates are in the **Unscheduled** column.
- Projects that estimate in points count their tasks as tasks ("2 tasks (1 in points)"), never as
  hours.
- A task with no estimate counts as a task with no hours.
- Done tasks are not counted. Weeks before this one show the hours logged with the
  [timer or by hand](20-time-tracking.md) beside the hours still planned.
- A [day off](#days-off), for everyone or for the assignee, is not a working day: it takes no share
  of an estimate and has no capacity. A week with days off shows less capacity, such as "12 h of
  32 h" with "capacity 32 h of 40 h: Christmas Day" under it.

Click a cell to see the tasks behind it and each one's share of the hours. Open a task, give it to
someone else, or change its start or due date right there.

### Capacity and working days

In Settings › People, **Edit** a person to set their **Weekly capacity** (0 to 168 hours, or empty for
none) and their **Working days** (Monday to Friday unless you change them). A person who works four
days spreads their tasks over those four days. Capacity is a planning number for you, not a promise
about anyone.

## Days off

**Days off** are days nobody works, such as bank holidays, and days one person is away, such as
leave. Find them in Settings › People, under the people list.

- **Everyone** lists the days nobody works. Each person with leave has their own list.
- **Add a day off**: choose who it is for (Everyone or one person), give it a name ("Christmas Day",
  "Leave") and a first day. Fill in the last day for a run of days, up to a year; leave it empty for
  one day. **Edit** changes a day off, and **Remove** takes it away at once, with **Undo** in the
  message that follows.
- **Import a holiday calendar…** reads a calendar file (`.ics`), such as one saved from Outlook,
  Google Calendar or gov.uk's bank holidays page. Its all-day events become days off, for everyone or
  for the person you choose. You see what will be added first, and which events are left out:
  events with a time, and repeats Ostler can't read. A yearly event on a fixed date, such as
  Christmas, is added for this year and the next five. The file can be up to 5 MB; nothing in it,
  such as a link, is ever opened.
- Loading the same file again for the same person, or for everyone again, replaces the days it
  brought last time. Loading it for someone else keeps both: the same team calendar can be each
  person's leave. **Calendar files** lists each file you imported and who it is for, with **Remove
  all from this file**, which takes away that one load.

Ostler has no built-in list of holidays: add the ones that apply to you. Days off are shared by
every project. They are not in project files, but backups keep them. Archiving a person keeps their
leave.

Where days off count:

- **Reschedule…**, spreading over the next working days, skips everyone's days off and the leave of
  the person whose tasks they are.
- **Workload** gives a day off no capacity (see above).
- **The Calendar** stripes everyone's days off and names them on the day, in every mode. A person's
  leave shows as a quiet note ("Sam off") on the days they are away, when they have tasks in the
  project.
- **The Timeline** shades everyone's days off at Week zoom, as it shades weekends, with an outline.
- A task's **due date** or **start date** on a day off says so under the date, such as "Christmas
  Day: a day off", for everyone's days off and the assignee's leave. It never stops you choosing it.
- Your [countdowns](#countdowns) and the run of days on [Your progress](#your-progress) count
  your own days off and everyone's, never other people's leave.

Weekends stay as each person's working days say.

## Calendars

Planning is easier when you can see your meetings. Ostler doesn't connect to Outlook or Google, but
every calendar app can save an `.ics` file: in Outlook, **File › Save Calendar**; in Google
Calendar, **Settings › Import & export › Export**; in Apple Calendar, **File › Export**.

In **Settings › General › Calendars**, choose **Add a calendar file…** and pick the file. Ostler
says how many events it read, how many it skipped (such as cancelled ones) and how many repeating
events it shows only once because their rule is one Ostler doesn't follow. Give the calendar a name
and a colour, then **Add calendar**.

- Its events show in the Calendar's Month, Week and Agenda, on Home beside Today, and in Print my
  week. Times follow your computer's time zone, so a meeting set in another zone shows at your
  time.
- **Reload** reads the same file again and replaces that calendar's events, after you save a newer
  copy over it. **Hide** keeps the calendar but stops showing it. **Rename** changes its name.
  **Remove** takes it away, with undo.
- Ostler reads the file only when you add it or press **Reload**, keeps it where it is, and never
  copies or changes it. Events are never searched, exported or put in a project file.

### A calendar link that stays up to date

A file goes stale the day after you save it. Outlook, Google and Apple can also give a calendar a
private address that is always current, and Ostler can subscribe to it:

- **Outlook** (Outlook.com or Microsoft 365 on the web): **Settings › Calendar › Shared calendars ›
  Publish a calendar**, choose the calendar and **Can view all details**, then copy the **ICS**
  link.
- **Google Calendar**: the calendar's **Settings and sharing › Integrate calendar › Secret address
  in iCal format**.
- **Apple** (iCloud Calendar): **Share Calendar** next to the calendar, turn on **Public
  Calendar** and copy the address (it starts `webcal://`).

In **Settings › General › Calendars**, choose **Subscribe to a calendar link…**, paste the address,
give the calendar a name and a colour, then **Subscribe**. Ostler fetches it once there and then and
says how many events it read; if it can't, it says why and saves nothing.

- **Anyone with the address can read the calendar**, so treat it like a password. Ostler stores it
  encrypted with Windows' protection for your account (if Windows can't encrypt on this PC, a link
  can't be saved) and never shows it again in full: Settings shows its host and the end of it, such
  as "outlook.office365.com/…/calendar.ics".
- Ostler fetches the address a minute after it starts, every hour while it runs, and when you press
  **Refresh**, one link after another, and asks only for what changed. Nothing else is fetched,
  and nothing is fetched until you add a link. See [Privacy](18-privacy.md).
- A hidden link calendar is paused: Ostler doesn't fetch it every hour, and the note about a link
  that hasn't updated leaves it out. **Show** fetches it straight away, then hourly again.
- Each link says when it last updated. When a try fails, it says why, such as "Could not reach it"
  or "The address was refused: check it is still shared", and keeps the events it had.
- **Replace link** pastes a new address for the same calendar, for example after you reset the
  secret address in Google. The new one is kept only if it works.
- A backup restored on another PC can't open the saved link (it was encrypted for your account on
  this one): the calendar says **Paste the link again**, and **Replace link** fixes it.
- A link calendar shows like a file calendar everywhere. **Hide**, **Rename** and **Remove** (with
  undo) work the same.

### A calendar from a connected account

If you connected a Google, Microsoft 365, Outlook.com or iCloud account in **Settings ›
Connections › Accounts**, Ostler can read its calendars directly, with no address to copy. In
**Settings › General › Calendars**, choose **Add from an account…**, pick the account if you have
more than one, and **Add** the calendars you want. The button shows only once an account that can
read calendars is connected.

- Ostler reads events from 60 days ago to a year ahead, on the same schedule as a calendar link:
  a minute after it starts, every hour while it runs, and when you press **Refresh**.
- Each calendar shows the account it comes from, such as "Google · ann@example.com". When the
  account needs you to sign in again, the calendar says so and keeps the events it had; **Sign in
  again…** in Settings › Connections fixes it.
- Calendars from an account are read only, like every other calendar in Ostler.

### Time blocks in your calendar

With an account connected that can write calendars (Google, Microsoft 365, Outlook.com or a CalDAV
server such as iCloud), **Settings › General › Calendars** has **Time blocks in your calendar**.
**Choose a calendar…** copies your time blocks into it as busy events, so colleagues who look at
your calendar see the time is taken.

- Blocks from a week ago to 90 days ahead are copied, a few seconds after you add, move, resize or
  remove one. Removing a block deletes its event.
- Each event holds the task's title and the project's name, nothing else. Ostler is the source:
  change the event there and it is put back as the block says the next time the block changes.
- The copies don't show twice in Ostler: reading that calendar back leaves them out.
- **Stop** deletes the events Ostler wrote; your blocks stay here. **Change…** moves them to
  another calendar.

### Join an online meeting

When an event's place or description has a Microsoft Teams, Zoom, Google Meet, Webex, GoTo or
Whereby link, its card has a **Join meeting** button that opens the link in your browser. Only
links on those services' own `https` addresses count; any other link stays plain text.

## Inbox

The Inbox lists things that happened and want your attention, newest first:

- reminders that fired
- blockers that were reported
- notices from your [rules](24-rules.md)' **Notify me**
- imports that finished, so you can undo one
- with [triage](03-tasks.md#triage) on, how many quick captures wait in a project, such as
  "4 to triage · Website", which opens its To triage view. It brings no desktop notification.
- a comment that [mentions you](03-tasks.md#mentions), from the last 30 days, until you read it
- a [sign-off](03-tasks.md#sign-offs) someone asked of you
- a new commit that says it [fixes an open task](03-tasks.md#commits), such as "Commit a1b2c3d says
  it fixes SHOP-12: Fix the login", with **Mark as done** (Undo in its message puts the status
  back) and **Dismiss**. It leaves once the task is done.
- with the [weekly review reminder](#weekly-review-reminder) on, that it is time for your weekly
  review
- with a project's [status update reminder](#status-update-reminder) on, that it is time for that
  project's status update
- with agents on, agent questions, [plans waiting for your approval](14-agents.md#plan-first)
  (opening one shows its plan), work waiting for review, and a project's agents reaching their
  token limit
- a repeating task that [goes to agents when it comes round](03-tasks.md#go-to-agents-when-it-comes-round),
  each time its schedule queues an occurrence, such as "Queued for agents: Update the
  dependencies", with how it repeats, or why it could not ("Not queued: agents are off"). Opening
  it opens the task. A note that was not queued offers **Queue it now** while the task is not
  done; if the reason still holds, Ostler says so. It brings no desktop notification, and leaves
  after a month or when archived.

Reminders and blockers of a task that is archived or in the recycle bin leave the Inbox. Blockers
of an On hold or Done project leave it too; its reminders still arrive.

Open an item to go straight to its task. Mark items read or unread, archive the ones you've dealt
with, or snooze a reminder for an hour or until tomorrow. The number next to Inbox in the sidebar
counts unread items.

### Status update reminder

In **Project settings** › **General** › **Status update reminder**, choose **Every week** or **Every two weeks**
and a **Reminder day**. On that day, unless you have posted a [status update](12-reports.md#status-updates)
since the day began, the Inbox shows "Time for a status update · Website". Opening it takes you to
the project's Overview with **Post an update** open. It stays until you post one, and a desktop
notification follows your reminders' setting in [Notifications](#notifications). Two weeks count
from the first reminder day after you set it. On hold and Done projects get no reminder.

### Reminders that keep reminding

When you add a reminder to a task (**Remind me…** in its drawer), turn on **Keep reminding me** and
choose how often: every 5, 15, 30 or 60 minutes (Settings › Notifications › **Keep reminding
every** sets the choice it starts on, 15 minutes unless you change it). The reminder's row then
says it keeps reminding. Reminders from a due date do not keep reminding.

After it goes off, its notification comes back at that interval until one of these happens:

- you finish the task, or archive or delete it;
- you snooze it: it goes off again at the snooze time, and keeps reminding from there;
- you press **Stop reminding**;
- midnight comes on the day it went off. Its Inbox item then says **Missed**.

Quiet hours hold the repeats, and the first one comes when they end. If notifications, or reminder
notifications, are off in Settings › Notifications, nothing pops up, but the Inbox item is still
there. Repeats are not new Inbox items: the reminder stays one item. A reminder missed while Ostler
was closed goes off once when it starts, then keeps reminding. With Ostler running in the
background, it keeps reminding with the window closed.

Windows notifications from Ostler have no buttons. Click one to open the task: while its reminder
keeps reminding, the drawer shows a bar at the top, "Reminder: 10:00, keeps reminding", with
**Snooze** (for an hour, or tomorrow at the reminder's time), **Done** and **Stop reminding**. The
reminder's Inbox item has the same three.

## Notifications

Ostler has two kinds of notification:

- **In-app notifications** pop up in the bottom-right corner of Ostler's window when something
  happens as you work, such as "Moved to the recycle bin" with **Undo**. Up to three show at once,
  newest at the bottom; pointing at one keeps it there. Each stays for 10 seconds unless you choose
  otherwise under Settings › Notifications › In-app notifications, which can also keep them until
  you close them.
- **Windows notifications** are shown by Windows, for reminders and agent alerts, even while Ostler
  is minimised. They live in the Windows notification centre (Windows key + N).

Every in-app notification is kept under the bell at the right end of the status bar until Ostler
closes. The bell shows how many went away before you saw them. Click it to read them again, use an
**Undo** or other button you missed (each works once), remove one, or **Clear all**.
**Notification settings** at the bottom of the list opens Settings › Notifications.

Settings › Notifications chooses which Inbox items also appear as Windows notifications, when due
reminders fire, and quiet hours when no notifications pop up. Items still arrive in the Inbox
during quiet hours.

A [focus](20-time-tracking.md#focus) holds notifications the same way while it counts down:
nothing pops up, but Inbox items still arrive and reminders still reach the Inbox on time. When the
focus ends, notifications show again.

Click a notification to open what it is about: the task it concerns, if it has one, or else its
project. The weekly review reminder opens the weekly review. A question, a review or a token-limit notice with no task opens the Inbox, and so does
the one notification that sums up several reminders missed while Ostler was closed. Ostler's taskbar button shows how many Inbox items are unread (up to
9, then 9+), and flashes when an agent asks a question while you are in another window. Imports
and AI task splits show their progress on it too.

## Keep Ostler running in the background

Reminders fire only while Ostler is running. To keep them coming with the window closed, turn on
Settings › General › **Keep Ostler running in the background**. Closing the window then hides Ostler
in the notification area, next to the clock, and everything keeps going: reminders fire and
agents keep working. Its icon there has a menu with **Open Ostler**, **Quick add**, **Inbox**,
**Pause reminders for 1 hour**, **Stop all AI** (when AI or agents are on) and **Quit Ostler**,
with your [countdowns](#countdowns) at the top.
With the setting off, closing the window quits Ostler.

In the same group:

- **Start Ostler when I sign in** starts Ostler with Windows. With background mode on, it starts in
  the notification area without opening its window.
- **Quick add from anywhere** gives Quick add a key that works in every app, `Ctrl` + `Alt` + `N`
  unless you choose another. Select the key box and press the keys you want. If another app
  already uses them, Ostler tells you and you can pick different ones.
