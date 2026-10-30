# Reports

A project's **Overview** shows how the work is going, in panes chosen at its top, so each fits on a
screen:

- **Summary**: the status update, the key numbers, what needs you, what is in progress and up next,
  recent activity, and beside them milestones at a glance (once the project has milestones), the
  budget, the project brief and, with Ostler AI set up, its summary and the notes chat.
- **Insights**: the charts and the at-risk lists below.
- **Code**, with a folder linked or agents on: the folder's Git status and the agent task prompt.

The Overview opens on the pane you chose last.

## Status updates

Numbers show what moved; only you know whether the project is on track. A **status update** records
that judgement: **On track**, **At risk** or **Off track**, with a short note.

- **Post an update** at the top of the Overview (also in the project's **More** menu and the
  command palette). Pick the health (each choice has its words and an icon; the arrow keys move
  between them) and write a note in Markdown, up to 2,000 characters. Nothing is posted until you
  press **Post**.
- The Overview shows the latest update: its health, note, who posted it and when. **History** opens
  the diary of every earlier update, newest first. Edit or delete any update with the buttons
  beside it; a delete or an edit offers **Undo**.
- Home's project cards and the [board of projects](05-home-and-inbox.md#board-of-projects) show the
  latest health as a small chip, "No update yet" when there is none, and "Last update 5 weeks ago"
  when it is old: older than twice the reminder's interval, or than a month without a reminder.
- Each update appears in the project's **Recent activity**.
- With [Ostler AI](13-ostler-ai.md) set up, **Draft from activity** in the dialog sends the project's
  activity since the last update (or the last two weeks), worded as Recent activity words it, and
  its open milestones' progress, and fills in a suggested health and note for you to change. When
  there is little to go on it says so ("Only 2 changes since the last update") rather than invent
  progress.
- To be reminded, set **Project settings** › **General** › **Status update reminder** to every week or every two
  weeks, and pick the day ([Inbox](05-home-and-inbox.md#status-update-reminder)).

Health is your word. Ostler never works it out, and it is separate from the health badge on Home's
cards and from the charts below.

Updates travel in the project file, and the [shareable web page](11-import-and-export.md#a-web-page-to-share)
can include the latest one.

## Budget and costs

A wedding, a kitchen or a launch runs on money as much as on time. Give the project a **budget**
and record its **costs**, and Ostler shows how much is spent, how much is coming and what is left.

- **Set a budget** in **Project settings** › **Budget**, on the Overview's **Budget** card, or in
  the Costs view. Type the amount as you write numbers in your region ("1.234,50" in Germany,
  "1,234.50" in Britain), or leave it empty for no budget. Pick the **currency**: your region's to
  begin with. Every cost in the project is in it; Ostler never converts between currencies.
- **Costs**, in the project's **More** menu, lists every cost by date: its description, category,
  task or milestone, whether it is **Planned** or **Paid**, and its amount, with the totals of what
  is shown at the foot. Filter by category and by state.
- **Add cost** adds a row you fill in where it stands: the date, a description (up to 200
  characters), a category (type a new one, or pick one the project has used), a task and a
  milestone if it helps, planned or paid, and the amount. Press **Enter** to save it, **Esc** to
  cancel.
- In the table, **↑** and **↓** move between costs, **Enter** edits the one you are on in place,
  **P** marks it paid and **Delete** deletes it. **Mark as paid** asks for the day it was paid and
  the amount, which may differ from the plan. A delete, an edit and Mark as paid each offer
  **Undo**.
- **Export costs to CSV** writes the costs shown, for a spreadsheet: date, description, category,
  task, milestone, state, the amount as a plain number and the currency.
- The Overview's **Budget** card appears once the project has a budget or a cost: the budget, paid,
  planned and what is left, or "Over by £120" in the warning colour, a bar of paid and planned
  against the budget, and the largest categories.
- A task's drawer has a **Costs** section: its costs and their total, with **Add a cost**. A
  milestone's card shows the total of the costs linked to it.
- Deleting a task or milestone keeps its costs; they simply lose the link. A new round of a
  repeating milestone starts with no costs.

The budget and costs travel in the project file. A template keeps the budget and the planned costs,
dated from the day it is used; paid costs stay behind. Costs stay on your PC: they are not in the
[shareable web page](11-import-and-export.md#a-web-page-to-share) or in a coding agent's task.

### Shopping list

A **Shopping list** in the project's **More** menu holds what the project needs bought: the paint
and screws for the kitchen, the plates for the party. You can also add it as a tab, or open it in a
new window to keep beside you.

- **Add item** reads one line: type "3 packs wall plugs £4.50" and Ostler takes 3 as the quantity,
  packs as the unit, "wall plugs" as the name and £4.50 as the estimate for the whole line. Write
  the numbers as you do in your region ("2,5 m Kabel 12,50 €" in Germany) and the price with the
  project's currency. When Ostler is not sure, the whole line becomes the name and you fill in the
  rest with **Edit**.
- Items are grouped by **supplier**, one of your [contacts](25-contacts.md), with **No supplier**
  last. Each shows its tick box, quantity, name, estimate and task. **Edit** changes the name,
  quantity, unit, estimate, supplier and task in place; **Delete** offers **Undo**.
- Drag an item to put it in order, or use the keyboard: **↑** and **↓** move between items,
  **Alt+↑** and **Alt+↓** move the item, **Enter** edits it, **Space** ticks it and **Delete**
  deletes it.
- **Tick an item when you buy it.** Ostler asks for the price paid (the estimate filled in) and the
  day (today), then adds a **paid cost** with that amount and day, the item's name, the category
  "Shopping" and its task. The cost is the record of the purchase: the Budget card and the Costs
  view count it, and you can change its amount or category there later. Bought items fold away
  under **Bought**. Untick an item to remove its cost, with **Undo**; deleting the cost in the Costs
  view unticks the item, and so does switching it back to planned there. Ticking the item again
  then pays that same cost rather than adding another.
- The foot of the list, and the Overview's **Budget** card, show "Still to buy: £230 (estimated)":
  the estimates of what is not bought yet, kept apart from planned costs so nothing is counted
  twice.
- **Print** or **Save as PDF** from the view's **More** menu prints what is still to buy, grouped
  by supplier, with tick boxes, quantities and estimates, in black and white on A4.
- Deleting a task or a contact keeps the item; it simply loses the link.

The shopping list travels in the project file. A template keeps the items not bought yet, without
their suppliers or prices paid.

## Key numbers

Tasks done, in progress and overdue, and how much work is left, counted in tasks or in your
estimates. Once the project has time entries, **Time logged** shows the hours logged in the chosen
period ([Time tracking](20-time-tracking.md)).

### What counts

Archived finished tasks count as done. A task closed as **won't do** counts nowhere: the numbers,
charts, forecasts and workload leave it out, as if it had never been in the plan
([Tasks](03-tasks.md#archive-and-the-recycle-bin)).

## Charts

Choose the period at the top of the charts, and whether they count tasks or estimates.

- **Burn-up:** the total work (scope) and the work done, over time. When the lines meet, you're
  done. A rising scope line means work was added.
- **Cumulative flow:** how many tasks were in each status each day. A band that keeps growing shows
  where work piles up.
- **Throughput:** how many tasks were finished each week.
- **Cycle time:** how long finished tasks took from start to done.

Once a project has [task types](03-tasks.md#task-types), tick **Split by type** beside the range to
answer questions like "how many bugs did we fix?": throughput and cycle time draw a series for each
type, in the type's colour, plus **No type**. The legend names each type with its icon, and the
sentence under each chart says the same for every type. With more than six series, the types that
finished least share one, **Other**. The split adds up to the whole chart, and the automation API
returns the same numbers.

Each chart can be read as a table instead, and every chart can be used from the keyboard: focus it
and use the arrow keys to read each value.

## At risk

The Overview also lists what needs attention: overdue tasks, tasks blocked for more than three
days, dependency conflicts, and milestones likely to be late.

## Compare rounds

For a milestone that repeats in rounds, **Compare rounds** beside the range picker shows every
round of its series side by side: how long each took against its plan, and each task's cycle time
(or time tracked) round by round, counted the same way as these charts. See
[Compare rounds](06-milestones-and-goals.md#compare-rounds).

## Print or save

Use **More** › **Print…** or **Save as PDF…** on the Overview to share a report.

## Your year

With **Show my progress** on (Settings › General › **Progress**), **Your year** is a printable page
of a calendar year of finished work across your projects, from the status history Ostler already
keeps. Open it from **Your year…** on Home's progress card, where you choose this year or any past
year with finished work, or from the command palette (`Ctrl` + `K`, **Print Your year** or **Save
Your year as PDF**, for this year). It shows:

- Tasks and milestones finished each month, as a bar chart and a table.
- The busiest week, the week you finished the most tasks.
- Projects finished: projects with no open tasks left whose last task was finished that year.
- The projects you finished the most in.
- Time tracked each month and by project, your own and time on no one, when you
  [track time](20-time-tracking.md).

Tasks count as on Home's [progress card](05-home-and-inbox.md#your-progress). A milestone counts
in the month it was completed. Milestones that were already complete before this version count in
the month they last changed, and the page marks those months with an asterisk as approximate.

The page prints in black and white on A4 portrait (Letter in the US). It is about you, so it is
never part of a project file or any other export; the PDF you save is the only copy.
