# Pomodoro Desk: how work is done here

- This is a .NET 8 WinForms app: `src/PomodoroDesk` (the window), `src/PomodoroDesk.Core` (timer
  logic and settings, no UI references) and `tests/PomodoroDesk.Core.Tests` (xUnit).
- In a fresh workspace run `dotnet restore` first. Ostler does not install .NET packages for you.
- Before you finish: `dotnet build` and `dotnet test` from the repository root must pass. If the
  solution does not exist yet, creating it is probably your task.
- Never commit `bin/`, `obj/` or `.vs/`. Check `git status` before every commit.
- Good enough to run is the bar: this app is a test vehicle. When a task is unclear, take the
  simplest reading and say which one you took in your report. Do not polish.
- Commit your work with a clear message before you report the task done.
- Your completion report ends with a line that starts `Ostler friction:`. Put there anything about
  Ostler itself that slowed you down or confused you: the instructions, the tools, the workspace,
  the task text. Write `Ostler friction: none` if nothing did. This is how the people testing Ostler
  hear from you.
