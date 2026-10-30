import { useCallback, useEffect, useState } from 'react'
import { formatFileSize } from '@shared/format'
import type { AgentStorageUsage, DatabaseStats, LibraryTextProgress } from '@shared/ostler-api'
import { Button, InlineAlert, useConfirm, useToast } from '../../../ui'
import { BackupsSection } from '../BackupsSection'
import { CommittedNumberField, SettingsGroup, useSettings } from '../settings-form'
import { useFeatures } from '../../../navigation/features'
import { ImportGroup } from './ImportGroup'
import { t } from '@shared/i18n'

/** Settings › Data: how much is stored, pruning old activity, imports (P6.1) and backups (P1.1). */
export function DataSection() {
  const { config, saveConfig } = useSettings()
  const features = useFeatures()
  const confirm = useConfirm()
  const { toast } = useToast()
  const [stats, setStats] = useState<DatabaseStats | null>(null)

  const load = useCallback(async () => {
    const result = await window.ostlerAPI.getDatabaseStats()
    if (result.ok) setStats(result.value)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const prune = async () => {
    const ok = await confirm({
      title: t('settings:dataSection.deleteActivityOlderThan'),
      body: t('settings:dataSection.fileGitAgentActivity'),
      confirmLabel: t('settings:dataSection.deleteOldActivity2'),
      tone: 'danger'
    })
    if (!ok) return
    const result = await window.ostlerAPI.pruneDatabase(30)
    if (result.ok) {
      toast({
        title: t('settings:dataSection.deletedOldActivityRecords', {
          deletedCount: result.value.deletedCount
        }),
        tone: 'success'
      })
      void load()
    } else {
      toast({
        title: t('settings:dataSection.couldntDeleteOldActivity'),
        body: result.error,
        tone: 'danger'
      })
    }
  }

  return (
    <>
      <SettingsGroup
        id="storage"
        description={t('settings:dataSection.everythingStoresStaysComputer')}
        actions={
          <Button variant="danger" onClick={() => void prune()}>
            {t('settings:dataSection.deleteOldActivity')}
          </Button>
        }
      >
        <dl className="ostler-settings-stats">
          <Stat
            label={t('settings:dataSection.databaseSize')}
            value={stats ? formatFileSize(stats.sizeBytes) : '…'}
          />
          <Stat
            label={t('settings:dataSection.fileActivityRecords')}
            value={stats?.watchEventCount ?? '…'}
          />
          <Stat
            label={t('settings:dataSection.gitActivityRecords')}
            value={stats?.gitEventCount ?? '…'}
          />
          <Stat
            label={t('settings:dataSection.aiConversations')}
            value={stats?.conversationCount ?? '…'}
          />
        </dl>
        {stats?.syncedBy && (
          <InlineAlert tone="warning">
            {t('settings:dataSection.dataFolderSynced', { service: stats.syncedBy })}
          </InlineAlert>
        )}
        <LibraryReadingLine />
      </SettingsGroup>
      {features.agents && <AgentStorageGroup />}
      <ImportGroup />
      <BackupsSection config={config} saveConfig={saveConfig} />
    </>
  )
}

/** How often the reading line asks how far the background pass has got. */
const READING_POLL_MS = 2_000

/**
 * "Reading 12 of 140 files for search" while the background pass reads the
 * Library's files (N4.5); nothing otherwise.
 */
export function LibraryReadingLine() {
  const [progress, setProgress] = useState<LibraryTextProgress | null>(null)

  useEffect(() => {
    let live = true
    const check = async () => {
      const result = await window.ostlerAPI.getLibraryTextProgress()
      if (live && result.ok) setProgress(result.value)
    }
    void check()
    const timer = window.setInterval(() => void check(), READING_POLL_MS)
    return () => {
      live = false
      window.clearInterval(timer)
    }
  }, [])

  if (!progress) return null
  return (
    <p className="ostler-settings-hint" role="status">
      {t('settings:dataSection.readingFilesForSearch', {
        done: progress.done,
        total: progress.total
      })}
    </p>
  )
}

/**
 * Space the agents' copies and kept history use, how long restore points and
 * discarded work are kept, and the files kept from the old agent setup
 * (simplify pass §3.5, §6).
 */
function AgentStorageGroup() {
  const { config, saveConfig } = useSettings()
  const confirm = useConfirm()
  const { toast } = useToast()
  const [usage, setUsage] = useState<AgentStorageUsage | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const result = await window.ostlerAPI.getAgentStorage()
    if (result.ok) setUsage(result.value)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const removeLegacy = async () => {
    const ok = await confirm({
      title: t('settings:dataSection.removeOldAgentFilesTitle'),
      body: t('settings:dataSection.removeOldAgentFilesBody'),
      confirmLabel: t('settings:dataSection.remove'),
      tone: 'danger'
    })
    if (!ok) return
    setBusy(true)
    try {
      const result = await window.ostlerAPI.removeLegacyAgentFiles()
      if (result.ok) {
        setUsage(result.value)
        toast({ title: t('settings:dataSection.oldAgentFilesRemoved'), tone: 'success' })
      } else {
        toast({
          title: t('settings:dataSection.couldntRemoveOldAgentFiles'),
          body: result.error,
          tone: 'danger'
        })
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingsGroup
      id="agent-copies"
      description={t('settings:dataSection.agentCopiesAndHistoryDescription')}
    >
      <dl className="ostler-settings-stats">
        <Stat
          label={t('settings:dataSection.agentCopies')}
          value={
            usage
              ? t('settings:dataSection.copiesSize', {
                  count: usage.copies,
                  size: formatFileSize(usage.copiesBytes)
                })
              : '…'
          }
        />
        <Stat label={t('settings:dataSection.restorePoints')} value={usage?.restorePoints ?? '…'} />
        <Stat label={t('settings:dataSection.discardedWork')} value={usage?.discardedWork ?? '…'} />
      </dl>
      <CommittedNumberField
        label={t('settings:dataSection.keepRestorePointsFor')}
        unit={t('settings:dataSection.days')}
        min={1}
        max={365}
        step={1}
        value={config.history.retentionDays}
        hint={t('settings:dataSection.keepRestorePointsHint')}
        onCommit={(retentionDays) => void saveConfig({ history: { retentionDays } })}
      />
      {usage && usage.legacyBytes > 0 && (
        <div className="ostler-settings-inline-actions">
          <span className="ostler-settings-text">
            {t('settings:dataSection.oldAgentFiles', { size: formatFileSize(usage.legacyBytes) })}
          </span>
          <Button size="sm" variant="danger" disabled={busy} onClick={() => void removeLegacy()}>
            {t('settings:dataSection.remove')}
          </Button>
        </div>
      )}
    </SettingsGroup>
  )
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="ostler-settings-stat">
      <dt>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  )
}
