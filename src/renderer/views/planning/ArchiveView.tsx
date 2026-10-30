import { useCallback, useEffect, useState } from 'react'
import { RECYCLE_BIN_RETENTION_DAYS, type PlanningWorkItem } from '@shared/ostler-api'
import type { PlanningWorkspace } from '../../hooks/usePlanningWorkspace'
import {
  Badge,
  Button,
  Checkbox,
  EmptyState,
  InlineAlert,
  SearchField,
  Select,
  StatusBadge,
  Toolbar,
  useConfirm,
  useToast,
  VisuallyHidden
} from '../../ui'
import { Archive, RotateCcw, Trash2 } from '../../ui/icons'
import './ArchiveView.css'
import { t } from '@shared/i18n'
import { formatDate } from '@shared/format'
import { matchesFilter, type TaskFilter } from '@shared/task-filter'

const DAY_MS = 24 * 60 * 60 * 1000

type Result = { ok: boolean; error?: string }

/** Which archived tasks the Archive shows (N1.2). */
export type ArchiveShow = 'all' | 'finished' | 'wontDo'

/** The Archive's "Show" choice as the one task filter (the Resolution field). */
export function archiveShowFilter(show: ArchiveShow): TaskFilter {
  if (show === 'all') return { match: 'all', conditions: [] }
  return {
    match: 'all',
    conditions: [{ field: 'resolution', op: show === 'wontDo' ? 'is' : 'isNot', value: 'wont-do' }]
  }
}

/** Days until a binned item is deleted for good. */
export function purgeDaysLeft(deletedAt: number | null | undefined, now = Date.now()): number {
  return Math.max(
    0,
    Math.ceil(((deletedAt ?? 0) + RECYCLE_BIN_RETENTION_DAYS * DAY_MS - now) / DAY_MS)
  )
}

/**
 * The project archive (`mode="archive"`) and recycle bin (`mode="bin"`), one
 * table-like list: title, status, the date it left the Board, and in the bin
 * when it is purged. Restoring and moving to the bin happen at once with an
 * undo; deleting forever can't be undone, so it asks first, naming the count.
 */
export function ArchiveView({ ws, mode }: { ws: PlanningWorkspace; mode: 'archive' | 'bin' }) {
  const [items, setItems] = useState<PlanningWorkItem[]>([])
  const [query, setQuery] = useState('')
  const [show, setShow] = useState<ArchiveShow>('all')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const confirm = useConfirm()
  const { toastUndo } = useToast()
  const isBin = mode === 'bin'

  const load = useCallback(async () => {
    if (!ws.projectId) return
    const result = await window.ostlerAPI.getPlanningWorkItems(
      ws.projectId,
      isBin ? 'deleted' : 'archived'
    )
    if (result.ok) {
      setItems(result.value)
      setSelected((current) => {
        const ids = new Set(result.value.map((item) => item.id))
        return new Set([...current].filter((id) => ids.has(id)))
      })
    } else setError(result.error)
  }, [ws.projectId, isBin])

  useEffect(() => {
    void load()
  }, [load])

  // An archived task edited in the drawer: its row shows what was saved at once.
  const edited = ws.closedWorkItem
  useEffect(() => {
    if (!edited) return
    setItems((current) =>
      current.some((item) => item.id === edited.id && item !== edited)
        ? current.map((item) => (item.id === edited.id ? edited : item))
        : current
    )
  }, [edited])

  // Housekeeping can move items while this view is open.
  useEffect(
    () =>
      window.ostlerAPI.onProjectStateChange((update) => {
        if (update.projectId === ws.projectId && update.field === 'planning') void load()
      }),
    [ws.projectId, load]
  )

  /** Runs `action` on each item; returns the ones it worked for. */
  const run = async (
    targets: PlanningWorkItem[],
    action: (item: PlanningWorkItem) => Promise<Result>
  ): Promise<PlanningWorkItem[]> => {
    setBusy(true)
    setError(null)
    const done: PlanningWorkItem[] = []
    try {
      for (const item of targets) {
        const result = await action(item)
        if (result.ok) done.push(item)
        else
          setError(
            result.error || t('tasks:archiveView.couldntChangeTryAgain', { itemTitle: item.title })
          )
      }
      const doneIds = new Set(done.map((item) => item.id))
      setItems((current) => current.filter((item) => !doneIds.has(item.id)))
      setSelected((current) => new Set([...current].filter((id) => !doneIds.has(id))))
      await ws.loadPlanning()
    } finally {
      setBusy(false)
    }
    return done
  }

  const after = async () => {
    await load()
    await ws.loadPlanning()
  }

  const restore = async (targets: PlanningWorkItem[]) => {
    const done = await run(targets, (item) =>
      isBin
        ? window.ostlerAPI.restorePlanningWorkItem(item.id)
        : window.ostlerAPI.unarchivePlanningWorkItem(item.id)
    )
    if (done.length === 0) return
    // The recycle bin restores; the Archive brings back what was set aside.
    toastUndo(
      isBin
        ? done.length === 1
          ? t('tasks:archiveView.restored', { title: done[0].title })
          : t('tasks:archiveView.restoredTasks', { count: done.length })
        : done.length === 1
          ? t('tasks:archiveView.broughtBack', { title: done[0].title })
          : t('tasks:archiveView.broughtBackTasks', { count: done.length }),
      async () => {
        for (const item of done)
          await (isBin
            ? window.ostlerAPI.deletePlanningWorkItem(item.id)
            : item.resolution === 'wont-do'
              ? // Undoing a reopen closes it again, with its reason.
                window.ostlerAPI.closePlanningWorkItemAsWontDo(item.id, {
                  reason: item.resolutionReason ?? ''
                })
              : window.ostlerAPI.archivePlanningWorkItem(item.id))
        await after()
      }
    )
  }

  const moveToBin = async (targets: PlanningWorkItem[]) => {
    const done = await run(targets, (item) => window.ostlerAPI.deletePlanningWorkItem(item.id))
    if (done.length === 0) return
    toastUndo(
      done.length === 1
        ? t('tasks:archiveView.movedRecycleBin', { title: done[0].title })
        : t('tasks:archiveView.movedTasksRecycleBin', { count: done.length }),
      async () => {
        for (const item of done) await window.ostlerAPI.restorePlanningWorkItem(item.id)
        await after()
      }
    )
  }

  const deleteForever = async (targets: PlanningWorkItem[]) => {
    const ok = await confirm({
      title:
        targets.length === 1
          ? t('tasks:archiveView.deleteForever3', { title: targets[0].title })
          : t('tasks:archiveView.deleteTasksForever', { count: targets.length }),
      body: t('tasks:archiveView.theyRemovedRecycleBin', { count: targets.length }),
      confirmLabel:
        targets.length === 1
          ? t('tasks:archiveView.deleteForever4')
          : t('tasks:archiveView.deleteTasksForever2', { count: targets.length }),
      cancelLabel: t('tasks:archiveView.keep'),
      tone: 'danger'
    })
    if (ok) await run(targets, (item) => window.ostlerAPI.deletePlanningWorkItemForever(item.id))
  }

  const needle = query.trim().toLowerCase()
  const showFilter = archiveShowFilter(isBin ? 'all' : show)
  const shown = items.filter((item) => matchesFilter(item, showFilter, { today: '', meId: null }))
  const visible = (
    needle
      ? shown.filter(
          (item) =>
            item.title.toLowerCase().includes(needle) ||
            item.description.toLowerCase().includes(needle) ||
            item.labels.some((label) => label.toLowerCase().includes(needle)) ||
            (item.resolutionReason ?? '').toLowerCase().includes(needle)
        )
      : shown
  )
    .slice()
    .sort(
      (a, b) =>
        ((isBin ? b.deletedAt : b.archivedAt) ?? 0) - ((isBin ? a.deletedAt : a.archivedAt) ?? 0)
    )
  const chosen = visible.filter((item) => selected.has(item.id))
  const allChosen = visible.length > 0 && chosen.length === visible.length

  const toggle = (id: string, on: boolean) =>
    setSelected((current) => {
      const next = new Set(current)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })

  return (
    <section
      className={isBin ? 'archive-view archive-view--bin' : 'archive-view'}
      aria-label={isBin ? t('tasks:archiveView.recycleBin') : t('tasks:archiveView.archive')}
    >
      <header className="archive-view__header">
        <p className="archive-view__intro">
          {isBin
            ? t('tasks:archiveView.deletedTasksEachKept', { RECYCLE_BIN_RETENTION_DAYS })
            : t('tasks:archiveView.finishedTasksMovedOff')}
        </p>
      </header>

      <Toolbar
        label={
          isBin ? t('tasks:archiveView.recycleBinActions') : t('tasks:archiveView.archiveActions')
        }
      >
        {chosen.length > 0 ? (
          <>
            <span className="archive-view__count">
              {t('tasks:archiveView.selected', { chosenCount: chosen.length })}
            </span>
            <Button icon={RotateCcw} disabled={busy} onClick={() => void restore(chosen)}>
              {isBin
                ? t('tasks:archiveView.restore', { chosenCount: chosen.length })
                : t('tasks:archiveView.bringBack', { chosenCount: chosen.length })}
            </Button>
            {isBin ? (
              <Button
                variant="danger"
                icon={Trash2}
                disabled={busy}
                onClick={() => void deleteForever(chosen)}
              >
                {t('tasks:archiveView.deleteForever', { chosenCount: chosen.length })}
              </Button>
            ) : (
              <Button icon={Trash2} disabled={busy} onClick={() => void moveToBin(chosen)}>
                {t('tasks:archiveView.moveRecycleBin', { chosenCount: chosen.length })}
              </Button>
            )}
            <Button variant="ghost" onClick={() => setSelected(new Set())}>
              {t('tasks:archiveView.clearSelection')}
            </Button>
          </>
        ) : (
          <>
            {!isBin && (
              <Select
                label={t('tasks:archiveView.show')}
                size="sm"
                value={show}
                onChange={(event) => setShow(event.target.value as ArchiveShow)}
                options={[
                  { value: 'all', label: t('tasks:archiveView.showAll') },
                  { value: 'finished', label: t('tasks:archiveView.showFinished') },
                  { value: 'wontDo', label: t('tasks:archiveView.showWontDo') }
                ]}
              />
            )}
            <SearchField
              label={
                isBin
                  ? t('tasks:archiveView.searchRecycleBin')
                  : t('tasks:archiveView.searchArchive')
              }
              hideLabel
              placeholder={t('tasks:archiveView.search')}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onClear={() => setQuery('')}
            />
          </>
        )}
      </Toolbar>

      {error && (
        <InlineAlert tone="danger" onDismiss={() => setError(null)}>
          {error}
        </InlineAlert>
      )}

      {visible.length === 0 ? (
        <EmptyState
          icon={isBin ? Trash2 : Archive}
          title={
            needle || show !== 'all'
              ? t('tasks:archiveView.nothingMatchesSearch')
              : isBin
                ? t('tasks:archiveView.recycleBinEmpty')
                : t('tasks:archiveView.nothingArchivedYet')
          }
          description={
            needle || show !== 'all'
              ? t('tasks:archiveView.tryFewerDifferentWords')
              : isBin
                ? t('tasks:archiveView.tasksDeleteWaitHere')
                : t('tasks:archiveView.archiveFinishedTaskCard')
          }
        />
      ) : (
        <div
          className="archive-table"
          role="table"
          aria-label={
            isBin ? t('tasks:archiveView.deletedTasks') : t('tasks:archiveView.archivedTasks')
          }
        >
          <div className="archive-table__row archive-table__row--head" role="row">
            <span role="columnheader">
              <Checkbox
                label={null}
                aria-label={t('tasks:archiveView.selectAll')}
                checked={allChosen}
                indeterminate={chosen.length > 0 && !allChosen}
                onChange={(event) =>
                  setSelected(
                    event.target.checked ? new Set(visible.map((item) => item.id)) : new Set()
                  )
                }
              />
            </span>
            <span role="columnheader">{t('tasks:archiveView.title')}</span>
            <span role="columnheader">{t('tasks:archiveView.status')}</span>
            <span role="columnheader">
              {isBin ? t('tasks:archiveView.deleted') : t('tasks:archiveView.archived')}
            </span>
            {isBin && <span role="columnheader">{t('tasks:archiveView.purge')}</span>}
            <span role="columnheader">
              <VisuallyHidden>{t('tasks:archiveView.actions')}</VisuallyHidden>
            </span>
          </div>
          {visible.map((item) => {
            const when = isBin ? item.deletedAt : item.archivedAt
            const wontDo = item.resolution === 'wont-do'
            return (
              <div key={item.id} className="archive-table__row" role="row">
                <span role="cell">
                  <Checkbox
                    label={null}
                    aria-label={t('tasks:archiveView.select', { itemTitle: item.title })}
                    checked={selected.has(item.id)}
                    onChange={(event) => toggle(item.id, event.target.checked)}
                  />
                </span>
                <span role="cell" className="archive-table__title">
                  {isBin ? (
                    <span title={item.title}>{item.title}</span>
                  ) : (
                    <button
                      type="button"
                      className="archive-table__open"
                      title={item.title}
                      onClick={() => ws.openClosedWorkItem(item)}
                    >
                      {item.title}
                    </button>
                  )}
                  {wontDo && (
                    <span className="archive-table__resolution">
                      <Badge tone="neutral">{t('tasks:wontDo.mark')}</Badge>
                      {item.resolutionReason && (
                        <span className="archive-table__reason" title={item.resolutionReason}>
                          {item.resolutionReason}
                        </span>
                      )}
                    </span>
                  )}
                  <span className="archive-table__muted">
                    {item.taskCode ? `${item.taskCode} · ` : ''}
                    {ws.milestoneNames.get(item.milestoneId ?? '') ??
                      t('tasks:archiveView.noMilestone')}
                  </span>
                </span>
                <span role="cell">
                  <StatusBadge status={item.status} columnId={item.columnId} />
                </span>
                <span role="cell" className="archive-table__muted">
                  <span className="archive-table__when-label">
                    {isBin ? t('tasks:archiveView.deleted') : t('tasks:archiveView.archived')}{' '}
                  </span>
                  {when ? formatDate(new Date(when), {}) : ''}
                </span>
                {isBin && (
                  <span role="cell" className="archive-table__muted">
                    {t('tasks:archiveView.purgesDays', { count: purgeDaysLeft(item.deletedAt) })}
                  </span>
                )}
                <span role="cell" className="archive-table__actions">
                  <Button size="sm" disabled={busy} onClick={() => void restore([item])}>
                    {isBin ? t('tasks:archiveView.restore2') : t('tasks:archiveView.bringBack2')}
                  </Button>
                  {isBin ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => void deleteForever([item])}
                    >
                      {t('tasks:archiveView.deleteForever2')}
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => void moveToBin([item])}
                    >
                      {t('tasks:archiveView.moveRecycleBin2')}
                    </Button>
                  )}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
