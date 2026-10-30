import { useState } from 'react'
import type { ProjectTokenKind } from '@shared/ostler-api'
import { Button } from '../../ui'
import { t } from '@shared/i18n'

/**
 * A project token, hidden by default. The renderer never holds it until the
 * person presses Show; Copy has main build the connection text and copy it.
 */
export function TokenControls({
  projectId,
  kind,
  label,
  copyDisabled,
  copyTitle,
  setError
}: {
  projectId: string
  kind: ProjectTokenKind
  label: string
  copyDisabled: boolean
  copyTitle?: string
  setError: (error: string | null) => void
}) {
  const [revealed, setRevealed] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  return (
    <>
      <code className="ostler-settings-token" aria-label={label}>
        {revealed ?? '••••••••••••'}
      </code>
      <Button
        size="sm"
        variant="ghost"
        aria-label={
          revealed
            ? t('agents:agentsSection.hide', { lowerCase: label.toLowerCase() })
            : t('agents:agentsSection.show', { lowerCase: label.toLowerCase() })
        }
        onClick={async () => {
          if (revealed) return setRevealed(null)
          const result = await window.ostlerAPI.revealProjectToken(projectId, kind)
          if (result.ok) setRevealed(result.value)
          else setError(result.error)
        }}
      >
        {revealed ? t('agents:agentsSection.hide2') : t('agents:agentsSection.show2')}
      </Button>
      <Button
        size="sm"
        disabled={copyDisabled}
        title={copyTitle}
        aria-label={t('agents:agentsSection.copyConnectionDetails', {
          lowerCase: label.toLowerCase()
        })}
        onClick={async () => {
          const result = await window.ostlerAPI.copyProjectConnection(projectId, kind)
          if (!result.ok) return setError(result.error)
          setCopied(true)
          setTimeout(() => setCopied(false), 2000)
        }}
      >
        {copied ? t('agents:agentsSection.copied') : t('agents:agentsSection.copy')}
      </Button>
    </>
  )
}
