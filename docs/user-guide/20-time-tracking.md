# Time tracking

Ostler can say how long a task took: run a timer while you work, or add time by hand, then see it
against the estimate and week by week in the Timesheet. Everything stays on your computer.

## The timer

Start a timer on a task from:

- the task's **Time** section in the drawer (**Start timer**),
- its card's menu (right-click the card, or its **…** button),
- the command palette (Ctrl+K): **Start timer on…**, then type the task's name.

One timer runs at a time across every project. Starting another stops the first, and the message
that says so has **Undo**, which puts things back as they were.

While a timer runs, the status bar shows the task and the time. Click it to open the task, use the
square button to stop the timer, or the calendar button to open the Timesheet. With background mode
on (Settings › General), the notification-area icon's menu has **Stop timer**, and so does the
taskbar's jump list in an installed Ostler.

The time is worked out from when the timer started, so it carries on while Ostler is closed. When
Ostler starts and finds a timer that was running when it closed, it asks whether to **keep it
running** or **stop it at the time Ostler closed**.

## Focus

**Focus** puts a countdown on a task's timer, for when you work best in fixed stretches. Start it
from:

- the task's **Time** section in the drawer (**Focus…**),
- its card's menu (**Focus…**),
- the command palette (Ctrl+K): **Focus on…**, then type the task's name,
- a time block's card in the Calendar's Week (**Focus…**).

Pick a length: 25 or 50 minutes, or **Another length** from 5 to 180 minutes. The length you used
last is chosen for you next time. Focus starts the task's timer, so a timer already running stops,
with **Undo** in the message as usual. One focus runs at a time.

While it runs:

- desktop notifications wait, as in quiet hours; Inbox items still arrive, and reminders still
  reach the Inbox on time,
- the status bar shows the task and the time left (click it to open the task, the square button
  to **Stop focus**, which stops the timer too),
- with background mode on, the notification-area icon says "Focus: 12 min left on …" and its menu
  has **Stop focus**.

Stopping the timer anywhere ends the focus too. The time left is worked out from when the focus
ends, so a laptop that slept wakes to the right time, or to the end.

At the end, Ostler plays a soft chime (it follows Windows' volume and mute), shows a notification
"Focus finished: …" if notifications are on, and asks:

- **Take a 5-minute break**: the timer stops at the moment focus ended and the break counts down
  in the status bar, with its own chime at the end,
- **Keep going**: the timer runs on, with no countdown,
- **Stop**: the timer stops at the moment focus ended.

If you choose nothing (or close the question), the timer keeps running as an ordinary timer.
Closing Ostler ends a focus; the timer then follows the question at the next start, as above. The
time is logged as an ordinary time entry; there are no cycles, scores or streaks.

Settings › Notifications › **Focus** sets the two lengths offered, the break's length and the
chime.

## Adding and changing time by hand

In the drawer's **Time** section, **Add time** asks for the day, when it started, how long, a note
and the person. Type the length as `1h 30m`, `1.5h` or `90m`; use your region's decimal separator
(`1,5h` where a comma is the separator). An entry can be up to a week long.

Each entry in the list has **Edit** and **Delete**. A delete can be undone from its message, or with
Ctrl+Z while the message shows.

## Time against the estimate

In a project that estimates in hours (Project settings), the drawer and the card show the time
logged against the estimate, such as "3.5 h of 5 h", in the warning colour once it is over. In a
project that estimates in points, they show the time logged.

## The Timesheet

The Timesheet shows one week at a time, every project's entries by day, with each day's total and
totals by project and by task. Open it from the command palette (**Timesheet**), the status bar's
timer, or a task's Time section.

- **Previous**, **This week** and **Next** move between weeks.
- Choose a project and a person to see only theirs.
- Click an entry to change it, in the same editor as the drawer's.
- **Export CSV** saves the entries of any range of days, with the project and person chosen, as a
  file for a spreadsheet: date, project, task, person, duration and note. Durations are in hours as
  plain numbers (`1.5`), so the column adds up.

- Choose **Billable only** or **Not billable** to see only that time. Billable entries say
  **Billable**, or **Billed** once they are billed.

An entry belongs to the day it started on, in your time zone.

## Billable time

When you charge for your time, Ostler can say which hours are billable, what they come to, and which
you have already billed. There are no invoices: Ostler gives you the numbers to put in your own.

**The rate.** In Project settings, beside the budget, set an **Hourly rate** in the project's
currency (the budget's), and tick **New time is billable** if most of this project's time is
charged for. The tick decides how new time starts, from the timer or by hand; it never changes time
already logged.

**Billable entries.** Each entry has a **Billable** tick: in the drawer's Time section, and in the
editor when you add or change time.

**The Time report.** In the project's **More** menu, **Time report** shows any dates (this month to
begin with): the hours, the billable hours and the amount, then a table by task, with each task's
entries under it when you ask. Unbilled and billed time are shown apart. The amount is the billable
hours times the rate, rounded to the penny (or cent) once at the end of each total, not entry by
entry. A timer that is still running is shown as running, and counts once it stops.

- **Export CSV** saves the report's entries for a spreadsheet: date, task, person, note, hours,
  billable, amount and the day it was billed.
- **Print** prints the report, and **Save as PDF** saves it on A4 (Letter in the US), every task
  with its entries.

**Mark as billed.** When you have charged for a range, **Mark as billed** asks first, then records a
billing for those dates: the range's unbilled billable time joins it, and its hours and amount are
kept as they were. Billed time is locked: changing or deleting it is refused until the billing is
unmarked. The billings are listed under the report; **Unmark** releases a billing's time, and its
message has **Undo**. Changing the rate later changes unbilled amounts only.

## Elsewhere

- The Overview's key numbers show the time logged in the chosen period, once the project has any
  time entries.
- **Export all tasks** (CSV) adds a **Time logged** column once the project has entries.
- Exporting a project to a file carries its time entries, which are billable, its rate and its
  billings; a template carries the rate and **New time is billable** only.
- The automation API lists, adds, changes and deletes entries, starts and stops the timer, and
  reads the Time report and marks and unmarks billings (`docs/automation-api/time-tracking.md`).

Not in Ostler: invoices, tax, rates per person or task, approvals, idle detection and Pomodoro
timers.
