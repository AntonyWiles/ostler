import { useState } from 'react'
import { projectFolder } from '@shared/project-folder'
import { useOstler } from '../../../context/OstlerContext'
import { useFeatures } from '../../../navigation/features'
import { Badge, Button, Switch, TextArea } from '../../../ui'
import { CommittedNumberField, SettingsGroup, useSettings } from '../settings-form'
import { t } from '@shared/i18n'
import { formatRelativeTime } from '@shared/format'
import { Trans } from '../../../i18n/Trans'

/**
 * Settings › Advanced: file activity (the watcher), Ostler AI's context size,
 * version history and developer notes; Git has its own section under it.
 * Technical words are allowed here; an API's port sits beside its own switch
 * (Agents, Connections).
 */
export function AdvancedSection() {
  const { config, saveConfig } = useSettings()
  const features = useFeatures()

  return (
    <>
      <FileActivityStatus />
      <FileActivitySettings />

      {features.ai && (
        <SettingsGroup
          id="advanced-ai"
          description={t('settings:advancedSection.contextSizeDescription')}
        >
          <CommittedNumberField
            label={t('settings:advancedSection.aiContextSize')}
            unit={t('settings:advancedSection.tokens')}
            min={8_000}
            max={2_000_000}
            step={1_000}
            value={config.ai.contextTokens}
            hint={t('settings:advancedSection.contextSizeHint')}
            onCommit={(contextTokens) => void saveConfig({ ai: { contextTokens } })}
          />
        </SettingsGroup>
      )}

      {features.agents && (
        <SettingsGroup
          id="version-history"
          description={t('settings:advancedSection.versionHistoryDescription')}
        >
          <Switch
            label={t('settings:advancedSection.manageHistoryMyself')}
            hint={t('settings:advancedSection.manageHistoryMyselfHint')}
            checked={!config.history.saveMyEdits}
            onChange={(event) =>
              void saveConfig({ history: { saveMyEdits: !event.target.checked } })
            }
          />
        </SettingsGroup>
      )}

      <SettingsGroup id="developer">
        <p className="ostler-settings-text">
          <Trans
            i18nKey="settings:advancedSection.developerLogs"
            values={{ aiLog: 'logs/ai-calls.log', mainLog: 'logs/main.log' }}
            components={{ code: <code /> }}
          />
        </p>
      </SettingsGroup>
    </>
  )
}

/** What each project's file watcher is doing, and its last error (moved from the status bar). */
function FileActivityStatus() {
  const { projects, watcherStatus } = useOstler()
  const [busy, setBusy] = useState<string | null>(null)
  const watched = projects.filter((project) => project.enabled && projectFolder(project) !== null)

  const toggle = async (projectId: string, watching: boolean) => {
    setBusy(projectId)
    try {
      if (watching) await window.ostlerAPI.pauseWatcher(projectId)
      else await window.ostlerAPI.resumeWatcher(projectId)
    } finally {
      setBusy(null)
    }
  }

  return (
    <SettingsGroup
      id="file-activity"
      description={t('settings:advancedSection.noticesWhenFilesChange')}
    >
      {watched.length === 0 ? (
        <p className="ostler-settings-hint">{t('settings:advancedSection.noProjectHasLinked')}</p>
      ) : (
        <ul
          className="ostler-settings-list"
          aria-label={t('settings:advancedSection.fileActivityProject')}
        >
          {watched.map((project) => {
            const status = watcherStatus?.projects.find((entry) => entry.projectId === project.id)
            const watching = status?.watching ?? false
            return (
              <li key={project.id} className="ostler-settings-list-row">
                <span className="ostler-settings-list-name">{project.name}</span>
                <Badge tone={status?.error ? 'danger' : watching ? 'success' : 'neutral'}>
                  {status?.error
                    ? t('settings:advancedSection.error')
                    : watching
                      ? t('settings:advancedSection.watching')
                      : t('settings:advancedSection.paused')}
                </Badge>
                <span className="ostler-settings-hint">
                  {status?.lastEvent
                    ? t('settings:advancedSection.lastChange', {
                        when: formatRelativeTime(status.lastEvent)
                      })
                    : t('settings:advancedSection.noChangesSeenYet')}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy === project.id}
                  aria-label={
                    watching
                      ? t('settings:advancedSection.pauseFileActivity', {
                          projectName: project.name
                        })
                      : t('settings:advancedSection.resumeFileActivity', {
                          projectName: project.name
                        })
                  }
                  onClick={() => void toggle(project.id, watching)}
                >
                  {watching
                    ? t('settings:advancedSection.pause')
                    : t('settings:advancedSection.resume')}
                </Button>
                {status?.error && (
                  <details className="ostler-settings-details ostler-settings-list-detail">
                    <summary>{t('settings:advancedSection.details')}</summary>
                    <code>{status.error}</code>
                  </details>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </SettingsGroup>
  )
}

function FileActivitySettings() {
  const { config, saveConfig } = useSettings()
  const watcher = config.watcher
  const [patterns, setPatterns] = useState(watcher.ignorePatterns.join('\n'))

  return (
    <SettingsGroup id="file-activity-settings">
      <TextArea
        label={t('settings:advancedSection.filesFoldersIgnore')}
        hint={t('settings:advancedSection.onePatternPerLine')}
        value={patterns}
        rows={5}
        spellCheck={false}
        onChange={(event) => setPatterns(event.target.value)}
        onBlur={() => {
          const ignorePatterns = patterns
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean)
          if (ignorePatterns.join('\n') !== watcher.ignorePatterns.join('\n')) {
            void saveConfig({ watcher: { ignorePatterns } })
          }
        }}
      />
      <CommittedNumberField
        label={t('settings:advancedSection.checkChangesEvery')}
        unit={t('common:unit.ms')}
        min={500}
        max={10000}
        step={100}
        value={watcher.pollingIntervalMs}
        onCommit={(pollingIntervalMs) => void saveConfig({ watcher: { pollingIntervalMs } })}
      />
      <CommittedNumberField
        label={t('settings:advancedSection.groupChangesMadeWithin')}
        unit={t('common:unit.ms')}
        min={100}
        max={2000}
        step={100}
        value={watcher.debounceMs}
        onCommit={(debounceMs) => void saveConfig({ watcher: { debounceMs } })}
      />
      <CommittedNumberField
        label={t('settings:advancedSection.ignoreFilesLargerThan')}
        unit={t('common:unit.MB')}
        min={1}
        max={1024}
        value={Math.round(watcher.maxFileSize / (1024 * 1024))}
        onCommit={(megabytes) =>
          void saveConfig({ watcher: { maxFileSize: megabytes * 1024 * 1024 } })
        }
      />
    </SettingsGroup>
  )
}
