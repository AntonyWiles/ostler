import fs from 'node:fs'
import type {
  AIDecisionDraft,
  AIMasterPlanDraft,
  AIMilestoneAdvisory,
  AINextTasksDraft,
  AIPlanningDraft,
  AIProjectBrief,
  AITaskSplitDraft,
  AIWorkItemImprovement,
  TaskReview,
  TaskStatusReviewDraft
} from '@shared/ostler-api'
import {
  canonicalRoot,
  ensureDirectory,
  resolveWithinRoot,
  validateProjectId
} from './storage-paths'

/**
 * Every per-project directory AIStorageService writes, as
 * `<dataDir>/ai/<name>/<projectId>`. Project removal inventories and purges
 * exactly this list; `ensureDirectory` below only accepts names from it.
 */
export const AI_STORAGE_DIRECTORIES = [
  'project-notes',
  'planning-drafts',
  'next-task-drafts',
  'milestone-advisories',
  'project-briefs',
  'work-item-drafts',
  'decision-drafts',
  'master-plan-drafts',
  'task-split-drafts',
  'task-status-review-drafts',
  'task-reviews'
] as const

export type AIStorageDirectory = (typeof AI_STORAGE_DIRECTORIES)[number]

/**
 * The only filesystem writer available to the built-in AI feature.
 *
 * This deliberately owns a namespace that is separate from `harness/`.
 * Callers provide identifiers and content, never paths, so model output
 * cannot select a destination outside of Ostler user data.
 */
export class AIStorageService {
  private readonly root: string

  constructor(dataDir: string) {
    this.root = canonicalRoot(dataDir)
  }

  appendProjectStatusNote(projectId: string, content: string): string {
    this.validateProjectId(projectId)

    const trimmed = content.trim()
    if (!trimmed) throw new Error('A status note cannot be empty')

    const notesDir = this.ensureDirectory('ai', 'project-notes', projectId)
    const statusPath = this.resolveWithinRoot(notesDir, 'status.md')

    // Do not follow a symlink or junction substituted for the note file.
    if (fs.existsSync(statusPath) && fs.lstatSync(statusPath).isSymbolicLink()) {
      throw new Error('AI storage file must not be a symbolic link')
    }

    const timestamp = new Date().toISOString()
    fs.appendFileSync(statusPath, `\n\n---\n\n## ${timestamp}\n\n${trimmed}\n`, 'utf8')
    return statusPath
  }

  writePlanningDraft(draft: AIPlanningDraft): string {
    this.validateProjectId(draft.projectId)
    if (!/^[a-f0-9-]{36}$/.test(draft.goalId)) {
      throw new Error('Invalid planning goal identifier')
    }
    const draftsDir = this.ensureDirectory('ai', 'planning-drafts', draft.projectId)
    const draftPath = this.resolveWithinRoot(draftsDir, `${draft.goalId}.json`)
    if (fs.existsSync(draftPath) && fs.lstatSync(draftPath).isSymbolicLink()) {
      throw new Error('AI storage file must not be a symbolic link')
    }
    const tempPath = this.resolveWithinRoot(draftsDir, `${draft.goalId}.json.tmp`)
    if (fs.existsSync(tempPath) && fs.lstatSync(tempPath).isSymbolicLink()) {
      throw new Error('AI storage file must not be a symbolic link')
    }
    fs.writeFileSync(tempPath, JSON.stringify(draft, null, 2), 'utf8')
    fs.renameSync(tempPath, draftPath)
    return draftPath
  }

  readPlanningDraft(projectId: string, goalId: string): AIPlanningDraft | null {
    const draftPath = this.planningDraftPath(projectId, goalId)
    if (!fs.existsSync(draftPath)) return null
    if (fs.lstatSync(draftPath).isSymbolicLink()) {
      throw new Error('AI storage file must not be a symbolic link')
    }
    return JSON.parse(fs.readFileSync(draftPath, 'utf8')) as AIPlanningDraft
  }

  writeNextTasksDraft(draft: AINextTasksDraft): string {
    this.validateProjectId(draft.projectId)
    this.validateDraftId(draft.draftId)
    const draftsDir = this.ensureDirectory('ai', 'next-task-drafts', draft.projectId)
    const draftPath = this.resolveWithinRoot(draftsDir, `${draft.draftId}.json`)
    const tempPath = this.resolveWithinRoot(draftsDir, `${draft.draftId}.json.tmp`)
    for (const candidate of [draftPath, tempPath]) {
      if (fs.existsSync(candidate) && fs.lstatSync(candidate).isSymbolicLink()) {
        throw new Error('AI storage file must not be a symbolic link')
      }
    }
    fs.writeFileSync(tempPath, JSON.stringify(draft, null, 2), 'utf8')
    fs.renameSync(tempPath, draftPath)
    return draftPath
  }

  readNextTasksDraft(projectId: string, draftId: string): AINextTasksDraft | null {
    this.validateProjectId(projectId)
    this.validateDraftId(draftId)
    const draftsDir = this.ensureDirectory('ai', 'next-task-drafts', projectId)
    const draftPath = this.resolveWithinRoot(draftsDir, `${draftId}.json`)
    if (!fs.existsSync(draftPath)) return null
    if (fs.lstatSync(draftPath).isSymbolicLink()) {
      throw new Error('AI storage file must not be a symbolic link')
    }
    return JSON.parse(fs.readFileSync(draftPath, 'utf8')) as AINextTasksDraft
  }

  writeMilestoneAdvisory(advisory: AIMilestoneAdvisory): string {
    this.validateProjectId(advisory.projectId)
    // Milestone ids are Ostler-generated and share the draft id shape, so the
    // same validator keeps model-adjacent input from selecting a path.
    this.validateDraftId(advisory.milestoneId)
    const advisoryDir = this.ensureDirectory('ai', 'milestone-advisories', advisory.projectId)
    const advisoryPath = this.resolveWithinRoot(advisoryDir, `${advisory.milestoneId}.json`)
    const tempPath = this.resolveWithinRoot(advisoryDir, `${advisory.milestoneId}.json.tmp`)
    for (const candidate of [advisoryPath, tempPath]) {
      if (fs.existsSync(candidate) && fs.lstatSync(candidate).isSymbolicLink()) {
        throw new Error('AI storage file must not be a symbolic link')
      }
    }
    fs.writeFileSync(tempPath, JSON.stringify(advisory, null, 2), 'utf8')
    fs.renameSync(tempPath, advisoryPath)
    return advisoryPath
  }

  readMilestoneAdvisory(projectId: string, milestoneId: string): AIMilestoneAdvisory | null {
    this.validateProjectId(projectId)
    this.validateDraftId(milestoneId)
    const advisoryDir = this.ensureDirectory('ai', 'milestone-advisories', projectId)
    const advisoryPath = this.resolveWithinRoot(advisoryDir, `${milestoneId}.json`)
    if (!fs.existsSync(advisoryPath)) return null
    if (fs.lstatSync(advisoryPath).isSymbolicLink()) {
      throw new Error('AI storage file must not be a symbolic link')
    }
    return JSON.parse(fs.readFileSync(advisoryPath, 'utf8')) as AIMilestoneAdvisory
  }

  writeProjectBrief(brief: AIProjectBrief): void {
    this.validateProjectId(brief.projectId)
    const briefsDir = this.ensureDirectory('ai', 'project-briefs', brief.projectId)
    const briefPath = this.resolveWithinRoot(briefsDir, 'latest.json')
    const tempPath = this.resolveWithinRoot(briefsDir, 'latest.json.tmp')
    for (const candidate of [briefPath, tempPath]) {
      if (fs.existsSync(candidate) && fs.lstatSync(candidate).isSymbolicLink()) {
        throw new Error('AI storage file must not be a symbolic link')
      }
    }
    fs.writeFileSync(tempPath, JSON.stringify(brief, null, 2), 'utf8')
    fs.renameSync(tempPath, briefPath)
  }

  readProjectBrief(projectId: string): AIProjectBrief | null {
    this.validateProjectId(projectId)
    const briefsDir = this.ensureDirectory('ai', 'project-briefs', projectId)
    const briefPath = this.resolveWithinRoot(briefsDir, 'latest.json')
    if (!fs.existsSync(briefPath)) return null
    if (fs.lstatSync(briefPath).isSymbolicLink())
      throw new Error('AI storage file must not be a symbolic link')
    return JSON.parse(fs.readFileSync(briefPath, 'utf8')) as AIProjectBrief
  }

  writeWorkItemImprovement(draft: AIWorkItemImprovement): void {
    this.validateProjectId(draft.projectId)
    if (!/^[a-f0-9-]{36}$/.test(draft.workItemId)) {
      throw new Error('Invalid planning work item identifier')
    }
    const draftsDir = this.ensureDirectory('ai', 'work-item-drafts', draft.projectId)
    const draftPath = this.resolveWithinRoot(draftsDir, `${draft.workItemId}.json`)
    const tempPath = this.resolveWithinRoot(draftsDir, `${draft.workItemId}.json.tmp`)
    for (const candidate of [draftPath, tempPath]) {
      if (fs.existsSync(candidate) && fs.lstatSync(candidate).isSymbolicLink()) {
        throw new Error('AI storage file must not be a symbolic link')
      }
    }
    fs.writeFileSync(tempPath, JSON.stringify(draft, null, 2), 'utf8')
    fs.renameSync(tempPath, draftPath)
  }

  writeDecisionDraft(draft: AIDecisionDraft): string {
    this.validateProjectId(draft.projectId)
    this.validateDraftId(draft.draftId)
    const draftsDir = this.ensureDirectory('ai', 'decision-drafts', draft.projectId)
    const draftPath = this.resolveWithinRoot(draftsDir, `${draft.draftId}.json`)
    const tempPath = this.resolveWithinRoot(draftsDir, `${draft.draftId}.json.tmp`)
    for (const candidate of [draftPath, tempPath]) {
      if (fs.existsSync(candidate) && fs.lstatSync(candidate).isSymbolicLink()) {
        throw new Error('AI storage file must not be a symbolic link')
      }
    }
    fs.writeFileSync(tempPath, JSON.stringify(draft, null, 2), 'utf8')
    fs.renameSync(tempPath, draftPath)
    return draftPath
  }

  readDecisionDraft(projectId: string, draftId: string): AIDecisionDraft | null {
    this.validateProjectId(projectId)
    this.validateDraftId(draftId)
    const draftsDir = this.ensureDirectory('ai', 'decision-drafts', projectId)
    const draftPath = this.resolveWithinRoot(draftsDir, `${draftId}.json`)
    if (!fs.existsSync(draftPath)) return null
    if (fs.lstatSync(draftPath).isSymbolicLink()) {
      throw new Error('AI storage file must not be a symbolic link')
    }
    return JSON.parse(fs.readFileSync(draftPath, 'utf8')) as AIDecisionDraft
  }

  writeMasterPlanDraft(draft: AIMasterPlanDraft): string {
    this.validateProjectId(draft.projectId)
    this.validateDraftId(draft.draftId)
    const draftsDir = this.ensureDirectory('ai', 'master-plan-drafts', draft.projectId)
    const draftPath = this.resolveWithinRoot(draftsDir, `${draft.draftId}.json`)
    const tempPath = this.resolveWithinRoot(draftsDir, `${draft.draftId}.json.tmp`)
    for (const candidate of [draftPath, tempPath]) {
      if (fs.existsSync(candidate) && fs.lstatSync(candidate).isSymbolicLink()) {
        throw new Error('AI storage file must not be a symbolic link')
      }
    }
    fs.writeFileSync(tempPath, JSON.stringify(draft, null, 2), 'utf8')
    fs.renameSync(tempPath, draftPath)
    return draftPath
  }

  readMasterPlanDraft(projectId: string, draftId: string): AIMasterPlanDraft | null {
    this.validateProjectId(projectId)
    this.validateDraftId(draftId)
    const draftsDir = this.ensureDirectory('ai', 'master-plan-drafts', projectId)
    const draftPath = this.resolveWithinRoot(draftsDir, `${draftId}.json`)
    if (!fs.existsSync(draftPath)) return null
    if (fs.lstatSync(draftPath).isSymbolicLink()) {
      throw new Error('AI storage file must not be a symbolic link')
    }
    return JSON.parse(fs.readFileSync(draftPath, 'utf8')) as AIMasterPlanDraft
  }

  writeTaskSplitDraft(draft: AITaskSplitDraft): string {
    this.validateProjectId(draft.projectId)
    this.validateDraftId(draft.draftId)
    const draftsDir = this.ensureDirectory('ai', 'task-split-drafts', draft.projectId)
    const draftPath = this.resolveWithinRoot(draftsDir, `${draft.draftId}.json`)
    const tempPath = this.resolveWithinRoot(draftsDir, `${draft.draftId}.json.tmp`)
    for (const candidate of [draftPath, tempPath]) {
      if (fs.existsSync(candidate) && fs.lstatSync(candidate).isSymbolicLink()) {
        throw new Error('AI storage file must not be a symbolic link')
      }
    }
    fs.writeFileSync(tempPath, JSON.stringify(draft, null, 2), 'utf8')
    fs.renameSync(tempPath, draftPath)
    return draftPath
  }

  readTaskSplitDraft(projectId: string, draftId: string): AITaskSplitDraft | null {
    this.validateProjectId(projectId)
    this.validateDraftId(draftId)
    const draftsDir = this.ensureDirectory('ai', 'task-split-drafts', projectId)
    const draftPath = this.resolveWithinRoot(draftsDir, `${draftId}.json`)
    if (!fs.existsSync(draftPath)) return null
    if (fs.lstatSync(draftPath).isSymbolicLink()) {
      throw new Error('AI storage file must not be a symbolic link')
    }
    return JSON.parse(fs.readFileSync(draftPath, 'utf8')) as AITaskSplitDraft
  }

  writeTaskStatusReviewDraft(draft: TaskStatusReviewDraft): string {
    this.validateProjectId(draft.projectId)
    this.validateDraftId(draft.draftId)
    const draftsDir = this.ensureDirectory('ai', 'task-status-review-drafts', draft.projectId)
    const draftPath = this.resolveWithinRoot(draftsDir, `${draft.draftId}.json`)
    const tempPath = this.resolveWithinRoot(draftsDir, `${draft.draftId}.json.tmp`)
    for (const candidate of [draftPath, tempPath]) {
      if (fs.existsSync(candidate) && fs.lstatSync(candidate).isSymbolicLink()) {
        throw new Error('AI storage file must not be a symbolic link')
      }
    }
    fs.writeFileSync(tempPath, JSON.stringify(draft, null, 2), 'utf8')
    fs.renameSync(tempPath, draftPath)
    return draftPath
  }

  readTaskStatusReviewDraft(projectId: string, draftId: string): TaskStatusReviewDraft | null {
    this.validateProjectId(projectId)
    this.validateDraftId(draftId)
    const draftsDir = this.ensureDirectory('ai', 'task-status-review-drafts', projectId)
    const draftPath = this.resolveWithinRoot(draftsDir, `${draftId}.json`)
    if (!fs.existsSync(draftPath)) return null
    if (fs.lstatSync(draftPath).isSymbolicLink()) {
      throw new Error('AI storage file must not be a symbolic link')
    }
    return JSON.parse(fs.readFileSync(draftPath, 'utf8')) as TaskStatusReviewDraft
  }

  /** Append-only per-work-item review history, mirroring the report-history pattern. */
  readTaskReviews(projectId: string, workItemId: string): TaskReview[] {
    const reviewsPath = this.taskReviewsPath(projectId, workItemId)
    if (!fs.existsSync(reviewsPath)) return []
    if (fs.lstatSync(reviewsPath).isSymbolicLink()) {
      throw new Error('AI storage file must not be a symbolic link')
    }
    return JSON.parse(fs.readFileSync(reviewsPath, 'utf8')) as TaskReview[]
  }

  appendTaskReview(projectId: string, workItemId: string, review: TaskReview): void {
    const history = this.readTaskReviews(projectId, workItemId)
    history.push(review)
    this.writeTaskReviews(projectId, workItemId, history)
  }

  /** Updates one review entry in place (annotate/accept/dismiss), keeping the append-only history otherwise intact. */
  updateTaskReview(projectId: string, workItemId: string, review: TaskReview): void {
    const history = this.readTaskReviews(projectId, workItemId)
    const index = history.findIndex((candidate) => candidate.id === review.id)
    if (index === -1) throw new Error('Task review not found')
    history[index] = review
    this.writeTaskReviews(projectId, workItemId, history)
  }

  private writeTaskReviews(projectId: string, workItemId: string, history: TaskReview[]): void {
    this.validateProjectId(projectId)
    if (!/^[a-f0-9-]{36}$/.test(workItemId)) {
      throw new Error('Invalid planning work item identifier')
    }
    const reviewsDir = this.ensureDirectory('ai', 'task-reviews', projectId)
    const reviewsPath = this.resolveWithinRoot(reviewsDir, `${workItemId}.json`)
    const tempPath = this.resolveWithinRoot(reviewsDir, `${workItemId}.json.tmp`)
    for (const candidate of [reviewsPath, tempPath]) {
      if (fs.existsSync(candidate) && fs.lstatSync(candidate).isSymbolicLink()) {
        throw new Error('AI storage file must not be a symbolic link')
      }
    }
    fs.writeFileSync(tempPath, JSON.stringify(history, null, 2), 'utf8')
    fs.renameSync(tempPath, reviewsPath)
  }

  private taskReviewsPath(projectId: string, workItemId: string): string {
    this.validateProjectId(projectId)
    if (!/^[a-f0-9-]{36}$/.test(workItemId)) {
      throw new Error('Invalid planning work item identifier')
    }
    const reviewsDir = this.ensureDirectory('ai', 'task-reviews', projectId)
    return this.resolveWithinRoot(reviewsDir, `${workItemId}.json`)
  }

  private planningDraftPath(projectId: string, goalId: string): string {
    this.validateProjectId(projectId)
    if (!/^[a-f0-9-]{36}$/.test(goalId)) {
      throw new Error('Invalid planning goal identifier')
    }
    const draftsDir = this.ensureDirectory('ai', 'planning-drafts', projectId)
    return this.resolveWithinRoot(draftsDir, `${goalId}.json`)
  }

  private validateProjectId(projectId: string): void {
    validateProjectId(projectId)
  }

  private validateDraftId(draftId: string): void {
    if (
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(draftId)
    ) {
      throw new Error('Invalid AI draft identifier')
    }
  }

  /** Typed to the shared list, so a directory written here is one removal also covers. */
  private ensureDirectory(area: 'ai', name: AIStorageDirectory, projectId: string): string {
    return ensureDirectory(this.root, [area, name, projectId])
  }

  private resolveWithinRoot(parent: string, child: string): string {
    return resolveWithinRoot(this.root, parent, child)
  }
}
