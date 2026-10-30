# The monkey

A tool that uses Ostler through its window the way a person does, and writes down everything: every
click, key and paste, a screenshot after every action, every error the window or the main process
reports, and a report at the end. It is how Ostler gets put through its paces end to end, by a
script, by an AI overseer, or both. It is not part of the test suite: `npm test` and
`npm run test:e2e` never run it.

```bash
npm run monkey -- --help
```

It always runs Ostler on its own data folder under `C:\temp\ostler-roadmap\monkey\<run>\` and
refuses to touch `%APPDATA%`. Build first (`npm run build`, or add `--build`).

## Modes

| Mode                | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `journey` (default) | Carries the dummy project, **Pomodoro Desk**, from a new install to finished milestones, through the window: the welcome, AI setup, agents, a new project in a new folder, the brief, the plan, day-to-day work, decisions, agents building and being reviewed, milestones, export and import, backup and restart, cleanup. `--phases a,b` runs only some.                                                                                                                                                                                                                                                                           |
| `explore`           | A seeded random walk: on every screen it prefers controls nobody has pressed yet, types plausible and implausible text, and presses shortcuts. `--seed` replays a walk, `--steps` and `--minutes` cap it. It restarts Ostler once halfway to check that what it did survived.                                                                                                                                                                                                                                                                                                                                                        |
| `whiteboard`        | Puts one whiteboard through everything, by mouse and keyboard: every tool clicked and dragged, selecting, moving and resizing (checked: did it select, move, grow?), every Style and Arrange choice, zoom and pan, the keys, Connect to…, Link, Make tasks, pictures, right-clicks, every template and the mind map, rename and every export, a seeded random spell on the board, a small window and a restart. Every action ends in a burst of three screenshots 0, 120 and 400 ms apart, and every drag is photographed mid-drag and before release. `--phases wb-setup,wb-tools,…` runs only some (see `journeys/whiteboard.ts`). |
| `drive`             | Opens Ostler and takes commands over HTTP on loopback, for an AI overseer or a person: `node scripts/monkey-drive.cjs snapshot`, `click role=button "name=New task"`, and so on. Everything is recorded exactly as in a journey.                                                                                                                                                                                                                                                                                                                                                                                                     |
| `report <folder>`   | Rewrites `report.md` and `report.html` for a run folder, for instance after a crash.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

`--keep-open` hands a finished journey or exploration over to drive mode, and `--run <folder>`
continues an earlier run on the same data (same project, new session).

## Who does the AI and the coding

| Option     | Choices                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--ai`     | `fake` (default): a stand-in OpenAI-compatible server on loopback that answers every Ostler AI feature with valid, plausible content about the dummy project, instantly and free, and can fail on purpose (`POST /ai-fail` in drive mode). `live`: a real provider; the key comes from `MONKEY_AI_KEY`, the provider from `--ai-preset` (default `anthropic`) and the model from `--ai-model`. `off`.                                                                                                                            |
| `--agents` | `simulated` (default): the monkey itself plays an external coding agent: it starts a queued task from the Agents tab ("Start this task" or "Copy prompt and token"), takes the session Ostler started, and over the harness HTTP API works and commits in the task's copy, asks, reports blockers and reports the task done, so Apply, Send back, Discard and History get real work to show. `embedded`: Ostler's built-in agents do the work and the monkey reviews it. `external`: an agent you start yourself does it. `off`. |

## What it notices by itself

After every action: uncaught errors in the window, console errors, new `ERROR` and `WARN` lines in
`main.log`, a view's error page, danger toasts and alerts (unless the step expects them), raw text
that should never be shown (`undefined`, `NaN`, `[object Object]`, untranslated keys), a window
that scrolls sideways, clicks that changed nothing, slow steps, screens that take long to load
(the hand waits for a loading placeholder before it looks, so screenshots show the screen, not the
spinner), focus lost when a dialog closes, and native message boxes. On every new screen it also
looks the way a person does (`lib/look.ts`): a control something else lies over, text cut off with
no way to read the rest, a control with no name, a broken image, a blank screen. With `--a11y`, an
axe accessibility check on every new screen. Each lead becomes a finding with a
screenshot; the journey adds checks of its own ("Quick add files the task in the current
project") and notes friction it is written to look for.

Native file pickers, message boxes and the browser are replaced by recorders: a save picker saves
into the run's `exports\` folder, an open picker answers with the file queued for it (`open-file`
in drive mode), and nothing ever opens Explorer or a web page.

## A run's folder

| File                       | What                                                                                                                                                                                                                                                       |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `report.md`, `report.html` | Phases, findings by severity, failed and slowest steps, places never opened, coverage, a filmstrip                                                                                                                                                         |
| `review/`                  | Per phase, a storyboard (`NN-phase.md`: every step, result, screenshot) and contact sheets (`NN-phase-K.png`: the screenshots as captioned thumbnails, failures framed in red); `findings-K.png` for every finding's screenshot. Read these to see the run |
| `findings.json`            | Every finding, deduplicated with a count                                                                                                                                                                                                                   |
| `journal.md`               | The narrative: phases, checks, waits, native calls, notes                                                                                                                                                                                                  |
| `actions.jsonl`            | Every action: kind, target, typed text (secrets redacted), screen, duration, result, screenshot                                                                                                                                                            |
| `keys.log`                 | Every key, click and paste the window received, with the control it went to                                                                                                                                                                                |
| `console.log`              | The renderer's console                                                                                                                                                                                                                                     |
| `coverage.json`            | Per screen, the controls seen and how often each was pressed                                                                                                                                                                                               |
| `shots/`                   | A screenshot after every action (`--shots phases` or `errors` for fewer)                                                                                                                                                                                   |
| `data/`                    | The app's data folder; `projects/` holds the dummy project's folder                                                                                                                                                                                        |
| `journey-state.json`       | What the journey learnt (ids), so `--phases` can continue a run                                                                                                                                                                                            |

## Changing the journey

The journey is in `journeys/dummy-app.ts`, with the shared steps in `journeys/steps.ts` and the
coverage phases (`sweep`: every screen, settings section, project tab, guide page and menu, read
from the window; `everyday`: time, subtasks, renaming, delete and Undo, the recycle bin, the
archive, bulk changes, My work, Timesheet, the Library's import, Stop all AI; `appearance`: the dark
theme and small windows) in `journeys/coverage.ts`; the dummy project's plan and the files the simulated
agent commits in `dummy-app/plan.ts`, and the brief and agent conventions in
`tests/monkey/dummy-project/` (read by the journey, never copied). Controls are found by role and
accessible name, as a screen reader reads them; when a step fails because the screen changed, the
finding says so and the screenshot shows what is there now.
