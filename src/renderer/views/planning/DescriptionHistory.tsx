import { useCallback, useEffect, useState } from 'react'
import type { PlanningDescriptionVersion } from '@shared/ostler-api'
import { compareLines, type ComparedLine } from '@shared/planning/line-compare'
import { formatDateTime } from '@shared/format'
import { t } from '@shared/i18n'
import { Button, Dialog, InlineAlert, Spinner, useToast } from '../../ui'
import { History, RotateCcw } from '../../ui/icons'
import { cx } from '../../ui/cx'
import './DescriptionHistory.css'

export type RestoreDescriptionResult =
  { ok: true; undo: () => Promise<boolean> } | { ok: false; error: string }

/**
 * Description history (N2.6, N21): **History** beside the description, shown
 * once there is an earlier version, opens a panel listing them; the selected
 * one is compared with today's text line by line, and **Restore** makes it the
 * description again, with undo in its toast.
 */
export function DescriptionHistory({
  workItemId,
  current,
  updatedAt,
  onRestore
}: {
  workItemId: string
  /** Today's text, as the editor shows it. */
  current: string
  /** Read the versions again whenever the task changes. */
  updatedAt: number
  onRestore: (versionId: number) => Promise<RestoreDescriptionResult>
}) {
  const { toastUndo } = useToast()
  const [versions, setVersions] = useState<PlanningDescriptionVersion[]>([])
  const [open, setOpen] = useState(false)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const result = await window.ostlerAPI.getPlanningDescriptionVersions(workItemId)
    if (result.ok) setVersions(result.value)
    else setError(result.error || t('tasks:descriptionHistory.couldntLoad'))
  }, [workItemId])

  useEffect(() => {
    void load()
  }, [load, updatedAt])

  const selected = versions.find((version) => version.id === selectedId) ?? versions[0] ?? null

  const restore = async () => {
    if (!selected) return
    setBusy(true)
    setError(null)
    const result = await onRestore(selected.id)
    setBusy(false)
    if (!result.ok) {
      setError(result.error || t('tasks:descriptionHistory.couldntRestore'))
      return
    }
    setOpen(false)
    void load()
    toastUndo(t('tasks:descriptionHistory.restored'), async () => {
      await result.undo()
      await load()
    })
  }

  if (versions.length === 0 && !open) return null
  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        icon={History}
        title={t('tasks:descriptionHistory.openTitle')}
        aria-haspopup="dialog"
        onClick={() => {
          setSelectedId(null)
          setError(null)
          setOpen(true)
        }}
      >
        {t('tasks:descriptionHistory.open')}
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={t('tasks:descriptionHistory.title')}
        description={t('tasks:descriptionHistory.description')}
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {t('tasks:descriptionHistory.close')}
            </Button>
            <Button
              variant="primary"
              icon={RotateCcw}
              loading={busy}
              disabled={!selected || selected.text === current}
              onClick={() => void restore()}
            >
              {t('tasks:descriptionHistory.restore')}
            </Button>
          </>
        }
      >
        {error && <InlineAlert tone="danger">{error}</InlineAlert>}
        <div className="description-history">
          <ul
            className="description-history__list"
            aria-label={t('tasks:descriptionHistory.versions')}
          >
            {versions.map((version) => (
              <li key={version.id}>
                <button
                  type="button"
                  className={cx(
                    'description-history__version',
                    version.id === selected?.id && 'is-selected'
                  )}
                  aria-pressed={version.id === selected?.id}
                  onClick={() => setSelectedId(version.id)}
                >
                  <span className="description-history__when">
                    {formatDateTime(version.endedAt)}
                  </span>
                  <span className="description-history__meta">
                    {version.actor.name} ·{' '}
                    {t('tasks:descriptionHistory.length', { count: version.text.length })}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {selected && <Comparison older={selected.text} newer={current} />}
        </div>
      </Dialog>
    </>
  )
}

/**
 * A version against today's text. The comparison is worked out after the
 * panel has drawn, not while it renders, so a long description never holds
 * the window up.
 */
function Comparison({ older, newer }: { older: string; newer: string }) {
  const [lines, setLines] = useState<ComparedLine[] | null>(null)
  useEffect(() => {
    setLines(null)
    const timer = setTimeout(() => setLines(compareLines(older, newer)), 0)
    return () => clearTimeout(timer)
  }, [older, newer])

  if (!lines)
    return (
      <div className="description-history__compare" role="status">
        <Spinner size="sm" /> {t('tasks:descriptionHistory.comparing')}
      </div>
    )
  const added = lines.filter((line) => line.kind === 'added').length
  const removed = lines.filter((line) => line.kind === 'removed').length
  return (
    <section
      className="description-history__compare"
      aria-label={t('tasks:descriptionHistory.against')}
    >
      <p className="description-history__summary">
        {added + removed === 0
          ? t('tasks:descriptionHistory.same')
          : t('tasks:descriptionHistory.summary', { added, removed })}
      </p>
      <ol className="description-history__lines">
        {lines.map((line, index) => (
          <li
            key={index}
            className={cx('description-history__line', `description-history__line--${line.kind}`)}
          >
            <span className="description-history__mark">
              {line.kind === 'added'
                ? t('tasks:descriptionHistory.added')
                : line.kind === 'removed'
                  ? t('tasks:descriptionHistory.removed')
                  : ''}
            </span>
            <span className="description-history__text">
              {line.text || (line.kind === 'same' ? ' ' : t('tasks:descriptionHistory.empty'))}
            </span>
          </li>
        ))}
      </ol>
    </section>
  )
}
