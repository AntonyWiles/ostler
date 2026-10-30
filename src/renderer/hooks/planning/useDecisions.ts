import React, { useState } from 'react'
import { assertResult } from '../../utils/unwrap-result'
import { useConfirm } from '../../ui'
import type { PlanningDecision } from '@shared/ostler-api'
import type { PlanningRunner } from './usePlanningRunner'
import type { PlanningRecords } from './usePlanningRecords'
import type { PlanningCreateForm } from './usePlanningCreateForm'
import { t } from '@shared/i18n'

/**
 * The decision log: opening the create form for a decision, and editing or
 * deleting one. (AI decision drafts are `usePlanningAiDrafts`.) Depends on the
 * runner, records and create form.
 */
export function useDecisions(
  runner: PlanningRunner,
  records: PlanningRecords,
  createForm: PlanningCreateForm
) {
  const confirm = useConfirm()
  const { busy, setError } = runner
  const { runBusy } = runner.internal
  const { setDecisions } = records.internal

  const [editingDecision, setEditingDecision] = useState<PlanningDecision | null>(null)
  const [editDecisionTitle, setEditDecisionTitle] = useState('')
  const [editDecisionContext, setEditDecisionContext] = useState('')
  const [editDecisionBody, setEditDecisionBody] = useState('')
  const [editDecisionAlternatives, setEditDecisionAlternatives] = useState('')
  const [editDecisionConsequences, setEditDecisionConsequences] = useState('')
  const [editDecisionDate, setEditDecisionDate] = useState('')
  const [editDecisionLinkedWorkItemIds, setEditDecisionLinkedWorkItemIds] = useState<string[]>([])

  const openDecisionCreate = (linkedWorkItemId?: string) => {
    createForm.internal.resetCreateForm()
    if (linkedWorkItemId) {
      createForm.setDecisionLinkedWorkItemIds([linkedWorkItemId])
    }
    createForm.setCreateMode('decision')
  }

  const openDecisionEdit = (decision: PlanningDecision) => {
    setError(null)
    setEditingDecision(decision)
    setEditDecisionTitle(decision.title)
    setEditDecisionContext(decision.context)
    setEditDecisionBody(decision.decision)
    setEditDecisionAlternatives(decision.alternativesConsidered)
    setEditDecisionConsequences(decision.consequences)
    setEditDecisionDate(decision.date)
    setEditDecisionLinkedWorkItemIds(decision.linkedWorkItemIds)
  }

  const closeDecisionEdit = () => {
    if (!busy) {
      setEditingDecision(null)
    }
  }

  const saveDecisionEdit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!editingDecision) return
    await runBusy(t('tasks:useDecisions.couldntSaveDecisionTry'), async () => {
      const result = await window.ostlerAPI.updatePlanningDecision(editingDecision.id, {
        title: editDecisionTitle,
        context: editDecisionContext,
        decision: editDecisionBody,
        alternativesConsidered: editDecisionAlternatives,
        consequences: editDecisionConsequences,
        date: editDecisionDate || undefined,
        linkedWorkItemIds: editDecisionLinkedWorkItemIds
      })
      assertResult(result)
      setDecisions((current) => current.map((d) => (d.id === result.value.id ? result.value : d)))
      setEditingDecision(null)
    })
  }

  const deleteDecisionRecord = async (decision: PlanningDecision) => {
    const ok = await confirm({
      title: t('tasks:useDecisions.deleteDecision', { decisionTitle: decision.title }),
      body: t('tasks:useDecisions.removesRecordPermanently'),
      confirmLabel: t('tasks:useDecisions.deleteDecision2'),
      tone: 'danger'
    })
    if (!ok) return
    await runBusy(t('tasks:useDecisions.couldntDeleteDecisionTry'), async () => {
      const result = await window.ostlerAPI.deletePlanningDecision(decision.id)
      assertResult(result)
      setDecisions((current) => current.filter((d) => d.id !== decision.id))
      if (editingDecision?.id === decision.id) setEditingDecision(null)
    })
  }

  return {
    editingDecision,
    setEditingDecision,
    editDecisionTitle,
    setEditDecisionTitle,
    editDecisionContext,
    setEditDecisionContext,
    editDecisionBody,
    setEditDecisionBody,
    editDecisionAlternatives,
    setEditDecisionAlternatives,
    editDecisionConsequences,
    setEditDecisionConsequences,
    editDecisionDate,
    setEditDecisionDate,
    editDecisionLinkedWorkItemIds,
    setEditDecisionLinkedWorkItemIds,
    openDecisionCreate,
    openDecisionEdit,
    closeDecisionEdit,
    saveDecisionEdit,
    deleteDecisionRecord
  }
}
