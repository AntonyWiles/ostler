# Undo history

Ostler keeps a record of every change you make, step by step: what you added, changed and deleted,
in which project, and when. You can look back over the last five minutes or the last month, and
undo any one step on its own. Changes you made after that step stay as they are.

## Undo and Redo

**Undo** and **Redo** sit at the top left of the window, beside the menu button (at the left of the
status bar if you use the standard Windows title bar). Point at either to see the step it would act
on, such as "Undo: Changed task “Paint the hall”".

- **Ctrl+Z** undoes your newest change, and **Ctrl+Y** (or **Ctrl+Shift+Z**) redoes the newest
  step you undid. In a text box, they undo and redo your typing instead.
- While a notice with its own **Undo** is showing, or a task's drawer is open, **Ctrl+Z** undoes
  that first, as before.
- The hamburger menu's **Edit** section has **Undo**, **Redo** and **Undo history…** too.
- After each undo, a notice says what was undone, with **Redo** to put it straight back.

## The Undo history page

Open it with the clock button beside Undo and Redo, **Edit › Undo history…** in the menu,
**G then U**, or the command palette (**Ctrl+K**, then type "undo history").

- Steps are listed newest first, by day. Each says what it did, such as "Deleted milestone
  “Launch”" or "Changed task “Order tiles”", with the project and what changed: "Title and due
  date", "Comments".
- **Details** (the arrow) shows each value before and after the step.
- **Undo** on a step puts back only the values that still hold what that step left. If you changed
  the same value again later, your later change is kept, and the notice says how many were kept.
  Undoing a deletion brings the thing back with its parts: a task comes back with its comments,
  checklist and links.
- An undone step is crossed out and shows **Redo**. Undoing is a step of its own ("Undid: …"), so
  it is in the list too.
- Search the history by name, show the last 5 minutes, hour, today or 7 days, or one project.
- **Forget this step** (the bin) takes a step off the list. What it changed stays as it is; you just
  can't undo it from here any more.

## How long it is kept

At the foot of the page, **Keep history for** sets how many days steps are kept: 30 by default.
Older steps are forgotten automatically, about once an hour. **Clear steps older than a week** and
**Clear all history** forget steps straight away. Forgetting never changes your projects.

## What it covers

The undo history covers what you change in Ostler's own windows: tasks and their parts (comments,
checklists, custom fields, dependencies, links, contacts, time, reminders, My day), milestones,
goals, decisions, iterations, labels, columns, task types, templates, rules, saved views, people,
contacts, costs, budgets, shopping lists, status updates, pins, days off and goals of your own.

It does not cover settings, project details such as a project's name and folder, Library files, or
what agents and the automation API do. A project folder's files have their own
[History](14-agents.md#history), and backups keep a copy of everything
([Backups and restore](15-backups-and-restore.md)).
