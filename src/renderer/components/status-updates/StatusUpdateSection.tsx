import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { RendererProject, StatusUpdate } from '@shared/ostler-api'
import { t } from '@shared/i18n'
import { Button, IconButton, InlineAlert, Markdown, Section, Skeleton, useToast } from '../../ui'
import { History, Megaphone, Pencil, Trash2 } from '../../ui/icons'
import { ActivityTime } from '../../views/planning/ActivityList'
import { StatusHealthBadge } from './StatusUpdateChip'
import { StatusUpdateDialog } from './StatusUpdateDialog'
import { useStatusUpdates } from './useStatusUpdates'
import './StatusUpdates.css'

/**
 * The top of the Overview (N5.5): the latest status update (health, note, who
 * and when), Post an update, and History, the diary of every update, newest
 * first. `?postUpdate=1` opens the posting dialog: the project's menu, the
 * command palette and the Inbox's reminder come here that way.
 */
export function StatusUpdateSection({ project }: { project: RendererProject }) {
  const { updates, error, reload } = useStatusUpdates(project.id)
  const { toast, toastUndo } = useToast()
  const [posting, setPosting] = useState(false)
  const [editing, setEditing] = useState<StatusUpdate | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const [searchParams, setSearchParams] = useSearchParams()

  const requested = searchParams.get('postUpdate')
  useEffect(() => {
    if (!requested) return
    setPosting(true)
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.delete('postUpdate')
        return next
      },
      { replace: true }
    )
  }, [requested, setSearchParams])

  const remove = async (update: StatusUpdate) => {
    const result = await window.ostlerAPI.deleteStatusUpdate(update.id)
    if (!result.ok) {
      toast({
        title: t('projects:statusUpdates.couldntDelete'),
        body: result.error,
        tone: 'danger'
      })
      return
    }
    await reload()
    toastUndo(t('projects:statusUpdates.deleted'), async () => {
      await window.ostlerAPI.restoreStatusUpdate(update.id)
      await reload()
    })
  }

  const saved = async ({ update, before }: { update: StatusUpdate; before?: StatusUpdate }) => {
    await reload()
    if (before) {
      toastUndo(t('projects:statusUpdates.edited'), async () => {
        await window.ostlerAPI.revertStatusUpdate(update.id, before)
        await reload()
      })
    } else {
      toastUndo(t('projects:statusUpdates.posted'), async () => {
        await window.ostlerAPI.deleteStatusUpdate(update.id)
        await reload()
      })
    }
  }

  const latest = updates?.[0] ?? null
  const older = updates?.slice(1) ?? []

  return (
    <Section
      title={t('projects:statusUpdates.title')}
      actions={
        <Button size="sm" variant="secondary" icon={Megaphone} onClick={() => setPosting(true)}>
          {t('projects:statusUpdates.postAnUpdate')}
        </Button>
      }
    >
      {error && <InlineAlert tone="danger">{error}</InlineAlert>}
      {!updates && !error && <Skeleton lines={2} />}
      {updates && !latest && (
        <p className="overview-muted">{t('projects:statusUpdates.noneYet')}</p>
      )}
      {latest && (
        <StatusUpdateEntry
          update={latest}
          onEdit={() => setEditing(latest)}
          onDelete={() => void remove(latest)}
        />
      )}
      {older.length > 0 && (
        <div className="status-update-history">
          <Button
            size="sm"
            variant="ghost"
            icon={History}
            aria-expanded={showHistory}
            aria-controls="status-update-history"
            onClick={() => setShowHistory((open) => !open)}
          >
            {showHistory
              ? t('projects:statusUpdates.hideHistory')
              : t('projects:statusUpdates.history', { count: older.length })}
          </Button>
          {showHistory && (
            <ol
              id="status-update-history"
              className="status-update-history__list"
              aria-label={t('projects:statusUpdates.historyLabel')}
            >
              {older.map((update) => (
                <li key={update.id}>
                  <StatusUpdateEntry
                    update={update}
                    onEdit={() => setEditing(update)}
                    onDelete={() => void remove(update)}
                  />
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
      {(posting || editing) && (
        <StatusUpdateDialog
          projectId={project.id}
          projectName={project.name}
          editing={editing ?? undefined}
          onClose={() => {
            setPosting(false)
            setEditing(null)
          }}
          onSaved={(result) => void saved(result)}
        />
      )}
    </Section>
  )
}

/** One update: its health, note (sanitised Markdown), who posted it and when. */
function StatusUpdateEntry({
  update,
  onEdit,
  onDelete
}: {
  update: StatusUpdate
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <article className="status-update" data-status-update={update.id}>
      <div className="status-update__head">
        <StatusHealthBadge health={update.health} />
        <span className="status-update__by">
          {t('projects:statusUpdates.by', { name: update.authorName })}{' '}
          <ActivityTime at={update.postedAt} />
          {update.editedAt !== null && (
            <span className="status-update__edited"> {t('projects:statusUpdates.editedMark')}</span>
          )}
        </span>
        <span className="status-update__actions">
          <IconButton
            icon={Pencil}
            size="sm"
            label={t('projects:statusUpdates.edit')}
            onClick={onEdit}
          />
          <IconButton
            icon={Trash2}
            size="sm"
            label={t('projects:statusUpdates.delete')}
            onClick={onDelete}
          />
        </span>
      </div>
      {update.note && <Markdown className="status-update__note">{update.note}</Markdown>}
    </article>
  )
}
