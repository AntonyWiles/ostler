import { useState } from 'react'
import type { StatusUpdate, StatusUpdateHealth } from '@shared/ostler-api'
import {
  MAX_STATUS_UPDATE_NOTE,
  STATUS_UPDATE_HEALTHS,
  statusUpdateHealthLabel
} from '@shared/status-updates'
import { formatDate, formatNumber } from '@shared/format'
import { t } from '@shared/i18n'
import { useFeatures } from '../../navigation/features'
import { Button, Dialog, InlineAlert, SegmentedControl, TextArea } from '../../ui'
import { Sparkles } from '../../ui/icons'
import { HEALTH_ICON } from './StatusUpdateChip'
import './StatusUpdates.css'

/**
 * Post a status update (N5.5), or edit one: three health choices, each with
 * words and an icon (arrow keys move between them), and a Markdown note of
 * at most 2,000 characters. With Ostler AI set up, Draft from activity fills
 * both for the person to change; nothing is posted until they press Post.
 */
export function StatusUpdateDialog({
  projectId,
  projectName,
  editing,
  onClose,
  onSaved
}: {
  projectId: string
  projectName: string
  /** The update to edit; a new one when absent. */
  editing?: StatusUpdate
  onClose: () => void
  onSaved: (result: { update: StatusUpdate; before?: StatusUpdate }) => void
}) {
  const features = useFeatures()
  const [health, setHealth] = useState<StatusUpdateHealth | null>(editing?.health ?? null)
  const [note, setNote] = useState(editing?.note ?? '')
  const [busy, setBusy] = useState(false)
  const [drafting, setDrafting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [draftNote, setDraftNote] = useState<string | null>(null)

  const tooLong = note.length > MAX_STATUS_UPDATE_NOTE

  const draft = async () => {
    setDrafting(true)
    setError(null)
    const result = await window.ostlerAPI.draftStatusUpdate(projectId)
    setDrafting(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    if (result.value.health) setHealth(result.value.health)
    setNote(result.value.note)
    setDraftNote(
      t('projects:statusUpdates.draftedFrom', {
        count: result.value.changes,
        formattedCount: formatNumber(result.value.changes),
        date: formatDate(result.value.since, { dateStyle: 'medium' })
      })
    )
  }

  const save = async () => {
    if (!health || tooLong) return
    setBusy(true)
    setError(null)
    if (editing) {
      const result = await window.ostlerAPI.editStatusUpdate(editing.id, { health, note })
      setBusy(false)
      if (!result.ok) return setError(result.error)
      onSaved({ update: result.value.after, before: result.value.before })
    } else {
      const result = await window.ostlerAPI.postStatusUpdate(projectId, { health, note })
      setBusy(false)
      if (!result.ok) return setError(result.error)
      onSaved({ update: result.value })
    }
    onClose()
  }

  return (
    <Dialog
      open
      size="md"
      title={
        editing
          ? t('projects:statusUpdates.editTitle', { projectName })
          : t('projects:statusUpdates.postTitle', { projectName })
      }
      description={t('projects:statusUpdates.dialogDescription')}
      onClose={onClose}
      canDismiss={!busy && !drafting}
      footer={
        <>
          {features.ai && !editing && (
            <Button
              variant="ai"
              icon={Sparkles}
              loading={drafting}
              disabled={busy}
              onClick={() => void draft()}
              className="status-update-dialog__draft"
            >
              {t('projects:statusUpdates.draftFromActivity')}
            </Button>
          )}
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t('projects:statusUpdates.cancel')}
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!health || tooLong || drafting}
            onClick={() => void save()}
          >
            {editing ? t('projects:statusUpdates.save') : t('projects:statusUpdates.post')}
          </Button>
        </>
      }
    >
      <form
        className="status-update-dialog"
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <div className="status-update-dialog__health">
          <span className="status-update-dialog__label" aria-hidden="true">
            {t('projects:statusUpdates.howIsItGoing')}
          </span>
          <SegmentedControl<StatusUpdateHealth>
            label={t('projects:statusUpdates.howIsItGoing')}
            value={(health ?? '') as StatusUpdateHealth}
            onChange={setHealth}
            options={STATUS_UPDATE_HEALTHS.map((value) => ({
              value,
              label: statusUpdateHealthLabel(value),
              icon: HEALTH_ICON[value]
            }))}
          />
        </div>
        <TextArea
          label={t('projects:statusUpdates.note')}
          hint={t('projects:statusUpdates.noteHint', {
            count: note.length,
            max: formatNumber(MAX_STATUS_UPDATE_NOTE)
          })}
          error={
            tooLong
              ? t('projects:statusUpdates.noteTooLong', {
                  max: formatNumber(MAX_STATUS_UPDATE_NOTE)
                })
              : undefined
          }
          value={note}
          rows={6}
          maxRows={16}
          onChange={(event) => setNote(event.target.value)}
          data-autofocus
        />
        {draftNote && <p className="status-update-dialog__drafted">{draftNote}</p>}
        {error && <InlineAlert tone="danger">{error}</InlineAlert>}
      </form>
    </Dialog>
  )
}
