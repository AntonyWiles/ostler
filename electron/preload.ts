import { contextBridge, ipcRenderer } from 'electron'
// Values from the modules that hold them, never the '@shared/ostler-api' barrel:
// the barrel also brings in modules that need i18next, which a sandboxed
// preload cannot load (P11.1).
import { IPC_CHANNELS } from '@shared/ostler-api/ipc-types'
import { API_CHANNELS, type ApiInvokeMethod } from '@shared/ostler-api/api-channels'
import { parseAppearanceArgument } from '@shared/ostler-api/appearance-types'
import { parseLocaleArgument } from '@shared/ostler-api/locale-types'
import { OFF_SCREEN_ARGUMENT } from '@shared/off-screen-clipboard'
import { keepClipboardKeysInOstler } from './preload-clipboard'
import type {
  OstlerAPI,
  WatchEvent,
  AIStreamChunk,
  ProjectStateUpdate,
  OstlerNotification,
  CodeCommandOutputEvent,
  TaskSplitJob,
  AskOstlerProgress,
  NavigateRequest,
  AppCommand,
  UpdateState,
  LocaleInfo,
  FocusChange,
  WindowState
} from '@shared/ostler-api'
import type { TryRun } from '@shared/try-it'

function subscribe<T>(channel: string, callback: (data: T) => void): () => void {
  const handler = (_event: Electron.IpcRendererEvent, data: T) => callback(data)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

/** One pass-through per `API_CHANNELS` entry: the arguments go to main unchanged. */
const invokers = Object.fromEntries(
  Object.entries(API_CHANNELS).map(([method, channel]) => [
    method,
    (...args: unknown[]) => ipcRenderer.invoke(channel, ...args)
  ])
) as Pick<OstlerAPI, ApiInvokeMethod>

const api: OstlerAPI = {
  ...invokers,
  // Main gets a real boolean, whatever the renderer passed.
  openInNewWindow: (route, closeOldest) =>
    ipcRenderer.invoke(API_CHANNELS.openInNewWindow, route, closeOldest === true),
  pinTaskToDesktop: (projectId, taskId, unpinOldest) =>
    ipcRenderer.invoke(API_CHANNELS.pinTaskToDesktop, projectId, taskId, unpinOldest === true),

  // --- Subscriptions ---
  onWatchEvent: (callback) => subscribe<WatchEvent>(IPC_CHANNELS.ON_WATCH_EVENT, callback),
  onAIStreamChunk: (callback) =>
    subscribe<AIStreamChunk>(IPC_CHANNELS.ON_AI_STREAM_CHUNK, callback),
  onProjectStateChange: (callback) =>
    subscribe<ProjectStateUpdate>(IPC_CHANNELS.ON_PROJECT_STATE_CHANGE, callback),
  onAccountsChange: (callback) =>
    subscribe<null>(IPC_CHANNELS.ON_ACCOUNTS_CHANGE, () => callback()),
  onNotification: (callback) =>
    subscribe<OstlerNotification>(IPC_CHANNELS.ON_NOTIFICATION, callback),
  onCodeCommandOutput: (callback) =>
    subscribe<CodeCommandOutputEvent>(IPC_CHANNELS.ON_CODE_COMMAND_OUTPUT, callback),
  onTaskSplitProgress: (callback) =>
    subscribe<TaskSplitJob>(IPC_CHANNELS.ON_TASK_SPLIT_PROGRESS, callback),
  onAskOstlerProgress: (callback) =>
    subscribe<AskOstlerProgress>(IPC_CHANNELS.ON_ASK_OSTLER_PROGRESS, callback),
  onTryRunChanged: (callback) => subscribe<TryRun>(IPC_CHANNELS.ON_TRY_RUN_CHANGED, callback),
  onWindowsAccentChanged: (callback) =>
    subscribe<string | null>(IPC_CHANNELS.ON_WINDOWS_ACCENT_CHANGED, callback),
  onLocaleChanged: (callback) => subscribe<LocaleInfo>(IPC_CHANNELS.ON_LOCALE_CHANGED, callback),
  onNavigate: (callback) => subscribe<NavigateRequest>(IPC_CHANNELS.ON_NAVIGATE, callback),
  onAppCommand: (callback) => subscribe<AppCommand>(IPC_CHANNELS.ON_APP_COMMAND, callback),
  onWindowState: (callback) => subscribe<WindowState>(IPC_CHANNELS.ON_WINDOW_STATE, callback),
  onFlushEdits: (callback) => subscribe<number>(IPC_CHANNELS.ON_FLUSH_EDITS, callback),
  onOpenInMainWindow: (callback) =>
    subscribe<string>(IPC_CHANNELS.ON_OPEN_IN_MAIN_WINDOW, callback),
  onNewTaskReturned: (callback) => subscribe<string>(IPC_CHANNELS.ON_NEW_TASK_RETURNED, callback),
  onUpdateState: (callback) => subscribe<UpdateState>(IPC_CHANNELS.ON_UPDATE_STATE, callback),
  onTimeChange: (callback) =>
    subscribe<{ projectId: string }>(IPC_CHANNELS.ON_TIME_CHANGE, callback),
  onFocusChange: (callback) => subscribe<FocusChange>(IPC_CHANNELS.ON_FOCUS_CHANGE, callback),

  // --- Values ---
  // Main passes it through webPreferences.additionalArguments (window.ts).
  initialAppearance: (() => {
    const appearance = parseAppearanceArgument(process.argv)
    return appearance ? Object.freeze(appearance) : null
  })(),
  initialLocale: (() => {
    const locale = parseLocaleArgument(process.argv)
    return locale ? Object.freeze(locale) : null
  })()
}

contextBridge.exposeInMainWorld('ostlerAPI', api)

// Off screen (main says so), copy and paste use Ostler's own clipboard, never the Windows one.
if (process.argv.includes(OFF_SCREEN_ARGUMENT)) {
  keepClipboardKeysInOstler((channel, ...args) => ipcRenderer.invoke(channel, ...args))
}
