# Decisions

The **Decisions** tab is the project's decision log. A decision record keeps the reason behind a
choice, so nobody has to guess it later.

## Record a decision

Use **New decision** and fill in:

- **Title:** the choice in a few words
- **Date:** when it was made
- **Context:** what led to it
- **Decision:** what was decided
- **Alternatives:** what else was considered
- **Consequences:** what follows from it

Link the tasks a decision affects, so each task shows why it is the way it is.

In any of the text fields, type `[[` to link to a task, milestone, Library item or another
decision ([Links in text](03-tasks.md#links-in-text)). Editing a decision shows **Linked from**
when a task, comment, note or other decision links to it.

## Sign-offs

A decision can be sent for sign-off, to get a named person's agreement. Open it and use **Ask for
sign-off**, choose the person under **Ask who** and press **Ask**. Only that person can **Approve**
it or **Send back** with a note. A decision has no Done state, so a waiting sign-off blocks
nothing. See [Sign-offs](03-tasks.md#sign-offs).

## With Ostler AI

When AI is set up, Ostler AI can draft a decision record from your notes. You review and edit it
before saving. A drafted record is marked as a suggestion until you save it.

**Find actions and decisions** on a Library note proposes the decisions written in it, beside its
tasks ([Library](07-library.md#find-actions-and-decisions)). A decision added that way names the
note at the start of its context and links the tasks added with it.

## Find decisions

Decisions show up in the command palette (`Ctrl` + `K`) and on the search page, with the words you
searched for highlighted.
