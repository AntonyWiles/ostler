import { createHash, randomUUID } from 'node:crypto'
import type {
  AIDraftSource,
  AIDecisionDraft,
  AILibraryGoalProposal,
  AIMasterPlanDraft,
  AIMilestoneAction,
  AIMilestoneAdvisory,
  AIMilestoneRecommendation,
  AINextTasksDraft,
  AINextTasksEvidenceSummary,
  AIPlanningDraft,
  AIPlanningSuggestion,
  AIPlanTaskNode,
  AIProjectBrief,
  AIProjectBriefAction,
  AITaskSplitDraft,
  AIWorkItemImprovement,
  OstlerConfig,
  PlanningGoal,
  PlanningPriority,
  PlanningVerificationStatus,
  PlanningWorkItem,
  TaskStatusReviewDraft,
  TaskStatusReviewItem
} from '@shared/ostler-api'
import {
  buildDecisionDraftUserPrompt,
  buildGoalBreakdownUserPrompt,
  buildLibraryGoalProposalUserPrompt,
  buildKnowledgeRewriteUserPrompt,
  buildMasterPlanUserPrompt,
  buildMilestoneAdvisoryUserPrompt,
  buildNextTasksUserPrompt,
  buildProjectBriefUserPrompt,
  buildRecommendationRevisionUserPrompt,
  buildTaskSplitUserPrompt,
  buildTaskStatusReviewUserPrompt,
  buildTasksFromTextUserPrompt,
  buildWorkItemImprovementUserPrompt,
  OSTLER_AI_COORDINATION_SYSTEM_PROMPT,
  OSTLER_AI_KNOWLEDGE_REWRITE_SYSTEM_PROMPT,
  OSTLER_AI_PLANNING_SYSTEM_PROMPT,
  OSTLER_AI_RECOMMENDATION_REVISION_SYSTEM_PROMPT,
  OSTLER_AI_REVIEW_ONLY_SYSTEM_PROMPT,
  OSTLER_AI_TASKS_FROM_TEXT_SYSTEM_PROMPT,
  OSTLER_AI_NOTE_ACTIONS_SYSTEM_PROMPT,
  buildNoteActionsUserPrompt,
  OSTLER_AI_FILTER_FROM_WORDS_SYSTEM_PROMPT,
  buildFilterFromWordsUserPrompt,
  buildImproveWritingUserPrompt,
  buildCommentSummaryUserPrompt,
  OSTLER_AI_IMPROVE_WRITING_SYSTEM_PROMPT,
  OSTLER_AI_COMMENT_SUMMARY_SYSTEM_PROMPT,
  OSTLER_AI_RELEASE_NOTES_SYSTEM_PROMPT,
  buildReleaseNotesUserPrompt,
  LIBRARY_PLANNING_CONTEXT_BUDGET_CHARS,
  PROMPT_VERSIONS,
  visionEnabled
} from '@shared/ostler-api'
import type { AiProfile } from '@shared/ai-profile'
import {
  chatWithImageFallback,
  isImageRefusal,
  type AIContentPart,
  type AIProviderInterface
} from './ai-provider'
import { readTextTaskSuggestions, type TasksFromTextDraft } from '@shared/tasks-from-text'
import {
  capVocabulary,
  readFilterAnswer,
  type FilterFromWordsResult,
  type FilterVocabulary
} from '@shared/filter-from-words'
import {
  NOTE_ACTIONS_MAX_CHARS,
  readNoteDecisions,
  type NoteActionsDraft
} from '@shared/note-actions'
import { AIStorageService } from './ai-storage-service'
import {
  contentWithImages,
  draftAttachmentIds,
  libraryContextHasContent,
  libraryContextItemIds,
  libraryImageParts,
  librarySources,
  type LibraryAiReader
} from './library-ai-parts'
import { requireAi } from './ai-access'
import { FriendlyAiError, unusableAnswer } from './ai-errors'
import {
  buildStatusUpdateUserPrompt,
  OSTLER_AI_STATUS_UPDATE_SYSTEM_PROMPT,
  type StatusUpdatePromptInput
} from '@shared/ostler-ai-prompts'
import { parseStatusDraftAnswer, type StatusUpdateDraft } from '@shared/status-updates'
import {
  buildProjectFileEvidence,
  projectFileBudgetChars,
  type ProjectFileEvidence,
  type ProjectFolderRef
} from './project-files'
import { t } from '@shared/i18n'
import { todayIsoDate } from '@shared/dates'
import {
  COMMENT_SUMMARY_MAX_COMMENTS,
  COMMENT_SUMMARY_MIN_COMMENTS,
  isWritingStyle,
  missingLinks,
  WRITING_HELP_MAX_CHARS,
  type CommentSummary,
  type ImprovedWriting,
  type WritingStyle
} from '@shared/writing-help'
import {
  missingTaskTitles,
  RELEASE_NOTES_POLISH_MAX_CHARS,
  type PolishedReleaseNotes,
  type ReleaseNotes
} from '@shared/release-notes'
import {
  readTriageSuggestion,
  triageSuggestionRequest,
  type TriageCandidate,
  type TriageSuggestion
} from '@shared/triage-suggestions'
import {
  buildAiFieldFillUserPrompt,
  buildTriageSuggestionUserPrompt,
  OSTLER_AI_FIELD_FILL_SYSTEM_PROMPT,
  OSTLER_AI_TRIAGE_SUGGESTION_SYSTEM_PROMPT
} from '@shared/ostler-ai-prompts'
import type { AiFieldSuggestion, PlanningFieldDefinition } from '@shared/ostler-api'
import { aiFieldRequest, aiFieldSourceHash, readAiFieldAnswer } from '@shared/planning/ai-fields'

/** A model's plain-text answer, without a code fence around it. */
function plainAnswer(response: string): string {
  return response
    .trim()
    .replace(/^```[a-z]*\s*\n/i, '')
    .replace(/\n?```$/, '')
    .trim()
}

function extractJsonObject(response: string): string {
  const stripped = response
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim()
  const start = stripped.indexOf('{')
  const end = stripped.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) return stripped
  return stripped.slice(start, end + 1)
}

/**
 * Stable hash of the evidence an advisory was built from, so a card can tell
 * "reviewed and nothing has changed" from "reviewed, but the work has moved on".
 */
/**
 * The one-click edit a milestone recommendation offers, or none. Every id must
 * be one the model was shown: a linked task for a criterion, a listed library
 * item for "include". Anything else is dropped rather than shown as a button
 * that would fail or touch the wrong record.
 */
export function milestoneAction(
  value: unknown,
  known: { workItemIds: Set<string>; libraryItems: Map<string, string> }
): AIMilestoneAction | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const text = (field: unknown, max: number) =>
    typeof field === 'string' ? field.trim().slice(0, max) : ''
  switch (raw.kind) {
    case 'add-task': {
      const title = text(raw.title, 200)
      return title ? { kind: 'add-task', title, description: text(raw.description, 4000) } : null
    }
    case 'add-success-criterion': {
      const criterion = text(raw.text, 500)
      return criterion ? { kind: 'add-success-criterion', text: criterion } : null
    }
    case 'add-acceptance-criterion': {
      const criterion = text(raw.text, 500)
      const workItemId = text(raw.workItemId, 200)
      return criterion && known.workItemIds.has(workItemId)
        ? { kind: 'add-acceptance-criterion', workItemId, text: criterion }
        : null
    }
    case 'include-library-item': {
      const itemId = text(raw.itemId, 200)
      const title = known.libraryItems.get(itemId)
      return title !== undefined ? { kind: 'include-library-item', itemId, title } : null
    }
    default:
      return null
  }
}

export function milestoneEvidenceFingerprint(evidence: unknown): string {
  return createHash('sha256').update(JSON.stringify(evidence)).digest('hex').slice(0, 32)
}

/**
 * A response that stops mid-object is a truncated answer, not a malformed one —
 * almost always the model hitting its output-token ceiling. Say so, because the
 * fix (raise Max tokens in AI settings) is nothing like the fix for bad JSON.
 */
function looksTruncated(json: string): boolean {
  if (!json.startsWith('{')) return false
  let depth = 0
  let inString = false
  let escaped = false
  for (const char of json) {
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === '{' || char === '[') depth += 1
    else if (char === '}' || char === ']') depth -= 1
  }
  return inString || depth > 0
}

/** What an AI answer was meant to be, for its errors: `errors:aiDraft.*.<kind>`. */
type DraftKind =
  | 'goalProposal'
  | 'planningDraft'
  | 'milestoneAdvisory'
  | 'nextTaskDraft'
  | 'decisionDraft'
  | 'masterPlan'
  | 'taskSplit'
  | 'taskStatusReview'
  | 'tasksFromText'
  | 'noteActions'
  | 'filterFromWords'

function parseDraft(response: string, kind: DraftKind): Record<string, unknown> {
  const json = extractJsonObject(response)
  try {
    return JSON.parse(json) as Record<string, unknown>
  } catch {
    if (looksTruncated(json)) {
      throw new Error(t(`errors:aiDraft.cutOff.${kind}`))
    }
    throw unusableAnswer(t(`errors:aiDraft.notJson.${kind}`))
  }
}

function planningPriority(value: unknown): PlanningPriority {
  return value === 'low' || value === 'high' || value === 'critical' ? value : 'medium'
}

/** Structured advisory planning only; deliberately has no harness dependency. */
export class AIPlanningService {
  private readonly storage: AIStorageService

  constructor(
    dataDir: string,
    private readonly getConfig: () => OstlerConfig,
    private readonly getLibrary: () => LibraryAiReader | null = () => null,
    /** The project's folder; the caller resolves the id to a registered watched project. */
    private readonly getProjectFolder: (projectId: string) => ProjectFolderRef | null = () => null,
    /** `projectAiProfile` for the project: whether its tasks are written for agents or people. */
    private readonly getProjectProfile: (projectId: string) => Promise<AiProfile> = async () =>
      'software'
  ) {
    this.storage = new AIStorageService(dataDir)
  }

  /**
   * One planning request with the project library attached: the library's
   * text after the prompt, its images after that, and the image fallback
   * applied. Returns which library items fed it and any vision warning.
   */
  private async chatWithLibrary(
    provider: AIProviderInterface,
    projectId: string,
    systemPrompt: string,
    prompt: string,
    options: { model: string; maxTokens: number; temperature: number },
    selectedItemIds: string[] = []
  ): Promise<{
    response: string
    sources: AIDraftSource[]
    warning: string | null
    /** Ids the context showed the model; the only ids a draft may attach. */
    contextIds: Set<string>
    /** Items the context named without their content, by id, with their titles. */
    listed: Map<string, string>
  }> {
    const config = this.getConfig()
    const library = this.getLibrary()
    // A planning action runs once and needs the guides whole: the larger budget.
    const context =
      library?.buildLibraryAiContext(projectId, {
        selectedItemIds,
        budgetChars: LIBRARY_PLANNING_CONTEXT_BUDGET_CHARS
      }) ?? null
    let content: string | AIContentPart[] = prompt
    let sources: AIDraftSource[] = []
    if (library && context && libraryContextHasContent(context)) {
      content = contentWithImages(
        `${prompt}\n\n${context.markdown}`,
        libraryImageParts(library, projectId, context)
      )
      sources = librarySources(library, projectId, context)
    }
    let warning: string | null = null
    let response = ''
    for await (const chunk of chatWithImageFallback(
      provider,
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content }
      ],
      { ...options, stream: true },
      {
        vision: visionEnabled(config.ai.vision),
        onWarning: (message) => {
          warning = message
        }
      }
    )) {
      response += chunk
    }
    return {
      response,
      sources,
      warning,
      contextIds: libraryContextItemIds(context),
      listed: new Map((context?.listed ?? []).map((entry) => [entry.id, entry.title]))
    }
  }

  /**
   * The project folder as evidence (`project-files.ts`): the file list, plus
   * the overview documents and the files `namedIn` texts mention when asked.
   * Nothing when the project has no folder or it cannot be read.
   */
  private async projectFiles(
    projectId: string,
    options: { overview?: boolean; namedIn?: string[] } = {}
  ): Promise<ProjectFileEvidence> {
    return buildProjectFileEvidence(this.getProjectFolder(projectId), {
      budgetChars: projectFileBudgetChars(this.getConfig().ai.contextTokens),
      ...options
    })
  }

  /**
   * Plan and split writes briefings for coding agents, so it is for software
   * projects only (P7.1); the desktop wizard is hidden for the rest.
   */
  private async assertSoftwareProject(projectId: string): Promise<void> {
    if ((await this.getProjectProfile(projectId)) !== 'software') {
      throw new Error(t('errors:aiPlanningService.planSplitWritesTasks'))
    }
  }

  /**
   * The gate, for work that calls the model later (a task split runs in the
   * background): refuses now, while the caller can still say so.
   */
  assertAiAvailable(projectId: string): void {
    requireAi(this.getConfig(), projectId)
  }

  /** A drafted task's attachments, kept only when they pass `draftAttachmentIds`. */
  private keepAttachments(projectId: string, contextIds: Set<string>, value: unknown): string[] {
    return draftAttachmentIds(this.getLibrary(), projectId, contextIds, value)
  }

  /**
   * "Plan work from these": proposes one goal from the selected library items.
   * Nothing is stored or created; the human confirms the goal themselves.
   */
  async proposeGoalFromLibrary(
    projectId: string,
    projectName: string,
    existingGoals: PlanningGoal[],
    selectedItemIds: string[]
  ): Promise<AILibraryGoalProposal> {
    const config = this.getConfig()
    const { provider, model } = requireAi(config, projectId)
    if (selectedItemIds.length === 0)
      throw new Error(t('errors:aiPlanningService.selectLeastOneLibrary'))
    const { response, sources, warning } = await this.chatWithLibrary(
      provider,
      projectId,
      OSTLER_AI_PLANNING_SYSTEM_PROMPT,
      buildLibraryGoalProposalUserPrompt({
        projectName,
        existingGoals: existingGoals
          .slice(0, 30)
          .map((goal) => ({ title: goal.title, status: goal.status }))
      }),
      { model, maxTokens: Math.max(config.ai.maxTokens || 0, 4096), temperature: 0.2 },
      selectedItemIds
    )
    // Same reader as every other draft: tolerates prose or fences around the
    // object, and says so when the answer was cut off rather than malformed.
    const parsed = parseDraft(response, 'goalProposal')
    const title = typeof parsed.title === 'string' ? parsed.title.trim().slice(0, 200) : ''
    const outcome = typeof parsed.outcome === 'string' ? parsed.outcome.trim().slice(0, 2000) : ''
    if (!title) throw unusableAnswer(t('errors:aiPlanningService.goalProposalHadNo'))
    const warnings = Array.isArray(parsed.warnings)
      ? parsed.warnings
          .filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '')
          .slice(0, 5)
          .map((entry) => entry.slice(0, 500))
      : []
    const proposal: AILibraryGoalProposal = {
      projectId,
      title,
      outcome,
      warnings: warning ? [warning, ...warnings] : warnings,
      sources
    }
    return proposal
  }

  async breakDownGoal(
    projectId: string,
    projectName: string,
    goal: PlanningGoal,
    existingItems: PlanningWorkItem[],
    selectedItemIds: string[] = []
  ): Promise<AIPlanningDraft> {
    const config = this.getConfig()
    const { provider, model } = requireAi(config, projectId)
    const evidence = {
      projectName,
      goal: { title: goal.title, outcome: goal.outcome },
      existingWork: existingItems.slice(0, 50).map((item) => ({
        title: item.title,
        status: item.status,
        priority: item.priority
      })),
      ...(await this.projectFiles(projectId, { namedIn: [goal.title, goal.outcome] }))
    }
    const prompt = buildGoalBreakdownUserPrompt(evidence, await this.getProjectProfile(projectId))
    const { response, sources, warning, contextIds } = await this.chatWithLibrary(
      provider,
      projectId,
      OSTLER_AI_PLANNING_SYSTEM_PROMPT,
      prompt,
      {
        model: model,
        maxTokens: config.ai.maxTokens || 4096,
        temperature: 0.2
      },
      selectedItemIds
    )
    const draft = this.parse(projectId, goal.id, config.ai.provider, model, response)
    for (const suggestion of draft.suggestions) {
      suggestion.attachments = this.keepAttachments(projectId, contextIds, suggestion.attachments)
    }
    draft.sources = sources
    if (warning) draft.warnings = [warning, ...draft.warnings]
    this.storage.writePlanningDraft(draft)
    return draft
  }

  getDraft(projectId: string, goalId: string): AIPlanningDraft {
    const draft = this.storage.readPlanningDraft(projectId, goalId)
    if (!draft || draft.projectId !== projectId || draft.goalId !== goalId) {
      throw new Error('AI planning draft was not found; generate it again')
    }
    return draft
  }

  async generateNextTasks(
    projectId: string,
    projectName: string,
    evidence: Record<string, unknown>,
    evidenceSummary: AINextTasksEvidenceSummary,
    selectedItemIds: string[] = []
  ): Promise<AINextTasksDraft> {
    const config = this.getConfig()
    const { provider, model } = requireAi(config, projectId)
    const prompt = buildNextTasksUserPrompt(
      projectName,
      {
        ...evidence,
        ...(await this.projectFiles(projectId, {
          overview: true,
          namedIn: [JSON.stringify(evidence.goals ?? ''), JSON.stringify(evidence.milestones ?? '')]
        }))
      },
      await this.getProjectProfile(projectId)
    )
    const { response, sources, warning, contextIds } = await this.chatWithLibrary(
      provider,
      projectId,
      OSTLER_AI_PLANNING_SYSTEM_PROMPT,
      prompt,
      { model, maxTokens: config.ai.maxTokens || 4096, temperature: 0.2 },
      selectedItemIds
    )
    const draft = this.parseNextTasks(
      randomUUID(),
      projectId,
      config.ai.provider,
      model,
      response,
      evidenceSummary
    )
    for (const suggestion of draft.suggestions) {
      suggestion.attachments = this.keepAttachments(projectId, contextIds, suggestion.attachments)
    }
    draft.sources = sources
    if (warning) draft.warnings = [warning, ...draft.warnings]
    this.storage.writeNextTasksDraft(draft)
    return draft
  }

  /**
   * Tasks from text or a photo (N4.1a). Sends the person's text, and the
   * photo when there is one, and nothing else: no project records, no Library
   * and never the people on this PC, whose names are matched here afterwards.
   * The photo arrives already scaled and stripped of EXIF by
   * `preparePhotoForAi`. A photo goes only when the vision setting allows
   * images, and a model that refuses it gets a plain message, never a retry
   * by description, since a photo has none. Nothing is stored or created.
   */
  async findTasksFromText(
    projectId: string,
    input: {
      text: string
      photo: { mimeType: string; base64: string } | null
      today: string
      weekStart: number
    },
    people: Array<{ id: string; name: string; initials?: string; isMe?: boolean }>
  ): Promise<TasksFromTextDraft> {
    const config = this.getConfig()
    const { provider, model } = requireAi(config, projectId)
    if (input.photo && !visionEnabled(config.ai.vision)) {
      throw new FriendlyAiError(t('errors:tasksFromText.visionOff'))
    }
    const prompt = buildTasksFromTextUserPrompt({
      text: input.text,
      today: input.today,
      weekStart: input.weekStart,
      hasPhoto: input.photo !== null
    })
    const content: string | AIContentPart[] = input.photo
      ? [
          { type: 'text', text: prompt },
          { type: 'image', mimeType: input.photo.mimeType, base64: input.photo.base64 }
        ]
      : prompt
    let response = ''
    try {
      for await (const chunk of provider.chat(
        [
          { role: 'system', content: OSTLER_AI_TASKS_FROM_TEXT_SYSTEM_PROMPT },
          { role: 'user', content }
        ],
        {
          model,
          maxTokens: Math.max(config.ai.maxTokens || 0, 4096),
          temperature: 0.1,
          stream: true
        }
      )) {
        response += chunk
      }
    } catch (error) {
      if (input.photo && response === '' && isImageRefusal(error)) {
        throw new FriendlyAiError(t('errors:tasksFromText.modelCantReadPictures'))
      }
      throw error
    }
    const parsed = parseDraft(response, 'tasksFromText')
    return {
      draftId: randomUUID(),
      projectId,
      model,
      generatedAt: Date.now(),
      ...readTextTaskSuggestions(parsed, people)
    }
  }

  /**
   * Describe it (N8.1): a filter from the person's words. Sends the words,
   * today, the week's first day, the filter grammar and the project's names
   * (capped by `capVocabulary`), never a task. The answer is mapped and
   * checked by `readFilterAnswer`; nothing is stored or created.
   */
  async filterFromWords(
    projectId: string,
    input: { text: string; today: string; weekStart: number },
    vocabulary: FilterVocabulary
  ): Promise<FilterFromWordsResult> {
    const config = this.getConfig()
    const { provider, model } = requireAi(config, projectId)
    const capped = capVocabulary(vocabulary)
    let response = ''
    for await (const chunk of provider.chat(
      [
        { role: 'system', content: OSTLER_AI_FILTER_FROM_WORDS_SYSTEM_PROMPT },
        {
          role: 'user',
          content: buildFilterFromWordsUserPrompt({ ...input, vocabulary: capped.vocabulary })
        }
      ],
      {
        model,
        maxTokens: Math.max(config.ai.maxTokens || 0, 2048),
        temperature: 0,
        stream: true
      }
    )) {
      response += chunk
    }
    const answer = readFilterAnswer(parseDraft(response, 'filterFromWords'), vocabulary)
    return { filter: answer.filter, notes: [...capped.notes, ...answer.notes], model }
  }

  /**
   * Find actions and decisions (N4.1b): one Library note, read through the
   * Library's own AI gate (`aiVisibleItem`), so a human-only, archived or
   * foreign note is refused before anything is sent. Only the note's title
   * and text go out, whole; a note too long to send whole is refused rather
   * than cut. Creates nothing.
   */
  async findNoteActions(
    projectId: string,
    itemId: string,
    input: { today: string; weekStart: number },
    people: Array<{ id: string; name: string; initials?: string; isMe?: boolean }>
  ): Promise<Omit<NoteActionsDraft, 'suggestions'> & Pick<TasksFromTextDraft, 'suggestions'>> {
    const config = this.getConfig()
    const { provider, model } = requireAi(config, projectId)
    const item = this.getLibrary()?.aiVisibleItem(projectId, itemId) ?? null
    if (!item) throw new FriendlyAiError(t('errors:noteActions.notReadable'))
    if (item.kind !== 'note' && item.kind !== 'brief' && item.kind !== 'guide') {
      throw new FriendlyAiError(t('errors:noteActions.notANote'))
    }
    if (!item.body.trim()) throw new FriendlyAiError(t('errors:noteActions.empty'))
    if (item.body.length > NOTE_ACTIONS_MAX_CHARS) {
      throw new FriendlyAiError(t('errors:noteActions.tooLong', { max: NOTE_ACTIONS_MAX_CHARS }))
    }
    let response = ''
    for await (const chunk of provider.chat(
      [
        { role: 'system', content: OSTLER_AI_NOTE_ACTIONS_SYSTEM_PROMPT },
        {
          role: 'user',
          content: buildNoteActionsUserPrompt({
            title: item.title,
            text: item.body,
            today: input.today,
            weekStart: input.weekStart
          })
        }
      ],
      {
        model,
        maxTokens: Math.max(config.ai.maxTokens || 0, 4096),
        temperature: 0.1,
        stream: true
      }
    )) {
      response += chunk
    }
    const parsed = parseDraft(response, 'noteActions')
    const tasks = readTextTaskSuggestions(parsed, people)
    const decisions = readNoteDecisions(parsed)
    return {
      draftId: randomUUID(),
      projectId,
      model,
      generatedAt: Date.now(),
      itemId: item.id,
      noteTitle: item.title,
      revision: item.revision,
      ...tasks,
      decisions: decisions.decisions,
      dropped: tasks.dropped + decisions.dropped
    }
  }

  /**
   * Improve writing (N8.2): one text box's text, as it is in the editor, sent
   * with the style and the project's name and nothing else. A Library item's
   * text is sent only when the Library's AI gate (`aiVisibleItem`) allows it.
   * Stores nothing; the rewrite comes back with the links it lost.
   */
  async improveWriting(
    projectId: string,
    projectName: string,
    input: { style: WritingStyle; text: string; libraryItemId?: string }
  ): Promise<ImprovedWriting> {
    const config = this.getConfig()
    const { provider, model } = requireAi(config, projectId)
    if (!isWritingStyle(input.style)) throw new FriendlyAiError(t('errors:writingHelp.badStyle'))
    if (
      input.libraryItemId !== undefined &&
      !this.getLibrary()?.aiVisibleItem(projectId, input.libraryItemId)
    ) {
      throw new FriendlyAiError(t('errors:writingHelp.notReadable'))
    }
    const text = typeof input.text === 'string' ? input.text : ''
    if (!text.trim()) throw new FriendlyAiError(t('errors:writingHelp.empty'))
    if (text.length > WRITING_HELP_MAX_CHARS) {
      throw new FriendlyAiError(t('errors:writingHelp.tooLong', { max: WRITING_HELP_MAX_CHARS }))
    }
    let response = ''
    for await (const chunk of provider.chat(
      [
        { role: 'system', content: OSTLER_AI_IMPROVE_WRITING_SYSTEM_PROMPT },
        {
          role: 'user',
          content: buildImproveWritingUserPrompt({ projectName, style: input.style, text })
        }
      ],
      {
        model,
        maxTokens: Math.max(config.ai.maxTokens || 0, 4096),
        temperature: 0.3,
        stream: true
      }
    )) {
      response += chunk
    }
    const suggestion = plainAnswer(response)
    if (!suggestion) throw unusableAnswer(t('errors:writingHelp.emptyAnswer'))
    return {
      style: input.style,
      original: text,
      suggestion,
      missingLinks: missingLinks(text, suggestion)
    }
  }

  /**
   * Polish with AI (N9.9): the release notes draft, built in main from the
   * milestone's or iteration's tasks, and nothing else: its names, task titles
   * and the first sentences the person chose. Stores nothing; the answer comes
   * back with the titles it no longer mentions.
   */
  async polishReleaseNotes(
    projectId: string,
    buildNotes: () => ReleaseNotes
  ): Promise<PolishedReleaseNotes> {
    const config = this.getConfig()
    const { provider, model } = requireAi(config, projectId)
    // Built after the gate, so nothing is read for a request that cannot go.
    const notes = buildNotes()
    if (notes.taskTitles.length === 0) throw new FriendlyAiError(t('errors:releaseNotes.empty'))
    if (notes.markdown.length > RELEASE_NOTES_POLISH_MAX_CHARS) {
      throw new FriendlyAiError(
        t('errors:releaseNotes.tooLong', { max: RELEASE_NOTES_POLISH_MAX_CHARS })
      )
    }
    let response = ''
    for await (const chunk of provider.chat(
      [
        { role: 'system', content: OSTLER_AI_RELEASE_NOTES_SYSTEM_PROMPT },
        { role: 'user', content: buildReleaseNotesUserPrompt(notes.markdown) }
      ],
      {
        model,
        maxTokens: Math.max(config.ai.maxTokens || 0, 8192),
        temperature: 0.4,
        stream: true
      }
    )) {
      response += chunk
    }
    const suggestion = plainAnswer(response)
    if (!suggestion) throw unusableAnswer(t('errors:releaseNotes.emptyAnswer'))
    return {
      draft: notes.markdown,
      suggestion,
      missingTitles: missingTaskTitles(notes.taskTitles, suggestion)
    }
  }

  /**
   * Triage suggestions (N4.3b): a priority, labels and likely duplicates for a
   * task in To triage. The candidates come from Ostler's search on this PC,
   * found by `buildInput` after the gate; only the task's title and
   * description, the project's label names and the candidates' titles and
   * statuses are sent. Stores nothing: the answer is checked data the person
   * uses or ignores.
   */
  async suggestForTriage(
    projectId: string,
    buildInput: () => {
      workItemId: string
      item: { title: string; description: string }
      labels: string[]
      candidates: TriageCandidate[]
    }
  ): Promise<TriageSuggestion> {
    const config = this.getConfig()
    const { provider, model } = requireAi(config, projectId)
    // Built after the gate, so nothing is searched for a request that cannot go.
    const input = buildInput()
    const request = triageSuggestionRequest(input.item, input.labels, input.candidates)
    let response = ''
    for await (const chunk of provider.chat(
      [
        { role: 'system', content: OSTLER_AI_TRIAGE_SUGGESTION_SYSTEM_PROMPT },
        { role: 'user', content: buildTriageSuggestionUserPrompt(request) }
      ],
      {
        model,
        maxTokens: Math.max(config.ai.maxTokens || 0, 1024),
        temperature: 0.2,
        stream: true
      }
    )) {
      response += chunk
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(extractJsonObject(response))
    } catch {
      throw unusableAnswer(t('errors:triageSuggestions.unusable'))
    }
    try {
      return readTriageSuggestion(parsed, input.workItemId, input.labels, input.candidates)
    } catch {
      throw unusableAnswer(t('errors:triageSuggestions.unusable'))
    }
  }

  /**
   * AI fields (N8.4): Ostler AI's answer for one task's AI field. Sends only
   * the field's name, instruction and options and the task's title,
   * description and checklist (`aiFieldRequest`), read after the gate.
   * Writes nothing: this service has no way to save a value, and the
   * person's Fill with AI saves the suggestion through the planning service.
   */
  async suggestAiFieldValue(
    projectId: string,
    buildInput: () => {
      field: PlanningFieldDefinition
      item: Pick<PlanningWorkItem, 'id' | 'title' | 'description' | 'acceptanceCriteria'>
    }
  ): Promise<AiFieldSuggestion> {
    const config = this.getConfig()
    const { provider, model } = requireAi(config, projectId)
    const { field, item } = buildInput()
    const request = aiFieldRequest(field, item)
    let response = ''
    for await (const chunk of provider.chat(
      [
        { role: 'system', content: OSTLER_AI_FIELD_FILL_SYSTEM_PROMPT },
        { role: 'user', content: buildAiFieldFillUserPrompt(request) }
      ],
      { model, maxTokens: Math.max(config.ai.maxTokens || 0, 512), temperature: 0.1, stream: true }
    )) {
      response += chunk
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(extractJsonObject(response))
    } catch {
      throw unusableAnswer(t('errors:aiFields.unusable'))
    }
    if (!parsed || typeof parsed !== 'object' || !('answer' in parsed))
      throw unusableAnswer(t('errors:aiFields.unusable'))
    const { value, note } = readAiFieldAnswer(field, (parsed as { answer: unknown }).answer)
    return {
      workItemId: item.id,
      fieldId: field.id,
      value,
      note,
      sourceHash: aiFieldSourceHash(item)
    }
  }

  /**
   * Draft from activity (N5.5): a suggested health and note for a status
   * update, from the project's activity since its last update and its
   * milestones' progress, built in main after the gate. Stores nothing and
   * posts nothing: the draft fills the dialog for the person to edit.
   */
  async draftStatusUpdate(
    projectId: string,
    buildInput: () => StatusUpdatePromptInput & { sinceAt: number }
  ): Promise<StatusUpdateDraft> {
    const config = this.getConfig()
    const { provider, model } = requireAi(config, projectId)
    // Built after the gate, so nothing is read for a request that cannot go.
    const input = buildInput()
    let response = ''
    for await (const chunk of provider.chat(
      [
        { role: 'system', content: OSTLER_AI_STATUS_UPDATE_SYSTEM_PROMPT },
        { role: 'user', content: buildStatusUpdateUserPrompt(input) }
      ],
      {
        model,
        maxTokens: Math.max(config.ai.maxTokens || 0, 2048),
        temperature: 0.3,
        stream: true
      }
    )) {
      response += chunk
    }
    const draft = parseStatusDraftAnswer(response)
    if (!draft) throw unusableAnswer(t('errors:statusUpdates.emptyDraft'))
    return {
      ...draft,
      changes: input.activity.length + input.omitted,
      since: input.sinceAt
    }
  }

  /**
   * Summarise comments (N8.2): one task's title and its latest comments, with
   * their authors' names and dates, and nothing else. Stores nothing.
   */
  async summariseComments(
    projectId: string,
    task: { id: string; title: string },
    comments: Array<{ author: string; at: number; body: string }>
  ): Promise<CommentSummary> {
    const config = this.getConfig()
    const { provider, model } = requireAi(config, projectId)
    if (comments.length < COMMENT_SUMMARY_MIN_COMMENTS) {
      throw new FriendlyAiError(
        t('errors:writingHelp.tooFewComments', { min: COMMENT_SUMMARY_MIN_COMMENTS })
      )
    }
    const sorted = [...comments].sort((a, b) => a.at - b.at)
    const sent = sorted.slice(-COMMENT_SUMMARY_MAX_COMMENTS)
    let response = ''
    for await (const chunk of provider.chat(
      [
        { role: 'system', content: OSTLER_AI_COMMENT_SUMMARY_SYSTEM_PROMPT },
        {
          role: 'user',
          content: buildCommentSummaryUserPrompt({
            taskTitle: task.title,
            comments: sent.map((comment) => ({
              author: comment.author,
              date: new Date(comment.at).toISOString().slice(0, 16).replace('T', ' '),
              body: comment.body
            })),
            omitted: sorted.length - sent.length
          })
        }
      ],
      {
        model,
        maxTokens: Math.max(config.ai.maxTokens || 0, 2048),
        temperature: 0.2,
        stream: true
      }
    )) {
      response += chunk
    }
    const summary = plainAnswer(response).slice(0, 8000)
    if (!summary) throw unusableAnswer(t('errors:writingHelp.emptySummary'))
    return {
      workItemId: task.id,
      summary,
      from: sent[0].at,
      to: sent[sent.length - 1].at,
      count: sent.length,
      total: sorted.length
    }
  }

  /**
   * Read-only assessment of one milestone. Reviewing is not creating: this
   * never writes planning records, and the advisory it stores is advice for a
   * human, not a queued action.
   */
  async reviewMilestone(
    projectId: string,
    projectName: string,
    milestoneId: string,
    milestoneName: string,
    evidence: Record<string, unknown>,
    selectedItemIds: string[] = [],
    readyToClose = false
  ): Promise<AIMilestoneAdvisory> {
    const config = this.getConfig()
    const { provider, model } = requireAi(config, projectId)
    const prompt = buildMilestoneAdvisoryUserPrompt(projectName, milestoneName, evidence)
    const { response, sources, warning, listed } = await this.chatWithLibrary(
      provider,
      projectId,
      OSTLER_AI_REVIEW_ONLY_SYSTEM_PROMPT,
      prompt,
      { model, maxTokens: config.ai.maxTokens || 4096, temperature: 0.2 },
      selectedItemIds
    )
    const linked = Array.isArray(evidence.linkedWorkItems)
      ? (evidence.linkedWorkItems as { id: string }[]).map((item) => item.id)
      : []
    const advisory = this.parseMilestoneAdvisory(
      projectId,
      milestoneId,
      config.ai.provider,
      model,
      response,
      milestoneEvidenceFingerprint(evidence),
      {
        readyToClose,
        workItemIds: new Set(linked),
        // Only items the context listed without their content are worth a click.
        libraryItems: listed
      }
    )
    advisory.sources = sources
    if (warning) advisory.warnings = [warning, ...advisory.warnings]
    this.storage.writeMilestoneAdvisory(advisory)
    return advisory
  }

  getMilestoneAdvisory(projectId: string, milestoneId: string): AIMilestoneAdvisory | null {
    const advisory = this.storage.readMilestoneAdvisory(projectId, milestoneId)
    if (!advisory || advisory.projectId !== projectId || advisory.milestoneId !== milestoneId) {
      return null
    }
    return advisory
  }

  getNextTasksDraft(projectId: string, draftId: string): AINextTasksDraft {
    const draft = this.storage.readNextTasksDraft(projectId, draftId)
    if (!draft || draft.projectId !== projectId || draft.draftId !== draftId) {
      throw new Error('AI next-task draft was not found; generate it again')
    }
    return draft
  }

  getProjectBrief(projectId: string): AIProjectBrief | null {
    const brief = this.storage.readProjectBrief(projectId)
    if (!brief) return null
    return {
      ...brief,
      nextActions: brief.nextActions.map((action, index) => ({
        ...action,
        id: action.id || `legacy-brief-action-${index + 1}`,
        reviewStatus: action.reviewStatus || 'pending',
        reviewNotes: action.reviewNotes || '',
        creation: action.creation || null
      }))
    }
  }

  async regenerateKnowledge(
    projectId: string,
    content: string,
    instruction: string
  ): Promise<string> {
    const config = this.getConfig()
    const { provider, model } = requireAi(config, projectId)
    if (!instruction.trim()) throw new Error(t('errors:aiPlanningService.tellOstlerWhatShould'))
    let response = ''
    for await (const chunk of provider.chat(
      [
        {
          role: 'system',
          content: OSTLER_AI_KNOWLEDGE_REWRITE_SYSTEM_PROMPT
        },
        {
          role: 'user',
          content: buildKnowledgeRewriteUserPrompt(content, instruction)
        }
      ],
      { model, maxTokens: config.ai.maxTokens || 4096, temperature: 0.2, stream: true }
    ))
      response += chunk
    if (!response.trim()) throw new Error(t('errors:aiPlanningService.aiReturnedNoRevised'))
    return response.trim().slice(0, 120000)
  }

  async generateProjectBrief(
    projectId: string,
    projectName: string,
    evidence: Record<string, unknown>,
    selectedItemIds: string[] = []
  ): Promise<AIProjectBrief> {
    const config = this.getConfig()
    const { provider, model } = requireAi(config, projectId)
    const prompt = buildProjectBriefUserPrompt(projectName, {
      ...evidence,
      ...(await this.projectFiles(projectId, { overview: true }))
    })
    const { response, sources, warning } = await this.chatWithLibrary(
      provider,
      projectId,
      OSTLER_AI_COORDINATION_SYSTEM_PROMPT,
      prompt,
      { model, maxTokens: Math.max(config.ai.maxTokens || 0, 8192), temperature: 0.2 },
      selectedItemIds
    )
    const json = extractJsonObject(response)
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(json) as Record<string, unknown>
    } catch {
      console.error('AI returned an invalid project brief. Raw response:', response)
      throw unusableAnswer(t('errors:aiPlanningService.projectBriefWasNot'))
    }
    if (typeof parsed.headline !== 'string' || typeof parsed.summary !== 'string') {
      throw unusableAnswer(t('errors:aiPlanningService.projectBriefHadNo'))
    }
    const health =
      parsed.health === 'blocked' || parsed.health === 'at-risk' ? parsed.health : 'on-track'
    const nextActions: AIProjectBriefAction[] = Array.isArray(parsed.nextActions)
      ? parsed.nextActions.slice(0, 3).flatMap((value, index) => {
          if (!value || typeof value !== 'object') return []
          const action = value as Record<string, unknown>
          if (typeof action.title !== 'string' || typeof action.rationale !== 'string') return []
          return [
            {
              id: `brief-action-${Date.now()}-${index + 1}`,
              title: action.title.trim().slice(0, 200),
              rationale: action.rationale.trim().slice(0, 1000),
              evidence: this.stringList(action.evidence, 10),
              reviewStatus: 'pending',
              reviewNotes: '',
              creation: null
            }
          ]
        })
      : []
    const brief: AIProjectBrief = {
      schemaVersion: 1,
      promptVersion: PROMPT_VERSIONS.projectBrief,
      projectId,
      generatedAt: new Date().toISOString(),
      provider: config.ai.provider,
      model: model.slice(0, 200),
      health,
      headline: parsed.headline.trim().slice(0, 300),
      summary: parsed.summary.trim().slice(0, 3000),
      nextActions: nextActions.filter((action) => action.title && action.rationale),
      risks: this.stringList(parsed.risks, 5),
      assumptions: this.stringList(parsed.assumptions, 10),
      warnings: [...(warning ? [warning] : []), ...this.stringList(parsed.warnings, 10)],
      sources
    }
    this.storage.writeProjectBrief(brief)
    return brief
  }

  updateProjectBriefActionReview(
    projectId: string,
    actionId: string,
    reviewStatus: 'approved' | 'rejected',
    reviewNotes: string
  ): AIProjectBrief {
    const brief = this.getProjectBrief(projectId)
    if (!brief) throw new Error(t('errors:aiPlanningService.generateProjectBriefFirst'))
    const found = brief.nextActions.some((action) => action.id === actionId)
    if (!found) throw new Error(t('errors:aiPlanningService.briefRecommendationWasNot'))
    const updated = {
      ...brief,
      nextActions: brief.nextActions.map((action) =>
        action.id === actionId
          ? { ...action, reviewStatus, reviewNotes: reviewNotes.trim().slice(0, 2000) }
          : action
      )
    }
    this.storage.writeProjectBrief(updated)
    return updated
  }

  recordProjectBriefActionCreation(
    projectId: string,
    actionId: string,
    type: 'goal' | 'milestone' | 'work-item',
    recordId: string
  ): AIProjectBrief {
    const brief = this.getProjectBrief(projectId)
    if (!brief) throw new Error(t('errors:aiPlanningService.generateProjectBriefFirst'))
    const action = brief.nextActions.find((candidate) => candidate.id === actionId)
    if (!action) throw new Error(t('errors:aiPlanningService.briefRecommendationWasNot'))
    if (action.reviewStatus !== 'approved')
      throw new Error(t('errors:aiPlanningService.approveRecommendationFirst'))
    if (action.creation) throw new Error(t('errors:aiPlanningService.recommendationHasAlreadyBeen'))
    const updated = {
      ...brief,
      nextActions: brief.nextActions.map((candidate) =>
        candidate.id === actionId
          ? { ...candidate, creation: { type, recordId, createdAt: new Date().toISOString() } }
          : candidate
      )
    }
    this.storage.writeProjectBrief(updated)
    return updated
  }

  clearProjectBriefActionCreation(projectId: string, actionId: string): AIProjectBrief {
    const brief = this.getProjectBrief(projectId)
    if (!brief) throw new Error(t('errors:aiPlanningService.generateProjectBriefFirst'))
    if (!brief.nextActions.some((candidate) => candidate.id === actionId))
      throw new Error(t('errors:aiPlanningService.briefRecommendationWasNot'))
    const updated = {
      ...brief,
      nextActions: brief.nextActions.map((candidate) =>
        candidate.id === actionId ? { ...candidate, creation: null } : candidate
      )
    }
    this.storage.writeProjectBrief(updated)
    return updated
  }

  async regenerateProjectBriefAction(
    projectId: string,
    projectName: string,
    actionId: string,
    reviewNotes: string
  ): Promise<AIProjectBrief> {
    const config = this.getConfig()
    const { provider, model } = requireAi(config, projectId)
    const brief = this.getProjectBrief(projectId)
    if (!brief) throw new Error(t('errors:aiPlanningService.generateProjectBriefFirst'))
    const action = brief.nextActions.find((candidate) => candidate.id === actionId)
    if (!action) throw new Error(t('errors:aiPlanningService.briefRecommendationWasNot'))
    let response = ''
    for await (const chunk of provider.chat(
      [
        {
          role: 'system',
          content: OSTLER_AI_RECOMMENDATION_REVISION_SYSTEM_PROMPT
        },
        {
          role: 'user',
          content: buildRecommendationRevisionUserPrompt(
            projectName,
            { title: action.title, rationale: action.rationale, evidence: action.evidence },
            reviewNotes
          )
        }
      ],
      { model, maxTokens: config.ai.maxTokens || 4096, temperature: 0.2, stream: true }
    ))
      response += chunk
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(
        response
          .trim()
          .replace(/^```(?:json)?\s*/i, '')
          .replace(/\s*```$/, '')
      ) as Record<string, unknown>
    } catch {
      throw unusableAnswer(t('errors:aiPlanningService.recommendationWasNotValid'))
    }
    const title = parsed.title
    const rationale = parsed.rationale
    if (typeof title !== 'string' || typeof rationale !== 'string')
      throw unusableAnswer(t('errors:aiPlanningService.recommendationHadNoTitle'))
    const updated = {
      ...brief,
      generatedAt: new Date().toISOString(),
      nextActions: brief.nextActions.map((candidate) =>
        candidate.id === actionId
          ? {
              ...candidate,
              title: title.trim().slice(0, 200),
              rationale: rationale.trim().slice(0, 1000),
              evidence: this.stringList(parsed.evidence, 10),
              reviewStatus: 'pending' as const,
              reviewNotes: reviewNotes.trim().slice(0, 2000)
            }
          : candidate
      )
    }
    this.storage.writeProjectBrief(updated)
    return updated
  }

  async improveWorkItem(
    projectId: string,
    projectName: string,
    item: PlanningWorkItem,
    existingItems: PlanningWorkItem[],
    selectedItemIds: string[] = []
  ): Promise<AIWorkItemImprovement> {
    const config = this.getConfig()
    const { provider, model } = requireAi(config, projectId)
    const profile = await this.getProjectProfile(projectId)
    const prompt = buildWorkItemImprovementUserPrompt(
      projectName,
      {
        workItem: {
          title: item.title,
          description: item.description,
          priority: item.priority,
          acceptanceCriteria: item.acceptanceCriteria,
          labels: item.labels
        },
        otherWorkTitles: existingItems
          .filter((candidate) => candidate.id !== item.id)
          .slice(0, 50)
          .map((candidate) => candidate.title),
        ...(await this.projectFiles(projectId, {
          namedIn: [item.title, item.description, ...(item.acceptanceCriteria ?? [])]
        }))
      },
      profile
    )
    const { response, sources, warning, contextIds } = await this.chatWithLibrary(
      provider,
      projectId,
      OSTLER_AI_PLANNING_SYSTEM_PROMPT,
      prompt,
      { model, maxTokens: config.ai.maxTokens || 4096, temperature: 0.2 },
      selectedItemIds
    )
    const json = response
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(json) as Record<string, unknown>
    } catch {
      throw unusableAnswer(t('errors:aiPlanningService.taskImprovementWasNot'))
    }
    if (
      typeof parsed.title !== 'string' ||
      typeof parsed.description !== 'string' ||
      typeof parsed.rationale !== 'string'
    ) {
      throw unusableAnswer(t('errors:aiPlanningService.taskImprovementHadNo'))
    }
    const priority: PlanningPriority =
      parsed.priority === 'low' || parsed.priority === 'high' || parsed.priority === 'critical'
        ? parsed.priority
        : 'medium'
    const draft: AIWorkItemImprovement = {
      schemaVersion: 1,
      promptVersion: PROMPT_VERSIONS.workItemImprovement,
      projectId,
      workItemId: item.id,
      generatedAt: new Date().toISOString(),
      provider: config.ai.provider,
      model: model.slice(0, 200),
      title: parsed.title.trim().slice(0, 200),
      description: parsed.description.trim().slice(0, 8000),
      priority,
      acceptanceCriteria: this.stringList(parsed.acceptanceCriteria, 30),
      rationale: parsed.rationale.trim().slice(0, 1500),
      assumptions: this.stringList(parsed.assumptions, 10),
      warnings: [...(warning ? [warning] : []), ...this.stringList(parsed.warnings, 10)],
      sources,
      attachments: this.keepAttachments(projectId, contextIds, parsed.attachments)
    }
    if (!draft.title || !draft.description) {
      throw unusableAnswer(t('errors:aiPlanningService.taskImprovementHadNo'))
    }
    this.storage.writeWorkItemImprovement(draft)
    return draft
  }

  /**
   * Drafts a decision record. `shownWorkItemIds` are the tasks the evidence
   * showed the model: the only ones the draft may link, because a link the
   * person cannot see in the review (a goal's or milestone's id, or a made-up
   * one) would make Save fail with no way to untick it.
   */
  async draftDecision(
    projectId: string,
    projectName: string,
    evidence: Record<string, unknown>,
    shownWorkItemIds: string[] = []
  ): Promise<AIDecisionDraft> {
    const config = this.getConfig()
    const { provider, model } = requireAi(config, projectId)
    const prompt = buildDecisionDraftUserPrompt(projectName, evidence)
    let response = ''
    for await (const chunk of provider.chat(
      [
        { role: 'system', content: OSTLER_AI_PLANNING_SYSTEM_PROMPT },
        { role: 'user', content: prompt }
      ],
      {
        model,
        maxTokens: config.ai.maxTokens || 4096,
        temperature: 0.2,
        stream: true
      }
    )) {
      response += chunk
    }
    const draft = this.parseDecisionDraft(
      randomUUID(),
      projectId,
      config.ai.provider,
      model,
      response,
      new Set(shownWorkItemIds)
    )
    this.storage.writeDecisionDraft(draft)
    return draft
  }

  getDecisionDraft(projectId: string, draftId: string): AIDecisionDraft {
    const draft = this.storage.readDecisionDraft(projectId, draftId)
    if (!draft || draft.projectId !== projectId || draft.draftId !== draftId) {
      throw new Error('AI decision draft was not found; generate it again')
    }
    return draft
  }

  /** Step 1 of the guided Agent Plan & Split workflow: the cheapest checkpoint before task generation. */
  async draftMasterPlan(
    projectId: string,
    projectName: string,
    goal: PlanningGoal,
    existingItems: PlanningWorkItem[],
    selectedItemIds: string[] = []
  ): Promise<AIMasterPlanDraft> {
    const config = this.getConfig()
    const { provider, model } = requireAi(config, projectId)
    await this.assertSoftwareProject(projectId)
    const evidence = {
      projectName,
      goal: { title: goal.title, outcome: goal.outcome },
      existingWork: existingItems.slice(0, 50).map((item) => ({
        title: item.title,
        status: item.status,
        priority: item.priority
      })),
      ...(await this.projectFiles(projectId, { overview: true }))
    }
    const { response, sources, warning } = await this.chatWithLibrary(
      provider,
      projectId,
      OSTLER_AI_PLANNING_SYSTEM_PROMPT,
      buildMasterPlanUserPrompt(evidence),
      { model, maxTokens: config.ai.maxTokens || 4096, temperature: 0.2 },
      selectedItemIds
    )
    const draft = this.parseMasterPlan(
      randomUUID(),
      projectId,
      goal.id,
      config.ai.provider,
      model,
      response
    )
    draft.sources = sources
    if (warning) draft.warnings = [warning, ...draft.warnings]
    this.storage.writeMasterPlanDraft(draft)
    return draft
  }

  /** Store a human-approved revision of a master plan draft over the AI's original. */
  saveMasterPlanDraft(draft: AIMasterPlanDraft): void {
    this.storage.writeMasterPlanDraft(draft)
  }

  getMasterPlanDraft(projectId: string, draftId: string): AIMasterPlanDraft {
    const draft = this.storage.readMasterPlanDraft(projectId, draftId)
    if (!draft || draft.projectId !== projectId || draft.draftId !== draftId) {
      throw new Error('AI master plan draft was not found; generate it again')
    }
    return draft
  }

  /**
   * Step 2 of the guided Agent Plan & Split workflow, one approved phase at a time.
   *
   * A whole-plan split is the largest structured output Ostler asks for, and it
   * reliably overran the model's output ceiling and came back as truncated JSON.
   * Splitting per phase keeps each response small; `alreadyPlanned` carries the
   * codes, titles and deliverables from earlier phases forward so a phase is not
   * planned blind -- it can avoid repeating earlier scope, depend on it by code,
   * and point its agent at the exact paths those tasks leave behind.
   */
  async draftPhaseSplit(
    projectId: string,
    projectName: string,
    goalId: string,
    masterPlanDraftId: string,
    approvedSummary: string,
    approvedRules: string[],
    phase: { code: string; name: string; objective: string },
    alreadyPlanned: { code: string; title: string; deliverables?: string[] }[],
    nodeBudget: number,
    selectedItemIds: string[] = []
  ): Promise<{
    code: string
    name: string
    tasks: AIPlanTaskNode[]
    sources?: AIDraftSource[]
    warning?: string
  }> {
    const config = this.getConfig()
    const { provider, model } = requireAi(config, projectId)
    await this.assertSoftwareProject(projectId)
    const evidence = {
      projectName,
      summary: approvedSummary,
      nonNegotiableRules: approvedRules,
      phases: [phase],
      alreadyPlanned,
      ...(await this.projectFiles(projectId, {
        overview: true,
        namedIn: [approvedSummary, phase.name, phase.objective, ...approvedRules]
      }))
    }
    const { response, sources, warning, contextIds } = await this.chatWithLibrary(
      provider,
      projectId,
      OSTLER_AI_PLANNING_SYSTEM_PROMPT,
      buildTaskSplitUserPrompt(evidence, nodeBudget),
      { model, maxTokens: Math.max(config.ai.maxTokens || 0, 8192), temperature: 0.2 },
      selectedItemIds
    )
    const parsed = this.parseTaskSplit(
      randomUUID(),
      projectId,
      goalId,
      masterPlanDraftId,
      [phase],
      config.ai.provider,
      model,
      [response]
    )
    const result = parsed.phases[0]
    const keepNodeAttachments = (node: AIPlanTaskNode): void => {
      node.attachments = this.keepAttachments(projectId, contextIds, node.attachments)
      node.subtasks.forEach(keepNodeAttachments)
    }
    result.tasks.forEach(keepNodeAttachments)
    return { ...result, sources, ...(warning ? { warning } : {}) }
  }

  /** Assembles the completed per-phase results into one stored draft. */
  finishTaskSplit(
    projectId: string,
    goalId: string,
    masterPlanDraftId: string,
    phases: { code: string; name: string; tasks: AIPlanTaskNode[] }[],
    warnings: string[] = []
  ): AITaskSplitDraft {
    if (phases.length === 0) throw new Error(t('errors:aiPlanningService.noPhasesWereSplit'))
    const config = this.getConfig()
    const draft: AITaskSplitDraft = {
      schemaVersion: 1,
      promptVersion: PROMPT_VERSIONS.taskSplit,
      draftId: randomUUID(),
      projectId,
      goalId,
      masterPlanDraftId,
      generatedAt: new Date().toISOString(),
      provider: config.ai.provider,
      model: (config.ai.model || 'gpt-4o').slice(0, 200),
      phases,
      warnings,
      // The split is planned from the same sources as its master plan.
      sources: this.storage.readMasterPlanDraft(projectId, masterPlanDraftId)?.sources ?? []
    }
    this.storage.writeTaskSplitDraft(draft)
    return draft
  }

  getTaskSplitDraft(projectId: string, draftId: string): AITaskSplitDraft {
    const draft = this.storage.readTaskSplitDraft(projectId, draftId)
    if (!draft || draft.projectId !== projectId || draft.draftId !== draftId) {
      throw new Error('AI task split draft was not found; generate it again')
    }
    return draft
  }

  /**
   * The second, architecturally isolated read-only auditor session. It has no
   * write-capable tool access and no code path back into planning state — the
   * only output is a draft a human may later accept via ACCEPT_TASK_STATUS_REVIEW.
   */
  async reviewTaskStatus(
    projectId: string,
    items: {
      workItemId: string
      title: string
      status: string
      verificationStatus: string
      sessionEvidence: string
      blockers: string[]
    }[]
  ): Promise<TaskStatusReviewDraft> {
    const config = this.getConfig()
    const { provider, model } = requireAi(config, projectId)
    if (items.length === 0) throw new Error(t('errors:aiPlanningService.chooseLeastOneTask'))
    const evidence = items.slice(0, 20).map((item) => ({
      workItemId: item.workItemId,
      title: item.title,
      claimedStatus: item.status,
      currentVerificationStatus: item.verificationStatus,
      sessionEvidence: item.sessionEvidence.slice(0, 8000),
      blockers: item.blockers.slice(0, 10)
    }))
    let response = ''
    for await (const chunk of provider.chat(
      [
        { role: 'system', content: OSTLER_AI_REVIEW_ONLY_SYSTEM_PROMPT },
        { role: 'user', content: buildTaskStatusReviewUserPrompt(evidence) }
      ],
      { model, maxTokens: config.ai.maxTokens || 4096, temperature: 0.1, stream: true }
    )) {
      response += chunk
    }
    const draft = this.parseTaskStatusReview(
      randomUUID(),
      projectId,
      config.ai.provider,
      model,
      response,
      items.map((item) => item.workItemId)
    )
    this.storage.writeTaskStatusReviewDraft(draft)
    return draft
  }

  getTaskStatusReviewDraft(projectId: string, draftId: string): TaskStatusReviewDraft {
    const draft = this.storage.readTaskStatusReviewDraft(projectId, draftId)
    if (!draft || draft.projectId !== projectId || draft.draftId !== draftId) {
      throw new Error('AI task status review draft was not found; generate it again')
    }
    return draft
  }

  private parse(
    projectId: string,
    goalId: string,
    provider: OstlerConfig['ai']['provider'],
    model: string,
    response: string
  ): AIPlanningDraft {
    const parsed = parseDraft(response, 'planningDraft') as {
      summary?: unknown
      assumptions?: unknown
      warnings?: unknown
      suggestions?: unknown
    }
    if (typeof parsed.summary !== 'string' || !Array.isArray(parsed.suggestions)) {
      throw unusableAnswer(t('errors:aiPlanningService.planningDraftWasMissing'))
    }
    const suggestions: AIPlanningSuggestion[] = parsed.suggestions
      .slice(0, 8)
      .flatMap((value) => {
        if (!value || typeof value !== 'object') return []
        const item = value as Record<string, unknown>
        if (typeof item.title !== 'string' || typeof item.description !== 'string') return []
        const priority = planningPriority(item.priority)
        const acceptanceCriteria = Array.isArray(item.acceptanceCriteria)
          ? item.acceptanceCriteria
              .filter((entry): entry is string => typeof entry === 'string')
              .slice(0, 20)
          : []
        const evidence = Array.isArray(item.evidence)
          ? item.evidence.filter((entry): entry is string => typeof entry === 'string').slice(0, 10)
          : []
        return [
          {
            title: item.title.trim().slice(0, 200),
            description: item.description.trim().slice(0, 8000),
            priority,
            acceptanceCriteria: acceptanceCriteria.map((entry) => entry.trim().slice(0, 500)),
            rationale:
              typeof item.rationale === 'string' ? item.rationale.trim().slice(0, 1000) : '',
            evidence: evidence.map((entry) => entry.trim().slice(0, 500)).filter(Boolean),
            // Raw ids; the caller keeps only those that pass draftAttachmentIds.
            attachments: this.stringList(item.attachments, 20)
          }
        ]
      })
      .filter((item) => item.title && item.description)
    return {
      schemaVersion: 1,
      promptVersion: PROMPT_VERSIONS.goalBreakdown,
      projectId,
      goalId,
      generatedAt: new Date().toISOString(),
      provider,
      model: model.slice(0, 200),
      summary: parsed.summary.trim().slice(0, 2000),
      assumptions: this.stringList(parsed.assumptions, 10),
      warnings: this.stringList(parsed.warnings, 10),
      suggestions
    }
  }

  private parseMilestoneAdvisory(
    projectId: string,
    milestoneId: string,
    provider: OstlerConfig['ai']['provider'],
    model: string,
    response: string,
    evidenceFingerprint: string,
    known: {
      readyToClose: boolean
      workItemIds: Set<string>
      libraryItems: Map<string, string>
    } = { readyToClose: false, workItemIds: new Set(), libraryItems: new Map() }
  ): AIMilestoneAdvisory {
    const parsed = parseDraft(response, 'milestoneAdvisory') as {
      health?: unknown
      headline?: unknown
      summary?: unknown
      recommendations?: unknown
      risks?: unknown
      assumptions?: unknown
      warnings?: unknown
    }
    if (typeof parsed.headline !== 'string' || typeof parsed.summary !== 'string') {
      throw unusableAnswer(t('errors:aiPlanningService.milestoneAdvisoryWasMissing'))
    }
    // Every linked task done is a fact, not the model's judgement: the verdict
    // follows the card's rule, and the model's doubts stay in its list.
    const health = known.readyToClose
      ? 'ready-to-close'
      : parsed.health === 'blocked' || parsed.health === 'at-risk'
        ? parsed.health
        : 'on-track'
    // An empty list is a legitimate verdict here, unlike the next-task draft
    // which must always return five. Nothing is padded to fill the card.
    const recommendations: AIMilestoneRecommendation[] = Array.isArray(parsed.recommendations)
      ? parsed.recommendations.slice(0, 3).flatMap((value) => {
          if (!value || typeof value !== 'object') return []
          const item = value as Record<string, unknown>
          if (typeof item.title !== 'string' || typeof item.rationale !== 'string') return []
          const title = item.title.trim().slice(0, 200)
          const rationale = item.rationale.trim().slice(0, 2000)
          if (!title || !rationale) return []
          const action = milestoneAction(item.action, known)
          return [
            {
              title,
              rationale,
              evidence: this.stringList(item.evidence, 10),
              ...(action ? { action } : {})
            }
          ]
        })
      : []
    return {
      schemaVersion: 1,
      promptVersion: PROMPT_VERSIONS.milestoneAdvisory,
      projectId,
      milestoneId,
      generatedAt: new Date().toISOString(),
      provider,
      model: model.slice(0, 200),
      health,
      headline: parsed.headline.trim().slice(0, 300),
      summary: parsed.summary.trim().slice(0, 4000),
      recommendations,
      risks: this.stringList(parsed.risks, 3),
      assumptions: this.stringList(parsed.assumptions, 10),
      warnings: this.stringList(parsed.warnings, 10),
      evidenceFingerprint
    }
  }

  private parseNextTasks(
    draftId: string,
    projectId: string,
    provider: OstlerConfig['ai']['provider'],
    model: string,
    response: string,
    evidenceSummary: AINextTasksEvidenceSummary
  ): AINextTasksDraft {
    const parsed = parseDraft(response, 'nextTaskDraft') as {
      summary?: unknown
      assumptions?: unknown
      warnings?: unknown
      suggestions?: unknown
    }
    if (typeof parsed.summary !== 'string' || !Array.isArray(parsed.suggestions)) {
      throw unusableAnswer(t('errors:aiPlanningService.nextTaskDraftWas'))
    }
    const suggestions: AIPlanningSuggestion[] = parsed.suggestions
      .slice(0, 6)
      .flatMap((value) => {
        if (!value || typeof value !== 'object') return []
        const item = value as Record<string, unknown>
        if (typeof item.title !== 'string' || typeof item.description !== 'string') return []
        const priority = planningPriority(item.priority)
        return [
          {
            title: item.title.trim().slice(0, 200),
            description: item.description.trim().slice(0, 8000),
            priority,
            acceptanceCriteria: this.stringList(item.acceptanceCriteria, 20),
            rationale:
              typeof item.rationale === 'string' ? item.rationale.trim().slice(0, 1000) : '',
            evidence: this.stringList(item.evidence, 10),
            // Raw ids; the caller keeps only those that pass draftAttachmentIds.
            attachments: this.stringList(item.attachments, 20)
          }
        ]
      })
      .filter(
        (item) =>
          item.title &&
          item.description &&
          item.acceptanceCriteria.length > 0 &&
          item.evidence.length > 0
      )
    if (suggestions.length !== 5 || parsed.suggestions.length !== 5) {
      throw unusableAnswer(t('errors:aiPlanningService.draftDidNotHave'))
    }
    return {
      schemaVersion: 1,
      promptVersion: PROMPT_VERSIONS.nextTasks,
      draftId,
      projectId,
      generatedAt: new Date().toISOString(),
      provider,
      model: model.slice(0, 200),
      summary: parsed.summary.trim().slice(0, 2000),
      assumptions: this.stringList(parsed.assumptions, 10),
      warnings: this.stringList(parsed.warnings, 10),
      evidenceSummary,
      suggestions
    }
  }

  private parseDecisionDraft(
    draftId: string,
    projectId: string,
    provider: OstlerConfig['ai']['provider'],
    model: string,
    response: string,
    shownWorkItemIds: Set<string>
  ): AIDecisionDraft {
    const parsed = parseDraft(response, 'decisionDraft')
    if (typeof parsed.title !== 'string' || typeof parsed.decision !== 'string') {
      throw unusableAnswer(t('errors:aiPlanningService.decisionDraftWasMissing'))
    }
    const title = parsed.title.trim().slice(0, 200)
    const decision = parsed.decision.trim().slice(0, 8000)
    if (!title || !decision) {
      throw unusableAnswer(t('errors:aiPlanningService.decisionDraftWasMissing'))
    }
    const context = typeof parsed.context === 'string' ? parsed.context.trim().slice(0, 8000) : ''
    const alternativesConsidered =
      typeof parsed.alternativesConsidered === 'string'
        ? parsed.alternativesConsidered.trim().slice(0, 8000)
        : Array.isArray(parsed.alternativesConsidered)
          ? parsed.alternativesConsidered
              .filter((entry): entry is string => typeof entry === 'string')
              .map((entry) => entry.trim())
              .join('\n\n')
              .slice(0, 8000)
          : ''
    const consequences =
      typeof parsed.consequences === 'string' ? parsed.consequences.trim().slice(0, 8000) : ''
    const date =
      typeof parsed.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(parsed.date)
        ? parsed.date
        : todayIsoDate()
    const linkedWorkItemIds = Array.isArray(parsed.linkedWorkItemIds)
      ? [
          ...new Set(
            parsed.linkedWorkItemIds
              .filter((id): id is string => typeof id === 'string')
              .map((id) => id.trim())
              .filter((id) => shownWorkItemIds.has(id))
          )
        ].slice(0, 50)
      : []
    const rationale =
      typeof parsed.rationale === 'string' ? parsed.rationale.trim().slice(0, 1500) : ''

    return {
      schemaVersion: 1,
      promptVersion: PROMPT_VERSIONS.decisionDraft,
      draftId,
      projectId,
      generatedAt: new Date().toISOString(),
      provider,
      model: model.slice(0, 200),
      title,
      context,
      decision,
      alternativesConsidered,
      consequences,
      date,
      linkedWorkItemIds,
      rationale,
      evidence: this.stringList(parsed.evidence, 10),
      assumptions: this.stringList(parsed.assumptions, 10),
      warnings: this.stringList(parsed.warnings, 10)
    }
  }

  private parseMasterPlan(
    draftId: string,
    projectId: string,
    goalId: string,
    provider: OstlerConfig['ai']['provider'],
    model: string,
    response: string
  ): AIMasterPlanDraft {
    const parsed = parseDraft(response, 'masterPlan') as {
      summary?: unknown
      auditFindings?: unknown
      nonNegotiableRules?: unknown
      phases?: unknown
      assumptions?: unknown
      warnings?: unknown
    }
    if (typeof parsed.summary !== 'string' || !Array.isArray(parsed.phases)) {
      throw unusableAnswer(t('errors:aiPlanningService.masterPlanWasMissing'))
    }
    const letters = 'ABCDEFGH'
    const phases = parsed.phases
      .slice(0, 8)
      .flatMap((value, index) => {
        if (!value || typeof value !== 'object') return []
        const phase = value as Record<string, unknown>
        if (typeof phase.name !== 'string' || typeof phase.objective !== 'string') return []
        return [
          {
            code: letters[index] ?? String(index + 1),
            name: phase.name.trim().slice(0, 160),
            objective: phase.objective.trim().slice(0, 2000)
          }
        ]
      })
      .filter((phase) => phase.name && phase.objective)
    if (phases.length === 0) throw unusableAnswer(t('errors:aiPlanningService.masterPlanHadNo'))
    return {
      schemaVersion: 1,
      promptVersion: PROMPT_VERSIONS.masterPlan,
      draftId,
      projectId,
      goalId,
      generatedAt: new Date().toISOString(),
      provider,
      model: model.slice(0, 200),
      summary: parsed.summary.trim().slice(0, 2000),
      auditFindings: this.stringList(parsed.auditFindings, 15),
      nonNegotiableRules: this.stringList(parsed.nonNegotiableRules, 15),
      phases,
      assumptions: this.stringList(parsed.assumptions, 10),
      warnings: this.stringList(parsed.warnings, 10)
    }
  }

  private parseTaskSplit(
    draftId: string,
    projectId: string,
    goalId: string,
    masterPlanDraftId: string,
    approvedPhases: { code: string; name: string; objective: string }[],
    provider: OstlerConfig['ai']['provider'],
    model: string,
    responses: string[]
  ): AITaskSplitDraft {
    // One response per approved phase; they are merged back into a single draft,
    // sharing the 60-node ceiling so a many-phase plan stays the same size overall.
    const parsedPhases = responses.flatMap((response) => {
      const parsed = parseDraft(response, 'taskSplit') as { phases?: unknown }
      if (!Array.isArray(parsed.phases)) {
        throw unusableAnswer(t('errors:aiPlanningService.taskSplitWasMissing'))
      }
      return parsed.phases
    })
    const approvedByCode = new Map(approvedPhases.map((phase) => [phase.code, phase]))
    const usedCodes = new Set<string>()
    let totalNodes = 0
    const parseNode = (value: unknown, prefix: string, depth: 1 | 2 | 3): AIPlanTaskNode[] => {
      if (!value || typeof value !== 'object') return []
      const raw = value as Record<string, unknown>
      if (typeof raw.title !== 'string' || typeof raw.task !== 'string') return []
      totalNodes += 1
      if (totalNodes > 60) return []
      const priority = planningPriority(raw.priority)
      const subtasksRaw = Array.isArray(raw.subtasks) ? raw.subtasks : []
      const subtasks =
        depth < 3
          ? subtasksRaw
              .slice(0, 5)
              .flatMap((child, index) =>
                parseNode(child, `${prefix}.${index + 1}`, (depth + 1) as 1 | 2 | 3)
              )
          : []
      return [
        {
          code: prefix,
          depth,
          title: raw.title.trim().slice(0, 200),
          context: typeof raw.context === 'string' ? raw.context.trim().slice(0, 4000) : '',
          task: raw.task.trim().slice(0, 4000),
          constraints: this.stringList(raw.constraints, 20),
          acceptanceCriteria: this.stringList(raw.acceptanceCriteria, 20),
          outOfScope: this.stringList(raw.outOfScope, 20),
          preconditions: this.stringList(raw.preconditions, 20),
          references: this.stringList(raw.references, 20),
          deliverables: this.stringList(raw.deliverables, 20),
          reliesOn: this.stringList(raw.reliesOn, 20),
          priority,
          rationale: typeof raw.rationale === 'string' ? raw.rationale.trim().slice(0, 1000) : '',
          evidence: this.stringList(raw.evidence, 10),
          // Raw ids; draftPhaseSplit keeps only those that pass draftAttachmentIds.
          attachments: this.stringList(raw.attachments, 20),
          subtasks
        }
      ]
    }
    const phases = parsedPhases
      .flatMap((value, index) => {
        if (!value || typeof value !== 'object') return []
        const phase = value as Record<string, unknown>
        // Each response covers exactly one requested phase, so a missing or
        // mangled code is recoverable from position: dropping the phase would
        // silently lose a whole phase of the plan the human already approved.
        const matched =
          typeof phase.code === 'string' && !usedCodes.has(phase.code)
            ? approvedByCode.get(phase.code)
            : undefined
        const approved =
          matched ??
          (parsedPhases.length === approvedPhases.length ? approvedPhases[index] : undefined)
        // A code already claimed by an earlier response would collide node codes.
        if (!approved || usedCodes.has(approved.code)) return []
        usedCodes.add(approved.code)
        const tasksRaw = Array.isArray(phase.tasks) ? phase.tasks : []
        const tasks = tasksRaw
          .slice(0, 12)
          .flatMap((task, taskIndex) => parseNode(task, `${approved.code}${taskIndex + 1}`, 1))
        return [{ code: approved.code, name: approved.name, tasks }]
      })
      .filter((phase) => phase.tasks.length > 0)
    if (phases.length === 0) throw unusableAnswer(t('errors:aiPlanningService.taskSplitHadNo'))
    return {
      schemaVersion: 1,
      promptVersion: PROMPT_VERSIONS.taskSplit,
      draftId,
      projectId,
      goalId,
      masterPlanDraftId,
      generatedAt: new Date().toISOString(),
      provider,
      model: model.slice(0, 200),
      phases
    }
  }

  private parseTaskStatusReview(
    draftId: string,
    projectId: string,
    provider: OstlerConfig['ai']['provider'],
    model: string,
    response: string,
    expectedWorkItemIds: string[]
  ): TaskStatusReviewDraft {
    const parsed = parseDraft(response, 'taskStatusReview') as { items?: unknown }
    if (!Array.isArray(parsed.items)) {
      throw unusableAnswer(t('errors:aiPlanningService.taskStatusReviewWas'))
    }
    const expected = new Set(expectedWorkItemIds)
    const verificationStatuses: PlanningVerificationStatus[] = [
      'unverified',
      'pending',
      'passed',
      'failed',
      'needs-rework'
    ]
    // Only the four narrow verification columns can ever be written from this draft; strip
    // anything else the model returns rather than let it flow through to a write path.
    const items: TaskStatusReviewItem[] = parsed.items
      .flatMap((value) => {
        if (!value || typeof value !== 'object') return []
        const raw = value as Record<string, unknown>
        if (typeof raw.workItemId !== 'string' || !expected.has(raw.workItemId)) return []
        const recommendedVerification: PlanningVerificationStatus =
          typeof raw.recommendedVerification === 'string' &&
          verificationStatuses.includes(raw.recommendedVerification as PlanningVerificationStatus)
            ? (raw.recommendedVerification as PlanningVerificationStatus)
            : 'pending'
        const confidence: 'low' | 'medium' | 'high' =
          raw.confidence === 'low' || raw.confidence === 'high' ? raw.confidence : 'medium'
        return [
          {
            workItemId: raw.workItemId,
            claimedStatus:
              typeof raw.claimedStatus === 'string' ? raw.claimedStatus.trim().slice(0, 100) : '',
            evidenceAssessment:
              typeof raw.evidenceAssessment === 'string'
                ? raw.evidenceAssessment.trim().slice(0, 2000)
                : '',
            concerns: this.stringList(raw.concerns, 10),
            recommendedVerification,
            confidence
          }
        ]
      })
      .slice(0, 20)
    return {
      schemaVersion: 1,
      promptVersion: PROMPT_VERSIONS.taskStatusReview,
      draftId,
      projectId,
      generatedAt: new Date().toISOString(),
      provider,
      model: model.slice(0, 200),
      items
    }
  }

  private stringList(value: unknown, limit: number): string[] {
    return Array.isArray(value)
      ? value
          .filter((entry): entry is string => typeof entry === 'string')
          .slice(0, limit)
          .map((entry) => entry.trim().slice(0, 500))
          .filter(Boolean)
      : []
  }
}
