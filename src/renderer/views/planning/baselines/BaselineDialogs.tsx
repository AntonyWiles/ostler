import { useState } from 'react'
import { todayIsoDate } from '@shared/dates'
import { formatDateTime } from '@shared/format'
import { t } from '@shared/i18n'
import {
  MAX_BASELINES,
  MAX_BASELINE_NAME,
  baselineName,
  type Baseline
} from '@shared/planning/baselines'
import { Button, Dialog, IconButton, InlineAlert, Select, TextField, useToast } from '../../../ui'
import { Check, Pencil, Trash2 } from '../../../ui/icons'
import { suggestedBaselineName } from './baseline-words'
import { useBaselines } from './useBaselines'
import './BaselineDialogs.css'

/**
 * Save a baseline (N7.4): a name, "Plan agreed 3 October" suggested from
 * today, then one call that copies every live task's and milestone's dates.
 * With ten saved already, it asks which to delete to make room.
 */
export function SaveBaselineDialog({
  projectId,
  onClose,
  onSaved
}: {
  projectId: string
  onClose: () => void
  onSaved?: (baseline: Baseline) => void
}) {
  const { baselines } = useBaselines(projectId)
  const { toast } = useToast()
  const [name, setName] = useState(() => suggestedBaselineName(todayIsoDate()))
  const [replaceId, setReplaceId] = useState('')
  const [error, setError] = useState<string | null>(null)
  // A save the main process refused: its reason, under a title that says what failed.
  const [saveFailed, setSaveFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const atLimit = baselines.length >= MAX_BASELINES

  const save = async () => {
    const clean = baselineName(name)
    setSaveFailed(false)
    if (clean === null) {
      setError(t('views:baselines.nameInvalid'))
      return
    }
    if (atLimit && !replaceId) {
      setError(t('views:baselines.replaceInvalid'))
      return
    }
    setBusy(true)
    const result = await window.ostlerAPI.createBaseline(projectId, {
      name: clean,
      ...(atLimit ? { replaceId } : {})
    })
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      setSaveFailed(true)
      return
    }
    toast({ title: t('views:baselines.saved', { name: result.value.name }), tone: 'success' })
    onSaved?.(result.value)
    onClose()
  }

  return (
    <Dialog
      open
      size="sm"
      onClose={onClose}
      title={t('views:baselines.saveTitle')}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            {t('views:baselines.cancel')}
          </Button>
          <Button variant="primary" loading={busy} disabled={busy} onClick={() => void save()}>
            {t('views:baselines.saveButton')}
          </Button>
        </>
      }
    >
      <div className="baseline-form">
        <p className="baseline-form__note">{t('views:baselines.saveDescription')}</p>
        {error && (
          <InlineAlert
            tone="danger"
            title={saveFailed ? t('views:baselines.couldNotSave') : undefined}
          >
            {error}
          </InlineAlert>
        )}
        <TextField
          label={t('views:baselines.name')}
          value={name}
          maxLength={MAX_BASELINE_NAME}
          autoFocus
          onChange={(event) => {
            setName(event.target.value)
            setError(null)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void save()
          }}
        />
        {atLimit && (
          <>
            <InlineAlert tone="warning">{t('views:baselines.atLimit')}</InlineAlert>
            <Select
              label={t('views:baselines.replace')}
              value={replaceId}
              onChange={(event) => {
                setReplaceId(event.target.value)
                setError(null)
              }}
              options={[
                { value: '', label: '' },
                ...baselines.map((baseline) => ({ value: baseline.id, label: baseline.name }))
              ]}
            />
          </>
        )}
      </div>
    </Dialog>
  )
}

/** Baselines (N7.4): the project's baselines, newest first, with rename and delete (with undo). */
export function BaselinesDialog({
  projectId,
  onClose
}: {
  projectId: string
  onClose: () => void
}) {
  const { baselines, reload } = useBaselines(projectId)
  const { toast, toastUndo } = useToast()
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null)

  const rename = async () => {
    if (!renaming) return
    const clean = baselineName(renaming.name)
    if (clean === null) {
      toast({
        title: t('views:baselines.couldNotRename'),
        body: t('views:baselines.nameInvalid'),
        tone: 'danger'
      })
      return
    }
    const result = await window.ostlerAPI.renameBaseline(projectId, renaming.id, clean)
    if (!result.ok) {
      toast({ title: t('views:baselines.couldNotRename'), body: result.error, tone: 'danger' })
      return
    }
    setRenaming(null)
    await reload()
  }

  const remove = async (baseline: Baseline) => {
    const result = await window.ostlerAPI.deleteBaseline(projectId, baseline.id)
    if (!result.ok) {
      toast({ title: t('views:baselines.couldNotDelete'), body: result.error, tone: 'danger' })
      return
    }
    await reload()
    toastUndo(t('views:baselines.deleted', { name: baseline.name }), () =>
      window.ostlerAPI.restoreBaseline(projectId, result.value).then(() => reload())
    )
  }

  return (
    <Dialog
      open
      size="md"
      onClose={onClose}
      title={t('views:baselines.listTitle')}
      footer={<Button onClick={onClose}>{t('views:baselines.close')}</Button>}
    >
      <p className="baseline-form__note">{t('views:baselines.listDescription')}</p>
      {baselines.length === 0 ? (
        <p className="baseline-list__empty">{t('views:baselines.none')}</p>
      ) : (
        <ul className="baseline-list" aria-label={t('views:baselines.listTitle')}>
          {baselines.map((baseline) => (
            <li key={baseline.id} className="baseline-list__item">
              {renaming?.id === baseline.id ? (
                <TextField
                  className="baseline-list__rename"
                  label={t('views:baselines.renameField', { name: baseline.name })}
                  hideLabel
                  value={renaming.name}
                  maxLength={MAX_BASELINE_NAME}
                  autoFocus
                  onChange={(event) => setRenaming({ id: baseline.id, name: event.target.value })}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void rename()
                    else if (event.key === 'Escape') {
                      event.preventDefault()
                      event.stopPropagation()
                      setRenaming(null)
                    }
                  }}
                />
              ) : (
                <div className="baseline-list__text">
                  <span className="baseline-list__name">{baseline.name}</span>
                  <span className="baseline-list__meta">
                    {t('views:baselines.savedOn', {
                      when: formatDateTime(baseline.savedAt),
                      tasks: t('views:baselines.tasks', { count: baseline.taskCount }),
                      milestones: t('views:baselines.milestones', {
                        count: baseline.milestoneCount
                      })
                    })}
                  </span>
                </div>
              )}
              {renaming?.id === baseline.id ? (
                <IconButton
                  label={t('views:baselines.renameDone')}
                  icon={Check}
                  onClick={() => void rename()}
                />
              ) : (
                <IconButton
                  label={t('views:baselines.rename', { name: baseline.name })}
                  icon={Pencil}
                  onClick={() => setRenaming({ id: baseline.id, name: baseline.name })}
                />
              )}
              <IconButton
                label={t('views:baselines.delete', { name: baseline.name })}
                icon={Trash2}
                onClick={() => void remove(baseline)}
              />
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  )
}
