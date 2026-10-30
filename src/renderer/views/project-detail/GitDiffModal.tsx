import { Button, Dialog, InlineAlert, Skeleton } from '../../ui'
import { DiffPatch } from '../../components/DiffPatch'
import '../planning/planning-dialogs.css'
import { t } from '@shared/i18n'

interface GitDiffModalProps {
  filePath: string
  commitHash: string
  diff: string | null
  loading: boolean
  error: string | null
  onClose: () => void
}

/** One file's changes in one commit, read-only. */
export function GitDiffModal({
  filePath,
  commitHash,
  diff,
  loading,
  error,
  onClose
}: GitDiffModalProps) {
  return (
    <Dialog
      open
      size="lg"
      onClose={onClose}
      title={filePath}
      description={t('projects:gitDiffModal.changesCommitReadOnly', {
        substring: commitHash.substring(0, 7)
      })}
      footer={
        <Button variant="primary" onClick={onClose}>
          {t('projects:gitDiffModal.close')}
        </Button>
      }
    >
      {loading && <Skeleton lines={6} />}
      {!loading && error && <InlineAlert tone="danger">{error}</InlineAlert>}
      {!loading && !error && diff && <DiffPatch patch={diff} />}
      {!loading && !error && !diff && (
        <p className="dialog-muted">{t('projects:gitDiffModal.thereNoChangesShow')}</p>
      )}
    </Dialog>
  )
}
