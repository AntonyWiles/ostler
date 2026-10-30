import { useCallback, useEffect, useState } from 'react'
import type {
  ProjectHistory,
  ProjectHistoryEntry,
  ProjectHistoryEntryKind
} from '@shared/ostler-api'
import type { ProjectViewProps } from '../../navigation/view-props'
import {
  Button,
  EmptyState,
  InlineAlert,
  SearchField,
  Section,
  SegmentedControl,
  Skeleton,
  useConfirm,
  useToast
} from '../../ui'
import { History as HistoryIcon } from '../../ui/icons'
import { formatDateTime } from '@shared/format'
import { t } from '@shared/i18n'
import './HistoryTab.css'

type KindFilter = 'all' | 'task' | 'your-edits' | 'undo'

const KIND_FILTERS: readonly KindFilter[] = ['all', 'task', 'your-edits', 'undo']

/**
 * History (simplify pass §3.5): one line per entry in the project folder's
 * history, written for people who do not know Git. Undo a task, undo an
 * undo, restore the folder to a point, and bring back discarded work. Every
 * one of these is a new entry, so nothing here rewrites or deletes history.
 */
export function HistoryTab({ project, ws }: ProjectViewProps) {
  const projectId = project.id
  const confirm = useConfirm()
  const { toast } = useToast()
  const [history, setHistory] = useState<ProjectHistory | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [search, setSearch] = useState('')
  const [kind, setKind] = useState<KindFilter>('all')

  const load = useCallback(async () => {
    const result = await window.ostlerAPI.getProjectHistory(projectId, {
      search: search.trim() || undefined,
      kind: kind === 'all' ? undefined : (kind as ProjectHistoryEntryKind)
    })
    if (result.ok) {
      setHistory(result.value)
      setError(null)
    } else setError(result.error)
  }, [projectId, search, kind])

  // Reload when the agents' state moves on: an Apply or Discard adds to it.
  const sessionCount =
    (ws.harnessState?.reviewSessions.length ?? 0) + (ws.harnessState?.activeSessions.length ?? 0)
  useEffect(() => {
    const timer = setTimeout(() => void load(), 200)
    return () => clearTimeout(timer)
  }, [load, sessionCount])

  const act = async (action: () => Promise<boolean>) => {
    setBusy(true)
    setError(null)
    try {
      if (await action()) await load()
    } finally {
      setBusy(false)
    }
  }

  const undo = (entry: ProjectHistoryEntry) =>
    act(async () => {
      const result = await window.ostlerAPI.undoHistoryEntries(projectId, [entry.id])
      if (!result.ok) {
        setError(result.error)
        return false
      }
      if (result.value.undone) {
        toast({ title: t('projects:historyTab.undone', { title: entry.title }), tone: 'success' })
        return true
      }
      const later = result.value.laterEntries
      if (later.length === 0) {
        setError(t('projects:historyTab.undoFailed'))
        return false
      }
      const both = await confirm({
        title: t('projects:historyTab.laterChangedTitle'),
        body: t('projects:historyTab.laterChangedBody', {
          title: entry.title,
          later: later.map((candidate) => candidate.title).join(', '),
          count: later.length
        }),
        confirmLabel: t('projects:historyTab.undoBoth', { count: later.length + 1 }),
        cancelLabel: t('projects:historyTab.leaveIt')
      })
      if (!both) return false
      const again = await window.ostlerAPI.undoHistoryEntries(projectId, [
        entry.id,
        ...later.map((candidate) => candidate.id)
      ])
      if (!again.ok) {
        setError(again.error)
        return false
      }
      if (!again.value.undone) {
        setError(t('projects:historyTab.undoFailed'))
        return false
      }
      toast({ title: t('projects:historyTab.undoneBoth'), tone: 'success' })
      return true
    })

  const restore = (entry: ProjectHistoryEntry) =>
    act(async () => {
      const ok = await confirm({
        title: t('projects:historyTab.restoreTitle'),
        body: t('projects:historyTab.restoreBody', {
          when: formatDateTime(new Date(entry.at))
        }),
        confirmLabel: t('projects:historyTab.restore')
      })
      if (!ok) return false
      const result = await window.ostlerAPI.restoreHistoryEntry(projectId, entry.id)
      if (!result.ok) {
        setError(result.error)
        return false
      }
      toast({ title: t('projects:historyTab.restored'), tone: 'success' })
      return true
    })

  const bringBack = (sessionId: string, title: string) =>
    act(async () => {
      const result = await window.ostlerAPI.bringBackHarnessTaskWork(projectId, sessionId)
      if (!result.ok) {
        setError(result.error)
        return false
      }
      toast({ title: t('projects:historyTab.broughtBack', { title }), tone: 'success' })
      return true
    })

  return (
    <div className="history-tab">
      {error && (
        <InlineAlert tone="danger" onDismiss={() => setError(null)}>
          {error}
        </InlineAlert>
      )}

      {history && history.discarded.length > 0 && (
        <Section
          title={t('projects:historyTab.discardedWork')}
          description={t('projects:historyTab.discardedWorkHint')}
          headingLevel={3}
        >
          <ul className="history-tab__list">
            {history.discarded.map((work) => (
              <li key={work.sessionId} className="history-tab__row">
                <div className="history-tab__main">
                  <span className="history-tab__title">{work.title}</span>
                  <span className="history-tab__meta">
                    {t('projects:historyTab.discardedAt', {
                      when: formatDateTime(new Date(work.discardedAt))
                    })}
                  </span>
                </div>
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() => void bringBack(work.sessionId, work.title)}
                >
                  {t('projects:historyTab.bringBack')}
                </Button>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section
        title={t('projects:historyTab.title')}
        description={
          history?.version
            ? t('projects:historyTab.onVersion', { version: history.version })
            : undefined
        }
        headingLevel={3}
      >
        <div className="history-tab__filters">
          <SearchField
            label={t('projects:historyTab.search')}
            hideLabel
            placeholder={t('projects:historyTab.searchPlaceholder')}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <SegmentedControl
            label={t('projects:historyTab.show')}
            size="sm"
            value={kind}
            onChange={setKind}
            options={KIND_FILTERS.map((value) => ({
              value,
              label: t(`projects:historyTab.kind.${value}`)
            }))}
          />
        </div>

        {!history && !error && <Skeleton lines={5} />}

        {history && !history.available && (
          <EmptyState icon={HistoryIcon} title={t('projects:historyTab.noHistory')} />
        )}

        {history?.available && history.entries.length === 0 && (
          <EmptyState icon={HistoryIcon} title={t('projects:historyTab.noEntries')} />
        )}

        {history?.available && history.entries.length > 0 && (
          <ul className="history-tab__list">
            {history.entries.map((entry) => (
              <li key={entry.id} className="history-tab__row">
                <div className="history-tab__main">
                  <span className="history-tab__title">{entry.title}</span>
                  <span className="history-tab__meta">
                    {formatDateTime(new Date(entry.at))}
                    {' · '}
                    {t('projects:historyTab.files', { count: entry.files.length })}
                    {entry.undone && ` · ${t('projects:historyTab.undoneNote')}`}
                  </span>
                  {entry.files.length > 0 && (
                    <details className="history-tab__files">
                      <summary>{t('projects:historyTab.showFiles')}</summary>
                      <ul>
                        {entry.files.map((file) => (
                          <li key={file}>
                            <code>{file}</code>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
                <div className="history-tab__actions">
                  {!entry.first && !entry.undone && (
                    <Button size="sm" disabled={busy} onClick={() => void undo(entry)}>
                      {entry.kind === 'undo'
                        ? t('projects:historyTab.undoTheUndo')
                        : entry.kind === 'task'
                          ? t('projects:historyTab.undoTask')
                          : t('projects:historyTab.undo')}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => void restore(entry)}
                  >
                    {t('projects:historyTab.restoreHere')}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  )
}
