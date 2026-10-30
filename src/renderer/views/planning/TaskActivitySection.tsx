import { useState } from 'react'
import type { ActivityFilter, PlanningWorkItem } from '@shared/ostler-api'
import { useActivityFeed } from '../../hooks/planning/useActivityFeed'
import { Button, InlineAlert, SegmentedControl, Skeleton } from '../../ui'
import { ActivityList, CommentComposer, type CommentQuote } from './ActivityList'
import { CommentSummaryPanel } from './CommentSummaryPanel'
import { TaskDrawerSection } from './TaskDrawerSection'
import { t } from '@shared/i18n'

const PAGE_SIZE = 20

const FILTER_OPTIONS: { value: ActivityFilter; label: string }[] = [
  {
    value: 'all',
    get label() {
      return t('tasks:taskActivitySection.all')
    }
  },
  {
    value: 'comments',
    get label() {
      return t('tasks:taskActivitySection.comments')
    }
  },
  {
    value: 'changes',
    get label() {
      return t('tasks:taskActivitySection.changes')
    }
  }
]

const EMPTY_TEXT: Record<ActivityFilter, string> = {
  get all() {
    return t('tasks:taskActivitySection.nothingHasHappenedTask')
  },
  get comments() {
    return t('tasks:taskActivitySection.noCommentsYetWrite')
  },
  get changes() {
    return t('tasks:taskActivitySection.noChangesYet')
  }
}

/**
 * The drawer's Activity section (P5.2): the comment box, then the task's
 * merged history (comments, changes, status moves and agent runs), newest
 * first, with an All, Comments or Changes filter.
 */
export function TaskActivitySection({ item }: { item: PlanningWorkItem }) {
  const [filter, setFilter] = useState<ActivityFilter>('all')
  const [error, setError] = useState<string | null>(null)
  const [quote, setQuote] = useState<CommentQuote | null>(null)
  const feed = useActivityFeed({
    projectId: item.projectId,
    workItemId: item.id,
    filter,
    pageSize: PAGE_SIZE
  })

  return (
    <TaskDrawerSection
      title={t('tasks:taskActivitySection.activity')}
      className="task-activity"
      actions={
        <SegmentedControl
          label={t('tasks:taskActivitySection.show')}
          size="sm"
          value={filter}
          onChange={setFilter}
          options={FILTER_OPTIONS}
        />
      }
    >
      <CommentComposer
        projectId={item.projectId}
        quote={quote}
        onSubmit={async (body) => {
          const result = await window.ostlerAPI.addPlanningComment(item.id, body)
          if (!result.ok) {
            setError(result.error)
            return false
          }
          setError(null)
          void feed.reload()
          return true
        }}
      />
      {(error ?? feed.error) && (
        <InlineAlert tone="danger" onDismiss={error ? () => setError(null) : undefined}>
          {error ?? t('tasks:taskActivitySection.couldntLoadTasksActivity', { error: feed.error })}
        </InlineAlert>
      )}
      <CommentSummaryPanel item={item} entries={feed.entries} onAdded={() => void feed.reload()} />
      {feed.loading ? (
        <Skeleton lines={3} />
      ) : feed.entries.length === 0 ? (
        <p className="task-drawer__muted">{EMPTY_TEXT[filter]}</p>
      ) : (
        <ActivityList
          entries={feed.entries}
          projectId={item.projectId}
          onQuote={(text, author) =>
            setQuote((current) => ({ text, author, nonce: (current?.nonce ?? 0) + 1 }))
          }
          onChanged={() => void feed.reload()}
          onError={setError}
        />
      )}
      {feed.hasMore && (
        <Button
          size="sm"
          variant="ghost"
          className="activity-more"
          loading={feed.loadingMore}
          onClick={() => void feed.loadMore()}
        >
          {t('tasks:taskActivitySection.showOlderActivity')}
        </Button>
      )}
    </TaskDrawerSection>
  )
}
