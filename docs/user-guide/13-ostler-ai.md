# Ostler AI

Ostler AI is optional. Everything else in Ostler works without it. When it's set up, it can:

- suggest tasks for a project
- turn a pasted, dictated or photographed list into tasks ([From text or a photo](03-tasks.md#from-text-or-a-photo))
- break a goal or a task down into smaller steps
- draft a decision record
- find the actions and decisions in a Library note, such as meeting notes ([Find actions and decisions](07-library.md#find-actions-and-decisions))
- make a view's filter from words you type ([Describe it](09-search-filters-and-saved-views.md#describe-it))
- improve what you write in a Library note, a task's description or a decision ([Improve writing](#improve-writing))
- summarise a long comment thread on a task ([Summarise comments](#summarise-comments))
- summarise a project
- answer questions about a project in its notes chat
- answer a question across all your projects, with links to where the answer came from ([Ask Ostler](#ask-ostler))
- write up Home's **Since you were last here** card as a short paragraph

What it writes is always a suggestion. You review it, and nothing is added until you choose to add
it. Suggestions are labelled with the model that made them and when.

## Review suggested tasks

**Suggest tasks**, **Break down with AI**, **From text or a photo**, **Find actions and decisions**
and an agent plan's split all
show the tasks Ostler AI drafted the same way:

- Every suggestion has a tick box, ticked to start with. Untick the ones you don't want.
- Edit a suggestion's title and details where they are, before you add it.
- The button says how many tasks it will add, such as **Add 4 tasks**. Nothing is added until you
  press it.

With the keyboard, Tab moves between suggestions and their fields, and Space ticks or unticks the
one in focus. A screen reader hears the new count each time it changes.

Added tasks carry no extra label. Their history says they came from an Ostler AI suggestion. Tasks
added by earlier versions may still have the labels `ai-next-five` or `agent-plan-split`; remove
them in Project settings › Tasks › Labels if you don't want them.

## Set up AI

Ostler doesn't include or provide an AI model. Ostler AI is the name for Ostler's AI features: they
send your request to the AI model you connect, either a provider's service with your own API key or
a model running on your PC. When you use a provider's service, what you send is handled under that
provider's terms and privacy policy, not Ostler's: Ostler can't see or control what happens to it
once it's sent. Read your provider's privacy policy before you connect it. A model running on your
PC sends nothing anywhere.

Go to Settings › AI and choose **Set up AI**. Four steps:

1. **Choose a provider.** A model that runs on this PC, such as Ollama or LM Studio, is free and
   nothing leaves your computer. Or use an account with an AI provider.
2. **Connect.** For a local model, Ostler can look for it. For an account, paste its API key.
3. **Choose a model.**
4. **Test** the connection.

Nothing is saved until you finish. Your API key is encrypted with Windows' own protection when
Windows can (see [Privacy](18-privacy.md)), and Ostler never shows it again.

## What Ostler AI reads

Ostler AI may read everything Ostler holds for you, so it can answer questions and plan from them:
tasks, comments, goals (your own too), milestones, decisions, the Library, contacts, costs and
budgets, billable time and rates, calendar events and field values, and the files in a project's
folder. Nothing is sent until you use an AI feature, and then each request sends the provider you
chose only what that feature needs:

- **The request's own records**, such as the task, note or comments you asked about.
- **The project's Library**: items set to **Always**, and items set to **When selected** when you
  choose them or attach them to a task. An item set to **Human only** is never sent. Each message
  in a project's chat takes up to 20,000 characters of it, and planning (a plan, splitting a goal
  into tasks, next tasks) up to 100,000. The project brief, when it is sent, goes first and whole;
  items that do not fit after it are only named, and Ostler AI may ask you to choose one.
- **Files in the project's folder** that the feature needs, skipping what your `.gitignore` leaves
  out. In the notes chat, name a file or folder ("make tasks from the prompts in
  `marketing/roles/`") and Ostler AI reads it.
- **Contacts, costs and the rest** only when a feature needs them, such as **Describe it**
  filtering by a contact, or **Ask Ostler** finding one.

**From text or a photo** is the exception: it sends only the text you typed and the photo you
added, never the project's records or the names of people on this PC. A photo is sent only when
Settings › AI lets the model read images. If the model can't read pictures, Ostler says so and sends
nothing in its place; type the list, or choose a model that reads images.

**Find actions and decisions** sends only the one note's title and text, and never a note set to
**Human only**.

**Ask Ostler** sends your question and today's date first, then your question with the records
and file passages it found: for a task its title, description, checklist and custom fields; for a
comment its text, task, author and date; for a goal or milestone its title, outcome and dates; for
a decision its text; for a Library item what Ostler AI may read of it; for a contact its name,
organisation, role, phone numbers, emails, website, address and notes; and for a file the matching
lines and their path. Each source is cut to 2,000 characters and the whole request to 40,000. A
follow-up question also sends the same open conversation's earlier questions and answers (text
only, the latest five).

Ostler AI only reads. It never writes: it never changes a file or a record, runs anything or
starts an agent. It suggests, and what it suggests is saved only when you click, such as **Add**.

## Ask Ostler

Ask a question about everything in Ostler, such as "What did we decide about the tiles?" or "Who's
waiting on the plumber?". Open it with **Ask Ostler…** in the command palette (`Ctrl` + `K`), or
with the **Ask Ostler** button beside Search's box, which takes the words you typed there.

Type the question and press **Ask**. The panel says what it is doing ("Searching 4 projects…",
"Writing the answer…"); **Stop** cancels the question. Ostler then:

1. Asks Ostler AI to turn your question into a few short searches. Only the question and today's
   date are sent for this.
2. Runs those searches itself, on this PC, across every project that is turned on: tasks,
   comments, goals, milestones, decisions and Library items, and your contacts. Archived and
   deleted items are left out, and so are Library items set to **Human only**. If the searches
   find nothing, it searches the longer words of your question one at a time instead.
3. Sends Ostler AI your question and the best 20 of what it found, and Ostler AI answers from those
   alone.

**Search file contents**, on to start with, also searches the text files in each project's linked
folder, on this PC, skipping what `.gitignore` leaves out and files over 512 KB. It looks at up to
5,000 files or for 3 seconds per project, and says so when it stopped early. A match is sent as
the matching lines with five lines either side, and at most 8 of the 20 places go to files. Ostler
remembers whether you left the switch on or off.

The answer cites its sources as [1], [2] and so on. Click a number, or a source in the numbered
list under the answer, to open it: a task in its drawer, a decision, a Library item, a contact,
or a file at its lines in the project's Files tab. If the sources don't answer the question, Ostler
AI says so rather than guessing.

### Follow-up questions

Under an answer, a box takes the next question, such as "What about the kitchen?". It is part of
the same conversation: the panel keeps each question, its answer and its sources, newest at the
bottom, while it is open. To work out what to search for, Ostler AI is also given your earlier
questions; to write the answer, it is also given the earlier questions and answers, as text only
and without their sources. Only the latest five are sent, each answer cut to 4,000 characters, and
the panel says so when older ones were left out. Each answer has its own numbered sources, and its
[1], [2] open its own list. **New question** starts again.

Nothing is kept once you close the panel. If you have asked more than one question, closing asks
first, and offers **Save as a note** there too.

### Save a conversation as a note

**Save as a note** asks which project's Library to keep it in (to start with, the project most of
its sources came from) and a title (the first question, shortened), then makes a Library note:
each question as a heading, each answer as written, and each answer's sources as a numbered list,
a task as a link that opens it. The note says at the top that Ostler AI wrote it and on which date,
and, when its sources came from other projects too, which projects. It opens in the Library;
**Undo** in the message removes it again. Once saved it is an ordinary note, yours to edit, and
Ostler AI reads it only as its own AI access allows.

Costs and calendar events are not part of Ostler's search, so Ask Ostler can't find them yet.

## Improve writing

**Improve writing** sits beside the text of a Library brief, guide or note, a task's description,
and each text field of a decision you edit (context, decision, alternatives and consequences).
Choose how: **Clearer**, **Shorter**, **Friendlier**, **Fix spelling and grammar** or **As a
list**. Select part of the text first to improve only that part.

The suggestion shows beside the text (below it in a narrow window), with the words it adds and
removes marked. Nothing changes until you choose **Accept**, which types the suggestion in for you,
so the editor saves it the usual way and `Ctrl` + `Z` takes it back. **Try again** asks for another
suggestion in the same style, and **Discard** closes it.

Markdown, links and `[[links]]` are kept as they are. If a suggestion drops a link, Ostler says
which before you accept. Ostler improves up to 20,000 characters at a time; for a longer text,
select a part. It sends the text you chose (as it is in the editor, saved or not), the style and
the project's name, and nothing else. It never shows on a Library item set to **Human only**.

## Summarise comments

On a task with 8 or more comments, **Summarise** above its activity asks Ostler AI for a short
summary: what was decided, what is still open, and who is waiting on whom. It shows above the thread
with the dates it covers. **Add as a comment** keeps it as a comment from Ostler AI, marked with the
sparkle, with **Undo**; **Close** keeps nothing. Ostler sends the task's title and its comments, with
their authors' names and dates: the latest 200 at most, and it says when there were more. Nothing
from other tasks is sent.

## Suggest in To triage

In a project's [To triage](03-tasks.md#triage), **Suggest** asks Ostler AI how to triage a waiting
task: a priority, up to three labels from the project's own (never a new one) and which tasks
look like the same work, each with a one-line reason. Before anything is sent, Ostler's own search
finds, on this PC, up to ten open or recently closed tasks in the same project that share words
with the task. Ostler sends the waiting task's title and description, the project's label names,
and those tasks' titles and statuses: nothing else, and never another task's description. It
checks the answer and drops any label or task it doesn't know. Nothing is saved until you use a
suggestion and accept the task. **Suggest for all** makes one request per waiting task, after
saying how many. Suggestions only come when you press the button, never on capture.

## Fill fields with AI

An [AI field](03-tasks.md#ai-fields) is a Text or Choice field with an instruction, such as "Which
room is this for?". **Fill with AI** in a task's drawer, or for tasks selected in the List, asks
Ostler AI to fill it from each task's own title, description and checklist. Each request sends the
field's name, its instruction and (for a Choice field) its option names, and that one task's title,
description and checklist: nothing else, not even another field's value or the task's comments. The task's text is treated as content to read, not as instructions. A Choice answer that
is not one of the options is left empty, with a note; a Text answer is cut to 500 characters.
Ostler AI only suggests: the values are saved because you asked, can be undone in one step, and
never replace a value you entered unless you say so. Ostler AI never fills a field without a click.

## Write up what changed

On Home's **Since you were last here** card (see [Home and Inbox](05-home-and-inbox.md)), **Write
it up** asks Ostler AI for a short paragraph about what changed. It is sent only the card's task
titles and counts: never a task's description, a comment's text, an agent's question, or the name
of the person or rule that did something. The paragraph is labelled with the model and when it was
written, and the card's facts stay below it. Nothing is saved.

## Software or not

Ostler AI writes tasks for the person doing them. For a software project with agents on, it can
also plan work for AI coding agents. **Kind of project** in Project settings chooses which. Auto
decides from whether a folder is linked.

## Stop all AI

While AI or agents are on, **Stop all AI** in the status bar cancels every AI request at once and
stops all agents.
