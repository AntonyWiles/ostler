import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import type { Result, WatchedProject } from '@shared/ostler-api'
import {
  API_CHANNELS,
  type ApiArgs,
  type ApiInvokeMethod,
  type ApiProjectArgs,
  type ApiValue
} from '@shared/ostler-api/api-channels'
import { appLog } from '../app/logging'
import { countIpcCall } from '../app/ipc-call-counter'
import { t } from '@shared/i18n'
import { isContributorOnlyError, isReadOnlyError, isRefusal, refusalLogLine } from '@shared/refusal'
import { runAsking } from '../services/send-to-window'
import { recordChanges } from '../services/change-history/context'

type IpcHandler<TArgs extends unknown[], TValue> = (
  event: IpcMainInvokeEvent,
  ...args: TArgs
) => TValue | Promise<TValue>

/**
 * Registers an IPC handler that always returns the Ostler Result contract.
 * Domain handlers can throw normally; raw exceptions never cross the bridge.
 * The user sees the error's message alone (no "Error: " prefix). A refusal
 * (`@shared/refusal`) is an expected "no" and goes to main.log as one INFO
 * line; anything else is an ERROR with its stack. Each call is one step of
 * the undo history: what it writes is recorded (`change-history/context.ts`).
 */
export function handleIpc<TArgs extends unknown[], TValue>(
  channel: string,
  handler: IpcHandler<TArgs, TValue>
): void {
  ipcMain.handle(channel, async (event, ...args: TArgs): Promise<Result<TValue>> => {
    countIpcCall(channel)
    try {
      // The window that asked (N5.8a): its dialogs and replies go to it.
      return {
        ok: true,
        value: await recordChanges(channel, async () =>
          runAsking(event?.sender, () => handler(event, ...args))
        )
      }
    } catch (error) {
      if (isRefusal(error) || isReadOnlyError(error)) {
        appLog.info(refusalLogLine(`IPC ${channel} refused`, error))
      } else appLog.error(`IPC ${channel} failed`, error)
      return { ok: false, error: ipcErrorMessage(error) }
    }
  })
}

/**
 * `handleIpc` for an `OstlerAPI` call, by method name: the channel comes from
 * `API_CHANNELS`, and the handler's arguments and value are checked against the
 * method's declaration, so the two cannot drift apart.
 */
export function handleApi<M extends ApiInvokeMethod>(
  method: M,
  handler: IpcHandler<ApiArgs<M>, ApiValue<M>>
): void {
  handleIpc(API_CHANNELS[method], handler)
}

/** What a failed IPC call tells the renderer: the message, never the stack. */
export function ipcErrorMessage(error: unknown): string {
  // A write a Viewer's PC refuses (D9): the database guard raises `ostler:read-only`.
  if (isContributorOnlyError(error)) return t('errors:sharing.contributorOnly')
  if (isReadOnlyError(error)) return t('errors:sharing.readOnly')
  if (error instanceof Error) return error.message || error.name
  return String(error)
}

type ProjectHandler<TArgs extends unknown[], TValue> = (
  project: WatchedProject,
  ...args: TArgs
) => TValue | Promise<TValue>

/**
 * The two wrappers every project-scoped IPC surface needs.
 *
 * Nearly all of these channels take a project id first and immediately resolve
 * it, because resolution is also the access check — a handler that skipped it
 * would read or write state for a project that is no longer registered. The
 * mutating ones then have to push the new harness state to the renderer, which
 * was a line each handler had to remember and any new one could silently omit.
 *
 * `projectApi` does the resolution; `mutatingApi` also notifies once the
 * handler returns. Both take the `OstlerAPI` method name and are typed from it
 * (see `handleApi`). A handler that has to notify part-way through (because it
 * kicks off background work of its own) uses `projectApi` and calls
 * `notifyHarnessState` itself.
 */
export function projectIpcHandlers(
  getProject: (projectId: string) => WatchedProject,
  notifyHarnessState: (project: WatchedProject) => void
) {
  const register = <TArgs extends unknown[], TValue>(
    channel: string,
    handler: ProjectHandler<TArgs, TValue>,
    notify: boolean
  ): void => {
    handleIpc(channel, async (_event, projectId: string, ...args: TArgs) => {
      const project = getProject(projectId)
      const value = await handler(project, ...args)
      if (notify) notifyHarnessState(project)
      return value
    })
  }

  return {
    projectApi: <M extends ApiInvokeMethod>(
      method: M,
      handler: ProjectHandler<ApiProjectArgs<M>, ApiValue<M>>
    ): void => register(API_CHANNELS[method], handler, false),
    mutatingApi: <M extends ApiInvokeMethod>(
      method: M,
      handler: ProjectHandler<ApiProjectArgs<M>, ApiValue<M>>
    ): void => register(API_CHANNELS[method], handler, true)
  }
}
