import { useEffect, useState } from 'react'
import type { RendererProject } from '@shared/ostler-api'
import { MIN_FILE_PASSWORD_LENGTH, passwordStrength } from '@shared/file-password'
import { Button, Checkbox, Dialog, InlineAlert, TextField, useToast } from '../ui'
import './ExportProjectDialog.css'
import { t } from '@shared/i18n'

/**
 * "Export project…" (P6.1): one `<project>.ostler-project` file (a zip, D29)
 * holding `project.json` and the Library's files, which imports back as a
 * new project. Comments travel if chosen. **Protect with a password** (N45)
 * encrypts the whole file in main; the password lives only in this dialog's
 * state, cleared when it closes, and is sent once with the export.
 */
export function ExportProjectDialog({
  project,
  onClose
}: {
  project: RendererProject
  onClose: () => void
}) {
  const { toast } = useToast()
  const [comments, setComments] = useState(true)
  const [protect, setProtect] = useState(false)
  const [password, setPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // The password never outlives the dialog.
  useEffect(
    () => () => {
      setPassword('')
      setRepeat('')
    },
    []
  )

  const close = () => {
    setPassword('')
    setRepeat('')
    onClose()
  }

  const strength = passwordStrength(password)
  const tooShort = protect && strength === 'tooShort'
  const mismatch = protect && repeat !== '' && repeat !== password
  const ready = !protect || (!tooShort && repeat === password)

  const save = async () => {
    if (!ready) return
    setBusy(true)
    const result = await window.ostlerAPI.exportProject(project.id, {
      comments,
      ...(protect ? { password } : {})
    })
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    if (!result.value) return
    toast({
      title: t('data:exportProjectDialog.exported', { projectName: project.name }),
      body: result.value,
      tone: 'success'
    })
    close()
  }

  return (
    <Dialog
      open
      size="sm"
      title={t('data:exportProjectDialog.export', { projectName: project.name })}
      description={t('data:exportProjectDialog.oneFileCanKeepShare')}
      onClose={close}
      canDismiss={!busy}
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={busy}>
            {t('data:exportProjectDialog.cancel')}
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={busy || !ready}
            onClick={() => void save()}
          >
            {t('data:exportProjectDialog.chooseWhere')}
          </Button>
        </>
      }
    >
      <div className="ostler-export-project">
        <p>{t('data:exportProjectDialog.tasksMilestonesGoalsLabels')}</p>
        <Checkbox
          label={t('data:exportProjectDialog.includeComments')}
          checked={comments}
          onChange={(event) => setComments(event.target.checked)}
          data-autofocus
        />
        <Checkbox
          label={t('data:exportProjectDialog.protectWithPassword')}
          checked={protect}
          onChange={(event) => {
            setProtect(event.target.checked)
            if (!event.target.checked) {
              setPassword('')
              setRepeat('')
            }
          }}
        />
        {protect && (
          <>
            <TextField
              label={t('data:exportProjectDialog.password')}
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              hint={
                password === ''
                  ? t('data:exportProjectDialog.atLeast', { min: MIN_FILE_PASSWORD_LENGTH })
                  : t(`data:exportProjectDialog.strength.${strength}`, {
                      min: MIN_FILE_PASSWORD_LENGTH
                    })
              }
            />
            <TextField
              label={t('data:exportProjectDialog.passwordAgain')}
              type="password"
              autoComplete="new-password"
              value={repeat}
              onChange={(event) => setRepeat(event.target.value)}
              error={mismatch ? t('data:exportProjectDialog.passwordsDiffer') : undefined}
            />
            <InlineAlert tone="warning">{t('data:exportProjectDialog.noRecovery')}</InlineAlert>
          </>
        )}
        {error && (
          <p className="ui-field__error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  )
}
