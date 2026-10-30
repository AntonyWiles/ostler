import { useEffect, useState } from 'react'
import type { PlanningPriority } from '@shared/ostler-api'
import { TASK_PRIORITIES, taskPriorityLabel } from '@shared/task-labels'
import type { PlanningWorkspace } from '../../hooks/usePlanningWorkspace'
import { ProposedAttachments } from '../../components/ProposedAttachments'
import { AiByline, AiWarnings } from '../../components/AiByline'
import {
  AiTaskReviewAddButton,
  AiTaskReviewItem,
  AiTaskReviewList,
  aiSuggestionName
} from '../../components/AiTaskReview'
import { Button, Dialog, InlineAlert, Select, TextArea } from '../../ui'
import './planning-dialogs.css'
import { t } from '@shared/i18n'

const PRIORITY_OPTIONS = TASK_PRIORITIES.map((priority) => ({
  value: priority,
  get label() {
    return taskPriorityLabel(priority)
  }
}))

/** Review Ostler AI's breakdown of a goal; only the ticked suggestions become backlog tasks. */
export function AiBreakdownDialog({ ws }: { ws: PlanningWorkspace }) {
  // Per suggestion index, the proposed attachments the human left ticked.
  const [attachments, setAttachments] = useState<Record<number, string[]>>({})
  const draftKey = ws.aiDraft?.generatedAt
  useEffect(() => setAttachments({}), [draftKey])
  if (!ws.aiDraft) return null
  const aiDraft = ws.aiDraft
  const count = ws.selectedSuggestions.length
  const missingTitle = ws.selectedSuggestions.some(
    (index) => !aiDraft.suggestions[index]?.title.trim()
  )

  return (
    <Dialog
      open
      size="lg"
      onClose={ws.closeAiDraft}
      canDismiss={!ws.busy}
      closeOnBackdrop={false}
      title={t('ai:aiBreakdownDialog.breakDown', { aiGoalTitle: ws.aiGoalTitle })}
      description={t('ai:aiBreakdownDialog.tickEditEach')}
      footer={
        <>
          <Button onClick={ws.closeAiDraft} disabled={ws.busy}>
            {t('ai:aiBreakdownDialog.cancel')}
          </Button>
          <AiTaskReviewAddButton
            count={count}
            missingTitle={missingTitle}
            loading={ws.busy}
            onClick={() => void ws.addAiSuggestions(attachments)}
          />
        </>
      }
    >
      <div className="dialog-form">
        <AiByline model={aiDraft.model} at={aiDraft.generatedAt} />
        {ws.error && <InlineAlert tone="danger">{ws.error}</InlineAlert>}
        {aiDraft.summary && <p>{aiDraft.summary}</p>}
        <AiWarnings warnings={aiDraft.warnings} assumptions={aiDraft.assumptions} />
        {aiDraft.suggestions.length === 0 ? (
          <p className="dialog-muted">{t('ai:aiBreakdownDialog.ostlerAiDidNot')}</p>
        ) : (
          <AiTaskReviewList included={count} total={aiDraft.suggestions.length}>
            {aiDraft.suggestions.map((suggestion, index) => {
              const included = ws.selectedSuggestions.includes(index)
              const locked = ws.busy || !included
              return (
                <AiTaskReviewItem
                  key={`${index}`}
                  name={aiSuggestionName(index)}
                  included={included}
                  onToggle={(next) =>
                    ws.setSelectedSuggestions((current) =>
                      next ? [...current, index] : current.filter((value) => value !== index)
                    )
                  }
                  title={suggestion.title}
                  onTitleChange={(title) => ws.updateAiSuggestion(index, { title })}
                  details={suggestion.description}
                  onDetailsChange={(description) => ws.updateAiSuggestion(index, { description })}
                  disabled={ws.busy}
                  fields={
                    <Select
                      label={t('ai:aiBreakdownDialog.suggestionPriority', { number: index + 1 })}
                      value={suggestion.priority}
                      disabled={locked}
                      options={PRIORITY_OPTIONS}
                      onChange={(event) =>
                        ws.updateAiSuggestion(index, {
                          priority: event.target.value as PlanningPriority
                        })
                      }
                    />
                  }
                >
                  <TextArea
                    label={t('ai:aiBreakdownDialog.suggestionChecklist', { number: index + 1 })}
                    hint={t('ai:aiBreakdownDialog.oneThingCheckPer')}
                    value={suggestion.acceptanceCriteria.join('\n')}
                    disabled={locked}
                    rows={2}
                    onChange={(event) =>
                      ws.updateAiSuggestion(index, {
                        acceptanceCriteria: event.target.value.split('\n')
                      })
                    }
                  />
                  {suggestion.rationale && <p className="dialog-muted">{suggestion.rationale}</p>}
                  {suggestion.evidence.length > 0 && (
                    <p className="dialog-muted">
                      {t('ai:aiBreakdownDialog.evidence', {
                        join: suggestion.evidence.join(' · ')
                      })}
                    </p>
                  )}
                  <ProposedAttachments
                    projectId={aiDraft.projectId}
                    proposed={suggestion.attachments}
                    selected={attachments[index] ?? suggestion.attachments ?? []}
                    disabled={locked}
                    onChange={(ids) => setAttachments((current) => ({ ...current, [index]: ids }))}
                  />
                </AiTaskReviewItem>
              )
            })}
          </AiTaskReviewList>
        )}
      </div>
    </Dialog>
  )
}
