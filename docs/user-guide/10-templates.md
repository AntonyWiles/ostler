# Templates

A template is a ready-made plan: milestones and tasks with their order, labels and relative dates.
Starting from one saves typing the same plan twice.

## Built-in templates

Ostler comes with templates for a software project, a website launch, a marketing campaign, event
planning, a content calendar, a product launch, moving house and a study plan. Choose **From a
template** when you create a project. The picker shows what each one holds and its first tasks.

Some come ready for their kind of work: event planning has Cost and Supplier fields, the
marketing campaign a Spend field and moving house a Cost field, and templates for work that is not
software hide the Board columns they don't need (Ready, Blocked or In review). The software
project brings the task types Bug, Feature and Chore; the others bring none. Change any of this in
Project settings once the project is made.

A template you save from a project keeps its task types, and each task's type.

Dates in a template are relative ("two weeks after the start"), so they fit whenever you start.

## Save your own

Open a project's **More** menu and choose **Save as template…**. Choose what to include. People
are left out by default, because templates are often shared. Statuses go back to the start, ticks
are cleared, and dates become relative. A template holds at most 2,000 tasks and 1 MB of text, as
a project file does; Ostler refuses to save a bigger one.

A template keeps the project's custom fields and the values on its tasks (a Date field's value
becomes relative, like the other dates), so a project started from it has the same fields.

## Manage templates

Settings › Projects › Templates lists your saved templates. Rename them, delete them (with undo),
export one to a file to share it, or import a template file someone gave you.

## Task templates

A task template is a single task, with its subtasks, saved to make again ([Tasks](03-tasks.md)
says how to save and use one). Settings › Projects › Task templates lists them all, with where each
can be used (one project, or every project) and when it last changed. **Edit** renames one or moves
it to another project or to every project; **Delete** removes it at once, with undo.

A project's own task templates travel with it: in its project file, and in **Save as template…**
(the **Task templates** choice, on by default). Templates for every project stay on this PC.

### Playbooks

While agents are on, a **playbook** is a task template for agents: it also holds the model and
effort the built-in agent uses, whether the agent plans first, and extra instructions for the
agent. Choose **Save as playbook…** from a task's menu, or in Settings › Projects › Task templates
open **Edit** on any template and tick **Playbook**; untick it to make it an ordinary template
again (its agent part is kept). Playbooks are listed in their own **Playbooks** group, where
**Edit** changes their agent part. [Agents](14-agents.md#playbooks) says how to run one.

Playbooks travel wherever task templates do, agent part included: in the project file and in
**Save as template…**.
