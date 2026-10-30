import { useState } from 'react'
import type { RendererProject, TimelineSlidesExportOptions } from '@shared/ostler-api'
import { compareIsoDates, isIsoDate } from '@shared/dates'
import { Button, DateField, Dialog, useToast } from '../../ui'
import '../ExportProjectDialog.css'
import { t } from '@shared/i18n'

/**
 * "Export to PowerPoint slide…" (N7.6, N54): the Timeline's tasks, in its
 * grouping and filter, as editable PowerPoint slides written where the
 * person chooses. The range starts as the Timeline's own and can be changed.
 */
export function ExportTimelineSlidesDialog({
  project,
  view,
  onClose
}: {
  project: RendererProject
  /** What the Timeline shows: its range, tasks, zoom, grouping and collapsed groups. */
  view: Omit<TimelineSlidesExportOptions, 'from' | 'to'> & { from: string; to: string }
  onClose: () => void
}) {
  const { toast } = useToast()
  const [from, setFrom] = useState(view.from)
  const [to, setTo] = useState(view.to)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const valid = isIsoDate(from) && isIsoDate(to) && compareIsoDates(from, to) <= 0

  const save = async () => {
    if (!valid) {
      setError(t('views:timelineSlides.badRange'))
      return
    }
    setBusy(true)
    const result = await window.ostlerAPI.exportTimelineSlides(project.id, { ...view, from, to })
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    if (!result.value) return
    toast({
      title: t('views:timelineSlides.exported', { projectName: project.name }),
      body: result.value,
      tone: 'success'
    })
    onClose()
  }

  return (
    <Dialog
      open
      size="sm"
      title={t('views:timelineSlides.dialogTitle', { projectName: project.name })}
      description={t('views:timelineSlides.dialogDescription')}
      onClose={onClose}
      canDismiss={!busy}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t('views:timelineSlides.cancel')}
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void save()}>
            {t('views:timelineSlides.chooseWhere')}
          </Button>
        </>
      }
    >
      <div className="ostler-export-project">
        <p>{t('views:timelineSlides.whatIsIncluded')}</p>
        <DateField
          label={t('views:timelineSlides.from')}
          value={from}
          onChange={setFrom}
          due={false}
          max={to || undefined}
        />
        <DateField
          label={t('views:timelineSlides.to')}
          hint={t('views:timelineSlides.rangeHint')}
          value={to}
          onChange={setTo}
          due={false}
          min={from || undefined}
        />
        <p className="ostler-export-project__note">{t('views:timelineSlides.notLive')}</p>
        {error && (
          <p className="ui-field__error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  )
}
