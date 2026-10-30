import type Database from 'better-sqlite3'
import type {
  AiFieldFillInput,
  AiFieldFillResult,
  AiFieldFillUndo,
  PlanningActor,
  PlanningChangeField,
  PlanningFieldValue,
  PlanningTaskType,
  PlanningWorkItem
} from '@shared/ostler-api'
import { isAiField, MAX_AI_FILL_BATCH } from '@shared/planning/ai-fields'
import { taskTypeOf, typeShowsField } from '@shared/task-type-fields'
import { Refusal } from '@shared/refusal'
import { t } from '@shared/i18n'
import type { PlanningFields } from './planning-fields'

export interface PlanningAiFillsDeps {
  fields: PlanningFields
  getWorkItem(workItemId: string): PlanningWorkItem | null
  listTaskTypes(projectId: string): PlanningTaskType[]
  recordChange(
    item: Pick<PlanningWorkItem, 'id' | 'projectId'>,
    field: PlanningChangeField,
    from: unknown,
    to: unknown,
    actor: PlanningActor,
    at: number
  ): void
  reindexTask(workItemId: string): void
  changed(projectId: string): void
}

const SOURCE_HASH = /^[0-9a-f]{8}$/

/**
 * Saving Ostler AI's values for an AI field (N8.4). Ostler AI itself never
 * calls this: it only suggests (`AIPlanningService.suggestAiFieldValue`),
 * and this runs when the person clicks Fill with AI, for one task or a
 * batch. One call is one transaction and one undo (`restore`), and each task
 * filled gets one "Ostler AI filled Room" in its activity. A value the person
 * entered is kept unless they confirmed replacing it.
 */
export class PlanningAiFills {
  constructor(
    private readonly db: Database.Database,
    private readonly deps: PlanningAiFillsDeps
  ) {}

  apply(
    projectId: string,
    fieldId: string,
    fills: AiFieldFillInput[],
    options: { replacePersonValues?: boolean } = {}
  ): AiFieldFillResult {
    const field = this.deps.fields.getForProject(projectId, fieldId)
    if (!isAiField(field))
      throw new Refusal(t('errors:aiFields.notAnAiField', { name: field.name }))
    if (!Array.isArray(fills)) throw new Refusal(t('errors:aiFields.unusable'))
    if (fills.length > MAX_AI_FILL_BATCH)
      throw new Refusal(t('errors:aiFields.tooMany', { max: MAX_AI_FILL_BATCH }))
    const replace = options?.replacePersonValues === true
    const types = this.deps.listTaskTypes(projectId)
    const actor: PlanningActor = { kind: 'ostler-ai' }
    const result: AiFieldFillResult = {
      filled: [],
      skipped: [],
      before: { fieldId: field.id, values: [] }
    }
    this.db.transaction(() => {
      const now = Date.now()
      for (const fill of fills) {
        const workItemId = typeof fill?.workItemId === 'string' ? fill.workItemId : ''
        const item = workItemId ? this.deps.getWorkItem(workItemId) : null
        if (!item || item.projectId !== projectId || item.deletedAt) {
          result.skipped.push({ workItemId, reason: 'notFound' })
          continue
        }
        // Only the fields a task's type shows (N2.7b).
        if (!typeShowsField(taskTypeOf(types, item.typeId), field.id)) {
          result.skipped.push({ workItemId, reason: 'hidden' })
          continue
        }
        if (fill.value === null || fill.value === undefined) continue
        if (typeof fill.sourceHash !== 'string' || !SOURCE_HASH.test(fill.sourceHash))
          throw new Refusal(t('errors:aiFields.unusable'))
        const current = item.fieldValues?.[field.id]
        const currentFill = item.fieldFills?.[field.id]
        const personValue = current !== undefined && currentFill?.filledBy !== 'ostler-ai'
        if (personValue && !replace) {
          result.skipped.push({ workItemId, reason: 'personValue' })
          continue
        }
        // Checked against the field's type, as every other write is.
        const values = this.deps.fields.validate(projectId, { [field.id]: fill.value })
        result.before.values.push({
          workItemId,
          value: current ?? null,
          filledBy: currentFill?.filledBy ?? 'person',
          sourceHash: currentFill?.sourceHash ?? null
        })
        this.deps.fields.write(projectId, workItemId, values, {
          filledBy: 'ostler-ai',
          sourceHash: fill.sourceHash
        })
        this.deps.recordChange(
          item,
          'aiFilled',
          undefined,
          { fieldId: field.id, name: field.name },
          actor,
          now
        )
        if (field.type === 'text') this.deps.reindexTask(workItemId)
        result.filled.push(workItemId)
      }
    })()
    if (result.filled.length > 0) this.deps.changed(projectId)
    return result
  }

  /** Undoes `apply`: every value, and who filled it, as it was before. */
  restore(projectId: string, undo: AiFieldFillUndo): string[] {
    const field = this.deps.fields.getForProject(projectId, undo?.fieldId)
    const restored: string[] = []
    this.db.transaction(() => {
      for (const entry of Array.isArray(undo.values) ? undo.values : []) {
        const item =
          typeof entry?.workItemId === 'string' ? this.deps.getWorkItem(entry.workItemId) : null
        if (!item || item.projectId !== projectId) continue
        const values = this.deps.fields.validate(projectId, {
          [field.id]: (entry.value ?? null) as PlanningFieldValue | null
        })
        const ostlerAi = entry.filledBy === 'ostler-ai'
        this.deps.fields.write(projectId, item.id, values, {
          filledBy: ostlerAi ? 'ostler-ai' : 'person',
          sourceHash:
            ostlerAi && typeof entry.sourceHash === 'string' && SOURCE_HASH.test(entry.sourceHash)
              ? entry.sourceHash
              : null
        })
        if (field.type === 'text') this.deps.reindexTask(item.id)
        restored.push(item.id)
      }
    })()
    if (restored.length > 0) this.deps.changed(projectId)
    return restored
  }
}
