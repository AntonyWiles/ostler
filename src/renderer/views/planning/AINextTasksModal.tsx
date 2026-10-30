import { AINextTasksDraft, PlanningMilestone, PlanningPriority } from '@shared/ostler-api'
import { TASK_PRIORITIES, taskPriorityLabel } from '@shared/task-labels'
import { NextTaskReviewItem } from '../project-detail/types'
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

interface AINextTasksModalProps {
  nextTasksDraft: AINextTasksDraft
  nextTaskReviews: NextTaskReviewItem[]
  nextTasksBusy: boolean
  nextTasksError: string | null
  planningMilestones: PlanningMilestone[]
  updateNextTaskReview: (suggestionIndex: number, updates: Partial<NextTaskReviewItem>) => void
  closeNextTasksDraft: () => void
  generateNextTasks: () => void
  approveNextTasks: () => void
}

const PRIORITY_OPTIONS = TASK_PRIORITIES.map((priority) => ({
  value: priority,
  get label() {
    return taskPriorityLabel(priority)
  }
}))

/** Review Ostler AI's next five tasks; approving creates tasks and never queues an agent. */
export function AINextTasksModal({
  nextTasksDraft,
  nextTaskReviews,
  nextTasksBusy,
  nextTasksError,
  planningMilestones,
  updateNextTaskReview,
  closeNextTasksDraft,
  generateNextTasks,
  approveNextTasks
}: AINextTasksModalProps) {
  const included = nextTaskReviews.filter((item) => item.included).length
  const missingTitle = nextTaskReviews.some((item) => item.included && !item.title.trim())
  const evidence = nextTasksDraft.evidenceSummary
  const milestoneOptions = [
    { value: '', label: t('ai:aINextTasksModal.noMilestone') },
    ...planningMilestones.map((milestone) => ({ value: milestone.id, label: milestone.name }))
  ]

  return (
    <Dialog
      open
      size="lg"
      onClose={closeNextTasksDraft}
      canDismiss={!nextTasksBusy}
      closeOnBackdrop={false}
      title={t('ai:aINextTasksModal.reviewSuggestedTasks')}
      description={t('ai:aINextTasksModal.tickEditEach')}
      footer={
        <>
          <Button onClick={closeNextTasksDraft} disabled={nextTasksBusy}>
            {t('ai:aINextTasksModal.cancel')}
          </Button>
          <Button variant="ai" disabled={nextTasksBusy} onClick={() => void generateNextTasks()}>
            {t('ai:aINextTasksModal.suggestAgain')}
          </Button>
          <AiTaskReviewAddButton
            count={included}
            missingTitle={missingTitle}
            loading={nextTasksBusy}
            onClick={() => void approveNextTasks()}
          />
        </>
      }
    >
      <div className="dialog-form">
        <AiByline model={nextTasksDraft.model} at={nextTasksDraft.generatedAt} />
        {nextTasksDraft.summary && <p>{nextTasksDraft.summary}</p>}
        <p className="dialog-muted">
          {t('ai:aINextTasksModal.readLast', {
            goalCount: evidence.goals,
            milestoneCount: evidence.milestones,
            taskCount: evidence.workItems,
            fileEventCount: evidence.watchEvents,
            commitCount: evidence.gitCommits,
            agentEventCount: evidence.harnessEvents,
            dayCount: evidence.windowDays
          })}
        </p>
        <AiWarnings warnings={nextTasksDraft.warnings} assumptions={nextTasksDraft.assumptions} />
        {nextTasksError && <InlineAlert tone="danger">{nextTasksError}</InlineAlert>}

        <AiTaskReviewList included={included} total={nextTaskReviews.length}>
          {nextTaskReviews.map((review) => {
            const source = nextTasksDraft.suggestions[review.suggestionIndex]
            const locked = nextTasksBusy || !review.included
            const update = (updates: Partial<NextTaskReviewItem>) =>
              updateNextTaskReview(review.suggestionIndex, updates)
            return (
              <AiTaskReviewItem
                key={review.suggestionIndex}
                name={aiSuggestionName(review.suggestionIndex)}
                included={review.included}
                onToggle={(next) => update({ included: next })}
                title={review.title}
                onTitleChange={(title) => update({ title })}
                details={review.description}
                onDetailsChange={(description) => update({ description })}
                disabled={nextTasksBusy}
              >
                {source.rationale && <p className="dialog-muted">{source.rationale}</p>}
                <div className="dialog-form__row">
                  <Select
                    label={t('ai:aINextTasksModal.priority')}
                    value={review.priority}
                    disabled={locked}
                    options={PRIORITY_OPTIONS}
                    onChange={(event) =>
                      update({ priority: event.target.value as PlanningPriority })
                    }
                  />
                  <Select
                    label={t('ai:aINextTasksModal.initialStatus')}
                    value={review.status}
                    disabled={locked}
                    options={[
                      { value: 'backlog', label: t('ai:aINextTasksModal.backlog') },
                      { value: 'ready', label: t('ai:aINextTasksModal.ready') }
                    ]}
                    onChange={(event) =>
                      update({ status: event.target.value as 'backlog' | 'ready' })
                    }
                  />
                  <Select
                    label={t('ai:aINextTasksModal.milestone')}
                    value={review.milestoneId}
                    disabled={locked}
                    options={milestoneOptions}
                    onChange={(event) => update({ milestoneId: event.target.value })}
                  />
                </div>
                <TextArea
                  label={t('ai:aINextTasksModal.checklist')}
                  hint={t('ai:aINextTasksModal.oneObservableConditionPer')}
                  rows={3}
                  value={review.acceptanceCriteria}
                  disabled={locked}
                  onChange={(event) => update({ acceptanceCriteria: event.target.value })}
                />
                <ProposedAttachments
                  projectId={nextTasksDraft.projectId}
                  proposed={source.attachments}
                  selected={review.attachments}
                  disabled={locked}
                  onChange={(ids) => update({ attachments: ids })}
                />
                {source.evidence.length > 0 && (
                  <details className="dialog-disclosure">
                    <summary>{t('ai:aINextTasksModal.whyOstlerAiSuggested')}</summary>
                    <ul className="dialog-list">
                      {source.evidence.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </AiTaskReviewItem>
            )
          })}
        </AiTaskReviewList>
      </div>
    </Dialog>
  )
}
