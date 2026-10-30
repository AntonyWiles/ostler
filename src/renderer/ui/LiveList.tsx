import { useEffect, useState } from 'react'
import { useInRouterContext, useNavigate } from 'react-router-dom'
import type { LiveListResult } from '@shared/live-list'
import { formatIsoDateShort } from '@shared/dates'
import { t } from '@shared/i18n'
import { projectPath } from '../navigation/paths'
import { ItemLinkChip } from './ItemLinkChip'
import { StatusBadge } from './StatusBadge'
import './LiveList.css'

/** A block's text as both the Markdown tree and the finder give it, for matching the two. */
export function liveListKey(body: string): string {
  return body.replace(/\r/g, '').trimEnd()
}

/**
 * What a text's live lists show (N4.4c): one `queryLiveLists` call for all of
 * a text's blocks, again when they change, when `refreshKey` changes or when
 * the project's tasks do. Null while loading; texts without blocks call nothing.
 */
export function useLiveLists(
  projectId: string | null | undefined,
  bodies: readonly string[],
  refreshKey?: unknown
): Map<string, LiveListResult> | null {
  const [results, setResults] = useState<Map<string, LiveListResult> | null>(null)
  const [tick, setTick] = useState(0)
  const key = bodies.join('\u0000')
  useEffect(() => {
    if (!projectId || bodies.length === 0) return
    return window.ostlerAPI.onProjectStateChange?.((update) => {
      if (update.projectId === projectId && update.field === 'planning') setTick((n) => n + 1)
    })
  }, [projectId, bodies.length > 0])
  useEffect(() => {
    if (!projectId || bodies.length === 0) return
    let live = true
    void window.ostlerAPI.queryLiveLists(projectId, [...bodies]).then((result) => {
      if (!live) return
      const map = new Map<string, LiveListResult>()
      bodies.forEach((body, index) => {
        const entry = result.ok
          ? result.value[index]
          : ({ ok: false, reason: 'invalid', problem: result.error } as const)
        if (entry) map.set(liveListKey(body), entry)
      })
      setResults(map)
    })
    return () => {
      live = false
    }
    // `key` stands for `bodies`, which is a new array each render.
  }, [projectId, key, refreshKey, tick])
  return results
}

export interface LiveListProps {
  /** The block's text, shown as it is when the list cannot be. */
  body: string
  projectId: string | null | undefined
  /** Undefined while loading. */
  result: LiveListResult | undefined
}

/**
 * An `ostler-tasks` block drawn as a live list (N4.4c): its title, a count by
 * status, the first tasks with status, assignee and due date, then "and 12
 * more", which opens the List with the same filter. A block that cannot be
 * shown is a quiet note with its own text, never an error.
 */
export function LiveList({ body, projectId, result }: LiveListProps) {
  if (!projectId) return <QuietBlock body={body} note={t('library:liveList.noProject')} />
  if (!result)
    return (
      <div className="ui-live-list is-loading" aria-busy="true">
        {t('library:liveList.loading')}
      </div>
    )
  if (!result.ok)
    return (
      <QuietBlock
        body={body}
        note={
          result.reason === 'missingView'
            ? result.problem
            : t('library:liveList.invalid', { problem: result.problem })
        }
      />
    )
  const title = result.title ?? result.viewName ?? t('library:liveList.defaultTitle')
  const more = result.total - result.tasks.length
  return (
    <section className="ui-live-list" aria-label={t('library:liveList.listLabel', { title })}>
      <header className="ui-live-list__header">
        <span className="ui-live-list__title">{title}</span>
        {result.counts.length > 0 && (
          <span className="ui-live-list__counts">
            {result.counts
              .map((entry) =>
                t('library:liveList.count', { count: entry.count, status: entry.label })
              )
              .join(', ')}
          </span>
        )}
      </header>
      <p className="ui-live-list__words">{result.words}</p>
      {result.tasks.length === 0 ? (
        <p className="ui-live-list__empty">{t('library:liveList.noTasks')}</p>
      ) : (
        <ul className="ui-live-list__tasks">
          {result.tasks.map((task) => (
            <li key={task.id} className="ui-live-list__task">
              <span className="ui-live-list__task-title">
                <ItemLinkChip
                  target={{ kind: 'task', projectId, id: task.id }}
                  info={{
                    kind: 'task',
                    projectId,
                    id: task.id,
                    exists: true,
                    title: task.title
                  }}
                  words={task.title}
                />
              </span>
              <StatusBadge status={task.status} columnId={task.columnId} projectId={projectId} />
              <span className="ui-live-list__meta">
                {task.assigneeName ?? t('library:liveList.nobody')}
              </span>
              <span className="ui-live-list__meta">
                {task.targetDate
                  ? t('library:liveList.due', { date: formatIsoDateShort(task.targetDate) })
                  : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
      {more > 0 && <MoreLink projectId={projectId} result={result} count={more} />}
    </section>
  )
}

function MoreLink({
  projectId,
  result,
  count
}: {
  projectId: string
  result: Extract<LiveListResult, { ok: true }>
  count: number
}) {
  const words = t('library:liveList.more', { count })
  if (!useInRouterContext()) return <p className="ui-live-list__more">{words}</p>
  return <RoutedMoreLink projectId={projectId} result={result} words={words} />
}

function RoutedMoreLink({
  projectId,
  result,
  words
}: {
  projectId: string
  result: Extract<LiveListResult, { ok: true }>
  words: string
}) {
  const navigate = useNavigate()
  return (
    <button
      type="button"
      className="ui-live-list__more is-link"
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        navigate(
          projectPath(projectId, 'list', {
            filter: JSON.stringify(result.filter),
            q: result.query || null
          })
        )
      }}
    >
      {words}
    </button>
  )
}

function QuietBlock({ body, note }: { body: string; note: string }) {
  return (
    <div className="ui-live-list is-quiet">
      <p className="ui-live-list__note">{note}</p>
      <pre className="ui-live-list__text">
        <code>{body}</code>
      </pre>
    </div>
  )
}
