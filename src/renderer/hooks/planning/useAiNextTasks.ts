import { useState } from 'react'
import type { AINextTasksDraft } from '@shared/ostler-api'
import type { NextTaskReviewItem } from '../../views/project-detail/types'
import { assertResult } from '../../utils/unwrap-result'
import { t } from '@shared/i18n'

/**
 * The "generate the next five tasks" AI draft and its human review pass.
 * Extracted from useProjectPlanningTasks so Planning can run it directly
 * instead of only the project Agents tab.
 */
export function useAiNextTasks(projectId: string, onApproved: () => Promise<void> | void) {
  const [nextTasksDraft, setNextTasksDraft] = useState<AINextTasksDraft | null>(null)
  const [nextTaskReviews, setNextTaskReviews] = useState<NextTaskReviewItem[]>([])
  const [nextTasksBusy, setNextTasksBusy] = useState(false)
  const [nextTasksError, setNextTasksError] = useState<string | null>(null)

  const updateNextTaskReview = (suggestionIndex: number, updates: Partial<NextTaskReviewItem>) => {
    setNextTaskReviews((current) =>
      current.map((item) =>
        item.suggestionIndex === suggestionIndex ? { ...item, ...updates } : item
      )
    )
  }

  const closeNextTasksDraft = () => {
    setNextTasksDraft(null)
    setNextTaskReviews([])
    setNextTasksError(null)
  }

  const generateNextTasks = async () => {
    if (!projectId) return
    setNextTasksBusy(true)
    setNextTasksError(null)
    try {
      const result = await window.ostlerAPI.generateAINextTasks(projectId)
      assertResult(result)
      setNextTasksDraft(result.value)
      setNextTaskReviews(
        result.value.suggestions.map((suggestion, suggestionIndex) => ({
          suggestionIndex,
          included: true,
          title: suggestion.title,
          description: suggestion.description,
          priority: suggestion.priority,
          acceptanceCriteria: suggestion.acceptanceCriteria.join('\n'),
          milestoneId: '',
          status: 'backlog',
          attachments: suggestion.attachments ?? []
        }))
      )
    } catch (error) {
      setNextTasksError(
        error instanceof Error ? error.message : t('tasks:useAiNextTasks.couldntGenerateNextFive')
      )
    } finally {
      setNextTasksBusy(false)
    }
  }

  const approveNextTasks = async () => {
    if (!projectId || !nextTasksDraft) return
    const selected = nextTaskReviews.filter((item) => item.included)
    if (selected.length === 0) {
      setNextTasksError(t('tasks:useAiNextTasks.selectLeastOneTask'))
      return
    }
    setNextTasksBusy(true)
    setNextTasksError(null)
    try {
      const result = await window.ostlerAPI.approveAINextTasks(
        projectId,
        nextTasksDraft.draftId,
        selected.map((item) => ({
          suggestionIndex: item.suggestionIndex,
          title: item.title,
          description: item.description,
          priority: item.priority,
          acceptanceCriteria: item.acceptanceCriteria
            .split('\n')
            .map((criterion) => criterion.trim())
            .filter(Boolean),
          milestoneId: item.milestoneId || null,
          status: item.status,
          attachments: item.attachments
        }))
      )
      assertResult(result)
      await onApproved()
      setNextTasksDraft(null)
      setNextTaskReviews([])
    } catch (error) {
      setNextTasksError(
        error instanceof Error
          ? error.message
          : t('tasks:useAiNextTasks.couldntApproveSelectedTasks')
      )
    } finally {
      setNextTasksBusy(false)
    }
  }

  return {
    nextTasksDraft,
    nextTaskReviews,
    setNextTaskReviews,
    nextTasksBusy,
    nextTasksError,
    updateNextTaskReview,
    closeNextTasksDraft,
    generateNextTasks,
    approveNextTasks
  }
}
