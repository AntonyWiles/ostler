import { useConfig } from '../../hooks/useConfig'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type {
  RendererProject,
  ChangeDetail,
  ChangeHistoryEntry,
  ChangeHistoryQuery,
  ChangeHistoryStats,
  PlanningWorkItemStatus
} from '@shared/ostler-api'
import { t } from '@shared/i18n'
import { formatDate, formatFileSize, formatTime } from '@shared/format'
import { useProjectList } from '../../context/OstlerContext'
import { ProjectMark } from '../../components/ProjectMark'
import { taskPath } from '../../navigation/paths'
import {
  Badge,
  Button,
  EmptyState,
  IconButton,
  PageHeader,
  SearchField,
  SegmentedControl,
  Select,
  useConfirm,
  useToast,
  VisuallyHidden
} from '../../ui'
import { ChevronDown, ChevronRight, History, Redo2, Trash2, Undo2 } from '../../ui/icons'
import { CommittedNumberField } from '../settings/settings-form'
import { useChangeHistory } from '../../history/ChangeHistoryProvider'
import { useStatusLabelFor } from '../../context/ColumnsContext'
import {
  changeFieldLabel,
  changeRows,
  describeEntry,
  describeEntryDetail,
  formatChangeValue
} from '../../history/describe-change'
import '../../history/history.css'

type Since = 'fiveMinutes' | 'hour' | 'today' | 'week' | 'all'

const PAGE_SIZE = 60
const MINUTE = 60_000

function sinceTime(since: Since, now = Date.now()): number | undefined {
  switch (since) {
    case 'fiveMinutes':
      return now - 5 * MINUTE
    case 'hour':
      return now - 60 * MINUTE
    case 'today': {
      const start = new Date(now)
      start.setHours(0, 0, 0, 0)
      return start.getTime()
    }
    case 'week':
      return now - 7 * 24 * 60 * MINUTE
    case 'all':
      return undefined
  }
}

/** "Today", "Yesterday", or the date. */
function dayLabel(at: number, now = Date.now()): string {
  const day = new Date(at)
  day.setHours(0, 0, 0, 0)
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  const days = Math.round((today.getTime() - day.getTime()) / (24 * 60 * MINUTE))
  if (days === 0) return t('views:undoHistory.groups.today')
  if (days === 1) return t('views:undoHistory.groups.yesterday')
  return formatDate(at, { weekday: 'long', day: 'numeric', month: 'long' })
}

function dayKey(at: number): string {
  const day = new Date(at)
  return `${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`
}

/**
 * The undo history: every change made in Ostler, newest first, by day. Any
 * step can be undone on its own (later changes stay), an undone step can be
 * redone, and a step can be forgotten. How long steps are kept, and clearing
 * them, sit at the foot of the page.
 */
export function UndoHistoryView() {
  const projects = useProjectList()
  const history = useChangeHistory()
  const confirm = useConfirm()
  const { toast } = useToast()
  const [search, setSearch] = useState('')
  const [since, setSince] = useState<Since>('all')
  const [projectId, setProjectId] = useState('')
  const [entries, setEntries] = useState<ChangeHistoryEntry[] | null>(null)
  const [nextBefore, setNextBefore] = useState<string | null>(null)
  const [stats, setStats] = useState<ChangeHistoryStats | null>(null)
  const [keepDays, setKeepDays] = useState<number | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const query = useMemo<ChangeHistoryQuery>(
    () => ({
      search: search.trim() || undefined,
      since: sinceTime(since),
      projectId: projectId || undefined,
      limit: PAGE_SIZE
    }),
    [search, since, projectId]
  )

  const load = useCallback(async () => {
    const [page, counted] = await Promise.all([
      window.ostlerAPI.listChangeHistory(query),
      window.ostlerAPI.getChangeHistoryStats()
    ])
    if (page.ok) {
      setEntries(page.value.entries)
      setNextBefore(page.value.nextBefore)
    }
    if (counted.ok) setStats(counted.value)
  }, [query])

  useEffect(() => {
    const timer = setTimeout(() => void load(), search ? 200 : 0)
    return () => clearTimeout(timer)
  }, [load, search])

  useEffect(
    () =>
      window.ostlerAPI.onProjectStateChange((update) => {
        if (update.field === 'history') void load()
      }),
    [load]
  )

  const savedKeepDays = useConfig().config?.history.keepChangesDays
  useEffect(() => {
    if (savedKeepDays !== undefined) setKeepDays(savedKeepDays)
  }, [savedKeepDays])

  const loadMore = async () => {
    if (!nextBefore) return
    const page = await window.ostlerAPI.listChangeHistory({ ...query, before: nextBefore })
    if (!page.ok) return
    setEntries((shown) => [...(shown ?? []), ...page.value.entries])
    setNextBefore(page.value.nextBefore)
  }

  const act = async (entry: ChangeHistoryEntry, run: () => Promise<void>) => {
    setBusyId(entry.id)
    try {
      await run()
    } finally {
      setBusyId(null)
    }
  }

  const forget = async (entry: ChangeHistoryEntry) => {
    const result = await window.ostlerAPI.deleteChangeHistoryEntry(entry.id)
    if (result.ok) toast({ title: t('views:undoHistory.forgotten'), tone: 'success' })
    else toast({ title: result.error, tone: 'danger' })
  }

  const clear = async (olderThanWeek: boolean) => {
    const ok = await confirm({
      title: olderThanWeek
        ? t('views:undoHistory.clear.confirmWeekTitle')
        : t('views:undoHistory.clear.confirmTitle'),
      body: olderThanWeek
        ? t('views:undoHistory.clear.confirmWeekText')
        : t('views:undoHistory.clear.confirmText'),
      confirmLabel: t('views:undoHistory.clear.confirm'),
      tone: 'danger'
    })
    if (!ok) return
    const result = await window.ostlerAPI.clearChangeHistory(
      olderThanWeek ? { olderThan: Date.now() - 7 * 24 * 60 * MINUTE } : {}
    )
    if (result.ok) {
      toast({ title: t('views:undoHistory.clear.done', { count: result.value }), tone: 'success' })
      void load()
    } else toast({ title: result.error, tone: 'danger' })
  }

  const saveKeepDays = async (days: number) => {
    setKeepDays(days)
    await window.ostlerAPI.updateConfig({ history: { keepChangesDays: days } })
  }

  const projectName = (id: string | null) => projects.find((project) => project.id === id) ?? null
  const filtered = Boolean(search.trim()) || since !== 'all' || Boolean(projectId)

  const groups = useMemo(() => {
    const result: { key: string; label: string; entries: ChangeHistoryEntry[] }[] = []
    for (const entry of entries ?? []) {
      const key = dayKey(entry.lastAt)
      const last = result[result.length - 1]
      if (last && last.key === key) last.entries.push(entry)
      else result.push({ key, label: dayLabel(entry.lastAt), entries: [entry] })
    }
    return result
  }, [entries])

  return (
    <div className="undo-history">
      <PageHeader
        title={t('views:undoHistory.title')}
        subtitle={t('views:undoHistory.subtitle')}
        actions={
          <>
            <Button
              variant="secondary"
              icon={Undo2}
              disabled={!history.head.undo}
              onClick={() => void history.undo()}
            >
              {t('views:undoHistory.toolbar.undo')}
            </Button>
            <Button
              variant="secondary"
              icon={Redo2}
              disabled={!history.head.redo}
              onClick={() => void history.redo()}
            >
              {t('views:undoHistory.toolbar.redo')}
            </Button>
          </>
        }
      />

      <div className="undo-history__filters">
        <SearchField
          label={t('views:undoHistory.filters.search')}
          hideLabel
          placeholder={t('views:undoHistory.filters.search')}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          slashShortcut
        />
        <SegmentedControl<Since>
          label={t('views:undoHistory.filters.when')}
          size="sm"
          value={since}
          onChange={setSince}
          options={[
            { value: 'fiveMinutes', label: t('views:undoHistory.filters.lastFiveMinutes') },
            { value: 'hour', label: t('views:undoHistory.filters.lastHour') },
            { value: 'today', label: t('views:undoHistory.filters.today') },
            { value: 'week', label: t('views:undoHistory.filters.lastSevenDays') },
            { value: 'all', label: t('views:undoHistory.filters.allTime') }
          ]}
        />
        <Select
          label={t('views:undoHistory.filters.project')}
          hideLabel
          size="sm"
          value={projectId}
          onChange={(event) => setProjectId(event.target.value)}
          options={[
            { value: '', label: t('views:undoHistory.filters.allProjects') },
            ...projects.map((project) => ({ value: project.id, label: project.name }))
          ]}
        />
      </div>

      {entries !== null && entries.length === 0 ? (
        <EmptyState
          icon={History}
          title={
            filtered
              ? t('views:undoHistory.empty.filteredTitle')
              : t('views:undoHistory.empty.title')
          }
          description={
            filtered ? t('views:undoHistory.empty.filteredText') : t('views:undoHistory.empty.text')
          }
        />
      ) : (
        <div className="undo-history__days">
          {groups.map((group) => (
            <section key={group.key} className="undo-history__day" aria-label={group.label}>
              <h2 className="undo-history__day-title">{group.label}</h2>
              <ol className="undo-history__list">
                {group.entries.map((entry) => (
                  <HistoryRow
                    key={entry.id}
                    entry={entry}
                    project={projectName(entry.projectId)}
                    busy={busyId === entry.id}
                    onUndo={() => void act(entry, () => history.undoEntry(entry.id))}
                    onRedo={() => void act(entry, () => history.redoEntry(entry.id))}
                    onForget={() => void forget(entry)}
                  />
                ))}
              </ol>
            </section>
          ))}
          {nextBefore && (
            <div className="undo-history__more">
              <Button variant="ghost" onClick={() => void loadMore()}>
                {t('views:undoHistory.loadMore')}
              </Button>
            </div>
          )}
        </div>
      )}

      <footer className="undo-history__keep">
        <div className="undo-history__keep-fields">
          {keepDays !== null && (
            <CommittedNumberField
              label={t('views:undoHistory.keep.title')}
              unit={t('views:undoHistory.keep.days')}
              min={1}
              max={3650}
              step={1}
              value={keepDays}
              hint={t('views:undoHistory.keep.hint')}
              onCommit={(days) => void saveKeepDays(days)}
            />
          )}
          <p className="undo-history__keep-summary">
            {stats && stats.entries > 0
              ? t('views:undoHistory.keep.summary', {
                  count: stats.entries,
                  size: formatFileSize(stats.bytes)
                })
              : t('views:undoHistory.keep.summaryEmpty')}{' '}
            {t('views:undoHistory.coverage')}
          </p>
        </div>
        <div className="undo-history__keep-actions">
          <Button
            variant="secondary"
            size="sm"
            disabled={!stats || stats.entries === 0}
            onClick={() => void clear(true)}
          >
            {t('views:undoHistory.clear.olderThanWeek')}
          </Button>
          <Button
            variant="danger"
            size="sm"
            disabled={!stats || stats.entries === 0}
            onClick={() => void clear(false)}
          >
            {t('views:undoHistory.clear.all')}
          </Button>
        </div>
      </footer>
    </div>
  )
}

function sentenceCase(text: string): string {
  return text.charAt(0).toLocaleUpperCase() + text.slice(1)
}

/** A value in a step's details; nothing shows as a quiet dash. */
function ChangeValue({ value }: { value: string | null }) {
  if (value !== null) return <>{value}</>
  return (
    <>
      <span className="undo-history__none" aria-hidden="true">
        —
      </span>
      <VisuallyHidden>{t('views:undoHistory.entry.empty')}</VisuallyHidden>
    </>
  )
}

function HistoryRow({
  entry,
  project,
  busy,
  onUndo,
  onRedo,
  onForget
}: {
  entry: ChangeHistoryEntry
  project: RendererProject | null
  busy: boolean
  onUndo: () => void
  onRedo: () => void
  onForget: () => void
}) {
  const [open, setOpen] = useState(false)
  const [details, setDetails] = useState<ChangeDetail[] | null>(null)
  const statusLabel = useStatusLabelFor()
  const status = (value: PlanningWorkItemStatus) => statusLabel(value, entry.projectId)
  const undone = entry.undoneById !== null
  const title = describeEntry(entry)
  const detail = describeEntryDetail(entry)
  const task =
    entry.kind === 'change' && entry.subjectCount === 1 && entry.subjects[0]?.kind === 'task'
      ? entry.subjects[0]
      : null

  useEffect(() => {
    if (!open || details) return
    void window.ostlerAPI.getChangeHistoryDetails(entry.id).then((result) => {
      setDetails(result.ok ? result.value : [])
    })
  }, [open, details, entry.id])

  // A new state (undone, redone) shows different values: read them again when next opened.
  useEffect(() => setDetails(null), [entry.undoneById])

  const KindIcon = entry.kind === 'undo' ? Undo2 : entry.kind === 'redo' ? Redo2 : null
  return (
    <li className={`undo-history__entry${undone ? ' is-undone' : ''}`}>
      <time
        className="undo-history__time tabular-nums"
        dateTime={new Date(entry.lastAt).toISOString()}
      >
        {formatTime(entry.lastAt)}
      </time>
      <div className="undo-history__body">
        <p className="undo-history__title">
          {KindIcon && <KindIcon className="undo-history__kind-icon" aria-hidden="true" />}
          <span>{title}</span>
          {undone && <Badge tone="neutral">{t('views:undoHistory.entry.undone')}</Badge>}
        </p>
        {(detail || project) && (
          <p className="undo-history__meta">
            {project && (
              <span className="undo-history__project">
                <ProjectMark project={project} />
                {project.name}
              </span>
            )}
            {detail && <span>{detail}</span>}
            {task && project && task.action !== 'removed' && !undone && (
              <Link to={taskPath(project.id, task.id)}>
                {t('views:undoHistory.entry.openTask')}
              </Link>
            )}
          </p>
        )}
        {open && (
          <div className="undo-history__details">
            {details === null ? null : details.length === 0 ? (
              <p className="undo-history__meta">{t('views:undoHistory.entry.noDetails')}</p>
            ) : (
              <table className="undo-history__changes">
                <thead>
                  <tr>
                    <th scope="col">
                      <VisuallyHidden>{t('views:undoHistory.entry.details')}</VisuallyHidden>
                    </th>
                    <th scope="col">{t('views:undoHistory.entry.before')}</th>
                    <th scope="col">{t('views:undoHistory.entry.after')}</th>
                  </tr>
                </thead>
                <tbody>
                  {changeRows(details).map((change, index) => (
                    <tr key={index}>
                      <th scope="row">{sentenceCase(changeFieldLabel(change.field))}</th>
                      {change.summary !== null ? (
                        <td colSpan={2}>{change.summary}</td>
                      ) : (
                        <>
                          <td>
                            <ChangeValue
                              value={formatChangeValue(change.field, change.before, status)}
                            />
                          </td>
                          <td>
                            <ChangeValue
                              value={formatChangeValue(change.field, change.after, status)}
                            />
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
      <div className="undo-history__actions">
        <IconButton
          size="sm"
          icon={open ? ChevronDown : ChevronRight}
          label={
            open ? t('views:undoHistory.entry.hideDetails') : t('views:undoHistory.entry.details')
          }
          aria-expanded={open}
          onClick={() => setOpen((was) => !was)}
        />
        {/* An undo or a redo is put right from the step it acted on. */}
        {entry.kind !== 'change' ? null : undone ? (
          <Button
            size="sm"
            variant="secondary"
            icon={Redo2}
            disabled={busy}
            title={t('views:undoHistory.entry.redoHint')}
            onClick={onRedo}
          >
            {t('views:undoHistory.entry.redo')}
          </Button>
        ) : (
          <Button
            size="sm"
            variant="secondary"
            icon={Undo2}
            disabled={busy}
            title={t('views:undoHistory.entry.undoHint')}
            onClick={onUndo}
          >
            {t('views:undoHistory.entry.undo')}
          </Button>
        )}
        <IconButton
          size="sm"
          icon={Trash2}
          label={t('views:undoHistory.entry.forget')}
          onClick={onForget}
        />
      </div>
    </li>
  )
}
