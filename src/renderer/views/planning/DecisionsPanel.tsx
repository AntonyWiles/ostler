import { useState } from 'react'
import type { PlanningDecision } from '@shared/ostler-api'
import type { PlanningWorkspace } from '../../hooks/usePlanningWorkspace'
import { useFeatures } from '../../navigation/features'
import { Badge, Button, Card, Dialog, EmptyState, Menu, StatusBadge } from '../../ui'
import { Pencil, Plus, Scale, Trash2 } from '../../ui/icons'
import { SignOffSection } from './SignOffSection'
import { DecisionFields, type DecisionDraftFields } from './DecisionFields'
import { LinkedFrom } from '../../components/LinkedFrom'
import { usePins } from '../../pins/PinsProvider'
import './DecisionsPanel.css'
import { t } from '@shared/i18n'
import { formatDate } from '@shared/format'

/** A decision's date in words ("8 Oct 2026"), or the stored text when it is not a date. */
function decisionDate(value: string): string {
  const date = new Date(`${value}T00:00:00`)
  return Number.isNaN(date.getTime())
    ? value
    : formatDate(date, { day: 'numeric', month: 'short', year: 'numeric' })
}

/**
 * The decision log: a list (title, date, linked task count) beside the
 * selected decision's Context, Decision, Alternatives and Consequences.
 * Create and edit happen in a Dialog; delete asks first, as it can't be undone.
 */
export function DecisionsPanel({ ws }: { ws: PlanningWorkspace }) {
  const features = useFeatures()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected =
    ws.decisions.find((decision) => decision.id === selectedId) ?? ws.decisions[0] ?? null

  return (
    <section className="decisions" aria-label={t('tasks:decisionsPanel.decisionLog')}>
      <header className="decisions__header">
        <p className="decisions__intro">{t('tasks:decisionsPanel.recordDecisionsBehindProject')}</p>
        <div className="decisions__actions">
          {features.ai && (
            <Button variant="ai" loading={ws.busy} onClick={() => void ws.draftAIDecision()}>
              {t('tasks:decisionsPanel.draftAi')}
            </Button>
          )}
          <Button
            variant="primary"
            icon={Plus}
            disabled={ws.busy}
            onClick={() => ws.openDecisionCreate()}
          >
            {t('tasks:decisionsPanel.newDecision')}
          </Button>
        </div>
      </header>

      {ws.decisions.length === 0 ? (
        <EmptyState
          icon={Scale}
          title={t('tasks:decisionsPanel.noDecisionsYet')}
          description={t('tasks:decisionsPanel.decisionRecordKeepsReason')}
          action={
            <Button variant="primary" onClick={() => ws.openDecisionCreate()}>
              {t('tasks:decisionsPanel.recordDecision')}
            </Button>
          }
          secondaryAction={
            features.ai ? (
              <Button variant="ai" onClick={() => void ws.draftAIDecision()}>
                {t('tasks:decisionsPanel.draftNotesAi')}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="decisions__layout">
          <ul className="decisions__list" aria-label={t('tasks:decisionsPanel.decisions')}>
            {ws.decisions.map((decision) => {
              const isSelected = decision.id === selected?.id
              return (
                <li key={decision.id}>
                  <button
                    type="button"
                    className={`decisions__row${isSelected ? ' is-selected' : ''}`}
                    aria-current={isSelected || undefined}
                    onClick={() => setSelectedId(decision.id)}
                  >
                    <span className="decisions__row-title" title={decision.title}>
                      {decision.title}
                    </span>
                    <span className="decisions__row-meta">
                      {decisionDate(decision.date)} ·{' '}
                      {t('tasks:decisionsPanel.linkedTasks', {
                        count: decision.linkedWorkItemIds.length
                      })}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
          {selected && <DecisionDetail ws={ws} decision={selected} />}
        </div>
      )}

      {ws.editingDecision && <EditDecisionDialog ws={ws} />}
    </section>
  )
}

function DecisionDetail({ ws, decision }: { ws: PlanningWorkspace; decision: PlanningDecision }) {
  const pins = usePins()
  const linked = decision.linkedWorkItemIds
    .map((id) => ws.workItemsById.get(id))
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
  const fields: Array<[string, string]> = [
    [t('tasks:decisionsPanel.field.context'), decision.context],
    [t('tasks:decisionsPanel.field.decision'), decision.decision],
    [t('tasks:decisionsPanel.field.alternatives'), decision.alternativesConsidered],
    [t('tasks:decisionsPanel.field.consequences'), decision.consequences]
  ]
  return (
    <Card as="article" className="decisions__detail" aria-label={decision.title}>
      <header className="decisions__detail-head">
        <div className="decisions__detail-titles">
          <h2>{decision.title}</h2>
          <p className="decisions__muted">
            {decisionDate(decision.date)}
            {decision.origin === 'ai-approved' && (
              <>
                {' · '}
                <Badge tone="accent">{t('tasks:decisionsPanel.drafted')}</Badge>
              </>
            )}
          </p>
        </div>
        <div className="decisions__actions">
          <Button
            size="sm"
            icon={Pencil}
            disabled={ws.busy}
            onClick={() => ws.openDecisionEdit(decision)}
          >
            {t('tasks:decisionsPanel.edit')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={Trash2}
            disabled={ws.busy}
            onClick={() => void ws.deleteDecisionRecord(decision)}
          >
            {t('tasks:decisionsPanel.delete')}
          </Button>
          {pins.available && (
            <Menu
              label={t('tasks:decisionsPanel.moreActions', { title: decision.title })}
              placement="bottom-end"
              items={() =>
                pins.menuItems({
                  kind: 'decision',
                  targetId: decision.id,
                  projectId: decision.projectId,
                  title: decision.title
                })
              }
            />
          )}
        </div>
      </header>
      {fields.map(([label, text]) => (
        <section key={label} className="decisions__field">
          <h3>{label}</h3>
          {text ? (
            <p>{text}</p>
          ) : (
            <p className="decisions__muted">{t('tasks:decisionsPanel.notRecorded')}</p>
          )}
        </section>
      ))}
      <section className="decisions__field">
        <h3>{t('tasks:signOff.heading')}</h3>
        <SignOffSection
          projectId={decision.projectId}
          item={{ kind: 'decision', id: decision.id }}
        />
      </section>
      <section className="decisions__field">
        <h3>{t('tasks:decisionsPanel.linkedTasks')}</h3>
        {linked.length === 0 ? (
          <p className="decisions__muted">{t('tasks:decisionsPanel.noLinkedTasks')}</p>
        ) : (
          <ul className="decisions__linked">
            {linked.map((item) => (
              <li key={item.id}>
                <button type="button" onClick={() => ws.openWorkItem(item)}>
                  <StatusBadge status={item.status} columnId={item.columnId} iconOnly />
                  <span title={item.title}>{item.title}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </Card>
  )
}

/** Edit a decision record in a Dialog; the form state lives in `useDecisions`. */
function EditDecisionDialog({ ws }: { ws: PlanningWorkspace }) {
  const value: DecisionDraftFields = {
    title: ws.editDecisionTitle,
    date: ws.editDecisionDate,
    context: ws.editDecisionContext,
    decision: ws.editDecisionBody,
    alternativesConsidered: ws.editDecisionAlternatives,
    consequences: ws.editDecisionConsequences,
    linkedWorkItemIds: ws.editDecisionLinkedWorkItemIds
  }
  const onChange = (patch: Partial<DecisionDraftFields>) => {
    if (patch.title !== undefined) ws.setEditDecisionTitle(patch.title)
    if (patch.date !== undefined) ws.setEditDecisionDate(patch.date)
    if (patch.context !== undefined) ws.setEditDecisionContext(patch.context)
    if (patch.decision !== undefined) ws.setEditDecisionBody(patch.decision)
    if (patch.alternativesConsidered !== undefined)
      ws.setEditDecisionAlternatives(patch.alternativesConsidered)
    if (patch.consequences !== undefined) ws.setEditDecisionConsequences(patch.consequences)
    if (patch.linkedWorkItemIds !== undefined)
      ws.setEditDecisionLinkedWorkItemIds(patch.linkedWorkItemIds)
  }
  return (
    <Dialog
      open
      size="lg"
      onClose={ws.closeDecisionEdit}
      canDismiss={!ws.busy}
      closeOnBackdrop={false}
      title={t('tasks:decisionsPanel.editDecision')}
      footer={
        <>
          <Button onClick={ws.closeDecisionEdit} disabled={ws.busy}>
            {t('tasks:decisionsPanel.cancel')}
          </Button>
          <Button variant="primary" type="submit" form="edit-decision-form" loading={ws.busy}>
            {t('tasks:decisionsPanel.saveDecision')}
          </Button>
        </>
      }
    >
      <form
        id="edit-decision-form"
        className="dialog-form"
        onSubmit={(event) => void ws.saveDecisionEdit(event)}
      >
        <DecisionFields
          value={value}
          onChange={onChange}
          workItems={ws.workItems}
          projectId={ws.projectId}
          writingHelp={
            ws.editingDecision
              ? { projectId: ws.editingDecision.projectId, decisionId: ws.editingDecision.id }
              : undefined
          }
        />
      </form>
      {ws.editingDecision && (
        <LinkedFrom kind="decision" id={ws.editingDecision.id} onOpen={ws.closeDecisionEdit} />
      )}
    </Dialog>
  )
}
