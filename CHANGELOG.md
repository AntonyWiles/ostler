# Changelog

Every notable change to Ostler, newest first. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/). The app shows the section for the version you run under
Help › What's new, and the Unreleased section until a version has its own.

## [Unreleased]

### Added

- **Inbox on Android.** The phone has an Inbox tab with an unread count: reminders that fired,
  mentions of you, sign-offs asked of you, tasks to triage and reported blockers. Open an item, mark
  it read or unread, or archive it with Undo. Read and archived items match on your PC.
- **Search on Android.** Search your tasks, comments, decisions, milestones and goals from the
  phone's top bar, with the matching words marked.
- **More task editing on Android.** Edit a task's description, priority, start date, estimate,
  milestone and labels from the phone, and add, rename, reorder or remove checklist items. A task
  lists its subtasks and links to its parent, and you can add a subtask from it. You can also see
  and change which tasks a task waits on, and see which tasks wait on it. Comments can be pinned,
  edited and deleted (with Undo), as your role in the project allows.
- **Reminders, archive and recycle bin on Android.** A task shows its coming reminders, and you
  can add one from the phone (your PC shows it when it is due) or remove one. A project's archive
  and recycle bin are a tap away, and a task in the bin can be restored from the phone.
- **Filter a project's tasks on Android** by words in the title or by label. A task you add on the
  phone opens straight away, so you can set its date, person and other details. The changes show in the task's history on your PC, and an
  earlier description can be brought back there.
- **Project planning on Android.** A project on the phone opens views for To triage (accept, move
  to Someday or mark won't do), Someday, milestones with their progress, goals with check-ins,
  decisions, and sign-offs you can approve or send back. The Projects list shows what is in
  progress, overdue, waiting to be triaged or waiting for your sign-off in each project.
- **Links on your PC and phone.** Plain web addresses and `ostler://` item links in descriptions
  and comments turn into links. On the PC, web links open in your browser. On the phone, an item
  link shows the item's title and opens it, a task can be shared as a link, and "Add a link" puts a
  link to another task, milestone or decision into a description or comment.
- **Answer what waits on you, from the phone.** The phone can gather, across every project, the
  blockers waiting for your decision, tasks in review, tasks blocked on you and sign-offs asked of
  you, each with its latest comment, and answer them: pick one of a blocker's options, approve or
  send back a review, or reply to a blocked task and move it on. The answers write the same rows as
  on your PC.
- **A "Needs you" tab on Android**, with a count. Cards are grouped as Decide, Review, Blocked on
  you, On your PC and Waiting on other tasks, and show the project, the task, the latest comment
  and how long the ask has waited. Answer with one tap (a blocker's options, Approve, Send back,
  Reply and unblock, Reply only), with Undo for a few seconds. An ask that reads like it needs
  your PC (a key, a sign-in, a command) is marked so. The Projects list shows what in each project
  is blocked on you or waiting for review, and a task shows its open blockers with the same
  choices. The phone's new screens are now translated into every language the app speaks.
- **Weekly review on Android.** The phone's ⋮ menu opens the weekly review, step by step as on the
  PC: overdue (move to tomorrow or next week, Someday, won't do), blocked for a while, untouched for
  two weeks, Someday, the next two weeks and milestones at risk, each action with Undo. Finishing
  it records the review, so your PC knows it was done.
- **Status updates on Android.** A project's new Status view shows its updates (on track, at risk,
  off track, with a note) and lets you post one from the phone or delete your own.
- **Time tracking on Android.** Start and stop a timer on a task, or log time by hand for today,
  yesterday or the day before. The running timer stays in a bar on the home screen, and the ⋮
  menu opens your Timesheet, a week at a time with each project's total.
- **Shopping lists on Android.** A project's Shopping view is made for the shop: add an item in
  one line ("3 packs wall plugs £4.50"), tick it bought (a paid cost at its estimate), and bought
  items fold away. Every change has Undo.
- **Team and Contacts on Android.** The ⋮ menu opens the Team: a card per person across projects
  with open, overdue, due this week, blocked and stalled work, hours this week and time away,
  opening to their open tasks. Contacts lists your clients and suppliers: search them, add one,
  call, email or open their website with one tap, and see the tasks that name them.
- **Read the Library on Android.** A project's Library view lists its briefs, guides, notes, links,
  whiteboards, documents and pictures, the primary brief first, with a filter. An item opens to
  read, its text formatted as on the PC; a link opens in the browser, and a file shows what it is
  (the file itself stays on your PC). Links to a Library item in a task now open the item.
- **A project's schedule on Android.** The Schedule view lists what is overdue, then the next twelve
  weeks one at a time, with each week's milestones (and their progress) and the tasks due or
  starting in it.
- **More at a glance on Android.** The Projects list shows each project's latest health (on track,
  at risk, off track), and a task lists the contacts it names, with Call and Email buttons.
- **My Day on Android shows your day as Home does on the PC.** Today's planned list comes first,
  then Today (overdue, due today, in progress and new today, yours or nobody's) and the next seven
  days, day by day. Tap a task's circle to mark it done, with Undo.
- **A richer task list on Android.** Sort a project's tasks by Do first, board order, due date or
  priority, and fold status groups (Done starts folded). Rows show priority, a coloured due date,
  checklist progress, what the task waits on, comments, labels and who it is assigned to.
- **Quick capture on Android.** The + on the home screen takes one line into a project's To triage,
  to sort out later on the phone or your PC. The project you used last is picked again.
- **Add milestones and record decisions on Android.** A project's Milestones view has New
  milestone (a name, what it delivers and a target date), and its Decisions view has Record a
  decision (what it's about, what was decided, the context, alternatives and consequences).

### Fixed

- A blocker resolved or a task's status changed on another device (your phone, say) now wakes
  agent dispatch on your PC as soon as the change arrives, as the same change made on the PC does.
  Before, the agent waited until something else happened in the project.
- A blocker reported or resolved on another device now shows on your PC's Overview at once, and
  agents waiting on the automation API's event feed (`GET /events`) hear `blocker.reported` or
  `blocker.resolved` for it, as they do for one changed on the PC.
- Removing one of your devices no longer shows "Sync folder refused: exists" when nothing else has
  changed since the last time.
- Leaving a project that a PC never joined now takes it off your list, so your other devices stop
  trying to join it.
- A phone that failed to save one shared project no longer fails to join every project after it.
- A new device no longer fails to load your personal space when a reminder points at a task in a
  project it hasn't joined yet. The reminder waits and appears once that project is joined.

## [0.1.0] - 2026-10-30

### Added

- **Initial release.** Ostler is a free, local-first project manager for Windows, with an Android
  companion. Your projects stay on your PC, with no account, no server and no telemetry. The
  [README](README.md) lists what it does, and the [user guide](docs/user-guide/01-getting-started.md)
  explains how to use it.
