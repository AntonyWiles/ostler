import type { PlanningWorkItem } from '@shared/ostler-api'
import type { PlanningWorkspace } from '../../hooks/usePlanningWorkspace'
import { useFeatures } from '../../navigation/features'
import { NeedsYouList, type NeedsYouItem } from '../../components/NeedsYouList'
import { Card, Section, StatusBadge } from '../../ui'
import { CircleCheck, Icon } from '../../ui/icons'
import { AgentQuestionsPanel } from './AgentQuestionsPanel'
import { BlockersPanel } from './BlockersPanel'
import { t } from '@shared/i18n'

/** What waits for the human in this project: the same list Home shows. */
export function needsYouItems(ws: PlanningWorkspace, agents: boolean): NeedsYouItem[] {
  return [
    ...ws.blockedNow.map((item): NeedsYouItem => ({
      id: `blocked:${item.id}`,
      kind: 'blocked',
      title: item.title,
      onOpen: () => ws.openWorkItem(item)
    })),
    ...(agents
      ? [
          ...ws.pendingQuestions.map((question): NeedsYouItem => ({
            id: `question:${question.id}`,
            kind: 'question',
            title: question.question,
            context: t('tasks:overviewWork.answerBelow')
          })),
          ...ws.reviewSessions.map((session): NeedsYouItem => ({
            id: `review:${session.id}`,
            kind: 'review',
            title: session.title,
            context: t('tasks:overviewWork.acceptDiscardChanges'),
            onOpen: () => ws.openSessionWorkItem(session)
          }))
        ]
      : [])
  ]
}

/**
 * Needs you: blocked tasks, and with agents on their questions, reported
 * blockers and changes to review. The Overview shows it first, above the
 * numbers, because it is what someone opening a project has to act on.
 */
export function OverviewNeedsYou({ ws }: { ws: PlanningWorkspace }) {
  const features = useFeatures()
  const needsYou = needsYouItems(ws, features.agents)

  return (
    <Section title={t('tasks:overviewWork.needs')}>
      {needsYou.length === 0 ? (
        <Card>
          <p className="overview-quiet">
            <Icon icon={CircleCheck} />
            {features.agents
              ? t('tasks:overviewWork.nothingBlockedNoAgent')
              : t('tasks:overviewWork.nothingBlocked')}
          </p>
        </Card>
      ) : (
        <NeedsYouList items={needsYou} />
      )}
      {features.agents && <AgentQuestionsPanel ws={ws} />}
      {features.agents && <BlockersPanel ws={ws} projectId={ws.projectId} />}
    </Section>
  )
}

/** The Overview's work in hand: In progress, then Up next. */
export function OverviewWork({ ws }: { ws: PlanningWorkspace }) {
  const features = useFeatures()

  return (
    <>
      <Section title={t('tasks:overviewWork.progress')}>
        {ws.activeNow.length === 0 ? (
          <Card>
            <p className="overview-quiet">{t('tasks:overviewWork.noTasksProgress')}</p>
          </Card>
        ) : (
          <TaskRows
            label={t('tasks:overviewWork.progress')}
            items={ws.activeNow}
            hint={(item) => ws.executionLabel(item) ?? undefined}
            onOpen={ws.openWorkItem}
          />
        )}
      </Section>

      <Section
        title={t('tasks:overviewWork.upNext')}
        description={t('tasks:overviewWork.readyTasksWhatEach')}
      >
        {ws.readyNow.length === 0 ? (
          <Card>
            <p className="overview-quiet">{t('tasks:overviewWork.nothingReady')}</p>
          </Card>
        ) : (
          <TaskRows
            label={t('tasks:overviewWork.upNext')}
            items={ws.readyNow}
            hint={(item) => readyHint(ws.unmetDependencies(item).length, features.agents)}
            onOpen={ws.openWorkItem}
          />
        )}
      </Section>
    </>
  )
}

/** The dependency hint for a Ready task, in plain words. */
export function readyHint(waiting: number, agents: boolean): string {
  if (waiting === 0) return t('tasks:overviewWork.nothingWay')
  if (agents) return t('tasks:overviewWork.canQueuedNowStarts', { count: waiting })
  return t('tasks:overviewWork.waitingTasks', { count: waiting })
}

function TaskRows({
  label,
  items,
  hint,
  onOpen
}: {
  label: string
  items: PlanningWorkItem[]
  hint: (item: PlanningWorkItem) => string | undefined
  onOpen: (item: PlanningWorkItem) => void
}) {
  return (
    <ul className="overview-rows" aria-label={label}>
      {items.map((item) => {
        const text = hint(item)
        return (
          <li key={item.id}>
            <button type="button" className="overview-row" onClick={() => onOpen(item)}>
              <StatusBadge status={item.status} columnId={item.columnId} iconOnly />
              <span className="overview-row__title" title={item.title}>
                {item.title}
              </span>
              {text && <span className="overview-row__hint">{text}</span>}
            </button>
          </li>
        )
      })}
    </ul>
  )
}
