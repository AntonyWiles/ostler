# Workstreams

A workstream is a named part of one project: a team, a stream of work, a phase with its own people.
Use one when a project has grown big enough that you want to look at one part of it at a time. A
workstream is not a separate project. It shares everything with its project: the same
[sharing](28-sharing-a-project.md), the same people, tags and fields, the same
[Library](07-library.md). It only decides which tasks and milestones you see.

A project with no workstreams looks exactly as it did, and shows nothing about them.

## Making one

- Right-click the project in the sidebar and choose **New workstream**.
- Or open the project's **Overview** and press **New workstream** in its **Workstreams** section.

Give it a **Name**, and if you like a **Description**, a **Lead** and **Members** (see
[Lead, members and status](#lead-members-and-status)), then press **Create**. Ostler opens the new
workstream.

## In the sidebar

A project that has workstreams gets a small arrow beside its name. Press it (or press `Right` on
the project, `Left` to close it) to show or hide **Workstreams of** that project, nested under it.
Ostler remembers which projects you left open.

Right-click a workstream for **Rename**, **Edit details**, **Mark on hold**, **Mark active**,
**Mark done**, **Archive** and **Delete**. In the narrow, collapsed sidebar, a project's right-click
menu lists its workstreams under **Open workstream**.

## Opening one

Choose a workstream in the sidebar, or its card on the Overview. The project's own views open with
only that workstream's work, and the header reads "Project › Workstream". The title bar names it
too: "Project › Workstream › View".

Press the workstream's name in the header to switch: the menu lists **All of** the project and each
workstream, **Edit** the open one, and **New workstream**. The **×** beside it goes back to the
whole project. In a project that has workstreams, the header shows **All workstreams** while you
look at the whole project, so you can open one from any view.

These views show only the workstream: **Overview**, **Plan**, **Board**, **List**, **Calendar**,
**Timeline**, **Milestones**, **Matrix**, **Triage**, **Someday** and **Archive**. Every other view
(the Library, decisions, reports, settings, sharing and so on) still shows the whole project, and
the header says so. The workstream stays open while you move between views, so going back to the
Board finds it as you left it. Counts such as "12 of 30 tasks" count the workstream's tasks only.

Anything you add while a workstream is open goes into that workstream: a task or a milestone, and
one added with Quick add (`Ctrl` + `Shift` + `N`) to that project. A subtask joins its parent's workstream.

## What the Overview shows

On the project's Overview, **Workstreams** sits under the counts, with a card for each live workstream with its status, its
open and done counts, a progress bar, its lead and members and its next milestone, and a card for
**Not in a workstream**, which opens the List filtered to the work that belongs to no workstream.
**Archived** workstreams fold away below, each with **Restore** and
**Delete**. On a workstream's own Overview the header shows its name, status, description, lead and
members, with **Edit**. Status updates are the whole project's, so they show only on the
project's own Overview, not on a workstream's.

## Moving tasks and milestones in and out

A task or milestone belongs to at most one workstream. Change it with:

- the **Workstream** field in the task's or milestone's drawer;
- **Move to workstream** in its right-click menu;
- the bulk bar, after selecting several;
- the **Workstream** column in the List.

Choose **None** (or **No workstream**) to take it out again. Only workstreams of the same project
are offered. When you are looking at the whole project, cards show a small chip with the
workstream's name.

## Group by and filter

Board and List can be grouped by **Workstream**. The filter bar has a **Workstream** field, in
[any view's filters](09-search-filters-and-saved-views.md#filter-a-view): pick a workstream, or
**No workstream** for work that belongs to none. Saved views can use it too.

## Across your projects

Wherever a task is shown outside its project, its name carries the workstream: "Project ›
Workstream" in Home's Today, Upcoming and My day, in the task drawer and in search results. The
command palette (`Ctrl` + `K`) also lists workstreams, to open one directly. The
[Timeline across projects](04-views.md#timeline-across-projects) folds a project's workstreams that
have dated work into rows under it.

## Lead, members and status

A workstream's **Lead** and **Members** are people from the project's contacts, and its status is
**Active**, **On hold** or **Done**. They describe who is doing the work and how it stands. They
grant nothing: who can see or edit the project is still decided per project, in
[Sharing](28-sharing-a-project.md#roles).

## Archive and delete

**Archive** hides a workstream from the sidebar and from the pickers. Its tasks and milestones stay
as they are, and you can **Restore** it from the Overview's archived list.

**Delete** asks first. Its tasks and milestones are not deleted: they move to the project, outside
any workstream.
