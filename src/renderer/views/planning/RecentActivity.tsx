import { useState } from 'react'
import type { PlanningWorkspace } from '../../hooks/usePlanningWorkspace'
import { useActivityFeed } from '../../hooks/planning/useActivityFeed'
import { Button, InlineAlert, Section, Skeleton } from '../../ui'
import { ActivityList } from './ActivityList'
import { t } from '@shared/i18n'

const PAGE_SIZE = 15

/**
 * Overview's "Recent activity" (P5.2): the project's last 15 entries across
 * every task, with "Show more". Each entry names its task, which opens it;
 * one action on many tasks (a template, an import) is one row that expands.
 */
export function RecentActivity({ ws }: { ws: PlanningWorkspace }) {
  const [error, setError] = useState<string | null>(null)
  const feed = useActivityFeed({ projectId: ws.projectId, workItemId: null, pageSize: PAGE_SIZE })
  const findTask = (workItemId: string) => ws.workItems.find((item) => item.id === workItemId)

  return (
    <Section title={t('tasks:recentActivity.recentActivity')} className="recent-activity">
      {(error ?? feed.error) && (
        <InlineAlert tone="danger">
          {error ?? t('tasks:recentActivity.couldntLoadRecentActivity', { error: feed.error })}
        </InlineAlert>
      )}
      {feed.loading ? (
        <Skeleton lines={4} />
      ) : feed.entries.length === 0 ? (
        <p className="overview-muted">{t('tasks:recentActivity.nothingHasHappenedYet')}</p>
      ) : (
        <ActivityList
          entries={feed.entries}
          grouped
          onChanged={() => void feed.reload()}
          onError={setError}
          canOpenTask={(id) => findTask(id) !== undefined}
          onOpenTask={(id) => {
            const item = findTask(id)
            if (item) ws.openWorkItem(item)
          }}
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
          {t('tasks:recentActivity.showMore')}
        </Button>
      )}
    </Section>
  )
}
