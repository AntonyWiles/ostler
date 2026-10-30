import type { SearchEntityType } from './search-types'

// ─── Ask Ostler (N8.3a) ──────────────────────────────────────────────────────

/** What a source is: a record Ostler's search found, or a passage of a project file. */
export type AskSourceType = SearchEntityType | 'file'

/** One numbered source an answer may cite as [n]. */
export interface AskSource {
  /** 1-based; the number the answer cites. */
  number: number
  type: AskSourceType
  projectId: string
  /** The record's id; for a file, its path. */
  id: string
  /** The record's title; for a comment, its task's title; for a file, its path. */
  title: string
  /** The task a task or comment opens in. */
  workItemId: string | null
  /** Files only: the path inside the project's folder, and the passage's lines (1-based). */
  path?: string
  startLine?: number
  endLine?: number
}

/** An earlier question and its answer in the same open conversation (N8.3b): text only. */
export interface AskTurn {
  question: string
  answer: string
}

export interface AskOstlerOptions {
  /** Also search the text files in each enabled project's linked folder. */
  searchFiles: boolean
  /**
   * The open conversation's earlier turns, oldest first (N8.3b). Only their
   * questions and answers are sent, never their sources' text, and only the
   * latest few (`boundAskHistory`).
   */
  earlier?: AskTurn[]
}

export interface AskOstlerAnswer {
  askId: string
  /** Markdown, citing sources as [n]; citations to numbers with no source are removed. */
  answer: string
  sources: AskSource[]
  /** Some sources were shortened, or left out, to keep the request small. */
  sourcesCut: boolean
  /** A project's file search stopped at its file or time limit. */
  filesCutShort: boolean
  /** Older turns of the conversation were left out, or shortened, to keep the request small. */
  earlierLeftOut: boolean
}

/** Where an ask has got to, for the panel's progress line. */
export type AskOstlerStage = 'queries' | 'searching' | 'files' | 'writing'

export interface AskOstlerProgress {
  askId: string
  stage: AskOstlerStage
  /** How many projects are being searched. */
  projectCount: number
}
