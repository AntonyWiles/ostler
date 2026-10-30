import { useState } from 'react'
import type { RendererProject } from '@shared/ostler-api'
import { BRAND } from '@shared/brand'
import { Button, Checkbox, Dialog, useToast } from '../../ui'
import { readCalendarFileOptions, writeCalendarFileOptions } from './share-options-memory'
import '../ExportProjectDialog.css'
import { t } from '@shared/i18n'

/**
 * "Export to calendar file…" (R4.1, D37): the project's due dates as an
 * `.ics` file, written where the person chooses. Finished tasks only if
 * ticked; the choice is remembered.
 */
export function ExportCalendarDialog({
  project,
  onClose
}: {
  project: RendererProject
  onClose: () => void
}) {
  const { toast } = useToast()
  const [includeFinished, setIncludeFinished] = useState(
    () => readCalendarFileOptions().includeFinished
  )
  const [includeBlocks, setIncludeBlocks] = useState(() => readCalendarFileOptions().includeBlocks)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    writeCalendarFileOptions({ includeFinished, includeBlocks })
    setBusy(true)
    const result = await window.ostlerAPI.exportCalendarFile(project.id, {
      includeFinished,
      includeBlocks
    })
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    if (!result.value) return
    toast({
      title: t('data:exportCalendarDialog.exported', { projectName: project.name }),
      body: result.value,
      tone: 'success'
    })
    onClose()
  }

  return (
    <Dialog
      open
      size="sm"
      title={t('data:exportCalendarDialog.title', { projectName: project.name })}
      description={t('data:exportCalendarDialog.description')}
      onClose={onClose}
      canDismiss={!busy}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t('data:exportCalendarDialog.cancel')}
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void save()}>
            {t('data:exportCalendarDialog.chooseWhere')}
          </Button>
        </>
      }
    >
      <div className="ostler-export-project">
        <p>{t('data:exportCalendarDialog.whatIsIncluded', { appName: BRAND.name })}</p>
        <Checkbox
          label={t('data:exportCalendarDialog.includeFinished')}
          checked={includeFinished}
          onChange={(event) => setIncludeFinished(event.target.checked)}
          data-autofocus
        />
        <Checkbox
          label={t('data:exportCalendarDialog.includeBlocks')}
          hint={t('data:exportCalendarDialog.includeBlocksNote')}
          checked={includeBlocks}
          onChange={(event) => setIncludeBlocks(event.target.checked)}
        />
        <p className="ostler-export-project__note">{t('data:exportCalendarDialog.notLive')}</p>
        {error && (
          <p className="ui-field__error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  )
}
