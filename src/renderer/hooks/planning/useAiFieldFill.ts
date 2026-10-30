import { useRef, useState } from 'react'
import type {
  AiFieldFillInput,
  PlanningFieldDefinition,
  PlanningTaskType,
  PlanningWorkItem
} from '@shared/ostler-api'
import { MAX_AI_FILL_BATCH } from '@shared/planning/ai-fields'
import { taskTypeOf, typeShowsField } from '@shared/task-type-fields'
import { useConfirm, useToast } from '../../ui'
import { t } from '@shared/i18n'

export interface AiFillProgress {
  fieldName: string
  done: number
  total: number
}

/**
 * Fill with AI (N8.4, N58 choice A), for one task in the drawer or for the
 * List's selected tasks: the person's click is what fills. Ostler AI is asked
 * one task at a time, and only suggests; the suggestions are saved together
 * in one call when the run ends (or is stopped), so a batch is one undo.
 * Values the person entered are replaced only once they confirm.
 */
export function useAiFieldFill({
  projectId,
  taskTypes,
  reload
}: {
  projectId: string
  taskTypes: readonly PlanningTaskType[]
  reload: () => Promise<unknown> | void
}) {
  const confirm = useConfirm()
  const { toast, toastUndo } = useToast()
  const [progress, setProgress] = useState<AiFillProgress | null>(null)
  const stopped = useRef(false)

  const fill = async (field: PlanningFieldDefinition, items: PlanningWorkItem[]) => {
    const shown = items.filter((item) =>
      typeShowsField(taskTypeOf(taskTypes, item.typeId), field.id)
    )
    if (shown.length === 0) return
    if (shown.length > MAX_AI_FILL_BATCH) {
      toast({ title: t('tasks:aiFields.tooMany', { max: MAX_AI_FILL_BATCH }), tone: 'warning' })
      return
    }
    const personValues = shown.filter(
      (item) =>
        item.fieldValues?.[field.id] !== undefined &&
        item.fieldFills?.[field.id]?.filledBy !== 'ostler-ai'
    )
    let replace = false
    if (personValues.length > 0)
      replace = await confirm({
        title: t('tasks:aiFields.replaceTitle', { count: personValues.length }),
        body: t('tasks:aiFields.replaceBody', { name: field.name }),
        confirmLabel: t('tasks:aiFields.replace'),
        cancelLabel: t('tasks:aiFields.keepMine')
      })
    const todo = replace ? shown : shown.filter((item) => !personValues.includes(item))
    if (todo.length === 0) {
      toast({ title: t('tasks:aiFields.nothingToFill') })
      return
    }

    stopped.current = false
    setProgress({ fieldName: field.name, done: 0, total: todo.length })
    const fills: AiFieldFillInput[] = []
    let notAnOption = 0
    let failure: string | null = null
    try {
      for (const [index, item] of todo.entries()) {
        if (stopped.current) break
        const result = await window.ostlerAPI.suggestAiFieldValue(projectId, item.id, field.id)
        if (!result.ok) {
          failure = result.error
          break
        }
        const suggestion = result.value
        if (suggestion.note === 'notAnOption') notAnOption++
        if (suggestion.value !== null)
          fills.push({
            workItemId: item.id,
            value: suggestion.value,
            sourceHash: suggestion.sourceHash
          })
        setProgress({ fieldName: field.name, done: index + 1, total: todo.length })
      }
      if (fills.length > 0) {
        const saved = await window.ostlerAPI.applyAiFieldFills(projectId, field.id, fills, {
          replacePersonValues: replace
        })
        if (!saved.ok) failure = saved.error
        else if (saved.value.filled.length > 0) {
          const { before, filled } = saved.value
          await reload()
          toastUndo(
            todo.length === 1
              ? t('tasks:aiFields.filled', { name: field.name })
              : t('tasks:aiFields.filledMany', { name: field.name, count: filled.length }),
            async () => {
              const undone = await window.ostlerAPI.restoreAiFieldFills(projectId, before)
              if (!undone.ok) toast({ title: undone.error, tone: 'danger' })
              await reload()
            },
            stopped.current ? t('tasks:aiFields.stopped') : undefined
          )
        }
      }
    } finally {
      setProgress(null)
    }
    if (failure)
      toast({
        title: t('tasks:aiFields.couldNotFill', { name: field.name }),
        body: failure,
        tone: 'danger'
      })
    if (notAnOption > 0)
      toast({
        title:
          todo.length === 1
            ? t('tasks:aiFields.notAnOption', { name: field.name })
            : t('tasks:aiFields.notAnOptionMany', { count: notAnOption }),
        tone: 'warning'
      })
    else if (!failure && fills.length === 0 && todo.length === 1)
      toast({ title: t('tasks:aiFields.noAnswer', { name: field.name }) })
  }

  return {
    /** Fills the field on these tasks, asking first before replacing the person's values. */
    fill,
    /** The run in progress, or null. */
    progress,
    /** Stops after the request in flight; what was filled so far is saved. */
    stop: () => {
      stopped.current = true
    }
  }
}
