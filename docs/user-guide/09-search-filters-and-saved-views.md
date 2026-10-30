# Search, filters and saved views

## Search everything

Press `Ctrl` + `K` to open the command palette. Type to find:

- projects, views and settings, to go straight there
- tasks, comments, decisions and Library items, in every project, including the words inside
  Library files (PDFs, and Word, PowerPoint and Excel files)

Type a task's ID, such as `SHOP-12`, `shop-12` or `shop 12`, and that task comes first, so
`Enter` opens it. See [Task IDs](03-tasks.md#task-ids).

Choose **See all results** for the search page, where you can narrow results to one type or one
project. Archived and deleted items are left out. A Library file's result shows the passage that
matched and, for a PDF, deck or workbook, where it is: "page 7", "Slide 3" or "Sheet Budget". See
[Find things](07-library.md#find-things) in the Library.

Search finds words. To get an answer instead, when Ostler AI is set up, choose **Ask Ostler** beside
the search box, or **Ask Ostler: …** at the end of the palette's results. Ostler searches for you and
Ostler AI answers from what it finds, with links to each source. See
[Ask Ostler](13-ostler-ai.md#ask-ostler).

## Filter a view

To see one part of a big project, open a [workstream](31-workstreams.md); the **Workstream** filter
field and grouping work in any view of the whole project.

Every view (Board, List, Calendar and Timeline) has the same filter bar:

- a search box that narrows the tasks you see (press `/` to jump to it)
- **Hide done**
- **Add filter**, to build filters on any field: status, priority, assignee, labels, milestone,
  due date, start date, estimate and more. Choose whether tasks must match all of your filters or
  any of them. For your own tasks, add an **Assignee** filter and choose yourself.

Your project's custom fields are in **Add filter** under their own heading, with a search box when
there are many. Each offers what suits its type:

- **Text**: contains, or doesn't contain, some words.
- **Number**: equals, less than, more than, or between two numbers.
- **Date**: before or after a day.
- **Choice**: is, or is not, one of the options you pick.
- **Choices**: has any, all or none of the options you pick.
- **Checkbox**: ticked or not.
- Any field: **is empty** or **is set**.

The search page and the command palette also find the words in Text fields.

Two filters are about [Show from and Someday](03-tasks.md#show-from-and-someday):

- **Show from** is hidden (in Someday, or shown from a later day), shown, today, set or not set,
  or before or after a day.
- **Someday** is yes or no.

Two are an idea's [scores](03-tasks.md#ideas-and-scores): **Impact** and **Effort** are set or
empty, equal to, less than or more than a number.

### Describe it

When [Ostler AI](13-ostler-ai.md) is set up, the filter bar has **Describe it**. Type what you want
to see in words, such as "Sam's high-priority tasks due before the launch, not done", and press
**Make filter**. Ostler AI turns it into an ordinary filter: it replaces the bar's filter, condition
by condition, and you can check, change or remove each one as if you had built it yourself. The
toast's **Undo** brings back the filter you had. The box keeps your words, so you can say it another
way and try again.

Names are matched to the project's own: a person, label, milestone, goal, iteration, task type or
contact Ostler can't find is left out, and the box says so ("Could not find a label called 'urgent'"). If nothing in
your words makes a filter, the filter doesn't change and the box says that too.

Describe it sends only your words, today's date and the project's names: its statuses,
priorities, labels, milestones, goals, iterations, task types, people and your contacts' names, so "tasks
Rosa asked for" can filter by contact. No task is sent. It doesn't search
your tasks' text by meaning, sort or group a view; the filter it makes is saved with a saved view
like any other, and your words are not.

Hiding tasks on the Board and the List is the view's own choice (**Show them** or **Hide them**
beside the task count), not a filter, so a saved view still shows what it showed when you saved
it.

## Saved views

Once a view shows what you want, save it from the **Views** menu. A saved view keeps its filters,
sort and grouping, including filters, columns and groups by custom fields, and the fields a Board
shows on its cards. You can:

- keep it for this project, or for all projects, where every project's Views menu offers it
- open it again from the Views menu or the command palette
- update it after changing the filters, or revert the changes
- rename it or delete it (and undo the delete)
- make it the view that opens first for that tab (the search text is not kept there; the view that
  opens first never keeps a search)
- show its tasks in a Library note as a [live list](07-library.md#live-lists), which uses the
  view's filter and search
