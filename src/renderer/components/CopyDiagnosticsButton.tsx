import { useState } from 'react'
import { Button } from '../ui'
import { Copy } from '../ui/icons'
import { t } from '@shared/i18n'

/** Copies redacted diagnostics (built in main) for a bug report. */
export function CopyDiagnosticsButton() {
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle')

  return (
    <>
      <Button
        variant="secondary"
        icon={Copy}
        onClick={async () => {
          const result = await window.ostlerAPI.copyDiagnostics()
          setStatus(result.ok ? 'copied' : 'failed')
          setTimeout(() => setStatus('idle'), 2500)
        }}
      >
        {status === 'copied'
          ? t('settings:copyDiagnosticsButton.diagnosticsCopied')
          : t('settings:copyDiagnosticsButton.copyDiagnostics')}
      </Button>
      {status === 'failed' && (
        <span role="alert" className="ostler-error-boundary-note">
          {t('settings:copyDiagnosticsButton.diagnosticsCouldNotCopied')}
        </span>
      )}
    </>
  )
}
