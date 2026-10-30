import { Suspense, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ImportResult } from '@shared/ostler-api'
import { useOstler } from '../../context/OstlerContext'
import { projectPath } from '../../navigation/paths'
import { useToast } from '../../ui'
import { lazyNamed } from '../../lib/lazy-named'
import type { ImportDialogTarget } from './ImportDialog'
import { t } from '@shared/i18n'

// The importer (and its CSV parser) loads the first time it opens (P9.1).
const ImportDialog = lazyNamed(() => import('./ImportDialog'), 'ImportDialog')

/**
 * The import dialog and what follows every import, wherever it starts (the
 * New project wizard, a project's More menu, Settings › Data): refresh the
 * projects, open the project's List, and say what came in.
 */
export function ImportFlow({
  target,
  onClose,
  onImported
}: {
  target: ImportDialogTarget
  onClose: () => void
  /** After a successful import, before the project opens. */
  onImported?: (result: ImportResult) => void
}) {
  const navigate = useNavigate()
  const { refreshProjects } = useOstler()
  const { toast } = useToast()

  const imported = async (result: ImportResult) => {
    onImported?.(result)
    await refreshProjects()
    navigate(projectPath(result.projectId, 'list'))
    const notes = [
      result.skipped > 0
        ? t('data:useImportDialog.rowsErrorsSkipped', { count: result.skipped })
        : '',
      ...result.warnings
    ].filter(Boolean)
    toast({
      title: t('data:useImportDialog.importedTasksInto', {
        count: result.batch.itemCount,
        projectName: result.projectName
      }),
      body: notes.length > 0 ? notes.join(' ') : t('data:useImportDialog.undoInboxSettingsData'),
      tone: notes.length > 0 ? 'warning' : 'success'
    })
  }

  return (
    <Suspense fallback={null}>
      <ImportDialog
        target={target}
        onClose={onClose}
        onImported={(result) => void imported(result)}
      />
    </Suspense>
  )
}

/** Opens the import flow from a menu or a button; `dialog` goes in the caller's tree. */
export function useImportDialog(options: { onImported?: () => void } = {}): {
  open: (target: ImportDialogTarget) => void
  dialog: ReactNode
} {
  const [target, setTarget] = useState<ImportDialogTarget | null>(null)
  return {
    open: setTarget,
    dialog: target ? (
      <ImportFlow
        target={target}
        onClose={() => setTarget(null)}
        onImported={() => {
          setTarget(null)
          options.onImported?.()
        }}
      />
    ) : null
  }
}
