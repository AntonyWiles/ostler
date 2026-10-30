import { useEffect, useId, useState } from 'react'
import type { AILibraryGoalProposal, LibraryItem, PlanningGoal } from '@shared/ostler-api'
import {
  Badge,
  Button,
  Dialog,
  InlineAlert,
  SegmentedControl,
  Select,
  TextArea,
  TextField
} from '../../../ui'
import { Sparkles } from '../../../ui/icons'
import { AiWarnings } from '../../../components/AiByline'
import '../../planning/planning-dialogs.css'
import { t } from '@shared/i18n'

interface LibraryPlanWorkModalProps {
  projectId: string
  /** The Library selection, in selection order. */
  items: LibraryItem[]
  onClose(): void
  /** The goal to plan, created or picked, with the AI-readable selection. */
  onReady(goal: PlanningGoal, sourceIds: string[]): void
}

/**
 * "Plan work from these": one AI call proposes a goal from the selection. The
 * human edits it or picks an existing goal; the goal is created only when they
 * confirm, and then the Agent Plan wizard opens with the selection as sources.
 */
export function LibraryPlanWorkModal({
  projectId,
  items,
  onClose,
  onReady
}: LibraryPlanWorkModalProps) {
  const readable = items.filter((item) => item.aiAccess !== 'human-only' && !item.archivedAt)
  const skipped = items.length - readable.length
  const [goals, setGoals] = useState<PlanningGoal[]>([])
  const [mode, setMode] = useState<'new' | 'existing'>('new')
  const [existingId, setExistingId] = useState('')
  const [proposal, setProposal] = useState<AILibraryGoalProposal | null>(null)
  const [title, setTitle] = useState('')
  const [outcome, setOutcome] = useState('')
  const [proposing, setProposing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void window.ostlerAPI.getPlanningGoals(projectId).then((result) => {
      if (!result.ok) return
      const active = result.value.filter((goal) => goal.status === 'active')
      setGoals(active)
      if (active[0]) setExistingId(active[0].id)
    })
  }, [projectId])

  const propose = async () => {
    setProposing(true)
    setError(null)
    try {
      const result = await window.ostlerAPI.proposeAIGoalFromLibrary(
        projectId,
        readable.map((item) => item.id)
      )
      if (!result.ok) {
        setError(result.error)
        return
      }
      setProposal(result.value)
      setTitle(result.value.title)
      setOutcome(result.value.outcome)
    } finally {
      setProposing(false)
    }
  }

  // One call when the dialog opens; the human can ask again.
  useEffect(() => {
    if (readable.length > 0) void propose()
  }, [])

  const confirm = async () => {
    const sourceIds = readable.map((item) => item.id)
    if (mode === 'existing') {
      const goal = goals.find((candidate) => candidate.id === existingId)
      if (goal) onReady(goal, sourceIds)
      return
    }
    if (!title.trim()) {
      setError(t('library:libraryPlanWorkModal.giveGoalTitle'))
      return
    }
    setSaving(true)
    setError(null)
    try {
      const result = await window.ostlerAPI.createPlanningGoal(projectId, {
        title: title.trim(),
        outcome: outcome.trim()
      })
      if (!result.ok) {
        setError(result.error)
        return
      }
      onReady(result.value, sourceIds)
    } finally {
      setSaving(false)
    }
  }

  const busy = proposing || saving
  const canConfirm =
    readable.length > 0 &&
    !busy &&
    (mode === 'existing' ? Boolean(existingId) : Boolean(title.trim()))

  const formId = useId()

  return (
    <Dialog
      open
      onClose={onClose}
      canDismiss={!busy}
      title={t('library:libraryPlanWorkModal.planWorkThese')}
      description={t('library:libraryPlanWorkModal.ostlerAiProposesGoal')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            {t('library:libraryPlanWorkModal.cancel')}
          </Button>
          <Button
            type="submit"
            form={formId}
            variant="primary"
            loading={saving}
            disabled={!canConfirm}
          >
            {saving
              ? t('library:libraryPlanWorkModal.creatingGoal')
              : mode === 'new'
                ? t('library:libraryPlanWorkModal.createGoalPlan')
                : t('library:libraryPlanWorkModal.planGoal')}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className="dialog-form"
        onSubmit={(event) => {
          event.preventDefault()
          void confirm()
        }}
      >
        <ul className="dialog-list">
          {items.map((item) => (
            <li key={item.id}>
              {item.title}{' '}
              {item.aiAccess === 'human-only' && (
                <Badge tone="warning">{t('library:libraryPlanWorkModal.notReadAi')}</Badge>
              )}
            </li>
          ))}
        </ul>
        {skipped > 0 && (
          <p className="dialog-muted">
            {t('library:libraryPlanWorkModal.humanOnlyArchivedItems', { count: skipped })}
          </p>
        )}

        <SegmentedControl
          label={t('library:libraryPlanWorkModal.goal')}
          value={mode}
          onChange={setMode}
          options={[
            { value: 'new', label: t('library:libraryPlanWorkModal.proposedGoal') },
            {
              value: 'existing',
              label: t('library:libraryPlanWorkModal.existingGoal'),
              disabled: goals.length === 0
            }
          ]}
        />

        {mode === 'new' ? (
          <>
            <TextField
              label={t('library:libraryPlanWorkModal.title')}
              value={title}
              maxLength={200}
              disabled={proposing}
              placeholder={
                proposing
                  ? t('library:libraryPlanWorkModal.ostlerAiProposingGoal')
                  : t('library:libraryPlanWorkModal.goalTitle')
              }
              onChange={(event) => setTitle(event.target.value)}
            />
            <TextArea
              label={t('library:libraryPlanWorkModal.outcome')}
              rows={3}
              value={outcome}
              disabled={proposing}
              onChange={(event) => setOutcome(event.target.value)}
            />
            {proposal && <AiWarnings warnings={proposal.warnings} />}
            <div>
              <Button
                variant="ai"
                size="sm"
                icon={Sparkles}
                loading={proposing}
                onClick={() => void propose()}
                disabled={busy || readable.length === 0}
              >
                {proposing
                  ? t('library:libraryPlanWorkModal.proposing')
                  : t('library:libraryPlanWorkModal.proposeAgain')}
              </Button>
            </div>
          </>
        ) : (
          <Select
            label={t('library:libraryPlanWorkModal.goal')}
            value={existingId}
            onChange={(event) => setExistingId(event.target.value)}
            options={goals.map((goal) => ({ value: goal.id, label: goal.title }))}
          />
        )}

        {error && <InlineAlert tone="danger">{error}</InlineAlert>}
      </form>
    </Dialog>
  )
}
