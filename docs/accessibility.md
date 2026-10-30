# Accessibility

Ostler should work for people who use a keyboard only, a screen reader, Windows high contrast,
large zoom or reduced motion. This page says what we aim for, how it is checked, what is known not
to work yet, and how to tell us when something doesn't work for you. The user's version is
[the guide's Accessibility page](user-guide/19-accessibility.md).

## Target

**WCAG 2.2, level AA**, for the whole desktop interface: every view, dialog and drawer, Settings and
the welcome. AAA criteria and screen-reader-specific alternative interfaces are out of scope.

## How it is tested

### Automatically, on every run of the end-to-end suite (`npm run test:e2e`, and the release workflow)

- **`tests/e2e/a11y.spec.ts`** runs [axe-core](https://github.com/dequelabs/axe-core) (through
  `@axe-core/playwright`, a development dependency only) against the WCAG 2.0, 2.1 and 2.2 A and AA
  rules. It visits every view and settings section in the navigation registry (read from
  `src/renderer/navigation/registry.ts`, so a new view is audited without a change here), the task
  drawer, New task, Quick add, the shortcut overlay, Import, a confirmation, AI setup, agent setup
  and the three welcome steps, on the sample project. It runs four times: light, dark, Windows
  forced colours (`forcedColors: 'active'`), and Compact density, where targets are smallest
  (WCAG 2.5.8 is axe's `target-size` rule). Any serious or critical violation fails the run.
- A second sweep in the same spec, also in all four modes,
  first puts something in each screen: a capture in To triage, an idea in Someday, a cost, a
  shopping item, a contact, a goal of one's own, a task type, links and dates with a baseline, a
  milestone with two rounds and a countdown, My day with a time block today and one passed, an
  outside calendar event and a day off. It then audits Home with My day, progress and countdowns,
  the Weekly review, Goals, Contacts, To triage, Someday, Matrix, Costs, the Shopping list, the
  Timeline with links and **Compare with**, the Calendar's Week, Year and Agenda, Milestones, the
  task drawer and Project settings, and the dialogs Plan my day, Fill my day, Move them, Repeat
  this round, Write release notes, Compare rounds, Block time, Mark as duplicate, Save as
  playbook, Run playbook and Insert a live list. Each of those dialogs (but Save as playbook,
  which is saved) is closed with `Escape`, and focus must be back on the button, or the button of
  the menu, that opened it. Remember this for next time is audited in
  `tests/e2e/reviewer-notes.spec.ts`, which has the agent run and Send back it needs.
- A third sweep, also in all four modes, audits whiteboards: the Plan's Whiteboards pane with two
  boards, a board holding a note, a shape, an arrow, a picture, a card and a mind map (with nothing
  selected, then with the note selected and its style bar shown), and the New whiteboard, Link and
  Make tasks dialogs, each closed with `Escape` with focus back where it was; then the Library with
  the board selected and its preview shown. **`tests/e2e/whiteboard.spec.ts`** drives whiteboards
  end to end with keys and clicks: a template, Connect to…, undo and redo, a link opened in the
  task drawer, Make tasks and its Undo, copy and paste between boards, `Ctrl` + `Shift` + `V` as
  one note per line, and the board as it was after a restart.
- **ARIA snapshots** (`tests/e2e/a11y.spec.ts-snapshots/*.aria.yml`) hold the roles and names of
  Home, the Board, the task drawer and Settings › General, so a change to them shows up in review.
  `npx playwright test a11y --update-snapshots` rewrites them; then prune the parts that change by
  the day (greetings, dates, the OS user name) again before committing.
- **Zoom:** the same spec zooms to 200% in a 900 × 600 window, restarts, and checks the zoom was
  kept and that Home, the Board and Settings still fit.
- **`tests/e2e/keyboard.spec.ts`** does the keyboard walkthroughs below with keys only. Its `tabTo`
  helper moves focus with `Tab` and fails if the target is never reached or if any stop on the way
  has no visible focus indicator.
- Component tests cover focus after navigation and Skip to content
  (`tests/renderer/shell/route-focus.test.tsx`), dialog and drawer focus return
  (`tests/renderer/ui/Dialog.test.tsx`, `Drawer.test.tsx`), popovers closing on `Escape` and when
  `Tab` leaves them (`Popover.test.tsx`), ticked menu items read as checkboxes or radios
  (`Menu.test.tsx`), toasts said once without taking focus and naming both of their actions
  (`tests/renderer/ui/Toast.test.tsx`), a lazily loaded dialog that never hides the drawer it was
  opened from (`tests/renderer/lib/lazy-layer.test.tsx`) and the agent-run announcements.

### Keyboard walkthroughs

Each is an end-to-end test in `tests/e2e/keyboard.spec.ts`:

1. Create a project with the New project wizard; add a task; edit every field in the task drawer
   (status, title, assignee, priority, start and due dates, estimate, label, description, checklist)
   and save; focus returns to the card.
2. Move a card to another column from its menu (`J`, then `Shift` + `F10`, **Move to**).
3. Edit a title in place in List (`E`); move a task a day in Calendar and a bar a day in Timeline
   (`Alt` + `Right`).
4. Search with `Ctrl` + `K` and open the result; save a filtered Board as a view.
5. Change the theme in Settings › General; back up, then restore, from Settings › Data.
6. Review and accept a finished agent run in a scratch Git project (agents on).
7. Build a whiteboard: from the Plan, `Tab` to **Whiteboards**, **New whiteboard**, **Blank**,
   **Create** (focus lands on the board's title); `Tab` to the board, `N`, `Enter`, type, `Ctrl` +
   `Enter`; `S`, `Enter` for a rectangle, moved with `Shift` and the arrows; **Connect to…** (`C`)
   joins it to the note; `B`, `Enter` and type a central idea, `Tab` and type a child, `Enter` and
   type the next; move along the map with the arrows; `Shift` + `Tab` back to the note and make a
   task from it with `K`; **Back to the plan** (focus lands on the board's **Open** button).

### By hand

The maintainer's screen-reader checklist below, before each release. An automated run cannot listen to a
screen reader.

## Narrator and NVDA checklist

Run each step with **Narrator** (`Ctrl` + `Win` + `Enter`) and again with **NVDA**, on a scratch
data folder (`npm run dev:scratch -- a11y`) with the sample project open. Note anything that is not
said, said twice, or said wrongly.

1. **Start-up.** Ostler opens on Home. Press `Tab`: "Skip to content, link" is read. Press `Enter`:
   the Home heading ("Good morning…, heading level 1") is read.
2. **Navigation.** In the sidebar, open the sample project. The project name heading is read, and
   "Overview, Sample project" is announced once.
3. **Tabs.** Arrow along the project tabs to Board. Each tab is read with its position ("Board, tab,
   2 of 8, selected"), and "Board, Sample project" is announced; focus stays on the tab.
4. **Board.** Press `J`: the first card's title is read. Press `Shift` + `F10`: "Actions for …,
   menu" and the first item are read; arrow to **Move to** › **In progress** and press `Enter`. The
   card is read again in its new column.
5. **Task drawer.** With a card focused, press `Enter`. The drawer's title field is read. `Tab`
   through every field: each has a name, and the status and priority lists say their value.
   Press `Escape`: focus is back on the card.
6. **Saving.** Change the title and choose **Save changes**: "Saved "…"" is announced.
7. **List.** In List, arrow through the grid: cells are read with their column. Press `E`, type,
   press `Enter`.
8. **Calendar.** Arrow through the days: each day is read with its date and the number of items.
   `Tab` to a task and press `Alt` + `Right`: the move is read.
9. **Command palette.** `Ctrl` + `K`, type a task's name: the number of results and the selected
   option are read; `Enter` opens it.
10. **Toasts.** Move a task to the recycle bin. The message ("… moved to the recycle bin. Undo is
    available.") is read once, and focus does not move.
11. **Errors.** In Settings › AI, set up a provider with a wrong key and choose **Test**: the error is
    read without moving focus.
12. **Agents** (Settings › Agents on, a scratch Git project). Start a run: "Agent started …" is
    announced. When it finishes: "Agent run ended …". Open **Review…**: the dialog title is read;
    **Accept changes** is reachable by `Tab`.
13. **Settings.** `Ctrl` + `,`. The section list and its links are read; the theme radios say which
    is checked. Change density to Compact: nothing is cut off.
14. **High contrast.** Turn on a Windows contrast theme (Settings › Accessibility › Contrast themes),
    then turn it off again afterwards. The selected sidebar link, the selected task and the
    selected Library item each have an outline; focus is always visible; progress bars have an
    outline. In the Calendar, a day off has a dashed edge (Month and Year) and hours outside the
    working hours are hatched (Week); the Budget card's bar shows paid and planned; dragging a row
    in My day or a task's subtasks shows where it will land.
15. **Whiteboards.** In the Plan, open **Whiteboards** and a board that has a note, a shape and a
    mind map. `Tab` into the board: the first object in reading order (or the selected one) is read
    by its kind and words, such as "Note: Call the venue", and as pressed (selected); `Tab` and
    `Shift` + `Tab` move through the objects. Select a mind-map idea and use the arrow keys: each
    idea is read with its place ("Idea: Venue, level 1, 1 of 2"), and at an end the reason is
    said ("Last idea on this branch"). Press `N`, then `Enter`: "Note added" is announced and the
    note's text box ("Note text") is read. `Escape` (or `Ctrl` + `Enter`) puts focus back on the
    note. **Skip past the whiteboard** moves on past the board. In the Library, select the
    whiteboard: its preview is read as "Preview of …, image", and **Open whiteboard** opens it in
    the Plan.
16. **Zoom.** `Ctrl` + `=` five times (200%) in a small window: every page can still be used, and
    `Ctrl` + `0` returns to 100%. Restart: the zoom is kept.

## Known gaps

- **List column widths** are changed by dragging a column edge or with `Alt` + `Shift` and the
  arrow keys; there is no single-pointer way yet (WCAG 2.5.7).
- **Monaco** (the Files view's editor) has its own keyboard and screen-reader model; `Ctrl` + `M`
  toggles whether `Tab` moves focus out of it.
- **Charts** are images to a screen reader beyond their summary sentence; **Show as table** gives
  the same numbers as a table.
- **Errors in forms and pages** are read at once (`role="alert"`) rather than politely, so they
  can interrupt.
- **Toasts** sit in the bottom-right corner above the status bar and can cover part of a control
  there for their six seconds. They never take focus, and hovering or focusing one keeps it.
- **Typing `[[` for a link** in a description, comment or note shows its picker under the text
  field, which says the highlighted option (`aria-activedescendant`) but is not a full combobox,
  so a screen reader does not say the list opened.
- **Popovers** (an event's or a time block's card) are not modal: they close on
  `Escape`, a click outside or `Tab` past either end, but `Tab` from the button that opened one
  goes on through the page rather than into it; focus moves into it only when it opens.
- **Whiteboard drawing** with the pen, the marker and the eraser needs a pointer. Shapes,
  connectors (**Connect to…**), text and mind maps are the keyboard way to the same picture.
- **A whiteboard to a screen reader** is its objects, each with a spoken name, and in the Library
  a preview read as one image; the drawing's look (positions, sizes, colours, freehand strokes) is
  not described. The board's outline, which Ostler AI and search read, is not shown in the
  Library's preview.
- **Mind-map branches** are placed by their map's layout; they cannot be placed by hand.
- **Screen readers** have not yet been checked by a person (the checklist above).

## Reporting a problem

Choose **Help** › **Report a problem…** in Ostler, or open an issue on the project's GitHub. Say what
you were trying to do, which assistive technology and version you use (Narrator, NVDA, JAWS,
Windows contrast theme, zoom level), and what happened. Accessibility problems are treated as bugs.
