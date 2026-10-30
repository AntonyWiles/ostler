import { useState } from 'react'
import type { RendererProject } from '@shared/ostler-api'
import { t } from '@shared/i18n'
import { Switch, useConfirm, useToast } from '../../../ui'

/**
 * Project settings' Triage new captures (N4.3a). Turning it off with tasks
 * waiting asks to accept them all into the Backlog, or to keep it on.
 */
export function TriageSetting({
  project,
  onSaved,
  onError
}: {
  project: RendererProject
  onSaved: (project: RendererProject) => void
  onError: (message: string) => void
}) {
  const confirm = useConfirm()
  const { toast } = useToast()
  const [busy, setBusy] = useState(false)

  const save = async (on: boolean) => {
    setBusy(true)
    try {
      if (!on) {
        const waiting = await window.ostlerAPI.getTriage(project.id)
        if (!waiting.ok) return onError(waiting.error)
        const count = waiting.value.items.length
        if (count > 0) {
          const accept = await confirm({
            title: t('tasks:triage.turnOffTitle'),
            body: t('tasks:triage.turnOffBody', { count }),
            confirmLabel: t('tasks:triage.turnOffConfirm'),
            cancelLabel: t('tasks:triage.turnOffCancel')
          })
          if (!accept) return
          const accepted = await window.ostlerAPI.acceptAllTriagedWorkItems(project.id)
          if (!accepted.ok) return onError(accepted.error)
          toast({
            title: t('tasks:triage.acceptedAll', { count: accepted.value }),
            tone: 'success'
          })
        }
      }
      const result = await window.ostlerAPI.updateProject(project.id, { triageCaptures: on })
      if (result.ok) onSaved(result.value)
      else onError(result.error)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Switch
      label={t('tasks:triage.setting')}
      hint={t('tasks:triage.settingHint')}
      checked={project.triageCaptures === true}
      disabled={busy}
      onChange={(event) => void save(event.target.checked)}
    />
  )
}
