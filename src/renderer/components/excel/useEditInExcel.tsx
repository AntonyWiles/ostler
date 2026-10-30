import { useState, type ReactNode } from 'react'
import type {
  BringBackPreview,
  CsvUpdateApplyRequest,
  EditInExcelFile,
  TaskCsvExportRequest
} from '@shared/ostler-api'
import { useToast } from '../../ui'
import { EditInExcelPanel } from './EditInExcelPanel'
import { BringBackDialog } from './BringBackDialog'
import { t } from '@shared/i18n'

/**
 * Edit in Excel (N2.8, N23) for one project: saves its tasks (or the List's
 * rows) as CSV with their IDs, opens the file in the default app, and shows
 * the panel whose Bring changes back previews and applies the edits. One undo
 * puts every changed task back; new tasks come in as an import batch.
 */
export function useEditInExcel(
  projectId: string,
  onChanged: () => void | Promise<unknown>
): { start: (request: TaskCsvExportRequest) => Promise<void>; panel: ReactNode } {
  const { toast, toastUndo } = useToast()
  const [file, setFile] = useState<EditInExcelFile | null>(null)
  const [reading, setReading] = useState(false)
  const [preview, setPreview] = useState<BringBackPreview | null>(null)
  const [applying, setApplying] = useState(false)

  const start = async (request: TaskCsvExportRequest) => {
    const result = await window.ostlerAPI.editInExcel(projectId, request)
    if (!result.ok)
      toast({ title: t('data:editInExcel.couldntOpen'), body: result.error, tone: 'danger' })
    else if (result.value) setFile(result.value)
  }

  const bringBack = async (editId: string | null) => {
    setReading(true)
    try {
      const result = await window.ostlerAPI.previewBringBack(projectId, editId)
      if (!result.ok)
        toast({ title: t('data:editInExcel.couldntRead'), body: result.error, tone: 'danger' })
      else if (result.value) setPreview(result.value)
    } finally {
      setReading(false)
    }
  }

  const closePreview = () => {
    if (preview) void window.ostlerAPI.forgetImportFile(preview.fileId)
    setPreview(null)
  }

  const apply = async (request: CsvUpdateApplyRequest) => {
    if (!preview) return
    setApplying(true)
    try {
      const result = await window.ostlerAPI.applyBringBack(projectId, preview.fileId, request)
      if (!result.ok) {
        toast({ title: t('data:editInExcel.couldntApply'), body: result.error, tone: 'danger' })
        return
      }
      setPreview(null)
      await onChanged()
      const { changed, undo, batch } = result.value
      const added = batch?.itemCount ?? 0
      const body = added > 0 ? t('data:editInExcel.addedTasks', { count: added }) : undefined
      if (changed.length === 0) {
        toast({ title: t('data:editInExcel.addedTasks', { count: added }), tone: 'success' })
        return
      }
      toastUndo(
        t('data:editInExcel.changedToast', { count: changed.length }),
        async () => {
          const undone = await window.ostlerAPI.restoreTaskValues(projectId, undo)
          if (!undone.ok)
            toast({
              title: t('data:editInExcel.couldntUndo'),
              body: undone.error,
              tone: 'danger'
            })
          await onChanged()
        },
        body
      )
    } finally {
      setApplying(false)
    }
  }

  const panel = (
    <>
      {file && (
        <EditInExcelPanel
          fileName={file.fileName}
          busy={reading}
          onBringBack={() => void bringBack(file.editId)}
          onChooseFile={() => void bringBack(null)}
          onDone={() => setFile(null)}
        />
      )}
      {preview && (
        <BringBackDialog
          preview={preview.preview}
          busy={applying}
          onApply={(request) => void apply(request)}
          onClose={closePreview}
        />
      )}
    </>
  )

  return { start, panel }
}
