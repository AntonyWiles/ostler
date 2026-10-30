import { useState } from 'react'
import type {
  CsvUpdateApplyRequest,
  CsvUpdatePreview,
  CsvUpdateSkipReason
} from '@shared/ostler-api'
import { Button, Checkbox, Dialog, InlineAlert } from '../../ui'
import { t } from '@shared/i18n'
import './EditInExcel.css'

export interface BringBackDialogProps {
  preview: CsvUpdatePreview
  busy: boolean
  onApply: (request: CsvUpdateApplyRequest) => void
  onClose: () => void
}

const SKIP_REASON: Record<CsvUpdateSkipReason, () => string> = {
  unknown: () => t('data:editInExcel.skipUnknown'),
  archived: () => t('data:editInExcel.skipArchived'),
  otherProject: () => t('data:editInExcel.skipOtherProject'),
  duplicate: () => t('data:editInExcel.skipDuplicate')
}

/**
 * Bring changes back's preview (N2.8): every changed field, old and new, the
 * new tasks and the rows left out, with a tick box per task. Apply changes
 * only the ticked ones; nothing is written before it.
 */
export function BringBackDialog({ preview, busy, onApply, onClose }: BringBackDialogProps) {
  const changeable = preview.changed.filter((row) => row.changes.length > 0)
  const importable = preview.newRows.filter((row) => row.errors.length === 0)
  const [tasks, setTasks] = useState(() => new Set(changeable.map((row) => row.taskId)))
  const [lines, setLines] = useState(() => new Set(importable.map((row) => row.line)))
  const toggle = <T,>(set: Set<T>, value: T) => {
    const next = new Set(set)
    if (next.has(value)) next.delete(value)
    else next.add(value)
    return next
  }
  const nothing = tasks.size === 0 && lines.size === 0

  return (
    <Dialog
      open
      size="lg"
      title={t('data:editInExcel.previewTitle', { fileName: preview.fileName })}
      description={t('data:editInExcel.previewDescription')}
      onClose={onClose}
      canDismiss={!busy}
      closeOnBackdrop={false}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            {t('data:editInExcel.cancel')}
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={nothing}
            onClick={() => onApply({ taskIds: [...tasks], newLines: [...lines] })}
          >
            {t('data:editInExcel.apply')}
          </Button>
        </>
      }
    >
      <p className="bring-back__summary">
        {t('data:editInExcel.summary', {
          changed: changeable.length,
          added: importable.length,
          unchanged: preview.unchangedCount,
          skipped: preview.skipped.length
        })}
      </p>
      {!preview.hasIdColumn && (
        <InlineAlert tone="warning">{t('data:editInExcel.noIdColumn')}</InlineAlert>
      )}

      {preview.changed.length > 0 && (
        <section className="bring-back__section">
          <h3>{t('data:editInExcel.changedTasks')}</h3>
          <ul className="bring-back__list">
            {preview.changed.map((row) => (
              <li key={row.taskId}>
                {row.changes.length > 0 ? (
                  <Checkbox
                    label={row.title}
                    checked={tasks.has(row.taskId)}
                    onChange={() => setTasks((current) => toggle(current, row.taskId))}
                  />
                ) : (
                  <strong>{row.title}</strong>
                )}
                <ul className="bring-back__changes">
                  {row.changes.map((change) => (
                    <li key={change.column} className="bring-back__change">
                      {t('data:editInExcel.fieldLabel', { label: change.label })}{' '}
                      <span className="bring-back__from">
                        {change.from || t('data:editInExcel.empty')}
                      </span>{' '}
                      {t('data:editInExcel.becomes')}{' '}
                      <span>{change.to || t('data:editInExcel.empty')}</span>
                    </li>
                  ))}
                  {row.problems.map((problem) => (
                    <li key={`problem-${problem.column}`} className="bring-back__problem">
                      {t('data:editInExcel.problem', {
                        label: problem.label,
                        message: problem.message
                      })}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      )}

      {preview.newRows.length > 0 && (
        <section className="bring-back__section">
          <h3>{t('data:editInExcel.newTasks')}</h3>
          <ul className="bring-back__list">
            {preview.newRows.map((row) =>
              row.errors.length === 0 ? (
                <li key={row.line}>
                  <Checkbox
                    label={row.title}
                    hint={row.warnings.join(' ') || undefined}
                    checked={lines.has(row.line)}
                    onChange={() => setLines((current) => toggle(current, row.line))}
                  />
                </li>
              ) : (
                <li key={row.line} className="bring-back__problem">
                  {t('data:editInExcel.rowNotImported', {
                    line: row.line,
                    reason: row.errors.join(' ')
                  })}
                </li>
              )
            )}
          </ul>
          {(preview.newPeople.length > 0 || preview.newMilestones.length > 0) && (
            <p className="bring-back__summary">
              {t('data:editInExcel.newRecords', {
                names: [...preview.newPeople, ...preview.newMilestones].join(', ')
              })}
            </p>
          )}
        </section>
      )}

      {preview.skipped.length > 0 && (
        <section className="bring-back__section">
          <h3>{t('data:editInExcel.skippedRows')}</h3>
          <ul className="bring-back__skipped">
            {preview.skipped.map((row) => (
              <li key={row.line}>
                {t('data:editInExcel.skippedRow', {
                  line: row.line,
                  title: row.title || row.id,
                  reason: SKIP_REASON[row.reason]()
                })}
              </li>
            ))}
          </ul>
        </section>
      )}

      {preview.changed.length === 0 && preview.newRows.length === 0 && (
        <p>{t('data:editInExcel.nothingChanged')}</p>
      )}
    </Dialog>
  )
}
