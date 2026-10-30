import { shell } from 'electron'
import { type WatchedProject } from '@shared/ostler-api'
import { t } from '@shared/i18n'
import { isLocalAddress } from '@shared/try-it'
import type { TryItService } from '../services/harness/try-it'
import { projectIpcHandlers, handleApi } from './handle-ipc'

export interface TryItHandlerDependencies {
  tryIt: TryItService
  getProject(projectId: string): WatchedProject
  notifyHarnessState(project: WatchedProject): void
}

/** Try it (N9.4): started, stopped and tidied only by the person, in the app. */
export function registerTryItHandlers({
  tryIt,
  getProject,
  notifyHarnessState
}: TryItHandlerDependencies): void {
  const { projectApi } = projectIpcHandlers(getProject, notifyHarnessState)

  /** The session must belong to the project the call names. */
  const own = (project: WatchedProject, sessionId: unknown) => {
    if (typeof sessionId !== 'string' || !sessionId) throw new Error('Send a session id')
    const run = tryIt.get(sessionId)
    if (run && run.projectId !== project.id) throw new Error('That session is in another project')
    return sessionId
  }

  projectApi('getTryRun', (project, sessionId: unknown) => tryIt.get(own(project, sessionId)))
  projectApi('startTryRun', (project, sessionId: unknown, acknowledged: unknown) =>
    tryIt.start(project.id, own(project, sessionId), acknowledged === true)
  )
  projectApi('stopTryRun', (project, sessionId: unknown) => tryIt.stop(own(project, sessionId)))
  projectApi('undoTryLeftFiles', (project, sessionId: unknown) =>
    tryIt.undoLeftFiles(own(project, sessionId))
  )
  projectApi('keepTryLeftFiles', (project, sessionId: unknown) =>
    tryIt.keepLeftFiles(own(project, sessionId))
  )

  // Only http(s) addresses on this computer: the output is the agent's code's.
  handleApi('openTryAddress', async (_event, url: unknown) => {
    if (typeof url !== 'string' || !isLocalAddress(url)) {
      throw new Error(t('errors:tryIt.onlyLocalAddresses'))
    }
    await shell.openExternal(url)
  })
}
