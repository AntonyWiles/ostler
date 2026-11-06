import { useState } from 'react'
import type { RendererProject } from '@shared/ostler-api'
import type { ResolvedShareReportOptions } from '@shared/export/share-report'
import { Button, Checkbox, Dialog, Radio, RadioGroup, useToast } from '../../ui'
import { readShareReportOptions, writeShareReportOptions } from './share-options-memory'
import '../ExportProjectDialog.css'
import { t } from '@shared/i18n'

type Flag =
  | 'descriptions'
  | 'decisions'
  | 'finished'
  | 'people'
  | 'statusUpdate'
  | 'comments'
  | 'goals'
  | 'milestoneDetails'
  | 'taskDetails'

/**
 * "Share as a web page…" (R4.1, D37): the project as one self-contained
 * `.html` file, written where the person chooses. The options are
 * remembered per viewer.
 */
export function ShareReportDialog({
  project,
  onClose
}: {
  project: RendererProject
  onClose: () => void
}) {
  const { toast } = useToast()
  const [options, setOptions] = useState<ResolvedShareReportOptions>(readShareReportOptions)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    writeShareReportOptions(options)
    setBusy(true)
    const result = await window.ostlerAPI.exportShareReport(project.id, options)
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    if (!result.value) return
    toast({
      title: t('data:shareReportDialog.exported', { projectName: project.name }),
      body: result.value,
      tone: 'success'
    })
    onClose()
  }

  const flag = (key: Flag, label: string) => (
    <Checkbox
      label={label}
      checked={options[key] === true}
      onChange={(event) => {
        const checked = event.target.checked
        setOptions((current) => ({ ...current, [key]: checked }))
      }}
    />
  )
  const groupBy = (value: ResolvedShareReportOptions['groupBy'], label: string) => (
    <Radio
      name="share-report-group"
      value={value}
      label={label}
      checked={options.groupBy === value}
      onChange={() => setOptions((current) => ({ ...current, groupBy: value }))}
    />
  )

  return (
    <Dialog
      open
      size="sm"
      title={t('data:shareReportDialog.title', { projectName: project.name })}
      description={t('data:shareReportDialog.description')}
      onClose={onClose}
      canDismiss={!busy}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t('data:shareReportDialog.cancel')}
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void save()}>
            {t('data:shareReportDialog.chooseWhere')}
          </Button>
        </>
      }
    >
      <div className="ostler-export-project">
        <p>{t('data:shareReportDialog.whatIsIncluded')}</p>
        <RadioGroup legend={t('data:shareReportDialog.groupBy')} orientation="horizontal">
          {groupBy('status', t('data:shareReportDialog.groupByStatus'))}
          {groupBy('milestone', t('data:shareReportDialog.groupByMilestone'))}
        </RadioGroup>
        {flag('descriptions', t('data:shareReportDialog.includeDescriptions'))}
        {flag('decisions', t('data:shareReportDialog.includeDecisions'))}
        {flag('finished', t('data:shareReportDialog.includeFinished'))}
        {flag('people', t('data:shareReportDialog.includePeople'))}
        {flag('statusUpdate', t('data:shareReportDialog.includeStatusUpdate'))}
        {flag('goals', t('data:shareReportDialog.includeGoals'))}
        {flag('milestoneDetails', t('data:shareReportDialog.includeMilestoneDetails'))}
        {flag('taskDetails', t('data:shareReportDialog.includeTaskDetails'))}
        {flag('comments', t('data:shareReportDialog.includeComments'))}
        {error && (
          <p className="ui-field__error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  )
}
