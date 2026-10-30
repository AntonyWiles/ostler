# Iterations

An iteration is a fixed period of work, such as a two-week sprint or a cycle. Iterations are
optional: a project that never makes one looks exactly as it did before.

Each iteration has a name, a start and an end date (the end day is included), an optional goal
sentence and a status: **Planned**, **Active** or **Finished**. A project's iterations can't
overlap, only one can be active at a time, and a task is in at most one iteration.

## Plan iterations

1. Open the project's **Milestones** tab and press **New iteration** in its header.
2. Ostler suggests a name and two weeks starting today, or the day after the last iteration ends if
   that is later. Change them as you like, add a
   goal if it helps, and press **Create iteration**.

Once the project has an iteration, the tab shows an **Iterations** section listing each one in date
order with its dates, goal and progress. Use a row's **⋯** menu to **Edit** its name, dates or goal,
or to **Delete** it. Deleting leaves its tasks as they were, just in no iteration, and **Undo** in
the notice puts the iteration and its tasks back.

## Put tasks in an iteration

Once a project has iterations, an **Iteration** field appears:

- in the task drawer,
- in **New task**,
- as a column in the plan grid.

Only unfinished iterations are offered. A task in a finished iteration keeps it.

## Start and finish

Press **Start** on a planned iteration to make it the active one. While it runs, press **Finish
iteration** on its row. The dialog lists what was done and what wasn't, with the estimate of each,
and asks where the tasks that aren't done should go:

- **Move them to** the next planned iteration, or
- **Take them out of any iteration**.

Done tasks stay in the finished iteration, and the iteration keeps its summary: how many tasks and
how much estimate were done and carried over. Each task that moves records it in its activity.

## See the work in an iteration

- **Filters**: every view's filter bar has an **Iteration** filter, with a quick **Current
  iteration** choice. The current iteration is the active one or, with none active, the planned one
  whose dates include today, the end day too.
- **Board**: group the board by **Iteration** to see a swimlane for each one, plus a lane for tasks
  in none.
- **Overview**: the current iteration's **Burn-down** chart shows the work remaining at the end of
  each day against an ideal line to nothing on the last day. Work added part-way, or reopened, raises
  the line. It counts in estimates or tasks with the same switch as the other charts, and **Show as
  table** lists the numbers.

## Import, export and templates

CSV export has an **Iteration** column, and CSV import maps an **Iteration** column to the
project's iterations by name; a name the project doesn't have is left out with a warning. The
project file carries iterations and which tasks are in them. A template keeps the iterations that
weren't finished, as planned, with dates relative to the day it is used.
