// ─── The Team view's data (team-leaders plan, D4) ───────────────────────────

/** What the Team view asks for (`getTeamOverview`). */
export interface TeamOverviewQuery {
  /** The renderer's local date, `YYYY-MM-DD`. */
  today: string
  /** Only the people in this team; leave out for everyone with work. */
  teamId?: string | null
  /** Only these projects' tasks; null or absent for every enabled project. */
  projectIds?: string[]
}

/** One person's row: their work across every project in scope, in one call. */
export interface TeamOverviewRow {
  personId: string
  /** Open tasks assigned. */
  open: number
  /** Open tasks with a due date before today. */
  overdue: number
  /** Open tasks due in today's week (Monday to Sunday), overdue ones from earlier in it included. */
  dueThisWeek: number
  /** Open tasks with an open blocker. */
  blocked: number
  /** Open tasks of theirs that wait for someone's sign-off. */
  waitingForSignOff: number
  /** Started tasks (not Backlog or Ready) not changed for seven days. */
  stalled: number
  /** Hours of finished time entries this week, in all projects. */
  hoursThisWeek: number
  /** Hours they can plan this week, days off taken out, or null without a capacity. */
  capacityThisWeek: number | null
  /** Away spans that have not ended and start within the next 14 days. */
  awayDays: { firstDate: string; lastDate: string }[]
  /** When they last changed or commented on a task, or null. */
  lastActiveAt: number | null
  /** Projects where they have open tasks. */
  projectIds: string[]
}
