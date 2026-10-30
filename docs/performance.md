# Performance

Ostler is meant to run all day on ordinary laptops, with 50 projects and thousands of tasks. This
page holds its performance budgets, how each is measured, and the latest numbers. Commands
are in the [developer guide](developer-guide.md#performance-the-scale-dataset-and-the-perf-suite).

## Budgets

| Measure                   | Budget                                                                |
| ------------------------- | --------------------------------------------------------------------- |
| Cold start to Home        | ≤ 2.5 s                                                               |
| Project or view switch    | ≤ 300 ms                                                              |
| Board, 500 cards          | ≤ 500 ms to render; no long task over 50 ms while dragging            |
| List, 5,000 rows          | No long task over 50 ms while scrolling                               |
| Whiteboard, 2,000 objects | ≤ 1,000 ms to open; no long task over 50 ms while dragging one object |
| Search                    | ≤ 150 ms                                                              |
| Idle, agents off          | Under 1% CPU on average; under 400 MB total memory after 10 minutes   |
| Idle IPC                  | At most 1 call per minute per open project                            |

`npm run perf` checks every one and fails when one is missed. The budgets live in
`tests/perf/budgets.ts`; change them there and here together.

## How each is measured

The suite (`tests/perf/perf.spec.ts`) launches the built app with Playwright against a fresh copy of
the scale dataset (`npm run seed:scale`) at 1280×800, and reads `performance.mark`s Ostler sets at its
key moments (`src/shared/perf-marks.ts`): in main, `ostler:main-start`, `ostler:services-created`,
`ostler:window-created` and `ostler:deferred-startup`; in the window, `ostler:home-rendered`,
`ostler:project-view-rendered` (a view with its project's tasks, after the paint),
`ostler:whiteboard-rendered` (a whiteboard's objects drawn on the Plan, after the paint), and
`ostler:search-started` and `ostler:search-results-shown`.

- **Cold start**: from the launch call to Home's mark, as timestamps, median of three launches. Each
  phase is recorded beside it.
- **Project and view switch**: a click inside the page to the view's mark. Projects: three 20-task
  projects, twice round. Views: Board, List, Calendar, Timeline and Overview of the 500-task project,
  twice round. The slowest switch is judged.
- **My work**: from Home, a click on My work in the sidebar to `ostler:my-work-rendered` (its
  tasks on screen), three times, for the person with the most open tasks on the dataset, grouped by
  due date. The slowest is judged against the view-switch budget, 300 ms.
- **Workload**: from My work, a click on its Workload link to `ostler:workload-rendered` (six
  weeks of every person's unfinished tasks on screen, every project), three times. The slowest is
  judged against the view-switch budget, 300 ms.
- **Timeline across projects**: from Home, a click on its Timeline link to
  `ostler:timeline-overview-rendered` (every enabled project's milestones and date span on screen,
  from one query; tasks are read only for a row that opens), three times. The slowest is judged
  against the view-switch budget, 300 ms.
- **Board, 500 cards**: from clicking the Board tab (the project's tasks already loaded) to its mark.
  Then a card is dragged from Ready across every column and back, one `dragover` per frame, while
  a `PerformanceObserver` collects long tasks.
- **List, 5,000 rows**: the List of the 5,000-task project, scrolled from top to bottom 600 px a
  frame, collecting long tasks.
- **Whiteboard, 2,000 objects**: a board of 2,000 notes in a grid is made through IPC
  (`createWhiteboard`, then `saveWhiteboard` in batches of 1,000, the upsert limit) in a 20-task
  project. From its **Open** button in the Plan's Whiteboards pane to `ostler:whiteboard-rendered`
  (the board's objects drawn, after the paint), three times; the first also loads the editor's
  code. The slowest is judged. Then one note on screen is dragged 400 px across and 200 px down
  with the mouse, one move per frame, and released, while a `PerformanceObserver` collects long
  tasks.
- **Search**: five queries in the command palette, from the request being sent (after typing
  settles) to the results' paint. The slowest is judged.
- **Idle**: a fresh launch with one project open on its Board, 30 s to settle, then
  `app.getAppMetrics()` every 15 s for 10 minutes. CPU is the average of the processes' summed
  `percentCPUUsage` (percent of one core). Memory is the processes' summed private memory at the end
  (see "Memory"); IPC calls are counted in main (`OSTLER_COUNT_IPC=1`) across the window.
- **Leak audit** (no budget): after one round of views, the 20-task project's views are switched 50
  times; the window's JavaScript heap (after garbage collection), DOM nodes and event listeners are
  read through the DevTools protocol before and after.

## Memory

The idle memory budget is judged on **private memory** (`privateBytes`), summed over every Ostler
process: what Task Manager's Memory column shows. Summing working sets instead counts the shared
Chromium and Electron code pages once per process; the GPU process, for example, has a 75 MB
working set of which 21 MB is its own. The working set is recorded beside it in `perf.json`.

## Latest numbers

Measured 2026-10-19 on the maintainer's machine: a Windows 11 virtual machine with 18 cores of an AMD
Ryzen 9 9900X and 16 GB of memory, with nothing else running. That machine is quicker than an
ordinary laptop; expect slower numbers there, with the same shape. Three runs of the full suite
each, given in order. "Before" is the build the work below started from, on a freshly
seeded dataset; "after" is the end of that work, on a dataset freshly seeded with what later work
added to tasks (task types with fields, dated checklist items, links of every kind, time blocks,
costs, an outside calendar and sidebar pins with countdowns; see the
[developer guide](developer-guide.md#performance-the-scale-dataset-and-the-perf-suite)).

| Measure                                     | Before              | After               | Budget     |
| ------------------------------------------- | ------------------- | ------------------- | ---------- |
| Cold start to Home (median of 3)            | 1,712; 1,570; 1,626 | 1,280; 1,246; 1,277 | ≤ 2,500 ms |
| Project switch (slowest of 6)               | 108; 131; 122       | 79; 104; 109        | ≤ 300 ms   |
| View switch, 500-task project (slowest)     | 310; 298; 304       | 122; 122; 129       | ≤ 300 ms   |
| My work, busiest person (slowest of 3)      | 73; 80; 87          | 43; 31; 29          | ≤ 300 ms   |
| Workload, every project (slowest of 3)      | 145; 142; 144       | 140; 133; 135       | ≤ 300 ms   |
| Timeline across projects (slowest of 3)     | 86; 85; 132         | 48; 41; 40          | ≤ 300 ms   |
| Board, 500 cards: render                    | 282; 260; 285       | 109; 102; 111       | ≤ 500 ms   |
| Board, 500 cards: longest task in a drag    | none over 50 ms     | none over 50 ms     | ≤ 50 ms    |
| List, 5,000 rows: longest task in a scroll  | none over 50 ms     | none over 50 ms     | ≤ 50 ms    |
| Search (slowest of 5)                       | 43; 42; 41          | 46; 44; 43          | ≤ 150 ms   |
| Idle CPU, 10 minutes                        | 0.01%; 0.01%; 0.01% | 0.01%; 0.01%; 0.01% | < 1%       |
| Idle memory, private                        | 364; 364; 369 MB    | 310; 311; 311 MB    | < 400 MB   |
| Idle IPC calls per minute, one open project | 0; 0; 0             | 0; 0; 0             | ≤ 1        |

The slowest view switch before was always the first visit to the Board (two of the three runs
missed its budget); after, it is the Board or the Timeline. The leak audit was unchanged: 50 view
switches grew the heap by 0.3 MB, with no DOM node or event listener left behind.

What changed, in order:

- **Board columns over 100 cards were not virtualised.** A column found its scroller by looking
  for the nearest ancestor with `overflow-y: auto`, and the Board's columns, which scroll sideways
  (`overflow-x: auto`), have that too. They grow with their cards and never scroll down, so every
  card counted as on screen: the Board drew all 500 cards and measured each. A column now passes
  over an ancestor that is no taller inside than out. The Board draws about 170 cards; the first
  visit to it went from about 300 ms to about 120 ms.
- **The command palette built its list while closed.** It re-renders on every route change, and
  built every project's views, settings and commands each time, tens of milliseconds on every
  project and view switch. It now builds them only while it is open.
- **Home drew every row of Today and Needs you.** On the dataset that was 647 tasks, 364 checklist
  items and 2,492 Needs you rows, 38,000 DOM nodes, which Home drew on each visit and took down when
  you left; whatever opened next from Home waited up to 450 ms. Each list now shows its first 20
  rows with "Show N more" (1,800 nodes in all). This was what moved cold start and idle memory.
- **Home's project cards read every project again on every visit**: five calls a project, the
  5,000-task project's tasks three times over, about a second of main's time that the next screen
  queued behind. A project's summary is now reused until main says it changed (or for five
  minutes), and a reload reads one project at a time and stops when Home closes.

The new data alone moved little: with the work above, the same suite on the earlier dataset gave
cold start 1,227 ms, idle memory 299 MB and the rest within a run's noise. Before the work, its
dated checklist items added 364 rows to Home's Today.

### The first performance work

Measured 2026-10-09 on the same machine, on the scale dataset (`p9-1-scale`). "Before" is the
build that added the measurement; "after" is the end of that performance work.

| Measure                                     | Before                            | After           | Budget     |
| ------------------------------------------- | --------------------------------- | --------------- | ---------- |
| Cold start to Home (median of 3)            | 2,234 ms                          | 1,187 ms        | ≤ 2,500 ms |
| Project switch (slowest of 6)               | 100 ms                            | 92 ms           | ≤ 300 ms   |
| View switch, 500-task project (slowest)     | 343 ms (first visit to Board)     | 265 ms (Board)  | ≤ 300 ms   |
| Board, 500 cards: render                    | 226 ms                            | 235 ms          | ≤ 500 ms   |
| Board, 500 cards: longest task in a drag    | 140 ms (13 long tasks)            | none over 50 ms | ≤ 50 ms    |
| List, 5,000 rows: longest task in a scroll  | none over 50 ms                   | none over 50 ms | ≤ 50 ms    |
| Search (slowest of 5)                       | 33 ms                             | 32 ms           | ≤ 150 ms   |
| Idle CPU, 10 minutes                        | 0.09%                             | 0.01%           | < 1%       |
| Idle memory, private                        | not recorded (535 MB working set) | 334 MB          | < 400 MB   |
| Idle IPC calls per minute, one open project | 11                                | 0               | ≤ 1        |

The cold start "before" is measured the same way as "after" (launch to Home's mark); the first
run of the suite measured to the driver noticing the mark, which added about a second.

What changed, in order: heavy screens load on first use (the window's main chunk went from 2,066 kB
to 1,381 kB); backups, housekeeping and the Git history sync wait for the first screen; the Board's
minute poll runs only while agents are on; Board cards are memoised and columns above 100 cards are
virtualised; Home asks for task metrics once per project instead of once per task (6,460 calls at
start-up) and project metrics read their history in one query; migration 9 adds two indexes; the
project views' code is warmed after the first screen; a card's menus are built when they open.

### My work

Measured 2026-10-14 on the same machine, on `p9-1-scale`, with an unrelated process keeping the CPU
busy: opening My work for the busiest person (390 open tasks across projects) took 135 ms, then
76 ms and 63 ms (budget 300 ms). Before its code was warmed after the first screen, the first open
took 370 ms. The full suite's other numbers that run: cold start 1,569 ms, project switch 120 ms,
view switch 263 ms (Board), Board render 191 ms, no long task over 50 ms in the drag or the List
scroll, search 15 ms, idle CPU 0.01%, idle memory 359 MB, idle IPC 0 calls a minute.

### Workload

Measured 2026-10-14 on the same machine and dataset: opening Workload from My work over every
project (six weeks, 98 cells) took 125, 130 and 127 ms (budget 300 ms), from one query. The full
suite: cold start 1,503 ms, project switch 115 ms, view switch 234 ms (Board), My work 73 ms, Board
render 193 ms, no long task in the drag or the List scroll, search 31 ms, idle CPU 0.01%, idle
memory 365 MB, idle IPC 0 calls a minute.

### Timeline across projects

Measured 2026-10-17 on the same machine and dataset: opening the Timeline across projects from Home
over every project (50 rows) took 75, 81 and 67 ms (budget 300 ms), from one query. The full suite:
cold start 1,846 ms, project switch 120 ms, view switch 298 ms (Board), My work 89 ms, Workload
164 ms, Board render 328 ms, no long task in the drag or the List scroll, search 30 ms, idle CPU
0.02%, idle memory 350 MB, idle IPC 0 calls a minute.

### Task IDs

Measured 2026-10-17 on the same machine, on a freshly seeded dataset: migration 42 numbers 10,000
tasks of one project in one `ROW_NUMBER()` update, about 0.4 s for the whole migration run with its
backup (`tests/unit/task-numbers.test.ts` holds it under a second, inside the cold start budget).
Every work item read works out its ID from the project's prefix with no extra query. The full suite:
cold start 1,529 ms, project switch 115 ms, view switch 246 ms (Board), My work 86 ms, Workload
132 ms, Timeline across projects 87 ms, Board render 230 ms, no long task in the drag or the List
scroll, search 40 ms, idle CPU 0.01%, idle memory 357 MB, idle IPC 0 calls a minute.

### Whiteboards

Measured 2026-10-26 on the same machine and dataset, with a board of 2,000 notes in Scale project
05: opening it from the Plan took 481, 170 and 186 ms (budget 1,000 ms; the first loads the
editor's code). Dragging one note had four long tasks, of 73, 85, 73 and **130 ms**: over the 50 ms
budget, which `npm run perf` reports as missed. Each pointer move draws the whole board again: every
object's spoken name is worked out anew (about a third of the time) and every note's text wrapped
again, and React compares all 2,000 objects. Drawing only what changed, and keeping each object's
name until it changes, is the follow-up. The full suite that run: cold start 1,653 ms, project
switch 130 ms, view switch 110 ms (Board), My work 33 ms, Workload 138 ms, Timeline across projects
50 ms, Board render 92 ms, no long task in the Board drag or the List scroll, search 46 ms, idle CPU
0.02%, idle memory 399 MB, idle IPC 0 calls a minute.

### Queries

`OSTLER_PROFILE_SQL=1` over a session on the dataset (Home, every view of the 5,000-task project,
search, the Inbox) put no statement above 26 ms. `EXPLAIN QUERY PLAN` on My work, activity,
reports (the project's status history), search and the task lists found two gaps, fixed in
migration 9: task lists sorted by update time in a temporary B-tree (9.9 ms to 6.3 ms on 5,000
tasks), and checklist ticks were read by scanning every project's. The rest use their indexes.
Search stays on the main process; at 32 ms it needs no worker.

### Leak audit

50 view switches (Board, List, Calendar, Timeline, Overview of a 20-task project) after one warm-up
round: JavaScript heap 11.5 MB to 11.8 MB after garbage collection, DOM nodes 2,191 to 2,191, event
listeners 507 to 507. Every `onProjectStateChange` and other push subscription in the renderer
returns its unsubscribe from its effect. No leak found.

### Polls

With agents off nothing in the window polls. In main, the Git poll runs only for enabled projects
with a folder and Git monitoring on, harness monitoring only with agents on, the backup check every
six hours and the reminder check hourly (cheap timers, no IPC). The agent views' polls run only with
agents on.
