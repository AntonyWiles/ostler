# Changelog

Every notable change to Ostler, newest first. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/). The app shows the section for the version you run under
Help › What's new, and the Unreleased section until a version has its own.

## [Unreleased]

### Added

- **Inbox on Android.** The phone has an Inbox tab with an unread count: reminders that fired,
  mentions of you, sign-offs asked of you, tasks to triage and reported blockers. Open an item, mark
  it read or unread, or archive it with Undo. Read and archived items match on your PC.
- **Search on Android.** Search your tasks, comments, decisions, milestones and goals from the
  phone's top bar, with the matching words marked.
- **More task editing on Android.** Edit a task's description, priority, start date, estimate,
  milestone and labels from the phone. The changes show in the task's history on your PC, and an
  earlier description can be brought back there.

### Fixed

- Removing one of your devices no longer shows "Sync folder refused: exists" when nothing else has
  changed since the last time.
- Leaving a project that a PC never joined now takes it off your list, so your other devices stop
  trying to join it.
- A phone that failed to save one shared project no longer fails to join every project after it.
- A new device no longer fails to load your personal space when a reminder points at a task in a
  project it hasn't joined yet. The reminder waits and appears once that project is joined.

## [0.1.0] - 2026-10-30

### Added

- **Initial release.** Ostler is a free, local-first project manager for Windows, with an Android
  companion. Your projects stay on your PC, with no account, no server and no telemetry. The
  [README](README.md) lists what it does, and the [user guide](docs/user-guide/01-getting-started.md)
  explains how to use it.
