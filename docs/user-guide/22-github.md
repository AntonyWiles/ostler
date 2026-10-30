# GitHub

A task can link the GitHub issues and pull requests it is about, and a project can bring in a
repository's issues as tasks. Ostler only reads from GitHub: it never comments, closes, labels or
pushes anything there.

## Link an issue or pull request

1. Open the task. In its **GitHub** section, press **Link an issue or pull request**.
2. Paste the issue's or pull request's address, such as
   `https://github.com/acme/site/issues/12`, or type `acme/site#12`. When the project has a
   repository (below), `#12` is enough.
3. Press **Link**.

The section lists each link with its number, title, state (open, closed, merged or draft) and when
it was last fetched. Click a link to open it in your browser. Remove one with its bin button, and
**Undo** puts it back. A task can have up to 20 links.

Cards on the Board and in lists show a small icon for each link (up to three) in the colour of its
state, as last fetched.

### When Ostler asks GitHub

Titles and states are fetched **when you open a task that has links**, and when you press
**Refresh** in its GitHub section. Nothing is fetched in the background, on a timer or when Ostler
starts. Between fetches the section shows what it had, with the time it was fetched. If GitHub
can't be reached, or can't find a link, the section says why beside that link and keeps the last
title and state.

## The project's repository

Project settings › **Folder and GitHub** takes the project's repository as `owner/name` or its github.com
address. When the project's folder is a Git repository whose `origin` remote is on GitHub, Ostler
suggests it, and you press **Use it** to confirm. Reading the remote changes nothing in the folder.

With a repository set, `#12` links issue 12 there, and **From GitHub issues** starts with it.

## Import a repository's issues

1. Open **Import tasks…** and choose **From GitHub issues…**.
2. Enter the repository, choose **Open** or **Open and closed**, and optionally labels (every one
   must match) and a milestone, by its name or its number (a name is matched first, so a milestone
   called 2025 is found by its name).
3. Press **Read issues**. The preview shows each issue as a task, as for a CSV import.
4. Press **Import**.

Each task links its issue. The title becomes the task's title, the body its description (Markdown,
shown with the same safe formatting as any description), labels become labels, the milestone
becomes a milestone (created if the project has none of that name), and assignees are matched to
people by name. Closed issues come in as Done. Pull requests are never imported.

Issues already linked to a task in the project are skipped, so importing again adds only new ones.
An import reads at most 1,000 issues; narrow it with labels or a milestone if there are more. Undo
the import from **Import history** like any other.

## A GitHub token

Public repositories work without a token, within GitHub's limit of 60 requests an hour for this
computer. A token raises the limit and reaches private repositories.

1. On GitHub, open **Settings › Developer settings › Fine-grained tokens** and generate a token.
2. Give it access to the repositories you want, with **Issues: Read-only**, **Pull requests:
   Read-only** and **Metadata: Read-only**. Ostler needs nothing else.
3. In Ostler, open **Settings › Connections › GitHub**, paste the token and press **Save token**.

The token is encrypted with Windows' own protection when Windows can, and never shown again. Press **Remove token** to
forget it. When GitHub's limit is reached, Ostler says so and when to try again.

## What is sent to GitHub

Only `api.github.com`, only when you open a task with links, press **Refresh**, link an issue or
read issues to import. Each request names the repository and issue number (or the filters you
chose), carries your token if you saved one, and identifies the app as Ostler. Nothing about your
tasks, projects or files is sent. See [Privacy](18-privacy.md).

The automation API can do the same: see `docs/automation-api/work-items.md` (GitHub links) and
`docs/automation-api/import-and-export.md`.
