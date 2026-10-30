# Troubleshooting

## Something looks wrong after a change

Most changes can be undone: press `Ctrl` + `Z` while the message about it is showing, or restore a
deleted task from **More** › **Recycle bin**. For bigger problems, restore a backup from
Settings › Data (see [Backups and restore](15-backups-and-restore.md)).

## A change didn't save

A failed save is never silent. The task drawer's header says **Not saved**, the field says what went
wrong, and the text you typed stays in it. **Retry** saves it again. If you close the drawer first,
Ostler asks whether to retry that change, discard it (the field goes back to what was saved), or keep
editing.

## A view shows an error

Each view recovers on its own: switch to another tab and back. If a whole page fails, go to Home
from the sidebar.

## Ostler AI doesn't answer

- Check Settings › AI. Use **Test** to try the connection.
- For a local model, make sure Ollama or LM Studio is running.
- For an account, check that the key is still valid and has credit.
- The message Ostler shows says what went wrong. **Details** has the provider's own words.

## Agents don't start

Run the checks again in Settings › Agents. Agents need Git, a project with a linked folder that is
a Git repository with at least one commit, and a model. If **Stop all AI** was pressed, choose
**Resume** in the status bar.

## Ostler is already open

Ostler runs once per data folder. Opening it again brings the open window to the front.

## Report a problem

Choose **Help** › **Report a problem…**. Ostler copies its diagnostics to your clipboard and opens
the issue page in your browser. Describe what happened, and paste the diagnostics only if you want
to. Diagnostics hold versions, counts and the end of the log, with your name, keys and tokens
removed and no project names. **Help** › **Copy diagnostics** copies them without opening the page.

## Where Ostler keeps its data

In `%APPDATA%\ostler`, unless it was started with another data folder. The log is
`logs\main.log` in that folder.

The log keeps two kinds of line apart. When Ostler says no to something on purpose, such as a
missing title or an agent's changes that conflict, it writes one `INFO` line. When something
actually goes wrong, it writes an `ERROR` line followed by the details a developer needs.
Diagnostics count only the `ERROR` lines.
