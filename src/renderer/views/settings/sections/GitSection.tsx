import { Switch } from '../../../ui'
import { CommittedNumberField, SettingsGroup, useSettings } from '../settings-form'
import { t } from '@shared/i18n'

/** Settings › Advanced › Git: whether and how often Ostler reads a project folder's commits. */
export function GitSection() {
  const { config, saveConfig } = useSettings()

  return (
    <SettingsGroup id="git" description={t('settings:advancedSection.projectsWhoseFolderGit')}>
      <Switch
        label={t('settings:advancedSection.readGitHistory')}
        checked={config.git.enabled}
        onChange={(event) => void saveConfig({ git: { enabled: event.target.checked } })}
      />
      <CommittedNumberField
        label={t('settings:advancedSection.checkNewCommitsEvery')}
        unit={t('common:unit.seconds')}
        min={5}
        max={120}
        step={5}
        value={Math.round(config.git.pollIntervalMs / 1000)}
        disabled={!config.git.enabled}
        onCommit={(seconds) => void saveConfig({ git: { pollIntervalMs: seconds * 1000 } })}
      />
      <CommittedNumberField
        label={t('settings:advancedSection.commitsReadTime')}
        min={10}
        max={200}
        step={10}
        value={config.git.maxCommitsToFetch}
        disabled={!config.git.enabled}
        onCommit={(maxCommitsToFetch) => void saveConfig({ git: { maxCommitsToFetch } })}
      />
    </SettingsGroup>
  )
}
