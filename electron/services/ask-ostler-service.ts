import type {
  AskOstlerAnswer,
  AskOstlerOptions,
  AskOstlerProgress,
  AskOstlerStage,
  AskSource,
  LibraryItem,
  OstlerConfig,
  PlanningComment,
  PlanningDecision,
  PlanningFieldDefinition,
  PlanningGoal,
  PlanningMilestone,
  PlanningWorkItem,
  SearchOptions,
  SearchResult,
  WatchedProject
} from '@shared/ostler-api'
import type { Contact } from '@shared/contacts'
import {
  ASK_OSTLER_ANSWER_SYSTEM_PROMPT,
  ASK_OSTLER_QUERY_SYSTEM_PROMPT,
  buildAskOstlerAnswerPrompt,
  buildAskOstlerQueryPrompt
} from '@shared/ostler-ai-prompts'
import { boundAskHistory, removeUnknownCitations } from '@shared/ask-ostler'
import { fieldValueText } from '@shared/planning/custom-fields'
import { toIsoDate, todayIsoDate } from '@shared/dates'
import { Refusal } from '@shared/refusal'
import { t } from '@shared/i18n'
import type { AIChatMessage, AIProviderInterface } from './ai-provider'
import { aiReadableProjects, requireAi } from './ai-access'
import { projectFileBudgetChars, type ProjectFolderRef } from './project-files'
import { searchFolderFiles, type FilePassage, type FolderSearchResult } from './ask-ostler-files'
import {
  ASK_RECORD_TYPES,
  ASK_TOTAL_CHARS,
  fallbackQueries,
  fileHit,
  formatAskSources,
  mergeHits,
  parseAskQueries,
  recordHit,
  type AskHit,
  type AskSourceText
} from './ask-ostler-sources'

/** The longest question accepted. */
export const ASK_QUESTION_MAX_CHARS = 2000
/** Enough for four short queries. */
const QUERY_MAX_TOKENS = 300
/** Results taken from each query in each project, before merging. */
const RESULTS_PER_QUERY = 20

/** What Ask Ostler reads of the planning records: read-only, by id. */
export interface AskRecordReader {
  getWorkItem(id: string): PlanningWorkItem
  getComment(id: string): PlanningComment
  getGoal(id: string): PlanningGoal
  listMilestones(projectId: string): PlanningMilestone[]
  getDecision(id: string): PlanningDecision
  listFields(projectId: string): PlanningFieldDefinition[]
}

export interface AskOstlerDependencies {
  getConfig(): OstlerConfig
  /** Ostler's own search (`SearchService.search`). */
  search(query: string, options: SearchOptions): SearchResult[]
  records: AskRecordReader
  /** A contact (N6.5), by id; contacts belong to no project. Without it, no contact is searched. */
  getContact?(contactId: string): Contact
  /** The Library's one AI gate: null for Human only, archived or missing items. */
  aiVisibleItem(projectId: string, itemId: string): LibraryItem | null
  /** A person's name, for a comment's author. */
  personName?(personId: string): string | null
  /** The project's linked folder, or null when it has none. */
  getFolder(project: WatchedProject): ProjectFolderRef | null
  emitProgress(progress: AskOstlerProgress): void
  /** For tests. */
  searchFolder?: typeof searchFolderFiles
  today?: () => string
}

/**
 * Ask Ostler (N8.3a): a question answered from what Ostler's own search finds
 * across every enabled project, and, when asked, passages of the text files
 * in their folders. Two Ostler AI requests, both through `requireAi`: the
 * first sends only the question and today's date and returns search queries;
 * the second sends the question and the numbered sources' listed fields.
 * Searching happens here, locally. Nothing is stored, and nothing changes.
 */
export class AskOstlerService {
  private readonly running = new Map<string, { cancelled: boolean }>()

  constructor(private readonly deps: AskOstlerDependencies) {}

  /** Stops an ask: the request in flight is dropped at its next chunk, and the ask fails as stopped. */
  cancel(askId: string): void {
    const state = this.running.get(askId)
    if (state) state.cancelled = true
  }

  async ask(askId: string, question: string, options: AskOstlerOptions): Promise<AskOstlerAnswer> {
    const asked = question.trim()
    if (!asked) throw new Refusal(t('errors:askOstler.askSomething'))
    if (asked.length > ASK_QUESTION_MAX_CHARS) throw new Refusal(t('errors:askOstler.tooLong'))
    const config = this.deps.getConfig()
    const { provider, model } = requireAi(config, null)
    const projects = aiReadableProjects(config)
    const state = { cancelled: false }
    this.running.set(askId, state)
    const progress = (stage: AskOstlerStage) =>
      this.deps.emitProgress({ askId, stage, projectCount: projects.length })
    const stopIfCancelled = () => {
      if (state.cancelled) throw new Refusal(t('errors:askOstler.stopped'))
    }
    const today = this.deps.today?.() ?? todayIsoDate()
    // A follow-up (N8.3b): the open conversation's latest turns, text only.
    const history = boundAskHistory(options.earlier ?? [])
    try {
      progress('queries')
      let queries: string[] = []
      try {
        queries = parseAskQueries(
          await this.complete(
            provider,
            model,
            [
              { role: 'system', content: ASK_OSTLER_QUERY_SYSTEM_PROMPT },
              {
                role: 'user',
                content: buildAskOstlerQueryPrompt({
                  question: asked,
                  today,
                  earlierQuestions: history.turns.map((turn) => turn.question)
                })
              }
            ],
            QUERY_MAX_TOKENS,
            state
          )
        )
      } catch (error) {
        stopIfCancelled()
        // A failed query step is not the end: the fallback searches the question's words.
        console.warn('Ask Ostler: the query step failed; searching the question instead.', error)
      }
      stopIfCancelled()

      let found = await this.find(projects, queries, options, progress, state)
      if (found.hits.length === 0) {
        const fallback = fallbackQueries(asked)
        if (fallback.length > 0)
          found = await this.find(projects, fallback, options, progress, state)
      }
      stopIfCancelled()

      const names = new Map(projects.map((project) => [project.id, project.name]))
      const described = mergeHits(found.hits)
        .map((hit) => ({ hit, text: this.describe(hit, names.get(this.projectOf(hit)) ?? '') }))
        .filter((entry): entry is { hit: AskHit; text: AskSourceText } => entry.text !== null)
      const budget = Math.min(ASK_TOTAL_CHARS, projectFileBudgetChars(config.ai.contextTokens))
      const formatted = formatAskSources(
        described.map((entry) => entry.text),
        { total: budget }
      )
      const sent = described.slice(0, formatted.count)
      const sources = sent.map((entry, index) => toAskSource(entry.hit, index + 1))

      progress('writing')
      const reply = await this.complete(
        provider,
        model,
        [
          { role: 'system', content: ASK_OSTLER_ANSWER_SYSTEM_PROMPT },
          {
            role: 'user',
            content: buildAskOstlerAnswerPrompt({
              question: asked,
              today,
              sources: formatted.text,
              sourcesCut: formatted.cut,
              earlier: history.turns,
              earlierLeftOut: history.leftOut
            })
          }
        ],
        config.ai.maxTokens ?? 4096,
        state
      )
      stopIfCancelled()
      return {
        askId,
        answer: removeUnknownCitations(reply, sources.length),
        sources,
        sourcesCut: formatted.cut,
        filesCutShort: found.filesCutShort,
        earlierLeftOut: history.leftOut
      }
    } finally {
      this.running.delete(askId)
    }
  }

  /** One request's whole reply; stops reading as soon as the ask is stopped. */
  private async complete(
    provider: AIProviderInterface,
    model: string,
    messages: AIChatMessage[],
    maxTokens: number,
    state: { cancelled: boolean }
  ): Promise<string> {
    let reply = ''
    for await (const chunk of provider.chat(messages, {
      model,
      maxTokens,
      temperature: 0.2,
      stream: true
    })) {
      if (state.cancelled) break
      reply += chunk
    }
    return reply.trim()
  }

  /**
   * The records and passages the queries find in the projects Ostler AI
   * reads: live records only, Library items only when the Library's gate
   * lets Ostler AI see them, files only when asked, and the contacts that match.
   */
  private async find(
    projects: WatchedProject[],
    queries: string[],
    options: AskOstlerOptions,
    progress: (stage: AskOstlerStage) => void,
    state: { cancelled: boolean }
  ): Promise<{ hits: AskHit[]; filesCutShort: boolean }> {
    if (queries.length === 0) return { hits: [], filesCutShort: false }
    progress('searching')
    const hits: AskHit[] = []
    for (const project of projects) {
      for (const query of queries) {
        const results = this.deps.search(query, {
          projectId: project.id,
          types: [...ASK_RECORD_TYPES],
          limit: RESULTS_PER_QUERY,
          includeArchived: false
        })
        for (const result of results) {
          if (result.projectId !== project.id) continue
          if (result.type === 'library' && !this.deps.aiVisibleItem(project.id, result.id)) continue
          hits.push(recordHit(result))
        }
      }
    }
    // Contacts belong to no project: searched once, across the whole list.
    if (this.deps.getContact) {
      for (const query of queries) {
        for (const result of this.deps.search(query, {
          types: ['contact'],
          limit: RESULTS_PER_QUERY,
          includeArchived: false
        })) {
          if (result.type === 'contact') hits.push(recordHit(result))
        }
      }
    }
    let filesCutShort = false
    if (options.searchFiles) {
      progress('files')
      const searchFolder = this.deps.searchFolder ?? searchFolderFiles
      for (const project of projects) {
        if (state.cancelled) break
        const folder = this.deps.getFolder(project)
        if (!folder) continue
        let result: FolderSearchResult
        try {
          result = await searchFolder(project.id, folder, queries)
        } catch {
          continue
        }
        filesCutShort ||= result.cutShort
        hits.push(...result.passages.map((passage: FilePassage) => fileHit(passage)))
      }
    }
    return { hits, filesCutShort }
  }

  private projectOf(hit: AskHit): string {
    return hit.kind === 'record' ? hit.record.projectId : hit.passage.projectId
  }

  /** A source's listed fields, and nothing else; null when it can no longer be read. */
  private describe(hit: AskHit, projectName: string): AskSourceText | null {
    if (hit.kind === 'file') {
      const { path, startLine, endLine, text } = hit.passage
      return {
        type: 'file',
        projectName,
        heading: `File ${path}, lines ${startLine} to ${endLine}`,
        body: text
      }
    }
    const record = hit.record
    const { records } = this.deps
    try {
      switch (record.type) {
        case 'task': {
          const item = records.getWorkItem(record.id)
          if (item.archivedAt || item.deletedAt) return null
          return {
            type: 'task',
            projectName,
            heading: `Task: ${item.title}`,
            body: lines([
              item.description,
              ...item.acceptanceCriteria.map(
                (entry) => `- [${item.checkedCriteria.includes(entry) ? 'x' : ' '}] ${entry}`
              ),
              ...this.fieldLines(item)
            ])
          }
        }
        case 'contact': {
          if (!this.deps.getContact) return null
          const contact = this.deps.getContact(record.id)
          return {
            type: 'contact',
            projectName,
            heading: `Contact: ${contact.name}`,
            body: lines([
              contact.organisation && `Organisation: ${contact.organisation}`,
              contact.role && `Role: ${contact.role}`,
              ...contact.phones.map(
                (phone) => `Phone${phone.label ? ` (${phone.label})` : ''}: ${phone.number}`
              ),
              ...contact.emails.map((email) => `Email: ${email}`),
              contact.website && `Website: ${contact.website}`,
              contact.address && `Address: ${contact.address}`,
              contact.notes && `Notes: ${contact.notes}`
            ])
          }
        }
        case 'comment': {
          const comment = records.getComment(record.id)
          if (comment.deletedAt) return null
          const task = records.getWorkItem(comment.workItemId)
          const author =
            (comment.authorPersonId && this.deps.personName?.(comment.authorPersonId)) ||
            comment.authorKind
          return {
            type: 'comment',
            projectName,
            heading: `Comment on the task "${task.title}" by ${author}, ${dateOf(comment.createdAt)}`,
            body: comment.body
          }
        }
        case 'goal': {
          const goal = records.getGoal(record.id)
          return {
            type: 'goal',
            projectName,
            heading: `Goal: ${goal.title}`,
            body: lines([
              goal.outcome && `Outcome: ${goal.outcome}`,
              `Status: ${goal.status}`,
              `Created ${dateOf(goal.createdAt)}, last changed ${dateOf(goal.updatedAt)}`
            ])
          }
        }
        case 'milestone': {
          const milestone = records
            .listMilestones(record.projectId)
            .find((entry) => entry.id === record.id)
          if (!milestone) return null
          return {
            type: 'milestone',
            projectName,
            heading: `Milestone: ${milestone.name}`,
            body: lines([
              milestone.outcome && `Outcome: ${milestone.outcome}`,
              milestone.targetDate && `Target date: ${milestone.targetDate}`,
              ...milestone.successCriteria.map((entry) => `- ${entry}`),
              `Status: ${milestone.status}`
            ])
          }
        }
        case 'decision': {
          const decision = records.getDecision(record.id)
          return {
            type: 'decision',
            projectName,
            heading: `Decision: ${decision.title} (${decision.date})`,
            body: lines([
              decision.context && `Context: ${decision.context}`,
              `Decision: ${decision.decision}`,
              decision.alternativesConsidered &&
                `Alternatives considered: ${decision.alternativesConsidered}`,
              decision.consequences && `Consequences: ${decision.consequences}`
            ])
          }
        }
        case 'library': {
          // The one gate again: an item made Human only since the search is not sent.
          const item = this.deps.aiVisibleItem(record.projectId, record.id)
          if (!item) return null
          return {
            type: 'library',
            projectName,
            heading: `Library ${item.kind}: ${item.title}`,
            body: lines([item.summary && `Summary: ${item.summary}`, item.body])
          }
        }
      }
    } catch {
      return null
    }
  }

  /** A task's custom field values, as their names and the words a card shows. */
  private fieldLines(item: PlanningWorkItem): string[] {
    const values = item.fieldValues ?? {}
    if (Object.keys(values).length === 0) return []
    return this.deps.records
      .listFields(item.projectId)
      .map((field) => ({ field, text: fieldValueText(field, values[field.id]) }))
      .filter((entry) => entry.text !== '')
      .map((entry) => `${entry.field.name}: ${entry.text}`)
  }
}

function lines(parts: (string | null | undefined | false)[]): string {
  return parts.filter((part): part is string => Boolean(part && part.trim())).join('\n')
}

/** The person's own calendar day, the same day `todayIsoDate` calls today. */
function dateOf(timestamp: number): string {
  return toIsoDate(new Date(timestamp))
}

function toAskSource(hit: AskHit, number: number): AskSource {
  if (hit.kind === 'file') {
    const { projectId, path, startLine, endLine } = hit.passage
    return {
      number,
      type: 'file',
      projectId,
      id: path,
      title: path,
      workItemId: null,
      path,
      startLine,
      endLine
    }
  }
  const { type, projectId, id, title, workItemId } = hit.record
  return { number, type, projectId, id, title, workItemId }
}
