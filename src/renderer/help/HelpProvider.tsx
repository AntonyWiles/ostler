import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useShortcuts } from '../navigation/shortcuts'
import { helpPath, settingsPath } from '../navigation/paths'
import { useToast } from '../ui'
import { ShortcutOverlay } from '../components/help/ShortcutOverlay'
import { WhatsNewDialog } from './WhatsNewDialog'
import { whatsNew } from './guide'
import { t } from '@shared/i18n'

/** The Help menu's actions, shared by the sidebar, the command palette and `?`. */
export interface HelpApi {
  openGuide: (page?: string) => void
  showShortcuts: () => void
  showWhatsNew: () => void
  reportProblem: () => Promise<void>
  copyDiagnostics: () => Promise<void>
  openAbout: () => void
}

const HelpContext = createContext<HelpApi | null>(null)

/**
 * Help (P8.1): the shortcut overlay (`?`), What's new, Report a problem and
 * Copy diagnostics. What's new opens by itself once after an update: when the
 * version differs from the last one shown (`ui.lastSeenVersion`). A new
 * install's welcome records the version, so it is not shown on first run.
 */
export function HelpProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const { toast } = useToast()
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [whatsNewOpen, setWhatsNewOpen] = useState(false)
  const [version, setVersion] = useState('')

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [versionResult, config] = await Promise.all([
        window.ostlerAPI.getAppVersion(),
        window.ostlerAPI.getConfig()
      ])
      if (cancelled || !versionResult.ok) return
      setVersion(versionResult.value)
      if (!config.ok || !config.value.ui.firstRunCompleted) return
      if (config.value.ui.lastSeenVersion === versionResult.value) return
      await window.ostlerAPI.updateConfig({ ui: { lastSeenVersion: versionResult.value } })
      if (!cancelled && whatsNew(versionResult.value)) setWhatsNewOpen(true)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useShortcuts({ 'shortcut-help': () => setShortcutsOpen(true) })

  const copyDiagnostics = useCallback(async () => {
    const result = await window.ostlerAPI.copyDiagnostics()
    toast(
      result.ok
        ? {
            title: t('help:helpProvider.diagnosticsCopied'),
            body: t('help:helpProvider.versionsCountsEndLog')
          }
        : {
            title: t('help:helpProvider.couldntCopyDiagnostics'),
            body: result.error,
            tone: 'danger'
          }
    )
  }, [toast])

  const reportProblem = useCallback(async () => {
    const result = await window.ostlerAPI.reportProblem()
    toast(
      result.ok
        ? {
            title: t('help:helpProvider.diagnosticsCopied'),
            body: t('help:helpProvider.issuePageOpenBrowser')
          }
        : { title: t('help:helpProvider.couldntOpenIssuePage'), body: result.error, tone: 'danger' }
    )
  }, [toast])

  const api = useMemo<HelpApi>(
    () => ({
      openGuide: (page) => navigate(helpPath(page)),
      showShortcuts: () => setShortcutsOpen(true),
      showWhatsNew: () => setWhatsNewOpen(true),
      reportProblem,
      copyDiagnostics,
      openAbout: () => navigate(settingsPath('about'))
    }),
    [navigate, reportProblem, copyDiagnostics]
  )

  return (
    <HelpContext.Provider value={api}>
      {children}
      <ShortcutOverlay open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      <WhatsNewDialog
        open={whatsNewOpen}
        version={version}
        onClose={() => setWhatsNewOpen(false)}
      />
    </HelpContext.Provider>
  )
}

export function useHelp(): HelpApi {
  const context = useContext(HelpContext)
  if (!context) throw new Error('useHelp needs a HelpProvider')
  return context
}

/** Help when there is one (the command palette also renders outside the shell in tests). */
export function useOptionalHelp(): HelpApi | null {
  return useContext(HelpContext)
}
