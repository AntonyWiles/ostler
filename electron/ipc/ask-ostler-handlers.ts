import { IPC_CHANNELS } from '@shared/ostler-api'
import type { AskOstlerProgress, AskTurn, OstlerConfig } from '@shared/ostler-api'
import { Refusal } from '@shared/refusal'
import type { PlanningService } from '../services/planning-service'
import type { LibraryAiReader } from '../services/library-ai-parts'
import type { PeopleService } from '../services/people-service'
import { ASK_QUESTION_MAX_CHARS, AskOstlerService } from '../services/ask-ostler-service'
import { projectFolderRef } from '../services/project-files'
import { handleApi } from './handle-ipc'

export interface AskOstlerHandlerDependencies {
  getConfig(): OstlerConfig
  planningService: PlanningService
  libraryService: Pick<LibraryAiReader, 'aiVisibleItem'>
  peopleService: Pick<PeopleService, 'get'>
  sendToRenderer(channel: string, payload: unknown): void
}

/** The most earlier turns accepted from the renderer; the service sends fewer (`boundAskHistory`). */
const MAX_EARLIER_TURNS = 50

/** A follow-up's earlier turns, checked: strings only, a bounded list. */
function earlierTurns(options: unknown): AskTurn[] {
  if (!options || typeof options !== 'object') return []
  const earlier = (options as { earlier?: unknown }).earlier
  if (earlier === undefined) return []
  if (!Array.isArray(earlier) || earlier.length > MAX_EARLIER_TURNS)
    throw new Refusal('Invalid conversation')
  return earlier.map((turn: unknown) => {
    const { question, answer } = (turn ?? {}) as { question?: unknown; answer?: unknown }
    if (typeof question !== 'string' || typeof answer !== 'string')
      throw new Refusal('Invalid conversation')
    return { question: question.slice(0, ASK_QUESTION_MAX_CHARS), answer }
  })
}

/** An ask's id: the renderer makes it, so it is checked like any id. */
const ASK_ID = /^[\w-]{1,80}$/

/**
 * Ask Ostler (N8.3a). Ostler AI only answers here: it reads through the same
 * gates as the rest of Ostler AI (`requireAi`, `aiReadableProjects`,
 * `aiVisibleItem`, `project-files.ts`) and changes nothing.
 */
export function registerAskOstlerHandlers({
  getConfig,
  planningService,
  libraryService,
  peopleService,
  sendToRenderer
}: AskOstlerHandlerDependencies): void {
  const service = new AskOstlerService({
    getConfig,
    search: (query, options) => planningService.search.search(query, options),
    records: planningService,
    getContact: (contactId) => planningService.contacts.get(contactId),
    aiVisibleItem: (projectId, itemId) => libraryService.aiVisibleItem(projectId, itemId),
    personName: (personId) => {
      try {
        return peopleService.get(personId).name
      } catch {
        return null
      }
    },
    getFolder: (project) => projectFolderRef(project),
    emitProgress: (progress: AskOstlerProgress) =>
      sendToRenderer(IPC_CHANNELS.ON_ASK_OSTLER_PROGRESS, progress)
  })

  handleApi('askOstler', async (_event, askId: unknown, question: unknown, options: unknown) => {
    if (typeof askId !== 'string' || !ASK_ID.test(askId)) throw new Refusal('Invalid ask')
    if (typeof question !== 'string') throw new Refusal('Ask a question')
    const searchFiles =
      Boolean(options) &&
      typeof options === 'object' &&
      (options as { searchFiles?: unknown }).searchFiles === true
    return service.ask(askId, question, { searchFiles, earlier: earlierTurns(options) })
  })
  handleApi('cancelAskOstler', async (_event, askId: unknown) => {
    if (typeof askId !== 'string' || !ASK_ID.test(askId)) throw new Refusal('Invalid ask')
    service.cancel(askId)
    return undefined
  })
}
