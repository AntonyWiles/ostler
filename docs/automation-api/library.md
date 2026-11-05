# Automation API: Library

Part of the [Ostler Automation API](README.md). Base path for all routes below: `<baseUrl>/automation/<projectId>`

## Library

The project library holds design briefs, guides, reference images, documents, links, notes
and whiteboards. Ostler's own AI reads it when planning. Coding agents don't, except for items
attached to their work item, so a task must say in words what it needs from a reference. Your automation token acts for the human, so
**human-only** items (by default, notes) are listed here, marked `humanOnly: true`.
Ostler AI never reads those.

| Method | Path                       | Body                                                                                                            | Response                                                                                                                        |
| ------ | -------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/library`                 | — (query: `kind`, `access`, `label` (or `tag`), `search`, `includeArchived=true`)                               | Array of items, each with `humanOnly` and `labels`.                                                                             |
| GET    | `/library/:itemId`         | — (query: `include=linkedFrom`)                                                                                 | The item plus `text` (body, a whiteboard's outline, or extracted document text) and `sourceOf` (work items written from it).    |
| GET    | `/library/:itemId/file`    | —                                                                                                               | Raw bytes of a stored image or document, with its content type. 404 for items without a file, whiteboards included.             |
| POST   | `/library`                 | `{ kind: "brief"\|"guide"\|"note"\|"link", title, summary?, body?, url?, aiAccess?, labels?, isPrimaryBrief? }` | Created item. A whiteboard cannot be created here.                                                                              |
| POST   | `/library/upload`          | `{ fileName, mimeType, base64 }`                                                                                | `{ item, duplicateOf? }`. Images and documents only, at most 25 MB. A file the project already holds returns the existing item. |
| PATCH  | `/library/:itemId`         | any of `{ title, summary, body, url, aiAccess, labels, isPrimaryBrief }`                                        | Updated item. Text edits create a new revision. A whiteboard's `body` is refused.                                               |
| POST   | `/library/:itemId/archive` | —                                                                                                               | Archived item (hidden from Ostler AI).                                                                                          |
| DELETE | `/library/:itemId`         | —                                                                                                               | `{ id, deleted: true }`. Permanent, including stored files and links.                                                           |

With `?include=linkedFrom`, `GET /library` and `GET /library/:itemId` add `linkedFrom` to each item:
the texts that link to it ([Links in text](work-items.md#links-in-text)).

`aiAccess` is `"always"` (sent with every Ostler AI request, up to 4 images), `"when-selected"`
(only when the human selects it), or `"human-only"` (never). The text sent is up to 20,000
characters with each message of a project's Ostler AI chat and up to 100,000 for a planning action
(a plan, a task split, next tasks and the other drafts made from the Library). The project's
primary brief (`isPrimaryBrief`) goes first and whole, even when it alone is longer; the other
items follow in order until the next one does not fit, and the rest are named, not sent. Give
every item a one-line `summary`, the answer to "what should Ostler AI take from this?".
To fill a library from scratch:

```
POST  /library         { "kind": "brief", "title": "Design brief", "body": "...", "isPrimaryBrief": true }
POST  /library         { "kind": "guide", "title": "Art direction", "body": "..." }
POST  /library/upload  { "fileName": "home.png", "mimeType": "image/png", "base64": "..." }
PATCH /library/<id>    { "summary": "Match this layout: two columns, cards 8px apart" }
```

### Whiteboards

Whiteboards are drawn and edited in the app; there are no whiteboard routes. A whiteboard is a
Library item of kind `whiteboard` (`GET /library?kind=whiteboard` lists them), and its `body` is an
outline in Markdown that Ostler writes from the board's notes, shapes, arrows and mind maps, without
positions or pictures. `GET /library/:itemId` gives that outline as `text`. `PATCH /library/:itemId`
refuses a `body` for a whiteboard but edits its `title`, `summary`, `aiAccess` and `labels`, and
`POST /library` cannot create one. New whiteboards are `"when-selected"`: Ostler AI reads a board's
outline only when the human selects it, and a coding agent gets it as Markdown only when the board
is attached to its work item.

### Live lists in notes

A note, brief or guide can hold **live lists**: fenced code blocks with the info string
`ostler-tasks`. The app shows each as the project's matching tasks, always current; the text stays
plain Markdown that reads anywhere. There is no route of its own: write the block into `body` with
`POST /library` or `PATCH /library/:itemId`.

````
```ostler-tasks
# Tasks where status is In progress and labels include any of design
filter: {"match":"all","conditions":[{"field":"status","op":"is","value":["active"]},{"field":"labels","op":"hasAny","value":["design"]}]}
title: Open design work
limit: 20
```
````

- One of `view: <saved view id>` (from `GET /views`) or `filter: <filter JSON on one line>`, the
  same filter `GET /work-items?filter=` takes ([Filtering](filtering-search-saved-views.md)).
- Optional `title: <words>` (at most 200 characters) and `limit: <1 to 100>` (20 when left out).
- Lines starting with `#` are for people reading the file elsewhere. On every save, from the app or
  this API, Ostler replaces them with one line describing the block in words.
- A view gives its filter and search text only; its sort, columns and other options are not used.
- Anything else (an unknown key, a key given twice, bad JSON, a filter the filter parser refuses)
  makes the block show as a quiet note with its text, and so does a view that was deleted. The body
  is never refused for it, and is stored as sent apart from the `#` line.
- Ostler AI and exports get the note's text as written, never the tasks a block shows. To read the
  tasks themselves, use `GET /work-items?filter=`.

**Make a task from a line.** The app's Make a task has no route of its own. To do the same
from outside, create each task with `POST /work-items`, rewrite each line of the note as a Markdown
link to its task, keeping the line's words
(`- [Call the venue](ostler://task/<projectId>/<workItemId>)`), and save the text with
`PATCH /library/:itemId { body }`, which makes a new revision and updates **Linked from**. Then
record the note with `POST /work-items/:workItemId/sources { itemId }`, so each task's source is at
that new revision. Read the note with `GET /library/:itemId` first, and do not save over a revision
someone changed since.

**Screenshots.** There is no capture route: Snip to task in the app needs a person at the
screen, and Ostler captures the screen only when they press its key, the tray item or the command
palette entry. To give a task a picture over the API, upload it with `POST /library/upload` and
attach it with `POST /work-items/:workItemId/attachments` ([Work items](work-items.md#work-item-attachments)).
A snip taken in the app is stored as a PNG with `aiAccess: "human-only"`, attached by `human`; it
shows in `GET /library` and `GET /work-items/:workItemId/attachments` like any item, marked
`humanOnly`.

## Labels

An item's tags are the project's labels, the same names its tasks use: there is no separate tag
list. Send them as `labels` (`tags` is the older name and still works); every item comes back with
both. A name nothing in the project has yet becomes a new label, listed by `GET /labels` and
offered on tasks. Renaming or deleting a label with `PATCH` or `DELETE /labels/:name` changes it
on Library items as well as tasks, and `POST /labels/restore` puts it back on both. `GET /labels`
counts each label's Library items in `libraryItemCount`, beside `taskCount`.
