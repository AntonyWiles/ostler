import { useEffect, useState } from 'react'
import type { PlanningWorkspace } from '../../hooks/usePlanningWorkspace'
import { AiByline, AiWarnings } from '../../components/AiByline'
import { Button, Dialog, InlineAlert } from '../../ui'
import { DecisionFields, type DecisionDraftFields } from './DecisionFields'
import './planning-dialogs.css'
import { t } from '@shared/i18n'

const EMPTY: DecisionDraftFields = {
  title: '',
  date: '',
  context: '',
  decision: '',
  alternativesConsidered: '',
  consequences: '',
  linkedWorkItemIds: []
}

/** Review and edit Ostler AI's decision draft; nothing is saved until Save decision. */
export function AiDecisionDialog({ ws }: { ws: PlanningWorkspace }) {
  const draft = ws.aiDecisionDraft
  const [fields, setFields] = useState<DecisionDraftFields>(EMPTY)

  useEffect(() => {
    if (draft) {
      setFields({
        title: draft.title,
        date: draft.date,
        context: draft.context,
        decision: draft.decision,
        alternativesConsidered: draft.alternativesConsidered,
        consequences: draft.consequences,
        linkedWorkItemIds: draft.linkedWorkItemIds
      })
    }
  }, [draft])

  if (!draft) return null

  return (
    <Dialog
      open
      size="lg"
      onClose={ws.closeAiDecisionDraft}
      canDismiss={!ws.busy}
      closeOnBackdrop={false}
      title={t('ai:aiDecisionDialog.reviewDraftedDecision')}
      description={t('ai:aiDecisionDialog.editAnythingWrongNothing')}
      footer={
        <>
          <Button onClick={ws.closeAiDecisionDraft} disabled={ws.busy}>
            {t('ai:aiDecisionDialog.discard')}
          </Button>
          <Button variant="primary" type="submit" form="ai-decision-form" loading={ws.busy}>
            {t('ai:aiDecisionDialog.saveDecision')}
          </Button>
        </>
      }
    >
      <form
        id="ai-decision-form"
        className="dialog-form"
        onSubmit={(event) => {
          event.preventDefault()
          void ws.approveAIDecision(fields)
        }}
      >
        <AiByline model={draft.model} at={draft.generatedAt} />
        {ws.error && <InlineAlert tone="danger">{ws.error}</InlineAlert>}
        {draft.rationale && <p>{draft.rationale}</p>}
        <AiWarnings warnings={draft.warnings} assumptions={draft.assumptions} />
        <DecisionFields
          value={fields}
          onChange={(patch) => setFields((current) => ({ ...current, ...patch }))}
          workItems={ws.workItems}
          projectId={ws.projectId}
          disabled={ws.busy}
        />
      </form>
    </Dialog>
  )
}
