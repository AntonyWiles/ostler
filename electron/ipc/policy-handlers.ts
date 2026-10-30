import { type OrgPolicy, type SetSyncServerInput } from '@shared/ostler-api'
import { policySummary } from '../services/policy'
import type { SyncServerSettings } from '../services/sync/sync-server-settings'
import { handleApi } from './handle-ipc'

/**
 * The organisation's policy and the sync server (docs/plans/integrations/overview.md,
 * phase 7). The renderer is told what the policy sets, never its client IDs;
 * a sync server's access key comes in once, to save, and is never sent back.
 */
export function registerPolicyHandlers({
  policy,
  syncServer
}: {
  policy(): OrgPolicy
  syncServer: SyncServerSettings | null
}): void {
  handleApi('getPolicy', () => policySummary(policy()))
  handleApi('getSyncServer', () => syncServer?.state() ?? null)
  handleApi('setSyncServer', (_event, input: SetSyncServerInput) => {
    if (!syncServer) return null
    return syncServer.set(input)
  })
  handleApi('clearSyncServer', () => syncServer?.clear() ?? null)
}
