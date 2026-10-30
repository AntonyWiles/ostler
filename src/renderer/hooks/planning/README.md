# Planning workspace hooks

`usePlanningWorkspace` (one level up) is a facade. It calls the hooks below in the order listed,
spreads their members into the one `ws` object every planning view receives, and leaves out each
hook's `internal` group (setters shared only between sibling hooks). Views never import these hooks
directly.

A hook may depend only on hooks above it in this table. That order is also the order their effects
run in.

| Hook                      | Owns                                                                                                                                                                               | May depend on                                              |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `usePlanningRunner`       | `busy`, `error`, the busy subject, and `runBusy`/`runWith`: the shape every mutating action shares                                                                                 | nothing                                                    |
| `usePlanningRecords`      | Loading and refreshing goals, milestones, work items, decisions, presets, WIP limits, metrics, harness state, open blockers and the library markers. The push-event routing below. | runner's `setError`                                        |
| `usePlanningSelectors`    | Read-only lookups and rules bound to the records: names by id, `projectedStatus`, dependencies, `isQueueable`, the Today lists                                                     | records                                                    |
| `useWorkItemDrawer`       | The open work item, its edit form, saving it, and the AI improve/re-draft pass                                                                                                     | runner, records, selectors                                 |
| `usePlanningCreateForm`   | The create dialog's mode and fields (state only)                                                                                                                                   | nothing                                                    |
| `usePlanningAiDrafts`     | Goal breakdown, the project brief and its recommendations, decision drafts, the agent-plan wizard's starting point                                                                 | runner, records, create form, drawer                       |
| `useWorkItemActions`      | Create (any record, from the create form), move, bulk update, edit in place, quick add, reschedule (Calendar and Timeline, with undo), subtasks, delete, archive, assign milestone | runner, records, selectors, drawer, create form, AI drafts |
| `useBoardInteraction`     | Drag and drop, the Board's filters (`useTaskFilters`), grouping, sorting, lanes, presets, WIP limits, and the filtered columns                                                     | runner, records, selectors, work item actions              |
| `useAgentQueue`           | Harness queue state, queueing and starting work, sessions, questions, transcripts, session review (merge, commit, reject, discard)                                                 | runner, records, selectors, drawer                         |
| `useAutoDispatchSettings` | The project's auto-dispatch toggles shown in the toolbar                                                                                                                           | runner, records                                            |
| `useGoalsMilestones`      | Editing goals and milestones in place                                                                                                                                              | runner, records                                            |
| `useDecisions`            | Opening the decision create form, editing and deleting decisions                                                                                                                   | runner, records, create form                               |
| `useIterations`           | Creating, editing, starting, finishing and deleting iterations (R6.1)                                                                                                              | runner, records                                            |

`useTaskFilters` (one level up) is the toolbar filter state every task view uses: the Board through
`useBoardInteraction`, the List directly. Its rule is `matchesBoardFilter`.

`useAiNextTasks` is separate: the project workspace (`views/workspace/ProjectWorkspace.tsx`) runs it directly, not through `ws`.

## Rules live in `src/shared/planning/`

Anything that decides an answer (which column, which dependencies are unmet, where an item sits in
the queue, what its label says, how the board filters and sorts) is a pure function in
`src/shared/planning/` or `src/shared/work-item-status.ts`, with its own tests in
`tests/unit/planning-rules.test.ts`. The hooks bind those rules to state; they do not reimplement
them. Main uses the same functions where it answers the same question.

## Refreshes

`usePlanningRecords` subscribes to `onProjectStateChange` once and ignores other projects:

| Field                    | Reloads                                                                                    |
| ------------------------ | ------------------------------------------------------------------------------------------ |
| `harness`                | Nothing: the push carries the state. Records only if the queue names work the board lacks. |
| `planning`, `taskReview` | The planning records, without the harness state                                            |
| `library`                | The changed-source markers and attachment counts                                           |

Pushes of the same kind within 100 ms load once, and what is on screen stays until the new data
replaces it. A 60-second poll is the safety net, not the mechanism.
