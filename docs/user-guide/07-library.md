# Library

Each project's **Library** keeps everything that belongs with the work in one place, so you don't
have to hunt through folders, emails and downloads: quotes, receipts, plans, photos, meeting notes,
useful web pages. It works the same whether or not you use Ostler AI. Without it, the Library shows
nothing about AI at all.

- **Design briefs:** what the project is for, who it's for and what done looks like
- **Guides:** how things are done, such as a checklist or house rules
- **References:** images and screenshots
- **Documents:** PDFs, Word, PowerPoint and Excel files, and other files
- **Links:** web pages
- **Notes:** anything else you write down
- **Whiteboards:** notes, sketches and mind maps laid out on a board (see
  [Whiteboards](30-whiteboards.md))

A whiteboard opens in the project's Plan view: double-click it, or press **Open whiteboard** in its
detail, which shows a preview of the board. Its text is an outline Ostler writes from the board,
for search, so you can't edit it or restore an earlier revision of it here; change the board
instead.

An empty Library offers **Write a note** and **Import files** to get you started.

## Add to the Library

- Drop files anywhere on the Library.
- Paste a screenshot or a link.
- Use **Add › Import from clipboard** to keep what you last copied, from any app: a picture as a
  PNG, a file copied in File Explorer as that file, a web address as a link, and other text as a
  note titled by its first line.
- Snip part of the screen into a new task with **Snip to task** (see
  [Tasks](03-tasks.md#snip-to-task)): the picture is saved here as a PNG and attached to the task.
  Press **Mark up** in quick add to draw on it or blur what is private first.
- Use **Mark up a copy** on a picture to draw arrows, boxes, highlights and text on it, or blur
  part of it (see [Tasks](03-tasks.md#mark-up-a-picture)). The copy is a new picture, "<name>
  (marked up).png". It starts unattached: attach it to the
  task it belongs to, as any item. From a task's drawer, the copy is attached to that task. The
  original is never changed.
- Use **Add** to write a brief, guide or note in Markdown.
- Use **Add › New meeting notes** to start a note with headings for the date (today's, filled in),
  who was there, the agenda, notes, decisions and actions.
- Use **Add › New whiteboard** to start a whiteboard. It opens in the Plan view, where you choose
  its title and template.
- Use **Write release notes** on a milestone or an iteration to save its finished tasks as a note
  tagged `release-notes` (see [Milestones and goals](06-milestones-and-goals.md#release-notes)).

Files you add are copied into Ostler's own data folder, so moving or deleting the original doesn't
break the Library.

Give an item a one-line **Summary** in its details ("Prices from the three caterers") and the list
shows it under the title. Without one, a note, brief or guide shows its first line of text.

The details on the right show a preview: a picture, a whiteboard, a note's text, or a PDF's pages
(use the arrows under the page to turn it). A Markdown file shows formatted, and a Word,
PowerPoint or Excel file shows its text. Drag the left edge of the details to make them wider or
narrower; Ostler remembers the width. In a narrow window the details sit under the list instead.

### Files in OneDrive, SharePoint, Google Drive or Dropbox

To keep a cloud file where it is, add its sharing link as a link instead of the file. Ostler keeps
only the link, never a copy, and **Open** opens the file in your browser. Attach it to tasks like
any item.

The item's detail says which service the file is in. If you connected an account that can pick
files there (**Settings › Connections › Accounts**), Ostler also reads the file's current name:
an empty title is filled in when you add the link, and when the file has been renamed since,
**Use this name** updates the title. Google only lets Ostler read files picked with Ostler, so a
pasted Google Drive link may show no name; the link still works.

## Find things

Use the search box (`Ctrl` + `F` in the Library) and the sections along the top. Add tags to items
in their details, such as `receipts` or `quotes`, and pick one from **Tags** beside the search box
to see only those.
Library items also show up in the command palette and the search page.

Search finds the words inside files as well as their names: PDFs, text and Markdown files, and
Word (`.docx`), PowerPoint (`.pptx`) and Excel (`.xlsx`) files. Ask "where did we write down the
venue's capacity?" by searching for **capacity**, and the result shows the passage around it, with
the page of a PDF ("page 7"), the slide of a deck ("Slide 3") or the sheet of a workbook ("Sheet
Budget"). Opening the result opens the item in the Library; **Open** opens the file in its own
app, which starts at the first page.

- A deck's speaker notes are read with its slides. A workbook's cells are read row by row; dates
  show as the numbers Excel stores, not as dates.
- Ostler reads the text only. It never runs a file's macros, follows its links or opens what is
  embedded in it.
- Text in pictures and scanned pages is not read. Neither are old `.doc`, `.ppt` and `.xls` files.
- A file Ostler can't read, such as a password-protected one, is still kept: its details say
  **Could not read the text of this file**.
- Files you added before Ostler could read them are read once, in the background, after Ostler has
  started, one at a time, and only while you are not typing or scrolling. Settings › Data shows
  how far it has got, such as **Reading 12 of 140 files for search**.

## Link to tasks and other items

In a note, brief or guide, type `[[` to link to a task, milestone, decision or another Library
item of the project ([Links in text](03-tasks.md#links-in-text)). The preview and the item's
detail show each link with the item's current title. An item's detail lists **Linked from**: the
descriptions, comments, decisions and notes that link to it.

## Live lists

A live list shows "where things stand" in a note and stays current: the open design tasks, what is
blocked, what is due this week. In the editor, choose **Insert a live list**, then pick one of the
project's [saved views](09-search-filters-and-saved-views.md#saved-views) or build a filter, give
it a title if you like, choose how many tasks to show (20 at first), check the preview and
**Insert**. A saved view gives the list its filter and search only, not its sort, columns or other
settings.

In the preview, the item's detail and anywhere else the note shows, the list reads as its title, a
count by status ("4 in progress, 2 in review"), and the matching tasks with their status, assignee
and due date. Click a task to open it. When more tasks match than the list shows, **and 12 more**
opens the List with the same filter, so the note and the List always agree.

In the note's text a live list is a short block of plain text, so the file still reads in any other
program:

````
```ostler-tasks
# Tasks where status is In progress and labels include any of design
filter: {"match":"all","conditions":[{"field":"status","op":"is","value":["active"]},{"field":"labels","op":"hasAny","value":["design"]}]}
title: Open design work
```
````

You can edit the block by hand. Lines starting with `#` are for people reading the file elsewhere:
Ostler writes one describing the list in words, and writes it again whenever you save. If a block
cannot be read, or its saved view was deleted, Ostler shows a quiet note with the block's text
instead of the list. A block pasted into a task's description or a comment shows as a list of that
project's tasks too. Exports get the note's text as written, never the tasks a list shows.

## Make a task from a line

Notes are often where work first appears: "- call the venue about parking". To turn lines into
tasks, select them in the editor of a note, brief or guide and press **Make a task** in the
toolbar, right-click and choose from the menu, or press `Ctrl` + `Shift` + `K`. With nothing
selected, the line the cursor is on is used. Choose:

- **A task from each line**: one task per line with words in it.
- **One task**: the first line is the title, the other lines the description.

List markers and check boxes (`- `, `* `, `1. `, `- [ ] `) are left out of the titles, and each
title is read as in quick add, so `#label`, `@person`, `!high` and dates such as `friday` work. As
in quick add, a task whose line names no `@person` is assigned to you. A short dialog shows the tasks before anything is made (title, the Backlog status, and what it read
from the line); press **Make 3 tasks**, for example.

In the note's detail, each list item also has a **Make a task** button when you point at it or tab
to it, which makes one task from that item.

In one step, the tasks are made, each lists the note as its source, and each line becomes a link to
its task while keeping its words: `- [Call the venue about parking](ostler://task/…)`. The
note is saved as a new revision. Each link shows its task's current title and status, ticked once
the task is done, so the note reads as a list of actions and where they stand. The text stays
ordinary Markdown, readable in any editor; finishing a task does not change the note's text. A line
that is already a link to a task makes no second task. One **Undo** in the toast removes the tasks
and puts the note's text back. If the note was saved somewhere else after you selected the lines,
Ostler says so and makes nothing: select the lines again.

On a whiteboard, **Make tasks** does the same for selected notes, shapes and mind-map ideas (see
[Whiteboards](30-whiteboards.md#making-tasks)).

## Attach to tasks

Attach Library items to a task from its drawer, or add new files to it there: **Attach files…**,
**Paste picture**, or a drop on the task's attachments (see
[Tasks](03-tasks.md#files-and-pictures-on-a-task)). Those files are kept here too. Anyone working
on the task sees what's attached. Any item that isn't archived can be attached.

## The project brief

A project's first design brief becomes its project brief, and the Overview shows it. To use another
brief instead, open it in the Library and make it the primary brief.

## If you use Ostler AI

Everything in this section shows only once Ostler AI is set up (see [Ostler AI](13-ostler-ai.md)).

### What Ostler AI reads

Each item's details have **Ostler AI reads it**, with three choices:

- **Always**: sent with every Ostler AI request in the project, as far as it fits.
- **When selected**: sent only when you choose the item for a request, or attach it to a task.
- **Never**: never sent to Ostler AI, and never given to an agent, even when attached to a task.

New briefs and guides start as **Always**; pictures, documents, links and whiteboards as **When
selected**; notes as **Never**, and meeting notes as **When selected**. A snip saved to a task
starts as **When selected**, and a marked-up copy keeps the original's choice. Each item in the list
shows a badge: **AI always**, **AI when selected** or **No AI**. The **Ostler AI** button beside the
search box shows how much of the **Always** text and pictures fits in a request, and filters the
list by choice. It shows a warning sign when some of it doesn't fit. An
item's **Summary** is sent with it, so a good one helps Ostler AI know what the item is for.

A file's text reaches Ostler AI only as this choice allows. Live lists are sent as the note's text,
never the tasks they show. **Make a task** from a line sends nothing, so it works on any note.

An AI agent working on a task reads only the items attached to that task, never one set to
**Never**.

### Find actions and decisions

A note, brief or guide shows **Find actions and decisions**. Ostler AI reads
the note and proposes the tasks (with due dates, people and checklists) and the decisions in it.
Review them in one dialog with two lists, tick and edit the ones you want, and press **Add**, such as
**Add 3 tasks and 1 decision**. One **Undo** removes everything that step added.

- Each task added this way lists the note as its source, so its drawer shows where it came from.
- Each decision's context starts with "From the note" and the note's name, and it links the tasks
  added in the same step.
- Run it again on the same note later: proposals that look like tasks already made from it say
  **Already a task** and start unticked, so you add only what is new.

Only the note's title and text are sent. A note set to **Never** is never sent (a new note starts
that way; new meeting notes start as **When selected**): change what Ostler AI reads to use this. A note too long to send whole is refused with a
message, never cut short.

### The project brief and Ostler AI

Ostler AI reads the project brief whenever it helps plan work in the project. Whenever it is sent
(set to **Always**, or chosen for a request), it goes first and whole, however long it is.
