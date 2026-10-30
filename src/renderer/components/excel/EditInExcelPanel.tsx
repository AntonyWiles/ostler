import { Button } from '../../ui'
import { FileSpreadsheet } from '../../ui/icons'
import { t } from '@shared/i18n'
import './EditInExcel.css'

export interface EditInExcelPanelProps {
  fileName: string
  busy: boolean
  onBringBack: () => void
  /** Bring changes back from another file the person picks. */
  onChooseFile: () => void
  onDone: () => void
}

/**
 * Shown while a file from Edit in Excel (N2.8) is open in the spreadsheet:
 * its name, Bring changes back and Done. It stays until Done, so a person can
 * bring changes back more than once.
 */
export function EditInExcelPanel({
  fileName,
  busy,
  onBringBack,
  onChooseFile,
  onDone
}: EditInExcelPanelProps) {
  return (
    <section className="edit-in-excel" aria-label={t('data:editInExcel.panelLabel')}>
      <FileSpreadsheet className="edit-in-excel__icon" aria-hidden />
      <div className="edit-in-excel__text">
        <strong className="edit-in-excel__file">{fileName}</strong>
        <span className="edit-in-excel__hint">{t('data:editInExcel.panelHint')}</span>
      </div>
      <div className="edit-in-excel__actions">
        <Button size="sm" variant="primary" loading={busy} onClick={onBringBack}>
          {t('data:editInExcel.bringBack')}
        </Button>
        <Button size="sm" disabled={busy} onClick={onChooseFile}>
          {t('data:editInExcel.chooseFile')}
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={onDone}>
          {t('data:editInExcel.done')}
        </Button>
      </div>
    </section>
  )
}
