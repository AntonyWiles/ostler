import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { RendererProject } from '@shared/ostler-api'
import { needsTryWarning, outputSegments, type TryRun } from '@shared/try-it'
import { t } from '@shared/i18n'
import { Badge, Button, InlineAlert, useConfirm } from '../../ui'
import { Play, Square } from '../../ui/icons'
import './TryItPanel.css'

export interface TryItPanelProps {
  projectId: string
  sessionId: string
  /** The project's try command, '' for none. */
  tryCommand: string
  tryItWarningSeen: boolean
  /** The agent's suggested command, shown with Use this command. Never run. */
  suggestion?: string
  /** Opens Project settings with this command filled in for the person to save. */
  onUseCommand: (command: string) => void
  /** Tells the review whether a run is going, so closing it can ask first. */
  onRunningChange?: (running: boolean) => void
}

/**
 * The project as Try it needs it, read from main: its try command and
 * whether its warning was seen. `reload` after Project settings saved.
 */
export function useTryItProject(projectId: string): {
  project: RendererProject | undefined
  reload: () => void
} {
  const [project, setProject] = useState<RendererProject | undefined>(undefined)
  const [version, setVersion] = useState(0)
  useEffect(() => {
    let live = true
    void window.ostlerAPI.getProjects().then((result) => {
      if (live && result.ok) setProject(result.value.find((item) => item.id === projectId))
    })
    return () => {
      live = false
    }
  }, [projectId, version])
  const reload = useCallback(() => setVersion((current) => current + 1), [])
  return { project, reload }
}

/** Whether a run is still going. */
export function tryRunIsLive(run: TryRun | null): boolean {
  return run?.state === 'running' || run?.state === 'setting-up'
}

/**
 * Try it (N9.4) in Review changes: runs the project's try command in the
 * task's copy, shows its output live, and stops it. The person's own
 * command only; an agent's suggestion is shown, never run.
 */
export function TryItPanel({
  projectId,
  sessionId,
  tryCommand,
  tryItWarningSeen,
  suggestion,
  onUseCommand,
  onRunningChange
}: TryItPanelProps) {
  const confirm = useConfirm()
  const [run, setRun] = useState<TryRun | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Seen in this window already, before the project list catches up.
  const [warned, setWarned] = useState(false)
  const outputRef = useRef<HTMLPreElement>(null)

  useEffect(() => {
    let live = true
    void window.ostlerAPI.getTryRun(projectId, sessionId).then((result) => {
      if (live && result.ok) setRun((current) => current ?? result.value)
    })
    const unsubscribe = window.ostlerAPI.onTryRunChanged((next) => {
      if (next.projectId === projectId && next.sessionId === sessionId) setRun(next)
    })
    return () => {
      live = false
      unsubscribe()
    }
  }, [projectId, sessionId])

  const running = tryRunIsLive(run)
  // A layout effect, so the word reaches the parent in the same commit that
  // shows "Running": a close that comes before passive effects flush (a busy
  // machine) must still ask.
  useLayoutEffect(() => onRunningChange?.(running), [running, onRunningChange])

  // Follow the output while it is at the bottom.
  const lineCount = run?.lines.length ?? 0
  useEffect(() => {
    const element = outputRef.current
    if (element) element.scrollTop = element.scrollHeight
  }, [lineCount])

  const act = async (action: () => Promise<{ ok: boolean; value?: unknown; error?: string }>) => {
    setBusy(true)
    const result = await action()
    setBusy(false)
    if (!result.ok) {
      setError(result.error ?? null)
      return
    }
    setError(null)
    if (result.value !== undefined) setRun(result.value as TryRun | null)
  }

  const start = async () => {
    let acknowledged = false
    if (needsTryWarning({ tryItWarningSeen: tryItWarningSeen || warned })) {
      const accepted = await confirm({
        title: t('agents:tryIt.warningTitle'),
        body: t('agents:tryIt.warningBody', { command: tryCommand }),
        confirmLabel: t('agents:tryIt.warningConfirm'),
        tone: 'danger'
      })
      if (!accepted) return
      acknowledged = true
      setWarned(true)
    }
    await act(() => window.ostlerAPI.startTryRun(projectId, sessionId, acknowledged))
  }

  const noCommand = !tryCommand
  const ended = run !== null && !running

  return (
    <section className="dialog-section try-it" aria-label={t('agents:tryIt.title')}>
      <div className="session-review__section-head">
        <h3 className="dialog-section__title">{t('agents:tryIt.title')}</h3>
        {run && <TryRunBadge run={run} />}
        <span className="session-review__spacer" />
        {running ? (
          <Button
            variant="secondary"
            size="sm"
            icon={Square}
            disabled={busy}
            onClick={() => void act(() => window.ostlerAPI.stopTryRun(projectId, sessionId))}
          >
            {t('agents:tryIt.stop')}
          </Button>
        ) : (
          <Button
            variant="secondary"
            size="sm"
            icon={Play}
            disabled={busy || noCommand}
            title={noCommand ? t('agents:tryIt.noCommandReason') : undefined}
            aria-describedby={noCommand ? `try-it-reason-${sessionId}` : undefined}
            onClick={() => void start()}
          >
            {ended ? t('agents:tryIt.tryAgain') : t('agents:tryIt.tryIt')}
          </Button>
        )}
      </div>
      {noCommand ? (
        <p className="dialog-muted" id={`try-it-reason-${sessionId}`}>
          {t('agents:tryIt.noCommandReason')}
        </p>
      ) : (
        !run && (
          <p className="dialog-muted">{t('agents:tryIt.runsCommand', { command: tryCommand })}</p>
        )
      )}

      {suggestion && suggestion !== tryCommand && (
        <p className="try-it__suggestion">
          <span>{t('agents:tryIt.agentSuggests')}</span> <code>{suggestion}</code>{' '}
          <Button variant="ghost" size="sm" onClick={() => onUseCommand(suggestion)}>
            {t('agents:tryIt.useThisCommand')}
          </Button>
        </p>
      )}

      {error && <InlineAlert tone="danger">{error}</InlineAlert>}
      {run?.failure && <InlineAlert tone="danger">{run.failure}</InlineAlert>}

      {run && run.lines.length > 0 && (
        <pre
          ref={outputRef}
          className="try-it__output"
          tabIndex={0}
          aria-label={t('agents:tryIt.output')}
        >
          {run.lines.map((line, index) => (
            <div key={index} className="try-it__line">
              {outputSegments(line).map((segment, part) =>
                segment.url ? (
                  <a
                    key={part}
                    href={segment.url}
                    onClick={(event) => {
                      event.preventDefault()
                      void window.ostlerAPI.openTryAddress(segment.url!)
                    }}
                  >
                    {segment.text}
                  </a>
                ) : (
                  <span key={part}>{segment.text}</span>
                )
              )}
            </div>
          ))}
        </pre>
      )}

      {ended && run.leftFiles.length > 0 && (
        <InlineAlert tone="warning">
          <p>{t('agents:tryIt.leftFiles', { count: run.leftFiles.length })}</p>
          <ul className="try-it__files">
            {run.leftFiles.map((file) => (
              <li key={file}>
                <code>{file}</code>
              </li>
            ))}
          </ul>
          <div className="try-it__actions">
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() =>
                void act(() => window.ostlerAPI.undoTryLeftFiles(projectId, sessionId))
              }
            >
              {t('agents:tryIt.undoChanges')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() =>
                void act(() => window.ostlerAPI.keepTryLeftFiles(projectId, sessionId))
              }
            >
              {t('agents:tryIt.keepChanges')}
            </Button>
          </div>
        </InlineAlert>
      )}
    </section>
  )
}

function TryRunBadge({ run }: { run: TryRun }) {
  switch (run.state) {
    case 'setting-up':
      return <Badge tone="info">{t('agents:tryIt.stateSettingUp')}</Badge>
    case 'running':
      return <Badge tone="info">{t('agents:tryIt.stateRunning')}</Badge>
    case 'exited':
      return (
        <Badge tone={run.exitCode === 0 ? 'success' : 'warning'}>
          {t('agents:tryIt.stateExited', { code: run.exitCode ?? '?' })}
        </Badge>
      )
    case 'stopped':
      return <Badge tone="neutral">{t('agents:tryIt.stateStopped')}</Badge>
    case 'failed':
      return <Badge tone="danger">{t('agents:tryIt.stateFailed')}</Badge>
  }
}
