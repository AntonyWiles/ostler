# Accessibility

Ostler is built to work with a keyboard alone, with a screen reader, with Windows high contrast, at
large sizes and with less motion. It aims for WCAG 2.2 level AA.

## Keyboard

- Everything can be done without a mouse. `Tab` and `Shift` + `Tab` move between controls, and
  the arrow keys move inside lists, grids, menus and tabs. Press `?` for every shortcut.
- The first `Tab` stop is **Skip to content**: it jumps past the sidebar to the page's heading.
- When you open a page, the cursor moves to its heading. Closing a dialog or the task drawer puts
  it back where you were.
- On the Board, `J` and `K` move between tasks and `Enter` opens one. Every card has a menu
  (`Shift` + `F10`, or its **More actions** button) with **Move to**, so nothing needs a drag.
- In the Calendar and the Timeline, `Alt` and the arrow keys move a task's dates; in the task
  drawer you can type them.
- Reorder projects in the sidebar with `Alt` + `Up` and `Alt` + `Down`, or **Move up** and
  **Move down** in a project's menu.

## Seeing the screen

- **Zoom:** `Ctrl` + `=` makes everything bigger, `Ctrl` + `-` smaller and `Ctrl` + `0` puts it
  back. Ostler remembers your zoom. Every page still works at 200%.
- **Density:** Settings › General › **Compact** fits more on screen; **Comfortable** is larger.
- **High contrast:** Ostler follows Windows' contrast themes. Selected items get an outline, since
  high contrast removes background colours; days off have a dashed edge, hours outside your
  working hours are hatched, and charts and project colours keep their colours.
- **Colour:** nothing is shown by colour alone. Statuses, priorities and overdue dates have icons
  or words, and every chart has **Show as table**.
- **Less motion:** with Windows' **Show animations** turned off, Ostler doesn't animate.

## Screen readers

Ostler works with Narrator and NVDA. Pages, dialogs, menus and lists have names, and Ostler says what
changed: the page you opened, a saved task, an agent run starting or finishing, and every message
that pops up in the corner, with the buttons it offers.

In menus, an item that can be ticked, such as **Reopen at start** in a window's menu, is read as
checked or not checked, and a choice of one, such as the views in the **Views** menu, as the one
that is selected.

For dates, use the Calendar's **Agenda**: a list of days, each a heading followed by its milestones
and tasks, so your screen reader's heading keys move day to day. A grid of days is harder to follow
by ear. In **Year**, each day says its date and how many tasks and milestones it has.

## Something doesn't work for you

Please tell us: choose **Help** › **Report a problem…** and say what you were trying to do, with
which assistive technology. See [Troubleshooting](17-troubleshooting.md).
