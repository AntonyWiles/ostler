# Pomodoro Desk — design brief

> **This project is a test vehicle.** It exists to give Ostler real work to plan, track and hand to
> agents. "Good enough to run" is the bar. Nobody should spend time polishing it: if a task is
> ambiguous, pick the simplest reading, write it down, and move on.

## What it is

Pomodoro Desk is a tiny Windows desktop app that helps one person work in focused blocks. It
counts down a 25-minute **Focus** period, then a 5-minute **Short break**, and after every fourth
focus period a 15-minute **Long break**. That is the whole product.

## Who it is for

Anyone on Windows 10 or 11 who wants a timer that starts instantly, sits in a corner of the
screen, and needs no account, no internet and no manual.

## How it looks and behaves

- One small window (about 320 × 220), titled **Pomodoro Desk**.
- A large countdown, `mm:ss`, centred. Under it, the current period: "Focus", "Short break" or
  "Long break", and "Today: n" — focus periods finished since midnight.
- Three buttons: **Start** (becomes **Pause** while running), **Reset**, and **Skip break** (only
  during a break).
- Keyboard: `Space` starts or pauses, `R` resets, `S` skips a break.
- When a period ends, the app shows a Windows tray notification ("Focus done — take a break" or
  "Break over — back to it") and moves to the next period, paused.
- While running, the window title shows the time: `12:34 — Focus`.
- Colours: plain system colours; the countdown uses the accent colour during Focus and grey
  during breaks. No custom styling beyond that.

## Settings

Durations (focus, short break, long break, focus periods before a long break) are stored in
`%APPDATA%\PomodoroDesk\settings.json` and edited in a small **Settings** dialog. A missing or
broken file means defaults: 25 / 5 / 15 / 4.

## How it is built

- .NET 8, C#, **WinForms**. No other UI framework, no NuGet packages beyond the test ones.
- A solution `PomodoroDesk.sln` with three projects:
  - `src/PomodoroDesk/` — the WinForms app (`net8.0-windows`)
  - `src/PomodoroDesk.Core/` — the timer logic and settings, no UI references (`net8.0`)
  - `tests/PomodoroDesk.Core.Tests/` — xUnit tests for Core
- The timer reads time from an injected clock (`IClock`), so tests never wait in real time.
- `dotnet build` and `dotnet test` from the repository root must pass before any task is done.
- `bin/` and `obj/` are never committed.

## Out of scope

Statistics beyond "Today", sounds, themes, multiple timers, sync, installers, auto-update,
localisation, and anything that needs a server.

## Done means

Someone can run `dotnet run --project src/PomodoroDesk`, press Space, and watch a focus period
count down; the tests pass; the README says how to use it.
