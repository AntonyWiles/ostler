import type { HarnessSession } from '@shared/ostler-api'
import type { useConfirm } from '../../../ui'
import { t } from '@shared/i18n'

type Confirm = ReturnType<typeof useConfirm>
type RunAction = (action: () => Promise<{ ok: boolean; error?: string }>) => Promise<boolean>

/**
 * Stop (simplify pass §3.3), with one wording and one confirmation wherever a
 * running agent shows it: the Agents view's Working now and the task dialog.
 * The agent ends, its work is kept aside the way Discard keeps it, and its
 * task goes back to the queue. Resolves true once it has stopped.
 */
export async function stopAgent({
  projectId,
  session,
  confirm,
  runHarnessAction
}: {
  projectId: string
  session: Pick<HarnessSession, 'id' | 'title'>
  confirm: Confirm
  runHarnessAction: RunAction
}): Promise<boolean> {
  const ok = await confirm({
    title: t('agents:stopAgent.title', { title: session.title }),
    body: t('agents:stopAgent.body'),
    confirmLabel: t('agents:stopAgent.stop'),
    tone: 'danger'
  })
  if (!ok) return false
  return runHarnessAction(() => window.ostlerAPI.stopHarnessSession(projectId, session.id))
}
