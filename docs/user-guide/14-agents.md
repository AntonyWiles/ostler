# Agents

AI agents are AI coding assistants that work through tasks in a software project's folder for you.
They're off for new installs, and most people never need them.

## Set up agents

Agents need a project with a linked folder that is a Git repository. Turn them on in
Settings › Agents with **Use AI agents for software projects**. A guided setup:

1. explains what agents do and how Ostler keeps your work safe
2. checks what agents need, such as Git, and tells you how to fix anything missing
3. chooses the model the built-in agent uses (by default the same one as Ostler AI)
4. chooses how many agents run at once, and whether queued tasks start by themselves

Agents go on only when you finish the setup. Connected agents reach Ostler through the agent API on
this computer only; its port is in Settings › Agents › **Agent API**, beside the agents' own
switch, as the automation API's port is in Settings › Connections.

## Safety

- Each task's agent works on its own copy of your project. Nothing reaches your folder until you
  review the work and apply it, and anything you apply can be undone from **History**.
- Before Ostler changes your folder, it saves your own edits first, so nothing you wrote is lost.
- An agent can read its own task, the Library items attached to that task, and the project's
  conventions. It can't browse the rest of the Library.
- **Stop all AI** in the status bar stops every agent at once.
- While agents are off, Ostler hides every agent control and doesn't listen for agent connections.

## Run a task

1. Open a project's **Agents** tab.
2. Queue a Ready task for an agent, from the Board or the Agents tab.
3. Ostler gets the task's copy ready (**Getting ready** on the queue). Then the built-in agent picks
   it up, or **Start this task** connects an agent you run yourself.
4. Watch it work, and answer its questions when it asks.

### The agent prompt

A task's **AI Agent** section always shows its **Agent prompt**: the whole text an agent gets for
the task. **Show the full prompt** opens it; tokens show only their last four characters.
**Copy prompt** there, or **Copy agent prompt** in the task's **⋯** menu, copies the same text in any
column:

- **Queued and waiting:** the handoff for an agent you run yourself. Copying it starts the task's
  session, with its own token.
- **An agent is on it:** the prompt that run was given.
- **Not queued:** the task with the automation API's connection details, so an agent you run
  yourself can work on it and move it to Review. Nothing is queued. This needs the automation API's
  token, made under **Settings › Connections**.

## Playbooks

Some agent jobs come round again and again: update the dependencies, add a translation, write the
release checklist. A **playbook** holds the task, the model and effort, whether the agent plans
first, and extra instructions, so you write them once ([Templates](10-templates.md#playbooks) says
how to save one).

**Run playbook…**, in the command palette, the Agents tab and the project's More menu, asks which
playbook (this project's and every project's), lets you change the task's title, and **Run** makes
the task and queues it for agents in one step:

- the run uses the playbook's model and effort (the built-in agent only);
- the task gets the playbook's **Plan first** choice;
- the extra instructions are added to the queued task's details under "Playbook instructions".
  They are your words about this task: they never change the standing instructions, the
  conventions or what an agent may do.

The task is made like any other, so rules, repeats and activity see it, and its activity says it
was created from the playbook. The queue and the run say **From playbook** with its name. If the
provider no longer offers the playbook's model, the run uses the project's default and says so.
Run playbook needs agents on and a linked folder; otherwise it says why.

## Scheduled tasks

A repeating task can [go to agents when it comes round](03-tasks.md#go-to-agents-when-it-comes-round):
turn it on in the task's Repeat dialog. Each occurrence is queued on its start date (or its due
date when it has none) through the same queue as **Queue for agent**, and the queue, the run and
the task's agent section say **Scheduled**. The Inbox notes each one.

- Whether it starts by itself is the project's own **Run queued tasks automatically** setting; otherwise it waits
  in the queue for you or a connected agent, like any queued task.
- It counts like any run, and waits when a [token limit](#token-limits) is reached.
- Its work lands in [review](#review) as usual. Nothing is applied without you.
- A repeat has one open occurrence at a time (the next is made when you finish this one), so
  scheduled work never piles up.

If agents are off, the project has no linked folder, or the task is already queued or running when
its day comes, it is not queued; the Inbox says why once, and the task stays an ordinary task you
can queue. It is not queued later by itself, even once the reason has gone: its Inbox note offers
**Queue it now**, which queues it the same way. If the reason still holds, Ostler says so ("Not
queued: agents are off") and the note shows the reason as it stands.

## Plan first

An agent can send you a plan before it changes anything: the steps it will take, the files it
expects to change, and the risks it sees. The run then waits for you, with no time limit.

- **Per task:** the task drawer's **AI Agent** section has **Plan first**: **Project default**,
  **Yes** or **No**. Choose it before the task is queued; once it is queued, the choice is fixed
  for that run.
- **For the project:** Project settings › Agents › **Agents plan first** makes every task on
  **Project default** plan first. It is off until you turn it on.

A plan waiting for you shows in Home's **Needs you**, in the Inbox and in the project's Agents tab
(**Plans waiting for approval**), with a notification like a question's. Open it to see the
**Plan** dialog: the steps, files and risks as the agent wrote them, which version it is ("Version
2: changed after your note"), your earlier note, and a warning if the agent has already changed
files. Then choose:

- **Approve:** the agent carries on with the task as planned.
- **Ask for changes:** write a note (it is required); the agent revises the plan and sends the next
  version, still without changing anything.
- **Cancel run:** after a question, the agent stops as **Stop** stops it, and the task goes back to
  the queue.

While a plan waits, its run is still running: its copy stays in use and counts towards the copies
Ostler prepares ahead. Every version and decision is kept with the task: the drawer shows the
approved plan and the plan's history, and **Review changes** shows the approved plan beside the
change, with the files **Changed but not in the plan** and **In the plan but not changed**.

## Choose the model for a run

Small tasks (rename a file, fix a typo) don't need the biggest model, and hard ones deserve more
than a small one. The built-in agent can run each task on its own model and effort:

- **For one run.** On the Board, a task's menu has **Queue for agent with model…**; in the Agents
  tab, the queue's **Queue a one-off agent run** has **Model for this run**. While the task waits
  in the queue, change it with **Choose model for this run…** in its menu in the queue, or
  **Change…** in the task's **AI Agent** section. Once a run starts, its model is fixed.
- **For a project.** Project settings › Agents › **Built-in agent's model**: **Same as Settings**,
  or this project's own provider, model and effort.
- **Everywhere else.** Settings › Agents chooses the model for every project on **Same as
  Settings**.

A run uses its own choice, else the project's, else Settings'. The models offered are the ones
Settings offers for the provider in effect, and the effort levels are the ones that model's
provider takes, checked the same way Settings checks them. Tasks queued automatically use the
default.

Each queue card and run says which model it uses: "Model: claude-haiku-5-5 (this run)", "(project
default)" or "(Settings)" while it waits, and the model a built-in run used once it starts. An agent
you connect yourself runs on the model you set in that tool, so its card says **Model: set in the
connected agent**; a model chosen for a task applies only if the built-in agent runs it.

### Run again with another model

A run that failed or stopped partway, so its task went back to the queue while its changes wait for
review, offers **Run again with…**: give a reason, choose the model, and **Run again**. Its changes
stay in the task's copy, the reason is added to the task for the next agent, as **Send back** does,
and the task waits in the queue with the model you chose. **Send back** with **Back in the queue**
offers the same choice.

## Send guidance to a running agent

Changed your mind about a task while an agent works on it, or want to point it the right way? Use
**Send guidance…** on the run: in the Agents tab's **Working now**, in the task's **AI Agent**
section, or in the transcript you open with **Watch**. Write your message (Markdown works) and
**Send**.

- The agent sees it as a message from you, by your name in Settings › People ("Me").
- The built-in agent gets it in its session at once, without stopping what it is doing. An agent you
  run yourself gets it the next time it reads its session from Ostler.
- The dialog lists what you have sent to this run, each marked **Delivered** or **Waiting for the
  agent**. Messages are kept with the run, so one still waiting survives a restart of Ostler.
- Guidance is your word on the task the agent already holds: it can change how the agent does the
  task or what counts as done. It cannot give the agent a different task or widen what it may
  touch.
- A message can be up to 4,000 characters, and you can send up to five to one run in ten minutes.
  A run that has finished, or that **Stop all AI** ended, takes no more messages.

## What a run's state means

Every place that shows an agent run (the Agents tab and its queue, a task's **AI Agent** section,
Board cards, **Needs you** on Home, the Inbox and notifications) uses the same words:

- **Queued**: waiting for an agent. The queue says **Next to start** or **Queued #3**.
- **On hold**: kept in the queue, but no agent will take it. The Board shows it as Blocked.
- **Getting ready**: Ostler is making the task's copy, or an agent has it and is connecting.
- **Running**: an agent is working on it.
- **Waiting for you**: the agent asked a question and waits for your answer.
- **In review**: the agent finished, and its work waits for you to apply, send back or discard. The
  task is in the Board's Review column. A run that stopped partway also waits here if it left
  changes.
- **Accepted**: you applied the work, and the run is over.
- **Cancelled**: taken out of the queue before an agent finished it. Cancel leaves the task in
  Ready, and while agents are on every task in Ready is queued, so it is queued again straight away
  as a new run. To keep a task waiting, put it on hold instead.

Moving a queued task that no agent has started yet changes the queue with it. Blocked puts it on
hold and moving it back to Ready releases it. Any other column (on the Board, in the List, from
the drawer's status or with bulk edit), **Move to Someday**, or a show-from date later than today
takes it out of the queue, and the toast's **Undo** puts it back where it was and queues it again.
A task an agent is running, or whose work waits for your review, does not move: Ostler says why.

The queue hides accepted runs; tick **Include accepted** to see them.

## History and cost

The Agents tab's run history lists every run, by the built-in agent or one you connected, with how it
ended, its model, how long it took and the tokens it used. Filter it by outcome, model and dates.
Above the list are the totals: runs, success rate (applied out of finished runs), median duration,
tokens and cost, then the same figures for each model. **Export CSV** saves the filtered list.

The built-in agent's tokens are counted by the app. A connected agent's tokens are only what it
reports when it finishes, and are marked **reported by the agent**: the app can't check them.

Cost is shown only for models you give a price. Enter prices per million input and output tokens
in Settings › Agents › Usage, in your own currency. A model with no price shows no cost; nothing
is guessed.

## Token limits

In Project settings › Agents you can give the built-in agent a token limit per day and per month.
The Agents tab shows how much of each is used. When a limit is reached:

- no queued task starts automatically, and starting one yourself is refused;
- an item appears in the Inbox, with a notification;
- a running run stops at the end of its current step, and what it did so far waits for review.

The daily limit starts again at midnight, your local time, and the monthly one on the first of the
month. A run counts in the day it started. Limits apply to the built-in agent only; an agent you
connect yourself uses its own account.

## Review

When an agent finishes, its task waits under **Ready for you to review**. Look at what it changed,
then choose:

- **Apply** adds the work to your project folder as one entry in **History**. Your own edits are
  saved first, as a **Your edits** entry. If your folder changed while the agent worked and the
  changes overlap, Ostler doesn't apply anything: the task goes back to its agent to bring its work
  up to date, and comes back for you to review again.
- **Send back…** returns the task to its agent with your reason, in the same copy.
- **Discard** removes the agent's copy. The task goes back to the queue, and the work is kept for a
  while in case you want it back.
- **Nothing changed: Close** appears instead of Apply when the agent changed nothing.

### Pictures and a walkthrough

An agent can add two things to its report to make the review quicker. Both are up to the agent,
and agents are told when to use them.

- **Pictures**: screenshots the agent took of its work, when the change is something you can see.
  They show as a strip above the changes. Select one, or press `Enter` on it, to see it full size,
  and use the arrow keys to move between them. Ostler keeps a copy of each picture with the task,
  so you can still see them after you apply or discard the work. It takes at most ten images per
  report, 5 MB each, and says when it left any out.
- **Walk through**: for a large change, the agent can say where to start reading. **Walk through**
  opens the changes at the first stop, highlights its lines, and shows the agent's note for it with
  **Previous** and **Next** (or the arrow keys) to move between stops. If a stop's lines aren't in
  the changes shown, its note still appears, saying so.

The changes show each line's number in the file before and after the change.

### Try it

Reading the changes tells you what the agent changed, not whether it works. **Try it** runs your
project's **try command**, such as `npm run dev`, in the task's copy with one click, so you can see
the change working before you apply it. Nothing is applied.

Set the command in **Project settings** › **Agents** › **Try command**: one line, such as
`npm run dev`, `npm run preview` or `npm test`. Until there is one, Try it is greyed out and says
why. An agent can suggest a command in its report: Review changes then shows "The agent suggests:"
with **Use this command**, which opens project settings with it filled in for you to save. Ostler
never runs a command an agent suggests.

The first time you try work in a project, Ostler asks first: Try it runs the command on the agent's
code, with your rights, as running it yourself would. Only try work you are willing to run.

- If the copy's workspace setup hasn't finished successfully, Try it runs it first.
- The output shows as it comes, the last 2,000 lines. Addresses on this computer
  (`http://localhost`, `127.0.0.1` and `[::1]`) are links that open in your browser; no other links
  are.
- **Stop** ends the command and anything still running from the copy, such as a dev server that
  started on its own. Try it also stops when you apply, send back or discard the work, when you
  close Review changes (Ostler asks first while it runs), and when Ostler quits. One Try runs per task
  at a time. If another Try is already using a port, the output says so as it is.
- If the run changed or added files Git doesn't ignore, Ostler lists them ("Try it left 3 changed
  files") with **Undo those changes**, which puts back only those files, and **Keep them**. Files
  that were already changed before the run are never touched. Apply waits until you choose, so a
  build's leftovers never end up in your project folder by accident.

### Comment on lines

When the work is nearly right, point at the lines. In the changes, click a line number to comment
on that line, and Shift+click another to take in a range. With the keyboard, Tab to a line number,
move with the Up and Down arrows, hold Shift with the arrows to take in more lines, and press
`Enter` to write a comment. A comment on a removed line is about the old version of the file.

Each comment shows under its lines and in the **Comments** list beside the changes, where you can
show it in the changes, edit it or delete it (with **Undo**). A comment is plain text of up to
2,000 characters, and you can leave up to 50. Comments are kept with the task while you review, so
closing Review changes loses nothing.

**Send back…** then says how many line comments will be sent, and the reason can stay empty when
there are comments. The agent gets each comment with its file, its lines and the code around them,
as they were in the attempt you sent back: with **Back in the queue** it carries on in the same
copy, so the lines are usually still there. The task's details get one line, such as
"[Sent back 2] See the line comments (4 line comments)". **Apply** asks first when there are
comments it would leave unsent, and **Discard** drops them with the work.

When the agent has tried again, Review changes shows **Comments from the last review** beside the
new changes: a checklist of what you asked for, with the code each comment was about and the
agent's answer to it. The agent answers each comment in its report: **Done**, with a note and where
the change now is if it says, or **Not done**, with why. A comment it did not answer shows
**No answer**, and so does every comment when the attempt ended without a report. The counts at the
top ("2 done, 1 not done, 1 no answer") sum it up, and when a comment has no answer, "3 of 4
comments answered" shows next to **Apply**.

An answer is the agent's word, not something Ostler checked: compare it with the changes before you
decide. **Show** goes to where the agent says the change is, or to the file when it gave no lines
the changes show. **Comment again** carries a comment into a new line comment for the next
**Send back**, on the lines the agent pointed to (or the original lines, if the changes still show
them); edit or delete it in the **Comments** list like any other.

**Stop** on a running agent ends it the way Discard does: its work is kept, and its task goes back
to the queue.

### A reviewer before you

A second run can review an agent's work before you decide on it. The reviewer reads the task and
its changes in a copy of its own, changes nothing, and reports what it finds. It is a run like any
other: it shows in the run history, and it counts towards your token limits.

- **Ask a reviewer**, at the top of Review changes, starts a review of work waiting for you, in any
  project.
- **Review agent work before me**, in Project settings › Agents, starts one for every piece of
  work that finishes with changes. It is off until you turn it on. Work without changes, and a
  review itself, is never reviewed.

While its review runs, the task shows **Being reviewed** in the Agents tab, and it waits there
rather than in Home's Needs you and the Inbox. It shows in both once the reviewer has finished, or
when it ended without a report (saying so), or after 30 minutes (saying the reviewer has not
finished), so a review that never ends cannot hide your work. You can open Review changes at any
time meanwhile.

Review changes then sums the review up ("Reviewer: 2 must-fix, 3 should-fix, 1 nit") with the
reviewer's own words about the change. Findings about the change as a whole, or lines the changes
do not show, are listed above the changes; the rest show under their lines and in a
**Reviewer's findings** list beside them. Each is labelled as the reviewer's, with its severity in
words: **Must fix**, **Should fix** or **Nit**. **Show findings** shows one severity at a time.

Findings are the reviewer's opinion, and Ostler never sends them to the agent. To pass one on,
choose **Send back as mine**. A finding on lines of the changes becomes one of your line comments,
which you can edit or delete in the **Comments** list, and **Send back…** carries it with the rest.
A general finding has no lines to comment on, so its words are added to your Send back reason, as
a paragraph of their own after anything you have written, and Send back opens if it was closed.
Edit the reason as you like before you send it; **Cancel** clears it. **Dismiss** marks a finding
you disagree with (**Bring back** undoes it). **Apply** asks first while must-fix findings are
open: "2 must-fix findings are open. Apply anyway?"

### If you switch versions

If your project folder switches to a different version while an agent works (a different branch,
in Git), the task says so and the agent carries on. When you apply it, Ostler asks first: **Apply
to the current version**, or **Wait** until the folder is back on the task's version. A copy whose
agent hasn't started yet simply follows your folder.

## History

A project's **History** view lists everything Ostler did to your folder: each task you applied, each
**Your edits** entry, and each undo. Search it by task, file or date.

- **Undo this task** takes a task's work back out of your folder. If later work changed the same
  lines, Ostler asks whether to undo both or leave it.
- **Undo the undo** puts it back.
- **Restore to this point** puts every file back the way it was then. Your edits are saved first,
  and the restore is an entry you can undo too.
- **Discarded work** lists work you discarded or stopped. **Bring back** puts it up for review
  again.

Restore points and discarded work are kept for 30 days by default. Change that in Settings › Data,
which also shows how much space agent copies use. If you keep your own version history and don't
want **Your edits** entries, turn on **I manage version history myself** in Settings › Advanced.

## Conventions

**Project settings** › **Agents** › **Conventions** holds the rules every agent follows in that
project, in Markdown: how to run the tests, the code style, what not to touch. Every agent reads
them, built-in or connected.

### Lessons: remember this for next time

When you send work back with a reason or line comments, the message that says it went back offers
**Remember this for next time**. It opens a short form with your reason as a draft lesson, and
each of your line comments with **Use this comment**, so you can pick the one worth keeping. Write
it as a rule for any task, not just this one: "Use `formatDate` from `src/shared/format.ts` for
dates, never a new helper." Save it, or cancel and nothing is kept: Ostler never saves a lesson by
itself.

Every later agent on the project reads the lessons that are on after the conventions, under
**Lessons from earlier reviews**, each with the date you saved it. If the conventions and lessons
together grow very long, the oldest lessons are left out first, and the agent is told how many.

**Project settings** › **Agents** › **Lessons** lists them, each with where it came from ("From
sending back “Fix the login”, 3 October"). Turn one off with its switch, **Edit** it, **Move into
conventions** to add it to the end of your conventions as a line of its own, or **Delete** it
(with **Undo**). A project keeps up to 100 lessons of up to 500 characters each. Like the
conventions, lessons stay with the project on this computer: they are not part of an exported
project file.

## Workspace setup

A new copy starts without the folder's installed dependencies (`node_modules` and the like are
never copied). So while it gets the copy ready, Ostler installs the dependencies with the package
manager the project's lockfile names. **Project settings** › **Agents** › **Workspace setup**
chooses how:

- **Automatic** (the default) runs the install that matches the lockfile, such as `npm ci`,
  `pnpm install --frozen-lockfile` or `uv sync --frozen`, or `dotnet restore` for a .NET solution
  (or project) at the top of the folder. With nothing recognised, nothing runs.
- **Custom** runs a command you type, for a package manager Ostler does not detect.
- **Off** installs nothing.

This happens when you queue the task, so the copy is ready by the time an agent starts. If setup
fails, the queue says **Couldn't make the agent's copy** with the reason, and Ostler tries again.
Setup also fails if it changes a file the project tracks, or creates files Git does not ignore: add
those folders, such as `dist/` or `.venv/`, to `.gitignore`.

## Run tasks automatically

In Project settings, **Run queued tasks automatically** starts queued tasks without you, up to the
number of agents allowed at once. It is off until you turn it on, and it never applies work: you
always review it.
