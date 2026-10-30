import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useUpdateState } from '../hooks/useUpdateState'
import { settingsPath } from '../navigation/paths'
import { useToast } from '../ui'
import { t } from '@shared/i18n'

/**
 * "Update ready. Restart to update" once per downloaded version (P10.1). The
 * Inbox has its own item. Restart happens only from the toast's button or
 * Settings › About; with agents working, the button opens About, where
 * "Restart when agents finish" is.
 */
export function useUpdateToast(): void {
  const { state } = useUpdateState()
  const { toast } = useToast()
  const navigate = useNavigate()
  const shown = useRef<string | null>(null)

  useEffect(() => {
    if (state?.status !== 'ready' || shown.current === state.version) return
    shown.current = state.version
    const agentsWorking = state.agentsRunning > 0
    toast({
      title: t('navigation:useUpdateToast.updateReadyRestartUpdate'),
      body: agentsWorking
        ? t('navigation:useUpdateToast.agentsWorkingCanRestart')
        : t('navigation:useUpdateToast.versionInstallsWhenRestart', { version: state.version }),
      tone: 'info',
      action: agentsWorking
        ? {
            label: t('navigation:useUpdateToast.restartOptions'),
            onClick: () => navigate(settingsPath('about'))
          }
        : {
            label: t('navigation:useUpdateToast.restartNow'),
            onClick: () => window.ostlerAPI.restartToUpdate('now')
          }
    })
  }, [state, toast, navigate])
}
