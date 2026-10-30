import { useEffect, useState, type ReactNode } from 'react'
import { useFeatures } from '../navigation/features'
import { useAgentActivity } from '../shell/AgentActivity'
import { Bot, Icon, OctagonX, Sparkles } from '../ui/icons'
import { StatusBarTimer } from '../time/StatusBarTimer'
import { StatusBarFocus } from '../time/StatusBarFocus'
import { NotificationCenter } from './NotificationCenter'
import { StatusBarSharing } from './StatusBarSharing'
import { StatusBarSave } from './StatusBarSave'
import './StatusBar.css'
import { t } from '@shared/i18n'

/**
 * The app's footer: the running timer (R2.3), then background activity. Agents running, Ostler AI busy, and Stop all AI while
 * AI or agents are on. The notification centre's bell is always at the far right. The watcher, database size and AI setup live in
 * Settings. `leading` holds Undo and Redo when Windows draws the title bar.
 */
export function StatusBar({ leading = null }: { leading?: ReactNode } = {}) {
  const features = useFeatures()
  const activity = useAgentActivity()
  const [activeRequests, setActiveRequests] = useState(0)
  // Latched until the human resumes, so it is read once and then only changed
  // by the two buttons below rather than polled.
  const [halted, setHalted] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [stopNotice, setStopNotice] = useState<string | null>(null)

  useEffect(() => {
    void window.ostlerAPI.getAIHaltState().then((result) => {
      if (!result.ok) return
      setHalted(result.value.halted)
      setActiveRequests(result.value.activeRequests ?? 0)
    })
    // Main pushes 'ai' whenever a model request starts or finishes.
    return window.ostlerAPI.onProjectStateChange((update) => {
      if (update.field !== 'ai') return
      const data = update.data as { activeRequests?: number; halted?: boolean } | null
      setActiveRequests(data?.activeRequests ?? 0)
      // The tray's Stop all AI (P8.2) halts too.
      if (data?.halted !== undefined) setHalted(data.halted)
    })
  }, [])

  useEffect(() => {
    if (!stopNotice) return
    const timer = setTimeout(() => setStopNotice(null), 8_000)
    return () => clearTimeout(timer)
  }, [stopNotice])

  const emergencyStop = async () => {
    setStopping(true)
    try {
      const result = await window.ostlerAPI.emergencyStopAI()
      if (result.ok) {
        setHalted(true)
        const sessions = result.value.stoppedSessions ?? 0
        setStopNotice(t('navigation:statusBar.stoppedAllAiRequests', { count: sessions }))
      } else {
        setStopNotice(t('navigation:statusBar.couldnTStopAll', { error: result.error }))
      }
    } finally {
      setStopping(false)
    }
  }

  const resumeAi = async () => {
    const result = await window.ostlerAPI.resumeAI()
    if (result.ok) {
      setHalted(result.value.halted)
      setStopNotice(null)
    } else {
      setStopNotice(t('navigation:statusBar.couldNotResume', { error: result.error }))
    }
  }

  const showStop = features.ai || features.agents

  return (
    <footer className="ostler-statusbar tabular-nums">
      <div className="statusbar-left">
        {leading}
        <StatusBarFocus />
        <StatusBarTimer />
        <span className="statusbar-activity" role="status" aria-live="polite">
          <StatusBarSave />
          <StatusBarSharing />
          {features.agents && activity.running > 0 && (
            <span className="statusbar-item">
              <Icon icon={Bot} />
              {t('navigation:statusBar.agentsRunning', { count: activity.running })}
            </span>
          )}
          {activeRequests > 0 && (
            <span className="statusbar-item">
              <Icon icon={Sparkles} />
              {t('navigation:statusBar.aiBusy')}
            </span>
          )}
        </span>
      </div>
      <div className="statusbar-right">
        {stopNotice && (
          <span className="statusbar-stop-notice" role="status">
            {stopNotice}
          </span>
        )}
        {halted ? (
          <button
            type="button"
            className="statusbar-stop statusbar-stop--halted"
            onClick={() => void resumeAi()}
            title={t('navigation:statusBar.aiStoppedNoAgent')}
          >
            <Icon icon={OctagonX} />
            {t('navigation:statusBar.aiStoppedResume')}
          </button>
        ) : (
          showStop && (
            <button
              type="button"
              className="statusbar-stop"
              disabled={stopping}
              onClick={() => void emergencyStop()}
              title={t('navigation:statusBar.cancelEveryAiRequest')}
            >
              <Icon icon={OctagonX} className="statusbar-stop-sign" />
              {stopping ? t('navigation:statusBar.stopping') : t('navigation:statusBar.stopAllAi')}
            </button>
          )
        )}
        <NotificationCenter />
      </div>
    </footer>
  )
}
