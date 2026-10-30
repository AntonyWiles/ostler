// ─── Since you were last here (N1.6, N14) ───────────────────────────────────

/** How many titles a briefing group lists before "and 214 more". */
export const BRIEFING_TITLES = 5

/** Who did something, as the briefing counts it. */
export type BriefingActorKind =
  'person' | 'agent' | 'rule' | 'import' | 'automation' | 'ostler-ai' | 'system'

/** A task, or a run, the briefing names. `id` is the task's, or null when there is none. */
export interface BriefingTask {
  id: string | null
  title: string
}

/** A count and its first titles (at most `BRIEFING_TITLES`). */
export interface BriefingList {
  count: number
  tasks: BriefingTask[]
}

/** Tasks one actor finished or added. `name` is the person's or rule's name, else null. */
export interface BriefingByActor extends BriefingList {
  actor: BriefingActorKind
  name: string | null
}

/** One project's part of the briefing. Every list may be empty; a project with nothing is left out. */
export interface BriefingProject {
  projectId: string
  projectName: string
  projectColor: string
  finished: BriefingByActor[]
  added: BriefingByActor[]
  /** `count` is comments; `tasks` the tasks they were on. */
  comments: BriefingList
  /** Due dates that passed while away, still open. */
  overdue: BriefingList
  /** Reminders that fired. */
  reminders: BriefingList
  /** Agent runs that ended. */
  runsFinished: BriefingList
  /** Runs waiting for review now. */
  runsInReview: BriefingList
  /** Agent questions waiting for an answer now (counted only: their text stays out). */
  questions: number
}

/** What happened from `since` to `until`, across the enabled projects. */
export interface Briefing {
  since: number
  until: number
  projects: BriefingProject[]
}

/** Ostler AI's paragraph about a briefing (Write it up). */
export interface BriefingWriteUp {
  text: string
  model: string
  at: number
}
